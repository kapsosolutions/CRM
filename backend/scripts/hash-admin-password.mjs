// Make a SUPER_ADMIN_PASSWORD_HASH value for backend/.env, so the super
// admin password itself is never stored on the server.
//
//   node scripts/hash-admin-password.mjs            # generates a strong password
//   node scripts/hash-admin-password.mjs "<password>"
//
// Prints the password (only when generated) and the line to put in .env.
// Changing it signs every open admin session out.
import crypto from 'crypto';
import { hashAdminPassword } from '../services/auth.js';

const given = process.argv[2];
const password = given || crypto.randomBytes(18).toString('base64url');
if (password.length < 12) {
  console.error('Use at least 12 characters.');
  process.exit(1);
}
const hash = await hashAdminPassword(password);
if (!given) console.log(`password: ${password}`);
console.log(`SUPER_ADMIN_PASSWORD_HASH=${hash}`);
