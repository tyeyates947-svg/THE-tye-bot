import { NextRequest, NextResponse } from "next/server";
import { getMarketData, inferAssetType, normalizeSymbol } from "@/lib/market";
import { getLatestNews } from "@/lib/news";
import { evaluateConfluence } from "@/lib/quant-signals";
import type { AnalysisMode } from "@/lib/types";
import { getSessionProfile } from "@/lib/session";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function gbpRate(currency: string): number {
  if (currency === "GBP") return 1;
  if (currency === "GBp") return 0.01;
  return 0.79;
}

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionProfile(request);
    if (!session) return NextResponse.json({ error: "Sign in to view paper trades." }, { status: 401 });
    const supabase = getSupabaseAdmin();
    const { data: rows, error } = await supabase.from("paper_trades")
      .select("id, symbol, asset_type, direction, timeframe, currency, fx_to_gbp, entry_price, units, amount_gbp, take_profit, stop_loss, status, pnl_gbp, created_at, closed_at")
      .eq("profile_id", session.profile.id).eq("status", "open").order("created_at", { ascending: false }).limit(10);
    if (error) throw new Error(`Could not load open trades: ${error.message}`);
    const trades = await Promise.all((rows ?? []).map(async (trade) => {
      try {
        const market = await getMarketData(trade.symbol, trade.timeframe === "5m" ? "5m" : "1d", trade.asset_type);
        const direction = trade.direction === "LONG" ? 1 : -1;
        const unrealizedRaw = direction * (market.price - Number(trade.entry_price)) * Number(trade.units) * Number(trade.fx_to_gbp);
        const unrealizedPnlGBP = Number(Math.max(-Number(trade.amount_gbp), unrealizedRaw).toFixed(2));
        return { ...trade, mark_price: market.price, unrealized_pnl_gbp: unrealizedPnlGBP, is_fallback: market.isFallback };
      } catch {
        return { ...trade, mark_price: Number(trade.entry_price), unrealized_pnl_gbp: 0, is_fallback: true };
      }
    }));
    return NextResponse.json({ trades, profile: session.profile });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load paper trades.";
    const status = message.includes("Supabase is not configured") ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSessionProfile(request);
    if (!session) return NextResponse.json({ error: "Sign in to open a paper trade." }, { status: 401 });
    const body = await request.json() as {
      symbol?: string; assetType?: string; direction?: string; timeframe?: string; amountGBP?: number;
      entryPrice?: number; takeProfit?: number; stopLoss?: number; mode?: AnalysisMode;
    };
    const symbol = normalizeSymbol(String(body.symbol ?? ""));
    const assetType = inferAssetType(symbol, body.assetType);
    const timeframe = body.timeframe === "5m" ? "5m" : "1d";
    const mode: AnalysisMode = body.mode === "sniper" ? "sniper" : "hunter";
    const rawAmount = Number(body.amountGBP);
    const amountGBP = Number.isFinite(rawAmount) ? Number(rawAmount.toFixed(2)) : Number.NaN;
    const entryPrice = Number(body.entryPrice);
    const takeProfit = Number(body.takeProfit);
    const stopLoss = Number(body.stopLoss);
    const direction = body.direction === "LONG" ? "LONG" : body.direction === "SHORT" ? "SHORT" : "";
    if (!symbol || !direction || ![amountGBP, entryPrice, takeProfit, stopLoss].every(Number.isFinite) || amountGBP < 1 || amountGBP > 1_000_000) {
      return NextResponse.json({ error: "The paper trade details are invalid." }, { status: 400 });
    }
    if (direction === "LONG" ? !(stopLoss < entryPrice && takeProfit > entryPrice) : !(takeProfit < entryPrice && stopLoss > entryPrice)) {
      return NextResponse.json({ error: "Entry, target and stop levels do not match the trade direction." }, { status: 400 });
    }
    const market = await getMarketData(symbol, timeframe, assetType);
    const news = await getLatestNews(symbol, assetType).catch(() => []);
    const signal = evaluateConfluence(market, news, mode);
    if (signal.decision === "WAIT" || signal.decision === "BUY" && direction !== "LONG" || signal.decision === "SELL" && direction !== "SHORT") {
      return NextResponse.json({ error: "Live confluence has changed or is no longer confirmed. Refresh the AI setup before paper trading." }, { status: 409 });
    }
    const entryDrift = Math.abs(market.price - entryPrice);
    if (entryDrift > Math.max(market.indicators.atr * 0.5, market.price * 0.003)) {
      return NextResponse.json({ error: "Price moved since this setup. Refresh the AI analysis before paper trading." }, { status: 409 });
    }
    const riskDistance = direction === "LONG" ? market.price - stopLoss : stopLoss - market.price;
    const rewardDistance = direction === "LONG" ? takeProfit - market.price : market.price - takeProfit;
    const riskReward = rewardDistance / riskDistance;
    if (!(riskDistance > 0) || riskReward < 2.4 || riskReward > 4.1) {
      return NextResponse.json({ error: "Trade levels do not meet the 1:2.5 to 1:4 risk/reward rules." }, { status: 400 });
    }
    const fxToGbp = gbpRate(market.currency);
    const liveEntryPrice = market.price;
    const units = amountGBP / (liveEntryPrice * fxToGbp);
    const { data, error } = await getSupabaseAdmin().rpc("qp_open_paper_trade", {
      p_profile_id: session.profile.id,
      p_symbol: symbol,
      p_asset_type: assetType,
      p_direction: direction,
      p_timeframe: timeframe,
      p_currency: market.currency,
      p_fx_to_gbp: fxToGbp,
      p_entry_price: liveEntryPrice,
      p_units: units,
      p_amount_gbp: amountGBP,
      p_take_profit: takeProfit,
      p_stop_loss: stopLoss,
    });
    if (error) {
      if (error.message.includes("Insufficient paper balance")) return NextResponse.json({ error: "Not enough available paper balance for that stake." }, { status: 409 });
      if (error.message.includes("Maximum of 10 open")) return NextResponse.json({ error: error.message }, { status: 409 });
      throw new Error(`Could not open paper trade: ${error.message}`);
    }
    const { data: profile, error: profileError } = await getSupabaseAdmin().from("profiles")
      .select("id, username, avatar_url, balance_gbp, total_profit_gbp, wins, losses").eq("id", session.profile.id).single();
    if (profileError) throw new Error(`Trade opened but profile refresh failed: ${profileError.message}`);
    return NextResponse.json({ tradeId: data.trade_id, balanceGBP: Number(data.balance_gbp), profile });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not open paper trade.";
    const status = message.includes("Supabase is not configured") ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
