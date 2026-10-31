// Public site → backend: sign-up, sign-in and "Continue with Google".
import { platformApi, type Business } from '../admin/platformApi';

const API = platformApi.apiBase;

export interface SiteConfig {
  supabaseUrl: string;
  googleEnabled: boolean;
  meta: { appId: string; configId: string; graphVersion: string };
}

export interface RegisterForm {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  confirmPassword: string;
  phone: string;
  category: string;
}

export interface SessionResult {
  success: boolean;
  token: string;
  business: Business;
}

export interface GoogleProfile {
  firstName: string;
  lastName: string;
  email: string;
  avatarUrl?: string;
}

export interface DemoCalendar {
  from: string; // first bookable date, YYYY-MM-DD
  to: string; // last bookable date
  closedDays: number[]; // 0 = Sunday
  timezone: string;
}
export interface DemoSlot {
  slot: string; // HH:MM
  left: number; // places left; 0 = full or past
  past: boolean;
}
export interface DemoBooking {
  name: string;
  businessName: string;
  email: string;
  phone: string;
  category: string;
  date: string;
  slot: string;
}

/** A failed request, with per-field messages when the server sent them. */
export class FormError extends Error {
  constructor(message: string, public fields: Record<string, string> = {}, public code = '') {
    super(message);
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new FormError(data.message || `Request failed (${res.status})`, data.errors || {}, data.code || '');
  return data as T;
}

let configPromise: Promise<SiteConfig> | null = null;

export const siteApi = {
  config(): Promise<SiteConfig> {
    configPromise ??= fetch(`${API}/api/auth/config`)
      .then((r) => r.json())
      .catch(() => ({ supabaseUrl: '', googleEnabled: false, meta: { appId: '', configId: '', graphVersion: 'v22.0' } }));
    return configPromise;
  },
  register: (form: RegisterForm) => post<SessionResult>('/api/auth/register', form),
  login: (email: string, password: string) => post<SessionResult>('/api/auth/login', { email, password }),
  google: (accessToken: string) =>
    post<SessionResult & { needsProfile?: boolean; profile?: GoogleProfile }>('/api/auth/google', { accessToken }),
  // Google sign-ups have no password — they sign in with Google.
  // ---- Book a demo ----
  demoCalendar: (): Promise<DemoCalendar> => fetch(`${API}/api/demo/calendar`).then((r) => r.json()),
  demoSlots: (date: string): Promise<{ slots: DemoSlot[]; closed?: string }> =>
    fetch(`${API}/api/demo/slots?date=${encodeURIComponent(date)}`).then((r) => r.json()),
  bookDemo: (body: DemoBooking) =>
    post<{ success: boolean; rescheduled: boolean; data: { date: string; slot: string; timezone: string } }>(
      '/api/demo/requests',
      body,
    ),
  googleComplete: (accessToken: string, form: Pick<RegisterForm, 'firstName' | 'lastName' | 'phone' | 'category'>) =>
    post<SessionResult>('/api/auth/google/complete', { accessToken, ...form }),
};

// ---- Google sign-in (through Supabase Auth) ----

const GOOGLE_KEY = 'crm_google_signup';

const authorizeUrl = (cfg: SiteConfig, back: string) =>
  `${cfg.supabaseUrl}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(back)}`;

// Set while a popup attempt is running. Google's pages cut the popup's link to
// this window (COOP), and some browsers then also clear window.name, so when
// Supabase lands the popup on the site root (/#access_token=…) instead of
// /auth-callback.html, this is how that page knows it's the popup.
const POPUP_KEY = 'kapso-google-popup';
const POPUP_TTL = 10 * 60_000;
// Where a full-page Google sign-in started, and the error to show there.
const FROM_KEY = 'kapso-google-from';
const ERROR_KEY = 'kapso-google-error';

/** True on a page that Supabase sent back to inside the sign-in popup. */
export function inGooglePopup(): boolean {
  if (window.name === 'kapso-google-signin' || window.opener) return true;
  try {
    const at = Number(localStorage.getItem(POPUP_KEY) || 0);
    return !!at && Date.now() - at < POPUP_TTL;
  } catch {
    return false;
  }
}

/** The popup has handed its result back: later pages aren't the popup. */
export function clearGooglePopupMark() {
  try { localStorage.removeItem(POPUP_KEY); } catch { /* ignore */ }
}

/** Full-page Google sign-in in this window: no popup involved at all. */
export async function redirectToGoogle() {
  const cfg = await siteApi.config();
  if (!cfg.supabaseUrl || !cfg.googleEnabled) {
    throw new Error('Google sign-in isn’t switched on yet. Use your email and password for now.');
  }
  cancelPrevious?.();
  try {
    localStorage.removeItem(POPUP_KEY);
    sessionStorage.setItem(FROM_KEY, window.location.hash || '#/login');
  } catch { /* ignore */ }
  window.location.href = authorizeUrl(cfg, `${window.location.origin}${window.location.pathname}`);
}

/** The page a full-page Google sign-in started from (#/login, #/register). */
export function googleStartRoute(): string {
  try {
    const r = sessionStorage.getItem(FROM_KEY) || '';
    sessionStorage.removeItem(FROM_KEY);
    return /^#\/(login|register)/.test(r) ? r.replace(/^#\/register\/google.*/, '#/register') : '#/login';
  } catch {
    return '#/login';
  }
}

/** Leave a Google sign-in error for the Login / Register page to show. */
export function setGoogleError(message: string) {
  try { sessionStorage.setItem(ERROR_KEY, message); } catch { /* ignore */ }
}
export function googleError(): string {
  try {
    return sessionStorage.getItem(ERROR_KEY) || '';
  } catch {
    return '';
  }
}
export function clearGoogleError() {
  try { sessionStorage.removeItem(ERROR_KEY); } catch { /* ignore */ }
}

let cancelPrevious: (() => void) | null = null;

/**
 * Google sign-in in a popup window, the way most sites do it, so the page the
 * user was on stays put underneath.
 *
 * The popup is opened synchronously (straight from the click, or the browser
 * blocks it) on a blank page, then pointed at Google once the config is in.
 * Google → Supabase → /auth-callback.html, which hands the tokens back over a
 * BroadcastChannel and closes itself.
 *
 * popup.closed is never read: once the popup is on Google's pages the browser
 * blocks that call (COOP) and reports the popup as closed while it's still
 * open. Instead `onStalled` fires when the user comes back to this window and
 * no result follows within a few seconds; the attempt keeps listening, so a
 * late result still signs in.
 *
 * Resolves with the sign-in result, or null after 10 minutes without one (or
 * when a newer attempt replaces this one). Falls back to a full-page redirect
 * when popups are blocked.
 */
export function googleSignInPopup(
  { onStalled }: { onStalled?: () => void } = {},
): Promise<{ accessToken?: string; error?: string } | null> {
  // Only one attempt listens at a time, so an abandoned popup can't sign in
  // alongside a newer one.
  cancelPrevious?.();
  const w = 500;
  const h = 640;
  const left = Math.max(0, window.screenX + (window.outerWidth - w) / 2);
  const top = Math.max(0, window.screenY + (window.outerHeight - h) / 2.5);
  const popup = window.open(
    'about:blank',
    'kapso-google-signin',
    `popup=yes,width=${w},height=${h},left=${Math.round(left)},top=${Math.round(top)}`,
  );

  try { localStorage.setItem(POPUP_KEY, String(Date.now())); } catch { /* ignore */ }

  return new Promise((resolve, reject) => {
    let done = false;
    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('kapso-auth') : null;
    let stallTimer: ReturnType<typeof setTimeout> | undefined;

    const cleanUp = () => {
      done = true;
      if (cancelPrevious === cancelThis) cancelPrevious = null;
      channel?.close();
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('message', onMessage);
      window.removeEventListener('focus', onFocus);
      clearTimeout(stallTimer);
      clearTimeout(giveUp);
    };
    const finish = (value: { accessToken?: string; error?: string } | null) => {
      if (done) return;
      cleanUp();
      resolve(value);
    };
    const take = (data: unknown) => {
      const m = data as { type?: string; hash?: string } | null;
      if (m?.type !== 'kapso-google-auth') return;
      finish(readOAuthReturn(m.hash || '') || { error: 'Google sign-in did not return a result.' });
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'kapso-google-auth' && e.newValue) {
        try {
          take(JSON.parse(e.newValue));
        } catch {
          /* ignore */
        }
      }
    };
    const onMessage = (e: MessageEvent) => {
      if (e.origin === window.location.origin) take(e.data);
    };
    // Back in this window (popup closed, or the user clicked away from it) and
    // nothing arrived a few seconds later: let the button reset.
    const onFocus = () => {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        if (!done) onStalled?.();
      }, 4000);
    };
    const cancelThis = () => finish(null);
    cancelPrevious = cancelThis;
    if (channel) channel.onmessage = (e) => take(e.data);
    window.addEventListener('storage', onStorage);
    window.addEventListener('message', onMessage);
    window.addEventListener('focus', onFocus);
    const giveUp = setTimeout(() => finish(null), POPUP_TTL);

    siteApi
      .config()
      .then((cfg) => {
        if (!cfg.supabaseUrl || !cfg.googleEnabled) {
          popup?.close();
          throw new Error('Google sign-in isn’t switched on yet. Use your email and password for now.');
        }
        const url = authorizeUrl(cfg, `${window.location.origin}/auth-callback.html`);
        // Still on its same-origin about:blank here, so reading .closed is fine.
        if (!popup || popup.closed) {
          // Popup blocked: do it in this window instead.
          finish(null);
          return redirectToGoogle();
        }
        popup.location.href = url;
        popup.focus();
      })
      .catch((err) => {
        if (done) return;
        cleanUp();
        reject(err);
      });
  });
}

/** Kept for callers that want the old full-page behaviour. */
export const startGoogleSignIn = redirectToGoogle;

/** Tokens Supabase put in the URL fragment after the Google redirect, if any. */
export function readOAuthReturn(hash: string): { accessToken?: string; error?: string } | null {
  if (!/(^|&)(access_token|error)=/.test(hash)) return null;
  const p = new URLSearchParams(hash);
  if (p.get('error')) return { error: p.get('error_description') || p.get('error') || 'Google sign-in failed' };
  return { accessToken: p.get('access_token') || '' };
}

/** A Google sign-up waiting for its phone / password / category. */
export function savePendingGoogle(v: { accessToken: string; profile: GoogleProfile }) {
  sessionStorage.setItem(GOOGLE_KEY, JSON.stringify(v));
}
export function pendingGoogle(): { accessToken: string; profile: GoogleProfile } | null {
  try {
    return JSON.parse(sessionStorage.getItem(GOOGLE_KEY) || 'null');
  } catch {
    return null;
  }
}
export function clearPendingGoogle() {
  sessionStorage.removeItem(GOOGLE_KEY);
}
