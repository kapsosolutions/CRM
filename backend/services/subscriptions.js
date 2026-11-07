// Buying a plan with Razorpay.
//
//   quote     what a plan + cycle costs this business now (and what kind of
//             purchase it is: new, renew, upgrade)
//   checkout  creates the Razorpay order + our SubscriptionPayment row
//   confirm   the checkout's signed callback: checks the signature AND asks
//             Razorpay that the payment really is captured for this order and
//             amount, then activates
//   activate  turns a payment 'paid' exactly once (conditional update), then
//             sets the business's subscription; the webhook uses it too
//
// Periods:
//   new      starts now. Bought during the free trial: the trial's unused
//            days are added on (the trial isn't cut short by paying early).
//   renew    the same plan: starts when the current period ends.
//   upgrade  a higher plan: starts now; the unused part of the current
//            period's payment comes off the price.
//   A lower plan while a higher one is active: refused (it can be bought
//   once the current period ends).
import crypto from 'crypto';
import Business from '../models/Business.js';
import SubscriptionPayment from '../models/SubscriptionPayment.js';
import logger from './logger.js';
import { notify } from './notifications.js';
import { forgetPlan } from './planGate.js';
import {
  planState, pricePaise, tierOf, cycleOf, isPaidTier, tierRank, TIER_NAMES, CYCLES, trialEndsAt,
} from './plans.js';
import {
  razorpayConfigured, razorpayKeyId, createOrder, fetchPayment, capturePayment, verifyCheckoutSignature, razorpayError,
} from './razorpay.js';

const MIN_PAISE = 100; // Razorpay's minimum charge (₹1)

/** Thrown for a purchase that can't go ahead. Carries an HTTP status. */
export class BillingError extends Error {
  constructor(message, status = 400, code = 'INVALID') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function addMonths(date, months) {
  const d = new Date(date);
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + months);
  // 31 Jan + 1 month → 28/29 Feb, not 3 Mar.
  if (d.getUTCDate() < day) d.setUTCDate(0);
  return d;
}

const rupees = (paise) => `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/**
 * What buying `tier` for `cycle` means for this business right now.
 * @returns {{tier, cycle, months, kind, listPaise, creditPaise, amountPaise, startsAt:Date, endsAt:Date}}
 */
export function quote(biz, tierIn, cycleIn, now = new Date()) {
  const tier = tierOf(tierIn);
  const cycle = cycleOf(cycleIn);
  if (!isPaidTier(tier)) throw new BillingError('Choose the Starter, Basic, Pro or Premium plan.');
  if (!cycle) throw new BillingError('Choose monthly, quarterly or annual billing.');
  const months = CYCLES[cycle];
  const listPaise = pricePaise(tier, cycle);
  const state = planState(biz, now);
  const sub = biz.subscription || {};

  if (state.status === 'active' && isPaidTier(sub.tier)) {
    const curEnd = new Date(sub.endsAt);
    if (tier === sub.tier) {
      return { tier, cycle, months, kind: 'renew', listPaise, creditPaise: 0, amountPaise: listPaise, startsAt: curEnd, endsAt: addMonths(curEnd, months) };
    }
    if (tierRank(tier) < tierRank(sub.tier)) {
      throw new BillingError(
        `You're on ${TIER_NAMES[sub.tier]} until ${curEnd.toDateString()}. You can switch to ${TIER_NAMES[tier]} when it ends.`,
        409,
        'DOWNGRADE_LATER',
      );
    }
    // Upgrade: the unused share of what was paid for the current period.
    const start = new Date(sub.startsAt || now).getTime();
    const total = Math.max(1, curEnd.getTime() - start);
    const left = Math.max(0, curEnd.getTime() - now.getTime());
    const paid = Number(sub.amountPaise) || 0;
    const creditPaise = Math.min(listPaise - MIN_PAISE, Math.floor((paid * left) / total));
    return {
      tier, cycle, months, kind: 'upgrade', listPaise, creditPaise: Math.max(0, creditPaise),
      amountPaise: Math.max(MIN_PAISE, listPaise - Math.max(0, creditPaise)), startsAt: now, endsAt: addMonths(now, months),
    };
  }

  // From the trial (its unused days carry over), Free, or before plans existed.
  const trialEnd = state.status === 'trial' ? trialEndsAt(biz) : null;
  const from = trialEnd && trialEnd > now ? trialEnd : now;
  return { tier, cycle, months, kind: 'new', listPaise, creditPaise: 0, amountPaise: listPaise, startsAt: now, endsAt: addMonths(from, months) };
}

/** Public view of a quote / payment. */
export const presentQuote = (q) => ({
  tier: q.tier,
  name: TIER_NAMES[q.tier],
  cycle: q.cycle,
  months: q.months,
  kind: q.kind,
  listPaise: q.listPaise,
  creditPaise: q.creditPaise,
  amountPaise: q.amountPaise,
  startsAt: q.startsAt?.toISOString?.() || q.startsAt || null,
  endsAt: q.endsAt?.toISOString?.() || q.endsAt || null,
});

export const presentPayment = (p) => ({
  _id: String(p._id),
  orderId: p.orderId,
  paymentId: p.paymentId || '',
  tier: p.tier,
  name: TIER_NAMES[p.tier] || p.tier,
  cycle: p.cycle,
  kind: p.kind,
  listPaise: p.listPaise || 0,
  creditPaise: p.creditPaise || 0,
  amountPaise: p.amountPaise,
  currency: p.currency || 'INR',
  status: p.status,
  method: p.method || '',
  paidAt: p.paidAt || null,
  startsAt: p.startsAt || null,
  endsAt: p.endsAt || null,
  createdAt: p.createdAt || null,
});

/** Create the Razorpay order for a plan purchase. */
export async function checkout(biz, { tier, cycle } = {}) {
  if (!razorpayConfigured()) throw new BillingError('Online payments aren\'t set up yet. Please contact support.', 503, 'PAYMENTS_OFF');
  const q = quote(biz, tier, cycle);
  const receipt = `sub_${String(biz._id).slice(-10)}_${Date.now().toString(36)}`;
  let order;
  try {
    order = await createOrder({
      amount: q.amountPaise,
      receipt,
      notes: { businessId: String(biz._id), business: String(biz.name || '').slice(0, 200), tier: q.tier, cycle: q.cycle, kind: q.kind },
    });
  } catch (err) {
    logger.error('razorpay order failed', { business: biz.name, error: razorpayError(err) });
    throw new BillingError('Couldn\'t start the payment. Please try again in a moment.', 502, 'RAZORPAY_FAILED');
  }
  if (!order?.id || Number(order.amount) !== q.amountPaise) {
    throw new BillingError('Couldn\'t start the payment. Please try again in a moment.', 502, 'RAZORPAY_FAILED');
  }
  await SubscriptionPayment.create({
    businessId: biz._id,
    orderId: order.id,
    tier: q.tier,
    cycle: q.cycle,
    months: q.months,
    kind: q.kind,
    listPaise: q.listPaise,
    creditPaise: q.creditPaise,
    amountPaise: q.amountPaise,
    currency: 'INR',
    status: 'created',
    receipt,
  });
  logger.info('plan checkout started', { business: biz.name, tier: q.tier, cycle: q.cycle, kind: q.kind, amount: q.amountPaise });
  return {
    keyId: razorpayKeyId(),
    orderId: order.id,
    amount: q.amountPaise,
    currency: 'INR',
    quote: presentQuote(q),
    prefill: {
      name: [biz.ownerFirstName, biz.ownerLastName].filter(Boolean).join(' ') || biz.name || '',
      email: biz.email || '',
      contact: String(biz.ownerPhone || '').replace(/[^\d+]/g, ''),
    },
    description: `${TIER_NAMES[q.tier]} plan · ${q.cycle} (${q.months} month${q.months === 1 ? '' : 's'})`,
  };
}

// One activation at a time per business, so two payments landing together
// (checkout callback + webhook, or two orders) can't compute dates from the
// same starting point. One backend process, so a promise chain is enough.
const chains = new Map();
function serialize(key, fn) {
  const prev = chains.get(key) || Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.catch(() => {});
  chains.set(key, tail);
  tail.then(() => {
    if (chains.get(key) === tail) chains.delete(key);
  });
  return run;
}

/**
 * Mark the order paid and give the business its plan. Idempotent: the
 * second call for the same order changes nothing and returns the result.
 * @returns {Promise<{payment:object, activated:boolean}>}
 */
export async function activate(orderId, { paymentId = '', method = '', amount = null } = {}) {
  const pay0 = await SubscriptionPayment.findOne({ orderId }).lean();
  if (!pay0) throw new BillingError('Unknown order.', 404, 'NOT_FOUND');
  if (amount !== null && Number(amount) !== Number(pay0.amountPaise)) {
    logger.error('razorpay amount mismatch', { orderId, expected: pay0.amountPaise, got: amount });
    throw new BillingError('The payment amount doesn\'t match the order.', 400, 'AMOUNT_MISMATCH');
  }
  return serialize(String(pay0.businessId), async () => {
    const now = new Date();
    const won = await SubscriptionPayment.findOneAndUpdate(
      { orderId, status: { $in: ['created', 'failed'] } },
      { $set: { status: 'paid', paymentId, method, paidAt: now, error: '' } },
      { new: true },
    ).lean();
    if (!won) {
      // Already activated (the other path got there first).
      return { payment: await SubscriptionPayment.findOne({ orderId }).lean(), activated: false };
    }
    const biz = await Business.findById(won.businessId);
    if (!biz) return { payment: won, activated: false };
    // Dates from the business as it is NOW (another payment may have landed
    // since the order was made).
    const before = planState(biz, now);
    const cur = biz.subscription || {};
    let tier = won.tier;
    let startsAt;
    let endsAt;
    let value; // what the period is worth (the next upgrade's credit is worked out from it)
    let q = null;
    try {
      q = quote(biz, won.tier, won.cycle, now);
    } catch {
      q = null; // a lower plan, while a higher one became active in between
    }
    if (!q) {
      // Never lose a paid period: the higher plan runs on for the months bought.
      tier = cur.tier;
      startsAt = new Date(cur.startsAt || now);
      endsAt = addMonths(new Date(cur.endsAt), won.months);
      value = (Number(cur.amountPaise) || 0) + won.amountPaise;
    } else if (q.kind === 'renew') {
      startsAt = new Date(cur.startsAt || now);
      endsAt = q.endsAt;
      value = (Number(cur.amountPaise) || 0) + won.amountPaise;
    } else {
      startsAt = now;
      endsAt = q.endsAt;
      value = won.listPaise;
    }
    await Business.updateOne({ _id: biz._id }, {
      $set: {
        subscription: {
          tier,
          cycle: won.cycle,
          startsAt,
          endsAt,
          amountPaise: value,
          paymentId,
          orderId,
          source: 'razorpay',
        },
        plan: 'paid',
        planName: TIER_NAMES[tier],
        planChangedAt: now,
        planNotices: null, // reminders start over for the new end date
      },
    });
    forgetPlan(biz._id);
    const payment = await SubscriptionPayment.findOneAndUpdate(
      { orderId },
      { $set: { startsAt: q?.kind === 'renew' ? q.startsAt : startsAt, endsAt } },
      { new: true },
    ).lean();
    logger.info('plan activated', {
      business: biz.name, tier, cycle: won.cycle, kind: q?.kind || 'extend', amount: won.amountPaise, endsAt: endsAt.toISOString(),
    });
    await notify(biz._id, {
      type: 'plan_changed',
      title: `Your ${TIER_NAMES[tier]} plan is active`,
      body: `Payment of ${rupees(won.amountPaise)} received. ${TIER_NAMES[tier]} runs until ${endsAt.toDateString()}`
        + `${before.status === 'trial' ? ' (your remaining trial days are included)' : ''}.`,
      target: { view: 'profile', id: 'billing' },
    });
    return { payment, activated: true };
  });
}

/**
 * The checkout's success callback. Verifies the signature, then asks
 * Razorpay for the payment (captures it if it was only authorised).
 */
export async function confirmCheckout(biz, { orderId, paymentId, signature } = {}) {
  const pay = await SubscriptionPayment.findOne({ orderId: String(orderId || ''), businessId: biz._id }).lean();
  if (!pay) throw new BillingError('Payment not found.', 404, 'NOT_FOUND');
  if (pay.status === 'paid') return { payment: pay, activated: false };
  if (!verifyCheckoutSignature(orderId, paymentId, signature)) {
    logger.warn('razorpay checkout signature invalid', { business: biz.name, orderId });
    throw new BillingError('The payment couldn\'t be verified.', 400, 'BAD_SIGNATURE');
  }
  let p;
  try {
    p = await fetchPayment(paymentId);
    if (p.status === 'authorized') p = await capturePayment(paymentId, pay.amountPaise);
  } catch (err) {
    logger.error('razorpay payment check failed', { orderId, error: razorpayError(err) });
    throw new BillingError('Your payment is being confirmed. If your plan isn\'t active in a few minutes, contact support.', 502, 'RAZORPAY_FAILED');
  }
  if (p.order_id !== orderId || Number(p.amount) !== Number(pay.amountPaise) || p.status !== 'captured') {
    logger.warn('razorpay payment not usable', { orderId, status: p.status, order: p.order_id, amount: p.amount });
    throw new BillingError('The payment wasn\'t completed.', 402, 'NOT_PAID');
  }
  return activate(orderId, { paymentId, method: p.method || '', amount: Number(p.amount) });
}

/** Record a failed attempt (Razorpay's webhook). Never undoes a paid order. */
export async function markFailed(orderId, reason = '') {
  await SubscriptionPayment.updateOne(
    { orderId, status: 'created' },
    { $set: { status: 'failed', error: String(reason).slice(0, 300) } },
  );
}

/** The admin gives a plan without payment (cash, partner, support). */
export async function grantPlan(id, { tier, until, trialDays } = {}) {
  const found = await Business.findById(id).lean();
  if (!found) return null;
  const now = new Date();
  const set = { plan: 'paid', planChangedAt: now, planNotices: null };
  if (trialDays) {
    const days = Math.min(90, Math.max(1, Math.floor(Number(trialDays))));
    set.subscription = null;
    set.trialEndsAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    set.planName = '';
  } else {
    const t = tierOf(tier);
    if (!t) throw new BillingError('Choose a plan.');
    const end = until ? new Date(until) : null;
    if (!end || Number.isNaN(end.getTime()) || end <= now) throw new BillingError('Choose an end date in the future.');
    set.subscription = {
      tier: t, cycle: '', startsAt: now, endsAt: end, amountPaise: 0, paymentId: '', orderId: '', source: 'admin',
    };
    set.planName = TIER_NAMES[t];
    // After the granted period: Free (not the trial, not the before-plans Premium).
    if (!found.trialEndsAt) set.trialEndsAt = now;
  }
  await Business.updateOne({ _id: found._id }, { $set: set });
  forgetPlan(found._id);
  const biz = await Business.findById(found._id);
  const state = planState(biz, now);
  await notify(biz._id, {
    type: 'plan_changed',
    title: trialDays ? `Your free trial was extended` : `You're now on the ${state.name} plan`,
    body: state.endsAt ? `${trialDays ? 'Trial' : state.name} until ${new Date(state.endsAt).toDateString()}.` : '',
    target: { view: 'profile', id: 'billing' },
  });
  logger.info('plan granted by admin', { business: biz.name, tier: state.tier, status: state.status, endsAt: state.endsAt });
  return biz;
}

export const newRequestKey = () => crypto.randomBytes(8).toString('hex');

export default {
  quote, checkout, confirmCheckout, activate, markFailed, grantPlan, presentQuote, presentPayment, addMonths, BillingError,
};
