// Ads page.
//   • Not connected: only the connect screen. "Connect your Facebook account"
//     opens Meta's Facebook Login for Business popup straight from the click
//     (MetaBusinessLogin.tsx, the adsLoginConfigId configuration; the SDK is
//     preloaded on mount, like WhatsApp Embedded Signup). The server then
//     lists the ad accounts the business granted and the "Choose your ad
//     account" dialog picks one (plus, optionally, the lead-forms Page).
//   • Connected: MetaAdsDashboard.tsx (insights, campaigns → ad sets → ads,
//     lead forms, and the Click-to-WhatsApp leads on its WhatsApp leads tab).
//     "Change" reruns the popup → dialog.
//   • Revoked at Meta (error 190): a banner with Reconnect (popup → dialog).
// The Click-to-WhatsApp leads (/api/ads/leads) are fetched only while an ad
// account is connected.
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { CrmApi } from '../api';
import type { AdLeadsReport, BusinessProfile, MetaAdAccountOption, MetaAdLink, MetaAdsLogin, MetaAdsStatus } from '../types';
import { listTime } from '../utils';
import { useBackHandler } from '../useBackHandler';
import { useNotify, useConfirm } from './Dialogs';
import { AdsRailSvg } from './NavRail';
import { BladeSpinner } from './BladeSpinner';
import { WhatsAppConnectRequired } from './WhatsAppConnectRequired';
import { useMetaBusinessLogin } from './MetaBusinessLogin';
import { MetaAdsDashboard, errCode, errText, rangeDays } from './MetaAdsDashboard';
import './Ads.css';


/** Official Meta Infinity Logo with official gradient */
function MetaInfinityLogo({ width = 46, height = 31 }: { width?: number; height?: number }) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: 'block' }}
      aria-label="Meta"
    >
      <defs>
        <linearGradient id="meta-grad-ads-official" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#0064E0" />
          <stop offset="50%" stopColor="#0072EC" />
          <stop offset="100%" stopColor="#0081FB" />
        </linearGradient>
      </defs>
      <path
        fill="url(#meta-grad-ads-official)"
        d="M6.915 4.03c-1.968 0-3.683 1.28-4.871 3.113C.704 9.208 0 11.883 0 14.449c0 .706.07 1.369.21 1.973a6.624 6.624 0 0 0 .265.86 5.297 5.297 0 0 0 .371.761c.696 1.159 1.818 1.927 3.593 1.927 1.497 0 2.633-.671 3.965-2.444.76-1.012 1.144-1.626 2.663-4.32l.756-1.339.186-.325c.061.1.121.196.183.3l2.152 3.595c.724 1.21 1.665 2.556 2.47 3.314 1.046.987 1.992 1.22 3.06 1.22 1.075 0 1.876-.355 2.455-.843a3.743 3.743 0 0 0 .81-.973c.542-.939.861-2.127.861-3.745 0-2.72-.681-5.357-2.084-7.45-1.282-1.912-2.957-2.93-4.716-2.93-1.047 0-2.088.467-3.053 1.308-.652.57-1.257 1.29-1.82 2.05-.69-.875-1.335-1.547-1.958-2.056-1.182-.966-2.315-1.303-3.454-1.303zm10.16 2.053c1.147 0 2.188.758 2.992 1.999 1.132 1.748 1.647 4.195 1.647 6.4 0 1.548-.368 2.9-1.839 2.9-.58 0-1.027-.23-1.664-1.004-.496-.601-1.343-1.878-2.832-4.358l-.617-1.028a44.908 44.908 0 0 0-1.255-1.98c.07-.109.141-.224.211-.327 1.12-1.667 2.118-2.602 3.358-2.602zm-10.201.553c1.265 0 2.058.791 2.675 1.446.307.327.737.871 1.234 1.579l-1.02 1.566c-.757 1.163-1.882 3.017-2.837 4.338-1.191 1.649-1.81 1.817-2.486 1.817-.524 0-1.038-.237-1.383-.794-.263-.426-.464-1.13-.464-2.046 0-2.221.63-4.535 1.66-6.088.454-.687.964-1.226 1.533-1.533a2.264 2.264 0 0 1 1.088-.285z"
      />
    </svg>
  );
}

/** Benefit circled checkmark icon matching exact design in screenshot */
function BenefitCheckIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="cs-benefit-icon" style={{ flexShrink: 0 }}>
      <circle cx="12" cy="12" r="9" stroke="#16a34a" strokeWidth="2" fill="none" />
      <path d="M8.5 12.2L10.8 14.5L15.5 9.8" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Channel Ads Logo matching 40x40 squircle brand gradient */
function ChannelAdsLogo() {
  return (
    <img
      src="/channel-ads.svg"
      alt="Ads"
      className="cs-unconnected-logo-img"
      onError={(e) => {
        // Fallback to inline SVG if image file is loading
        const target = e.currentTarget;
        target.style.display = 'none';
        const parent = target.parentElement;
        if (parent && !parent.querySelector('.ads-inline-fallback')) {
          const fallback = document.createElement('div');
          fallback.className = 'ads-inline-fallback';
          fallback.innerHTML = `
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
              <rect width="40" height="40" rx="9.5" fill="#1877F2"/>
              <rect x="8.5" y="15.5" width="3" height="9" rx="1.5" fill="#ffffff"/>
              <path d="M11.5 17L22.5 12V28L11.5 23V17Z" fill="#ffffff"/>
              <path d="M25.5 16.5C27 18 27 22 25.5 23.5" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>
              <path d="M28.5 13.5C31 16.5 31 23.5 28.5 26.5" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>
            </svg>
          `;
          parent.insertBefore(fallback, target);
        }
      }}
    />
  );
}

const DEMO_REPORT: AdLeadsReport = {
  success: true,
  days: 30,
  summary: { leads: 14, ads: 3, inFreeWindow: 4 },
  ads: [
    {
      id: 'ad_summer_offer',
      sourceType: 'ad',
      headline: 'Summer Special · Flat 20% Off',
      body: 'Order direct on WhatsApp & get instant confirmation',
      url: 'https://facebook.com/ads',
      image: '',
      mediaType: 'image',
      leads: 8,
      messages: 19,
      lastAt: new Date().toISOString(),
    },
    {
      id: 'ad_new_collection',
      sourceType: 'ad',
      headline: 'Explore Our New Premium Collection',
      body: 'Chat with our team directly for custom recommendations',
      url: 'https://instagram.com/ads',
      image: '',
      mediaType: 'video',
      leads: 4,
      messages: 11,
      lastAt: new Date(Date.now() - 86400000 * 2).toISOString(),
    },
    {
      id: 'ad_free_shipping',
      sourceType: 'post',
      headline: 'Free Express Delivery All Weekend',
      body: 'Boosted Instagram post with Click-to-WhatsApp button',
      url: 'https://instagram.com/ads',
      image: '',
      mediaType: 'image',
      leads: 2,
      messages: 5,
      lastAt: new Date(Date.now() - 86400000 * 5).toISOString(),
    },
  ],
  leads: [
    {
      phone: '919876543210',
      name: 'Priya Sharma',
      firstMessage: 'Hi! I saw your 20% off summer offer, is it valid today?',
      at: new Date().toISOString(),
      adId: 'ad_summer_offer',
      adHeadline: 'Summer Special · Flat 20% Off',
      sourceType: 'ad',
      freeWindowEndsAt: new Date(Date.now() + 86400000 * 2.5).toISOString(),
    },
    {
      phone: '919812345678',
      name: 'Arjun Mehta',
      firstMessage: 'Can you share details on the new collection?',
      at: new Date(Date.now() - 3600000 * 14).toISOString(),
      adId: 'ad_new_collection',
      adHeadline: 'Explore Our New Premium Collection',
      sourceType: 'ad',
      freeWindowEndsAt: new Date(Date.now() + 86400000 * 1.8).toISOString(),
    },
    {
      phone: '919845012345',
      name: 'Sneha Patel',
      firstMessage: 'I am looking for express delivery to Bangalore',
      at: new Date(Date.now() - 86400000 * 1.2).toISOString(),
      adId: 'ad_free_shipping',
      adHeadline: 'Free Express Delivery All Weekend',
      sourceType: 'post',
      freeWindowEndsAt: new Date(Date.now() + 86400000 * 0.9).toISOString(),
    },
  ],
};

/** Formats remaining free 72-hour window time */
function freeLeft(endsAt: string) {
  const ms = new Date(endsAt).getTime() - Date.now();
  if (ms <= 0) return '';
  const h = Math.floor(ms / 3600000);
  return h >= 1 ? `Free replies · ${h}h left` : `Free replies · ${Math.max(1, Math.floor(ms / 60000))}m left`;
}


interface Props {
  api: CrmApi;
  demo?: boolean;
  business?: BusinessProfile;
  onBusinessUpdated?: (b: BusinessProfile) => void;
  onConnected?: (b: BusinessProfile) => void;
  onOpenChat: (phone: string) => void;
  /** From a notification: 'leadform:<id>' opens that lead form. */
  focusRequest?: { id: string; n: number } | null;
}

export const ADS_NOT_CONFIGURED_TEXT =
  'Facebook ads connections aren’t set up on this server yet. The platform owner needs to create a Facebook Login ' +
  'for Business configuration with ad accounts in the Meta app and add its id to the server ' +
  '(META_BUSINESS_LOGIN_CONFIG_ID, or META_ADS_LOGIN_CONFIG_ID for a separate one).';

const STANDARD_ACCESS_NOTE =
  'While the Meta app is in test mode (standard access), only people with a role on the Meta app can connect an ad account.';

export function AdsPage(props: Props) {
  const { demo = false, business } = props;
  if (!demo && business && !business.whatsappConnected) {
    return <WhatsAppConnectRequired page="ads" api={props.api} business={business} onConnected={props.onConnected || props.onBusinessUpdated} />;
  }
  return <AdsPageInner {...props} />;
}

function AdsPageInner({ api, demo = false, onOpenChat, focusRequest, business }: Props) {
  const notify = useNotify();
  const confirm = useConfirm();
  const [status, setStatus] = useState<MetaAdsStatus | null>(demo ? { success: true, configured: true, connection: null } : null);
  const [statusError, setStatusError] = useState('');
  const fbLogin = useMetaBusinessLogin(api, 'adsLoginConfigId', 'Facebook ads login', ADS_NOT_CONFIGURED_TEXT);
  const notConfigured = (status ? !status.configured : false) || fbLogin.notConfigured;

  // '' idle · 'popup' Meta's login window is open · 'reading' the server lists the ad accounts
  const [phase, setPhase] = useState<'' | 'popup' | 'reading'>('');
  const [picker, setPicker] = useState<MetaAdsLogin | null>(null);
  const [pickerError, setPickerError] = useState<{ code: string; text: string } | null>(null);
  const [connecting, setConnecting] = useState(false);

  // Click-to-WhatsApp leads (only while an ad account is connected)
  const [days, setDays] = useState(30);
  const [report, setReport] = useState<AdLeadsReport | null>(demo ? DEMO_REPORT : null);
  const [error, setError] = useState('');

  const loadStatus = useCallback(() => {
    if (demo) return;
    api
      .getMetaAds()
      .then((s) => {
        setStatus(s);
        setStatusError('');
      })
      .catch((e) => setStatusError(errText(e)));
  }, [api, demo]);
  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const linkedAccount = status?.connection?.status === 'connected' ? status.connection.adAccountId : '';
  useEffect(() => {
    if (demo || !linkedAccount) return;
    setReport(null);
    setError('');
    api
      .getAdLeads(days)
      .then(setReport)
      .catch((e) => setError(errText(e)));
  }, [api, days, demo, linkedAccount]);

  /**
   * Opens Meta's popup. Must run synchronously from the click (fbLogin.login
   * calls FB.login before returning), or the browser blocks the popup.
   */
  function startLogin() {
    if (phase) return;
    if (demo) {
      notify('error', 'Not in the demo', 'Sign up to connect your own Facebook ad account.');
      return;
    }
    if (notConfigured) {
      notify('error', 'Not set up yet', ADS_NOT_CONFIGURED_TEXT);
      return;
    }
    setPicker(null);
    setPickerError(null);
    setPhase('popup');
    void fbLogin.login().then(async (code) => {
      if (!code) {
        setPhase('');
        return;
      }
      setPhase('reading');
      try {
        setPicker(await api.startMetaAdsLogin(code));
      } catch (e) {
        notify('error', errCode(e) === 'RATE_LIMITED' ? 'Meta is busy, try again shortly' : 'Couldn’t read your ad accounts', errText(e));
      } finally {
        setPhase('');
      }
    });
  }

  async function connect(adAccountId: string, pageId: string) {
    if (!picker) return;
    setConnecting(true);
    setPickerError(null);
    try {
      const r = await api.connectMetaAds({ sessionId: picker.sessionId, adAccountId, pageId: pageId || undefined });
      setStatus((s) => ({ success: true, configured: s?.configured ?? true, connection: r.connection }));
      setPicker(null);
      notify('success', 'Facebook ads connected', `${r.connection.adAccountName} is connected.`);
    } catch (e) {
      const code = errCode(e);
      setPickerError({
        code,
        text: code === 'SESSION_EXPIRED' ? 'Your Meta login has expired. Please connect again.' : errText(e),
      });
    } finally {
      setConnecting(false);
    }
  }

  const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
  // Meta's SDK is still loading: FB.login can't run from a click yet.
  // (A failed load leaves the button enabled: clicking it loads again.)
  const sdkLoading = !demo && isHttps && !notConfigured && fbLogin.preparing;
  const loginBusy = phase !== '';

  async function disconnect() {
    const ok = await confirm({
      title: 'Disconnect Facebook ads?',
      message:
        'The CRM forgets this ad account and stops showing its spend, campaigns and lead forms. Nothing changes in your ads at Meta, and the Click-to-WhatsApp leads stay.',
      confirmLabel: 'Disconnect',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await api.disconnectMetaAds();
      setStatus((s) => ({ success: true, configured: s?.configured ?? true, connection: null }));
      notify('success', 'Disconnected', 'Facebook ads were disconnected.');
    } catch (e) {
      notify('error', 'Not disconnected', errText(e));
    }
  }

  const onRevoked = useCallback(() => loadStatus(), [loadStatus]);
  const onReadOnly = useCallback(
    () => setStatus((s) => (s?.connection ? { ...s, connection: { ...s.connection, canManage: false } } : s)),
    [],
  );

  const conn = status?.connection || null;
  const ctwaNode = <CtwaLeads report={report} error={error} onOpenChat={onOpenChat} />;

  const modals = picker && (
    <AdAccountPicker
      key={picker.sessionId}
      login={picker}
      busy={connecting}
      error={pickerError}
      onClearError={() => setPickerError(null)}
      onCancel={() => {
        setPicker(null);
        setPickerError(null);
      }}
      onRetry={startLogin}
      onConnect={connect}
    />
  );

  if (!demo && !status && !statusError) {
    return (
      <div className="crm-ads-page">
        <BladeSpinner center={true} containerHeight={240} />
      </div>
    );
  }

  if (conn?.status === 'connected') {
    return (
      <div className="crm-ads-page">
        <MetaAdsDashboard
          api={api}
          conn={conn}
          ctwa={{ node: ctwaNode, report }}
          onRangeChange={(r) => setDays(rangeDays(r))}
          onReconnect={startLogin}
          onDisconnect={disconnect}
          onRevoked={onRevoked}
          onReadOnly={onReadOnly}
          onOpenChat={onOpenChat}
          focus={focusRequest}
          businessId={business?._id || ''}
        />
        {modals}
      </div>
    );
  }

  return (
    <div className="crm-ads-page">
      <div className="crm-ads-onboarding" data-testid="ads-not-connected">
        <div className="cs-unconnected-hero-box">
          <div className="cs-unconnected-logos-row">
            <ChannelAdsLogo />
            <span className="cs-unconnected-arrow">⇄</span>
            <MetaInfinityLogo width={46} height={31} />
          </div>

          {conn?.status === 'disconnected' && (
            <div className="ads-state red ads-revoked" role="alert" data-testid="ads-revoked">
              <span className="material-icons" aria-hidden="true">link_off</span>
              <div>
                <strong>Facebook ads were disconnected at Meta</strong>
                <p>
                  The CRM no longer has access to {conn.adAccountName || 'your ad account'}
                  {conn.statusReason ? ` (${conn.statusReason})` : ''}. Reconnect it to see spend and leads again.
                </p>
              </div>
              <div className="ads-revoked-actions">
                <button
                  type="button"
                  className="ads-btn primary"
                  onClick={startLogin}
                  disabled={sdkLoading || loginBusy}
                  data-testid="ads-revoked-reconnect"
                >
                  {loginBusy ? 'Connecting…' : sdkLoading ? 'Preparing…' : 'Reconnect'}
                </button>
                <button type="button" className="ads-btn" onClick={disconnect}>
                  Remove
                </button>
              </div>
            </div>
          )}
          {statusError && (
            <div className="ads-state red" role="alert">
              <span className="material-icons" aria-hidden="true">error_outline</span>
              <div>
                <strong>Couldn’t check the ad account</strong>
                <p>{statusError}</p>
              </div>
              <button type="button" className="ads-btn" onClick={loadStatus}>
                Try again
              </button>
            </div>
          )}

          <h2 className="cs-unconnected-headline">To run and track ads, connect your Facebook ad account</h2>
          <p className="cs-unconnected-subline">
            See spend, reach, messaging conversations and leads for your Facebook and Instagram ads, next to the WhatsApp chats they bring in.
          </p>

          <div className="cs-unconnected-benefits-box">
            <h3 className="cs-unconnected-benefits-title">Benefits of connecting your ad account</h3>
            <ul className="cs-unconnected-benefits-list">
              <li className="cs-unconnected-benefit-item">
                <BenefitCheckIcon />
                <span>Spend, impressions, reach, clicks and cost per result for any date range</span>
              </li>
              <li className="cs-unconnected-benefit-item">
                <BenefitCheckIcon />
                <span>Campaigns, ad sets and ads with their results, and lead form leads with CSV export</span>
              </li>
              <li className="cs-unconnected-benefit-item">
                <BenefitCheckIcon />
                <span>Click-to-WhatsApp leads linked to the campaign and ad that brought them</span>
              </li>
            </ul>

            <div className="cs-unconnected-cta-row">
              <button
                type="button"
                className={`cs-connect-channel-btn${notConfigured ? ' not-configured' : ''}`}
                onClick={startLogin}
                disabled={sdkLoading || loginBusy}
                aria-busy={sdkLoading || loginBusy}
                data-testid="ads-connect"
              >
                {loginBusy
                  ? 'Connecting…'
                  : sdkLoading
                    ? 'Preparing…'
                    : conn?.status === 'disconnected'
                      ? 'Reconnect your Facebook account'
                      : 'Connect your Facebook account'}
              </button>
            </div>
            {notConfigured ? (
              <p className="ads-note" data-testid="ads-not-configured">
                {ADS_NOT_CONFIGURED_TEXT}
              </p>
            ) : (
              <p className="ads-note">{STANDARD_ACCESS_NOTE}</p>
            )}
          </div>
        </div>
      </div>
      {modals}
    </div>
  );
}

/** Ad account statuses that can't be connected, with the reason shown on the card. */
const UNUSABLE_REASON: Record<number, string> = {
  2: 'Disabled by Meta. Check Account Quality in Meta Business Suite before connecting it.',
  100: 'Being closed at Meta, so it can’t be connected.',
  101: 'Closed at Meta. Reopen it in Ads Manager to connect it.',
  202: 'Closed at Meta. Reopen it in Ads Manager to connect it.',
};
const isUsable = (a: MetaAdAccountOption) => !(a.status in UNUSABLE_REASON);
const pillTone = (a: MetaAdAccountOption) => (!isUsable(a) ? 'red' : a.status === 1 || a.status === 201 ? 'green' : 'amber');

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])';

/** After Meta's login: "Choose your ad account" (and, optionally, the lead-forms Page). */
function AdAccountPicker({
  login, busy, error, onClearError, onCancel, onRetry, onConnect,
}: {
  login: MetaAdsLogin;
  busy: boolean;
  /** The last connect error (ASSET_IN_USE, PAGE_IN_USE, SESSION_EXPIRED, …). */
  error: { code: string; text: string } | null;
  onClearError: () => void;
  onCancel: () => void;
  /** Reruns Meta's popup; called straight from the click. */
  onRetry: () => void;
  onConnect: (adAccountId: string, pageId: string) => void;
}) {
  const titleId = useId();
  const descId = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const usable = login.accounts.filter(isUsable);
  const [account, setAccount] = useState(usable.length === 1 ? usable[0].id : '');
  const [pageId, setPageId] = useState(login.pages.length === 1 ? login.pages[0].id : '');
  const empty = login.accounts.length === 0;
  const expired = error?.code === 'SESSION_EXPIRED';
  const showRetry = empty || usable.length === 0 || expired;

  const live = useRef({ busy, onCancel });
  live.current = { busy, onCancel };
  const close = () => {
    if (!live.current.busy) live.current.onCancel();
  };
  // Browser Back closes it, like Esc (same as the CRM's other dialogs).
  useBackHandler(true, close);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const box = boxRef.current;
    const first =
      box?.querySelector<HTMLElement>('input[name="ads-account"]:checked:not(:disabled)') ||
      box?.querySelector<HTMLElement>('input[name="ads-account"]:not(:disabled)') ||
      box?.querySelector<HTMLElement>('[data-autofocus]') ||
      box?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        return;
      }
      if (e.key !== 'Tab' || !boxRef.current) return;
      // Keep Tab inside the dialog.
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

  return (
    <div className="ads-dialog-backdrop" onClick={(e) => e.target === e.currentTarget && close()}>
      <div
        ref={boxRef}
        className="ads-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        data-testid="ads-picker"
      >
        <div className="ads-dialog-head">
          <h3 className="ads-dialog-title" id={titleId}>
            Choose your ad account
          </h3>
          <button type="button" className="ads-dialog-close" onClick={close} disabled={busy} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="ads-dialog-body">
          {empty ? (
            <div className="ads-dialog-empty" data-testid="ads-picker-empty">
              <span className="material-icons" aria-hidden="true">account_balance_wallet</span>
              <strong>No ad accounts were shared</strong>
              <p id={descId}>
                Meta didn’t return any ad account for this login. You need an ad account in the business portfolio you
                shared in Meta’s window, selected on its ad accounts step. While the Meta app is in test mode, you also
                need a role on the Meta app (admin, developer or tester).
              </p>
            </div>
          ) : (
            <>
              <p className="ads-dialog-intro" id={descId}>
                The CRM shows this account’s spend, campaigns and leads. Nothing changes in your ads at Meta.
              </p>
              <div className="ads-picker-list" role="radiogroup" aria-labelledby={titleId}>
                {login.accounts.map((a) => {
                  const ok = isUsable(a);
                  const reasonId = `${titleId}-r-${a.accountId || a.id}`;
                  return (
                    <label
                      key={a.id}
                      className={`ads-picker-item${a.id === account ? ' selected' : ''}${ok ? '' : ' disabled'}`}
                      data-testid="ads-picker-item"
                    >
                      <input
                        type="radio"
                        name="ads-account"
                        value={a.id}
                        checked={a.id === account}
                        onChange={() => {
                          setAccount(a.id);
                          onClearError();
                        }}
                        disabled={busy || !ok}
                        aria-describedby={ok ? undefined : reasonId}
                      />
                      <span>
                        <strong>{a.name}</strong>
                        <small>
                          {a.id}
                          {a.currency ? ` · ${a.currency}` : ''}
                          {a.timezone ? ` · ${a.timezone}` : ''}
                          {a.businessName ? ` · ${a.businessName}` : ''}
                        </small>
                        {!ok && (
                          <small className="ads-picker-reason" id={reasonId}>
                            {UNUSABLE_REASON[a.status]}
                          </small>
                        )}
                      </span>
                      <span className={`ads-pill ${pillTone(a)}`}>{a.statusLabel}</span>
                    </label>
                  );
                })}
              </div>
              {usable.length === 0 && (
                <p className="ads-note" data-testid="ads-picker-none-usable">
                  None of these ad accounts can be connected. Fix it at Meta, or run the login again and share another ad account.
                </p>
              )}
              <label className="ads-picker-page">
                <span>Facebook Page with your lead forms</span>
                <select
                  value={pageId}
                  onChange={(e) => {
                    setPageId(e.target.value);
                    onClearError();
                  }}
                  disabled={busy}
                  data-testid="ads-picker-page"
                >
                  <option value="">Don’t show lead forms</option>
                  {login.pages.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name || p.id}
                    </option>
                  ))}
                </select>
              </label>
              {!login.pages.length && <p className="ads-note">Meta didn’t share a Page. To see lead forms, select your Page in Meta’s window.</p>}
              {!login.canManage && (
                <p className="ads-note" data-testid="ads-picker-readonly">
                  Read-only: Meta didn’t grant managing ads (ads_management), so pausing and resuming from the CRM isn’t available.
                </p>
              )}
              {login.pages.length > 0 && !login.leadsAllowed && (
                <p className="ads-note">Lead details need the leads_retrieval permission, which Meta didn’t grant in this login.</p>
              )}
            </>
          )}
          {error && (
            <div className="ads-dialog-error" role="alert" data-testid="ads-picker-error">
              <span className="material-icons" aria-hidden="true">error_outline</span>
              <span>{error.text}</span>
            </div>
          )}
        </div>

        <div className="ads-dialog-foot">
          <button type="button" className="ads-dialog-btn cancel" onClick={close} disabled={busy} data-testid="ads-picker-cancel">
            Cancel
          </button>
          {showRetry ? (
            <button
              type="button"
              className="ads-dialog-btn primary"
              onClick={onRetry}
              disabled={busy}
              data-autofocus
              data-testid="ads-picker-retry"
            >
              {expired ? 'Connect again' : 'Try again'}
            </button>
          ) : (
            <button
              type="button"
              className="ads-dialog-btn primary"
              disabled={busy || !account}
              onClick={() => onConnect(account, pageId)}
              data-testid="ads-picker-connect"
            >
              {busy ? 'Connecting…' : 'Connect'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Click-to-WhatsApp leads (message referrals), linked to campaigns when the ad is in the connected account. */
function CtwaLeads({ report, error, onOpenChat }: { report: AdLeadsReport | null; error: string; onOpenChat: (phone: string) => void }) {
  const links: Record<string, MetaAdLink> = report?.links || {};
  if (error) return <p className="err">{error}</p>;
  if (!report) return <BladeSpinner center={true} containerHeight={160} />;
  const empty = report.summary.leads === 0;
  const linkText = (adId: string) => {
    const l = links[adId];
    return l ? [l.campaignName, l.adName].filter(Boolean).join(' › ') : '';
  };
  return (
    <div className="ads-ctwa" data-testid="ads-ctwa">
      <div className="ads-stats ads-stats-3">
        <div className="ads-stat">
          <span>Leads from ads</span>
          <strong>{report.summary.leads}</strong>
        </div>
        <div className="ads-stat">
          <span>Ads bringing chats</span>
          <strong>{report.summary.ads}</strong>
        </div>
        <div className="ads-stat green">
          <span>Still free to reply</span>
          <strong>{report.summary.inFreeWindow}</strong>
        </div>
      </div>
      {empty ? (
        <div className="ads-empty">
          <span className="ads-empty-icon" aria-hidden="true">
            <AdsRailSvg size={28} />
          </span>
          <p>
            No ad leads in the last {report.days} days. When customers click your
            <strong> Click-to-WhatsApp </strong>ads on Facebook or Instagram and message you, they show up here.
          </p>
        </div>
      ) : (
        <div className="ads-cols">
          <section className="ads-card">
            <h4>Customer leads</h4>
            <ul className="ads-leads">
              {report.leads.map((l) => {
                const free = freeLeft(l.freeWindowEndsAt);
                const linked = linkText(l.adId);
                return (
                  <li key={l.phone}>
                    <button className="ads-lead" onClick={() => onOpenChat(l.phone)} title="Open chat">
                      <span className="ads-lead-avatar" aria-hidden="true">
                        {(l.name || l.phone).slice(0, 1).toUpperCase()}
                      </span>
                      <span className="ads-lead-main">
                        <strong>{l.name || `+${l.phone}`}</strong>
                        <small>
                          {l.adHeadline || 'Ad'} · “{l.firstMessage || '…'}”
                        </small>
                        {linked && <small className="ads-link" data-testid="ads-ctwa-link">{linked}</small>}
                      </span>
                      <span className="ads-lead-side">
                        <small>{listTime(l.at)}</small>
                        {free && <span className="k-chip sm green">{free}</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
          <section className="ads-card">
            <h4>Ads bringing chats</h4>
            <ul className="ads-adlist">
              {report.ads.map((a) => (
                <li key={a.id}>
                  {a.image ? (
                    <img src={a.image} alt="" />
                  ) : (
                    <span className="ads-ad-ph material-icons" aria-hidden="true">
                      {a.mediaType === 'video' ? 'movie' : 'campaign'}
                    </span>
                  )}
                  <span className="ads-ad-main">
                    <strong>{links[a.id]?.adName || a.headline || 'Untitled ad'}</strong>
                    <small>
                      {links[a.id]?.campaignName
                        ? `Campaign: ${links[a.id].campaignName}`
                        : a.sourceType === 'post'
                          ? 'Boosted post'
                          : 'Click-to-WhatsApp ad'}
                      {a.body ? ` · ${a.body}` : ''}
                    </small>
                  </span>
                  <span className="ads-ad-n">
                    <strong>{a.leads}</strong>
                    <small>lead{a.leads === 1 ? '' : 's'}</small>
                  </span>
                  {a.url && (
                    <a href={a.url} target="_blank" rel="noreferrer" className="icon-btn" aria-label="View ad on Meta">
                      <span className="material-icons">open_in_new</span>
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}
