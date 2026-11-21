import type { AssetType, MarketData, Timeframe } from "@/lib/market";

export type AnalysisMode = "hunter" | "sniper";
export type PaperAccountProvider = "trading212" | "alpaca";

export type TradeDuration = "5m" | "15m" | "1h" | "4h" | "1d" | "1w" | "custom";

export const TRADE_DURATIONS: Record<Exclude<TradeDuration, "custom">, number> = {
  "5m": 5,
  "15m": 15,
  "1h": 60,
  "4h": 240,
  "1d": 1440,
  "1w": 10080,
};

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
  requestedProfitGBP?: number;
  profitTargetMet?: boolean;
  entryAt?: string;
  durationMinutes?: number;
  goalRiskWarning?: string;
  maxRiskGBP: number;
  allocationGBP: number;
  leverage: string;
  rationale: string;
  riskNote: string;
  market: Omit<MarketData, "candles">;
  newsInsights: Array<{ title: string; source: string; url: string; timestamp: number; sentiment: "bullish" | "bearish" | "neutral" }>;
  scanned?: boolean;
  commentary?: {
    hook: string;
    chartSetup: string;
    newsCatalyst: string;
    riskNote: string;
  };
}

export interface FuturePlan {
  id: string;
  title: string;
  symbol: string;
  assetType: AssetType;
  timeframe: Timeframe;
  budget: number;
  targetProfitGBP?: number;
  durationMinutes?: number;
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
  entry_at?: string;
  duration_minutes?: number;
  expires_at?: string;
  mark_price: number;
  unrealized_pnl_gbp: number;
  is_fallback: boolean;
  status?: "scheduled" | "open" | "closed";
  pnl_gbp?: number;
  exit_price?: number | null;
  closed_at?: string | null;
  progress_pct?: number;
  ai_update?: string;
}

export interface PaperAccountStats {
  provider: PaperAccountProvider;
  balance_gbp: number;
  equity_gbp: number;
  profit_gbp: number;
  open_profit_gbp: number;
  closed_profit_gbp: number;
  win_rate: number | null;
  open_positions: number;
}
