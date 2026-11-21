import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { checkAuthAttempt, createSession, dummyPasswordHash, publicProfile, verifyPassword } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { email?: string; password?: string };
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || password.length < 8 || password.length > 128) {
      return NextResponse.json({ error: "Enter a valid email address and password." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const allowed = await checkAuthAttempt(email, request);
    if (!allowed) return NextResponse.json({ error: "Too many attempts. Try again in 15 minutes." }, { status: 429 });

    const { data: row, error } = await supabase.from("profiles")
      .select("id, username, password_hash, avatar_url, balance_gbp, total_profit_gbp, wins, losses, paper_account_provider, paper_account_verified, paper_account_balance_gbp, paper_account_equity_gbp, paper_account_profit_gbp, paper_account_win_rate, paper_account_open_profit_gbp, paper_account_closed_profit_gbp, paper_account_open_positions")
      .eq("email", email).maybeSingle();
    if (error) throw new Error(`Could not look up account: ${error.message}`);
    const validPassword = await verifyPassword(password, row?.password_hash ?? dummyPasswordHash());
    if (!row || !row.password_hash || !validPassword) return NextResponse.json({ error: "Email or password is incorrect." }, { status: 401 });

    const token = await createSession(row.id);
    return NextResponse.json({ token, profile: publicProfile(row) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sign-in failed.";
    const status = message.includes("Supabase is not configured") ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
