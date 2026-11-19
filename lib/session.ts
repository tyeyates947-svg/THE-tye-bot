import { createHash, randomBytes, scrypt as nodeScrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

const scrypt = promisify(nodeScrypt);
const SESSION_DAYS = 30;

export interface Profile {
  id: string;
  username: string;
  avatar_url: string;
  balance_gbp: number;
  total_profit_gbp: number;
  wins: number;
  losses: number;
}

const DUMMY_PASSWORD_HASH = `scrypt$${"0".repeat(32)}$${"0".repeat(128)}`;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64) as Buffer;
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, salt, savedHex] = stored.split("$");
  if (algorithm !== "scrypt" || !salt || !savedHex || !/^[0-9a-f]{128}$/i.test(savedHex)) return false;
  const actual = await scrypt(password, salt, 64) as Buffer;
  return timingSafeEqual(actual, Buffer.from(savedHex, "hex"));
}

export async function checkAuthAttempt(email: string, request: NextRequest): Promise<boolean> {
  const { data: allowed, error } = await getSupabaseAdmin().rpc("qp_record_auth_attempt", {
    p_email: email,
    p_ip_hash: requestIpHash(request),
  });
  if (error) throw new Error(`Authentication rate limit check failed: ${error.message}`);
  return Boolean(allowed);
}

export function dummyPasswordHash(): string {
  return DUMMY_PASSWORD_HASH;
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(profileId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const { error } = await getSupabaseAdmin().from("auth_sessions").insert({
    token_hash: hashSessionToken(token),
    profile_id: profileId,
    expires_at: new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString(),
  });
  if (error) throw new Error(`Could not create session: ${error.message}`);
  return token;
}

export function publicProfile(row: Record<string, unknown>): Profile {
  return {
    id: String(row.id),
    username: String(row.username),
    avatar_url: String(row.avatar_url ?? "pulse:lime"),
    balance_gbp: Number(row.balance_gbp ?? 0),
    total_profit_gbp: Number(row.total_profit_gbp ?? 0),
    wins: Number(row.wins ?? 0),
    losses: Number(row.losses ?? 0),
  };
}

export async function getSessionProfile(request: NextRequest): Promise<{ profile: Profile; tokenHash: string } | null> {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!/^[\w-]{40,60}$/.test(token)) return null;
  const tokenHash = hashSessionToken(token);
  const supabase = getSupabaseAdmin();
  const { data: session, error: sessionError } = await supabase.from("auth_sessions")
    .select("profile_id, expires_at").eq("token_hash", tokenHash).maybeSingle();
  if (sessionError) throw new Error(`Could not validate session: ${sessionError.message}`);
  if (!session || new Date(session.expires_at).getTime() <= Date.now()) {
    if (session) await supabase.from("auth_sessions").delete().eq("token_hash", tokenHash);
    return null;
  }
  const { data: row, error } = await supabase.from("profiles")
    .select("id, username, avatar_url, balance_gbp, total_profit_gbp, wins, losses")
    .eq("id", session.profile_id).single();
  if (error || !row) throw new Error(`Could not load profile: ${error?.message ?? "Profile not found"}`);
  return { profile: publicProfile(row), tokenHash };
}

export function requestIpHash(request: NextRequest): string {
  const address = request.headers.get("x-vercel-forwarded-for")
    ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? request.headers.get("x-real-ip")
    ?? "unknown";
  return createHash("sha256").update(`${process.env.SUPABASE_SERVICE_ROLE_KEY}:${address}`).digest("hex");
}
