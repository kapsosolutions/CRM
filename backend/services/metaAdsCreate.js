// ---------------------------------------------------------------------------
// Ads Manager S1: the "Create campaign" wizard (Ads page → Campaigns).
//
// Everything is built here from validated fields; no browser JSON is passed
// to Meta as-is. Every object the CRM creates at Meta is created PAUSED.
// Only publishCampaign() sets ACTIVE, and only with { confirm: true } (the
// browser asks first, showing the budget and the dates).
//
// Flow:
//   1. createOptions: the ad account's currency, time zone, minimum daily
//      budget and payment method, the Pages it can promote, its pixels.
//   2. targetingSearch / targetingBrowse / estimateAudience: Meta's targeting
//      search (/search) and delivery_estimate for the live audience size.
//   3. pageDetails: the Page's Instagram accounts and linked WhatsApp number.
//   4. uploadImage / uploadVideo / videoStatus / mediaLibrary / createLeadForm.
//   5. previewCreative: act_/generatepreviews → only the iframe src, checked to
//      be an https facebook.com preview URL; the browser renders its own
//      sandboxed iframe.
//   6. createCampaign: campaign → ad set → creative → ad, all PAUSED. When a
//      later step fails, what was made is deleted again (in reverse order).
//   7. publishCampaign: ads, ad sets, then the campaign → ACTIVE.
//   8. Drafts (AdDraft): the wizard saved in the CRM, resumable.
//
// Writes need ads_management on the account (409 READ_ONLY otherwise, after
// a fresh permission check). Every id from the browser is checked against the
// connected ad account (or its Pages) before it is read or written. Errors 190
// (revoked) and rate limits are handled by withAdsToken / mapMetaError.
//
// Graph version: META_ADS_GRAPH_VERSION, else WA_GRAPH_VERSION. The Marketing
// API retires versions after about a year (v21.0 ended September 9, 2025), and
// the write endpoints used here are not auto-upgraded, so the platform owner
// should set META_ADS_GRAPH_VERSION to a live version (v24.0+). The payloads
// below are valid on v24–v26 (is_adset_budget_sharing_enabled sent for ad set
// budgets, instagram_user_id instead of instagram_actor_id, an explicit
// targeting_automation.advantage_audience, no detailed-targeting exclusions,
// no video_feeds placement).
// ---------------------------------------------------------------------------
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import AdDraft from '../models/AdDraft.js';
import {
  AdsError, requireAdsRow, requireAdsWriter, withAdsToken, refreshPermissions, assertInAccount, clearCache, auth, proof, http, budget,
  NO_MINOR_UNIT, isId, actNumber, listLeadForms, mapMetaError,
} from './metaAds.js';
import { imageKindOf, isVideoFile, AD_VIDEO_TMP_PREFIX } from '../middleware/upload.js';
import { notify } from './notifications.js';
import logger from './logger.js';
// Ads Manager S4: custom audience ids in the targeting are checked there.
import { assertAudiences } from './metaAdsAudiences.js';

export const adsGraphVersion = () => process.env.META_ADS_GRAPH_VERSION || process.env.WA_GRAPH_VERSION || 'v22.0';
const AG = () => `https://graph.facebook.com/${adsGraphVersion()}`;
// Meta's host for video uploads (act_/advideos with upload_phase).
const AGV = () => `https://graph-video.facebook.com/${adsGraphVersion()}`;
const CACHE_MS = 5 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const digits = (s) => String(s || '').replace(/\D/g, '');
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// ------------------------------------------------------------ allow-lists --

/** The wizard's goals → Meta objective, ad set destination, optimisation goals, CTAs. */
export const OBJECTIVES = {
  whatsapp: {
    label: 'Click-to-WhatsApp messages', objective: 'OUTCOME_ENGAGEMENT', destination: 'WHATSAPP',
    goals: ['CONVERSATIONS', 'LINK_CLICKS'], ctas: ['WHATSAPP_MESSAGE'], url: 'none',
  },
  traffic: {
    label: 'Website traffic', objective: 'OUTCOME_TRAFFIC', destination: 'WEBSITE',
    goals: ['LINK_CLICKS', 'LANDING_PAGE_VIEWS'],
    ctas: ['LEARN_MORE', 'SHOP_NOW', 'SIGN_UP', 'BOOK_NOW', 'CONTACT_US', 'ORDER_NOW', 'GET_OFFER', 'SUBSCRIBE', 'APPLY_NOW', 'GET_QUOTE', 'DOWNLOAD', 'WATCH_MORE'],
    url: 'required',
  },
  leads: {
    label: 'Leads with an instant form', objective: 'OUTCOME_LEADS', destination: 'ON_AD',
    goals: ['LEAD_GENERATION'], ctas: ['SIGN_UP', 'LEARN_MORE', 'APPLY_NOW', 'GET_QUOTE', 'SUBSCRIBE', 'DOWNLOAD'], url: 'none',
  },
  awareness: {
    label: 'Awareness', objective: 'OUTCOME_AWARENESS', destination: '',
    goals: ['REACH', 'IMPRESSIONS'], ctas: ['LEARN_MORE', 'SHOP_NOW', 'CONTACT_US', 'BOOK_NOW', 'ORDER_NOW', 'NO_BUTTON'], url: 'optional',
  },
  sales: {
    label: 'Sales (website conversions)', objective: 'OUTCOME_SALES', destination: 'WEBSITE',
    goals: ['OFFSITE_CONVERSIONS'], ctas: ['SHOP_NOW', 'BUY_NOW', 'ORDER_NOW', 'LEARN_MORE', 'SIGN_UP', 'BOOK_NOW', 'GET_OFFER'], url: 'required',
  },
};
export const CONVERSION_EVENTS = [
  'PURCHASE', 'ADD_TO_CART', 'INITIATED_CHECKOUT', 'ADD_PAYMENT_INFO', 'COMPLETE_REGISTRATION', 'LEAD', 'CONTENT_VIEW',
  'CONTACT', 'SUBSCRIBE', 'SEARCH', 'SCHEDULE', 'START_TRIAL', 'SUBMIT_APPLICATION',
];
export const SPECIAL_CATEGORIES = ['CREDIT', 'FINANCIAL_PRODUCTS_SERVICES', 'EMPLOYMENT', 'HOUSING', 'ISSUES_ELECTIONS_POLITICS'];
// Housing, employment and credit/financial ads: Meta limits their targeting.
const RESTRICTED = new Set(['CREDIT', 'FINANCIAL_PRODUCTS_SERVICES', 'EMPLOYMENT', 'HOUSING']);
export const BID_STRATEGIES = ['LOWEST_COST_WITHOUT_CAP', 'COST_CAP', 'LOWEST_COST_WITH_BID_CAP'];
export const POSITIONS = {
  facebook: ['feed', 'profile_feed', 'right_hand_column', 'marketplace', 'search', 'story', 'facebook_reels', 'instream_video'],
  instagram: ['stream', 'profile_feed', 'explore', 'explore_home', 'story', 'reels', 'ig_search'],
  messenger: ['story'],
  audience_network: ['classic', 'rewarded_video'],
};
const POSITION_KEY = {
  facebook: 'facebook_positions', instagram: 'instagram_positions', messenger: 'messenger_positions', audience_network: 'audience_network_positions',
};
// The wizard's preview placements → Meta's generatepreviews ad_format
// (Marketing API reference, ad-account/generatepreviews). Keys are the CRM's;
// only these values are ever sent to Meta.
export const PREVIEW_FORMATS = {
  facebook_feed: 'MOBILE_FEED_STANDARD',
  facebook_desktop_feed: 'DESKTOP_FEED_STANDARD',
  facebook_profile_feed: 'FACEBOOK_PROFILE_FEED_MOBILE',
  facebook_story: 'FACEBOOK_STORY_MOBILE',
  facebook_reels: 'FACEBOOK_REELS_MOBILE',
  facebook_marketplace: 'MARKETPLACE_MOBILE',
  facebook_video_feeds: 'SUGGESTED_VIDEO_MOBILE',
  facebook_instream: 'INSTREAM_VIDEO_MOBILE',
  facebook_right_column: 'RIGHT_COLUMN_STANDARD',
  instagram_feed: 'INSTAGRAM_STANDARD',
  instagram_profile_feed: 'INSTAGRAM_PROFILE_FEED',
  instagram_story: 'INSTAGRAM_STORY',
  reels: 'INSTAGRAM_REELS',
  instagram_explore: 'INSTAGRAM_EXPLORE_CONTEXTUAL',
  instagram_explore_home: 'INSTAGRAM_EXPLORE_GRID_HOME',
  instagram_search: 'INSTAGRAM_SEARCH_CHAIN',
  messenger_inbox: 'MESSENGER_MOBILE_INBOX_MEDIA',
  messenger_story: 'MESSENGER_MOBILE_STORY_MEDIA',
  whatsapp_status: 'WHATSAPP_STATUS_MEDIA',
  an_native: 'MOBILE_NATIVE',
  an_interstitial: 'MOBILE_INTERSTITIAL',
  an_rewarded_video: 'AUDIENCE_NETWORK_REWARDED_VIDEO',
};
// flexible_spec keys for detailed targeting (interests, behaviours, demographics).
const DETAILED_KINDS = new Set([
  'interests', 'behaviors', 'life_events', 'industries', 'income', 'family_statuses', 'education_statuses',
  'relationship_statuses', 'work_positions', 'work_employers', 'education_schools', 'education_majors',
]);
const GEO_KINDS = new Set(['country', 'region', 'city']);
const LEAD_QUESTIONS = ['FULL_NAME', 'EMAIL', 'PHONE'];
const CTWA_LINK = 'https://api.whatsapp.com/send';
const LEAD_LINK = 'http://fb.me/'; // the only link Meta accepts on lead-form ads

// Minimum daily budget when Meta doesn't return min_daily_budget (major units,
// roughly USD 1 of delivery). Meta still rejects a budget under its own limit.
const FALLBACK_MIN = {
  USD: 1, EUR: 1, GBP: 1, CAD: 1, AUD: 1, NZD: 1, SGD: 1, CHF: 1, INR: 85, AED: 4, SAR: 4, QAR: 4, BRL: 5, MXN: 20,
  ZAR: 18, TRY: 35, PHP: 55, THB: 35, MYR: 5, PKR: 280, BDT: 120, NGN: 1500, KES: 130, EGP: 50, LKR: 300, NPR: 135,
  JPY: 150, KRW: 1400, IDR: 16000, VND: 25000, TWD: 32, CLP: 950, COP: 4000, CRC: 520, HUF: 370, ISK: 140, PYG: 7500,
};

const noMinor = (cur) => NO_MINOR_UNIT.has(String(cur || '').toUpperCase());
/** Major units → Meta's minor units (budget() in reverse). */
export const toMinor = (v, cur) => (noMinor(cur) ? Math.round(Number(v)) : Math.round(Number(v) * 100));
const fromMinor = (v, cur) => budget(v, cur);

// --------------------------------------------------------------- errors --

/** A validation error that names the field (the wizard highlights it). */
class FieldError extends AdsError {
  constructor(field, message, opts = {}) {
    super(message, { status: 400, code: 'INVALID_INPUT', ...opts });
    this.field = field;
  }

  toJSON() {
    return { ...super.toJSON(), field: this.field };
  }
}
const bad = (field, message) => new FieldError(field, message);

/** createCampaign failed at Meta: which step, and what was rolled back. */
class CreateError extends AdsError {
  constructor(cause, step, rollback) {
    const left = rollback.filter((r) => !r.deleted);
    const what = { campaign: 'the campaign', adset: 'the ad set', creative: 'the ad creative', ad: 'the ad' }[step] || step;
    const tail = !rollback.length
      ? 'Nothing was created at Meta.'
      : left.length
        ? `The CRM could not delete everything it made: ${left.map((r) => `${r.level} ${r.id}`).join(', ')}. Delete it in Ads Manager (it is paused and doesn't spend).`
        : 'What was already created was deleted again, so nothing is left at Meta.';
    super(`Meta didn’t accept ${what}: ${cause.message.replace(/^Meta returned an error: /, '')} ${tail}`, {
      status: cause.status || 502, code: cause.code || 'META_ERROR', meta: cause.meta || null,
    });
    this.step = step;
    this.rollback = rollback;
  }

  toJSON() {
    return { ...super.toJSON(), step: this.step, rolledBack: this.rollback };
  }
}

const READ_ONLY_TEXT = 'The CRM can only read this ad account. To create campaigns here, reconnect and allow managing ads (ads_management).';
/** Errors that mean "this lookup isn't available", not "stop". */
const soft = (e) => e instanceof AdsError && ['PERMISSION_MISSING', 'META_ERROR'].includes(e.code);

// ---------------------------------------------------------------- graph --

const bearer = (t) => ({ Authorization: `Bearer ${t}` });

function gGet(row, path, params = {}, kind = 'ad') {
  return withAdsToken(row, kind, async (token) => (await http.get(`${AG()}/${path}`, auth(token, params))).data);
}

/** All result pages (bounded) of a Graph edge. */
function gList(row, path, params = {}, { kind = 'ad', maxPages = 3 } = {}) {
  return withAdsToken(row, kind, async (token) => {
    const out = [];
    let next = `${AG()}/${path}`;
    let opts = auth(token, params);
    for (let i = 0; i < maxPages && next; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const { data } = await http.get(next, opts);
      out.push(...(data?.data || []));
      next = data?.paging?.next || '';
      opts = { headers: bearer(token) }; // the next link carries its query
    }
    return out;
  });
}

/** POST a JSON body; appsecret_proof as a query param. */
function gPost(row, path, body, kind = 'ad') {
  return withAdsToken(row, kind, async (token) => (await http.post(`${AG()}/${path}`, body, {
    params: { appsecret_proof: proof(token) },
    headers: { ...bearer(token), 'Content-Type': 'application/json' },
  })).data);
}

function gPostForm(row, path, form, timeout = 25000, base = AG) {
  return withAdsToken(row, 'ad', async (token) => (await http.post(`${base()}/${path}`, form, {
    params: { appsecret_proof: proof(token) },
    headers: bearer(token),
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    timeout,
  })).data);
}

function gDelete(row, path) {
  return withAdsToken(row, 'ad', async (token) => (await http.delete(`${AG()}/${path}`, auth(token))).data);
}

// ---------------------------------------------------------------- cache --

const memoMap = new Map(); // `${businessId}|${act}|${key}` -> { at, data }
async function memo(row, key, fn, { refresh = false, ttl = CACHE_MS } = {}) {
  const k = `${String(row.businessId)}|${row.adAccountId}|${key}`;
  const hit = memoMap.get(k);
  if (!refresh && hit && Date.now() - hit.at < ttl) return hit.data;
  const data = await fn();
  if (memoMap.size > 2000) memoMap.clear();
  memoMap.set(k, { at: Date.now(), data });
  return data;
}
function clearAll(businessId) {
  clearCache(businessId);
  const prefix = `${String(businessId)}|`;
  for (const k of memoMap.keys()) if (k.startsWith(prefix)) memoMap.delete(k);
}

// Videos uploaded through this process (their ids skip the library lookup),
// per business AND ad account: after a reconnect to another ad account the
// old ids go through the library check again.
const uploadedVideos = new Map(); // `${businessId}|${adAccountId}` -> Set(videoId)
const videoKey = (row) => `${String(row.businessId)}|${row.adAccountId}`;
const rememberVideo = (row, id) => {
  const k = videoKey(row);
  if (!uploadedVideos.has(k)) uploadedVideos.set(k, new Set());
  const s = uploadedVideos.get(k);
  if (s.size > 500) s.clear();
  s.add(String(id));
};

// ----------------------------------------------------------------- guard --

/** A write: Graph version ≥ v24, connected, ads_management re-checked now (409 GRAPH_VERSION_TOO_OLD / READ_ONLY). */
const requireWriter = (businessId) => requireAdsWriter(businessId, READ_ONLY_TEXT);

// ------------------------------------------- in-flight lock + request id --
// A double click or a retry after a proxy timeout must not create a second
// campaign (or publish twice). Per business: one create and one publish at a
// time (409 IN_PROGRESS). With a client request id, the same id again gets
// the first answer back (`replayed: true`) for 15 minutes instead of a new
// run. Kept in this process's memory: the CRM runs one backend process.
const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;
const REPLAY_MS = 15 * 60 * 1000;
const inflight = new Map(); // `${businessId}|${what}` -> { requestId, promise }
const replays = new Map(); // `${businessId}|${what}|${requestId}` -> { at, result }

function requestIdOf(v) {
  if (v === undefined || v === null || v === '') return '';
  const s = String(v);
  if (!REQUEST_ID.test(s)) throw bad('requestId', 'The request id isn’t valid. Reload the page and try again.');
  return s;
}

async function once(businessId, what, requestId, busyText, fn) {
  const now = Date.now();
  for (const [k, v] of replays) if (now - v.at > REPLAY_MS) replays.delete(k);
  const rk = requestId ? `${String(businessId)}|${what}|${requestId}` : '';
  if (rk && replays.has(rk)) return { ...replays.get(rk).result, replayed: true };
  const lk = `${String(businessId)}|${what}`;
  const busy = inflight.get(lk);
  if (busy) {
    if (requestId && busy.requestId === requestId) return { ...(await busy.promise), replayed: true };
    throw new AdsError(busyText, { status: 409, code: 'IN_PROGRESS' });
  }
  const entry = { requestId, promise: null };
  inflight.set(lk, entry);
  entry.promise = fn();
  try {
    const result = await entry.promise;
    if (rk) {
      if (replays.size > 2000) replays.clear();
      replays.set(rk, { at: Date.now(), result });
    }
    return result;
  } finally {
    inflight.delete(lk);
  }
}

// -------------------------------------------------------------- lookups --

async function accountInfo(row, refresh = false) {
  return memo(row, 'account', async () => {
    const a = await gGet(row, row.adAccountId, { fields: 'id,name,currency,timezone_name,min_daily_budget,account_status' });
    // The payment method needs the MANAGE task; unknown (null) when Meta won't say.
    let hasPaymentMethod = null;
    try {
      const f = await gGet(row, row.adAccountId, { fields: 'funding_source' });
      hasPaymentMethod = !!f?.funding_source;
    } catch (e) {
      if (!soft(e)) throw e;
    }
    const currency = String(a?.currency || row.adAccountCurrency || 'USD').toUpperCase();
    const fromMeta = num(a?.min_daily_budget) > 0;
    const minMinor = fromMeta ? Math.ceil(num(a.min_daily_budget)) : toMinor(FALLBACK_MIN[currency] ?? 1, currency);
    return {
      id: row.adAccountId,
      name: a?.name || row.adAccountName || '',
      currency,
      timezone: a?.timezone_name || row.adAccountTimezone || 'UTC',
      accountStatus: num(a?.account_status),
      minDailyBudget: fromMinor(minMinor, currency),
      minDailyBudgetMinor: minMinor,
      minDailyBudgetSource: fromMeta ? 'meta' : 'fallback',
      hasPaymentMethod,
    };
  }, { refresh });
}

/** The Pages this ad account can promote (act_/promote_pages, else the token's Pages). */
async function promotePages(row, refresh = false) {
  return memo(row, 'pages', async () => {
    let list = [];
    try {
      list = await gList(row, `${row.adAccountId}/promote_pages`, { fields: 'id,name,picture{url}', limit: 100 });
    } catch (e) {
      if (!soft(e)) throw e;
    }
    if (!list.length) {
      try {
        list = await gList(row, 'me/accounts', { fields: 'id,name,picture{url}', limit: 100 });
      } catch (e) {
        if (!soft(e)) throw e;
      }
    }
    const pages = list.filter((p) => isId(p.id)).map((p) => ({ id: String(p.id), name: p.name || `Page ${p.id}`, picture: p.picture?.data?.url || '' }));
    if (row.pageId && !pages.some((p) => p.id === row.pageId)) pages.push({ id: row.pageId, name: row.pageName || `Page ${row.pageId}`, picture: '' });
    return pages.map((p) => ({ ...p, leadForms: p.id === row.pageId && !!row.pageAccessToken }));
  }, { refresh });
}

async function pixelsOf(row, refresh = false) {
  return memo(row, 'pixels', async () => {
    try {
      const list = await gList(row, `${row.adAccountId}/adspixels`, { fields: 'id,name,last_fired_time,is_unavailable', limit: 50 }, { maxPages: 2 });
      return list.filter((p) => isId(p.id)).map((p) => ({
        id: String(p.id), name: p.name || `Pixel ${p.id}`, lastFiredTime: p.last_fired_time || null, unavailable: !!p.is_unavailable,
      }));
    } catch (e) {
      if (!soft(e)) throw e;
      return [];
    }
  }, { refresh });
}

async function whatsappOf(row, pageId, refresh = false) {
  return memo(row, `wa|${pageId}`, async () => {
    try {
      const p = await gGet(row, pageId, { fields: 'whatsapp_number,has_whatsapp_number,has_whatsapp_business_number' });
      const n = digits(p?.whatsapp_number);
      // Meta leaves these fields out entirely when it won't share them with
      // this app (only { id } comes back). That means "unknown", not "not
      // linked": only an explicit answer may block the ad.
      const answered = p && ['whatsapp_number', 'has_whatsapp_number', 'has_whatsapp_business_number'].some((k) => p[k] !== undefined && p[k] !== null);
      if (!answered) return { checked: false, linked: null, number: '', digits: '', business: false };
      return {
        checked: true,
        linked: !!(n || p?.has_whatsapp_number || p?.has_whatsapp_business_number),
        number: n ? `+${n}` : '',
        digits: n,
        business: !!p?.has_whatsapp_business_number,
      };
    } catch (e) {
      if (!soft(e)) throw e;
      return { checked: false, linked: null, number: '', digits: '', business: false };
    }
  }, { refresh });
}

async function instagramFor(row, pageId, refresh = false) {
  return memo(row, `ig|${pageId}`, async () => {
    const out = new Map();
    const add = (a, source) => {
      if (a && isId(a.id) && !out.has(String(a.id))) {
        out.set(String(a.id), { id: String(a.id), username: a.username || '', picture: a.profile_picture_url || a.profile_pic || '', source });
      }
    };
    try {
      const p = await gGet(row, pageId, { fields: 'instagram_business_account{id,username,profile_picture_url}' });
      add(p?.instagram_business_account, 'page');
    } catch (e) {
      if (!soft(e)) throw e;
    }
    try {
      for (const a of await gList(row, `${row.adAccountId}/instagram_accounts`, { fields: 'id,username,profile_pic', limit: 50 }, { maxPages: 1 })) add(a, 'ad_account');
    } catch (e) {
      if (!soft(e)) throw e;
    }
    // Like Ads Manager: Instagram accounts the ad account's business portfolio
    // owns, even when they aren't linked to the Page or assigned to the ad account.
    try {
      const bid = await businessOf(row, refresh);
      if (bid) {
        for (const a of await gList(row, `${bid}/owned_instagram_accounts`, { fields: 'id,username,profile_picture_url', limit: 50 }, { maxPages: 1 })) add(a, 'business');
      }
    } catch (e) {
      if (!soft(e)) throw e;
    }
    return [...out.values()];
  }, { refresh });
}

/** The business portfolio that owns the ad account ('' when Meta won't say). */
async function businessOf(row, refresh = false) {
  return memo(row, 'business', async () => {
    try {
      const a = await gGet(row, row.adAccountId, { fields: 'business{id}' });
      return isId(a?.business?.id) ? String(a.business.id) : '';
    } catch (e) {
      if (!soft(e)) throw e;
      return '';
    }
  }, { refresh, ttl: 30 * 60 * 1000 });
}

/** S5: the ad account's custom conversions (act_/customconversions), read only to check a chosen one; [] when Meta won't say. */
async function conversionsOf(row, refresh = false) {
  return memo(row, 'customconversions', async () => {
    try {
      const list = await gList(row, `${row.adAccountId}/customconversions`, { fields: 'id,name,custom_event_type,pixel{id},is_archived,is_unavailable', limit: 100 }, { maxPages: 2 });
      return list.filter((c) => isId(c.id)).map((c) => ({
        id: String(c.id), name: c.name || `Custom conversion ${c.id}`, eventType: c.custom_event_type || 'OTHER', pixelId: c.pixel?.id ? String(c.pixel.id) : '',
        archived: !!c.is_archived, unavailable: !!c.is_unavailable,
      }));
    } catch (e) {
      if (!soft(e)) throw e;
      return [];
    }
  }, { refresh });
}

export async function createOptions(businessId, q = {}) {
  let row = await requireAdsRow(businessId);
  row = await refreshPermissions(row);
  const refresh = q.refresh === '1';
  const [account, pages, pixels] = await Promise.all([accountInfo(row, refresh), promotePages(row, refresh), pixelsOf(row, refresh)]);
  // S5: the wizard's Sales step reads custom conversions from GET /meta/automation/pixels.
  return {
    account,
    canManage: !!row.canManageAds,
    graphVersion: adsGraphVersion(),
    pages,
    leadFormsPage: row.pageId ? { id: row.pageId, name: row.pageName || '', hasToken: !!row.pageAccessToken } : null,
    pixels,
  };
}

// ------------------------------------------------------- existing posts --
// "Use existing post", like Ads Manager: a Facebook Page post
// (object_story_id = its promotable_id) or an Instagram post
// (source_instagram_media_id + instagram_user_id + the Page as object_id).
// Page posts are read with the Page's token (asked for with the ad token,
// pages_read_engagement); Instagram media with the ad token (instagram_basic).
// Meta's own eligibility flags decide what can be picked.

const FB_POST_ID = /^\d{1,30}_\d{1,30}$/;
const POST_FIELDS_FB = 'id,promotable_id,message,created_time,full_picture,permalink_url,is_eligible_for_promotion,instagram_eligibility,status_type,attachments{media_type}';
const POST_FIELDS_IG = 'id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,boost_eligibility_info';
const POSTS_TTL = 2 * 60 * 1000;
const httpsOr = (u) => (/^https:\/\//.test(String(u || '')) ? String(u) : '');

/** A Page access token for one of the Pages the ad account can promote (never leaves the server). */
async function pageTokenOf(row, pageId) {
  return memo(row, `ptok|${pageId}`, async () => {
    const p = await gGet(row, pageId, { fields: 'access_token' });
    if (!p?.access_token) {
      throw new AdsError('Meta didn’t give the CRM access to this Page’s posts. Reconnect the ad account and allow the Page (pages_read_engagement).', {
        status: 409, code: 'PERMISSION_MISSING',
      });
    }
    return String(p.access_token);
  }, { ttl: 30 * 60 * 1000 });
}

const fbPostOf = (p) => {
  const type = String(p.attachments?.data?.[0]?.media_type || '').toLowerCase();
  const eligible = p.is_eligible_for_promotion === undefined ? null : !!p.is_eligible_for_promotion;
  return {
    id: FB_POST_ID.test(String(p.promotable_id || '')) ? String(p.promotable_id) : String(p.id),
    source: 'facebook',
    text: String(p.message || '').slice(0, 2200),
    picture: httpsOr(p.full_picture),
    permalink: httpsOr(p.permalink_url),
    createdAt: p.created_time || null,
    mediaType: type === 'video' ? 'VIDEO' : type === 'album' ? 'CAROUSEL_ALBUM' : type === 'photo' ? 'IMAGE' : type ? type.toUpperCase() : 'TEXT',
    eligible,
    reason: eligible === false ? 'Meta says this post can’t be promoted.' : '',
    instagramEligible: p.instagram_eligibility ? p.instagram_eligibility === 'eligible' : null,
  };
};

// Meta's field is boost_ineligible_reason, a sentence like "Remove or choose
// different audio." (older answers used a code in ineligible_reason).
const IG_REASON = (b) => {
  const raw = String(b?.boost_ineligible_reason || b?.ineligible_reason || b?.reason || '').trim().slice(0, 300);
  if (!raw) return 'Meta says this post can’t be boosted.';
  const r = /^[A-Z0-9_]+$/.test(raw) ? raw.replace(/_/g, ' ').toLowerCase() : raw.replace(/\.$/, '');
  return `Meta says this post can’t be boosted: ${r}.`;
};
// Reels with licensed music ("Remove or choose different audio."). Ads Manager
// can swap the music; the Marketing API can't: a live test (Oct 2026) with
// creative_features_spec.music_generation / audio and asset_feed_spec.audios
// all got 100/2875030 "Reels that use copyrighted music can't be boosted as ads".
const AUDIO_REASON = /\b(audio|music|song|sound)\b/i;
export const AUDIO_BLOCKED_TEXT = 'This reel uses copyrighted music, and Meta only lets you change a reel’s music inside Meta Ads Manager, not from other apps. Change the music there, or upload the video with different music as a Single video ad.';
const igPostOf = (m) => {
  const b = m.boost_eligibility_info || null;
  const eligible = b && typeof b.eligible_to_boost === 'boolean' ? b.eligible_to_boost : null;
  const audioBlocked = eligible === false && AUDIO_REASON.test(String(b?.boost_ineligible_reason || b?.ineligible_reason || b?.reason || ''));
  return {
    id: String(m.id),
    source: 'instagram',
    text: String(m.caption || '').slice(0, 2200),
    picture: httpsOr(m.media_type === 'VIDEO' ? m.thumbnail_url || m.media_url : m.media_url || m.thumbnail_url),
    permalink: httpsOr(m.permalink),
    createdAt: m.timestamp || null,
    mediaType: String(m.media_type || 'IMAGE'),
    productType: String(m.media_product_type || ''),
    eligible,
    reason: eligible === false ? IG_REASON(b) : '',
    audioBlocked,
  };
};

async function fbPosts(row, pageId, refresh) {
  return memo(row, `posts|fb|${pageId}`, async () => {
    const token = await pageTokenOf(row, pageId);
    try {
      const { data } = await http.get(`${AG()}/${pageId}/published_posts`, auth(token, { fields: POST_FIELDS_FB, limit: 30 }));
      return (data?.data || []).filter((p) => FB_POST_ID.test(String(p.id))).map(fbPostOf);
    } catch (err) {
      throw mapPostsError(err, 'Facebook Page');
    }
  }, { refresh, ttl: POSTS_TTL });
}

async function igPosts(row, igId, refresh) {
  return memo(row, `posts|ig|${igId}`, async () => {
    const list = await gList(row, `${igId}/media`, { fields: POST_FIELDS_IG, limit: 30 }, { maxPages: 1 });
    // Stories can't be listed here (only live ones exist); ads from feed posts and reels.
    return list.filter((m) => isId(m.id) && m.media_product_type !== 'STORY').map(igPostOf);
  }, { refresh, ttl: POSTS_TTL });
}

function mapPostsError(err, what) {
  const e = mapMetaError(err);
  if (e.code === 'PERMISSION_MISSING') {
    return new AdsError(`Meta didn’t allow the CRM to read this ${what}’s posts. Reconnect the ad account and allow reading the Page (pages_read_engagement).`, { status: 409, code: 'PERMISSION_MISSING', meta: e.meta });
  }
  return e;
}

/** GET /meta/create/pages/:id/posts?source=facebook|instagram&instagramId=…: posts that can be used as the ad. */
export async function pagePosts(businessId, pageId, q = {}) {
  const row = await requireAdsRow(businessId);
  if (!isId(pageId)) throw new AdsError('Unknown Page.', { status: 400, code: 'BAD_ID' });
  const refresh = q.refresh === '1';
  const source = String(q.source || 'facebook');
  if (!['facebook', 'instagram'].includes(source)) throw new AdsError('Pick Facebook or Instagram posts.', { status: 400, code: 'BAD_SOURCE' });
  const pages = await promotePages(row, false);
  if (!pages.some((p) => p.id === String(pageId))) throw new AdsError('That Facebook Page isn’t one this ad account can promote.', { status: 404, code: 'NOT_IN_ACCOUNT' });
  if (source === 'facebook') return { source, pageId: String(pageId), posts: await fbPosts(row, String(pageId), refresh) };
  const igId = String(q.instagramId || '');
  if (!isId(igId)) throw new AdsError('Pick the Instagram account in the Identity step first.', { status: 400, code: 'BAD_ID' });
  const ig = await instagramFor(row, String(pageId), false);
  if (!ig.some((a) => a.id === igId)) throw new AdsError('That Instagram account isn’t linked to the Page or the ad account.', { status: 404, code: 'NOT_IN_ACCOUNT' });
  return { source, pageId: String(pageId), instagramId: igId, posts: await igPosts(row, igId, refresh) };
}

/** The chosen post must be one of the Page's (or its Instagram account's) posts that Meta lets you promote. */
async function assertPost(row, identity, post) {
  const list = post.source === 'facebook' ? await fbPosts(row, identity.pageId, false) : await igPosts(row, identity.instagramId, false);
  let hit = list.find((p) => p.id === post.id);
  if (!hit) {
    const fresh = post.source === 'facebook' ? await fbPosts(row, identity.pageId, true) : await igPosts(row, identity.instagramId, true);
    hit = fresh.find((p) => p.id === post.id);
  }
  if (!hit) {
    throw new AdsError(post.source === 'facebook'
      ? 'That post isn’t one of the chosen Page’s recent posts. Pick it again.'
      : 'That post isn’t one of the chosen Instagram account’s recent posts. Pick it again.', { status: 404, code: 'NOT_IN_PAGE' });
  }
  if (hit.eligible === false && hit.audioBlocked) throw bad('creative.post', AUDIO_BLOCKED_TEXT);
  if (hit.eligible === false) throw bad('creative.post', hit.reason || 'Meta says this post can’t be promoted. Pick another one.');
  return hit;
}

/** One Page: its WhatsApp number and Instagram accounts. */
export async function pageDetails(businessId, pageId, q = {}) {
  const row = await requireAdsRow(businessId);
  if (!isId(pageId)) throw new AdsError('Unknown Page.', { status: 400, code: 'BAD_ID' });
  const refresh = q.refresh === '1';
  const page = (await promotePages(row, refresh)).find((p) => p.id === String(pageId));
  if (!page) throw new AdsError('That Facebook Page isn’t one this ad account can promote.', { status: 404, code: 'NOT_IN_ACCOUNT' });
  const [whatsapp, instagram] = await Promise.all([whatsappOf(row, page.id, refresh), instagramFor(row, page.id, refresh)]);
  const { digits: _d, ...wa } = whatsapp;
  // Why no Instagram account shows: Meta withholds them all from a token
  // without instagram_basic (the ads login configuration must ask for it).
  const scopes = Array.isArray(row.grantedScopes) ? row.grantedScopes : [];
  const instagramIssue = instagram.length ? '' : scopes.includes('instagram_basic') ? 'NOT_LINKED' : 'NO_PERMISSION';
  return { page, whatsapp: wa, instagram, instagramIssue };
}

// ------------------------------------------------------------ targeting --

const SEARCH_TYPES = { geo: 'adgeolocation', interest: 'adinterest', locale: 'adlocale' };

function geoLabel(g) {
  return [g.name, g.type === 'city' ? g.region : '', g.type !== 'country' ? g.country_name : ''].filter(Boolean).join(', ');
}

/** ?type=geo|interest|locale&q= → Meta's targeting search, normalised. */
export async function targetingSearch(businessId, q = {}) {
  const row = await requireAdsRow(businessId);
  const type = String(q.type || '');
  if (!SEARCH_TYPES[type]) throw bad('type', 'Unknown search type.');
  const text = String(q.q || '').trim();
  if (!text) return { type, results: [] };
  if (text.length > 100) throw bad('q', 'Search for at most 100 characters.');
  const params = { type: SEARCH_TYPES[type], q: text, limit: type === 'interest' ? 20 : 12 };
  if (type === 'geo') params.location_types = JSON.stringify(['country', 'region', 'city']);
  const data = await memo(row, `search|${type}|${text.toLowerCase()}`, () => gList(row, 'search', params, { maxPages: 1 }), { ttl: 30 * 60 * 1000 });
  let results;
  if (type === 'geo') {
    results = data.filter((g) => GEO_KINDS.has(g.type) && g.key).map((g) => ({
      key: String(g.key), kind: g.type, name: g.name || '', label: geoLabel(g), countryCode: String(g.country_code || '').toUpperCase(),
      supportsRadius: g.type === 'city' && g.supports_radius !== false,
    }));
  } else if (type === 'interest') {
    results = data.filter((i) => isId(i.id)).map((i) => ({
      id: String(i.id), name: i.name || '', kind: 'interests', path: Array.isArray(i.path) ? i.path : [],
      sizeLower: num(i.audience_size_lower_bound) || null, sizeUpper: num(i.audience_size_upper_bound) || null,
    }));
  } else {
    results = data.filter((l) => Number.isInteger(Number(l.key))).map((l) => ({ key: Number(l.key), name: l.name || '' }));
  }
  return { type, results };
}

/** ?class=interests|behaviors|demographics → Meta's browse tree (adTargetingCategory). */
export async function targetingBrowse(businessId, q = {}) {
  const row = await requireAdsRow(businessId);
  const cls = String(q.class || '');
  if (!['interests', 'behaviors', 'demographics'].includes(cls)) throw bad('class', 'Unknown category.');
  const data = await memo(row, `browse|${cls}`, () => gList(row, 'search', { type: 'adTargetingCategory', class: cls, limit: 1000 }, { maxPages: 1 }), { ttl: 6 * 60 * 60 * 1000 });
  const items = data
    .map((i) => ({
      id: String(i.id || ''), name: i.name || '', kind: cls === 'interests' ? 'interests' : String(i.type || cls),
      path: Array.isArray(i.path) ? i.path : [], sizeLower: num(i.audience_size_lower_bound) || null, sizeUpper: num(i.audience_size_upper_bound) || null,
    }))
    .filter((i) => isId(i.id) && DETAILED_KINDS.has(i.kind));
  return { class: cls, items };
}

// ----------------------------------------------------------- validation --

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
function text(v, max, field, label, { required = false } = {}) {
  if (v !== undefined && v !== null && typeof v !== 'string') throw bad(field, `${label} must be text.`);
  const s = String(v ?? '').replace(CONTROL, '').trim();
  if (required && !s) throw bad(field, `${label} is required.`);
  if (s.length > max) throw bad(field, `${label} can be at most ${max} characters.`);
  return s;
}
function httpsUrl(v, field, label, { required = false } = {}) {
  const s = text(v, 1000, field, label, { required });
  if (!s) return '';
  let u;
  try {
    u = new URL(s);
  } catch {
    throw bad(field, `${label} must be a full https:// address.`);
  }
  if (u.protocol !== 'https:' || !u.hostname.includes('.') || u.username || u.password) throw bad(field, `${label} must be a full https:// address.`);
  return u.toString();
}
function oneOf(v, list, field, label) {
  const s = String(v ?? '');
  if (!list.includes(s)) throw bad(field, `${label}: pick one of the options.`);
  return s;
}
function idOf(v, field, label, { required = false } = {}) {
  const s = String(v ?? '').trim();
  if (!s) {
    if (required) throw bad(field, `${label} is required.`);
    return '';
  }
  if (!isId(s)) throw bad(field, `${label} isn’t a valid id.`);
  return s;
}
function intIn(v, min, max, field, label) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(field, `${label} must be a whole number from ${min} to ${max}.`);
  return n;
}
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const arr = (v, max, field, label) => {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw bad(field, `${label} must be a list.`);
  if (v.length > max) throw bad(field, `${label}: at most ${max}.`);
  return v;
};

/** The wall-clock offset of `tz` at a UTC instant, in ms. */
function tzOffsetMs(utcMs, tz) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = Object.fromEntries(dtf.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - utcMs;
}
const validTz = (tz) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(0);
    return true;
  } catch {
    return false;
  }
};

/** 'YYYY-MM-DDTHH:mm' in the ad account's time zone → UTC ms (NaN if malformed). */
export function zonedToUtc(local, tz) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(local || ''));
  if (!m) return NaN;
  const zone = validTz(tz) ? tz : 'UTC';
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const back = new Date(guess);
  if (back.getUTCMonth() !== +m[2] - 1 || back.getUTCDate() !== +m[3]) return NaN; // 2026-02-31
  let t = guess - tzOffsetMs(guess, zone);
  t = guess - tzOffsetMs(t, zone);
  return t;
}

function specialOf(raw) {
  const list = arr(raw, 5, 'specialAdCategories', 'Special ad categories').map(String);
  for (const c of list) if (!SPECIAL_CATEGORIES.includes(c)) throw bad('specialAdCategories', 'Unknown special ad category.');
  return [...new Set(list)];
}

function goalOf(objKey, raw) {
  const goals = OBJECTIVES[objKey].goals;
  if (raw === undefined || raw === null || raw === '') return goals[0];
  return oneOf(raw, goals, 'optimizationGoal', 'Optimise for');
}

function geoItem(g, field, { restricted }) {
  const o = obj(g);
  const kind = oneOf(o.kind, [...GEO_KINDS], field, 'Location type');
  const key = String(o.key ?? '');
  if (kind === 'country' ? !/^[A-Z]{2}$/.test(key) : !/^\d{1,15}$/.test(key)) throw bad(field, 'That location isn’t valid. Pick it from the search.');
  const countryCode = String(o.countryCode || (kind === 'country' ? key : '')).toUpperCase();
  if (countryCode && !/^[A-Z]{2}$/.test(countryCode)) throw bad(field, 'That location isn’t valid. Pick it from the search.');
  let radius = null;
  if (kind === 'city' && o.radius !== undefined && o.radius !== null && o.radius !== '') {
    radius = intIn(o.radius, 17, 80, field, 'City radius (km)');
  }
  if (restricted && kind === 'city' && radius !== null && radius < 25) throw bad(field, 'Housing, employment and credit ads need a city radius of at least 25 km.');
  return { kind, key, countryCode, name: text(o.name, 200, field, 'Location name'), radius };
}

function geoSpec(items) {
  const g = {};
  for (const i of items) {
    if (i.kind === 'country') (g.countries ||= []).push(i.key);
    else if (i.kind === 'region') (g.regions ||= []).push({ key: i.key });
    else (g.cities ||= []).push(i.radius ? { key: i.key, radius: i.radius, distance_unit: 'kilometer' } : { key: i.key });
  }
  return g;
}

export function validateAudience(raw, { restricted = false } = {}) {
  const a = obj(raw);
  const locations = arr(a.locations, 50, 'audience.locations', 'Locations').map((g) => geoItem(g, 'audience.locations', { restricted }));
  if (!locations.length) throw bad('audience.locations', 'Add at least one location.');
  const excludedLocations = arr(a.excludedLocations, 50, 'audience.excludedLocations', 'Excluded locations')
    .map((g) => geoItem(g, 'audience.excludedLocations', { restricted }));
  let ageMin = a.ageMin === undefined || a.ageMin === '' ? 18 : intIn(a.ageMin, 18, 65, 'audience.ageMin', 'Minimum age');
  let ageMax = a.ageMax === undefined || a.ageMax === '' ? 65 : intIn(a.ageMax, 18, 65, 'audience.ageMax', 'Maximum age');
  if (ageMin > ageMax) throw bad('audience.ageMax', 'The maximum age is below the minimum age.');
  let genders = a.genders === undefined || a.genders === '' ? 'all' : oneOf(a.genders, ['all', 'male', 'female'], 'audience.genders', 'Gender');
  const detailed = arr(a.detailed, 50, 'audience.detailed', 'Detailed targeting').map((d) => {
    const o = obj(d);
    const kind = String(o.kind || '');
    if (!DETAILED_KINDS.has(kind) || !isId(o.id)) throw bad('audience.detailed', 'That targeting option isn’t valid. Pick it from the search.');
    return { id: String(o.id), kind, name: text(o.name, 200, 'audience.detailed', 'Targeting name') };
  });
  if (restricted) {
    // Meta's special ad category rules: all ages 18–65+, all genders, no detailed demographics.
    if (ageMin !== 18 || ageMax !== 65) throw bad('audience.ageMin', 'Housing, employment and credit ads must target all ages (18–65+).');
    if (genders !== 'all') throw bad('audience.genders', 'Housing, employment and credit ads must target all genders.');
    if (detailed.some((d) => d.kind !== 'interests' && d.kind !== 'behaviors')) throw bad('audience.detailed', 'Housing, employment and credit ads can’t use demographic targeting.');
    ageMin = 18;
    ageMax = 65;
    genders = 'all';
  }
  const locales = arr(a.locales, 20, 'audience.locales', 'Languages').map((l) => {
    const o = obj(l);
    if (!Number.isInteger(Number(o.key)) || Number(o.key) < 0) throw bad('audience.locales', 'That language isn’t valid. Pick it from the search.');
    return { key: Number(o.key), name: text(o.name, 100, 'audience.locales', 'Language name') };
  });
  const advantageAudience = a.advantageAudience === undefined ? true : !!a.advantageAudience;
  // Ads Manager S4: custom and lookalike audiences to include / exclude
  // ({ id, name }). Their ids are checked against the ad account by
  // assertAudiences (metaAdsAudiences.js) before Meta sees them.
  const refs = (list, field, label) => {
    const seen = new Set();
    return arr(list, 50, field, label).map((x) => {
      const o = obj(x);
      if (!isId(o.id)) throw bad(field, 'That audience isn’t valid. Pick it from the list.');
      return { id: String(o.id), name: text(o.name, 400, field, 'Audience name') };
    }).filter((x) => (seen.has(x.id) ? false : seen.add(x.id)));
  };
  const customAudiences = refs(a.customAudiences, 'audience.customAudiences', 'Custom audiences');
  const excludedCustomAudiences = refs(a.excludedCustomAudiences, 'audience.excludedCustomAudiences', 'Excluded audiences');
  if (customAudiences.some((c) => excludedCustomAudiences.some((x) => x.id === c.id))) {
    throw bad('audience.excludedCustomAudiences', 'An audience can’t be both included and excluded.');
  }
  return { locations, excludedLocations, ageMin, ageMax, genders, detailed, locales, advantageAudience, customAudiences, excludedCustomAudiences };
}

export function validatePlacements(raw, objKey) {
  const p = obj(raw);
  const mode = p.mode === undefined ? 'automatic' : oneOf(p.mode, ['automatic', 'manual'], 'placements.mode', 'Placements');
  if (mode === 'automatic') return { mode };
  const platforms = [...new Set(arr(p.platforms, 4, 'placements.platforms', 'Platforms').map(String))];
  for (const pl of platforms) if (!POSITIONS[pl]) throw bad('placements.platforms', 'Unknown platform.');
  if (!platforms.length) throw bad('placements.platforms', 'Pick at least one platform, or use Advantage+ placements.');
  if (objKey === 'leads' && platforms.includes('audience_network')) throw bad('placements.platforms', 'Lead form ads can’t run on the Audience Network.');
  const positions = {};
  const rawPos = obj(p.positions);
  for (const pl of platforms) {
    const list = [...new Set(arr(rawPos[pl], 12, 'placements.positions', 'Positions').map(String))];
    for (const pos of list) if (!POSITIONS[pl].includes(pos)) throw bad('placements.positions', `Unknown ${pl} position.`);
    if (!list.length) throw bad('placements.positions', `Pick at least one position for ${pl.replace('_', ' ')}.`);
    positions[pl] = list;
  }
  const devices = [...new Set(arr(p.devices, 2, 'placements.devices', 'Devices').map(String))];
  for (const d of devices) if (!['mobile', 'desktop'].includes(d)) throw bad('placements.devices', 'Unknown device.');
  const os = p.os === undefined || p.os === '' ? 'all' : oneOf(p.os, ['all', 'ios', 'android'], 'placements.os', 'Operating system');
  if (os !== 'all' && devices.includes('desktop')) throw bad('placements.os', 'Pick mobile only to target an operating system.');
  return { mode, platforms, positions, devices: devices.length ? devices : ['mobile', 'desktop'], os };
}

/** Meta's targeting spec, from validated audience + placements. */
export function buildTargeting(aud, pl) {
  const t = { geo_locations: { ...geoSpec(aud.locations), location_types: ['home', 'recent'] } };
  if (aud.excludedLocations.length) t.excluded_geo_locations = geoSpec(aud.excludedLocations);
  if (aud.advantageAudience) {
    // Advantage+ audience: age_min 18–25 only, age_max fixed at 65; the chosen
    // range, gender and interests become suggestions (age_range).
    t.age_min = Math.min(aud.ageMin, 25);
    t.age_max = 65;
    if (aud.ageMin !== 18 || aud.ageMax !== 65) t.age_range = [aud.ageMin, aud.ageMax];
  } else {
    t.age_min = aud.ageMin;
    t.age_max = aud.ageMax;
  }
  if (aud.genders === 'male') t.genders = [1];
  if (aud.genders === 'female') t.genders = [2];
  if (aud.detailed.length) {
    const spec = {};
    for (const d of aud.detailed) (spec[d.kind] ||= []).push({ id: d.id, name: d.name });
    t.flexible_spec = [spec];
  }
  if (aud.locales.length) t.locales = aud.locales.map((l) => l.key);
  // S4: custom / lookalike audiences (ids only; Meta knows the names).
  if (aud.customAudiences?.length) t.custom_audiences = aud.customAudiences.map((c) => ({ id: c.id }));
  if (aud.excludedCustomAudiences?.length) t.excluded_custom_audiences = aud.excludedCustomAudiences.map((c) => ({ id: c.id }));
  t.targeting_automation = { advantage_audience: aud.advantageAudience ? 1 : 0 };
  if (pl.mode === 'manual') {
    t.publisher_platforms = pl.platforms;
    for (const p of pl.platforms) t[POSITION_KEY[p]] = pl.positions[p];
    t.device_platforms = pl.devices;
    if (pl.os === 'ios') t.user_os = ['iOS'];
    if (pl.os === 'android') t.user_os = ['Android'];
  }
  return t;
}

function validateBudget(raw, sched, ctx) {
  const b = obj(raw);
  const level = b.level === undefined ? 'campaign' : oneOf(b.level, ['campaign', 'adset'], 'budget.level', 'Budget level');
  const type = b.type === undefined ? 'daily' : oneOf(b.type, ['daily', 'lifetime'], 'budget.type', 'Budget type');
  const amount = Number(b.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw bad('budget.amount', 'Enter a budget above 0.');
  if (amount > 1e9) throw bad('budget.amount', 'That budget is too large.');
  const places = noMinor(ctx.currency) ? 0 : 2;
  if (Math.round(amount * 10 ** places) / 10 ** places !== amount) throw bad('budget.amount', places ? 'Use at most 2 decimals.' : `${ctx.currency} budgets are whole numbers.`);
  const minor = toMinor(amount, ctx.currency);
  const minDaily = ctx.minDailyMinor;
  if (type === 'daily' && minor < minDaily) {
    throw bad('budget.amount', `Meta’s minimum daily budget for this account is ${fromMinor(minDaily, ctx.currency)} ${ctx.currency}.`);
  }
  if (type === 'lifetime') {
    if (!sched.end) throw bad('schedule.end', 'A lifetime budget needs an end date.');
    const days = Math.max(1, Math.ceil((sched.end - (sched.start || ctx.now)) / DAY_MS));
    if (minor < minDaily * days) {
      throw bad('budget.amount', `For ${days} day${days === 1 ? '' : 's'} the lifetime budget must be at least ${fromMinor(minDaily * days, ctx.currency)} ${ctx.currency} (Meta’s daily minimum × days).`);
    }
  }
  const bidStrategy = b.bidStrategy === undefined || b.bidStrategy === '' ? 'LOWEST_COST_WITHOUT_CAP' : oneOf(b.bidStrategy, BID_STRATEGIES, 'budget.bidStrategy', 'Bid strategy');
  let bidAmount = null;
  let bidMinor = null;
  if (bidStrategy !== 'LOWEST_COST_WITHOUT_CAP') {
    bidAmount = Number(b.bidAmount);
    if (!Number.isFinite(bidAmount) || bidAmount <= 0) throw bad('budget.bidAmount', bidStrategy === 'COST_CAP' ? 'Enter your cost per result goal.' : 'Enter your bid cap.');
    bidMinor = toMinor(bidAmount, ctx.currency);
    if (bidMinor < 1) throw bad('budget.bidAmount', 'That amount is too small.');
    if (type === 'daily' && bidMinor > minor) throw bad('budget.bidAmount', 'The bid can’t be higher than the daily budget.');
  }
  return { level, type, amount, minor, bidStrategy, bidAmount, bidMinor };
}

function validateSchedule(raw, ctx) {
  const s = obj(raw);
  const startLocal = s.start ? String(s.start) : '';
  const endLocal = s.end ? String(s.end) : '';
  let start = null;
  let end = null;
  if (startLocal) {
    start = zonedToUtc(startLocal, ctx.timezone);
    if (Number.isNaN(start)) throw bad('schedule.start', 'Pick a valid start date and time.');
    if (start < ctx.now - 5 * 60 * 1000) throw bad('schedule.start', 'The start time is in the past. Leave it empty to start as soon as it’s published.');
    if (start > ctx.now + 730 * DAY_MS) throw bad('schedule.start', 'The start date is more than 2 years away.');
  }
  if (endLocal) {
    end = zonedToUtc(endLocal, ctx.timezone);
    if (Number.isNaN(end)) throw bad('schedule.end', 'Pick a valid end date and time.');
    if (end - (start || ctx.now) < DAY_MS) throw bad('schedule.end', 'The end must be at least 24 hours after the start.');
    if (end - (start || ctx.now) > 1100 * DAY_MS) throw bad('schedule.end', 'The schedule can be at most 3 years.');
  }
  return { startLocal, endLocal, start, end };
}

function validateIdentity(raw, objKey) {
  const i = obj(raw);
  const pageId = idOf(i.pageId, 'identity.pageId', 'Facebook Page', { required: true });
  const instagramId = idOf(i.instagramId, 'identity.instagramId', 'Instagram account');
  return { pageId, instagramId, objKey };
}

const IMAGE_HASH = /^[A-Za-z0-9_-]{8,64}$/;

export function validateCreative(raw, objKey, { forPreview = false } = {}) {
  const c = obj(raw);
  const meta = OBJECTIVES[objKey];
  const format = c.format === undefined ? 'image' : oneOf(c.format, ['image', 'video', 'carousel', 'post'], 'creative.format', 'Format');
  const out = { format };
  if (format === 'post') {
    // An existing post: its own text and media are the ad; the CRM adds the button (and the WhatsApp chat).
    const p = obj(c.post);
    const source = oneOf(p.source, ['facebook', 'instagram'], 'creative.post', 'Post');
    const id = String(p.id || '').trim();
    if (source === 'facebook' ? !FB_POST_ID.test(id) : !isId(id)) throw bad('creative.post', 'Pick the post to use.');
    out.post = { source, id };
  } else if (format === 'image') {
    if (!IMAGE_HASH.test(String(c.imageHash || ''))) throw bad('creative.imageHash', 'Upload or pick an image.');
    out.imageHash = String(c.imageHash);
  } else if (format === 'video') {
    out.videoId = idOf(c.videoId, 'creative.videoId', 'Video', { required: true });
  } else {
    const cards = arr(c.cards, 10, 'creative.cards', 'Carousel cards');
    if (cards.length < 2) throw bad('creative.cards', 'A carousel needs 2 to 10 cards.');
    out.cards = cards.map((card, i) => {
      const o = obj(card);
      if (!IMAGE_HASH.test(String(o.imageHash || ''))) throw bad('creative.cards', `Card ${i + 1} needs an image.`);
      return {
        imageHash: String(o.imageHash),
        headline: text(o.headline, 255, 'creative.cards', `Card ${i + 1} headline`),
        description: text(o.description, 255, 'creative.cards', `Card ${i + 1} description`),
        link: meta.url === 'required' ? httpsUrl(o.link, 'creative.cards', `Card ${i + 1} website URL`) : '',
      };
    });
  }
  out.primaryText = format === 'post' ? '' : text(c.primaryText, 2200, 'creative.primaryText', 'Primary text', { required: !forPreview });
  out.headline = text(c.headline, 255, 'creative.headline', 'Headline');
  out.description = text(c.description, 255, 'creative.description', 'Description');
  out.link = meta.url === 'none' ? '' : httpsUrl(c.link, 'creative.link', 'Website URL', { required: meta.url === 'required' });
  out.displayLink = meta.url === 'none' ? '' : text(c.displayLink, 100, 'creative.displayLink', 'Display link');
  if (out.displayLink && !/^[\w.-]+(\.[a-z]{2,})(\/[\w./-]*)?$/i.test(out.displayLink)) throw bad('creative.displayLink', 'The display link should look like example.com.');
  out.cta = c.cta === undefined || c.cta === '' ? meta.ctas[0] : oneOf(c.cta, meta.ctas, 'creative.cta', 'Call to action');
  if (objKey === 'whatsapp') {
    const w = obj(c.whatsapp);
    out.whatsapp = {
      greeting: text(w.greeting, 500, 'creative.whatsapp.greeting', 'Greeting'),
      prefill: text(w.prefill, 300, 'creative.whatsapp.prefill', 'Pre-filled message'),
      iceBreakers: arr(w.iceBreakers, 3, 'creative.whatsapp.iceBreakers', 'Questions')
        .map((q, i) => text(q, 80, 'creative.whatsapp.iceBreakers', `Question ${i + 1}`))
        .filter(Boolean),
    };
  }
  if (objKey === 'leads') out.leadFormId = idOf(c.leadFormId, 'creative.leadFormId', 'Lead form', { required: true });
  return out;
}

/** The whole wizard spec, validated against the ad account (ctx: currency, timezone, minDailyMinor, now). */
export function normalizeSpec(raw, ctx) {
  const r = obj(raw);
  const objKey = oneOf(r.objective, Object.keys(OBJECTIVES), 'objective', 'Goal');
  const meta = OBJECTIVES[objKey];
  const name = text(r.name, 400, 'name', 'Campaign name', { required: true });
  const specialAdCategories = specialOf(r.specialAdCategories);
  const restricted = specialAdCategories.some((c) => RESTRICTED.has(c));
  const goal = goalOf(objKey, r.optimizationGoal);
  let pixelId = '';
  let conversionEvent = '';
  let customConversionId = '';
  if (objKey === 'sales') {
    pixelId = idOf(r.pixelId, 'pixelId', 'Pixel', { required: true });
    conversionEvent = r.conversionEvent ? oneOf(r.conversionEvent, CONVERSION_EVENTS, 'conversionEvent', 'Conversion event') : 'PURCHASE';
    // S5: optionally optimise for a custom conversion of that pixel (checked in assertAssets).
    customConversionId = r.customConversionId ? idOf(r.customConversionId, 'customConversionId', 'Custom conversion') : '';
  }
  const schedule = validateSchedule(r.schedule, ctx);
  const budgetSpec = validateBudget(r.budget, schedule, ctx);
  const audience = validateAudience(r.audience, { restricted });
  const placements = validatePlacements(r.placements, objKey);
  const identity = validateIdentity(r.identity, objKey);
  const creative = validateCreative(r.creative, objKey);
  const countries = [...new Set(audience.locations.map((l) => l.countryCode).filter(Boolean))];
  if (specialAdCategories.length && !countries.length) throw bad('audience.locations', 'Special ad categories need at least one country in the locations.');
  return {
    objKey, meta, name,
    adsetName: text(r.adsetName, 400, 'adsetName', 'Ad set name') || `${name} – ad set`.slice(0, 400),
    adName: text(r.adName, 400, 'adName', 'Ad name') || `${name} – ad`.slice(0, 400),
    specialAdCategories, specialCountries: countries, goal, pixelId, conversionEvent, customConversionId,
    schedule, budget: budgetSpec, audience, placements, identity, creative,
  };
}

// --------------------------------------------------------------- assets --

/** Image hashes that exist in the ad account. */
async function knownHashes(row, hashes) {
  const want = [...new Set(hashes)];
  if (!want.length) return new Map();
  const list = await gList(row, `${row.adAccountId}/adimages`, { hashes: JSON.stringify(want), fields: 'hash,url,name' }, { maxPages: 1 });
  return new Map(list.map((i) => [String(i.hash), i]));
}

async function accountVideos(row, refresh = false) {
  return memo(row, 'videos', () => gList(row, `${row.adAccountId}/advideos`, { fields: 'id,title,picture,length,created_time', limit: 100 }, { maxPages: 3 }), { refresh });
}

async function assertVideo(row, videoId) {
  const mine = uploadedVideos.get(videoKey(row))?.has(String(videoId));
  if (!mine) {
    let list = await accountVideos(row);
    if (!list.some((v) => String(v.id) === String(videoId))) list = await accountVideos(row, true);
    if (!list.some((v) => String(v.id) === String(videoId))) {
      throw new AdsError('That video isn’t in your connected ad account.', { status: 404, code: 'NOT_IN_ACCOUNT' });
    }
  }
}

function thumbOf(v) {
  const list = v?.thumbnails?.data || [];
  const t = list.find((x) => x.is_preferred) || list[0];
  const url = t?.uri || v?.picture || '';
  return /^https:\/\//.test(url) ? url : '';
}

/**
 * Every id in the spec must belong to this ad account / its Pages. Returns
 * what the payload needs (video thumbnail, WhatsApp number).
 */
async function assertAssets(row, spec, { refresh = true, forPreview = false } = {}) {
  const { identity, creative, objKey } = spec;
  // S4: custom / lookalike audiences in the targeting must be this account's.
  const aud = spec.audience;
  if (aud && (aud.customAudiences?.length || aud.excludedCustomAudiences?.length)) {
    await assertAudiences(row, {
      include: aud.customAudiences.map((x) => x.id), exclude: aud.excludedCustomAudiences.map((x) => x.id),
    }, { restricted: (spec.specialAdCategories || []).some((c) => RESTRICTED.has(c)) });
  }
  const pages = await promotePages(row, refresh);
  if (!pages.some((p) => p.id === identity.pageId)) {
    throw new AdsError('That Facebook Page isn’t one this ad account can promote.', { status: 404, code: 'NOT_IN_ACCOUNT' });
  }
  if (identity.instagramId) {
    const ig = await instagramFor(row, identity.pageId, refresh);
    if (!ig.some((a) => a.id === identity.instagramId)) {
      throw new AdsError('That Instagram account isn’t linked to the Page or the ad account.', { status: 404, code: 'NOT_IN_ACCOUNT' });
    }
  }
  const out = { videoThumb: '', whatsappDigits: '' };
  if (objKey === 'leads') {
    if (identity.pageId !== row.pageId) {
      throw new AdsError(row.pageId
        ? `Lead forms are read from the Page connected for lead forms (${row.pageName || row.pageId}). Run this ad from that Page, or reconnect and pick this Page for lead forms.`
        : 'No Facebook Page is connected for lead forms. Reconnect and pick the Page that runs your lead ads.', { status: 409, code: row.pageId ? 'LEADS_PAGE_MISMATCH' : 'NO_PAGE' });
    }
    if (creative.leadFormId) {
      const { forms } = await listLeadForms(row.businessId, { refresh: refresh ? '1' : '' });
      if (!forms.some((f) => f.id === creative.leadFormId)) throw new AdsError('That lead form isn’t on your connected Page.', { status: 404, code: 'NOT_IN_PAGE' });
    }
  }
  if (objKey === 'sales' && spec.pixelId) {
    const pixels = await pixelsOf(row, refresh);
    const pixel = pixels.find((p) => p.id === spec.pixelId);
    if (!pixel) throw new AdsError('That pixel isn’t in your connected ad account.', { status: 404, code: 'NOT_IN_ACCOUNT' });
    // S5: an unavailable pixel can't record conversions; a custom conversion must be this account's, live, and on that pixel.
    if (pixel.unavailable) throw bad('pixelId', 'Meta marks this pixel as unavailable. Pick another pixel, or check it in Events Manager.');
    if (spec.customConversionId) {
      const cc = (await conversionsOf(row, refresh)).find((c) => c.id === spec.customConversionId);
      if (!cc) throw new AdsError('That custom conversion isn’t in your connected ad account.', { status: 404, code: 'NOT_IN_ACCOUNT' });
      if (cc.archived || cc.unavailable) throw bad('customConversionId', 'That custom conversion is archived or blocked at Meta. Pick another one, or a standard event.');
      if (cc.pixelId && cc.pixelId !== spec.pixelId) throw bad('customConversionId', 'That custom conversion uses another pixel. Pick its pixel, or another conversion.');
      out.customConversion = cc;
    }
  }
  if (creative.format === 'post') {
    if (creative.post.source === 'instagram' && !identity.instagramId) {
      throw bad('identity.instagramId', 'An Instagram post runs from its Instagram account: pick that account in the Identity step.');
    }
    out.post = await assertPost(row, identity, creative.post);
  }
  const hashes = creative.format === 'carousel' ? creative.cards.map((c) => c.imageHash) : creative.format === 'image' ? [creative.imageHash] : [];
  if (hashes.length) {
    const known = await knownHashes(row, hashes);
    if (hashes.some((h) => !known.has(h))) throw new AdsError('An image isn’t in your connected ad account. Upload it again.', { status: 404, code: 'NOT_IN_ACCOUNT' });
  }
  if (creative.format === 'video') {
    await assertVideo(row, creative.videoId);
    const v = await gGet(row, creative.videoId, { fields: 'id,status,picture,thumbnails{uri,is_preferred}' });
    const status = v?.status?.video_status || '';
    if (status && status !== 'ready') {
      throw new AdsError(status === 'error' ? 'Meta couldn’t process this video. Upload another one.' : 'Meta is still processing the video. Try again in a minute.', {
        status: 409, code: status === 'error' ? 'VIDEO_FAILED' : 'VIDEO_NOT_READY',
      });
    }
    out.videoThumb = thumbOf(v);
    if (!out.videoThumb && !forPreview) throw new AdsError('Meta hasn’t made a thumbnail for this video yet. Try again in a minute.', { status: 409, code: 'VIDEO_NOT_READY' });
  }
  if (objKey === 'whatsapp') {
    const wa = await whatsappOf(row, identity.pageId, refresh);
    if (wa.checked && !wa.linked) {
      throw new AdsError('This Page has no WhatsApp number linked. Link it in the Page’s settings (Linked accounts → WhatsApp) or in Meta Business Suite, then try again.', {
        status: 409, code: 'WHATSAPP_NOT_LINKED',
      });
    }
    out.whatsappDigits = wa.digits || '';
  }
  return out;
}

// -------------------------------------------------------------- payloads --

function welcomeMessage(w) {
  if (!w || (!w.greeting && !w.prefill && !w.iceBreakers.length)) return null;
  const message = { text: w.greeting || 'Hi! Thanks for getting in touch. How can we help?' };
  if (w.iceBreakers.length) {
    return {
      type: 'VISUAL_EDITOR', version: 2, landing_screen_type: 'welcome_message', media_type: 'text',
      text_format: { customer_action_type: 'ice_breakers', message: { ...message, ice_breakers: w.iceBreakers.map((title) => ({ title })) } },
    };
  }
  if (w.prefill) message.autofill_message = { content: w.prefill };
  return {
    type: 'VISUAL_EDITOR', version: 2, landing_screen_type: 'welcome_message', media_type: 'text',
    text_format: { customer_action_type: 'autofill_message', message },
  };
}

function ctaFor(objKey, cta, link, leadFormId, forVideo) {
  if (cta === 'NO_BUTTON') return null;
  if (objKey === 'whatsapp') return { type: 'WHATSAPP_MESSAGE', value: forVideo ? { app_destination: 'WHATSAPP', link: CTWA_LINK } : { app_destination: 'WHATSAPP' } };
  if (objKey === 'leads') return { type: cta, value: forVideo ? { lead_gen_form_id: leadFormId, link: LEAD_LINK } : { lead_gen_form_id: leadFormId } };
  return { type: cta, value: { link } };
}

/** object_story_spec for the creative (also used for previews). */
export function buildStorySpec(spec, assets) {
  const { objKey, identity, creative: c } = spec;
  const link = objKey === 'whatsapp' ? CTWA_LINK : objKey === 'leads' ? LEAD_LINK : c.link || `https://www.facebook.com/${identity.pageId}`;
  const welcome = objKey === 'whatsapp' ? welcomeMessage(c.whatsapp) : null;
  const oss = { page_id: identity.pageId };
  if (identity.instagramId) oss.instagram_user_id = identity.instagramId; // v22+: instagram_actor_id is gone
  if (c.format === 'video') {
    const v = { video_id: c.videoId, message: c.primaryText };
    if (assets.videoThumb) v.image_url = assets.videoThumb;
    if (c.headline) v.title = c.headline;
    if (c.description) v.link_description = c.description;
    const cta = ctaFor(objKey, c.cta, link, c.leadFormId, true);
    if (cta) v.call_to_action = cta;
    if (welcome) v.page_welcome_message = JSON.stringify(welcome);
    oss.video_data = v;
    return oss;
  }
  const l = { link, message: c.primaryText };
  if (c.displayLink) l.caption = c.displayLink;
  const cta = ctaFor(objKey, c.cta, link, c.leadFormId, false);
  if (c.format === 'image') {
    l.image_hash = c.imageHash;
    if (c.headline) l.name = c.headline;
    if (c.description) l.description = c.description;
  } else {
    l.child_attachments = c.cards.map((card) => {
      const cardLink = card.link || link;
      const a = { link: cardLink, image_hash: card.imageHash };
      if (card.headline) a.name = card.headline;
      if (card.description) a.description = card.description;
      const cc = ctaFor(objKey, c.cta, cardLink, c.leadFormId, false);
      if (cc) a.call_to_action = cc;
      return a;
    });
    l.multi_share_optimized = true;
    l.multi_share_end_card = false;
  }
  if (cta) l.call_to_action = cta;
  if (welcome) l.page_welcome_message = JSON.stringify(welcome);
  oss.link_data = l;
  return oss;
}

/**
 * The creative's content fields: a new post (object_story_spec), or an
 * existing one, a Page post (object_story_id) or an Instagram post
 * (source_instagram_media_id with the Page as object_id), plus the button
 * and, for WhatsApp, the chat's welcome message.
 */
export function creativeContentOf(spec, assets) {
  const { objKey, identity, creative: c } = spec;
  if (c.format !== 'post') return { object_story_spec: buildStorySpec(spec, assets) };
  const link = objKey === 'whatsapp' ? CTWA_LINK : objKey === 'leads' ? LEAD_LINK : c.link || `https://www.facebook.com/${identity.pageId}`;
  const body = c.post.source === 'facebook'
    ? { object_story_id: c.post.id, ...(identity.instagramId ? { instagram_user_id: identity.instagramId } : {}) }
    : { object_id: identity.pageId, instagram_user_id: identity.instagramId, source_instagram_media_id: c.post.id };
  // With the link in the value, as Meta's examples for existing posts.
  const cta = ctaFor(objKey, c.cta, link, c.leadFormId, true);
  if (cta) body.call_to_action = cta;
  const welcome = objKey === 'whatsapp' ? welcomeMessage(c.whatsapp) : null;
  if (welcome) body.page_welcome_message = JSON.stringify(welcome);
  return body;
}

const unix = (ms) => Math.floor(ms / 1000);

export function buildPayloads(spec, assets) {
  const { meta, budget: b, schedule: s, objKey } = spec;
  const budgetKey = b.type === 'daily' ? 'daily_budget' : 'lifetime_budget';
  const campaign = {
    name: spec.name,
    objective: meta.objective,
    status: 'PAUSED',
    buying_type: 'AUCTION',
    special_ad_categories: spec.specialAdCategories,
  };
  if (spec.specialAdCategories.length) campaign.special_ad_category_country = spec.specialCountries;
  if (b.level === 'campaign') {
    campaign[budgetKey] = b.minor;
    campaign.bid_strategy = b.bidStrategy;
  } else {
    // Required from v24.0 when the budget is on the ad set.
    campaign.is_adset_budget_sharing_enabled = false;
  }
  const adset = {
    name: spec.adsetName,
    status: 'PAUSED',
    billing_event: 'IMPRESSIONS',
    optimization_goal: spec.goal,
    targeting: buildTargeting(spec.audience, spec.placements),
  };
  if (meta.destination) adset.destination_type = meta.destination;
  if (objKey === 'sales') {
    const cc = assets?.customConversion;
    adset.promoted_object = cc
      ? { pixel_id: spec.pixelId, custom_event_type: cc.eventType || 'OTHER', custom_conversion_id: cc.id }
      : { pixel_id: spec.pixelId, custom_event_type: spec.conversionEvent };
  }
  else if (objKey === 'whatsapp') {
    adset.promoted_object = { page_id: spec.identity.pageId };
    if (assets.whatsappDigits) adset.promoted_object.whatsapp_phone_number = assets.whatsappDigits;
  } else if (objKey !== 'traffic') adset.promoted_object = { page_id: spec.identity.pageId };
  if (s.start) adset.start_time = unix(s.start);
  if (s.end) adset.end_time = unix(s.end);
  if (b.level === 'adset') {
    adset[budgetKey] = b.minor;
    adset.bid_strategy = b.bidStrategy;
  }
  if (b.bidMinor) adset.bid_amount = b.bidMinor;
  const creative = { name: `${spec.name} creative`.slice(0, 100), ...creativeContentOf(spec, assets) };
  const ad = { name: spec.adName, status: 'PAUSED' };
  return { campaign, adset, creative, ad };
}

// ---------------------------------------------------------- estimate --

function promotedForEstimate(objKey, pageOk, pixelOk, raw) {
  if (objKey === 'sales' && pixelOk) return { pixel_id: String(raw.pixelId), custom_event_type: CONVERSION_EVENTS.includes(raw.conversionEvent) ? raw.conversionEvent : 'PURCHASE' };
  if (objKey !== 'sales' && objKey !== 'traffic' && pageOk) return { page_id: String(obj(raw.identity).pageId) };
  return null;
}

/** POST body { objective, optimizationGoal, specialAdCategories, audience, placements, identity?, pixelId?, budget? } → size estimate. */
export async function estimateAudience(businessId, raw = {}) {
  const row = await requireAdsRow(businessId);
  const r = obj(raw);
  const objKey = oneOf(r.objective, Object.keys(OBJECTIVES), 'objective', 'Goal');
  const goal = goalOf(objKey, r.optimizationGoal);
  const restricted = specialOf(r.specialAdCategories).some((c) => RESTRICTED.has(c));
  const audience = validateAudience(r.audience, { restricted });
  const placements = validatePlacements(r.placements, objKey);
  if (audience.customAudiences.length || audience.excludedCustomAudiences.length) {
    await assertAudiences(row, { include: audience.customAudiences.map((x) => x.id), exclude: audience.excludedCustomAudiences.map((x) => x.id) }, { restricted });
  }
  const targeting = buildTargeting(audience, placements);
  const pageId = obj(r.identity).pageId;
  const pageOk = isId(pageId) && (await promotePages(row)).some((p) => p.id === String(pageId));
  const pixelOk = objKey === 'sales' && isId(r.pixelId) && (await pixelsOf(row)).some((p) => p.id === String(r.pixelId));
  const params = { targeting_spec: JSON.stringify(targeting), optimization_goal: goal };
  const promoted = promotedForEstimate(objKey, pageOk, pixelOk, r);
  if (promoted) params.promoted_object = JSON.stringify(promoted);
  const key = crypto.createHash('sha1').update(JSON.stringify(params)).digest('hex');
  const data = await memo(row, `est|${key}`, () => gGet(row, `${row.adAccountId}/delivery_estimate`, params), { ttl: 2 * 60 * 1000 });
  const d = data?.data?.[0] || {};
  // Daily reach for the daily budget, from Meta's spend → reach curve (spend in minor units).
  let dailyReach = null;
  const b = obj(r.budget);
  const curve = Array.isArray(d.daily_outcomes_curve) ? d.daily_outcomes_curve : [];
  if (curve.length && b.type !== 'lifetime' && Number(b.amount) > 0) {
    const cur = row.adAccountCurrency || 'USD';
    const target = toMinor(Number(b.amount), cur);
    const point = curve.filter((p) => num(p.spend) <= target).sort((a, z) => num(z.spend) - num(a.spend))[0];
    if (point && num(point.reach) > 0) dailyReach = Math.round(num(point.reach));
  }
  return {
    ready: d.estimate_ready !== false,
    lower: num(d.estimate_mau_lower_bound) || null,
    upper: num(d.estimate_mau_upper_bound) || null,
    dau: num(d.estimate_dau) || null,
    dailyReach,
  };
}

// ------------------------------------------------------------- preview --

const decodeEntities = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

/** Only the iframe src of Meta's preview HTML, and only an https facebook.com preview URL. */
export function previewSrc(body) {
  const m = /<iframe\b[^>]*?\ssrc\s*=\s*("([^"]*)"|'([^']*)')/i.exec(String(body || ''));
  if (!m) return '';
  let u;
  try {
    u = new URL(decodeEntities(m[2] ?? m[3] ?? ''));
  } catch {
    return '';
  }
  if (u.protocol !== 'https:' || !/^(www\.|business\.|m\.)?facebook\.com$/.test(u.hostname)) return '';
  if (!u.pathname.startsWith('/ads/api/preview_iframe.php')) return '';
  return u.toString();
}

/** POST { spec, format } → { format, src } for the wizard's sandboxed iframe. */
export async function previewCreative(businessId, { spec: raw, format } = {}) {
  const row = await requireAdsRow(businessId);
  const fmt = oneOf(format, Object.keys(PREVIEW_FORMATS), 'format', 'Preview format');
  const r = obj(raw);
  const objKey = oneOf(r.objective, Object.keys(OBJECTIVES), 'objective', 'Goal');
  const identity = validateIdentity(r.identity, objKey);
  const creative = validateCreative(r.creative, objKey, { forPreview: true });
  const spec = { objKey, identity, creative, pixelId: '' };
  const assets = await assertAssets(row, spec, { refresh: false, forPreview: true });
  const content = creativeContentOf(spec, assets);
  const data = await memo(row, `pv|${fmt}|${crypto.createHash('sha1').update(JSON.stringify(content)).digest('hex')}`,
    () => gGet(row, `${row.adAccountId}/generatepreviews`, { creative: JSON.stringify(content), ad_format: PREVIEW_FORMATS[fmt] }),
    { ttl: 10 * 60 * 1000 });
  const src = previewSrc(data?.data?.[0]?.body);
  if (!src) throw new AdsError('Meta didn’t return a preview for this placement.', { status: 502, code: 'NO_PREVIEW' });
  return { format: fmt, src };
}

// -------------------------------------------------------------- media --

/** An image file (multer memory) → act_/adimages → { hash, url }. */
export async function uploadImage(businessId, file) {
  if (!file?.buffer?.length) throw bad('file', 'Choose an image to upload.');
  // The browser's declared type isn't trusted: the bytes must be JPEG, PNG or GIF.
  if (!imageKindOf(file.buffer)) throw new AdsError('That file isn’t a JPG, PNG or GIF image.', { status: 400, code: 'BAD_FILE' });
  const row = await requireWriter(businessId);
  const name = String(file.originalname || 'image').replace(/[^\w.-]+/g, '-').slice(0, 80) || 'image';
  const form = new FormData();
  form.append('bytes', file.buffer.toString('base64'));
  form.append('name', name);
  const data = await gPostForm(row, `${row.adAccountId}/adimages`, form, 120000);
  const img = Object.values(data?.images || {})[0];
  if (!img?.hash) throw new AdsError('Meta didn’t return the uploaded image.', { status: 502, code: 'META_ERROR' });
  clearAll(businessId);
  logger.info('ad image uploaded', { businessId: String(businessId), adAccountId: row.adAccountId, bytes: file.size || file.buffer.length });
  return { hash: String(img.hash), url: img.url || '', name: img.name || name, width: num(img.width) || null, height: num(img.height) || null };
}

const videoName = (file) => String(file.originalname || 'video').replace(/[^\w.-]+/g, '-').slice(0, 80) || 'video';

// Meta's video upload codes worth another try: 1 / 2 (unexpected / temporary,
// "There was a problem with uploading your video. Please try again."), 6000
// (upload problem), and no answer at all.
const VIDEO_RETRY_CODES = new Set([1, 2, 6000]);
const VIDEO_TRIES = 3;
// 2 / 1363047 ("Service temporarily unavailable") at upload_phase=start, for
// every request format and for file_url too (live checks, Oct 2026): Meta's
// video service refuses this app on this ad account, while image uploads
// work. Retrying doesn't help; Ads Manager uploads do, and the CRM can use
// those from the ad account's library.
const VIDEO_REFUSED_SUBCODE = 1363047;
export const VIDEO_REFUSED_TEXT = 'Meta isn’t accepting video uploads from this CRM for this ad account right now (Meta: “There was a problem with uploading your video”). '
  + 'Image uploads still work. Upload the video in Meta Ads Manager (Media library), then pick it here with “From your ad account”. '
  + 'If this keeps happening, the platform owner should check that the Meta app is in Live mode.';
const videoRefused = (e) => Number(e?.meta?.code) === 2 && Number(e?.meta?.subcode) === VIDEO_REFUSED_SUBCODE;
const videoRetryable = (e) => !videoRefused(e) && (e?.code === 'META_UNREACHABLE' || VIDEO_RETRY_CODES.has(Number(e?.meta?.code)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Retry waits (ms) between attempts; ADS_VIDEO_RETRY_MS overrides the base (the harness). */
const videoRetryMs = (attempt) => (Number(process.env.ADS_VIDEO_RETRY_MS) >= 0 && process.env.ADS_VIDEO_RETRY_MS !== undefined ? Number(process.env.ADS_VIDEO_RETRY_MS) : 2000) * 2 ** attempt;

/**
 * The file on disk → act_/advideos on graph-video.facebook.com with Meta's
 * resumable (chunked) upload: upload_phase=start (file_size) → transfer the
 * byte ranges Meta asks for (start_offset / end_offset, video_file_chunk)
 * until start_offset reaches the size → finish. Each phase is retried on
 * Meta's temporary errors. → Meta's video id.
 * onProgress(0..100): how much of the file Meta has received.
 */
async function sendVideo(row, file, onProgress = null) {
  const name = videoName(file);
  const blob = await fs.openAsBlob(file.path, { type: file.mimetype || 'video/mp4' });
  const size = blob.size;
  if (!size) throw bad('file', 'The video file is empty.');
  const phase = async (fields, chunk = null, timeout = 2 * 60 * 1000) => {
    for (let attempt = 0; ; attempt += 1) {
      const form = new FormData();
      for (const [k, v] of Object.entries(fields)) form.append(k, String(v));
      if (chunk) form.append('video_file_chunk', chunk, name);
      try {
        // eslint-disable-next-line no-await-in-loop
        return await gPostForm(row, `${row.adAccountId}/advideos`, form, timeout, AGV);
      } catch (e) {
        if (videoRefused(e)) throw new AdsError(VIDEO_REFUSED_TEXT, { status: 502, code: 'VIDEO_UPLOAD_REFUSED', meta: e.meta || null });
        if (attempt + 1 >= VIDEO_TRIES || !videoRetryable(e)) throw e;
        logger.warn('ad video upload: retrying a phase', { adAccountId: row.adAccountId, phase: fields.upload_phase, attempt: attempt + 1, metaCode: e?.meta?.code ?? null });
        // eslint-disable-next-line no-await-in-loop
        await sleep(videoRetryMs(attempt));
      }
    }
  };
  const offsets = (a) => [Number(a?.start_offset), Number(a?.end_offset)];
  const start = await phase({ upload_phase: 'start', file_size: size });
  const session = String(start?.upload_session_id || '');
  const videoId = String(start?.video_id || '');
  if (!isId(session) || !isId(videoId)) throw new AdsError('Meta didn’t start the video upload. Try again.', { status: 502, code: 'META_ERROR' });
  let [from, to] = offsets(start);
  onProgress?.(0);
  for (let n = 0; from < size; n += 1) {
    if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to <= from || to > size || n > 100000) {
      throw new AdsError('Meta answered the video upload with an unexpected byte range. Try again.', { status: 502, code: 'META_ERROR' });
    }
    // eslint-disable-next-line no-await-in-loop
    const answer = await phase({ upload_phase: 'transfer', upload_session_id: session, start_offset: from }, blob.slice(from, to), 5 * 60 * 1000);
    const [nextFrom, nextTo] = offsets(answer);
    if (!(nextFrom > from)) throw new AdsError('Meta didn’t accept part of the video. Try again.', { status: 502, code: 'META_ERROR' });
    [from, to] = [nextFrom, nextTo];
    onProgress?.(Math.min(99, Math.floor((from * 100) / size)));
  }
  const done = await phase({ upload_phase: 'finish', upload_session_id: session, title: name.slice(0, 250), name });
  if (done && done.success === false) throw new AdsError('Meta didn’t finish the video upload. Try again.', { status: 502, code: 'META_ERROR' });
  onProgress?.(100);
  rememberVideo(row, videoId);
  clearAll(row.businessId);
  logger.info('ad video uploaded', { businessId: String(row.businessId), adAccountId: row.adAccountId, bytes: size, videoId });
  return videoId;
}

/** A video temp file → act_/advideos → { id }, in the request (the route uses the background job below). */
export async function uploadVideo(businessId, file) {
  if (!file?.path) throw bad('file', 'Choose a video to upload.');
  if (!(await isVideoFile(file.path))) throw new AdsError('That file isn’t an MP4 or MOV video.', { status: 400, code: 'BAD_FILE' });
  const row = await requireWriter(businessId);
  return { id: await sendVideo(row, file) };
}

// ------------------------------------------------- video upload jobs --
// POST /meta/create/videos only lands the file on disk. Before multer writes
// a byte, beginVideoUpload checks the connection, ads_management and the
// Graph version and takes a slot: one upload per business (409
// UPLOAD_RUNNING) and at most ADS_VIDEO_UPLOADS_MAX (3) on the server (429
// UPLOADS_BUSY). startVideoUpload then answers at once with a CRM upload id
// and sends the file to Meta in the background; the browser polls
// videoUploadStatus until Meta's video id is there (or the upload failed),
// so no request waits on Meta longer than nginx's 120 s proxy timeout.
// Temp files are deleted when the job ends, when a request is refused or
// aborted, and stale crm-advideo-* files (> 1 h) are swept when an upload
// starts. Jobs live in this process (one backend process).
const VIDEO_TMP_STALE_MS = 60 * 60 * 1000;
const VIDEO_JOB_KEEP_MS = 60 * 60 * 1000;
const videoUploadsMax = () => {
  const n = Math.floor(Number(process.env.ADS_VIDEO_UPLOADS_MAX));
  return Number.isFinite(n) && n >= 1 ? n : 3;
};
const videoSlots = new Map(); // businessId -> ticket (receiving the file or sending it to Meta)
const videoJobs = new Map(); // uploadId -> job
const activeVideoPaths = new Set();

/** Delete crm-advideo-* temp files older than an hour that no upload is using. */
export async function sweepVideoTemp({ now = Date.now(), dir = os.tmpdir() } = {}) {
  let names = [];
  try {
    names = await fs.promises.readdir(dir);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const n of names) {
    if (!n.startsWith(AD_VIDEO_TMP_PREFIX)) continue;
    const p = path.join(dir, n);
    if (activeVideoPaths.has(p)) continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      const st = await fs.promises.stat(p);
      if (now - st.mtimeMs > VIDEO_TMP_STALE_MS) {
        // eslint-disable-next-line no-await-in-loop
        await fs.promises.unlink(p);
        removed += 1;
      }
    } catch {
      // gone already, or in use on Windows
    }
  }
  if (removed) logger.info('stale ad video temp files removed', { removed });
  return removed;
}

/** Before the file is read: version, connection, ads_management, then a slot. Returns a ticket to release. */
export async function beginVideoUpload(businessId) {
  const row = await requireWriter(businessId);
  const k = String(businessId);
  if (videoSlots.has(k)) {
    throw new AdsError('A video is still uploading for this business. Wait for it to finish, then upload the next one.', { status: 409, code: 'UPLOAD_RUNNING' });
  }
  if (videoSlots.size >= videoUploadsMax()) {
    throw new AdsError('The server is sending other videos to Meta right now. Try again in a minute or two.', { status: 429, code: 'UPLOADS_BUSY' });
  }
  const ticket = {
    businessId: k,
    row,
    handedOff: false,
    released: false,
    release() {
      if (this.released) return;
      this.released = true;
      if (videoSlots.get(k) === this) videoSlots.delete(k);
    },
  };
  videoSlots.set(k, ticket);
  return ticket;
}

// sentPercent: how much of the file the server has sent to Meta (0–100; 100
// while Meta still answers). Not set for a failed upload.
const presentVideoJob = (j) => ({
  id: j.id, status: j.status, videoId: j.videoId || '', error: j.error, bytes: j.bytes, name: j.name, startedAt: j.startedAt, finishedAt: j.finishedAt,
  sentPercent: j.status === 'done' ? 100 : j.sentPercent || 0,
});

/** The file is on disk: check its bytes, then send it to Meta in the background. → { upload } */
export async function startVideoUpload(ticket, file) {
  if (!file?.path) throw bad('file', 'Choose a video to upload.');
  if (!(await isVideoFile(file.path))) throw new AdsError('That file isn’t an MP4 or MOV video.', { status: 400, code: 'BAD_FILE' });
  const now = Date.now();
  for (const [id, j] of videoJobs) if (j.finishedAt && now - new Date(j.finishedAt).getTime() > VIDEO_JOB_KEEP_MS) videoJobs.delete(id);
  const { row } = ticket;
  const job = {
    id: crypto.randomBytes(12).toString('hex'), businessId: ticket.businessId, adAccountId: row.adAccountId, status: 'uploading', videoId: '', error: null,
    bytes: Number(file.size) || 0, name: videoName(file), startedAt: new Date(), finishedAt: null, promise: null, sentPercent: 0,
  };
  videoJobs.set(job.id, job);
  activeVideoPaths.add(file.path);
  ticket.handedOff = true;
  job.promise = sendVideo(row, file, (p) => {
    job.sentPercent = p;
  })
    .then((videoId) => {
      job.status = 'done';
      job.videoId = videoId;
    })
    .catch((e) => {
      const err = e instanceof AdsError ? e : new AdsError('The upload to Meta stopped. Try again.', { status: 502, code: 'ADS_FAILED' });
      job.status = 'failed';
      job.error = { code: err.code, message: err.message };
      logger.warn('ad video upload failed', {
        businessId: job.businessId, adAccountId: job.adAccountId, code: err.code, metaCode: err.meta?.code ?? null, metaSubcode: err.meta?.subcode ?? null, message: err.message, bytes: job.bytes,
      });
    })
    .finally(async () => {
      job.finishedAt = new Date();
      activeVideoPaths.delete(file.path);
      await fs.promises.unlink(file.path).catch(() => {});
      ticket.release();
    });
  return presentVideoJob(job);
}

/** GET /meta/create/videos/uploads/:id → { upload: { status: uploading|done|failed, videoId, error } } */
export async function videoUploadStatus(businessId, uploadId) {
  if (!/^[a-f0-9]{24}$/.test(String(uploadId || ''))) throw new AdsError('Unknown upload.', { status: 400, code: 'BAD_ID' });
  const row = await requireAdsRow(businessId);
  const j = videoJobs.get(String(uploadId));
  if (!j || j.businessId !== String(businessId) || j.adAccountId !== row.adAccountId) {
    throw new AdsError('That upload doesn’t exist any more. Upload the video again.', { status: 404, code: 'UPLOAD_NOT_FOUND' });
  }
  return presentVideoJob(j);
}

/** Wait for this process's video uploads (the harness). */
export async function waitForVideoUploads() {
  await Promise.all([...videoJobs.values()].map((j) => j.promise?.catch(() => {})));
}

export async function videoStatus(businessId, videoId) {
  const row = await requireAdsRow(businessId);
  if (!isId(videoId)) throw new AdsError('Unknown video.', { status: 400, code: 'BAD_ID' });
  await assertVideo(row, videoId);
  const v = await gGet(row, String(videoId), { fields: 'id,status,picture,thumbnails{uri,is_preferred},length,title' });
  const status = v?.status?.video_status || 'processing';
  return {
    id: String(videoId),
    status,
    ready: status === 'ready',
    progress: num(v?.status?.processing_progress) || null,
    thumbnailUrl: thumbOf(v),
    length: num(v?.length) || null,
  };
}

/** ?type=image|video → recent images / videos in the ad account. */
export async function mediaLibrary(businessId, q = {}) {
  const row = await requireAdsRow(businessId);
  const type = oneOf(q.type, ['image', 'video'], 'type', 'Media type');
  const refresh = q.refresh === '1';
  if (type === 'image') {
    const list = await memo(row, 'imagelib', () => gList(row, `${row.adAccountId}/adimages`, { fields: 'hash,url,url_128,name,width,height,created_time', limit: 40 }, { maxPages: 1 }), { refresh });
    return {
      type,
      items: list.filter((i) => i.hash && /^https:\/\//.test(i.url || '')).map((i) => ({
        hash: String(i.hash), url: i.url, thumbUrl: /^https:\/\//.test(i.url_128 || '') ? i.url_128 : i.url, name: i.name || '', width: num(i.width) || null, height: num(i.height) || null,
      })),
    };
  }
  const list = await accountVideos(row, refresh);
  return {
    type,
    items: list.filter((v) => isId(v.id)).slice(0, 40).map((v) => ({
      id: String(v.id), title: v.title || '', thumbUrl: /^https:\/\//.test(v.picture || '') ? v.picture : '', length: num(v.length) || null,
    })),
  };
}

// ---------------------------------------------------------- lead form --

/** A simple instant form on the connected lead-forms Page (Page token). */
export async function createLeadForm(businessId, raw = {}) {
  const row = await requireWriter(businessId);
  if (!row.pageId || !row.pageAccessToken) {
    throw new AdsError('No Facebook Page is connected for lead forms. Reconnect and pick the Page that runs your lead ads.', { status: 409, code: 'NO_PAGE' });
  }
  const r = obj(raw);
  const name = text(r.name, 200, 'name', 'Form name', { required: true });
  const intro = text(r.intro, 500, 'intro', 'Intro');
  const introTitle = text(r.introTitle, 60, 'introTitle', 'Intro headline');
  const privacyUrl = httpsUrl(r.privacyUrl, 'privacyUrl', 'Privacy policy URL', { required: true });
  const privacyText = text(r.privacyText, 70, 'privacyText', 'Privacy link text') || 'Privacy policy';
  const qs = arr(r.questions, 10, 'questions', 'Questions');
  const seen = new Set();
  const questions = [];
  qs.forEach((q, i) => {
    const o = obj(q);
    const type = oneOf(o.type, [...LEAD_QUESTIONS, 'CUSTOM'], 'questions', 'Question type');
    if (type !== 'CUSTOM') {
      if (seen.has(type)) return;
      seen.add(type);
      questions.push({ type, key: `q${i + 1}` });
    } else {
      questions.push({ type, key: `q${i + 1}`, label: text(o.label, 80, 'questions', `Question ${i + 1}`, { required: true }) });
    }
  });
  if (!questions.length) throw bad('questions', 'Add at least one question.');
  if (questions.filter((q) => q.type === 'CUSTOM').length > 5) throw bad('questions', 'At most 5 custom questions.');
  const t = obj(r.thankYou);
  const thankTitle = text(t.title, 60, 'thankYou.title', 'Thank-you headline') || 'Thanks, you’re all set.';
  const thankBody = text(t.body, 300, 'thankYou.body', 'Thank-you text') || 'We’ll be in touch soon.';
  const websiteUrl = httpsUrl(t.websiteUrl, 'thankYou.websiteUrl', 'Website URL');
  const thankYou = websiteUrl
    ? { title: thankTitle, body: thankBody, button_type: 'VIEW_WEBSITE', button_text: text(t.buttonText, 30, 'thankYou.buttonText', 'Button text') || 'Visit website', website_url: websiteUrl }
    : { title: thankTitle, body: thankBody, button_type: 'NONE' };
  const body = {
    name,
    questions,
    privacy_policy: { url: privacyUrl, link_text: privacyText },
    thank_you_page: thankYou,
  };
  if (intro) body.context_card = { title: introTitle || name.slice(0, 60), style: 'PARAGRAPH_STYLE', content: [intro] };
  const data = await gPost(row, `${row.pageId}/leadgen_forms`, body, 'page');
  if (!isId(data?.id)) throw new AdsError('Meta didn’t return the new form.', { status: 502, code: 'META_ERROR' });
  clearAll(businessId);
  logger.info('lead form created from the CRM', { businessId: String(businessId), pageId: row.pageId, formId: data.id });
  return { id: String(data.id), name };
}

// -------------------------------------------------------------- create --

const objectsOf = async (row, ids) => {
  const data = await gGet(row, '', { ids: ids.join(','), fields: 'id,name,status,effective_status' });
  return Object.fromEntries(ids.map((id) => [id, data?.[id] || {}]));
};
const present = (o, id) => ({ id: String(id), name: o?.name || '', status: o?.status || 'PAUSED', effectiveStatus: o?.effective_status || o?.status || 'PAUSED' });

async function rollback(row, created) {
  const out = [];
  for (const c of [...created].reverse()) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await gDelete(row, c.id);
      out.push({ ...c, deleted: true });
    } catch (e) {
      logger.warn('ads create rollback: could not delete', { level: c.level, id: c.id, code: e.code || '', error: e.message });
      out.push({ ...c, deleted: false });
    }
  }
  return out.reverse();
}

/**
 * POST { spec, draftId?, requestId? }: campaign → ad set → creative → ad, all
 * PAUSED; rolled back when a step fails. One create at a time per business
 * (409 IN_PROGRESS); the same requestId again returns the first result.
 */
export async function createCampaign(business, { spec: raw, draftId, requestId } = {}) {
  const rid = requestIdOf(requestId);
  return once(business._id, 'create', rid, 'The CRM is still creating your last campaign. Wait for it to finish; it shows up paused in the Campaigns tab.', () => createNow(business, { spec: raw, draftId }));
}

async function createNow(business, { spec: raw, draftId }) {
  const businessId = business._id;
  const row = await requireWriter(businessId);
  const acct = await accountInfo(row, true);
  const spec = normalizeSpec(raw, { currency: acct.currency, timezone: acct.timezone, minDailyMinor: acct.minDailyBudgetMinor, now: Date.now() });
  const assets = await assertAssets(row, spec);
  const p = buildPayloads(spec, assets);
  const act = row.adAccountId;
  const created = [];
  let step = 'campaign';
  try {
    const campaign = await gPost(row, `${act}/campaigns`, p.campaign);
    created.push({ level: 'campaign', id: String(campaign.id) });
    step = 'adset';
    const adset = await gPost(row, `${act}/adsets`, { ...p.adset, campaign_id: String(campaign.id) });
    created.push({ level: 'adset', id: String(adset.id) });
    step = 'creative';
    const creative = await gPost(row, `${act}/adcreatives`, p.creative);
    created.push({ level: 'creative', id: String(creative.id) });
    step = 'ad';
    const ad = await gPost(row, `${act}/ads`, { ...p.ad, adset_id: String(adset.id), creative: { creative_id: String(creative.id) } });
    created.push({ level: 'ad', id: String(ad.id) });
  } catch (err) {
    const cause = err instanceof AdsError ? err : new AdsError(err.message || 'Unknown error', { status: 502, code: 'META_ERROR' });
    // A revoked token can't delete anything; don't try.
    const rolled = cause.code === 'ADS_REVOKED' ? created.map((c) => ({ ...c, deleted: false })) : await rollback(row, created);
    clearAll(businessId);
    logger.warn('ads create failed, rolled back', {
      business: business.name, step, code: cause.code, metaCode: cause.meta?.code ?? null, created: created.length, deleted: rolled.filter((x) => x.deleted).length,
    });
    throw new CreateError(cause, step, rolled);
  }
  clearAll(businessId);
  const [c, s, , a] = created;
  let states = {};
  try {
    states = await objectsOf(row, [c.id, s.id, a.id]);
  } catch (e) {
    logger.warn('ads create: status read-back failed', { error: e.message });
  }
  if (draftId && /^[a-f0-9]{24}$/.test(String(draftId))) {
    await AdDraft.deleteOne({ _id: String(draftId), businessId: String(businessId) }).catch(() => {});
  }
  const money = `${spec.budget.amount} ${acct.currency} ${spec.budget.type === 'daily' ? 'a day' : 'lifetime'}`;
  notify(businessId, {
    type: 'ad_campaign_created',
    title: `Campaign created (paused): ${spec.name}`,
    body: `${spec.meta.label} · ${money}. It doesn’t spend until you publish it on the Ads page.`,
    target: { view: 'ads', id: `campaign:${c.id}` },
  }).catch(() => {});
  logger.info('ad campaign created from the CRM (paused)', { business: business.name, adAccountId: act, objective: spec.meta.objective, campaignId: c.id });
  return {
    campaign: { ...present(states[c.id], c.id), name: states[c.id]?.name || spec.name },
    adset: { ...present(states[s.id], s.id), name: states[s.id]?.name || spec.adsetName },
    ad: { ...present(states[a.id], a.id), name: states[a.id]?.name || spec.adName },
    creativeId: created[2].id,
    summary: {
      objective: spec.objKey,
      currency: acct.currency,
      budget: { level: spec.budget.level, type: spec.budget.type, amount: spec.budget.amount },
      start: spec.schedule.start ? new Date(spec.schedule.start).toISOString() : null,
      end: spec.schedule.end ? new Date(spec.schedule.end).toISOString() : null,
      timezone: acct.timezone,
    },
  };
}

// ------------------------------------------------------------- publish --

async function childrenOf(row, campaignId) {
  const [adsets, ads] = await Promise.all([
    gList(row, `${campaignId}/adsets`, { fields: 'id,name,status,effective_status,account_id', limit: 50 }, { maxPages: 1 }),
    gList(row, `${campaignId}/ads`, { fields: 'id,name,status,effective_status,account_id,ad_review_feedback,issues_info', limit: 100 }, { maxPages: 1 }),
  ]);
  const act = String(row.adAccountId).replace(/^act_/, '');
  const foreign = [...adsets, ...ads].some((o) => o.account_id && String(o.account_id).replace(/^act_/, '') !== act);
  if (foreign) throw new AdsError('That isn’t part of your connected ad account.', { status: 404, code: 'NOT_IN_ACCOUNT' });
  return { adsets, ads };
}

const reviewOf = (a) => {
  const fb = a?.ad_review_feedback || {};
  const reasons = Object.values(fb.global || {}).map(String).slice(0, 5);
  return reasons;
};

/** The campaign, its ad sets and ads with Meta's review state. */
export async function reviewStatus(businessId, campaignId) {
  const row = await requireAdsRow(businessId);
  await assertInAccount(row, campaignId, true);
  const camp = await gGet(row, String(campaignId), { fields: 'id,name,status,effective_status,daily_budget,lifetime_budget,objective' });
  const { adsets, ads } = await childrenOf(row, campaignId);
  return {
    campaign: present(camp, campaignId),
    adsets: adsets.map((s) => present(s, s.id)),
    ads: ads.map((a) => ({ ...present(a, a.id), reviewFeedback: reviewOf(a) })),
  };
}

const notInCampaign = () => new AdsError('That ad set or ad isn’t part of this campaign, so the CRM won’t turn it on.', { status: 404, code: 'NOT_IN_CAMPAIGN' });

/** One child of the campaign, read fresh; Meta's "doesn't exist / wrong kind" (#100) → NOT_IN_CAMPAIGN. */
async function childOf(row, id, fields) {
  try {
    return await gGet(row, id, { fields });
  } catch (e) {
    if (e instanceof AdsError && e.code === 'META_ERROR' && Number(e.meta?.code) === 100) throw notInCampaign();
    throw e;
  }
}

/**
 * POST { confirm: true, adsetId, adId, requestId? }: exactly the ad and ad
 * set the wizard created → ACTIVE, then the campaign. Both must be children
 * of this campaign in the connected ad account (404 NOT_IN_CAMPAIGN);
 * nothing else in the campaign is touched.
 */
export async function publishCampaign(business, campaignId, { confirm, adsetId, adId, requestId } = {}) {
  if (confirm !== true) {
    throw new AdsError('Publishing starts spending. Confirm it in the CRM first.', { status: 400, code: 'CONFIRM_REQUIRED' });
  }
  const rid = requestIdOf(requestId);
  const setId = idOf(adsetId, 'adsetId', 'The ad set to publish', { required: true });
  const oneAd = idOf(adId, 'adId', 'The ad to publish', { required: true });
  return once(business._id, 'publish', rid, 'The CRM is still publishing this campaign. Wait a moment.', async () => {
    const row = await requireWriter(business._id);
    await assertInAccount(row, campaignId, true);
    const act = actNumber(row.adAccountId);
    const set = await childOf(row, setId, 'id,name,account_id,campaign_id,status,effective_status');
    const ad = await childOf(row, oneAd, 'id,name,account_id,campaign_id,adset_id,status,effective_status');
    const mine = (o) => o && actNumber(o.account_id) === act && String(o.campaign_id) === String(campaignId);
    if (!mine(set) || !mine(ad) || String(ad.adset_id) !== setId) throw notInCampaign();
    // The ad first, then its ad set, the campaign last: nothing delivers until the campaign is on.
    if (ad.status !== 'ACTIVE') await gPost(row, oneAd, { status: 'ACTIVE' });
    if (set.status !== 'ACTIVE') await gPost(row, setId, { status: 'ACTIVE' });
    await gPost(row, String(campaignId), { status: 'ACTIVE' });
    clearAll(business._id);
    logger.info('ad campaign published from the CRM', { business: business.name, campaignId: String(campaignId), adsetId: setId, adId: oneAd });
    return reviewStatus(business._id, campaignId);
  });
}

// -------------------------------------------------------------- drafts --

const DRAFT_MAX_BYTES = 200 * 1024;
const DRAFT_LIMIT = 50;
const DRAFT_KEYS = [
  'objective', 'name', 'adsetName', 'adName', 'specialAdCategories', 'optimizationGoal', 'pixelId', 'conversionEvent', 'customConversionId', 'budget', 'schedule',
  'audience', 'placements', 'identity', 'creative',
];
const isDraftId = (id) => /^[a-f0-9]{24}$/.test(String(id || ''));

function draftSpec(raw) {
  const r = obj(raw);
  const out = {};
  for (const k of DRAFT_KEYS) if (r[k] !== undefined) out[k] = r[k];
  let json;
  try {
    json = JSON.stringify(out);
  } catch {
    throw bad('spec', 'The draft couldn’t be saved.');
  }
  if (Buffer.byteLength(json) > DRAFT_MAX_BYTES) throw bad('spec', 'The draft is too large to save.');
  return JSON.parse(json);
}
const presentDraft = (d, withSpec = false) => ({
  id: String(d._id), name: d.name || '', objective: d.objective || '', step: num(d.step), updatedAt: d.updatedAt || null,
  ...(withSpec ? { spec: d.spec || {} } : {}),
});

export async function listDrafts(businessId) {
  const row = await requireAdsRow(businessId);
  const rows = await AdDraft.find({ businessId: String(businessId), adAccountId: row.adAccountId }).sort({ updatedAt: -1 }).limit(DRAFT_LIMIT).lean();
  return { drafts: rows.map((d) => presentDraft(d)) };
}

export async function getDraft(businessId, id) {
  if (!isDraftId(id)) throw new AdsError('Unknown draft.', { status: 400, code: 'BAD_ID' });
  const d = await AdDraft.findOne({ _id: String(id), businessId: String(businessId) }).lean();
  if (!d) throw new AdsError('That draft doesn’t exist any more.', { status: 404, code: 'DRAFT_NOT_FOUND' });
  return { draft: presentDraft(d, true) };
}

export async function saveDraft(businessId, { id, step, spec } = {}) {
  const row = await requireAdsRow(businessId);
  const clean = draftSpec(spec);
  const fields = {
    adAccountId: row.adAccountId,
    name: typeof clean.name === 'string' ? clean.name.slice(0, 400) : '',
    objective: OBJECTIVES[clean.objective] ? clean.objective : '',
    step: Number.isInteger(Number(step)) ? Math.min(10, Math.max(0, Number(step))) : 0,
    spec: clean,
  };
  if (id) {
    if (!isDraftId(id)) throw new AdsError('Unknown draft.', { status: 400, code: 'BAD_ID' });
    const d = await AdDraft.findOneAndUpdate({ _id: String(id), businessId: String(businessId) }, { $set: fields }, { new: true }).lean();
    if (!d) throw new AdsError('That draft doesn’t exist any more.', { status: 404, code: 'DRAFT_NOT_FOUND' });
    return { draft: presentDraft(d) };
  }
  const count = Number(await AdDraft.countDocuments({ businessId: String(businessId) })) || 0;
  if (count >= DRAFT_LIMIT) throw new AdsError(`You have ${DRAFT_LIMIT} drafts. Delete some before saving another.`, { status: 409, code: 'DRAFT_LIMIT' });
  const d = await AdDraft.create({ businessId: String(businessId), ...fields });
  return { draft: presentDraft(d.toObject ? d.toObject() : d) };
}

export async function deleteDraft(businessId, id) {
  if (!isDraftId(id)) throw new AdsError('Unknown draft.', { status: 400, code: 'BAD_ID' });
  const r = await AdDraft.deleteOne({ _id: String(id), businessId: String(businessId) });
  if (!r.deletedCount) throw new AdsError('That draft doesn’t exist any more.', { status: 404, code: 'DRAFT_NOT_FOUND' });
  return { deleted: true };
}

// Shared with the S2 "Manage" service (metaAdsManage.js): exported as they
// are, no behaviour change.
export { assertAssets, accountInfo, promotePages, clearAll, FALLBACK_MIN, RESTRICTED };

export default {
  OBJECTIVES, createOptions, pageDetails, targetingSearch, targetingBrowse, estimateAudience, previewCreative, uploadImage, uploadVideo,
  beginVideoUpload, startVideoUpload, videoUploadStatus, sweepVideoTemp, videoStatus, mediaLibrary, createLeadForm, createCampaign, reviewStatus, publishCampaign, listDrafts, getDraft, saveDraft, deleteDraft,
  normalizeSpec, buildPayloads, buildTargeting, previewSrc, zonedToUtc, adsGraphVersion,
};
