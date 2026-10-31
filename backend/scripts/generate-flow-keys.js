// Generate an RSA keypair for WhatsApp Flows endpoint encryption.
// Writes backend/keys/flow_private.pem + flow_public.pem.
// Then upload the PUBLIC key to the WABA (Graph API: POST /{phone_number_id}/
// whatsapp_business_encryption with business_public_key) and set each endpoint
// flow's endpoint_uri to  <PUBLIC_BASE_URL>/api/whatsapp/flow-endpoint.
//
// Run: node scripts/generate-flow-keys.js
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const keysDir = path.join(__dirname, '..', 'keys');

const passphrase = process.env.WA_FLOW_KEY_PASSPHRASE || '';

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: passphrase
    ? { type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase }
    : { type: 'pkcs8', format: 'pem' },
});

fs.mkdirSync(keysDir, { recursive: true });
fs.writeFileSync(path.join(keysDir, 'flow_private.pem'), privateKey);
fs.writeFileSync(path.join(keysDir, 'flow_public.pem'), publicKey);

console.log('✅ Flow keys written to backend/keys/');
console.log('   flow_private.pem  (keep secret — never commit)');
console.log('   flow_public.pem   (upload to your WABA)');
console.log('\nNext:');
console.log('  1. Upload the public key to Meta:');
console.log('     POST /{phone_number_id}/whatsapp_business_encryption  { business_public_key: <flow_public.pem> }');
console.log('  2. Set WA_FLOW_PRIVATE_KEY_PATH / FLOW_PRIVATE_KEY_B64 in .env');
console.log('  3. Set each endpoint flow\'s endpoint_uri to <PUBLIC_BASE_URL>/api/whatsapp/flow-endpoint');
