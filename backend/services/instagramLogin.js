// ---------------------------------------------------------------------------
// Channel Status → Instagram → "Log in with Instagram": connecting an
// Instagram professional account through Business Login for Instagram
// (Instagram API with Instagram Login). No Facebook Page is involved.
//
//   1. GET /api/channels/instagram/login-url: the authorize URL with a signed,
//      short-lived `state` bound to the business (CSRF protection).
//   2. The browser opens it in a popup; Instagram sends the popup back to
//      INSTAGRAM_REDIRECT_URI (frontend/public/instagram-callback.html) with
//      ?code&state, and that page hands both to the CRM window.
//   3. POST /api/channels/instagram/connect { code, state }:
//      state checked → code → short-lived token → long-lived token (60 days)
//      → GET /me (must be a professional account, not connected to another
//      business) → POST /me/subscribed_apps → the token is stored encrypted
//      on the business's ChannelConnection row (channel 'instagram',
//      loginMethod 'instagram').
//
// The long-lived token is refreshed on use (services/metaChannels.js
// withConnectionToken) and by a daily sweep (startInstagramTokenRefresh,
// started from server.js like the other background jobs). Error 190 or an
// expired token marks the connection disconnected with one notification
// (metaChannels.markRevoked). Tokens never appear in a response or a log line.
// ---------------------------------------------------------------------------
import crypto from 'crypto';
import ChannelConnection from '../models/ChannelConnection.js';
import CommentRule from '../models/CommentRule.js';
import { encryptToken, decryptToken } from './tokenCrypto.js';
import { notify } from './notifications.js';
import {
  ChannelError, listConnections, markRevoked, unsubscribePage, expiredTokenError,
} from './metaChannels.js';
import {
  IG, IG_ROOT, IG_AUTHORIZE, IG_OAUTH_TOKEN, igLoginScopes, IG_FIELDS, LONG_LIVED_MS, http, instagramLoginConfig,
  instagramAppSecret, igText, igInfo, igRevoked, isInstagramLogin, tokenExpired, refreshIfDue, subscribeInstagram,
  unsubscribeInstagram,
} from './instagramGraph.js';
import logger from './logger.js';

const STATE_TTL_MS = 10 * 60 * 1000;
const PROFESSIONAL = ['BUSINESS', 'MEDIA_CREATOR', 'CREATOR'];
const bearer = (token) => ({ headers: { Authorization: `Bearer ${token}` } });

export const INSTAGRAM_NOT_CONFIGURED = 'Log in with Instagram isn’t set up on this server yet. The platform owner needs to add '
  + 'the Instagram product ("API setup with Instagram login") to the Meta app and set INSTAGRAM_APP_ID and '
  + 'INSTAGRAM_APP_SECRET on the server. You can still connect with Facebook.';

function requireIgConfig() {
  const cfg = instagramLoginConfig();
  if (!cfg.configured) throw new ChannelError(INSTAGRAM_NOT_CONFIGURED, { status: 409, code: 'INSTAGRAM_NOT_CONFIGURED' });
  return cfg;
}

// --------------------------------------------------------------- state --

// HMAC key for `state`: the server's auth secret plus the Instagram app
// secret, so a state can't be minted without both.
const stateKey = () => crypto.createHash('sha256')
  .update(`instagram-login-state|${process.env.AUTH_SECRET || 'dev-insecure-secret-change-me'}|${instagramAppSecret()}`)
  .digest();
const sign = (data) => crypto.createHmac('sha256', stateKey()).update(data).digest('base64url');
const used = new Map(); // nonce -> expiresAt (each state is accepted once)

function sweepUsed(now = Date.now()) {
  for (const [n, exp] of used) if (exp < now) used.delete(n);
}

/** A signed state bound to the business, valid for 10 minutes. */
export function createState(businessId, now = Date.now()) {
  const payload = { b: String(businessId), n: crypto.randomBytes(12).toString('base64url'), e: now + STATE_TTL_MS };
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return { state: `${data}.${sign(data)}`, expiresAt: new Date(payload.e) };
}

const stateError = (code, message) => new ChannelError(message, { status: 400, code });

/**
 * Check a state came from createState for this business, hasn't expired and
 * hasn't been used. Marks it used. Throws STATE_INVALID / STATE_EXPIRED /
 * STATE_MISMATCH / STATE_USED.
 */
export function verifyState(state, businessId, now = Date.now()) {
  const again = 'Click Connect Instagram again.';
  const s = String(state || '');
  const [data, sig, extra] = s.split('.');
  if (!data || !sig || extra !== undefined) throw stateError('STATE_INVALID', `This Instagram login isn’t valid. ${again}`);
  const want = Buffer.from(sign(data));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) {
    throw stateError('STATE_INVALID', `This Instagram login isn’t valid. ${again}`);
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
  } catch {
    throw stateError('STATE_INVALID', `This Instagram login isn’t valid. ${again}`);
  }
  if (!payload?.n || !Number(payload.e)) throw stateError('STATE_INVALID', `This Instagram login isn’t valid. ${again}`);
  if (Number(payload.e) < now) throw stateError('STATE_EXPIRED', `The Instagram login took too long and expired. ${again}`);
  if (String(payload.b) !== String(businessId)) {
    throw stateError('STATE_MISMATCH', `This Instagram login was started from another CRM account. ${again}`);
  }
  sweepUsed(now);
  if (used.has(payload.n)) throw stateError('STATE_USED', `This Instagram login was already used. ${again}`);
  used.set(payload.n, Number(payload.e));
  return payload;
}

// ------------------------------------------------------------ the login --

/** Step 1: the authorize URL (and its state) for this business. */
export function loginUrl(business) {
  const cfg = requireIgConfig();
  const { state, expiresAt } = createState(business._id);
  const params = new URLSearchParams({
    client_id: cfg.appId,
    redirect_uri: cfg.redirectUri,
    response_type: 'code',
    scope: igLoginScopes().join(','),
    state,
    // Always ask which account: a browser that is signed in to a personal
    // Instagram account would otherwise connect that one (and be refused).
    force_reauth: 'true',
  });
  return { url: `${IG_AUTHORIZE}?${params.toString()}`, state, expiresAt, redirectUri: cfg.redirectUri };
}

/** The code from the redirect → a short-lived token, the user id and the granted permissions. */
export async function exchangeInstagramCode(code) {
  const cfg = requireIgConfig();
  // Instagram appends "#_" to the redirect; it isn't part of the code.
  const c = String(code || '').replace(/#_?$/, '').trim();
  if (!c) throw new ChannelError('Missing the login code from Instagram.', { code: 'CODE_REQUIRED' });
  try {
    const { data } = await http.post(
      IG_OAUTH_TOKEN,
      new URLSearchParams({
        client_id: cfg.appId,
        client_secret: instagramAppSecret(),
        grant_type: 'authorization_code',
        redirect_uri: cfg.redirectUri,
        code: c,
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );
    // Documented as { data: [{ access_token, user_id, permissions }] }; some
    // apps get the object itself.
    const d = Array.isArray(data?.data) ? data.data[0] : data;
    if (!d?.access_token) throw new Error('No access token in the response');
    const perms = Array.isArray(d.permissions) ? d.permissions : String(d.permissions || '').split(',');
    return { token: d.access_token, userId: String(d.user_id || ''), permissions: perms.map((p) => p.trim()).filter(Boolean) };
  } catch (err) {
    throw new ChannelError(`Instagram did not accept the login: ${igText(err)}`, {
      status: 400, code: 'CODE_REJECTED', meta: igInfo(err),
    });
  }
}

/** Short-lived → long-lived token (60 days). */
export async function exchangeLongLived(shortToken) {
  try {
    const { data } = await http.get(`${IG_ROOT}/access_token`, {
      params: { grant_type: 'ig_exchange_token', client_secret: instagramAppSecret(), access_token: shortToken },
    });
    if (!data?.access_token) throw new Error('No access token in the response');
    const ms = Number(data.expires_in) > 0 ? Number(data.expires_in) * 1000 : LONG_LIVED_MS;
    return { token: data.access_token, expiresAt: new Date(Date.now() + ms) };
  } catch (err) {
    throw new ChannelError(`Instagram did not issue a long-lived access token: ${igText(err)}`, {
      status: 502, code: 'TOKEN_EXCHANGE_FAILED', meta: igInfo(err),
    });
  }
}

/** GET /me: the professional account's id (the webhook entry id), handle, type and picture. */
export async function readInstagramProfile(token) {
  try {
    const { data } = await http.get(`${IG()}/me`, {
      params: { fields: 'user_id,username,name,account_type,profile_picture_url' },
      ...bearer(token),
    });
    const d = Array.isArray(data?.data) ? data.data[0] : data;
    return {
      userId: String(d?.user_id || ''),
      username: String(d?.username || ''),
      name: String(d?.name || ''),
      accountType: String(d?.account_type || ''),
      picture: String(d?.profile_picture_url || ''),
    };
  } catch (err) {
    throw new ChannelError(`Could not read your Instagram account: ${igText(err)}`, {
      status: 502, code: 'PROFILE_UNAVAILABLE', meta: igInfo(err),
    });
  }
}

/** Steps 3: state → tokens → profile checks → webhook subscription → stored connection. */
export async function connectInstagramLogin(business, { code, state } = {}) {
  requireIgConfig();
  verifyState(state, business._id);
  const short = await exchangeInstagramCode(code);
  if (short.permissions.length && !short.permissions.includes('instagram_business_manage_messages')) {
    throw new ChannelError(
      'Instagram didn’t give the CRM permission to manage your messages. Connect again and keep “Manage messages” switched on.',
      { status: 400, code: 'MISSING_PERMISSION' },
    );
  }
  const long = await exchangeLongLived(short.token);
  const me = await readInstagramProfile(long.token);
  if (!me.userId) {
    throw new ChannelError('Instagram didn’t return the account’s id. Try connecting again.', { status: 502, code: 'PROFILE_UNAVAILABLE' });
  }
  const type = me.accountType.toUpperCase();
  if (type && !PROFESSIONAL.includes(type)) {
    throw new ChannelError(
      `@${me.username || me.userId} is a personal Instagram account. Switch it to a professional (Business or Creator) `
      + 'account in the Instagram app (Settings → Account type and tools → Switch to professional account), then connect again.',
      { status: 400, code: 'NOT_PROFESSIONAL' },
    );
  }
  if (!type) logger.warn('Instagram /me returned no account_type; accepting the login', { business: business.name });

  // One business per Instagram account, so a webhook can only ever belong to one inbox.
  const other = await ChannelConnection.findOne({
    channel: 'instagram', igUserId: me.userId, status: 'connected', businessId: { $ne: business._id },
  }).select('businessId').lean();
  if (other) {
    throw new ChannelError(`@${me.username || me.userId} is already connected to another CRM account. Disconnect it there first.`, {
      status: 409, code: 'ASSET_IN_USE',
    });
  }

  // Comment auto-DM rules for Instagram are on: keep 'comments' in the
  // account's webhook fields. If Meta refuses it, connect without it.
  let igFields = IG_FIELDS;
  try {
    const wantsComments = !!(await CommentRule.exists({ businessId: business._id, channel: 'instagram', active: true }));
    if (wantsComments) {
      try {
        await subscribeInstagram(long.token, [...IG_FIELDS, 'comments']);
        igFields = [...IG_FIELDS, 'comments'];
      } catch (err) {
        if (igRevoked(err)) throw err;
        logger.warn('could not keep the Instagram account subscribed to comments; connecting without it', { error: igText(err) });
        await subscribeInstagram(long.token, IG_FIELDS);
      }
    } else {
      await subscribeInstagram(long.token, IG_FIELDS);
    }
  } catch (err) {
    throw new ChannelError(`Could not subscribe @${me.username || me.userId} to the CRM's webhooks: ${igText(err)}`, {
      status: 502, code: igRevoked(err) ? 'TOKEN_INVALID' : 'SUBSCRIBE_FAILED', meta: igInfo(err),
    });
  }

  const previous = await ChannelConnection.findOne({ businessId: business._id, channel: 'instagram' }).lean();
  const now = new Date();
  await ChannelConnection.findOneAndUpdate(
    { businessId: business._id, channel: 'instagram' },
    {
      $set: {
        businessId: business._id,
        channel: 'instagram',
        loginMethod: 'instagram',
        pageId: '',
        pageName: '',
        igUserId: me.userId,
        igUsername: me.username,
        pictureUrl: me.picture,
        pageAccessToken: encryptToken(long.token),
        tokenSource: 'instagram_user',
        tokenExpiresAt: long.expiresAt,
        tokenRefreshedAt: now,
        connectedAt: now,
        status: 'connected',
        statusReason: '',
        disconnectedAt: null,
        subscribedFields: igFields,
        // What the login granted (the Create page shows what is missing).
        grantedScopes: short.permissions,
        permissionsCheckedAt: short.permissions.length ? now : null,
      },
    },
    { upsert: true, new: true },
  );

  // What the previous Instagram connection subscribed is released (best effort).
  if (previous?.status === 'connected') {
    if (isInstagramLogin(previous)) {
      if (previous.igUserId !== me.userId) await unsubscribeInstagram(decryptToken(previous.pageAccessToken));
    } else if (previous.pageId) {
      const stillUsed = await ChannelConnection.countDocuments({ businessId: business._id, pageId: previous.pageId });
      if (!stillUsed) await unsubscribePage(previous.pageId, decryptToken(previous.pageAccessToken));
    }
  }

  logger.info('Instagram connected with Instagram login', {
    business: business.name, igUserId: me.userId, accountType: type || '(unknown)',
  });
  notify(business._id, {
    type: 'channel_connected',
    title: 'Instagram connected',
    body: `Direct messages to @${me.username || me.userId} now arrive in your Chats.`,
    target: { view: 'channel-status', id: 'instagram' },
  }).catch(() => {});
  return listConnections(business._id);
}

// ------------------------------------------------------ daily refresh --

/**
 * One pass over Instagram-login connections whose token expires within 10
 * days: expired → disconnected (one notification); ≥ 24 h old → refreshed;
 * 190 → disconnected. Idempotent (a refreshed token is 60 days out and no
 * longer matches; a disconnected row no longer matches). Never throws; logs
 * counts only.
 */
export async function sweepInstagramTokens({ now = Date.now(), limit = 500 } = {}) {
  const counts = { checked: 0, refreshed: 0, expired: 0, revoked: 0, failed: 0, notDue: 0 };
  let rows = [];
  try {
    rows = await ChannelConnection.find({
      channel: 'instagram',
      loginMethod: 'instagram',
      status: 'connected',
      tokenExpiresAt: { $lte: new Date(now + 10 * 24 * 60 * 60 * 1000) },
    }).limit(limit).lean();
  } catch (err) {
    logger.warn('Instagram token sweep query failed', { error: err.message });
    return counts;
  }
  for (const row of rows) {
    counts.checked += 1;
    try {
      if (tokenExpired(row, now)) {
        // eslint-disable-next-line no-await-in-loop
        await markRevoked(row, expiredTokenError());
        counts.expired += 1;
        continue;
      }
      const token = decryptToken(row.pageAccessToken);
      if (!token) {
        counts.failed += 1;
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const r = await refreshIfDue(row, token);
      if (r.refreshed) counts.refreshed += 1;
      else if (r.error) counts.failed += 1;
      else counts.notDue += 1;
    } catch (err) {
      if (igRevoked(err)) {
        // eslint-disable-next-line no-await-in-loop
        await markRevoked(row, err).catch(() => {});
        counts.revoked += 1;
      } else {
        counts.failed += 1;
      }
    }
  }
  if (counts.checked) logger.info('Instagram token sweep', counts);
  return counts;
}

let timer = null;
const SWEEP_EVERY_MS = 24 * 60 * 60 * 1000;

/** Start the daily sweep. Safe to call once at boot (server.js); no-op when Instagram login isn't configured. */
export function startInstagramTokenRefresh() {
  if (timer) return;
  if (!instagramLoginConfig().configured) {
    logger.info('Instagram token refresh not started (Log in with Instagram is not configured)');
    return;
  }
  const run = () => { sweepInstagramTokens().catch(() => {}); };
  // A first pass a minute after boot, then once a day.
  const first = setTimeout(run, 60 * 1000);
  if (first.unref) first.unref();
  timer = setInterval(run, SWEEP_EVERY_MS);
  if (timer.unref) timer.unref();
  logger.info('Instagram token refresh started', { everyHours: 24 });
}

export default {
  INSTAGRAM_NOT_CONFIGURED, createState, verifyState, loginUrl, exchangeInstagramCode, exchangeLongLived,
  readInstagramProfile, connectInstagramLogin, sweepInstagramTokens, startInstagramTokenRefresh,
};
