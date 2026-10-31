// "Connect WhatsApp Business Account" — Meta's Embedded Signup.
//
// The Facebook JS SDK opens Meta's signup popup for our Tech Provider app and
// configuration. When the customer finishes, Meta gives us:
//   • a short-lived `code` (FB.login's callback), which the backend exchanges
//     for the business's access token, and
//   • the WABA / phone number they picked, posted to this window as a
//     WA_EMBEDDED_SIGNUP message (best-effort — the backend can find them
//     from the token if it never arrives).
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CrmApi } from '../api';
import type { BusinessProfile } from '../types';
import { useConfirm, useNotify } from './Dialogs';
import { NUMBER_ACTIVATION_EVENT, SIGNUP_ACTIVATION_KEY } from '../numberStatus';
import './Settings.css';

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

interface MetaConfig {
  appId: string;
  configId: string;
  graphVersion: string;
}

let sdkPromise: Promise<FbSdk> | null = null;

// Our business categories → WhatsApp's own business-profile categories, which
// is what Embedded Signup's "category" field takes.
const WA_CATEGORY: Record<string, string> = {
  ecommerce: 'RETAIL',
  restaurant: 'RESTAURANT',
  grocery: 'GROCERY',
  hospital: 'HEALTH',
  salon: 'BEAUTY',
  gym: 'HEALTH',
  automobile: 'AUTO',
  professional: 'PROF_SERVICES',
  homeservices: 'PROF_SERVICES',
  hotel: 'HOTEL',
  rooms: 'HOTEL',
  events: 'EVENT_PLAN',
  education: 'EDU',
  finance: 'FINANCE',
  realestate: 'OTHER',
  logistics: 'OTHER',
  other: 'OTHER',
};

/** "919876543210" → { code: 91, number: "9876543210" } (last 10 digits are the number). */
function splitPhone(raw?: string): { code: number; number: string } | undefined {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length <= 10) return undefined; // no country code to split off
  return { code: Number(d.slice(0, d.length - 10)), number: d.slice(-10) };
}

/**
 * Embedded Signup pre-fill from what the business entered when it registered,
 * so Meta's form opens already filled in (it can still be edited there).
 * The registered business name is only the owner's name until WhatsApp is
 * connected, so it isn't offered as the business name.
 */
function prefillFrom(b?: BusinessProfile) {
  if (!b) return {};
  const ownerName = `${b.ownerFirstName || ''} ${b.ownerLastName || ''}`.trim();
  const realName = b.name && b.name !== ownerName ? b.name : '';
  const phone = splitPhone(b.ownerPhone);
  const business: Record<string, unknown> = {};
  if (realName) business.name = realName;
  if (b.email) business.email = b.email;
  if (phone) business.phone = phone;
  const waPhone: Record<string, unknown> = {};
  if (realName) waPhone.displayName = realName;
  const category = WA_CATEGORY[b.category || ''];
  if (category) waPhone.category = category;
  return {
    ...(Object.keys(business).length ? { business } : {}),
    ...(Object.keys(waPhone).length ? { phone: waPhone } : {}),
  };
}

/**
 * Load and initialise the Facebook SDK once per page. Shared with Facebook
 * Login for Business (MetaBusinessLogin.tsx: Instagram, Messenger).
 */
export function loadSdk(appId: string, version: string): Promise<FbSdk> {
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise<FbSdk>((resolve, reject) => {
    const ready = () => {
      window.FB!.init({ appId, autoLogAppEvents: true, xfbml: false, version });
      resolve(window.FB!);
    };
    if (window.FB) return ready();
    window.fbAsyncInit = ready;
    const s = document.createElement('script');
    s.src = 'https://connect.facebook.net/en_US/sdk.js';
    s.async = true;
    s.defer = true;
    s.crossOrigin = 'anonymous';
    s.onerror = () => {
      sdkPromise = null;
      reject(new Error('Could not load Facebook’s sign-in script. Check your connection or ad blocker and try again.'));
    };
    document.body.appendChild(s);
  });
  return sdkPromise;
}

interface SessionInfo {
  wabaId?: string;
  phoneNumberId?: string;
  metaBusinessId?: string;
  cancelledAt?: string;
  error?: string;
}

const isFacebookOrigin = (origin: string) => {
  try {
    return /(^|\.)facebook\.com$/.test(new URL(origin).hostname);
  } catch {
    return false;
  }
};

/**
 * Embedded Signup as a hook: `connect()` must run straight from a click so the
 * browser allows Meta's popup, which is why the SDK is loaded ahead of time.
 */
export function useEmbeddedSignup(
  api: CrmApi,
  onConnected: (b: BusinessProfile) => void,
  business?: BusinessProfile,
) {
  const notify = useNotify();
  const confirm = useConfirm();
  const [cfg, setCfg] = useState<MetaConfig | null>(null);
  const [publicUrl, setPublicUrl] = useState('');
  const [sdk, setSdk] = useState<FbSdk | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const session = useRef<SessionInfo>({});

  useEffect(() => {
    let live = true;
    api
      .getAuthConfig()
      .then((r) => {
        if (!live) return;
        setCfg(r.meta);
        setPublicUrl(r.publicUrl || '');
        // On an http:// page Meta's popup can't run, so don't load its SDK.
        if (window.location.protocol !== 'https:') return;
        if (!r.meta?.appId || !r.meta?.configId) {
          setProblem('WhatsApp signup isn’t configured on the server yet.');
          return;
        }
        loadSdk(r.meta.appId, r.meta.graphVersion || 'v22.0')
          .then((fb) => live && setSdk(fb))
          .catch((e) => live && setProblem(e.message));
      })
      .catch(() => live && setProblem('Could not reach the server.'));
    return () => {
      live = false;
    };
  }, [api]);

  // Meta reports the chosen WABA / number (or a cancel) by postMessage.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!isFacebookOrigin(event.origin)) return;
      let data: { type?: string; event?: string; data?: Record<string, string> } | null = null;
      try {
        data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      } catch {
        return;
      }
      if (data?.type !== 'WA_EMBEDDED_SIGNUP') return;
      const d = data.data || {};
      if (String(data.event || '').startsWith('FINISH')) {
        session.current = { wabaId: d.waba_id, phoneNumberId: d.phone_number_id, metaBusinessId: d.business_id };
      } else if (data.event === 'CANCEL') {
        session.current = { cancelledAt: d.current_step || 'unknown' };
      } else if (data.event === 'ERROR') {
        session.current = { error: d.error_message || 'Meta reported an error during signup.' };
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const finish = useCallback(
    async (code: string) => {
      // The session message can land just after the login callback.
      for (let i = 0; i < 10 && !session.current.wabaId && !session.current.error; i++) {
        await new Promise((r) => setTimeout(r, 150));
      }
      const s = session.current;
      try {
        const r = await api.completeEmbeddedSignup({
          code,
          wabaId: s.wabaId,
          phoneNumberId: s.phoneNumberId,
          metaBusinessId: s.metaBusinessId,
        });
        const num = r.business.meta?.displayPhoneNumber;
        if (r.activation?.needed) {
          // Linked, but Meta lists the number as Pending: Channel Status
          // shows "Pending — activate this number" with the reason.
          try {
            sessionStorage.setItem(SIGNUP_ACTIVATION_KEY, JSON.stringify(r.activation));
          } catch {
            /* ignore */
          }
          notify(
            'error',
            'One more step: activate your number',
            `${num || 'Your number'} is linked but still Pending at Meta. Press Activate on Channel Status to start messaging.`,
          );
        } else {
          notify(
            'success',
            'WhatsApp connected',
            num ? `${num} is now connected to your CRM.` : 'Your WhatsApp Business Account is now connected.',
          );
        }
        for (const w of r.warnings || []) notify('error', 'Heads up', w);
        onConnected(r.business);
        if (r.activation?.needed) {
          window.dispatchEvent(new CustomEvent(NUMBER_ACTIVATION_EVENT, { detail: r.activation }));
        }
      } catch (e) {
        notify('error', 'Could not connect WhatsApp', e instanceof Error ? e.message : undefined);
      } finally {
        setBusy(false);
      }
    },
    [api, notify, onConnected],
  );

  const connect = useCallback(() => {
    // Meta refuses FB.login on any http:// page, localhost included. Offer to
    // move to the site's https address instead of a popup that can only fail.
    if (window.location.protocol !== 'https:') {
      if (/^https:\/\//.test(publicUrl)) {
        confirm({
          title: 'Switch to the secure link?',
          message: `Meta only allows WhatsApp signup on an https:// page. The CRM will open at ${publicUrl} — sign in there once, then click Connect again.`,
          confirmLabel: 'Open secure link',
          cancelLabel: 'Not now',
          tone: 'primary',
        }).then((go) => {
          // Closing the dialog rewinds its Back-button history entry; a
          // navigation started in the same tick gets cancelled by that rewind.
          if (go) setTimeout(() => window.location.assign(`${publicUrl}/#/login`), 300);
        });
      } else {
        notify('error', 'Open the CRM over https', 'Meta only allows WhatsApp signup from an https:// address, and no https address is set up for this server (PUBLIC_BASE_URL).');
      }
      return;
    }
    if (problem) {
      notify('error', 'Can’t start WhatsApp signup', problem);
      return;
    }
    if (!sdk || !cfg) {
      notify('error', 'Still loading', 'Give it a second and click again.');
      return;
    }
    session.current = {};
    setBusy(true);
    // FB.login wants a plain (non-async) callback.
    sdk.login(
      (response) => {
        const code = response?.authResponse?.code;
        if (code) {
          void finish(code);
          return;
        }
        setBusy(false);
        const s = session.current;
        if (s.error) notify('error', 'WhatsApp signup failed', s.error);
        else notify('error', 'Signup not finished', 'The WhatsApp signup window was closed before it finished.');
      },
      {
        config_id: cfg.configId,
        response_type: 'code',
        override_default_response_type: true,
        extras: { setup: prefillFrom(business), featureType: '', sessionInfoVersion: '3' },
      },
    );
  }, [cfg, sdk, problem, finish, notify, confirm, publicUrl, business]);

  return { connect, busy, ready: !!sdk && !problem, problem };
}

/** The button itself. */
export function ConnectWhatsAppButton({
  api,
  onConnected,
  business,
  label = 'Connect WhatsApp Business Account',
  variant = 'primary',
}: {
  api: CrmApi;
  onConnected: (b: BusinessProfile) => void;
  /** The signed-in business — its registration details pre-fill Meta's form. */
  business?: BusinessProfile;
  label?: string;
  variant?: 'primary' | 'ghost';
}) {
  const { connect, busy } = useEmbeddedSignup(api, onConnected, business);
  return (
    <button
      type="button"
      className={`k-btn${variant === 'ghost' ? ' ghost' : ''} cw-btn`}
      onClick={connect}
      disabled={busy}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2c-1.5 0-3-.4-4.3-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1c-.2.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.4.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2s.2-1.1.2-1.2-.2-.2-.5-.3z"
        />
      </svg>
      {busy ? 'Connecting…' : label}
    </button>
  );
}

/** Top-of-CRM bar shown until WhatsApp is connected. */
export function ConnectWhatsAppBar({
  api,
  onConnected,
  business,
}: {
  api: CrmApi;
  onConnected: (b: BusinessProfile) => void;
  business?: BusinessProfile;
}) {
  return (
    <div className="cw-bar" role="region" aria-label="Connect WhatsApp">
      <span className="material-icons" aria-hidden="true">link_off</span>
      <div className="cw-bar-text">
        <strong>Your WhatsApp number isn’t connected yet</strong>
        <small>Connect your WhatsApp Business Account to start receiving and sending messages.</small>
      </div>
      <ConnectWhatsAppButton api={api} onConnected={onConnected} business={business} />
    </div>
  );
}
