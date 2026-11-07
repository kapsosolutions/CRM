// ---------------------------------------------------------------------------
// Supabase Auth — where business owners' passwords and Google identities live.
//
// The backend talks to Supabase's Auth REST API directly:
//   • users are created through the admin API (service-role key) with the
//     email already confirmed, so sign-up isn't held hostage by Supabase's
//     built-in mailer and its few-emails-an-hour limit;
//   • passwords are checked with the normal password grant (publishable key);
//   • a Google sign-in is proven by the access token Supabase hands the
//     browser, which is exchanged here for the user it belongs to.
// The CRM keeps issuing its own session tokens afterwards — Supabase is only
// the identity provider.
// ---------------------------------------------------------------------------
import axios from 'axios';
import logger from './logger.js';

const url = () => String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const publishable = () => process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '';
const serviceRole = () => process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export class AuthError extends Error {
  constructor(message, status = 400, code = '') {
    super(message);
    this.name = 'AuthError';
    this.status = status;
    this.code = code;
  }
}

const http = axios.create({ timeout: 15000 });

function adminHeaders() {
  const key = serviceRole();
  if (!key) throw new AuthError('Sign-up is not configured on the server (SUPABASE_SERVICE_ROLE_KEY missing).', 500);
  return { apikey: key, Authorization: `Bearer ${key}` };
}

/** Supabase's error body → a readable message. */
const reason = (err) =>
  err.response?.data?.msg || err.response?.data?.message || err.response?.data?.error_description ||
  err.response?.data?.error || err.message;

const isEmailTaken = (err) => {
  const d = err.response?.data || {};
  return err.response?.status === 422 && /already|exists|registered/i.test(`${d.code || ''} ${d.msg || ''} ${d.message || ''}`);
};

/** Create a confirmed email + password user. Throws AuthError(409) if the email is taken. */
export async function createUser({ email, password, metadata = {} }) {
  try {
    const { data } = await http.post(
      `${url()}/auth/v1/admin/users`,
      { email, password, email_confirm: true, user_metadata: metadata },
      { headers: adminHeaders() },
    );
    return data;
  } catch (err) {
    if (err instanceof AuthError) throw err;
    if (isEmailTaken(err)) throw new AuthError('An account with this email already exists. Sign in instead.', 409, 'email_exists');
    // Supabase's password policy (length / strength) comes back as 422 too.
    if (err.response?.status === 422) throw new AuthError(reason(err), 400, 'weak_password');
    logger.error('supabase createUser failed', { status: err.response?.status, error: reason(err) });
    throw new AuthError('Could not create the account right now. Please try again.', 502);
  }
}

/** Update a user (password / email / metadata) through the admin API. */
export async function updateUser(id, patch) {
  try {
    const { data } = await http.put(`${url()}/auth/v1/admin/users/${encodeURIComponent(id)}`, patch, {
      headers: adminHeaders(),
    });
    return data;
  } catch (err) {
    if (err instanceof AuthError) throw err;
    if (isEmailTaken(err)) throw new AuthError('That email is already used by another account.', 409, 'email_exists');
    if (err.response?.status === 422) throw new AuthError(reason(err), 400);
    logger.error('supabase updateUser failed', { status: err.response?.status, error: reason(err) });
    throw new AuthError('Could not update the account right now.', 502);
  }
}

export async function deleteUser(id) {
  if (!id) return;
  try {
    await http.delete(`${url()}/auth/v1/admin/users/${encodeURIComponent(id)}`, { headers: adminHeaders() });
  } catch (err) {
    logger.warn('supabase deleteUser failed', { id, error: reason(err) });
  }
}

/**
 * Check an email + password. Returns the Supabase user, or null when the
 * credentials are wrong (never throws for a bad password).
 */
export async function signInWithPassword(email, password) {
  try {
    const { data } = await http.post(
      `${url()}/auth/v1/token?grant_type=password`,
      { email, password },
      { headers: { apikey: publishable() } },
    );
    return data?.user || null;
  } catch (err) {
    const s = err.response?.status;
    if (s === 400 || s === 401 || s === 422) return null;
    logger.error('supabase password sign-in failed', { status: s, error: reason(err) });
    throw new AuthError('Sign-in is unavailable right now. Please try again.', 502);
  }
}

/** The user behind a Supabase access token (e.g. from a Google sign-in), or null. */
export async function userFromAccessToken(accessToken) {
  if (!accessToken) return null;
  try {
    const { data } = await http.get(`${url()}/auth/v1/user`, {
      headers: { apikey: publishable(), Authorization: `Bearer ${accessToken}` },
    });
    return data || null;
  } catch (err) {
    if ([401, 403].includes(err.response?.status)) return null;
    logger.error('supabase getUser failed', { status: err.response?.status, error: reason(err) });
    throw new AuthError('Could not verify the Google sign-in. Please try again.', 502);
  }
}

/**
 * Is this Supabase user a real, verified Google sign-in? The access token
 * alone isn't enough: an email + password user (who may never have proved
 * they own the address) gets a token too. Requires a Google identity and a
 * confirmed email.
 */
export function isVerifiedGoogleUser(user) {
  if (!user?.id || !user.email) return false;
  const providers = [
    ...(Array.isArray(user.app_metadata?.providers) ? user.app_metadata.providers : []),
    user.app_metadata?.provider,
    ...(Array.isArray(user.identities) ? user.identities.map((i) => i?.provider) : []),
  ];
  if (!providers.includes('google')) return false;
  return Boolean(user.email_confirmed_at || user.confirmed_at);
}

/** Which providers are switched on in the Supabase project (cached a minute). */
let settingsCache = null;
let settingsAt = 0;
export async function authSettings() {
  if (settingsCache && Date.now() - settingsAt < 60_000) return settingsCache;
  try {
    const { data } = await http.get(`${url()}/auth/v1/settings`, { headers: { apikey: publishable() } });
    settingsCache = { google: !!data?.external?.google, email: !!data?.external?.email };
  } catch {
    settingsCache = { google: false, email: true };
  }
  settingsAt = Date.now();
  return settingsCache;
}

/** First / last name from a Google identity's metadata. */
export function namesFromUser(user) {
  const m = user?.user_metadata || {};
  const full = String(m.full_name || m.name || '').trim();
  const [first, ...rest] = full.split(/\s+/);
  return {
    firstName: String(m.given_name || m.first_name || first || '').trim(),
    lastName: String(m.family_name || m.last_name || rest.join(' ') || '').trim(),
    email: String(user?.email || '').trim().toLowerCase(),
    // Google profile photo, for the "signed in as" card on the sign-up form.
    avatarUrl: String(m.avatar_url || m.picture || '').trim(),
  };
}

export const supabaseUrl = url;

export default {
  AuthError, createUser, updateUser, deleteUser, signInWithPassword, userFromAccessToken,
  authSettings, namesFromUser, supabaseUrl, isVerifiedGoogleUser,
};
