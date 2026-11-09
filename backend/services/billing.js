// ---------------------------------------------------------------------------
// Settings → Billing: the plan in force (services/plans.js), what the plan's
// limits are and how much of them is used, the number's messaging tier, the
// billing contact, and the plan payments made through Razorpay
// (services/subscriptions.js).
// ---------------------------------------------------------------------------
import Template from '../models/Template.js';
import SubscriptionPayment from '../models/SubscriptionPayment.js';
import { isWhatsAppConnected, sandboxConfig, sandboxContacts } from './sandbox.js';
import { getNumberStatus } from './metaAccount.js';
import { planState } from './plans.js';
import { contactAllowance, campaignsThisMonth, campaignsInTrial } from './planGate.js';
import { presentPayment } from './subscriptions.js';
import { razorpayConfigured } from './razorpay.js';

/** The billing contact address: the profile address, else the seller address. */
function addressOf(biz) {
  if (String(biz.address || '').trim()) return String(biz.address).trim();
  const p = biz.payment || {};
  return [p.addressLine1, p.addressLine2, p.city, p.zoneCode, p.postalCode]
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .join(', ');
}

/** The number's messaging tier (Channel Status), or the shared number's contact limit. */
async function messagingOf(biz) {
  if (!isWhatsAppConnected(biz)) {
    return {
      connected: false,
      sandbox: sandboxConfig().configured ? await sandboxContacts(biz._id) : null,
    };
  }
  const s = await getNumberStatus(biz).catch((e) => ({ error: e.message }));
  return {
    connected: true,
    displayPhoneNumber: s?.number?.displayPhoneNumber || biz.meta?.displayPhoneNumber || '',
    status: s?.number?.status || '',
    qualityRating: s?.number?.qualityRating || '',
    throughputLevel: s?.number?.throughputLevel || '',
    limit: s?.limit || null,
    fetchedAt: s?.fetchedAt || null,
    stale: !!s?.stale,
    error: s?.error || '',
  };
}

/** How much of each limited thing the business uses, next to its plan's limit (null = unlimited). */
export async function usageOf(biz, state = planState(biz)) {
  const L = state.limits;
  // On the free trial the campaign cap covers the whole trial, not a month.
  const trial = state.status === 'trial' && !!L.trialCampaigns;
  const [contacts, templates, campaigns] = await Promise.all([
    contactAllowance(biz._id, state),
    Template.countDocuments({ businessId: biz._id }),
    trial ? campaignsInTrial(biz._id) : campaignsThisMonth(biz._id),
  ]);
  return {
    contacts: { used: contacts.limit ? contacts.total : null, limit: L.contacts },
    templates: { used: templates, limit: L.templates },
    campaigns: { used: campaigns, limit: trial ? L.trialCampaigns : L.campaignsPerMonth, period: trial ? 'trial' : 'month' },
  };
}

/** Everything the Billing page shows. No secrets. */
export async function billingSummary(biz) {
  const state = planState(biz);
  const [messaging, usage, rows] = await Promise.all([
    messagingOf(biz),
    usageOf(biz, state),
    SubscriptionPayment.find({ businessId: biz._id, status: 'paid' }).sort({ paidAt: -1 }).limit(24).lean(),
  ]);
  return {
    plan: { ...state, customerSince: biz.createdAt || null },
    usage,
    messaging,
    contact: {
      name: biz.name || '',
      email: biz.email || '',
      phone: biz.ownerPhone || '',
      address: addressOf(biz),
    },
    payments: rows.map(presentPayment),
    paymentsEnabled: razorpayConfigured(),
  };
}

export default { billingSummary, usageOf };
