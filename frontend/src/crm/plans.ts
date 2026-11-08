// The SaaS plans, as the landing page, the plans dialog (Buy Now) and
// Settings → Billing show them. What each plan really includes is enforced
// by the server (backend/services/plans.js): the tiers, prices and limits
// here must match it.
//
//   Starter  ₹499 (tier key 'free'): WhatsApp team inbox, 50 templates
//            (standard; Marketing + Utility), 10 campaigns/month at 5/s,
//            journeys (no native WhatsApp Flows).
//   Basic    100 templates (standard + carousel, Authentication too), 25
//            campaigns at 10/s, journeys + WhatsApp Flows, calls, polls,
//            events, API keys, catalog, payments, Instagram and
//            Messenger. No Orders / Appointments page, Ads or Create.
//   Pro      Every feature and template format, 300 templates, 50
//            campaigns at 20/s, Ads and Create.
//   Premium  Everything, no template or campaign limits, 40/s.
// Every new business gets every feature for 7 days first (the free trial).
// No plan limits contacts.
// Prices are per month and are what the customer pays; quarterly and annual
// are paid upfront.
import type { PlanFeature, PlanLimits, PlanState, PlanTierKey, TemplateKind } from './types';

export type BillingCycle = 'monthly' | 'quarterly' | 'annual';

export const BILLING_CYCLES: { key: BillingCycle; label: string; months: number; save?: string }[] = [
  { key: 'monthly', label: 'Monthly', months: 1 },
  { key: 'quarterly', label: 'Quarterly', months: 3, save: 'Save up to 10%' },
  { key: 'annual', label: 'Annual', months: 12, save: 'Save up to 25%' },
];

export const TRIAL_DAYS = 7;

/** Meta's per-message prices, in every country (public/meta-whatsapp-pricing.pdf). */
export const META_PRICING_PDF = '/meta-whatsapp-pricing.pdf';

const ALL: PlanFeature[] = [
  'chats', 'templates', 'campaigns', 'journeys', 'flows', 'calls', 'polls', 'events', 'api',
  'catalog', 'categories', 'members', 'offers', 'orders',
  'payment-config', 'ads', 'create', 'instagram', 'messenger',
];
export const TEMPLATE_KINDS: TemplateKind[] = ['standard', 'carousel', 'lto'];
export const KIND_NAMES: Record<TemplateKind, string> = { standard: 'Standard', carousel: 'Carousel', lto: 'Limited-time offer' };
const without = (...f: PlanFeature[]) => ALL.filter((x) => !f.includes(x));

export const LIMITS: Record<PlanTierKey, PlanLimits> = {
  free: {
    features: ['chats', 'templates', 'campaigns', 'journeys'], contacts: null, templates: 50, templateKinds: ['standard'],
    campaignsPerMonth: 10, sendRate: 5, carousel: false, authTemplates: false,
  },
  basic: {
    features: without('orders', 'ads', 'create'), contacts: null, templates: 100, templateKinds: ['standard', 'carousel'],
    campaignsPerMonth: 25, sendRate: 10, carousel: true, authTemplates: true,
  },
  pro: {
    features: ALL, contacts: null, templates: 300, templateKinds: TEMPLATE_KINDS,
    campaignsPerMonth: 50, sendRate: 20, carousel: true, authTemplates: true,
  },
  premium: {
    features: ALL, contacts: null, templates: null, templateKinds: TEMPLATE_KINDS,
    campaignsPerMonth: null, sendRate: 40, carousel: true, authTemplates: true,
  },
};

export const TIER_ORDER: PlanTierKey[] = ['free', 'basic', 'pro', 'premium'];
export const TIER_NAMES: Record<PlanTierKey, string> = { free: 'Starter', basic: 'Basic', pro: 'Pro', premium: 'Premium' };

/** Per-month price in rupees, for each cycle. */
export const PRICES: Record<PlanTierKey, Record<BillingCycle, number>> = {
  free: { monthly: 499, quarterly: 449, annual: 374 },
  basic: { monthly: 999, quarterly: 899, annual: 749 },
  pro: { monthly: 1999, quarterly: 1799, annual: 1499 },
  premium: { monthly: 2499, quarterly: 2249, annual: 1874 },
};

/**
 * The struck-through "was" price per month, shown before the real price on
 * every plan card (display only: what's charged is PRICES, on the server).
 */
export const STRIKE_PRICES: Record<PlanTierKey, number> = {
  free: 749,
  basic: 1499,
  pro: 2999,
  premium: 3749,
};

export interface PlanTier {
  key: PlanTierKey;
  name: string;
  badge?: string;
  theme: 'slate' | 'blue' | 'green' | 'purple';
  description: string;
  /** What's included, then what isn't. */
  includes: string[];
  excludes: string[];
  buttonColor: string;
}

const n = (v: number | null | undefined, what: string) => (v === null || v === undefined ? `Unlimited ${what}` : `${v} ${what}`);
const speed = (t: PlanTierKey) => `Campaign speed: up to ${LIMITS[t].sendRate} messages a second`;
const FREE_SERVICE = '1,000 free service messages a month (Meta)';

export const PLANS: PlanTier[] = [
  {
    key: 'free',
    name: 'Starter',
    theme: 'slate',
    description: 'The WhatsApp CRM: a team inbox, templates, campaigns and journeys on the official API.',
    includes: [
      'WhatsApp CRM: team inbox, unlimited contacts',
      n(LIMITS.free.templates, 'message templates'),
      'Standard templates (text, media, buttons)',
      'Marketing & Utility templates',
      `${n(LIMITS.free.campaignsPerMonth, 'campaigns')} a month (broadcast & drip)`,
      speed('free'),
      'Basic automation: journeys & keyword replies',
      FREE_SERVICE,
      'Your own WhatsApp number · official Meta Cloud API',
    ],
    excludes: [
      'Carousel & limited-time offer templates',
      'Authentication (OTP) templates',
      'WhatsApp calls, polls & events',
      'Template API keys',
      'WhatsApp Flows (native forms)',
      'Catalog, orders & payment configuration',
      'Instagram, Messenger & Ads',
    ],
    buttonColor: '#e2e8f0',
  },
  {
    key: 'basic',
    name: 'Basic',
    theme: 'blue',
    description: 'Advanced automation with WhatsApp Flows, calls, your catalog and Instagram & Messenger.',
    includes: [
      'WhatsApp CRM: team inbox, unlimited contacts',
      n(LIMITS.basic.templates, 'message templates'),
      'Standard & carousel templates',
      'Marketing, Utility & Authentication (OTP) templates',
      `${n(LIMITS.basic.campaignsPerMonth, 'campaigns')} a month (broadcast & drip)`,
      speed('basic'),
      'Advanced automation: journeys + native WhatsApp Flows',
      'WhatsApp calls, polls & events in chats',
      'Template API keys (send from your website or app)',
      'Catalog, categories, members & offers',
      'WhatsApp Pay configuration',
      'Instagram & Messenger accounts',
      FREE_SERVICE,
    ],
    excludes: ['Limited-time offer templates', 'Orders & appointments (bookings)', 'Ads', 'Create: Facebook & Instagram posts'],
    buttonColor: '#38bdf8',
  },
  {
    key: 'pro',
    name: 'Pro',
    badge: 'Best Value',
    theme: 'green',
    description: 'Every feature and template format, with Click-to-WhatsApp ads.',
    includes: [
      'WhatsApp CRM: team inbox, unlimited contacts',
      n(LIMITS.pro.templates, 'message templates'),
      'All template formats: standard, carousel & limited-time offer',
      'Marketing, Utility & Authentication (OTP) templates',
      `${n(LIMITS.pro.campaignsPerMonth, 'campaigns')} a month (broadcast & drip)`,
      speed('pro'),
      'Advanced automation: journeys + native WhatsApp Flows',
      'WhatsApp calls, polls & events in chats',
      'Template API keys (send from your website or app)',
      'Catalog, offers, orders & bookings',
      'WhatsApp Pay configuration',
      'Instagram & Messenger accounts',
      'Ads: Click-to-WhatsApp ads & lead forms',
      'Create: Facebook & Instagram posts',
      FREE_SERVICE,
    ],
    excludes: [],
    buttonColor: '#00d084',
  },
  {
    key: 'premium',
    name: 'Premium',
    theme: 'purple',
    description: 'Everything unlocked, with no limits on templates or campaigns.',
    includes: [
      'WhatsApp CRM: team inbox, unlimited contacts',
      'Unlimited message templates',
      'All template formats: standard, carousel & limited-time offer',
      'Marketing, Utility & Authentication (OTP) templates',
      'Unlimited campaigns (broadcast & drip)',
      speed('premium'),
      'Advanced automation: journeys + native WhatsApp Flows',
      'WhatsApp calls, polls & events in chats',
      'Template API keys (send from your website or app)',
      'Catalog, offers, orders & bookings',
      'WhatsApp Pay configuration',
      'Instagram & Messenger accounts',
      'Ads: Click-to-WhatsApp ads & lead forms',
      'Create: Facebook & Instagram posts',
      FREE_SERVICE,
      'Priority support',
    ],
    excludes: [],
    buttonColor: '#f472b6',
  },
];

export const cycleLabel = (c: string) => BILLING_CYCLES.find((x) => x.key === c)?.label || c;
export const cycleMonths = (c: string) => BILLING_CYCLES.find((x) => x.key === c)?.months || 1;

const inr = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
export const rupees = (paise: number) => inr(Math.round(paise) / 100);

/** "₹1,499" per month for a plan + cycle. */
export function monthlyPrice(tier: PlanTierKey, cycle: BillingCycle): string {
  return inr(PRICES[tier][cycle]);
}

/** The struck-through "was" price per month ("₹1,499"), or '' when it isn't above the real price. */
export function strikePrice(tier: PlanTierKey, cycle: BillingCycle): string {
  const was = STRIKE_PRICES[tier];
  return was > PRICES[tier][cycle] ? inr(was) : '';
}

/** What the period costs upfront: "₹17,988 billed annually". */
export function billedText(tier: PlanTierKey, cycle: BillingCycle): string {
  const total = PRICES[tier][cycle] * cycleMonths(cycle);
  return cycle === 'monthly' ? 'billed monthly' : `${inr(total)} billed ${cycle === 'annual' ? 'annually' : 'quarterly'}`;
}

/** "₹1499/month, billed annually (₹17,988)" */
export function priceText(tier: PlanTierKey, cycle: BillingCycle): string {
  return `${monthlyPrice(tier, cycle)}/month, ${billedText(tier, cycle)}`;
}

export const hasFeature = (state: PlanState | null | undefined, f: PlanFeature) =>
  !state || state.limits.features.includes(f);

/** The template formats a plan may create (an older server only says `carousel`). */
export function kindsOf(l: PlanLimits | null | undefined): TemplateKind[] {
  if (!l) return TEMPLATE_KINDS;
  return l.templateKinds?.length ? l.templateKinds : l.carousel ? ['standard', 'carousel', 'lto'] : ['standard'];
}

/** The cheapest plan that unlocks a feature or template format (for "Upgrade to Basic"). */
export function tierFor(f: PlanFeature | TemplateKind | 'authTemplates'): PlanTierKey {
  if (f === 'authTemplates') return TIER_ORDER.find((t) => LIMITS[t].authTemplates) || 'premium';
  if ((TEMPLATE_KINDS as string[]).includes(f)) return TIER_ORDER.find((t) => kindsOf(LIMITS[t]).includes(f as TemplateKind)) || 'premium';
  return TIER_ORDER.find((t) => LIMITS[t].features.includes(f as PlanFeature)) || 'premium';
}

export const tierRank = (t: PlanTierKey) => TIER_ORDER.indexOf(t);

/** A short line for the plan's status: "Free trial · 3 days left", "Pro · until 12 Dec 2026". */
export function planStatusText(s: PlanState | null | undefined): string {
  if (!s) return '';
  const date = s.endsAt ? new Date(s.endsAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  if (s.status === 'trial') return `Free trial · ${s.daysLeft === 1 ? '1 day' : `${s.daysLeft} days`} left`;
  if (s.status === 'active') return `${s.name} · until ${date}`;
  if (s.status === 'legacy') return `${s.name}`;
  return 'No active plan';
}
