// Lightweight auth: signed stateless tokens (HMAC-SHA256, JWT-like) and scrypt
// passcode hashing — no external deps. One server secret signs all tokens.
import crypto from 'crypto';

const SECRET = () => process.env.AUTH_SECRET || 'dev-insecure-secret-change-me';
const TTL_SECONDS = Number(process.env.AUTH_TTL_SECONDS || 60 * 60 * 24 * 7); // 7 days

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const fromB64url = (s) => Buffer.from(s, 'base64url').toString('utf8');

// ---------- Tokens ----------
export function signToken(payload, ttl = TTL_SECONDS) {
  const body = { ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + ttl };
  const data = b64url(JSON.stringify(body));
  const sig = crypto.createHmac('sha256', SECRET()).update(data).digest('base64url');
  return `${data}.${sig}`;
}

export function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [data, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', SECRET()).update(data).digest('base64url');
  const a = Buffer.from(sig || '');
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(fromB64url(data));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

// ---------- Passcode hashing (scrypt) ----------
export function hashPasscode(passcode) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(passcode), salt, 32).toString('hex');
  return { hash, salt };
}
export function verifyPasscode(passcode, hash, salt) {
  if (!hash || !salt) return false;
  const candidate = crypto.scryptSync(String(passcode), salt, 32);
  const stored = Buffer.from(hash, 'hex');
  return candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored);
}

// ---------- Generators ----------
const slug = (s) =>
  String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 14) || 'biz';

export function generateUsername(name) {
  return `${slug(name)}_${crypto.randomBytes(2).toString('hex')}`;
}
export function generatePasscode() {
  // 6-digit numeric, no leading-zero issues (100000–999999).
  return String(crypto.randomInt(100000, 1000000));
}
export function generateVerifyToken() {
  return crypto.randomBytes(18).toString('hex');
}

export default {
  signToken,
  verifyToken,
  hashPasscode,
  verifyPasscode,
  generateUsername,
  generatePasscode,
  generateVerifyToken,
};
