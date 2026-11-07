// ---------------------------------------------------------------------------
// API keys for the public API (/api/v1), and the one-time codes it sends.
//
// Two kinds of key:
//   secret       kp_live_<32 base62>  server-side, every endpoint
//   publishable  kp_pub_<32 base62>   read-only data endpoints, from a
//                                     browser on the business's own websites
//
// A key looks like  kp_live_<32 random base62 characters>  (~190 bits). Only
// an HMAC-SHA256 of it is stored, keyed with a server secret, so a database
// copy alone can't be used to call the API, and lookups are by that hash (no
// key is ever compared character by character). The key is shown once.
//
// The server secret is API_KEY_PEPPER, else derived from TOKEN_ENC_KEY (which
// the server creates on first boot and keeps in backend/.env). Changing it
// invalidates every key.
// ---------------------------------------------------------------------------
import crypto from 'crypto';
import ApiKey from '../models/ApiKey.js';
import OtpCode from '../models/OtpCode.js';
import logger from './logger.js';

export const KEY_PREFIX = 'kp_live_';
export const PUB_PREFIX = 'kp_pub_';
export const MAX_KEYS = 10;
export const MAX_ORIGINS = 10;
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const KEY_RE = /^kp_(live|pub)_[0-9A-Za-z]{32}$/;

function pepper() {
  const own = process.env.API_KEY_PEPPER;
  if (own) return own;
  const base = process.env.TOKEN_ENC_KEY;
  if (!base) throw new Error('API keys need API_KEY_PEPPER or TOKEN_ENC_KEY');
  return crypto.createHash('sha256').update(`kapso-api-keys:${base}`).digest('hex');
}

export const hashKey = (raw) => crypto.createHmac('sha256', pepper()).update(`key:${raw}`).digest('hex');

/** 32 characters from 0-9A-Za-z, without modulo bias. */
function randomBase62(n = 32) {
  let out = '';
  while (out.length < n) {
    for (const b of crypto.randomBytes(n * 2)) {
      if (b < 248) out += BASE62[b % 62];
      if (out.length === n) break;
    }
  }
  return out;
}

export const looksLikeKey = (raw) => KEY_RE.test(String(raw || ''));

/**
 * A website address a publishable key may be used from, normalised to
 * "scheme://host[:port]" (lowercase, no path). "example.com" means https.
 * "https://*.example.com" allows every subdomain. http only for localhost.
 * → the origin, or throws a 400 with a readable message.
 */
export function normalizeOrigin(input) {
  let v = String(input || '').trim().toLowerCase();
  if (!v) throw Object.assign(new Error('Add the website address, e.g. https://www.example.com'), { status: 400, code: 'INVALID_ORIGIN' });
  if (!/^[a-z]+:\/\//.test(v)) v = `https://${v}`;
  const m = v.match(/^(https?):\/\/(\*\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)*)(?::(\d{1,5}))?(?:\/.*)?$/);
  if (!m) throw Object.assign(new Error(`"${input}" isn't a website address. Use e.g. https://www.example.com`), { status: 400, code: 'INVALID_ORIGIN' });
  const [, scheme, wild = '', host, port] = m;
  const local = host === 'localhost' || host === '127.0.0.1';
  if (scheme === 'http' && !local) {
    throw Object.assign(new Error(`"${input}": use https:// (http:// is only allowed for localhost while you build).`), { status: 400, code: 'INVALID_ORIGIN' });
  }
  if (wild && host.split('.').length < 2) {
    throw Object.assign(new Error(`"${input}": a wildcard needs a domain, e.g. https://*.example.com`), { status: 400, code: 'INVALID_ORIGIN' });
  }
  return `${scheme}://${wild}${host}${port ? `:${port}` : ''}`;
}

/** Normalise a list of origins (unique, at most MAX_ORIGINS). */
export function normalizeOrigins(list) {
  const arr = Array.isArray(list) ? list : String(list || '').split(/[\s,]+/);
  const out = [...new Set(arr.map((o) => String(o || '').trim()).filter(Boolean).map(normalizeOrigin))];
  if (out.length > MAX_ORIGINS) {
    throw Object.assign(new Error(`A key can have at most ${MAX_ORIGINS} website addresses.`), { status: 400, code: 'TOO_MANY_ORIGINS' });
  }
  return out;
}

/** May a browser on `origin` use this key? (A request without an Origin header isn't from a browser page.) */
export function originAllowed(key, origin) {
  const o = String(origin || '').toLowerCase();
  if (!o) return true;
  return (key?.allowedOrigins || []).some((allowed) => {
    if (allowed === o) return true;
    const w = allowed.match(/^(https?):\/\/\*\.(.+)$/);
    if (!w) return false;
    const m = o.match(/^(https?):\/\/([^/]+)$/);
    return !!m && m[1] === w[1] && (m[2].endsWith(`.${w[2]}`));
  });
}

export const keyTypeOf = (k) => (k?.type === 'publishable' ? 'publishable' : 'secret');

const present = (k) => ({
  id: String(k._id),
  name: k.name || '',
  type: keyTypeOf(k),
  allowedOrigins: keyTypeOf(k) === 'publishable' ? (k.allowedOrigins || []) : [],
  prefix: k.prefix,
  lastFour: k.lastFour,
  createdAt: k.createdAt,
  lastUsedAt: k.lastUsedAt || null,
  requests: k.requests || 0,
});

export async function listKeys(businessId) {
  const rows = await ApiKey.find({ businessId, revokedAt: null }).sort({ createdAt: -1 }).lean();
  return rows.map(present);
}

/**
 * createKey(businessId, name) or createKey(businessId, { name, type, allowedOrigins }).
 * A publishable key needs at least one website address.
 * → { key: <the key, shown once>, ...present(row) }
 */
export async function createKey(businessId, opts = '') {
  const o = typeof opts === 'string' ? { name: opts } : (opts || {});
  const type = o.type === 'publishable' ? 'publishable' : 'secret';
  const allowedOrigins = type === 'publishable' ? normalizeOrigins(o.allowedOrigins) : [];
  if (type === 'publishable' && !allowedOrigins.length) {
    throw Object.assign(new Error('Add the website address(es) this key will be used on, e.g. https://www.example.com'), { status: 400, code: 'ORIGIN_REQUIRED' });
  }
  const active = await ApiKey.countDocuments({ businessId, revokedAt: null });
  if (active >= MAX_KEYS) {
    throw Object.assign(new Error(`You can have up to ${MAX_KEYS} API keys. Revoke one you no longer use first.`), { status: 409, code: 'KEY_LIMIT' });
  }
  const prefix = type === 'publishable' ? PUB_PREFIX : KEY_PREFIX;
  const secret = `${prefix}${randomBase62(32)}`;
  const row = await ApiKey.create({
    businessId,
    name: String(o.name || '').trim().slice(0, 60) || (type === 'publishable' ? 'Website key' : 'API key'),
    type,
    allowedOrigins,
    keyHash: hashKey(secret),
    prefix: secret.slice(0, prefix.length + 4),
    lastFour: secret.slice(-4),
  });
  return { key: secret, ...present(row) };
}

/** Rename a key, or change a publishable key's websites. → the key, or null. */
export async function updateKey(businessId, id, { name, allowedOrigins } = {}) {
  const row = await ApiKey.findOne({ _id: id, businessId, revokedAt: null }).lean();
  if (!row) return null;
  const set = {};
  if (name !== undefined) set.name = String(name || '').trim().slice(0, 60) || row.name;
  if (allowedOrigins !== undefined) {
    if (keyTypeOf(row) !== 'publishable') {
      throw Object.assign(new Error('Only publishable keys have website addresses.'), { status: 400, code: 'NOT_PUBLISHABLE' });
    }
    set.allowedOrigins = normalizeOrigins(allowedOrigins);
    if (!set.allowedOrigins.length) {
      throw Object.assign(new Error('A publishable key needs at least one website address.'), { status: 400, code: 'ORIGIN_REQUIRED' });
    }
  }
  if (Object.keys(set).length) await ApiKey.updateOne({ _id: row._id, businessId }, { $set: set });
  return present({ ...row, ...set });
}

export async function revokeKey(businessId, id) {
  const r = await ApiKey.updateOne({ _id: id, businessId, revokedAt: null }, { $set: { revokedAt: new Date() } });
  return !!r.matchedCount;
}

/** The live key row for a raw key, or null. */
export async function findKey(raw) {
  if (!looksLikeKey(raw)) return null;
  return ApiKey.findOne({ keyHash: hashKey(raw), revokedAt: null }).lean();
}

// Usage is written at most once a minute per key (each call would be a write).
const touched = new Map();
export function noteKeyUse(key, ip) {
  const id = String(key._id);
  const now = Date.now();
  const last = touched.get(id) || { at: 0, n: 0 };
  last.n += 1;
  if (now - last.at < 60_000) {
    touched.set(id, last);
    return;
  }
  const n = last.n;
  touched.set(id, { at: now, n: 0 });
  ApiKey.updateOne({ _id: key._id }, { $set: { lastUsedAt: new Date(now), lastUsedIp: String(ip || '').slice(0, 64) }, $inc: { requests: n } })
    .catch((err) => logger.debug('api key usage write failed', { error: err.message }));
}

// ---------------------------------------------------------------- one-time codes

export const OTP_MAX_ATTEMPTS = 5;
const otpHash = (businessId, phone, code) =>
  crypto.createHmac('sha256', pepper()).update(`otp:${businessId}:${phone}:${code}`).digest('hex');

/** Remember a code just sent (any older one to the same number stops counting). */
export async function storeOtp({ businessId, phone, templateName, code, metaMessageId, ttlMinutes }) {
  const now = new Date();
  await OtpCode.updateMany(
    { businessId, phone, verifiedAt: null, supersededAt: null },
    { $set: { supersededAt: now } },
  );
  const expiresAt = new Date(now.getTime() + Math.max(1, Math.min(90, Number(ttlMinutes) || 10)) * 60_000);
  await OtpCode.create({
    businessId, phone, templateName, metaMessageId: metaMessageId || '', codeHash: otpHash(businessId, phone, code), expiresAt,
    attempts: 0, verifiedAt: null, supersededAt: null,
  });
  return expiresAt;
}

/**
 * Check a code the user typed against the latest one sent to that number.
 * → { valid: true } | { valid: false, reason: 'not_found'|'expired'|'too_many_attempts'|'already_used'|'wrong_code', attemptsLeft? }
 */
export async function verifyOtp({ businessId, phone, code }) {
  const row = await OtpCode.findOne({ businessId, phone, supersededAt: null }).sort({ createdAt: -1 }).lean();
  if (!row) return { valid: false, reason: 'not_found' };
  if (row.verifiedAt) return { valid: false, reason: 'already_used' };
  if (new Date(row.expiresAt).getTime() <= Date.now()) return { valid: false, reason: 'expired' };
  const used = Number(row.attempts) || 0;
  if (used >= OTP_MAX_ATTEMPTS) return { valid: false, reason: 'too_many_attempts' };
  const want = Buffer.from(row.codeHash, 'hex');
  const got = Buffer.from(otpHash(businessId, phone, String(code || '').trim()), 'hex');
  const ok = want.length === got.length && crypto.timingSafeEqual(want, got);
  if (!ok) {
    // Counted only if still under the limit (two wrong guesses at once can't both slip through).
    await OtpCode.updateOne({ _id: row._id, attempts: { $lt: OTP_MAX_ATTEMPTS } }, { $inc: { attempts: 1 } });
    const left = Math.max(0, OTP_MAX_ATTEMPTS - used - 1);
    return { valid: false, reason: left ? 'wrong_code' : 'too_many_attempts', attemptsLeft: left };
  }
  // One use: only the request that marks it wins.
  const won = await OtpCode.updateOne({ _id: row._id, verifiedAt: null }, { $set: { verifiedAt: new Date() } });
  return won.matchedCount ? { valid: true } : { valid: false, reason: 'already_used' };
}

export default {
  createKey, listKeys, updateKey, revokeKey, findKey, noteKeyUse, hashKey, looksLikeKey, storeOtp, verifyOtp,
  normalizeOrigin, normalizeOrigins, originAllowed, keyTypeOf,
};
