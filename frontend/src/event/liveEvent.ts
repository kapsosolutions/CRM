// The live event theme (admin panel → Events), for the website and the CRM.
//
//   useLiveEvent()   the live event, or null (normal design)
//
// Read once per page load from GET /api/events/live. The last answer is kept
// in localStorage, so a returning visitor sees the event's logo and hero at
// once instead of a flash of the normal design; the fresh answer replaces it.
//
// Preview: the admin opens the site with ?eventPreview=<id> (from Events).
// That event is shown in this tab, from the admin endpoint, until the tab is
// closed or ?eventPreview=off.
import { useEffect, useState } from 'react';
import { ADMIN_TOKEN_KEY, platformApi } from '../admin/platformApi';

export type Tone = 'dark' | 'light';
export interface EventTheme {
  logos?: { site?: string; crmLight?: string; crmDark?: string };
  landing?: { heroBg?: string; heroArt?: string; badge?: string; titleAccent?: string; titleMain?: string; desc?: string; accent?: string; tone?: Tone; overlay?: number };
  pages?: { heroBg?: string; tone?: Tone; overlay?: number };
  whatsapp?: { image?: string; tooltip?: string };
  announcement?: { enabled?: boolean; text?: string; linkLabel?: string; linkUrl?: string; bg?: string; color?: string; image?: string };
}
export interface LiveEvent {
  id: string;
  name: string;
  theme: EventTheme;
  updatedAt?: string | null;
  /** Shown only to the admin, from Events → Preview. */
  preview?: boolean;
}

const CACHE_KEY = 'kapso-live-event';
const PREVIEW_KEY = 'kapso-event-preview';

function previewId(): string {
  try {
    const q = new URLSearchParams(window.location.search).get('eventPreview');
    if (q === 'off') sessionStorage.removeItem(PREVIEW_KEY);
    else if (q && /^[a-f0-9]{24}$/i.test(q)) sessionStorage.setItem(PREVIEW_KEY, q);
    return sessionStorage.getItem(PREVIEW_KEY) || '';
  } catch {
    return '';
  }
}

function cached(): LiveEvent | null {
  try {
    if (previewId()) return null;
    const v = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    return v && typeof v === 'object' && v.theme ? v : null;
  } catch {
    return null;
  }
}

async function fetchLive(): Promise<LiveEvent | null> {
  const pid = previewId();
  const token = (() => {
    try {
      return localStorage.getItem(ADMIN_TOKEN_KEY) || '';
    } catch {
      return '';
    }
  })();
  if (pid && token) {
    const r = await fetch(`${platformApi.apiBase}/api/admin/events/${pid}`, { headers: { Authorization: `Bearer ${token}` } });
    if (r.ok) {
      const { data } = await r.json();
      if (data) return { id: data._id, name: data.name, theme: data.theme || {}, updatedAt: data.updatedAt, preview: true };
    }
  }
  const r = await fetch(`${platformApi.apiBase}/api/events/live`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const { data } = await r.json();
  const ev: LiveEvent | null = data && data.theme ? data : null;
  try {
    if (ev) localStorage.setItem(CACHE_KEY, JSON.stringify(ev));
    else localStorage.removeItem(CACHE_KEY);
  } catch {
    /* private mode */
  }
  return ev;
}

let current: LiveEvent | null | undefined; // undefined = not read yet
let pending: Promise<LiveEvent | null> | null = null;
const listeners = new Set<(e: LiveEvent | null) => void>();

function load() {
  pending ??= fetchLive()
    .catch(() => (current === undefined ? cached() : current ?? null))
    .then((ev) => {
      current = ev;
      listeners.forEach((l) => l(ev));
      return ev;
    });
  return pending;
}

/** The live event (or the admin's preview), null when there is none. */
export function useLiveEvent(): LiveEvent | null {
  const [ev, setEv] = useState<LiveEvent | null>(() => (current !== undefined ? current : cached()));
  useEffect(() => {
    listeners.add(setEv);
    if (current === undefined) load();
    else setEv(current);
    return () => {
      listeners.delete(setEv);
    };
  }, []);
  return ev;
}

/** A CSS url() value for an image URL the server already checked (https, no quotes). */
export const cssUrl = (u?: string) => (u && /^https:\/\/[^\s"'()<>\\]+$/i.test(u) ? `url("${u}")` : undefined);
