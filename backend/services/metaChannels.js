// ---------------------------------------------------------------------------
// Messenger and Instagram: connecting a business's Facebook Page (and the
// Instagram professional account linked to it), and replying from the CRM.
//
// Connecting (Channel Status → Connect):
//   1. The browser runs Facebook Login for Business (FB.login with the
//      META_BUSINESS_LOGIN_CONFIG_ID configuration, response_type 'code') and
//      posts the code here.
//   2. The code is exchanged for an access token. With a "System-user access
//      token" configuration this is a business-integration system user token
//      that never expires, so there is no long-lived exchange or refresh.
//   3. The Pages the business granted are read with that token: first
//      GET /me/accounts (which returns each Page's access token), and if that
//      gives nothing, the Page ids from the token's granular scopes
//      (debug_token) read one by one with GET /{page-id}?fields=access_token,…
//   4. The business picks one Page (Messenger) and its linked Instagram
//      account. The Page is subscribed to the app's webhooks and the Page
//      access token is stored encrypted (services/tokenCrypto.js).
// Between steps 3 and 4 the token lives only in this process (a 15-minute
// login session); the browser only ever sees Page names and ids.
//
// A Meta error 190 on any call with a stored Page token means the business
// removed the CRM's access: the connection is marked disconnected and the
// business is told to reconnect.
//
// Instagram can also be connected without a Page, through Business Login for
// Instagram (services/instagramLogin.js): the row then has loginMethod
// 'instagram', an Instagram user token that expires after 60 days (refreshed
// on use here, and by a daily sweep), and replies go to graph.instagram.com.
// ---------------------------------------------------------------------------
import axios from 'axios';
import crypto from 'crypto';
import ChannelConnection from '../models/ChannelConnection.js';
import CommentRule from '../models/CommentRule.js';
import Conversation from '../models/Conversation.js';
import Message from '../models/Message.js';
import { encryptToken, decryptToken } from './tokenCrypto.js';
import { emitMessage } from './eventBus.js';
import { recordOutboundPreview } from './conversationState.js';
import { takeParked, isStatusUpgrade, statusesBelow } from './messageStatus.js';
import { outboundPreview } from './metaCloud.js';
import { notify } from './notifications.js';
import {
  IG, isInstagramLogin, tokenExpired, refreshIfDue, unsubscribeInstagram,
} from './instagramGraph.js';
import logger from './logger.js';

export const CHANNELS = ['messenger', 'instagram'];
export const CHANNEL_LABEL = { messenger: 'Messenger', instagram: 'Instagram' };

// Page webhook fields (POST /{page-id}/subscribed_apps). `messaging_seen` is
// an Instagram field: it isn't in the Page enum, so it goes on the app's
// 'instagram' object subscription instead (APP_FIELDS below).
export const PAGE_FIELDS = ['messages', 'messaging_postbacks', 'message_reads', 'message_deliveries'];
// App-level subscriptions (POST /{app-id}/subscriptions) this feature needs.
export const APP_FIELDS = {
  page: ['messages', 'messaging_postbacks', 'message_deliveries', 'message_reads'],
  instagram: ['messages', 'messaging_postbacks', 'messaging_seen'],
};

const DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_MS = 15 * 60 * 1000;
const version = () => process.env.WA_GRAPH_VERSION || 'v22.0';
const G = () => `https://graph.facebook.com/${version()}`;
const http = axios.create({ timeout: 20000 });
const digits = (s) => String(s || '').replace(/\D/g, '');
const bearer = (token) => ({ headers: { Authorization: `Bearer ${token}` } });

const metaErr = (err) => err?.response?.data?.error || null;
const metaText = (err) => {
  const e = metaErr(err);
  return e?.error_user_msg || e?.message || err?.message || 'Unknown error';
};
const isRevoked = (err) => Number(metaErr(err)?.code) === 190;

export class ChannelError extends Error {
  constructor(message, { status = 400, code = 'CHANNEL_ERROR', meta = null } = {}) {
    super(message);
    this.name = 'ChannelError';
    this.status = status;
    this.code = code;
    this.meta = meta;
  }

  toJSON() {
    return {
      success: false,
      code: this.code,
      message: this.message,
      ...(this.meta ? { metaCode: this.meta.code ?? null, metaMessage: this.meta.message || '' } : {}),
    };
  }
}

const metaInfo = (err) => {
  const e = metaErr(err);
  return e ? { code: e.code, subcode: e.error_subcode, message: e.error_user_msg || e.message || '' } : null;
};

// ------------------------------------------------------------- config --

/** Is Facebook Login for Business set up on this server? */
export function businessLoginConfig() {
  const appId = String(process.env.META_APP_ID || '').trim();
  const appSecret = String(process.env.META_APP_SECRET || '').trim();
  const configId = String(process.env.META_BUSINESS_LOGIN_CONFIG_ID || '').trim();
  const missing = [];
  if (!appId) missing.push('META_APP_ID');
  if (!appSecret) missing.push('META_APP_SECRET');
  if (!configId) missing.push('META_BUSINESS_LOGIN_CONFIG_ID');
  return { configured: missing.length === 0, appId, configId, missing };
}

export const NOT_CONFIGURED = 'Instagram and Messenger connections aren’t set up on this server yet. '
  + 'The platform owner needs to create a Facebook Login for Business configuration in the Meta app '
  + 'and add its id to the server (META_BUSINESS_LOGIN_CONFIG_ID).';

function requireConfig() {
  const cfg = businessLoginConfig();
  if (!cfg.configured) throw new ChannelError(NOT_CONFIGURED, { status: 409, code: 'NOT_CONFIGURED' });
  return cfg;
}

const appToken = () => `${process.env.META_APP_ID}|${process.env.META_APP_SECRET}`;

// --------------------------------------------------------- login flow --

/** The code from FB.login → an access token (system user or user). */
export async function exchangeCode(code) {
  const { appId } = requireConfig();
  if (!code || typeof code !== 'string') throw new ChannelError('Missing the login code from Meta.', { code: 'CODE_REQUIRED' });
  try {
    const { data } = await http.get(`${G()}/oauth/access_token`, {
      params: { client_id: appId, client_secret: process.env.META_APP_SECRET, code },
    });
    if (!data?.access_token) throw new Error('No access token in the response');
    return data.access_token;
  } catch (err) {
    throw new ChannelError(`Meta did not accept the login: ${metaText(err)}`, {
      status: 400, code: 'CODE_REJECTED', meta: metaInfo(err),
    });
  }
}

/** debug_token for a token: its type and the assets it was granted. Never throws. */
async function tokenInfo(token) {
  try {
    const { data } = await http.get(`${G()}/debug_token`, { params: { input_token: token, access_token: appToken() } });
    return data?.data || null;
  } catch (err) {
    logger.warn('debug_token lookup failed', { error: metaText(err) });
    return null;
  }
}

const PAGE_FIELDS_READ = 'id,name,access_token,tasks,picture{url},'
  + 'instagram_business_account{id,username,name,profile_picture_url}';

function normalizePage(p) {
  const ig = p.instagram_business_account;
  return {
    id: String(p.id),
    name: p.name || '',
    accessToken: p.access_token || '',
    picture: p.picture?.data?.url || '',
    tasks: Array.isArray(p.tasks) ? p.tasks : [],
    instagram: ig?.id
      ? { id: String(ig.id), username: ig.username || '', name: ig.name || '', picture: ig.profile_picture_url || '' }
      : null,
  };
}

/** GET /me/accounts, all pages of results (bounded). */
async function meAccounts(token) {
  const out = [];
  let url = `${G()}/me/accounts`;
  let params = { fields: PAGE_FIELDS_READ, limit: 100 };
  for (let i = 0; i < 5 && url; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const { data } = await http.get(url, { params, ...bearer(token) });
    out.push(...(data?.data || []));
    url = data?.paging?.next || '';
    params = undefined; // the next link carries its own query
  }
  return out;
}

/**
 * The Pages this token can act for, each with its Page access token and its
 * linked Instagram professional account.
 *
 * Tried two ways, because which one answers depends on the token type:
 *   • GET /me/accounts — works for user tokens and for system user tokens
 *     with pages_show_list;
 *   • the Page ids in the token's granular scopes (debug_token), each read
 *     with GET /{page-id}?fields=access_token,instagram_business_account —
 *     the assets a business granted through Login for Business.
 */
export async function listPages(token) {
  let pages = [];
  let firstError = null;
  try {
    pages = await meAccounts(token);
  } catch (err) {
    if (isRevoked(err)) {
      throw new ChannelError(`Meta rejected the login token: ${metaText(err)}`, { status: 400, code: 'TOKEN_INVALID', meta: metaInfo(err) });
    }
    firstError = err;
    logger.warn('GET /me/accounts failed, trying the granted Page ids', { error: metaText(err) });
  }
  const info = await tokenInfo(token);
  if (!pages.length) {
    const ids = [...new Set((info?.granular_scopes || [])
      .filter((s) => ['pages_show_list', 'pages_messaging', 'pages_manage_metadata', 'pages_read_engagement'].includes(s.scope))
      .flatMap((s) => s.target_ids || [])
      .map(String))];
    for (const id of ids.slice(0, 50)) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const { data } = await http.get(`${G()}/${id}`, { params: { fields: PAGE_FIELDS_READ }, ...bearer(token) });
        if (data?.id) pages.push(data);
      } catch (err) {
        firstError = firstError || err;
        logger.warn('could not read a granted Page', { pageId: id, error: metaText(err) });
      }
    }
  }
  if (!pages.length && firstError) {
    throw new ChannelError(`Could not read your Facebook Pages: ${metaText(firstError)}`, {
      status: 502, code: 'PAGES_UNAVAILABLE', meta: metaInfo(firstError),
    });
  }
  const tokenSource = String(info?.type || '').toUpperCase() === 'SYSTEM_USER' ? 'system_user'
    : info?.type ? 'user' : '';
  const seen = new Set();
  return {
    tokenSource,
    pages: pages.map(normalizePage).filter((p) => (seen.has(p.id) ? false : seen.add(p.id))),
  };
}

// In-process login sessions: the login token and the Pages it can reach,
// kept server-side between "list my Pages" and "connect this one".
const sessions = new Map(); // id -> { businessId, token, tokenSource, pages, expiresAt }

function sweepSessions() {
  const now = Date.now();
  for (const [id, s] of sessions) if (s.expiresAt < now) sessions.delete(id);
}

const publicPage = (p) => ({
  id: p.id,
  name: p.name,
  picture: p.picture,
  instagram: p.instagram,
  canMessage: !p.tasks.length || p.tasks.includes('MESSAGING') || p.tasks.includes('MODERATE') || p.tasks.includes('MANAGE'),
});

/** Steps 1–3: code → token → Pages. Returns a session id and the Pages (no tokens). */
export async function startLogin(business, code) {
  const token = await exchangeCode(code);
  const { pages, tokenSource } = await listPages(token);
  sweepSessions();
  const businessId = String(business._id);
  // One open login per business: a new one replaces the old.
  for (const [id, s] of sessions) if (s.businessId === businessId) sessions.delete(id);
  const sessionId = crypto.randomBytes(18).toString('hex');
  sessions.set(sessionId, { businessId, token, tokenSource, pages, expiresAt: Date.now() + SESSION_MS });
  logger.info('Meta business login: Pages listed', { business: business.name, pages: pages.length, tokenSource });
  return { sessionId, tokenSource, pages: pages.map(publicPage) };
}

/** A Page access token from the login token, when the listing didn't carry one. */
async function pageTokenFor(pageId, token) {
  try {
    const { data } = await http.get(`${G()}/${pageId}`, { params: { fields: 'access_token' }, ...bearer(token) });
    return data?.access_token || '';
  } catch (err) {
    throw new ChannelError(`Could not get access to the Page: ${metaText(err)}`, {
      status: 502, code: 'PAGE_TOKEN_UNAVAILABLE', meta: metaInfo(err),
    });
  }
}

/** Subscribe the Page to the app's webhooks (its messages reach /api/meta/webhook). */
export async function subscribePage(pageId, pageToken, fields = PAGE_FIELDS) {
  await http.post(`${G()}/${pageId}/subscribed_apps`, null, {
    params: { subscribed_fields: fields.join(',') },
    ...bearer(pageToken),
  });
}

/**
 * Every Page webhook field the CRM's connections on this Page rely on: the
 * messaging fields plus what was added on demand and stored on a connection
 * (utility template statuses, 'feed' for Comment auto-DM). POST
 * /{page-id}/subscribed_apps replaces the whole list, so whoever re-subscribes
 * the Page sends these too. 'leadgen' is the ads connection's own business.
 */
export async function pageFieldsInUse(pageId, extra = []) {
  const rows = pageId
    ? await ChannelConnection.find({ pageId: String(pageId), channel: { $in: CHANNELS }, status: 'connected' }).select('subscribedFields loginMethod channel').lean()
    : [];
  const stored = rows.filter((r) => !isInstagramLogin(r)).flatMap((r) => r.subscribedFields || []);
  return [...new Set([...PAGE_FIELDS, ...stored.filter((f) => f !== 'leadgen'), ...extra])];
}

/** Best-effort: remove the app from the Page's webhooks. */
export async function unsubscribePage(pageId, pageToken) {
  if (!pageId || !pageToken) return false;
  try {
    await http.delete(`${G()}/${pageId}/subscribed_apps`, bearer(pageToken));
    return true;
  } catch (err) {
    logger.warn('could not unsubscribe the Page from the app', { pageId, error: metaText(err) });
    return false;
  }
}

/** The browser's view of a connection: never the token. */
export function presentConnection(c) {
  if (!c) return null;
  return {
    channel: c.channel,
    pageId: c.pageId || '',
    pageName: c.pageName || '',
    igUserId: c.igUserId || '',
    igUsername: c.igUsername || '',
    pictureUrl: c.pictureUrl || '',
    status: c.status || 'connected',
    statusReason: c.statusReason || '',
    connectedAt: c.connectedAt || null,
    disconnectedAt: c.disconnectedAt || null,
    tokenSource: c.tokenSource || '',
    // Instagram: 'instagram' (Business Login for Instagram) or 'facebook' (the
    // Page's linked account). When the Instagram login's token expires (it is
    // refreshed automatically); never the token itself.
    loginMethod: c.channel === 'instagram' ? (c.loginMethod === 'instagram' ? 'instagram' : 'facebook') : '',
    tokenExpiresAt: isInstagramLogin(c) ? c.tokenExpiresAt || null : null,
  };
}

export async function listConnections(businessId) {
  const rows = await ChannelConnection.find({ businessId: String(businessId) }).lean();
  const out = { messenger: null, instagram: null };
  for (const r of rows) if (CHANNELS.includes(r.channel)) out[r.channel] = presentConnection(r);
  return out;
}

/** The flags /api/auth/me carries for the profile sidebar and Channel Status. */
export async function channelFlags(businessId) {
  try {
    const c = await listConnections(businessId);
    return {
      messengerConnected: c.messenger?.status === 'connected',
      messengerPageName: c.messenger?.pageName || '',
      instagramConnected: c.instagram?.status === 'connected',
      instagramUsername: c.instagram?.igUsername || '',
    };
  } catch (err) {
    logger.warn('channel flags unavailable', { error: err.message });
    return {};
  }
}

/** Step 4: connect the chosen Page for Messenger and/or its Instagram account. */
export async function connectPage(business, { sessionId, pageId, channels } = {}) {
  requireConfig();
  const wanted = [...new Set((Array.isArray(channels) ? channels : [channels]).map(String))].filter((c) => CHANNELS.includes(c));
  if (!wanted.length) throw new ChannelError('Choose Messenger, Instagram or both.', { code: 'CHANNEL_REQUIRED' });
  sweepSessions();
  const s = sessions.get(String(sessionId || ''));
  if (!s || s.businessId !== String(business._id)) {
    throw new ChannelError('Your Meta login has expired. Click Connect again.', { status: 409, code: 'SESSION_EXPIRED' });
  }
  const page = s.pages.find((p) => p.id === String(pageId || ''));
  if (!page) throw new ChannelError('That Page isn’t one you granted access to. Pick a Page from the list.', { code: 'PAGE_NOT_GRANTED' });
  if (wanted.includes('instagram') && !page.instagram?.id) {
    throw new ChannelError(`${page.name} has no Instagram professional account linked. Link one to the Page in Meta Business Suite, then connect again.`, { code: 'NO_INSTAGRAM' });
  }

  // One business per Page / Instagram account, so a webhook can only ever
  // belong to one inbox.
  for (const ch of wanted) {
    const assetFilter = ch === 'messenger' ? { pageId: page.id } : { igUserId: page.instagram.id };
    // eslint-disable-next-line no-await-in-loop
    const other = await ChannelConnection.findOne({
      channel: ch, ...assetFilter, status: 'connected', businessId: { $ne: business._id },
    }).select('businessId').lean();
    if (other) {
      throw new ChannelError(
        ch === 'messenger'
          ? `${page.name} is already connected to another CRM account. Disconnect it there first.`
          : `@${page.instagram.username || page.instagram.id} is already connected to another CRM account. Disconnect it there first.`,
        { status: 409, code: 'ASSET_IN_USE' },
      );
    }
  }

  const pageToken = page.accessToken || (await pageTokenFor(page.id, s.token));
  if (!pageToken) throw new ChannelError('Meta did not give the CRM access to that Page.', { status: 502, code: 'PAGE_TOKEN_UNAVAILABLE' });
  // Feature F: when this Page is also the business's lead-forms Page, keep its
  // 'leadgen' field (the subscribed_fields list replaces the previous one).
  const adsOnPage = await ChannelConnection.findOne({
    businessId: business._id, channel: 'ads', pageId: page.id, status: 'connected', leadgenSubscribed: true,
  }).select('_id').lean();
  const pageFields = adsOnPage ? [...PAGE_FIELDS, 'leadgen'] : PAGE_FIELDS;
  // Comment auto-DM rules for Facebook are on: keep the Page's 'feed' field
  // (comments). If Meta refuses it, the Page is connected without it.
  const wantsFeed = !!(await CommentRule.exists({ businessId: business._id, channel: 'facebook', active: true }));
  let storedFields = PAGE_FIELDS;
  try {
    if (wantsFeed) {
      try {
        await subscribePage(page.id, pageToken, [...pageFields, 'feed']);
        storedFields = [...PAGE_FIELDS, 'feed'];
      } catch (err) {
        if (isRevoked(err)) throw err;
        logger.warn('could not keep the Page subscribed to comments (feed); connecting without it', { pageId: page.id, error: metaText(err) });
        await subscribePage(page.id, pageToken, pageFields);
      }
    } else {
      await subscribePage(page.id, pageToken, pageFields);
    }
  } catch (err) {
    throw new ChannelError(`Could not subscribe ${page.name} to the CRM's webhooks: ${metaText(err)}`, {
      status: 502, code: isRevoked(err) ? 'TOKEN_INVALID' : 'SUBSCRIBE_FAILED', meta: metaInfo(err),
    });
  }

  const previous = await ChannelConnection.find({ businessId: business._id, channel: { $in: wanted } }).lean();
  const now = new Date();
  const encrypted = encryptToken(pageToken);
  for (const ch of wanted) {
    // eslint-disable-next-line no-await-in-loop
    await ChannelConnection.findOneAndUpdate(
      { businessId: business._id, channel: ch },
      {
        $set: {
          businessId: business._id,
          channel: ch,
          pageId: page.id,
          pageName: page.name,
          igUserId: ch === 'instagram' ? page.instagram.id : '',
          igUsername: ch === 'instagram' ? page.instagram.username || '' : '',
          pictureUrl: ch === 'instagram' ? page.instagram.picture || page.picture : page.picture,
          pageAccessToken: encrypted,
          tokenSource: s.tokenSource || '',
          connectedAt: now,
          status: 'connected',
          statusReason: '',
          disconnectedAt: null,
          subscribedFields: storedFields,
          // Read again on the Create page (debug_token): a new login may grant other permissions.
          grantedScopes: [],
          permissionsCheckedAt: null,
          loginMethod: 'facebook',
          tokenExpiresAt: null,
          tokenRefreshedAt: null,
        },
      },
      { upsert: true, new: true },
    );
  }
  sessions.delete(String(sessionId));

  // A Page this business no longer uses for anything is unsubscribed.
  const stillUsed = new Set((await ChannelConnection.find({ businessId: business._id }).select('pageId').lean()).map((r) => r.pageId));
  for (const old of previous) {
    if (old.pageId && !stillUsed.has(old.pageId)) {
      // eslint-disable-next-line no-await-in-loop
      await unsubscribePage(old.pageId, decryptToken(old.pageAccessToken));
    }
    // An Instagram login for a different account than the one now linked: its
    // own webhook subscription goes too (best effort).
    if (isInstagramLogin(old) && old.status === 'connected' && old.igUserId !== page.instagram?.id) {
      // eslint-disable-next-line no-await-in-loop
      await unsubscribeInstagram(decryptToken(old.pageAccessToken));
    }
  }

  logger.info('Meta channel connected', {
    business: business.name, channels: wanted, pageId: page.id, igUserId: page.instagram?.id || '',
  });
  for (const ch of wanted) {
    notify(business._id, {
      type: 'channel_connected',
      title: `${CHANNEL_LABEL[ch]} connected`,
      body: ch === 'messenger'
        ? `Messages to the Facebook Page ${page.name} now arrive in your Chats.`
        : `Direct messages to @${page.instagram.username || page.instagram.id} now arrive in your Chats.`,
      target: { view: 'channel-status', id: ch },
    }).catch(() => {});
  }
  return listConnections(business._id);
}

/** Remove a channel connection (and its stored token). */
export async function disconnectChannel(business, channel) {
  if (!CHANNELS.includes(channel)) throw new ChannelError('Unknown channel.', { status: 400, code: 'UNKNOWN_CHANNEL' });
  const row = await ChannelConnection.findOne({ businessId: business._id, channel }).lean();
  if (!row) throw new ChannelError(`${CHANNEL_LABEL[channel]} isn’t connected.`, { status: 404, code: 'NOT_CONNECTED' });
  await ChannelConnection.deleteOne({ _id: row._id, businessId: business._id });
  let unsubscribed = false;
  if (isInstagramLogin(row)) {
    // Business Login for Instagram: no Page; the account's own subscription
    // is removed (best effort) and the stored token is gone with the row.
    if (row.status === 'connected') unsubscribed = await unsubscribeInstagram(decryptToken(row.pageAccessToken));
    logger.info('Meta channel disconnected', { business: business.name, channel, loginMethod: 'instagram', igUserId: row.igUserId, unsubscribed });
    return { connections: await listConnections(business._id), unsubscribed };
  }
  const others = row.pageId ? await ChannelConnection.countDocuments({ businessId: business._id, pageId: row.pageId }) : 1;
  if (!others && row.status === 'connected') unsubscribed = await unsubscribePage(row.pageId, decryptToken(row.pageAccessToken));
  logger.info('Meta channel disconnected', { business: business.name, channel, pageId: row.pageId, unsubscribed });
  return { connections: await listConnections(business._id), unsubscribed };
}

// ------------------------------------------------------- revocation --

/**
 * Meta answered 190 for a stored Page token: the business removed the CRM's
 * access (or the token was otherwise invalidated). Marked once, with one
 * notification.
 */
export async function markRevoked(row, err) {
  if (!row?._id) return;
  const reason = metaText(err);
  try {
    const r = await ChannelConnection.updateOne(
      { _id: row._id, status: 'connected' },
      { $set: { status: 'disconnected', statusReason: reason, disconnectedAt: new Date() } },
    );
    // Already marked by an earlier call: no second notification.
    if (!r.matchedCount) return;
    logger.warn('Meta channel access removed (error 190 or expired token), marked disconnected', {
      businessId: String(row.businessId), channel: row.channel, pageId: row.pageId, loginMethod: row.loginMethod || '',
    });
    const what = row.channel === 'instagram' ? `@${row.igUsername || row.igUserId}` : row.pageName || 'your Facebook Page';
    notify(row.businessId, {
      type: 'channel_disconnected',
      title: `${CHANNEL_LABEL[row.channel] || 'Channel'} disconnected`,
      body: `Meta says the CRM no longer has access to ${what}. Reconnect it on Channel Status to keep receiving and replying to messages.`,
      target: { view: 'channel-status', id: row.channel },
    }).catch(() => {});
  } catch (e) {
    logger.warn('could not mark the channel disconnected', { error: e.message });
  }
}

/** An Instagram login whose 60-day token ran out (never refreshed in time). */
export const expiredTokenError = () => Object.assign(
  new Error('The Instagram login expired (its access token is valid for 60 days and could not be refreshed in time).'),
  { expiredToken: true },
);

/**
 * Run a Graph call with a stored connection's token; error 190 (or an expired
 * Instagram login) marks it disconnected. An Instagram-login token that is
 * due is refreshed first (≥ 24 h old and within 10 days of expiry).
 */
export async function withConnectionToken(row, fn) {
  let token = decryptToken(row.pageAccessToken);
  if (!token) {
    throw new ChannelError(`${CHANNEL_LABEL[row.channel]} needs to be reconnected on Channel Status.`, {
      status: 409, code: 'CHANNEL_DISCONNECTED',
    });
  }
  try {
    if (isInstagramLogin(row)) {
      if (tokenExpired(row)) throw expiredTokenError();
      token = (await refreshIfDue(row, token)).token;
    }
    return await fn(token);
  } catch (err) {
    if (err?.expiredToken || isRevoked(err)) {
      await markRevoked(row, err);
      throw new ChannelError(
        err?.expiredToken
          ? 'The Instagram login expired. Reconnect Instagram on Channel Status.'
          : `Meta removed the CRM's access to ${CHANNEL_LABEL[row.channel]}. Reconnect it on Channel Status.`,
        { status: 502, code: 'CHANNEL_TOKEN_INVALID', meta: metaInfo(err) },
      );
    }
    throw err;
  }
}

// ------------------------------------------------------------ sending --

/** The connection a chat's replies go out on. */
async function connectionFor(businessId, channel) {
  return ChannelConnection.findOne({ businessId: String(businessId), channel }).lean();
}

/** 'messenger' | 'instagram' when this chat is on one of those channels, else ''. */
export async function chatChannel(business, phone) {
  const p = digits(phone);
  if (!p || !business?._id) return '';
  const convo = await Conversation.findOne({ businessId: business._id, phone: p }).select('channel').lean();
  return CHANNELS.includes(convo?.channel) ? convo.channel : '';
}

export const channelUnsupported = (channel) => `Templates, WhatsApp Flows, catalog and payments are WhatsApp features. `
  + `They can’t be sent in a ${CHANNEL_LABEL[channel] || 'non-WhatsApp'} chat.`;

function mapSendError(err, channel) {
  if (err instanceof ChannelError) return err;
  const e = metaErr(err);
  const code = Number(e?.code);
  const sub = Number(e?.error_subcode);
  // Outside the 24-hour standard messaging window.
  if ((code === 10 && sub === 2018278) || code === 551 || sub === 2534022 || sub === 2018108) {
    return new ChannelError(
      `The 24-hour reply window with this customer has closed. On ${CHANNEL_LABEL[channel]} you can only reply within 24 hours of their last message.`,
      { status: 409, code: 'CHANNEL_WINDOW_CLOSED', meta: metaInfo(err) },
    );
  }
  if (e) {
    return new ChannelError(`${CHANNEL_LABEL[channel]} refused the message: ${metaText(err)}`, {
      status: 502, code: 'META_ERROR', meta: metaInfo(err),
    });
  }
  return new ChannelError(`Could not reach Meta: ${err.message}`, { status: 503, code: 'META_UNREACHABLE' });
}

/** Log an outbound Messenger / Instagram message, like metaCloud's logOutbound. */
export async function logOutbound({ businessId, channel, psid, d, mid, extra = {}, campaignId = null }) {
  try {
    const doc = await Message.create({
      phone: psid,
      direction: 'out',
      type: d.type,
      body: d.body,
      raw: { outbound: d, channel, ...extra },
      metaMessageId: mid || undefined,
      status: 'sent',
      businessId: String(businessId),
      channel,
      ...(campaignId ? { campaignId: String(campaignId) } : {}),
    });
    await recordOutboundPreview(psid, outboundPreview(d), String(businessId)).catch(() => {});
    const early = takeParked(mid);
    if (early && isStatusUpgrade(doc.status, early.status)) {
      Object.assign(doc, { status: early.status });
      await Message.updateOne({ _id: doc._id, status: { $in: statusesBelow(early.status) } }, { $set: { status: early.status } });
    }
    emitMessage(doc);
    return doc;
  } catch (err) {
    logger.warn('channel logOutbound failed', { error: err.message });
    return null;
  }
}

const emptyDescriptor = (type) => ({
  type, body: '', headerImageUrl: '', headerText: '', headerDocName: '', headerDocUrl: '', footer: '',
  buttons: [], cta: null, flowCta: '', mediaUrl: '', mediaType: '', filename: '',
});
const MEDIA_LABEL = { image: '📷 Photo', video: '🎥 Video', audio: '🎵 Audio', document: '📄 Document' };
const ATTACHMENT_TYPE = { image: 'image', video: 'video', audio: 'audio', document: 'file' };
const TEXT_LIMIT = { messenger: 2000, instagram: 1000 };

/** Is the standard 24-hour messaging window open (from the customer's last message)? */
export function windowIsOpen(convo, now = Date.now()) {
  const last = convo?.lastInboundAt ? new Date(convo.lastInboundAt).getTime() : 0;
  return !!last && now - last <= DAY_MS;
}

export const windowClosedError = (channel) => new ChannelError(
  `The 24-hour reply window with this customer has closed. On ${CHANNEL_LABEL[channel]} you can only reply within 24 hours of their last message.`,
  { status: 409, code: 'CHANNEL_WINDOW_CLOSED' },
);

/**
 * The business's connection for a channel, ready to send on: connected, and
 * (when `enforceWindow`) the customer inside the 24-hour window.
 */
export async function readyConnection(businessId, channel, convo, { enforceWindow = true } = {}) {
  const row = await connectionFor(businessId, channel);
  if (!row) {
    throw new ChannelError(`${CHANNEL_LABEL[channel]} isn’t connected. Connect it on Channel Status to reply.`, {
      status: 409, code: 'CHANNEL_NOT_CONNECTED',
    });
  }
  if (row.status !== 'connected') {
    throw new ChannelError(`${CHANNEL_LABEL[channel]} was disconnected at Meta. Reconnect it on Channel Status to reply.`, {
      status: 409, code: 'CHANNEL_DISCONNECTED',
    });
  }
  if (enforceWindow && !windowIsOpen(convo)) throw windowClosedError(channel);
  return row;
}

/**
 * POST one message to a Messenger / Instagram customer and log it in the chat.
 *
 *   message      — the Send API `message` object ({ text }, { attachment }, { template }, …)
 *   d            — the chat log descriptor (what the CRM bubble shows)
 *   messagingType — Messenger only: RESPONSE (a reply), UPDATE (proactive,
 *                   inside the window) or UTILITY (an approved utility
 *                   template, allowed outside the window). Instagram has no
 *                   messaging_type.
 *   enforceWindow — refuse outside the 24-hour window (everything but utility templates)
 *   campaignId   — stored on the Message, so campaign stats count it
 */
export async function sendChannelMessage(business, channel, convo, psid, message, d, {
  messagingType = 'RESPONSE', enforceWindow = true, campaignId = null, extra = {},
} = {}) {
  const businessId = String(business._id);
  const row = await readyConnection(businessId, channel, convo, { enforceWindow });
  const to = digits(psid);
  const body = {
    recipient: { id: to },
    ...(channel === 'messenger' ? { messaging_type: messagingType } : {}),
    message,
  };
  // Business Login for Instagram: graph.instagram.com/<IG_ID>/messages with
  // the Instagram user token; otherwise the Page's /messages with its token.
  const url = isInstagramLogin(row) ? `${IG()}/${row.igUserId}/messages` : `${G()}/${row.pageId}/messages`;
  let data;
  try {
    data = await withConnectionToken(row, async (token) => (await http.post(url, body, bearer(token))).data);
  } catch (err) {
    const mapped = mapSendError(err, channel);
    logger.error('channel send failed', {
      channel, businessId, code: mapped.code, metaCode: mapped.meta?.code ?? null, error: mapped.message,
    });
    throw mapped;
  }
  const doc = await logOutbound({ businessId, channel, psid: to, d, mid: data?.message_id || '', extra, campaignId });
  return { ...data, messageId: data?.message_id || '', doc };
}

/**
 * A client for one Messenger / Instagram chat, with the same send methods the
 * CRM routes call on a WhatsApp client (sendText, sendImage, …).
 */
export function createChannelClient(business, channel, convo) {
  // Messenger needs a messaging type; a reply inside 24 hours is RESPONSE.
  const post = (psid, message, d, extra = {}) => sendChannelMessage(business, channel, convo, psid, message, d, { extra });

  async function sendAttachment(psid, kind, url, filename = '') {
    const d = emptyDescriptor(kind);
    d.mediaType = kind;
    d.mediaUrl = url;
    d.filename = kind === 'document' ? filename || 'Document' : '';
    d.body = MEDIA_LABEL[kind];
    const payload = { url, ...(channel === 'messenger' ? { is_reusable: true } : {}) };
    return post(psid, { attachment: { type: ATTACHMENT_TYPE[kind], payload } }, d);
  }

  const client = {
    channel,
    // `reply.replyTo` is kept with the logged message for the CRM's quote.
    async sendText(psid, text, reply = null) {
      const t = String(text || '');
      const tooLong = channel === 'instagram' ? Buffer.byteLength(t, 'utf8') > TEXT_LIMIT.instagram : t.length > TEXT_LIMIT.messenger;
      if (tooLong) {
        throw new ChannelError(
          channel === 'instagram'
            ? 'Instagram messages can be at most 1,000 bytes. Shorten the message and send it again.'
            : 'Messenger messages can be at most 2,000 characters. Shorten the message and send it again.',
          { status: 400, code: 'TEXT_TOO_LONG' },
        );
      }
      const d = emptyDescriptor('text');
      d.body = t;
      return post(psid, { text: t }, d, reply?.replyTo ? { replyTo: reply.replyTo } : {});
    },
    // Messenger / Instagram attachments carry no caption: it goes as a text after.
    async sendImage(psid, url, caption = '') {
      const r = await sendAttachment(psid, 'image', url);
      if (caption) await client.sendText(psid, caption);
      return r;
    },
    async sendVideo(psid, url, caption = '') {
      const r = await sendAttachment(psid, 'video', url);
      if (caption) await client.sendText(psid, caption);
      return r;
    },
    async sendAudio(psid, url) {
      return sendAttachment(psid, 'audio', url);
    },
    async sendDocument(psid, url, filename, caption = '') {
      const r = await sendAttachment(psid, 'document', url, filename);
      if (caption) await client.sendText(psid, caption);
      return r;
    },
    async sendReaction() {
      throw new ChannelError(`Reactions can’t be sent to ${CHANNEL_LABEL[channel]} from the CRM.`, {
        status: 409, code: 'REACTION_UNSUPPORTED',
      });
    },
  };
  return client;
}

/**
 * The client a CRM reply goes out on when the chat is a Messenger / Instagram
 * one, or null for a WhatsApp chat (the caller then uses the WhatsApp client).
 */
export async function channelClientForChat(business, phone) {
  const p = digits(phone);
  if (!p || !business?._id) return null;
  const convo = await Conversation.findOne({ businessId: business._id, phone: p }).select('channel lastInboundAt').lean();
  if (!CHANNELS.includes(convo?.channel)) return null;
  return createChannelClient(business, convo.channel, convo);
}

// ------------------------------------------------ app subscriptions --

/** The callback URL Meta posts 'page' and 'instagram' events to. */
export function metaWebhookUrl(baseUrl = process.env.PUBLIC_BASE_URL) {
  const base = String(baseUrl || '').replace(/\/$/, '');
  return base ? `${base}/api/meta/webhook` : '';
}

const summarize = (list) => (list || []).map((s) => ({
  object: s.object,
  callbackUrl: s.callback_url || '',
  active: !!s.active,
  fields: (s.fields || []).map((f) => f.name || f).filter(Boolean),
}));

/** GET /{app-id}/subscriptions (app token): every object the app is subscribed to. */
export async function readAppSubscriptions() {
  const appId = process.env.META_APP_ID;
  if (!appId || !process.env.META_APP_SECRET) throw new ChannelError('META_APP_ID / META_APP_SECRET are not set.', { status: 409, code: 'NOT_CONFIGURED' });
  const { data } = await http.get(`${G()}/${appId}/subscriptions`, { params: { access_token: appToken() } });
  return summarize(data?.data || []);
}

/**
 * Make sure the app's 'page' and 'instagram' subscriptions point at
 * /api/meta/webhook with the fields this feature needs. Idempotent: an object
 * that is already right is left alone, and existing fields are kept. The
 * 'whatsapp_business_account' subscription is never touched.
 */
export async function ensureAppSubscriptions({ extraFields = {} } = {}) {
  // extraFields: more fields for an object, e.g. { page: ['leadgen'] } for
  // lead ads (Feature F, opt-in). Only objects in APP_FIELDS are ever posted.
  const wanted = Object.fromEntries(Object.keys(APP_FIELDS).map((o) => [
    o, [...new Set([...APP_FIELDS[o], ...((extraFields && extraFields[o]) || [])])],
  ]));
  const appId = process.env.META_APP_ID;
  const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN;
  const want = metaWebhookUrl();
  if (!appId || !process.env.META_APP_SECRET || !verifyToken) {
    return { ok: false, reason: 'META_APP_ID / META_APP_SECRET / META_WEBHOOK_VERIFY_TOKEN not set', results: [] };
  }
  if (!want) return { ok: false, reason: 'PUBLIC_BASE_URL is not set', results: [] };
  let before;
  try {
    before = await readAppSubscriptions();
  } catch (err) {
    return { ok: false, reason: metaText(err), results: [] };
  }
  const results = [];
  for (const object of Object.keys(APP_FIELDS)) {
    const cur = before.find((s) => s.object === object);
    const fields = [...new Set([...(cur?.fields || []), ...wanted[object]])];
    const complete = wanted[object].every((f) => cur?.fields.includes(f));
    if (cur && cur.callbackUrl === want && cur.active && complete) {
      results.push({ object, ok: true, changed: false });
      continue;
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      await http.post(
        `${G()}/${appId}/subscriptions`,
        new URLSearchParams({
          object,
          callback_url: want,
          verify_token: verifyToken,
          fields: fields.join(','),
          access_token: appToken(),
        }).toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
      );
      results.push({ object, ok: true, changed: true, fields });
    } catch (err) {
      results.push({ object, ok: false, changed: false, error: metaText(err), metaCode: metaErr(err)?.code ?? null });
    }
  }
  let after = null;
  try {
    after = await readAppSubscriptions();
  } catch (err) {
    logger.warn('could not read the app subscriptions back', { error: metaText(err) });
  }
  return { ok: results.every((r) => r.ok), callbackUrl: want, results, before, after };
}

export default {
  CHANNELS, PAGE_FIELDS, APP_FIELDS, ChannelError, businessLoginConfig, exchangeCode, listPages, startLogin,
  connectPage, disconnectChannel, listConnections, channelFlags, presentConnection, markRevoked, unsubscribePage,
  withConnectionToken, expiredTokenError, chatChannel, channelUnsupported, createChannelClient, channelClientForChat,
  metaWebhookUrl, readAppSubscriptions, ensureAppSubscriptions, windowIsOpen, windowClosedError, readyConnection,
  sendChannelMessage, subscribePage, pageFieldsInUse, logOutbound, CHANNEL_LABEL,
};
