// WhatsApp Flows data-endpoint encryption (RSA-OAEP + AES-GCM), per Meta spec.
// The tenant generates an RSA keypair (scripts/generate-flow-keys.js), uploads
// the public key to their WABA, and keeps the private key here.
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let privateKeyCache = null;

function loadPrivateKey() {
  if (privateKeyCache) return privateKeyCache;
  const passphrase = process.env.WA_FLOW_KEY_PASSPHRASE || '';
  let pem;
  if (process.env.FLOW_PRIVATE_KEY_B64) {
    pem = Buffer.from(process.env.FLOW_PRIVATE_KEY_B64, 'base64').toString('utf8');
  } else if (process.env.FLOW_PRIVATE_KEY) {
    pem = process.env.FLOW_PRIVATE_KEY.split('\\n').join('\n');
  } else {
    const p = process.env.WA_FLOW_PRIVATE_KEY_PATH || './keys/flow_private.pem';
    const abs = path.isAbsolute(p) ? p : path.join(__dirname, '..', p);
    pem = fs.readFileSync(abs, 'utf8');
  }
  privateKeyCache = passphrase
    ? crypto.createPrivateKey({ key: pem, passphrase })
    : crypto.createPrivateKey({ key: pem });
  return privateKeyCache;
}

export function decryptRequest(body) {
  const { encrypted_flow_data, encrypted_aes_key, initial_vector } = body;
  const privateKey = loadPrivateKey();

  const aesKeyBuffer = crypto.privateDecrypt(
    { key: privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    Buffer.from(encrypted_aes_key, 'base64'),
  );

  const flowDataBuffer = Buffer.from(encrypted_flow_data, 'base64');
  const initialVectorBuffer = Buffer.from(initial_vector, 'base64');

  const TAG_LENGTH = 16;
  const encryptedBody = flowDataBuffer.subarray(0, -TAG_LENGTH);
  const authTag = flowDataBuffer.subarray(-TAG_LENGTH);

  const decipher = crypto.createDecipheriv(`aes-${aesKeyBuffer.length * 8}-gcm`, aesKeyBuffer, initialVectorBuffer);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encryptedBody), decipher.final()]);

  return { decrypted: JSON.parse(decrypted.toString('utf-8')), aesKeyBuffer, initialVectorBuffer };
}

// Response IV is the request IV with all bits flipped; Meta expects base64 text.
export function encryptResponse(responseObj, aesKeyBuffer, initialVectorBuffer) {
  const flippedIv = Buffer.from(initialVectorBuffer.map((b) => ~b & 0xff));
  const cipher = crypto.createCipheriv(`aes-${aesKeyBuffer.length * 8}-gcm`, aesKeyBuffer, flippedIv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(responseObj), 'utf-8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([encrypted, authTag]).toString('base64');
}

export function keysAvailable() {
  try {
    loadPrivateKey();
    return true;
  } catch (err) {
    logger.warn('Flow private key not loadable', { error: err.message });
    return false;
  }
}

const keysDir = () => path.join(__dirname, '..', 'keys');
const privPath = () => path.join(keysDir(), 'flow_private.pem');
const pubPath = () => path.join(keysDir(), 'flow_public.pem');

/**
 * The public key Meta should encrypt endpoint requests with, generating the
 * keypair on first use. Endpoint-mode flows can't be published until Meta has
 * this, so publishing calls it rather than relying on a manual setup step.
 */
export function ensureFlowKeys() {
  // An explicitly configured key wins — then there's nothing to generate.
  if (process.env.FLOW_PRIVATE_KEY_B64 || process.env.FLOW_PRIVATE_KEY) {
    return fs.existsSync(pubPath()) ? fs.readFileSync(pubPath(), 'utf8') : '';
  }
  if (!fs.existsSync(privPath()) || !fs.existsSync(pubPath())) {
    const passphrase = process.env.WA_FLOW_KEY_PASSPHRASE || '';
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: passphrase
        ? { type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase }
        : { type: 'pkcs8', format: 'pem' },
    });
    fs.mkdirSync(keysDir(), { recursive: true });
    fs.writeFileSync(privPath(), privateKey);
    fs.writeFileSync(pubPath(), publicKey);
    privateKeyCache = null;
    logger.info('generated WhatsApp Flows endpoint keypair', { dir: keysDir() });
  }
  return fs.readFileSync(pubPath(), 'utf8');
}

export default { decryptRequest, encryptResponse, keysAvailable, ensureFlowKeys };
