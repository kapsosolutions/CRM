// The SaaS plans, as the landing page, the plans dialog (Buy Now) and
// Settings → Billing show them. What each plan really includes is enforced
// by the server (backend/services/plans.js): the tiers, prices and limits
// here must match it.
//
//   Starter  ₹499 (tier key 'free') — Chats with unlimited contacts + 3
//            templates (no carousel, no authentication templates).
//   Basic    No template limit, campaigns, automation, catalog,
//            orders… everything except Ads, Instagram, Messenger, Create.
//            No authentication templates.
//   Pro      Everything except Ads.
//   Premium  Everything.
// Every new business gets every feature for 7 days first (the free trial).
// No plan limits contacts.
// Prices are per month and are what the customer pays; quarterly and annual
// are paid upfront.
import type { PlanFeature, PlanLimits, PlanState, PlanTierKey } from './types';

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
  'chats', 'templates', 'campaigns', 'flows', 'catalog', 'categories', 'members', 'offers', 'orders',
  'payment-config', 'ads', 'create', 'instagram', 'messenger',
];
const without = (...f: PlanFeature[]) => ALL.filter((x) => !f.includes(x));

export const LIMITS: Record<PlanTierKey, PlanLimits> = {
  free: { features: ['chats', 'templates'], contacts: null, templates: 3, campaignsPerMonth: 0, carousel: false, authTemplates: false },
  basic: { features: without('ads', 'create', 'instagram', 'messenger'), contacts: null, templates: null, campaignsPerMonth: 15, carousel: true, authTemplates: false },
  pro: { features: without('ads'), contacts: null, templates: null, campaignsPerMonth: 50, carousel: true, authTemplates: true },
  premium: { features: ALL, contacts: null, templates: null, campaignsPerMonth: null, carousel: true, authTemplates: true },
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

export const PLANS: PlanTier[] = [
  {
    key: 'free',
    name: 'Starter',
    theme: 'slate',
    description: 'Start chatting with customers on the official WhatsApp Business API.',
    includes: [
      'Team inbox: chat with unlimited contacts',
      'Up to 3 message templates',
      'Connect your own WhatsApp number',
      'Official Meta Cloud API',
    ],
    excludes: ['Campaigns', 'Carousel & authentication templates', 'Automation, catalog & orders', 'Instagram, Messenger & Ads'],
    buttonColor: '#e2e8f0',
  },
  {
    key: 'basic',
    name: 'Basic',
    theme: 'blue',
    description: 'Unlimited chats and templates, campaigns, automation and your catalog on WhatsApp.',
    includes: [
      'Everything in Starter',
      'Unlimited templates, incl. carousel',
      `${LIMITS.basic.campaignsPerMonth} campaigns a month (broadcast & drip)`,
      'Automation: journeys & WhatsApp Flows',
      'Catalog, offers, orders & bookings',
      'WhatsApp Pay configuration',
    ],
    excludes: ['Authentication (OTP) templates', 'Instagram & Messenger', 'Ads'],
    buttonColor: '#38bdf8',
  },
  {
    key: 'pro',
    name: 'Pro',
    badge: 'Best Value',
    theme: 'green',
    description: 'Every channel: WhatsApp, Instagram and Messenger in one inbox, with authentication templates.',
    includes: [
      'Everything in Basic',
      `${LIMITS.pro.campaignsPerMonth} campaigns a month`,
      'Authentication (OTP) templates',
      'Instagram & Messenger inbox and campaigns',
      'Create: Facebook & Instagram posts',
    ],
    excludes: ['Ads'],
    buttonColor: '#00d084',
  },
  {
    key: 'premium',
    name: 'Premium',
    theme: 'purple',
    description: 'Everything unlocked, with unlimited campaigns and Click-to-WhatsApp ads.',
    includes: [
      'Everything in Pro',
      'Unlimited campaigns',
      'Ads: Click-to-WhatsApp ads & lead forms',
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

/** The cheapest plan that unlocks a feature (for "Upgrade to Basic"). */
export function tierFor(f: PlanFeature | 'carousel' | 'authTemplates'): PlanTierKey {
  if (f === 'carousel') return TIER_ORDER.find((t) => LIMITS[t].carousel) || 'premium';
  if (f === 'authTemplates') return TIER_ORDER.find((t) => LIMITS[t].authTemplates) || 'premium';
  return TIER_ORDER.find((t) => LIMITS[t].features.includes(f)) || 'premium';
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
