import type { AssetType, MarketData, Timeframe } from "@/lib/market";

export type AnalysisMode = "hunter" | "sniper";

export interface AnalysisPayload {
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
  market: Omit<MarketData, "candles">;
  newsInsights: Array<{ title: string; source: string; url: string; timestamp: number; sentiment: "bullish" | "bearish" | "neutral" }>;
  scanned?: boolean;
}

export interface FuturePlan {
  id: string;
  title: string;
  symbol: string;
  assetType: AssetType;
  timeframe: Timeframe;
  budget: number;
  dueAt: string;
  updatedAt?: string;
  analysis?: AnalysisPayload;
  refreshError?: string;
}

export interface PaperTrade {
  id: string;
  symbol: string;
  asset_type: AssetType;
  direction: "LONG" | "SHORT";
  timeframe: Timeframe;
  currency: string;
  entry_price: number;
  units: number;
  amount_gbp: number;
  take_profit: number;
  stop_loss: number;
  created_at: string;
  mark_price: number;
  unrealized_pnl_gbp: number;
  is_fallback: boolean;
}
