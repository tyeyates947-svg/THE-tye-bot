export type Timeframe = "5m" | "1d";
export type AssetType = "stock" | "crypto";

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Indicators {
  rsi: number;
  ema9: number;
  ema21: number;
  ema200: number;
  macd: number;
  macdSignal: number;
  atr: number;
  rangeHigh: number;
  rangeLow: number;
  volumeSpikePct: number;
}

export interface MarketData {
  symbol: string;
  assetType: AssetType;
  timeframe: Timeframe;
  currency: string;
  candles: Candle[];
  price: number;
  changePct: number;
  indicators: Indicators;
  source: string;
  isFallback: boolean;
}

const cryptoSymbols = new Set([
  "BTC", "ETH", "SOL", "XRP", "DOGE", "SUI", "PEPE", "ADA", "AVAX", "LINK",
  "DOT", "LTC", "BCH", "BNB", "TRX", "TON", "SHIB", "UNI", "NEAR", "APT",
]);

export function normalizeSymbol(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9.^=-]/g, "").slice(0, 20);
}

export function inferAssetType(symbol: string, requested?: string | null): AssetType {
  if (requested === "crypto" || requested === "stock") return requested;
  return cryptoSymbols.has(symbol.toUpperCase()) ? "crypto" : "stock";
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function ema(values: number[], period: number): number {
  if (!values.length) return 0;
  const multiplier = 2 / (period + 1);
  return values.reduce((current, value, index) => index === 0 ? value : value * multiplier + current * (1 - multiplier), values[values.length - 1]);
}

export function calculateIndicators(candles: Candle[]): Indicators {
  const closes = candles.map((candle) => candle.close);
  const recent = candles.slice(-14);
  const gains: number[] = [];
  const losses: number[] = [];
  for (let index = Math.max(1, closes.length - 14); index < closes.length; index += 1) {
    const change = closes[index] - closes[index - 1];
    gains.push(Math.max(change, 0));
    losses.push(Math.max(-change, 0));
  }
  const avgGain = average(gains);
  const avgLoss = average(losses);
  const rsi = avgLoss === 0 ? (avgGain === 0 ? 50 : 100) : 100 - 100 / (1 + avgGain / avgLoss);
  const trueRanges = candles.slice(1).map((candle, index) => Math.max(
    candle.high - candle.low,
    Math.abs(candle.high - candles[index].close),
    Math.abs(candle.low - candles[index].close),
  ));
  const macdLine = ema(closes, 12) - ema(closes, 26);
  const macdValues = closes.map((_, index) => ema(closes.slice(0, index + 1), 12) - ema(closes.slice(0, index + 1), 26));
  const volumeAverage = average(candles.slice(-21, -1).map((candle) => candle.volume));
  const latestVolume = candles.at(-1)?.volume ?? 0;

  return {
    rsi: Number(rsi.toFixed(2)),
    ema9: ema(closes, 9),
    ema21: ema(closes, 21),
    ema200: ema(closes, 200),
    macd: macdLine,
    macdSignal: ema(macdValues, 9),
    atr: average(trueRanges.slice(-14)),
    rangeHigh: Math.max(...candles.map((candle) => candle.high)),
    rangeLow: Math.min(...candles.map((candle) => candle.low)),
    volumeSpikePct: volumeAverage ? Number((((latestVolume / volumeAverage) - 1) * 100).toFixed(1)) : 0,
  };
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export function makeFallbackCandles(symbol: string, timeframe: Timeframe, count = 220): Candle[] {
  const seed = [...symbol].reduce((total, char) => total + char.charCodeAt(0), timeframe === "5m" ? 5 : 1);
  const random = seededRandom(seed);
  const base = (seed % 400) + 35;
  const interval = timeframe === "5m" ? 5 * 60 : 24 * 60 * 60;
  const now = Math.floor(Date.now() / interval) * interval;
  let previous = base;

  return Array.from({ length: count }, (_, index) => {
    const time = now - (count - index - 1) * interval;
    const drift = (random() - 0.49) * base * (timeframe === "5m" ? 0.003 : 0.018);
    const open = previous;
    const close = Math.max(0.01, open + drift);
    const spread = Math.max(base * 0.0007, Math.abs(drift) * random() * 1.8);
    previous = close;
    return {
      time,
      open,
      close,
      high: Math.max(open, close) + spread * random(),
      low: Math.max(0.01, Math.min(open, close) - spread * random()),
      volume: Math.round(300_000 + random() * 1_800_000),
    };
  });
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { "User-Agent": "QuantPulseAI/1.0 (market dashboard)" },
    signal: AbortSignal.timeout(7000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Market provider returned ${response.status}`);
  return response.json();
}

function parseYahoo(payload: unknown): { candles: Candle[]; currency: string } {
  const chart = (payload as {
    chart?: {
      result?: Array<{
        timestamp?: number[];
        meta?: { currency?: string };
        indicators?: {
          quote?: Array<{
            open?: (number | null)[];
            high?: (number | null)[];
            low?: (number | null)[];
            close?: (number | null)[];
            volume?: (number | null)[];
          }>;
        };
      }>;
    };
  }).chart;
  const result = chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  if (!result?.timestamp || !quote?.close) throw new Error("No Yahoo Finance candle data");
  const candles = result.timestamp.flatMap((time, index) => {
    const open = quote.open?.[index];
    const high = quote.high?.[index];
    const low = quote.low?.[index];
    const close = quote.close?.[index];
    if ([open, high, low, close].some((value) => typeof value !== "number")) return [];
    return [{ time, open: open as number, high: high as number, low: low as number, close: close as number, volume: quote.volume?.[index] ?? 0 }];
  });
  if (!candles.length) throw new Error("No Yahoo Finance candles");
  return { candles, currency: result.meta?.currency ?? "USD" };
}

async function fetchStock(symbol: string, timeframe: Timeframe): Promise<{ candles: Candle[]; currency: string; source: string }> {
  const interval = timeframe === "5m" ? "5m" : "1d";
  const range = timeframe === "5m" ? "5d" : "2y";
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;
  try {
    const data = parseYahoo(await fetchJson(url));
    return { ...data, source: "Yahoo Finance" };
  } catch (yahooError) {
    if (process.env.ALPHA_VANTAGE_API_KEY) {
      try {
        const outputSize = timeframe === "5m" ? "compact" : "full";
        const functionName = timeframe === "5m" ? "TIME_SERIES_INTRADAY&interval=5min" : "TIME_SERIES_DAILY";
        const avUrl = `https://www.alphavantage.co/query?function=${functionName}&symbol=${encodeURIComponent(symbol)}&outputsize=${outputSize}&apikey=${process.env.ALPHA_VANTAGE_API_KEY}`;
        const av = await fetchJson(avUrl) as Record<string, unknown>;
        const series = Object.entries(av).find(([key]) => key.startsWith("Time Series"));
        if (series) {
          const candles = Object.entries(series[1] as Record<string, Record<string, string>>).map(([date, values]) => ({
            time: Math.floor(new Date(date).getTime() / 1000),
            open: Number(values["1. open"]), high: Number(values["2. high"]), low: Number(values["3. low"]),
            close: Number(values["4. close"]), volume: Number(values["5. volume"]),
          })).sort((a, b) => a.time - b.time);
          if (candles.length) return { candles, currency: "USD", source: "Alpha Vantage" };
        }
      } catch (alphaError) {
        console.warn(`Alpha Vantage data unavailable for ${symbol}.`, alphaError);
      }
    }
    if (yahooError instanceof Error) console.warn(`Yahoo data unavailable for ${symbol}; using fallback candles.`);
    return { candles: makeFallbackCandles(symbol, timeframe), currency: symbol.endsWith(".L") ? "GBp" : "USD", source: "Simulated fallback" };
  }
}

async function fetchCrypto(symbol: string, timeframe: Timeframe): Promise<{ candles: Candle[]; currency: string; source: string }> {
  const interval = timeframe === "5m" ? "5m" : "1d";
  const pair = `${symbol.toUpperCase()}USDT`;
  try {
    const rows = await fetchJson(`https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(pair)}&interval=${interval}&limit=500`) as unknown[][];
    const candles = rows.map((row) => ({
      time: Math.floor(Number(row[0]) / 1000),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5]),
    }));
    if (candles.length) return { candles, currency: "USDT", source: "Binance" };
    throw new Error("No Binance candles");
  } catch {
    try {
      if (timeframe === "5m") throw new Error("CoinGecko fallback is daily, not intraday.");
      const coin = await fetchJson(`https://api.coingecko.com/api/v3/coins/${encodeURIComponent(symbol.toLowerCase())}/market_chart?vs_currency=usd&days=30&interval=daily`) as { prices?: [number, number][]; total_volumes?: [number, number][] };
      if (coin.prices?.length) {
        const candles = coin.prices.map(([timestamp, close], index) => ({
          time: Math.floor(timestamp / 1000), open: index ? coin.prices?.[index - 1][1] ?? close : close,
          high: close * 1.005, low: close * 0.995, close, volume: coin.total_volumes?.[index]?.[1] ?? 0,
        }));
        return { candles, currency: "USD", source: "CoinGecko" };
      }
    } catch {
      // The deterministic fallback below keeps unsupported or rate-limited assets usable.
    }
    return { candles: makeFallbackCandles(symbol, timeframe), currency: "USD", source: "Simulated fallback" };
  }
}

export async function getMarketData(symbol: string, timeframe: Timeframe, assetType: AssetType): Promise<MarketData> {
  const providerData = assetType === "crypto" ? await fetchCrypto(symbol, timeframe) : await fetchStock(symbol, timeframe);
  const candles = providerData.candles.slice(-500);
  if (!candles.length) throw new Error(`No candle data available for ${symbol}`);
  const price = candles.at(-1)!.close;
  const previous = candles.at(-2)?.close ?? price;
  return {
    symbol,
    assetType,
    timeframe,
    currency: providerData.currency,
    candles,
    price,
    changePct: previous ? ((price - previous) / previous) * 100 : 0,
    indicators: calculateIndicators(candles),
    source: providerData.source,
    isFallback: providerData.source === "Simulated fallback",
  };
}
