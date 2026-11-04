import { useState, useEffect, useCallback, type ReactNode } from 'react';
import type { CrmApi } from '../api';
import type {
  ActivationFailure, ActivationResult, BusinessProfile, ChannelStatus, MetaChannel, MetaChannelConnection,
  MetaChannelsInfo, MetaPageOption, SignupActivation,
} from '../types';
import type { CrmView } from './NavRail';
import { ConnectWhatsAppButton } from './ConnectWhatsApp';
import { BUSINESS_LOGIN_NOT_CONFIGURED, MetaPagePicker, useMetaBusinessLogin } from './MetaBusinessLogin';
import {
  InstagramIntroDialog, InstagramMethodDialog, InstagramLoginError, cancelInstagramLogin, openInstagramLogin,
  useInstagramLoginConfig, type InstagramMethod,
} from './InstagramConnect';
import { useConfirm, useNotify } from './Dialogs';
import { ActivateNumberPanel, NumberStateCard } from './ActivateNumberPanel';
import {
  numberStatusTone,
  CHANNEL_STATUS_EVENT,
  NUMBER_ACTIVATION_EVENT,
  SIGNUP_ACTIVATION_KEY,
} from '../numberStatus';
import './ChannelStatusPage.css';
import { COMING_SOON } from '../features';
import { ComingSoonPanel, SoonPill } from './ComingSoon';
import { CallingSettings } from './CallingSettings';

// The "Soon" corner badge on the Instagram / Messenger tabs (features.ts).
const SOON_BADGE = { background: '#fef3c7', color: '#92400e' };

/** Embedded Signup's register failure, kept until the Activate panel has shown it. */
function readSignupError(): ActivationFailure | null {
  try {
    const raw = sessionStorage.getItem(SIGNUP_ACTIVATION_KEY);
    return raw ? (JSON.parse(raw) as SignupActivation).error || null : null;
  } catch {
    return null;
  }
}

interface Props {
  api: CrmApi;
  demo?: boolean;
  business?: BusinessProfile;
  onConnected: (b: BusinessProfile) => void;
  onOpenChat?: (phone: string) => void;
  onNavigate?: (view: CrmView) => void;
  initialTab?: ChannelTab;
  onTabChange?: (tab: ChannelTab) => void;
  initialSubItem?: SubItem;
}

type ChannelTab = 'whatsapp' | 'instagram' | 'messenger';
type SubItem = 'connect' | 'limit' | 'approval' | 'display_name' | 'phone_number' | 'quality_rating' | 'calling';

// Meta's current tier path (same order as backend services/messagingTier.js
// TIER_TRACK). Legacy TIER_50 / TIER_1K numbers get their own slot.
const TIER_TRACK: { tier: string; label: string; limit: number }[] = [
  { tier: 'TIER_250', label: '250', limit: 250 },
  { tier: 'TIER_2K', label: '2,000', limit: 2000 },
  { tier: 'TIER_10K', label: '10,000', limit: 10000 },
  { tier: 'TIER_100K', label: '100,000', limit: 100000 },
  { tier: 'TIER_UNLIMITED', label: 'Unlimited', limit: Infinity },
];
const TIER_DESC = 'Unique customers you can start conversations with in a rolling 24-hour period';

type Tone = 'green' | 'amber' | 'red' | 'grey';

const TIPS = {
  limit:
    "How many unique customers you can start conversations with in a rolling 24 hours. Replies within a customer's 24-hour window don't count.",
  throughput: 'How many messages per second this number can send. Meta raises it automatically for busy numbers.',
  quality: "Meta's rating of how customers have received your messages over the last 7 days.",
  status: 'Whether this number can send and receive on the Cloud API.',
  displayPhone: 'The phone number customers see your messages come from.',
  verifiedName: 'The business name customers see on WhatsApp, as approved by Meta.',
  phoneNumberId: "Meta's ID for this phone number, used by the Cloud API.",
  wabaId: 'The ID of the WhatsApp Business Account this number belongs to.',
  codeVerification: 'Whether this number was verified with a code sent by SMS or voice call.',
  accountMode: 'LIVE numbers can message any customer; SANDBOX numbers only reach test recipients.',
  platform: 'Where this number is hosted. CLOUD_API means Meta hosts it for you.',
  canSend: "Whether Meta currently lets this account start conversations. Blocked or limited means something below needs fixing.",
  nameStatus: "Meta's review of your WhatsApp display name.",
  newNameStatus: "Meta's review of a display name change you requested.",
  official: 'Official Business Accounts show a blue tick next to the name. Meta grants it on request to notable brands.',
  review: "Meta's review of your WhatsApp Business Account.",
  businessVerification: "Whether Meta has verified your business (in Meta Business Manager > Security Center).",
  wabaName: 'The name of your WhatsApp Business Account in Meta Business Manager.',
  lastUpdated: 'When these values were last read from Meta. They are reused for up to 5 minutes.',
};

const QUALITY: Record<string, { label: string; tone: Tone }> = {
  GREEN: { label: 'High', tone: 'green' },
  YELLOW: { label: 'Medium', tone: 'amber' },
  RED: { label: 'Low', tone: 'red' },
  UNKNOWN: { label: 'Not rated yet', tone: 'grey' },
};

/** "PENDING_REVIEW" → "Pending Review"; '' → '—'. */
function humanize(s?: string | null): string {
  if (!s) return '—';
  return String(s)
    .toLowerCase()
    .split('_')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/** Colour of a review / verification / availability value. */
function reviewTone(s?: string): Tone {
  const v = String(s || '').toUpperCase();
  if (!v || v === 'NONE') return 'grey';
  if (['APPROVED', 'VERIFIED', 'AVAILABLE', 'AVAILABLE_WITHOUT_REVIEW', 'LIVE'].includes(v)) return 'green';
  if (['REJECTED', 'DECLINED', 'FAILED', 'BLOCKED', 'NOT_VERIFIED', 'EXPIRED'].includes(v)) return 'red';
  return 'amber';
}

function throughputText(level?: string): string {
  const v = String(level || '').toUpperCase();
  if (!v) return '—';
  if (v === 'STANDARD') return 'Standard (up to 80 messages/second)';
  if (v === 'HIGH') return 'High (up to 1,000 messages/second)';
  return humanize(v);
}

const BADGE_CLASS: Record<Tone, string> = { green: 'completed', amber: 'pending', red: 'failed', grey: 'muted' };

const META_LABEL: Record<MetaChannel, string> = { messenger: 'Messenger', instagram: 'Instagram' };

/** Standard access: only people with a role on the Meta app can connect and message. */
const META_TEST_MODE_NOTE =
  'While the Meta app has standard access (test mode), only people with a role on the app (admins, developers, ' +
  'testers) can connect their Page, and only their messages reach the CRM.';
const IG_LOGIN_TEST_MODE_NOTE =
  'Meta delivers Instagram direct messages to the CRM only while the Meta app is Live. Until then, accounts added as ' +
  'Instagram Testers can connect, but new messages don’t arrive.';

function shortDate(v?: string | null): string {
  if (!v) return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** A Messenger / Instagram connection: connected card, or the Connect hero (with reconnect / not-set-up notes). */
function MetaChannelPanel({
  channel,
  conn,
  busy,
  preparing = false,
  notConfigured,
  onConnect,
  onDisconnect,
}: {
  channel: MetaChannel;
  conn: MetaChannelConnection | null;
  busy: boolean;
  /** Meta's sign-in is still loading: the button waits ("Preparing…"). */
  preparing?: boolean;
  notConfigured: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const ig = channel === 'instagram';
  const label = META_LABEL[channel];
  if (conn?.status === 'connected') {
    return (
      <div className="cs-completed-card" data-testid={`cs-meta-connected-${channel}`}>
        <div className="cs-card-pattern" />
        <div className="cs-completed-inner">
          <div className="cs-icon-circle-success">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#24d06e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h2 className="cs-completed-title">Connected</h2>
          <p className="cs-completed-text-1">
            {ig ? 'Your Instagram professional account is connected.' : 'Your Facebook Page is connected to Messenger.'}
          </p>
          <p className="cs-completed-text-2">
            {ig
              ? 'Direct messages arrive in your Chats, and you can reply within 24 hours of the customer’s last message.'
              : 'Messages to your Page arrive in your Chats, and you can reply within 24 hours of the customer’s last message.'}
          </p>
          <div className="cs-account-details-pill">
            {ig && (
              <>
                <span>Username: <strong>@{conn.igUsername || conn.igUserId}</strong></span>
                <span>•</span>
              </>
            )}
            {ig && conn.loginMethod === 'instagram' ? (
              <span data-testid="cs-ig-login-method">Connected with: <strong>Instagram login</strong></span>
            ) : (
              <span>Page: <strong>{conn.pageName || conn.pageId}</strong></span>
            )}
            {conn.connectedAt && (
              <>
                <span>•</span>
                <span>Since: <strong>{shortDate(conn.connectedAt)}</strong></span>
              </>
            )}
          </div>
          <p className="cs-meta-note">{ig && conn.loginMethod === 'instagram' ? IG_LOGIN_TEST_MODE_NOTE : META_TEST_MODE_NOTE}</p>
          <div style={{ marginTop: 20 }}>
            <button type="button" className="cs-disconnect-btn" onClick={onDisconnect}>
              Disconnect {label}
            </button>
          </div>
        </div>
      </div>
    );
  }
  const revoked = conn?.status === 'disconnected';
  return (
    <div className="cs-unconnected-hero-box">
      <div className="cs-unconnected-logos-row">
        <img
          src={ig ? '/channel-instagram.svg' : '/channel-messenger.svg'}
          alt={label}
          className={`cs-unconnected-logo-img${ig ? '' : ' cs-messenger-logo'}`}
        />
        <span className="cs-unconnected-arrow">⇄</span>
        <MetaInfinityLogo width={46} height={31} />
      </div>

      <h2 className="cs-unconnected-headline">
        {ig ? 'To experience messaging, connect your Instagram account' : 'To experience messaging, connect your Facebook Page'}
      </h2>
      <p className="cs-unconnected-subline">
        {ig
          ? 'Once connected, you can start chatting with customers on Instagram Direct'
          : 'Once connected, you can start chatting with customers on Facebook Messenger'}
      </p>

      {revoked && (
        <div className="cs-meta-revoked" role="alert" data-testid={`cs-meta-revoked-${channel}`}>
          <strong>{label} was disconnected at Meta</strong>
          <span>
            The CRM no longer has access to {ig ? `@${conn?.igUsername || conn?.igUserId}` : conn?.pageName || 'your Page'}
            {conn?.disconnectedAt ? ` (since ${shortDate(conn.disconnectedAt)})` : ''}. Connect again to keep receiving and
            replying to messages.
          </span>
        </div>
      )}

      <div className="cs-unconnected-benefits-box">
        <h3 className="cs-unconnected-benefits-title">
          {ig ? 'Benefits of connecting your own account' : 'Benefits of connecting your own page'}
        </h3>
        <ul className="cs-unconnected-benefits-list">
          <li className="cs-unconnected-benefit-item">
            <BenefitCheckIcon />
            <span>{ig ? 'Chat directly with Instagram Direct customers' : 'Chat directly with Facebook Page customers'}</span>
          </li>
          <li className="cs-unconnected-benefit-item">
            <BenefitCheckIcon />
            <span>{ig ? 'Unified inbox with WhatsApp and Facebook' : 'Unified inbox with WhatsApp and Instagram'}</span>
          </li>
          <li className="cs-unconnected-benefit-item">
            <BenefitCheckIcon />
            <span>Reply with text and photos from the CRM</span>
          </li>
        </ul>

        <div className="cs-unconnected-cta-row">
          <button
            type="button"
            className={`cs-connect-channel-btn${notConfigured ? ' not-configured' : ''}`}
            onClick={onConnect}
            disabled={busy || preparing}
            aria-disabled={notConfigured}
            aria-busy={busy || preparing}
            data-testid={`cs-meta-connect-${channel}`}
          >
            {busy ? 'Connecting…' : preparing ? 'Preparing…' : revoked ? `Reconnect ${label}` : ig ? 'Connect Instagram Account' : 'Connect Messenger Account'}
          </button>
        </div>
        {notConfigured ? (
          <p className="cs-meta-not-configured" data-testid={`cs-meta-not-configured-${channel}`}>
            {BUSINESS_LOGIN_NOT_CONFIGURED}
          </p>
        ) : (
          <p className="cs-meta-note">
            {ig
              ? 'Log in with your Instagram professional account, or with Facebook and choose the Page it’s linked to.'
              : 'Meta’s login window opens. Choose the Facebook Page you want to answer messages for.'}{' '}
            {META_TEST_MODE_NOTE}
          </p>
        )}
      </div>
    </div>
  );
}

function Info({ tip }: { tip: string }) {
  return (
    <span className="cs-info-icon" title={tip} aria-label={tip} role="img">
      ⓘ
    </span>
  );
}

function Pill({ label, tone }: { label: string; tone: Tone }) {
  return <span className={`cs-quality-pill ${tone}`}>{label}</span>;
}

function KeyVal({ k, tip, children }: { k: string; tip: string; children: ReactNode }) {
  return (
    <div className="cs-keyval-item">
      <span className="cs-keyval-key">
        {k} <Info tip={tip} />
      </span>
      <span className="cs-keyval-val">{children}</span>
    </div>
  );
}

function MetaInfinityLogo({ width = 44, height = 30 }: { width?: number; height?: number }) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: 'block' }}
    >
      <defs>
        <linearGradient id="meta-grad-official" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#0064E0" />
          <stop offset="50%" stopColor="#0072EC" />
          <stop offset="100%" stopColor="#0081FB" />
        </linearGradient>
      </defs>
      <path
        fill="url(#meta-grad-official)"
        d="M6.915 4.03c-1.968 0-3.683 1.28-4.871 3.113C.704 9.208 0 11.883 0 14.449c0 .706.07 1.369.21 1.973a6.624 6.624 0 0 0 .265.86 5.297 5.297 0 0 0 .371.761c.696 1.159 1.818 1.927 3.593 1.927 1.497 0 2.633-.671 3.965-2.444.76-1.012 1.144-1.626 2.663-4.32l.756-1.339.186-.325c.061.1.121.196.183.3l2.152 3.595c.724 1.21 1.665 2.556 2.47 3.314 1.046.987 1.992 1.22 3.06 1.22 1.075 0 1.876-.355 2.455-.843a3.743 3.743 0 0 0 .81-.973c.542-.939.861-2.127.861-3.745 0-2.72-.681-5.357-2.084-7.45-1.282-1.912-2.957-2.93-4.716-2.93-1.047 0-2.088.467-3.053 1.308-.652.57-1.257 1.29-1.82 2.05-.69-.875-1.335-1.547-1.958-2.056-1.182-.966-2.315-1.303-3.454-1.303zm10.16 2.053c1.147 0 2.188.758 2.992 1.999 1.132 1.748 1.647 4.195 1.647 6.4 0 1.548-.368 2.9-1.839 2.9-.58 0-1.027-.23-1.664-1.004-.496-.601-1.343-1.878-2.832-4.358l-.617-1.028a44.908 44.908 0 0 0-1.255-1.98c.07-.109.141-.224.211-.327 1.12-1.667 2.118-2.602 3.358-2.602zm-10.201.553c1.265 0 2.058.791 2.675 1.446.307.327.737.871 1.234 1.579l-1.02 1.566c-.757 1.163-1.882 3.017-2.837 4.338-1.191 1.649-1.81 1.817-2.486 1.817-.524 0-1.038-.237-1.383-.794-.263-.426-.464-1.13-.464-2.046 0-2.221.63-4.535 1.66-6.088.454-.687.964-1.226 1.533-1.533a2.264 2.264 0 0 1 1.088-.285z"
      />
    </svg>
  );
}

function BenefitCheckIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="cs-benefit-icon">
      <path
        d="M9 12L11 14L15 10M12 3L4 7V13C4 17.4183 7.58172 21 12 21C16.4183 21 20 17.4183 20 13V7L12 3Z"
        stroke="#16a34a"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ChannelStatusPage({
  api,
  demo = false,
  business,
  onConnected,
  onNavigate: _onNavigate,
  initialTab = 'whatsapp',
  onTabChange,
  initialSubItem,
}: Props) {
  const [activeTab, setActiveTab] = useState<ChannelTab>(initialTab || 'whatsapp');
  const [selectedSubItem, setSelectedSubItem] = useState<SubItem>(() => {
    try {
      const stored = localStorage.getItem('crm_channel_status_subitem');
      if (stored) {
        localStorage.removeItem('crm_channel_status_subitem');
        return stored as SubItem;
      }
    } catch {
      // ignore
    }
    return initialSubItem || 'connect';
  });

  useEffect(() => {
    if (initialSubItem) {
      setSelectedSubItem(initialSubItem);
      setActiveTab('whatsapp');
    }
  }, [initialSubItem]);

  useEffect(() => {
    const handleSubItem = (e: any) => {
      if (e?.detail) {
        setSelectedSubItem(e.detail);
        setActiveTab('whatsapp');
      }
    };
    window.addEventListener('crm_set_channel_subitem', handleSubItem);
    return () => window.removeEventListener('crm_set_channel_subitem', handleSubItem);
  }, []);

  // ---- Messenger / Instagram (Facebook Login for Business) ----
  const notify = useNotify();
  const confirm = useConfirm();
  const [metaInfo, setMetaInfo] = useState<MetaChannelsInfo | null>(null);
  useEffect(() => {
    if (demo) {
      setMetaInfo({ success: true, configured: true, connections: { messenger: null, instagram: null } });
      return;
    }
    let live = true;
    api
      .getMetaChannels()
      .then((r) => live && setMetaInfo(r))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [api, demo]);
  // Instagram's "Log in with Facebook" keeps the Login for Business
  // configuration; Messenger has its own (messengerLoginConfigId, which falls
  // back to it on the server) so its popup can be Pages-only.
  const fbLogin = useMetaBusinessLogin(api, 'businessLoginConfigId', 'Instagram login with Facebook');
  const fbMessengerLogin = useMetaBusinessLogin(api, 'messengerLoginConfigId', 'Messenger login');
  const loginFor = (channel: MetaChannel) => (channel === 'messenger' ? fbMessengerLogin : fbLogin);
  const fbNotConfiguredFor = (channel: MetaChannel) => (metaInfo ? !metaInfo.configured : false) || loginFor(channel).notConfigured;
  // "Log in with Instagram" (Business Login for Instagram).
  const igLoginCfg = useInstagramLoginConfig(api);
  const igLoginConfigured = igLoginCfg.configured;
  // Instagram is only "not set up" when neither way of connecting is.
  const instagramNotConfigured = fbNotConfiguredFor('instagram') && igLoginCfg.loaded && !igLoginConfigured;
  const [igDialog, setIgDialog] = useState<null | 'intro' | 'method'>(null);
  const [igMethodInit, setIgMethodInit] = useState<InstagramMethod | undefined>(undefined);
  const [igBusy, setIgBusy] = useState<'' | 'popup' | 'connecting'>('');
  const [igError, setIgError] = useState('');
  const [metaBusy, setMetaBusy] = useState<MetaChannel | null>(null);
  const [picker, setPicker] = useState<{ sessionId: string; pages: MetaPageOption[]; channel: MetaChannel } | null>(null);
  const [pickerBusy, setPickerBusy] = useState(false);
  const igConn = metaInfo?.connections.instagram || null;
  const msgConn = metaInfo?.connections.messenger || null;

  /** New connection state from the server, mirrored onto the business for the sidebar. */
  const applyMetaConnections = (connections: MetaChannelsInfo['connections']) => {
    setMetaInfo((p) => ({ success: true, configured: p?.configured ?? true, connections }));
    if (business) {
      onConnected({
        ...business,
        instagramConnected: connections.instagram?.status === 'connected',
        instagramUsername: connections.instagram?.igUsername || undefined,
        messengerConnected: connections.messenger?.status === 'connected',
        messengerPageName: connections.messenger?.pageName || undefined,
      });
    }
  };

  // Runs straight from the click, so Meta's popup isn't blocked.
  const startMetaConnect = (channel: MetaChannel) => {
    if (demo) {
      notify('error', 'Not available in the demo', 'Sign in to your own CRM to connect Instagram or Messenger.');
      return;
    }
    if (fbNotConfiguredFor(channel)) {
      notify('error', 'Not set up yet', BUSINESS_LOGIN_NOT_CONFIGURED);
      return;
    }
    setMetaBusy(channel);
    loginFor(channel)
      .login()
      .then(async (code) => {
        if (!code) return;
        const r = await api.startMetaLogin(code);
        setPicker({ sessionId: r.sessionId, pages: r.pages || [], channel });
      })
      .catch((e: unknown) => notify('error', 'Could not connect', e instanceof Error ? e.message : undefined))
      .finally(() => setMetaBusy(null));
  };

  // ---- Instagram: the banner dialog, then "Choose how to connect Instagram" ----
  const openInstagramConnect = () => {
    if (demo) {
      notify('error', 'Not available in the demo', 'Sign in to your own CRM to connect Instagram or Messenger.');
      return;
    }
    if (instagramNotConfigured) {
      notify('error', 'Not set up yet', BUSINESS_LOGIN_NOT_CONFIGURED);
      return;
    }
    setIgError('');
    setIgMethodInit(undefined);
    setIgDialog('intro');
  };

  const closeInstagramDialogs = () => {
    if (igBusy === 'connecting') return;
    cancelInstagramLogin();
    setIgBusy('');
    setIgError('');
    setIgDialog(null);
  };

  // "Log in with Facebook": the existing Login for Business popup, straight from the click.
  const connectInstagramWithFacebook = () => {
    setIgDialog(null);
    setIgError('');
    startMetaConnect('instagram');
  };

  // "Log in with Instagram": the popup opens inside this click (openInstagramLogin calls window.open first).
  const connectInstagramWithInstagram = () => {
    setIgError('');
    setIgBusy('popup');
    openInstagramLogin(api, { onStalled: () => setIgBusy((b) => (b === 'popup' ? '' : b)) })
      .then(async (r) => {
        if (!r) return;
        setIgBusy('connecting');
        const res = await api.connectInstagramLogin(r);
        applyMetaConnections(res.connections);
        setIgDialog(null);
        const ig = res.connections.instagram;
        notify('success', 'Instagram connected', `Direct messages to @${ig?.igUsername || ig?.igUserId || 'your account'} will appear in your Chats.`);
      })
      .catch((e: unknown) => {
        if (e instanceof InstagramLoginError && e.code === 'WRONG_ORIGIN') {
          const target = igLoginCfg.publicUrl || e.redirectOrigin;
          setIgDialog(null);
          if (/^https:\/\//.test(target)) {
            void confirm({
              title: 'Switch to the secure link?',
              message: `Instagram sends the login back to ${target}. The CRM will open there — sign in once, then connect Instagram again.`,
              confirmLabel: 'Open secure link',
              cancelLabel: 'Not now',
              tone: 'primary',
            }).then((go) => {
              if (go) setTimeout(() => window.location.assign(`${target}/#/login`), 300);
            });
          } else {
            notify('error', 'Open the CRM over https', e.message);
          }
          return;
        }
        setIgError(e instanceof Error ? e.message : 'Could not connect Instagram.');
      })
      .finally(() => setIgBusy(''));
  };

  const finishMetaConnect = (pageId: string, channels: MetaChannel[]) => {
    if (!picker) return;
    setPickerBusy(true);
    api
      .connectMetaChannel({ sessionId: picker.sessionId, pageId, channels })
      .then((r) => {
        applyMetaConnections(r.connections);
        setPicker(null);
        notify(
          'success',
          `${channels.map((c) => META_LABEL[c]).join(' and ')} connected`,
          'New messages will appear in your Chats.',
        );
      })
      .catch((e: unknown) => notify('error', 'Could not connect', e instanceof Error ? e.message : undefined))
      .finally(() => setPickerBusy(false));
  };

  const disconnectMeta = async (channel: MetaChannel) => {
    const ok = await confirm({
      title: `Disconnect ${META_LABEL[channel]}?`,
      message:
        channel === 'instagram'
          ? 'Instagram direct messages will stop arriving in your Chats and you won’t be able to reply to them here. Your existing chats stay.'
          : 'Messenger messages to your Facebook Page will stop arriving in your Chats and you won’t be able to reply to them here. Your existing chats stay.',
      confirmLabel: 'Disconnect',
    });
    if (!ok) return;
    api
      .disconnectMetaChannel(channel)
      .then((r) => {
        applyMetaConnections(r.connections);
        notify('success', `${META_LABEL[channel]} disconnected`);
      })
      .catch((e: unknown) => notify('error', 'Could not disconnect', e instanceof Error ? e.message : undefined));
  };

  // Synchronize activeTab if initialTab changes externally
  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  const handleTabClick = (tab: ChannelTab) => {
    setActiveTab(tab);
    onTabChange?.(tab);
  };

  const hasOwnNumber = demo || (!!business?.whatsappConnected && !!(business?.meta?.displayPhoneNumber || business?.whatsappNumber || (business as any)?.phoneNumberId));

  // Live number status from Meta (GET /api/channel/status). null = not loaded.
  const [status, setStatus] = useState<ChannelStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const loadStatus = useCallback(
    (refresh = false) => {
      setStatusLoading(true);
      return api
        .getChannelStatus(refresh)
        .then((s) => setStatus(s))
        .catch((e: unknown) =>
          setStatus((prev) => ({
            ...(prev || { success: false, connected: true }),
            error: e instanceof Error ? e.message : 'Could not load the status from Meta',
            stale: !!prev?.number,
          })),
        )
        .finally(() => setStatusLoading(false));
    },
    [api],
  );
  useEffect(() => {
    if (hasOwnNumber) void loadStatus();
    else setStatus(null);
  }, [hasOwnNumber, business?.phoneNumberId, loadStatus]);

  // The top-bar widget shows the same live status.
  useEffect(() => {
    if (demo || !status?.number?.status) return;
    window.dispatchEvent(new CustomEvent(CHANNEL_STATUS_EVENT, { detail: { status: status.number.status } }));
    if (String(status.number.status).toUpperCase() === 'CONNECTED') {
      try {
        sessionStorage.removeItem(SIGNUP_ACTIVATION_KEY);
      } catch {
        // ignore
      }
    }
  }, [demo, status?.number?.status]);

  // Embedded Signup left the number Pending: show why, and read the status again.
  const [signupError, setSignupError] = useState<ActivationFailure | null>(readSignupError);
  useEffect(() => {
    const onSignup = (e: Event) => {
      setSignupError((e as CustomEvent<SignupActivation>).detail?.error || null);
      setSelectedSubItem('connect');
      setActiveTab('whatsapp');
    };
    window.addEventListener(NUMBER_ACTIVATION_EVENT, onSignup);
    return () => window.removeEventListener(NUMBER_ACTIVATION_EVENT, onSignup);
  }, []);

  const onActivated = (r: ActivationResult) => {
    setSignupError(null);
    try {
      sessionStorage.removeItem(SIGNUP_ACTIVATION_KEY);
    } catch {
      // ignore
    }
    if (r.channel?.number) setStatus(r.channel);
    else void loadStatus(true);
  };

  // The backend has the final say: no number of its own → the Connect state.
  const isWaConnected = hasOwnNumber && status?.connected !== false;
  // Until the server answers, the flags from /api/auth/me.
  const isIgConnected = metaInfo ? igConn?.status === 'connected' : !!business?.instagramConnected;
  const isMessengerConnected = metaInfo ? msgConn?.status === 'connected' : !!business?.messengerConnected;
  const isConnected = isWaConnected;
  const isCurrentChannelConnected =
    activeTab === 'whatsapp'
      ? isConnected
      : activeTab === 'instagram'
      ? isIgConnected
      : isMessengerConnected;

  const num = status?.number || null;
  const limit = status?.limit || null;
  const waba = status?.waba || null;
  const health = num?.health || null;
  const loadingFirst = statusLoading && !num;

  const savedNumber = (business?.meta?.displayPhoneNumber || business?.whatsappNumber || '').replace(/[^\d+]/g, '');
  const displayPhone =
    num?.displayPhoneNumber || (savedNumber ? (savedNumber.startsWith('+') ? savedNumber : `+${savedNumber}`) : '');

  const wabaName = waba?.name || business?.meta?.wabaName || '';
  const verifiedName = num?.verifiedName || business?.meta?.verifiedName || '';
  const phoneNumberId = num?.phoneNumberId || business?.phoneNumberId || '';
  const wabaId = waba?.id || business?.wabaId || '';

  const quality = num ? QUALITY[num.qualityRating] || { label: humanize(num.qualityRating), tone: 'grey' as Tone } : null;
  const numberTone = numberStatusTone(num?.status);
  const reviewStatus = waba?.accountReviewStatus || '';
  const pending = (label = 'Loading…') => ({ label: loadingFirst ? label : '—', tone: 'grey' as Tone });

  // Header badge for each sub-item, from the same live values.
  const subBadge: Record<Exclude<SubItem, 'connect' | 'limit' | 'calling'>, { label: string; tone: Tone }> = {
    quality_rating: quality || pending(),
    phone_number: num?.status ? { label: humanize(num.status), tone: numberTone } : pending(),
    approval: reviewStatus ? { label: humanize(reviewStatus), tone: reviewTone(reviewStatus) } : pending(),
    display_name: num?.nameStatus ? { label: humanize(num.nameStatus), tone: reviewTone(num.nameStatus) } : pending(),
  };

  // The tier track: Meta's current path, plus the number's own tier if it is
  // a legacy one (TIER_50 / TIER_1K) or anything else with a numeric limit.
  const track = (() => {
    const t = TIER_TRACK.slice();
    if (limit?.tier && !t.some((x) => x.tier === limit.tier) && limit.limit != null) {
      t.push({ tier: limit.tier, label: limit.label, limit: limit.limit });
      t.sort((a, b) => a.limit - b.limit);
    }
    return t;
  })();
  const currentIdx = limit ? track.findIndex((x) => x.tier === limit.tier) : -1;
  const nextTier = currentIdx >= 0 ? TIER_TRACK.find((x) => x.limit > track[currentIdx].limit) : undefined;

  // The number's real Cloud API state, not just "a token is stored".
  const liveStatus = String(num?.status || '').toUpperCase();
  const numberConnected = demo || liveStatus === 'CONNECTED';
  const needsActivation = !demo && !!status?.activation?.needed;
  const connectBadge: { label: string; tone: Tone } = numberConnected
    ? { label: 'Completed', tone: 'green' }
    : needsActivation
    ? { label: 'Pending', tone: 'amber' }
    : liveStatus
    ? { label: humanize(liveStatus), tone: numberTone }
    : { label: loadingFirst ? 'Checking…' : 'Unknown', tone: 'grey' };

  const fetchedAt = status?.fetchedAt ? new Date(status.fetchedAt) : null;
  const lastUpdated = fetchedAt
    ? fetchedAt.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    : loadingFirst
    ? 'Loading…'
    : '—';

  return (
    <div className="cs-page">
      {/* Left Sidebar */}
      <aside className="cs-sidebar">
        <div className="cs-sidebar-header">
          <h2 className="cs-sidebar-title">{isConnected ? 'Channel Status' : 'Channels'}</h2>
          <p className="cs-sidebar-sub">View and manage your connections</p>
        </div>

        {!isConnected ? (
          /* Channels List when WhatsApp is not connected */
          <div className="cs-channels-list">
            <button
              type="button"
              className={`cs-channel-row-btn ${activeTab === 'whatsapp' ? 'active' : ''}`}
              data-testid="cs-channel-row-whatsapp"
              onClick={() => handleTabClick('whatsapp')}
            >
              <div className="cs-channel-row-left">
                <img src="/whatsapp.svg" alt="WhatsApp" className="cs-channel-row-icon" />
                <span className="cs-channel-row-name">WhatsApp</span>
              </div>
              <span className={`cs-channel-row-badge ${isWaConnected ? 'connected' : ''}`}>
                {isWaConnected ? 'Connected' : 'Not set up'}
              </span>
            </button>

            <button
              type="button"
              className={`cs-channel-row-btn ${activeTab === 'instagram' ? 'active' : ''}`}
              data-testid="cs-channel-row-instagram"
              onClick={() => handleTabClick('instagram')}
            >
              <div className="cs-channel-row-left">
                <img src="/channel-instagram.svg" alt="Instagram" className="cs-channel-row-icon" />
                <span className="cs-channel-row-name">Instagram</span>
              </div>
              {COMING_SOON.instagram && !isIgConnected ? (
                <SoonPill />
              ) : (
                <span className={`cs-channel-row-badge ${isIgConnected ? 'connected' : ''}`}>
                  {isIgConnected ? 'Connected' : 'Not set up'}
                </span>
              )}
            </button>

            <button
              type="button"
              className={`cs-channel-row-btn ${activeTab === 'messenger' ? 'active' : ''}`}
              data-testid="cs-channel-row-messenger"
              onClick={() => handleTabClick('messenger')}
            >
              <div className="cs-channel-row-left">
                <img src="/channel-messenger.svg" alt="Messenger" className="cs-channel-row-icon" />
                <span className="cs-channel-row-name">Messenger</span>
              </div>
              {COMING_SOON.messenger && !isMessengerConnected ? (
                <SoonPill />
              ) : (
                <span className={`cs-channel-row-badge ${isMessengerConnected ? 'connected' : ''}`}>
                  {isMessengerConnected ? 'Connected' : 'Not set up'}
                </span>
              )}
            </button>
          </div>
        ) : (
          /* Connected State: Tabs & Detailed sub-items */
          <>
            {/* Channel Tabs: WhatsApp, Instagram, Messenger */}
            <div className="cs-channel-tabs">
              <button
                type="button"
                className={`cs-tab-btn ${activeTab === 'whatsapp' ? 'active' : ''}`}
                onClick={() => handleTabClick('whatsapp')}
                title="WhatsApp Channel"
              >
                <img src="/whatsapp.svg" alt="WhatsApp" className="cs-tab-icon" />
                <span className="cs-tab-text">WhatsApp</span>
              </button>

              <button
                type="button"
                className={`cs-tab-btn ${activeTab === 'instagram' ? 'active' : ''}`}
                onClick={() => handleTabClick('instagram')}
                title="Instagram Channel"
              >
                <img src="/channel-instagram.svg" alt="Instagram" className="cs-tab-icon" />
                <span className="cs-tab-text">Instagram</span>
                {isIgConnected ? (
                  <span className="cs-tab-badge-new" style={{ background: '#dcfce7', color: '#15803d' }}>
                    Live
                  </span>
                ) : COMING_SOON.instagram ? (
                  <span className="cs-tab-badge-new" style={SOON_BADGE} data-testid="cs-tab-soon-instagram">Soon</span>
                ) : null}
              </button>

              <button
                type="button"
                className={`cs-tab-btn ${activeTab === 'messenger' ? 'active' : ''}`}
                onClick={() => handleTabClick('messenger')}
                title="Messenger Channel"
              >
                <img src="/channel-messenger.svg" alt="Messenger" className="cs-tab-icon" />
                <span className="cs-tab-text">Messenger</span>
                {isMessengerConnected ? (
                  <span className="cs-tab-badge-new" style={{ background: '#dcfce7', color: '#15803d' }}>
                    Live
                  </span>
                ) : COMING_SOON.messenger ? (
                  <span className="cs-tab-badge-new" style={SOON_BADGE} data-testid="cs-tab-soon-messenger">Soon</span>
                ) : (
                  <span className="cs-tab-badge-new">New</span>
                )}
              </button>
            </div>

            {/* Channel Specific Content */}
            {activeTab === 'whatsapp' ? (
              <div className="cs-sidebar-body">
                {/* Connected Number Input Card matching Image 1 */}
                <div className="cs-number-card">
                  <div className="cs-number-left">
                    <img src="/whatsapp.svg" alt="" className="cs-number-wa-icon" />
                    <span className="cs-number-text">
                      {displayPhone || '—'}
                    </span>
                    {!demo && liveStatus && (
                      <span
                        className={`cs-quality-pill cs-number-status-pill ${numberTone}`}
                        title={`Meta reports this number as ${humanize(liveStatus)}`}
                        data-testid="cs-number-status"
                      >
                        {humanize(liveStatus)}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    className="cs-number-add-btn"
                    onClick={() => {
                      if (isConnected) {
                        alert('Your WhatsApp number is already connected! To change it, disconnect first.');
                      }
                    }}
                  >
                    ⊕ Add
                  </button>
                </div>

                {/* Mandatory Section */}
                <div className="cs-section">
                  <div className="cs-section-label">Mandatory</div>
                  <button
                    type="button"
                    className={`cs-item-btn ${selectedSubItem === 'connect' ? 'active' : ''}`}
                    onClick={() => setSelectedSubItem('connect')}
                  >
                    <div className={`cs-item-check ${numberConnected ? 'completed' : 'pending'}`}>
                      {numberConnected ? '✓' : '!'}
                    </div>
                    <div className="cs-item-info">
                      <span className="cs-item-title">Connect Account</span>
                      <span className="cs-item-desc">
                        {needsActivation ? 'Pending — activate this number' : 'Link your Business Manager & Number'}
                      </span>
                    </div>
                  </button>
                </div>

                {/* Others Section (Matching Image 2 exactly) */}
                <div className="cs-section">
                  <div className="cs-section-label">Others</div>

                  {/* Messaging limit */}
                  <button
                    type="button"
                    className={`cs-item-btn ${selectedSubItem === 'limit' ? 'active' : ''}`}
                    onClick={() => setSelectedSubItem('limit')}
                  >
                    <div className={`cs-item-check ${isConnected ? 'completed' : 'pending'}`}>
                      {isConnected ? '✓' : '•'}
                    </div>
                    <div className="cs-item-info">
                      <span className="cs-item-title">Messaging limit</span>
                      <span className="cs-item-desc">Know your Messaging Limits</span>
                    </div>
                  </button>

                  {/* Approval Status */}
                  <button
                    type="button"
                    className={`cs-item-btn ${selectedSubItem === 'approval' ? 'active' : ''}`}
                    onClick={() => setSelectedSubItem('approval')}
                  >
                    <div className={`cs-item-check ${isConnected ? 'completed' : 'pending'}`}>
                      {isConnected ? '✓' : '•'}
                    </div>
                    <div className="cs-item-info">
                      <span className="cs-item-title">Approval Status</span>
                      <span className="cs-item-desc">Check account approval status</span>
                    </div>
                  </button>

                  {/* WhatsApp Display Name */}
                  <button
                    type="button"
                    className={`cs-item-btn ${selectedSubItem === 'display_name' ? 'active' : ''}`}
                    onClick={() => setSelectedSubItem('display_name')}
                  >
                    <div className={`cs-item-check ${isConnected ? 'completed' : 'pending'}`}>
                      {isConnected ? '✓' : '•'}
                    </div>
                    <div className="cs-item-info">
                      <span className="cs-item-title">WhatsApp Display Name</span>
                      <span className="cs-item-desc">Know your WhatsApp Display Name Status</span>
                    </div>
                  </button>

                  {/* Phone Number Status (Image 2) */}
                  <button
                    type="button"
                    className={`cs-item-btn ${selectedSubItem === 'phone_number' ? 'active' : ''}`}
                    onClick={() => setSelectedSubItem('phone_number')}
                  >
                    <div className={`cs-item-check ${isConnected ? 'completed' : 'pending'}`}>
                      {isConnected ? '✓' : '•'}
                    </div>
                    <div className="cs-item-info">
                      <span className="cs-item-title">Phone Number Status</span>
                      <span className="cs-item-desc">Check Number Connection Status</span>
                    </div>
                  </button>

                  {/* Quality Rating (Image 2) */}
                  <button
                    type="button"
                    className={`cs-item-btn ${selectedSubItem === 'quality_rating' ? 'active' : ''}`}
                    onClick={() => setSelectedSubItem('quality_rating')}
                  >
                    <div className={`cs-item-check ${isConnected ? 'completed' : 'pending'}`}>
                      {isConnected ? '✓' : '•'}
                    </div>
                    <div className="cs-item-info">
                      <span className="cs-item-title">Quality Rating</span>
                      <span className="cs-item-desc">Know phone number's quality rating</span>
                    </div>
                  </button>
                </div>

                {/* Features: voice calls on the number (video and screen sharing: Soon). */}
                <div className="cs-section">
                  <div className="cs-section-label">Features</div>
                  <button
                    type="button"
                    className={`cs-item-btn ${selectedSubItem === 'calling' ? 'active' : ''}`}
                    onClick={() => setSelectedSubItem('calling')}
                    data-testid="cs-item-calling"
                  >
                    <div className={`cs-item-check ${isConnected ? 'completed' : 'pending'}`}>
                      <span className="material-icons" style={{ fontSize: 13 }}>call</span>
                    </div>
                    <div className="cs-item-info">
                      <span className="cs-item-title">Calling</span>
                      <span className="cs-item-desc">Voice calls on WhatsApp · video <SoonPill /></span>
                    </div>
                  </button>
                </div>
              </div>
            ) : activeTab === 'instagram' ? (
              <div className="cs-sidebar-body">
                <div className="cs-number-card">
                  <span className="cs-number-text">
                    {isIgConnected
                      ? (igConn?.igUsername || business?.instagramUsername)
                        ? `@${igConn?.igUsername || business?.instagramUsername}`
                        : 'Instagram'
                      : 'Instagram Direct'}
                  </span>
                  <span className={`cs-status-pill ${isIgConnected ? 'connected' : 'active'}`}>
                    {isIgConnected ? 'Connected' : 'Available'}
                  </span>
                </div>
                <div className="cs-section">
                  <div className="cs-section-label">Features</div>
                  <div className="cs-item-btn active">
                    <div className={`cs-item-check ${isIgConnected ? 'completed' : 'pending'}`}>
                      {isIgConnected ? '✓' : '•'}
                    </div>
                    <div className="cs-item-info">
                      <span className="cs-item-title">Direct Messages</span>
                      <span className="cs-item-desc">Manage IG chats, stories & replies</span>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="cs-sidebar-body">
                <div className="cs-number-card">
                  <span className="cs-number-text">
                    {isMessengerConnected ? (msgConn?.pageName || business?.messengerPageName || 'Facebook Page') : 'Facebook Messenger'}
                  </span>
                  <span className={`cs-status-pill ${isMessengerConnected ? 'connected' : 'active'}`}>
                    {isMessengerConnected ? 'Connected' : 'Available'}
                  </span>
                </div>
                <div className="cs-section">
                  <div className="cs-section-label">Features</div>
                  <div className="cs-item-btn active">
                    <div className={`cs-item-check ${isMessengerConnected ? 'completed' : 'pending'}`}>
                      {isMessengerConnected ? '✓' : '•'}
                    </div>
                    <div className="cs-item-info">
                      <span className="cs-item-title">Page Messenger</span>
                      <span className="cs-item-desc">Connect Facebook page to CRM</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </aside>

      {/* Main Content Area */}
      <main className="cs-main">
        {/* Top Header Bar */}
        <div className="cs-top-bar">
          <div className="cs-top-left">
            <div className="cs-top-heading-row">
              <h1 className="cs-top-title">
                {activeTab === 'whatsapp'
                  ? !isConnected
                    ? 'Connect Account'
                    : selectedSubItem === 'connect'
                    ? 'Connect Account'
                    : selectedSubItem === 'limit'
                    ? 'Messaging limit'
                    : selectedSubItem === 'approval'
                    ? 'Approval Status'
                    : selectedSubItem === 'display_name'
                    ? 'WhatsApp Display Name'
                    : selectedSubItem === 'phone_number'
                    ? 'Phone Number Status'
                    : selectedSubItem === 'calling'
                    ? 'WhatsApp Calling'
                    : 'Quality Rating'
                  : activeTab === 'instagram'
                  ? 'Instagram Direct'
                  : 'Messenger Integration'}
              </h1>

              {activeTab === 'whatsapp' ? (
                !isConnected ? (
                  <span className="cs-badge-not-started">Not Started</span>
                ) : selectedSubItem === 'connect' ? (
                  <span className={`cs-badge-status ${BADGE_CLASS[connectBadge.tone]}`} data-testid="cs-connect-badge">
                    {connectBadge.label}
                  </span>
                ) : selectedSubItem === 'limit' || selectedSubItem === 'calling' ? (
                  null
                ) : (
                  <span className={`cs-badge-status ${BADGE_CLASS[subBadge[selectedSubItem].tone]}`}>
                    {subBadge[selectedSubItem].label}
                  </span>
                )
              ) : activeTab === 'instagram' ? (
                isIgConnected ? (
                  <span className="cs-badge-status completed">Connected</span>
                ) : COMING_SOON.instagram ? (
                  <SoonPill className="lg" />
                ) : (
                  <span className="cs-badge-not-started">Not Started</span>
                )
              ) : (
                isMessengerConnected ? (
                  <span className="cs-badge-status completed">Connected</span>
                ) : COMING_SOON.messenger ? (
                  <SoonPill className="lg" />
                ) : (
                  <span className="cs-badge-not-started">Not Started</span>
                )
              )}
            </div>

            {activeTab === 'whatsapp' && isConnected && (
              <span className="cs-last-updated">
                Last Updated : {lastUpdated} <Info tip={TIPS.lastUpdated} />
                {!demo && (
                  <button
                    type="button"
                    className="cs-refresh-link"
                    disabled={statusLoading}
                    onClick={() => void loadStatus(true)}
                    title="Read the latest values from Meta"
                  >
                    {statusLoading ? 'Refreshing…' : 'Refresh'}
                  </button>
                )}
              </span>
            )}
            {activeTab === 'whatsapp' && isConnected && status?.error && (
              <span className="cs-status-error" role="status">
                {status.stale && fetchedAt
                  ? `Couldn't refresh from Meta (${status.error}). Showing the values from ${lastUpdated}.`
                  : `Couldn't load this number's status from Meta: ${status.error}`}
              </span>
            )}
            {activeTab === 'whatsapp' && isConnected && !!status?.otherApps?.length && (
              <div className="cs-other-apps" role="alert" data-testid="cs-other-apps">
                <strong>
                  Another app is connected to this WhatsApp number:{' '}
                  {status.otherApps.map((a) => `${a.name || 'App'} (ID ${a.id})`).join(', ')}
                </strong>
                <span>
                  WhatsApp lets only one app answer each chat. While this app is attached it can take your chats,
                  so its old automation replies and your messages from the CRM may be refused. Remove it in
                  Meta Business Suite → Settings → WhatsApp accounts → this account → Partners, or delete that app
                  in developers.facebook.com. Messages it holds still appear here.
                </span>
              </div>
            )}
            {activeTab === 'whatsapp' && isConnected && !!status?.threadControl?.at && (
              <div className="cs-other-apps cs-thread-control" role="alert" data-testid="cs-thread-control">
                <strong>Another app is answering chats on this number</strong>
                <span>
                  WhatsApp refused a message from the CRM because a Meta app from an earlier setup (an old automation, a
                  developer app or another tool) still controls chats on {displayPhone || 'this number'}
                  {status.threadControl.phone ? <>, including the chat with +{status.threadControl.phone}</> : null}. Its
                  old replies go out and your journeys can&apos;t answer there. Turning off its webhook isn&apos;t enough:
                  remove this number from that app (its WhatsApp → API Setup), or delete the app, then send a message
                  again. Or connect a different number.
                </span>
                <span className="cs-thread-actions">
                  <button
                    type="button"
                    className="k-btn ghost sm"
                    data-testid="cs-thread-dismiss"
                    onClick={() => {
                      void api.dismissThreadControl().then(() =>
                        setStatus((s) => (s ? { ...s, threadControl: null } : s)),
                      );
                    }}
                  >
                    I&apos;ve fixed it
                  </button>
                </span>
              </div>
            )}
          </div>

          {!isCurrentChannelConnected ? (
            <div className="cs-trialling-pill">
              <span className="cs-trialling-icon">ⓘ</span>
              <span>You are trialling our Business Plan. You can upgrade anytime.</span>
            </div>
          ) : (
            <div className="cs-top-right">
              <button
                type="button"
                className="cs-link-btn"
                onClick={() => window.open('https://help.kapso.io', '_blank')}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                  <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                </svg>
                <span>Help Guide</span>
              </button>
              {selectedSubItem === 'connect' && (
                <button
                  type="button"
                  className="cs-link-btn"
                  onClick={() => window.open('https://youtube.com', '_blank')}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <polygon points="10 8 16 12 10 16 10 8" fill="currentColor" />
                  </svg>
                  <span>Watch Tutorial</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Content Body */}
        <div className={`cs-content-body${activeTab === 'whatsapp' && !isConnected ? ' has-unconnected-hero' : ''}`}>
          {activeTab === 'whatsapp' ? (
            !isConnected ? (
              <div className="cs-unconnected-hero-box">
                <div className="cs-unconnected-logos-row">
                  <img src="/whatsapp.svg" alt="WhatsApp" className="cs-unconnected-logo-img" />
                  <span className="cs-unconnected-arrow">⇄</span>
                  <MetaInfinityLogo width={46} height={31} />
                </div>

                <h2 className="cs-unconnected-headline">
                  Connect WhatsApp to unlock 2B+ users
                </h2>
                <p className="cs-unconnected-subline">
                  WhatsApp is the most used messaging app globally.<br />
                  Connect your account to start messaging.
                </p>

                <div className="cs-unconnected-benefits-box">
                  <h3 className="cs-unconnected-benefits-title">
                    Benefits of connecting your own number
                  </h3>
                  <ul className="cs-unconnected-benefits-list">
                    <li className="cs-unconnected-benefit-item">
                      <BenefitCheckIcon />
                      <span>Sending messages from your brand name</span>
                    </li>
                    <li className="cs-unconnected-benefit-item">
                      <BenefitCheckIcon />
                      <span>Free 100 INR credits</span>
                    </li>
                    <li className="cs-unconnected-benefit-item">
                      <BenefitCheckIcon />
                      <span>Respond to unlimited customer initiated conversations</span>
                    </li>
                  </ul>

                  <div className="cs-unconnected-cta-row">
                    <ConnectWhatsAppButton
                      api={api}
                      onConnected={onConnected}
                      business={business}
                      label="Connect WhatsApp Account"
                    />
                  </div>
                </div>
              </div>
            ) : (
              selectedSubItem === 'connect' && needsActivation ? (
                /* Linked, but Meta lists the number as Pending: activate it */
                <ActivateNumberPanel
                  api={api}
                  displayPhone={displayPhone}
                  status={liveStatus}
                  codeVerificationStatus={num?.codeVerificationStatus}
                  hasSavedPin={!!status?.activation?.hasSavedPin}
                  signupError={signupError}
                  demo={demo}
                  onActivated={onActivated}
                />
              ) : selectedSubItem === 'connect' && !numberConnected ? (
                <NumberStateCard
                  displayPhone={displayPhone}
                  status={liveStatus}
                  loading={!num && (statusLoading || !status)}
                  error={status?.error}
                />
              ) : selectedSubItem === 'connect' ? (
                /* Connect Account (Single Central Card) */
                <div className="cs-completed-card">
                  <div className="cs-card-pattern" />
                  <div className="cs-completed-inner">
                    <div className="cs-icon-circle-success">
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#24d06e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </div>
                    <h2 className="cs-completed-title">Completed</h2>
                    <p className="cs-completed-text-1">Your account has been connected.</p>
                    <p className="cs-completed-text-2">No action is pending at your end.</p>
                    <div className="cs-account-details-pill">
                      <span>WhatsApp Number: <strong>{displayPhone || '—'}</strong></span>
                      <span>•</span>
                      <span>WABA: <strong>{wabaName || wabaId || '—'}</strong></span>
                    </div>
                  </div>
                </div>
              ) : selectedSubItem === 'calling' ? (
                <CallingSettings api={api} limit={limit} />
              ) : selectedSubItem === 'limit' ? (
              /* Messaging Limit (Matching user screenshot: 5 horizontal segments with elevated Current card) */
              <div className="cs-two-col-layout">
                <div className="cs-left-content">
                  <div className="cs-limit-summary">
                    <div className="cs-limit-summary-row">
                      <span className="cs-qr-label">Your messaging limit :</span>
                      <strong className="cs-limit-value">
                        {limit ? (limit.unlimited ? 'Unlimited' : limit.limit != null ? `${limit.label} customers / 24 hours` : limit.label) : loadingFirst ? 'Loading…' : '—'}
                      </strong>
                      <Info tip={TIPS.limit} />
                    </div>
                    <div className="cs-limit-summary-row">
                      <span className="cs-limit-summary-key">Throughput :</span>
                      <span>{num ? throughputText(num.throughputLevel) : loadingFirst ? 'Loading…' : '—'}</span>
                      <Info tip={TIPS.throughput} />
                    </div>
                  </div>

                  {/* Horizontal tier track: "Current" sits on the number's real tier */}
                  <div className="cs-tier-track-wrapper">
                    <div className="cs-tier-track static">
                      {track.map((tier, idx) => {
                        const isCurrent = idx === currentIdx;
                        return (
                          <div
                            key={tier.tier}
                            className={`cs-tier-col ${isCurrent ? 'active' : ''} ${idx === 0 ? 'first' : ''} ${idx === track.length - 1 ? 'last' : ''}`}
                            title={
                              isCurrent
                                ? `Your current limit: ${tier.label}. ${TIPS.limit}`
                                : tier.limit === Infinity
                                ? 'No daily limit on unique customers.'
                                : `${tier.label} unique customers in a rolling 24 hours.`
                            }
                          >
                            {isCurrent ? (
                              <div className="cs-tier-elevated-card">
                                <span className="cs-tier-current-tag">Current</span>
                                <div className="cs-tier-active-num">{tier.label}</div>
                                <div className="cs-tier-active-desc">{TIER_DESC}</div>
                              </div>
                            ) : (
                              <span className="cs-tier-inactive-num">{tier.label}</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* How to reach the next tier, for the number's real tier */}
                  <div className="cs-criteria-banner">
                    <div className="cs-criteria-line">
                      {!limit
                        ? loadingFirst
                          ? 'Loading your messaging limit…'
                          : "Meta hasn't reported a messaging limit for this number yet."
                        : limit.unlimited
                        ? 'You are on the highest tier: there is no daily limit on unique customers.'
                        : !nextTier
                        ? `Meta reports this number's limit as ${limit.label}.`
                        : (limit.limit ?? 0) < 2000
                        ? `To reach ${nextTier.label}: send 2,000 delivered messages to unique users in 30 days with high-quality templates, or verify your business.`
                        : `To reach ${nextTier.label}: use at least half your limit (${Math.ceil((limit.limit ?? 0) / 2).toLocaleString('en-US')} unique customers) within 7 days while keeping quality high.`}
                    </div>
                    <a
                      href="#learn"
                      className="cs-criteria-link"
                      onClick={(e) => {
                        e.preventDefault();
                        window.open('https://developers.facebook.com/docs/whatsapp/messaging-limits', '_blank');
                      }}
                    >
                      Learn how this works
                    </a>
                    <div className="cs-criteria-line" style={{ marginTop: 16 }}>
                      Maintain a quality rating of high or medium
                    </div>
                  </div>
                </div>

                {/* Right Column: Tools & Tips ⓘ matching Image 1 */}
                <aside className="cs-tools-panel">
                  <div className="cs-tools-header">
                    <span>Tools & Tips</span>
                    <span className="cs-info-icon" title="Tools & Tips Information">ⓘ</span>
                  </div>

                  <h3 className="cs-tools-subtitle">Increase your messaging limit</h3>

                  <p className="cs-tools-p">
                    Messaging limits determine how many unique users your business can send messages to on a daily basis. This includes new conversations as well as existing conversations with users.
                  </p>

                  <p className="cs-tools-p">
                    The messaging limit does NOT limit the number of messages your business can send, just the number of users you are trying to message. It also does NOT apply to messages sent in response to a user-initiated message within a 24-hour period.
                  </p>

                  <ul className="cs-tools-bullets">
                    <li>
                      <span className="cs-bullet-dot">•</span>
                      <span>
                        <strong>Trial Tier :</strong> Allows your business to send messages to 250 unique customers in a rolling 24-hour period.
                      </span>
                    </li>
                    <li>
                      <span className="cs-bullet-dot">•</span>
                      <span>
                        <strong>Tier 1 :</strong> Allows your business to send messages to 2,000 unique customers in a rolling 24-hour period.
                      </span>
                    </li>
                    <li>
                      <span className="cs-bullet-dot">•</span>
                      <span>
                        <strong>Tier 2 :</strong> Allows your business to send messages to 10,000 unique customers in a rolling 24-hour period.
                      </span>
                    </li>
                    <li>
                      <span className="cs-bullet-dot">•</span>
                      <span>
                        <strong>Tier 3 :</strong> Allows your business to send messages to 100,000 unique customers in a rolling 24-hour period.
                      </span>
                    </li>
                    <li>
                      <span className="cs-bullet-dot">•</span>
                      <span>
                        <strong>Tier 4 :</strong> Allows your business to send messages to unlimited unique customers in a rolling 24-hour period.
                      </span>
                    </li>
                  </ul>
                </aside>
              </div>
            ) : selectedSubItem === 'quality_rating' ? (
              /* Quality Rating (Image 2: Exact Layout and Text) */
              <div className="cs-two-col-layout">
                <div className="cs-left-content">
                  <div className="cs-white-panel">
                    <div className="cs-qr-head-row">
                      <span className="cs-qr-label">Number Quality Rating :</span>
                      <Pill {...(quality || pending())} />
                      <Info tip={TIPS.quality} />
                    </div>

                    {num?.qualityRating === 'UNKNOWN' && (
                      <p className="cs-qr-intro">
                        Meta hasn&apos;t rated this number yet. A rating appears once you have sent messages to customers.
                      </p>
                    )}
                    {num?.qualityRating === 'RED' && (
                      <p className="cs-qr-intro cs-text-warn">
                        Customers have been blocking or reporting your messages. Meta may lower your messaging limit if this continues.
                      </p>
                    )}

                    <p className="cs-qr-intro">
                      The quality rating is determined by the quality of messages that you&apos;re sending. To maintain a high quality rating, please ensure -
                    </p>

                    <ul className="cs-qr-checklist">
                      <li>
                        <span className="cs-bullet-green">•</span>
                        <span>Only send messages to users who have opted in</span>
                      </li>
                      <li>
                        <span className="cs-bullet-green">•</span>
                        <span>Do not send spammy messages</span>
                      </li>
                      <li>
                        <span className="cs-bullet-green">•</span>
                        <span>Allow your users to opt-out from your messages</span>
                      </li>
                    </ul>

                    <p className="cs-qr-restore-note">
                      If your quality rating becomes low, it shall be restored to the default rating &quot;High&quot; within 7 days.
                    </p>
                  </div>
                </div>

                {/* Right Column: Tools & Tips ⓘ matching Image 2 */}
                <aside className="cs-tools-panel">
                  <div className="cs-tools-header">
                    <span>Tools & Tips</span>
                    <span className="cs-info-icon" title="Tools & Tips Information">ⓘ</span>
                  </div>

                  <ul className="cs-tools-bullets" style={{ marginTop: 14 }}>
                    <li>
                      <span className="cs-bullet-green">•</span>
                      <span>
                        Always send messages to contacts that have opted in to receive messages from your business
                      </span>
                    </li>
                    <li>
                      <span className="cs-bullet-green">•</span>
                      <span>
                        Allow contacts to opt out of messages to avoid getting blocked or marked as spam.
                      </span>
                    </li>
                    <li>
                      <span className="cs-bullet-green">•</span>
                      <span>
                        To allow your users to opt-out of messages you can follow this quick guide{' '}
                        <a
                          href="https://support.wati.io/l/en/article/52b1g1j0x1-how-to-allow-users-to-opt-out-or-unsubscribe-from-broadcasts"
                          target="_blank"
                          rel="noreferrer"
                          className="cs-inline-link"
                        >
                          (https://support.wati.io/l/en/article/52b1g... how-to-allow-users-to-opt-out-or-unsubscribe-from-broadcasts)
                        </a>
                      </span>
                    </li>
                  </ul>
                </aside>
              </div>
            ) : selectedSubItem === 'phone_number' ? (
              /* Phone Number Status (New Option in Image 2) */
              <div className="cs-two-col-layout">
                <div className="cs-left-content">
                  <div className="cs-white-panel">
                    <div className="cs-qr-head-row">
                      <span className="cs-qr-label">Number Connection Status :</span>
                      <Pill {...subBadge.phone_number} />
                      <Info tip={TIPS.status} />
                    </div>

                    <div className="cs-status-keyval-list">
                      <KeyVal k="Phone Number" tip={TIPS.displayPhone}>
                        <strong>{displayPhone || '—'}</strong>
                      </KeyVal>
                      <KeyVal k="Verified Display Name" tip={TIPS.verifiedName}>
                        <strong>{verifiedName || '—'}</strong>
                      </KeyVal>
                      <KeyVal k="Phone Number ID" tip={TIPS.phoneNumberId}>
                        {phoneNumberId ? <code>{phoneNumberId}</code> : '—'}
                      </KeyVal>
                      <KeyVal k="WABA Account ID" tip={TIPS.wabaId}>
                        {wabaId ? <code>{wabaId}</code> : '—'}
                      </KeyVal>
                      <KeyVal k="Code Verification" tip={TIPS.codeVerification}>
                        <Pill label={humanize(num?.codeVerificationStatus)} tone={reviewTone(num?.codeVerificationStatus)} />
                      </KeyVal>
                      <KeyVal k="Account Mode" tip={TIPS.accountMode}>
                        {humanize(num?.accountMode)}
                      </KeyVal>
                      <KeyVal k="Platform" tip={TIPS.platform}>
                        {num?.platformType === 'CLOUD_API' ? 'Cloud API' : humanize(num?.platformType)}
                      </KeyVal>
                      <KeyVal k="Throughput" tip={TIPS.throughput}>
                        {throughputText(num?.throughputLevel)}
                      </KeyVal>
                    </div>

                    <p className="cs-qr-footer-note" style={{ marginTop: 20 }}>
                      {!num
                        ? loadingFirst
                          ? 'Loading the live status from Meta…'
                          : "This number's live status couldn't be read from Meta."
                        : num.status === 'CONNECTED'
                        ? 'This number is connected to the WhatsApp Cloud API and can send and receive messages.'
                        : needsActivation
                        ? `Meta reports this number as ${humanize(num.status)}: it isn't registered with the Cloud API yet. Activate it under Connect Account.`
                        : `Meta reports this number as ${humanize(num.status)}. Open WhatsApp Manager in Meta Business Suite for details.`}
                    </p>
                  </div>
                </div>

                <aside className="cs-tools-panel">
                  <div className="cs-tools-header">
                    <span>Tools & Tips</span>
                    <span className="cs-info-icon" title="Tools & Tips Information">ⓘ</span>
                  </div>

                  <ul className="cs-tools-bullets" style={{ marginTop: 14 }}>
                    <li>
                      <span className="cs-bullet-green">•</span>
                      <span>
                        Keep your phone number capable of receiving SMS or calls in case Meta requests occasional identity re-verification.
                      </span>
                    </li>
                    <li>
                      <span className="cs-bullet-green">•</span>
                      <span>
                        Two-step verification PIN is securely held by the platform to protect your account against unauthorized number porting.
                      </span>
                    </li>
                    <li>
                      <span className="cs-bullet-green">•</span>
                      <span>
                        Do not remove or disconnect this phone number from Meta Business Manager while your CRM campaigns are active.
                      </span>
                    </li>
                  </ul>
                </aside>
              </div>
            ) : selectedSubItem === 'approval' ? (
              /* Approval Status */
              <div className="cs-two-col-layout">
                <div className="cs-left-content">
                  <div className="cs-white-panel">
                    <div className="cs-qr-head-row">
                      <span className="cs-qr-label">Account Approval Overview :</span>
                      <Pill {...subBadge.approval} />
                      <Info tip={TIPS.review} />
                    </div>

                    <div className="cs-status-keyval-list">
                      <KeyVal k="WhatsApp Business Account" tip={TIPS.wabaName}>
                        <strong>{wabaName || '—'}</strong>
                      </KeyVal>
                      <KeyVal k="Account Review" tip={TIPS.review}>
                        <Pill label={humanize(waba?.accountReviewStatus)} tone={reviewTone(waba?.accountReviewStatus)} />
                      </KeyVal>
                      <KeyVal k="Meta Business Verification" tip={TIPS.businessVerification}>
                        <Pill label={humanize(waba?.businessVerificationStatus)} tone={reviewTone(waba?.businessVerificationStatus)} />
                      </KeyVal>
                      <KeyVal k="Display Name Status" tip={TIPS.nameStatus}>
                        <Pill label={humanize(num?.nameStatus)} tone={reviewTone(num?.nameStatus)} />
                      </KeyVal>
                      <KeyVal k="Phone Number Status" tip={TIPS.status}>
                        <Pill label={humanize(num?.status)} tone={numberTone} />
                      </KeyVal>
                      <KeyVal k="Can Start Conversations" tip={TIPS.canSend}>
                        <Pill label={humanize(health?.canSendMessage)} tone={reviewTone(health?.canSendMessage)} />
                      </KeyVal>
                    </div>

                    {!!health?.errors?.length && (
                      <ul className="cs-health-errors">
                        {health.errors.map((er, i) => (
                          <li key={`${er.code}-${i}`} className="cs-health-error">
                            <strong>
                              {!er.entity ? 'Meta' : ['WABA', 'APP'].includes(er.entity) ? er.entity : humanize(er.entity)}
                              {er.code != null ? ` · ${er.code}` : ''}:
                            </strong>{' '}
                            {er.description}
                            {er.solution && <div className="cs-health-solution">{er.solution}</div>}
                          </li>
                        ))}
                      </ul>
                    )}

                    <p className="cs-qr-footer-note" style={{ marginTop: 20 }}>
                      {!num
                        ? loadingFirst
                          ? 'Loading the live status from Meta…'
                          : "This account's status couldn't be read from Meta."
                        : !waba
                        ? "The WhatsApp Business Account's review status couldn't be read with this account's access token."
                        : health?.errors?.length || health?.canSendMessage === 'BLOCKED' || health?.canSendMessage === 'LIMITED'
                        ? 'Meta reports an issue that limits what this account can send. Fix it in Meta Business Suite, then press Refresh.'
                        : reviewTone(waba.accountReviewStatus) === 'green' && reviewTone(num.nameStatus) === 'green'
                        ? 'Your account has passed Meta’s reviews and can send and receive WhatsApp messages.'
                        : 'Some of Meta’s reviews are not complete yet. Check back after Meta finishes reviewing.'}
                    </p>
                  </div>
                </div>

                <aside className="cs-tools-panel">
                  <div className="cs-tools-header">
                    <span>Tools & Tips</span>
                    <span className="cs-info-icon" title="Tools & Tips Information">ⓘ</span>
                  </div>

                  <ul className="cs-tools-bullets" style={{ marginTop: 14 }}>
                    <li>
                      <span className="cs-bullet-green">•</span>
                      <span>
                        Business Verification confirms your official legal organization on Meta Business Suite.
                      </span>
                    </li>
                    <li>
                      <span className="cs-bullet-green">•</span>
                      <span>
                        Verified organizations automatically qualify for faster template approvals and higher daily messaging limits.
                      </span>
                    </li>
                    <li>
                      <span className="cs-bullet-green">•</span>
                      <span>
                        To apply for Meta Official Business Account (Green Tick Badge), maintain a high quality score and have active media press coverage.
                      </span>
                    </li>
                  </ul>
                </aside>
              </div>
            ) : (
              /* WhatsApp Display Name */
              <div className="cs-two-col-layout">
                <div className="cs-left-content">
                  <div className="cs-white-panel">
                    <div className="cs-qr-head-row">
                      <span className="cs-qr-label">Display Name Status :</span>
                      <Pill {...subBadge.display_name} />
                      <Info tip={TIPS.nameStatus} />
                    </div>

                    <p className="cs-qr-intro">
                      Your WhatsApp display name is visible to all customers when they receive messages from your business.
                    </p>

                    <div className="cs-display-name-card">
                      <div className="cs-display-name-val">
                        {verifiedName || '—'} <Info tip={TIPS.verifiedName} />
                      </div>
                      {num?.nameStatus === 'APPROVED' ? (
                        <span className="cs-verified-tick">✓ Approved by Meta</span>
                      ) : num?.nameStatus ? (
                        <Pill label={humanize(num.nameStatus)} tone={reviewTone(num.nameStatus)} />
                      ) : null}
                    </div>

                    <div className="cs-status-keyval-list" style={{ marginTop: 14 }}>
                      {num?.newNameStatus && num.newNameStatus !== 'NONE' && (
                        <KeyVal k="Requested Name Change" tip={TIPS.newNameStatus}>
                          <Pill label={humanize(num.newNameStatus)} tone={reviewTone(num.newNameStatus)} />
                        </KeyVal>
                      )}
                      <KeyVal k="Official Business Account" tip={TIPS.official}>
                        {num ? (num.isOfficialBusinessAccount ? 'Yes' : 'No') : '—'}
                      </KeyVal>
                    </div>

                    <p className="cs-qr-footer-note" style={{ marginTop: 20 }}>
                      If you ever need to change your display name, submit an update via Meta Business Manager. Meta reviews name changes within 2-4 hours.
                    </p>
                  </div>
                </div>

                <aside className="cs-tools-panel">
                  <div className="cs-tools-header">
                    <span>Tools & Tips</span>
                    <span className="cs-info-icon" title="Tools & Tips Information">ⓘ</span>
                  </div>

                  <ul className="cs-tools-bullets" style={{ marginTop: 14 }}>
                    <li>
                      <span className="cs-bullet-green">•</span>
                      <span>
                        Display names must directly represent your business, website or company branding.
                      </span>
                    </li>
                    <li>
                      <span className="cs-bullet-green">•</span>
                      <span>
                        Avoid all-caps, unnecessary punctuation, or emojis in your display name.
                      </span>
                    </li>
                    <li>
                      <span className="cs-bullet-green">•</span>
                      <span>
                        Display names are subject to WhatsApp Commerce &amp; Business Policies.
                      </span>
                    </li>
                  </ul>
                </aside>
              </div>
            )
          )
        ) : COMING_SOON[activeTab] ? (
            <div className="cs-soon-wrap">
              <ComingSoonPanel feature={activeTab} compact />
              {/* A connection made before this was locked can still be removed. */}
              {(activeTab === 'instagram' ? igConn : msgConn) && (
                <div className="cs-soon-disconnect">
                  <button type="button" className="cs-disconnect-btn" onClick={() => void disconnectMeta(activeTab)} data-testid={`cs-soon-disconnect-${activeTab}`}>
                    Disconnect {META_LABEL[activeTab]}
                  </button>
                </div>
              )}
            </div>
          ) : activeTab === 'instagram' ? (
            <MetaChannelPanel
              channel="instagram"
              conn={igConn}
              busy={metaBusy === 'instagram'}
              notConfigured={instagramNotConfigured}
              onConnect={openInstagramConnect}
              onDisconnect={() => void disconnectMeta('instagram')}
            />
          ) : (
            <MetaChannelPanel
              channel="messenger"
              conn={msgConn}
              busy={metaBusy === 'messenger'}
              preparing={!demo && fbMessengerLogin.preparing}
              notConfigured={fbNotConfiguredFor('messenger')}
              onConnect={() => startMetaConnect('messenger')}
              onDisconnect={() => void disconnectMeta('messenger')}
            />
          )}
        </div>
      </main>

      {/* After Meta's login: which Page (Messenger) and its Instagram account */}
      {picker && (
        <MetaPagePicker
          pages={picker.pages}
          initialChannel={picker.channel}
          busy={pickerBusy}
          onCancel={() => setPicker(null)}
          onConnect={finishMetaConnect}
          // Instagram via Facebook, no linked account: rerun Meta's popup from the click, or switch method.
          onRetry={
            picker.channel === 'instagram'
              ? () => {
                  setPicker(null);
                  startMetaConnect('instagram');
                }
              : undefined
          }
          onUseInstagramLogin={
            picker.channel === 'instagram' && igLoginConfigured
              ? () => {
                  setPicker(null);
                  setIgError('');
                  setIgMethodInit('instagram');
                  setIgDialog('method');
                }
              : undefined
          }
        />
      )}

      {/* Instagram → Connect: the banner dialog, then the choice of login */}
      {igDialog === 'intro' && (
        <InstagramIntroDialog onClose={closeInstagramDialogs} onGetStarted={() => setIgDialog('method')} />
      )}
      {igDialog === 'method' && (
        <InstagramMethodDialog
          igLoaded={igLoginCfg.loaded}
          igConfigured={igLoginConfigured}
          fbConfigured={!fbNotConfiguredFor('instagram')}
          fbPreparing={fbLogin.preparing}
          fbNotConfiguredText="Log in with Facebook isn’t set up on this server yet (META_BUSINESS_LOGIN_CONFIG_ID)."
          initialMethod={igMethodInit}
          busy={igBusy}
          error={igError}
          onCancel={closeInstagramDialogs}
          onConnectInstagram={connectInstagramWithInstagram}
          onConnectFacebook={connectInstagramWithFacebook}
        />
      )}
    </div>
  );
}
