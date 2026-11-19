import { NextRequest, NextResponse } from "next/server";
import { AssetType, getMarketData, inferAssetType, normalizeSymbol, Timeframe } from "@/lib/market";
import { getLatestNews, type NewsItem } from "@/lib/news";
import { evaluateConfluence, headlineSentiment, sentimentScore } from "@/lib/quant-signals";
import type { AnalysisMode } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface AnalysisResult {
  symbol: string;
  assetType: AssetType;
  timeframe: Timeframe;
  mode: AnalysisMode;
  decision: "BUY" | "SELL" | "WAIT";
  direction: "LONG" | "SHORT" | "WAIT";
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
  market: Omit<Awaited<ReturnType<typeof getMarketData>>, "candles">;
  newsInsights: Array<NewsItem & { sentiment: "bullish" | "bearish" | "neutral" }>;
}

const watchlist: Array<[string, AssetType]> = [
  ["NVDA", "stock"], ["TSLA", "stock"], ["AMD", "stock"], ["PLTR", "stock"], ["COIN", "stock"],
  ["BTC", "crypto"], ["SOL", "crypto"], ["XRP", "crypto"], ["ETH", "crypto"], ["SUI", "crypto"],
];

function roundPrice(price: number): number {
  const decimals = price >= 100 ? 2 : price >= 1 ? 3 : 6;
  return Number(price.toFixed(decimals));
}

async function getCommentary(
  apiKey: string,
  question: string,
  market: AnalysisResult["market"],
  decision: AnalysisResult["decision"],
  direction: AnalysisResult["direction"],
  news: NewsItem[],
  levels: Pick<AnalysisResult, "entryPrice" | "takeProfit" | "stopLoss" | "winProbability" | "targetProfitGBP" | "maxRiskGBP" | "allocationGBP">,
): Promise<string> {
  const messages = [
    { role: "system", content: "You are a sharp UK trading mate texting: concise, direct, natural, lowercase is fine, zero corporate filler. Output ONLY raw valid JSON with one string field 'message'; do not include markdown fences or any text outside the JSON object. No financial advice or promises. Respect the supplied decision exactly; if it is WAIT, clearly say to leave it alone and never suggest entering. Mention the news headlines and whether they read bullish, bearish or neutral. Do not invent prices, facts or headlines." },
    { role: "user", content: JSON.stringify({
        question, symbol: market.symbol, timeframe: market.timeframe, decision, direction,
        price: market.price, indicators: market.indicators,
        news: news.slice(0, 3).map((item) => ({ title: item.title, sentiment: headlineSentiment(item.title) })),
        levels: decision === "WAIT" ? null : levels,
        dataSource: market.source,
    }) },
  ];
  const models = ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.8-27b"];
  let response: Response | undefined;
  for (const [index, model] of models.entries()) {
    response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(12000),
      body: JSON.stringify({ model, messages, temperature: 0.3 }),
    });
    if (response.ok) break;

    const errorBody = await response.text();
    console.error(`Groq returned ${response.status}`, errorBody);
    if ([400, 404, 429].includes(response.status) && index < models.length - 1) continue;

    let errorMessage = errorBody || `Groq ${response.status}`;
    try {
      const errorData = JSON.parse(errorBody) as { error?: { message?: unknown } };
      if (typeof errorData.error?.message === "string" && errorData.error.message) {
        errorMessage = errorData.error.message;
      }
    } catch {
      // Keep the raw response body when Groq does not return JSON.
    }
    throw new Error(errorMessage);
  }
  if (!response) throw new Error("Groq returned no response.");
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("Groq returned no analysis.");
  const jsonStart = content.indexOf("{");
  const jsonEnd = content.lastIndexOf("}");
  if (jsonStart === -1 || jsonEnd < jsonStart) throw new Error("Groq response did not contain a JSON object.");
  const parsed = JSON.parse(content.slice(jsonStart, jsonEnd + 1)) as { message?: string };
  if (typeof parsed.message !== "string" || !parsed.message.trim()) throw new Error("Groq response did not include a message.");
  return parsed.message.trim();
}

export async function POST(request: NextRequest) {
  if (!process.env.GROQ_API_KEY) {
    return NextResponse.json({ error: "GROQ_API_KEY is missing. Add it to your Vercel project environment variables to enable AI analysis." }, { status: 503 });
  }
  try {
    const body = await request.json() as { symbol?: string; assetType?: string; timeframe?: string; mode?: AnalysisMode; budget?: number; question?: string };
    const question = String(body.question ?? "").slice(0, 800);
    const mode: AnalysisMode = body.mode === "sniper" ? "sniper" : "hunter";
    const timeframe: Timeframe = /\b(5m|5-minute|scalp|intraday)\b/i.test(question)
      ? "5m"
      : /\b(1d|long[- ]term|swing|hold)\b/i.test(question) ? "1d" : body.timeframe === "5m" ? "5m" : "1d";
    const budget = Math.min(1_000_000, Math.max(1, Number(body.budget) || 1000));
    const explicitSymbol = question.match(/\b(?:analy[sz]e|for|on|ticker|buy|trade)\s+([A-Z][A-Z0-9.^=-]{0,9})\b/i)?.[1];
    const askedSymbol = normalizeSymbol(explicitSymbol ?? body.symbol ?? "");
    const scanner = !askedSymbol || /\b(best|find|scan|hunt|right now|maximum profit|high[- ]profit|top trade|movers?|pick)\b/i.test(question);

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
      const momentum = Math.min(30, Math.abs(changePct) * 3);
      const volume = Math.min(25, Math.max(0, indicators.volumeSpikePct) * 0.25);
      const rsiQuality = Math.max(0, 20 - Math.abs(indicators.rsi - 55) * 0.35);
      const sentiment = sentimentScore(candidate.news) * 10;
      const signal = evaluateConfluence(candidate.market, candidate.news, mode);
      return { ...candidate, signal, score: momentum + volume + rsiQuality + sentiment };
    }).sort((a, b) => Number(b.signal.decision !== "WAIT") - Number(a.signal.decision !== "WAIT")
      || b.signal.confirmationCount - a.signal.confirmationCount || b.score - a.score);
    const selected = ranked[0];
    const { market } = selected;
    const { signal } = selected;
    const decision = signal.decision;
    const direction: "LONG" | "SHORT" | "WAIT" = decision === "BUY" ? "LONG" : decision === "SELL" ? "SHORT" : "WAIT";
    const bias = signal.bias;
    const entryPrice = market.price;
    const unitRisk = Math.max(market.indicators.atr || entryPrice * 0.01, entryPrice * 0.001);
    const stopDistance = unitRisk;
    const rewardDistance = stopDistance * 3;
    const fx = market.currency === "GBP" || market.currency === "GBp" ? (market.currency === "GBp" ? 0.01 : 1) : 0.79;
    const riskBudget = budget * 0.01;
    const riskDrivenUnits = riskBudget / (stopDistance * fx);
    const budgetUnits = budget / (entryPrice * fx);
    const units = decision === "WAIT" ? 0 : Math.min(riskDrivenUnits, budgetUnits);
    const maxRiskGBP = units * stopDistance * fx;
    const allocationGBP = units * entryPrice * fx;
    const winProbability = decision === "WAIT" ? 0 : Math.round(Math.max(52, Math.min(68, 54 + selected.score * 0.15)));
    const entryPriceRounded = roundPrice(entryPrice);
    const takeProfitRounded = roundPrice(entryPrice + (bias === "LONG" ? rewardDistance : -rewardDistance));
    const stopLossRounded = roundPrice(entryPrice + (bias === "LONG" ? -stopDistance : stopDistance));
    const levels = {
      entryPrice: entryPriceRounded,
      takeProfit: takeProfitRounded,
      stopLoss: stopLossRounded,
      winProbability,
      targetProfitGBP: Number((units * rewardDistance * fx).toFixed(2)),
      maxRiskGBP: Number(maxRiskGBP.toFixed(2)),
      allocationGBP: Number(allocationGBP.toFixed(2)),
    };
    const rationale = await getCommentary(
      process.env.GROQ_API_KEY,
      question,
      market,
      decision,
      direction,
      selected.news,
      levels,
    );

    const result: AnalysisResult = {
      symbol: selected.symbol,
      assetType: selected.assetType,
      timeframe,
      mode,
      decision,
      direction,
      entryPrice: entryPriceRounded,
      takeProfit: takeProfitRounded,
      stopLoss: stopLossRounded,
      winProbability,
      targetProfitGBP: Number((units * rewardDistance * fx).toFixed(2)),
      maxRiskGBP: Number(maxRiskGBP.toFixed(2)),
      allocationGBP: Number(allocationGBP.toFixed(2)),
      leverage: "1x (no leverage)",
      rationale: decision === "WAIT" ? `WAIT — ${signal.reason}. ${rationale}` : `${signal.reason}. ${rationale}`,
      riskNote: "Illustrative estimates only—not financial advice or a guaranteed outcome. Win probability is a heuristic, not a statistically validated forecast. FX for non-GBP assets is approximate.",
      newsInsights: selected.news.slice(0, 3).map((item) => ({ ...item, sentiment: headlineSentiment(item.title) })),
      market: {
        symbol: market.symbol,
        assetType: market.assetType,
        timeframe: market.timeframe,
        currency: market.currency,
        price: market.price,
        changePct: market.changePct,
        indicators: market.indicators,
        source: market.source,
        isFallback: market.isFallback,
      },
    };
    return NextResponse.json({ ...result, scanned: scanner, scannedSymbols: ranked.map((item) => item.symbol) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Analysis could not be completed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
