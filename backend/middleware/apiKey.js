// Auth for the public API (/api/v1): a business API key instead of a login.
//
//   Authorization: Bearer kp_live_...      (or  X-API-Key: kp_live_...)
//
// Two kinds of key (services/apiKeys.js):
//   secret       kp_live_…  server-side only. A request carrying a browser
//                           Origin header is refused, so a secret key pasted
//                           into a web page stops working instead of leaking.
//   publishable  kp_pub_…   GET requests to the read-only data endpoints
//                           (PUBLISHABLE_PATHS), from the key's own websites.
//
// Limits, per process (one server today):
//   - secret key: API_RATE_PER_MIN requests a minute (default 120);
//   - publishable key: API_PUB_RATE_PER_MIN per visitor IP (default 60) and
//     API_PUB_TOTAL_PER_MIN for the key overall (default 1200);
//   - each IP: 20 failed key checks in 10 minutes, then 429 for the rest of
//     the window (slows down anyone guessing keys).
// Every limit answers 429 with Retry-After, and X-RateLimit-* headers.
import Business from '../models/Business.js';
import { findKey, noteKeyUse, originAllowed, keyTypeOf } from '../services/apiKeys.js';

const PER_MIN = () => Math.max(10, Number(process.env.API_RATE_PER_MIN) || 120);
const PUB_PER_IP = () => Math.max(10, Number(process.env.API_PUB_RATE_PER_MIN) || 60);
const PUB_TOTAL = () => Math.max(60, Number(process.env.API_PUB_TOTAL_PER_MIN) || 1200);
const FAIL_WINDOW_MS = 10 * 60_000;
const FAIL_MAX = 20;

/** What a publishable key may read (GET only). */
export const PUBLISHABLE_PATHS = [/^\/business$/, /^\/catalog(\/|$)/, /^\/members(\/|$)/, /^\/offers(\/|$)/];

const windows = new Map(); // bucket -> { start, n }
const failures = new Map(); // ip -> { start, n }

function sweep(map, ttl) {
  if (map.size < 5000) return;
  const now = Date.now();
  for (const [k, v] of map) if (now - v.start > ttl) map.delete(k);
}

export const apiError = (res, status, code, message, extra = {}) =>
  res.status(status).json({ error: { code, message, ...extra } });

function rawKey(req) {
  const auth = req.get('authorization') || '';
  const m = auth.match(/^Bearer\s+(\S+)$/i);
  return (m ? m[1] : req.get('x-api-key') || '').trim();
}

/** Count one request in a fixed one-minute window → { n, start }. */
function hit(bucket) {
  const now = Date.now();
  let w = windows.get(bucket);
  if (!w || now - w.start >= 60_000) {
    w = { start: now, n: 0 };
    windows.set(bucket, w);
    sweep(windows, 60_000);
  }
  w.n += 1;
  return w;
}

/**
 * CORS for /api/v1, mounted before the app-wide CORS. Any website may ask
 * (the preflight carries no key); whether it may use the answer is decided
 * by the key: requireApiKey refuses a secret key from a browser and a
 * publishable key from a website it doesn't list. No cookies are involved,
 * so reflecting the Origin back is safe.
 */
export function apiCors(req, res, next) {
  const origin = req.get('origin');
  if (origin) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
    res.set('Access-Control-Expose-Headers', 'X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, Retry-After, Idempotent-Replayed');
  }
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Authorization, X-API-Key, Content-Type, Idempotency-Key');
    res.set('Access-Control-Max-Age', '600');
    return res.status(204).end();
  }
  return next();
}

export async function requireApiKey(req, res, next) {
  const ip = req.ip || '';
  const f = failures.get(ip);
  if (f && Date.now() - f.start < FAIL_WINDOW_MS && f.n >= FAIL_MAX) {
    res.set('Retry-After', String(Math.ceil((f.start + FAIL_WINDOW_MS - Date.now()) / 1000)));
    return apiError(res, 429, 'too_many_failed_attempts', 'Too many requests with an invalid API key. Try again later.');
  }
  const fail = (status, code, message) => {
    const cur = failures.get(ip);
    if (!cur || Date.now() - cur.start >= FAIL_WINDOW_MS) failures.set(ip, { start: Date.now(), n: 1 });
    else cur.n += 1;
    sweep(failures, FAIL_WINDOW_MS);
    return apiError(res, status, code, message);
  };

  const raw = rawKey(req);
  if (!raw) return fail(401, 'missing_api_key', 'Send your API key as "Authorization: Bearer <key>".');
  let key;
  try {
    key = await findKey(raw);
  } catch {
    return apiError(res, 503, 'unavailable', 'The API is unavailable right now. Please retry.');
  }
  if (!key) return fail(401, 'invalid_api_key', 'This API key isn’t valid, or it was revoked.');

  // Where the key may be used from.
  const type = keyTypeOf(key);
  const origin = req.get('origin') || '';
  if (type === 'secret' && origin) {
    return apiError(res, 403, 'secret_key_in_browser', 'Secret keys (kp_live_…) only work from your server. In a web page, use a publishable key (kp_pub_…).');
  }
  if (type === 'publishable') {
    if (req.method !== 'GET' || !PUBLISHABLE_PATHS.some((re) => re.test(req.path))) {
      return apiError(res, 403, 'publishable_key_read_only', 'Publishable keys can only read your catalog, categories, members, slots and offers. Use a secret key from your server for this.');
    }
    if (origin && !originAllowed(key, origin)) {
      return apiError(res, 403, 'origin_not_allowed', `This key isn't set up for ${origin}. Add the website to the key in the CRM.`);
    }
  }

  const biz = await Business.findById(key.businessId).catch(() => null);
  if (!biz || !biz.active) return apiError(res, 403, 'account_inactive', 'This account is inactive.');

  // Rate limits.
  const id = String(key._id);
  const checks = type === 'publishable'
    ? [[`${id}|${ip}`, PUB_PER_IP(), 'per visitor'], [id, PUB_TOTAL(), 'for this key']]
    : [[id, PER_MIN(), 'per key']];
  for (const [bucket, limit, what] of checks) {
    const w = hit(bucket);
    if (bucket === checks[0][0]) {
      res.set('X-RateLimit-Limit', String(limit));
      res.set('X-RateLimit-Remaining', String(Math.max(0, limit - w.n)));
      res.set('X-RateLimit-Reset', String(Math.ceil((w.start + 60_000) / 1000)));
    }
    if (w.n > limit) {
      res.set('Retry-After', String(Math.ceil((w.start + 60_000 - Date.now()) / 1000)));
      return apiError(res, 429, 'rate_limited', `Rate limit is ${limit} requests a minute ${what}.`);
    }
  }

  noteKeyUse(key, ip);
  req.apiKey = key;
  req.business = biz;
  return next();
}

export default { requireApiKey, apiError, apiCors, PUBLISHABLE_PATHS };
