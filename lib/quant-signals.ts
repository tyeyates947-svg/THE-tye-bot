import type { MarketData } from "@/lib/market";
import type { NewsItem } from "@/lib/news";
import type { AnalysisMode } from "@/lib/types";

export type HeadlineSentiment = "bullish" | "bearish" | "neutral";

export interface ConfluenceSignal {
  bias: "LONG" | "SHORT";
  decision: "BUY" | "SELL" | "WAIT";
  reason: string;
  sentimentScore: number;
  confirmationCount: number;
}

export function headlineSentiment(title: string): HeadlineSentiment {
  const positive = /\b(gain|surge|beats|growth|bullish|record|rise|rally|approval|upgrade|profit|inflow|strong)\b/i.test(title);
  const negative = /\b(loss|drop|fall|miss|bearish|lawsuit|decline|selloff|downgrade|risk|outflow|crash|weak)\b/i.test(title);
  return positive === negative ? "neutral" : positive ? "bullish" : "bearish";
}

export function sentimentScore(items: NewsItem[]): number {
  if (!items.length) return 0;
  const sentiments = items.map((item) => headlineSentiment(item.title));
  return (sentiments.filter((value) => value === "bullish").length - sentiments.filter((value) => value === "bearish").length) / sentiments.length;
}

export function evaluateConfluence(market: MarketData, news: NewsItem[], mode: AnalysisMode = "hunter"): ConfluenceSignal {
  const { indicators } = market;
  const sentiment = sentimentScore(news);
  const lastCandle = market.candles.at(-1);
  const bullishSignals = [
    indicators.ema9 > indicators.ema21 && indicators.ema21 > indicators.ema200,
    indicators.rsi >= 52 && indicators.rsi <= 70,
    indicators.volumeSpikePct >= 20 && Boolean(lastCandle && lastCandle.close > lastCandle.open),
    sentiment >= 0.25,
  ];
  const bearishSignals = [
    indicators.ema9 < indicators.ema21 && indicators.ema21 < indicators.ema200,
    indicators.rsi >= 30 && indicators.rsi <= 48,
    indicators.volumeSpikePct >= 20 && Boolean(lastCandle && lastCandle.close < lastCandle.open),
    sentiment <= -0.25,
  ];
  const bullishCount = bullishSignals.filter(Boolean).length;
  const bearishCount = bearishSignals.filter(Boolean).length;
  const confirmationCount = Math.max(bullishCount, bearishCount);
  const flat = market.price > 0
    && indicators.atr / market.price < 0.001
    && Math.abs(market.changePct) < 0.03
    && indicators.volumeSpikePct < 10;
  const hunterLong = bullishCount >= 2 && bullishCount > bearishCount;
  const hunterShort = bearishCount >= 2 && bearishCount > bullishCount;
  const sniperLong = bullishCount >= 3 && bearishCount === 0 && bullishSignals[0];
  const sniperShort = bearishCount >= 3 && bullishCount === 0 && bearishSignals[0];
  const long = !market.isFallback && !flat && (mode === "sniper" ? sniperLong : hunterLong);
  const short = !market.isFallback && !flat && (mode === "sniper" ? sniperShort : hunterShort);
  const decision = long ? "BUY" : short ? "SELL" : "WAIT";
  return {
    bias: long ? "LONG" : short ? "SHORT" : bullishCount > bearishCount ? "LONG" : bearishCount > bullishCount ? "SHORT" : indicators.ema9 >= indicators.ema21 ? "LONG" : "SHORT",
    decision,
    sentimentScore: sentiment,
    confirmationCount,
    reason: market.isFallback ? "Price candles are simulated, so live confluence cannot be confirmed"
      : flat ? "The market is flat with low volatility and volume"
        : bullishCount === bearishCount && bullishCount > 0 ? "Bullish and bearish signals directly conflict"
          : decision !== "WAIT" ? `${confirmationCount} of 4 ${decision === "BUY" ? "bullish" : "bearish"} signals confirm the setup`
            : mode === "sniper" ? `Strict Sniper needs 3 aligned signals including the full EMA trend; ${confirmationCount} confirmed`
              : `Hunter needs 2 of 4 aligned signals; ${confirmationCount} confirmed`,
  };
}
