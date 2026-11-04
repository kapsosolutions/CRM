// ---------------------------------------------------------------------------
// Meta's daily messaging limit, for the sidebar bar and the Campaigns page.
//
// The limit (Meta's tier: 250, 2,000, 10,000 …) is how many unique customers
// the business can reach with messages outside their 24-hour customer service
// window, in a moving 24 hours (campaignStats.limitUsage counts those).
//
// Any template that goes out (campaign, chat, journey, trigger) may use it
// up, so logOutbound calls noteLimitActivity; a failed one gives it back
// (handleStatus). Either way, shortly after, the figures are pushed to the
// business's open CRM tabs as `crm:messaging-limit`. The tabs also read again
// every minute or so: customers drop out of the 24 hours on their own.
//
// Imported by metaCloud.js, so the heavier services are loaded on first use
// (they import metaCloud themselves).
// ---------------------------------------------------------------------------
import Business from '../models/Business.js';
import { emitMessagingLimit, roomSize } from './eventBus.js';
import logger from './logger.js';

const PUSH_DEBOUNCE_MS = 1500;
const pushTimers = new Map();

const connectedNumber = (biz) => !!(biz?.accessToken && biz?.phoneNumberId);

/**
 * { connected, limit: { tier, limit, label, unlimited } | null, used24h,
 *   messages24h, nextFreeAt, metaError, stale, fetchedAt, updatedAt }
 */
export async function getMessagingLimit(biz, { refresh = false } = {}) {
  if (!connectedNumber(biz)) return { connected: false, limit: null, used24h: 0, messages24h: 0, nextFreeAt: null };
  const [{ getNumberStatus }, { limitUsage }] = await Promise.all([
    import('./metaAccount.js'),
    import('./campaignStats.js'),
  ]);
  const [status, usage] = await Promise.all([
    getNumberStatus(biz, { refresh }).catch((err) => ({ error: err.message, limit: null })),
    limitUsage(biz._id),
  ]);
  return {
    connected: true,
    limit: status?.limit || null,
    ...usage,
    metaError: status?.error || '',
    stale: !!status?.stale,
    fetchedAt: status?.fetchedAt || null,
    updatedAt: new Date().toISOString(),
  };
}

/** A template went out (or failed) for this business: push new figures soon. */
export function noteLimitActivity(businessId) {
  const id = businessId ? String(businessId) : '';
  if (!id || pushTimers.has(id)) return;
  pushTimers.set(id, setTimeout(() => {
    pushTimers.delete(id);
    pushLimit(id).catch((err) => logger.debug('messaging limit push failed', { businessId: id, error: err.message }));
  }, PUSH_DEBOUNCE_MS));
}

async function pushLimit(id) {
  // Nobody has the CRM open: nothing to read.
  if (!roomSize(id)) return;
  const biz = await Business.findById(id).lean();
  if (!biz) return;
  const data = await getMessagingLimit(biz);
  emitMessagingLimit(id, { ...data, businessId: id });
}

export default { getMessagingLimit, noteLimitActivity };
