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

interface TradeCheckInput {
  id: number;
  symbol: string;
  direction: "LONG" | "SHORT";
  price_move_pct: number;
  target_progress_pct: number;
  stop_proximity_pct: number;
}

async function getAiCheckins(trades: TradeCheckInput[]): Promise<{ updates: Map<number, string>; error?: string }> {
  if (!trades.length) return { updates: new Map() };
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return { updates: new Map(), error: "AI check-ins are unavailable because GROQ_API_KEY is not configured." };
  const messages = [
    { role: "system", content: "You monitor simulated market positions. Return only raw valid JSON: {\"updates\":[{\"id\":0,\"message\":\"...\"}]}. Return exactly one update for each supplied numeric position ID. Each message must be one short, factual sentence, using only supplied data. Mention price move, target progress, or stop proximity when relevant. Do not give financial advice, predict outcomes, or invent catalysts." },
    { role: "user", content: JSON.stringify(trades) },
  ];
  const models = ["openai/gpt-oss-120b", "openai/gpt-oss-20b"];
  try {
    let response: Response | undefined;
    for (const [index, model] of models.entries()) {
      response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(10_000),
        body: JSON.stringify({ model, messages, temperature: 0.2 }),
      });
      if (response.ok) break;
      const errorBody = await response.text();
      console.error(`Groq trade check-in returned ${response.status}`, errorBody.slice(0, 500));
      if ([400, 404, 429].includes(response.status) && index < models.length - 1) continue;
      return { updates: new Map(), error: `AI check-ins are temporarily unavailable (Groq ${response.status}); live price monitoring continues.` };
    }
    if (!response?.ok) return { updates: new Map(), error: "AI check-ins are temporarily unavailable; live price monitoring continues." };
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) return { updates: new Map(), error: "AI check-ins returned no update; live price monitoring continues." };
    const jsonStart = content.indexOf("{");
    const jsonEnd = content.lastIndexOf("}");
    if (jsonStart < 0 || jsonEnd < jsonStart) return { updates: new Map(), error: "AI check-ins returned an invalid response; live price monitoring continues." };
    const parsed = JSON.parse(content.slice(jsonStart, jsonEnd + 1)) as { updates?: Array<{ id?: unknown; message?: unknown }> };
    const validIds = new Set(trades.map((trade) => trade.id));
    const updates = new Map((parsed.updates ?? [])
      .filter((item): item is { id: number; message: string } => typeof item.id === "number" && Number.isInteger(item.id) && validIds.has(item.id)
        && typeof item.message === "string" && item.message.trim().length > 0)
      .map((item) => {
        const normalized = item.message.replace(/\s+/g, " ").trim();
        const sentence = normalized.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? normalized;
        const message = sentence.length > 180 ? `${sentence.slice(0, 179).trimEnd()}…` : sentence;
        return [item.id, message] as const;
      }));
    if (updates.size !== trades.length) return { updates: new Map(), error: "AI check-ins returned incomplete updates; live price monitoring continues." };
    return { updates };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown error";
    console.error("Could not generate AI trade check-ins:", detail);
    return { updates: new Map(), error: "AI check-ins are temporarily unavailable; live price monitoring continues." };
  }
}

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionProfile(request);
    if (!session) return NextResponse.json({ error: "Sign in to view your Trade Withs." }, { status: 401 });
    const supabase = getSupabaseAdmin();
    const { data: rows, error } = await supabase.from("paper_trades")
      .select("id, symbol, asset_type, direction, timeframe, currency, fx_to_gbp, entry_price, exit_price, units, amount_gbp, take_profit, stop_loss, status, pnl_gbp, created_at, closed_at, entry_at, duration_minutes, expires_at, mode")
      .eq("profile_id", session.profile.id).order("created_at", { ascending: false }).limit(50);
    if (error) throw new Error(`Could not load your Trade Withs: ${error.message}`);
    const activeRows = (rows ?? []).filter((trade) => trade.status === "open");
    const pendingRows: Array<Record<string, unknown>> = [];
    const history = (rows ?? []).filter((trade) => trade.status === "closed");
    const events: Array<{ id: string; kind: "target" | "stop" | "expiry"; message: string }> = [];
    for (const trade of (rows ?? []).filter((item) => item.status === "scheduled")) {
      const entryAt = new Date(trade.entry_at).getTime();
      const expiresAt = new Date(trade.expires_at).getTime();
      if (expiresAt <= Date.now()) {
        const { error: cancelError } = await supabase.rpc("qp_cancel_scheduled_paper_trade", {
          p_profile_id: session.profile.id,
          p_trade_id: trade.id,
        });
        if (cancelError) throw new Error(`Could not cancel expired scheduled Trade With: ${cancelError.message}`);
        events.push({ id: trade.id, kind: "expiry", message: `${trade.symbol} missed its scheduled entry; the reserved stake was returned.` });
        continue;
      }
      if (entryAt > Date.now()) {
        pendingRows.push({
          ...trade,
          mark_price: Number(trade.entry_price),
          unrealized_pnl_gbp: 0,
          is_fallback: true,
          progress_pct: 0,
          ai_update: "Entry is scheduled; the stake is reserved until the countdown ends.",
        });
        continue;
      }
      let market: Awaited<ReturnType<typeof getMarketData>>;
      try {
        market = await getMarketData(trade.symbol, trade.timeframe === "5m" ? "5m" : "1d", trade.asset_type);
      } catch {
        pendingRows.push({ ...trade, mark_price: Number(trade.entry_price), unrealized_pnl_gbp: 0, is_fallback: true, progress_pct: 0, ai_update: "Entry time reached; waiting for a live market price." });
        continue;
      }
      if (market.isFallback) {
        pendingRows.push({ ...trade, mark_price: Number(trade.entry_price), unrealized_pnl_gbp: 0, is_fallback: true, progress_pct: 0, ai_update: "Entry time reached; waiting for a live market price." });
        continue;
      }
      const liveNews = await getLatestNews(trade.symbol, trade.asset_type).catch(() => []);
      const signal = evaluateConfluence(market, liveNews, trade.mode === "sniper" ? "sniper" : "hunter");
      const directionConfirmed = signal.decision === "BUY" && trade.direction === "LONG" || signal.decision === "SELL" && trade.direction === "SHORT";
      const entryDrift = Math.abs(market.price - Number(trade.entry_price));
      if (!directionConfirmed || entryDrift > Math.max(market.indicators.atr * 0.5, market.price * 0.003)) {
        const { error: cancelError } = await supabase.rpc("qp_cancel_scheduled_paper_trade", {
          p_profile_id: session.profile.id,
          p_trade_id: trade.id,
        });
        if (cancelError) throw new Error(`Could not cancel the changed ${trade.symbol} setup: ${cancelError.message}`);
        events.push({ id: trade.id, kind: "expiry", message: `${trade.symbol} no longer matches its scheduled entry; the reserved stake was returned.` });
        continue;
      }
      const units = Number(trade.amount_gbp) / (market.price * Number(trade.fx_to_gbp));
      const { data: activated, error: activateError } = await supabase.rpc("qp_activate_scheduled_paper_trade", {
        p_profile_id: session.profile.id,
        p_trade_id: trade.id,
        p_entry_price: market.price,
        p_units: units,
      });
      if (activateError) throw new Error(`Could not activate scheduled ${trade.symbol} Trade With: ${activateError.message}`);
      if (activated) activeRows.push({ ...trade, status: "open", entry_price: market.price, units });
    }
    const trades = await Promise.all(activeRows.map(async (trade) => {
      let market: Awaited<ReturnType<typeof getMarketData>>;
      try {
        market = await getMarketData(trade.symbol, trade.timeframe === "5m" ? "5m" : "1d", trade.asset_type);
      } catch {
        return { ...trade, mark_price: Number(trade.entry_price), unrealized_pnl_gbp: 0, is_fallback: true, progress_pct: 0, ai_update: `${trade.symbol} live price is temporarily unavailable.` };
      }
      const direction = trade.direction === "LONG" ? 1 : -1;
      const unrealizedRaw = direction * (market.price - Number(trade.entry_price)) * Number(trade.units) * Number(trade.fx_to_gbp);
      const unrealizedPnlGBP = Number(Math.max(-Number(trade.amount_gbp), unrealizedRaw).toFixed(2));
      const reachedTarget = direction > 0 ? market.price >= Number(trade.take_profit) : market.price <= Number(trade.take_profit);
      const reachedStop = direction > 0 ? market.price <= Number(trade.stop_loss) : market.price >= Number(trade.stop_loss);
      const expired = new Date(trade.expires_at).getTime() <= Date.now();
      if (!market.isFallback && (reachedTarget || reachedStop || expired)) {
        const kind = reachedTarget ? "target" : reachedStop ? "stop" : "expiry";
        const exitPrice = reachedTarget ? Number(trade.take_profit) : reachedStop ? Number(trade.stop_loss) : market.price;
        const pnlGBP = Number((direction * (exitPrice - Number(trade.entry_price)) * Number(trade.units) * Number(trade.fx_to_gbp)).toFixed(2));
        const { error: closeError } = await supabase.rpc("qp_close_paper_trade", {
          p_profile_id: session.profile.id,
          p_trade_id: trade.id,
          p_exit_price: exitPrice,
          p_pnl_gbp: pnlGBP,
        });
        if (!closeError) {
          events.push({
            id: trade.id,
            kind,
            message: kind === "expiry"
              ? `${trade.symbol} reached its time limit and was automatically closed.`
              : `${trade.symbol} reached its ${kind === "target" ? "take-profit target" : "stop loss"} and was closed.`,
          });
          return null;
        }
        if (!closeError.message.includes("Open trade not found")) throw new Error(`Could not close ${trade.symbol} at its ${kind}: ${closeError.message}`);
        return null;
      }
      const entryMove = ((market.price - Number(trade.entry_price)) / Number(trade.entry_price)) * direction * 100;
      const targetDistance = Math.abs(Number(trade.take_profit) - Number(trade.entry_price));
      const favorableMove = Math.max(0, (market.price - Number(trade.entry_price)) * direction);
      const progressPct = Math.min(100, Math.round(favorableMove / targetDistance * 100));
      const aiUpdate = reachedStop
        ? `${trade.symbol} is at its stop-loss level.`
        : entryMove >= 0
          ? `${trade.symbol} is +${entryMove.toFixed(2)}% from entry; ${progressPct >= 75 ? "approaching the target, keep an eye on it" : "position remains open"}.`
          : `${trade.symbol} is ${entryMove.toFixed(2)}% from entry; watch the risk level.`;
      return { ...trade, mark_price: market.price, unrealized_pnl_gbp: unrealizedPnlGBP, is_fallback: market.isFallback, progress_pct: progressPct, ai_update: aiUpdate };
    }));
    const filteredTrades = trades.filter((trade): trade is NonNullable<typeof trade> => trade !== null);
    const liveTrades = filteredTrades.filter((trade) => !trade.is_fallback);
    const checkins = await getAiCheckins(liveTrades.map((trade, index) => ({
      id: index,
      symbol: trade.symbol,
      direction: trade.direction,
      price_move_pct: Number((((Number(trade.mark_price) - Number(trade.entry_price)) / Number(trade.entry_price)) * (trade.direction === "LONG" ? 1 : -1) * 100).toFixed(2)),
      target_progress_pct: Number(trade.progress_pct),
      stop_proximity_pct: Number((Math.max(0, 100 - (Math.abs(Number(trade.mark_price) - Number(trade.stop_loss)) / Math.abs(Number(trade.entry_price) - Number(trade.stop_loss))) * 100)).toFixed(0)),
    })));
    const updatesByTradeId = new Map<string, string>();
    liveTrades.forEach((trade, index) => {
      const update = checkins.updates.get(index);
      if (update) updatesByTradeId.set(trade.id, update);
    });
    const updatedTrades = filteredTrades.map((trade) => ({
      ...trade,
      ai_update: trade.is_fallback
        ? "Waiting for a live price before the next AI check-in."
        : updatesByTradeId.get(trade.id) ?? "AI check-in unavailable; live price monitoring continues.",
    }));
    const mappedHistory = history.map((trade) => ({
      ...trade, pnl_gbp: Number(trade.pnl_gbp), amount_gbp: Number(trade.amount_gbp),
      mark_price: Number(trade.exit_price ?? trade.entry_price), unrealized_pnl_gbp: Number(trade.pnl_gbp), is_fallback: false,
    }));
    let profile = session.profile;
    if (events.length) {
      const { data: profileRow, error: profileError } = await supabase.from("profiles")
        .select("balance_gbp, total_profit_gbp, wins, losses").eq("id", session.profile.id).single();
      if (profileError) throw new Error(`Positions closed but profile refresh failed: ${profileError.message}`);
      profile = {
        ...session.profile,
        balance_gbp: Number(profileRow.balance_gbp),
        total_profit_gbp: Number(profileRow.total_profit_gbp),
        wins: Number(profileRow.wins),
        losses: Number(profileRow.losses),
      };
    }
    return NextResponse.json({ trades: [...pendingRows, ...updatedTrades], history: mappedHistory, events, profile, aiCheckError: checkins.error });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load your Trade Withs.";
    const status = message.includes("Supabase is not configured") ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSessionProfile(request);
    if (!session) return NextResponse.json({ error: "Sign in to Trade With this setup." }, { status: 401 });
    const body = await request.json() as {
      symbol?: string; assetType?: string; direction?: string; timeframe?: string; amountGBP?: number;
      entryPrice?: number; takeProfit?: number; stopLoss?: number; mode?: AnalysisMode;
      entryAt?: string; durationMinutes?: number;
    };
    const symbol = normalizeSymbol(String(body.symbol ?? ""));
    const assetType = inferAssetType(symbol, body.assetType);
    const durationMinutes = Number(body.durationMinutes);
    const timeframe = durationMinutes <= 240 ? "5m" : "1d";
    const mode: AnalysisMode = body.mode === "sniper" ? "sniper" : "hunter";
    const rawAmount = Number(body.amountGBP);
    const amountGBP = Number.isFinite(rawAmount) ? Number(rawAmount.toFixed(2)) : Number.NaN;
    const rawEntryAt = body.entryAt ? new Date(body.entryAt).getTime() : Date.now();
    const entryPrice = Number(body.entryPrice);
    const takeProfit = Number(body.takeProfit);
    const stopLoss = Number(body.stopLoss);
    const direction = body.direction === "LONG" ? "LONG" : body.direction === "SHORT" ? "SHORT" : "";
    if (!symbol || !direction || ![amountGBP, entryPrice, takeProfit, stopLoss, rawEntryAt, durationMinutes].every(Number.isFinite)
      || amountGBP < 1 || amountGBP > 1_000_000 || durationMinutes < 5 || durationMinutes > 10080
      || rawEntryAt < Date.now() - 60_000 || rawEntryAt > Date.now() + 30 * 24 * 60 * 60_000) {
      return NextResponse.json({ error: "The Trade With details are invalid." }, { status: 400 });
    }
    if (direction === "LONG" ? !(stopLoss < entryPrice && takeProfit > entryPrice) : !(takeProfit < entryPrice && stopLoss > entryPrice)) {
      return NextResponse.json({ error: "Entry, target and stop levels do not match the trade direction." }, { status: 400 });
    }
    const market = await getMarketData(symbol, timeframe, assetType);
    const news = await getLatestNews(symbol, assetType).catch(() => []);
    const signal = evaluateConfluence(market, news, mode);
    if (signal.decision === "WAIT" || signal.decision === "BUY" && direction !== "LONG" || signal.decision === "SELL" && direction !== "SHORT") {
      return NextResponse.json({ error: "Live confluence has changed or is no longer confirmed. Refresh the AI setup before trading with it." }, { status: 409 });
    }
    const entryDrift = Math.abs(market.price - entryPrice);
    if (rawEntryAt <= Date.now() && entryDrift > Math.max(market.indicators.atr * 0.5, market.price * 0.003)) {
      return NextResponse.json({ error: "Price moved since this setup. Refresh the AI analysis before trading with it." }, { status: 409 });
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
      p_entry_at: new Date(rawEntryAt).toISOString(),
      p_duration_minutes: durationMinutes,
      p_mode: mode,
    });
    if (error) {
      if (error.message.includes("Insufficient paper balance")) return NextResponse.json({ error: "Not enough available virtual balance for that stake." }, { status: 409 });
      if (error.message.includes("Maximum of 10 open")) return NextResponse.json({ error: "You can have up to 10 active Trade Withs at a time." }, { status: 409 });
      throw new Error(`Could not open Trade With: ${error.message}`);
    }
    const { data: profile, error: profileError } = await getSupabaseAdmin().from("profiles")
      .select("id, username, avatar_url, balance_gbp, total_profit_gbp, wins, losses, paper_account_provider, paper_account_verified, paper_account_balance_gbp, paper_account_equity_gbp, paper_account_profit_gbp, paper_account_win_rate, paper_account_open_profit_gbp, paper_account_closed_profit_gbp, paper_account_open_positions").eq("id", session.profile.id).single();
    if (profileError) throw new Error(`Trade opened but profile refresh failed: ${profileError.message}`);
    return NextResponse.json({
      tradeId: data.trade_id,
      balanceGBP: Number(data.balance_gbp),
      profile: {
        ...profile,
        balance_gbp: Number(profile.balance_gbp),
        total_profit_gbp: Number(profile.total_profit_gbp),
        wins: Number(profile.wins),
        losses: Number(profile.losses),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not open Trade With.";
    const status = message.includes("Supabase is not configured") ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
