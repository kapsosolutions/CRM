// The SaaS plans: what each one includes, what it costs, and which plan a
// business is on right now.
//
// Plans (cheapest first):
//   free     "Starter", ₹499/month (the key is still 'free' so stored
//            subscriptions keep working) — Chats with any number of
//            contacts, and up to 3 templates (no carousel, no
//            authentication templates). Nothing else.
//   basic    No template limit, campaigns (monthly cap), and every
//            page except Ads, Instagram, Messenger and Create. No
//            authentication templates.
//   pro      Everything except Ads (campaigns: a higher monthly cap).
//   premium  Everything.
//
// Which plan applies, in order:
//   1. a paid (or admin-granted) subscription that hasn't ended;
//   2. a business created before PLANS_LAUNCHED_AT that never had a
//      subscription: kept on Premium (they were onboarded before plans
//      existed, so nothing they use is taken away);
//   3. the 7-day free trial (from sign-up): Premium;
//   4. otherwise status 'free' (nothing bought): the Starter limits.
// Nothing here writes to the database: the plan is worked out from the
// dates every time, so a trial or a paid period ends on time without a job.
//
// Prices are per month, in rupees, and are what the customer pays (no tax
// is added on top). Quarterly and annual are paid upfront (3× / 12×).
// The browser has the same table (frontend/src/crm/plans.ts): keep them equal.

export const TIERS = ['free', 'basic', 'pro', 'premium'];
export const TIER_NAMES = { free: 'Starter', basic: 'Basic', pro: 'Pro', premium: 'Premium' };
export const CYCLES = { monthly: 1, quarterly: 3, annual: 12 };
export const PRICES = {
  free: { monthly: 499, quarterly: 449, annual: 374 },
  basic: { monthly: 999, quarterly: 899, annual: 749 },
  pro: { monthly: 1999, quarterly: 1799, annual: 1499 },
  premium: { monthly: 2499, quarterly: 2249, annual: 1874 },
};

export const TRIAL_DAYS = 7;
/** Days before the end of a trial or paid period when the CRM starts reminding. */
export const REMIND_DAYS = 5;
const DAY = 24 * 60 * 60 * 1000;

/** Businesses created before this keep Premium until they buy a plan. */
export const PLANS_LAUNCHED_AT = new Date(process.env.PLANS_LAUNCHED_AT || '2026-10-31T00:00:00.000Z');

/**
 * Pages / features, by the CRM's rail keys, plus the channel connections.
 * `flows` covers Automation and Journeys (and the chatbot that runs them).
 */
export const FEATURES = [
  'chats', 'templates', 'campaigns', 'flows', 'catalog', 'categories', 'members', 'offers', 'orders',
  'payment-config', 'ads', 'create', 'instagram', 'messenger',
];
const ALL = FEATURES;
const without = (...f) => ALL.filter((x) => !f.includes(x));

export const LIMITS = {
  free: {
    features: ['chats', 'templates'],
    contacts: null, // no plan limits the contacts it can chat with
    templates: 3, // templates in its account (any status)
    campaignsPerMonth: 0,
    carousel: false,
    authTemplates: false,
  },
  basic: {
    features: without('ads', 'create', 'instagram', 'messenger'),
    contacts: null,
    templates: null,
    campaignsPerMonth: 15,
    carousel: true,
    authTemplates: false,
  },
  pro: {
    features: without('ads'),
    contacts: null,
    templates: null,
    campaignsPerMonth: 50,
    carousel: true,
    authTemplates: true,
  },
  premium: {
    features: ALL,
    contacts: null,
    templates: null,
    campaignsPerMonth: null,
    carousel: true,
    authTemplates: true,
  },
};

export const tierRank = (t) => TIERS.indexOf(t);
// Every plan can be bought (Starter included).
export const isPaidTier = (t) => t === 'free' || t === 'basic' || t === 'pro' || t === 'premium';
export const cycleOf = (raw) => (Object.prototype.hasOwnProperty.call(CYCLES, String(raw)) ? String(raw) : '');
export const tierOf = (raw) => (TIERS.includes(String(raw || '').toLowerCase()) ? String(raw).toLowerCase() : '');

/** What a tier + cycle costs, in paise (the whole period, paid upfront). */
export function pricePaise(tier, cycle) {
  const perMonth = PRICES[tier]?.[cycle];
  if (!perMonth) return 0;
  return perMonth * CYCLES[cycle] * 100;
}

/** The cheapest plan that includes `feature` (for "Upgrade to Basic"). */
export function tierFor(feature) {
  if (feature === 'authTemplates') return TIERS.find((t) => LIMITS[t].authTemplates);
  if (feature === 'carousel') return TIERS.find((t) => LIMITS[t].carousel);
  return TIERS.find((t) => LIMITS[t].features.includes(feature)) || 'premium';
}

const asDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** When this business's free trial ends (stored, or 7 days after sign-up). */
export function trialEndsAt(biz) {
  const stored = asDate(biz?.trialEndsAt);
  if (stored) return stored;
  const created = asDate(biz?.createdAt);
  return created ? new Date(created.getTime() + TRIAL_DAYS * DAY) : null;
}

/** Created before plans existed and never subscribed: kept on Premium. */
export function isLegacy(biz) {
  const created = asDate(biz?.createdAt);
  return !!created && created < PLANS_LAUNCHED_AT && !biz?.subscription?.tier && !biz?.trialEndsAt;
}

/**
 * The plan in force for a business, safe to send to the browser.
 * status: 'active' (paid or granted) | 'legacy' | 'trial' | 'free'
 */
export function planState(biz, now = new Date()) {
  const t = now.getTime();
  const sub = biz?.subscription || null;
  const subEnds = asDate(sub?.endsAt);
  const base = (tier, status, endsAt = null, extra = {}) => {
    const msLeft = endsAt ? Math.max(0, endsAt.getTime() - t) : null;
    return {
      tier,
      name: TIER_NAMES[tier],
      status,
      endsAt: endsAt ? endsAt.toISOString() : null,
      daysLeft: msLeft === null ? null : Math.ceil(msLeft / DAY),
      // Shown in the top bar from REMIND_DAYS before the end.
      endingSoon: msLeft !== null && msLeft <= REMIND_DAYS * DAY,
      limits: LIMITS[tier],
      ...extra,
    };
  };

  if (sub?.tier && LIMITS[sub.tier] && subEnds && subEnds.getTime() > t) {
    return base(sub.tier, 'active', subEnds, {
      cycle: sub.cycle || '',
      startsAt: sub.startsAt || null,
      source: sub.source || 'razorpay',
    });
  }
  if (isLegacy(biz)) return base('premium', 'legacy');
  const trialEnd = trialEndsAt(biz);
  if (trialEnd && trialEnd.getTime() > t && !sub?.tier) return base('premium', 'trial', trialEnd);
  return base('free', 'free', null, {
    // What ended, so the page can say "Your trial ended" / "Your Pro plan ended".
    ended: sub?.tier ? { kind: 'plan', tier: sub.tier, name: TIER_NAMES[sub.tier], at: subEnds?.toISOString() || null }
      : trialEnd ? { kind: 'trial', at: trialEnd.toISOString() } : null,
  });
}

export const hasFeature = (state, feature) => !!state?.limits?.features?.includes(feature);

/** Thrown when the business's plan doesn't allow something. HTTP 402. */
export class PlanLimitError extends Error {
  constructor(message, { code = 'PLAN_LOCKED', feature = '', needs = '', limit = null } = {}) {
    super(message);
    this.name = 'PlanLimitError';
    this.status = 402;
    this.code = code;
    this.feature = feature;
    this.needs = needs;
    this.limit = limit;
  }

  toJSON() {
    return {
      success: false,
      code: this.code,
      message: this.message,
      feature: this.feature || undefined,
      needs: this.needs || undefined,
      needsName: this.needs ? TIER_NAMES[this.needs] : undefined,
      limit: this.limit ?? undefined,
    };
  }
}

const FEATURE_LABEL = {
  chats: 'Chats',
  templates: 'Templates',
  campaigns: 'Campaigns',
  flows: 'Automation',
  catalog: 'Catalog',
  categories: 'Categories',
  members: 'Members',
  offers: 'Offers',
  orders: 'Orders',
  'payment-config': 'Payment configuration',
  ads: 'Ads',
  create: 'Create',
  instagram: 'Instagram',
  messenger: 'Messenger',
};

/** Throws unless the plan includes `feature`. */
export function assertFeature(biz, feature, now = new Date()) {
  const state = planState(biz, now);
  if (hasFeature(state, feature)) return state;
  const needs = tierFor(feature);
  throw new PlanLimitError(
    `${FEATURE_LABEL[feature] || 'This feature'} isn't included in your ${state.name} plan. Upgrade to ${TIER_NAMES[needs]} to use it.`,
    { feature, needs },
  );
}

export default {
  TIERS, TIER_NAMES, CYCLES, PRICES, LIMITS, FEATURES, TRIAL_DAYS, REMIND_DAYS, PLANS_LAUNCHED_AT,
  pricePaise, tierFor, trialEndsAt, isLegacy, planState, hasFeature, assertFeature, PlanLimitError, tierRank, isPaidTier,
};
