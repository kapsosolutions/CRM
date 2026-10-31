// ---------------------------------------------------------------------------
// Meta ads (Ads page): connecting a business's ad account and reading its
// results through the Marketing API.
//
// Connecting (Ads → Connect your Facebook account):
//   1. The browser runs Facebook Login for Business (the
//      META_ADS_LOGIN_CONFIG_ID configuration, or META_BUSINESS_LOGIN_CONFIG_ID
//      when no separate one is set) and posts the code here.
//   2. The code is exchanged for an access token. With a "System-user access
//      token" configuration it never expires: no long-lived exchange, no refresh.
//   3. The ad accounts the business granted are listed (GET /me/adaccounts; if
//      that is empty, the ad account ids in the token's granular scopes, then
//      the owned / client ad accounts of /me/businesses), plus the Pages (for
//      lead forms) through services/metaChannels.js listPages.
//   4. The business picks one ad account (and optionally a Page). The login
//      token and the Page token are stored encrypted on a ChannelConnection row
//      with channel 'ads'. The Page is subscribed to 'leadgen' webhooks when
//      Meta allows it.
// Between 3 and 4 the token lives only in this process (15-minute session).
//
// Every Marketing API call runs on the server with the stored token. Reads are
// cached for a few minutes per business. Meta error 190 marks the connection
// disconnected (one notification); rate limits (4, 17, 32, 613, 80000–80014)
// become a readable "try again shortly" error (HTTP 429). No Meta error is
// ever answered with 401/403, so it can't sign the user out of the CRM.
// ---------------------------------------------------------------------------
import axios from 'axios';
import crypto from 'crypto';
import ChannelConnection from '../models/ChannelConnection.js';
import Business from '../models/Business.js';
import Notification from '../models/Notification.js';
import { encryptToken, decryptToken } from './tokenCrypto.js';
import { listPages, pageFieldsInUse } from './metaChannels.js';
import { notify } from './notifications.js';
import logger from './logger.js';

// Marketing API versions retire faster than the WhatsApp ones (v21.0 ended
// September 2025), so the ads code has its own version setting.
const version = () => process.env.META_ADS_GRAPH_VERSION || process.env.WA_GRAPH_VERSION || 'v22.0';
const G = () => `https://graph.facebook.com/${version()}`;
// Ads Manager writes (S1–S5) are built for v24+ payloads. On an older
// resolved version they fail closed (409 GRAPH_VERSION_TOO_OLD); reads go on.
export const MIN_ADS_WRITE_VERSION = 24;
const http = axios.create({ timeout: 25000 });
const SESSION_MS = 15 * 60 * 1000;
const CACHE_MS = () => Math.max(0, Number(process.env.ADS_CACHE_MS) || 5 * 60 * 1000);
const PERMISSIONS_EVERY_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const isId = (s) => /^\d{1,30}$/.test(String(s || ''));
const actNumber = (s) => String(s || '').replace(/^act_/, '');
const digits = (s) => String(s || '').replace(/\D/g, '');

const metaErr = (err) => err?.response?.data?.error || null;
const metaText = (err) => {
  const e = metaErr(err);
  return e?.error_user_msg || e?.message || err?.message || 'Unknown error';
};
const metaInfo = (err) => {
  const e = metaErr(err);
  return e ? { code: e.code, subcode: e.error_subcode, message: e.error_user_msg || e.message || '' } : null;
};
const isRevoked = (err) => Number(metaErr(err)?.code) === 190;

/** Meta's rate-limit / throttling codes. */
export function isRateLimitCode(code) {
  const c = Number(code);
  return c === 4 || c === 17 || c === 32 || c === 613 || (c >= 80000 && c <= 80014);
}

export class AdsError extends Error {
  constructor(message, { status = 400, code = 'ADS_ERROR', meta = null } = {}) {
    super(message);
    this.name = 'AdsError';
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

export const RATE_LIMITED_TEXT = 'Meta is limiting requests for this ad account right now. Try again in a few minutes.';

/** 'v25.0' → 25 (NaN when it isn't a Graph version string). */
export function adsVersionNumber(v = version()) {
  const m = /^v(\d{1,3})\.(\d{1,2})$/.exec(String(v || '').trim());
  return m ? Number(m[1]) + Number(m[2]) / 100 : NaN;
}

/** Throws 409 GRAPH_VERSION_TOO_OLD when the resolved ads Graph version is below v24 (or unreadable). */
export function assertAdsWriteVersion() {
  const v = String(version() || '').trim();
  if (adsVersionNumber(v) >= MIN_ADS_WRITE_VERSION) return v;
  throw new AdsError(
    `This CRM server talks to Meta’s Marketing API ${v || '(no version set)'}, which is too old for changes (v${MIN_ADS_WRITE_VERSION}.0 or newer is needed). `
    + 'Creating, editing, duplicating and turning things on are switched off until the platform owner sets META_ADS_GRAPH_VERSION=v25.0 on the server and restarts it. '
    + 'Reports and lists still work.',
    { status: 409, code: 'GRAPH_VERSION_TOO_OLD' },
  );
}

/** Any Meta / network failure → an AdsError the routes can answer with. */
export function mapMetaError(err) {
  if (err instanceof AdsError) return err;
  const e = metaErr(err);
  if (!e) {
    if (err?.response?.status === 429) return new AdsError(RATE_LIMITED_TEXT, { status: 429, code: 'RATE_LIMITED' });
    return new AdsError(`Could not reach Meta: ${err?.message || 'network error'}`, { status: 503, code: 'META_UNREACHABLE' });
  }
  const code = Number(e.code);
  if (isRateLimitCode(code)) return new AdsError(RATE_LIMITED_TEXT, { status: 429, code: 'RATE_LIMITED', meta: metaInfo(err) });
  if (code === 10 || (code >= 200 && code <= 299)) {
    return new AdsError(`Meta didn’t allow this: ${metaText(err)}`, { status: 409, code: 'PERMISSION_MISSING', meta: metaInfo(err) });
  }
  return new AdsError(`Meta returned an error: ${metaText(err)}`, { status: 502, code: 'META_ERROR', meta: metaInfo(err) });
}

// ------------------------------------------------------------- config --

/** Facebook Login for Business configuration used for the ads connect. */
export function adsLoginConfig() {
  const appId = String(process.env.META_APP_ID || '').trim();
  const appSecret = String(process.env.META_APP_SECRET || '').trim();
  const own = String(process.env.META_ADS_LOGIN_CONFIG_ID || '').trim();
  const configId = own || String(process.env.META_BUSINESS_LOGIN_CONFIG_ID || '').trim();
  const missing = [];
  if (!appId) missing.push('META_APP_ID');
  if (!appSecret) missing.push('META_APP_SECRET');
  if (!configId) missing.push('META_BUSINESS_LOGIN_CONFIG_ID');
  return { configured: missing.length === 0, appId, configId, configKey: own ? 'META_ADS_LOGIN_CONFIG_ID' : 'META_BUSINESS_LOGIN_CONFIG_ID', missing };
}

export const ADS_NOT_CONFIGURED = 'Facebook ads connections aren’t set up on this server yet. The platform owner needs to '
  + 'create a Facebook Login for Business configuration with ad accounts in the Meta app and add its id to the server '
  + '(META_BUSINESS_LOGIN_CONFIG_ID, or META_ADS_LOGIN_CONFIG_ID for a separate one).';

function requireConfig() {
  const cfg = adsLoginConfig();
  if (!cfg.configured) throw new AdsError(ADS_NOT_CONFIGURED, { status: 409, code: 'NOT_CONFIGURED' });
  return cfg;
}

const appToken = () => `${process.env.META_APP_ID}|${process.env.META_APP_SECRET}`;

/** appsecret_proof for a server-side call with a user / system user token. */
const proof = (token) => crypto.createHmac('sha256', String(process.env.META_APP_SECRET || '')).update(token).digest('hex');
const auth = (token, params = {}) => ({
  params: { ...params, appsecret_proof: proof(token) },
  headers: { Authorization: `Bearer ${token}` },
});

// ------------------------------------------------------ login + listing --

async function exchangeCode(code) {
  const { appId } = requireConfig();
  if (!code || typeof code !== 'string') throw new AdsError('Missing the login code from Meta.', { code: 'CODE_REQUIRED' });
  try {
    const { data } = await http.get(`${G()}/oauth/access_token`, {
      params: { client_id: appId, client_secret: process.env.META_APP_SECRET, code },
    });
    if (!data?.access_token) throw new Error('No access token in the response');
    return data.access_token;
  } catch (err) {
    throw new AdsError(`Meta did not accept the login: ${metaText(err)}`, { status: 400, code: 'CODE_REJECTED', meta: metaInfo(err) });
  }
}

async function debugToken(token) {
  try {
    const { data } = await http.get(`${G()}/debug_token`, { params: { input_token: token, access_token: appToken() } });
    return data?.data || null;
  } catch (err) {
    logger.warn('ads debug_token lookup failed', { error: metaText(err) });
    return null;
  }
}

/**
 * Which permissions the token has, and whether ads_management covers the ad
 * account (pause / resume). debug_token first; GET /me/permissions for a user
 * token when debug_token can't be read.
 */
export async function permissionsFor(token, adAccountId, info = undefined) {
  const data = info === undefined ? await debugToken(token) : info;
  let scopes = Array.isArray(data?.scopes) ? data.scopes.map(String) : null;
  const granular = Array.isArray(data?.granular_scopes) ? data.granular_scopes : [];
  if (!scopes) {
    try {
      const { data: p } = await http.get(`${G()}/me/permissions`, auth(token));
      scopes = (p?.data || []).filter((x) => x.status === 'granted').map((x) => String(x.permission));
    } catch (err) {
      logger.warn('ads permission lookup failed', { error: metaText(err) });
      scopes = [];
    }
  }
  const mg = granular.find((s) => s.scope === 'ads_management');
  const targets = Array.isArray(mg?.target_ids) ? mg.target_ids.map((t) => actNumber(t)) : [];
  const covers = !targets.length || !adAccountId || targets.includes(actNumber(adAccountId));
  return { scopes, canManage: scopes.includes('ads_management') && covers };
}

const ACCOUNT_FIELDS = 'id,account_id,name,account_status,currency,timezone_name,business{id,name}';
export const ACCOUNT_STATUS = {
  1: 'Active', 2: 'Disabled', 3: 'Unsettled', 7: 'Pending risk review', 8: 'Pending settlement',
  9: 'In grace period', 100: 'Pending closure', 101: 'Closed', 201: 'Active', 202: 'Closed',
};

function normalizeAccount(a, businessName = '') {
  const num = actNumber(a.account_id || a.id);
  return {
    id: `act_${num}`,
    accountId: num,
    name: a.name || `Ad account ${num}`,
    status: Number(a.account_status) || 0,
    statusLabel: ACCOUNT_STATUS[Number(a.account_status)] || 'Unknown',
    currency: a.currency || '',
    timezone: a.timezone_name || '',
    businessName: a.business?.name || businessName || '',
  };
}

async function getPaged(url, token, params, maxPages = 5) {
  const out = [];
  let next = url;
  let p = params;
  for (let i = 0; i < maxPages && next; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const { data } = await http.get(next, p ? auth(token, p) : { headers: { Authorization: `Bearer ${token}` } });
    out.push(...(data?.data || []));
    next = data?.paging?.next || '';
    p = undefined; // the next link carries its own query
  }
  return out;
}

/**
 * The ad accounts this token can read. Three ways, because which one answers
 * depends on the token type: /me/adaccounts (user tokens, and system users
 * with assigned accounts), the ad account ids in debug_token granular scopes
 * (what the business granted in Login for Business), and the owned / client
 * ad accounts of the businesses the token can see.
 */
export async function listAdAccounts(token, info) {
  let rows = [];
  let firstError = null;
  try {
    rows = (await getPaged(`${G()}/me/adaccounts`, token, { fields: ACCOUNT_FIELDS, limit: 100 })).map((a) => normalizeAccount(a));
  } catch (err) {
    if (isRevoked(err)) throw new AdsError(`Meta rejected the login token: ${metaText(err)}`, { status: 400, code: 'TOKEN_INVALID', meta: metaInfo(err) });
    if (isRateLimitCode(metaErr(err)?.code)) throw mapMetaError(err);
    firstError = err;
    logger.warn('GET /me/adaccounts failed, trying the granted ad account ids', { error: metaText(err) });
  }
  if (!rows.length) {
    const ids = [...new Set((info?.granular_scopes || [])
      .filter((s) => ['ads_read', 'ads_management'].includes(s.scope))
      .flatMap((s) => s.target_ids || [])
      .map(actNumber)
      .filter(isId))];
    for (const id of ids.slice(0, 50)) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const { data } = await http.get(`${G()}/act_${id}`, auth(token, { fields: ACCOUNT_FIELDS }));
        if (data?.id || data?.account_id) rows.push(normalizeAccount(data));
      } catch (err) {
        firstError = firstError || err;
        logger.warn('could not read a granted ad account', { adAccountId: id, error: metaText(err) });
      }
    }
  }
  if (!rows.length) {
    try {
      const sub = `{${ACCOUNT_FIELDS}}`;
      const businesses = await getPaged(`${G()}/me/businesses`, token, {
        fields: `id,name,owned_ad_accounts.limit(100)${sub},client_ad_accounts.limit(100)${sub}`,
        limit: 50,
      }, 2);
      for (const b of businesses) {
        for (const a of [...(b.owned_ad_accounts?.data || []), ...(b.client_ad_accounts?.data || [])]) {
          rows.push(normalizeAccount(a, b.name));
        }
      }
    } catch (err) {
      firstError = firstError || err;
      logger.warn('GET /me/businesses ad accounts failed', { error: metaText(err) });
    }
  }
  if (!rows.length && firstError) {
    throw new AdsError(`Could not read your ad accounts: ${metaText(firstError)}`, {
      status: 502, code: 'ADACCOUNTS_UNAVAILABLE', meta: metaInfo(firstError),
    });
  }
  const seen = new Set();
  return rows.filter((a) => (seen.has(a.id) ? false : seen.add(a.id)));
}

const sessions = new Map(); // id -> { businessId, token, info, tokenSource, accounts, pages, expiresAt }
function sweepSessions() {
  const now = Date.now();
  for (const [id, s] of sessions) if (s.expiresAt < now) sessions.delete(id);
}

/** Steps 1–3: code → token → ad accounts + Pages. No token in the result. */
export async function startAdsLogin(business, code) {
  const token = await exchangeCode(code);
  const info = await debugToken(token);
  const accounts = await listAdAccounts(token, info);
  let pages = [];
  try {
    pages = (await listPages(token)).pages;
  } catch (err) {
    // Pages are optional here (lead forms only).
    logger.warn('ads login: Pages unavailable', { error: err.message });
  }
  const perms = await permissionsFor(token, '', info);
  const tokenSource = String(info?.type || '').toUpperCase() === 'SYSTEM_USER' ? 'system_user' : info?.type ? 'user' : '';
  sweepSessions();
  const businessId = String(business._id);
  for (const [id, s] of sessions) if (s.businessId === businessId) sessions.delete(id);
  const sessionId = crypto.randomBytes(18).toString('hex');
  sessions.set(sessionId, { businessId, token, info, tokenSource, accounts, pages, expiresAt: Date.now() + SESSION_MS });
  logger.info('Meta ads login: ad accounts listed', { business: business.name, accounts: accounts.length, pages: pages.length, tokenSource });
  return {
    sessionId,
    tokenSource,
    accounts,
    pages: pages.map((p) => ({ id: p.id, name: p.name, picture: p.picture })),
    scopes: perms.scopes,
    canManage: perms.canManage,
    leadsAllowed: perms.scopes.includes('leads_retrieval'),
  };
}

/** The browser's view of the ads connection: never a token. */
export function presentAds(row) {
  if (!row) return null;
  return {
    status: row.status || 'connected',
    statusReason: row.statusReason || '',
    adAccountId: row.adAccountId || '',
    adAccountName: row.adAccountName || '',
    currency: row.adAccountCurrency || '',
    timezone: row.adAccountTimezone || '',
    accountStatus: Number(row.adAccountStatus) || 0,
    accountStatusLabel: ACCOUNT_STATUS[Number(row.adAccountStatus)] || '',
    pageId: row.pageId || '',
    pageName: row.pageName || '',
    leadgenSubscribed: !!row.leadgenSubscribed,
    leadgenError: row.leadgenError || '',
    canManage: !!row.canManageAds,
    scopes: Array.isArray(row.grantedScopes) ? row.grantedScopes : [],
    tokenSource: row.tokenSource || '',
    connectedAt: row.connectedAt || null,
    disconnectedAt: row.disconnectedAt || null,
  };
}

const adsRow = (businessId) => ChannelConnection.findOne({ businessId: String(businessId), channel: 'ads' }).lean();

export async function adsStatus(businessId) {
  const cfg = adsLoginConfig();
  return { configured: cfg.configured, connection: presentAds(await adsRow(businessId)) };
}

async function pageTokenFor(pageId, token) {
  try {
    const { data } = await http.get(`${G()}/${pageId}`, auth(token, { fields: 'access_token' }));
    return data?.access_token || '';
  } catch (err) {
    logger.warn('ads connect: no Page token', { pageId, error: metaText(err) });
    return '';
  }
}

/** Page webhook fields to keep for a Page: Messenger's when it is connected for messaging, plus 'leadgen'. */
async function fieldsWithLeadgen(pageId) {
  const messaging = await ChannelConnection.countDocuments({ pageId, channel: { $in: ['messenger', 'instagram'] }, status: 'connected' });
  return messaging ? [...(await pageFieldsInUse(pageId)), 'leadgen'] : ['leadgen'];
}

async function subscribeLeadgen(pageId, pageToken) {
  const fields = await fieldsWithLeadgen(pageId);
  await http.post(`${G()}/${pageId}/subscribed_apps`, null, {
    params: { subscribed_fields: fields.join(',') },
    headers: { Authorization: `Bearer ${pageToken}` },
  });
}

/** Undo the 'leadgen' subscription: keep Messenger's fields if a messaging connection still uses the Page. Best effort. */
async function releaseLeadgen(pageId, pageToken) {
  if (!pageId || !pageToken) return false;
  try {
    const messaging = await ChannelConnection.countDocuments({ pageId, channel: { $in: ['messenger', 'instagram'] }, status: 'connected' });
    const otherAds = await ChannelConnection.countDocuments({ pageId, channel: 'ads', status: 'connected', leadgenSubscribed: true });
    if (otherAds) return false;
    if (messaging) {
      await http.post(`${G()}/${pageId}/subscribed_apps`, null, {
        params: { subscribed_fields: (await pageFieldsInUse(pageId)).join(',') },
        headers: { Authorization: `Bearer ${pageToken}` },
      });
    } else {
      await http.delete(`${G()}/${pageId}/subscribed_apps`, { headers: { Authorization: `Bearer ${pageToken}` } });
    }
    return true;
  } catch (err) {
    logger.warn('could not remove the leadgen subscription', { pageId, error: metaText(err) });
    return false;
  }
}

/** Step 4: store the chosen ad account (and lead-forms Page). */
export async function connectAdAccount(business, { sessionId, adAccountId, pageId } = {}) {
  requireConfig();
  sweepSessions();
  const s = sessions.get(String(sessionId || ''));
  if (!s || s.businessId !== String(business._id)) {
    throw new AdsError('Your Meta login has expired. Click Connect again.', { status: 409, code: 'SESSION_EXPIRED' });
  }
  const account = s.accounts.find((a) => a.id === `act_${actNumber(adAccountId)}`);
  if (!account) throw new AdsError('That ad account isn’t one you granted access to. Pick one from the list.', { code: 'ADACCOUNT_NOT_GRANTED' });
  const wantPage = String(pageId || '');
  const page = wantPage ? s.pages.find((p) => p.id === wantPage) : null;
  if (wantPage && !page) throw new AdsError('That Page isn’t one you granted access to. Pick a Page from the list.', { code: 'PAGE_NOT_GRANTED' });

  const other = await ChannelConnection.findOne({
    channel: 'ads', adAccountId: account.id, status: 'connected', businessId: { $ne: business._id },
  }).select('_id').lean();
  if (other) throw new AdsError(`${account.name} is already connected to another CRM account. Disconnect it there first.`, { status: 409, code: 'ASSET_IN_USE' });
  if (page) {
    const pageTaken = await ChannelConnection.findOne({
      channel: 'ads', pageId: page.id, status: 'connected', businessId: { $ne: business._id },
    }).select('_id').lean();
    if (pageTaken) throw new AdsError(`${page.name}’s lead forms are already connected to another CRM account.`, { status: 409, code: 'PAGE_IN_USE' });
  }

  const perms = await permissionsFor(s.token, account.id, s.info);
  let pageToken = '';
  let leadgenSubscribed = false;
  let leadgenError = '';
  if (page) {
    pageToken = page.accessToken || (await pageTokenFor(page.id, s.token));
    if (!pageToken) leadgenError = 'Meta did not give the CRM access to that Page.';
    else {
      try {
        await subscribeLeadgen(page.id, pageToken);
        leadgenSubscribed = true;
      } catch (err) {
        leadgenError = metaText(err);
        logger.warn('leadgen subscription refused', { pageId: page.id, metaCode: metaErr(err)?.code ?? null, error: leadgenError });
      }
    }
  }

  const previous = await adsRow(business._id);
  const now = new Date();
  await ChannelConnection.findOneAndUpdate(
    { businessId: business._id, channel: 'ads' },
    {
      $set: {
        businessId: business._id,
        channel: 'ads',
        adAccountId: account.id,
        adAccountName: account.name,
        adAccountCurrency: account.currency,
        adAccountTimezone: account.timezone,
        adAccountStatus: account.status,
        adAccessToken: encryptToken(s.token),
        grantedScopes: perms.scopes,
        canManageAds: perms.canManage,
        permissionsCheckedAt: now,
        pageId: page?.id || '',
        pageName: page?.name || '',
        pictureUrl: page?.picture || '',
        pageAccessToken: pageToken ? encryptToken(pageToken) : '',
        igUserId: '',
        igUsername: '',
        leadgenSubscribed,
        leadgenError,
        subscribedFields: leadgenSubscribed ? ['leadgen'] : [],
        tokenSource: s.tokenSource || '',
        connectedAt: now,
        status: 'connected',
        statusReason: '',
        disconnectedAt: null,
      },
    },
    { upsert: true, new: true },
  );
  sessions.delete(String(sessionId));
  clearCache(business._id);

  // The old lead-forms Page, when it changed.
  if (previous?.pageId && previous.pageId !== (page?.id || '') && previous.leadgenSubscribed && previous.status === 'connected') {
    await releaseLeadgen(previous.pageId, decryptToken(previous.pageAccessToken));
  }

  logger.info('Meta ad account connected', {
    business: business.name, adAccountId: account.id, pageId: page?.id || '', canManage: perms.canManage, leadgenSubscribed,
  });
  notify(business._id, {
    type: 'ads_connected',
    title: 'Facebook ads connected',
    body: `${account.name} (${account.id}) is connected. Spend, results and campaigns show on the Ads page.`,
    target: { view: 'ads', id: account.id },
  }).catch(() => {});
  return presentAds(await adsRow(business._id));
}

/** Remove the ads connection and its stored tokens. */
export async function disconnectAds(business) {
  const row = await adsRow(business._id);
  if (!row) throw new AdsError('No ad account is connected.', { status: 404, code: 'NOT_CONNECTED' });
  await ChannelConnection.deleteOne({ _id: row._id, businessId: business._id, channel: 'ads' });
  clearCache(business._id);
  let leadgenRemoved = false;
  if (row.status === 'connected' && row.leadgenSubscribed && row.pageId) {
    leadgenRemoved = await releaseLeadgen(row.pageId, decryptToken(row.pageAccessToken));
  }
  logger.info('Meta ad account disconnected', { business: business.name, adAccountId: row.adAccountId, leadgenRemoved });
  return { connection: null, leadgenRemoved };
}

// ------------------------------------------------------- revocation --

export async function markAdsRevoked(row, err) {
  if (!row?._id) return;
  const reason = metaText(err);
  try {
    const r = await ChannelConnection.updateOne(
      { _id: row._id, channel: 'ads', status: 'connected' },
      { $set: { status: 'disconnected', statusReason: reason, disconnectedAt: new Date() } },
    );
    clearCache(row.businessId);
    if (!r.matchedCount) return;
    logger.warn('Meta ads access removed (error 190), marked disconnected', { businessId: String(row.businessId), adAccountId: row.adAccountId });
    notify(row.businessId, {
      type: 'ads_disconnected',
      title: 'Facebook ads disconnected',
      body: `Meta says the CRM no longer has access to ${row.adAccountName || 'your ad account'}. Reconnect it on the Ads page to see spend and leads again.`,
      target: { view: 'ads', id: row.adAccountId || '' },
    }).catch(() => {});
  } catch (e) {
    logger.warn('could not mark the ads connection disconnected', { error: e.message });
  }
}

/** Run a Graph call with the stored ad token ('ad') or lead-forms Page token ('page'). */
export async function withAdsToken(row, kind, fn) {
  const token = decryptToken(kind === 'page' ? row.pageAccessToken : row.adAccessToken);
  if (!token) {
    throw kind === 'page'
      ? new AdsError('No Facebook Page with lead forms is connected. Reconnect and pick a Page.', { status: 409, code: 'NO_PAGE' })
      : new AdsError('Facebook ads need to be reconnected.', { status: 409, code: 'ADS_DISCONNECTED' });
  }
  try {
    return await fn(token);
  } catch (err) {
    if (isRevoked(err)) {
      await markAdsRevoked(row, err);
      throw new AdsError('Meta removed the CRM’s access to your ad account. Reconnect it on the Ads page.', {
        status: 409, code: 'ADS_REVOKED', meta: metaInfo(err),
      });
    }
    throw mapMetaError(err);
  }
}

/** The connected row, or a readable error when there is none / it was revoked. */
export async function requireAdsRow(businessId) {
  const row = await adsRow(businessId);
  if (!row) throw new AdsError('No ad account is connected yet.', { status: 409, code: 'NOT_CONNECTED' });
  if (row.status !== 'connected') {
    throw new AdsError('Meta removed the CRM’s access to your ad account. Reconnect it on the Ads page.', { status: 409, code: 'ADS_REVOKED' });
  }
  return row;
}

// ------------------------------------------------------------ cache --

const cache = new Map(); // key -> { at, data }
export function clearCache(businessId) {
  const prefix = `${String(businessId)}|`;
  for (const k of cache.keys()) if (k.startsWith(prefix)) cache.delete(k);
}

async function cached(row, key, fn, refresh) {
  const k = `${String(row.businessId)}|${row.adAccountId}|${key}`;
  const hit = cache.get(k);
  if (!refresh && hit && Date.now() - hit.at < CACHE_MS()) return hit.data;
  const data = await fn();
  if (cache.size > 2000) {
    for (const [ck, v] of cache) if (Date.now() - v.at >= CACHE_MS()) cache.delete(ck);
    if (cache.size > 2000) cache.clear();
  }
  cache.set(k, { at: Date.now(), data });
  return data;
}

/** GET a Graph path (all result pages, bounded) with the stored token; cached. */
function graphList(row, path, params, { kind = 'ad', refresh = false, maxPages = 5 } = {}) {
  // maxPages is part of the key: the leads table (2 pages) and the CSV (20
  // pages) read the same path and params, and must not share a cached result.
  return cached(row, `${kind}|${path}|p${maxPages}|${JSON.stringify(params)}`, () => withAdsToken(row, kind, (token) => getPaged(`${G()}/${path}`, token, params, maxPages)), refresh);
}

function graphGet(row, path, params, { kind = 'ad', refresh = false } = {}) {
  return cached(row, `${kind}|one|${path}|${JSON.stringify(params)}`, () => withAdsToken(row, kind, async (token) => (await http.get(`${G()}/${path}`, auth(token, params))).data), refresh);
}

// ------------------------------------------------------- date range --

const PRESETS = { today: 'Today', last_7d: 'Last 7 days', last_30d: 'Last 30 days', last_90d: 'Last 90 days' };
const ymd = (d) => d.toISOString().slice(0, 10);

/** ?preset=today|last_7d|last_30d|last_90d, or ?preset=custom&since=YYYY-MM-DD&until=YYYY-MM-DD. */
export function parseRange(q = {}) {
  const preset = String(q.preset || 'last_7d');
  if (preset !== 'custom') {
    if (!PRESETS[preset]) throw new AdsError('Unknown date range.', { code: 'BAD_RANGE' });
    return { preset, label: PRESETS[preset], params: { date_preset: preset } };
  }
  const since = String(q.since || '');
  const until = String(q.until || '');
  const valid = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && ymd(new Date(`${s}T00:00:00Z`)) === s;
  if (!valid(since) || !valid(until)) throw new AdsError('Pick a start and an end date.', { code: 'BAD_RANGE' });
  if (since > until) throw new AdsError('The start date is after the end date.', { code: 'BAD_RANGE' });
  const tomorrow = ymd(new Date(Date.now() + DAY_MS));
  if (until > tomorrow) throw new AdsError('The end date is in the future.', { code: 'BAD_RANGE' });
  const oldest = new Date();
  oldest.setUTCMonth(oldest.getUTCMonth() - 37);
  if (since < ymd(oldest)) throw new AdsError('Meta keeps ad results for 37 months. Pick a later start date.', { code: 'BAD_RANGE' });
  return { preset, since, until, label: `${since} – ${until}`, params: { time_range: JSON.stringify({ since, until }) } };
}

// ---------------------------------------------------------- metrics --

const INSIGHT_FIELDS = 'spend,impressions,reach,clicks,ctr,cpc,cpm,frequency,actions,cost_per_action_type';
const MESSAGING_TYPES = ['onsite_conversion.messaging_conversation_started_7d'];
const LEAD_TYPES = ['lead', 'onsite_conversion.lead_grouped', 'leadgen_grouped', 'onsite_conversion.lead', 'offsite_conversion.fb_pixel_lead'];
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const actionMax = (actions, types) => Math.max(0, ...((actions || []).filter((a) => types.includes(a.action_type)).map((a) => num(a.value))));
const ACTION_LABEL = {
  'onsite_conversion.messaging_conversation_started_7d': 'Messaging conversations started',
  'onsite_conversion.messaging_first_reply': 'New messaging contacts',
  lead: 'Leads',
  'onsite_conversion.lead_grouped': 'Leads (on Meta)',
  leadgen_grouped: 'Lead form leads',
  link_click: 'Link clicks',
  landing_page_view: 'Landing page views',
  post_engagement: 'Post engagements',
  page_engagement: 'Page engagements',
  video_view: 'Video views',
  post_reaction: 'Reactions',
  comment: 'Comments',
  like: 'Page likes',
};

/** Meta's insights row → the numbers the dashboard shows (results = conversations + leads, else link clicks). */
export function metricsOf(r = {}) {
  const spend = num(r.spend);
  const messaging = actionMax(r.actions, MESSAGING_TYPES);
  const leads = actionMax(r.actions, LEAD_TYPES);
  const linkClicks = actionMax(r.actions, ['link_click']);
  let results = messaging + leads;
  let resultType = messaging && leads ? 'conversations_and_leads' : messaging ? 'messaging_conversations' : leads ? 'leads' : '';
  if (!results && linkClicks) {
    results = linkClicks;
    resultType = 'link_clicks';
  }
  return {
    spend,
    impressions: num(r.impressions),
    reach: num(r.reach),
    clicks: num(r.clicks),
    ctr: num(r.ctr),
    cpc: num(r.cpc),
    cpm: num(r.cpm),
    frequency: num(r.frequency),
    messagingConversations: messaging,
    leads,
    linkClicks,
    results,
    resultType,
    costPerResult: results ? Math.round((spend / results) * 100) / 100 : null,
    actions: (r.actions || [])
      .map((a) => ({ type: a.action_type, label: ACTION_LABEL[a.action_type] || a.action_type, value: num(a.value) }))
      .filter((a) => a.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 12),
  };
}

// Budgets come in the currency's minor unit; these currencies have none.
const NO_MINOR_UNIT = new Set(['CLP', 'COP', 'CRC', 'HUF', 'ISK', 'IDR', 'JPY', 'KRW', 'PYG', 'TWD', 'VND']);
const budget = (v, currency) => {
  if (v === undefined || v === null || v === '' || Number(v) <= 0) return null;
  return NO_MINOR_UNIT.has(String(currency).toUpperCase()) ? num(v) : num(v) / 100;
};

function account(row) {
  return {
    id: row.adAccountId,
    name: row.adAccountName,
    currency: row.adAccountCurrency,
    timezone: row.adAccountTimezone,
  };
}

/** Re-read the permissions now and then, so a later grant of ads_management shows up. */
async function refreshPermissions(row) {
  if (row.permissionsCheckedAt && Date.now() - new Date(row.permissionsCheckedAt).getTime() < PERMISSIONS_EVERY_MS) return row;
  const token = decryptToken(row.adAccessToken);
  if (!token) return row;
  try {
    const perms = await permissionsFor(token, row.adAccountId);
    await ChannelConnection.updateOne(
      { _id: row._id, channel: 'ads' },
      { $set: { grantedScopes: perms.scopes, canManageAds: perms.canManage, permissionsCheckedAt: new Date() } },
    );
    return { ...row, grantedScopes: perms.scopes, canManageAds: perms.canManage };
  } catch (err) {
    logger.warn('ads permission re-check failed', { error: err.message });
    return row;
  }
}

export async function accountSummary(businessId, q = {}) {
  const row = await requireAdsRow(businessId);
  const range = parseRange(q);
  const refresh = q.refresh === '1';
  const data = await graphList(row, `${row.adAccountId}/insights`, { fields: INSIGHT_FIELDS, ...range.params, limit: 1 }, { refresh, maxPages: 1 });
  return { account: account(row), range: { preset: range.preset, label: range.label, since: range.since, until: range.until }, empty: !data.length, metrics: metricsOf(data[0] || {}) };
}

export async function accountTimeSeries(businessId, q = {}) {
  const row = await requireAdsRow(businessId);
  const range = parseRange(q);
  const data = await graphList(row, `${row.adAccountId}/insights`, {
    fields: 'spend,impressions,clicks,reach,actions', time_increment: 1, ...range.params, limit: 500,
  }, { refresh: q.refresh === '1', maxPages: 3 });
  const days = data.map((d) => {
    const m = metricsOf(d);
    return {
      date: d.date_start, spend: m.spend, impressions: m.impressions, clicks: m.clicks, reach: m.reach,
      results: m.results, messagingConversations: m.messagingConversations, leads: m.leads,
    };
  }).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return { account: account(row), range: { preset: range.preset, label: range.label }, days };
}

/** An id the business asked about must belong to its connected ad account. */
async function assertInAccount(row, id, refresh) {
  if (!isId(id)) throw new AdsError('Unknown id.', { status: 400, code: 'BAD_ID' });
  const obj = await graphGet(row, id, { fields: 'account_id,name' }, { refresh });
  if (actNumber(obj?.account_id) !== actNumber(row.adAccountId)) {
    throw new AdsError('That isn’t part of your connected ad account.', { status: 404, code: 'NOT_IN_ACCOUNT' });
  }
  return obj;
}

const statusOf = (o) => ({ status: o.status || '', effectiveStatus: o.effective_status || o.status || '' });

export async function listCampaigns(businessId, q = {}) {
  const row = await requireAdsRow(businessId);
  const range = parseRange(q);
  const refresh = q.refresh === '1';
  const [items, insights] = await Promise.all([
    graphList(row, `${row.adAccountId}/campaigns`, {
      fields: 'id,name,status,effective_status,objective,daily_budget,lifetime_budget,budget_remaining,start_time,stop_time',
      limit: 100,
    }, { refresh }),
    graphList(row, `${row.adAccountId}/insights`, { level: 'campaign', fields: `campaign_id,${INSIGHT_FIELDS}`, ...range.params, limit: 500 }, { refresh }),
  ]);
  const byId = new Map(insights.map((i) => [String(i.campaign_id), i]));
  const cur = row.adAccountCurrency;
  const fresh = await refreshPermissions(row);
  return {
    account: account(row),
    canManage: !!fresh.canManageAds,
    range: { preset: range.preset, label: range.label },
    campaigns: items.map((c) => ({
      id: String(c.id), name: c.name || '', ...statusOf(c), objective: c.objective || '',
      dailyBudget: budget(c.daily_budget, cur), lifetimeBudget: budget(c.lifetime_budget, cur),
      startTime: c.start_time || null, stopTime: c.stop_time || null,
      metrics: metricsOf(byId.get(String(c.id)) || {}),
    })).sort((a, b) => b.metrics.spend - a.metrics.spend),
  };
}

export async function listAdSets(businessId, campaignId, q = {}) {
  const row = await requireAdsRow(businessId);
  const range = parseRange(q);
  const refresh = q.refresh === '1';
  const campaign = await assertInAccount(row, campaignId, refresh);
  const [items, insights] = await Promise.all([
    graphList(row, `${campaignId}/adsets`, {
      fields: 'id,name,status,effective_status,daily_budget,lifetime_budget,optimization_goal,billing_event,destination_type,start_time,end_time',
      limit: 100,
    }, { refresh }),
    graphList(row, `${campaignId}/insights`, { level: 'adset', fields: `adset_id,${INSIGHT_FIELDS}`, ...range.params, limit: 500 }, { refresh }),
  ]);
  const byId = new Map(insights.map((i) => [String(i.adset_id), i]));
  const cur = row.adAccountCurrency;
  return {
    campaign: { id: String(campaignId), name: campaign.name || '' },
    range: { preset: range.preset, label: range.label },
    adsets: items.map((s) => ({
      id: String(s.id), name: s.name || '', ...statusOf(s),
      dailyBudget: budget(s.daily_budget, cur), lifetimeBudget: budget(s.lifetime_budget, cur),
      optimizationGoal: s.optimization_goal || '', billingEvent: s.billing_event || '', destinationType: s.destination_type || '',
      metrics: metricsOf(byId.get(String(s.id)) || {}),
    })).sort((a, b) => b.metrics.spend - a.metrics.spend),
  };
}

function creativeOf(c = {}) {
  const spec = c.object_story_spec || {};
  const link = spec.link_data || {};
  const video = spec.video_data || {};
  return {
    id: c.id ? String(c.id) : '',
    title: c.title || link.name || video.title || c.name || '',
    body: c.body || link.message || video.message || '',
    thumbnailUrl: c.thumbnail_url || c.image_url || link.picture || video.image_url || '',
  };
}

export async function listAds(businessId, adsetId, q = {}) {
  const row = await requireAdsRow(businessId);
  const range = parseRange(q);
  const refresh = q.refresh === '1';
  const adset = await assertInAccount(row, adsetId, refresh);
  const [items, insights] = await Promise.all([
    graphList(row, `${adsetId}/ads`, {
      fields: 'id,name,status,effective_status,creative{id,name,title,body,thumbnail_url,image_url,object_story_spec}',
      limit: 100,
    }, { refresh }),
    graphList(row, `${adsetId}/insights`, { level: 'ad', fields: `ad_id,${INSIGHT_FIELDS}`, ...range.params, limit: 500 }, { refresh }),
  ]);
  const byId = new Map(insights.map((i) => [String(i.ad_id), i]));
  return {
    adset: { id: String(adsetId), name: adset.name || '' },
    range: { preset: range.preset, label: range.label },
    ads: items.map((a) => ({
      id: String(a.id), name: a.name || '', ...statusOf(a), creative: creativeOf(a.creative),
      metrics: metricsOf(byId.get(String(a.id)) || {}),
    })).sort((a, b) => b.metrics.spend - a.metrics.spend),
  };
}

/** Pause / resume a campaign, ad set or ad. Only with ads_management on this account. */
export async function setStatus(business, { level, id, status } = {}) {
  if (!['campaign', 'adset', 'ad'].includes(level)) throw new AdsError('Unknown level.', { code: 'BAD_LEVEL' });
  if (!['ACTIVE', 'PAUSED'].includes(status)) throw new AdsError('Status must be ACTIVE or PAUSED.', { code: 'BAD_STATUS' });
  // Resuming is refused on a retired Graph version; pausing stays available
  // (it only lowers spend, and the status payload is the same on every version).
  if (status === 'ACTIVE') assertAdsWriteVersion();
  let row = await requireAdsRow(business._id);
  row = await refreshPermissions({ ...row, permissionsCheckedAt: null });
  if (!row.canManageAds) {
    throw new AdsError('The CRM can only read this ad account. To pause or resume ads here, reconnect and allow managing ads (ads_management).', {
      status: 409, code: 'READ_ONLY',
    });
  }
  await assertInAccount(row, id, true);
  await withAdsToken(row, 'ad', (token) => http.post(`${G()}/${id}`, new URLSearchParams({ status, appsecret_proof: proof(token) }).toString(), {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded' },
  }));
  clearCache(business._id);
  logger.info('ad status changed from the CRM', { business: business.name, level, id, status });
  return { id: String(id), level, status };
}

// ------------------------------------------------------- lead forms --

const LEAD_FIELDS = 'id,created_time,ad_id,ad_name,adset_name,campaign_id,campaign_name,form_id,field_data,is_organic,platform';

function leadOf(l = {}) {
  const fields = (l.field_data || []).map((f) => ({ name: String(f.name || ''), values: (f.values || []).map(String) }));
  const get = (...names) => {
    for (const n of names) {
      const f = fields.find((x) => x.name.toLowerCase() === n);
      if (f?.values?.[0]) return f.values[0];
    }
    return '';
  };
  const name = get('full_name', 'name') || [get('first_name'), get('last_name')].filter(Boolean).join(' ');
  const rawPhone = get('phone_number', 'phone', 'mobile_number', 'whatsapp_number');
  const phone = digits(rawPhone);
  return {
    id: String(l.id || ''),
    createdTime: l.created_time || null,
    adId: l.ad_id ? String(l.ad_id) : '',
    adName: l.ad_name || '',
    adsetName: l.adset_name || '',
    campaignId: l.campaign_id ? String(l.campaign_id) : '',
    campaignName: l.campaign_name || '',
    formId: l.form_id ? String(l.form_id) : '',
    isOrganic: !!l.is_organic,
    platform: l.platform || '',
    name,
    email: get('email'),
    phone: phone.length >= 8 && phone.length <= 15 ? phone : '',
    fields,
  };
}

export async function listLeadForms(businessId, q = {}) {
  const row = await requireAdsRow(businessId);
  if (!row.pageId) return { page: null, forms: [] };
  const forms = await graphList(row, `${row.pageId}/leadgen_forms`, { fields: 'id,name,status,leads_count,created_time,locale', limit: 100 }, {
    kind: 'page', refresh: q.refresh === '1', maxPages: 3,
  });
  return {
    page: { id: row.pageId, name: row.pageName, leadgenSubscribed: !!row.leadgenSubscribed, leadgenError: row.leadgenError || '' },
    forms: forms.map((f) => ({
      id: String(f.id), name: f.name || '', status: f.status || '', leadsCount: num(f.leads_count), createdTime: f.created_time || null,
    })),
  };
}

async function assertForm(row, formId, refresh) {
  if (!isId(formId)) throw new AdsError('Unknown form.', { status: 400, code: 'BAD_ID' });
  const { forms } = await listLeadForms(row.businessId, { refresh: refresh ? '1' : '' });
  const form = forms.find((f) => f.id === String(formId));
  if (!form) throw new AdsError('That lead form isn’t on your connected Page.', { status: 404, code: 'NOT_IN_PAGE' });
  return form;
}

export async function listLeads(businessId, formId, q = {}, { max = 200 } = {}) {
  const row = await requireAdsRow(businessId);
  if (!row.pageId) throw new AdsError('No Facebook Page with lead forms is connected. Reconnect and pick a Page.', { status: 409, code: 'NO_PAGE' });
  const refresh = q.refresh === '1';
  const form = await assertForm(row, formId, refresh);
  const limit = 100;
  const raw = await graphList(row, `${formId}/leads`, { fields: LEAD_FIELDS, limit }, { kind: 'page', refresh, maxPages: Math.ceil(max / limit) });
  return { form, leads: raw.slice(0, max).map(leadOf) };
}

/** Spreadsheet-safe CSV cell: quoted, and a leading = + - @ can't start a formula. */
function csvCell(v) {
  let s = String(v ?? '');
  if (/^[=@\t\r]/.test(s) || /^[+-](?![\d\s().-]*$)/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export async function leadsCsv(businessId, formId, q = {}) {
  const { form, leads } = await listLeads(businessId, formId, q, { max: 2000 });
  const fieldNames = [...new Set(leads.flatMap((l) => l.fields.map((f) => f.name)))];
  // Fixed columns, then every form question as the lead answered it.
  const head = ['created_time', 'lead_id', 'ad_id', 'ad_name', 'campaign_name', 'platform', 'whatsapp_number', ...fieldNames];
  const lines = [head.map(csvCell).join(',')];
  for (const l of leads) {
    const byName = new Map(l.fields.map((f) => [f.name, f.values.join('; ')]));
    lines.push([l.createdTime, l.id, l.adId, l.adName, l.campaignName, l.platform, l.phone, ...fieldNames.map((n) => byName.get(n) || '')]
      .map(csvCell).join(','));
  }
  const safe = String(form.name || 'leads').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'leads';
  return { filename: `leads-${safe}-${ymd(new Date())}.csv`, csv: `\uFEFF${lines.join('\r\n')}\r\n`, count: leads.length };
}

// ------------------------------------------- Click-to-WhatsApp links --

/** ad id → { adName, campaign, adset } for the CTWA leads, when the ad is in the connected account. Never throws. */
export async function linkAdIds(businessId, adIds = []) {
  try {
    const row = await adsRow(businessId);
    if (!row || row.status !== 'connected') return {};
    const ids = [...new Set(adIds.map(String).filter(isId))].slice(0, 50);
    if (!ids.length) return {};
    const data = await graphGet(row, '', { ids: ids.join(','), fields: 'id,name,account_id,campaign{id,name},adset{id,name}' });
    const out = {};
    for (const id of ids) {
      const a = data?.[id];
      if (!a || actNumber(a.account_id) !== actNumber(row.adAccountId)) continue;
      out[id] = {
        adId: id,
        adName: a.name || '',
        campaignId: a.campaign?.id ? String(a.campaign.id) : '',
        campaignName: a.campaign?.name || '',
        adsetId: a.adset?.id ? String(a.adset.id) : '',
        adsetName: a.adset?.name || '',
      };
    }
    return out;
  } catch (err) {
    logger.warn('could not link ad ids to campaigns', { error: err.message });
    return {};
  }
}

// ---------------------------------------------------- leadgen webhook --

const seenLeads = new Map(); // `${businessId}|${leadId}` -> at
function firstSighting(key) {
  const now = Date.now();
  if (seenLeads.size > 5000) for (const [k, at] of seenLeads) if (now - at > DAY_MS) seenLeads.delete(k);
  if (seenLeads.has(key)) return false;
  seenLeads.set(key, now);
  return true;
}

/**
 * entry.changes[field = 'leadgen'] of a signed 'page' webhook
 * (routes/metaWebhook.js → services/metaChannelInbound.js). Routed by the Page
 * id to the business whose ads connection uses that Page; one notification
 * per new lead. Never throws.
 */
export async function handleLeadgenEntry(entry = {}) {
  const changes = (entry.changes || []).filter((c) => c?.field === 'leadgen' && c.value);
  if (!changes.length) return 0;
  const pageId = String(entry.id || changes[0].value.page_id || '');
  let row = null;
  try {
    const rows = await ChannelConnection.find({ channel: 'ads', pageId }).sort({ updatedAt: -1 }).limit(5).lean();
    row = rows.find((r) => r.status === 'connected') || null;
  } catch (err) {
    logger.error('leadgen webhook lookup failed', { error: err.message });
    return 0;
  }
  if (!row) {
    logger.warn('leadgen webhook for a Page no business has connected for lead forms, dropped', { pageId });
    return 0;
  }
  const biz = await Business.findById(row.businessId).select('active name').lean().catch(() => null);
  if (!biz || !biz.active) {
    logger.warn('leadgen webhook for an inactive or deleted business, dropped', { pageId });
    return 0;
  }
  let notified = 0;
  for (const c of changes) {
    const v = c.value || {};
    const leadId = String(v.leadgen_id || '');
    if (!isId(leadId) || (v.page_id && String(v.page_id) !== pageId)) continue;
    const key = `${String(row.businessId)}|${leadId}`;
    if (!firstSighting(key)) continue;
    // eslint-disable-next-line no-await-in-loop
    const already = await Notification.findOne({ businessId: String(row.businessId), groupKey: `lead:${leadId}` }).select('_id').lean().catch(() => null);
    if (already) continue;
    let lead = null;
    try {
      // eslint-disable-next-line no-await-in-loop
      lead = leadOf(await withAdsToken(row, 'page', async (token) => (await http.get(`${G()}/${leadId}`, auth(token, { fields: LEAD_FIELDS }))).data));
    } catch (err) {
      logger.warn('could not read the new lead', { leadId, code: err.code || '', error: err.message });
    }
    let formName = '';
    const formId = String(v.form_id || lead?.formId || '');
    try {
      // eslint-disable-next-line no-await-in-loop
      const { forms } = await listLeadForms(row.businessId, {});
      formName = forms.find((f) => f.id === formId)?.name || '';
    } catch {
      /* the name is optional */
    }
    clearCache(row.businessId);
    // eslint-disable-next-line no-await-in-loop
    await notify(row.businessId, {
      type: 'ad_lead',
      title: lead?.name ? `New lead: ${lead.name}` : 'New lead from your Facebook lead form',
      body: [formName || 'Lead form', lead?.adName || '', lead?.phone ? 'has a phone number, you can open a WhatsApp chat' : '']
        .filter(Boolean).join(' · '),
      target: { view: 'ads', id: formId ? `leadform:${formId}` : 'leadforms', phone: lead?.phone || '' },
      groupKey: `lead:${leadId}`,
    });
    notified += 1;
    logger.info('lead ad lead received', { business: biz.name, pageId, formId, leadId });
  }
  return notified;
}

/**
 * The guard of every Ads Manager write (S1–S5): a Graph version that takes
 * the v24+ payloads (409 GRAPH_VERSION_TOO_OLD), a connection, and
 * ads_management re-checked now (409 READ_ONLY with the caller's text).
 */
export async function requireAdsWriter(businessId, readOnlyText, { skipVersion = false } = {}) {
  // `skipVersion` is for the brakes only (turning a rule off, bulk pause): they
  // lower spend and their payload is the same on every version, like the
  // row-level pause in setStatus. Connection and READ_ONLY still apply.
  if (!skipVersion) assertAdsWriteVersion();
  let row = await requireAdsRow(businessId);
  row = await refreshPermissions({ ...row, permissionsCheckedAt: null });
  if (!row.canManageAds) throw new AdsError(readOnlyText || 'The CRM can only read this ad account. Reconnect and allow managing ads (ads_management).', { status: 409, code: 'READ_ONLY' });
  return row;
}

// Shared internals for the Ads Manager services (metaAdsCreate.js and the
// later slices). Exported as they are: no behaviour change here.
export {
  graphList, graphGet, refreshPermissions, assertInAccount, auth, proof, http, G, budget, account, INSIGHT_FIELDS,
  NO_MINOR_UNIT, isId, actNumber,
  // Ads Manager S3 (metaAdsReports.js): the report CSV uses the lead CSV's safe cell.
  csvCell,
};

export default {
  AdsError, adsLoginConfig, adsStatus, startAdsLogin, connectAdAccount, disconnectAds, accountSummary, accountTimeSeries,
  listCampaigns, listAdSets, listAds, setStatus, listLeadForms, listLeads, leadsCsv, linkAdIds, handleLeadgenEntry,
  parseRange, metricsOf, mapMetaError, isRateLimitCode, withAdsToken, markAdsRevoked, clearCache, permissionsFor,
};
