import type { MarketData } from "@/lib/market";
import type { NewsItem } from "@/lib/news";

export type HeadlineSentiment = "bullish" | "bearish" | "neutral";

export interface ConfluenceSignal {
  bias: "LONG" | "SHORT";
  decision: "BUY" | "SELL" | "WAIT";
  reason: string;
  sentimentScore: number;
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

export function evaluateConfluence(market: MarketData, news: NewsItem[]): ConfluenceSignal {
  const { indicators } = market;
  const sentiment = sentimentScore(news);
  const volumeReady = indicators.volumeSpikePct >= 20;
  const long = !market.isFallback
    && indicators.ema9 > indicators.ema21
    && indicators.ema21 > indicators.ema200
    && indicators.rsi >= 52 && indicators.rsi <= 68
    && volumeReady && sentiment >= 0.25;
  const short = !market.isFallback
    && indicators.ema9 < indicators.ema21
    && indicators.ema21 < indicators.ema200
    && indicators.rsi >= 32 && indicators.rsi <= 48
    && volumeReady && sentiment <= -0.25;
  return {
    bias: indicators.ema9 >= indicators.ema21 ? "LONG" : "SHORT",
    decision: long ? "BUY" : short ? "SELL" : "WAIT",
    sentimentScore: sentiment,
    reason: market.isFallback ? "Price candles are simulated, so live confluence cannot be confirmed"
      : !news.length ? "No current headlines to confirm sentiment"
        : !volumeReady ? "Volume has not confirmed the move"
          : sentiment === 0 ? "Headline sentiment is mixed or neutral"
            : "RSI, EMA trend, volume and headline sentiment are not all aligned",
  };
}
