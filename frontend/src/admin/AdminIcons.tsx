// Icons for the admin panel: the CRM's own rail / toolbar icons (same
// drawings the business owner sees: chats, cart, members, megaphone…) plus a
// few extra ones drawn in the same 20×20, 1.5px line style. All use
// currentColor, so CSS `color` sets their colour; CSS can also set their size.
import type { ReactNode } from 'react';
import {
  AutomationRailSvg,
  CampaignsRailSvg,
  CatalogRailSvg,
  CategoriesRailSvg,
  ChatsRailSvg,
  LogoutSvg,
  MembersRailSvg,
  OffersRailSvg,
  PaymentConfigRailSvg,
  TemplatesRailSvg,
} from '../crm/components/NavRail';
import {
  BookDemoSvg,
  BuyNowSvg,
  CalendarSvg,
  CancelIconSvg,
  TemplateDeleteSvg,
  TemplateSearchSvg,
} from '../crm/components/TemplateIcons';

// ---- the CRM's icons, under the names the admin panel uses ----
export const DashboardIcon = CategoriesRailSvg;
export const CartIcon = CatalogRailSvg;
export const UsersIcon = MembersRailSvg;
export const ChatIcon = ChatsRailSvg;
export const MessageIcon = TemplatesRailSvg;
export const MegaphoneIcon = CampaignsRailSvg;
export const FlowIcon = AutomationRailSvg;
export const TagIcon = OffersRailSvg;
export const RupeeChatIcon = PaymentConfigRailSvg;
export { LogoutSvg as LogoutIcon };
export const CardIcon = () => <BuyNowSvg width={20} height={20} />;
export const CalendarIcon = () => <CalendarSvg width={20} height={20} />;
export const VideoIcon = () => <BookDemoSvg width={20} height={20} />;
export const BanIcon = () => <CancelIconSvg width={20} height={20} />;
export const TrashIcon = () => <TemplateDeleteSvg width={18} height={18} />;
export const SearchIcon = () => <TemplateSearchSvg width={18} height={18} />;

// ---- extra icons in the same style ----
function Line({ children, size = 20 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** A shop front: businesses on the platform. */
export function StoreIcon() {
  return (
    <Line>
      <path d="M3.5 9V17H16.5V9" />
      <path d="M2 8.5L3.6 3.5H16.4L18 8.5C18 9.6 17.1 10.5 16 10.5C14.9 10.5 14 9.6 14 8.5C14 9.6 13.1 10.5 12 10.5C10.9 10.5 10 9.6 10 8.5C10 9.6 9.1 10.5 8 10.5C6.9 10.5 6 9.6 6 8.5C6 9.6 5.1 10.5 4 10.5C2.9 10.5 2 9.6 2 8.5Z" />
      <path d="M8 17V13.5H12V17" />
    </Line>
  );
}

/** The Indian rupee sign. */
export function RupeeIcon() {
  return (
    <Line>
      <path d="M5.5 3.5H14.5M5.5 7H14.5" />
      <path d="M5.5 3.5H8.5C10.6 3.5 12 5 12 7C12 9 10.6 10.5 8.5 10.5H6L12.5 16.5" />
    </Line>
  );
}

export function GlobeIcon() {
  return (
    <Line>
      <circle cx="10" cy="10" r="7.25" />
      <path d="M2.75 10H17.25" />
      <path d="M10 2.75C11.9 4.8 12.9 7.3 12.9 10C12.9 12.7 11.9 15.2 10 17.25C8.1 15.2 7.1 12.7 7.1 10C7.1 7.3 8.1 4.8 10 2.75Z" />
    </Line>
  );
}

export function RefreshIcon() {
  return (
    <Line>
      <path d="M16.25 10A6.25 6.25 0 1 1 14.4 5.6" />
      <path d="M16.5 2.75V6.25H13" />
    </Line>
  );
}

/** Storage: a database cylinder. */
export function DatabaseIcon() {
  return (
    <Line>
      <ellipse cx="10" cy="4.75" rx="6.25" ry="2.25" />
      <path d="M3.75 4.75V15.25C3.75 16.5 6.55 17.5 10 17.5C13.45 17.5 16.25 16.5 16.25 15.25V4.75" />
      <path d="M3.75 10C3.75 11.25 6.55 12.25 10 12.25C13.45 12.25 16.25 11.25 16.25 10" />
    </Line>
  );
}

/** Events: a sparkle (festive themes for the website and the CRM). */
export function SparkleIcon() {
  return (
    <Line>
      <path d="M10 2.75L11.6 7.4L16.25 9L11.6 10.6L10 15.25L8.4 10.6L3.75 9L8.4 7.4L10 2.75Z" />
      <path d="M15.5 13.25V17.25M13.5 15.25H17.5" />
    </Line>
  );
}

/** An image (uploads). */
export function ImageIcon() {
  return (
    <Line>
      <rect x="2.75" y="3.75" width="14.5" height="12.5" rx="2" />
      <circle cx="7.25" cy="8.25" r="1.5" />
      <path d="M17.25 13L13 9L5 16.25" />
    </Line>
  );
}

/** The CRM top bar's bell. */
export function BellIcon() {
  return (
    <svg width="16" height="18" viewBox="0 0 14 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path
        d="M6.99204 0C10.141 0 12.7359 2.33488 12.9765 5.3554L12.9899 5.57762L12.9944 5.80214L12.9934 9.398L13.9188 11.6202C13.9414 11.6743 13.9591 11.7302 13.9717 11.7871L13.987 11.8733L13.9957 12.0046C13.9957 12.4526 13.6991 12.8387 13.2465 12.9677L13.1302 12.9945L12.9957 13.0046L9.494 13.004L9.48902 13.1653C9.40391 14.469 8.31956 15.5 6.9944 15.5C5.66892 15.5 4.58436 14.4685 4.49972 13.1644L4.494 13.004L0.993294 13.0046C0.905342 13.0046 0.81797 12.993 0.733407 12.9702L0.608948 12.9277C0.198166 12.7567 -0.0438033 12.3392 0.00659775 11.8757L0.0276852 11.7483L0.0701043 11.6202L0.993401 9.401L0.994488 5.79281L0.998788 5.56824C1.1214 2.45115 3.76543 0 6.99204 0ZM8.494 13.004H5.494L5.50136 13.1454C5.5699 13.8581 6.13714 14.425 6.84994 14.4931L6.9944 14.5C7.7741 14.5 8.41485 13.9051 8.48753 13.1445L8.494 13.004ZM6.99204 1C4.36949 1 2.22155 2.92372 2.01154 5.38498L1.99831 5.59723L1.9944 5.80214V9.5L1.956 9.69217L0.993283 12.0046L12.951 12.0066L12.9962 12.0045L12.0328 9.6922L11.9944 9.5L11.9945 5.81241L11.9904 5.60831C11.8853 3.0349 9.68904 1 6.99204 1Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function MenuIcon() {
  return (
    <Line>
      <path d="M3 5.5H17M3 10H17M3 14.5H17" />
    </Line>
  );
}

/** "⋯": a card's options. */
export function DotsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="4.5" cy="10" r="1.6" />
      <circle cx="10" cy="10" r="1.6" />
      <circle cx="15.5" cy="10" r="1.6" />
    </svg>
  );
}

/** Collapse the sidebar (an arrow to the left edge). */
export function CollapseIcon() {
  return (
    <Line>
      <path d="M3.5 4V16" />
      <path d="M16.5 10H7.5M11 6.5L7.5 10L11 13.5" />
    </Line>
  );
}

export function ArrowLeftIcon() {
  return (
    <Line>
      <path d="M16 10H4.5M9 5.5L4.5 10L9 14.5" />
    </Line>
  );
}

export function CloseIcon() {
  return (
    <Line>
      <path d="M5 5L15 15M15 5L5 15" />
    </Line>
  );
}

export function MailIcon() {
  return (
    <Line>
      <rect x="2.75" y="4.25" width="14.5" height="11.5" rx="2" />
      <path d="M3.5 5.5L10 10.5L16.5 5.5" />
    </Line>
  );
}

export function CheckCircleIcon() {
  return (
    <Line>
      <circle cx="10" cy="10" r="7.25" />
      <path d="M6.75 10.25L8.9 12.4L13.4 7.6" />
    </Line>
  );
}

export function PhoneMissedIcon() {
  return (
    <Line>
      <path d="M3 13.2C7.3 9.4 12.7 9.4 17 13.2L15.4 15.4L12.9 14.3V12.4C11 11.7 9 11.7 7.1 12.4V14.3L4.6 15.4L3 13.2Z" />
      <path d="M6 3.5L9 6.5L13.5 2.5M11 2.5H13.5V5" />
    </Line>
  );
}

export function ClockIcon() {
  return (
    <Line>
      <circle cx="10" cy="10" r="7.25" />
      <path d="M10 5.75V10L12.75 11.75" />
    </Line>
  );
}

export function ListIcon() {
  return (
    <Line>
      <path d="M7.5 5.5H16.5M7.5 10H16.5M7.5 14.5H16.5" />
      <path d="M3.5 5.5H3.51M3.5 10H3.51M3.5 14.5H3.51" />
    </Line>
  );
}

/** Messages in / out. */
export function SwapIcon() {
  return (
    <Line>
      <path d="M6.5 3.5V16.5M6.5 16.5L3.5 13.5M6.5 16.5L9.5 13.5" />
      <path d="M13.5 16.5V3.5M13.5 3.5L10.5 6.5M13.5 3.5L16.5 6.5" />
    </Line>
  );
}

/** WhatsApp (the CRM's Connect WhatsApp glyph). */
export function WhatsAppIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2c-1.5 0-3-.4-4.3-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1c-.2.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.4.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2s.2-1.1.2-1.2-.2-.2-.5-.3z"
      />
    </svg>
  );
}
