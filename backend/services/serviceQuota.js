// ---------------------------------------------------------------------------
// Meta's free tier of service messages, for the profile sidebar.
//
// Since 1 October 2026 Meta charges for service messages (replies inside the
// 24-hour customer service window), except the first 1,000 delivered each
// month per business phone number. The tier resets at the start of every
// month and doesn't roll over.
//
// Two sources, and the card shows the larger:
//   - Meta's own count, from the WhatsApp Business Account's pricing_analytics
//     with the business's token: SERVICE messages, FREE_CUSTOMER_SERVICE
//     (inside the free tier) and REGULAR (charged, after it). It's what Meta
//     bills, but it lags by hours.
//   - Our own count: outbound WhatsApp messages that aren't templates and
//     reached the phone (delivered/read) this month. It moves the moment a
//     receipt arrives, so the card updates live (handleStatus calls
//     noteServiceDelivered, which pushes `crm:service-quota` to the tenant).
//
// The month is counted from midnight India time: every tenant is set up in
// India, and Meta resets the tier at midnight in the account's time zone.
// Meta's answer is kept for a few minutes so opening the sidebar doesn't call
// Meta every time; ?refresh=1 asks again (throttled). Nothing is written to Meta.
// ---------------------------------------------------------------------------
import axios from 'axios';
import { isWhatsAppConnected } from './sandbox.js';
import { query } from '../db/pool.js';
import { emitServiceQuota, roomSize } from './eventBus.js';
import logger from './logger.js';

export const FREE_SERVICE_PER_MONTH = 1000;
const IST_MS = 5.5 * 3600 * 1000;
const TTL_MS = 10 * 60 * 1000;
const REFRESH_EVERY_MS = 30 * 1000;
// Receipts come in bursts (a reply with three messages, a read of a whole
// chat): one push per business per this long.
const PUSH_DEBOUNCE_MS = 1500;

const cache = new Map(); // businessId -> { at, data } (Meta's answer)
const lastAttempt = new Map();
const inFlight = new Map();
// businessId -> { monthStart, count, at }: our own count, bumped per receipt.
const live = new Map();
const counting = new Map();
const pushTimers = new Map();

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

/**
 * Meta's figures and ours, as the card shows them: the larger count wins
 * (Meta's lags; ours can miss a message sent from another app). Past the free
 * tier, everything beyond it is charged.
 */
export function combine(meta, ownCount, limit = FREE_SERVICE_PER_MONTH) {
  const metaUsed = Number(meta?.used) || 0;
  const used = Math.max(metaUsed, Number(ownCount) || 0);
  const charged = Math.max(Number(meta?.charged) || 0, used - limit);
  return {
    used,
    free: Math.max(0, used - charged),
    charged,
    remaining: Math.max(0, limit - used),
    metaUsed,
  };
}

/** Our own count of this month's delivered service messages. */
async function dbServiceCount(businessId, monthStart) {
  const { rows } = await query(
    `SELECT count(*)::int AS n FROM messages
      WHERE business_id = $1 AND direction = 'out' AND created_at >= $2
        AND status IN ('delivered', 'read') AND type <> 'template'
        AND coalesce(channel, '') = '' AND coalesce(raw->>'sandbox', '') <> 'true'`,
    [String(businessId), new Date(monthStart)],
  );
  return rows[0]?.n || 0;
}

/** Our count for this month: counted from the table, then kept up per receipt. */
async function ownCount(id, { refresh = false } = {}) {
  const { start } = monthWindow();
  const hit = live.get(id);
  if (hit && hit.monthStart === start && !refresh && Date.now() - hit.at < TTL_MS) return hit.count;
  if (counting.has(id)) return counting.get(id);
  const run = dbServiceCount(id, start)
    .then((count) => {
      live.set(id, { monthStart: start, count, at: Date.now() });
      return count;
    })
    .catch((err) => {
      logger.warn('service count read failed', { businessId: id, error: err.message });
      return hit && hit.monthStart === start ? hit.count : 0;
    })
    .finally(() => counting.delete(id));
  counting.set(id, run);
  return run;
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
    ...sums,
    monthStart: new Date(start).toISOString(),
    resetsAt: new Date(next).toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/** Meta's figures (cached), or null when Meta hasn't answered yet. */
async function metaQuota(biz, refresh) {
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
      // The last good answer beats nothing (unless it's from last month).
      if (hit && new Date(hit.data.resetsAt).getTime() > Date.now()) return { ...hit.data, stale: true };
      return null;
    })
    .finally(() => inFlight.delete(id));
  inFlight.set(id, run);
  return run;
}

/** The card's payload from Meta's figures (may be null) and our count. */
function payload(meta, count) {
  const { start, next } = monthWindow();
  return {
    connected: true,
    limit: FREE_SERVICE_PER_MONTH,
    ...combine(meta, count),
    monthStart: new Date(start).toISOString(),
    resetsAt: new Date(next).toISOString(),
    // When Meta last answered; our own count is always current.
    metaUpdatedAt: meta?.updatedAt || null,
    updatedAt: new Date().toISOString(),
    ...(meta && !meta.stale ? {} : { metaUnavailable: true }),
  };
}

/**
 * This month's free service messages for the business's own number.
 * { connected:false } for a business without one (the shared test number).
 */
export async function getServiceQuota(biz, { refresh = false } = {}) {
  if (!isWhatsAppConnected(biz) || !biz.wabaId) return { connected: false, limit: FREE_SERVICE_PER_MONTH };
  const id = String(biz._id);
  const [meta, count] = await Promise.all([metaQuota(biz, refresh), ownCount(id, { refresh })]);
  return payload(meta, count);
}

/**
 * A service message of this business just reached the phone for the first
 * time (handleStatus). Bumps our count and, shortly after, pushes the new
 * figures to the business's open CRM tabs. Nobody watching: nothing is read.
 */
export function noteServiceDelivered(businessId) {
  const id = businessId ? String(businessId) : '';
  if (!id) return;
  const { start } = monthWindow();
  const hit = live.get(id);
  if (hit && hit.monthStart === start) hit.count += 1;
  if (pushTimers.has(id)) return;
  pushTimers.set(id, setTimeout(() => {
    pushTimers.delete(id);
    pushServiceQuota(id).catch((err) => logger.debug('service quota push failed', { businessId: id, error: err.message }));
  }, PUSH_DEBOUNCE_MS));
}

async function pushServiceQuota(id) {
  if (!roomSize(id)) return;
  // Counted from the table if this is the first we've heard of the business
  // (or a new month); otherwise the bumped figure, no query.
  const count = await ownCount(id);
  const meta = cache.get(id)?.data || null;
  const fresh = meta && new Date(meta.resetsAt).getTime() > Date.now() ? meta : null;
  emitServiceQuota(id, { ...payload(fresh, count), businessId: id });
}

export default { getServiceQuota, noteServiceDelivered, sumService, combine, monthWindow, FREE_SERVICE_PER_MONTH };
