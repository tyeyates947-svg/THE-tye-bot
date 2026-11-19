"use client";

import { useState } from "react";

export const avatarPresets = ["pulse:lime", "pulse:violet", "pulse:orange", "pulse:blue", "pulse:rose", "pulse:mint"];

interface AvatarPickerProps {
  value: string;
  onChange: (value: string) => void;
}

function resizeImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const ratio = Math.min(1, 128 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
      const context = canvas.getContext("2d");
      if (!context) { reject(new Error("Could not resize this image.")); return; }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      let quality = 0.74;
      let result = canvas.toDataURL("image/jpeg", quality);
      while (result.length > 95_000 && quality > 0.34) {
        quality -= 0.1;
        result = canvas.toDataURL("image/jpeg", quality);
      }
      resolve(result);
    };
    image.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error("Could not read this image.")); };
    image.src = objectUrl;
  });
}

export default function AvatarPicker({ value, onChange }: AvatarPickerProps) {
  const [error, setError] = useState("");

  const handleFile = async (file?: File) => {
    if (!file) return;
    setError("");
    if (!file.type.startsWith("image/")) { setError("Choose an image file."); return; }
    try { onChange(await resizeImage(file)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not resize the image."); }
  };

  return (
    <div className="avatar-picker">
      <div className="avatar-options" role="group" aria-label="Choose a preset avatar">
        {avatarPresets.map((preset) => (
          <button type="button" key={preset} className={`avatar-option ${value === preset ? "selected" : ""}`} onClick={() => onChange(preset)} aria-label={`Choose ${preset.replace("pulse:", "")} avatar`}>
            <span className={`preset-dot ${preset.split(":")[1]}`}>{preset === "pulse:lime" ? "⚡" : preset === "pulse:violet" ? "✦" : preset === "pulse:orange" ? "☀" : preset === "pulse:blue" ? "◈" : preset === "pulse:rose" ? "♥" : "❋"}</span>
          </button>
        ))}
        <label className="avatar-upload">Upload<input type="file" accept="image/*" onChange={(event) => void handleFile(event.target.files?.[0])} /></label>
      </div>
      {error && <span className="auth-feedback">{error}</span>}
    </div>
  );
}
