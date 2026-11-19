import { NextRequest, NextResponse } from "next/server";
import { getMarketData, inferAssetType, normalizeSymbol } from "@/lib/market";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const symbol = normalizeSymbol(params.get("symbol") ?? "");
  const timeframe = params.get("timeframe") === "5m" ? "5m" : "1d";
  const assetType = inferAssetType(symbol, params.get("assetType"));

  if (!symbol) return NextResponse.json({ error: "Enter a ticker symbol." }, { status: 400 });
  try {
    return NextResponse.json(await getMarketData(symbol, timeframe, assetType));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Market data could not be loaded.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
