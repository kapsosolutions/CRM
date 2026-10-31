// Enforces the plan limits (services/plans.js) on the server, so a limit
// can't be stepped around by calling the API directly. The CRM shows the
// same locks; this is what makes them real.
import Business from '../models/Business.js';
import Conversation from '../models/Conversation.js';
import Template from '../models/Template.js';
import Campaign from '../models/Campaign.js';
import { businessFromToken } from '../middleware/auth.js';
import logger from './logger.js';
import {
  planState, hasFeature, assertFeature, PlanLimitError, tierFor, TIER_NAMES,
} from './plans.js';

const PLAN_FIELDS = 'createdAt trialEndsAt subscription name';

// Every outbound message checks the plan, so the business's plan fields are
// kept for a few seconds (a campaign sends many messages in a row). A plan
// change calls forgetPlan, so a purchase applies at once.
const CACHE_MS = 15000;
const cache = new Map();

export function forgetPlan(businessId) {
  cache.delete(String(businessId));
}

/** The plan of a business by id (a light, briefly cached read), or null. */
export async function planOf(businessId) {
  if (!businessId) return null;
  const key = String(businessId);
  const hit = cache.get(key);
  let biz = hit && hit.at > Date.now() - CACHE_MS ? hit.biz : null;
  if (!biz) {
    biz = await Business.findById(key).select(PLAN_FIELDS).lean().catch(() => null);
    if (biz) cache.set(key, { biz, at: Date.now() });
    if (cache.size > 5000) cache.clear();
  }
  return biz ? { biz, state: planState(biz) } : null;
}

/** Does this business's plan include `feature`? Unknown business: yes (don't block on a read failure). */
export async function tenantHasFeature(businessId, feature) {
  const p = await planOf(businessId);
  return p ? hasFeature(p.state, feature) : true;
}

const isWhatsApp = (c) => !c.channel || c.channel === 'whatsapp';
const digits = (p) => String(p || '').replace(/\D/g, '');

/**
 * The contacts a plan with a contact limit may chat with: its first N
 * WhatsApp contacts (by when the chat started). Everyone after that is
 * locked until the business upgrades; their messages are still saved.
 * @returns {Promise<{limit:number|null, used:number, allowed:Set<string>|null}>}
 */
export async function contactAllowance(businessId, state) {
  const limit = state?.limits?.contacts ?? null;
  if (!limit) return { limit: null, used: 0, allowed: null };
  const rows = await Conversation.find({ businessId })
    .select('phone channel createdAt')
    .sort({ createdAt: 1, _id: 1 })
    .limit(limit + 500)
    .lean();
  const wa = rows.filter(isWhatsApp);
  const allowed = new Set(wa.slice(0, limit).map((c) => c.phone));
  return { limit, used: Math.min(wa.length, limit), total: wa.length, allowed };
}

/**
 * Throws unless the business may message `phone` on WhatsApp: one of its
 * first N contacts, or a new contact while it still has room.
 */
export async function assertContact(businessId, phone, stateIn = null) {
  const state = stateIn || (await planOf(businessId))?.state;
  const limit = state?.limits?.contacts ?? null;
  if (!limit) return;
  const p = digits(phone);
  const { allowed, total } = await contactAllowance(businessId, state);
  if (allowed.has(p)) return;
  const known = await Conversation.exists({ businessId, phone: p });
  // A brand-new contact still fits while fewer than N exist.
  if (!known && total < limit) return;
  throw new PlanLimitError(
    `Your ${state.name} plan includes chats with ${limit} contacts. Upgrade to ${TIER_NAMES.basic} to chat with everyone.`,
    { code: 'CONTACT_LIMIT', feature: 'contacts', needs: 'basic', limit },
  );
}

/** Throws unless the plan allows creating this template (count, carousel, authentication). */
export async function assertTemplateAllowed(biz, { name, category, kind }) {
  const state = planState(biz);
  const L = state.limits;
  if (String(category || '').toUpperCase() === 'AUTHENTICATION' && !L.authTemplates) {
    const needs = tierFor('authTemplates');
    throw new PlanLimitError(
      `Authentication templates aren't included in your ${state.name} plan. Upgrade to ${TIER_NAMES[needs]} to create them.`,
      { feature: 'authTemplates', needs },
    );
  }
  if (kind === 'carousel' && !L.carousel) {
    const needs = tierFor('carousel');
    throw new PlanLimitError(
      `Carousel templates aren't included in your ${state.name} plan. Upgrade to ${TIER_NAMES[needs]} to create them.`,
      { feature: 'carousel', needs },
    );
  }
  if (L.templates) {
    const clean = String(name || '').trim().toLowerCase().replace(/\s+/g, '_');
    // Saving over a template it already has (a draft, a resubmit) isn't a new one.
    const existing = clean ? await Template.exists({ businessId: biz._id, name: clean }) : false;
    if (!existing) {
      const count = await Template.countDocuments({ businessId: biz._id });
      if (count >= L.templates) {
        throw new PlanLimitError(
          `Your ${state.name} plan includes ${L.templates} templates, and you have ${count}. Delete one or upgrade to ${TIER_NAMES.basic} for unlimited templates.`,
          { code: 'TEMPLATE_LIMIT', feature: 'templates', needs: 'basic', limit: L.templates },
        );
      }
    }
  }
  return state;
}

const monthStart = (now = new Date()) => new Date(now.getFullYear(), now.getMonth(), 1);

/** Campaigns launched (sent or scheduled, not drafts) this calendar month. */
export async function campaignsThisMonth(businessId, { exceptId = null } = {}) {
  const filter = { businessId, status: { $ne: 'draft' }, createdAt: { $gte: monthStart() } };
  const n = await Campaign.countDocuments(filter);
  if (!exceptId) return n;
  // An edited campaign that was already counted (scheduled → send now) isn't a new one.
  const self = await Campaign.exists({ _id: exceptId, ...filter });
  return self ? n - 1 : n;
}

/** Throws unless the plan allows launching one more campaign this month (channel aware). */
export async function assertCampaignAllowed(biz, { channel = 'whatsapp', exceptId = null } = {}) {
  const state = assertFeature(biz, 'campaigns');
  if (channel === 'messenger' || channel === 'instagram') assertFeature(biz, channel);
  const cap = state.limits.campaignsPerMonth;
  if (cap === null || cap === undefined) return state;
  const used = await campaignsThisMonth(biz._id, { exceptId });
  if (used >= cap) {
    const needs = state.tier === 'basic' ? 'pro' : 'premium';
    throw new PlanLimitError(
      `Your ${state.name} plan includes ${cap} campaigns a month, and ${used} have been launched this month. Upgrade to ${TIER_NAMES[needs]} for more, or wait until next month.`,
      { code: 'CAMPAIGN_LIMIT', feature: 'campaigns', needs, limit: cap },
    );
  }
  return state;
}

/** Sends a PlanLimitError as JSON; returns false for anything else. */
export function sendPlanError(res, err) {
  if (!(err instanceof PlanLimitError)) return false;
  res.status(err.status).json(err.toJSON());
  return true;
}

/**
 * Express gate for a whole router: every change (POST / PUT / PATCH /
 * DELETE) by a signed-in business needs `feature` in its plan. Reads are
 * left alone (a locked page shows its upgrade screen instead). Requests
 * without a business token pass through, so public endpoints (payment
 * callbacks, webhooks) and the router's own sign-in check still work.
 * @param {string|((req)=>string|null)} feature  null from a function = not gated
 * @param {{only?: (req)=>boolean}} [opts]
 */
export function requireFeature(feature, { only } = {}) {
  return async (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (only && !only(req)) return next();
    const auth = req.headers.authorization || '';
    if (!auth) return next();
    try {
      const biz = await businessFromToken(auth);
      if (!biz) return next();
      const f = typeof feature === 'function' ? feature(req) : feature;
      if (!f) return next();
      assertFeature(biz, f);
      return next();
    } catch (err) {
      if (sendPlanError(res, err)) return undefined;
      logger.warn('plan gate check failed (allowed through)', { path: req.originalUrl, error: err.message });
      return next();
    }
  };
}

export default {
  planOf, tenantHasFeature, contactAllowance, assertContact, assertTemplateAllowed,
  campaignsThisMonth, assertCampaignAllowed, sendPlanError, requireFeature,
};
