// ---------------------------------------------------------------------------
// Meta's free tier of service messages, for the profile sidebar.
//
// Since 1 October 2026 Meta charges for service messages (replies inside the
// 24-hour customer service window), except the first 1,000 delivered each
// month per business phone number. The tier resets at the start of every
// month and doesn't roll over. Meta's numbers are the truth here, so this
// reads them from the WhatsApp Business Account's pricing_analytics with the
// business's own token: SERVICE messages, FREE_CUSTOMER_SERVICE (inside the
// free tier) and REGULAR (charged, after it). Nothing is written to Meta.
//
// The month is counted from midnight India time: every tenant is set up in
// India, and Meta resets the tier at midnight in the account's time zone.
// Answers are kept for a few minutes so opening the sidebar doesn't call Meta
// every time; ?refresh=1 asks again (throttled).
// ---------------------------------------------------------------------------
import axios from 'axios';
import { isWhatsAppConnected } from './sandbox.js';
import logger from './logger.js';

export const FREE_SERVICE_PER_MONTH = 1000;
const IST_MS = 5.5 * 3600 * 1000;
const TTL_MS = 10 * 60 * 1000;
const REFRESH_EVERY_MS = 30 * 1000;

const cache = new Map(); // businessId -> { at, data }
const lastAttempt = new Map();
const inFlight = new Map();

/** Midnight India time on the 1st of this month, and of the next. */
export function monthWindow(now = Date.now()) {
  const ist = new Date(now + IST_MS);
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth();
  return { start: Date.UTC(y, m, 1) - IST_MS, next: Date.UTC(y, m + 1, 1) - IST_MS };
}

/**
 * Add up Meta's data points: SERVICE messages for this business's number.
 * @param {object[]} points pricing_analytics data_points
 * @param {string} phoneDigits the business number, digits only ('' = all numbers)
 */
export function sumService(points, phoneDigits = '') {
  let free = 0;
  let charged = 0;
  for (const p of points || []) {
    if (String(p.pricing_category || '').toUpperCase() !== 'SERVICE') continue;
    if (phoneDigits && p.phone_number && String(p.phone_number).replace(/\D/g, '') !== phoneDigits) continue;
    const n = Number(p.volume) || 0;
    if (String(p.pricing_type || '').toUpperCase() === 'REGULAR') charged += n;
    else free += n;
  }
  const used = free + charged;
  return {
    used,
    // What Meta counted as free, and what it charged once the tier was used.
    free,
    charged,
    remaining: Math.max(0, FREE_SERVICE_PER_MONTH - used),
  };
}

async function fetchQuota(biz) {
  const { start, next } = monthWindow();
  const version = biz.graphVersion || process.env.WA_GRAPH_VERSION || 'v22.0';
  const fields = `pricing_analytics.start(${Math.floor(start / 1000)}).end(${Math.floor(Date.now() / 1000)})`
    + '.granularity(DAILY).dimensions(PRICING_CATEGORY,PRICING_TYPE,PHONE)';
  const { data } = await axios.get(`https://graph.facebook.com/${version}/${encodeURIComponent(biz.wabaId)}`, {
    params: { fields },
    headers: { Authorization: `Bearer ${biz.accessToken}` },
    timeout: 15000,
  });
  const points = (data?.pricing_analytics?.data || []).flatMap((d) => d?.data_points || []);
  const phone = String(biz.meta?.displayPhoneNumber || biz.whatsappNumber || '').replace(/\D/g, '');
  // A number the WABA reports under another format still counts: fall back to
  // every number when nothing matched this one.
  let sums = sumService(points, phone);
  if (phone && !sums.used && points.some((p) => String(p.pricing_category || '').toUpperCase() === 'SERVICE')) {
    sums = sumService(points, '');
  }
  return {
    connected: true,
    limit: FREE_SERVICE_PER_MONTH,
    ...sums,
    monthStart: new Date(start).toISOString(),
    resetsAt: new Date(next).toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * This month's free service messages for the business's own number.
 * { connected:false } for a business without one (the shared test number).
 */
export async function getServiceQuota(biz, { refresh = false } = {}) {
  if (!isWhatsAppConnected(biz) || !biz.wabaId) return { connected: false, limit: FREE_SERVICE_PER_MONTH };
  const id = String(biz._id);
  const hit = cache.get(id);
  const fresh = hit && Date.now() - hit.at < TTL_MS && new Date(hit.data.resetsAt).getTime() > Date.now();
  const throttled = Date.now() - (lastAttempt.get(id) || 0) < REFRESH_EVERY_MS;
  if (hit && (fresh && !refresh || throttled)) return hit.data;
  if (inFlight.has(id)) return inFlight.get(id);
  lastAttempt.set(id, Date.now());
  const run = fetchQuota(biz)
    .then((data) => {
      cache.set(id, { at: Date.now(), data });
      return data;
    })
    .catch((err) => {
      const message = err?.response?.data?.error?.message || err?.message || 'Meta request failed';
      logger.warn('service quota read failed', { business: biz.name, error: message });
      // The last good answer beats an error; without one, say why.
      if (hit) return { ...hit.data, stale: true };
      return { connected: true, limit: FREE_SERVICE_PER_MONTH, error: 'Meta didn’t return the message count right now. Try again in a minute.' };
    })
    .finally(() => inFlight.delete(id));
  inFlight.set(id, run);
  return run;
}

export default { getServiceQuota, sumService, monthWindow, FREE_SERVICE_PER_MONTH };
