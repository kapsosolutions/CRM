// ---------------------------------------------------------------------------
// Encryption at rest for third-party access tokens (Page access tokens for
// Messenger / Instagram, and later the ads connections).
//
// AES-256-GCM with a 32-byte key from TOKEN_ENC_KEY in backend/.env (base64 or
// 64 hex characters). If the key is missing it is generated once and appended
// to backend/.env, so tokens stored now can still be read after a restart.
// The key is never logged or returned anywhere.
//
// Stored form: "v1:" + base64(iv[12] | authTag[16] | ciphertext).
// ---------------------------------------------------------------------------
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from './logger.js';

const PREFIX = 'v1:';
const ENV_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env');

let cachedRaw = null;
let cachedKey = null;

function parseKey(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (/^[0-9a-f]{64}$/i.test(s)) return Buffer.from(s, 'hex');
  try {
    const b = Buffer.from(s, 'base64');
    if (b.length === 32) return b;
  } catch {
    /* fall through */
  }
  return null;
}

/** Create TOKEN_ENC_KEY in backend/.env (and this process) when it's missing. */
function generateKey() {
  const raw = crypto.randomBytes(32).toString('base64');
  try {
    const current = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '';
    if (/^\s*TOKEN_ENC_KEY\s*=\s*\S/m.test(current)) {
      // Another process wrote it meanwhile; this process just hadn't loaded it.
      const m = current.match(/^\s*TOKEN_ENC_KEY\s*=\s*(\S+)/m);
      process.env.TOKEN_ENC_KEY = m[1];
      return m[1];
    }
    const sep = current && !current.endsWith('\n') ? '\n' : '';
    fs.appendFileSync(
      ENV_FILE,
      `${sep}# Encrypts stored Page access tokens (Messenger / Instagram). Never share or change it:\n`
        + `# changing it makes every stored token unreadable.\nTOKEN_ENC_KEY=${raw}\n`,
    );
    logger.info('TOKEN_ENC_KEY was missing; a new key was generated and saved to backend/.env');
  } catch (err) {
    // Still usable for this process, but tokens won't survive a restart.
    logger.error('could not save the generated TOKEN_ENC_KEY to backend/.env', { error: err.message });
  }
  process.env.TOKEN_ENC_KEY = raw;
  return raw;
}

function key() {
  let raw = process.env.TOKEN_ENC_KEY;
  if (!raw || !String(raw).trim()) {
    // In production a missing key means the .env was lost or replaced: a new
    // key would silently make every stored token (and every backup's tokens)
    // unreadable, so refuse instead.
    if (process.env.NODE_ENV === 'production') throw new Error('TOKEN_ENC_KEY is not set');
    raw = generateKey();
  }
  if (raw === cachedRaw && cachedKey) return cachedKey;
  const k = parseKey(raw);
  if (!k) throw new Error('TOKEN_ENC_KEY must be 32 bytes, as base64 or 64 hex characters');
  cachedRaw = raw;
  cachedKey = k;
  return k;
}

/** Make sure a usable key exists (generating it if needed). Never returns it. */
export function ensureTokenKey() {
  key();
  return true;
}

export function encryptToken(plain) {
  if (plain == null || plain === '') return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64');
}

/** The plain token, or '' when there is none or it can't be decrypted. */
export function decryptToken(stored) {
  const s = String(stored || '');
  if (!s.startsWith(PREFIX)) return '';
  try {
    const buf = Buffer.from(s.slice(PREFIX.length), 'base64');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ct = buf.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch (err) {
    logger.warn('stored token could not be decrypted (wrong TOKEN_ENC_KEY?)', { error: err.message });
    return '';
  }
}

export const isEncryptedToken = (s) => String(s || '').startsWith(PREFIX);

export default { encryptToken, decryptToken, ensureTokenKey, isEncryptedToken };
