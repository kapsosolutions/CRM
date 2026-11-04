// ---------------------------------------------------------------------------
// Ads Manager S4: audiences (Ads page → Audiences).
//
//   • Customer-list custom audiences from the CRM's WhatsApp contacts
//     (Conversation rows): all contacts, contacted in the last N days, or
//     inbound in the last N days. Messenger / Instagram rows are left out
//     (their `phone` is a PSID / IGSID), and so is anything that isn't a
//     plausible E.164 number (8–15 digits) or doesn't start with a valid
//     country calling code (counted as "no country code"; no country is
//     guessed).
//   • Every number is normalised here (digits with the country code, no
//     leading zeros or +) and hashed with SHA-256 (lowercase hex). Raw numbers
//     never leave this process and are never logged; logs carry counts only.
//   • Upload: POST act_/customaudiences (subtype CUSTOM, customer_file_source
//     USER_PROVIDED_ONLY), then POST /{audience}/users with the single-key
//     payload { schema: 'PHONE_SHA256', data: ['<hash>', …] } (a flat list:
//     the /{id}/users and /{id}/usersreplace references, v25, keep the
//     two-dimensional form for multi-key array schemas) in batches of at most
//     10,000, all batches in one Meta session (session_id / batch_seq /
//     last_batch_flag / estimated_num_total). Refreshing an audience uses
//     /{audience}/usersreplace (same payload and batching), and falls back to
//     adding when Meta says replace isn't available for it.
//   • Uploads run in the background (an AdAudienceJob row the browser polls),
//     so a large upload never holds an HTTP request. The request only checks
//     that a contact exists and creates the audience; the job reads the
//     contacts (paged by _id), keeps the normalised numbers (not hashes) and
//     hashes one batch at a time, yielding to the event loop in between. At
//     most ADS_AUDIENCE_CONCURRENCY (2) uploads run in the process; the rest
//     wait as `queued`. One upload per business; its slot is taken before the
//     request's first await. A long upload ends with an `ad_audience_ready`
//     notification. Job errors hold a code and a CRM-written message, never
//     Meta's text. Jobs live in this process (one backend process): a job
//     this process doesn't run, whose heartbeat (every 30 s) is older than 3
//     minutes, is shown as "interrupted" and the business runs Refresh again.
//     Jobs older than 90 days are pruned (the latest per audience is kept).
//   • Lookalikes: subtype LOOKALIKE, origin_audience_id, lookalike_spec
//     { ratio 0.01–0.10, country | location_spec.geo_locations.countries }.
//   • Saved audiences: Meta's are read (GET act_/saved_audiences); the
//     Marketing API can't create them, so audiences saved from the CRM are an
//     AdSavedAudience row (a starting point for the wizard / ad set editor).
//   • The Custom Audience terms: act_?fields=tos_accepted
//     (custom_audience_tos = 1). Not accepted → 409 TERMS_NOT_ACCEPTED with
//     the link to accept them at Meta.
//   • assertAudiences(): custom / lookalike audience ids used in targeting
//     (S1 wizard, S2 ad set editor) must belong to the connected ad account.
//
// Writes need ads_management (409 READ_ONLY after a fresh permission check).
// Every audience id from the browser is read back and must be in the
// connected ad account (404 NOT_IN_ACCOUNT). Errors 190 / rate limits through
// withAdsToken / mapMetaError; every call carries appsecret_proof.
// ---------------------------------------------------------------------------
import crypto from 'crypto';
import Conversation from '../models/Conversation.js';
import AdAudienceJob from '../models/AdAudienceJob.js';
import AdSavedAudience from '../models/AdSavedAudience.js';
import {
  AdsError, requireAdsRow, requireAdsWriter, withAdsToken, refreshPermissions, clearCache, auth, proof, http, G, isId, actNumber, graphGet, graphList,
} from './metaAds.js';
import { notify } from './notifications.js';
import logger from './logger.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH_MAX = 10000; // Meta: at most 10,000 people per request
export const SCHEMA = 'PHONE_SHA256';
export const FILTERS = ['all', 'contacted', 'inbound'];
const SAVED_LIMIT = 100;
const SAVED_MAX_BYTES = 100 * 1024;
const NAME_MAX = 400;
// Meta closes a replace session 90 minutes after its first batch.
const REPLACE_WINDOW_MS = 85 * 60 * 1000;
const RETRIES = 4;

const envNum = (k, d, min = 0) => {
  const n = Number(process.env[k]);
  return Number.isFinite(n) && n >= min ? n : d;
};
const batchSize = () => Math.min(BATCH_MAX, Math.max(1, Math.floor(envNum('ADS_AUDIENCE_BATCH', BATCH_MAX, 1))));
const maxContacts = () => Math.max(1, Math.floor(envNum('ADS_AUDIENCE_MAX_CONTACTS', 300000, 1)));
const readPage = () => Math.max(1, Math.floor(envNum('ADS_AUDIENCE_READ_PAGE', 5000, 1)));
const retryMs = () => envNum('ADS_AUDIENCE_RETRY_MS', 60000);
const longMs = () => envNum('ADS_AUDIENCE_LONG_MS', 30000);
const concurrency = () => Math.max(1, Math.floor(envNum('ADS_AUDIENCE_CONCURRENCY', 2, 1)));
const HEARTBEAT_MS = () => envNum('ADS_AUDIENCE_HEARTBEAT_MS', 30000, 1);
const STALE_MS = 3 * 60 * 1000;
const HASH_SLICE = 2000; // digests hashed between two event-loop yields
const JOB_KEEP_DAYS = 90;
const yieldNow = () => new Promise((r) => setImmediate(r));
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const termsUrl = (act) => `https://business.facebook.com/ads/manage/customaudiences/tos/?act=${actNumber(act)}`;

// --------------------------------------------------------------- errors --

class FieldError extends AdsError {
  constructor(field, message) {
    super(message, { status: 400, code: 'INVALID_INPUT' });
    this.field = field;
  }

  toJSON() {
    return { ...super.toJSON(), field: this.field };
  }
}
const bad = (field, message) => new FieldError(field, message);

/** The ad account hasn't accepted Meta's Custom Audience terms. */
class TermsError extends AdsError {
  constructor(row, meta = null) {
    super('Meta needs someone from your business to accept the Custom Audience terms for this ad account before the CRM can upload contacts. Accept them at Meta, then try again.', {
      status: 409, code: 'TERMS_NOT_ACCEPTED', meta,
    });
    this.termsUrl = termsUrl(row.adAccountId);
  }

  toJSON() {
    return { ...super.toJSON(), termsUrl: this.termsUrl };
  }
}

const READ_ONLY_TEXT = 'The CRM can only read this ad account. To create or change audiences here, reconnect and allow managing ads (ads_management).';
const NOT_IN_ACCOUNT = () => new AdsError('That audience isn’t part of your connected ad account.', { status: 404, code: 'NOT_IN_ACCOUNT' });

// ----------------------------------------------------------- validation --

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
function text(v, max, field, label, { required = false } = {}) {
  if (v !== undefined && v !== null && typeof v !== 'string') throw bad(field, `${label} must be text.`);
  const s = String(v ?? '').replace(CONTROL, '').trim();
  if (required && !s) throw bad(field, `${label} is required.`);
  if (s.length > max) throw bad(field, `${label} can be at most ${max} characters.`);
  return s;
}
function oneOf(v, list, field, label) {
  const s = String(v ?? '');
  if (!list.includes(s)) throw bad(field, `${label}: pick one of the options.`);
  return s;
}
function intIn(v, min, max, field, label) {
  const n = typeof v === 'string' && v.trim() === '' ? NaN : Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(field, `${label} must be a whole number from ${min} to ${max}.`);
  return n;
}

/** { filter: all | contacted | inbound, days (1–365, not for all) } */
export function selectionOf(raw) {
  const r = obj(raw);
  const filter = r.filter === undefined || r.filter === '' ? 'all' : oneOf(r.filter, FILTERS, 'filter', 'Contacts');
  const days = filter === 'all' ? 0 : intIn(r.days, 1, 365, 'days', 'Number of days');
  return { filter, days };
}

// ------------------------------------------------------------ hashing --

// Country calling codes (ITU E.164) → the national number's length [min, max]
// after the code. Codes are prefix-free, so a number matches at most one.
const CC_LENGTHS = {
  1: [10, 10], 7: [10, 10],
  20: [9, 10], 27: [9, 9], 30: [10, 10], 31: [9, 9], 32: [8, 9], 33: [9, 9], 34: [9, 9], 36: [8, 9], 39: [6, 11], 40: [9, 9], 41: [9, 9], 43: [4, 13],
  44: [9, 10], 45: [8, 8], 46: [7, 9], 47: [8, 8], 48: [9, 9], 49: [6, 13], 51: [8, 9], 52: [10, 10], 53: [8, 8], 54: [10, 11], 55: [10, 11], 56: [9, 9],
  57: [10, 10], 58: [10, 10], 60: [8, 10], 61: [9, 9], 62: [9, 12], 63: [9, 10], 64: [8, 10], 65: [8, 8], 66: [8, 9], 81: [9, 10], 82: [8, 10], 84: [9, 10],
  86: [10, 11], 90: [10, 10], 91: [10, 10], 92: [9, 10], 93: [9, 9], 94: [9, 9], 95: [7, 10], 98: [10, 10],
  212: [9, 9], 213: [9, 9], 216: [8, 8], 218: [9, 9], 233: [9, 9], 234: [8, 10], 251: [9, 9], 254: [9, 9], 255: [9, 9], 256: [9, 9], 260: [9, 9], 263: [9, 9],
  351: [9, 9], 353: [7, 9], 358: [6, 10], 375: [9, 9], 380: [9, 9], 850: [8, 10], 852: [8, 8], 853: [8, 8], 855: [8, 9], 856: [8, 10], 880: [8, 10], 886: [9, 9],
  960: [7, 7], 961: [7, 8], 962: [9, 9], 963: [9, 9], 964: [10, 10], 965: [8, 8], 966: [8, 9], 967: [9, 9], 968: [8, 8], 970: [9, 9], 971: [8, 9], 972: [8, 9],
  973: [8, 8], 974: [8, 8], 975: [8, 8], 976: [8, 8], 977: [7, 10], 992: [9, 9], 993: [8, 8], 994: [9, 9], 995: [9, 9], 996: [9, 9], 998: [9, 9],
};
// The other assigned country codes (3 digits); national numbers of 4–12 digits.
const CC_OTHER = new Set(('211 220 221 222 223 224 225 226 227 228 229 230 231 232 235 236 237 238 239 240 241 242 243 244 245 246 247 248 249 250 252 253 '
  + '257 258 261 262 264 265 266 267 268 269 290 291 297 298 299 350 352 354 355 356 357 359 370 371 372 373 374 376 377 378 381 382 383 385 386 387 389 '
  + '420 421 423 500 501 502 503 504 505 506 507 508 509 590 591 592 593 594 595 596 597 598 599 670 672 673 674 675 676 677 678 679 680 681 682 683 685 '
  + '686 687 688 689 690 691 692').split(' '));

/** Digits that start with a country calling code followed by a plausible national number. */
export function hasCallingCode(d) {
  for (let len = 1; len <= 3; len += 1) {
    const cc = d.slice(0, len);
    const range = CC_LENGTHS[cc] || (len === 3 && CC_OTHER.has(cc) ? [4, 12] : null);
    if (range) {
      const nsn = d.length - len;
      return nsn >= range[0] && nsn <= range[1];
    }
  }
  return false;
}

/**
 * A stored phone → { n } (Meta's PHONE normalisation: digits only with the
 * country code, no leading zeros or +) or { n: '', reason }: 'invalid' when
 * it holds letters (an id, not a number) or isn't 8–15 digits;
 * 'noCountryCode' when it doesn't start with a valid calling code (a number
 * saved without its country code; the CRM doesn't guess one).
 */
export function phoneCheck(raw) {
  const s = String(raw ?? '');
  if (/[a-z]/i.test(s)) return { n: '', reason: 'invalid' };
  const d = s.replace(/\D/g, '').replace(/^0+/, '');
  if (d.length < 8 || d.length > 15) return { n: '', reason: 'invalid' };
  if (!hasCallingCode(d)) return { n: '', reason: 'noCountryCode' };
  return { n: d, reason: '' };
}

/** A stored phone → the normalised number, '' when it can't be used (see phoneCheck). */
export const normalizePhone = (raw) => phoneCheck(raw).n;

/** SHA-256 of a normalised number, lowercase hex (what Meta matches against). */
export const hashPhone = (normalised) => crypto.createHash('sha256').update(String(normalised), 'utf8').digest('hex');

const OTHER_CHANNELS = ['messenger', 'instagram'];

function dateFilter(sel, now) {
  if (sel.filter === 'all') return {};
  const since = new Date(now - sel.days * DAY_MS);
  if (sel.filter === 'inbound') return { lastInboundAt: { $gte: since } };
  // Contacted: any message either way in the window.
  return { $or: [{ lastMessageAt: { $gte: since } }, { lastInboundAt: { $gte: since } }, { lastOutboundAt: { $gte: since } }] };
}

/**
 * Read the business's WhatsApp contacts for a selection, paged by _id
 * (keyset, no OFFSET), yielding to the event loop between pages. Unique
 * normalised numbers are kept as JS numbers (≤ 15 digits fit exactly), which
 * is far smaller than their digests; nothing is hashed here. `firstOnly`
 * stops at the first usable contact (the request's "is there anyone?").
 */
async function scanContacts(businessId, sel, { now = Date.now(), keep = true, firstOnly = false, countOther = true } = {}) {
  // Blocked contacts stay out of ad audiences.
  const base = { businessId: String(businessId), blocked: { $ne: true }, ...dateFilter(sel, now) };
  const filter = { ...base, channel: { $nin: OTHER_CHANNELS } };
  const max = maxContacts();
  const seen = new Set();
  let scanned = 0;
  let invalid = 0;
  let noCountryCode = 0;
  let duplicate = 0;
  let otherChannel = 0;
  let truncated = false;
  let after = null;
  const page = readPage();
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const rows = await Conversation.find(after ? { ...filter, _id: { $gt: after } } : filter).select('phone channel').sort({ _id: 1 }).limit(page).lean();
    for (const r of rows) {
      if (OTHER_CHANNELS.includes(String(r.channel || '').toLowerCase())) {
        otherChannel += 1; // never a phone number (PSID / IGSID)
        continue;
      }
      scanned += 1;
      const { n, reason } = phoneCheck(r.phone);
      if (!n) {
        if (reason === 'noCountryCode') noCountryCode += 1;
        else invalid += 1;
        continue;
      }
      const key = Number(n);
      if (seen.has(key)) {
        duplicate += 1;
        continue;
      }
      if (seen.size >= max) {
        truncated = true;
        break;
      }
      seen.add(key);
      if (firstOnly) break;
    }
    if (truncated || (firstOnly && seen.size) || rows.length < page) break;
    after = String(rows[rows.length - 1]._id);
    // eslint-disable-next-line no-await-in-loop
    await yieldNow();
  }
  if (countOther && !firstOnly) otherChannel += Number(await Conversation.countDocuments({ ...base, channel: { $in: OTHER_CHANNELS } })) || 0;
  return {
    count: seen.size, numbers: keep ? [...seen] : [], scanned, truncated, max, skipped: { otherChannel, invalid, noCountryCode, duplicate },
  };
}

/** SHA-256 digests of numbers[from, to), yielding to the event loop every HASH_SLICE. */
async function hashSlice(numbers, from, to) {
  const out = [];
  for (let i = from; i < to; i += 1) {
    out.push(hashPhone(String(numbers[i])));
    // eslint-disable-next-line no-await-in-loop
    if ((i - from + 1) % HASH_SLICE === 0) await yieldNow();
  }
  return out;
}

/**
 * The business's WhatsApp contacts for a selection: counts, and the SHA-256
 * digests when `digests` is true (the harness; uploads hash per batch in the
 * job instead). Normalised numbers stay inside this module.
 */
export async function collectContacts(businessId, sel, { digests: wantDigests = true, now = Date.now() } = {}) {
  const c = await scanContacts(businessId, sel, { now, keep: wantDigests });
  const digests = wantDigests ? await hashSlice(c.numbers, 0, c.numbers.length) : [];
  return { count: c.count, digests, scanned: c.scanned, truncated: c.truncated, max: c.max, skipped: c.skipped };
}

/** GET /meta/audiences/contacts?filter=&days= → how many contacts an upload would send (counts only). */
export async function contactsPreview(businessId, q = {}) {
  await requireAdsRow(businessId);
  const sel = selectionOf(q);
  const c = await scanContacts(businessId, sel, { keep: false });
  return { ...sel, count: c.count, scanned: c.scanned, skipped: c.skipped, truncated: c.truncated, max: c.max, batches: Math.ceil(c.count / batchSize()), batchSize: batchSize() };
}

// ---------------------------------------------------------------- graph --

const bearer = (t) => ({ Authorization: `Bearer ${t}` });

function gGet(row, path, params = {}) {
  return withAdsToken(row, 'ad', async (token) => (await http.get(`${G()}/${path}`, auth(token, params))).data);
}

/** POST a JSON body; appsecret_proof as a query param. */
function gPost(row, path, body) {
  return withAdsToken(row, 'ad', async (token) => (await http.post(`${G()}/${path}`, body, {
    params: { appsecret_proof: proof(token) },
    headers: { ...bearer(token), 'Content-Type': 'application/json' },
  })).data);
}

function gDelete(row, path) {
  return withAdsToken(row, 'ad', async (token) => (await http.delete(`${G()}/${path}`, auth(token))).data);
}

const TERMS_SUBCODE = 1870090;
const isTermsError = (e) => Number(e?.meta?.subcode) === TERMS_SUBCODE || /customaudiences\/tos/i.test(String(e?.meta?.message || ''));
const isMissing = (e) => e?.code === 'META_ERROR' && Number(e?.meta?.code) === 100 && (Number(e?.meta?.subcode) === 33 || /does not exist|do not exist|Unsupported get request/i.test(String(e?.meta?.message || '')));

/** Meta's custom-audience errors → readable CRM errors. */
async function call(row, fn) {
  try {
    return await fn();
  } catch (e) {
    if (isTermsError(e)) throw new TermsError(row, e.meta);
    if (Number(e?.meta?.code) === 2650) {
      const sub = Number(e.meta.subcode);
      if (sub === 1870145) throw new AdsError('Meta is still updating this audience. Try again when its availability is back to normal (usually within an hour).', { status: 409, code: 'AUDIENCE_BUSY', meta: e.meta });
      if (sub === 1870158) throw new AdsError('Meta closed the replace session after 90 minutes. The audience holds what was uploaded so far; run Refresh again later.', { status: 409, code: 'REPLACE_TIMEOUT', meta: e.meta });
    }
    throw e;
  }
}

// --------------------------------------------------------------- guards --

/** Graph version ≥ v24, connected, ads_management re-checked now (409 GRAPH_VERSION_TOO_OLD / READ_ONLY). */
const requireWriter = (businessId) => requireAdsWriter(businessId, READ_ONLY_TEXT);

const AUDIENCE_FIELDS = 'id,name,description,account_id,subtype,approximate_count_lower_bound,approximate_count_upper_bound,operation_status,delivery_status,'
  + 'customer_file_source,lookalike_spec,time_created,time_updated';

/** A custom audience id from the browser, read fresh; it must be in the connected ad account. */
async function ownAudience(row, id) {
  if (!isId(id)) throw new AdsError('Unknown audience.', { status: 400, code: 'BAD_ID' });
  let a;
  try {
    a = await gGet(row, String(id), { fields: AUDIENCE_FIELDS });
  } catch (e) {
    if (isMissing(e)) throw NOT_IN_ACCOUNT();
    throw e;
  }
  if (actNumber(a?.account_id) !== actNumber(row.adAccountId)) throw NOT_IN_ACCOUNT();
  return a;
}

/**
 * Custom / lookalike audience ids used in targeting (S1 wizard, S2 ad set
 * editor, saved audiences) must belong to the connected ad account.
 * Lookalikes aren't allowed with housing / employment / financial ads;
 * audiences Meta flagged (operation_status 471) can't be used.
 */
export async function assertAudiences(row, { include = [], exclude = [] } = {}, { restricted = false } = {}) {
  const lists = [['audience.customAudiences', include], ['audience.excludedCustomAudiences', exclude]];
  for (const [field, list] of lists) for (const id of list) if (!isId(id)) throw bad(field, 'That audience isn’t valid. Pick it from the list.');
  const want = [...new Set([...include, ...exclude].map(String))];
  if (!want.length) return new Map();
  let data;
  try {
    data = await graphGet(row, '', { ids: want.join(','), fields: 'id,name,account_id,subtype,operation_status' });
  } catch (e) {
    if (isMissing(e)) throw NOT_IN_ACCOUNT();
    throw e;
  }
  const out = new Map();
  for (const [field, list] of lists) {
    for (const id of list.map(String)) {
      const a = data?.[id];
      if (!a || actNumber(a.account_id) !== actNumber(row.adAccountId)) throw NOT_IN_ACCOUNT();
      if (restricted && String(a.subtype).toUpperCase() === 'LOOKALIKE') throw bad(field, 'Lookalike audiences aren’t available for housing, employment or financial products ads. Remove them.');
      if (Number(a.operation_status?.code) === 471) throw bad(field, `Meta flagged “${a.name || id}” and won’t run ads with it. Pick another audience.`);
      out.set(id, a);
    }
  }
  return out;
}

/** The Custom Audience terms of the ad account: accepted true / false, or null when Meta didn't say. */
async function termsOf(row, refresh = false) {
  try {
    const a = await graphGet(row, row.adAccountId, { fields: 'tos_accepted' }, { refresh });
    return { accepted: Number(a?.tos_accepted?.custom_audience_tos) === 1, url: termsUrl(row.adAccountId) };
  } catch (e) {
    if (e?.code === 'RATE_LIMITED' || e?.code === 'ADS_REVOKED') throw e;
    logger.warn('custom audience terms check failed', { adAccountId: row.adAccountId, code: e?.code || '', metaCode: e?.meta?.code ?? null });
    return { accepted: null, url: termsUrl(row.adAccountId) };
  }
}

// ----------------------------------------------------------- presenting --

const TYPE_OF = { LOOKALIKE: 'lookalike', WEBSITE: 'website', ENGAGEMENT: 'engagement', APP: 'app', OFFLINE_CONVERSION: 'offline' };
const statusOf = (s) => (s && (s.code !== undefined || s.description) ? { code: num(s.code), description: String(s.description || '') } : null);
const unixIso = (v) => (num(v) > 0 ? new Date(num(v) * 1000).toISOString() : null);

function presentAudience(a = {}, job = null) {
  const subtype = String(a.subtype || '').toUpperCase();
  const type = subtype === 'CUSTOM' ? (a.customer_file_source ? 'customer_list' : 'custom') : TYPE_OF[subtype] || 'other';
  const lower = a.approximate_count_lower_bound;
  const upper = a.approximate_count_upper_bound;
  const known = lower !== undefined && lower !== null && num(lower) >= 0;
  const op = statusOf(a.operation_status);
  const del = statusOf(a.delivery_status);
  let lookalike = null;
  if (subtype === 'LOOKALIKE') {
    const spec = obj(a.lookalike_spec);
    const origin = Array.isArray(spec.origin) ? spec.origin[0] : null;
    const countries = Array.isArray(spec.target_countries) && spec.target_countries.length
      ? spec.target_countries
      : spec.country ? [spec.country] : obj(obj(spec.location_spec).geo_locations).countries || [];
    lookalike = {
      ratio: spec.ratio !== undefined ? Math.round(num(spec.ratio) * 100) : null,
      type: spec.type || '',
      countries: countries.map((c) => String(c).toUpperCase()),
      originId: origin?.id ? String(origin.id) : '',
      originName: origin?.name || '',
    };
  }
  return {
    id: String(a.id || ''),
    name: a.name || '',
    description: a.description || '',
    subtype,
    type,
    size: known ? { lower: num(lower), upper: upper !== undefined && num(upper) >= 0 ? num(upper) : null } : null,
    operationStatus: op,
    deliveryStatus: del,
    ready: del ? del.code === 200 : null,
    flagged: op?.code === 471,
    lookalike,
    createdAt: unixIso(a.time_created),
    updatedAt: unixIso(a.time_updated),
    crm: job ? { filter: job.filter, days: job.days, lastJob: presentJob(job) } : null,
    canRefresh: subtype === 'CUSTOM' && !!job,
  };
}

// ----------------------------------------------------------------- jobs --

const ACTIVE = new Set(['queued', 'running', 'waiting']);
const RUNNER = crypto.randomBytes(8).toString('hex');
const running = new Map(); // jobId -> { businessId, audienceId, promise } (queued or running in this process)
const reserved = new Map(); // businessId -> { audienceId } (a create / refresh request between its checks and its job)
const waiting = []; // jobs waiting for one of the ADS_AUDIENCE_CONCURRENCY slots
let activeUploads = 0;

/** Start queued jobs while a process-wide slot is free. */
function pump() {
  while (activeUploads < concurrency() && waiting.length) {
    const next = waiting.shift();
    activeUploads += 1;
    // runJob never rejects today; the catch keeps a future slip from becoming
    // an unhandled rejection (the slot is still released by finally).
    next().finally(() => {
      activeUploads -= 1;
      pump();
    }).catch(() => {});
  }
}

/** Tests only: queue a job function on the process-wide upload queue, and read the slot counters. */
export function queueUploadForTests(fn) {
  waiting.push(fn);
  pump();
}
export function uploadSlots() {
  return { active: activeUploads, waiting: waiting.length };
}

// What the business reads when an upload stops: a code and the CRM's own
// words. Meta's error text is never stored (it could echo request data).
const JOB_ERRORS = {
  RATE_LIMITED: 'Meta kept limiting requests for this ad account, so the upload stopped. Meta keeps what was already sent. Run Refresh in a few minutes to upload the contacts again.',
  ADS_REVOKED: 'The Facebook connection was revoked during the upload. Reconnect on the Ads page, then run Refresh.',
  PERMISSION_MISSING: 'Meta didn’t allow the upload for this ad account. Check that the connection can manage ads (ads_management), then run Refresh.',
  TERMS_NOT_ACCEPTED: 'Meta needs the Custom Audience terms accepted for this ad account. Accept them at Meta, then run Refresh.',
  AUDIENCE_BUSY: 'Meta is still updating this audience. Run Refresh again when its availability is back to normal (usually within an hour).',
  REPLACE_TIMEOUT: 'Meta closes a replace after 90 minutes. The audience holds what was uploaded so far; run Refresh again later.',
  NO_CONTACTS: 'No WhatsApp contacts matched when the upload started, so nothing was sent. Pick a longer period or all contacts, then run Refresh.',
  META_UNREACHABLE: 'The CRM couldn’t reach Meta during the upload. Run Refresh to try again.',
};
function jobError(e) {
  const code = String(e?.code || 'ADS_FAILED');
  const metaCode = e?.meta?.code ?? null;
  const message = JOB_ERRORS[code]
    || (code === 'META_ERROR'
      ? `Meta refused the upload${metaCode !== null ? ` (Meta error ${Number(metaCode)})` : ''}. Meta keeps what was already sent. Run Refresh to try again, or create a new audience.`
      : 'The upload stopped. Run Refresh to try again.');
  return { code, message, ...(metaCode !== null ? { metaCode: Number(metaCode) } : {}) };
}

function presentJob(j) {
  if (!j) return null;
  const total = num(j.total);
  return {
    id: String(j._id),
    audienceId: j.audienceId || '',
    audienceName: j.audienceName || '',
    kind: j.kind || 'create',
    mode: j.mode || 'add',
    fallback: j.fallback || '',
    filter: j.filter || 'all',
    days: num(j.days),
    status: j.status || 'queued',
    done: !ACTIVE.has(j.status),
    total,
    sent: num(j.sent),
    percent: total ? Math.min(100, Math.round((num(j.sent) / total) * 100)) : 0,
    batches: num(j.batches),
    batchesDone: num(j.batchesDone),
    received: num(j.received),
    invalid: num(j.invalid),
    skipped: { otherChannel: num(j.skipped?.otherChannel), invalid: num(j.skipped?.invalid), noCountryCode: num(j.skipped?.noCountryCode), duplicate: num(j.skipped?.duplicate) },
    truncated: !!j.skipped?.truncated,
    error: j.error ? { code: String(j.error.code || ''), message: String(j.error.message || '') } : null,
    startedAt: j.startedAt || null,
    finishedAt: j.finishedAt || null,
  };
}

/**
 * A job marked active that this process isn't running: the server restarted
 * mid-upload. A job another process runs (another runner id with a heartbeat
 * in the last 3 minutes) is left alone.
 */
async function settle(j) {
  if (!j || !ACTIVE.has(j.status) || running.has(String(j._id))) return j;
  const beat = j.heartbeatAt ? new Date(j.heartbeatAt).getTime() : 0;
  if (j.runner && j.runner !== RUNNER && Date.now() - beat < STALE_MS) return j;
  const error = {
    code: 'INTERRUPTED',
    message: 'The CRM server restarted during this upload. Meta keeps what was already sent. Run Refresh to upload the contacts again.',
  };
  await AdAudienceJob.updateOne({ _id: j._id, status: { $in: [...ACTIVE] } }, { $set: { status: 'interrupted', error, finishedAt: new Date() } }).catch(() => {});
  return { ...j, status: 'interrupted', error, finishedAt: new Date() };
}

function assertNoActiveJob(businessId, audienceId = '') {
  const busy = [...running.values()].find((r) => r.businessId === String(businessId)) || reserved.get(String(businessId));
  if (!busy) return;
  throw new AdsError(audienceId && busy.audienceId === audienceId
    ? 'This audience is still uploading. Wait for it to finish.'
    : 'Another audience upload is still running. Wait for it to finish, then try again.', { status: 409, code: 'JOB_RUNNING' });
}

/**
 * Take the business's upload slot synchronously (before the request's first
 * await), so two quick submits can't both pass the check. → release().
 */
function reserve(businessId, audienceId = '') {
  assertNoActiveJob(businessId, audienceId);
  const k = String(businessId);
  const token = { audienceId };
  reserved.set(k, token);
  return () => {
    if (reserved.get(k) === token) reserved.delete(k);
  };
}

/** A positive 64-bit session id, unique per ad account (time-based; fits a JS number). */
export function newSessionId() {
  return Date.now() * 1000 + crypto.randomInt(1000);
}

const replaceUnavailable = (e) => {
  const m = e?.meta || {};
  if (Number(m.code) === 2650 && Number(m.subcode) === 1870144) return 'This audience is too large to replace (100 million or more).';
  if (Number(m.code) === 100 && /usersreplace|unsupported post request|nonexisting field|not supported/i.test(String(m.message || ''))) return 'Meta doesn’t offer replace for this audience.';
  return '';
};

/**
 * Send SHA-256 digests to /{audience}/users (add) or /usersreplace (replace)
 * in batches of ≤ 10,000, all in one Meta session. Rate limits wait and retry
 * (ADS_AUDIENCE_RETRY_MS, doubling, 4 times). A replace that Meta can't do
 * falls back to add on its first batch. Exported for the harness.
 */
export async function uploadDigests(row, audienceId, digests, opts = {}) {
  return uploadBatches(row, audienceId, digests.length, async (from, to) => digests.slice(from, to), opts);
}

/**
 * The upload loop: `total` people, `batchOf(from, to)` gives one batch's
 * digests (the job hashes each batch only when it is sent). Payload: the
 * documented single-key form { schema: 'PHONE_SHA256', data: [hash, …] }.
 */
async function uploadBatches(row, audienceId, total, batchOf, { mode = 'add', sessionId = newSessionId(), onProgress = async () => {} } = {}) {
  const size = batchSize();
  const batches = Math.max(1, Math.ceil(total / size));
  let used = mode === 'replace' ? 'replace' : 'add';
  let fallback = '';
  let session = sessionId;
  let sent = 0;
  let received = 0;
  let invalid = 0;
  const started = Date.now();
  for (let i = 0; i < batches; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const chunk = await batchOf(i * size, Math.min(total, (i + 1) * size));
    if (used === 'replace' && i > 0 && Date.now() - started > REPLACE_WINDOW_MS) {
      throw Object.assign(new AdsError('Meta closes a replace session after 90 minutes. The audience holds what was uploaded so far; run Refresh again later.', { status: 409, code: 'REPLACE_TIMEOUT' }), {
        progress: { sent, batchesDone: i, received, invalid, mode: used, fallback },
      });
    }
    let data;
    for (let attempt = 0; ; attempt += 1) {
      const body = {
        session: { session_id: session, batch_seq: i + 1, last_batch_flag: i === batches - 1, estimated_num_total: total },
        payload: { schema: SCHEMA, data: chunk },
      };
      try {
        // eslint-disable-next-line no-await-in-loop
        data = await call(row, () => gPost(row, `${audienceId}/${used === 'replace' ? 'usersreplace' : 'users'}`, body));
        break;
      } catch (e) {
        if (e?.code === 'RATE_LIMITED' && attempt < RETRIES) {
          // eslint-disable-next-line no-await-in-loop
          await onProgress({ status: 'waiting', sent, batchesDone: i, received, invalid, mode: used, fallback });
          // eslint-disable-next-line no-await-in-loop
          await sleep(retryMs() * 2 ** attempt);
          continue;
        }
        const why = i === 0 && used === 'replace' ? replaceUnavailable(e) : '';
        if (why) {
          used = 'add';
          fallback = why;
          session = newSessionId(); // a new session for the add
          continue;
        }
        throw Object.assign(e, { progress: { sent, batchesDone: i, received, invalid, mode: used, fallback } });
      }
    }
    sent += chunk.length;
    received = Math.max(received, num(data?.num_received));
    invalid += num(data?.num_invalid_entries);
    // eslint-disable-next-line no-await-in-loop
    await onProgress({ status: 'running', sent, batchesDone: i + 1, received, invalid, mode: used, fallback });
  }
  return { sent, batches, received, invalid, mode: used, fallback, sessionId: session };
}

/**
 * One upload, run when a process-wide slot is free: read the contacts (paged
 * by _id), then hash and send one batch at a time. Only the normalised
 * numbers are kept while it runs, never all digests.
 */
async function runJob(jobId, row, businessName, plan) {
  const t0 = Date.now();
  const save = (set) => AdAudienceJob.updateOne({ _id: jobId }, { $set: { ...set, heartbeatAt: new Date() } }).catch((e) => logger.warn('audience job progress not saved', { error: e.message }));
  let total = 0;
  let skipped = {};
  try {
    await save({ status: 'running', startedAt: new Date() });
    const c = await scanContacts(row.businessId, plan.sel);
    total = c.numbers.length;
    skipped = { ...c.skipped, truncated: c.truncated };
    await save({ total, batches: Math.max(1, Math.ceil(total / batchSize())), skipped });
    if (!total) throw new AdsError(JOB_ERRORS.NO_CONTACTS, { status: 400, code: 'NO_CONTACTS' });
    let numbers = c.numbers;
    const res = await uploadBatches(row, plan.audienceId, total, (from, to) => hashSlice(numbers, from, to), {
      mode: plan.mode,
      sessionId: Number(plan.sessionId),
      onProgress: (p) => save(p),
    });
    numbers = null;
    await save({ status: 'done', sent: res.sent, batchesDone: res.batches, received: res.received, invalid: res.invalid, mode: res.mode, fallback: res.fallback, sessionId: String(res.sessionId), finishedAt: new Date(), error: null });
    clearCache(row.businessId);
    logger.info('custom audience upload finished', {
      business: businessName, adAccountId: row.adAccountId, audienceId: plan.audienceId, kind: plan.kind, mode: res.mode,
      contacts: res.sent, batches: res.batches, received: res.received, invalid: res.invalid, skipped,
    });
    if (res.batches > 1 || Date.now() - t0 > longMs()) {
      await notify(row.businessId, {
        type: 'ad_audience_ready',
        title: `Audience uploaded: ${plan.audienceName}`,
        body: `${res.sent.toLocaleString('en-US')} contacts ${res.mode === 'replace' ? 'replaced the audience' : 'were added'} at Meta. Meta matches them to accounts over the next hours; the matched size shows on the Audiences tab.`,
        target: { view: 'ads', id: `audience:${plan.audienceId}` },
        groupKey: `ad_audience_ready:${jobId}`,
      }).catch(() => {});
    }
  } catch (e) {
    const p = e?.progress || {};
    await save({ status: 'failed', ...p, finishedAt: new Date(), error: jobError(e) });
    clearCache(row.businessId);
    // Counts and codes only: no Meta message (it could echo request data).
    logger.warn('custom audience upload stopped', {
      business: businessName, adAccountId: row.adAccountId, audienceId: plan.audienceId, code: e?.code || '', metaCode: e?.meta?.code ?? null,
      metaSubcode: e?.meta?.subcode ?? null, contacts: total, sent: num(p.sent), batchesDone: num(p.batchesDone),
    });
  }
}

/**
 * The job row (queued) and its place in the queue. The row's heartbeat is
 * refreshed every 30 s while it is queued or running here, so another
 * process (or this one after a restart) can tell a live job from a dead one.
 */
async function startJob(row, business, plan) {
  const now = new Date();
  const sessionId = newSessionId();
  const job = await AdAudienceJob.create({
    businessId: String(business._id), adAccountId: row.adAccountId, audienceId: plan.audienceId, audienceName: plan.audienceName,
    kind: plan.kind, mode: plan.mode, filter: plan.sel.filter, days: plan.sel.days, status: 'queued',
    total: 0, batches: 0, skipped: {}, sessionId: String(sessionId), runner: RUNNER, startedAt: now, heartbeatAt: now,
  });
  const j = job.toObject ? job.toObject() : job;
  const id = String(j._id);
  const entry = { businessId: String(business._id), audienceId: plan.audienceId, promise: null };
  running.set(id, entry);
  const beat = setInterval(() => {
    AdAudienceJob.updateOne({ _id: id, status: { $in: [...ACTIVE] } }, { $set: { heartbeatAt: new Date() } }).catch(() => {});
  }, HEARTBEAT_MS());
  beat.unref?.();
  entry.promise = new Promise((resolve) => {
    waiting.push(() => runJob(id, row, business.name, { ...plan, sessionId }).finally(resolve));
    pump();
  }).finally(() => {
    clearInterval(beat);
    running.delete(id);
  });
  return presentJob(j);
}

/** Wait for this process's queued and running uploads (the harness; a graceful stop). */
export async function waitForJobs() {
  while (running.size) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.all([...running.values()].map((r) => r.promise?.catch(() => {})));
  }
}

export async function getJob(businessId, jobId) {
  if (!/^[a-f0-9]{24}$/.test(String(jobId || ''))) throw new AdsError('Unknown upload.', { status: 400, code: 'BAD_ID' });
  const j = await AdAudienceJob.findOne({ _id: String(jobId), businessId: String(businessId) }).lean();
  if (!j) throw new AdsError('That upload doesn’t exist any more.', { status: 404, code: 'JOB_NOT_FOUND' });
  return { job: presentJob(await settle(j)) };
}

async function latestJobs(businessId, adAccountId) {
  const rows = await AdAudienceJob.find({ businessId: String(businessId), adAccountId }).sort({ createdAt: -1 }).limit(500).lean();
  const out = new Map();
  for (const j of rows) if (!out.has(j.audienceId)) out.set(j.audienceId, await settle(j)); // eslint-disable-line no-await-in-loop
  return out;
}

const prunedAt = new Map(); // businessId -> ms of the last prune

/**
 * Delete upload rows older than 90 days, keeping the latest per audience (it
 * holds the audience's CRM filter for Refresh) and anything still active.
 * Runs when the Audiences list loads, at most once an hour per business.
 */
export async function pruneJobs(businessId, { now = Date.now(), force = false } = {}) {
  const k = String(businessId);
  if (!force && now - (prunedAt.get(k) || 0) < 60 * 60 * 1000) return 0;
  prunedAt.set(k, now);
  const cutoff = now - JOB_KEEP_DAYS * DAY_MS;
  const rows = await AdAudienceJob.find({ businessId: k }).select('_id adAccountId audienceId status createdAt').sort({ createdAt: -1 }).limit(5000).lean();
  const latest = new Set();
  const drop = [];
  for (const j of rows) {
    const a = `${j.adAccountId}|${j.audienceId}`;
    if (!latest.has(a)) {
      latest.add(a);
      continue;
    }
    if (new Date(j.createdAt).getTime() < cutoff && !ACTIVE.has(j.status)) drop.push(String(j._id));
  }
  if (!drop.length) return 0;
  const r = await AdAudienceJob.deleteMany({ businessId: k, _id: { $in: drop } });
  logger.info('old audience upload rows pruned', { businessId: k, deleted: Number(r?.deletedCount) || drop.length });
  return Number(r?.deletedCount) || drop.length;
}

// ------------------------------------------------------------ endpoints --

/** GET /meta/audiences: the ad account's custom and lookalike audiences, the terms, uploads. */
export async function listAudiences(businessId, q = {}) {
  const row = await requireAdsRow(businessId);
  const refresh = q.refresh === '1';
  const [items, terms, fresh] = await Promise.all([
    graphList(row, `${row.adAccountId}/customaudiences`, { fields: AUDIENCE_FIELDS, limit: 50 }, { refresh, maxPages: 10 }),
    termsOf(row, refresh),
    refreshPermissions(row),
  ]);
  await pruneJobs(businessId).catch((e) => logger.warn('audience upload rows not pruned', { error: e.message }));
  const jobs = await latestJobs(businessId, row.adAccountId);
  const audiences = items
    .filter((a) => actNumber(a.account_id || row.adAccountId) === actNumber(row.adAccountId))
    .map((a) => presentAudience(a, jobs.get(String(a.id)) || null))
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  return {
    canManage: !!fresh.canManageAds,
    terms,
    audiences,
    jobs: [...jobs.values()].filter((j) => ACTIVE.has(j.status)).map(presentJob),
    limits: { batchSize: batchSize(), maxContacts: maxContacts() },
  };
}

/** GET /meta/audiences/:id: one audience read fresh (the matched size after an upload). */
export async function getAudience(businessId, id) {
  const row = await requireAdsRow(businessId);
  const a = await ownAudience(row, id);
  const jobs = await latestJobs(businessId, row.adAccountId);
  return { audience: presentAudience(a, jobs.get(String(id)) || null) };
}

/** POST { name, description?, filter, days? }: a customer-list audience from CRM contacts, uploaded in the background. */
export async function createFromContacts(business, raw = {}) {
  const r = obj(raw);
  const name = text(r.name, NAME_MAX, 'name', 'Audience name', { required: true });
  const description = text(r.description, NAME_MAX, 'description', 'Description');
  const sel = selectionOf(r);
  const release = reserve(business._id); // before the first await
  try {
    const row = await requireWriter(business._id);
    const terms = await termsOf(row, true);
    if (terms.accepted === false) throw new TermsError(row);
    const first = await scanContacts(business._id, sel, { keep: false, firstOnly: true });
    if (!first.count) throw new AdsError('No WhatsApp contacts match this choice. Pick a longer period or all contacts.', { status: 400, code: 'NO_CONTACTS' });
    const created = await call(row, () => gPost(row, `${row.adAccountId}/customaudiences`, {
      name, ...(description ? { description } : {}), subtype: 'CUSTOM', customer_file_source: 'USER_PROVIDED_ONLY',
    }));
    const audienceId = String(created?.id || '');
    if (!isId(audienceId)) throw new AdsError('Meta didn’t return the new audience.', { status: 502, code: 'META_ERROR' });
    clearCache(business._id);
    logger.info('custom audience created from CRM contacts', { business: business.name, adAccountId: row.adAccountId, audienceId, filter: sel.filter, days: sel.days });
    const job = await startJob(row, business, { audienceId, audienceName: name, kind: 'create', mode: 'add', sel });
    return {
      audience: presentAudience({ id: audienceId, name, description, subtype: 'CUSTOM', customer_file_source: 'USER_PROVIDED_ONLY', account_id: row.adAccountId }, { ...job, _id: job.id }),
      job,
      // Known once the job has read the contacts (job.truncated).
      truncated: null,
    };
  } finally {
    release();
  }
}

/** POST /meta/audiences/:id/refresh { filter?, days? }: replace the audience with the current contacts. */
export async function refreshAudience(business, audienceId, raw = {}) {
  const r = obj(raw);
  const chosen = r.filter !== undefined ? selectionOf(r) : null;
  const release = reserve(business._id, String(audienceId)); // before the first await
  try {
    const row = await requireWriter(business._id);
    const a = await ownAudience(row, audienceId);
    if (String(a.subtype).toUpperCase() !== 'CUSTOM') throw new AdsError('Only customer-list audiences made from CRM contacts can be refreshed.', { status: 409, code: 'NOT_CUSTOMER_LIST' });
    const last = await AdAudienceJob.findOne({ businessId: String(business._id), adAccountId: row.adAccountId, audienceId: String(audienceId) }).sort({ createdAt: -1 }).lean();
    if (!last) {
      throw new AdsError('This audience wasn’t made from CRM contacts, so the CRM won’t replace its people. Create a new audience from your contacts instead.', { status: 409, code: 'NOT_CRM_AUDIENCE' });
    }
    if (Number(a.operation_status?.code) === 414) {
      throw new AdsError('Meta is still replacing this audience’s people. Try again when it’s done.', { status: 409, code: 'AUDIENCE_BUSY' });
    }
    const sel = chosen || { filter: last.filter || 'all', days: num(last.days) };
    const terms = await termsOf(row, true);
    if (terms.accepted === false) throw new TermsError(row);
    const first = await scanContacts(business._id, sel, { keep: false, firstOnly: true });
    if (!first.count) throw new AdsError('No WhatsApp contacts match this choice, so the audience would be emptied. Pick a longer period or all contacts.', { status: 400, code: 'NO_CONTACTS' });
    const job = await startJob(row, business, { audienceId: String(audienceId), audienceName: a.name || '', kind: 'refresh', mode: 'replace', sel });
    return { audience: presentAudience(a, { ...job, _id: job.id }), job, truncated: null };
  } finally {
    release();
  }
}

/** POST { name, originId, countries[1–25], ratio 1–10 }: a lookalike of one of the account's custom audiences. */
export async function createLookalike(business, raw = {}) {
  const r = obj(raw);
  const row = await requireWriter(business._id);
  const name = text(r.name, NAME_MAX, 'name', 'Audience name', { required: true });
  const originId = String(r.originId ?? '').trim();
  if (!isId(originId)) throw bad('originId', 'Pick the source audience.');
  if (!Array.isArray(r.countries)) throw bad('countries', 'Pick at least one country.');
  const countries = [...new Set(r.countries.map((c) => String(c ?? '').trim().toUpperCase()))];
  if (!countries.length) throw bad('countries', 'Pick at least one country.');
  if (countries.length > 25) throw bad('countries', 'Pick at most 25 countries.');
  if (countries.some((c) => !/^[A-Z]{2}$/.test(c))) throw bad('countries', 'That country isn’t valid. Pick it from the list.');
  const ratio = intIn(r.ratio, 1, 10, 'ratio', 'Audience size (%)');
  const origin = await ownAudience(row, originId);
  if (String(origin.subtype).toUpperCase() === 'LOOKALIKE') throw bad('originId', 'A lookalike can’t be the source of another lookalike. Pick a custom audience.');
  if (Number(origin.operation_status?.code) === 471) throw bad('originId', 'Meta flagged this audience, so it can’t be the source of a lookalike.');
  const terms = await termsOf(row);
  if (terms.accepted === false && origin.customer_file_source) throw new TermsError(row);
  const rf = Number((ratio / 100).toFixed(2));
  const lookalike_spec = countries.length === 1 ? { ratio: rf, country: countries[0] } : { ratio: rf, location_spec: { geo_locations: { countries } } };
  const created = await call(row, () => gPost(row, `${row.adAccountId}/customaudiences`, { name, subtype: 'LOOKALIKE', origin_audience_id: originId, lookalike_spec }));
  const id = String(created?.id || '');
  if (!isId(id)) throw new AdsError('Meta didn’t return the new audience.', { status: 502, code: 'META_ERROR' });
  clearCache(business._id);
  logger.info('lookalike audience created from the CRM', { business: business.name, adAccountId: row.adAccountId, audienceId: id, originId, countries: countries.length, ratio });
  return {
    audience: presentAudience({
      id, name, subtype: 'LOOKALIKE', account_id: row.adAccountId,
      lookalike_spec: { ratio: rf, target_countries: countries, origin: [{ id: originId, name: origin.name || '' }] },
    }),
  };
}

/** POST /meta/audiences/:id/delete { confirm: true } */
export async function deleteAudience(business, audienceId, { confirm } = {}) {
  if (confirm !== true) throw new AdsError('Deleting an audience can’t be undone. Confirm it in the CRM first.', { status: 400, code: 'CONFIRM_REQUIRED' });
  const row = await requireWriter(business._id);
  await ownAudience(row, audienceId);
  const busy = [...running.values(), ...(reserved.has(String(business._id)) ? [reserved.get(String(business._id))] : [])];
  for (const r of busy) {
    if ((r.businessId === undefined || r.businessId === String(business._id)) && r.audienceId === String(audienceId)) {
      throw new AdsError('This audience is still uploading. Wait for it to finish.', { status: 409, code: 'JOB_RUNNING' });
    }
  }
  await call(row, () => gDelete(row, String(audienceId)));
  await AdAudienceJob.deleteMany({ businessId: String(business._id), audienceId: String(audienceId) }).catch(() => {});
  clearCache(business._id);
  logger.info('custom audience deleted from the CRM', { business: business.name, adAccountId: row.adAccountId, audienceId: String(audienceId) });
  return { id: String(audienceId), deleted: true };
}

// ------------------------------------------------------ saved audiences --

const presentSaved = (s) => ({
  id: String(s._id), source: 'crm', name: s.name || '', description: s.description || '', audience: s.audience || {}, sizeLower: null, sizeUpper: null, notes: [],
  updatedAt: s.updatedAt || null,
});

/** GET /meta/audiences/saved: Meta's saved audiences (read only) and the CRM's. */
export async function listSavedAudiences(businessId, q = {}) {
  const row = await requireAdsRow(businessId);
  const { targetingToEditors } = await import('./metaAdsManage.js');
  let meta = [];
  let metaError = '';
  try {
    meta = await graphList(row, `${row.adAccountId}/saved_audiences`, {
      fields: 'id,name,description,targeting,approximate_count_lower_bound,approximate_count_upper_bound,run_status,time_updated', limit: 50,
    }, { refresh: q.refresh === '1', maxPages: 4 });
  } catch (e) {
    if (e?.code === 'RATE_LIMITED' || e?.code === 'ADS_REVOKED') throw e;
    metaError = 'Meta didn’t share the saved audiences of this ad account.';
    logger.warn('saved audiences unavailable', { adAccountId: row.adAccountId, code: e?.code || '', metaCode: e?.meta?.code ?? null });
  }
  const crm = await AdSavedAudience.find({ businessId: String(businessId), adAccountId: row.adAccountId }).sort({ updatedAt: -1 }).limit(SAVED_LIMIT).lean();
  return {
    meta: meta
      .filter((s) => !s.run_status || String(s.run_status).toUpperCase() !== 'DELETED')
      .map((s) => {
        const ed = targetingToEditors(s.targeting || {});
        const lower = s.approximate_count_lower_bound;
        return {
          id: String(s.id), source: 'meta', name: s.name || '', description: s.description || '', audience: ed.audience, notes: ed.notes,
          sizeLower: lower !== undefined && num(lower) >= 0 ? num(lower) : null,
          sizeUpper: s.approximate_count_upper_bound !== undefined && num(s.approximate_count_upper_bound) >= 0 ? num(s.approximate_count_upper_bound) : null,
          updatedAt: s.time_updated ? (Number.isFinite(Number(s.time_updated)) ? unixIso(s.time_updated) : String(s.time_updated)) : null,
        };
      }),
    crm: crm.map(presentSaved),
    metaError,
    // v25: act_/saved_audiences is read-only in the Marketing API.
    createAtMeta: false,
  };
}

/** POST /meta/audiences/saved { name, description?, audience }: saved targeting in the CRM. */
export async function createSavedAudience(business, raw = {}) {
  const r = obj(raw);
  const row = await requireWriter(business._id);
  const { validateAudience } = await import('./metaAdsCreate.js');
  const name = text(r.name, NAME_MAX, 'name', 'Name', { required: true });
  const description = text(r.description, NAME_MAX, 'description', 'Description');
  const audience = validateAudience(r.audience);
  await assertAudiences(row, {
    include: audience.customAudiences.map((x) => x.id), exclude: audience.excludedCustomAudiences.map((x) => x.id),
  });
  if (Buffer.byteLength(JSON.stringify(audience)) > SAVED_MAX_BYTES) throw bad('audience', 'This audience is too large to save.');
  const count = Number(await AdSavedAudience.countDocuments({ businessId: String(business._id) })) || 0;
  if (count >= SAVED_LIMIT) throw new AdsError(`You have ${SAVED_LIMIT} saved audiences. Delete some before saving another.`, { status: 409, code: 'SAVED_LIMIT' });
  const s = await AdSavedAudience.create({ businessId: String(business._id), adAccountId: row.adAccountId, name, description, audience });
  return { saved: presentSaved(s.toObject ? s.toObject() : s) };
}

/** DELETE /meta/audiences/saved/:id (CRM saved audiences only). */
export async function deleteSavedAudience(business, id) {
  if (!/^[a-f0-9]{24}$/.test(String(id || ''))) throw new AdsError('Unknown saved audience.', { status: 400, code: 'BAD_ID' });
  await requireWriter(business._id);
  const r = await AdSavedAudience.deleteOne({ _id: String(id), businessId: String(business._id) });
  if (!r.deletedCount) throw new AdsError('That saved audience doesn’t exist any more.', { status: 404, code: 'SAVED_NOT_FOUND' });
  return { id: String(id), deleted: true };
}

export default {
  listAudiences, getAudience, contactsPreview, createFromContacts, refreshAudience, createLookalike, deleteAudience, getJob,
  listSavedAudiences, createSavedAudience, deleteSavedAudience, assertAudiences, normalizePhone, phoneCheck, hasCallingCode, hashPhone, collectContacts, uploadDigests,
  selectionOf, newSessionId, waitForJobs, pruneJobs, termsUrl, SCHEMA, FILTERS,
};
