import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { createSession, hashPin, publicProfile, requestIpHash } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { username?: string; pin?: string; avatarUrl?: string };
    const username = String(body.username ?? "").trim().toLowerCase();
    const pin = String(body.pin ?? "");
    const avatarUrl = String(body.avatarUrl ?? "pulse:lime");
    if (!/^[a-z0-9_]{3,24}$/.test(username)) {
      return NextResponse.json({ error: "Username must be 3–24 letters, numbers or underscores." }, { status: 400 });
    }
    if (!/^\d{4}$/.test(pin)) return NextResponse.json({ error: "PIN must contain exactly four digits." }, { status: 400 });
    if (avatarUrl.length > 100_000 || (!avatarUrl.startsWith("pulse:") && !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(avatarUrl))) {
      return NextResponse.json({ error: "Choose a preset avatar or a compressed JPEG, PNG or WebP image under 75 KB." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data: allowed, error: rateError } = await supabase.rpc("qp_record_pin_attempt", {
      p_username: username,
      p_ip_hash: requestIpHash(request),
    });
    if (rateError) throw new Error(`Account rate limit check failed: ${rateError.message}`);
    if (!allowed) return NextResponse.json({ error: "Too many account attempts. Try again in 15 minutes." }, { status: 429 });
    const { data: row, error } = await supabase.from("profiles").insert({
      username,
      pin_hash: await hashPin(pin),
      avatar_url: avatarUrl,
    }).select("id, username, avatar_url, balance_gbp, total_profit_gbp, wins, losses").single();
    if (error) {
      if (error.code === "23505") return NextResponse.json({ error: "That username is already taken." }, { status: 409 });
      throw new Error(`Could not create profile: ${error.message}`);
    }
    const token = await createSession(row.id);
    return NextResponse.json({ token, profile: publicProfile(row) }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Account creation failed.";
    const status = message.includes("Supabase is not configured") ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
