import { NextRequest, NextResponse } from "next/server";
import { getMarketData } from "@/lib/market";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ username: string }> }) {
  try {
    const { username: rawUsername } = await params;
    const username = rawUsername.toLowerCase();
    if (!/^[a-z0-9_]{3,24}$/.test(username)) return NextResponse.json({ error: "That username is invalid." }, { status: 400 });
    const supabase = getSupabaseAdmin();
    const { data: profile, error: profileError } = await supabase.from("profiles")
      .select("id, username, avatar_url, balance_gbp, total_profit_gbp, wins, losses, paper_account_provider, paper_account_verified, paper_account_balance_gbp, paper_account_equity_gbp, paper_account_profit_gbp, paper_account_win_rate, paper_account_open_profit_gbp, paper_account_closed_profit_gbp, paper_account_open_positions")
      .eq("username", username).maybeSingle();
    if (profileError) throw new Error(`Could not load trader profile: ${profileError.message}`);
    if (!profile) return NextResponse.json({ error: "Trader not found." }, { status: 404 });

    const { data: rows, error: tradesError } = await supabase.from("paper_trades")
      .select("id, symbol, asset_type, direction, timeframe, currency, fx_to_gbp, entry_price, exit_price, units, amount_gbp, take_profit, stop_loss, status, pnl_gbp, created_at, closed_at")
      .eq("profile_id", profile.id)
      .order("created_at", { ascending: false }).limit(50);
    if (tradesError) throw new Error(`Could not load trader history: ${tradesError.message}`);
    const active = await Promise.all((rows ?? []).filter((trade) => trade.status === "open").map(async (trade) => {
      try {
        const market = await getMarketData(trade.symbol, trade.timeframe === "5m" ? "5m" : "1d", trade.asset_type);
        const sign = trade.direction === "LONG" ? 1 : -1;
        const pnl = Number((sign * (market.price - Number(trade.entry_price)) * Number(trade.units) * Number(trade.fx_to_gbp)).toFixed(2));
        return { ...trade, mark_price: market.price, unrealized_pnl_gbp: Math.max(-Number(trade.amount_gbp), pnl), is_fallback: market.isFallback };
      } catch {
        return { ...trade, mark_price: Number(trade.entry_price), unrealized_pnl_gbp: 0, is_fallback: true };
      }
    }));
    return NextResponse.json({
      profile: {
        username: profile.username,
        avatar_url: profile.avatar_url,
        total_profit_gbp: Number(profile.total_profit_gbp),
        wins: Number(profile.wins),
        losses: Number(profile.losses),
        paper_account_provider: profile.paper_account_provider,
        paper_account_verified: profile.paper_account_verified === true,
        paper_account_balance_gbp: profile.paper_account_balance_gbp === null ? null : Number(profile.paper_account_balance_gbp),
        paper_account_equity_gbp: profile.paper_account_equity_gbp === null ? null : Number(profile.paper_account_equity_gbp),
        paper_account_profit_gbp: profile.paper_account_profit_gbp === null ? null : Number(profile.paper_account_profit_gbp),
        paper_account_win_rate: profile.paper_account_win_rate === null ? null : Number(profile.paper_account_win_rate),
        paper_account_open_profit_gbp: profile.paper_account_open_profit_gbp === null ? null : Number(profile.paper_account_open_profit_gbp),
        paper_account_closed_profit_gbp: profile.paper_account_closed_profit_gbp === null ? null : Number(profile.paper_account_closed_profit_gbp),
        paper_account_open_positions: profile.paper_account_open_positions === null ? null : Number(profile.paper_account_open_positions),
      },
      active: active.map((trade) => ({
        id: trade.id,
        symbol: trade.symbol,
        asset_type: trade.asset_type,
        direction: trade.direction,
        timeframe: trade.timeframe,
        currency: trade.currency,
        entry_price: Number(trade.entry_price),
        mark_price: Number(trade.mark_price),
        unrealized_pnl_gbp: Number(trade.unrealized_pnl_gbp),
        take_profit: Number(trade.take_profit),
        stop_loss: Number(trade.stop_loss),
        created_at: trade.created_at,
      })),
      history: (rows ?? []).filter((trade) => trade.status === "closed").map((trade) => ({
        id: trade.id,
        symbol: trade.symbol,
        direction: trade.direction,
        pnl_gbp: Number(trade.pnl_gbp),
        entry_price: Number(trade.entry_price),
        exit_price: trade.exit_price === null ? null : Number(trade.exit_price),
        created_at: trade.created_at,
        closed_at: trade.closed_at,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load trader profile.";
    const status = message.includes("Supabase is not configured") ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
