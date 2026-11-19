"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  Activity, ArrowDownRight, ArrowUpRight, Bot, CalendarClock, CircleHelp, Clock3, LoaderCircle, LockKeyhole,
  Newspaper, Search, Send, Sparkles, Trophy, TrendingUp, Users,
} from "lucide-react";
import TradingChart from "@/components/TradingChart";
import AuthDialog from "@/components/AuthDialog";
import LeaderboardDialog from "@/components/LeaderboardDialog";
import PlannerDialog from "@/components/PlannerDialog";
import ProfileAvatar from "@/components/ProfileAvatar";
import ProfileDialog from "@/components/ProfileDialog";
import { readApiResponse, withSession } from "@/lib/client-api";
import type { AssetType, MarketData, Timeframe } from "@/lib/market";
import type { Profile } from "@/lib/session";
import type { AnalysisPayload, FuturePlan, PaperTrade } from "@/lib/types";

interface NewsItem { title: string; source: string; timestamp: number; url: string }
type Analysis = AnalysisPayload;
interface ChatMessage { role: "user" | "assistant"; text: string }
const movers: Array<{ symbol: string; type: AssetType }> = [
  { symbol: "NVDA", type: "stock" }, { symbol: "TSLA", type: "stock" }, { symbol: "AMD", type: "stock" },
  { symbol: "PLTR", type: "stock" }, { symbol: "BTC", type: "crypto" },
];
const prompts = ["Best trade right now?", "5m high-profit scalp", "Long-term hold pick"];

function currency(value: number, code = "USD"): string {
  const normalizedCode = code === "GBp" ? "GBP" : code === "USDT" ? "USD" : code;
  const normalizedValue = code === "GBp" ? value / 100 : value;
  try { return new Intl.NumberFormat("en-GB", { style: "currency", currency: normalizedCode, maximumFractionDigits: normalizedValue < 1 ? 5 : 2 }).format(normalizedValue); }
  catch { return `${normalizedCode} ${normalizedValue.toFixed(2)}`; }
}

function shortTime(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return date.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function Dashboard() {
  const [symbol, setSymbol] = useState("NVDA");
  const [assetType, setAssetType] = useState<AssetType>("stock");
  const [timeframe, setTimeframe] = useState<Timeframe>("5m");
  const [query, setQuery] = useState("");
  const [searchType, setSearchType] = useState<"auto" | AssetType>("auto");
  const [market, setMarket] = useState<MarketData | null>(null);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [budget, setBudget] = useState(1000);
  const [sessionToken, setSessionToken] = useState("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [paperTrades, setPaperTrades] = useState<PaperTrade[]>([]);
  const [tradeStake, setTradeStake] = useState("100");
  const [tradeBusy, setTradeBusy] = useState(false);
  const [tradeError, setTradeError] = useState("");
  const [plans, setPlans] = useState<FuturePlan[]>([]);
  const [plansLoaded, setPlansLoaded] = useState(false);
  const [loadingMarket, setLoadingMarket] = useState(false);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  const [error, setError] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatText, setChatText] = useState("");
  const [authOpen, setAuthOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  const [plannerOpen, setPlannerOpen] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const refreshPaperTrades = useCallback(async (token: string) => {
    try {
      const response = await fetch("/api/trades", { headers: withSession(token) });
      const result = await readApiResponse<{ trades: PaperTrade[]; profile: Profile }>(response, "Paper trading");
      setPaperTrades(result.trades);
      setProfile(result.profile);
      setTradeError("");
    } catch (caught) {
      setTradeError(caught instanceof Error ? caught.message : "Could not refresh paper trades.");
    }
  }, []);

  const refreshProfile = useCallback(async (token: string) => {
    const response = await fetch("/api/auth/me", { headers: withSession(token) });
    const result = await readApiResponse<{ profile: Profile }>(response, "Profile service");
    setProfile(result.profile);
  }, []);

  useEffect(() => {
    const savedBudget = Number(localStorage.getItem("quantpulse-budget"));
    if (savedBudget > 0) setBudget(savedBudget);
    try {
      const savedPlans = JSON.parse(localStorage.getItem("quantpulse-plans") ?? "[]") as FuturePlan[];
      if (Array.isArray(savedPlans)) setPlans(savedPlans);
    } catch {
      localStorage.removeItem("quantpulse-plans");
    }
    setPlansLoaded(true);
    const savedToken = localStorage.getItem("quantpulse-session");
    if (!savedToken) return;
    setSessionToken(savedToken);
    void refreshProfile(savedToken).then(() => refreshPaperTrades(savedToken)).catch(() => {
      localStorage.removeItem("quantpulse-session");
      setSessionToken("");
      setProfile(null);
    });
  }, [refreshPaperTrades, refreshProfile]);

  useEffect(() => {
    if (plansLoaded) localStorage.setItem("quantpulse-plans", JSON.stringify(plans));
  }, [plans, plansLoaded]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const loadAsset = useCallback(async (nextSymbol: string, nextType: AssetType, nextTimeframe = timeframe) => {
    setLoadingMarket(true);
    setError("");
    setSymbol(nextSymbol);
    setAssetType(nextType);
    try {
      const params = new URLSearchParams({ symbol: nextSymbol, assetType: nextType, timeframe: nextTimeframe });
      const [marketResponse, newsResponse] = await Promise.all([
        fetch(`/api/market?${params}`),
        fetch(`/api/news?${new URLSearchParams({ symbol: nextSymbol, assetType: nextType })}`),
      ]);
      const marketPayload = await readApiResponse<MarketData>(marketResponse, "Market data");
      const newsPayload = await readApiResponse<{ items?: NewsItem[] }>(newsResponse, "News feed");
      setMarket(marketPayload);
      setNews(newsPayload.items ?? []);
      setAnalysis((previous) => previous?.symbol === nextSymbol && previous.timeframe === nextTimeframe ? previous : null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Market data could not be loaded.");
    } finally { setLoadingMarket(false); }
  }, [timeframe]);

  useEffect(() => { void loadAsset("NVDA", "stock", "5m"); }, []);

  useEffect(() => {
    if (!sessionToken) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshPaperTrades(sessionToken);
    }, 30_000);
    return () => window.clearInterval(interval);
  }, [refreshPaperTrades, sessionToken]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadAsset(symbol, assetType, timeframe);
    }, 60_000);
    return () => window.clearInterval(interval);
  }, [loadAsset, symbol, assetType, timeframe]);

  const runAnalysis = async (question: string) => {
    setLoadingAnalysis(true);
    setError("");
    setMessages((items) => [...items, { role: "user", text: question }]);
    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, assetType, timeframe, budget, question }),
      });
      const result = await readApiResponse<Analysis & { error?: string }>(response, "Analysis service");
      setAnalysis(result);
      setTradeStake(result.allocationGBP > 0 ? result.allocationGBP.toFixed(2) : "100");
      const headlines = result.newsInsights.slice(0, 3).map((item) => `${item.sentiment}: ${item.title}`).join("\n");
      const probability = result.decision === "WAIT" ? "n/a — WAIT" : `${result.winProbability}% (heuristic)`;
      const levelsText = result.decision === "WAIT"
        ? "no trade levels or position are actionable while the signal is WAIT."
        : `entry ${currency(result.entryPrice, result.market.currency)} · take profit ${currency(result.takeProfit, result.market.currency)} · stop loss ${currency(result.stopLoss, result.market.currency)}\nwin probability ${probability} · projected +£${result.targetProfitGBP.toFixed(2)} · max risk £${result.maxRiskGBP.toFixed(2)} on £${result.allocationGBP.toFixed(2)} allocation.`;
      setMessages((items) => [...items, { role: "assistant", text: `${result.scanned ? `scanner's top match: ${result.symbol} (${result.decision}). ` : `${result.symbol} ${result.decision}. `}${result.rationale}\n\n${headlines ? `news read:\n${headlines}\n\n` : "no live headlines to confirm sentiment.\n\n"}${levelsText} ${result.riskNote}` }]);
      if (result.symbol !== symbol || result.assetType !== assetType || result.timeframe !== timeframe) {
        setTimeframe(result.timeframe);
        await loadAsset(result.symbol, result.assetType, result.timeframe);
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Analysis could not be completed.";
      setError(message);
      setMessages((items) => [...items, { role: "assistant", text: `I couldn't complete that analysis: ${message}` }]);
    } finally { setLoadingAnalysis(false); }
  };

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    const normalized = query.trim().toUpperCase().replace(/[^A-Z0-9.^=-]/g, "");
    if (!normalized) return;
    const nextType: AssetType = searchType === "auto"
      ? ["BTC", "ETH", "SOL", "XRP", "DOGE", "SUI", "PEPE", "ADA", "AVAX", "BNB"].includes(normalized) ? "crypto" : "stock"
      : searchType;
    void loadAsset(normalized, nextType);
    setQuery("");
  };

  const changeTimeframe = (nextTimeframe: Timeframe) => {
    if (nextTimeframe === timeframe) return;
    setTimeframe(nextTimeframe);
    void loadAsset(symbol, assetType, nextTimeframe);
  };

  const handleBudget = (value: string) => {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      const bounded = Math.min(1_000_000, parsed);
      setBudget(bounded);
      localStorage.setItem("quantpulse-budget", String(bounded));
    }
  };

  const handleAuthenticated = (token: string, value: Profile) => {
    localStorage.setItem("quantpulse-session", token);
    setSessionToken(token);
    setProfile(value);
    setTradeError("");
    void refreshPaperTrades(token);
  };

  const signOut = async () => {
    if (sessionToken) await fetch("/api/auth/logout", { method: "POST", headers: withSession(sessionToken) }).catch(() => undefined);
    localStorage.removeItem("quantpulse-session");
    setSessionToken("");
    setProfile(null);
    setPaperTrades([]);
  };

  const openPaperTrade = async () => {
    if (!activeAnalysis || !profile || !sessionToken || activeAnalysis.decision === "WAIT") return;
    setTradeBusy(true);
    setTradeError("");
    try {
      const response = await fetch("/api/trades", {
        method: "POST",
        headers: { ...withSession(sessionToken), "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: activeAnalysis.symbol,
          assetType: activeAnalysis.assetType,
          direction: activeAnalysis.direction,
          timeframe: activeAnalysis.timeframe,
          amountGBP: Number(tradeStake),
          entryPrice: activeAnalysis.entryPrice,
          takeProfit: activeAnalysis.takeProfit,
          stopLoss: activeAnalysis.stopLoss,
        }),
      });
      const result = await readApiResponse<{ profile: Profile }>(response, "Paper trade");
      setProfile(result.profile);
      await refreshPaperTrades(sessionToken);
    } catch (caught) {
      setTradeError(caught instanceof Error ? caught.message : "Could not open paper trade.");
    } finally { setTradeBusy(false); }
  };

  const closePaperTrade = async (tradeId: string) => {
    if (!sessionToken) return;
    setTradeBusy(true);
    setTradeError("");
    try {
      const response = await fetch("/api/trades/close", {
        method: "POST",
        headers: { ...withSession(sessionToken), "Content-Type": "application/json" },
        body: JSON.stringify({ tradeId }),
      });
      await readApiResponse<{ pnlGBP: number; balanceGBP: number }>(response, "Close trade");
      await refreshPaperTrades(sessionToken);
    } catch (caught) {
      setTradeError(caught instanceof Error ? caught.message : "Could not close paper trade.");
    } finally { setTradeBusy(false); }
  };
  const onChatSubmit = (event: FormEvent) => {
    event.preventDefault();
    const question = chatText.trim();
    if (!question || loadingAnalysis) return;
    setChatText("");
    void runAnalysis(question);
  };
  const activeAnalysis = analysis?.symbol === symbol && analysis.assetType === assetType && analysis.timeframe === timeframe ? analysis : null;
  const stakeScale = activeAnalysis?.allocationGBP ? Math.max(0, Number(tradeStake) || 0) / activeAnalysis.allocationGBP : 0;
  const stakeTargetGBP = (activeAnalysis?.targetProfitGBP ?? 0) * stakeScale;
  const stakeRiskGBP = (activeAnalysis?.maxRiskGBP ?? 0) * stakeScale;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark"><Activity size={19} strokeWidth={2.5} /></div>
          <div><div className="brand-name">QuantPulse AI</div><div className="brand-sub">MARKET INTELLIGENCE</div></div>
        </div>
        <div className="top-actions">
          <label className="budget-box"><span>Budget</span><span>£</span><input aria-label="Trading budget in pounds" type="number" min="1" max="1000000" value={budget} onChange={(event) => handleBudget(event.target.value)} /></label>
          <button className="outline-button friends-button" onClick={() => setLeaderboardOpen(true)}><Users size={14} /><span>Friends</span></button>
          {profile
            ? <div className="account-controls"><button className="profile-badge" onClick={() => setProfileOpen(true)} aria-label={`Edit @${profile.username} profile`}><ProfileAvatar avatarUrl={profile.avatar_url} username={profile.username} size={29} /><span>@{profile.username}</span><b>£{profile.balance_gbp.toFixed(2)}</b></button><button className="outline-button sign-out-button" onClick={() => void signOut()} title="Sign out"><LockKeyhole size={14} /></button></div>
            : <button className="outline-button" onClick={() => setAuthOpen(true)}><LockKeyhole size={14} /> <span>Sign in</span></button>}
        </div>
      </header>

      <main className="main-content">
        <div className="hero-row">
          <div>
            <div className="eyebrow">Quant dashboard <span style={{ color: "#667064" }}> / </span> Live markets</div>
            <h1 className="page-title">Find your next market edge.</h1>
            <p className="page-description">Market data and technical scenarios for research—not financial advice.</p>
          </div>
          <form className="search-area" onSubmit={submitSearch}>
            <select className="search-select" aria-label="Ticker type" value={searchType} onChange={(event) => setSearchType(event.target.value as "auto" | AssetType)}>
              <option value="auto">Auto</option><option value="stock">Stock</option><option value="crypto">Crypto</option>
            </select>
            <label className="search-box"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search any ticker e.g. NVDA, BTC..." aria-label="Search a ticker" /></label>
            <button type="submit" className="lime-button"><Search size={14} /> <span>Search</span></button>
          </form>
        </div>

        <div className="toolbar">
          <div className="mover-list">
            <span className="section-label">Quick markets</span>
            {movers.map((item) => <button key={item.symbol} className={`chip ${symbol === item.symbol ? "selected" : ""}`} onClick={() => void loadAsset(item.symbol, item.type)}>{item.symbol}</button>)}
          </div>
          <div className="time-toggle" role="group" aria-label="Chart timeframe">
            <button className={timeframe === "5m" ? "active" : ""} onClick={() => changeTimeframe("5m")}><Clock3 size={12} style={{ verticalAlign: "middle", marginRight: 5 }} />5m Scalp</button>
            <button className={timeframe === "1d" ? "active" : ""} onClick={() => changeTimeframe("1d")}><TrendingUp size={12} style={{ verticalAlign: "middle", marginRight: 5 }} />1D Long-term</button>
          </div>
        </div>

        {error && <div className="error-banner" role="alert">{error}</div>}
        {profile && <section className="panel paper-trades-panel">
          <div className="paper-trades-head">
            <div><div className="panel-title"><TrendingUp size={14} /> Active paper trades <span className="paper-count">{paperTrades.length}</span></div><div className="paper-balance">Available £{profile.balance_gbp.toFixed(2)} <span>·</span> All-time P&L <strong className={profile.total_profit_gbp >= 0 ? "positive" : "negative"}>{profile.total_profit_gbp >= 0 ? "+" : ""}£{profile.total_profit_gbp.toFixed(2)}</strong> <span>·</span> {profile.wins}W / {profile.losses}L</div></div>
            <button className="outline-button friends-inline" onClick={() => setLeaderboardOpen(true)}><Trophy size={13} /> Leaderboard</button>
          </div>
          {tradeError && <div className="trade-error">{tradeError}</div>}
          <div className="paper-trade-list">
            {paperTrades.map((trade) => <article className="paper-trade-row" key={trade.id}>
              <span className={`trade-side ${trade.direction.toLowerCase()}`}>{trade.direction}</span>
              <strong>{trade.symbol}</strong>
              <span>Entry {currency(trade.entry_price, trade.currency)}</span>
              <span>Now {currency(trade.mark_price, trade.currency)}{trade.is_fallback ? " · est." : ""}</span>
              <strong className={trade.unrealized_pnl_gbp >= 0 ? "positive" : "negative"}>{trade.unrealized_pnl_gbp >= 0 ? "+" : ""}£{trade.unrealized_pnl_gbp.toFixed(2)}</strong>
              <button className="close-trade-button" disabled={tradeBusy} onClick={() => void closePaperTrade(trade.id)}>Close trade</button>
            </article>)}
            {!paperTrades.length && <div className="paper-empty">No open positions yet. Run an AI scan and take a paper trade to see live P&L here.</div>}
          </div>
        </section>}
        <div className="dashboard-grid">
          <div className="left-stack">
            <section className="panel market-panel">
              <div className="asset-header">
                <div className="asset-info">
                  <div className="asset-icon">{assetType === "crypto" ? "₿" : symbol.slice(0, 2)}</div>
                  <div><div className="asset-symbol">{symbol} <span style={{ color: "#778078", fontSize: 10, fontWeight: 450 }}>{assetType === "crypto" ? "CRYPTO" : "EQUITY"}</span></div>
                    <div className="asset-name"><span className="source-dot" style={{ background: market?.isFallback ? "#e5aa54" : "#b1f26a" }} /> {market?.source ?? "Loading market data"} {market?.isFallback ? "· estimated" : "· live feed"}</div></div>
                </div>
                <div className="price-area">
                  <div className="asset-price">{market ? currency(market.price, market.currency) : "—"}</div>
                  <div className={`price-change ${(market?.changePct ?? 0) >= 0 ? "positive" : "negative"}`}>{market ? <>{market.changePct >= 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />} {market.changePct >= 0 ? "+" : ""}{market.changePct.toFixed(2)}%</> : "Waiting for data"}</div>
                </div>
              </div>
              <div className="chart-wrap">
                <div className="chart-meta">
                  <span>{timeframe === "5m" ? "5-minute candles · 5-day window" : "Daily candles · 2-year window"}</span>
                  <div className="legend"><span style={{ color: "#d9deda" }}><i /> Entry</span><span style={{ color: "#b1f26a" }}><i /> Target</span><span style={{ color: "#fa7268" }}><i /> Stop</span></div>
                </div>
                {market ? <TradingChart candles={market.candles} entry={activeAnalysis?.decision !== "WAIT" ? activeAnalysis?.entryPrice : undefined} takeProfit={activeAnalysis?.decision !== "WAIT" ? activeAnalysis?.takeProfit : undefined} stopLoss={activeAnalysis?.decision !== "WAIT" ? activeAnalysis?.stopLoss : undefined} /> : <div className="chart-canvas" style={{ display: "grid", placeItems: "center" }}><span className="loading-note">{loadingMarket ? "Loading candles..." : "Search a market to begin"}</span></div>}
              </div>
            </section>

            <div className="metrics-grid">
              {[
                { label: "RSI (14)", value: market?.indicators.rsi.toFixed(1) ?? "—", note: market ? market.indicators.rsi > 70 ? "Overbought zone" : market.indicators.rsi < 30 ? "Oversold zone" : "Neutral momentum" : "Relative strength" },
                { label: "EMA 9 / 21", value: market ? `${currency(market.indicators.ema9, market.currency)} / ${currency(market.indicators.ema21, market.currency)}` : "—", note: market ? market.indicators.ema9 > market.indicators.ema21 ? "Short trend bullish" : "Short trend bearish" : "Trend alignment" },
                { label: "EMA 200", value: market ? currency(market.indicators.ema200, market.currency) : "—", note: "Long-term trend" },
                { label: "Volume spike", value: market ? `${market.indicators.volumeSpikePct > 0 ? "+" : ""}${market.indicators.volumeSpikePct.toFixed(1)}%` : "—", note: `MACD ${market?.indicators.macd.toFixed(3) ?? "—"} · ATR ${market ? market.indicators.atr.toFixed(3) : "—"}` },
              ].map((item) => <article className="panel metric-card" key={item.label}><div className="metric-label">{item.label}<CircleHelp size={12} /></div><div className="metric-value">{item.value}</div><div className="metric-note">{item.note}</div></article>)}
            </div>

            <div className="bottom-grid">
              <section className="panel">
                <div className="panel-heading"><div className="panel-title"><Sparkles size={14} /> Trade scenario</div><span className={`panel-kicker ${activeAnalysis?.decision === "WAIT" ? "negative" : ""}`}>{activeAnalysis ? activeAnalysis.decision : "Awaiting analysis"}</span></div>
                {activeAnalysis ? <div className="trade-content">
                  {activeAnalysis.decision === "WAIT" ? <div className="wait-card"><strong>WAIT · no qualified setup</strong><span>RSI, EMA trend, volume and live news must all align before sizing a paper trade.</span></div> : <>
                  <div className="trade-stat-row">
                    <div className="trade-stat"><label>Est. target at stake</label><strong className="positive">+£{stakeTargetGBP.toFixed(2)}</strong></div>
                    <div className="trade-stat"><label>Max risk at stake</label><strong className="negative">−£{stakeRiskGBP.toFixed(2)}</strong></div>
                    <div className="trade-stat"><label>Allocation · {activeAnalysis.leverage}</label><strong>£{activeAnalysis.allocationGBP.toFixed(2)}</strong></div>
                  </div>
                  <div className="confidence-row"><span>Estimated win probability · heuristic</span><strong>{activeAnalysis.winProbability}%</strong></div>
                  <div className="progress-track"><div className="progress-fill" style={{ width: `${activeAnalysis.winProbability}%` }} /></div>
                  <div className="paper-entry-form">
                    {profile ? <><label>Stake £<input aria-label="Paper trade stake in pounds" type="number" min="1" max={profile.balance_gbp} step="0.01" value={tradeStake} onChange={(event) => setTradeStake(event.target.value)} /></label><button className="lime-button" disabled={tradeBusy || Number(tradeStake) <= 0 || Number(tradeStake) > profile.balance_gbp} onClick={() => void openPaperTrade()}>{tradeBusy ? <LoaderCircle size={13} className="spin" /> : <TrendingUp size={13} />} Take Paper Trade (£)</button></>
                      : <button className="outline-button paper-login-button" onClick={() => setAuthOpen(true)}>Sign in to paper trade</button>}
                  </div>
                  <p className="risk-copy">{activeAnalysis.riskNote}</p>
                  </>}
                </div> : <div className="trade-content"><p className="loading-note">Ask QuantPulse to create a budget-aware scenario for {symbol}.</p></div>}
              </section>
              <section className="panel">
                <div className="panel-heading"><div className="panel-title"><Newspaper size={14} /> Latest headlines</div><span className="panel-kicker">{news.length ? "LIVE · 5 MAX" : "LIVE FEED"}</span></div>
                <div className="news-list">{news.length ? news.slice(0, 5).map((item, index) => <article className="news-item" key={`${item.url}-${index}`}><a href={item.url} target="_blank" rel="noopener noreferrer">{item.title}</a><div className="news-meta"><span>{item.source}</span><span>·</span><time>{shortTime(item.timestamp)}</time></div></article>) : <div className="empty-news">No live headlines available for this ticker right now.</div>}</div>
              </section>
            </div>
          </div>

          <aside className="panel chat-panel">
            <div className="chat-heading"><div className="bot-icon"><Bot size={17} /></div><div><div className="chat-title">Quant AI assistant</div><div className="chat-status"><span className="source-dot" /> Groq · Llama 3.3 70B · strict confluence</div></div><button className="icon-button" title="AI analysis details" onClick={() => setMessages((items) => [...items, { role: "assistant", text: "I only mark a setup BUY or SELL when RSI, EMA trend, volume and headline sentiment align. If they clash or data is missing, it’s WAIT. Probability is a heuristic, not a proven forecast." }])}><CircleHelp size={14} /></button></div>
            <div className="chat-body">
              {!messages.length && <div className="welcome-card"><strong>Your market co-pilot</strong>Ask for a ticker breakdown or scan the watchlist for technical momentum. I’ll size an illustrative scenario to your £{budget.toLocaleString("en-GB")} budget.</div>}
              {messages.map((message, index) => <div className={`chat-line ${message.role}`} key={`${index}-${message.role}`}><ProfileAvatar avatarUrl={message.role === "user" ? profile?.avatar_url : "pulse:lime"} username={profile?.username} size={24} /><div className={`chat-message ${message.role}`}>{message.text}</div></div>)}
              {loadingAnalysis && <div className="chat-message assistant"><LoaderCircle size={13} className="spin" /> Scanning prices, volume & indicators...</div>}
              <div ref={chatEndRef} />
            </div>
            <div className="prompt-list">{prompts.map((prompt) => <button key={prompt} className="prompt-button" disabled={loadingAnalysis} onClick={() => void runAnalysis(prompt)}>{prompt}</button>)}</div>
            <form className="chat-form" onSubmit={onChatSubmit}><input value={chatText} onChange={(event) => setChatText(event.target.value)} placeholder="Ask about any market..." aria-label="Ask the AI assistant" /><button className="send-button" type="submit" aria-label="Send message" disabled={loadingAnalysis || !chatText.trim()}>{loadingAnalysis ? <LoaderCircle size={15} /> : <Send size={15} />}</button></form>
          </aside>
        </div>
        <div className="footer-note">QuantPulse AI is for educational and research purposes only. Markets involve risk; data can be delayed or simulated. Always verify independently.</div>
      </main>

      {authOpen && <AuthDialog onClose={() => setAuthOpen(false)} onAuthenticated={handleAuthenticated} />}
      {profileOpen && profile && <ProfileDialog profile={profile} token={sessionToken} onClose={() => setProfileOpen(false)} onSaved={setProfile} />}
      {leaderboardOpen && <LeaderboardDialog onClose={() => setLeaderboardOpen(false)} />}
      <button className="planner-bubble" onClick={() => setPlannerOpen(true)} aria-label={`Open Future Trade Planner with ${plans.length} planned trades`}><CalendarClock size={17} /><span>Planner</span>{plans.length > 0 && <b>{plans.length}</b>}</button>
      <PlannerDialog open={plannerOpen} plans={plans} onChange={setPlans} onClose={() => setPlannerOpen(false)} />
      {loadingMarket && <div className="sr-only" aria-live="polite">Loading market data for {symbol}</div>}
      <style jsx global>{`.spin { animation: qp-spin 1s linear infinite; vertical-align: middle; } @keyframes qp-spin { to { transform: rotate(360deg); } } .sr-only { position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0; }`}</style>
    </div>
  );
}
