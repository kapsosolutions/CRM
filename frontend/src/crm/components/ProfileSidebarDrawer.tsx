import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import type { BusinessProfile } from '../types';
import type { CrmView } from './NavRail';
import { VERTICAL_OPTIONS } from '../verticals';
import { resetBackHandler } from '../useBackHandler';
import { platformApi } from '../../admin/platformApi';
import { useConfirm } from './Dialogs';
import { CopyIcon } from './AppIcons';
import type { CrmApi } from '../api';
import type { CrmSocket } from '../socket';
import type { ServiceQuota, WhatsAppProfile } from '../types';
import { PROFILE_UPDATED_EVENT } from './WhatsAppProfileEditor';
import { pushSignOut } from '../push';
import { COMING_SOON } from '../features';
import { SoonPill } from './ComingSoon';
import './WhatsAppProfileEditor.css';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** Reads the WhatsApp profile (photo, about, …) of the connected number. */
  api?: CrmApi;
  business?: BusinessProfile;
  demo?: boolean;
  onNavigate: (view: CrmView) => void;
  onOpenChannelStatus?: (channel: 'whatsapp' | 'instagram' | 'messenger') => void;
  onLogout?: () => void;
  /** The shell's live feed: pushes the free service message count as replies are delivered. */
  socket?: CrmSocket | null;
}

/**
 * The newer of two answers. Within a month the count only goes up, so an
 * answer that started before a live push and lands after it can't move the
 * bar back.
 */
function newerQuota(prev: ServiceQuota | null, next: ServiceQuota): ServiceQuota {
  if (!prev || prev.used === undefined || next.used === undefined || prev.error) return next;
  if (prev.monthStart !== next.monthStart || next.used >= prev.used) return next;
  return { ...next, used: prev.used, free: prev.free, charged: prev.charged, remaining: prev.remaining };
}


function BusinessCategoryIconSvg() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="2.5" y="6" width="15" height="11" rx="2" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M7 6V4.5C7 3.67157 7.67157 3 8.5 3H11.5C12.3284 3 13 3.67157 13 4.5V6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2.75 10H17.25M8 10V11.5H12V10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MailIconSvg() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="2.5" y="4" width="15" height="12" rx="2" stroke="#334155" strokeWidth="1.6" />
      <path d="M3 5.5L10 11L17 5.5" stroke="#334155" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AtIconSvg() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="10" cy="10" r="3" stroke="#334155" strokeWidth="1.6" />
      <path
        d="M13 8.5V11C13 12.1046 13.8954 13 15 13C16.1046 13 17 12.1046 17 11V10C17 6.13401 13.866 3 10 3C6.13401 3 3 6.13401 3 10C3 13.866 6.13401 17 10 17C12.1484 17 14.0622 16.0319 15.3406 14.5"
        stroke="#334155"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PhoneIconSvg() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path
        d="M4 3H7L8.5 6.5L6.5 8C7.5 10 9 11.5 11 12.5L12.5 10.5L16 12V15C16 15.5523 15.5523 16 15 16C8.92487 16 4 11.0751 4 5C4 4.44772 4.44772 4 5 4"
        stroke="#334155"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CopyIconSvg() {
  return <CopyIcon size={14} />;
}

function CheckmarkIconSvg() {
  return (
    <svg width="13" height="13" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M4 10.5L8 14.5L16 6.5" stroke="#24d06e" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}


/* User-requested exact Settings SVG */
function SettingsPillSvg() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 19 20" fill="none" aria-hidden="true">
      <path
        d="M6.08023 1.5316L5.82068 2.87197C5.61834 3.91693 4.53781 4.54078 3.53167 4.19354L2.23824 3.74714C2.00313 4.0671 1.80194 4.41323 1.63983 4.78022L2.67435 5.67816C3.47818 6.37588 3.47818 7.62363 2.67434 8.32135L1.63967 9.21943C1.80174 9.5864 2.00289 9.93251 2.23795 10.2525L3.53167 9.80597C4.5378 9.45873 5.61834 10.0826 5.82068 11.1275L6.08032 12.4684C6.47266 12.5104 6.88354 12.5101 7.27569 12.4675L7.53516 11.1275C7.7375 10.0826 8.81804 9.45873 9.82417 9.80597L11.1115 10.2503C11.3469 9.92946 11.5483 9.5824 11.7104 9.21441L10.6815 8.32135C9.87766 7.62363 9.87766 6.37588 10.6815 5.67816L11.7102 4.78524C11.5481 4.41723 11.3467 4.07015 11.1112 3.74935L9.82417 4.19354C8.81804 4.54078 7.73751 3.91693 7.53516 2.87198L7.27579 1.53249C6.88357 1.48987 6.47262 1.48956 6.08023 1.5316ZM5.29749 0.135421C5.74313 0.0465128 6.20347 0 6.67392 0C7.14766 0 7.61114 0.0471646 8.05968 0.137289C8.35793 0.197214 8.59043 0.431356 8.64826 0.730014L9.00781 2.58682C9.03671 2.73609 9.19107 2.82522 9.33481 2.77561L11.1194 2.15971C11.4068 2.06053 11.7256 2.14465 11.9266 2.3727C12.5351 3.06285 13.0101 3.87455 13.3104 4.76741C13.4073 5.05553 13.3207 5.37364 13.0911 5.57289L11.6647 6.81096C11.5499 6.91063 11.5499 7.08888 11.6647 7.18855L13.0912 8.42673C13.3208 8.62597 13.4074 8.94406 13.3105 9.23216C13.0103 10.125 12.5354 10.9367 11.927 11.6269C11.726 11.855 11.4071 11.9391 11.1197 11.8399L9.33481 11.2239C9.19108 11.1743 9.03671 11.2634 9.00781 11.4127L8.64816 13.27C8.59033 13.5687 8.35782 13.8028 8.05957 13.8627C7.61106 13.9528 7.14762 14 6.67392 14C6.20351 14 5.74321 13.9535 5.2976 13.8646C4.9989 13.805 4.7659 13.5707 4.708 13.2717L4.34804 11.4127C4.31913 11.2634 4.16477 11.1743 4.02103 11.2239L2.23 11.842C1.94271 11.9412 1.62399 11.8572 1.42292 11.6293C0.814931 10.9401 0.340033 10.1297 0.0393625 9.23819C-0.0578547 8.94993 0.0286745 8.63151 0.258409 8.43211L1.6911 7.18856C1.80593 7.08888 1.80593 6.91063 1.6911 6.81096L0.258536 5.56752C0.0287886 5.3681 -0.057736 5.04965 0.0395054 4.76139C0.340244 3.86988 0.815219 3.05944 1.42329 2.37033C1.62436 2.14246 1.94306 2.05845 2.23033 2.1576L4.02104 2.77561C4.16477 2.82522 4.31913 2.73609 4.34804 2.58681L4.7079 0.728347C4.76581 0.429324 4.9988 0.195012 5.29749 0.135421ZM11.6144 12.6339C11.4228 12.5678 11.2082 12.6223 11.0858 12.7838C10.8617 13.0793 10.6734 13.4034 10.5271 13.7495C10.4482 13.9362 10.5083 14.1495 10.6614 14.2824L11.6684 15.1565C11.8772 15.3378 11.8772 15.6618 11.6684 15.8431L10.6612 16.7173C10.5082 16.8502 10.448 17.0635 10.5269 17.2502C10.6732 17.5963 10.8615 17.9203 11.0855 18.2158C11.2079 18.3773 11.4226 18.4319 11.6142 18.3658L12.8738 17.931C13.1352 17.8408 13.4158 18.0028 13.4684 18.2742L13.7218 19.583C13.7604 19.7822 13.9153 19.941 14.1167 19.9658C14.2992 19.9884 14.4852 20 14.6738 20C14.8625 20 15.0484 19.9884 15.231 19.9658C15.4324 19.941 15.5873 19.7822 15.6259 19.583L15.8793 18.2742C15.9318 18.0028 16.2125 17.8408 16.4738 17.931L17.7335 18.3658C17.9251 18.4319 18.1397 18.3773 18.2622 18.2158C18.4861 17.9203 18.6745 17.5963 18.8207 17.2502C18.8996 17.0635 18.8395 16.8502 18.6864 16.7174L17.6792 15.8431C17.4705 15.6618 17.4705 15.3378 17.6792 15.1565L18.6863 14.2824C18.8394 14.1495 18.8995 13.9362 18.8206 13.7495C18.6743 13.4033 18.4859 13.0793 18.2619 12.7838C18.1395 12.6223 17.9248 12.5678 17.7333 12.6339L16.4738 13.0686C16.2125 13.1588 15.9318 12.9968 15.8793 12.7254L15.6259 11.417C15.5874 11.2178 15.4325 11.059 15.2311 11.0342C15.0485 11.0116 14.8625 11 14.6738 11C14.4852 11 14.2992 11.0116 14.1166 11.0342C13.9152 11.059 13.7603 11.2178 13.7217 11.417L13.4684 12.7254C13.4158 12.9968 13.1352 13.1588 12.8738 13.0686L11.6144 12.6339ZM14.6736 16.7506C13.983 16.7506 13.4231 16.1907 13.4231 15.5C13.4231 14.8094 13.983 14.2495 14.6736 14.2495C15.3643 14.2495 15.9242 14.8094 15.9242 15.5C15.9242 16.1907 15.3643 16.7506 14.6736 16.7506ZM5.67386 6.99993C5.67386 6.44771 6.12155 6 6.67386 6C7.22617 6 7.67386 6.44771 7.67386 6.99993C7.67386 7.55215 7.22617 7.99986 6.67386 7.99986C6.12155 7.99986 5.67386 7.55215 5.67386 6.99993ZM6.67386 4.5C5.29318 4.5 4.17386 5.61923 4.17386 6.99993C4.17386 8.38063 5.29318 9.49986 6.67386 9.49986C8.05454 9.49986 9.17386 8.38063 9.17386 6.99993C9.17386 5.61923 8.05454 4.5 6.67386 4.5Z"
        fill="currentColor"
      />
    </svg>
  );
}

/* User-provided QR Code SVG */
function QrCodeSvg() {
  return (
    <svg width="15" height="15" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M2.5 2.5H8V8H2.5V2.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M4.5 4.5H6V6H4.5V4.5Z" fill="currentColor" />
      <path d="M12 2.5H17.5V8H12V2.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M14 4.5H15.5V6H14V4.5Z" fill="currentColor" />
      <path d="M2.5 12H8V17.5H2.5V12Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M4.5 14H6V15.5H4.5V14Z" fill="currentColor" />
      <path d="M10 2.5V5M10 8V10M12 10H15M17.5 10V12M10 13H12V17.5M14 13V14.5H17.5M15 16H17.5V17.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* User-provided Channel Status SVG */
function ChannelStatusIconSvg() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="7" cy="6" r="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M1.5 16C1.5 13.5147 3.51472 11.5 6 11.5H8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="14" cy="13" r="4" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12.5 13L13.5 14L15.5 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* User-provided Info SVG */
function InfoIconSvg() {
  return (
    <svg width="20" height="20" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M3.07347 8.20456C3.67068 5.65859 5.65859 3.67067 8.20456 3.07347C10.0432 2.64218 11.9568 2.64218 13.7954 3.07347C16.3414 3.67067 18.3293 5.65859 18.9265 8.20456C19.3578 10.0432 19.3578 11.9568 18.9265 13.7954C18.3293 16.3414 16.3414 18.3293 13.7954 18.9265C11.9568 19.3578 10.0432 19.3578 8.20457 18.9265C5.65859 18.3293 3.67068 16.3414 3.07347 13.7954C2.64218 11.9568 2.64218 10.0432 3.07347 8.20456Z" stroke="#23A455" strokeWidth="1.375" />
      <path d="M11 14.2082V10.5415" stroke="#23A455" strokeWidth="1.375" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="10.9997" cy="8.25016" r="0.458333" stroke="#23A455" strokeWidth="0.916667" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* User-provided Notification SVG */
function NotificationIconSvg() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M10 5.3667V8.1417" stroke="#23A455" strokeWidth="1.13636" strokeMiterlimit="10" strokeLinecap="round" />
      <path d="M10.0161 1.6665C6.94943 1.6665 4.46609 4.14984 4.46609 7.2165V8.9665C4.46609 9.53317 4.23276 10.3832 3.94109 10.8665L2.88276 12.6332C2.23276 13.7248 2.68276 14.9415 3.88276 15.3415C7.86609 16.6665 12.1744 16.6665 16.1578 15.3415C17.2828 14.9665 17.7661 13.6498 17.1578 12.6332L16.0994 10.8665C15.8078 10.3832 15.5744 9.52484 15.5744 8.9665V7.2165C15.5661 4.1665 13.0661 1.6665 10.0161 1.6665Z" stroke="#23A455" strokeWidth="1.13636" strokeMiterlimit="10" strokeLinecap="round" />
      <path d="M12.7746 15.6831C12.7746 17.2081 11.5246 18.4581 9.99961 18.4581C9.24128 18.4581 8.54128 18.1414 8.04128 17.6414C7.54128 17.1414 7.22461 16.4414 7.22461 15.6831" stroke="#23A455" strokeWidth="1.13636" strokeMiterlimit="10" />
    </svg>
  );
}

const fmt = (n: number) => n.toLocaleString('en-IN');
const dayMonth = (iso?: string) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }) : '';

/**
 * Meta's free tier of service messages: 1,000 delivered replies per number
 * each month (since 1 October 2026; after that Meta charges for them).
 */
function ServiceQuotaCard({
  connected, quota, loading, onRefresh, onConnect,
}: {
  connected: boolean;
  quota: ServiceQuota | null;
  loading: boolean;
  onRefresh: () => void;
  onConnect: () => void;
}) {
  const limit = quota?.limit || 1000;
  const used = quota?.used ?? 0;
  const charged = quota?.charged ?? Math.max(0, used - limit);
  const known = connected && !!quota && quota.used !== undefined && !quota.error;
  const pct = known ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const full = known && used >= limit;
  const tone = full ? 'full' : pct >= 80 ? 'warn' : 'ok';
  const resets = dayMonth(quota?.resetsAt);
  const tip =
    `Meta gives every WhatsApp number ${fmt(limit)} free service messages a month: your replies to customers inside the 24-hour window. ` +
    'After that Meta charges for each one. Template messages (campaigns) are charged separately and not counted here. ' +
    'The count goes up as each reply reaches the customer. Meta’s own bill can take a few hours to catch up.';
  return (
    <div className={`crm-ps-quota ${tone}`} data-testid="service-quota">
      <div className="crm-ps-quota-head">
        <span className="crm-ps-quota-title">Free service messages</span>
        <span className="crm-ps-quota-info" title={tip} aria-label={tip}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.25" />
            <path d="M6.5 6.25C6.5 5.42157 7.17157 4.75 8 4.75C8.82843 4.75 9.5 5.42157 9.5 6.25C9.5 6.84587 9.15175 7.36014 8.64731 7.59918C8.2435 7.79054 8 8.1969 8 8.64453V9" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
            <circle cx="8" cy="11.25" r="0.75" fill="currentColor" />
          </svg>
        </span>
        {connected && (
          <button type="button" className="crm-ps-quota-refresh" onClick={onRefresh} disabled={loading} title="Ask Meta again" aria-label="Refresh">
            <span className={`material-icons${loading ? ' spin' : ''}`}>refresh</span>
          </button>
        )}
      </div>
      {!connected ? (
        <div className="crm-ps-quota-note">
          Connect your own WhatsApp number to see your {fmt(limit)} free service messages.
          <button type="button" className="crm-ps-quota-link" onClick={onConnect}>Connect WhatsApp</button>
        </div>
      ) : (
        <>
          <div className="crm-ps-quota-bar" role="progressbar" aria-valuemin={0} aria-valuemax={limit} aria-valuenow={known ? Math.min(used, limit) : undefined}>
            <div className="crm-ps-quota-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="crm-ps-quota-row">
            <span className="crm-ps-quota-stat" data-testid="service-quota-stat">
              {known
                ? `${fmt(Math.min(used, limit))} / ${fmt(limit)} used this month`
                : quota?.error
                  ? quota.error
                  : 'Loading…'}
            </span>
            {known && resets && <span className="crm-ps-quota-reset">Resets {resets}</span>}
          </div>
          {known && (
            <div className="crm-ps-quota-sub" data-testid="service-quota-sub">
              {full
                ? `Free messages used up. ${charged ? `${fmt(charged)} more ${charged === 1 ? 'was' : 'were'} charged by Meta. ` : ''}Replies are charged until ${resets || 'the 1st'}.`
                : `${fmt(limit - used)} free left${quota?.stale ? ' · last known count' : ''}`}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function ProfileSidebarDrawer({
  isOpen,
  onClose,
  api,
  business,
  demo = false,
  onNavigate,
  onOpenChannelStatus,
  onLogout,
  socket,
}: Props) {
  const confirm = useConfirm();
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedUsername, setCopiedUsername] = useState(false);
  const [showQrCard, setShowQrCard] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');

  // Prevent horizontal moving/scrolling on body when drawer is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflowX = 'hidden';
      document.documentElement.style.overflowX = 'hidden';
      return () => {
        document.body.style.overflowX = '';
        document.documentElement.style.overflowX = '';
      };
    }
  }, [isOpen]);

  // Close on Escape key
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
      }
    }
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, onClose]);

  // Resolve business details
  const name =
    business?.name ||
    (business?.ownerFirstName ? `${business.ownerFirstName} ${business.ownerLastName || ''}`.trim() : '') ||
    (demo ? 'Demo Store' : 'Kapso Solutions');

  const email = business?.email || 'contact.kapsosolutions@gmail.com';

  // Login phone number
  const loginPhoneRaw = (
    business?.ownerPhone ||
    business?.phone ||
    ''
  ).replace(/[^\d+]/g, '');
  const displayLoginPhone = loginPhoneRaw.startsWith('+') ? loginPhoneRaw : (loginPhoneRaw ? `+${loginPhoneRaw}` : '');

  // Connected WhatsApp phone number (for QR code & connected status)
  const isWhatsAppConnected = demo || (!!business?.whatsappConnected && !!(business?.meta?.displayPhoneNumber || business?.whatsappNumber || (business as any)?.phoneNumberId));
  const isInstagramConnected = !!(business as any)?.instagramConnected;
  const isMessengerConnected = !!(business as any)?.messengerConnected;
  // Waiting for Meta's approval (features.ts): shown as "Coming soon".
  const igSoon = COMING_SOON.instagram;
  const msgSoon = COMING_SOON.messenger;

  const connectedNumberRaw = (
    business?.meta?.displayPhoneNumber ||
    business?.whatsappNumber ||
    (demo ? '918143939393' : '')
  ).replace(/[^\d+]/g, '');
  const displayConnectedPhone = connectedNumberRaw.startsWith('+') ? connectedNumberRaw : (connectedNumberRaw ? `+${connectedNumberRaw}` : '');

  const categoryObj = VERTICAL_OPTIONS.find((v) => v.value === business?.category);
  const categoryLabel = categoryObj?.label || (business?.category ? business.category.charAt(0).toUpperCase() + business.category.slice(1) : 'E-commerce & Retail');

  // Clean username without leading @ symbol
  const rawUsername =
    business?.username ||
    (business?.name ? business.name.toLowerCase().replace(/[^a-z0-9]/g, '_') : '') ||
    'kapsosolutions_db3e';
  const cleanUsername = rawUsername.replace(/^@+/, '');

  const handleCopyUsername = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!cleanUsername) return;
    navigator.clipboard?.writeText(cleanUsername).then(() => {
      setCopiedUsername(true);
      setTimeout(() => setCopiedUsername(false), 2000);
    });
  };

  // The WhatsApp profile Meta has for the connected number: read when the
  // drawer opens and again after the editor saves a change.
  const canReadWaProfile = !!api && (demo || !!business?.whatsappConnected);
  const [waProfile, setWaProfile] = useState<WhatsAppProfile | null>(null);
  const [avatarFailed, setAvatarFailed] = useState(false);

  useEffect(() => {
    if (!isOpen || !api || !canReadWaProfile) return;
    let alive = true;
    const fetchProfile = () => {
      api
        .getWhatsAppProfile()
        .then((r) => {
          if (!alive) return;
          setWaProfile(r.connected && r.data ? r.data : null);
          setAvatarFailed(false);
        })
        .catch(() => {});
    };
    fetchProfile();
    window.addEventListener(PROFILE_UPDATED_EVENT, fetchProfile);
    return () => {
      alive = false;
      window.removeEventListener(PROFILE_UPDATED_EVENT, fetchProfile);
    };
  }, [isOpen, api, canReadWaProfile, business?._id]);

  // Free service messages this month (1,000 per number). Read when the drawer
  // opens, then kept current by the socket: the server pushes the new count
  // each time a reply reaches the customer's phone. Those updates are silent;
  // only the refresh button spins.
  const [quota, setQuota] = useState<ServiceQuota | null>(null);
  const [quotaLoading, setQuotaLoading] = useState(false);
  const quotaBizRef = useRef(business?._id);
  const loadQuota = (refresh = false) => {
    if (!api) return;
    if (refresh) setQuotaLoading(true);
    const biz = business?._id;
    api
      .getServiceQuota(refresh)
      .then((r) => {
        if (quotaBizRef.current === biz) setQuota((q) => newerQuota(q, r));
      })
      .catch(() => setQuota((q) => q || { connected: true, limit: 1000, error: 'Couldn’t load the count right now.' }))
      .finally(() => {
        if (refresh) setQuotaLoading(false);
      });
  };
  useEffect(() => {
    // Another business (master login switch): don't show the last one's count.
    if (quotaBizRef.current !== business?._id) {
      quotaBizRef.current = business?._id;
      setQuota(null);
    }
  }, [business?._id]);
  useEffect(() => {
    if (!isOpen || !api || !isWhatsAppConnected) return;
    loadQuota();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, api, isWhatsAppConnected, business?._id]);
  useEffect(() => {
    if (!socket || !isWhatsAppConnected) return undefined;
    return socket.onServiceQuota((q) => {
      if (!q || q.used === undefined) return;
      if (q.businessId && business?._id && String(q.businessId) !== String(business._id)) return;
      setQuota((prev) => newerQuota(prev, q));
    });
  }, [socket, isWhatsAppConnected, business?._id]);

  // Once Meta has answered, its photo (or none) wins over anything stored.
  const avatarUrl = avatarFailed ? '' : waProfile ? waProfile.profilePictureUrl : (
    (business as any)?.profilePicture ||
    (business as any)?.avatarUrl ||
    (business as any)?.meta?.profilePictureUrl ||
    (business as any)?.avatar ||
    (business as any)?.logoUrl ||
    (business as any)?.logo ||
    ''
  );

  const bizInitial = (name || business?.name || business?.meta?.verifiedName || 'P').trim().charAt(0).toUpperCase() || 'P';

  // QR Code URL points ONLY to the connected number
  const chatUrl = isWhatsAppConnected && connectedNumberRaw
    ? `https://wa.me/${connectedNumberRaw.replace(/\D/g, '')}`
    : '';

  // Generate QR code for connected WhatsApp chat link
  useEffect(() => {
    if (showQrCard && chatUrl) {
      QRCode.toDataURL(chatUrl, { width: 220, margin: 1, color: { dark: '#000000', light: '#ffffff' } })
        .then((url) => setQrDataUrl(url))
        .catch(() => {
          setQrDataUrl(`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(chatUrl)}`);
        });
    }
  }, [showQrCard, chatUrl]);

  if (!isOpen) return null;

  const handleCopyLink = () => {
    if (!chatUrl) return;
    navigator.clipboard?.writeText(chatUrl).then(() => {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    });
  };

  const handleConfirmSignOut = () => {
    onClose();
    resetBackHandler();
    // This browser stops getting desktop notifications for the business (needs the token, so first).
    if (api && !demo) pushSignOut(api);
    platformApi.businessLogout();
    try {
      localStorage.removeItem('crm_business_jwt');
      localStorage.removeItem('crm_admin_jwt');
    } catch {
      // ignore
    }
    if (onLogout) {
      try {
        onLogout();
      } catch {
        // ignore
      }
    }
    window.location.hash = '#/login';
    window.location.reload();
  };

  const handleSignOutClick = async () => {
    const ok = await confirm({
      title: 'Sign out?',
      message: 'Are you sure you want to sign out of your account? You will need to log in again to access your CRM.',
      confirmLabel: 'Sign out',
      cancelLabel: 'Cancel',
      tone: 'danger',
    });
    if (!ok) return;
    handleConfirmSignOut();
  };

  return (
    <div className="crm-ps-backdrop" onClick={onClose} aria-modal="true" role="dialog">
        <div className="crm-ps-drawer" onClick={(e) => e.stopPropagation()}>
          {/* Top Header Card */}
          <div className="crm-ps-header">
            <div className="crm-ps-user-top">
              <div className="crm-ps-avatar-box">
                <div
                  className="crm-ps-avatar-wrapper clickable"
                  onClick={() => {
                    onClose();
                    onNavigate('profile');
                  }}
                  title="Click to view and edit profile"
                >
                  <div className="crm-ps-avatar-circle">
                    {avatarUrl ? (
                      <img src={avatarUrl} alt={name} className="crm-ps-avatar-img" onError={() => setAvatarFailed(true)} />
                    ) : (
                      <div className="crm-ps-avatar-initial-box">
                        <span>{bizInitial}</span>
                      </div>
                    )}
                  </div>
                  <span className="crm-ps-avatar-edit-badge" title="Edit profile picture">
                    <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="#ffffff" strokeWidth="2" aria-hidden="true">
                      <path d="M4 6h3l1.5-2h3L13 6h3a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" />
                      <circle cx="10" cy="12" r="3" />
                    </svg>
                  </span>
                </div>
              </div>

              <div className="crm-ps-user-text">
                <div className="crm-ps-name-row">
                  <h3 className="crm-ps-name">{name}</h3>
                  <button
                    type="button"
                    className="crm-ps-signout-btn"
                    onClick={handleSignOutClick}
                    title="Sign out of account"
                  >
                    Sign out
                  </button>
                </div>

                <div className="crm-ps-category-pill" title="Business category">
                  <BusinessCategoryIconSvg />
                  <span>{categoryLabel}</span>
                </div>

                <div className="crm-ps-contact-list">
                  <div className="crm-ps-contact-item" title="Contact email">
                    <MailIconSvg />
                    <span className="crm-ps-contact-text">{email}</span>
                  </div>

                  <div className="crm-ps-contact-item crm-ps-username-item" title="Username">
                    <AtIconSvg />
                    <span className="crm-ps-contact-text">{cleanUsername}</span>
                    <button
                      type="button"
                      className={`crm-ps-inline-copy-btn ${copiedUsername ? 'copied' : ''}`}
                      onClick={handleCopyUsername}
                      title={copiedUsername ? 'Copied username!' : 'Copy username'}
                      aria-label="Copy username"
                    >
                      {copiedUsername ? <CheckmarkIconSvg /> : <CopyIconSvg />}
                    </button>
                    {copiedUsername && <span className="crm-ps-copied-badge">Copied!</span>}
                  </div>

                  {displayLoginPhone && (
                    <div className="crm-ps-contact-item" title="Login phone number">
                      <PhoneIconSvg />
                      <span className="crm-ps-contact-text">{displayLoginPhone}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

          {/* Quick Action Pills: Settings and QR code to chat (removed redundant copy pill) */}
          <div className="crm-ps-pills-row">
            <button
              type="button"
              className="crm-ps-pill-btn"
              onClick={() => {
                onClose();
                onNavigate('profile');
              }}
              title="Open business profile"
            >
              <SettingsPillSvg />
              <span>Settings</span>
            </button>

            <button
              type="button"
              className={`crm-ps-pill-btn ${showQrCard ? 'active' : ''}`}
              onClick={() => setShowQrCard((prev) => !prev)}
              title="View WhatsApp Chat QR Code"
            >
              <QrCodeSvg />
              <span>QR code to chat</span>
            </button>
          </div>

          {/* QR Code Section (Shown when QR option is selected) */}
          {showQrCard && (
            <div className="crm-ps-qr-card">
              <div className="crm-ps-qr-header">
                <div className="crm-ps-qr-title-box">
                  <h4 className="crm-ps-qr-title">Scan to chat on WhatsApp</h4>
                  <p className="crm-ps-qr-sub">
                    {isWhatsAppConnected
                      ? `Points to connected number: ${displayConnectedPhone}`
                      : 'WhatsApp account not connected'}
                  </p>
                </div>
                <button
                  type="button"
                  className="crm-ps-qr-close-btn"
                  onClick={() => setShowQrCard(false)}
                  title="Close QR Code"
                >
                  ✕
                </button>
              </div>

              {isWhatsAppConnected && chatUrl ? (
                <>
                  <div className="crm-ps-qr-img-box">
                    {qrDataUrl ? (
                      <img src={qrDataUrl} alt="WhatsApp QR Code" className="crm-ps-qr-img" />
                    ) : (
                      <div className="crm-ps-qr-loading">Generating QR code...</div>
                    )}
                  </div>

                  <div className="crm-ps-qr-footer">
                    <span className="crm-ps-qr-link">{chatUrl}</span>
                    <div className="crm-ps-qr-actions">
                      {qrDataUrl && (
                        <a
                          href={qrDataUrl}
                          download={`whatsapp-qr-${connectedNumberRaw}.png`}
                          className="crm-ps-qr-action-btn download"
                          title="Download QR code image"
                        >
                          Download QR
                        </a>
                      )}
                      <button
                        type="button"
                        className="crm-ps-qr-action-btn copy"
                        onClick={handleCopyLink}
                      >
                        {copiedLink ? 'Copied!' : 'Copy Link'}
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="crm-ps-qr-unconnected-box">
                  <p className="crm-ps-qr-unconnected-msg">
                    Your WhatsApp account is not connected yet. Connect your WhatsApp number to generate your QR code and enable click-to-chat.
                  </p>
                  <button
                    type="button"
                    className="crm-ps-qr-action-btn download"
                    onClick={() => {
                      onClose();
                      onNavigate('channel-status');
                    }}
                  >
                    Connect WhatsApp Account
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Action Links */}
          <div className="crm-ps-links-row">
            <button
              type="button"
              className="crm-ps-link-btn"
              onClick={() => {
                onClose();
                try {
                  localStorage.setItem('crm_settings_active_tab', 'profile');
                  window.dispatchEvent(new CustomEvent('crm_set_profile_tab', { detail: 'profile' }));
                } catch {
                  // ignore
                }
                onNavigate('profile');
              }}
              title="Business Info"
            >
              <InfoIconSvg />
              <span>Info</span>
            </button>

            <button
              type="button"
              className="crm-ps-link-btn"
              onClick={() => {
                onClose();
                try {
                  localStorage.setItem('crm_settings_active_tab', 'notifications');
                  window.dispatchEvent(new CustomEvent('crm_set_profile_tab', { detail: 'notifications' }));
                } catch {
                  // ignore
                }
                onNavigate('profile');
              }}
              title="Manage Notifications"
            >
              <NotificationIconSvg />
              <span>Manage Notifications</span>
            </button>
          </div>
        </div>

        {/* Divider */}
        <div className="crm-ps-divider" />

        {/* Big Green Channel Status Button (Matches Image 1, 2, 3) */}
        <button
          type="button"
          className="crm-ps-channel-btn"
          onClick={() => {
            onClose();
            if (onOpenChannelStatus) onOpenChannelStatus('whatsapp');
            else onNavigate('channel-status');
          }}
          title="Open Channel Status"
        >
          <ChannelStatusIconSvg />
          <span>Channel Status</span>
        </button>

        {/* Meta's free service messages this month, like the Campaigns
            page's daily messaging limit card. */}
        <ServiceQuotaCard
          connected={isWhatsAppConnected}
          quota={quota}
          loading={quotaLoading}
          onRefresh={() => loadQuota(true)}
          onConnect={() => {
            onClose();
            if (onOpenChannelStatus) onOpenChannelStatus('whatsapp');
            else onNavigate('channel-status');
          }}
        />

        {/* Channels Section */}
        <div className="crm-ps-channels-section">
          <div className="crm-ps-channels-header">
            <h4 className="crm-ps-channels-title">Channels</h4>
            <span className="crm-ps-channels-sub">Connected messaging platforms</span>
          </div>

          <div className="crm-ps-channels-list">
            {/* WhatsApp Channel */}
            <div
              className={`crm-ps-channel-item ${isWhatsAppConnected ? 'connected' : 'unconnected'}`}
              onClick={() => {
                onClose();
                try {
                  localStorage.setItem('crm_channel_status_subitem', 'phone_number');
                  window.dispatchEvent(new CustomEvent('crm_set_channel_subitem', { detail: 'phone_number' }));
                } catch {
                  // ignore
                }
                if (onOpenChannelStatus) onOpenChannelStatus('whatsapp');
                else onNavigate('channel-status');
              }}
              role="button"
              tabIndex={0}
              title={isWhatsAppConnected ? `WhatsApp: ${displayConnectedPhone}` : 'Connect WhatsApp'}
            >
              <div className="crm-ps-ch-left">
                <img
                  src="/whatsapp.svg"
                  alt="WhatsApp"
                  className={`crm-ps-ch-icon ${isWhatsAppConnected ? 'color' : 'no-color'}`}
                />
                <div className="crm-ps-ch-info">
                  <div className="crm-ps-ch-name">WhatsApp</div>
                  <div className="crm-ps-ch-desc">
                    {isWhatsAppConnected ? (displayConnectedPhone || 'Connected') : 'Not connected'}
                  </div>
                </div>
              </div>
              <div className="crm-ps-ch-right">
                {isWhatsAppConnected ? (
                  <span className="crm-ps-ch-badge connected">
                    <span className="crm-ps-ch-dot" />
                    Connected
                  </span>
                ) : (
                  <span className="crm-ps-ch-badge unconnected">
                    Connect
                  </span>
                )}
              </div>
            </div>

            {/* Instagram Channel */}
            <div
              className={`crm-ps-channel-item ${isInstagramConnected ? 'connected' : 'unconnected'}${igSoon && !isInstagramConnected ? ' soon' : ''}`}
              data-testid="ps-channel-instagram"
              onClick={() => {
                onClose();
                if (onOpenChannelStatus) onOpenChannelStatus('instagram');
                else onNavigate('channel-status');
              }}
              role="button"
              tabIndex={0}
              title={isInstagramConnected ? 'Instagram connected' : igSoon ? 'Instagram is coming soon' : 'Connect Instagram'}
            >
              <div className="crm-ps-ch-left">
                <img
                  src="/channel-instagram.svg"
                  alt="Instagram"
                  className={`crm-ps-ch-icon ${isInstagramConnected ? 'color' : 'no-color'}`}
                />
                <div className="crm-ps-ch-info">
                  <div className="crm-ps-ch-name">Instagram</div>
                  <div className="crm-ps-ch-desc">
                    {isInstagramConnected ? ((business as any)?.instagramUsername ? `@${(business as any).instagramUsername}` : 'Connected') : igSoon ? 'Coming soon' : 'Not connected'}
                  </div>
                </div>
              </div>
              <div className="crm-ps-ch-right">
                {igSoon && !isInstagramConnected ? (
                  <SoonPill />
                ) : isInstagramConnected ? (
                  <span className="crm-ps-ch-badge connected">
                    <span className="crm-ps-ch-dot" />
                    Connected
                  </span>
                ) : (
                  <span className="crm-ps-ch-badge unconnected">
                    Connect
                  </span>
                )}
              </div>
            </div>

            {/* Messenger Channel */}
            <div
              className={`crm-ps-channel-item ${isMessengerConnected ? 'connected' : 'unconnected'}${msgSoon && !isMessengerConnected ? ' soon' : ''}`}
              data-testid="ps-channel-messenger"
              onClick={() => {
                onClose();
                if (onOpenChannelStatus) onOpenChannelStatus('messenger');
                else onNavigate('channel-status');
              }}
              role="button"
              tabIndex={0}
              title={isMessengerConnected ? 'Messenger connected' : msgSoon ? 'Messenger is coming soon' : 'Connect Messenger'}
            >
              <div className="crm-ps-ch-left">
                <img
                  src="/channel-messenger.svg"
                  alt="Messenger"
                  className={`crm-ps-ch-icon ${isMessengerConnected ? 'color' : 'no-color'}`}
                />
                <div className="crm-ps-ch-info">
                  <div className="crm-ps-ch-name">Messenger</div>
                  <div className="crm-ps-ch-desc">
                    {isMessengerConnected ? ((business as any)?.messengerPageName || 'Connected') : msgSoon ? 'Coming soon' : 'Not connected'}
                  </div>
                </div>
              </div>
              <div className="crm-ps-ch-right">
                {msgSoon && !isMessengerConnected ? (
                  <SoonPill />
                ) : isMessengerConnected ? (
                  <span className="crm-ps-ch-badge connected">
                    <span className="crm-ps-ch-dot" />
                    Connected
                  </span>
                ) : (
                  <span className="crm-ps-ch-badge unconnected">
                    Connect
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Copyright Footer (Direct child of .crm-ps-drawer) */}
        <div className="crm-ps-footer">
          <p className="crm-ps-copyright">
            © {new Date().getFullYear()} Kapso Solutions. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  );
}
