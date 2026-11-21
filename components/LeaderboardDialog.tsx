"use client";

import { useEffect, useState } from "react";
import { LoaderCircle, Trophy, X } from "lucide-react";
import ProfileAvatar from "@/components/ProfileAvatar";
import { readApiResponse } from "@/lib/client-api";

interface Leader {
  rank: number; username: string; avatar_url: string; balance_gbp: number; total_profit_gbp: number;
  combined_profit_gbp: number; verified_paper_profit_gbp: number | null; paper_account_provider: string | null;
  paper_account_verified: boolean; return_pct: number; wins: number; losses: number;
  open_positions: Array<{ symbol: string; direction: string }>;
}

interface LeaderboardDialogProps { onClose: () => void; onSelectTrader: (username: string) => void }

export default function LeaderboardDialog({ onClose, onSelectTrader }: LeaderboardDialogProps) {
  const [rows, setRows] = useState<Leader[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void fetch("/api/leaderboard").then((response) => readApiResponse<{ leaderboard: Leader[] }>(response, "Leaderboard"))
      .then((result) => { if (active) setRows(result.leaderboard); })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "Leaderboard unavailable."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  return (
    <div className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="leaderboard-title" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="auth-card leaderboard-card">
        <div className="auth-header"><div className="profile-header"><div className="bot-icon"><Trophy size={18} /></div><div><h2 id="leaderboard-title">Friends leaderboard</h2><p>Practice returns from the QuantPulse community.</p></div></div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={15} /></button></div>
        <div className="leaderboard-list">
          {loading && <div className="dialog-loading"><LoaderCircle size={16} className="spin" /> Loading rankings…</div>}
          {error && <div className="error-banner">{error}</div>}
          {!loading && !error && rows.map((row) => (
            <button type="button" key={row.username} className="leader-row leader-row-button" onClick={() => onSelectTrader(row.username)} aria-label={`View @${row.username}'s public profile`}>
              <span className={`leader-rank ${row.rank <= 3 ? "top" : ""}`}>{String(row.rank).padStart(2, "0")}</span>
              <ProfileAvatar avatarUrl={row.avatar_url} username={row.username} size={38} />
              <div className="leader-main"><strong>@{row.username} {row.paper_account_verified && <span className="verified-badge">✓ Verified paper</span>}</strong><span>{row.wins}W / {row.losses}L {row.open_positions.length ? `· Open: ${row.open_positions.map((position) => position.symbol).join(", ")}` : ""}</span></div>
              <div className="leader-result"><strong className={row.combined_profit_gbp >= 0 ? "positive" : "negative"}>{row.combined_profit_gbp >= 0 ? "+" : ""}£{row.combined_profit_gbp.toFixed(2)}</strong><span>{row.paper_account_verified ? `In-app £${row.total_profit_gbp.toFixed(2)} · Verified paper ${row.verified_paper_profit_gbp! >= 0 ? "+" : "−"}£${Math.abs(row.verified_paper_profit_gbp!).toFixed(2)}` : `${row.return_pct.toFixed(1)}% in-app return`}</span></div>
            </button>
          ))}
          {!loading && !error && rows.length === 0 && <div className="dialog-loading">No traders yet. Be the first on the board.</div>}
        </div>
        <p className="auth-hint">Verified paper-account results and simulated Trade With returns are displayed separately; paper trading does not reflect live investment performance.</p>
      </section>
    </div>
  );
}
