// ---------------------------------------------------------------------------
// Live status of a business's own WhatsApp number (Channel Status page,
// Campaigns overview)
//
// Reads the phone number and its WABA from Graph with the business's own
// token, and keeps the answer in memory for a few minutes so opening pages
// doesn't call Meta every time. This is the one place that reads the
// messaging-limit tier and quality rating from Meta. Nothing is written to
// Meta. The Business row's `meta.numberStatus` snapshot is only kept in step
// once something has stored one (Embedded Signup, "Activate number"): when
// Meta's status moves on, the snapshot follows, and a move to CONNECTED
// creates the "WhatsApp number connected" notification.
//
// A business without its own number (including one on the shared test
// number, whose credentials never touch Business) gets { connected:false }
// and Meta is never called.
// ---------------------------------------------------------------------------
import axios from 'axios';
import Business from '../models/Business.js';
import { isWhatsAppConnected } from './sandbox.js';
import { tierInfo, pickTier } from './messagingTier.js';
import { notify } from './notifications.js';
import logger from './logger.js';

const TTL_MS = 5 * 60 * 1000; // how long an answer is reused
const REFRESH_EVERY_MS = 30 * 1000; // ?refresh=1 at most this often per business
const TIMEOUT_MS = 15000;

const NUMBER_FIELDS = [
  'display_phone_number', 'verified_name', 'status', 'quality_rating',
  // Both limit fields: the old one is deprecated (not returned on v21–v23)
  // but asking for it is harmless, and pickTier prefers the new one.
  'messaging_limit_tier', 'whatsapp_business_manager_messaging_limit',
  'throughput', 'name_status', 'new_name_status', 'code_verification_status',
  'account_mode', 'platform_type', 'is_official_business_account', 'health_status',
].join(',');
const WABA_FIELDS = 'name,account_review_status,business_verification_status';

// businessId -> { phoneNumberId, at, data } (last good answer)
const cache = new Map();
// businessId -> ms of the last Graph attempt, for the refresh throttle
const lastAttempt = new Map();
// businessId -> Promise, so concurrent page loads share one Graph round trip
const inFlight = new Map();

const graphBase = (biz) => `https://graph.facebook.com/${biz.graphVersion || process.env.WA_GRAPH_VERSION || 'v22.0'}`;
const metaMessage = (err) => err?.response?.data?.error?.message || err?.message || 'Meta request failed';

async function graphGet(biz, id, fields) {
  const { data } = await axios.get(`${graphBase(biz)}/${encodeURIComponent(id)}`, {
    params: { fields },
    headers: { Authorization: `Bearer ${biz.accessToken}` },
    timeout: TIMEOUT_MS,
  });
  return data || {};
}

/**
 * Meta's health_status, kept to what affects messaging: the overall
 * can_send_message plus the errors of every entity that can't send freely
 * (e.g. WABA 141006, payment method). Calling/SIP notes on entities that can
 * still send are left out.
 */
function mapHealth(h) {
  if (!h || typeof h !== 'object') return null;
  const toError = (entity) => (e) => ({
    entity,
    code: e?.error_code ?? null,
    description: e?.error_description || '',
    solution: e?.possible_solution || '',
  });
  const errors = (h.errors || []).map(toError(''));
  for (const en of h.entities || []) {
    if (en?.can_send_message && en.can_send_message !== 'AVAILABLE') {
      errors.push(...(en.errors || []).map(toError(en.entity_type || '')));
    }
  }
  return { canSendMessage: h.can_send_message || '', errors };
}

function mapNumber(biz, d) {
  return {
    phoneNumberId: String(biz.phoneNumberId),
    displayPhoneNumber: d.display_phone_number || '',
    verifiedName: d.verified_name || '',
    status: d.status || '',
    qualityRating: String(d.quality_rating || 'UNKNOWN').toUpperCase(),
    nameStatus: d.name_status || '',
    newNameStatus: d.new_name_status || '',
    codeVerificationStatus: d.code_verification_status || '',
    accountMode: d.account_mode || '',
    platformType: d.platform_type || '',
    isOfficialBusinessAccount: !!d.is_official_business_account,
    throughputLevel: d.throughput?.level || '',
    health: mapHealth(d.health_status),
  };
}

async function fetchStatus(biz) {
  const [num, waba] = await Promise.allSettled([
    graphGet(biz, biz.phoneNumberId, NUMBER_FIELDS),
    biz.wabaId ? graphGet(biz, biz.wabaId, WABA_FIELDS) : Promise.resolve(null),
  ]);
  if (num.status === 'rejected') throw num.reason;
  if (waba.status === 'rejected') {
    // An own-app token may not be allowed to read the WABA; the number
    // fields are still worth showing.
    logger.warn('channel status: WABA read failed', { business: biz.name, error: metaMessage(waba.reason) });
  }
  const w = waba.status === 'fulfilled' ? waba.value : null;
  return {
    connected: true,
    fetchedAt: new Date().toISOString(),
    number: mapNumber(biz, num.value),
    limit: tierInfo(pickTier(num.value)),
    waba: w
      ? {
        id: String(w.id || biz.wabaId),
        name: w.name || '',
        accountReviewStatus: w.account_review_status || '',
        businessVerificationStatus: w.business_verification_status || '',
      }
      : null,
  };
}

const up = (s) => String(s || '').trim().toUpperCase();

// Statuses that mean "not registered with Cloud API yet": POST /register is
// what moves them to CONNECTED. FLAGGED / RESTRICTED / BANNED are Meta
// enforcement states that registering doesn't fix, so they get no button.
const ACTIVATABLE = new Set(['PENDING', 'DISCONNECTED', 'UNVERIFIED', 'NOT_REGISTERED']);

/** Does this number (a mapped `number` from fetchStatus) need "Activate number"? */
export function needsActivation(number) {
  if (!number) return false;
  const s = up(number.status);
  if (s === 'CONNECTED') return false;
  if (ACTIVATABLE.has(s)) return true;
  // No status at all, and not hosted anywhere: not registered either.
  return !s && up(number.platformType) === 'NOT_APPLICABLE';
}

/** The per-business part of an answer (whether a PIN is stored, never the PIN). */
function withActivation(biz, data) {
  if (!data?.number) return data;
  return {
    ...data,
    activation: {
      needed: needsActivation(data.number),
      hasSavedPin: !!biz.waConnection?.pin,
      pinSetAt: biz.waConnection?.pinSetAt || null,
    },
  };
}

// Status writes for one business run one after another, so a page load and an
// activation finishing together can't both see "PENDING" and notify twice.
const statusChains = new Map();
function serialize(key, fn) {
  const prev = statusChains.get(key) || Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.catch(() => {});
  statusChains.set(key, tail);
  tail.then(() => {
    if (statusChains.get(key) === tail) statusChains.delete(key);
  });
  return run;
}

/**
 * Store the number's Meta status on the Business row (`meta.numberStatus`),
 * plus any other `meta.*` keys in `extra`. A move to CONNECTED from anything
 * else creates the "WhatsApp number connected" notification.
 * @returns {Promise<{changed:boolean, prev:string, status:string}>}
 */
export function recordNumberStatus(bizId, status, extra = {}) {
  const id = String(bizId || '');
  const s = up(status);
  if (!id || !s) return Promise.resolve({ changed: false, prev: '', status: s });
  return serialize(id, async () => {
    const row = await Business.findById(id).lean();
    if (!row) return { changed: false, prev: '', status: s };
    const prev = up(row.meta?.numberStatus);
    const $set = {};
    for (const [k, v] of Object.entries(extra || {})) $set[`meta.${k}`] = v;
    if (prev !== s) {
      $set['meta.numberStatus'] = s;
      $set['meta.numberStatusAt'] = new Date();
    }
    if (!Object.keys($set).length) return { changed: false, prev, status: s };
    await Business.updateOne({ _id: id }, { $set });
    if (s === 'CONNECTED' && prev !== 'CONNECTED') {
      const number = extra.displayPhoneNumber || row.meta?.displayPhoneNumber || '';
      notify(id, {
        type: 'whatsapp_connected',
        title: 'WhatsApp number connected',
        body: number
          ? `${number} is connected to the WhatsApp Cloud API and can send and receive messages.`
          : 'Your WhatsApp number is connected to the WhatsApp Cloud API and can send and receive messages.',
        target: { view: 'channel-status' },
      }).catch(() => {});
    }
    return { changed: prev !== s, prev, status: s };
  });
}

/**
 * Keep a stored snapshot in step with what Meta just said. Only rows that
 * already hold one are written (a business that never stored a status keeps
 * its row as it is).
 */
function syncStoredStatus(biz, data) {
  const stored = up(biz.meta?.numberStatus);
  const live = up(data?.number?.status);
  if (!stored || !live || stored === live) return;
  biz.meta = { ...(biz.meta || {}), numberStatus: live };
  recordNumberStatus(biz._id, live).catch((e) => logger.warn('could not store the number status', { business: biz.name, error: e.message }));
}

/**
 * The live status of this business's number:
 *   { connected:false }  — no number of its own, Meta not called
 *   { connected:true, fetchedAt, cached, stale, error, number, limit, waba, activation }
 * Answers are reused for 5 minutes. `refresh` skips the cache, but at most
 * once per 30 s per business; `force` (server-side only, e.g. polling after
 * an activation) always asks Meta. When Meta fails, the last good answer
 * comes back with stale:true and Meta's message in `error`; with none, the
 * number fields are null.
 */
export async function getNumberStatus(biz, { refresh = false, force = false } = {}) {
  if (!biz || !isWhatsAppConnected(biz)) return { connected: false };
  const id = String(biz._id);
  const phoneNumberId = String(biz.phoneNumberId);

  let hit = cache.get(id);
  if (hit && hit.phoneNumberId !== phoneNumberId) { // the number changed
    cache.delete(id);
    hit = null;
  }
  const now = Date.now();
  const fresh = hit && now - hit.at < TTL_MS;
  const mayRefresh = now - (lastAttempt.get(id) || 0) >= REFRESH_EVERY_MS;
  if (hit && !force && (refresh ? !mayRefresh : fresh)) {
    syncStoredStatus(biz, hit.data);
    return withActivation(biz, { ...hit.data, cached: true, stale: false, error: '' });
  }

  let p = inFlight.get(id);
  if (!p) {
    lastAttempt.set(id, now);
    p = fetchStatus(biz).finally(() => inFlight.delete(id));
    inFlight.set(id, p);
  }
  try {
    const data = await p;
    cache.set(id, { phoneNumberId, at: Date.now(), data });
    syncStoredStatus(biz, data);
    return withActivation(biz, { ...data, cached: false, stale: false, error: '' });
  } catch (err) {
    const error = metaMessage(err);
    logger.warn('channel status: Meta read failed', { business: biz.name, error });
    if (hit) return withActivation(biz, { ...hit.data, cached: true, stale: true, error });
    return { connected: true, fetchedAt: null, cached: false, stale: false, error, number: null, limit: null, waba: null };
  }
}

/** Forget a business's cached status (e.g. after it reconnects). */
export function clearNumberStatus(bizId) {
  const id = String(bizId || '');
  cache.delete(id);
  lastAttempt.delete(id);
}

export default { getNumberStatus, clearNumberStatus, needsActivation, recordNumberStatus };
