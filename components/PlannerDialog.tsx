"use client";

import { FormEvent, useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { CalendarClock, Clock3, LoaderCircle, RefreshCw, Trash2, X } from "lucide-react";
import { readApiResponse } from "@/lib/client-api";
import type { AssetType, Timeframe } from "@/lib/market";
import type { AnalysisPayload, FuturePlan } from "@/lib/types";

interface PlannerDialogProps {
  open: boolean;
  plans: FuturePlan[];
  onChange: Dispatch<SetStateAction<FuturePlan[]>>;
  onClose: () => void;
}

function countdown(dueAt: string, now: number): string {
  const delta = Math.max(0, new Date(dueAt).getTime() - now);
  const days = Math.floor(delta / 86_400_000);
  const hours = Math.floor((delta % 86_400_000) / 3_600_000);
  const minutes = Math.floor((delta % 3_600_000) / 60_000);
  const seconds = Math.floor((delta % 60_000) / 1000);
  return days ? `${days}d ${hours}h ${minutes}m` : hours ? `${hours}h ${minutes}m ${seconds}s` : `${minutes}m ${seconds}s`;
}

function nextHour(): string {
  const value = new Date(Date.now() + 60 * 60 * 1000);
  value.setMinutes(value.getMinutes() - value.getTimezoneOffset());
  return value.toISOString().slice(0, 16);
}

function priceText(value: number, currency: string): string {
  const code = currency === "GBp" ? "GBP" : currency === "USDT" ? "USD" : currency;
  const amount = currency === "GBp" ? value / 100 : value;
  try { return new Intl.NumberFormat("en-GB", { style: "currency", currency: code, maximumFractionDigits: amount < 1 ? 5 : 2 }).format(amount); }
  catch { return `${code} ${amount.toFixed(2)}`; }
}

function refreshPeriod(dueAt: string): number {
  const remaining = new Date(dueAt).getTime() - Date.now();
  if (remaining <= 0) return Number.POSITIVE_INFINITY;
  return remaining < 60 * 60 * 1000 ? 10_000
    : remaining < 24 * 60 * 60 * 1000 ? 5 * 60 * 1000 : 60 * 60 * 1000;
}

export default function PlannerDialog({ open, plans, onChange, onClose }: PlannerDialogProps) {
  const [title, setTitle] = useState("");
  const [symbol, setSymbol] = useState("");
  const [assetType, setAssetType] = useState<AssetType>("stock");
  const [timeframe, setTimeframe] = useState<Timeframe>("1d");
  const [budget, setBudget] = useState("250");
  const [dueAt, setDueAt] = useState(nextHour);
  const [now, setNow] = useState(Date.now());
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const runningRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [open]);

  const refreshPlans = useCallback(async (force = false) => {
    if (runningRef.current || !plans.length) return;
    const nowTime = Date.now();
    const targets = plans.filter((plan) => force || !plan.updatedAt
      || nowTime - new Date(plan.updatedAt).getTime() >= refreshPeriod(plan.dueAt));
    if (!targets.length) return;
    runningRef.current = true;
    setRefreshing(true);
    setError("");
    const updated = await Promise.all(targets.map(async (plan) => {
      try {
        const response = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            symbol: plan.symbol,
            assetType: plan.assetType,
            timeframe: plan.timeframe,
            budget: plan.budget,
            question: `Refresh the scheduled single-ticker plan for ${plan.symbol}.`,
          }),
        });
        const result = await readApiResponse<AnalysisPayload>(response, "Planner analysis");
        return { ...plan, analysis: result, updatedAt: new Date().toISOString(), refreshError: undefined };
      } catch (caught) {
        return { ...plan, updatedAt: new Date().toISOString(), refreshError: caught instanceof Error ? caught.message : "Could not refresh this plan." };
      }
    }));
    const updates = new Map(updated.map((plan) => [plan.id, plan]));
    onChange((previous) => previous.map((plan) => updates.get(plan.id) ?? plan));
    if (updated.some((plan) => plan.refreshError)) setError("One or more plans could not refresh. Check the message on each plan.");
    setRefreshing(false);
    runningRef.current = false;
  }, [onChange, plans]);

  const refreshInterval = plans.reduce((nearest, plan) => Math.min(nearest, refreshPeriod(plan.dueAt)), Number.POSITIVE_INFINITY);

  useEffect(() => {
    if (!open || !plans.length) return;
    if (!Number.isFinite(refreshInterval)) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshPlans(false);
    }, refreshInterval);
    return () => window.clearInterval(timer);
  }, [open, refreshInterval, refreshPlans, plans.length]);

  const addPlan = (event: FormEvent) => {
    event.preventDefault();
    const normalized = symbol.trim().toUpperCase().replace(/[^A-Z0-9.^=-]/g, "");
    const amount = Number(budget);
    if (!normalized || !Number.isFinite(amount) || amount <= 0 || amount > 1_000_000 || new Date(dueAt).getTime() <= Date.now()) {
      setError("Add a ticker, budget between £1 and £1,000,000, and a future date/time.");
      return;
    }
    const newPlan: FuturePlan = {
      id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      title: title.trim() || `${normalized} setup`,
      symbol: normalized,
      assetType,
      timeframe,
      budget: amount,
      dueAt: new Date(dueAt).toISOString(),
    };
    onChange((previous) => [newPlan, ...previous]);
    setTitle("");
    setSymbol("");
    setError("");
  };

  if (!open) return null;

  return (
    <div className="planner-overlay" role="dialog" aria-modal="true" aria-labelledby="planner-title" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="planner-drawer">
        <div className="planner-header">
          <div className="planner-heading-icon"><CalendarClock size={18} /></div>
          <div className="planner-heading-copy"><h2 id="planner-title">Future trade planner</h2><p>Scheduled setups refresh with live prices, news and AI context.</p></div>
          <button className="icon-button" onClick={onClose} aria-label="Close planner"><X size={15} /></button>
        </div>
        <div className="planner-toolbar"><span>{plans.length} planned {plans.length === 1 ? "event" : "events"}</span><button className="outline-button" disabled={refreshing || !plans.length} onClick={() => void refreshPlans(true)}><RefreshCw size={13} className={refreshing ? "spin" : ""} /> Refresh Plan Now</button></div>
        {error && <div className="error-banner planner-error">{error}</div>}
        <div className="planner-list">
          {plans.map((plan) => (
            <article className="planner-item" key={plan.id}>
              <div className="planner-item-top"><div><strong>{plan.title}</strong><span>{plan.symbol} · {plan.assetType} · {plan.timeframe} · £{plan.budget.toFixed(2)}</span></div><button className="planner-remove" onClick={() => onChange((previous) => previous.filter((item) => item.id !== plan.id))} aria-label={`Remove ${plan.title}`}><Trash2 size={14} /></button></div>
              <div className="planner-countdown"><Clock3 size={13} />{countdown(plan.dueAt, now)} <span>until scheduled time</span></div>
              {plan.analysis && <div className="planner-analysis"><div className={`planner-decision ${plan.analysis.decision.toLowerCase()}`}>{plan.analysis.decision}</div><span>Live {priceText(plan.analysis.market.price, plan.analysis.market.currency)}{plan.analysis.decision === "WAIT" ? " · no trade levels" : ` · Entry ${plan.analysis.entryPrice} · TP ${plan.analysis.takeProfit} · SL ${plan.analysis.stopLoss}`}</span><p>{plan.analysis.rationale}</p>{plan.analysis.newsInsights.slice(0, 2).map((news) => <a key={news.url} href={news.url} target="_blank" rel="noopener noreferrer">{news.sentiment} · {news.title}</a>)}</div>}
              {plan.refreshError && <p className="planner-item-error">{plan.refreshError}</p>}
              <div className="planner-item-footer"><span>{plan.updatedAt ? `Updated ${new Date(plan.updatedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} · refresh ${refreshPeriod(plan.dueAt) === 10_000 ? "10 sec" : refreshPeriod(plan.dueAt) === 300_000 ? "5 min" : refreshPeriod(plan.dueAt) === 3_600_000 ? "hourly" : "manual only"}` : "Not refreshed yet"}</span><span>{new Date(plan.dueAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</span></div>
            </article>
          ))}
          {!plans.length && <div className="planner-empty"><CalendarClock size={20} /><strong>No plans yet</strong><span>Add an event below to track an upcoming setup.</span></div>}
        </div>
        <form className="planner-form" onSubmit={addPlan}>
          <div className="planner-form-title">Plan a future event</div>
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Event name · e.g. Fed decision" maxLength={70} />
          <div className="planner-fields"><input required value={symbol} onChange={(event) => setSymbol(event.target.value)} placeholder="Ticker e.g. NVDA" maxLength={20} /><select value={assetType} onChange={(event) => setAssetType(event.target.value as AssetType)}><option value="stock">Stock</option><option value="crypto">Crypto</option></select><select value={timeframe} onChange={(event) => setTimeframe(event.target.value as Timeframe)}><option value="5m">5m</option><option value="1d">1D</option></select></div>
          <div className="planner-fields"><label>Budget £<input type="number" min="1" max="1000000" step="1" value={budget} onChange={(event) => setBudget(event.target.value)} /></label><label>Event date & time<input type="datetime-local" value={dueAt} min={nextHour()} onChange={(event) => setDueAt(event.target.value)} required /></label></div>
          <button type="submit" className="lime-button"><CalendarClock size={14} /> Add to planner</button>
          <p className="planner-refresh-note"><LoaderCircle size={12} /> Auto-refresh: {!Number.isFinite(refreshInterval) ? "manual only (no upcoming events)" : refreshInterval === 10_000 ? "every 10 sec (<1h)" : refreshInterval === 300_000 ? "every 5 min (1–24h)" : "hourly (>24h)"} while this planner is open.</p>
        </form>
      </section>
    </div>
  );
}
