"use client";

import { FormEvent, useState } from "react";
import { LoaderCircle, X } from "lucide-react";
import AvatarPicker from "@/components/AvatarPicker";
import ProfileAvatar from "@/components/ProfileAvatar";
import type { Profile } from "@/lib/session";
import { readApiResponse, withSession } from "@/lib/client-api";

interface ProfileDialogProps {
  profile: Profile;
  token: string;
  onClose: () => void;
  onSaved: (profile: Profile) => void;
}

export default function ProfileDialog({ profile, token, onClose, onSaved }: ProfileDialogProps) {
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
        <div className="auth-header"><div className="profile-header"><ProfileAvatar avatarUrl={avatarUrl} username={profile.username} size={46} /><div><h2 id="profile-title">@{profile.username}</h2><p>Change your profile picture.</p></div></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close"><X size={15} /></button></div>
        <AvatarPicker value={avatarUrl} onChange={setAvatarUrl} />
        <div className="auth-actions"><button className="lime-button" disabled={busy}>{busy ? <LoaderCircle size={14} className="spin" /> : null}Save profile</button></div>
        {error && <div className="auth-feedback" role="alert">{error}</div>}
      </form>
    </div>
  );
}
