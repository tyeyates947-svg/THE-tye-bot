import { NextRequest, NextResponse } from "next/server";
import { inferAssetType, normalizeSymbol } from "@/lib/market";
import { getLatestNews } from "@/lib/news";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const symbol = normalizeSymbol(params.get("symbol") ?? "");
  const assetType = inferAssetType(symbol, params.get("assetType"));
  if (!symbol) return NextResponse.json({ error: "Enter a ticker symbol." }, { status: 400 });

  try {
    const items = await getLatestNews(symbol, assetType);
    return NextResponse.json({ symbol, items, source: assetType === "crypto" ? "CryptoCompare" : "Yahoo Finance" });
  } catch (error) {
    console.warn(`News unavailable for ${symbol}.`, error);
    return NextResponse.json({ symbol, items: [], source: "Unavailable", error: "Live headlines are temporarily unavailable." });
  }
}
