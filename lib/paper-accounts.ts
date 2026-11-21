import { createDecipheriv, createCipheriv, randomBytes } from "node:crypto";
import type { PaperAccountProvider, PaperAccountStats } from "@/lib/types";
import { getSupabaseAdmin } from "@/lib/supabase";

interface Credentials {
  apiKey: string;
  apiSecret: string;
}

function encryptionKey(): Buffer {
  const configured = process.env.PAPER_ACCOUNT_ENCRYPTION_KEY ?? "";
  if (!/^[\da-f]{64}$/i.test(configured)) {
    throw new Error("PAPER_ACCOUNT_ENCRYPTION_KEY must be configured as a 64-character hexadecimal key before connecting a paper account.");
  }
  return Buffer.from(configured, "hex");
}

function encryptCredentials(credentials: Credentials): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(credentials), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")).join(".");
}

function decryptCredentials(value: string): Credentials {
  const [iv, tag, encrypted] = value.split(".");
  if (!iv || !tag || !encrypted) throw new Error("Stored paper account credentials are invalid.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
  const credentials = JSON.parse(plaintext) as Partial<Credentials>;
  if (typeof credentials.apiKey !== "string" || typeof credentials.apiSecret !== "string") {
    throw new Error("Stored paper account credentials are invalid.");
  }
  return { apiKey: credentials.apiKey, apiSecret: credentials.apiSecret };
}

function toGBP(amount: number, currency: string): number {
  if (currency === "GBp" || currency.toUpperCase() === "GBX") return amount * 0.01;
  return amount * (currency.toUpperCase() === "GBP" ? 1 : 0.79);
}

async function getJson(url: string, headers: HeadersInit): Promise<unknown> {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(12_000), cache: "no-store" });
  if (!response.ok) throw new Error(`Paper account provider returned HTTP ${response.status}. Check the practice-account credentials and API permissions.`);
  return response.json();
}

async function syncTrading212(credentials: Credentials): Promise<Omit<PaperAccountStats, "provider">> {
  const authorization = `Basic ${Buffer.from(`${credentials.apiKey}:${credentials.apiSecret}`).toString("base64")}`;
  const headers = { Authorization: authorization, Accept: "application/json" };
  let cashValue: unknown;
  let portfolioValue: unknown;
  try {
    [cashValue, portfolioValue] = await Promise.all([
      getJson("https://demo.trading212.com/api/v0/equity/account/cash", headers),
      getJson("https://demo.trading212.com/api/v0/equity/portfolio", headers),
    ]);
  } catch {
    [cashValue, portfolioValue] = await Promise.all([
      getJson("https://demo.trading212.com/api/v0/equity/account/summary", headers),
      getJson("https://demo.trading212.com/api/v0/equity/positions", headers),
    ]);
  }
  if (!cashValue || typeof cashValue !== "object") throw new Error("Trading 212 returned an unexpected account response.");
  const account = cashValue as Record<string, unknown>;
  const legacyCash = account.cash && typeof account.cash === "object" ? account.cash as Record<string, unknown> : null;
  const investments = account.investments && typeof account.investments === "object" ? account.investments as Record<string, unknown> : null;
  const positions = Array.isArray(portfolioValue) ? portfolioValue as Array<Record<string, unknown>>
    : portfolioValue && typeof portfolioValue === "object" && Array.isArray((portfolioValue as Record<string, unknown>).items)
      ? (portfolioValue as { items: Array<Record<string, unknown>> }).items
      : [];
  const currency = typeof account.currency === "string" ? account.currency : "GBP";
  const free = Number(legacyCash?.availableToTrade ?? account.free);
  const cashTotal = Number(legacyCash
    ? Number(legacyCash.availableToTrade ?? 0) + Number(legacyCash.reservedForOrders ?? 0) + Number(legacyCash.inPies ?? 0)
    : account.total ?? (Number(account.free ?? 0) + Number(account.reserved ?? 0)));
  const investedValue = Number(investments?.currentValue);
  if (!Number.isFinite(free) || !Number.isFinite(cashTotal)) throw new Error("Trading 212 did not return valid cash and total values.");
  const marketValue = positions.reduce((sum, position) => {
    const value = Number(position.currentPrice) * Number(position.quantity);
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);
  const openPnl = positions.reduce((sum, position) => {
    const value = Number(position.ppl);
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);
  const summaryOpenPnl = Number(investments?.unrealizedProfitLoss);
  const closedPnl = Number(investments?.realizedProfitLoss ?? account.result);
  const history = await getJson("https://demo.trading212.com/api/v0/equity/history/orders?limit=50", headers);
  const historyItems = history && typeof history === "object" && Array.isArray((history as Record<string, unknown>).items)
    ? (history as { items: Array<Record<string, unknown>> }).items
    : [];
  let wins = 0;
  let losses = 0;
  for (const item of historyItems) {
    if (!item.fill || typeof item.fill !== "object" || !item.order || typeof item.order !== "object") continue;
    const fill = item.fill as Record<string, unknown>;
    const order = item.order as Record<string, unknown>;
    const walletImpact = fill.walletImpact && typeof fill.walletImpact === "object" ? fill.walletImpact as Record<string, unknown> : {};
    if (order.side !== "SELL") continue;
    const realized = Number(walletImpact.realisedProfitLoss);
    if (!Number.isFinite(realized)) continue;
    if (realized > 0) wins += 1;
    else losses += 1;
  }
  const closedProfitGBP = toGBP(Number.isFinite(closedPnl) ? closedPnl : 0, currency);
  const openProfitGBP = toGBP(Number.isFinite(summaryOpenPnl) ? summaryOpenPnl : openPnl, currency);
  return {
    balance_gbp: Number(toGBP(free, currency).toFixed(2)),
    equity_gbp: Number(toGBP(cashTotal + (Number.isFinite(investedValue) ? investedValue : marketValue), currency).toFixed(2)),
    profit_gbp: Number((closedProfitGBP + openProfitGBP).toFixed(2)),
    open_profit_gbp: Number(openProfitGBP.toFixed(2)),
    closed_profit_gbp: Number(closedProfitGBP.toFixed(2)),
    win_rate: wins + losses ? Number((wins / (wins + losses) * 100).toFixed(2)) : null,
    open_positions: positions.length,
  };
}

function alpacaHeaders(credentials: Credentials): HeadersInit {
  return { "APCA-API-KEY-ID": credentials.apiKey, "APCA-API-SECRET-KEY": credentials.apiSecret, Accept: "application/json" };
}

async function alpacaClosedPerformance(credentials: Credentials): Promise<{ winRate: number | null; realizedPnl: number }> {
  const value = await getJson("https://paper-api.alpaca.markets/v2/account/activities/FILL?page_size=100&direction=desc", alpacaHeaders(credentials));
  if (!Array.isArray(value)) return { winRate: null, realizedPnl: 0 };
  const lots = new Map<string, Array<{ qty: number; price: number }>>();
  let wins = 0;
  let losses = 0;
  let realizedPnl = 0;
  for (const raw of [...value].reverse()) {
    if (!raw || typeof raw !== "object") continue;
    const activity = raw as Record<string, unknown>;
    const symbol = String(activity.symbol ?? "");
    const side = String(activity.side ?? "").toLowerCase();
    const quantity = Number(activity.qty);
    const price = Number(activity.price);
    if (!symbol || !["buy", "sell"].includes(side) || !(quantity > 0) || !(price > 0)) continue;
    const positionLots = lots.get(symbol) ?? [];
    if (side === "buy") {
      positionLots.push({ qty: quantity, price });
    } else {
      let remaining = quantity;
      while (remaining > 0 && positionLots.length) {
        const lot = positionLots[0];
        const matched = Math.min(remaining, lot.qty);
        const pnl = (price - lot.price) * matched;
        realizedPnl += pnl;
        if (pnl > 0) wins += 1;
        else losses += 1;
        remaining -= matched;
        lot.qty -= matched;
        if (lot.qty <= 1e-10) positionLots.shift();
      }
    }
    lots.set(symbol, positionLots);
  }
  return { winRate: wins + losses ? Number((wins / (wins + losses) * 100).toFixed(2)) : null, realizedPnl };
}

async function syncAlpaca(credentials: Credentials): Promise<Omit<PaperAccountStats, "provider">> {
  const headers = alpacaHeaders(credentials);
  const [accountValue, positionsValue, performance] = await Promise.all([
    getJson("https://paper-api.alpaca.markets/v2/account", headers),
    getJson("https://paper-api.alpaca.markets/v2/positions", headers),
    alpacaClosedPerformance(credentials),
  ]);
  if (!accountValue || typeof accountValue !== "object" || !Array.isArray(positionsValue)) {
    throw new Error("Alpaca returned an unexpected account response.");
  }
  const account = accountValue as Record<string, unknown>;
  const currency = typeof account.currency === "string" ? account.currency : "USD";
  const cash = Number(account.cash);
  const equity = Number(account.equity);
  const lastEquity = Number(account.last_equity);
  if (![cash, equity, lastEquity].every(Number.isFinite)) throw new Error("Alpaca did not return valid account balances.");
  const positions = positionsValue as Array<Record<string, unknown>>;
  const openPnl = positions.reduce((sum, position) => {
    const value = Number(position.unrealized_pl);
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);
  return {
    balance_gbp: Number(toGBP(cash, currency).toFixed(2)),
    equity_gbp: Number(toGBP(equity, currency).toFixed(2)),
    profit_gbp: Number(toGBP(performance.realizedPnl + openPnl, currency).toFixed(2)),
    open_profit_gbp: Number(toGBP(openPnl, currency).toFixed(2)),
    closed_profit_gbp: Number(toGBP(performance.realizedPnl, currency).toFixed(2)),
    win_rate: performance.winRate,
    open_positions: positions.length,
  };
}

export async function fetchPaperAccountStats(provider: PaperAccountProvider, credentials: Credentials): Promise<PaperAccountStats> {
  const values = provider === "alpaca" ? await syncAlpaca(credentials) : await syncTrading212(credentials);
  return { provider, ...values };
}

export async function storePaperAccount(
  profileId: string,
  provider: PaperAccountProvider,
  credentials: Credentials,
  stats: PaperAccountStats,
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error: accountError } = await supabase.from("connected_paper_accounts").upsert({
    profile_id: profileId,
    provider,
    credentials_ciphertext: encryptCredentials(credentials),
    updated_at: new Date().toISOString(),
  });
  if (accountError) throw new Error(`Could not securely save the paper account: ${accountError.message}`);
  const { error: profileError } = await supabase.from("profiles").update({
    paper_account_provider: provider,
    paper_account_verified: true,
    paper_account_balance_gbp: stats.balance_gbp,
    paper_account_equity_gbp: stats.equity_gbp,
    paper_account_profit_gbp: stats.profit_gbp,
    paper_account_win_rate: stats.win_rate,
    paper_account_open_profit_gbp: stats.open_profit_gbp,
    paper_account_closed_profit_gbp: stats.closed_profit_gbp,
    paper_account_open_positions: stats.open_positions,
    updated_at: new Date().toISOString(),
  }).eq("id", profileId);
  if (profileError) throw new Error(`Account verified, but profile statistics could not be saved: ${profileError.message}`);
}

export async function refreshPaperAccount(profileId: string): Promise<PaperAccountStats | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("connected_paper_accounts")
    .select("provider, credentials_ciphertext").eq("profile_id", profileId).maybeSingle();
  if (error) throw new Error(`Could not load connected paper account: ${error.message}`);
  if (!data) return null;
  const provider = data.provider as PaperAccountProvider;
  const stats = await fetchPaperAccountStats(provider, decryptCredentials(String(data.credentials_ciphertext)));
  await storePaperAccount(profileId, provider, decryptCredentials(String(data.credentials_ciphertext)), stats);
  return stats;
}

export async function removePaperAccount(profileId: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("connected_paper_accounts").delete().eq("profile_id", profileId);
  if (error) throw new Error(`Could not disconnect paper account: ${error.message}`);
  const { error: profileError } = await supabase.from("profiles").update({
    paper_account_provider: null,
    paper_account_verified: false,
    paper_account_balance_gbp: null,
    paper_account_equity_gbp: null,
    paper_account_profit_gbp: null,
    paper_account_win_rate: null,
    paper_account_open_profit_gbp: null,
    paper_account_closed_profit_gbp: null,
    paper_account_open_positions: null,
    updated_at: new Date().toISOString(),
  }).eq("id", profileId);
  if (profileError) throw new Error(`Paper account disconnected, but profile status could not be updated: ${profileError.message}`);
}

export function validatePaperAccountRequest(body: unknown): { provider: PaperAccountProvider; credentials: Credentials } {
  if (!body || typeof body !== "object") throw new Error("Paper account details are required.");
  const value = body as Record<string, unknown>;
  const provider = value.provider;
  const apiKey = typeof value.apiKey === "string" ? value.apiKey.trim() : "";
  const apiSecret = typeof value.apiSecret === "string" ? value.apiSecret.trim() : "";
  if ((provider !== "trading212" && provider !== "alpaca") || apiKey.length < 8 || apiKey.length > 300 || apiSecret.length < 8 || apiSecret.length > 300) {
    throw new Error("Choose a provider and enter a valid API key and secret.");
  }
  return { provider, credentials: { apiKey, apiSecret } };
}
