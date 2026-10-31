// Top-level CRM shell: a left icon rail + the active view.
// The rail is business-vertical aware — a tenant only sees the pages its
// category needs (a hospital gets Members, not Catalog/Offers), and labels
// adapt ("Doctors" instead of "Members"). See crm/verticals.ts.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CrmApi } from '../api';
import { CrmSocket } from '../socket';
import type { AppNotification, PlanFeature, PlanState, PlanTierKey } from '../types';
import { PlanContext, type PlanContextValue } from '../PlanContext';
import { hasFeature, tierFor, TIER_NAMES } from '../plans';
import { PlanLockedPage } from './PlanLocked';
import { WalletButton } from './WalletButton';
import { MockCrmApi } from '../demo/mockApi';
import { defaultConfig, type CrmConfig } from '../config';
import { NavRail, type CrmView, SettingsRailSvg, ProfileRailSvg } from './NavRail';
import { ProfileSidebarDrawer } from './ProfileSidebarDrawer';
import { NotificationDrawer } from './NotificationDrawer';
import { verticalConfig, type LabelOverrides } from '../verticals';
import { CrmApp } from './CrmApp';
import { TemplatesPage, type TemplatesTab } from './TemplatesPage';
import type { CampaignChannel, CampaignStartRequest } from '../types';
import { CampaignsPage } from './CampaignsPage';
import { FlowsPage } from './FlowsPage';
import { CatalogPage } from './CatalogPage';
import { CategoriesPage } from './CategoriesPage';
import { MembersPage } from './MembersPage';
import { OffersPage } from './OffersPage';
import { OrdersPage } from './OrdersPage';
import { ProfilePage } from './ProfilePage';
import { AdsPage } from './AdsPage';
import { CreatePage } from './CreatePage';
import { ComingSoonPage } from './ComingSoon';
import { COMING_SOON } from '../features';
import { ChannelStatusPage } from './ChannelStatusPage';
import { PaymentConfigPage } from './PaymentConfigPage';
import { WhatsAppConnectRequired } from './WhatsAppConnectRequired';
import type { BusinessProfile } from '../types';
import { useLockWindowScroll } from '../useLockWindowScroll';
import { useAppSmoothScroll } from '../useAppSmoothScroll';
import { useConfirm } from './Dialogs';
import { useBackHandler } from '../useBackHandler';
import { BuyPlanModal } from './BuyPlanModal';
import { DemoModal } from '../../site/DemoModal';
import { BookDemoSvg, NavConnectSvg, BuyNowSvg } from './TemplateIcons';
import { numberStatusTone, CHANNEL_STATUS_EVENT, NUMBER_ACTIVATION_EVENT } from '../numberStatus';
import { preloadMetaSdk } from '../metaSdk';
import type { SignupActivation } from '../types';
import './CrmApp.css';

interface Props {
  config?: Partial<CrmConfig>;
  demo?: boolean;
  onLogout?: () => void;
}

const UNCONNECTED_MARQUEE_MESSAGES: Record<string, string> = {
  chats: 'Connect your WhatsApp account to remove the 10 contact limit and message unlimited customers.',
  templates: 'Templates belong to your own WhatsApp Business Account. Connect your WhatsApp number to create and send templates.',
  campaigns: 'Campaigns belong to your own WhatsApp Business Account. Connect your WhatsApp number to launch broadcast campaigns.',
  flows: 'WhatsApp Flows and journeys run with your own WhatsApp Business Account. Connect your number to enable Flows.',
  catalog: 'Connect your WhatsApp account to unlock and publish your product catalog.',
  categories: 'Connect your WhatsApp account to manage categories for your catalog.',
  members: 'Connect your WhatsApp account to unlock team members and staff management.',
  offers: 'Connect your WhatsApp account to create and share special offers with customers.',
  orders: 'Connect your WhatsApp account to receive and manage WhatsApp orders.',
  ads: COMING_SOON.ads
    ? 'Ads are coming soon · Meanwhile, connect your WhatsApp account to chat, send campaigns and share your catalog.'
    : 'Connect your WhatsApp account to create Click-to-WhatsApp ads and capture leads.',
  create: COMING_SOON.create
    ? 'Create is coming soon · Meanwhile, connect your WhatsApp account to chat, send campaigns and share your catalog.'
    : 'Connect your WhatsApp account to reply to everyone your posts and reels bring in from one inbox.',
  'payment-config': 'Connect your WhatsApp account to configure WhatsApp Pay and collect payments.',
  'channel-status': 'Connect your WhatsApp account to activate your number and unlock all messaging features.',
  profile: 'Connect your WhatsApp account to verify your business and unlock all messaging features.',
  settings: 'Connect your WhatsApp account to verify your business and unlock all messaging features.',
};

const CONNECTED_MARQUEE_MESSAGES: Record<string, string> = {
  chats: 'WhatsApp connected · Live team inbox active · Messaging customers in real-time.',
  templates: 'WhatsApp connected · Create, submit, and send pre-approved Meta templates.',
  campaigns: 'WhatsApp connected · Broadcast messages to all your opt-in customer lists.',
  flows: 'WhatsApp connected · Native WhatsApp interactive flows and automations active.',
  catalog: 'WhatsApp connected · Showcase products and sync WhatsApp commerce catalog.',
  categories: 'WhatsApp connected · Organize your items into structured categories.',
  members: 'WhatsApp connected · Team inbox collaboration and chat assignments active.',
  offers: 'WhatsApp connected · Send high-converting deals and coupons directly to chat.',
  orders: 'WhatsApp connected · Automated order processing and delivery receipts enabled.',
  ads: COMING_SOON.ads
    ? 'WhatsApp connected · Ads are coming soon, once Meta approves them for every business.'
    : 'WhatsApp connected · Drive customer conversations from Click-to-WhatsApp ads.',
  create: COMING_SOON.create
    ? 'WhatsApp connected · Create (Facebook and Instagram posts) is coming soon, once Meta approves it.'
    : 'WhatsApp connected · Publish posts, reels and stories, and DM everyone who comments.',
  'payment-config': 'WhatsApp connected · Collect in-chat UPI payments seamlessly via WhatsApp Pay.',
  'channel-status': 'WhatsApp connected · Your business number is verified and active.',
  profile: 'WhatsApp connected · Business profile synced with Meta Business Manager.',
  settings: 'WhatsApp connected · Channel settings synced with Meta Business Manager.',
};

function renderMarqueeWithWhatsApp(text: string) {
  const parts = text.split(/(WhatsApp)/gi);
  return parts.map((part, idx) => {
    if (part.toLowerCase() === 'whatsapp') {
      return (
        <span key={idx} className="crm-top-marquee-wa-word">
          <img
            src="/whatsapp.svg"
            alt="WhatsApp"
            className="crm-top-marquee-wa-icon"
            aria-hidden="true"
          />
          <span>{part}</span>
        </span>
      );
    }
    return part;
  });
}

function TopBarMarquee({
  message,
  needsConnect,
  onConnectClick,
  side,
}: {
  message: string;
  needsConnect?: boolean;
  onConnectClick?: () => void;
  side: 'left' | 'right';
}) {
  return (
    <div
      className={`crm-top-bar-marquee ${side}`}
      onClick={needsConnect ? onConnectClick : undefined}
      title={needsConnect ? 'Click to connect your WhatsApp account' : undefined}
      role={needsConnect ? 'button' : undefined}
      tabIndex={needsConnect ? 0 : undefined}
    >
      <div className="crm-top-bar-track-single">
        <div className="crm-top-marquee-item">
          <span className="crm-top-marquee-text">{renderMarqueeWithWhatsApp(message)}</span>
          {needsConnect && (
            <span className="crm-top-marquee-badge red">
              <img
                src="/whatsapp.svg"
                alt="WhatsApp"
                className="crm-top-marquee-wa-icon-badge"
                aria-hidden="true"
              />
              <span>Connect WhatsApp</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

interface PlanTopBarProps {
  plan: PlanState | null;
  onBuyNow: () => void;
  view?: CrmView;
  needsConnect?: boolean;
  onConnectClick?: () => void;
}

/**
 * The announcement bar: the page's marquee on both sides, and in the middle
 * what the plan needs attention for (from the server's plan state):
 *   trial      "Your trial ends in N days." (a live HH:MM:SS on the last day) + Buy Now
 *   paid       from 5 days before the end: "Your Pro plan ends in N days." + Renew
 *   free       "You're on the Free plan: 10 contacts, 3 templates." + Upgrade
 * A paid plan with time left, or a business from before plans: nothing in the middle.
 */
function PlanTopBar({ plan, onBuyNow, view, needsConnect, onConnectClick }: PlanTopBarProps) {
  const [now, setNow] = useState<number>(() => Date.now());
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  const endsAt = plan?.endsAt ? new Date(plan.endsAt).getTime() : null;
  const msLeft = endsAt ? Math.max(0, endsAt - now) : null;
  const ticking = msLeft !== null && msLeft <= ONE_DAY_MS;
  useEffect(() => {
    if (!endsAt) return undefined;
    // Every second on the last day (the countdown), every minute otherwise.
    const timer = setInterval(() => setNow(Date.now()), ticking ? 1000 : 60000);
    return () => clearInterval(timer);
  }, [endsAt, ticking]);

  const pad = (n: number) => String(n).padStart(2, '0');
  const totalSec = Math.floor((msLeft || 0) / 1000);
  const timerText = `${pad(Math.floor(totalSec / 3600))} : ${pad(Math.floor((totalSec % 3600) / 60))} : ${pad(totalSec % 60)}`;
  const daysLeft = msLeft === null ? 0 : Math.max(1, Math.ceil(msLeft / ONE_DAY_MS));

  const currentMsg = needsConnect
    ? (view ? UNCONNECTED_MARQUEE_MESSAGES[view] : undefined) || 'Connect your WhatsApp account to unlock unlimited messaging and features.'
    : (view ? CONNECTED_MARQUEE_MESSAGES[view] : undefined) || 'WhatsApp connected · Channel is active and ready to message.';

  const who = plan?.status === 'trial' ? 'Your trial' : `Your ${plan?.name || ''} plan`;
  let center: ReactNode = null;
  if (plan && (plan.status === 'trial' || (plan.status === 'active' && plan.endingSoon))) {
    const label = plan.status === 'trial' ? 'Buy Now' : 'Renew';
    center = (
      <>
        {msLeft !== null && msLeft <= 0 ? (
          <span className="crm-top-bar-text">
            {who} has ended:{' '}
            <strong className="crm-top-bar-timer red">
              <span className="crm-top-bar-pulse-dot" />
              00 : 00 : 00
            </strong>
          </span>
        ) : ticking ? (
          <span className="crm-top-bar-text">
            {who} ends in{' '}
            <strong className="crm-top-bar-timer red">
              <span className="crm-top-bar-pulse-dot" />
              {timerText}
            </strong>
          </span>
        ) : (
          <span className="crm-top-bar-text" data-testid="topbar-plan-text">
            {who} ends in <strong>{daysLeft === 1 ? '1 day.' : `${daysLeft} days.`}</strong>
          </span>
        )}
        <button type="button" className="crm-top-bar-btn" onClick={onBuyNow} data-testid="topbar-buy">
          <BuyNowSvg width={16} height={16} stroke="currentColor" />
          <span>{label}</span>
        </button>
      </>
    );
  } else if (plan?.status === 'free') {
    center = (
      <>
        <span className="crm-top-bar-text" data-testid="topbar-plan-text">
          {plan.ended?.kind === 'plan' ? `Your ${plan.ended.name} plan has ended.` : plan.ended?.kind === 'trial' ? 'Your trial has ended.' : ''}{' '}
          You&apos;re on the <strong>Free plan</strong>: 10 contacts, 3 templates.
        </span>
        <button type="button" className="crm-top-bar-btn" onClick={onBuyNow} data-testid="topbar-buy">
          <BuyNowSvg width={16} height={16} stroke="currentColor" />
          <span>Upgrade</span>
        </button>
      </>
    );
  }

  return (
    <div className={`crm-top-bar${center ? '' : ' no-center'}`} data-plan-status={plan?.status || ''}>
      <TopBarMarquee
        message={currentMsg}
        needsConnect={needsConnect}
        onConnectClick={onConnectClick}
        side="left"
      />

      {center && <div className="crm-top-bar-center">{center}</div>}

      <TopBarMarquee
        message={currentMsg}
        needsConnect={needsConnect}
        onConnectClick={onConnectClick}
        side="right"
      />
    </div>
  );
}

interface CrmTopNavProps {
  business?: BusinessProfile;
  demo?: boolean;
  view: CrmView;
  onNavigate: (view: CrmView) => void;
  onBookDemo: () => void;
  onOpenProfile: () => void;
  profileDrawerOpen: boolean;
  /** Unread notifications, for the bell badge. */
  notificationsUnread: number;
  notificationsOpen: boolean;
  onToggleNotifications: () => void;
  /** Meta's live status of the number; null = not read yet, '' = Meta gave none. */
  numberStatus: string | null;
}

function CrmTopNav({
  business,
  demo,
  view,
  onNavigate,
  onBookDemo,
  onOpenProfile,
  profileDrawerOpen,
  notificationsUnread,
  notificationsOpen,
  onToggleNotifications,
  numberStatus,
}: CrmTopNavProps) {
  const rawNum = (
    business?.meta?.displayPhoneNumber ||
    business?.whatsappNumber ||
    business?.phone ||
    business?.ownerPhone ||
    ''
  ).replace(/[^\d+]/g, '');
  const displayPhone = !rawNum ? '' : rawNum.startsWith('+') ? rawNum : `+${rawNum}`;
  const isConnected = demo || business?.whatsappConnected !== false;
  // The real Meta status (CONNECTED / PENDING / FLAGGED / …), not "a token is stored".
  const status = demo
    ? 'CONNECTED'
    : (numberStatus || business?.meta?.numberStatus || '').toUpperCase();
  const statusText = status ? status.replace(/_/g, ' ') : numberStatus === null ? 'CHECKING…' : 'UNKNOWN';
  const statusClass = { green: 'connected', amber: 'pending', red: 'disconnected', grey: 'unknown' }[numberStatusTone(status)];

  return (
    <header className="crm-main-nav">
      <div className="crm-main-nav-left">
        <button
          type="button"
          className="crm-main-nav-logo-btn"
          onClick={() => onNavigate('chats')}
          title="Kapso CRM - Home"
        >
          <img src="/logo.png" alt="Kapso Solutions" className="crm-main-nav-logo" />
        </button>
      </div>

      <div className="crm-main-nav-right">
        {/* Book a Demo Button */}
        <button
          type="button"
          className="crm-nav-demo-btn"
          onClick={onBookDemo}
          title="Book a demo"
        >
          <BookDemoSvg width={16} height={16} />
          <span>Book a demo</span>
        </button>

        {/* Wallet: coming soon (opens Meta's billing page meanwhile) */}
        <WalletButton business={business} />

        <div className="crm-nav-sep" />

        {/* Notifications Icon */}
        <button
          type="button"
          className={`crm-nav-icon-btn crm-nav-bell${notificationsOpen ? ' active' : ''}`}
          title="Notifications"
          aria-label={notificationsUnread ? `Notifications, ${notificationsUnread} unread` : 'Notifications'}
          aria-expanded={notificationsOpen}
          onClick={onToggleNotifications}
          data-testid="crm-bell"
        >
          <svg width="14" height="16" viewBox="0 0 14 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path
              d="M6.99204 0C10.141 0 12.7359 2.33488 12.9765 5.3554L12.9899 5.57762L12.9944 5.80214L12.9934 9.398L13.9188 11.6202C13.9414 11.6743 13.9591 11.7302 13.9717 11.7871L13.987 11.8733L13.9957 12.0046C13.9957 12.4526 13.6991 12.8387 13.2465 12.9677L13.1302 12.9945L12.9957 13.0046L9.494 13.004L9.48902 13.1653C9.40391 14.469 8.31956 15.5 6.9944 15.5C5.66892 15.5 4.58436 14.4685 4.49972 13.1644L4.494 13.004L0.993294 13.0046C0.905342 13.0046 0.81797 12.993 0.733407 12.9702L0.608948 12.9277C0.198166 12.7567 -0.0438033 12.3392 0.00659775 11.8757L0.0276852 11.7483L0.0701043 11.6202L0.993401 9.401L0.994488 5.79281L0.998788 5.56824C1.1214 2.45115 3.76543 0 6.99204 0ZM8.494 13.004H5.494L5.50136 13.1454C5.5699 13.8581 6.13714 14.425 6.84994 14.4931L6.9944 14.5C7.7741 14.5 8.41485 13.9051 8.48753 13.1445L8.494 13.004ZM6.99204 1C4.36949 1 2.22155 2.92372 2.01154 5.38498L1.99831 5.59723L1.9944 5.80214V9.5L1.956 9.69217L0.993283 12.0046L12.951 12.0066L12.9962 12.0045L12.0328 9.6922L11.9944 9.5L11.9945 5.81241L11.9904 5.60831C11.8853 3.0349 9.68904 1 6.99204 1Z"
              fill="currentColor"
            />
          </svg>
          {notificationsUnread > 0 && (
            <span className="crm-nav-bell-badge" data-testid="crm-bell-badge" aria-hidden="true">
              {notificationsUnread > 99 ? '99+' : notificationsUnread}
            </span>
          )}
        </button>

        <div className="crm-nav-sep" />

        {/* Connection Widget: If connected, show number + status; If not connected, show Connect button */}
        {isConnected ? (
          <button
            type="button"
            className={`crm-nav-connected ${view === 'channel-status' ? 'active' : ''}`}
            title={`WhatsApp: ${displayPhone} (${statusText}) — Click to view Channel Status`}
            onClick={() => onNavigate('channel-status')}
            data-testid="crm-nav-connected"
          >
            <span className={`crm-nav-connected-status ${statusClass}`} data-testid="crm-nav-status">{statusText}</span>
            <span className="crm-nav-connected-number">{displayPhone}</span>
          </button>
        ) : (
          <button
            type="button"
            className={`crm-nav-connect-btn ${view === 'channel-status' ? 'active' : ''}`}
            title="Connect WhatsApp"
            onClick={() => onNavigate('channel-status')}
          >
            <NavConnectSvg width={18} height={18} />
            <span>Connect</span>
          </button>
        )}

        <div className="crm-nav-sep" />

        {/* Settings Icon -> navigates to Business Profile */}
        <button
          type="button"
          className={`crm-nav-icon-btn ${view === 'profile' || view === 'settings' ? 'active' : ''}`}
          onClick={() => onNavigate('profile')}
          title="Business profile"
          aria-label="Business profile"
        >
          <SettingsRailSvg />
        </button>

        {/* Profile Icon (Opens Profile Sidebar Drawer) */}
        <button
          type="button"
          className={`crm-nav-icon-btn ${profileDrawerOpen || view === 'profile' ? 'active' : ''}`}
          onClick={onOpenProfile}
          title="Profile"
          aria-label="Profile"
          aria-expanded={profileDrawerOpen}
        >
          <ProfileRailSvg />
        </button>
      </div>
    </header>
  );
}

export function CrmShell({ config, demo = false, onLogout }: Props) {
  // Full-screen app: each page scrolls inside itself, the window never moves.
  useLockWindowScroll();
  // Smooth (Lenis) wheel scrolling inside those page panels, on every page.
  useAppSmoothScroll();
  const [view, setView] = useState<CrmView>('chats');
  const [showDemoModal, setShowDemoModal] = useState(false);
  const [profileDrawerOpen, setProfileDrawerOpen] = useState(false);
  // Chats with unread messages, for the red badge on the Chats icon.
  const [unreadChats, setUnreadChats] = useState(0);
  const [chatRequest, setChatRequest] = useState<{ phone: string; n: number } | null>(null);
  const [channelStatusTab, setChannelStatusTab] = useState<'whatsapp' | 'instagram' | 'messenger'>('whatsapp');
  const [channelStatusSubItem, setChannelStatusSubItem] = useState<
    'connect' | 'limit' | 'approval' | 'display_name' | 'phone_number' | 'quality_rating'
  >('connect');
  const [templateInitialMode, setTemplateInitialMode] = useState<'list' | 'create'>('list');
  // 'templates:<tab>' while Templates is open, and "Start a campaign" from the Template Library.
  const [templatesTabRequest, setTemplatesTabRequest] = useState<{ tab: TemplatesTab; n: number } | null>(null);
  const [campaignStart, setCampaignStart] = useState<CampaignStartRequest | null>(null);

  useEffect(() => {
    const handleSubItem = (e: any) => {
      if (e?.detail) setChannelStatusSubItem(e.detail);
    };
    window.addEventListener('crm_set_channel_subitem', handleSubItem);
    return () => window.removeEventListener('crm_set_channel_subitem', handleSubItem);
  }, []);

  // ---- Unsaved-work guard -------------------------------------------------
  // A page with a canvas (the journey builder) registers a probe here. Leaving
  // the page would discard that work, so navigation is held back and the
  // confirmation below is shown instead. Kept in the shell because the shell
  // owns navigation — a page can't refuse a tab change it never hears about.
  const dirtyProbe = useRef<(() => boolean) | null>(null);
  const confirm = useConfirm();

  const registerDirty = useCallback((fn: (() => boolean) | null) => {
    dirtyProbe.current = fn;
  }, []);

  const navigate = useCallback(
    (next: CrmView, options?: { templateMode?: 'list' | 'create' }) => {
      if (options?.templateMode) {
        setTemplateInitialMode(options.templateMode);
      } else if (next === 'templates') {
        setTemplateInitialMode('list');
      }
      if (next === view) {
        if (options?.templateMode) {
          setTemplateInitialMode(options.templateMode);
        }
        return;
      }
      if (dirtyProbe.current?.()) {
        confirm({
          title: 'Discard changes?',
          message: 'You have unsaved changes on this page. Leaving now loses them.',
          confirmLabel: 'Discard',
          cancelLabel: 'Keep editing',
        }).then((discard) => {
          if (!discard) return;
          // The page unmounts, so its probe goes with it.
          dirtyProbe.current = null;
          setView(next);
        });
        return;
      }
      setView(next);
    },
    [view, confirm],
  );

  const handleOpenTemplateCreate = useCallback(() => {
    navigate('templates', { templateMode: 'create' });
  }, [navigate]);

  // Back from any other tab returns to Chats (the home tab), the way a phone
  // app's Back returns to its first tab. Open sub-pages close first.
  useBackHandler(view !== 'chats', () => navigate('chats'));

  const handleOpenChannelStatus = useCallback(
    (tab: 'whatsapp' | 'instagram' | 'messenger' = 'whatsapp') => {
      setChannelStatusTab(tab);
      navigate('channel-status');
    },
    [navigate],
  );

  // Pages can ask for a specific tab: 'channel-status:messenger' opens Channel
  // Status on Messenger, 'templates:instagram' opens Templates on Instagram.
  const pageNavigate = useCallback(
    (target: string) => {
      const cs = /^channel-status:(whatsapp|instagram|messenger)$/.exec(target);
      if (cs) {
        handleOpenChannelStatus(cs[1] as 'whatsapp' | 'instagram' | 'messenger');
        return;
      }
      const tp = /^templates:(library|whatsapp|instagram|messenger)$/.exec(target);
      if (tp) {
        try {
          localStorage.setItem('crm_templates_channel_tab', tp[1]);
        } catch {
          /* ignore */
        }
        // Already on Templates: the page switches its sidebar item itself.
        setTemplatesTabRequest((r) => ({ tab: tp[1] as TemplatesTab, n: (r?.n ?? 0) + 1 }));
        navigate('templates');
        return;
      }
      // 'campaign-new:whatsapp:<template>', 'campaign-new:<messenger|instagram>[:quick|utility:<id>]':
      // Campaigns opens that channel's creator with it preselected.
      const cn = /^campaign-new:(whatsapp|messenger|instagram)(?::(.+))?$/.exec(target);
      // Messenger / Instagram campaigns are coming soon: plain Campaigns instead.
      if (cn && cn[1] !== 'whatsapp' && COMING_SOON[cn[1] as 'messenger' | 'instagram']) {
        navigate('campaigns');
        return;
      }
      if (cn) {
        const ch = cn[1] as CampaignChannel;
        const rest = cn[2] || '';
        const m = /^(quick|utility):([a-f0-9]{24})$/.exec(rest);
        setCampaignStart((r) => ({
          channel: ch,
          ...(ch === 'whatsapp' && /^[a-z0-9_]{1,512}$/.test(rest) ? { templateName: rest } : {}),
          ...(ch !== 'whatsapp' && m?.[1] === 'quick' ? { quickMessageId: m[2] } : {}),
          ...(ch === 'messenger' && m?.[1] === 'utility' ? { utilityTemplateId: m[2] } : {}),
          n: (r?.n ?? 0) + 1,
        }));
        navigate('campaigns');
        return;
      }
      navigate(target as CrmView);
    },
    [handleOpenChannelStatus, navigate],
  );

  function openChatFor(phone: string) {
    setChatRequest((r) => ({ phone, n: (r?.n ?? 0) + 1 }));
    navigate('chats');
  }
  const cfg = useMemo<CrmConfig>(() => ({ ...defaultConfig, ...config }), [config]);
  const api = useMemo(() => (demo ? new MockCrmApi(cfg) : new CrmApi(cfg)), [cfg, demo]);

  // ---- Notifications (bell + drawer) ---------------------------------------
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationsUnread, setNotificationsUnread] = useState(0);
  const [notificationSocket, setNotificationSocket] = useState<CrmSocket | null>(null);
  // A record to open on the page a notification leads to (template, campaign, order).
  const [focusRequest, setFocusRequest] = useState<{ view: CrmView; id: string; n: number } | null>(null);

  // Resolve the tenant's vertical. Demo mode shows everything.
  const [category, setCategory] = useState<string | undefined>(demo ? 'other' : undefined);
  // The SaaS plan in force (backend services/plans.js): which pages are open,
  // limits, trial / renewal dates. The demo shows a trial with every feature.
  const [planState, setPlanState] = useState<PlanState | null>(() => (demo ? demoPlan() : null));
  // The plans dialog, opened from the top bar, a locked page or a locked option.
  const [plansFor, setPlansFor] = useState<{ tier?: PlanTierKey; reason?: string } | null>(null);
  // The native Flow builder is the platform owner's tool, plus any tenant it's
  // been enabled for. Demo mode shows everything.
  const [canUseFlows, setCanUseFlows] = useState(demo);
  // Who we're signed in as, so the chat view can sanity-check live events
  // against the tenant they claim to belong to.
  const [businessId, setBusinessId] = useState<string | undefined>(undefined);
  // Per-business wording overrides (members / categories / customer term).
  const [labels, setLabels] = useState<LabelOverrides | undefined>(undefined);
  // The signed-in business, for the WhatsApp connection state.
  const [business, setBusiness] = useState<BusinessProfile | undefined>(undefined);

  const loadMe = useCallback(() => {
    if (demo) return;
    api
      .getMe()
      .then((r) => {
        setBusiness(r.business);
        setCategory(r.business?.category || 'other');
        setLabels(r.business?.labels);
        setBusinessId(r.business?._id);
        setPlanState(r.planState || null);
        // Three ways in: the admin panel, a tenant the owner switched Flows on
        // for, or a session opened with the platform master passcode. The last
        // one is what makes the builder reachable inside *any* tenant without
        // handing the tenant itself the tool.
        setCanUseFlows(r.role === 'admin' || !!r.master || !!r.business?.flowsEnabled);
      })
      .catch(() => setCategory('other')); // on failure, don't hide anything
  }, [api, demo]);

  useEffect(() => {
    loadMe();
  }, [loadMe]);

  // A trial or a paid period ends at a set time: read the plan again then,
  // so the pages lock (or the bar changes) without a reload.
  useEffect(() => {
    if (demo || !planState?.endsAt) return undefined;
    const ms = new Date(planState.endsAt).getTime() - Date.now();
    if (ms <= 0 || ms > 2 ** 31 - 1) return undefined;
    const id = setTimeout(loadMe, ms + 2000);
    return () => clearTimeout(id);
  }, [demo, planState?.endsAt, loadMe]);

  const planCtx = useMemo<PlanContextValue>(() => ({
    plan: planState,
    openPlans: (opts) => setPlansFor(opts || {}),
    refresh: loadMe,
  }), [planState, loadMe]);

  /** The plan feature a rail page needs (null = part of every plan). */
  const featureOf = (v: CrmView): PlanFeature | null =>
    ['templates', 'campaigns', 'flows', 'catalog', 'categories', 'members', 'offers', 'orders', 'ads', 'create', 'payment-config'].includes(v)
      ? (v as PlanFeature)
      : null;
  /** The page is outside the plan: show its upgrade screen instead. */
  const planLocked = (v: CrmView) => {
    const f = featureOf(v);
    return !!f && !hasFeature(planState, f);
  };
  const lockedRail = useMemo(() => {
    const out: Partial<Record<CrmView, string>> = {};
    for (const v of ['templates', 'campaigns', 'flows', 'catalog', 'categories', 'members', 'offers', 'orders', 'ads', 'create', 'payment-config'] as CrmView[]) {
      const f = v as PlanFeature;
      if (!hasFeature(planState, f)) out[v] = TIER_NAMES[tierFor(f)];
    }
    return out;
  }, [planState]);

  const vertical = useMemo(() => verticalConfig(category, labels), [category, labels]);

  // If the active view isn't available for this vertical, fall back to chats.
  useEffect(() => {
    if (category && view !== 'profile' && view !== 'settings' && view !== 'channel-status' && view !== 'payment-config' && !vertical.showsPage(view)) {
      setView('chats');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, vertical, view]);

  const show = (p: CrmView) => vertical.showsPage(p);

  // The bell's unread count: fetched once signed in, then kept live over the
  // shell's own socket (CrmApp owns the chat socket and disconnects it). It
  // is re-read on every reconnect, so events missed while offline are caught up.
  useEffect(() => {
    const refresh = () =>
      api
        .getUnreadNotificationCount()
        .then((r) => setNotificationsUnread(r.count || 0))
        .catch(() => {});
    if (demo) {
      refresh();
      return undefined;
    }
    if (!businessId) return undefined;
    const s = new CrmSocket(cfg.apiBase, cfg.tokenKey);
    const offs = [
      s.onNotification((e) => setNotificationsUnread(e?.unread ?? 0)),
      s.onNotificationCount((e) => setNotificationsUnread(e?.unread ?? 0)),
      s.onConnect(refresh),
    ];
    refresh();
    setNotificationSocket(s);
    return () => {
      offs.forEach((off) => off());
      s.disconnect();
      setNotificationSocket(null);
    };
  }, [api, cfg, demo, businessId]);

  // ---- The number's real Meta status, for the top-bar widget ---------------
  // Read on page load (the backend reuses its 5-minute Channel Status cache),
  // kept in step with Channel Status, and re-read every 5 minutes while the
  // number isn't CONNECTED, so a Pending number turns Connected on its own.
  const [numberStatus, setNumberStatus] = useState<string | null>(null);
  const hasOwnNumber = !demo && !!business?.whatsappConnected;
  const loadNumberStatus = useCallback(() => {
    api
      .getChannelStatus()
      .then((s) => setNumberStatus(String(s.number?.status || '').toUpperCase()))
      .catch(() => setNumberStatus((prev) => prev ?? ''));
  }, [api]);
  useEffect(() => {
    if (!hasOwnNumber) {
      setNumberStatus(null);
      return;
    }
    loadNumberStatus();
  }, [hasOwnNumber, business?.phoneNumberId, loadNumberStatus]);
  useEffect(() => {
    if (!hasOwnNumber || numberStatus === 'CONNECTED') return undefined;
    const id = setInterval(loadNumberStatus, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [hasOwnNumber, numberStatus, loadNumberStatus]);
  useEffect(() => {
    const onStatus = (e: Event) => {
      const s = (e as CustomEvent<{ status?: string }>).detail?.status;
      if (s) setNumberStatus(String(s).toUpperCase());
    };
    window.addEventListener(CHANNEL_STATUS_EVENT, onStatus);
    return () => window.removeEventListener(CHANNEL_STATUS_EVENT, onStatus);
  }, []);
  // "WhatsApp number connected" arrived: read the status again.
  useEffect(() => {
    if (!notificationSocket || !hasOwnNumber) return undefined;
    return notificationSocket.onNotification((e) => {
      if (e?.notification?.type === 'whatsapp_connected') loadNumberStatus();
    });
  }, [notificationSocket, hasOwnNumber, loadNumberStatus]);
  // The admin changed the plan: re-read it (trial badge, credits polling).
  useEffect(() => {
    if (!notificationSocket) return undefined;
    return notificationSocket.onNotification((e) => {
      const t = e?.notification?.type;
      if (t === 'plan_changed' || t === 'plan_ended' || t === 'channel_disconnected') loadMe();
    });
  }, [notificationSocket, loadMe]);
  // Embedded Signup left the number Pending: take the user to the Activate step.
  useEffect(() => {
    const onPending = (e: Event) => {
      const a = (e as CustomEvent<SignupActivation>).detail;
      if (a?.status) setNumberStatus(String(a.status).toUpperCase());
      setChannelStatusTab('whatsapp');
      setChannelStatusSubItem('connect');
      navigate('channel-status');
    };
    window.addEventListener(NUMBER_ACTIVATION_EVENT, onPending);
    return () => window.removeEventListener(NUMBER_ACTIVATION_EVENT, onPending);
  }, [navigate]);

  // A focus request is for the page it was made for; leaving that page drops it,
  // so coming back later doesn't reopen the same record.
  useEffect(() => {
    if (focusRequest && focusRequest.view !== view) setFocusRequest(null);
  }, [view, focusRequest]);

  const closeNotifications = useCallback(() => setNotificationsOpen(false), []);

  /** Open what a notification is about: the chat, or the record's page. */
  function openNotification(n: AppNotification) {
    const { view: target, id, phone } = n.target || { view: '', id: '', phone: '' };
    if (target === 'chats' && phone) {
      openChatFor(phone);
      return;
    }
    const page = target as CrmView;
    const always: CrmView[] = ['channel-status', 'settings', 'profile', 'payment-config'];
    // A plan change opens Settings → Billing.
    if (page === 'profile' && id === 'billing') {
      try {
        localStorage.setItem('crm_settings_active_tab', 'billing');
        window.dispatchEvent(new CustomEvent('crm_set_profile_tab', { detail: 'billing' }));
      } catch {
        // ignore
      }
      // The plan badge / credits follow the new plan.
      loadMe();
    }
    // Messenger / Instagram connected or disconnected: open that channel's tab.
    if (page === 'channel-status' && (id === 'messenger' || id === 'instagram')) {
      setChannelStatusTab(id);
      loadMe();
    }
    if (page && (always.includes(page) || vertical.showsPage(page))) {
      setFocusRequest((r) => ({ view: page, id: id || '', n: (r?.n ?? 0) + 1 }));
      navigate(page);
      return;
    }
    // The page isn't part of this business type: the customer's chat is the
    // next best place.
    if (phone) openChatFor(phone);
  }
  const focusFor = (p: CrmView) => (focusRequest?.view === p ? focusRequest : null);

  // Registered but WhatsApp not connected yet: every page is there, with a bar
  // on top to connect the number (Embedded Signup).
  const needsConnect = !demo && !!business && !business.whatsappConnected;
  // Connecting WhatsApp is the next thing this business will do: get Meta's
  // sign-in ready in the background, so the Connect button works on the first
  // click instead of waiting while it loads.
  useEffect(() => {
    if (needsConnect || view === 'channel-status') preloadMetaSdk(api);
  }, [needsConnect, view, api]);
  const onConnected = useCallback(
    (b: BusinessProfile) => {
      setBusiness(b);
      loadMe();
    },
    [loadMe],
  );

  return (
    <PlanContext.Provider value={planCtx}>
    <div className="crm-shell-root">
      <PlanTopBar
        plan={planState}
        onBuyNow={() => setPlansFor({})}
        view={view}
        needsConnect={needsConnect}
        onConnectClick={() => navigate('channel-status')}
      />
      <CrmTopNav
        business={business}
        demo={demo}
        view={view}
        onNavigate={navigate}
        onBookDemo={() => setShowDemoModal(true)}
        onOpenProfile={() => setProfileDrawerOpen(true)}
        profileDrawerOpen={profileDrawerOpen}
        notificationsUnread={notificationsUnread}
        notificationsOpen={notificationsOpen}
        onToggleNotifications={() => setNotificationsOpen((o) => !o)}
        numberStatus={numberStatus}
      />

      <div className={`crm-shell${needsConnect ? ' has-connect-bar' : ''}`}>
        <NavRail
          view={view}
          onChange={navigate}
          allowed={vertical.pages}
          badges={{ chats: unreadChats }}
          soon={{ ads: COMING_SOON.ads, create: COMING_SOON.create }}
          locked={lockedRail}
          labels={{
            members: vertical.memberLabel,
            orders: vertical.ordersLabel,
            categories: vertical.categoryPlural,
            flows: canUseFlows ? 'Automation' : 'Journeys',
          }}
        />
        <div className="crm-shell-main">
          <div className="crm-shell-content">
            {/* Keep the chat view mounted so its socket + state persist across tabs. */}
            <div className="shell-pane" style={{ display: view === 'chats' ? 'block' : 'none' }}>
              <CrmApp
                config={config}
                demo={demo}
                openRequest={chatRequest}
                businessId={businessId}
                visible={view === 'chats'}
                onUnreadChange={setUnreadChats}
                needsConnect={needsConnect}
                businessName={business?.name || (business?.ownerFirstName ? `${business.ownerFirstName} ${business.ownerLastName || ''}`.trim() : '')}
                onConnectClick={() => navigate('channel-status')}
                onOpenTemplatesPage={() => navigate('templates')}
                onOpenTemplateCreate={handleOpenTemplateCreate}
              />
            </div>
            {/* A page outside the business's plan: its upgrade screen (Ads / Create stay 'coming soon'). */}
            {planLocked(view) && !(view === 'ads' && COMING_SOON.ads) && !(view === 'create' && COMING_SOON.create) && (view === 'payment-config' || show(view)) && (
              <PlanLockedPage feature={featureOf(view) as PlanFeature} />
            )}
            {/* Every business has a profile, whatever its type. */}
            {(view === 'profile' || view === 'settings') && (
              <ProfilePage
                api={api}
                demo={demo}
                business={business}
                onNavigate={navigate}
              />
            )}
            {view === 'templates' && show('templates') && !planLocked('templates') && (
              <TemplatesPage
                api={api}
                registerDirty={registerDirty}
                business={business}
                demo={demo}
                onNavigate={pageNavigate}
                initialMode={templateInitialMode}
                onModeChange={setTemplateInitialMode}
                focusRequest={focusFor('templates')}
                tabRequest={templatesTabRequest}
              />
            )}
            {view === 'campaigns' && show('campaigns') && !planLocked('campaigns') && (
              <CampaignsPage
                api={api}
                business={business}
                demo={demo}
                onNavigate={pageNavigate}
                focusRequest={focusFor('campaigns')}
                startRequest={campaignStart}
                onStartRequestHandled={() => setCampaignStart(null)}
              />
            )}
            {view === 'flows' && show('flows') && !planLocked('flows') && (
              <FlowsPage
                api={api}
                canUseFlows={canUseFlows}
                registerDirty={registerDirty}
                vertical={vertical}
                business={business}
                demo={demo}
                onNavigate={pageNavigate}
              />
            )}
            {view === 'catalog' && show('catalog') && !planLocked('catalog') && (
              needsConnect ? (
                <WhatsAppConnectRequired page="catalog" api={api} business={business} onConnected={onConnected} />
              ) : (
                <CatalogPage
                  api={api}
                  vertical={vertical}
                  business={business}
                  demo={demo}
                  onBusinessUpdated={(b) => setBusiness(b)}
                />
              )
            )}
            {view === 'categories' && show('categories') && !planLocked('categories') && (
              needsConnect ? (
                <WhatsAppConnectRequired page="categories" api={api} business={business} onConnected={onConnected} />
              ) : (
                <CategoriesPage api={api} vertical={vertical} business={business} demo={demo} onConnected={onConnected} />
              )
            )}
            {view === 'members' && show('members') && !planLocked('members') && (
              needsConnect ? (
                <WhatsAppConnectRequired page="members" api={api} business={business} onConnected={onConnected} />
              ) : (
                <MembersPage api={api} vertical={vertical} business={business} demo={demo} onConnected={onConnected} />
              )
            )}
            {view === 'offers' && show('offers') && !planLocked('offers') && (
              needsConnect ? (
                <WhatsAppConnectRequired page="offers" api={api} business={business} onConnected={onConnected} />
              ) : (
                <OffersPage api={api} business={business} demo={demo} onConnected={onConnected} />
              )
            )}
            {view === 'orders' && show('orders') && !planLocked('orders') && (
              needsConnect ? (
                <WhatsAppConnectRequired page="orders" api={api} business={business} onConnected={onConnected} />
              ) : (
                <OrdersPage
                  api={api}
                  vertical={vertical}
                  business={business}
                  demo={demo}
                  onConnected={onConnected}
                  onOpenChat={openChatFor}
                  focusRequest={focusFor('orders')}
                />
              )
            )}
            {view === 'ads' && show('ads') && (
              COMING_SOON.ads ? (
                <ComingSoonPage feature="ads" title="Ads" onBack={() => navigate('chats')} />
              ) : needsConnect ? (
                <WhatsAppConnectRequired page="ads" api={api} business={business} onConnected={onConnected} />
              ) : (
                <AdsPage
                  api={api}
                  demo={demo}
                  business={business}
                  onBusinessUpdated={(b) => setBusiness(b)}
                  onOpenChat={openChatFor}
                  focusRequest={focusFor('ads')}
                />
              )
            )}
            {view === 'create' && show('create') && (
              COMING_SOON.create ? (
                <ComingSoonPage feature="create" title="Create" onBack={() => navigate('chats')} />
              ) : (
                <CreatePage api={api} demo={demo} onNavigate={pageNavigate} focusRequest={focusFor('create')} />
              )
            )}
            {view === 'payment-config' && !planLocked('payment-config') && (
              needsConnect ? (
                <WhatsAppConnectRequired page="payment-config" api={api} business={business} onConnected={onConnected} />
              ) : (
                <PaymentConfigPage
                  api={api}
                  demo={demo}
                  business={business}
                  onBusinessUpdated={(b) => setBusiness(b)}
                  onConnected={onConnected}
                  onNavigate={navigate}
                />
              )
            )}
            {view === 'channel-status' && (
              <ChannelStatusPage
                api={api}
                demo={demo}
                business={business}
                onConnected={onConnected}
                onOpenChat={openChatFor}
                onNavigate={navigate}
                initialTab={channelStatusTab}
                onTabChange={setChannelStatusTab}
                initialSubItem={channelStatusSubItem}
              />
            )}
          </div>
        </div>
      </div>

      {plansFor && (
        <BuyPlanModal
          api={api}
          plan={planState}
          highlightTier={plansFor.tier}
          reason={plansFor.reason}
          onClose={() => setPlansFor(null)}
          onPaid={(p) => {
            setPlanState(p);
            loadMe();
          }}
        />
      )}
      {showDemoModal && <DemoModal onClose={() => setShowDemoModal(false)} />}
      <NotificationDrawer
        isOpen={notificationsOpen}
        onClose={closeNotifications}
        api={api}
        socket={notificationSocket}
        onUnreadChange={setNotificationsUnread}
        onOpen={openNotification}
      />
      <ProfileSidebarDrawer
        isOpen={profileDrawerOpen}
        onClose={() => setProfileDrawerOpen(false)}
        api={api}
        business={business}
        demo={demo}
        onNavigate={navigate}
        onOpenChannelStatus={handleOpenChannelStatus}
        onLogout={onLogout}
      />
    </div>
    </PlanContext.Provider>
  );
}

/** The demo's plan: the free trial (every feature), 6 days left. */
function demoPlan(): PlanState {
  return {
    tier: 'premium',
    name: 'Premium',
    status: 'trial',
    endsAt: new Date(Date.now() + 6 * 24 * 60 * 60 * 1000 - 60000).toISOString(),
    daysLeft: 6,
    endingSoon: false,
    limits: {
      features: ['chats', 'templates', 'campaigns', 'flows', 'catalog', 'categories', 'members', 'offers', 'orders', 'payment-config', 'ads', 'create', 'instagram', 'messenger'],
      contacts: null,
      templates: null,
      campaignsPerMonth: null,
      carousel: true,
      authTemplates: true,
    },
  };
}
