import { NextRequest, NextResponse } from "next/server";
import { AssetType, getMarketData, inferAssetType, normalizeSymbol, Timeframe } from "@/lib/market";
import { getLatestNews, type NewsItem } from "@/lib/news";

export const dynamic = "force-dynamic";

interface AnalysisResult {
  symbol: string;
  assetType: AssetType;
  timeframe: Timeframe;
  direction: "LONG" | "SHORT";
  entryPrice: number;
  takeProfit: number;
  stopLoss: number;
  winProbability: number;
  targetProfitGBP: number;
  maxRiskGBP: number;
  allocationGBP: number;
  leverage: string;
  rationale: string;
  riskNote: string;
  market: Awaited<ReturnType<typeof getMarketData>>;
}

const watchlist: Array<[string, AssetType]> = [
  ["NVDA", "stock"], ["TSLA", "stock"], ["AMD", "stock"], ["PLTR", "stock"], ["COIN", "stock"],
  ["BTC", "crypto"], ["SOL", "crypto"], ["XRP", "crypto"], ["ETH", "crypto"], ["SUI", "crypto"],
];

function roundPrice(price: number): number {
  const decimals = price >= 100 ? 2 : price >= 1 ? 3 : 6;
  return Number(price.toFixed(decimals));
}

function sentimentFromNews(items: NewsItem[]): number {
  const positive = /\b(gain|surge|beats|growth|bullish|record|rise|rally|approval|upgrade|profit|inflow)\b/gi;
  const negative = /\b(loss|drop|fall|miss|bearish|lawsuit|decline|selloff|downgrade|risk|outflow|crash)\b/gi;
  const text = items.map((item) => item.title).join(" ");
  return Math.max(-1, Math.min(1, ((text.match(positive)?.length ?? 0) - (text.match(negative)?.length ?? 0)) / 3));
}

async function getCommentary(apiKey: string, question: string, market: AnalysisResult["market"], direction: string, news: NewsItem[]): Promise<string> {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(12000),
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "Return JSON with a concise 'rationale' field only. Explain technical evidence and relevant uncertainty in plain language. Never promise profits or assert unsupported facts." },
        { role: "user", content: JSON.stringify({ question, symbol: market.symbol, direction, price: market.price, indicators: market.indicators, news: news.map((item) => item.title), dataSource: market.source }) },
      ],
      temperature: 0.3,
      max_tokens: 220,
    }),
  });
  if (!response.ok) throw new Error(`Groq returned ${response.status}`);
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("Groq returned no analysis.");
  const parsed = JSON.parse(content) as { rationale?: string };
  return parsed.rationale ?? "Technical conditions are mixed; use the levels as a scenario, not a forecast.";
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { symbol?: string; assetType?: string; timeframe?: string; budget?: number; question?: string };
    const question = String(body.question ?? "").slice(0, 800);
    const timeframe: Timeframe = /\b(5m|5-minute|scalp|intraday)\b/i.test(question)
      ? "5m"
      : /\b(1d|long[- ]term|swing|hold)\b/i.test(question) ? "1d" : body.timeframe === "5m" ? "5m" : "1d";
    const budget = Math.min(1_000_000, Math.max(1, Number(body.budget) || 1000));
    const explicitSymbol = question.match(/\b(?:analy[sz]e|for|on|ticker|buy|trade)\s+([A-Z][A-Z0-9.^=-]{0,9})\b/i)?.[1];
    const askedSymbol = normalizeSymbol(explicitSymbol ?? body.symbol ?? "");
    const scanner = !askedSymbol || /\b(best|find|scan|hunt|right now|maximum profit|top trade|mover)\b/i.test(question);

    let candidates: Array<{ symbol: string; assetType: AssetType; market: Awaited<ReturnType<typeof getMarketData>>; news: NewsItem[] }>;
    if (scanner) {
      candidates = (await Promise.all(watchlist.map(async ([symbol, assetType]) => {
        try {
          const [market, news] = await Promise.all([
            getMarketData(symbol, timeframe, assetType),
            getLatestNews(symbol, assetType).catch(() => []),
          ]);
          return { symbol, assetType, market, news };
        } catch {
          return null;
        }
      }))).filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null);
      if (!candidates.length) throw new Error("The market scanner could not load any assets.");
    } else {
      const assetType = explicitSymbol ? inferAssetType(askedSymbol) : inferAssetType(askedSymbol, body.assetType);
      const [market, news] = await Promise.all([
        getMarketData(askedSymbol, timeframe, assetType),
        getLatestNews(askedSymbol, assetType).catch(() => []),
      ]);
      candidates = [{ symbol: askedSymbol, assetType, market, news }];
    }

    const ranked = candidates.map((candidate) => {
      const { indicators, changePct } = candidate.market;
      const trend = indicators.ema9 > indicators.ema21 ? 1 : -1;
      const momentum = Math.min(30, Math.abs(changePct) * 3);
      const volume = Math.min(25, Math.max(0, indicators.volumeSpikePct) * 0.25);
      const rsiQuality = Math.max(0, 20 - Math.abs(indicators.rsi - 55) * 0.35);
      const sentiment = sentimentFromNews(candidate.news) * 10;
      return { ...candidate, score: momentum + volume + rsiQuality + (trend > 0 ? 10 : 0) + sentiment };
    }).sort((a, b) => b.score - a.score);
    const selected = ranked[0];
    const { market } = selected;
    const direction: "LONG" | "SHORT" = market.indicators.ema9 >= market.indicators.ema21 ? "LONG" : "SHORT";
    const entryPrice = market.price;
    const unitRisk = Math.max(market.indicators.atr || entryPrice * 0.01, entryPrice * 0.001);
    const stopDistance = unitRisk;
    const rewardDistance = stopDistance * 3;
    const fx = market.currency === "GBP" || market.currency === "GBp" ? (market.currency === "GBp" ? 0.01 : 1) : 0.79;
    const riskBudget = budget * 0.01;
    const riskDrivenUnits = riskBudget / (stopDistance * fx);
    const budgetUnits = budget / (entryPrice * fx);
    const units = Math.min(riskDrivenUnits, budgetUnits);
    const maxRiskGBP = units * stopDistance * fx;
    const allocationGBP = units * entryPrice * fx;
    const winProbability = Math.round(Math.max(38, Math.min(68, 47 + selected.score * 0.2)));
    let rationale = `${direction === "LONG" ? "Bullish" : "Bearish"} EMA alignment with RSI ${market.indicators.rsi.toFixed(0)} and ${market.indicators.volumeSpikePct.toFixed(0)}% volume change. Levels use a 1 ATR stop and 3 ATR target.`;
    if (process.env.GROQ_API_KEY) {
      try {
        rationale = await getCommentary(process.env.GROQ_API_KEY, question, market, direction, selected.news);
      } catch (error) {
        console.warn("Groq analysis unavailable; using indicator-based rationale.", error);
      }
    }

    const result: AnalysisResult = {
      symbol: selected.symbol,
      assetType: selected.assetType,
      timeframe,
      direction,
      entryPrice: roundPrice(entryPrice),
      takeProfit: roundPrice(entryPrice + (direction === "LONG" ? rewardDistance : -rewardDistance)),
      stopLoss: roundPrice(entryPrice + (direction === "LONG" ? -stopDistance : stopDistance)),
      winProbability,
      targetProfitGBP: Number((units * rewardDistance * fx).toFixed(2)),
      maxRiskGBP: Number(maxRiskGBP.toFixed(2)),
      allocationGBP: Number(allocationGBP.toFixed(2)),
      leverage: "1x (no leverage)",
      rationale,
      riskNote: "Illustrative, rule-based estimates—not financial advice or a guaranteed outcome. Past price data and simulated fallback candles can be inaccurate. FX uses an approximate conversion for non-GBP assets.",
      market,
    };
    return NextResponse.json({ ...result, scanned: scanner, scannedSymbols: ranked.map((item) => item.symbol) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Analysis could not be completed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
