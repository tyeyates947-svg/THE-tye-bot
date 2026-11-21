"use client";

import type { TradeDuration } from "@/lib/types";
import { TRADE_DURATIONS } from "@/lib/types";
import { ukDateTimeInput } from "@/lib/date-time";

interface TradeTimingControlsProps {
  entryMode: "now" | "scheduled";
  entryAt: string;
  duration: TradeDuration;
  customMinutes: string;
  onEntryModeChange: (mode: "now" | "scheduled") => void;
  onEntryAtChange: (value: string) => void;
  onDurationChange: (duration: TradeDuration) => void;
  onCustomMinutesChange: (value: string) => void;
}

const durationOptions: Array<{ value: TradeDuration; label: string }> = [
  { value: "5m", label: "5 mins" },
  { value: "15m", label: "15 mins" },
  { value: "1h", label: "1 hour" },
  { value: "4h", label: "4 hours" },
  { value: "1d", label: "1 day" },
  { value: "1w", label: "1 week" },
  { value: "custom", label: "Custom" },
];

export function selectedDurationMinutes(duration: TradeDuration, customMinutes: string): number {
  if (duration !== "custom") return TRADE_DURATIONS[duration];
  return Math.min(10080, Math.max(5, Math.round(Number(customMinutes) || 5)));
}

export default function TradeTimingControls({
  entryMode, entryAt, duration, customMinutes, onEntryModeChange, onEntryAtChange, onDurationChange, onCustomMinutesChange,
}: TradeTimingControlsProps) {
  return (
    <div className="trade-timing-controls">
      <label className="trade-time-entry">Entry time
        <select value={entryMode} onChange={(event) => onEntryModeChange(event.target.value as "now" | "scheduled")}>
          <option value="now">Enter Now (Market)</option>
          <option value="scheduled">Schedule entry</option>
        </select>
      </label>
      {entryMode === "scheduled" && <label className="trade-time-entry">Date &amp; time (UK)
        <input type="datetime-local" value={entryAt} min={ukDateTimeInput(Date.now() + 60_000)} onChange={(event) => onEntryAtChange(event.target.value)} />
      </label>}
      <fieldset className="trade-duration-options">
        <legend>Trade duration · auto-close</legend>
        <div>{durationOptions.map((option) => <button key={option.value} type="button" className={duration === option.value ? "selected" : ""} aria-pressed={duration === option.value} onClick={() => onDurationChange(option.value)}>{option.label}</button>)}</div>
      </fieldset>
      {duration === "custom" && <label className="trade-time-entry">Minutes (5–10,080)
        <input type="number" min="5" max="10080" step="1" value={customMinutes} onChange={(event) => onCustomMinutesChange(event.target.value)} />
      </label>}
      <span className="trade-duration-hint">AI targets use a {selectedDurationMinutes(duration, customMinutes) <= 60 ? "fast scalp" : "swing"} timeframe. Paper trades close automatically at expiry.</span>
    </div>
  );
}
