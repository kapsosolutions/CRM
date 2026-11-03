// -----------------------------------------------------------------------------
// Desktop notifications that arrive even when the CRM is closed (Web Push).
//
// The service worker (public/sw.js) receives pushes from the backend and shows
// them, unless a CRM tab is in front (that tab plays its own alert). This file
// registers the worker, subscribes this browser for the signed-in business,
// keeps its Manage Notifications choices on the server, and unsubscribes on
// sign-out.
// -----------------------------------------------------------------------------
import type { CrmApi } from './api';
import { loadPrefs, type NotifyPrefs } from './notifyPrefs';

const ENDPOINT_KEY = 'crm_push_endpoint';

export type PushState =
  | 'on' // subscribed: desktop notifications also arrive when the CRM is closed
  | 'off' // Desktop nudge switched off on Settings
  | 'ask' // the browser hasn't been asked yet
  | 'blocked' // the browser blocks notifications for this site
  | 'unsupported' // no service workers / push here (or not https)
  | 'unavailable' // the server has no push keys: notifications only while a tab is open
  | 'error';

export function pushSupported(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

const savedEndpoint = (): string => {
  try {
    return localStorage.getItem(ENDPOINT_KEY) || '';
  } catch {
    return '';
  }
};
const setSavedEndpoint = (v: string) => {
  try {
    if (v) localStorage.setItem(ENDPOINT_KEY, v);
    else localStorage.removeItem(ENDPOINT_KEY);
  } catch {
    /* ignore */
  }
};

/** This browser is subscribed, so the service worker shows desktop notifications (the page mustn't as well). */
export function pushActive(): boolean {
  return pushSupported() && Notification.permission === 'granted' && !!savedEndpoint();
}

let registration: Promise<ServiceWorkerRegistration | null> | null = null;
/** Register the service worker once (also needed for clicks on its notifications). */
export function registerWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return Promise.resolve(null);
  if (!registration) {
    registration = navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then(() => navigator.serviceWorker.ready)
      .catch(() => null);
  }
  return registration;
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}
const sameKey = (a: ArrayBuffer | null | undefined, b: Uint8Array) => {
  if (!a) return false;
  const x = new Uint8Array(a);
  return x.length === b.length && x.every((v, i) => v === b[i]);
};

/**
 * Bring this browser's subscription in line with the choices: subscribe when
 * Desktop nudge is on and the browser allows it, remove it otherwise. Never
 * asks for permission itself (call askPermission() from a click for that).
 */
export async function syncPush(api: CrmApi, prefs: NotifyPrefs = loadPrefs()): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  const perm = Notification.permission;
  if (perm === 'denied') return 'blocked';
  const reg = await registerWorker();
  if (!reg) return 'unsupported';
  const existing = await reg.pushManager.getSubscription().catch(() => null);
  if (!prefs.allowDesktop || perm !== 'granted') {
    if (existing) {
      await api.pushUnsubscribe(existing.endpoint).catch(() => {});
      await existing.unsubscribe().catch(() => {});
    }
    setSavedEndpoint('');
    return prefs.allowDesktop ? 'ask' : 'off';
  }
  try {
    const k = await api.getPushKey();
    if (!k.enabled || !k.publicKey) {
      setSavedEndpoint('');
      return 'unavailable';
    }
    const key = keyBytes(k.publicKey);
    let sub = existing;
    // Subscribed with an older server key: start again with the current one.
    if (sub && !sameKey(sub.options?.applicationServerKey, key)) {
      await sub.unsubscribe().catch(() => {});
      sub = null;
    }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    await api.pushSubscribe(sub.toJSON(), prefs);
    setSavedEndpoint(sub.endpoint);
    return 'on';
  } catch {
    return 'error';
  }
}

/** Ask the browser for permission (from a click), then subscribe. */
export async function askPermission(api: CrmApi): Promise<PushState> {
  if (!pushSupported()) {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') await Notification.requestPermission().catch(() => 'default');
    return 'unsupported';
  }
  const r = await Notification.requestPermission().catch(() => 'default' as NotificationPermission);
  if (r === 'denied') return 'blocked';
  if (r !== 'granted') return 'ask';
  return syncPush(api);
}

/** The choices changed: tell the server, so pushes follow them. */
export function pushPrefsChanged(api: CrmApi, prefs: NotifyPrefs): Promise<PushState> {
  const ep = savedEndpoint();
  // Switching Desktop nudge on or off adds or removes the subscription.
  if (!prefs.allowDesktop || !ep) return syncPush(api, prefs);
  return api.pushPrefs(ep, prefs).then((r) => (r.found ? 'on' : syncPush(api, prefs))).catch(() => 'error' as PushState);
}

/** Signing out: this browser stops getting this business's notifications. */
export function pushSignOut(api: CrmApi): void {
  const ep = savedEndpoint();
  if (ep) api.pushUnsubscribeOnLeave(ep);
  setSavedEndpoint('');
}

// The chat open on screen in this tab ('' = none), so its own messages don't
// pop up a desktop notification while it's being read.
let watchingPhone = '';
export const currentlyWatching = () => watchingPhone;
const tellWorker = () => {
  try {
    navigator.serviceWorker?.controller?.postMessage({ type: 'crm-watching', phone: watchingPhone });
  } catch {
    /* ignore */
  }
};
if (pushSupported()) navigator.serviceWorker.addEventListener('controllerchange', tellWorker);
export function setWatchingChat(phone: string | null): void {
  watchingPhone = phone || '';
  if (pushSupported()) tellWorker();
}

/** Clicks on a notification while a tab is open: the worker posts what to open. */
export function onPushOpen(cb: (d: { id?: string; target?: { view?: string; id?: string; phone?: string } }) => void): () => void {
  if (!pushSupported()) return () => {};
  const h = (e: MessageEvent) => {
    if (e.data?.type === 'crm-open-notification') cb(e.data);
  };
  navigator.serviceWorker.addEventListener('message', h);
  return () => navigator.serviceWorker.removeEventListener('message', h);
}
