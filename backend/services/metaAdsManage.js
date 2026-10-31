// ---------------------------------------------------------------------------
// Ads Manager S2: managing what already exists at Meta (Ads page → Campaigns).
//
//   • getDetails: one campaign / ad set / ad, normalised for the edit dialogs
//     (the ad set's targeting turned back into the S1 audience + placements
//     editors' shape, the ad's creative into the S1 creative editor's shape).
//   • editCampaign: name, campaign budget (Advantage campaign budget), bid
//     strategy, spend cap, end date (written to the campaign's ad sets: at the
//     campaign level stop_time is read-only).
//   • editAdSet: name, budget, schedule, targeting (S1's validateAudience /
//     validatePlacements / buildTargeting, merged into Meta's current
//     targeting so fields the CRM doesn't edit are kept), optimisation, bid.
//   • editAd: name, and a new creative (creatives are immutable): a new
//     act_/adcreatives, then the ad points at it; the new creative is deleted
//     again when Meta refuses the ad update.
//   • duplicateObject: POST /{id}/copies, deep_copy for campaigns and ad sets,
//     always status_option PAUSED. A copy that comes back ACTIVE anyway is
//     paused at once.
//   • removeObject: archive (status ARCHIVED) or delete (DELETE /{id}), only
//     with { confirm: true }.
//   • bulkAction: pause / resume / duplicate / archive up to 50 ids; resume and
//     archive need { confirm: true }.
//   • reviewRows / archivedRows: effective_status, issues_info and
//     ad_review_feedback for the table rows, the account's ads that need
//     attention, and the archived rows (Meta leaves them out of the default
//     lists). A rejected ad notifies once (ad_rejected, groupKey per ad and
//     rejection reasons).
//   • adPreview: /{ad}/previews → only the iframe src (S1's previewSrc check).
//
// Every write: requireAdsRow, then a fresh permission check (409 READ_ONLY
// without ads_management), then every id is read back fresh and must belong
// to the connected ad account and be of the level asked for (404
// NOT_IN_ACCOUNT). Nothing here ever sends status ACTIVE except an explicit,
// confirmed "resume". Payloads are built from validated fields only. Errors
// 190 and rate limits go through withAdsToken / mapMetaError; clearCache
// (and S1's caches) after every write.
// ---------------------------------------------------------------------------
import crypto from 'crypto';
import Notification from '../models/Notification.js';
import {
  AdsError, requireAdsRow, requireAdsWriter, withAdsToken, refreshPermissions, clearCache, auth, proof, http, G, budget, graphList, graphGet,
  metricsOf, mapMetaError, NO_MINOR_UNIT, isId, actNumber,
} from './metaAds.js';
import {
  OBJECTIVES, BID_STRATEGIES, POSITIONS, PREVIEW_FORMATS, validateAudience, validatePlacements, buildTargeting, validateCreative,
  buildStorySpec, creativeContentOf, previewSrc, toMinor, zonedToUtc, assertAssets, accountInfo, clearAll, FALLBACK_MIN, RESTRICTED,
} from './metaAdsCreate.js';
import { notify } from './notifications.js';
import { assertAudiences } from './metaAdsAudiences.js';
import logger from './logger.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const BULK_MAX = 50;
// Meta copies at most 3 child ads in one synchronous /copies call (51 with
// an asynchronous batch, which the CRM doesn't use).
export const SYNC_COPY_MAX = 3;
// spend_cap value that removes the cap (Campaign reference).
export const REMOVE_SPEND_CAP = 922337203685478;
// Advantage+ shopping / app campaigns can't be updated or copied through the
// Marketing API from v25.0 (all versions from May 19, 2026).
const LOCKED_PROMOTIONS = new Set(['AUTOMATED_SHOPPING_ADS', 'SMART_APP_PROMOTION']);
const PROBLEM_STATUSES = ['DISAPPROVED', 'WITH_ISSUES', 'PENDING_BILLING_INFO'];
const ATTENTION = new Set(PROBLEM_STATUSES);
const POSITION_KEY = {
  facebook: 'facebook_positions', instagram: 'instagram_positions', messenger: 'messenger_positions', audience_network: 'audience_network_positions',
};
// Targeting keys the CRM's editors own; everything else in Meta's targeting is kept as it is.
const MANAGED_TARGETING = new Set([
  'geo_locations', 'excluded_geo_locations', 'age_min', 'age_max', 'age_range', 'genders', 'flexible_spec', 'locales', 'targeting_automation',
  'publisher_platforms', 'facebook_positions', 'instagram_positions', 'messenger_positions', 'audience_network_positions', 'device_platforms', 'user_os',
]);
const GEO_EDITED = new Set(['countries', 'regions', 'cities', 'location_types']);
const DETAILED_KINDS = new Set([
  'interests', 'behaviors', 'life_events', 'industries', 'income', 'family_statuses', 'education_statuses',
  'relationship_statuses', 'work_positions', 'work_employers', 'education_schools', 'education_majors',
]);

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const clip = (s, n) => {
  const v = String(s ?? '').replace(/\s+/g, ' ').trim();
  return v.length > n ? `${v.slice(0, n - 1)}…` : v;
};
const unix = (ms) => Math.floor(ms / 1000);
const noMinor = (cur) => NO_MINOR_UNIT.has(String(cur || '').toUpperCase());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const envMs = (k, d) => {
  const n = Number(process.env[k]);
  return Number.isFinite(n) && n >= 0 ? n : d;
};
const KEY = /^[A-Za-z0-9_-]{8,64}$/;

// --------------------------------------------------------------- errors --

class FieldError extends AdsError {
  constructor(field, message) {
    super(message, { status: 400, code: 'INVALID_INPUT' });
    this.field = field;
  }

  toJSON() {
    return { ...super.toJSON(), field: this.field };
  }
}
const bad = (field, message) => new FieldError(field, message);
const notInAccount = () => new AdsError('That isn’t part of your connected ad account.', { status: 404, code: 'NOT_IN_ACCOUNT' });
const READ_ONLY_TEXT = 'The CRM can only read this ad account. To change campaigns here, reconnect and allow managing ads (ads_management).';
const confirmRequired = (what) => new AdsError(`${what} Confirm it in the CRM first.`, { status: 400, code: 'CONFIRM_REQUIRED' });

/**
 * An edit that can raise the spend of something that is on (a higher budget,
 * bid or spend cap, no cap, no end date, a later end): 400 CONFIRM_REQUIRED
 * with the old → new values, until the edit is sent again with
 * { confirmIncrease: true }.
 */
class IncreaseConfirm extends AdsError {
  constructor(what, changes) {
    super(`This ${what} is on, so this change can raise what it spends straight away. Confirm it in the CRM first.`, { status: 400, code: 'CONFIRM_REQUIRED' });
    this.summary = {
      text: `This ${what} is on. Saving changes it at Meta straight away: ${changes.map((c) => `${c.label} ${c.from} → ${c.to}`).join('; ')}.`,
      changes,
    };
  }

  toJSON() {
    return { ...super.toJSON(), summary: this.summary };
  }
}

function moneyText(minor, cur) {
  const major = budget(minor, cur);
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur || 'USD', maximumFractionDigits: noMinor(cur) ? 0 : 2 }).format(major);
  } catch {
    return `${major} ${cur}`;
  }
}

// ---------------------------------------------------------------- graph --

const bearer = (t) => ({ Authorization: `Bearer ${t}` });
const gGet = (row, path, params = {}) => withAdsToken(row, 'ad', async (token) => (await http.get(`${G()}/${path}`, auth(token, params))).data);
/** POST a JSON body built here; appsecret_proof as a query param. */
const gPost = (row, path, body) => withAdsToken(row, 'ad', async (token) => (await http.post(`${G()}/${path}`, body, {
  params: { appsecret_proof: proof(token) },
  headers: { ...bearer(token), 'Content-Type': 'application/json' },
})).data);
const gDelete = (row, path) => withAdsToken(row, 'ad', async (token) => (await http.delete(`${G()}/${path}`, auth(token))).data);
function gList(row, path, params = {}, maxPages = 2) {
  return withAdsToken(row, 'ad', async (token) => {
    const out = [];
    let next = `${G()}/${path}`;
    let opts = auth(token, params);
    for (let i = 0; i < maxPages && next; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const { data } = await http.get(next, opts);
      out.push(...(data?.data || []));
      next = data?.paging?.next || '';
      opts = { headers: bearer(token) };
    }
    return out;
  });
}

/** After every write: the dashboard's and the wizard's caches. */
function cleared(businessId) {
  clearCache(businessId);
  clearAll(businessId);
}

// ---------------------------------------------------------------- guard --

/**
 * Graph version ≥ v24, connected, ads_management re-checked now (409 GRAPH_VERSION_TOO_OLD / READ_ONLY).
 * `brake: true` (bulk pause) skips only the version check, like the row-level pause.
 */
const requireWriter = (businessId, { brake = false } = {}) => requireAdsWriter(businessId, READ_ONLY_TEXT, { skipVersion: brake });

// A field only one level has: it proves the id is that kind of object.
const LEVELS = {
  campaign: {
    label: 'campaign', marker: 'objective',
    fields: 'id,name,account_id,status,effective_status,objective,daily_budget,lifetime_budget,bid_strategy,spend_cap,can_use_spend_cap,start_time,stop_time,smart_promotion_type,special_ad_categories,issues_info',
    brief: 'id,name,account_id,status,effective_status,objective,smart_promotion_type,daily_budget,lifetime_budget',
  },
  adset: {
    label: 'ad set', marker: 'optimization_goal',
    fields: 'id,name,account_id,campaign_id,status,effective_status,daily_budget,lifetime_budget,bid_strategy,bid_amount,optimization_goal,billing_event,destination_type,start_time,end_time,targeting,issues_info,campaign{id,name,objective,daily_budget,lifetime_budget,bid_strategy,special_ad_categories,smart_promotion_type}',
    brief: 'id,name,account_id,status,effective_status,optimization_goal,daily_budget,lifetime_budget,campaign{id,objective,smart_promotion_type}',
  },
  ad: {
    label: 'ad', marker: 'adset_id',
    fields: 'id,name,account_id,adset_id,campaign_id,status,effective_status,issues_info,ad_review_feedback,creative{id,name,object_story_spec,thumbnail_url,image_url},adset{id,name,destination_type},campaign{id,name,objective,smart_promotion_type,special_ad_categories}',
    brief: 'id,name,account_id,status,effective_status,adset_id,campaign{id,objective,smart_promotion_type}',
  },
};
function levelOf(level) {
  if (!LEVELS[level]) throw new AdsError('Unknown level.', { status: 400, code: 'BAD_LEVEL' });
  return LEVELS[level];
}

/** Read an object fresh and prove it is in the connected ad account and of this level. */
async function ownObject(row, level, id, fields) {
  const L = levelOf(level);
  if (!isId(id)) throw new AdsError('Unknown id.', { status: 400, code: 'BAD_ID' });
  let o;
  try {
    o = await gGet(row, String(id), { fields: fields || L.fields });
  } catch (e) {
    // (#100) "nonexisting field" (another kind of object) or "does not exist / no permission".
    if (e instanceof AdsError && e.code === 'META_ERROR' && Number(e.meta?.code) === 100) throw notInAccount();
    throw e;
  }
  if (!o || actNumber(o.account_id) !== actNumber(row.adAccountId) || o[L.marker] === undefined) throw notInAccount();
  return o;
}

/** Many ids of one level (one ?ids= read; per id when Meta refuses the batch). Map id → object | AdsError. */
async function ownMany(row, level, ids) {
  const L = levelOf(level);
  const out = new Map();
  let data = null;
  try {
    data = await gGet(row, '', { ids: ids.join(','), fields: L.brief });
  } catch (e) {
    if (!(e instanceof AdsError && e.code === 'META_ERROR' && Number(e.meta?.code) === 100)) throw e;
  }
  for (const id of ids) {
    if (data) {
      const o = data[id];
      out.set(id, o && actNumber(o.account_id) === actNumber(row.adAccountId) && o[L.marker] !== undefined ? o : notInAccount());
    } else {
      try {
        // eslint-disable-next-line no-await-in-loop
        out.set(id, await ownObject(row, level, id, L.brief));
      } catch (e) {
        if (e.code === 'ADS_REVOKED' || e.code === 'RATE_LIMITED') throw e;
        out.set(id, e instanceof AdsError ? e : mapMetaError(e));
      }
    }
  }
  return out;
}

function lockOf(campaign = {}) {
  return LOCKED_PROMOTIONS.has(String(campaign.smart_promotion_type || '').toUpperCase()) ? 'ADVANTAGE_PLUS' : '';
}
function assertNotLocked(campaign) {
  if (lockOf(campaign)) {
    throw new AdsError('This is an Advantage+ shopping or app campaign. Meta no longer lets other apps change or copy these (Marketing API v25). Change it in Meta Ads Manager.', {
      status: 409, code: 'ADVANTAGE_PLUS_LOCKED',
    });
  }
}
const isArchived = (o) => ['ARCHIVED', 'DELETED'].includes(String(o?.status || ''));

// ------------------------------------------------------------ validation --

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
function text(v, max, field, label, { required = false } = {}) {
  if (v !== undefined && v !== null && typeof v !== 'string') throw bad(field, `${label} must be text.`);
  const s = String(v ?? '').replace(CONTROL, '').trim();
  if (required && !s) throw bad(field, `${label} is required.`);
  if (s.length > max) throw bad(field, `${label} can be at most ${max} characters.`);
  return s;
}
function oneOf(v, list, field, label) {
  const s = String(v ?? '');
  if (!list.includes(s)) throw bad(field, `${label}: pick one of the options.`);
  return s;
}
function amountOf(v, field, label, cur) {
  const n = Number(v);
  if (v === '' || v === null || v === undefined || typeof v === 'boolean' || !Number.isFinite(n) || n <= 0) throw bad(field, `Enter ${label} above 0.`);
  if (n > 1e9) throw bad(field, `That ${label} is too large.`);
  const places = noMinor(cur) ? 0 : 2;
  if (Math.round(n * 10 ** places) / 10 ** places !== n) throw bad(field, places ? 'Use at most 2 decimals.' : `${cur} amounts are whole numbers.`);
  return n;
}
const blank = (v) => v === null || v === '';

/** Meta's '2026-11-01T10:00:00+0530' → ms (NaN when missing). */
function parseTime(s) {
  if (!s) return NaN;
  return Date.parse(String(s).replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
}
/** UTC ms → 'YYYY-MM-DDTHH:mm' wall-clock in the ad account's time zone (the S1 editors' format). */
export function utcToLocal(ms, tz) {
  if (!Number.isFinite(ms)) return '';
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone: tz || 'UTC', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
  } catch {
    return new Date(ms).toISOString().slice(0, 16);
  }
}
function localTime(v, tz, field, label) {
  const t = zonedToUtc(String(v), tz);
  if (Number.isNaN(t)) throw bad(field, `Pick a valid ${label}.`);
  return t;
}

/** The S1 wizard goal key for a campaign objective (+ the ad set's destination); '' when the CRM can't edit it. */
export function objectiveKeyOf(objective, destination = '') {
  const d = String(destination || '');
  switch (String(objective || '')) {
    case 'OUTCOME_ENGAGEMENT': return d === 'WHATSAPP' ? 'whatsapp' : '';
    case 'OUTCOME_TRAFFIC': return !d || d === 'WEBSITE' ? 'traffic' : '';
    case 'OUTCOME_LEADS': return !d || d === 'ON_AD' ? 'leads' : '';
    case 'OUTCOME_AWARENESS': return 'awareness';
    case 'OUTCOME_SALES': return !d || d === 'WEBSITE' ? 'sales' : '';
    default: return '';
  }
}
const minSpendCap = (cur) => (FALLBACK_MIN[String(cur || '').toUpperCase()] ?? 1) * 100;

// ------------------------------------------------- targeting ↔ editors --

let regionNames = null;
function countryName(code) {
  try {
    regionNames ||= new Intl.DisplayNames(['en'], { type: 'region' });
    return regionNames.of(code) || code;
  } catch {
    return code;
  }
}

function geoItems(g = {}) {
  const out = [];
  for (const c of g.countries || []) out.push({ kind: 'country', key: String(c), countryCode: String(c).toUpperCase(), name: countryName(String(c).toUpperCase()), radius: null });
  for (const r of g.regions || []) {
    out.push({ kind: 'region', key: String(r.key), countryCode: String(r.country || '').toUpperCase(), name: [r.name, r.country ? countryName(String(r.country).toUpperCase()) : ''].filter(Boolean).join(', ') || `Region ${r.key}`, radius: null });
  }
  for (const c of g.cities || []) {
    let radius = c.radius ? Number(c.radius) : null;
    if (radius && c.distance_unit === 'mile') radius = Math.round(radius * 1.609);
    if (radius) radius = Math.min(80, Math.max(17, radius));
    out.push({
      kind: 'city', key: String(c.key), countryCode: String(c.country || '').toUpperCase(), name: [c.name, c.region].filter(Boolean).join(', ') || `City ${c.key}`,
      radius, supportsRadius: true,
    });
  }
  return out;
}

/** Meta's ad set targeting → { audience, placements, notes } in the S1 editors' shape. */
export function targetingToEditors(t = {}) {
  const notes = [];
  const advantage = Number(t.targeting_automation?.advantage_audience) === 1;
  const range = Array.isArray(t.age_range) && t.age_range.length === 2 ? t.age_range.map(Number) : null;
  const ageMin = advantage && range ? range[0] : num(t.age_min) || 18;
  const ageMax = advantage && range ? range[1] : num(t.age_max) || 65;
  const genders = Array.isArray(t.genders) && t.genders.length === 1 ? (Number(t.genders[0]) === 1 ? 'male' : 'female') : 'all';
  const flex = Array.isArray(t.flexible_spec) ? t.flexible_spec : [];
  const detailed = [];
  for (const group of flex.slice(0, 1)) {
    for (const [kind, list] of Object.entries(group || {})) {
      if (!DETAILED_KINDS.has(kind) || !Array.isArray(list)) continue;
      for (const d of list) if (isId(d?.id)) detailed.push({ id: String(d.id), kind, name: String(d.name || d.id) });
    }
  }
  if (flex.length > 1) notes.push('This ad set narrows its audience with several detailed-targeting groups. They stay as they are unless you change the detailed targeting here, which combines them into one group.');
  if (flex.some((g) => Object.keys(g || {}).some((k) => !DETAILED_KINDS.has(k)))) notes.push('Some detailed targeting isn’t shown here. It stays as it is unless you change the detailed targeting.');
  const extraGeo = (g) => Object.keys(g || {}).filter((k) => !GEO_EDITED.has(k) && (Array.isArray(g[k]) ? g[k].length : g[k]));
  if (extraGeo(t.geo_locations).length || extraGeo(t.excluded_geo_locations).length) notes.push('Some locations (postcodes, places, pins or markets) aren’t shown here. They are kept.');
  // Ads Manager S4: custom / lookalike audiences are part of the editor now.
  const refsOf = (list) => (Array.isArray(list) ? list : []).filter((x) => isId(x?.id)).map((x) => ({ id: String(x.id), name: String(x.name || `Audience ${x.id}`) }));
  const customAudiences = refsOf(t.custom_audiences);
  const excludedCustomAudiences = refsOf(t.excluded_custom_audiences);
  if (customAudiences.length || excludedCustomAudiences.length) notes.push('Custom and lookalike audiences on this ad set are listed under “Custom audiences” below.');
  if (t.exclusions) notes.push('Detailed-targeting exclusions on this ad set are kept as they are.');
  const audience = {
    locations: geoItems(t.geo_locations),
    excludedLocations: geoItems(t.excluded_geo_locations),
    ageMin: Math.min(65, Math.max(18, ageMin)),
    ageMax: Math.min(65, Math.max(18, ageMax)),
    genders,
    detailed,
    locales: (Array.isArray(t.locales) ? t.locales : []).filter((k) => Number.isInteger(Number(k))).map((k) => ({ key: Number(k), name: `Language #${k}` })),
    advantageAudience: advantage,
    customAudiences,
    excludedCustomAudiences,
  };
  const pp = Array.isArray(t.publisher_platforms) ? t.publisher_platforms.filter((p) => POSITIONS[p]) : [];
  let placements;
  if (!pp.length) {
    placements = {
      mode: 'automatic', platforms: ['facebook', 'instagram'], positions: { facebook: ['feed', 'story', 'facebook_reels'], instagram: ['stream', 'story', 'reels'] },
      devices: ['mobile', 'desktop'], os: 'all',
    };
  } else {
    const positions = {};
    for (const p of pp) {
      const list = Array.isArray(t[POSITION_KEY[p]]) ? t[POSITION_KEY[p]].filter((x) => POSITIONS[p].includes(x)) : [...POSITIONS[p]];
      positions[p] = list.length ? list : [...POSITIONS[p]];
    }
    const devices = Array.isArray(t.device_platforms) ? t.device_platforms.filter((d) => d === 'mobile' || d === 'desktop') : [];
    const os = (t.user_os || []).some((o) => /^ios/i.test(o)) ? 'ios' : (t.user_os || []).some((o) => /^android/i.test(o)) ? 'android' : 'all';
    placements = { mode: 'manual', platforms: pp, positions, devices: devices.length ? devices : ['mobile', 'desktop'], os: devices.length === 1 && devices[0] === 'mobile' ? os : 'all' };
  }
  return { audience, placements, notes };
}

const detailedSig = (list) => JSON.stringify((list || []).map((d) => `${d.kind}:${d.id}`).sort());

// Ads Manager S4: replaced only when the edit sent the custom audience lists
// (keepAudiences: false); an older client's audience edit keeps Meta's.
const AUDIENCE_TARGETING = new Set(['custom_audiences', 'excluded_custom_audiences']);

/** The new targeting: the editors' part from buildTargeting, plus everything else Meta had. */
export function mergeTargeting(old = {}, built = {}, { keepFlexible = false, keepAudiences = true } = {}) {
  const out = {};
  for (const [k, v] of Object.entries(old || {})) if (!MANAGED_TARGETING.has(k) && (keepAudiences || !AUDIENCE_TARGETING.has(k))) out[k] = v;
  Object.assign(out, built);
  for (const key of ['geo_locations', 'excluded_geo_locations']) {
    const extra = Object.fromEntries(Object.entries(old?.[key] || {}).filter(([k]) => !GEO_EDITED.has(k)));
    if (Object.keys(extra).length) out[key] = { ...(out[key] || {}), ...extra };
  }
  if (keepFlexible && Array.isArray(old?.flexible_spec) && old.flexible_spec.length) out.flexible_spec = old.flexible_spec;
  return out;
}

// --------------------------------------------------------- creative → editor --

function welcomeOf(raw) {
  const empty = { greeting: '', prefill: '', iceBreakers: [] };
  if (!raw) return empty;
  let w = raw;
  if (typeof raw === 'string') {
    try {
      w = JSON.parse(raw);
    } catch {
      return empty;
    }
  }
  const m = w?.text_format?.message || {};
  return {
    greeting: String(m.text || ''),
    prefill: String(m.autofill_message?.content || ''),
    iceBreakers: Array.isArray(m.ice_breakers) ? m.ice_breakers.map((q) => String(q?.title || '')).filter(Boolean).slice(0, 3) : [],
  };
}
const https = (u) => (/^https:\/\//.test(String(u || '')) ? String(u) : '');

/** The ad's creative → the S1 creative editor's fields (empty media when Meta's creative isn't a story spec). */
export function creativeToEditor(c = {}) {
  const oss = c.object_story_spec || {};
  const l = oss.link_data;
  const v = oss.video_data;
  const spec = {
    format: 'image', imageHash: '', imageUrl: '', videoId: '', videoThumbUrl: '', cards: [], primaryText: '', headline: '', description: '', link: '',
    displayLink: '', cta: '', whatsapp: { greeting: '', prefill: '', iceBreakers: [] }, leadFormId: '',
  };
  let source = 'other';
  if (v) {
    source = 'story_spec';
    Object.assign(spec, {
      format: 'video', videoId: isId(v.video_id) ? String(v.video_id) : '', videoThumbUrl: https(v.image_url) || https(c.thumbnail_url),
      primaryText: v.message || '', headline: v.title || '', description: v.link_description || '', cta: v.call_to_action?.type || '',
      leadFormId: isId(v.call_to_action?.value?.lead_gen_form_id) ? String(v.call_to_action.value.lead_gen_form_id) : '',
      whatsapp: welcomeOf(v.page_welcome_message),
    });
    const link = v.call_to_action?.value?.link;
    if (link && !/api\.whatsapp\.com|fb\.me/.test(link)) spec.link = link;
  } else if (l) {
    source = 'story_spec';
    Object.assign(spec, {
      primaryText: l.message || '', headline: l.name || '', description: l.description || '', link: /api\.whatsapp\.com|fb\.me/.test(l.link || '') ? '' : l.link || '',
      displayLink: l.caption || '', cta: l.call_to_action?.type || '',
      leadFormId: isId(l.call_to_action?.value?.lead_gen_form_id) ? String(l.call_to_action.value.lead_gen_form_id) : '',
      whatsapp: welcomeOf(l.page_welcome_message),
    });
    if (Array.isArray(l.child_attachments) && l.child_attachments.length) {
      spec.format = 'carousel';
      spec.cards = l.child_attachments.slice(0, 10).map((a) => ({
        imageHash: a.image_hash || '', imageUrl: https(a.picture), headline: a.name || '', description: a.description || '', link: a.link || '',
      }));
    } else {
      spec.imageHash = l.image_hash || '';
      spec.imageUrl = https(c.image_url) || https(l.picture) || https(c.thumbnail_url);
    }
  }
  return { spec, source, pageId: isId(oss.page_id) ? String(oss.page_id) : '', instagramId: String(oss.instagram_user_id || oss.instagram_actor_id || '') };
}

// ------------------------------------------------------------- review --

const issuesOf = (list) => (Array.isArray(list) ? list : []).slice(0, 10).map((i) => ({
  code: String(i?.error_code ?? ''),
  summary: clip(i?.error_summary, 200),
  message: clip(i?.error_message, 500),
  level: String(i?.level || ''),
  type: String(i?.error_type || ''),
}));
/** ad_review_feedback (global and per placement) → the rejection reasons as text. */
export function feedbackOf(fb) {
  const out = [];
  const walk = (o, depth) => {
    if (!o || typeof o !== 'object' || depth > 3) return;
    for (const v of Object.values(o)) {
      if (typeof v === 'string') out.push(clip(v, 500));
      else walk(v, depth + 1);
    }
  };
  walk(fb?.global, 0);
  walk(fb?.placement_specific, 0);
  return [...new Set(out.filter(Boolean))].slice(0, 8);
}

const inflight = new Set();
/** One ad_rejected notification per ad and set of reasons (groupKey), however often the list loads. */
async function notifyRejections(row, ads) {
  let n = 0;
  for (const a of ads.slice(0, 20)) {
    const reasons = feedbackOf(a.ad_review_feedback);
    const sig = crypto.createHash('sha1').update([...reasons].sort().join('|')).digest('hex').slice(0, 12);
    const groupKey = `ad_rejected:${a.id}:${sig}`;
    const k = `${String(row.businessId)}|${groupKey}`;
    if (inflight.has(k)) continue;
    inflight.add(k);
    try {
      // eslint-disable-next-line no-await-in-loop
      const already = await Notification.findOne({ businessId: String(row.businessId), groupKey }).select('_id').lean();
      if (already) continue;
      // eslint-disable-next-line no-await-in-loop
      const done = await notify(row.businessId, {
        type: 'ad_rejected',
        title: `Ad rejected: ${a.name || a.id}`,
        body: reasons.length ? reasons.join(' ') : 'Meta rejected this ad. Open it on the Ads page to see why, then edit it.',
        target: { view: 'ads', id: `ad:${a.id}` },
        groupKey,
      });
      if (done) n += 1;
    } catch (e) {
      logger.warn('ad_rejected notification failed', { error: e.message });
    } finally {
      inflight.delete(k);
    }
  }
  return n;
}

const AD_REVIEW_FIELDS = 'id,name,account_id,campaign_id,adset_id,effective_status,issues_info,ad_review_feedback';
const problemFilter = () => JSON.stringify([{ field: 'effective_status', operator: 'IN', value: PROBLEM_STATUSES }]);
const sameAccount = (row, list) => list.filter((o) => !o.account_id || actNumber(o.account_id) === actNumber(row.adAccountId));

async function parentFor(row, level, parentId) {
  if (level === 'campaign') return '';
  await ownObject(row, level === 'adset' ? 'campaign' : 'adset', parentId, `id,account_id,${level === 'adset' ? 'objective' : 'optimization_goal'}`);
  return String(parentId);
}

/** ?level=campaign|adset|ad&parentId= → review state per row + the ads that need attention. Notifies new rejections. */
export async function reviewRows(businessId, q = {}) {
  const row = await requireAdsRow(businessId);
  const level = oneOf(q.level || 'campaign', ['campaign', 'adset', 'ad'], 'level', 'Level');
  const refresh = q.refresh === '1';
  const parent = await parentFor(row, level, String(q.parentId || ''));
  let objects;
  let problemAds;
  if (level === 'ad') {
    objects = sameAccount(row, await graphList(row, `${parent}/ads`, { fields: AD_REVIEW_FIELDS, limit: 100 }, { refresh }));
    problemAds = objects.filter((a) => ATTENTION.has(a.effective_status) || (a.issues_info || []).length);
  } else {
    const path = level === 'campaign' ? `${row.adAccountId}/campaigns` : `${parent}/adsets`;
    const adsPath = level === 'campaign' ? `${row.adAccountId}/ads` : `${parent}/ads`;
    const [o, p] = await Promise.all([
      graphList(row, path, { fields: 'id,name,account_id,effective_status,issues_info', limit: 100 }, { refresh }),
      graphList(row, adsPath, { fields: AD_REVIEW_FIELDS, filtering: problemFilter(), limit: 100 }, { refresh, maxPages: 2 }),
    ]);
    objects = sameAccount(row, o);
    problemAds = sameAccount(row, p);
  }
  const childKey = level === 'campaign' ? 'campaign_id' : 'adset_id';
  const counts = new Map();
  const rejected = new Map();
  if (level !== 'ad') {
    for (const a of problemAds) {
      const k = String(a[childKey] || '');
      counts.set(k, (counts.get(k) || 0) + 1);
      if (a.effective_status === 'DISAPPROVED') rejected.set(k, (rejected.get(k) || 0) + 1);
    }
  }
  const items = objects.map((o) => {
    const issues = issuesOf(o.issues_info);
    const reviewFeedback = level === 'ad' ? feedbackOf(o.ad_review_feedback) : [];
    const adProblems = level === 'ad' ? 0 : counts.get(String(o.id)) || 0;
    return {
      id: String(o.id),
      effectiveStatus: o.effective_status || '',
      issues,
      reviewFeedback,
      adProblems,
      rejectedAds: level === 'ad' ? (o.effective_status === 'DISAPPROVED' ? 1 : 0) : rejected.get(String(o.id)) || 0,
      needsAttention: ATTENTION.has(o.effective_status) || issues.length > 0 || adProblems > 0,
    };
  });
  const notified = await notifyRejections(row, problemAds.filter((a) => a.effective_status === 'DISAPPROVED'));
  return {
    level,
    parentId: parent,
    items,
    problemAds: problemAds.slice(0, 50).map((a) => ({
      id: String(a.id), name: a.name || '', campaignId: String(a.campaign_id || ''), adsetId: String(a.adset_id || ''),
      effectiveStatus: a.effective_status || '', issues: issuesOf(a.issues_info), reviewFeedback: feedbackOf(a.ad_review_feedback),
    })),
    notified,
  };
}

const creativeRow = (c = {}) => {
  const spec = c.object_story_spec || {};
  const l = spec.link_data || {};
  const v = spec.video_data || {};
  return {
    id: c.id ? String(c.id) : '', title: c.title || l.name || v.title || c.name || '', body: c.body || l.message || v.message || '',
    thumbnailUrl: c.thumbnail_url || c.image_url || l.picture || v.image_url || '',
  };
};

/** ?level=&parentId= → archived rows in the table's row shape (Meta's default lists leave them out). */
export async function archivedRows(businessId, q = {}) {
  const row = await requireAdsRow(businessId);
  const level = oneOf(q.level || 'campaign', ['campaign', 'adset', 'ad'], 'level', 'Level');
  const refresh = q.refresh === '1';
  const parent = await parentFor(row, level, String(q.parentId || ''));
  const filtering = JSON.stringify([{ field: 'effective_status', operator: 'IN', value: ['ARCHIVED'] }]);
  const cur = row.adAccountCurrency;
  const metrics = metricsOf({});
  if (level === 'campaign') {
    const list = sameAccount(row, await graphList(row, `${row.adAccountId}/campaigns`, {
      fields: 'id,name,account_id,status,effective_status,objective,daily_budget,lifetime_budget,start_time,stop_time', filtering, limit: 100,
    }, { refresh }));
    return {
      level,
      rows: list.map((c) => ({
        id: String(c.id), name: c.name || '', status: c.status || 'ARCHIVED', effectiveStatus: c.effective_status || 'ARCHIVED', objective: c.objective || '',
        dailyBudget: budget(c.daily_budget, cur), lifetimeBudget: budget(c.lifetime_budget, cur), startTime: c.start_time || null, stopTime: c.stop_time || null, metrics,
      })),
    };
  }
  if (level === 'adset') {
    const list = sameAccount(row, await graphList(row, `${parent}/adsets`, {
      fields: 'id,name,account_id,status,effective_status,daily_budget,lifetime_budget,optimization_goal,billing_event,destination_type', filtering, limit: 100,
    }, { refresh }));
    return {
      level,
      rows: list.map((s) => ({
        id: String(s.id), name: s.name || '', status: s.status || 'ARCHIVED', effectiveStatus: s.effective_status || 'ARCHIVED',
        dailyBudget: budget(s.daily_budget, cur), lifetimeBudget: budget(s.lifetime_budget, cur), optimizationGoal: s.optimization_goal || '',
        billingEvent: s.billing_event || '', destinationType: s.destination_type || '', metrics,
      })),
    };
  }
  const list = sameAccount(row, await graphList(row, `${parent}/ads`, {
    fields: 'id,name,account_id,status,effective_status,creative{id,name,title,body,thumbnail_url,image_url,object_story_spec}', filtering, limit: 100,
  }, { refresh }));
  return {
    level,
    rows: list.map((a) => ({
      id: String(a.id), name: a.name || '', status: a.status || 'ARCHIVED', effectiveStatus: a.effective_status || 'ARCHIVED', creative: creativeRow(a.creative), metrics,
    })),
  };
}

// ------------------------------------------------------------- details --

function baseOf(o, level, acct) {
  return {
    level,
    id: String(o.id),
    name: o.name || '',
    status: o.status || '',
    effectiveStatus: o.effective_status || o.status || '',
    archived: isArchived(o),
    issues: issuesOf(o.issues_info),
    account: { currency: acct.currency, timezone: acct.timezone, minDailyBudget: acct.minDailyBudget, minSpendCap: minSpendCap(acct.currency) },
  };
}

async function childAdSets(row, campaignId) {
  const list = await gList(row, `${campaignId}/adsets`, {
    fields: 'id,name,account_id,status,start_time,end_time,daily_budget,lifetime_budget,bid_amount', limit: 100,
  }, 1);
  if (list.some((s) => s.account_id && actNumber(s.account_id) !== actNumber(row.adAccountId))) throw notInAccount();
  return list.filter((s) => !isArchived(s));
}

function campaignDetails(c, acct, adsets) {
  const cur = acct.currency;
  const type = num(c.daily_budget) ? 'daily' : num(c.lifetime_budget) ? 'lifetime' : null;
  const ends = adsets.map((s) => parseTime(s.end_time)).filter(Number.isFinite);
  const end = ends.length ? Math.max(...ends) : parseTime(c.stop_time);
  const cap = num(c.spend_cap);
  const bid = adsets.map((s) => num(s.bid_amount)).find((b) => b > 0);
  return {
    ...baseOf(c, 'campaign', acct),
    locked: lockOf(c),
    objective: c.objective || '',
    objectiveKey: objectiveKeyOf(c.objective, c.objective === 'OUTCOME_ENGAGEMENT' ? 'WHATSAPP' : ''),
    specialAdCategories: Array.isArray(c.special_ad_categories) ? c.special_ad_categories.filter((x) => x !== 'NONE') : [],
    budget: { level: type ? 'campaign' : 'adset', type, amount: type ? budget(c[`${type}_budget`], cur) : null },
    bidStrategy: c.bid_strategy || (type ? 'LOWEST_COST_WITHOUT_CAP' : ''),
    bidAmount: bid ? budget(bid, cur) : null,
    spendCap: cap > 0 && cap < REMOVE_SPEND_CAP ? budget(cap, cur) : null,
    canUseSpendCap: c.can_use_spend_cap !== false,
    endTime: Number.isFinite(end) ? utcToLocal(end, acct.timezone) : '',
    adsets: adsets.map((s) => ({
      id: String(s.id), name: s.name || '', status: s.status || '', endTime: utcToLocal(parseTime(s.end_time), acct.timezone), lifetime: num(s.lifetime_budget) > 0,
    })),
  };
}

function adsetDetails(s, acct) {
  const cur = acct.currency;
  const camp = s.campaign || {};
  const cbo = num(camp.daily_budget) > 0 || num(camp.lifetime_budget) > 0;
  const type = num(s.daily_budget) ? 'daily' : num(s.lifetime_budget) ? 'lifetime' : null;
  const key = objectiveKeyOf(camp.objective, s.destination_type);
  const start = parseTime(s.start_time);
  const special = Array.isArray(camp.special_ad_categories) ? camp.special_ad_categories.filter((x) => x !== 'NONE') : [];
  const editors = targetingToEditors(s.targeting || {});
  return {
    ...baseOf(s, 'adset', acct),
    locked: lockOf(camp),
    campaign: {
      id: String(camp.id || s.campaign_id || ''), name: camp.name || '', objective: camp.objective || '', objectiveKey: key, cbo,
      bidStrategy: camp.bid_strategy || '', specialAdCategories: special, restricted: special.some((c) => RESTRICTED.has(c)),
    },
    budget: { own: !!type, type: type || (num(camp.lifetime_budget) ? 'lifetime' : 'daily'), amount: type ? budget(s[`${type}_budget`], cur) : null },
    bidStrategy: s.bid_strategy || (cbo ? camp.bid_strategy || '' : 'LOWEST_COST_WITHOUT_CAP'),
    bidAmount: num(s.bid_amount) ? budget(s.bid_amount, cur) : null,
    optimizationGoal: s.optimization_goal || '',
    goals: key ? OBJECTIVES[key].goals : [s.optimization_goal].filter(Boolean),
    destinationType: s.destination_type || '',
    schedule: {
      start: utcToLocal(start, acct.timezone),
      end: utcToLocal(parseTime(s.end_time), acct.timezone),
      started: Number.isFinite(start) && start <= Date.now(),
    },
    audience: editors.audience,
    placements: editors.placements,
    targetingNotes: editors.notes,
  };
}

function adDetails(a, acct) {
  const camp = a.campaign || {};
  const key = objectiveKeyOf(camp.objective, a.adset?.destination_type);
  const c = creativeToEditor(a.creative || {});
  let creativeNote = '';
  if (!key) creativeNote = 'The CRM changes creatives of WhatsApp, traffic, leads, awareness and sales ads. Change this one in Meta Ads Manager.';
  else if (c.source !== 'story_spec') creativeNote = 'This ad uses an existing post or a dynamic creative. Changing it here replaces it with a new single image, video or carousel.';
  return {
    ...baseOf(a, 'ad', acct),
    locked: lockOf(camp),
    adsetId: String(a.adset_id || ''),
    campaignId: String(a.campaign_id || camp.id || ''),
    objectiveKey: key,
    specialAdCategories: Array.isArray(camp.special_ad_categories) ? camp.special_ad_categories.filter((x) => x !== 'NONE') : [],
    identity: { pageId: c.pageId, instagramId: isId(c.instagramId) ? c.instagramId : '' },
    creative: c.spec,
    creativeId: String(a.creative?.id || ''),
    thumbnailUrl: https(a.creative?.thumbnail_url) || https(a.creative?.image_url),
    creativeEditable: !!key && !isArchived(a) && !lockOf(camp),
    creativeNote,
    reviewFeedback: feedbackOf(a.ad_review_feedback),
  };
}

/** GET one campaign / ad set / ad for its edit dialog. */
export async function getDetails(businessId, level, id) {
  let row = await requireAdsRow(businessId);
  levelOf(level);
  row = await refreshPermissions(row);
  const o = await ownObject(row, level, id);
  const acct = await accountInfo(row);
  let details;
  if (level === 'campaign') details = campaignDetails(o, acct, await childAdSets(row, o.id));
  else if (level === 'adset') details = adsetDetails(o, acct);
  else details = adDetails(o, acct);
  return { canManage: !!row.canManageAds, details };
}

// --------------------------------------------------------------- edits --

const NOTHING = () => new AdsError('Nothing to change.', { status: 400, code: 'NOTHING_TO_CHANGE' });
const archivedOnlyName = (what) => new AdsError(`This ${what} is archived. Meta only lets you rename it (or delete it).`, { status: 409, code: 'ARCHIVED' });

/** PATCH { name?, budget?, bidStrategy?, bidAmount?, spendCap? (null removes), endTime? ('' = no end) } */
export async function editCampaign(business, id, raw = {}) {
  const r = obj(raw);
  const row = await requireWriter(business._id);
  const c = await ownObject(row, 'campaign', id);
  assertNotLocked(c);
  const acct = await accountInfo(row, true);
  const cur = acct.currency;
  const p = {};
  if (r.name !== undefined) p.name = text(r.name, 400, 'name', 'Campaign name', { required: true });
  const others = ['budget', 'bidStrategy', 'bidAmount', 'spendCap', 'endTime'].filter((k) => r[k] !== undefined);
  if (isArchived(c) && others.length) throw archivedOnlyName('campaign');
  const type = num(c.daily_budget) ? 'daily' : num(c.lifetime_budget) ? 'lifetime' : null;
  if (r.budget !== undefined) {
    if (!type) throw bad('budget', 'This campaign’s budget is set on its ad sets. Edit the ad sets instead.');
    const minor = toMinor(amountOf(r.budget, 'budget', 'a budget', cur), cur);
    if (minor < acct.minDailyBudgetMinor) {
      throw bad('budget', `Meta’s minimum ${type === 'daily' ? 'daily ' : ''}budget for this account is ${budget(acct.minDailyBudgetMinor, cur)} ${cur}${type === 'lifetime' ? ' a day' : ''}.`);
    }
    if (minor !== num(c[`${type}_budget`])) p[`${type}_budget`] = minor;
  }
  let adsets = null;
  if (r.bidStrategy !== undefined || r.bidAmount !== undefined || r.endTime !== undefined) adsets = await childAdSets(row, c.id);
  if (r.bidStrategy !== undefined || r.bidAmount !== undefined) {
    if (!type) throw bad('bidStrategy', 'With ad set budgets, the bid strategy is set on each ad set. Edit the ad sets instead.');
    const current = c.bid_strategy || 'LOWEST_COST_WITHOUT_CAP';
    const strategy = r.bidStrategy === undefined ? current : oneOf(r.bidStrategy, BID_STRATEGIES, 'bidStrategy', 'Bid strategy');
    if (strategy !== current) p.bid_strategy = strategy;
    if (strategy !== 'LOWEST_COST_WITHOUT_CAP' && (strategy !== current || !blank(r.bidAmount ?? ''))) {
      const bidMinor = toMinor(amountOf(r.bidAmount, 'bidAmount', strategy === 'COST_CAP' ? 'a cost per result goal' : 'a bid cap', cur), cur);
      if (!adsets.length) throw bad('bidStrategy', 'This campaign has no ad sets yet. Add one before setting a bid.');
      if (type === 'daily' && bidMinor > num(p.daily_budget || c.daily_budget)) throw bad('bidAmount', 'The bid can’t be higher than the daily budget.');
      // Meta needs every ad set's bid when the campaign's strategy uses one.
      p.adset_bid_amounts = Object.fromEntries(adsets.map((s) => [String(s.id), bidMinor]));
    } else if (strategy === 'LOWEST_COST_WITHOUT_CAP' && !blank(r.bidAmount ?? '')) {
      throw bad('bidAmount', 'Highest volume has no bid amount.');
    }
  }
  if (r.spendCap !== undefined) {
    if (c.can_use_spend_cap === false) throw bad('spendCap', 'Meta doesn’t allow a spend cap on this campaign.');
    if (blank(r.spendCap)) {
      if (num(c.spend_cap) > 0 && num(c.spend_cap) < REMOVE_SPEND_CAP) p.spend_cap = REMOVE_SPEND_CAP;
    } else {
      const amount = amountOf(r.spendCap, 'spendCap', 'a spend cap', cur);
      if (amount < minSpendCap(cur)) throw bad('spendCap', `Meta’s minimum spend cap is about USD 100 (${minSpendCap(cur)} ${cur}).`);
      p.spend_cap = toMinor(amount, cur);
    }
  }
  let endUtc;
  if (r.endTime !== undefined) {
    if (!adsets.length) throw bad('endTime', 'This campaign has no ad sets to schedule.');
    if (blank(r.endTime)) {
      if (type === 'lifetime' || adsets.some((s) => num(s.lifetime_budget))) throw bad('endTime', 'A lifetime budget needs an end date.');
      endUtc = 0;
    } else {
      endUtc = localTime(r.endTime, acct.timezone, 'endTime', 'end date and time');
      if (endUtc < Date.now() + HOUR_MS) throw bad('endTime', 'The end must be at least an hour from now.');
      for (const s of adsets) {
        const st = parseTime(s.start_time);
        if (Number.isFinite(st) && endUtc - st < DAY_MS) throw bad('endTime', `The end must be at least 24 hours after “${s.name || s.id}” starts.`);
      }
    }
  }
  if (!Object.keys(p).length && endUtc === undefined) throw NOTHING();
  // Raising possible spend on a campaign that is on needs { confirmIncrease: true }.
  if (c.status !== 'PAUSED') {
    const inc = [];
    if (type && p[`${type}_budget`] > num(c[`${type}_budget`])) {
      inc.push({ field: 'budget', label: type === 'daily' ? 'Daily budget' : 'Lifetime budget', from: moneyText(c[`${type}_budget`], cur), to: moneyText(p[`${type}_budget`], cur) });
    }
    const oldStrategy = c.bid_strategy || 'LOWEST_COST_WITHOUT_CAP';
    const oldBid = Math.max(0, ...(adsets || []).map((s) => num(s.bid_amount)));
    const bidLabel = (st) => (st === 'COST_CAP' ? 'Cost per result goal' : 'Bid cap');
    if (p.adset_bid_amounts) {
      // The campaign's bid is written to every ad set: compare it per ad set,
      // so raising a low ad set up to a sibling's higher bid still asks.
      if (oldStrategy !== 'LOWEST_COST_WITHOUT_CAP') {
        for (const s of adsets) {
          const before = num(s.bid_amount);
          const after = num(p.adset_bid_amounts[String(s.id)]);
          if (before > 0 && after > before) {
            inc.push({ field: 'bidAmount', label: `${bidLabel(p.bid_strategy || oldStrategy)} · ${s.name || s.id}`, from: moneyText(before, cur), to: moneyText(after, cur) });
          }
        }
      }
    } else if (p.bid_strategy === 'LOWEST_COST_WITHOUT_CAP' && oldStrategy !== 'LOWEST_COST_WITHOUT_CAP') {
      inc.push({ field: 'bidStrategy', label: 'Bid strategy', from: `${bidLabel(oldStrategy)}${oldBid ? ` ${moneyText(oldBid, cur)}` : ''}`, to: 'Highest volume (no cap)' });
    }
    const oldCap = num(c.spend_cap) > 0 && num(c.spend_cap) < REMOVE_SPEND_CAP ? num(c.spend_cap) : 0;
    if (p.spend_cap === REMOVE_SPEND_CAP && oldCap) inc.push({ field: 'spendCap', label: 'Spend cap', from: moneyText(oldCap, cur), to: 'No spend cap' });
    else if (p.spend_cap && p.spend_cap !== REMOVE_SPEND_CAP && oldCap && p.spend_cap > oldCap) inc.push({ field: 'spendCap', label: 'Spend cap', from: moneyText(oldCap, cur), to: moneyText(p.spend_cap, cur) });
    if (endUtc !== undefined) {
      const ends = adsets.map((s) => parseTime(s.end_time)).filter(Number.isFinite);
      const oldEnd = ends.length ? Math.max(...ends) : NaN;
      const when = (ms) => `${utcToLocal(ms, acct.timezone).replace('T', ' ')} (${acct.timezone})`;
      if (endUtc === 0 && ends.length) inc.push({ field: 'endTime', label: 'End date', from: when(oldEnd), to: 'No end date' });
      else if (endUtc > 0 && ends.some((t) => endUtc > t + 60 * 1000)) inc.push({ field: 'endTime', label: 'End date', from: when(Math.min(...ends)), to: when(endUtc) });
    }
    if (inc.length && r.confirmIncrease !== true) throw new IncreaseConfirm('campaign', inc);
  }
  // Writes in order: the campaign, then each ad set's end. A failure after a
  // write leaves Meta partly changed, so the answer says what was written
  // (`updated`) and what wasn't (`failed`) instead of "nothing saved".
  const updated = [];
  const failed = [];
  if (Object.keys(p).length) {
    await gPost(row, String(c.id), p);
    updated.push({ level: 'campaign', id: String(c.id), name: c.name || '', fields: Object.keys(p) });
  }
  if (endUtc !== undefined) {
    let stop = null;
    for (const s of adsets) {
      if (stop) {
        failed.push({ level: 'adset', id: String(s.id), name: s.name || '', fields: ['end_time'], code: 'SKIPPED', message: 'Not tried after the error above.' });
        continue;
      }
      try {
        // eslint-disable-next-line no-await-in-loop
        await gPost(row, String(s.id), { end_time: endUtc === 0 ? 0 : unix(endUtc) });
        updated.push({ level: 'adset', id: String(s.id), name: s.name || '', fields: ['end_time'] });
      } catch (e) {
        const err = e instanceof AdsError ? e : mapMetaError(e);
        if (!updated.length) {
          cleared(business._id);
          throw err; // nothing was written at all
        }
        failed.push({ level: 'adset', id: String(s.id), name: s.name || '', fields: ['end_time'], code: err.code, message: err.message });
        stop = err;
      }
    }
  }
  cleared(business._id);
  logger.info('campaign edited from the CRM', {
    business: business.name, campaignId: String(c.id), writes: updated.map((w) => `${w.level}:${w.fields.join('+')}`), failed: failed.length,
  });
  return { updated, failed, partial: failed.length > 0, ...(await readBack(business._id, 'campaign', c.id)) };
}

/** The object after a successful write; a failed read doesn't turn the save into an error (`stale: true`). */
async function readBack(businessId, level, id) {
  try {
    return { stale: false, ...(await getDetails(businessId, level, id)) };
  } catch (e) {
    logger.warn('ads edit saved, read-back failed', { level, id: String(id), code: e?.code || '' });
    return { stale: true, canManage: true, details: null };
  }
}

/** PATCH { name?, budget?, schedule?{start,end}, audience?, placements?, optimizationGoal?, bidStrategy?, bidAmount? } */
export async function editAdSet(business, id, raw = {}) {
  const r = obj(raw);
  const row = await requireWriter(business._id);
  const s = await ownObject(row, 'adset', id);
  const camp = s.campaign || {};
  assertNotLocked(camp);
  const acct = await accountInfo(row, true);
  const cur = acct.currency;
  const tz = acct.timezone;
  const now = Date.now();
  const p = {};
  if (r.name !== undefined) p.name = text(r.name, 400, 'name', 'Ad set name', { required: true });
  const others = ['budget', 'schedule', 'audience', 'placements', 'optimizationGoal', 'bidStrategy', 'bidAmount'].filter((k) => r[k] !== undefined);
  if (isArchived(s) && others.length) throw archivedOnlyName('ad set');
  const cbo = num(camp.daily_budget) > 0 || num(camp.lifetime_budget) > 0;
  const type = num(s.daily_budget) ? 'daily' : num(s.lifetime_budget) ? 'lifetime' : null;
  let startMs = parseTime(s.start_time);
  let endMs = parseTime(s.end_time);
  if (r.schedule !== undefined) {
    const sc = obj(r.schedule);
    if (sc.start !== undefined && !blank(sc.start)) {
      const t = localTime(sc.start, tz, 'schedule.start', 'start date and time');
      const started = Number.isFinite(startMs) && startMs <= now;
      if (Math.abs(t - (startMs || 0)) > 60 * 1000) {
        if (started) throw bad('schedule.start', 'This ad set has already started, so its start time can’t change.');
        if (t < now - 5 * 60 * 1000) throw bad('schedule.start', 'The start time is in the past.');
        p.start_time = unix(t);
        startMs = t;
      }
    }
    if (sc.end !== undefined) {
      if (blank(sc.end)) {
        if (type === 'lifetime' || num(camp.lifetime_budget)) throw bad('schedule.end', 'A lifetime budget needs an end date.');
        if (Number.isFinite(endMs)) {
          p.end_time = 0;
          endMs = NaN;
        }
      } else {
        const t = localTime(sc.end, tz, 'schedule.end', 'end date and time');
        if (!Number.isFinite(endMs) || Math.abs(t - endMs) > 60 * 1000) {
          if (t < now + HOUR_MS) throw bad('schedule.end', 'The end must be at least an hour from now.');
          if (t - (Number.isFinite(startMs) ? startMs : now) < DAY_MS) throw bad('schedule.end', 'The end must be at least 24 hours after the start.');
          p.end_time = unix(t);
          endMs = t;
        }
      }
    }
  }
  if (r.budget !== undefined) {
    if (!type) throw bad('budget', cbo ? 'This ad set uses the campaign’s budget (Advantage campaign budget). Edit the campaign instead.' : 'This ad set has no budget to edit.');
    const minor = toMinor(amountOf(r.budget, 'budget', 'a budget', cur), cur);
    if (type === 'daily' && minor < acct.minDailyBudgetMinor) throw bad('budget', `Meta’s minimum daily budget for this account is ${budget(acct.minDailyBudgetMinor, cur)} ${cur}.`);
    if (type === 'lifetime') {
      const days = Number.isFinite(endMs) ? Math.max(1, Math.ceil((endMs - (Number.isFinite(startMs) ? startMs : now)) / DAY_MS)) : 1;
      if (minor < acct.minDailyBudgetMinor * days) {
        throw bad('budget', `For ${days} day${days === 1 ? '' : 's'} the lifetime budget must be at least ${budget(acct.minDailyBudgetMinor * days, cur)} ${cur} (Meta’s daily minimum × days).`);
      }
    }
    if (minor !== num(s[`${type}_budget`])) p[`${type}_budget`] = minor;
  }
  const key = objectiveKeyOf(camp.objective, s.destination_type);
  if (r.optimizationGoal !== undefined) {
    const goals = key ? OBJECTIVES[key].goals : [s.optimization_goal].filter(Boolean);
    const goal = oneOf(r.optimizationGoal, goals, 'optimizationGoal', 'Optimise for');
    if (goal !== s.optimization_goal) p.optimization_goal = goal;
  }
  if (r.bidStrategy !== undefined || r.bidAmount !== undefined) {
    const budgetMinor = type ? num(p[`${type}_budget`] || s[`${type}_budget`]) : 0;
    if (cbo) {
      const strategy = camp.bid_strategy || 'LOWEST_COST_WITHOUT_CAP';
      if (r.bidStrategy !== undefined && r.bidStrategy !== strategy) throw bad('bidStrategy', 'With an Advantage campaign budget, the bid strategy is set on the campaign. Edit the campaign instead.');
      if (strategy === 'LOWEST_COST_WITHOUT_CAP') {
        if (!blank(r.bidAmount ?? '')) throw bad('bidAmount', 'The campaign uses highest volume, which has no bid amount.');
      } else {
        const bidMinor = toMinor(amountOf(r.bidAmount, 'bidAmount', 'a bid amount', cur), cur);
        if (bidMinor !== num(s.bid_amount)) p.bid_amount = bidMinor;
      }
    } else {
      const current = s.bid_strategy || 'LOWEST_COST_WITHOUT_CAP';
      const strategy = r.bidStrategy === undefined ? current : oneOf(r.bidStrategy, BID_STRATEGIES, 'bidStrategy', 'Bid strategy');
      if (strategy !== current) p.bid_strategy = strategy;
      if (strategy !== 'LOWEST_COST_WITHOUT_CAP') {
        const bidMinor = toMinor(amountOf(r.bidAmount, 'bidAmount', strategy === 'COST_CAP' ? 'a cost per result goal' : 'a bid cap', cur), cur);
        if (type === 'daily' && bidMinor > budgetMinor) throw bad('bidAmount', 'The bid can’t be higher than the daily budget.');
        if (bidMinor !== num(s.bid_amount) || strategy !== current) p.bid_amount = bidMinor;
      } else if (!blank(r.bidAmount ?? '')) {
        throw bad('bidAmount', 'Highest volume has no bid amount.');
      }
    }
  }
  if (r.audience !== undefined || r.placements !== undefined) {
    const special = Array.isArray(camp.special_ad_categories) ? camp.special_ad_categories : [];
    const restricted = special.some((c) => RESTRICTED.has(c));
    const current = targetingToEditors(s.targeting || {});
    const aud = validateAudience(r.audience !== undefined ? r.audience : current.audience, { restricted });
    const pl = validatePlacements(r.placements !== undefined ? r.placements : current.placements, key || 'awareness');
    if (key === 'leads' && pl.mode === 'manual' && pl.platforms.includes('audience_network')) throw bad('placements.platforms', 'Lead form ads can’t run on the Audience Network.');
    const keepFlexible = detailedSig(aud.detailed) === detailedSig(current.audience.detailed);
    // S4: the custom audience lists are replaced only when the edit sent them.
    // New ids (not already on the ad set) must be this ad account's.
    const ra = obj(r.audience);
    const sentAudiences = r.audience !== undefined && ('customAudiences' in ra || 'excludedCustomAudiences' in ra);
    if (sentAudiences) {
      const had = new Set([...current.audience.customAudiences, ...current.audience.excludedCustomAudiences].map((x) => x.id));
      await assertAudiences(row, {
        include: aud.customAudiences.map((x) => x.id).filter((x) => !had.has(x)),
        exclude: aud.excludedCustomAudiences.map((x) => x.id).filter((x) => !had.has(x)),
      }, { restricted });
    }
    p.targeting = mergeTargeting(s.targeting || {}, buildTargeting(sentAudiences ? aud : { ...aud, customAudiences: [], excludedCustomAudiences: [] }, pl), { keepFlexible, keepAudiences: !sentAudiences });
  }
  if (!Object.keys(p).length) throw NOTHING();
  // Raising possible spend on an ad set that is on needs { confirmIncrease: true }.
  if (s.status !== 'PAUSED') {
    const inc = [];
    if (type && p[`${type}_budget`] > num(s[`${type}_budget`])) {
      inc.push({ field: 'budget', label: type === 'daily' ? 'Daily budget' : 'Lifetime budget', from: moneyText(s[`${type}_budget`], cur), to: moneyText(p[`${type}_budget`], cur) });
    }
    const oldStrategy = cbo ? camp.bid_strategy || 'LOWEST_COST_WITHOUT_CAP' : s.bid_strategy || 'LOWEST_COST_WITHOUT_CAP';
    const oldBid = num(s.bid_amount);
    const bidLabel = (st) => (st === 'COST_CAP' ? 'Cost per result goal' : 'Bid cap');
    if (p.bid_amount !== undefined && oldBid > 0 && p.bid_amount > oldBid && oldStrategy !== 'LOWEST_COST_WITHOUT_CAP') {
      inc.push({ field: 'bidAmount', label: bidLabel(p.bid_strategy || oldStrategy), from: moneyText(oldBid, cur), to: moneyText(p.bid_amount, cur) });
    }
    if (p.bid_strategy === 'LOWEST_COST_WITHOUT_CAP' && oldStrategy !== 'LOWEST_COST_WITHOUT_CAP') {
      inc.push({ field: 'bidStrategy', label: 'Bid strategy', from: `${bidLabel(oldStrategy)}${oldBid ? ` ${moneyText(oldBid, cur)}` : ''}`, to: 'Highest volume (no cap)' });
    }
    const oldEnd = parseTime(s.end_time);
    const when = (ms) => `${utcToLocal(ms, tz).replace('T', ' ')} (${tz})`;
    // An earlier start adds paid days, like a later end.
    const oldStart = parseTime(s.start_time);
    if (p.start_time !== undefined && Number.isFinite(oldStart) && p.start_time * 1000 < oldStart - 60 * 1000) {
      inc.push({ field: 'schedule.start', label: 'Start date', from: when(oldStart), to: when(p.start_time * 1000) });
    }
    if (p.end_time === 0 && Number.isFinite(oldEnd)) inc.push({ field: 'schedule.end', label: 'End date', from: when(oldEnd), to: 'No end date' });
    else if (p.end_time > 0 && Number.isFinite(oldEnd) && p.end_time * 1000 > oldEnd + 60 * 1000) inc.push({ field: 'schedule.end', label: 'End date', from: when(oldEnd), to: when(p.end_time * 1000) });
    if (inc.length && r.confirmIncrease !== true) throw new IncreaseConfirm('ad set', inc);
  }
  await gPost(row, String(s.id), p);
  cleared(business._id);
  logger.info('ad set edited from the CRM', { business: business.name, adsetId: String(s.id), fields: Object.keys(p) });
  return { updated: [{ level: 'adset', id: String(s.id), name: s.name || '', fields: Object.keys(p) }], failed: [], partial: false, ...(await readBack(business._id, 'adset', s.id)) };
}

/** PATCH { name?, creative? (S1 creative editor fields), identity?{pageId, instagramId} } */
export async function editAd(business, id, raw = {}) {
  const r = obj(raw);
  const row = await requireWriter(business._id);
  const a = await ownObject(row, 'ad', id);
  const camp = a.campaign || {};
  assertNotLocked(camp);
  const p = {};
  if (r.name !== undefined) p.name = text(r.name, 400, 'name', 'Ad name', { required: true });
  let creativeBody = null;
  if (r.creative !== undefined) {
    if (isArchived(a)) throw archivedOnlyName('ad');
    const objKey = objectiveKeyOf(camp.objective, a.adset?.destination_type);
    if (!objKey) {
      throw new AdsError('The CRM changes creatives of WhatsApp, traffic, leads, awareness and sales ads. Change this one in Meta Ads Manager.', { status: 409, code: 'UNSUPPORTED_OBJECTIVE' });
    }
    const current = creativeToEditor(a.creative || {});
    const ident = obj(r.identity);
    const pageId = String(ident.pageId || current.pageId || '');
    if (!isId(pageId)) throw bad('identity.pageId', 'Pick the Facebook Page the ad runs from.');
    const igRaw = ident.instagramId !== undefined ? String(ident.instagramId || '') : isId(current.instagramId) ? current.instagramId : '';
    if (igRaw && !isId(igRaw)) throw bad('identity.instagramId', 'That Instagram account isn’t valid.');
    const creative = validateCreative(r.creative, objKey);
    const spec = { objKey, identity: { pageId, instagramId: igRaw, objKey }, creative, pixelId: '' };
    const assets = await assertAssets(row, spec);
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
    creativeBody = { name: `${p.name || a.name || 'Ad'} creative ${stamp}`.slice(0, 100), ...creativeContentOf(spec, assets) };
  }
  if (!Object.keys(p).length && !creativeBody) throw NOTHING();
  let creativeId = '';
  let removedCreative = null;
  if (creativeBody) {
    const made = await gPost(row, `${row.adAccountId}/adcreatives`, creativeBody);
    if (!isId(made?.id)) throw new AdsError('Meta didn’t return the new creative.', { status: 502, code: 'META_ERROR' });
    creativeId = String(made.id);
    try {
      await gPost(row, String(a.id), { ...p, creative: { creative_id: creativeId } });
    } catch (err) {
      // The ad keeps its old creative; don't leave the unused one behind.
      if (err.code !== 'ADS_REVOKED') {
        try {
          await gDelete(row, creativeId);
          removedCreative = true;
        } catch (e) {
          removedCreative = false;
          logger.warn('ad edit: unused creative not deleted', { creativeId, error: e.message });
        }
      }
      cleared(business._id);
      if (err instanceof AdsError) err.creativeRolledBack = removedCreative;
      throw err;
    }
  } else {
    await gPost(row, String(a.id), p);
  }
  cleared(business._id);
  logger.info('ad edited from the CRM', { business: business.name, adId: String(a.id), fields: Object.keys(p), newCreative: creativeId || null });
  return {
    updated: [{ level: 'ad', id: String(a.id), name: a.name || '', fields: [...Object.keys(p), ...(creativeId ? ['creative'] : [])] }], failed: [], partial: false, creativeId,
    ...(await readBack(business._id, 'ad', a.id)),
  };
}

export async function editObject(business, level, id, raw) {
  levelOf(level);
  if (level === 'campaign') return editCampaign(business, id, raw);
  if (level === 'adset') return editAdSet(business, id, raw);
  return editAd(business, id, raw);
}

// ----------------------------------------------------------- duplicate --

/** POST /{id}/copies, always PAUSED; a copy that comes back ACTIVE is paused right away. */
async function copyOne(row, level, o) {
  const camp = level === 'campaign' ? o : o.campaign || {};
  assertNotLocked(camp);
  if (camp.objective && !/^OUTCOME_/.test(String(camp.objective))) {
    throw new AdsError('Meta only copies campaigns that use the current objectives (awareness, traffic, engagement, leads, app promotion, sales). Create a new campaign instead.', {
      status: 409, code: 'LEGACY_OBJECTIVE',
    });
  }
  if (o.status === 'DELETED') throw new AdsError('Deleted items can’t be copied.', { status: 409, code: 'BAD_STATE' });
  const body = { status_option: 'PAUSED', rename_options: { rename_strategy: 'ONLY_TOP_LEVEL_RENAME' } };
  if (level !== 'ad') {
    const ads = await gList(row, `${o.id}/ads`, { fields: 'id', limit: SYNC_COPY_MAX + 1 }, 1);
    if (ads.length > SYNC_COPY_MAX) {
      throw new AdsError(`Meta copies at most ${SYNC_COPY_MAX} ads in one go, and this ${LEVELS[level].label} has more. Duplicate its ${level === 'campaign' ? 'ad sets' : 'ads'} one by one, or use Meta Ads Manager.`, {
        status: 409, code: 'COPY_TOO_LARGE',
      });
    }
    body.deep_copy = true;
  }
  const data = await gPost(row, `${o.id}/copies`, body);
  const newId = String(data?.copied_campaign_id || data?.copied_adset_id || data?.copied_ad_id || data?.id || '');
  if (!isId(newId)) throw new AdsError('Meta didn’t return the copy.', { status: 502, code: 'META_ERROR' });
  // The money backstop: status_option PAUSED should have done it, but a copy
  // is never left running unseen. Read its status (twice if needed); when it
  // is ACTIVE, or still unknown, pause it (twice if needed); when that fails,
  // delete the copy; when that fails too, answer with its id and a
  // COPY_NOT_PAUSED warning the browser shows prominently.
  let copy = null;
  for (let i = 0; i < 2 && !copy; i += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      copy = await gGet(row, newId, { fields: 'id,name,status,effective_status' });
    } catch (e) {
      logger.warn('copy read-back failed', { newId, attempt: i + 1, code: e?.code || '' });
    }
  }
  const verified = !!copy;
  let forcedPause = false;
  let warning = null;
  if (!copy || copy.status === 'ACTIVE') {
    let paused = false;
    for (let i = 0; i < 2 && !paused; i += 1) {
      try {
        // eslint-disable-next-line no-await-in-loop
        if (i) await sleep(envMs('ADS_COPY_RETRY_MS', 2000));
        // eslint-disable-next-line no-await-in-loop
        await gPost(row, newId, { status: 'PAUSED' });
        paused = true;
      } catch (e) {
        logger.warn('copy pause failed', { newId, attempt: i + 1, code: e?.code || '' });
      }
    }
    if (paused) {
      forcedPause = verified;
      copy = { ...(copy || {}), status: 'PAUSED', effective_status: 'PAUSED' };
    } else {
      let deleted = false;
      try {
        await gDelete(row, newId);
        deleted = true;
      } catch (e) {
        logger.warn('copy delete after failed pause failed', { newId, code: e?.code || '' });
      }
      if (deleted) {
        logger.warn('copy deleted: it could not be confirmed paused', { level, sourceId: String(o.id), newId });
        throw new AdsError(`Meta made the copy but the CRM couldn’t ${verified ? 'pause it (it came back on)' : 'check that it is paused'}, so it deleted the copy again. Nothing was duplicated; try again in a few minutes.`, {
          status: 502, code: 'COPY_DELETED',
        });
      }
      warning = {
        code: 'COPY_NOT_PAUSED',
        message: `Meta made the copy (${newId}), but the CRM couldn’t ${verified ? 'pause it (it came back on)' : 'check that it is paused'}, nor delete it. Open it in Meta Ads Manager now and pause or delete it, or it may spend.`,
      };
      logger.error('copy may be running: not paused, not deleted', { level, sourceId: String(o.id), newId, verified });
    }
  }
  return {
    level, sourceId: String(o.id), id: newId, name: copy?.name || '', status: warning ? (copy?.status || 'UNKNOWN') : copy?.status || 'PAUSED',
    effectiveStatus: warning ? (copy?.effective_status || copy?.status || 'UNKNOWN') : copy?.effective_status || copy?.status || 'PAUSED',
    deepCopy: !!body.deep_copy, forcedPause, statusVerified: verified, warning,
  };
}

export async function duplicateObject(business, level, id) {
  const L = levelOf(level);
  const row = await requireWriter(business._id);
  const o = await ownObject(row, level, id, L.brief);
  try {
    const copy = await copyOne(row, level, o);
    logger.info('ad object duplicated from the CRM (paused)', { business: business.name, level, sourceId: copy.sourceId, copyId: copy.id, warning: copy.warning?.code || '' });
    return { copy, ...(copy.warning ? { warning: copy.warning } : {}) };
  } finally {
    cleared(business._id);
  }
}

// ---------------------------------------------------- archive / delete --

export async function removeObject(business, level, id, { action, confirm } = {}) {
  const L = levelOf(level);
  const act = oneOf(action, ['archive', 'delete'], 'action', 'Action');
  if (confirm !== true) throw confirmRequired(act === 'delete' ? 'Deleting can’t be undone.' : 'Archiving stops delivery for good.');
  const row = await requireWriter(business._id);
  const o = await ownObject(row, level, id, `id,name,account_id,status,${L.marker}`);
  if (act === 'archive') {
    if (o.status === 'DELETED') throw new AdsError('This was deleted already.', { status: 409, code: 'BAD_STATE' });
    if (o.status !== 'ARCHIVED') await gPost(row, String(o.id), { status: 'ARCHIVED' });
  } else {
    await gDelete(row, String(o.id));
  }
  cleared(business._id);
  logger.info(`ad object ${act}d from the CRM`, { business: business.name, level, id: String(o.id) });
  return { id: String(o.id), level, action: act, status: act === 'archive' ? 'ARCHIVED' : 'DELETED' };
}

// ---------------------------------------------------------------- bulk --

/** The bulk request's fields, validated (no Graph call). */
function parseBulk(raw) {
  const r = obj(raw);
  const action = oneOf(r.action, ['pause', 'resume', 'duplicate', 'archive'], 'action', 'Action');
  const level = oneOf(r.level, ['campaign', 'adset', 'ad'], 'level', 'Level');
  if (!Array.isArray(r.ids) || !r.ids.length) throw bad('ids', 'Select at least one row.');
  const ids = [...new Set(r.ids.map(String))];
  if (ids.length > BULK_MAX) throw bad('ids', `Select at most ${BULK_MAX} rows at once.`);
  if (ids.some((x) => !isId(x))) throw bad('ids', 'One of the selected ids isn’t valid.');
  if (action === 'resume' && r.confirm !== true) throw confirmRequired('Resuming starts spending.');
  if (action === 'archive' && r.confirm !== true) throw confirmRequired('Archiving stops delivery for good.');
  return { action, level, ids };
}

/** POST { action: pause|resume|duplicate|archive, level, ids[], confirm? } → one result per id (in the request; the route uses startBulk). */
export async function bulkAction(business, raw = {}) {
  const plan = parseBulk(raw);
  const row = await requireWriter(business._id, { brake: plan.action === 'pause' });
  return runBulk(business, row, plan, []);
}

async function runBulk(business, row, { action, level, ids }, results) {
  const owned = await ownMany(row, level, ids);
  let stopped = '';
  try {
    for (const id of ids) {
      if (stopped) {
        results.push({ id, ok: false, code: 'SKIPPED', message: 'Not tried: Meta is limiting requests. Try these again in a few minutes.' });
        continue;
      }
      const o = owned.get(id);
      if (o instanceof Error) {
        results.push({ id, ok: false, code: o.code || 'ADS_ERROR', message: o.message });
        continue;
      }
      try {
        if (action === 'pause' || action === 'resume') {
          const want = action === 'pause' ? 'PAUSED' : 'ACTIVE';
          const from = action === 'pause' ? 'ACTIVE' : 'PAUSED';
          if (o.status === want) {
            results.push({ id, ok: true, status: want, unchanged: true });
            continue;
          }
          if (o.status !== from) throw new AdsError(`Only ${from === 'ACTIVE' ? 'active' : 'paused'} items can be ${action}d.`, { status: 409, code: 'BAD_STATE' });
          if (action === 'resume') assertNotLocked(level === 'campaign' ? o : o.campaign || {});
          // eslint-disable-next-line no-await-in-loop
          await gPost(row, id, { status: want });
          results.push({ id, ok: true, status: want });
        } else if (action === 'archive') {
          if (o.status === 'ARCHIVED') {
            results.push({ id, ok: true, status: 'ARCHIVED', unchanged: true });
            continue;
          }
          // eslint-disable-next-line no-await-in-loop
          await gPost(row, id, { status: 'ARCHIVED' });
          results.push({ id, ok: true, status: 'ARCHIVED' });
        } else {
          // eslint-disable-next-line no-await-in-loop
          const copy = await copyOne(row, level, o);
          results.push({ id, ok: true, copyId: copy.id, status: copy.status, ...(copy.warning ? { warning: copy.warning } : {}) });
        }
      } catch (e) {
        const err = e instanceof AdsError ? e : mapMetaError(e);
        if (err.code === 'ADS_REVOKED') throw err;
        results.push({ id, ok: false, code: err.code, message: err.message });
        if (err.code === 'RATE_LIMITED') stopped = 'RATE_LIMITED';
      }
    }
  } finally {
    cleared(business._id);
  }
  const done = results.filter((x) => x.ok).length;
  logger.info('ads bulk action from the CRM', { business: business.name, action, level, selected: ids.length, done, stopped });
  return { action, level, results, done, failed: results.length - done, stopped };
}

// ------------------------------------------------------- bulk jobs --
// Up to 50 writes or deep copies can take longer than nginx's 120 s proxy
// timeout, so the route runs bulk as a background job: POST answers 202 with
// a job id at once and the browser polls GET /meta/manage/bulk/:id. The
// browser sends an idempotency `key` (one per click): the same key again
// returns the same job instead of running it twice (a retried bulk duplicate
// never makes a second set of copies); the same key with other rows → 409
// KEY_REUSED. One bulk job at a time per business (409 BULK_RUNNING). Jobs
// and keys live in this process for an hour (one backend process).
const BULK_KEEP_MS = 60 * 60 * 1000;
const bulkJobs = new Map(); // jobId -> job
const bulkKeys = new Map(); // `${businessId}|${key}` -> { jobId, fingerprint, at }

function presentBulk(j) {
  const done = j.results.filter((x) => x.ok).length;
  return {
    id: j.id, action: j.action, level: j.level, status: j.status, total: j.total, processed: j.results.length, results: j.results,
    done, failed: j.results.length - done, stopped: j.stopped || '', error: j.error, startedAt: j.startedAt, finishedAt: j.finishedAt,
  };
}

/** At most this many jobs are kept (ADS_BULK_JOBS_MAX, default 500); the oldest finished ones go first. */
const bulkJobsMax = () => Math.max(1, Math.floor(envMs('ADS_BULK_JOBS_MAX', 500)) || 500);
const forgetBulk = (j) => {
  bulkJobs.delete(j.id);
  const k = `${j.businessId}|${j.key}`;
  if (bulkKeys.get(k)?.jobId === j.id) bulkKeys.delete(k);
};

function pruneBulk(now = Date.now()) {
  for (const [id, j] of bulkJobs) if (j.finishedAt && now - new Date(j.finishedAt).getTime() > BULK_KEEP_MS) bulkJobs.delete(id);
  for (const [k, v] of bulkKeys) if (now - v.at > BULK_KEEP_MS && !bulkJobs.has(v.jobId)) bulkKeys.delete(k);
  // The global cap: Map order is insertion order, so this walks oldest first.
  // Running jobs are never dropped (there is at most one per business).
  const max = bulkJobsMax();
  if (bulkJobs.size >= max) {
    for (const j of [...bulkJobs.values()]) {
      if (bulkJobs.size < max) break;
      if (j.finishedAt) forgetBulk(j);
    }
  }
}

/** Tests only: how many bulk jobs and keys this process holds. */
export function bulkStoreSize() {
  return { jobs: bulkJobs.size, keys: bulkKeys.size };
}

/** POST /meta/manage/bulk { action, level, ids, confirm?, key } → 202 { job } (the same key → the same job). */
export async function startBulk(business, raw = {}) {
  const r = obj(raw);
  const key = String(r.key ?? '');
  if (!KEY.test(key)) throw bad('key', 'The request key is missing. Reload the page and try again.');
  const plan = parseBulk(r);
  const b = String(business._id);
  pruneBulk();
  const fingerprint = `${plan.action}|${plan.level}|${[...plan.ids].sort().join(',')}`;
  const k = `${b}|${key}`;
  const seen = bulkKeys.get(k);
  if (seen) {
    if (seen.fingerprint !== fingerprint) throw new AdsError('This request key was already used for another bulk action. Reload the page and try again.', { status: 409, code: 'KEY_REUSED' });
    const j = bulkJobs.get(seen.jobId);
    if (j) {
      // A retry that arrives while the first request is still being checked
      // gets that check's answer (and nothing when it was refused).
      if (j.gate) await j.gate;
      if (bulkJobs.has(j.id)) return { job: presentBulk(j), replayed: true };
    }
  }
  for (const j of bulkJobs.values()) {
    if (j.businessId === b && j.status === 'running') throw new AdsError('Another bulk action is still running. Wait for it to finish.', { status: 409, code: 'BULK_RUNNING' });
  }
  // Reserved before the first await, so a quick retry finds this job.
  const job = {
    id: crypto.randomBytes(12).toString('hex'), businessId: b, adAccountId: '', key, action: plan.action, level: plan.level, total: plan.ids.length,
    status: 'running', results: [], stopped: '', error: null, startedAt: new Date(), finishedAt: null, promise: null,
  };
  bulkJobs.set(job.id, job);
  bulkKeys.set(k, { jobId: job.id, fingerprint, at: Date.now() });
  let row;
  try {
    job.gate = requireWriter(business._id, { brake: plan.action === 'pause' });
    row = await job.gate;
  } catch (e) {
    // Refused before anything ran: keep neither the job nor its key, so a
    // read-only tenant clicking again doesn't grow the maps.
    forgetBulk(job);
    throw e;
  } finally {
    job.gate = null;
  }
  job.adAccountId = row.adAccountId;
  job.promise = runBulk(business, row, plan, job.results)
    .then((res) => {
      job.stopped = res.stopped;
      job.status = 'done';
    })
    .catch((e) => {
      job.status = 'failed';
      job.error = { code: e?.code || 'ADS_FAILED', message: e instanceof AdsError ? e.message : 'Something went wrong. Please try again.' };
      logger.warn('ads bulk job stopped', { business: business.name, action: plan.action, level: plan.level, code: e?.code || '', processed: job.results.length });
    })
    .finally(() => {
      job.finishedAt = new Date();
    });
  return { job: presentBulk(job) };
}

/** GET /meta/manage/bulk/:id → { job } (this business and ad account only). */
export async function bulkStatus(businessId, jobId) {
  if (!/^[a-f0-9]{24}$/.test(String(jobId || ''))) throw new AdsError('Unknown bulk action.', { status: 400, code: 'BAD_ID' });
  const row = await requireAdsRow(businessId);
  const j = bulkJobs.get(String(jobId));
  if (!j || j.businessId !== String(businessId) || (j.adAccountId && j.adAccountId !== row.adAccountId)) {
    throw new AdsError('That bulk action doesn’t exist any more.', { status: 404, code: 'BULK_NOT_FOUND' });
  }
  return { job: presentBulk(j) };
}

/** Wait for this process's bulk jobs (the harness). */
export async function waitForBulk() {
  await Promise.all([...bulkJobs.values()].map((j) => j.promise?.catch(() => {})));
}

// ------------------------------------------------------------- preview --

/** ?format=facebook_feed|instagram_feed|instagram_story|reels → { src } of an existing ad's preview. */
export async function adPreview(businessId, adId, q = {}) {
  const row = await requireAdsRow(businessId);
  const format = oneOf(q.format || 'facebook_feed', Object.keys(PREVIEW_FORMATS), 'format', 'Preview format');
  await ownObject(row, 'ad', adId, 'id,account_id,adset_id');
  const data = await graphGet(row, `${adId}/previews`, { ad_format: PREVIEW_FORMATS[format] }, { refresh: q.refresh === '1' });
  const src = previewSrc(data?.data?.[0]?.body);
  if (!src) throw new AdsError('Meta didn’t return a preview for this placement.', { status: 502, code: 'NO_PREVIEW' });
  return { format, src };
}

export default {
  getDetails, editObject, editCampaign, editAdSet, editAd, duplicateObject, removeObject, bulkAction, startBulk, bulkStatus, reviewRows, archivedRows, adPreview,
  targetingToEditors, mergeTargeting, creativeToEditor, feedbackOf, objectiveKeyOf, utcToLocal,
};
