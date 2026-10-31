// Screen displayed when a WhatsApp account connection is required
import type { CrmApi } from '../api';
import type { BusinessProfile } from '../types';
import { ConnectWhatsAppButton } from './ConnectWhatsApp';
import './WhatsAppConnectRequired.css';

export type WhatsAppRequiredPage = 'catalog' | 'categories' | 'members' | 'offers' | 'ads' | 'orders' | 'payment-config';

export const PAGE_CONNECT_DETAILS: Record<
  WhatsAppRequiredPage,
  { title: string; subtitle: string; benefitsTitle?: string; benefits: string[] }
> = {
  catalog: {
    title: 'Connect WhatsApp to unlock Catalog',
    subtitle: 'Showcase your products and services directly inside WhatsApp chats.\nConnect your WhatsApp account to enable your catalog.',
    benefitsTitle: 'Benefits of connecting your own number',
    benefits: [
      'Sync products directly with Meta WhatsApp Business catalog',
      'Allow customers to browse items and add to cart in chat',
      'Receive real-time orders directly on WhatsApp',
    ],
  },
  categories: {
    title: 'Connect WhatsApp to unlock Categories',
    subtitle: 'Organize your products and services into structured categories for WhatsApp flows.\nConnect your WhatsApp account to start managing categories.',
    benefitsTitle: 'Benefits of connecting your own number',
    benefits: [
      'Group products and services for intuitive browsing in chat',
      'Power WhatsApp interactive list messages and navigation menus',
      'Help customers quickly discover the right products',
    ],
  },
  members: {
    title: 'Connect WhatsApp to unlock Members',
    subtitle: 'List your specialists, doctors, or team for direct appointment scheduling.\nConnect your WhatsApp account to enable member booking flows.',
    benefitsTitle: 'Benefits of connecting your own number',
    benefits: [
      'Showcase member profiles with photos, titles, and specialties',
      'Let customers select and book appointments with specific members',
      'Manage member schedules, time windows, and availability on WhatsApp',
    ],
  },
  offers: {
    title: 'Connect WhatsApp to unlock Offers',
    subtitle: 'Create discounts, promotional deals, and special pricing for WhatsApp shoppers.\nConnect your WhatsApp account to broadcast and apply offers.',
    benefitsTitle: 'Benefits of connecting your own number',
    benefits: [
      'Display discounted sale pricing directly in your WhatsApp catalog',
      'Broadcast special promotional offers and vouchers to customers',
      'Increase checkout conversions with time-sensitive deals',
    ],
  },
  ads: {
    title: 'Connect WhatsApp to unlock Click to WhatsApp Ads',
    subtitle: 'Run targeted Facebook and Instagram ads that drive buyers straight into WhatsApp.\nConnect your WhatsApp account to track leads and campaign ROI.',
    benefitsTitle: 'Benefits of connecting your own number',
    benefits: [
      'Direct ad traffic straight to high-converting WhatsApp conversations',
      'Automatically greet new leads with interactive chatbot flows',
      'Enjoy a 72-hour free messaging window for every ad lead',
    ],
  },
  orders: {
    title: 'Connect WhatsApp to unlock Orders',
    subtitle: 'Receive, track, and manage customer orders and bookings from WhatsApp chats.\nConnect your WhatsApp account to start processing orders.',
    benefitsTitle: 'Benefits of connecting your own number',
    benefits: [
      'Send automated order confirmations and status updates on WhatsApp',
      'Track order lifecycle from pending to delivered in real time',
      'Support online payments and pay-on-delivery seamlessly',
    ],
  },
  'payment-config': {
    title: 'Connect WhatsApp to unlock WhatsApp Payments',
    subtitle: 'Accept UPI, cards, net banking, and direct payments inside WhatsApp conversations.\nConnect your WhatsApp account to enable in-chat payments.',
    benefitsTitle: 'Benefits of connecting your own number',
    benefits: [
      'Accept instant payments directly within customer WhatsApp chats',
      'Support UPI (Google Pay, PhonePe, Paytm), credit/debit cards & net banking',
      'Automate payment receipts, order confirmation & webhook tracking',
    ],
  },
};

interface Props {
  api: CrmApi;
  business?: BusinessProfile;
  onConnected?: (b: BusinessProfile) => void;
  page?: WhatsAppRequiredPage;
  title?: string;
  subtitle?: string;
  benefitsTitle?: string;
  benefits?: string[];
}

export function MetaInfinityLogo({ width = 46, height = 31 }: { width?: number; height?: number }) {
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
        <linearGradient id="meta-grad-wa-req-new" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#0064E0" />
          <stop offset="50%" stopColor="#0072EC" />
          <stop offset="100%" stopColor="#0081FB" />
        </linearGradient>
      </defs>
      <path
        fill="url(#meta-grad-wa-req-new)"
        d="M6.915 4.03c-1.968 0-3.683 1.28-4.871 3.113C.704 9.208 0 11.883 0 14.449c0 .706.07 1.369.21 1.973a6.624 6.624 0 0 0 .265.86 5.297 5.297 0 0 0 .371.761c.696 1.159 1.818 1.927 3.593 1.927 1.497 0 2.633-.671 3.965-2.444.76-1.012 1.144-1.626 2.663-4.32l.756-1.339.186-.325c.061.1.121.196.183.3l2.152 3.595c.724 1.21 1.665 2.556 2.47 3.314 1.046.987 1.992 1.22 3.06 1.22 1.075 0 1.876-.355 2.455-.843a3.743 3.743 0 0 0 .81-.973c.542-.939.861-2.127.861-3.745 0-2.72-.681-5.357-2.084-7.45-1.282-1.912-2.957-2.93-4.716-2.93-1.047 0-2.088.467-3.053 1.308-.652.57-1.257 1.29-1.82 2.05-.69-.875-1.335-1.547-1.958-2.056-1.182-.966-2.315-1.303-3.454-1.303zm10.16 2.053c1.147 0 2.188.758 2.992 1.999 1.132 1.748 1.647 4.195 1.647 6.4 0 1.548-.368 2.9-1.839 2.9-.58 0-1.027-.23-1.664-1.004-.496-.601-1.343-1.878-2.832-4.358l-.617-1.028a44.908 44.908 0 0 0-1.255-1.98c.07-.109.141-.224.211-.327 1.12-1.667 2.118-2.602 3.358-2.602zm-10.201.553c1.265 0 2.058.791 2.675 1.446.307.327.737.871 1.234 1.579l-1.02 1.566c-.757 1.163-1.882 3.017-2.837 4.338-1.191 1.649-1.81 1.817-2.486 1.817-.524 0-1.038-.237-1.383-.794-.263-.426-.464-1.13-.464-2.046 0-2.221.63-4.535 1.66-6.088.454-.687.964-1.226 1.533-1.533a2.264 2.264 0 0 1 1.088-.285z"
      />
    </svg>
  );
}

export function BenefitCheckIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="wa-req-benefit-icon">
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

export function WhatsAppConnectRequired({
  api,
  business,
  onConnected = () => {},
  page,
  title,
  subtitle,
  benefitsTitle,
  benefits,
}: Props) {
  const pageDefaults = page ? PAGE_CONNECT_DETAILS[page] : undefined;
  const activeTitle = title ?? pageDefaults?.title ?? 'Connect WhatsApp to unlock 2B+ users';
  const activeSubtitle =
    subtitle ?? pageDefaults?.subtitle ?? 'WhatsApp is the most used messaging app globally.\nConnect your account to start messaging.';
  const activeBenefitsTitle = benefitsTitle ?? pageDefaults?.benefitsTitle ?? 'Benefits of connecting your own number';
  const activeBenefits =
    benefits ??
    pageDefaults?.benefits ?? [
      'Sending messages from your brand name',
      'Free 100 INR credits',
      'Respond to unlimited customer initiated conversations',
    ];

  return (
    <div className="wa-req-wrapper">
      <div className="wa-req-box">
        <div className="wa-req-logos-row">
          <img src="/whatsapp.svg" alt="WhatsApp" className="wa-req-logo-img" />
          <span className="wa-req-arrow">⇄</span>
          <MetaInfinityLogo width={46} height={31} />
        </div>

        <h2 className="wa-req-headline">{activeTitle}</h2>
        <p className="wa-req-subline">
          {activeSubtitle.split('\n').map((line, idx, arr) => (
            <span key={idx}>
              {line}
              {idx < arr.length - 1 && <br />}
            </span>
          ))}
        </p>

        <div className="wa-req-benefits-box">
          <h3 className="wa-req-benefits-title">{activeBenefitsTitle}</h3>
          <ul className="wa-req-benefits-list">
            {activeBenefits.map((b, idx) => (
              <li key={idx} className="wa-req-benefit-item">
                <BenefitCheckIcon />
                <span>{b}</span>
              </li>
            ))}
          </ul>

          <div className="wa-req-cta-row">
            <ConnectWhatsAppButton
              api={api}
              onConnected={onConnected}
              business={business}
              label="Connect WhatsApp Account"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
