// The chat header's 24-hour reply-window countdown. It ticks every second on
// its own, so only this text re-renders, not the whole chat (every message
// bubble used to re-render once a second, which made scrolling stutter).
import { useEffect, useState } from 'react';

const pad = (n: number) => String(n).padStart(2, '0');

export function SessionTimer({ expiresAt, metaChat }: { expiresAt: number; metaChat: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (expiresAt <= Date.now()) return undefined;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [expiresAt]);

  const open = expiresAt > now;
  const sec = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const text = open ? (h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`) : '00:00:00';
  const color = !open || sec <= 3600 ? '#ff4545' : sec <= 14400 ? '#ffd43b' : '#22ce6d';

  return (
    <div
      className="timer-box"
      id="timerBox"
      style={{ '--timer-color': color } as React.CSSProperties}
      title={
        open
          ? `Session window open: ${text} remaining`
          : metaChat
            ? '24-hour reply window closed — wait for the customer to write again'
            : '24-hour session window closed — use a template'
      }
    >
      <div className="timer" id="timer">
        {text}
      </div>
    </div>
  );
}

/**
 * Whether the 24-hour window is open, re-checked only at the moment it
 * closes (not every second).
 */
export function useWindowOpen(expiresAt: number): boolean {
  const [open, setOpen] = useState(() => expiresAt > Date.now());
  useEffect(() => {
    const left = expiresAt - Date.now();
    setOpen(left > 0);
    if (left <= 0) return undefined;
    // setTimeout caps at ~24.8 days; the window is 24 hours.
    const id = window.setTimeout(() => setOpen(false), Math.min(left + 50, 2 ** 31 - 1));
    return () => window.clearTimeout(id);
  }, [expiresAt]);
  return open;
}
