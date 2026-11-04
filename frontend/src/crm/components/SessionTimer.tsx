// The chat header's 24-hour reply-window countdown. It ticks every second on
// its own, so only this chip re-renders, not the whole chat (every message
// bubble used to re-render once a second, which made scrolling stutter).
//
// Look: a soft tinted chip with a ring that empties as the window runs out.
// Green while there's plenty of time, amber under 4 hours, red in the last
// hour (then it counts mm:ss), grey with a lock once it's closed.
import { useEffect, useState } from 'react';
import './SessionTimer.css';

const WINDOW_SEC = 24 * 3600;
const RING_R = 7;
const RING_C = 2 * Math.PI * RING_R;
const pad = (n: number) => String(n).padStart(2, '0');

type State = 'ok' | 'warn' | 'low' | 'closed';

export function SessionTimer({ expiresAt, metaChat }: { expiresAt: number; metaChat: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (expiresAt <= Date.now()) return undefined;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [expiresAt]);

  const sec = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  const open = sec > 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const state: State = !open ? 'closed' : sec <= 3600 ? 'low' : sec <= 4 * 3600 ? 'warn' : 'ok';
  // Hours and minutes while there's time; a ticking mm:ss in the last hour.
  const text = !open ? 'Closed' : h > 0 ? `${h}h ${pad(m)}m` : `${pad(m)}:${pad(s)}`;
  // The ring shows the share of the 24 hours left; in the last hour it counts
  // down that hour instead (a sliver of 24h would look already empty).
  const left = state === 'low' ? sec / 3600 : Math.min(1, sec / WINDOW_SEC);
  const exact = `${pad(h)}:${pad(m)}:${pad(s)}`;
  const title = open
    ? `Reply window open: ${exact} left to reply freely`
    : metaChat
      ? '24-hour reply window closed — wait for the customer to write again'
      : '24-hour reply window closed — send a template to restart the chat';

  return (
    <div
      className={`sw sw-${state}`}
      role="timer"
      aria-label={open ? `Reply window: ${exact} left` : 'Reply window closed'}
      title={title}
      data-testid="session-timer"
      data-state={state}
    >
      {open ? (
        <svg className="sw-ring" viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">
          <circle className="sw-track" cx="9" cy="9" r={RING_R} />
          <circle
            className="sw-arc"
            cx="9"
            cy="9"
            r={RING_R}
            strokeDasharray={RING_C}
            strokeDashoffset={RING_C * (1 - left)}
            transform="rotate(-90 9 9)"
          />
        </svg>
      ) : (
        <span className="sw-lock material-icons" aria-hidden="true">lock_clock</span>
      )}
      <span className="sw-text">
        <span className="sw-label">Reply window</span>
        <span className="sw-time">{text}</span>
      </span>
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
