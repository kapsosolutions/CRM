// Brute-force protection for the sign-in endpoints.
//
// Two counters, both sliding windows kept in this process's memory (the
// backend runs as one process, so memory is the whole picture; a restart
// clears them, which only ever helps a legitimate user):
//
//   • per client IP — every attempt on a sign-in endpoint, so one address
//     can't spray passwords across many accounts;
//   • per account — failed attempts only, so a password can't be guessed by
//     rotating addresses. When it trips, the account is locked for a while
//     (successful sign-ins never count against it).
//
// The checks answer 429 with a Retry-After header and the same wording for
// every account, so the lockout doesn't reveal whether an account exists.

const buckets = new Map(); // key -> number[] (attempt times, ms)
const locks = new Map(); // key -> lockedUntil (ms)
const MAX_KEYS = 50_000; // a hard memory ceiling, whatever an attacker sends

const now = () => Date.now();

function recent(key, windowMs) {
  const t = now();
  const list = (buckets.get(key) || []).filter((at) => t - at < windowMs);
  if (list.length) buckets.set(key, list);
  else buckets.delete(key);
  return list;
}

function push(key, windowMs) {
  const list = recent(key, windowMs);
  if (!buckets.has(key) && buckets.size >= MAX_KEYS) {
    // Drop the oldest key rather than grow without bound.
    buckets.delete(buckets.keys().next().value);
  }
  list.push(now());
  buckets.set(key, list);
  return list.length;
}

/** Seconds until `key` is unlocked, 0 when it isn't locked. */
function lockedFor(key) {
  const until = locks.get(key) || 0;
  if (until <= now()) {
    locks.delete(key);
    return 0;
  }
  return Math.ceil((until - now()) / 1000);
}

// Limits per kind of sign-in. Admin is the strictest: one account, and it
// opens every tenant.
export const POLICIES = {
  login: { ipLimit: 30, ipWindowMs: 10 * 60_000, failLimit: 8, failWindowMs: 15 * 60_000, lockMs: 15 * 60_000 },
  admin: { ipLimit: 10, ipWindowMs: 15 * 60_000, failLimit: 5, failWindowMs: 15 * 60_000, lockMs: 30 * 60_000 },
  register: { ipLimit: 20, ipWindowMs: 60 * 60_000 },
  google: { ipLimit: 30, ipWindowMs: 10 * 60_000 },
};

const ipKey = (kind, ip) => `ip:${kind}:${ip || '?'}`;
const acctKey = (kind, account) => `acct:${kind}:${String(account || '').trim().toLowerCase()}`;

/**
 * Count this attempt against the client IP and refuse it when the IP or the
 * account is over its limit. → { ok: true } | { ok: false, retryAfter }
 */
export function checkAttempt(kind, { ip, account } = {}) {
  const p = POLICIES[kind];
  if (!p) return { ok: true };
  if (account && p.failLimit) {
    const wait = lockedFor(acctKey(kind, account));
    if (wait) return { ok: false, retryAfter: wait };
  }
  const ipWait = lockedFor(ipKey(kind, ip));
  if (ipWait) return { ok: false, retryAfter: ipWait };
  const count = push(ipKey(kind, ip), p.ipWindowMs);
  if (count > p.ipLimit) {
    locks.set(ipKey(kind, ip), now() + p.ipWindowMs);
    return { ok: false, retryAfter: Math.ceil(p.ipWindowMs / 1000) };
  }
  return { ok: true };
}

/** A wrong password for `account`: may lock the account. */
export function recordFailure(kind, account) {
  const p = POLICIES[kind];
  if (!p?.failLimit || !account) return;
  const key = acctKey(kind, account);
  const count = push(key, p.failWindowMs);
  if (count >= p.failLimit) {
    locks.set(key, now() + p.lockMs);
    buckets.delete(key);
  }
}

/** A good sign-in: the account's failure count starts again. */
export function recordSuccess(kind, account) {
  if (!account) return;
  buckets.delete(acctKey(kind, account));
}

/** Express helper: answer 429 for a refused attempt. Returns true when it did. */
export function refuse(res, verdict) {
  if (verdict.ok) return false;
  res.set('Retry-After', String(verdict.retryAfter));
  const minutes = Math.max(1, Math.ceil(verdict.retryAfter / 60));
  res.status(429).json({
    success: false,
    code: 'TOO_MANY_ATTEMPTS',
    message: `Too many sign-in attempts. Please wait ${minutes} minute${minutes === 1 ? '' : 's'} and try again.`,
  });
  return true;
}

/** Tests only. */
export function _resetLoginGuard() {
  buckets.clear();
  locks.clear();
}

// Forget expired entries now and then so idle keys don't pile up.
setInterval(() => {
  const t = now();
  for (const [k, until] of locks) if (until <= t) locks.delete(k);
  for (const [k, list] of buckets) if (!list.length || t - list[list.length - 1] > 60 * 60_000) buckets.delete(k);
}, 10 * 60_000).unref();
