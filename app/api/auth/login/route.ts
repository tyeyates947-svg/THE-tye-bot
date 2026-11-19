import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { createSession, publicProfile, requestIpHash, verifyPin } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const dummyPinHash = `scrypt$${"0".repeat(32)}$${"0".repeat(128)}`;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { username?: string; pin?: string };
    const username = String(body.username ?? "").trim().toLowerCase();
    const pin = String(body.pin ?? "");
    if (!/^[a-z0-9_]{3,24}$/.test(username) || !/^\d{4}$/.test(pin)) {
      return NextResponse.json({ error: "Enter a valid username and four-digit PIN." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data: allowed, error: rateError } = await supabase.rpc("qp_record_pin_attempt", {
      p_username: username,
      p_ip_hash: requestIpHash(request),
    });
    if (rateError) throw new Error(`PIN rate limit check failed: ${rateError.message}`);
    if (!allowed) return NextResponse.json({ error: "Too many attempts. Try again in 15 minutes." }, { status: 429 });

    const { data: row, error } = await supabase.from("profiles")
      .select("id, username, pin_hash, avatar_url, balance_gbp, total_profit_gbp, wins, losses")
      .eq("username", username).maybeSingle();
    if (error) throw new Error(`Could not look up account: ${error.message}`);
    const validPin = await verifyPin(pin, row?.pin_hash ?? dummyPinHash);
    if (!row || !validPin) return NextResponse.json({ error: "Username or PIN is incorrect." }, { status: 401 });

    const token = await createSession(row.id);
    return NextResponse.json({ token, profile: publicProfile(row) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sign-in failed.";
    const status = message.includes("Supabase is not configured") ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
