// Facebook Login for Business: Meta's login popup for Instagram + Messenger
// (and, later, the ads account). Same mechanism as WhatsApp Embedded Signup:
// the Facebook JS SDK (loaded once, ConnectWhatsApp.tsx loadSdk) and FB.login
// with a configuration id, response_type 'code' and
// override_default_response_type. The configuration id comes from
// /api/auth/config (META_BUSINESS_LOGIN_CONFIG_ID on the server); the code is
// exchanged on the server, so no token ever reaches the browser.
import { useCallback, useEffect, useState } from 'react';
import type { CrmApi } from '../api';
import type { MetaChannel, MetaPageOption } from '../types';
import { loadSdk, type FbSdk } from './ConnectWhatsApp';
import { useConfirm, useNotify } from './Dialogs';

/** Shown wherever the configuration id isn't set on the server yet. */
export const BUSINESS_LOGIN_NOT_CONFIGURED =
  'Instagram and Messenger connections aren’t set up on this server yet. The platform owner needs to create a ' +
  'Facebook Login for Business configuration in the Meta app and add its id to the server ' +
  '(META_BUSINESS_LOGIN_CONFIG_ID).';

type ConfigKey = 'businessLoginConfigId' | 'adsLoginConfigId' | 'catalogLoginConfigId' | 'messengerLoginConfigId';

/**
 * `login()` must run straight from a click so the browser allows Meta's
 * popup, which is why the SDK is loaded ahead of time. Resolves the code, or
 * null when the popup was closed / the user was sent to the https address.
 */
export function useMetaBusinessLogin(
  api: CrmApi,
  configKey: ConfigKey = 'businessLoginConfigId',
  what = 'Meta login',
  notConfiguredText = BUSINESS_LOGIN_NOT_CONFIGURED,
) {
  const notify = useNotify();
  const confirm = useConfirm();
  const [configId, setConfigId] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [publicUrl, setPublicUrl] = useState('');
  const [sdk, setSdk] = useState<FbSdk | null>(null);
  const [problem, setProblem] = useState('');

  useEffect(() => {
    let live = true;
    api
      .getAuthConfig()
      .then((r) => {
        if (!live) return;
        const id = String(r.meta?.[configKey] || '');
        setConfigId(id);
        setPublicUrl(r.publicUrl || '');
        setLoaded(true);
        // On an http:// page Meta's popup can't run, so don't load its SDK.
        if (window.location.protocol !== 'https:' || !id) return;
        if (!r.meta?.appId) {
          setProblem('The Meta app isn’t configured on the server (META_APP_ID).');
          return;
        }
        loadSdk(r.meta.appId, r.meta.graphVersion || 'v22.0')
          .then((fb) => live && setSdk(fb))
          .catch((e: Error) => live && setProblem(e.message));
      })
      .catch(() => {
        if (!live) return;
        setLoaded(true);
        setProblem('Could not reach the server.');
      });
    return () => {
      live = false;
    };
  }, [api, configKey]);

  const notConfigured = loaded && !configId;

  const login = useCallback((): Promise<string | null> => {
    if (notConfigured) {
      notify('error', 'Not set up yet', notConfiguredText);
      return Promise.resolve(null);
    }
    // Meta refuses FB.login on any http:// page, localhost included.
    if (window.location.protocol !== 'https:') {
      if (/^https:\/\//.test(publicUrl)) {
        void confirm({
          title: 'Switch to the secure link?',
          message: `Meta only allows ${what} on an https:// page. The CRM will open at ${publicUrl} — sign in there once, then click Connect again.`,
          confirmLabel: 'Open secure link',
          cancelLabel: 'Not now',
          tone: 'primary',
        }).then((go) => {
          // Let the dialog's Back-button entry rewind before navigating.
          if (go) setTimeout(() => window.location.assign(`${publicUrl}/#/login`), 300);
        });
      } else {
        notify('error', 'Open the CRM over https', `Meta only allows ${what} from an https:// address, and no https address is set up for this server (PUBLIC_BASE_URL).`);
      }
      return Promise.resolve(null);
    }
    if (problem) {
      notify('error', `Can’t start ${what}`, problem);
      return Promise.resolve(null);
    }
    if (!sdk || !configId) {
      notify('error', 'Still loading', 'Give it a second and click again.');
      return Promise.resolve(null);
    }
    return new Promise<string | null>((resolve) => {
      // FB.login wants a plain (non-async) callback, called synchronously from the click.
      sdk.login(
        (response) => {
          const code = response?.authResponse?.code;
          if (code) resolve(code);
          else {
            notify('error', 'Login not finished', 'Meta’s login window was closed before it finished.');
            resolve(null);
          }
        },
        { config_id: configId, response_type: 'code', override_default_response_type: true },
      );
    });
  }, [notConfigured, notConfiguredText, publicUrl, problem, sdk, configId, notify, confirm, what]);

  return { login, loaded, notConfigured, ready: !!sdk && !problem && !!configId, problem };
}

const LABEL: Record<MetaChannel, string> = { messenger: 'Messenger', instagram: 'Instagram' };

/** "Which Page?" after the login: one Page, Messenger and/or its Instagram account. */
export function MetaPagePicker({
  pages,
  initialChannel,
  busy,
  onCancel,
  onConnect,
  onRetry,
  onUseInstagramLogin,
}: {
  pages: MetaPageOption[];
  initialChannel: MetaChannel;
  busy: boolean;
  onCancel: () => void;
  onConnect: (pageId: string, channels: MetaChannel[]) => void;
  /** Instagram: rerun Meta's login popup (called straight from the click). */
  onRetry?: () => void;
  /** Instagram: switch to "Log in with Instagram" (no Page needed). */
  onUseInstagramLogin?: () => void;
}) {
  const firstFit =
    pages.find((p) => (initialChannel === 'instagram' ? !!p.instagram : true)) || pages[0] || null;
  const [pageId, setPageId] = useState(firstFit?.id || '');
  const [channels, setChannels] = useState<Record<MetaChannel, boolean>>({
    messenger: initialChannel === 'messenger',
    instagram: initialChannel === 'instagram',
  });
  const page = pages.find((p) => p.id === pageId) || null;
  const igAvailable = !!page?.instagram;
  const chosen = (Object.keys(channels) as MetaChannel[]).filter((c) => channels[c] && (c !== 'instagram' || igAvailable));
  // Connecting Instagram, and the chosen Page (or none at all) has no linked account.
  const noIgHelp = initialChannel === 'instagram' && !!onRetry && (pages.length === 0 || !igAvailable);

  return (
    <div className="cs-modal-overlay" onClick={busy ? undefined : onCancel}>
      <div className="cs-modal-card cs-meta-picker" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="cs-meta-picker-title">
        <div className="cs-modal-header">
          <h3 className="cs-modal-title" id="cs-meta-picker-title">Choose your Facebook Page</h3>
          <button type="button" className="cs-modal-close-btn" onClick={onCancel} disabled={busy} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="cs-modal-body">
          {pages.length === 0 ? (
            <p className="cs-meta-empty" data-testid="cs-meta-no-pages">
              Meta didn’t share any Facebook Page with the CRM. Run the login again and select the Page (and its
              Instagram account) on the assets step.
            </p>
          ) : (
            <>
              <p className="cs-meta-intro">
                Messenger uses the Page. Instagram uses the professional account linked to that Page.
              </p>
              <div className="cs-meta-pages" role="radiogroup" aria-label="Facebook Pages">
                {pages.map((p) => (
                  <label key={p.id} className={`cs-meta-page${p.id === pageId ? ' selected' : ''}`}>
                    <input
                      type="radio"
                      name="cs-meta-page"
                      value={p.id}
                      checked={p.id === pageId}
                      onChange={() => setPageId(p.id)}
                      disabled={busy}
                    />
                    {p.picture ? <img src={p.picture} alt="" className="cs-meta-page-pic" /> : <span className="cs-meta-page-pic blank" />}
                    <span className="cs-meta-page-text">
                      <strong>{p.name || p.id}</strong>
                      <small>
                        {p.instagram
                          ? `Instagram: @${p.instagram.username || p.instagram.id}`
                          : 'No Instagram professional account linked'}
                      </small>
                    </span>
                  </label>
                ))}
              </div>
              <div className="cs-meta-channels">
                {(['messenger', 'instagram'] as MetaChannel[]).map((c) => {
                  const disabled = busy || (c === 'instagram' && !igAvailable);
                  return (
                    <label key={c} className={`cs-meta-channel${disabled ? ' disabled' : ''}`}>
                      <input
                        type="checkbox"
                        checked={channels[c] && !(c === 'instagram' && !igAvailable)}
                        disabled={disabled}
                        onChange={(e) => setChannels((s) => ({ ...s, [c]: e.target.checked }))}
                      />
                      <img src={c === 'instagram' ? '/channel-instagram.svg' : '/channel-messenger.svg'} alt="" />
                      <span>
                        {LABEL[c]}
                        {c === 'instagram' && !igAvailable && <small> (link an Instagram account to this Page first)</small>}
                      </span>
                    </label>
                  );
                })}
              </div>
            </>
          )}
          {noIgHelp && (
            <div className="cs-meta-no-ig-help" role="note" data-testid="cs-meta-no-ig-help">
              <strong>
                {page ? `${page.name || 'This Page'} has no Instagram professional account linked` : 'No Instagram account was shared'}
              </strong>
              <ol>
                <li>
                  In the Instagram app, switch the account to a professional account: Settings → Account type and tools →
                  Switch to professional account.
                </li>
                <li>
                  Link it to your Facebook Page in Meta Business Suite → Settings → Business assets → Instagram accounts (or
                  on Facebook: Page settings → Linked accounts → Instagram).
                </li>
                <li>Click Try again, and select the Page and its Instagram account in Meta’s window.</li>
              </ol>
              <div className="cs-meta-no-ig-actions">
                <button type="button" className="cs-modal-btn confirm cs-meta-try-again" onClick={onRetry} disabled={busy} data-testid="cs-meta-try-again">
                  Try again
                </button>
                {onUseInstagramLogin && (
                  <button type="button" className="cs-meta-use-ig" onClick={onUseInstagramLogin} disabled={busy} data-testid="cs-meta-use-ig-login">
                    Log in with Instagram instead
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="cs-modal-footer">
          <button type="button" className="cs-modal-btn cancel" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="cs-modal-btn confirm"
            style={{ background: '#0084FF', color: '#ffffff', border: 'none' }}
            disabled={busy || !page || chosen.length === 0}
            onClick={() => page && onConnect(page.id, chosen)}
            data-testid="cs-meta-connect-confirm"
          >
            {busy ? 'Connecting…' : 'Connect'}
          </button>
        </div>
      </div>
    </div>
  );
}
