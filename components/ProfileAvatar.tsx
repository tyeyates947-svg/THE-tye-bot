import { UserRound } from "lucide-react";

const avatarStyles: Record<string, { icon: string; color: string }> = {
  "pulse:lime": { icon: "⚡", color: "#b1f26a" },
  "pulse:violet": { icon: "✦", color: "#c5a5ff" },
  "pulse:orange": { icon: "☀", color: "#ffad6e" },
  "pulse:blue": { icon: "◈", color: "#82c9ff" },
  "pulse:rose": { icon: "♥", color: "#ff93ad" },
  "pulse:mint": { icon: "❋", color: "#77e0c3" },
};

interface ProfileAvatarProps { avatarUrl?: string | null; username?: string; size?: number }

export default function ProfileAvatar({ avatarUrl, username, size = 34 }: ProfileAvatarProps) {
  const preset = avatarStyles[avatarUrl ?? "pulse:lime"];
  const style = { width: size, height: size, fontSize: Math.round(size * 0.46) };
  if (avatarUrl?.startsWith("data:image/")) {
    return <img className="profile-avatar image-avatar" src={avatarUrl} alt={`${username ?? "User"} avatar`} style={style} />;
  }
  return (
    <span className="profile-avatar preset-avatar" style={{ ...style, color: preset?.color ?? "#b1f26a", borderColor: `${preset?.color ?? "#b1f26a"}44` }} aria-label={`${username ?? "User"} avatar`}>
      {preset?.icon ?? <UserRound size={Math.round(size * 0.52)} />}
    </span>
  );
}
