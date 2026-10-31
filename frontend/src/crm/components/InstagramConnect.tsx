// Channel Status → Instagram → Connect:
//   1. "Connect Instagram to your CRM": the banner dialog (same look as the
//      Catalog / Payment configuration dialogs, CatalogPage.css crm-cat-modal-*),
//   2. "Choose how to connect Instagram": Log in with Instagram (Business Login
//      for Instagram, no Facebook Page needed) or Log in with Facebook (the
//      existing Login for Business popup and Page picker).
// Both dialogs: Esc / Back (useBackHandler) / backdrop close, Tab stays inside.
//
// Log in with Instagram runs in a popup opened straight from the click (so it
// isn't blocked), the same way as the Google sign-in popup (siteApi.ts):
// about:blank first, then Instagram's authorize URL from
// GET /api/channels/instagram/login-url. Instagram sends the popup back to
// /instagram-callback.html, which hands { code, state } to this window over
// postMessage (this origin only), BroadcastChannel and localStorage, then
// closes. The code is exchanged on the server; no token reaches the browser.
import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import type { CrmApi } from '../api';
import { authConfig } from '../metaSdk';
import { useBackHandler } from '../useBackHandler';
import './CatalogPage.css';
import './InstagramConnect.css';

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])';

/** Meta's help page on switching an Instagram account to a professional (business) account. */
export const IG_PROFESSIONAL_HELP = 'https://help.instagram.com/502981923235522';

export const INSTAGRAM_LOGIN_NOT_CONFIGURED =
  'Log in with Instagram isn’t set up on this server yet. The platform owner needs to add the Instagram product ' +
  '(API setup with Instagram login) to the Meta app and set INSTAGRAM_APP_ID and INSTAGRAM_APP_SECRET.';

export type InstagramMethod = 'instagram' | 'facebook';

// ------------------------------------------------------------ dialog keys --

/** Back / Esc close, focus starts inside (on [data-autofocus] if any), Tab stays inside, focus restored on close. */
function useDialogBehaviour(boxRef: RefObject<HTMLDivElement>, close: () => void) {
  const live = useRef(close);
  live.current = close;
  useBackHandler(true, () => live.current());
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const box = boxRef.current;
    const first = box?.querySelector<HTMLElement>('[data-autofocus]:not(:disabled)') || box?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      // A confirm dialog on top handles its own keys.
      if (document.querySelector('.app-dialog')) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        live.current();
        return;
      }
      if (e.key !== 'Tab' || !boxRef.current) return;
      const els = Array.from(boxRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (!els.length) return;
      const firstEl = els[0];
      const lastEl = els[els.length - 1];
      const inside = boxRef.current.contains(document.activeElement);
      if (e.shiftKey && (document.activeElement === firstEl || !inside)) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && (document.activeElement === lastEl || !inside)) {
        e.preventDefault();
        firstEl.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (prev && document.contains(prev)) prev.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

// ----------------------------------------------------------------- icons --

function LinkStepIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function ReplyStepIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <path d="M8 9h8M8 13h5" />
    </svg>
  );
}

/** A Facebook Page (flag), in Facebook blue: no Facebook logo artwork. */
function FacebookPageIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1877f2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 22V4" />
      <path d="M4 4h12l-2 4 2 4H4" />
    </svg>
  );
}

// ------------------------------------------------------ 1. banner dialog --

export function InstagramIntroDialog({ onClose, onGetStarted }: { onClose: () => void; onGetStarted: () => void }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  useDialogBehaviour(boxRef, onClose);
  return (
    <div className="crm-cat-modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={boxRef}
        className="crm-cat-modal-box ig-connect-box"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        data-testid="ig-intro-dialog"
      >
        <div className="crm-cat-modal-banner-wrap ig-banner-wrap">
          <img src="/instagram_banner.svg" alt="" className="crm-cat-modal-banner ig-banner" />
          <button type="button" className="crm-cat-modal-close-btn" onClick={onClose} title="Close" aria-label="Close">
            ✕
          </button>
        </div>
        <div className="crm-cat-modal-body">
          <h3 className="crm-cat-modal-title" id={titleId}>
            Connect Instagram to your CRM
          </h3>
          <p className="crm-cat-modal-sub" id={descId}>
            Answer your Instagram direct messages from the CRM, in the same inbox as WhatsApp.
          </p>
          <div className="crm-cat-steps-list">
            <div className="crm-cat-step-item">
              <div className="crm-cat-step-icon">
                <LinkStepIcon />
              </div>
              <div className="crm-cat-step-content">
                <h4 className="crm-cat-step-title">Connect</h4>
                <p className="crm-cat-step-desc">
                  Log in with your Instagram professional account, or with Facebook and pick the Page it’s linked to.
                </p>
              </div>
            </div>
            <div className="crm-cat-step-item">
              <div className="crm-cat-step-icon">
                <ReplyStepIcon />
              </div>
              <div className="crm-cat-step-content">
                <h4 className="crm-cat-step-title">Reply from the CRM</h4>
                <p className="crm-cat-step-desc">
                  New direct messages arrive in your Chats. Reply with text and photos within 24 hours of the customer’s
                  last message.
                </p>
              </div>
            </div>
          </div>
        </div>
        <div className="crm-cat-modal-footer">
          <p className="crm-cat-disclaimer">
            By continuing, you accept the{' '}
            <a href="https://help.instagram.com/581066165581870" target="_blank" rel="noopener noreferrer">
              Instagram Terms of Use
            </a>{' '}
            and{' '}
            <a href="https://www.facebook.com/legal/terms" target="_blank" rel="noopener noreferrer">
              Meta Terms of Service
            </a>
            .
          </p>
          <button type="button" className="crm-cat-get-started-btn" onClick={onGetStarted} data-autofocus data-testid="ig-get-started">
            Get started
          </button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------ 2. choose method --

export function InstagramMethodDialog({
  igLoaded,
  igConfigured,
  fbConfigured,
  fbPreparing = false,
  fbNotConfiguredText,
  initialMethod,
  busy,
  error,
  onCancel,
  onConnectInstagram,
  onConnectFacebook,
}: {
  igLoaded: boolean;
  igConfigured: boolean;
  fbConfigured: boolean;
  /** Meta's sign-in script is still loading (Log in with Facebook waits for it). */
  fbPreparing?: boolean;
  fbNotConfiguredText: string;
  initialMethod?: InstagramMethod;
  /** '' | 'popup' (Instagram's window is open) | 'connecting' (the code is being exchanged). */
  busy: '' | 'popup' | 'connecting';
  error: string;
  onCancel: () => void;
  /** Opens Instagram's popup: called straight from the click. */
  onConnectInstagram: () => void;
  /** Runs FB.login: called straight from the click. */
  onConnectFacebook: () => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [method, setMethod] = useState<InstagramMethod>(
    initialMethod || (igConfigured || !igLoaded ? 'instagram' : 'facebook'),
  );
  const [isPro, setIsPro] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  // Config arrives after the dialog opened: fall back to Facebook when Instagram isn't set up.
  useEffect(() => {
    if (igLoaded && !igConfigured && method === 'instagram' && fbConfigured) setMethod('facebook');
  }, [igLoaded, igConfigured, fbConfigured, method]);

  const close = () => {
    if (busy !== 'connecting') onCancel();
  };
  useDialogBehaviour(boxRef, close);

  const igReady = igConfigured && isPro && isAdmin;
  const fbWaiting = method === 'facebook' && fbConfigured && fbPreparing;
  const canConnect = busy === '' && (method === 'instagram' ? igReady : fbConfigured && !fbPreparing);
  const label = busy === 'popup'
    ? 'Waiting for Instagram…'
    : busy === 'connecting'
      ? 'Connecting…'
      : fbWaiting
        ? 'Preparing…'
        : 'Connect Instagram';

  return (
    <div className="crm-cat-modal-backdrop" onClick={(e) => e.target === e.currentTarget && close()}>
      <div
        ref={boxRef}
        className="crm-cat-modal-box ig-connect-box ig-method-box"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="ig-method-dialog"
      >
        <div className="ig-method-head">
          <h3 className="crm-cat-modal-title" id={titleId}>
            Choose how to connect Instagram
          </h3>
          <button type="button" className="ig-method-close" onClick={close} disabled={busy === 'connecting'} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="crm-cat-modal-body ig-method-body">
          <div className="ig-method-options" role="radiogroup" aria-labelledby={titleId}>
            <label
              className={`ig-method-card${method === 'instagram' ? ' selected' : ''}${!igConfigured ? ' disabled' : ''}`}
              data-testid="ig-method-instagram"
            >
              <input
                type="radio"
                name="ig-method"
                value="instagram"
                checked={method === 'instagram'}
                onChange={() => setMethod('instagram')}
                disabled={!igConfigured || busy !== ''}
                data-autofocus={method === 'instagram' ? true : undefined}
              />
              <span className="ig-method-icon">
                <img src="/channel-instagram.svg" alt="" />
              </span>
              <span className="ig-method-text">
                <span className="ig-method-title">
                  Log in with Instagram <span className="ig-method-badge">Faster</span>
                </span>
                <span className="ig-method-desc">Use your Instagram account to log in. Fast and easy way to connect.</span>
                {igLoaded && !igConfigured && (
                  <span className="ig-method-off" data-testid="ig-method-instagram-off">
                    {INSTAGRAM_LOGIN_NOT_CONFIGURED}
                  </span>
                )}
                {!igLoaded && <span className="ig-method-off muted">Checking…</span>}
              </span>
            </label>
            {method === 'instagram' && igConfigured && (
              <div className="ig-prereq" data-testid="ig-prereq">
                <p className="ig-prereq-title">Before you continue</p>
                <label className="ig-prereq-item">
                  <input type="checkbox" checked={isPro} onChange={(e) => setIsPro(e.target.checked)} disabled={busy !== ''} data-testid="ig-prereq-pro" />
                  <span>
                    I have an Instagram professional account{' '}
                    <a href={IG_PROFESSIONAL_HELP} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
                      (how to switch)
                    </a>
                  </span>
                </label>
                <label className="ig-prereq-item">
                  <input type="checkbox" checked={isAdmin} onChange={(e) => setIsAdmin(e.target.checked)} disabled={busy !== ''} data-testid="ig-prereq-admin" />
                  <span>I have admin access to that account</span>
                </label>
              </div>
            )}

            <label
              className={`ig-method-card${method === 'facebook' ? ' selected' : ''}${!fbConfigured ? ' disabled' : ''}`}
              data-testid="ig-method-facebook"
            >
              <input
                type="radio"
                name="ig-method"
                value="facebook"
                checked={method === 'facebook'}
                onChange={() => setMethod('facebook')}
                disabled={!fbConfigured || busy !== ''}
                data-autofocus={method === 'facebook' ? true : undefined}
              />
              <span className="ig-method-icon fb">
                <FacebookPageIcon />
              </span>
              <span className="ig-method-text">
                <span className="ig-method-title">Log in with Facebook</span>
                <span className="ig-method-desc">Sign in with Facebook, then pick the linked Instagram account.</span>
                {!fbConfigured && (
                  <span className="ig-method-off" data-testid="ig-method-facebook-off">
                    {fbNotConfiguredText}
                  </span>
                )}
              </span>
            </label>
          </div>
          {error && (
            <p className="ig-method-error" role="alert" data-testid="ig-method-error">
              {error}
            </p>
          )}
        </div>
        <div className="crm-cat-modal-footer ig-method-footer">
          <button type="button" className="ig-method-cancel" onClick={close} disabled={busy === 'connecting'}>
            Cancel
          </button>
          <button
            type="button"
            className="crm-cat-get-started-btn"
            disabled={!canConnect}
            onClick={() => (method === 'instagram' ? onConnectInstagram() : onConnectFacebook())}
            data-testid="ig-method-connect"
          >
            {label}
          </button>
        </div>
      </div>
    </div>
  );
}

// --------------------------------------------- Log in with Instagram popup --

/** Whether Log in with Instagram is configured (/api/auth/config) and the CRM's public https address. */
export function useInstagramLoginConfig(api: CrmApi) {
  const [state, setState] = useState({ loaded: false, configured: false, publicUrl: '' });
  useEffect(() => {
    let live = true;
    // Shared with the other Meta buttons: one /api/auth/config request.
    authConfig(api)
      .then((r) => live && setState({ loaded: true, configured: !!r.meta?.instagramLoginConfigured, publicUrl: r.publicUrl || '' }))
      .catch(() => live && setState({ loaded: true, configured: false, publicUrl: '' }));
    return () => {
      live = false;
    };
  }, [api]);
  return state;
}

type AuthMessage = {
  type?: string;
  code?: string;
  state?: string;
  error?: string;
  errorReason?: string;
  errorDescription?: string;
};

export class InstagramLoginError extends Error {
  code: string;
  redirectOrigin: string;
  constructor(message: string, code = 'INSTAGRAM_LOGIN_FAILED', redirectOrigin = '') {
    super(message);
    this.name = 'InstagramLoginError';
    this.code = code;
    this.redirectOrigin = redirectOrigin;
  }
}

const POPUP_NAME = 'crm-instagram-login';
const POPUP_TTL = 10 * 60_000;
let cancelPrevious: (() => void) | null = null;

/** Stop listening for an open Instagram login (its popup may stay open; a late result is ignored). */
export function cancelInstagramLogin() {
  cancelPrevious?.();
}

/**
 * Log in with Instagram in a popup. MUST be called synchronously from the
 * click (window.open runs first). Resolves { code, state } for
 * POST /api/channels/instagram/connect, or null when the attempt was
 * replaced / cancelled / timed out (10 minutes). Rejects an
 * InstagramLoginError: popup blocked, Instagram's error (e.g. cancelled), or
 * WRONG_ORIGIN when the redirect page is on another origin than this tab.
 *
 * popup.closed is never read once the popup is on Instagram's pages (COOP
 * makes it unreliable): `onStalled` fires when the user is back in this
 * window and nothing arrived a few seconds later; the attempt keeps listening.
 */
export function openInstagramLogin(
  api: CrmApi,
  { onStalled }: { onStalled?: () => void } = {},
): Promise<{ code: string; state: string } | null> {
  cancelPrevious?.();
  const w = 520;
  const h = 720;
  const left = Math.max(0, window.screenX + (window.outerWidth - w) / 2);
  const top = Math.max(0, window.screenY + (window.outerHeight - h) / 2.5);
  const popup = window.open('about:blank', POPUP_NAME, `popup=yes,width=${w},height=${h},left=${Math.round(left)},top=${Math.round(top)}`);
  if (!popup) {
    return Promise.reject(
      new InstagramLoginError('Your browser blocked the Instagram login window. Allow pop-ups for this site, then click Connect Instagram again.', 'POPUP_BLOCKED'),
    );
  }

  return new Promise((resolve, reject) => {
    let done = false;
    let expected = '';
    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('crm-instagram-auth') : null;
    let stallTimer: ReturnType<typeof setTimeout> | undefined;

    const cleanUp = () => {
      done = true;
      if (cancelPrevious === cancelThis) cancelPrevious = null;
      channel?.close();
      window.removeEventListener('message', onMessage);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', onFocus);
      clearTimeout(stallTimer);
      clearTimeout(giveUp);
    };
    const finish = (value: { code: string; state: string } | null) => {
      if (done) return;
      cleanUp();
      resolve(value);
    };
    const fail = (err: Error) => {
      if (done) return;
      cleanUp();
      reject(err);
    };
    const take = (data: unknown) => {
      const m = data as AuthMessage | null;
      if (!m || m.type !== 'crm-instagram-auth') return;
      // A result for another (older) attempt: not ours.
      if (expected && m.state && m.state !== expected) return;
      if (m.error) {
        fail(
          new InstagramLoginError(
            m.error === 'access_denied' ? 'The Instagram login was cancelled.' : m.errorDescription || 'Instagram didn’t finish the login.',
            m.error === 'access_denied' ? 'CANCELLED' : 'INSTAGRAM_ERROR',
          ),
        );
        return;
      }
      if (!m.code || !m.state) {
        fail(new InstagramLoginError('Instagram didn’t return a login code. Try again.'));
        return;
      }
      finish({ code: m.code, state: m.state });
    };
    const onMessage = (e: MessageEvent) => {
      // Only our own origin (instagram-callback.html) may answer.
      if (e.origin !== window.location.origin) return;
      take(e.data);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key !== 'crm-instagram-auth' || !e.newValue) return;
      try {
        take(JSON.parse(e.newValue));
      } catch {
        /* ignore */
      }
    };
    const onFocus = () => {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        if (!done) onStalled?.();
      }, 4000);
    };
    const cancelThis = () => finish(null);
    cancelPrevious = cancelThis;
    if (channel) channel.onmessage = (e) => take(e.data);
    window.addEventListener('message', onMessage);
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', onFocus);
    const giveUp = setTimeout(() => finish(null), POPUP_TTL);

    api
      .getInstagramLoginUrl()
      .then((r) => {
        if (done) return;
        let redirectOrigin = '';
        try {
          redirectOrigin = new URL(r.redirectUri).origin;
        } catch {
          /* checked below */
        }
        if (redirectOrigin !== window.location.origin) {
          popup.close();
          fail(
            new InstagramLoginError(
              'Instagram sends the login back to the CRM’s public address, so it has to be started from there.',
              'WRONG_ORIGIN',
              redirectOrigin,
            ),
          );
          return;
        }
        // Still on its same-origin about:blank here, so reading .closed is fine.
        if (popup.closed) {
          finish(null);
          return;
        }
        expected = r.state;
        popup.location.href = r.url;
        popup.focus();
      })
      .catch((err: unknown) => {
        try {
          popup.close();
        } catch {
          /* ignore */
        }
        fail(err instanceof Error ? err : new InstagramLoginError('Could not start the Instagram login.'));
      });
  });
}
