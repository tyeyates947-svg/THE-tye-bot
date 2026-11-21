"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  Activity, ArrowDownRight, ArrowUpRight, Bell, Bot, CalendarClock, CircleHelp, Clock3, Handshake, LoaderCircle, LockKeyhole,
  Newspaper, Search, Send, Sparkles, Trophy, TrendingUp, Users, X,
} from "lucide-react";
import TradingChart from "@/components/TradingChart";
import AuthDialog from "@/components/AuthDialog";
import LeaderboardDialog from "@/components/LeaderboardDialog";
import PlannerDialog from "@/components/PlannerDialog";
import ProfileAvatar from "@/components/ProfileAvatar";
import ProfileDialog from "@/components/ProfileDialog";
import PublicProfileDialog from "@/components/PublicProfileDialog";
import TradeTimingControls, { selectedDurationMinutes } from "@/components/TradeTimingControls";
import ThemePicker from "@/components/ThemePicker";
import TutorialTour from "@/components/TutorialTour";
import { readApiResponse, withSession } from "@/lib/client-api";
import { ukDateTimeInput, ukDateTimeToIso } from "@/lib/date-time";
import type { AssetType, MarketData, Timeframe } from "@/lib/market";
import type { Profile } from "@/lib/session";
import type { AnalysisMode, AnalysisPayload, FuturePlan, PaperTrade, TradeDuration } from "@/lib/types";

interface NewsItem { title: string; source: string; timestamp: number; url: string }
type Analysis = AnalysisPayload;
interface ChatMessage { role: "user" | "assistant"; text: string; analysis?: Analysis }
interface AppNotification { id: string; message: string; createdAt: number; read: boolean }
interface CopiedTrade {
  symbol: string; asset_type: AssetType; direction: "LONG" | "SHORT"; timeframe: Timeframe; currency: string;
  entry_price: number; take_profit: number; stop_loss: number;
}
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

function localDateTime(timestamp = Date.now() + 60_000): string {
  return ukDateTimeInput(timestamp);
}

function countdownText(target: string | undefined, now: number): string {
  if (!target) return "—";
  const totalSeconds = Math.max(0, Math.floor((new Date(target).getTime() - now) / 1000));
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return days ? `${days}d ${hours}h ${minutes}m` : hours ? `${hours}h ${minutes}m ${seconds}s` : `${minutes}m ${seconds}s`;
}

function savedMessages(profileId: string): ChatMessage[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(`quantpulse-chat:${profileId}`) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is ChatMessage => Boolean(item) && typeof item === "object"
      && ((item as ChatMessage).role === "user" || (item as ChatMessage).role === "assistant")
      && typeof (item as ChatMessage).text === "string");
  } catch {
    localStorage.removeItem(`quantpulse-chat:${profileId}`);
    return [];
  }
}

export default function Dashboard() {
  const [symbol, setSymbol] = useState("NVDA");
  const [assetType, setAssetType] = useState<AssetType>("stock");
  const [timeframe, setTimeframe] = useState<Timeframe>("5m");
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>("hunter");
  const [query, setQuery] = useState("");
  const [searchType, setSearchType] = useState<"auto" | AssetType>("auto");
  const [market, setMarket] = useState<MarketData | null>(null);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [budget, setBudget] = useState(1000);
  const [sessionToken, setSessionToken] = useState("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [paperTrades, setPaperTrades] = useState<PaperTrade[]>([]);
  const [tradeHistory, setTradeHistory] = useState<PaperTrade[]>([]);
  const [tradeStake, setTradeStake] = useState("100");
  const [tradeBusy, setTradeBusy] = useState(false);
  const [tradeError, setTradeError] = useState("");
  const [entryMode, setEntryMode] = useState<"now" | "scheduled">("now");
  const [entryAt, setEntryAt] = useState(localDateTime);
  const [tradeDuration, setTradeDuration] = useState<TradeDuration>("1d");
  const [customDurationMinutes, setCustomDurationMinutes] = useState("30");
  const [now, setNow] = useState(Date.now());
  const [plans, setPlans] = useState<FuturePlan[]>([]);
  const [plansLoaded, setPlansLoaded] = useState(false);
  const [loadingMarket, setLoadingMarket] = useState(false);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  const [error, setError] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatLoaded, setChatLoaded] = useState(false);
  const [chatText, setChatText] = useState("");
  const [authOpen, setAuthOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  const [plannerOpen, setPlannerOpen] = useState(false);
  const [publicProfileUsername, setPublicProfileUsername] = useState("");
  const [theme, setTheme] = useState("emerald");
  const [tourStep, setTourStep] = useState<number | null>(null);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [toasts, setToasts] = useState<AppNotification[]>([]);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const seenUpdatesRef = useRef<Map<string, string>>(new Map());
  const lastUpdateNoticeRef = useRef<Map<string, number>>(new Map());

  const addNotification = useCallback((message: string) => {
    const notification = { id: `${Date.now()}-${Math.random()}`, message, createdAt: Date.now(), read: false };
    setNotifications((items) => [notification, ...items].slice(0, 30));
    setToasts((items) => [notification, ...items].slice(0, 3));
    window.setTimeout(() => setToasts((items) => items.filter((item) => item.id !== notification.id)), 6000);
    if ("Notification" in window && Notification.permission === "granted") new Notification("QuantPulse AI", { body: message, tag: notification.id });
  }, []);

  const refreshPaperTrades = useCallback(async (token: string) => {
    try {
      const response = await fetch("/api/trades", { headers: withSession(token) });
      const result = await readApiResponse<{ trades: PaperTrade[]; history: PaperTrade[]; events: Array<{ id: string; kind: string; message: string }>; profile: Profile; aiCheckError?: string }>(response, "Trade Withs");
      for (const event of result.events) addNotification(event.message);
      for (const trade of result.trades) {
        const previous = seenUpdatesRef.current.get(trade.id);
        const lastNotice = lastUpdateNoticeRef.current.get(trade.id) ?? 0;
        if (previous && trade.ai_update && previous !== trade.ai_update && Date.now() - lastNotice >= 5 * 60_000) {
          addNotification(`AI check-in · ${trade.ai_update}`);
          lastUpdateNoticeRef.current.set(trade.id, Date.now());
        }
        if (trade.ai_update) seenUpdatesRef.current.set(trade.id, trade.ai_update);
      }
      setPaperTrades(result.trades);
      setTradeHistory(result.history);
      setProfile(result.profile);
      setTradeError(result.aiCheckError ?? "");
    } catch (caught) {
      setTradeError(caught instanceof Error ? caught.message : "Could not refresh your Trade Withs.");
    }
  }, [addNotification]);

  const refreshProfile = useCallback(async (token: string) => {
    const response = await fetch("/api/auth/me", { headers: withSession(token) });
    const result = await readApiResponse<{ profile: Profile }>(response, "Profile service");
    setProfile(result.profile);
    setMessages(savedMessages(result.profile.id));
    setChatLoaded(true);
  }, []);

  useEffect(() => {
    const savedTheme = localStorage.getItem("quantpulse-theme");
    if (savedTheme && ["emerald", "blue", "purple", "gold", "crimson", "pink"].includes(savedTheme)) setTheme(savedTheme);
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
    localStorage.setItem("quantpulse-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (plansLoaded) localStorage.setItem("quantpulse-plans", JSON.stringify(plans));
  }, [plans, plansLoaded]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!profile || !chatLoaded) return;
    localStorage.setItem(`quantpulse-chat:${profile.id}`, JSON.stringify(messages));
  }, [chatLoaded, messages, profile]);

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
      const recentHistory = messages.slice(-9).map((message) => ({
        role: message.role,
        content: message.analysis
          ? `${message.text}. Trade setup ${message.analysis.symbol}: ${message.analysis.decision}, entry ${message.analysis.entryPrice}, target ${message.analysis.takeProfit}, stop ${message.analysis.stopLoss}.`
          : message.text,
      }));
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { ...withSession(sessionToken), "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol,
          assetType,
          timeframe: selectedDurationMinutes(tradeDuration, customDurationMinutes) <= 240 ? "5m" : "1d",
          mode: analysisMode,
          budget,
          question,
          durationMinutes: selectedDurationMinutes(tradeDuration, customDurationMinutes),
          entryAt: entryMode === "now" ? new Date().toISOString() : ukDateTimeToIso(entryAt) ?? "",
          chatHistory: recentHistory,
          hasTradeContext: messages.slice(-10).some((message) => Boolean(message.analysis)),
        }),
      });
      const result = await readApiResponse<Analysis & { conversational?: boolean; reply?: string }>(response, "Analysis service");
      if (result.conversational) {
        setMessages((items) => [...items, { role: "assistant", text: result.reply ?? "I couldn't form a grounded reply just now." }]);
        return;
      }
      setAnalysis(result);
      setTradeStake(result.allocationGBP > 0 ? result.allocationGBP.toFixed(2) : "100");
      setMessages((items) => [...items, {
        role: "assistant",
        text: result.scanned ? `Scanner's top match: ${result.symbol} · ${result.decision}` : `${result.symbol} · ${result.decision}`,
        analysis: result,
      }]);
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
  const startNewChat = () => {
    setMessages([]);
    if (profile) localStorage.removeItem(`quantpulse-chat:${profile.id}`);
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

  const changeAnalysisMode = (nextMode: AnalysisMode) => {
    if (nextMode === analysisMode) return;
    setAnalysisMode(nextMode);
    setAnalysis(null);
  };

  const handleBudget = (value: string) => {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      const bounded = Math.min(1_000_000, parsed);
      setBudget(bounded);
      localStorage.setItem("quantpulse-budget", String(bounded));
    }
  };

  const handleAuthenticated = (token: string, value: Profile, isNewAccount: boolean) => {
    localStorage.setItem("quantpulse-session", token);
    setSessionToken(token);
    setProfile(value);
    setMessages(savedMessages(value.id));
    setChatLoaded(true);
    setTradeError("");
    void refreshPaperTrades(token);
    if (isNewAccount) setTourStep(0);
  };

  const signOut = async () => {
    if (sessionToken) await fetch("/api/auth/logout", { method: "POST", headers: withSession(sessionToken) }).catch(() => undefined);
    localStorage.removeItem("quantpulse-session");
    setSessionToken("");
    setProfile(null);
    setPaperTrades([]);
    setMessages([]);
    setChatLoaded(false);
  };

  const openPaperTrade = async (
    setup = activeAnalysis,
    amountGBP = Number(tradeStake),
    timing?: { entryAt: string; durationMinutes: number },
  ) => {
    if (!setup || !profile || !sessionToken || setup.decision === "WAIT") return;
    setTradeBusy(true);
    setTradeError("");
    try {
      const response = await fetch("/api/trades", {
        method: "POST",
        headers: { ...withSession(sessionToken), "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: setup.symbol,
          assetType: setup.assetType,
          direction: setup.direction,
          timeframe: setup.timeframe,
          mode: setup.mode,
          amountGBP,
          entryAt: timing?.entryAt ?? (entryMode === "now" ? new Date().toISOString() : new Date(entryAt).toISOString()),
          durationMinutes: timing?.durationMinutes ?? selectedDurationMinutes(tradeDuration, customDurationMinutes),
          entryPrice: setup.entryPrice,
          takeProfit: setup.takeProfit,
          stopLoss: setup.stopLoss,
        }),
      });
      const result = await readApiResponse<{ profile: Profile }>(response, "Trade With");
      setProfile(result.profile);
      await refreshPaperTrades(sessionToken);
    } catch (caught) {
      setTradeError(caught instanceof Error ? caught.message : "Could not open Trade With.");
    } finally { setTradeBusy(false); }
  };

  const copyTradeWith = async (
    trade: CopiedTrade,
    timing: { entryMode: "now" | "scheduled"; entryAt: string; duration: TradeDuration; customMinutes: string },
  ) => {
    if (!profile || !sessionToken) { setAuthOpen(true); return; }
    setTradeBusy(true);
    setTradeError("");
    try {
      const response = await fetch("/api/trades", {
        method: "POST",
        headers: { ...withSession(sessionToken), "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: trade.symbol,
          assetType: trade.asset_type,
          direction: trade.direction,
          timeframe: selectedDurationMinutes(timing.duration, timing.customMinutes) <= 240 ? "5m" : "1d",
          mode: "hunter",
          amountGBP: Math.min(100, profile.balance_gbp),
          entryAt: timing.entryMode === "now" ? new Date().toISOString() : ukDateTimeToIso(timing.entryAt) ?? "",
          durationMinutes: selectedDurationMinutes(timing.duration, timing.customMinutes),
          entryPrice: trade.entry_price,
          takeProfit: trade.take_profit,
          stopLoss: trade.stop_loss,
        }),
      });
      await readApiResponse<{ profile: Profile }>(response, "Copy Trade With");
      await refreshPaperTrades(sessionToken);
      setPublicProfileUsername("");
      addNotification(`You're now trading with ${trade.symbol}'s setup.`);
    } catch (caught) {
      setTradeError(caught instanceof Error ? caught.message : "Could not copy this Trade With.");
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
      setTradeError(caught instanceof Error ? caught.message : "Could not close Trade With.");
    } finally { setTradeBusy(false); }
  };
  const selectPlannerAsset = useCallback((nextSymbol: string, nextType: AssetType, nextTimeframe: Timeframe) => {
    setTimeframe(nextTimeframe);
    void loadAsset(nextSymbol, nextType, nextTimeframe);
  }, [loadAsset]);
  const usePlannerPlan = useCallback(async (setup: AnalysisPayload, durationMinutes: number) => {
    setEntryMode("now");
    setEntryAt(localDateTime());
    const preset: Record<number, TradeDuration> = { 5: "5m", 15: "15m", 60: "1h", 240: "4h", 1440: "1d", 10080: "1w" };
    const durationPreset = preset[durationMinutes];
    setTradeDuration(durationPreset ?? "custom");
    if (!durationPreset) setCustomDurationMinutes(String(durationMinutes));
    setTradeStake(Math.min(setup.allocationGBP || 100, profile?.balance_gbp ?? budget).toFixed(2));
    setTimeframe(setup.timeframe);
    await loadAsset(setup.symbol, setup.assetType, setup.timeframe);
    setAnalysis(setup);
    if (!profile || !sessionToken) {
      setAuthOpen(true);
      return;
    }
    const amount = Math.min(setup.allocationGBP || 100, profile.balance_gbp);
    await openPaperTrade(setup, amount, { entryAt: new Date().toISOString(), durationMinutes });
  }, [budget, loadAsset, openPaperTrade, profile, sessionToken]);
  const onChatSubmit = (event: FormEvent) => {
    event.preventDefault();
    const question = chatText.trim();
    if (!question || loadingAnalysis) return;
    setChatText("");
    void runAnalysis(question);
  };
  const activeAnalysis = analysis?.symbol === symbol && analysis.assetType === assetType
    && analysis.timeframe === timeframe && analysis.mode === analysisMode ? analysis : null;
  const activeDurationMatches = activeAnalysis?.durationMinutes === selectedDurationMinutes(tradeDuration, customDurationMinutes);
  const stakeScale = activeAnalysis?.allocationGBP ? Math.max(0, Number(tradeStake) || 0) / activeAnalysis.allocationGBP : 0;
  const stakeTargetGBP = (activeAnalysis?.targetProfitGBP ?? 0) * stakeScale;
  const stakeRiskGBP = (activeAnalysis?.maxRiskGBP ?? 0) * stakeScale;

  return (
    <div className="app-shell" data-theme={theme}>
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark"><Activity size={19} strokeWidth={2.5} /></div>
          <div><div className="brand-name">QuantPulse AI</div><div className="brand-sub">MARKET INTELLIGENCE</div></div>
        </div>
        <div className="top-actions">
          <label className="budget-box" data-tour="budget"><span>Budget</span><span>£</span><input aria-label="Trading budget in pounds" type="number" min="1" max="1000000" value={budget} onChange={(event) => handleBudget(event.target.value)} /></label>
          <ThemePicker value={theme} onChange={setTheme} />
          <button className="icon-button notification-button" title="Notifications (click to enable browser alerts)" aria-label={`Notifications, ${notifications.filter((item) => !item.read).length} unread`} onClick={() => {
            setNotificationOpen((open) => !open);
            setNotifications((items) => items.map((item) => ({ ...item, read: true })));
            if ("Notification" in window && Notification.permission === "default") void Notification.requestPermission();
          }}><Bell size={15} />{notifications.some((item) => !item.read) && <span className="notification-badge">{notifications.filter((item) => !item.read).length}</span>}</button>
          <button className="outline-button friends-button" data-tour="friends" onClick={() => setLeaderboardOpen(true)}><Users size={14} /><span>Friends</span></button>
          {profile
            ? <div className="account-controls"><button className="profile-badge" onClick={() => setProfileOpen(true)} aria-label={`Edit @${profile.username} profile`}><ProfileAvatar avatarUrl={profile.avatar_url} username={profile.username} size={29} /><span>@{profile.username}</span><b>£{profile.balance_gbp.toFixed(2)}</b></button><button className="outline-button sign-out-button" onClick={() => void signOut()} title="Sign out"><LockKeyhole size={14} /></button></div>
            : <button className="outline-button" onClick={() => setAuthOpen(true)}><LockKeyhole size={14} /> <span>Sign in</span></button>}
          <button className="outline-button replay-tour-header" onClick={() => setTourStep(0)}><CircleHelp size={13} /><span>Replay Tour</span></button>
        </div>
      </header>
      {notificationOpen && <section className="notification-panel" aria-label="Recent notifications">
        <div className="notification-panel-head"><strong>Notifications</strong><button className="icon-button" onClick={() => setNotificationOpen(false)} aria-label="Close notifications"><X size={13} /></button></div>
        {!notifications.length && <p className="notification-empty">Your live Trade With updates will appear here.</p>}
        {notifications.slice(0, 8).map((item) => <div className="notification-item" key={item.id}><span>{item.message}</span><time>{new Date(item.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</time></div>)}
      </section>}

      <main className="main-content">
        <div className="hero-row">
          <div>
            <div className="eyebrow">Quant dashboard <span style={{ color: "#667064" }}> / </span> Live markets</div>
            <h1 className="page-title">Find your next market edge.</h1>
            <p className="page-description">Market data and technical scenarios for research—not financial advice.</p>
          </div>
          <form className="search-area" data-tour="search" onSubmit={submitSearch}>
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
          <div className="signal-controls">
            <div className="time-toggle" role="group" aria-label="Chart timeframe">
              <button className={timeframe === "5m" ? "active" : ""} onClick={() => changeTimeframe("5m")}><Clock3 size={12} style={{ verticalAlign: "middle", marginRight: 5 }} />5m Scalp</button>
              <button className={timeframe === "1d" ? "active" : ""} onClick={() => changeTimeframe("1d")}><TrendingUp size={12} style={{ verticalAlign: "middle", marginRight: 5 }} />1D Long-term</button>
            </div>
            <div className="mode-toggle" role="group" aria-label="Signal mode">
              <button className={analysisMode === "hunter" ? "active" : ""} aria-pressed={analysisMode === "hunter"} onClick={() => changeAnalysisMode("hunter")}>High-Profit Hunter</button>
              <button className={analysisMode === "sniper" ? "active" : ""} aria-pressed={analysisMode === "sniper"} onClick={() => changeAnalysisMode("sniper")}>Strict Sniper</button>
            </div>
          </div>
        </div>

        {error && <div className="error-banner" role="alert">{error}</div>}
        {profile && <section className="panel paper-trades-panel" data-tour="live">
          <div className="paper-trades-head">
            <div><div className="panel-title"><Handshake size={14} /> Active Trade Withs <span className="paper-count">{paperTrades.length}</span></div><div className="paper-balance">Available £{profile.balance_gbp.toFixed(2)} <span>·</span> All-time P&L <strong className={profile.total_profit_gbp >= 0 ? "positive" : "negative"}>{profile.total_profit_gbp >= 0 ? "+" : ""}£{profile.total_profit_gbp.toFixed(2)}</strong> <span>·</span> {profile.wins}W / {profile.losses}L</div></div>
            <button className="outline-button friends-inline" onClick={() => setLeaderboardOpen(true)}><Trophy size={13} /> Leaderboard</button>
          </div>
          {tradeError && <div className="trade-error">{tradeError}</div>}
          <div className="paper-trade-list">
            {paperTrades.map((trade) => <article className="paper-trade-row" key={trade.id}>
              <span className={`trade-side ${trade.direction.toLowerCase()}`}>{trade.direction}</span>
              <strong>{trade.symbol}</strong>
              {trade.status === "scheduled"
                ? <span className="trade-countdown">Entry in {countdownText(trade.entry_at, now)}</span>
                : <><span>Entry {currency(trade.entry_price, trade.currency)}</span><span>Now {currency(trade.mark_price, trade.currency)}{trade.is_fallback ? " · est." : ""}</span></>}
              <strong className={trade.unrealized_pnl_gbp >= 0 ? "positive" : "negative"}>{trade.unrealized_pnl_gbp >= 0 ? "+" : ""}£{trade.unrealized_pnl_gbp.toFixed(2)}</strong>
              <span className="trade-countdown">{trade.status === "scheduled" ? "Scheduled" : `Time left ${countdownText(trade.expires_at, now)}`}</span>
              <button className="close-trade-button" disabled={tradeBusy} onClick={() => void closePaperTrade(trade.id)}>{trade.status === "scheduled" ? "Cancel entry" : "Close trade"}</button>
              {trade.ai_update && <span className="trade-ai-update">{trade.ai_update}</span>}
              <span className="trade-progress" aria-label={`${trade.progress_pct ?? 0}% progress toward target`}><i style={{ width: `${trade.progress_pct ?? 0}%` }} /></span>
            </article>)}
            {!paperTrades.length && <div className="paper-empty">No active Trade Withs yet. Run an AI scan and follow a setup to see live updates here.</div>}
          </div>
        </section>}
        <div className="dashboard-grid">
          <div className="left-stack">
            <section className="panel market-panel">
              <div className="asset-header">
                <div className="asset-info">
                  <div className="asset-icon">{assetType === "crypto" ? "₿" : symbol.slice(0, 2)}</div>
                  <div><div className="asset-symbol">{symbol} <span style={{ color: "#778078", fontSize: 10, fontWeight: 450 }}>{assetType === "crypto" ? "CRYPTO" : "EQUITY"}</span></div>
                    <div className="asset-name"><span className="source-dot" style={{ background: market?.isFallback ? "#e5aa54" : "var(--lime)" }} /> {market?.source ?? "Loading market data"} {market?.isFallback ? "· estimated" : "· live feed"}</div></div>
                </div>
                <div className="price-area">
                  <div className="asset-price">{market ? currency(market.price, market.currency) : "—"}</div>
                  <div className={`price-change ${(market?.changePct ?? 0) >= 0 ? "positive" : "negative"}`}>{market ? <>{market.changePct >= 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />} {market.changePct >= 0 ? "+" : ""}{market.changePct.toFixed(2)}%</> : "Waiting for data"}</div>
                </div>
              </div>
              <div className="chart-wrap">
                <div className="chart-meta">
                  <span>{timeframe === "5m" ? "5-minute candles · 5-day window" : "Daily candles · 2-year window"}</span>
                  <div className="legend"><span style={{ color: "#d9deda" }}><i /> Entry</span><span style={{ color: "var(--lime)" }}><i /> Target</span><span style={{ color: "#fa7268" }}><i /> Stop</span></div>
                </div>
                {market ? <TradingChart candles={market.candles} entry={activeAnalysis?.decision !== "WAIT" ? activeAnalysis?.entryPrice : undefined} takeProfit={activeAnalysis?.decision !== "WAIT" ? activeAnalysis?.takeProfit : undefined} stopLoss={activeAnalysis?.decision !== "WAIT" ? activeAnalysis?.stopLoss : undefined} theme={theme} /> : <div className="chart-canvas" style={{ display: "grid", placeItems: "center" }}><span className="loading-note">{loadingMarket ? "Loading candles..." : "Search a market to begin"}</span></div>}
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
                  {activeAnalysis.decision === "WAIT" ? <div className="wait-card"><strong>WAIT · no qualified setup</strong><span>{activeAnalysis.rationale}</span></div> : <>
                  <p className="signal-rationale">{activeAnalysis.rationale}</p>
                  <div className="trade-stat-row">
                    <div className="trade-stat"><label>Est. target at stake</label><strong className="positive">+£{stakeTargetGBP.toFixed(2)}</strong></div>
                    <div className="trade-stat"><label>Max risk at stake</label><strong className="negative">−£{stakeRiskGBP.toFixed(2)}</strong></div>
                    <div className="trade-stat"><label>Allocation · {activeAnalysis.leverage}</label><strong>£{activeAnalysis.allocationGBP.toFixed(2)}</strong></div>
                  </div>
                  <div className="confidence-row"><span>Estimated win probability · heuristic</span><strong>{activeAnalysis.winProbability}%</strong></div>
                  <div className="progress-track"><div className="progress-fill" style={{ width: `${activeAnalysis.winProbability}%` }} /></div>
                  <TradeTimingControls
                    entryMode={entryMode}
                    entryAt={entryAt}
                    duration={tradeDuration}
                    customMinutes={customDurationMinutes}
                    onEntryModeChange={setEntryMode}
                    onEntryAtChange={setEntryAt}
                    onDurationChange={setTradeDuration}
                    onCustomMinutesChange={setCustomDurationMinutes}
                  />
                  <div className="paper-entry-form">
                    {profile ? <><label>Stake £<input aria-label="Trade With stake in pounds" type="number" min="1" max={profile.balance_gbp} step="0.01" value={tradeStake} onChange={(event) => setTradeStake(event.target.value)} /></label><button className="lime-button" disabled={tradeBusy || Number(tradeStake) <= 0 || Number(tradeStake) > profile.balance_gbp || entryMode === "scheduled" && (!ukDateTimeToIso(entryAt) || new Date(ukDateTimeToIso(entryAt)!).getTime() <= Date.now())} onClick={() => {
                      if (!activeDurationMatches) {
                        const prompt = `${symbol} ${selectedDurationMinutes(tradeDuration, customDurationMinutes) <= 240 ? "5m scalp" : "swing"} setup`;
                        void runAnalysis(prompt);
                        return;
                      }
                      void openPaperTrade();
                    }}>{tradeBusy ? <LoaderCircle size={13} className="spin" /> : <Handshake size={13} />} {!activeDurationMatches ? "Refresh AI for duration" : entryMode === "scheduled" ? "Schedule Trade With" : "🤝 Trade With This"}</button></>
                      : <button className="outline-button paper-login-button" onClick={() => setAuthOpen(true)}>Sign in to Trade With This</button>}
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

          <aside className="panel chat-panel" data-tour="trade-card">
            <div className="chat-heading"><div className="bot-icon"><Bot size={17} /></div><div><div className="chat-title">Quant AI assistant</div><div className="chat-status"><span className="source-dot" /> Groq · GPT OSS · {analysisMode === "hunter" ? "2-of-4 Hunter" : "Strict Sniper"}</div></div><button className="outline-button new-chat-button" onClick={startNewChat}>New Chat</button><button className="icon-button" title="AI analysis details" onClick={() => setMessages((items) => [...items, { role: "assistant", text: analysisMode === "hunter" ? "High-Profit Hunter looks for two or more of four directional signals: EMA trend, RSI momentum, volume with candle direction, and news. It waits on flat markets, conflicting signals, or simulated data. Setups target 1:3 risk/reward; verify independently." : "Strict Sniper needs at least three aligned signals including the full EMA trend, with no opposing confirmations. It waits on flat markets, conflicting signals, or simulated data. Setups target 1:3 risk/reward; verify independently." }])}><CircleHelp size={14} /></button></div>
            <div className="chat-body">
              {!messages.length && <div className="welcome-card"><strong>Your market co-pilot</strong>Ask for a ticker breakdown or scan the watchlist for technical momentum. I’ll size an illustrative scenario to your £{budget.toLocaleString("en-GB")} budget.</div>}
              {messages.map((message, index) => <div className={`chat-line ${message.role}`} key={`${index}-${message.role}`}><ProfileAvatar avatarUrl={message.role === "user" ? profile?.avatar_url : "pulse:lime"} username={profile?.username} size={24} />{message.analysis && message.analysis.commentary
                ? <div className="trade-card">
                  <div className="trade-card-heading"><strong>{message.analysis.commentary.hook}</strong><span className={`panel-kicker ${message.analysis.decision === "WAIT" ? "negative" : ""}`}>{message.analysis.symbol} · {message.analysis.decision}</span></div>
                  <ul className="trade-card-bullets">
                    <li><b>Chart setup</b><span>{message.analysis.commentary.chartSetup}</span></li>
                    <li><b>Live news</b><span>{message.analysis.commentary.newsCatalyst}</span></li>
                    <li><b>Risk note</b><span>{message.analysis.commentary.riskNote}</span></li>
                  </ul>
                  {message.analysis.decision !== "WAIT" && <div className="trade-card-pills">
                    <span><small>Entry</small>{currency(message.analysis.entryPrice, message.analysis.market.currency)}</span>
                    <span><small>Target</small>{currency(message.analysis.takeProfit, message.analysis.market.currency)}</span>
                    <span><small>Stop Loss</small>{currency(message.analysis.stopLoss, message.analysis.market.currency)}</span>
                    <span><small>Est. Win %</small>{message.analysis.winProbability}%</span>
                    <span><small>Projected £ Profit</small>+£{message.analysis.targetProfitGBP.toFixed(2)}</span>
                  </div>}
                  {message.analysis.decision !== "WAIT" && <TradeTimingControls
                    entryMode={entryMode}
                    entryAt={entryAt}
                    duration={tradeDuration}
                    customMinutes={customDurationMinutes}
                    onEntryModeChange={setEntryMode}
                    onEntryAtChange={setEntryAt}
                    onDurationChange={setTradeDuration}
                    onCustomMinutesChange={setCustomDurationMinutes}
                  />}
                  {message.analysis.decision !== "WAIT" && <button className="lime-button trade-card-action" disabled={tradeBusy || entryMode === "scheduled" && (!ukDateTimeToIso(entryAt) || new Date(ukDateTimeToIso(entryAt)!).getTime() <= Date.now())} onClick={() => {
                    if (message.analysis?.durationMinutes !== selectedDurationMinutes(tradeDuration, customDurationMinutes)) {
                      const ticker = message.analysis?.symbol ?? symbol;
                      void runAnalysis(`${ticker} ${selectedDurationMinutes(tradeDuration, customDurationMinutes) <= 240 ? "5m scalp" : "swing"} setup`);
                      return;
                    }
                    if (!profile) { setAuthOpen(true); return; }
                    const setup = message.analysis;
                    if (!setup) return;
                    const amount = Math.min(setup.allocationGBP, profile.balance_gbp);
                    setTradeStake(amount.toFixed(2));
                    void openPaperTrade(setup, amount);
                  }}>{tradeBusy ? <LoaderCircle size={13} className="spin" /> : <Handshake size={14} />} {message.analysis.durationMinutes !== selectedDurationMinutes(tradeDuration, customDurationMinutes) ? "Refresh AI for duration" : entryMode === "scheduled" ? "Schedule Trade With This" : "🤝 Trade With This"}</button>}
                </div>
                : <div className={`chat-message ${message.role}`}>{message.text}</div>}</div>)}
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
      {profileOpen && profile && <ProfileDialog profile={profile} token={sessionToken} activeTrades={paperTrades} history={tradeHistory} theme={theme} onThemeChange={setTheme} onReplayTour={() => setTourStep(0)} onClose={() => setProfileOpen(false)} onSaved={setProfile} />}
      {leaderboardOpen && <LeaderboardDialog onClose={() => setLeaderboardOpen(false)} onSelectTrader={(username) => { setLeaderboardOpen(false); setPublicProfileUsername(username); }} />}
      {publicProfileUsername && <PublicProfileDialog username={publicProfileUsername} signedIn={Boolean(profile && sessionToken)} onClose={() => setPublicProfileUsername("")} onSignIn={() => { setPublicProfileUsername(""); setAuthOpen(true); }} onTradeWith={(trade, timing) => void copyTradeWith(trade, timing)} />}
      <button className="planner-bubble" onClick={() => setPlannerOpen(true)} aria-label={`Open Future Trade Planner with ${plans.length} planned trades`}><CalendarClock size={17} /><span>Planner</span>{plans.length > 0 && <b>{plans.length}</b>}</button>
      <PlannerDialog
        open={plannerOpen}
        plans={plans}
        onChange={setPlans}
        budget={profile?.balance_gbp ?? budget}
        token={sessionToken}
        onSelectAsset={selectPlannerAsset}
        onUsePlan={(setup, durationMinutes) => { void usePlannerPlan(setup, durationMinutes); setPlannerOpen(false); }}
        onClose={() => setPlannerOpen(false)}
      />
      {tourStep !== null && <TutorialTour step={tourStep} onStep={setTourStep} onClose={() => setTourStep(null)} />}
      {!!toasts.length && <div className="toast-stack" aria-live="polite">{toasts.map((toast) => <div className="trade-toast" key={toast.id}><Bell size={14} /><span>{toast.message}</span><button aria-label="Dismiss notification" onClick={() => setToasts((items) => items.filter((item) => item.id !== toast.id))}><X size={13} /></button></div>)}</div>}
      {loadingMarket && <div className="sr-only" aria-live="polite">Loading market data for {symbol}</div>}
      <style jsx global>{`.spin { animation: qp-spin 1s linear infinite; vertical-align: middle; } @keyframes qp-spin { to { transform: rotate(360deg); } } .sr-only { position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0; }`}</style>
    </div>
  );
}
