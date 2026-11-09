// Meta's daily messaging limit, shared by the sidebar's bar and the Campaigns
// page's card so both show the same live figure.
//
// Read once, then kept current three ways: the server pushes new figures the
// moment a template goes out (or fails); a re-read every minute while the tab
// is visible (customers leave the rolling 24 hours on their own); and a
// re-read right when the first counted customer leaves (`nextFreeAt`).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CrmApi } from '../api';
import type { MessagingLimitUsage } from '../types';
import './MessagingLimit.css';

type LimitSocket = { onMessagingLimit(cb: (q: MessagingLimitUsage) => void): () => void };

type Ctx = { data: MessagingLimitUsage | null; loading: boolean; refresh: (askMeta?: boolean) => void };
const MessagingLimitCtx = createContext<Ctx>({ data: null, loading: false, refresh: () => {} });
export const useMessagingLimit = () => useContext(MessagingLimitCtx);

// The server pushes every change (a template sent or failed) over the socket,
// and the one change it can't push (a customer leaving the 24 hours) is read
// at `nextFreeAt`. This slow re-read only catches what both could miss
// (a dropped socket, a tier change at Meta).
const SAFETY_RELOAD_MS = 10 * 60_000;
/** Coming back to the tab re-reads only if the figure is at least this old. */
const STALE_MS = 60_000;

export function MessagingLimitProvider({
  api, socket, enabled, businessId, children,
}: {
  api: CrmApi;
  socket: LimitSocket | null;
  /** The business has its own number (or it's the demo). */
  enabled: boolean;
  businessId?: string;
  children: ReactNode;
}) {
  const [data, setData] = useState<MessagingLimitUsage | null>(null);
  const [loading, setLoading] = useState(false);
  const bizRef = useRef(businessId);
  // The latest client, so a new one never re-runs the effects below (and
  // never blanks the bar).
  const apiRef = useRef(api);
  apiRef.current = api;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const loadedAt = useRef(0);
  const inFlight = useRef(false);

  // Stable for the life of the provider. A failed read keeps what's shown.
  const load = useCallback((askMeta = false) => {
    if (!enabledRef.current || (inFlight.current && !askMeta)) return;
    const biz = bizRef.current;
    inFlight.current = true;
    if (askMeta) setLoading(true);
    apiRef.current
      .getMessagingLimit(askMeta)
      .then((r) => {
        if (bizRef.current !== biz) return;
        loadedAt.current = Date.now();
        setData(r);
      })
      .catch(() => setData((d) => d || { connected: true, limit: null, used24h: 0, messages24h: 0, nextFreeAt: null, error: 'Couldn’t load the limit right now.' }))
      .finally(() => {
        inFlight.current = false;
        if (askMeta) setLoading(false);
      });
  }, []);

  // Only another business (master login switch) starts over from blank. The
  // number being re-read (a profile reload) keeps the bar as it is.
  const shownFor = useRef<string | undefined>(undefined);
  useEffect(() => {
    bizRef.current = businessId;
    if (shownFor.current !== undefined && shownFor.current !== businessId) {
      setData(null);
      loadedAt.current = 0;
    }
    shownFor.current = businessId;
    if (enabled && !loadedAt.current) load();
  }, [businessId, enabled, load]);

  useEffect(() => {
    if (!enabled) return undefined;
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, SAFETY_RELOAD_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - loadedAt.current > STALE_MS) load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, load]);

  // The first counted customer leaves the 24 hours: a slot is free again.
  const nextFreeAt = data?.nextFreeAt ? new Date(data.nextFreeAt).getTime() : 0;
  useEffect(() => {
    if (!enabled || !nextFreeAt) return undefined;
    const wait = Math.max(1000, nextFreeAt - Date.now() + 2000);
    // setTimeout can't wait longer than ~24.8 days; the safety re-read covers it.
    if (wait > 25 * 60 * 60 * 1000) return undefined;
    const t = setTimeout(() => load(), wait);
    return () => clearTimeout(t);
  }, [enabled, nextFreeAt, load]);

  useEffect(() => {
    if (!socket || !enabled) return undefined;
    return socket.onMessagingLimit((q) => {
      if (!q || q.used24h === undefined) return;
      if (q.businessId && businessId && String(q.businessId) !== String(businessId)) return;
      loadedAt.current = Date.now();
      // A push without the tier (Meta didn't answer this time) keeps the known one.
      setData((d) => (q.connected === false ? q : { ...q, limit: q.limit || d?.limit || null }));
    });
  }, [socket, enabled, businessId]);

  const value = useMemo(() => ({ data: enabled ? data : null, loading, refresh: load }), [enabled, data, loading, load]);
  return <MessagingLimitCtx.Provider value={value}>{children}</MessagingLimitCtx.Provider>;
}

const fmt = (n: number) => n.toLocaleString('en-IN');

function GaugeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M3.25 14.75A7.75 7.75 0 1 1 16.75 14.75" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M10 12.5L13.1 8.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="10" cy="12.5" r="1.4" fill="currentColor" />
    </svg>
  );
}

/** "in 5 h" / "in 40 min": when the next slot frees up. */
function untilText(iso: string | null): string {
  const t = iso ? new Date(iso).getTime() - Date.now() : 0;
  if (!(t > 0)) return '';
  const min = Math.ceil(t / 60000);
  return min >= 60 ? `in ${Math.round(min / 60)} h` : `in ${min} min`;
}

/**
 * The bar at the bottom of the left sidebar, styled like the profile drawer's
 * "Free service messages" card. Collapsed sidebar: a small ring with the
 * percentage, the details in its tooltip.
 */
export function SidebarMessagingLimit({ onOpen }: { onOpen?: () => void }) {
  const { data } = useMessagingLimit();
  // "frees in 40 min" counts down on this computer's clock (no server call).
  const [, tick] = useState(0);
  const counting = !!data?.nextFreeAt && !!data.used24h;
  useEffect(() => {
    if (!counting) return undefined;
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, [counting]);
  if (!data || !data.connected) return null;
  const lim = data.limit;
  const used = data.used24h || 0;
  const unlimited = !!lim?.unlimited;
  const max = lim?.limit || 0;
  const known = !data.error && (unlimited || max > 0);
  const pct = known && !unlimited ? Math.min(100, Math.round((used / max) * 100)) : 0;
  const full = known && !unlimited && used >= max;
  const tone = full ? 'full' : pct >= 80 ? 'warn' : 'ok';
  const left = known && !unlimited ? Math.max(0, max - used) : 0;
  const frees = untilText(data.nextFreeAt);
  const stat = !known
    ? data.error || (data.metaError ? 'Limit unavailable from Meta' : 'Loading…')
    : unlimited
      ? `${fmt(used)} · Unlimited`
      : `${fmt(used)} / ${fmt(max)}`;
  const tip =
    'Meta’s daily messaging limit: how many different customers your number can send a template to, outside their 24-hour chat window, in any 24 hours. '
    + 'Replies inside a chat don’t count. Campaigns, templates from a chat, journeys and automatic templates all do. '
    + (known && !unlimited ? `${fmt(used)} of ${fmt(max)} used, ${fmt(left)} left.` : '')
    + (frees && used ? ` The next one frees up ${frees}.` : '');

  return (
    <button
      type="button"
      className={`side-limit ${tone}`}
      onClick={onOpen}
      title={tip}
      aria-label={`Daily messaging limit: ${stat}`}
      data-testid="side-limit"
    >
      {/* Both forms are drawn; CSS shows the ring only in the collapsed wide sidebar. */}
      <span className="side-limit-ring" style={{ '--p': `${pct}` } as React.CSSProperties} data-testid="side-limit-ring" aria-hidden="true">
        <span>{unlimited ? '∞' : `${pct}%`}</span>
      </span>
      <span className="side-limit-wide">
          <span className="side-limit-head">
            <span className="side-limit-ico"><GaugeIcon /></span>
            <span className="side-limit-title">Daily messaging limit</span>
          </span>
          <span className="side-limit-bar" role="progressbar" aria-valuemin={0} aria-valuemax={max || undefined} aria-valuenow={known && !unlimited ? Math.min(used, max) : undefined}>
            <span className="side-limit-fill" style={{ width: `${unlimited ? 0 : pct}%` }} />
          </span>
          <span className="side-limit-row">
            <span className="side-limit-stat" data-testid="side-limit-stat">{stat}</span>
            <span className="side-limit-sub" data-testid="side-limit-sub">
              {!known ? '' : full ? (frees ? `Full · frees ${frees}` : 'Full') : unlimited ? 'last 24 h' : `${fmt(left)} left · 24 h`}
            </span>
          </span>
      </span>
    </button>
  );
}
