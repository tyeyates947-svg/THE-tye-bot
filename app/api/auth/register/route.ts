import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { checkAuthAttempt, createSession, hashPassword, publicProfile } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { email?: string; password?: string; username?: string; avatarUrl?: string };
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const username = String(body.username ?? "").trim().toLowerCase();
    const avatarUrl = String(body.avatarUrl ?? "pulse:lime");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
    }
    if (!/^[a-z0-9_]{3,24}$/.test(username)) {
      return NextResponse.json({ error: "Username must be 3–24 letters, numbers or underscores." }, { status: 400 });
    }
    if (password.length < 8 || password.length > 128) {
      return NextResponse.json({ error: "Password must be 8–128 characters." }, { status: 400 });
    }
    if (avatarUrl.length > 100_000 || (!avatarUrl.startsWith("pulse:") && !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(avatarUrl))) {
      return NextResponse.json({ error: "Choose a preset avatar or a compressed JPEG, PNG or WebP image under 75 KB." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const allowed = await checkAuthAttempt(email, request);
    if (!allowed) return NextResponse.json({ error: "Too many account attempts. Try again in 15 minutes." }, { status: 429 });
    const { data: row, error } = await supabase.from("profiles").insert({
      email,
      username,
      password_hash: await hashPassword(password),
      avatar_url: avatarUrl,
    }).select("id, username, avatar_url, balance_gbp, total_profit_gbp, wins, losses, paper_account_provider, paper_account_verified, paper_account_balance_gbp, paper_account_equity_gbp, paper_account_profit_gbp, paper_account_win_rate, paper_account_open_profit_gbp, paper_account_closed_profit_gbp, paper_account_open_positions").single();
    if (error) {
      if (error.code === "23505") return NextResponse.json({ error: "That email or username is already in use." }, { status: 409 });
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
