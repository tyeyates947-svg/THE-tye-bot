import { NextRequest, NextResponse } from "next/server";
import { getMarketData } from "@/lib/market";
import { getSessionProfile } from "@/lib/session";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const session = await getSessionProfile(request);
    if (!session) return NextResponse.json({ error: "Sign in to close a Trade With." }, { status: 401 });
    const body = await request.json() as { tradeId?: string };
    const tradeId = String(body.tradeId ?? "");
    if (!/^[\da-f-]{36}$/i.test(tradeId)) return NextResponse.json({ error: "Trade ID is invalid." }, { status: 400 });
    const supabase = getSupabaseAdmin();
    const { data: trade, error: tradeError } = await supabase.from("paper_trades")
      .select("id, symbol, asset_type, timeframe, direction, entry_price, units, amount_gbp, fx_to_gbp")
      .eq("id", tradeId).eq("profile_id", session.profile.id).eq("status", "open").maybeSingle();
    if (tradeError) throw new Error(`Could not load trade: ${tradeError.message}`);
    if (!trade) return NextResponse.json({ error: "That open trade could not be found." }, { status: 404 });

    const market = await getMarketData(trade.symbol, trade.timeframe === "5m" ? "5m" : "1d", trade.asset_type);
    if (market.isFallback) {
      return NextResponse.json({ error: "No live exit price is available right now. Try closing this trade again when market data returns." }, { status: 503 });
    }
    const sign = trade.direction === "LONG" ? 1 : -1;
    const rawPnl = sign * (market.price - Number(trade.entry_price)) * Number(trade.units) * Number(trade.fx_to_gbp);
    const pnlGBP = Number(Math.max(-Number(trade.amount_gbp), rawPnl).toFixed(2));
    const { data, error } = await supabase.rpc("qp_close_paper_trade", {
      p_profile_id: session.profile.id,
      p_trade_id: tradeId,
      p_exit_price: market.price,
      p_pnl_gbp: pnlGBP,
    });
    if (error) throw new Error(`Could not close Trade With: ${error.message}`);
    return NextResponse.json({ exitPrice: market.price, pnlGBP, balanceGBP: Number(data.balance_gbp) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not close Trade With.";
    const status = message.includes("Supabase is not configured") ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
