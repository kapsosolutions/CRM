// ---------------------------------------------------------------------------
// Instagram API with Instagram Login (Business Login for Instagram): the
// low-level pieces shared by the connect flow (services/instagramLogin.js),
// the reply path (services/metaChannels.js) and inbound profile lookups
// (services/metaChannelInbound.js). No dependency on either of those, so
// there is no import cycle.
//
// Meta's endpoints (docs: developers.facebook.com/docs/instagram-platform/
// instagram-api-with-instagram-login/business-login):
//   • https://www.instagram.com/oauth/authorize            → a code (1 hour, single use)
//   • POST https://api.instagram.com/oauth/access_token    → short-lived token (1 hour)
//   • GET  https://graph.instagram.com/access_token        → long-lived token (60 days)
//          ?grant_type=ig_exchange_token&client_secret=…&access_token=…
//   • GET  https://graph.instagram.com/refresh_access_token → another 60 days,
//          ?grant_type=ig_refresh_token&access_token=…     once the token is ≥ 24 h old
//   • https://graph.instagram.com/<ver>/me, /me/subscribed_apps, /<IG_ID>/messages
//
// The Instagram app id / secret are the ones under App Dashboard → Instagram →
// API setup with Instagram login → Business login settings. They are not
// META_APP_ID / META_APP_SECRET.
// ---------------------------------------------------------------------------
import axios from 'axios';
import ChannelConnection from '../models/ChannelConnection.js';
import { encryptToken } from './tokenCrypto.js';
import logger from './logger.js';

export const IG_SCOPES = ['instagram_business_basic', 'instagram_business_manage_messages'];
// Create (publishing) and Comment auto-DM. Only asked for once the app has
// them (App Review): set INSTAGRAM_PUBLISH_SCOPES=true. Until then the login
// asks for the messaging scopes alone, as before.
export const IG_PUBLISH_SCOPES = ['instagram_business_content_publish', 'instagram_business_manage_comments'];
export const igLoginScopes = () => (String(process.env.INSTAGRAM_PUBLISH_SCOPES || '').toLowerCase() === 'true'
  ? [...IG_SCOPES, ...IG_PUBLISH_SCOPES]
  : [...IG_SCOPES]);
// Instagram webhook fields for the account (POST /me/subscribed_apps): what the
// inbox files (metaChannelInbound.js handles messages, postbacks, seen, reactions).
export const IG_FIELDS = ['messages', 'messaging_postbacks', 'messaging_seen', 'message_reactions'];

const DAY_MS = 24 * 60 * 60 * 1000;
/** Meta only refreshes a long-lived token that is at least 24 hours old. */
export const REFRESH_MIN_AGE_MS = DAY_MS;
/** Refresh once the token is within 10 days of expiring. */
export const REFRESH_WITHIN_MS = 10 * DAY_MS;
/** When Meta doesn't say (expires_in missing), a long-lived token lasts 60 days. */
export const LONG_LIVED_MS = 60 * DAY_MS;

const igVersion = () => process.env.INSTAGRAM_GRAPH_VERSION || 'v25.0';
export const IG_ROOT = 'https://graph.instagram.com';
export const IG = () => `${IG_ROOT}/${igVersion()}`;
export const IG_AUTHORIZE = 'https://www.instagram.com/oauth/authorize';
export const IG_OAUTH_TOKEN = 'https://api.instagram.com/oauth/access_token';

export const http = axios.create({ timeout: 20000 });
const bearer = (token) => ({ headers: { Authorization: `Bearer ${token}` } });

// ------------------------------------------------------------- config --

/** Is Business Login for Instagram set up on this server? Never returns the secret. */
export function instagramLoginConfig() {
  const appId = String(process.env.INSTAGRAM_APP_ID || '').trim();
  const hasSecret = !!String(process.env.INSTAGRAM_APP_SECRET || '').trim();
  const base = String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/$/, '');
  const redirectUri = String(process.env.INSTAGRAM_REDIRECT_URI || '').trim() || (base ? `${base}/instagram-callback.html` : '');
  const missing = [];
  if (!appId) missing.push('INSTAGRAM_APP_ID');
  if (!hasSecret) missing.push('INSTAGRAM_APP_SECRET');
  if (!redirectUri) missing.push('INSTAGRAM_REDIRECT_URI (or PUBLIC_BASE_URL)');
  return { configured: missing.length === 0, appId, redirectUri, missing };
}

export const instagramAppSecret = () => String(process.env.INSTAGRAM_APP_SECRET || '').trim();

// ------------------------------------------------------------- errors --

/**
 * Meta's error from an Instagram call. graph.instagram.com answers in the
 * Graph format ({ error: { code, message } }); api.instagram.com/oauth in its
 * own ({ error_type, code, error_message }).
 */
export function igErr(err) {
  const d = err?.response?.data;
  if (d?.error && typeof d.error === 'object') return d.error;
  if (d && (d.error_message || d.error_type)) return { code: d.code, message: d.error_message || '', type: d.error_type || '' };
  return null;
}
export const igText = (err) => {
  const e = igErr(err);
  return e?.error_user_msg || e?.message || err?.message || 'Unknown error';
};
export const igInfo = (err) => {
  const e = igErr(err);
  return e ? { code: e.code, subcode: e.error_subcode, message: e.error_user_msg || e.message || '' } : null;
};
export const igRevoked = (err) => Number(igErr(err)?.code) === 190;

// ------------------------------------------------------- token checks --

const time = (d) => (d ? new Date(d).getTime() : NaN);
export const isInstagramLogin = (row) => row?.channel === 'instagram' && row?.loginMethod === 'instagram';

/** The stored long-lived token is past its expiry. */
export function tokenExpired(row, now = Date.now()) {
  const exp = time(row?.tokenExpiresAt);
  return Number.isFinite(exp) && exp <= now;
}

/** Old enough for Meta to refresh (≥ 24 h) and within 10 days of expiring. */
export function needsRefresh(row, now = Date.now()) {
  if (!isInstagramLogin(row)) return false;
  const exp = time(row.tokenExpiresAt);
  if (!Number.isFinite(exp) || exp <= now) return false;
  const issued = time(row.tokenRefreshedAt || row.connectedAt);
  if (!Number.isFinite(issued) || now - issued < REFRESH_MIN_AGE_MS) return false;
  return exp - now <= REFRESH_WITHIN_MS;
}

const expiryFrom = (expiresIn, now = Date.now()) => new Date(now + (Number(expiresIn) > 0 ? Number(expiresIn) * 1000 : LONG_LIVED_MS));

/** GET /refresh_access_token: another 60 days for a valid long-lived token. */
export async function refreshLongLivedToken(token) {
  const { data } = await http.get(`${IG_ROOT}/refresh_access_token`, {
    params: { grant_type: 'ig_refresh_token', access_token: token },
  });
  if (!data?.access_token) throw new Error('No access token in the refresh response');
  return { token: data.access_token, expiresAt: expiryFrom(data.expires_in) };
}

const inflight = new Map(); // row id -> Promise<{ token, refreshed }>

/**
 * Refresh an 'instagram'-method connection's token when it is due (or when
 * `force`), store the new one encrypted, and return the token to use.
 * Error 190 is rethrown (the caller marks the connection disconnected); any
 * other failure is logged and the current token is used.
 * Concurrent calls for one row share one refresh. The row object passed in is
 * updated in place.
 */
export async function refreshIfDue(row, token, { force = false } = {}) {
  if (!isInstagramLogin(row) || !token) return { token, refreshed: false };
  if (!force && !needsRefresh(row)) return { token, refreshed: false };
  const key = String(row._id);
  if (inflight.has(key)) return inflight.get(key);
  const run = (async () => {
    let fresh;
    try {
      fresh = await refreshLongLivedToken(token);
    } catch (err) {
      if (igRevoked(err)) throw err;
      logger.warn('Instagram token refresh failed, using the current token', { error: igText(err) });
      return { token, refreshed: false, error: igText(err) };
    }
    const encrypted = encryptToken(fresh.token);
    const now = new Date();
    // Only replaces the token this refresh started from (idempotent across callers).
    await ChannelConnection.updateOne(
      { _id: row._id, pageAccessToken: row.pageAccessToken, status: 'connected' },
      { $set: { pageAccessToken: encrypted, tokenExpiresAt: fresh.expiresAt, tokenRefreshedAt: now } },
    );
    Object.assign(row, { pageAccessToken: encrypted, tokenExpiresAt: fresh.expiresAt, tokenRefreshedAt: now });
    return { token: fresh.token, refreshed: true };
  })();
  inflight.set(key, run);
  try {
    return await run;
  } finally {
    inflight.delete(key);
  }
}

// ------------------------------------------------------------ webhooks --

/** POST /me/subscribed_apps: the account's messages reach the app's Instagram webhook. */
export async function subscribeInstagram(token, fields = IG_FIELDS) {
  const { data } = await http.post(`${IG()}/me/subscribed_apps`, null, {
    params: { subscribed_fields: fields.join(',') },
    ...bearer(token),
  });
  if (data && data.success === false) throw new Error('Meta did not confirm the webhook subscription');
  return true;
}

/**
 * Best-effort: remove the app's webhook subscription for the account
 * (DELETE /me/subscribed_apps). Meta documents only the POST for Instagram
 * Login, so a refusal is logged and ignored. Never throws.
 */
export async function unsubscribeInstagram(token) {
  if (!token) return false;
  try {
    await http.delete(`${IG()}/me/subscribed_apps`, bearer(token));
    return true;
  } catch (err) {
    logger.warn('could not unsubscribe the Instagram account from the app', { error: igText(err) });
    return false;
  }
}

export default {
  IG_SCOPES, IG_PUBLISH_SCOPES, igLoginScopes, IG_FIELDS, IG, IG_ROOT, IG_AUTHORIZE, IG_OAUTH_TOKEN, http, instagramLoginConfig, instagramAppSecret,
  igErr, igText, igInfo, igRevoked, isInstagramLogin, tokenExpired, needsRefresh, refreshLongLivedToken, refreshIfDue,
  subscribeInstagram, unsubscribeInstagram,
};
