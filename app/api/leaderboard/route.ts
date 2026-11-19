import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();
    const { data: profiles, error } = await supabase.from("profiles")
      .select("id, username, avatar_url, balance_gbp, total_profit_gbp, wins, losses")
      .order("total_profit_gbp", { ascending: false }).limit(100);
    if (error) throw new Error(`Could not load leaderboard: ${error.message}`);
    const ids = (profiles ?? []).map((profile) => profile.id);
    const { data: openTrades, error: tradesError } = ids.length
      ? await supabase.from("paper_trades").select("profile_id, symbol, direction, amount_gbp").in("profile_id", ids).eq("status", "open")
      : { data: [], error: null };
    if (tradesError) throw new Error(`Could not load leaderboard positions: ${tradesError.message}`);
    const leaderboard = (profiles ?? []).map((profile, index) => {
      const positions = (openTrades ?? []).filter((trade) => trade.profile_id === profile.id);
      const initialBalance = Number(profile.balance_gbp) + positions.reduce((sum, trade) => sum + Number(trade.amount_gbp), 0) - Number(profile.total_profit_gbp);
      return {
        rank: index + 1,
        username: profile.username,
        avatar_url: profile.avatar_url,
        balance_gbp: Number(profile.balance_gbp),
        total_profit_gbp: Number(profile.total_profit_gbp),
        return_pct: initialBalance > 0 ? Number((Number(profile.total_profit_gbp) / initialBalance * 100).toFixed(2)) : 0,
        wins: profile.wins,
        losses: profile.losses,
        open_positions: positions,
      };
    });
    return NextResponse.json({ leaderboard });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load leaderboard.";
    const status = message.includes("Supabase is not configured") ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
