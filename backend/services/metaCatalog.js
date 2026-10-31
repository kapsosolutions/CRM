// ---------------------------------------------------------------------------
// Catalog page → "Get started": connecting a Meta product catalog through
// Facebook Login for Business instead of typing its id.
//
//   1. The browser runs FB.login with the META_CATALOG_LOGIN_CONFIG_ID
//      configuration (META_BUSINESS_LOGIN_CONFIG_ID when no separate one is
//      set) and posts the code here.
//   2. The code is exchanged for a token. The catalogs the business granted
//      are listed: the catalog ids in the token's catalog_management granular
//      scope, then the owned / client catalogs of /me/businesses. The catalog
//      already connected to the business's WhatsApp Business Account
//      (GET /{waba_id}/product_catalogs) is marked.
//   3. The business picks one. It is connected to the WABA
//      (POST /{waba_id}/product_catalogs, one catalog per WABA: another one
//      already there is disconnected first), saved as Business.catalogId, and
//      the login token is stored encrypted (Business.catalogConnection.token)
//      for the product sync (services/metaCloud.js catalog calls).
// Between 2 and 3 the token lives only in this process (15-minute session).
// No token is ever returned to the browser.
// ---------------------------------------------------------------------------
import axios from 'axios';
import crypto from 'crypto';
import Business from '../models/Business.js';
import { encryptToken } from './tokenCrypto.js';
import { isWhatsAppConnected } from './sandbox.js';
import { notify } from './notifications.js';
import logger from './logger.js';

const version = () => process.env.WA_GRAPH_VERSION || 'v22.0';
const G = () => `https://graph.facebook.com/${version()}`;
const http = axios.create({ timeout: 25000 });
const SESSION_MS = 15 * 60 * 1000;
const isId = (s) => /^\d{1,30}$/.test(String(s || ''));

const metaErr = (err) => err?.response?.data?.error || null;
const metaText = (err) => {
  const e = metaErr(err);
  return e?.error_user_msg || e?.message || err?.message || 'Unknown error';
};
const metaInfo = (err) => {
  const e = metaErr(err);
  return e ? { code: e.code, subcode: e.error_subcode, message: e.error_user_msg || e.message || '' } : null;
};
const isRateLimit = (err) => {
  const c = Number(metaErr(err)?.code);
  return c === 4 || c === 17 || c === 32 || c === 613 || (c >= 80000 && c <= 80014);
};
const isPermission = (err) => {
  const e = metaErr(err);
  const c = Number(e?.code);
  // (#100) "Missing Permission" is how Meta answers when the login wasn't
  // granted catalog_management / business_management (no Advanced Access).
  return c === 10 || (c >= 200 && c <= 299) || (c === 100 && /permission/i.test(String(e?.message || '')));
};

export class CatalogError extends Error {
  constructor(message, { status = 400, code = 'CATALOG_ERROR', meta = null } = {}) {
    super(message);
    this.name = 'CatalogError';
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

// ------------------------------------------------------------- config --

/** Facebook Login for Business configuration used for the catalog connect. */
export function catalogLoginConfig() {
  const appId = String(process.env.META_APP_ID || '').trim();
  const appSecret = String(process.env.META_APP_SECRET || '').trim();
  const own = String(process.env.META_CATALOG_LOGIN_CONFIG_ID || '').trim();
  const configId = own || String(process.env.META_BUSINESS_LOGIN_CONFIG_ID || '').trim();
  const missing = [];
  if (!appId) missing.push('META_APP_ID');
  if (!appSecret) missing.push('META_APP_SECRET');
  if (!configId) missing.push('META_BUSINESS_LOGIN_CONFIG_ID');
  return { configured: missing.length === 0, appId, configId, missing };
}

export const CATALOG_NOT_CONFIGURED = 'Connecting a catalog through Meta isn’t set up on this server yet. The platform '
  + 'owner needs a Facebook Login for Business configuration with catalogs in the Meta app, and its id on the server '
  + '(META_BUSINESS_LOGIN_CONFIG_ID, or META_CATALOG_LOGIN_CONFIG_ID for a separate one).';

function requireConfig() {
  const cfg = catalogLoginConfig();
  if (!cfg.configured) throw new CatalogError(CATALOG_NOT_CONFIGURED, { status: 409, code: 'NOT_CONFIGURED' });
  return cfg;
}

function requireWaba(business) {
  if (!isWhatsAppConnected(business) || !business.wabaId) {
    throw new CatalogError('Connect your own WhatsApp number first. The catalog is connected to its WhatsApp Business Account.', {
      status: 409, code: 'WHATSAPP_REQUIRED',
    });
  }
}

const appToken = () => `${process.env.META_APP_ID}|${process.env.META_APP_SECRET}`;
const proof = (token) => crypto.createHmac('sha256', String(process.env.META_APP_SECRET || '')).update(token).digest('hex');

/**
 * Request options for a token. The login token comes from this app, so it gets
 * appsecret_proof. The business's WhatsApp token may come from another app
 * (credentials entered by hand), where our proof would be rejected.
 */
const authFor = (t, params = {}) => ({
  params: t.proof ? { ...params, appsecret_proof: proof(t.token) } : params,
  headers: { Authorization: `Bearer ${t.token}` },
});

// ------------------------------------------------------ login + listing --

async function exchangeCode(code) {
  const { appId } = requireConfig();
  if (!code || typeof code !== 'string') throw new CatalogError('Missing the login code from Meta.', { code: 'CODE_REQUIRED' });
  try {
    const { data } = await http.get(`${G()}/oauth/access_token`, {
      params: { client_id: appId, client_secret: process.env.META_APP_SECRET, code },
    });
    if (!data?.access_token) throw new Error('No access token in the response');
    return data.access_token;
  } catch (err) {
    throw new CatalogError(`Meta did not accept the login: ${metaText(err)}`, { status: 400, code: 'CODE_REJECTED', meta: metaInfo(err) });
  }
}

async function debugToken(token) {
  try {
    const { data } = await http.get(`${G()}/debug_token`, { params: { input_token: token, access_token: appToken() } });
    return data?.data || null;
  } catch (err) {
    logger.warn('catalog debug_token lookup failed', { error: metaText(err) });
    return null;
  }
}

async function grantedScopes(t, info) {
  if (Array.isArray(info?.scopes)) return info.scopes.map(String);
  try {
    const { data } = await http.get(`${G()}/me/permissions`, authFor(t));
    return (data?.data || []).filter((x) => x.status === 'granted').map((x) => String(x.permission));
  } catch {
    return [];
  }
}

const CATALOG_FIELDS = 'id,name,product_count,vertical,business{id,name}';

function normalizeCatalog(c, businessName = '') {
  return {
    id: String(c.id),
    name: c.name || `Catalog ${c.id}`,
    productCount: Number.isFinite(Number(c.product_count)) ? Number(c.product_count) : null,
    vertical: c.vertical || '',
    businessId: c.business?.id ? String(c.business.id) : '',
    businessName: c.business?.name || businessName || '',
  };
}

async function getPaged(url, t, params, maxPages = 3) {
  const out = [];
  let next = url;
  let p = params;
  for (let i = 0; i < maxPages && next; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const { data } = await http.get(next, p ? authFor(t, p) : { headers: { Authorization: `Bearer ${t.token}` } });
    out.push(...(data?.data || []));
    next = data?.paging?.next || '';
    p = undefined; // the next link carries its own query
  }
  return out;
}

/**
 * The catalogs this login can use. The ids granted on the catalogs step of
 * Meta's window first (debug_token granular scopes), then the owned / client
 * catalogs of the businesses the token can see.
 */
export async function listCatalogs(t, info) {
  const rows = [];
  let firstError = null;
  const ids = [...new Set((info?.granular_scopes || [])
    .filter((s) => s.scope === 'catalog_management')
    .flatMap((s) => s.target_ids || [])
    .map(String)
    .filter(isId))];
  for (const id of ids.slice(0, 50)) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const { data } = await http.get(`${G()}/${id}`, authFor(t, { fields: CATALOG_FIELDS }));
      if (data?.id) rows.push(normalizeCatalog(data));
    } catch (err) {
      if (isRateLimit(err)) throw new CatalogError('Meta is busy right now. Try again in a minute.', { status: 429, code: 'RATE_LIMITED' });
      firstError = firstError || err;
      logger.warn('could not read a granted catalog', { catalogId: id, error: metaText(err) });
    }
  }
  if (!rows.length) {
    try {
      const sub = `{${CATALOG_FIELDS}}`;
      const businesses = await getPaged(`${G()}/me/businesses`, t, {
        fields: `id,name,owned_product_catalogs.limit(100)${sub},client_product_catalogs.limit(100)${sub}`,
        limit: 50,
      }, 2);
      for (const b of businesses) {
        for (const c of [...(b.owned_product_catalogs?.data || []), ...(b.client_product_catalogs?.data || [])]) {
          rows.push(normalizeCatalog(c, b.name));
        }
      }
    } catch (err) {
      if (isRateLimit(err)) throw new CatalogError('Meta is busy right now. Try again in a minute.', { status: 429, code: 'RATE_LIMITED' });
      firstError = firstError || err;
      logger.warn('GET /me/businesses catalogs failed', { error: metaText(err) });
    }
  }
  if (!rows.length && firstError && !isPermission(firstError)) {
    throw new CatalogError(`Could not read your catalogs: ${metaText(firstError)}`, {
      status: 502, code: 'CATALOGS_UNAVAILABLE', meta: metaInfo(firstError),
    });
  }
  const seen = new Set();
  return rows.filter((c) => (seen.has(c.id) ? false : seen.add(c.id)));
}

/** The catalog(s) connected to the WABA now. [] when it can't be read. */
async function wabaCatalogs(business, tokens) {
  for (const t of tokens) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const { data } = await http.get(`${G()}/${business.wabaId}/product_catalogs`, authFor(t, { fields: 'id,name,product_count' }));
      return (data?.data || []).map((c) => normalizeCatalog(c));
    } catch (err) {
      logger.warn('could not read the WABA catalog', { business: business.name, via: t.kind, error: metaText(err) });
    }
  }
  return [];
}

/**
 * Catalogs owned by (or shared with) the Meta business that owns the WABA.
 * A business-integration system-user login can grant catalog_management
 * without listing catalog ids, and /me/businesses is empty for a system user,
 * so a catalog the business made in Commerce Manager would otherwise never be
 * offered. Tries each token in turn; `via` says which one could see them.
 */
/** The Meta business that owns the WABA ('' when no token can read it). */
async function wabaOwnerId(business, tokens) {
  for (const t of tokens) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const { data } = await http.get(`${G()}/${business.wabaId}`, authFor(t, { fields: 'owner_business_info' }));
      const id = String(data?.owner_business_info?.id || '');
      if (isId(id)) return id;
    } catch (err) {
      logger.warn('could not read the WABA owner business', { business: business.name, via: t.kind, error: metaText(err) });
    }
  }
  return '';
}

/**
 * WhatsApp Manager → Catalogue for this WABA, where the business can link a
 * catalog itself when Meta won't let the CRM do it ("Choose a Catalogue").
 */
export function whatsappManagerCatalogUrl(ownerBusinessId, wabaId) {
  const q = new URLSearchParams();
  if (isId(ownerBusinessId)) q.set('business_id', ownerBusinessId);
  if (isId(wabaId)) q.set('asset_id', wabaId);
  return `https://business.facebook.com/latest/whatsapp_manager/catalog${q.toString() ? `?${q}` : ''}`;
}

async function ownerBusinessCatalogs(business, tokens, ownerId) {
  const sub = `{${CATALOG_FIELDS}}`;
  if (!isId(ownerId)) return { via: '', catalogs: [] };
  for (const t of tokens) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const { data: owner } = await http.get(`${G()}/${ownerId}`, authFor(t, {
        fields: `id,name,owned_product_catalogs.limit(100)${sub},client_product_catalogs.limit(100)${sub}`,
      }));
      const list = [...(owner?.owned_product_catalogs?.data || []), ...(owner?.client_product_catalogs?.data || [])];
      return { via: t.kind, catalogs: list.map((c) => normalizeCatalog(c, owner?.name || '')) };
    } catch (err) {
      if (isRateLimit(err)) throw new CatalogError('Meta is busy right now. Try again in a minute.', { status: 429, code: 'RATE_LIMITED' });
      logger.warn('could not read the WABA owner business catalogs', { business: business.name, via: t.kind, error: metaText(err) });
    }
  }
  return { via: '', catalogs: [] };
}

// WhatsApp only links E-commerce catalogs. Meta's own refusal ("…of a type
// other than E-Commerce") is turned into steps the business can follow.
function notEcommerce(catalog, meta) {
  return new CatalogError(
    `${catalog.name} isn’t an E-commerce catalog, and WhatsApp only works with E-commerce catalogs. `
    + 'In Commerce Manager, click Add catalog, choose E-commerce, then come back and click Try again.',
    { status: 409, code: 'NOT_ECOMMERCE', ...(meta ? { meta } : {}) },
  );
}

const tenantToken = (business) => ({ kind: 'whatsapp', token: business.accessToken, proof: false });
const loginToken = (token) => ({ kind: 'login', token, proof: true });

const sessions = new Map(); // id -> { businessId, token, info, tokenSource, scopes, catalogs, onWaba, expiresAt }
function sweepSessions() {
  const now = Date.now();
  for (const [id, s] of sessions) if (s.expiresAt < now) sessions.delete(id);
}

/** Steps 1–2: code → token → catalogs. No token in the result. */
export async function startCatalogLogin(business, code) {
  requireConfig();
  requireWaba(business);
  const token = await exchangeCode(code);
  const info = await debugToken(token);
  const login = loginToken(token);
  const scopes = await grantedScopes(login, info);
  const catalogs = await listCatalogs(login, info);
  const onWaba = await wabaCatalogs(business, [tenantToken(business), login]);
  // The WABA's catalog is offered even when this login didn't grant it.
  for (const c of onWaba) if (!catalogs.some((x) => x.id === c.id)) catalogs.push({ ...c, viaWhatsApp: true });
  // Nothing granted by id: offer the catalogs of the business that owns the
  // WABA (made in Commerce Manager but not linked to WhatsApp yet). Read with
  // the login token first; if only the WhatsApp token can see them, they keep
  // using that token (viaWhatsApp), like the WABA's own catalog above.
  // Also gives the WhatsApp Manager link offered when Meta won't let the CRM
  // link a catalog itself.
  const ownerId = await wabaOwnerId(business, [tenantToken(business), login]);
  let fromOwner = 0;
  if (!catalogs.length) {
    const owned = await ownerBusinessCatalogs(business, [login, tenantToken(business)], ownerId);
    for (const c of owned.catalogs) {
      if (catalogs.some((x) => x.id === c.id)) continue;
      catalogs.push(owned.via === 'login' ? c : { ...c, viaWhatsApp: true });
      fromOwner += 1;
    }
  }

  const tokenSource = String(info?.type || '').toUpperCase() === 'SYSTEM_USER' ? 'system_user' : info?.type ? 'user' : '';
  sweepSessions();
  const businessId = String(business._id);
  for (const [id, s] of sessions) if (s.businessId === businessId) sessions.delete(id);
  const sessionId = crypto.randomBytes(18).toString('hex');
  const whatsappManagerUrl = whatsappManagerCatalogUrl(ownerId, business.wabaId);
  const session = { businessId, token, info, tokenSource, scopes, catalogs, onWaba, whatsappManagerUrl, expiresAt: Date.now() + SESSION_MS };
  sessions.set(sessionId, session);
  logger.info('Meta catalog login: catalogs listed', { business: business.name, catalogs: catalogs.length, onWaba: onWaba.length, fromOwner, tokenSource });
  return loginView(sessionId, session, business);
}

/** What the browser gets for a login session (never the token). */
function loginView(sessionId, s, business) {
  const onWabaIds = new Set(s.onWaba.map((c) => c.id));
  return {
    sessionId,
    tokenSource: s.tokenSource,
    currentId: business.catalogId || '',
    catalogs: s.catalogs.map((c) => ({
      id: c.id,
      name: c.name,
      productCount: c.productCount,
      vertical: c.vertical,
      businessName: c.businessName,
      onWhatsApp: onWabaIds.has(c.id),
    })),
    scopes: s.scopes,
    canManage: s.scopes.includes('catalog_management'),
    whatsappManagerUrl: s.whatsappManagerUrl || '',
  };
}

function liveSession(business, sessionId) {
  sweepSessions();
  const s = sessions.get(String(sessionId || ''));
  if (!s || s.businessId !== String(business._id)) {
    throw new CatalogError('Your Meta login has expired. Click Connect again.', { status: 409, code: 'SESSION_EXPIRED' });
  }
  return s;
}

/**
 * After the business linked a catalog itself in WhatsApp Manager: read what
 * is on the WABA now, add it to the list, and keep the session alive a while
 * longer (WhatsApp Manager can take a few minutes).
 */
export async function refreshCatalogLogin(business, { sessionId } = {}) {
  requireConfig();
  requireWaba(business);
  const s = liveSession(business, sessionId);
  s.onWaba = await wabaCatalogs(business, [tenantToken(business), loginToken(s.token)]);
  for (const c of s.onWaba) if (!s.catalogs.some((x) => x.id === c.id)) s.catalogs.push({ ...c, viaWhatsApp: true });
  s.expiresAt = Date.now() + SESSION_MS;
  logger.info('Meta catalog login: WABA catalogs re-read', { business: business.name, onWaba: s.onWaba.length });
  return loginView(String(sessionId), s, business);
}

/** POST / DELETE on /{waba}/product_catalogs with the first token Meta accepts. */
async function onWabaCall(method, business, catalogId, tokens) {
  let lastErr = null;
  for (const t of tokens) {
    try {
      const url = `${G()}/${business.wabaId}/product_catalogs`;
      // eslint-disable-next-line no-await-in-loop
      if (method === 'post') await http.post(url, null, authFor(t, { catalog_id: catalogId }));
      // eslint-disable-next-line no-await-in-loop
      else await http.delete(url, authFor(t, { catalog_id: catalogId }));
      return t.kind;
    } catch (err) {
      lastErr = err;
      logger.warn(`WABA catalog ${method} refused`, { business: business.name, catalogId, via: t.kind, metaCode: metaErr(err)?.code ?? null, error: metaText(err) });
    }
  }
  throw lastErr;
}

/** Step 3: connect the picked catalog to the WABA and to the CRM. */
export async function connectCatalog(business, { sessionId, catalogId } = {}) {
  requireConfig();
  requireWaba(business);
  const s = liveSession(business, sessionId);
  const catalog = s.catalogs.find((c) => c.id === String(catalogId || ''));
  if (!catalog) throw new CatalogError('That catalog isn’t one you granted access to. Pick one from the list.', { code: 'CATALOG_NOT_GRANTED' });

  const other = await Business.findOne({ catalogId: catalog.id, _id: { $ne: business._id } }).select('_id').lean();
  if (other) {
    throw new CatalogError(`${catalog.name} is already connected to another CRM account. Disconnect it there first.`, {
      status: 409, code: 'ASSET_IN_USE',
    });
  }

  const tokens = [tenantToken(business), loginToken(s.token)];
  // Read the WABA again rather than trusting the list from the login: the
  // business may have linked the catalog in WhatsApp Manager since then.
  // (An empty read keeps the earlier list, so a failed read changes nothing.)
  const fresh = await wabaCatalogs(business, tokens);
  if (fresh.length || !s.onWaba.length) s.onWaba = fresh;
  const alreadyOn = s.onWaba.some((c) => c.id === catalog.id);
  if (!alreadyOn) {
    // A WhatsApp Business Account has one catalog: move the old one off first.
    const removed = [];
    for (const old of s.onWaba) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await onWabaCall('delete', business, old.id, tokens);
        removed.push(old);
        logger.info('old catalog disconnected from the WABA', { business: business.name, catalogId: old.id });
      } catch (err) {
        logger.warn('could not disconnect the old WABA catalog', { business: business.name, catalogId: old.id, error: metaText(err) });
      }
    }
    try {
      await onWabaCall('post', business, catalog.id, tokens);
    } catch (err) {
      // Put the old catalog back, so a refusal doesn't leave WhatsApp without one.
      for (const old of removed) {
        // eslint-disable-next-line no-await-in-loop
        await onWabaCall('post', business, old.id, tokens).catch((e) => {
          logger.warn('could not reconnect the old WABA catalog', { business: business.name, catalogId: old.id, error: metaText(e) });
        });
      }
      if (isRateLimit(err)) throw new CatalogError('Meta is busy right now. Try again in a minute.', { status: 429, code: 'RATE_LIMITED' });
      if (/type other than e-?commerce/i.test(metaText(err))) throw notEcommerce(catalog, metaInfo(err));
      throw new CatalogError(
        `Meta didn’t let the CRM connect ${catalog.name} to your WhatsApp Business Account: ${metaText(err)}`,
        { status: 409, code: 'LINK_FAILED', meta: metaInfo(err) },
      );
    }
  }

  const now = new Date();
  business.catalogId = catalog.id;
  business.meta = { ...(business.meta || {}), catalogName: catalog.name };
  // A catalog only visible through the WhatsApp token keeps using that token.
  const ownToken = !catalog.viaWhatsApp;
  business.catalogConnection = {
    method: 'meta_login',
    token: ownToken ? encryptToken(s.token) : '',
    tokenSource: ownToken ? s.tokenSource || '' : '',
    scopes: s.scopes,
    metaBusinessId: catalog.businessId || '',
    metaBusinessName: catalog.businessName || '',
    connectedAt: now,
  };
  await business.save();
  sessions.delete(String(sessionId));

  logger.info('Meta catalog connected', { business: business.name, catalogId: catalog.id, alreadyOn, ownToken });
  notify(business._id, {
    type: 'catalog_connected',
    title: 'Catalog connected',
    body: `${catalog.name} (${catalog.id}) is connected to your WhatsApp Business Account.`,
    target: { view: 'catalog', id: catalog.id },
  }).catch(() => {});
  return { catalogId: catalog.id, catalogName: catalog.name, productCount: catalog.productCount };
}
