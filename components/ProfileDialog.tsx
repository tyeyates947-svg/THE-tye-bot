"use client";

import { FormEvent, useState } from "react";
import { LoaderCircle, Play, X } from "lucide-react";
import AvatarPicker from "@/components/AvatarPicker";
import ProfileAvatar from "@/components/ProfileAvatar";
import type { Profile } from "@/lib/session";
import { readApiResponse, withSession } from "@/lib/client-api";
import type { PaperTrade } from "@/lib/types";
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

  return (
    <div className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="profile-title" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form className="auth-card profile-card" onSubmit={(event) => void save(event)}>
        <div className="auth-header"><div className="profile-header"><ProfileAvatar avatarUrl={avatarUrl} username={profile.username} size={46} /><div><h2 id="profile-title">@{profile.username}</h2><p>{profile.wins}W / {profile.losses}L · <span className={profile.total_profit_gbp >= 0 ? "positive" : "negative"}>£{profile.total_profit_gbp.toFixed(2)} total profit</span></p></div></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close"><X size={15} /></button></div>
        <div className="profile-drawer-section"><h3>Active Trade Withs</h3>{activeTrades.length ? activeTrades.map((trade) => <div className="profile-mini-row" key={trade.id}><strong>{trade.symbol}</strong><span>{trade.direction}</span><b className={trade.unrealized_pnl_gbp >= 0 ? "positive" : "negative"}>£{trade.unrealized_pnl_gbp.toFixed(2)}</b></div>) : <p className="auth-hint">No active Trade Withs yet.</p>}</div>
        <div className="profile-drawer-section"><h3>Trade History</h3>{history.map((trade) => <div className="profile-mini-row" key={trade.id}><strong>{trade.symbol}</strong><span>{trade.direction}</span><b className={(trade.pnl_gbp ?? 0) >= 0 ? "positive" : "negative"}>£{(trade.pnl_gbp ?? 0).toFixed(2)}</b></div>)}{!history.length && <p className="auth-hint">Closed positions will appear here.</p>}</div>
        <AvatarPicker value={avatarUrl} onChange={setAvatarUrl} />
        <div className="auth-actions"><button className="lime-button" disabled={busy}>{busy ? <LoaderCircle size={14} className="spin" /> : null}Save profile</button></div>
        <div className="profile-settings"><span>App theme</span><ThemePicker value={theme} onChange={onThemeChange} /></div>
        <button type="button" className="outline-button replay-tour-button" onClick={onReplayTour}><Play size={13} /> Replay Tour</button>
        {error && <div className="auth-feedback" role="alert">{error}</div>}
      </form>
    </div>
  );
}
