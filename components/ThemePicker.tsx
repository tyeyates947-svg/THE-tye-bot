"use client";

import { useState } from "react";
import { Palette } from "lucide-react";

export const themes = [
  { id: "emerald", name: "Emerald Pulse", accent: "#b1f26a", bg: "#0a0c0a", panel: "#111411" },
  { id: "blue", name: "Cyber Blue", accent: "#57d9ff", bg: "#080d13", panel: "#101922" },
  { id: "purple", name: "Royal Purple", accent: "#bd8cff", bg: "#0d0a13", panel: "#17121f" },
  { id: "gold", name: "Solar Gold", accent: "#f5c451", bg: "#100e08", panel: "#19160f" },
  { id: "crimson", name: "Crimson Red", accent: "#ff697b", bg: "#12090c", panel: "#1c1115" },
  { id: "pink", name: "Midnight Pink", accent: "#ff72d2", bg: "#110914", panel: "#1b1220" },
] as const;

interface ThemePickerProps { value: string; onChange: (theme: string) => void }

export default function ThemePicker({ value, onChange }: ThemePickerProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="theme-picker">
      <button type="button" className="icon-button" title="Choose app theme" aria-label="Choose app theme" aria-expanded={open} onClick={() => setOpen(!open)}><Palette size={15} /></button>
      {open && <div className="theme-menu" role="menu" aria-label="App themes">
        {themes.map((theme) => <button type="button" key={theme.id} role="menuitemradio" aria-checked={value === theme.id} className={`theme-option ${value === theme.id ? "selected" : ""}`} onClick={() => { onChange(theme.id); setOpen(false); }}>
          <span className="theme-swatch" style={{ background: theme.accent }} />
          <span>{theme.name}</span>
          {value === theme.id && <span className="theme-check">Selected</span>}
        </button>)}
      </div>}
    </div>
  );
}
