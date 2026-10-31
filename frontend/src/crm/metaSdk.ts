// One shared loader for Meta's Facebook JS SDK and the server's public Meta
// config (/api/auth/config), used by every "Connect with Meta" button:
// WhatsApp Embedded Signup, Instagram / Messenger, Ads and Catalog.
//
// Meta's popup (FB.login) has to open straight from the user's click, so the
// SDK must be ready BEFORE the click. That's why:
//   • the config is fetched once per API client and shared (not once per button);
//   • the SDK script is loaded once per page, with a timeout, and retried on failure;
//   • preloadMetaSdk() starts both early (the CRM calls it while WhatsApp isn't
//     connected yet), so the button is normally ready when it's shown;
//   • useMetaSdk() tells a button whether it's still preparing, so it can show
//     "Preparing…" instead of failing on an early click.
import { useCallback, useEffect, useState } from 'react';
import type { CrmApi } from './api';

interface FbLoginResponse {
  authResponse?: { code?: string } | null;
  status?: string;
}
export interface FbSdk {
  init(opts: Record<string, unknown>): void;
  login(cb: (r: FbLoginResponse) => void, opts: Record<string, unknown>): void;
}
declare global {
  interface Window {
    FB?: FbSdk;
    fbAsyncInit?: () => void;
  }
}

export type AuthConfig = Awaited<ReturnType<CrmApi['getAuthConfig']>>;

const SDK_SRC = 'https://connect.facebook.net/en_US/sdk.js';
const SDK_TIMEOUT_MS = 20_000;
export const SDK_LOAD_ERROR =
  'Could not load Meta’s sign-in. Check your internet connection or ad blocker, then click again.';

// ---- server config: one request per API client -----------------------------
// Keyed by client, so the demo's mock API never answers for a real session.
const configCache = new WeakMap<CrmApi, Promise<AuthConfig>>();

export function authConfig(api: CrmApi): Promise<AuthConfig> {
  let p = configCache.get(api);
  if (!p) {
    p = api.getAuthConfig();
    configCache.set(api, p);
    // A failed request isn't cached: the next call asks again.
    p.catch(() => configCache.delete(api));
  }
  return p;
}

// ---- Facebook SDK: one script per page --------------------------------------
let sdkPromise: Promise<FbSdk> | null = null;
let sdkReady: FbSdk | null = null;
// Every mounted button hears when the SDK becomes ready (even one whose own
// earlier attempt failed), so they all switch from "Try again" together.
const readyListeners = new Set<(fb: FbSdk) => void>();

/** Load and initialise the SDK once per page. Rejects after a timeout; a later call tries again. */
export function loadSdk(appId: string, version: string): Promise<FbSdk> {
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise<FbSdk>((resolve, reject) => {
    let settled = false;
    let script: HTMLScriptElement | null = null;
    const done = (ok: boolean, err?: string) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      if (ok && window.FB) {
        window.FB.init({ appId, autoLogAppEvents: true, xfbml: false, version });
        sdkReady = window.FB;
        resolve(window.FB);
        readyListeners.forEach((fn) => fn(window.FB!));
      } else {
        sdkPromise = null;
        // Leave a script that may still finish; remove only one that failed.
        if (err === 'error') script?.remove();
        reject(new Error(SDK_LOAD_ERROR));
      }
    };
    const timer = window.setTimeout(() => done(false, 'timeout'), SDK_TIMEOUT_MS);
    if (window.FB) {
      done(true);
      return;
    }
    window.fbAsyncInit = () => done(true);
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SDK_SRC}"]`);
    if (existing) {
      // An earlier attempt timed out but its script is still on the page:
      // wait for it (fbAsyncInit above) instead of adding a second copy.
      script = existing;
      existing.addEventListener('error', () => done(false, 'error'), { once: true });
      return;
    }
    script = document.createElement('script');
    script.src = SDK_SRC;
    script.async = true;
    script.defer = true;
    script.crossOrigin = 'anonymous';
    script.onerror = () => done(false, 'error');
    document.body.appendChild(script);
  });
  return sdkPromise;
}

const isHttpsPage = () => typeof window !== 'undefined' && window.location.protocol === 'https:';

/** Start fetching the config and loading the SDK now, ahead of any click. Never throws. */
export function preloadMetaSdk(api: CrmApi): void {
  if (!isHttpsPage()) return;
  authConfig(api)
    .then((r) => (r.meta?.appId ? loadSdk(r.meta.appId, r.meta.graphVersion || 'v22.0') : null))
    .catch(() => {
      /* the buttons retry on their own */
    });
}

/**
 * The server config + the SDK, for one button.
 * - `cfg`: /api/auth/config once it has arrived (null before).
 * - `sdk`: the initialised SDK (null until ready, and always null on http://).
 * - `error`: the config or the SDK couldn't be loaded; `retry()` tries again.
 */
export function useMetaSdk(api: CrmApi) {
  const [cfg, setCfg] = useState<AuthConfig | null>(null);
  const [sdk, setSdk] = useState<FbSdk | null>(() => sdkReady);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setError('');
    authConfig(api)
      .then((r) => {
        if (!live) return undefined;
        setCfg(r);
        // On an http:// page Meta's popup can't run, so the SDK isn't loaded.
        if (!isHttpsPage() || !r.meta?.appId) return undefined;
        return loadSdk(r.meta.appId, r.meta.graphVersion || 'v22.0').then((fb) => {
          if (live) setSdk(fb);
        });
      })
      .catch((e: unknown) => {
        if (!live) return;
        setError(e instanceof Error && e.message === SDK_LOAD_ERROR ? SDK_LOAD_ERROR : 'Could not reach the server. Check your connection, then click again.');
      });
    return () => {
      live = false;
    };
  }, [api, attempt]);

  // Another button's retry succeeded: this one is ready too.
  useEffect(() => {
    const onReady = (fb: FbSdk) => {
      setSdk(fb);
      setError('');
    };
    readyListeners.add(onReady);
    return () => {
      readyListeners.delete(onReady);
    };
  }, []);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { cfg, sdk, error, retry, https: isHttpsPage() };
}
