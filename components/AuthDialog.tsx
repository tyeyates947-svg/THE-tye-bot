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
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("pulse:lime");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pin.length !== 4) { setError("Enter all four PIN digits."); return; }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/auth/${mode === "login" ? "login" : "register"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, pin, ...(mode === "register" ? { avatarUrl } : {}) }),
      });
      const result = await readApiResponse<{ token: string; profile: Profile }>(response, "Account service");
      onAuthenticated(result.token, result.profile);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not sign in.");
    } finally { setBusy(false); }
  };

  const digit = (value: string) => {
    setError("");
    setPin((current) => current.length < 4 ? current + value : current);
  };

  return (
    <div className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="pin-auth-title" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form className="auth-card pin-auth-card" onSubmit={(event) => void submit(event)}>
        <div className="auth-header">
          <div className="pin-brand"><div className="brand-mark">⚡</div><div><h2 id="pin-auth-title">{mode === "login" ? "Welcome back" : "Join QuantPulse"}</h2><p>{mode === "login" ? "Your paper portfolio is waiting." : "Create a paper-trading profile."}</p></div></div>
          <button type="button" className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={15} /></button>
        </div>
        <div className="auth-fields">
          <label className="auth-label">Username<input type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} minLength={3} maxLength={24} required pattern="[a-zA-Z0-9_]{3,24}" placeholder="e.g. chart_wizard" value={username} onChange={(event) => setUsername(event.target.value)} /></label>
          {mode === "register" && <div><span className="auth-label-text">Pick your avatar</span><AvatarPicker value={avatarUrl} onChange={setAvatarUrl} /></div>}
          <label className="auth-label">4-digit PIN<input type="password" inputMode="numeric" autoComplete={mode === "login" ? "current-password" : "new-password"} pattern="[0-9]{4}" maxLength={4} required placeholder="••••" value={pin} onChange={(event) => { setError(""); setPin(event.target.value.replace(/\D/g, "").slice(0, 4)); }} /></label>
          <div className="pin-keypad" aria-label="PIN keypad">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "delete"].map((key) => (
              <button type="button" key={key} className="pin-key" onClick={() => key === "clear" ? setPin("") : key === "delete" ? setPin((value) => value.slice(0, -1)) : digit(key)} aria-label={key === "delete" ? "Delete last digit" : key === "clear" ? "Clear PIN" : `Digit ${key}`}>
                {key === "delete" ? "⌫" : key === "clear" ? "CLR" : key}
              </button>
            ))}
          </div>
        </div>
        <div className="auth-actions">
          <button className="lime-button" disabled={busy || pin.length !== 4}>{busy ? <LoaderCircle size={14} className="spin" /> : <ProfileAvatar avatarUrl={avatarUrl} size={19} />}{mode === "login" ? "Sign in" : "Create account"}</button>
          <button type="button" className="auth-toggle" onClick={() => { setMode(mode === "login" ? "register" : "login"); setPin(""); setError(""); }}>{mode === "login" ? "New here? Make an account" : "Already have an account? Sign in"}</button>
        </div>
        {error && <div className="auth-feedback" role="alert">{error}</div>}
        <p className="auth-hint">PIN sign-in is rate-limited. Never reuse a PIN from another service.</p>
      </form>
    </div>
  );
}
