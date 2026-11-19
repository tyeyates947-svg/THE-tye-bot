"use client";

import { FormEvent, useState } from "react";
import { LoaderCircle, X } from "lucide-react";
import AvatarPicker from "@/components/AvatarPicker";
import ProfileAvatar from "@/components/ProfileAvatar";
import type { Profile } from "@/lib/session";
import { readApiResponse } from "@/lib/client-api";

interface AuthDialogProps {
  onClose: () => void;
  onAuthenticated: (token: string, profile: Profile) => void;
}

export default function AuthDialog({ onClose, onAuthenticated }: AuthDialogProps) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("pulse:lime");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (password.length < 8 || password.length > 128) { setError("Password must be 8–128 characters."); return; }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/auth/${mode === "login" ? "login" : "register"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, ...(mode === "register" ? { username, avatarUrl } : {}) }),
      });
      const result = await readApiResponse<{ token: string; profile: Profile }>(response, "Account service");
      onAuthenticated(result.token, result.profile);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not sign in.");
    } finally { setBusy(false); }
  };

  return (
    <div className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form className="auth-card email-auth-card" onSubmit={(event) => void submit(event)}>
        <div className="auth-header">
          <div className="auth-brand"><div className="brand-mark">⚡</div><div><h2 id="auth-title">{mode === "login" ? "Welcome back" : "Join QuantPulse"}</h2><p>{mode === "login" ? "Your paper portfolio is waiting." : "Create a paper-trading profile."}</p></div></div>
          <button type="button" className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={15} /></button>
        </div>
        <div className="auth-fields">
          <label className="auth-label">Email<input type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} maxLength={254} required placeholder="you@example.com" value={email} onChange={(event) => { setError(""); setEmail(event.target.value); }} /></label>
          {mode === "register" && <label className="auth-label">Username<input type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} minLength={3} maxLength={24} required pattern="[a-zA-Z0-9_]{3,24}" placeholder="e.g. chart_wizard" value={username} onChange={(event) => { setError(""); setUsername(event.target.value); }} /></label>}
          {mode === "register" && <div><span className="auth-label-text">Pick your avatar</span><AvatarPicker value={avatarUrl} onChange={setAvatarUrl} /></div>}
          <label className="auth-label">Password<input type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={8} maxLength={128} required placeholder={mode === "login" ? "Enter your password" : "At least 8 characters"} value={password} onChange={(event) => { setError(""); setPassword(event.target.value); }} /></label>
        </div>
        <div className="auth-actions">
          <button className="lime-button" disabled={busy || password.length < 8}>{busy ? <LoaderCircle size={14} className="spin" /> : <ProfileAvatar avatarUrl={avatarUrl} size={19} />}{mode === "login" ? "Sign in" : "Create account"}</button>
          <button type="button" className="auth-toggle" onClick={() => { setMode(mode === "login" ? "register" : "login"); setPassword(""); setError(""); }}>{mode === "login" ? "New here? Make an account" : "Already have an account? Sign in"}</button>
        </div>
        {error && <div className="auth-feedback" role="alert">{error}</div>}
        <p className="auth-hint">Passwords must be 8–128 characters. Sign-in attempts are rate-limited.</p>
      </form>
    </div>
  );
}
