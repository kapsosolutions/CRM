// The website menu's icons, in the CRM sidebar's style: the sidebar's own
// drawings where one exists (inbox, megaphone, automation, cart…) and the
// rest drawn the same way (20×20, 1.5px lines, round ends, currentColor).
// Menus name icons by their old Material names (siteMenus.ts).
import type { ReactNode } from 'react';
import {
  AdsRailSvg, AutomationRailSvg, CampaignsRailSvg, CatalogRailSvg, ChatsRailSvg, OffersRailSvg, TemplatesRailSvg,
} from '../crm/components/NavRail';
import { BuyNowSvg, CalendarSvg } from '../crm/components/TemplateIcons';

function Line({ children }: { children: ReactNode }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      {children}
    </svg>
  );
}

const ICONS: Record<string, () => ReactNode> = {
  // The CRM sidebar's own icons.
  inbox: () => <ChatsRailSvg />,
  campaign: () => <CampaignsRailSvg />,
  account_tree: () => <AutomationRailSvg />,
  storefront: () => <CatalogRailSvg />,
  description: () => <TemplatesRailSvg />,
  sell: () => <OffersRailSvg />,
  ads_click: () => <AdsRailSvg size={17} />,
  payments: () => <BuyNowSvg width={20} height={20} />,
  event_available: () => <CalendarSvg width={20} height={20} />,

  // Drawn in the same style.
  trending_up: () => <Line><path d="M2.75 14.5L7.75 9.5L11 12.75L17.25 6.5" /><path d="M13 6.5H17.25V10.75" /></Line>,
  support_agent: () => (
    <Line>
      <path d="M3.75 11.5V9.75C3.75 6.3 6.55 3.5 10 3.5C13.45 3.5 16.25 6.3 16.25 9.75V11.5" />
      <rect x="2.75" y="10.25" width="3" height="4.5" rx="1.25" />
      <rect x="14.25" y="10.25" width="3" height="4.5" rx="1.25" />
      <path d="M15.75 14.75C15.75 16 14.5 16.75 12.75 16.75H10.75" />
    </Line>
  ),
  shopping_bag: () => (
    <Line>
      <path d="M4.25 6.75H15.75L14.95 16.1C14.89 16.81 14.29 17.25 13.58 17.25H6.42C5.71 17.25 5.11 16.81 5.05 16.1L4.25 6.75Z" />
      <path d="M7.5 9V5.5C7.5 4.12 8.62 3 10 3C11.38 3 12.5 4.12 12.5 5.5V9" />
    </Line>
  ),
  restaurant: () => (
    <Line>
      <path d="M6 2.75V17.25M3.75 2.75V6.5C3.75 7.74 4.76 8.75 6 8.75C7.24 8.75 8.25 7.74 8.25 6.5V2.75" />
      <path d="M14.75 17.25V2.75C12.9 3.6 12 5.5 12 8V11.75H14.75" />
    </Line>
  ),
  local_hospital: () => <Line><rect x="3" y="3" width="14" height="14" rx="3" /><path d="M10 6.75V13.25M6.75 10H13.25" /></Line>,
  content_cut: () => (
    <Line>
      <circle cx="5.25" cy="5.5" r="2.25" />
      <circle cx="5.25" cy="14.5" r="2.25" />
      <path d="M7.2 6.75L17 14.75M7.2 13.25L17 5.25" />
    </Line>
  ),
  school: () => (
    <Line>
      <path d="M10 3.75L18 7.5L10 11.25L2 7.5L10 3.75Z" />
      <path d="M5.25 9.1V12.75C5.25 13.9 7.4 15.25 10 15.25C12.6 15.25 14.75 13.9 14.75 12.75V9.1M18 7.5V11.5" />
    </Line>
  ),
  apartment: () => (
    <Line>
      <path d="M3.75 17.25V3.75C3.75 3.2 4.2 2.75 4.75 2.75H11.25C11.8 2.75 12.25 3.2 12.25 3.75V17.25M12.25 8H15.25C15.8 8 16.25 8.45 16.25 9V17.25M2.5 17.25H17.5" />
      <path d="M6.5 6H6.51M9.5 6H9.51M6.5 9H6.51M9.5 9H9.51M6.5 12H6.51M9.5 12H9.51" strokeWidth="2" />
    </Line>
  ),
  hotel: () => (
    <Line>
      <path d="M2.75 4.75V16.25M2.75 13.25H17.25V16.25" />
      <path d="M17.25 13.25V10.5C17.25 9.4 16.35 8.5 15.25 8.5H9.25V13.25" />
      <circle cx="5.9" cy="10.4" r="1.6" />
    </Line>
  ),
  fitness_center: () => <Line><path d="M6.25 5.75V14.25M13.75 5.75V14.25M3.5 8V12M16.5 8V12M6.25 10H13.75" /></Line>,
  forum: () => (
    <Line>
      <path d="M12.75 8.25C12.75 5.35 10.3 3 7.25 3C4.2 3 1.75 5.35 1.75 8.25C1.75 9.5 2.2 10.6 2.95 11.5L2.5 13.75L4.85 13.05C5.6 13.35 6.4 13.5 7.25 13.5" />
      <path d="M18.25 13C18.25 10.65 16.2 8.75 13.75 8.75C11.3 8.75 9.25 10.65 9.25 13C9.25 15.35 11.3 17.25 13.75 17.25C14.45 17.25 15.1 17.1 15.7 16.85L17.75 17.5L17.35 15.55C17.9 14.8 18.25 13.95 18.25 13Z" />
    </Line>
  ),
  chat: () => <Line><path d="M10 3.25C14.1 3.25 17.25 6.05 17.25 9.5C17.25 12.95 14.1 15.75 10 15.75C9.1 15.75 8.25 15.6 7.45 15.35L3.5 16.75L4.6 13.55C3.45 12.45 2.75 11.05 2.75 9.5C2.75 6.05 5.9 3.25 10 3.25Z" /></Line>,
  qr_code_2: () => (
    <Line>
      <rect x="3" y="3" width="5" height="5" rx="1" />
      <rect x="12" y="3" width="5" height="5" rx="1" />
      <rect x="3" y="12" width="5" height="5" rx="1" />
      <path d="M12 12H14M17 12V14M12 15V17H14M16.5 17H17M15 14.5H15.01" />
    </Line>
  ),
  dynamic_form: () => (
    <Line>
      <rect x="3" y="2.75" width="14" height="14.5" rx="2" />
      <path d="M6.25 6.5H13.75M6.25 10H13.75" />
      <rect x="6.25" y="12.75" width="2.25" height="2" rx="0.5" />
      <path d="M10.5 13.75H13.75" />
    </Line>
  ),
  notifications_active: () => (
    <Line>
      <path d="M5.25 8.5C5.25 5.88 7.38 3.75 10 3.75C12.62 3.75 14.75 5.88 14.75 8.5V11.75L16.25 14.25H3.75L5.25 11.75V8.5Z" />
      <path d="M8.25 16.5C8.6 17.1 9.25 17.5 10 17.5C10.75 17.5 11.4 17.1 11.75 16.5M2.5 7C2.75 5.4 3.5 4 4.6 3M17.5 7C17.25 5.4 16.5 4 15.4 3" />
    </Line>
  ),
  call: () => <Line><path d="M6.4 2.75H4.25C3.42 2.75 2.73 3.43 2.8 4.26C3.45 11.15 8.85 16.55 15.74 17.2C16.57 17.27 17.25 16.58 17.25 15.75V13.6L13.9 12.25L12.05 13.85C9.8 12.85 7.15 10.2 6.15 7.95L7.75 6.1L6.4 2.75Z" /></Line>,
  verified: () => (
    <Line>
      <path d="M10 2.5L12.1 4.05L14.7 3.95L15.45 6.45L17.5 8.05L16.65 10.5L17.5 12.95L15.45 14.55L14.7 17.05L12.1 16.95L10 18.5L7.9 16.95L5.3 17.05L4.55 14.55L2.5 12.95L3.35 10.5L2.5 8.05L4.55 6.45L5.3 3.95L7.9 4.05L10 2.5Z" />
      <path d="M7.25 10.5L9.15 12.4L12.9 8.6" />
    </Line>
  ),
  code: () => <Line><path d="M6.75 5.5L2.75 10L6.75 14.5M13.25 5.5L17.25 10L13.25 14.5M11.25 3.75L8.75 16.25" /></Line>,
  help: () => <Line><circle cx="10" cy="10" r="7.25" /><path d="M7.75 7.9C7.95 6.8 8.85 6 10 6C11.25 6 12.25 6.9 12.25 8.05C12.25 9.6 10 9.85 10 11.5M10 14.1H10.01" /></Line>,
  info: () => <Line><circle cx="10" cy="10" r="7.25" /><path d="M10 9.25V13.75M10 6.4H10.01" /></Line>,
  library_books: () => (
    <Line>
      <rect x="5.75" y="2.75" width="11.5" height="11.5" rx="1.75" />
      <path d="M2.75 6.25V15.5C2.75 16.47 3.53 17.25 4.5 17.25H13.75M8.75 6.5H14.25M8.75 9.5H14.25M8.75 12.5H11.75" />
    </Line>
  ),
  request_quote: () => (
    <Line>
      <path d="M4.75 2.75H12L15.25 6V17.25H4.75V2.75Z" />
      <path d="M7.5 8H12.5M7.5 10.25H12.5M7.5 8H9.25C10.35 8 11 8.9 11 10.25C11 11.6 10.35 12.5 9.25 12.5H8L11.25 15" />
    </Line>
  ),
  menu_book: () => <Line><path d="M10 5.25C8.5 4.1 6.3 3.5 2.75 3.5V15.5C6.3 15.5 8.5 16.1 10 17.25C11.5 16.1 13.7 15.5 17.25 15.5V3.5C13.7 3.5 11.5 4.1 10 5.25ZM10 5.25V17.25" /></Line>,
  link: () => (
    <Line>
      <path d="M8.5 11.5C9.5 12.75 11.4 12.85 12.55 11.7L15.3 8.95C16.45 7.8 16.45 5.95 15.3 4.8C14.15 3.65 12.3 3.65 11.15 4.8L10.4 5.55" />
      <path d="M11.5 8.5C10.5 7.25 8.6 7.15 7.45 8.3L4.7 11.05C3.55 12.2 3.55 14.05 4.7 15.2C5.85 16.35 7.7 16.35 8.85 15.2L9.6 14.45" />
    </Line>
  ),
  calculate: () => (
    <Line>
      <rect x="3.75" y="2.75" width="12.5" height="14.5" rx="2" />
      <rect x="6.25" y="5.25" width="7.5" height="3" rx="0.75" />
      <path d="M6.75 11H6.76M10 11H10.01M13.25 11H13.26M6.75 14.25H6.76M10 14.25H10.01M13.25 14.25H13.26" strokeWidth="2" />
    </Line>
  ),
  mail: () => <Line><rect x="2.75" y="4.25" width="14.5" height="11.5" rx="2" /><path d="M3.5 5.5L10 10.5L16.5 5.5" /></Line>,
  send: () => <Line><path d="M17.25 2.75L8.75 11.25M17.25 2.75L11.75 17.25L8.75 11.25L2.75 8.25L17.25 2.75Z" /></Line>,
  password: () => (
    <Line>
      <rect x="2.25" y="6" width="15.5" height="8" rx="2" />
      <path d="M6 8.5V11.5M4.7 9.25L7.3 10.75M7.3 9.25L4.7 10.75M10 8.5V11.5M8.7 9.25L11.3 10.75M11.3 9.25L8.7 10.75M13.5 11.75H15.5" />
    </Line>
  ),
  key: () => (
    <Line>
      <circle cx="6.75" cy="13.25" r="3.5" />
      <path d="M9.25 10.75L16.5 3.5M14 6L16.25 8.25M12 8L13.75 9.75" />
    </Line>
  ),
};

/** A menu icon by its name; unknown names fall back to the Material font. */
export function SiteIcon({ name }: { name: string }) {
  const draw = ICONS[name];
  return draw ? <>{draw()}</> : <span className="material-icons" aria-hidden="true">{name}</span>;
}
