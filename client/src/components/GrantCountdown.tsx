import { useState, useEffect, useRef } from "react";

interface GrantCountdownProps {
  expiresAt: string | null;
  onExpire?: () => void;
}

function formatRemaining(ms: number): string {
  if (ms <= 0) return "Expired";
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) {
    return `${days}d ${hours}h left`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s left`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s left`;
  }
  return `${seconds}s left`;
}

export default function GrantCountdown({ expiresAt, onExpire }: GrantCountdownProps) {
  const [now, setNow] = useState(() => Date.now());
  const expiredFiredRef = useRef(false);

  useEffect(() => {
    if (!expiresAt) return;
    const expiryTime = new Date(expiresAt).getTime();
    if (isNaN(expiryTime)) return;

    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= expiryTime && !expiredFiredRef.current) {
        expiredFiredRef.current = true;
        onExpire?.();
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [expiresAt, onExpire]);

  if (!expiresAt) return null;
  const expiryTime = new Date(expiresAt).getTime();
  const diff = expiryTime - now;
  const isExpired = diff <= 0;

  return (
    <span
      style={{
        fontSize: 12,
        fontFamily: "var(--font-mono, monospace)",
        color: isExpired ? "var(--color-red, #ea4335)" : "var(--color-text-secondary, #5f6368)",
      }}
    >
      ⏱ {formatRemaining(diff)}
    </span>
  );
}
