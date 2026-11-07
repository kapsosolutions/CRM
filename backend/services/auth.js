// Lightweight auth: signed stateless tokens (HMAC-SHA256, JWT-like) and scrypt
// passcode hashing — no external deps. One server secret signs all tokens.
import crypto from 'crypto';
import { promisify } from 'util';

const scrypt = promisify(crypto.scrypt);

const DEV_SECRET = 'dev-insecure-secret-change-me';
const SECRET = () => process.env.AUTH_SECRET || DEV_SECRET;
const TTL_SECONDS = Number(process.env.AUTH_TTL_SECONDS || 60 * 60 * 24 * 7); // 7 days
// The super admin opens every tenant, so its sessions are short.
export const ADMIN_TTL_SECONDS = Number(process.env.ADMIN_TOKEN_TTL_SECONDS || 60 * 60 * 8); // 8 hours

/**
 * Called at startup. In production a missing or short AUTH_SECRET would let
 * anyone mint tokens with the public dev secret, so the server refuses to run.
 */
export function assertAuthSecret() {
  const s = process.env.AUTH_SECRET || '';
  if (process.env.NODE_ENV === 'production' && s.length < 32) {
    throw new Error('AUTH_SECRET must be set to at least 32 characters in production');
  }
}

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

// ---------- Passcode hashing (scrypt, async so a login never blocks the event loop) ----------
export async function hashPasscode(passcode) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = (await scrypt(String(passcode), salt, 32)).toString('hex');
  return { hash, salt };
}
export async function verifyPasscode(passcode, hash, salt) {
  if (!hash || !salt) return false;
  const candidate = await scrypt(String(passcode), salt, 32);
  const stored = Buffer.from(hash, 'hex');
  return candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored);
}

// ---------- Super admin credentials ----------

/** Constant-time string compare (hashing first so lengths don't leak). */
export function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a ?? '')).digest();
  const hb = crypto.createHash('sha256').update(String(b ?? '')).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export const adminUsername = () => process.env.SUPER_ADMIN_USERNAME || process.env.ADMIN_USERNAME || 'admin';

/**
 * The configured admin password material: SUPER_ADMIN_PASSWORD_HASH
 * ("scrypt:<salt>:<hex>", made with `node scripts/hash-admin-password.mjs`)
 * wins over the plain SUPER_ADMIN_PASSWORD. '' = admin login not configured.
 */
const adminSecretMaterial = () =>
  process.env.SUPER_ADMIN_PASSWORD_HASH || process.env.SUPER_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || '';

export const adminConfigured = () => Boolean(adminSecretMaterial());

/** Make a SUPER_ADMIN_PASSWORD_HASH value. */
export async function hashAdminPassword(password) {
  const { hash, salt } = await hashPasscode(password);
  return `scrypt:${salt}:${hash}`;
}

/** Do these credentials open the super admin? Always does the same work. */
export async function adminCredentialsMatch(username, password) {
  const userOk = safeEqual(username, adminUsername());
  const stored = process.env.SUPER_ADMIN_PASSWORD_HASH || '';
  let passOk = false;
  if (stored) {
    const [scheme, salt, hash] = stored.split(':');
    passOk = scheme === 'scrypt' && salt && hash ? await verifyPasscode(String(password ?? ''), hash, salt) : false;
  } else {
    const plain = process.env.SUPER_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || '';
    passOk = Boolean(plain) && safeEqual(password, plain);
  }
  return userOk && passOk;
}

/**
 * The admin credential generation, carried in admin tokens as `av`. Derived
 * from the configured password, so changing the admin password signs every
 * existing admin session out on its next request.
 */
export function adminTokenVersion() {
  return crypto.createHmac('sha256', SECRET()).update(`admin:${adminUsername()}:${adminSecretMaterial()}`).digest('base64url').slice(0, 16);
}

/** Is this verified token payload a current super admin session? */
export const isCurrentAdmin = (payload) =>
  Boolean(payload) && payload.role === 'admin' && adminConfigured() && payload.av === adminTokenVersion();

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
