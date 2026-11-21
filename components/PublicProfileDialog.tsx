"use client";

import { useEffect, useState } from "react";
import { LoaderCircle, Users, X } from "lucide-react";
import ProfileAvatar from "@/components/ProfileAvatar";
import type { AssetType, Timeframe } from "@/lib/market";
import { readApiResponse } from "@/lib/client-api";
import TradeTimingControls from "@/components/TradeTimingControls";
import type { TradeDuration } from "@/lib/types";
import { ukDateTimeInput } from "@/lib/date-time";

interface PublicTrade {
  id: string;
  symbol: string;
  asset_type: AssetType;
  direction: "LONG" | "SHORT";
  timeframe: Timeframe;
  currency: string;
  entry_price: number;
  mark_price?: number;
  exit_price?: number | null;
  unrealized_pnl_gbp?: number;
  pnl_gbp?: number;
  amount_gbp: number;
  take_profit: number;
  stop_loss: number;
  created_at: string;
  closed_at?: string | null;
}

interface PublicProfile {
  username: string;
  avatar_url: string;
  total_profit_gbp: number;
  wins: number;
  losses: number;
  paper_account_provider: "trading212" | "alpaca" | null;
  paper_account_verified: boolean;
  paper_account_equity_gbp: number | null;
  paper_account_profit_gbp: number | null;
  paper_account_win_rate: number | null;
  paper_account_open_profit_gbp: number | null;
  paper_account_closed_profit_gbp: number | null;
  paper_account_open_positions: number | null;
}

interface PublicProfileDialogProps {
  username: string;
  signedIn: boolean;
  onClose: () => void;
  onSignIn: () => void;
  onTradeWith: (trade: PublicTrade, timing: { entryMode: "now" | "scheduled"; entryAt: string; duration: TradeDuration; customMinutes: string }) => void;
}

function money(value: number): string {
  return `${value >= 0 ? "+" : "−"}£${Math.abs(value).toFixed(2)}`;
}

export default function PublicProfileDialog({ username, signedIn, onClose, onSignIn, onTradeWith }: PublicProfileDialogProps) {
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [active, setActive] = useState<PublicTrade[]>([]);
  const [history, setHistory] = useState<PublicTrade[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [entryMode, setEntryMode] = useState<"now" | "scheduled">("now");
  const [entryAt, setEntryAt] = useState(() => {
    return ukDateTimeInput(Date.now() + 60_000);
  });
  const [duration, setDuration] = useState<TradeDuration>("1d");
  const [customMinutes, setCustomMinutes] = useState("30");

  useEffect(() => {
    let mounted = true;
    void fetch(`/api/profiles/${encodeURIComponent(username)}`)
      .then((response) => readApiResponse<{ profile: PublicProfile; active: PublicTrade[]; history: PublicTrade[] }>(response, "Public profile"))
      .then((result) => {
        if (!mounted) return;
        setProfile(result.profile);
        setActive(result.active);
        setHistory(result.history);
      })
      .catch((caught) => { if (mounted) setError(caught instanceof Error ? caught.message : "Could not load trader profile."); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [username]);

  return (
    <div className="auth-modal public-profile-overlay" role="dialog" aria-modal="true" aria-labelledby="public-profile-title" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="auth-card public-profile-card">
        <div className="auth-header">
          <div className="profile-header">
            {profile && <ProfileAvatar avatarUrl={profile.avatar_url} username={profile.username} size={46} />}
            <div><h2 id="public-profile-title">{profile ? `@${profile.username}` : `@${username}`}</h2><p>Trader profile &amp; public Trade Withs {profile?.paper_account_verified && <span className="verified-badge">✓ Verified Paper Account</span>}</p></div>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close"><X size={15} /></button>
        </div>
        {loading && <div className="dialog-loading"><LoaderCircle size={16} className="spin" /> Loading profile…</div>}
        {error && <div className="error-banner">{error}</div>}
        {profile && <>
          <div className="public-stats">
            <div><span>Win / loss</span><strong>{profile.wins}W / {profile.losses}L</strong></div>
            <div><span>Total profit</span><strong className={profile.total_profit_gbp >= 0 ? "positive" : "negative"}>{money(profile.total_profit_gbp)}</strong></div>
            {profile.paper_account_verified && <div><span>{profile.paper_account_provider === "alpaca" ? "Alpaca" : "Trading 212"} paper equity</span><strong>£{(profile.paper_account_equity_gbp ?? 0).toFixed(2)}</strong></div>}
            {profile.paper_account_verified && profile.paper_account_profit_gbp !== null && <div><span>Verified paper P&amp;L</span><strong className={profile.paper_account_profit_gbp >= 0 ? "positive" : "negative"}>{money(profile.paper_account_profit_gbp)}</strong></div>}
            {profile.paper_account_verified && profile.paper_account_win_rate !== null && <div><span>Paper win rate</span><strong>{profile.paper_account_win_rate.toFixed(1)}%</strong></div>}
            {profile.paper_account_verified && profile.paper_account_open_profit_gbp !== null && <div><span>Open paper P&amp;L · {profile.paper_account_open_positions ?? 0} positions</span><strong className={profile.paper_account_open_profit_gbp >= 0 ? "positive" : "negative"}>{money(profile.paper_account_open_profit_gbp)}</strong></div>}
            {profile.paper_account_verified && profile.paper_account_closed_profit_gbp !== null && <div><span>Closed paper P&amp;L</span><strong className={profile.paper_account_closed_profit_gbp >= 0 ? "positive" : "negative"}>{money(profile.paper_account_closed_profit_gbp)}</strong></div>}
          </div>
          <h3 className="profile-section-title"><Users size={14} /> Active Trade Withs</h3>
          <div className="public-trade-list">
            {!active.length && <div className="paper-empty">No active Trade Withs right now.</div>}
            {active.map((trade) => <article className="public-trade" key={trade.id}>
              <div><strong>{trade.symbol}</strong><span className={`trade-side ${trade.direction.toLowerCase()}`}>{trade.direction}</span><small>{trade.timeframe} · Entry {trade.currency} {Number(trade.entry_price).toFixed(2)}</small></div>
              <strong className={(trade.unrealized_pnl_gbp ?? 0) >= 0 ? "positive" : "negative"}>{money(trade.unrealized_pnl_gbp ?? 0)}</strong>
              {signedIn
                ? <div className="public-copy-controls">
                  <TradeTimingControls entryMode={entryMode} entryAt={entryAt} duration={duration} customMinutes={customMinutes} onEntryModeChange={setEntryMode} onEntryAtChange={setEntryAt} onDurationChange={setDuration} onCustomMinutesChange={setCustomMinutes} />
                  <button className="lime-button copy-trade-button" onClick={() => onTradeWith(trade, { entryMode, entryAt, duration, customMinutes })}>{entryMode === "scheduled" ? "Schedule Trade With" : "Copy / Trade With Too"}</button>
                </div>
                : <button className="outline-button copy-trade-button" onClick={onSignIn}>Sign in to copy</button>}
            </article>)}
          </div>
          <h3 className="profile-section-title">Trade History</h3>
          <div className="public-trade-list history-list">
            {!history.length && <div className="paper-empty">No closed positions yet.</div>}
            {history.map((trade) => <article className="history-row" key={trade.id}>
              <span>{trade.symbol} · {trade.direction}</span><strong className={(trade.pnl_gbp ?? 0) >= 0 ? "positive" : "negative"}>{money(trade.pnl_gbp ?? 0)}</strong>
            </article>)}
          </div>
        </>}
        <p className="auth-hint">Positions are simulated for education only and are not financial advice or real trading.</p>
      </section>
    </div>
  );
}
