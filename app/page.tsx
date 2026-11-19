"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  Activity, ArrowDownRight, ArrowUpRight, Bot, Check, CircleHelp, Clock3, LoaderCircle,
  LockKeyhole, LogIn, LogOut, Newspaper, Search, Send, Sparkles, TrendingUp, X,
} from "lucide-react";
import TradingChart from "@/components/TradingChart";
import type { AssetType, MarketData, Timeframe } from "@/lib/market";
import { getSupabaseClient } from "@/lib/supabase";

interface NewsItem { title: string; source: string; timestamp: number; url: string }
interface Analysis {
  symbol: string; assetType: AssetType; timeframe: Timeframe; direction: "LONG" | "SHORT";
  entryPrice: number; takeProfit: number; stopLoss: number; winProbability: number;
  targetProfitGBP: number; maxRiskGBP: number; allocationGBP: number; leverage: string;
  rationale: string; riskNote: string; market: MarketData; scanned?: boolean;
}
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
  const [loadingMarket, setLoadingMarket] = useState(false);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  const [error, setError] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatText, setChatText] = useState("");
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"signIn" | "signUp">("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const savedBudget = Number(localStorage.getItem("quantpulse-budget"));
    if (savedBudget > 0) setBudget(savedBudget);
    const supabase = getSupabaseClient();
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => setUserEmail(data.session?.user.email ?? ""));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => setUserEmail(session?.user.email ?? ""));
    return () => listener.subscription.unsubscribe();
  }, []);

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
      const marketPayload = await marketResponse.json() as MarketData | { error?: string };
      if (!marketResponse.ok || !("candles" in marketPayload)) throw new Error("error" in marketPayload ? marketPayload.error : "Market data could not be loaded.");
      const newsPayload = await newsResponse.json() as { items?: NewsItem[] };
      setMarket(marketPayload);
      setNews(newsPayload.items ?? []);
      setAnalysis((previous) => previous?.symbol === nextSymbol && previous.timeframe === nextTimeframe ? previous : null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Market data could not be loaded.");
    } finally { setLoadingMarket(false); }
  }, [timeframe]);

  useEffect(() => { void loadAsset("NVDA", "stock", "5m"); }, []);

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
      const result = await response.json() as Analysis & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Analysis could not be completed.");
      setAnalysis(result);
      setMessages((items) => [...items, { role: "assistant", text: `${result.scanned ? `Scanner pick: ${result.symbol}. ` : `${result.symbol} ${result.direction} idea. `}${result.rationale}\n\nEntry ${currency(result.entryPrice, result.market.currency)} · Target ${currency(result.takeProfit, result.market.currency)} · Stop ${currency(result.stopLoss, result.market.currency)}\nIllustrative target +£${result.targetProfitGBP.toFixed(2)} / max risk £${result.maxRiskGBP.toFixed(2)}. ${result.riskNote}` }]);
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
      setBudget(parsed);
      localStorage.setItem("quantpulse-budget", String(parsed));
    }
  };

  const handleAuth = async (event: FormEvent) => {
    event.preventDefault();
    setAuthError("");
    const supabase = getSupabaseClient();
    if (!supabase) { setAuthError("Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to enable account access."); return; }
    setAuthBusy(true);
    const result = authMode === "signUp"
      ? await supabase.auth.signUp({ email, password })
      : await supabase.auth.signInWithPassword({ email, password });
    if (result.error) setAuthError(result.error.message);
    else if (authMode === "signUp" && !result.data.session) setAuthError("Check your email to confirm your new account.");
    else { setUserEmail(result.data.user?.email ?? email); setAuthOpen(false); }
    setAuthBusy(false);
  };

  const signOut = async () => { await getSupabaseClient()?.auth.signOut(); setUserEmail(""); };
  const onChatSubmit = (event: FormEvent) => {
    event.preventDefault();
    const question = chatText.trim();
    if (!question || loadingAnalysis) return;
    setChatText("");
    void runAnalysis(question);
  };
  const activeAnalysis = analysis?.symbol === symbol && analysis.timeframe === timeframe ? analysis : null;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark"><Activity size={19} strokeWidth={2.5} /></div>
          <div><div className="brand-name">QuantPulse AI</div><div className="brand-sub">MARKET INTELLIGENCE</div></div>
        </div>
        <div className="top-actions">
          <label className="budget-box"><span>Budget</span><span>£</span><input aria-label="Trading budget in pounds" type="number" min="1" value={budget} onChange={(event) => handleBudget(event.target.value)} /></label>
          {userEmail
            ? <button className="outline-button" onClick={() => void signOut()} title={`Signed in as ${userEmail}`}><LogOut size={14} /> <span>Sign out</span></button>
            : <button className="outline-button" onClick={() => { setAuthOpen(true); setAuthError(""); }}><LockKeyhole size={14} /> <span>Sign in</span></button>}
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
                {market ? <TradingChart candles={market.candles} entry={activeAnalysis?.entryPrice} takeProfit={activeAnalysis?.takeProfit} stopLoss={activeAnalysis?.stopLoss} /> : <div className="chart-canvas" style={{ display: "grid", placeItems: "center" }}><span className="loading-note">{loadingMarket ? "Loading candles..." : "Search a market to begin"}</span></div>}
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
                <div className="panel-heading"><div className="panel-title"><Sparkles size={14} /> Trade scenario</div><span className="panel-kicker">{activeAnalysis ? activeAnalysis.direction : "Awaiting analysis"}</span></div>
                {activeAnalysis ? <div className="trade-content">
                  <div className="trade-stat-row">
                    <div className="trade-stat"><label>Est. target profit</label><strong className="positive">+£{activeAnalysis.targetProfitGBP.toFixed(2)}</strong></div>
                    <div className="trade-stat"><label>Max risk</label><strong className="negative">−£{activeAnalysis.maxRiskGBP.toFixed(2)}</strong></div>
                    <div className="trade-stat"><label>Allocation · {activeAnalysis.leverage}</label><strong>£{activeAnalysis.allocationGBP.toFixed(2)}</strong></div>
                  </div>
                  <div className="confidence-row"><span>Heuristic scenario score</span><strong>{activeAnalysis.winProbability}%</strong></div>
                  <div className="progress-track"><div className="progress-fill" style={{ width: `${activeAnalysis.winProbability}%` }} /></div>
                  <p className="risk-copy">{activeAnalysis.riskNote}</p>
                </div> : <div className="trade-content"><p className="loading-note">Ask QuantPulse to create a budget-aware scenario for {symbol}.</p></div>}
              </section>
              <section className="panel">
                <div className="panel-heading"><div className="panel-title"><Newspaper size={14} /> Latest headlines</div><span className="panel-kicker">{news.length ? "LIVE · 5 MAX" : "LIVE FEED"}</span></div>
                <div className="news-list">{news.length ? news.slice(0, 5).map((item, index) => <article className="news-item" key={`${item.url}-${index}`}><a href={item.url} target="_blank" rel="noopener noreferrer">{item.title}</a><div className="news-meta"><span>{item.source}</span><span>·</span><time>{shortTime(item.timestamp)}</time></div></article>) : <div className="empty-news">No live headlines available for this ticker right now.</div>}</div>
              </section>
            </div>
          </div>

          <aside className="panel chat-panel">
            <div className="chat-heading"><div className="bot-icon"><Bot size={17} /></div><div><div className="chat-title">Quant AI assistant</div><div className="chat-status"><span className="source-dot" /> {process.env.NEXT_PUBLIC_GROQ_ENABLED === "true" ? "Groq · Llama 3.3 70B" : "Quant engine · Groq optional"}</div></div><button className="icon-button" title="AI analysis details" onClick={() => setMessages((items) => [...items, { role: "assistant", text: "The scenario uses locally calculated indicators and a 1 ATR stop / 3 ATR target. Win probability is a heuristic score, not a statistically validated forecast." }])}><CircleHelp size={14} /></button></div>
            <div className="chat-body">
              {!messages.length && <div className="welcome-card"><strong>Your market co-pilot</strong>Ask for a ticker breakdown or scan the watchlist for technical momentum. I’ll size an illustrative scenario to your £{budget.toLocaleString("en-GB")} budget.</div>}
              {messages.map((message, index) => <div key={`${index}-${message.role}`} className={`chat-message ${message.role}`}>{message.text}</div>)}
              {loadingAnalysis && <div className="chat-message assistant"><LoaderCircle size={13} className="spin" /> Scanning prices, volume & indicators...</div>}
              <div ref={chatEndRef} />
            </div>
            <div className="prompt-list">{prompts.map((prompt) => <button key={prompt} className="prompt-button" disabled={loadingAnalysis} onClick={() => void runAnalysis(prompt)}>{prompt}</button>)}</div>
            <form className="chat-form" onSubmit={onChatSubmit}><input value={chatText} onChange={(event) => setChatText(event.target.value)} placeholder="Ask about any market..." aria-label="Ask the AI assistant" /><button className="send-button" type="submit" aria-label="Send message" disabled={loadingAnalysis || !chatText.trim()}>{loadingAnalysis ? <LoaderCircle size={15} /> : <Send size={15} />}</button></form>
          </aside>
        </div>
        <div className="footer-note">QuantPulse AI is for educational and research purposes only. Markets involve risk; data can be delayed or simulated. Always verify independently.</div>
      </main>

      {authOpen && <div className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title" onClick={(event) => { if (event.target === event.currentTarget) setAuthOpen(false); }}>
        <form className="auth-card" onSubmit={(event) => void handleAuth(event)}>
          <div className="auth-header"><div><h2 id="auth-title">{authMode === "signIn" ? "Welcome back" : "Create your account"}</h2><p>Sign in to your QuantPulse workspace.</p></div><button type="button" className="icon-button" aria-label="Close dialog" onClick={() => setAuthOpen(false)}><X size={15} /></button></div>
          <div className="auth-fields"><input type="email" autoComplete="email" required placeholder="Email address" value={email} onChange={(event) => setEmail(event.target.value)} /><input type="password" autoComplete={authMode === "signIn" ? "current-password" : "new-password"} required minLength={6} placeholder="Password (at least 6 characters)" value={password} onChange={(event) => setPassword(event.target.value)} /></div>
          <div className="auth-actions"><button className="lime-button" disabled={authBusy}>{authBusy ? <LoaderCircle size={14} /> : authMode === "signIn" ? <LogIn size={14} /> : <Check size={14} />}{authMode === "signIn" ? "Sign in" : "Create account"}</button><button type="button" className="auth-toggle" onClick={() => { setAuthMode(authMode === "signIn" ? "signUp" : "signIn"); setAuthError(""); }}>{authMode === "signIn" ? "New here? Create an account" : "Already have an account? Sign in"}</button></div>
          {authError && <div className="auth-feedback" role="alert">{authError}</div>}
        </form>
      </div>}
      {loadingMarket && <div className="sr-only" aria-live="polite">Loading market data for {symbol}</div>}
      <style jsx global>{`.spin { animation: qp-spin 1s linear infinite; vertical-align: middle; } @keyframes qp-spin { to { transform: rotate(360deg); } } .sr-only { position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0; }`}</style>
    </div>
  );
}
