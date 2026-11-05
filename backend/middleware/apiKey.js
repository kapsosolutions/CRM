// Auth for the public API (/api/v1): a business API key instead of a login.
//
//   Authorization: Bearer kp_live_...      (or  X-API-Key: kp_live_...)
//
// Limits, per process (one server today):
//   - each key: API_RATE_PER_MIN requests a minute (default 120), with
//     X-RateLimit-* headers and 429 + Retry-After past it;
//   - each IP: 20 failed key checks in 10 minutes, then 429 for the rest of
//     the window (slows down anyone guessing keys).
import Business from '../models/Business.js';
import { findKey, noteKeyUse } from '../services/apiKeys.js';

const PER_MIN = () => Math.max(10, Number(process.env.API_RATE_PER_MIN) || 120);
const FAIL_WINDOW_MS = 10 * 60_000;
const FAIL_MAX = 20;

const windows = new Map(); // keyId -> { start, n }
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

  const biz = await Business.findById(key.businessId).catch(() => null);
  if (!biz || !biz.active) return apiError(res, 403, 'account_inactive', 'This account is inactive.');

  // Per-key fixed window.
  const id = String(key._id);
  const now = Date.now();
  let w = windows.get(id);
  if (!w || now - w.start >= 60_000) {
    w = { start: now, n: 0 };
    windows.set(id, w);
    sweep(windows, 60_000);
  }
  w.n += 1;
  const limit = PER_MIN();
  res.set('X-RateLimit-Limit', String(limit));
  res.set('X-RateLimit-Remaining', String(Math.max(0, limit - w.n)));
  res.set('X-RateLimit-Reset', String(Math.ceil((w.start + 60_000) / 1000)));
  if (w.n > limit) {
    res.set('Retry-After', String(Math.ceil((w.start + 60_000 - now) / 1000)));
    return apiError(res, 429, 'rate_limited', `Rate limit is ${limit} requests a minute per key.`);
  }

  noteKeyUse(key, ip);
  req.apiKey = key;
  req.business = biz;
  return next();
}

export default { requireApiKey, apiError };
