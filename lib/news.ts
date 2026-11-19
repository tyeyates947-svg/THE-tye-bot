import type { AssetType } from "@/lib/market";

export interface NewsItem {
  title: string;
  source: string;
  timestamp: number;
  url: string;
}

export async function getLatestNews(symbol: string, assetType: AssetType): Promise<NewsItem[]> {
  const url = assetType === "crypto"
    ? `https://min-api.cryptocompare.com/data/v2/news/?categories=${encodeURIComponent(symbol)}`
    : `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}&newsCount=5`;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(7000),
    headers: { "User-Agent": "QuantPulseAI/1.0" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`News provider returned ${response.status}`);
  const payload = await response.json() as { Data?: Array<Record<string, unknown>>; news?: Array<Record<string, unknown>> };
  return (assetType === "crypto" ? payload.Data : payload.news)?.slice(0, 5).map((item) => ({
    title: String(item.title ?? "Untitled headline"),
    source: String((item.source_info as { name?: string } | undefined)?.name ?? item.publisher ?? item.source ?? "Market news"),
    timestamp: Number(item.published_on ?? (item.providerPublishTime ? Number(item.providerPublishTime) : Date.now() / 1000)),
    url: String(item.url ?? item.link ?? ""),
  })).filter((item) => item.url) ?? [];
}
