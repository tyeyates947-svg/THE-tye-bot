"use client";

import { FormEvent, useEffect, useState } from "react";
import { BadgeCheck, LoaderCircle, Play, RefreshCw, Unplug, X } from "lucide-react";
import AvatarPicker from "@/components/AvatarPicker";
import ProfileAvatar from "@/components/ProfileAvatar";
import type { Profile } from "@/lib/session";
import { readApiResponse, withSession } from "@/lib/client-api";
import type { PaperAccountProvider, PaperAccountStats, PaperTrade } from "@/lib/types";
import ThemePicker from "@/components/ThemePicker";

interface ProfileDialogProps {
  profile: Profile;
  token: string;
  activeTrades: PaperTrade[];
  history: PaperTrade[];
  theme: string;
  onThemeChange: (theme: string) => void;
  onReplayTour: () => void;
  onClose: () => void;
  onSaved: (profile: Profile) => void;
}

export default function ProfileDialog({ profile, token, activeTrades, history, theme, onThemeChange, onReplayTour, onClose, onSaved }: ProfileDialogProps) {
  const [avatarUrl, setAvatarUrl] = useState(profile.avatar_url);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [accountProvider, setAccountProvider] = useState<PaperAccountProvider>("trading212");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountError, setAccountError] = useState("");
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const countdown = (value: string | undefined) => {
    if (!value) return "—";
    const seconds = Math.max(0, Math.floor((new Date(value).getTime() - now) / 1000));
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes}m` : `${minutes}m ${seconds % 60}s`;
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { ...withSession(token), "Content-Type": "application/json" },
        body: JSON.stringify({ avatarUrl }),
      });
      const result = await readApiResponse<{ profile: Profile }>(response, "Profile service");
      onSaved(result.profile);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save your profile.");
    } finally { setBusy(false); }
  };

  const connectPaperAccount = async (action: "connect" | "sync" | "disconnect") => {
    setAccountBusy(true);
    setAccountError("");
    try {
      const response = await fetch("/api/paper-account", {
        method: action === "disconnect" ? "DELETE" : "POST",
        headers: { ...withSession(token), ...(action === "disconnect" ? {} : { "Content-Type": "application/json" }) },
        ...(action === "disconnect" ? {} : {
          body: JSON.stringify(action === "sync" ? { action } : { provider: accountProvider, apiKey, apiSecret }),
        }),
      });
      const result = await readApiResponse<{ stats?: PaperAccountStats }>(response, "Paper account");
      if (action === "disconnect") {
        onSaved({
          ...profile,
          paper_account_provider: null,
          paper_account_verified: false,
          paper_account_balance_gbp: null,
          paper_account_equity_gbp: null,
          paper_account_profit_gbp: null,
          paper_account_win_rate: null,
          paper_account_open_profit_gbp: null,
          paper_account_closed_profit_gbp: null,
          paper_account_open_positions: null,
        });
      } else if (result.stats) {
        onSaved({
          ...profile,
          paper_account_provider: result.stats.provider,
          paper_account_verified: true,
          paper_account_balance_gbp: result.stats.balance_gbp,
          paper_account_equity_gbp: result.stats.equity_gbp,
          paper_account_profit_gbp: result.stats.profit_gbp,
          paper_account_win_rate: result.stats.win_rate,
          paper_account_open_profit_gbp: result.stats.open_profit_gbp,
          paper_account_closed_profit_gbp: result.stats.closed_profit_gbp,
          paper_account_open_positions: result.stats.open_positions,
        });
      }
      if (action === "connect") {
        setApiKey("");
        setApiSecret("");
      }
    } catch (caught) {
      setAccountError(caught instanceof Error ? caught.message : "Could not update the connected paper account.");
    } finally { setAccountBusy(false); }
  };

  return (
    <div className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="profile-title" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form className="auth-card profile-card" onSubmit={(event) => void save(event)}>
        <div className="auth-header"><div className="profile-header"><ProfileAvatar avatarUrl={avatarUrl} username={profile.username} size={46} /><div><h2 id="profile-title">@{profile.username}</h2><p>{profile.wins}W / {profile.losses}L · <span className={profile.total_profit_gbp >= 0 ? "positive" : "negative"}>£{profile.total_profit_gbp.toFixed(2)} total profit</span></p></div></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close"><X size={15} /></button></div>
        <div className="profile-drawer-section"><h3>Active Trade Withs</h3>{activeTrades.length ? activeTrades.map((trade) => <div className="profile-mini-row" key={trade.id}><strong>{trade.symbol}</strong><span>{trade.status === "scheduled" ? "Entry scheduled" : trade.direction}</span><span>{trade.status === "scheduled" ? `Entry in ${countdown(trade.entry_at)}` : `Time left ${countdown(trade.expires_at)}`}</span><b className={trade.unrealized_pnl_gbp >= 0 ? "positive" : "negative"}>£{trade.unrealized_pnl_gbp.toFixed(2)}</b></div>) : <p className="auth-hint">No active Trade Withs yet.</p>}</div>
        <div className="profile-drawer-section"><h3>Trade History</h3>{history.map((trade) => <div className="profile-mini-row" key={trade.id}><strong>{trade.symbol}</strong><span>{trade.direction}</span><b className={(trade.pnl_gbp ?? 0) >= 0 ? "positive" : "negative"}>£{(trade.pnl_gbp ?? 0).toFixed(2)}</b></div>)}{!history.length && <p className="auth-hint">Closed positions will appear here.</p>}</div>
        <section className="profile-drawer-section paper-account-section">
          <h3>🔗 Connect Paper Account</h3>
          {profile.paper_account_verified
            ? <div className="verified-account"><strong><BadgeCheck size={14} /> ✓ Verified Paper Account · {profile.paper_account_provider === "alpaca" ? "Alpaca" : "Trading 212"}</strong><span>Cash £{(profile.paper_account_balance_gbp ?? 0).toFixed(2)} · Equity £{(profile.paper_account_equity_gbp ?? 0).toFixed(2)} · {profile.paper_account_open_positions ?? 0} open positions</span><span>Open P&amp;L {(profile.paper_account_open_profit_gbp ?? 0) >= 0 ? "+" : "−"}£{Math.abs(profile.paper_account_open_profit_gbp ?? 0).toFixed(2)} · Closed P&amp;L {(profile.paper_account_closed_profit_gbp ?? 0) >= 0 ? "+" : "−"}£{Math.abs(profile.paper_account_closed_profit_gbp ?? 0).toFixed(2)}{profile.paper_account_win_rate !== null ? ` · Win rate ${profile.paper_account_win_rate.toFixed(1)}%` : ""}</span><div className="account-actions"><button type="button" className="outline-button" disabled={accountBusy} onClick={() => void connectPaperAccount("sync")}><RefreshCw size={12} /> Sync</button><button type="button" className="outline-button" disabled={accountBusy} onClick={() => void connectPaperAccount("disconnect")}><Unplug size={12} /> Disconnect</button></div></div>
            : <>
              <p className="auth-hint">Practice accounts only. Use read-only credentials with account, positions, and history access. Secrets are encrypted on the server and never shown publicly.</p>
              <label>Provider<select value={accountProvider} onChange={(event) => setAccountProvider(event.target.value as PaperAccountProvider)}><option value="trading212">Trading 212 Practice</option><option value="alpaca">Alpaca Paper</option></select></label>
              <label>API key<input value={apiKey} onChange={(event) => setApiKey(event.target.value)} autoComplete="off" spellCheck={false} /></label>
              <label>API secret<input type="password" value={apiSecret} onChange={(event) => setApiSecret(event.target.value)} autoComplete="new-password" /></label>
              <button type="button" className="lime-button" disabled={accountBusy || apiKey.length < 8 || apiSecret.length < 8} onClick={() => void connectPaperAccount("connect")}>{accountBusy ? <LoaderCircle size={13} className="spin" /> : <BadgeCheck size={13} />} Verify &amp; connect practice account</button>
            </>}
          {accountError && <div className="auth-feedback" role="alert">{accountError}</div>}
        </section>
        <AvatarPicker value={avatarUrl} onChange={setAvatarUrl} />
        <div className="auth-actions"><button className="lime-button" disabled={busy}>{busy ? <LoaderCircle size={14} className="spin" /> : null}Save profile</button></div>
        <div className="profile-settings"><span>App theme</span><ThemePicker value={theme} onChange={onThemeChange} /></div>
        <button type="button" className="outline-button replay-tour-button" onClick={onReplayTour}><Play size={13} /> Replay Tour</button>
        {error && <div className="auth-feedback" role="alert">{error}</div>}
      </form>
    </div>
  );
}
