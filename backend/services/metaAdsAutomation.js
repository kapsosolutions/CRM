// ---------------------------------------------------------------------------
// Ads Manager S5: automation, A/B tests and pixels (Ads page → Automation).
//
//   • Automated rules: Meta's Ad Rules Engine (act_/adrules_library). The CRM
//     builds every rule from validated fields: entity level + scope, a time
//     range, 1–5 conditions on an allow-listed metric, an action (PAUSE,
//     CHANGE_BUDGET with a percentage and a money cap, NOTIFICATION) and a
//     schedule (SEMI_HOURLY, HOURLY, DAILY, CUSTOM). Schedule-based rules
//     only; UNPAUSE is never offered, so no rule can turn anything on.
//     A rule is created DISABLED unless the business confirms "create and
//     turn on" ({ enabled: true, confirm: true }). Enabling a rule, and
//     editing one that is enabled, also need { confirm: true }; the confirm
//     text is the server's own summary of what the rule will do.
//     Budget increases are always capped: change_spec.limit (the cap), a
//     daily_budget < cap filter, budget_reset_period DAY (daily budgets only),
//     results > 0 (no increase for "cheap" ad sets that got nothing),
//     action_frequency and execution_count_limit.
//   • Rule history: /{rule}/history (hide_no_changes). Executions are
//     mirrored as `ad_rule_triggered` CRM notifications when the Automation
//     tab loads the rules (at most every ADS_RULE_MIRROR_MS, default 10 min,
//     per business), deduped by groupKey ad_rule:<rule>:<timestamp>. There is
//     no background loop: that would need server.js, which also runs the
//     production server's boot.
//   • A/B tests: Meta split tests (POST /{business_id}/ad_studies, type
//     SPLIT_TEST, 2–5 cells of one ad set or campaign each, equal split). The
//     business id is the ad account's owning Business portfolio. Listing reads
//     act_/impacting_ad_studies; results and a winner come from
//     /{study}/objectives → results. When Meta can't run one (no Business
//     portfolio, no permission), the CRM comparison (compareObjects) puts 2–5
//     campaigns or ad sets side by side from the S3 report engine with a
//     two-proportion z-test as the significance indicator.
//   • Pixels: act_/adspixels (last_fired_time), /{pixel}/stats
//     (aggregation=event, at most the last 7 days), custom conversions
//     (act_/customconversions), and the Meta Pixel base code built here from
//     the validated pixel id.
//
// Writes need ads_management (409 READ_ONLY after a fresh permission check).
// Every id from the browser is proven to be in the connected ad account
// (404 NOT_IN_ACCOUNT). Errors 190 / rate limits through withAdsToken /
// mapMetaError; every call carries appsecret_proof. Nothing here sets a
// status on a campaign, ad set or ad.
// ---------------------------------------------------------------------------
import crypto from 'crypto';
import Notification from '../models/Notification.js';
import {
  AdsError, requireAdsRow, requireAdsWriter, withAdsToken, refreshPermissions, auth, proof, http, G, isId, actNumber, graphList, graphGet, NO_MINOR_UNIT,
} from './metaAds.js';
import { accountInfo, clearAll, zonedToUtc, CONVERSION_EVENTS } from './metaAdsCreate.js';
import { utcToLocal } from './metaAdsManage.js';
import { insightsReport, clearReportCache } from './metaAdsReports.js';
import { notify } from './notifications.js';
import logger from './logger.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const NAME_MAX = 400;
const DESC_MAX = 1000;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const envNum = (k, d, min = 0) => {
  const n = Number(process.env[k]);
  return Number.isFinite(n) && n >= min ? n : d;
};
const mirrorEveryMs = () => envNum('ADS_RULE_MIRROR_MS', 10 * 60 * 1000);
const noMinor = (cur) => NO_MINOR_UNIT.has(String(cur || '').toUpperCase());
const toMinor = (v, cur) => (noMinor(cur) ? Math.round(Number(v)) : Math.round(Number(v) * 100));
const fromMinor = (v, cur) => (noMinor(cur) ? num(v) : num(v) / 100);

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

/**
 * "Turn it on?" is asked in the CRM first; the error carries the summary to
 * show and its summaryHash, which the confirmed request must send back.
 */
class ConfirmError extends AdsError {
  constructor(message, summary, summaryHash) {
    super(message, { status: 400, code: 'CONFIRM_REQUIRED' });
    this.summary = summary;
    this.summaryHash = summaryHash;
  }

  toJSON() {
    return { ...super.toJSON(), summary: this.summary, summaryHash: this.summaryHash };
  }
}

/**
 * A confirm whose summaryHash isn't the hash of the spec being written (the
 * user confirmed an older summary, or none): 409 SUMMARY_STALE with the
 * fresh summary and hash to confirm instead.
 */
class StaleSummaryError extends AdsError {
  constructor(summary, summaryHash) {
    super('The rule changed after the summary you confirmed. Check the new summary and confirm again.', { status: 409, code: 'SUMMARY_STALE' });
    this.summary = summary;
    this.summaryHash = summaryHash;
  }

  toJSON() {
    return { ...super.toJSON(), summary: this.summary, summaryHash: this.summaryHash };
  }
}

/** JSON with sorted keys (undefined members dropped), so equal specs hash equal. */
function stable(v) {
  if (Array.isArray(v)) return `[${v.map((x) => stable(x)).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}
/**
 * summaryHash: SHA-256 (first 32 hex) of the normalised spec the summary was
 * made from, plus the account currency (the summary's money format). For a
 * rule made outside the CRM, the hash is of Meta's own evaluation, execution
 * and schedule specs.
 */
export function summaryHashOf(spec, currency) {
  return crypto.createHash('sha256').update(stable({ v: 1, currency: String(currency || '').toUpperCase(), spec })).digest('hex').slice(0, 32);
}
export function outsideHashOf(rule, currency) {
  return summaryHashOf({
    outside: true, evaluation_spec: rule.evaluation_spec ?? null, execution_spec: rule.execution_spec ?? null, schedule_spec: rule.schedule_spec ?? null,
  }, currency);
}
/** confirm: true needs the hash of exactly what is being written. */
function assertSummaryHash(sent, summary, hash) {
  if (typeof sent !== 'string' || sent !== hash) throw new StaleSummaryError(summary, hash);
}

const READ_ONLY_TEXT = 'The CRM can only read this ad account. To create or change rules and tests here, reconnect and allow managing ads (ads_management).';
const notInAccount = (what = 'That') => new AdsError(`${what} isn’t part of your connected ad account.`, { status: 404, code: 'NOT_IN_ACCOUNT' });
const isMissing = (e) => e?.code === 'META_ERROR' && Number(e?.meta?.code) === 100
  && (Number(e?.meta?.subcode) === 33 || /does not exist|Unsupported get request/i.test(String(e?.meta?.message || '')));
/** Errors that mean "this read isn't available", not "stop". */
const soft = (e) => e instanceof AdsError && ['PERMISSION_MISSING', 'META_ERROR'].includes(e.code);

// ---------------------------------------------------------- validation --

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
function intIn(v, min, max, field, label) {
  const n = typeof v === 'string' && v.trim() === '' ? NaN : Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(field, `${label} must be a whole number from ${min} to ${max}.`);
  return n;
}
function numberIn(v, min, max, field, label) {
  const n = typeof v === 'string' && v.trim() === '' ? NaN : Number(v);
  if (typeof v === 'boolean' || !Number.isFinite(n) || n < min || n > max) throw bad(field, `${label} must be a number from ${min} to ${max}.`);
  return n;
}
function idList(v, { min, max, field, label }) {
  if (!Array.isArray(v)) throw bad(field, `Pick the ${label}.`);
  const ids = [...new Set(v.map((x) => String(x ?? '').trim()))];
  if (ids.some((x) => !isId(x))) throw bad(field, `Unknown ${label.replace(/s$/, '')} id.`);
  if (ids.length < min) throw bad(field, min === 1 ? `Pick at least one of the ${label}.` : `Pick at least ${min} ${label}.`);
  if (ids.length > max) throw bad(field, `Pick at most ${max} ${label}.`);
  return ids;
}

// -------------------------------------------------------------- graph --

const bearer = (t) => ({ Authorization: `Bearer ${t}` });
const gGet = (row, path, params = {}) => withAdsToken(row, 'ad', async (token) => (await http.get(`${G()}/${path}`, auth(token, params))).data);
function gList(row, path, params = {}, maxPages = 3) {
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
/** POST a form body built here (Graph's documented encoding for the rules / studies APIs); appsecret_proof as a param. */
function gPostForm(row, path, fields) {
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) form.set(k, typeof v === 'string' ? v : JSON.stringify(v));
  return withAdsToken(row, 'ad', async (token) => (await http.post(`${G()}/${path}`, form.toString(), {
    params: { appsecret_proof: proof(token) },
    headers: { ...bearer(token), 'Content-Type': 'application/x-www-form-urlencoded' },
  })).data);
}
const gDelete = (row, path) => withAdsToken(row, 'ad', async (token) => (await http.delete(`${G()}/${path}`, auth(token))).data);

/**
 * Rule and test writes: Graph version ≥ v24, connected, ads_management re-checked now (409 GRAPH_VERSION_TOO_OLD / READ_ONLY).
 * `brake: true` (turning a rule off) skips only the version check, like the row-level pause.
 */
const requireWriter = (businessId, { brake = false } = {}) => requireAdsWriter(businessId, READ_ONLY_TEXT, { skipVersion: brake });
function afterWrite(businessId) {
  clearAll(businessId);
  clearReportCache(businessId);
}

/**
 * Campaign / ad set ids from the browser: read through the account's own edge
 * filtered by id, so an id of another account, or of the other level, simply
 * isn't returned (404 NOT_IN_ACCOUNT).
 */
async function assertObjects(row, level, ids, { field = 'ids' } = {}) {
  if (!ids.length) return [];
  const edge = level === 'campaign' ? 'campaigns' : 'adsets';
  const list = await gList(row, `${row.adAccountId}/${edge}`, {
    fields: level === 'campaign' ? 'id,name,status,effective_status,objective' : 'id,name,status,effective_status,campaign_id,daily_budget,lifetime_budget',
    filtering: JSON.stringify([{ field: 'id', operator: 'IN', value: ids }]),
    limit: 100,
  }, 1);
  const byId = new Map(list.map((o) => [String(o.id), o]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length) {
    const e = notInAccount(level === 'campaign' ? 'That campaign' : 'That ad set');
    e.field = field;
    throw e;
  }
  return ids.map((id) => byId.get(id));
}

const fmtMoney = (major, cur) => {
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: cur || 'USD', maximumFractionDigits: noMinor(cur) ? 0 : 2 }).format(major);
  } catch {
    return `${cur || ''} ${Number(major).toFixed(2)}`.trim();
  }
};

// ======================================================= automated rules ==

export const RULE_LEVELS = { CAMPAIGN: 'campaign', ADSET: 'ad set', AD: 'ad' };
export const SCOPES = ['all_active', 'campaigns', 'adsets'];
/** Rule time ranges (Meta's time_preset; the "_DAYS" ones include today). */
export const TIME_PRESETS = {
  TODAY: 'Today', YESTERDAY: 'Yesterday', LAST_2_DAYS: 'Yesterday and today', LAST_3_DAYS: 'Last 3 days (incl. today)',
  LAST_7_DAYS: 'Last 7 days (incl. today)', LAST_14_DAYS: 'Last 14 days (incl. today)', LAST_30_DAYS: 'Last 30 days (incl. today)', LIFETIME: 'Lifetime',
};
/**
 * Condition metrics (Meta's rule Insights fields). money values go to Meta in
 * the currency's minor unit; cost_per is Meta's cost per result for the
 * object's optimisation goal.
 */
export const RULE_METRICS = {
  spent: { label: 'Amount spent', kind: 'money' },
  results: { label: 'Results', kind: 'int' },
  cost_per: { label: 'Cost per result', kind: 'money' },
  impressions: { label: 'Impressions', kind: 'int' },
  reach: { label: 'Reach', kind: 'int' },
  clicks: { label: 'Clicks (all)', kind: 'int' },
  ctr: { label: 'CTR (all, %)', kind: 'pct' },
  cpc: { label: 'CPC (all)', kind: 'money' },
  cpm: { label: 'CPM', kind: 'money' },
  frequency: { label: 'Frequency', kind: 'dec' },
};
export const RULE_OPERATORS = { GREATER_THAN: 'is more than', LESS_THAN: 'is less than', EQUAL: 'is' };
export const RULE_ACTIONS = { PAUSE: 'Pause', CHANGE_BUDGET: 'Increase daily budget', NOTIFICATION: 'Notify only' };
export const SCHEDULES = { SEMI_HOURLY: 'Every 30 minutes', HOURLY: 'Every hour', DAILY: 'Once a day (12:00 AM, account time zone)', CUSTOM: 'Custom' };
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The four templates (the builder starts from one; the server validates the result like any rule). */
export const RULE_TEMPLATES = {
  pause_high_cpr: {
    label: 'Pause ad sets when cost per result is high',
    spec: { level: 'ADSET', scope: { type: 'all_active', ids: [] }, timePreset: 'LAST_7_DAYS', conditions: [{ metric: 'cost_per', operator: 'GREATER_THAN', value: null }], action: { type: 'PAUSE' }, schedule: { type: 'SEMI_HOURLY' } },
  },
  pause_spend_no_results: {
    label: 'Pause when spend is high and there are no results',
    spec: { level: 'ADSET', scope: { type: 'all_active', ids: [] }, timePreset: 'LAST_7_DAYS', conditions: [{ metric: 'spent', operator: 'GREATER_THAN', value: null }, { metric: 'results', operator: 'EQUAL', value: 0 }], action: { type: 'PAUSE' }, schedule: { type: 'SEMI_HOURLY' } },
  },
  increase_budget_low_cpr: {
    label: 'Increase daily budget when cost per result is low',
    spec: { level: 'ADSET', scope: { type: 'all_active', ids: [] }, timePreset: 'LAST_7_DAYS', conditions: [{ metric: 'cost_per', operator: 'LESS_THAN', value: null }], action: { type: 'CHANGE_BUDGET', percent: 20, cap: null, everyHours: 24, maxTimes: 5 }, schedule: { type: 'DAILY' } },
  },
  notify_only: {
    label: 'Notify me only',
    spec: { level: 'ADSET', scope: { type: 'all_active', ids: [] }, timePreset: 'LAST_7_DAYS', conditions: [{ metric: 'spent', operator: 'GREATER_THAN', value: null }], action: { type: 'NOTIFICATION' }, schedule: { type: 'DAILY' } },
  },
};

/**
 * The browser's rule → a validated rule spec (major units, ids checked for
 * shape; ownership is checked by assertRuleScope). Nothing from the browser
 * reaches Meta except through buildRulePayload.
 */
export function validateRuleSpec(raw, { currency, minDailyMinor = 0 } = {}) {
  const r = obj(raw);
  const name = text(r.name, NAME_MAX, 'name', 'Rule name', { required: true });
  const level = oneOf(r.level, Object.keys(RULE_LEVELS), 'level', 'Apply to');
  const sc = obj(r.scope);
  const scopeType = oneOf(sc.type ?? 'all_active', SCOPES, 'scope.type', 'Which ones');
  let ids = [];
  if (scopeType !== 'all_active') {
    if (scopeType === 'adsets' && level === 'CAMPAIGN') throw bad('scope.type', 'A campaign rule can’t be limited to ad sets. Pick campaigns instead.');
    ids = idList(sc.ids, { min: 1, max: 50, field: 'scope.ids', label: scopeType === 'campaigns' ? 'campaigns' : 'ad sets' });
  }
  const timePreset = oneOf(r.timePreset, Object.keys(TIME_PRESETS), 'timePreset', 'Time range');
  if (!Array.isArray(r.conditions) || !r.conditions.length) throw bad('conditions', 'Add at least one condition.');
  if (r.conditions.length > 5) throw bad('conditions', 'A rule can have at most 5 conditions.');
  const conditions = r.conditions.map((c0, i) => {
    const c = obj(c0);
    const f = `conditions.${i}`;
    const metric = oneOf(c.metric, Object.keys(RULE_METRICS), `${f}.metric`, 'Metric');
    const kind = RULE_METRICS[metric].kind;
    const operator = oneOf(c.operator, Object.keys(RULE_OPERATORS), `${f}.operator`, 'Condition');
    if (operator === 'EQUAL' && kind !== 'int') throw bad(`${f}.operator`, `${RULE_METRICS[metric].label} can only be compared with “more than” or “less than”.`);
    const max = kind === 'pct' ? 100 : kind === 'dec' ? 1000 : 1e9;
    const value = numberIn(c.value, 0, max, `${f}.value`, RULE_METRICS[metric].label);
    if (kind === 'int' && !Number.isInteger(value)) throw bad(`${f}.value`, `${RULE_METRICS[metric].label} must be a whole number.`);
    if (kind === 'money' && operator === 'LESS_THAN' && value <= 0) throw bad(`${f}.value`, 'Pick an amount above 0.');
    return { metric, operator, value: kind === 'money' ? Math.round(value * 100) / 100 : value };
  });
  const keys = conditions.map((c) => `${c.metric}|${c.operator}`);
  if (new Set(keys).size !== keys.length) throw bad('conditions', 'The same condition is there twice.');
  const a = obj(r.action);
  const type = oneOf(a.type, Object.keys(RULE_ACTIONS), 'action.type', 'Action');
  const action = { type };
  if (type === 'CHANGE_BUDGET') {
    if (level !== 'ADSET') throw bad('level', 'Budget increases work on ad sets with their own daily budget. Pick “Ad sets”.');
    action.percent = intIn(a.percent, 1, 100, 'action.percent', 'Increase by (%)');
    if (a.cap === null || a.cap === undefined || a.cap === '') throw bad('action.cap', 'Set the highest daily budget the rule may reach.');
    action.cap = numberIn(a.cap, 0.01, 1e9, 'action.cap', 'Maximum daily budget');
    action.cap = noMinor(currency) ? Math.round(action.cap) : Math.round(action.cap * 100) / 100;
    if (minDailyMinor && toMinor(action.cap, currency) < minDailyMinor) {
      throw bad('action.cap', `The maximum daily budget must be at least ${fmtMoney(fromMinor(minDailyMinor, currency), currency)} (Meta’s minimum for this account).`);
    }
    action.everyHours = intIn(a.everyHours ?? 24, 1, 168, 'action.everyHours', 'At most once every (hours)');
    action.maxTimes = intIn(a.maxTimes ?? 5, 1, 50, 'action.maxTimes', 'At most (times per ad set)');
  }
  const s = obj(r.schedule);
  const sType = oneOf(s.type, Object.keys(SCHEDULES), 'schedule.type', 'Schedule');
  const schedule = { type: sType };
  if (sType === 'CUSTOM') {
    if (!Array.isArray(s.days) || !s.days.length) throw bad('schedule.days', 'Pick the days the rule runs on.');
    const days = [...new Set(s.days.map((d) => intIn(d, 0, 6, 'schedule.days', 'Day')))].sort((x, y) => x - y);
    const startMinute = intIn(s.startMinute, 0, 1410, 'schedule.startMinute', 'Start time (minutes after midnight)');
    if (startMinute % 30) throw bad('schedule.startMinute', 'Pick a start time on the hour or half hour.');
    schedule.days = days;
    schedule.startMinute = startMinute;
    if (s.endMinute !== undefined && s.endMinute !== null && s.endMinute !== '') {
      const endMinute = intIn(s.endMinute, 30, 1410, 'schedule.endMinute', 'End time (minutes after midnight)');
      if (endMinute % 30) throw bad('schedule.endMinute', 'Pick an end time on the hour or half hour.');
      if (endMinute <= startMinute) throw bad('schedule.endMinute', 'The end time must be after the start time.');
      schedule.endMinute = endMinute;
    }
  }
  return { name, level, scope: { type: scopeType, ids }, timePreset, conditions, action, schedule };
}

const valueToMeta = (metric, v, currency) => (RULE_METRICS[metric].kind === 'money' ? toMinor(v, currency) : v);

/** A validated rule spec → Meta's exact evaluation_spec / execution_spec / schedule_spec. */
export function buildRulePayload(spec, { currency }) {
  const filters = [{ field: 'entity_type', value: spec.level, operator: 'EQUAL' }];
  if (spec.scope.type === 'all_active') filters.push({ field: 'effective_status', value: ['ACTIVE'], operator: 'IN' });
  else if (spec.scope.type === 'campaigns') filters.push({ field: spec.level === 'CAMPAIGN' ? 'id' : 'campaign.id', value: spec.scope.ids, operator: 'IN' });
  else filters.push({ field: spec.level === 'ADSET' ? 'id' : 'adset.id', value: spec.scope.ids, operator: 'IN' });
  filters.push({ field: 'time_preset', value: spec.timePreset, operator: 'EQUAL' });
  for (const c of spec.conditions) filters.push({ field: c.metric, value: valueToMeta(c.metric, c.value, currency), operator: c.operator });
  const execution = { execution_type: spec.action.type };
  if (spec.action.type === 'CHANGE_BUDGET') {
    const capMinor = toMinor(spec.action.cap, currency);
    // Only ad sets with a daily budget of their own, still under the cap.
    filters.push({ field: 'budget_reset_period', value: ['DAY'], operator: 'IN' });
    filters.push({ field: 'daily_budget', value: capMinor, operator: 'LESS_THAN' });
    // "Cost per result is low" must not mean "no results at all".
    if (!spec.conditions.some((c) => c.metric === 'results')) filters.push({ field: 'results', value: 0, operator: 'GREATER_THAN' });
    execution.execution_options = [
      { field: 'change_spec', value: { amount: spec.action.percent, unit: 'PERCENTAGE', limit: capMinor }, operator: 'EQUAL' },
      { field: 'action_frequency', value: spec.action.everyHours * 60, operator: 'EQUAL' },
      { field: 'execution_count_limit', value: spec.action.maxTimes, operator: 'EQUAL' },
    ];
  }
  const schedule = { schedule_type: spec.schedule.type };
  if (spec.schedule.type === 'CUSTOM') {
    const entry = { start_minute: spec.schedule.startMinute, days: spec.schedule.days };
    if (spec.schedule.endMinute !== undefined) entry.end_minute = spec.schedule.endMinute;
    schedule.schedule = [entry];
  }
  return {
    name: spec.name,
    evaluation_spec: { evaluation_type: 'SCHEDULE', filters },
    execution_spec: execution,
    schedule_spec: schedule,
  };
}

const clock = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
function scheduleText(s) {
  if (s.type !== 'CUSTOM') return SCHEDULES[s.type];
  const days = s.days.length === 7 ? 'Every day' : s.days.map((d) => DAY_NAMES[d]).join(', ');
  return s.endMinute !== undefined ? `${days}, every 30 minutes from ${clock(s.startMinute)} to ${clock(s.endMinute)}` : `${days} at ${clock(s.startMinute)}`;
}
function conditionText(c, currency) {
  const m = RULE_METRICS[c.metric];
  const v = m.kind === 'money' ? fmtMoney(c.value, currency) : m.kind === 'pct' ? `${c.value}%` : String(c.value);
  return `${m.label.replace(/ \(.*\)$/, '').toLowerCase()} ${RULE_OPERATORS[c.operator]} ${v}`;
}

/** Plain-language summary: what the rule checks, and exactly what it does (the confirm dialog shows this). */
export function ruleSummary(spec, { currency, names = {}, reach = null } = {}) {
  const plural = { CAMPAIGN: 'campaigns', ADSET: 'ad sets', AD: 'ads' }[spec.level];
  const one = RULE_LEVELS[spec.level];
  const scope = spec.scope.type === 'all_active'
    ? `all active ${plural}`
    : spec.scope.type === 'campaigns'
      ? `${spec.level === 'CAMPAIGN' ? '' : `${plural} in `}${spec.scope.ids.length === 1 ? `the campaign ${names[spec.scope.ids[0]] ? `“${names[spec.scope.ids[0]]}”` : spec.scope.ids[0]}` : `${spec.scope.ids.length} campaigns`}`.trim()
      : `${spec.level === 'ADSET' ? '' : `${plural} in `}${spec.scope.ids.length === 1 ? `the ad set ${names[spec.scope.ids[0]] ? `“${names[spec.scope.ids[0]]}”` : spec.scope.ids[0]}` : `${spec.scope.ids.length} ad sets`}`.trim();
  const when = spec.conditions.map((c) => conditionText(c, currency)).join(' and ');
  let does;
  let cap = null;
  let capText = null;
  let adSetCount = null;
  let worstCase = null;
  if (spec.action.type === 'PAUSE') does = `pause the ${one}`;
  else if (spec.action.type === 'NOTIFICATION') does = 'send you a Facebook notification (nothing is changed)';
  else {
    cap = fmtMoney(spec.action.cap, currency);
    does = `raise its daily budget by ${spec.action.percent}%, never above ${cap} a day per ad set, at most once every ${spec.action.everyHours} hour${spec.action.everyHours === 1 ? '' : 's'} and ${spec.action.maxTimes} time${spec.action.maxTimes === 1 ? '' : 's'} in total per ad set (only ad sets with a daily budget and at least one result)`;
    // The cap is per ad set: with N ad sets the rule can reach N × cap a day.
    const total = (n) => fmtMoney(Math.round(n * spec.action.cap * 100) / 100, currency);
    const ads = (n) => `${n} ad set${n === 1 ? '' : 's'}`;
    if (spec.scope.type === 'adsets') {
      adSetCount = spec.scope.ids.length;
      worstCase = total(adSetCount);
      capText = `Budget cap: never above ${cap} a day per ad set. ${ads(adSetCount)}, so at most ${worstCase} a day in total.`;
    } else {
      const which = spec.scope.type === 'all_active'
        ? 'each active ad set with its own daily budget'
        : `each ad set with its own daily budget in ${spec.scope.ids.length === 1 ? 'that campaign' : `those ${spec.scope.ids.length} campaigns`}`;
      if (reach && Number.isInteger(reach.count)) {
        adSetCount = reach.count;
        worstCase = total(reach.count);
      }
      capText = `Budget cap: never above ${cap} a day per ad set, for ${which}${adSetCount !== null
        ? ` (${reach.atLeast ? 'at least ' : ''}${ads(adSetCount)} right now, so up to ${reach.atLeast ? 'at least ' : ''}${worstCase} a day in total)`
        : ''}.`;
    }
  }
  const range = TIME_PRESETS[spec.timePreset].replace(/ \(incl\. today\)$/, '').toLowerCase();
  return {
    text: `${scheduleText(spec.schedule)}, Meta checks ${scope}. If ${when} (${range}), it will ${does}.`,
    schedule: scheduleText(spec.schedule),
    scope,
    conditions: spec.conditions.map((c) => conditionText(c, currency)),
    action: does,
    actionType: spec.action.type,
    cap,
    capPerAdSet: cap !== null,
    capText,
    adSetCount,
    worstCase,
    changesDelivery: spec.action.type !== 'NOTIFICATION',
  };
}

/**
 * Budget rules on all active ad sets or on campaigns: how many ad sets with
 * a daily budget of their own the rule can reach now (one cached read; null
 * when it fails). Specific ad-set scopes count their ids instead.
 */
const REACH_LIMIT = 500;
const REACH_PAGES = 2;
async function budgetReach(row, spec, { refresh = false } = {}) {
  if (!spec || spec.action.type !== 'CHANGE_BUDGET' || spec.scope.type === 'adsets') return null;
  const filtering = spec.scope.type === 'all_active'
    ? [{ field: 'effective_status', operator: 'IN', value: ['ACTIVE'] }]
    : [{ field: 'campaign.id', operator: 'IN', value: spec.scope.ids }];
  try {
    const list = await graphList(row, `${row.adAccountId}/adsets`, { fields: 'id,daily_budget', filtering: JSON.stringify(filtering), limit: REACH_LIMIT }, { refresh, maxPages: REACH_PAGES });
    return { count: list.filter((s) => num(s.daily_budget) > 0).length, atLeast: list.length >= REACH_LIMIT * REACH_PAGES };
  } catch (e) {
    if (e?.code === 'ADS_REVOKED') throw e;
    return null;
  }
}

const TEMPLATE_KEYS = Object.keys(RULE_TEMPLATES);
/** Which template a rule matches (for the list and the builder). */
export function templateOf(spec) {
  const has = (m, op) => spec.conditions.some((c) => c.metric === m && c.operator === op);
  if (spec.action.type === 'CHANGE_BUDGET') return 'increase_budget_low_cpr';
  if (spec.action.type === 'NOTIFICATION') return 'notify_only';
  if (has('spent', 'GREATER_THAN') && spec.conditions.some((c) => c.metric === 'results' && c.operator === 'EQUAL' && c.value === 0)) return 'pause_spend_no_results';
  if (has('cost_per', 'GREATER_THAN')) return 'pause_high_cpr';
  return 'custom';
}

/**
 * A rule read from Meta → the builder's spec, when it has the shape the CRM
 * builds (else null: the rule was made elsewhere and can only be turned on /
 * off or deleted here).
 */
export function specFromMeta(rule, { currency }) {
  try {
    const ev = obj(rule.evaluation_spec);
    const ex = obj(rule.execution_spec);
    const sc = obj(rule.schedule_spec);
    if (ev.evaluation_type !== 'SCHEDULE' || ev.trigger) return null;
    const filters = Array.isArray(ev.filters) ? ev.filters : [];
    const take = (field) => filters.find((f) => f.field === field);
    const level = take('entity_type')?.value;
    if (!RULE_LEVELS[level]) return null;
    const actionType = ex.execution_type;
    if (!RULE_ACTIONS[actionType]) return null;
    let scope = { type: 'all_active', ids: [] };
    const idF = take('id') || take('campaign.id') || take('adset.id');
    if (idF) {
      const field = idF.field;
      const campaignish = field === 'campaign.id' || (field === 'id' && level === 'CAMPAIGN');
      scope = { type: campaignish ? 'campaigns' : 'adsets', ids: (Array.isArray(idF.value) ? idF.value : [idF.value]).map(String) };
    }
    const timePreset = take('time_preset')?.value || '';
    const known = new Set(['entity_type', 'effective_status', 'id', 'campaign.id', 'adset.id', 'time_preset']);
    const opts = Array.isArray(ex.execution_options) ? ex.execution_options : [];
    const opt = (f) => opts.find((o) => o.field === f)?.value;
    let action = { type: actionType };
    if (actionType === 'CHANGE_BUDGET') {
      const cs = obj(opt('change_spec'));
      if (cs.unit !== 'PERCENTAGE' || !Number.isFinite(Number(cs.limit))) return null;
      action = {
        type: actionType, percent: num(cs.amount), cap: fromMinor(cs.limit, currency),
        everyHours: Math.round(num(opt('action_frequency') || 1440) / 60), maxTimes: num(opt('execution_count_limit') || 0),
      };
      known.add('budget_reset_period');
      known.add('daily_budget');
    }
    const conditions = [];
    for (const f of filters) {
      if (known.has(f.field)) continue;
      // The safety filter the CRM adds to budget rules isn't a user condition.
      if (actionType === 'CHANGE_BUDGET' && f.field === 'results' && f.operator === 'GREATER_THAN' && num(f.value) === 0) continue;
      if (!RULE_METRICS[f.field] || !RULE_OPERATORS[f.operator] || Array.isArray(f.value)) return null;
      const kind = RULE_METRICS[f.field].kind;
      conditions.push({ metric: f.field, operator: f.operator, value: kind === 'money' ? fromMinor(f.value, currency) : num(f.value) });
    }
    const schedule = { type: sc.schedule_type || '' };
    if (schedule.type === 'CUSTOM') {
      const e = obj((sc.schedule || [])[0]);
      schedule.days = Array.isArray(e.days) ? e.days.map(Number) : [0, 1, 2, 3, 4, 5, 6];
      schedule.startMinute = num(e.start_minute);
      if (e.end_minute !== undefined) schedule.endMinute = num(e.end_minute);
    }
    const spec = validateRuleSpec({ name: rule.name || 'Rule', level, scope, timePreset, conditions, action, schedule }, { currency });
    // Only "editable" when rebuilding gives Meta's rule back exactly.
    const again = buildRulePayload(spec, { currency });
    const same = JSON.stringify(normFilters(again.evaluation_spec.filters)) === JSON.stringify(normFilters(filters));
    return same ? spec : null;
  } catch {
    return null;
  }
}
const normFilters = (fs) => fs.map((f) => ({ field: f.field, operator: f.operator, value: Array.isArray(f.value) ? f.value.map(String) : String(f.value) }))
  .sort((a, b) => `${a.field}|${a.operator}`.localeCompare(`${b.field}|${b.operator}`));

const RULE_FIELDS = 'id,name,status,account_id,evaluation_spec,execution_spec,schedule_spec,created_time,updated_time,disable_error_code';

/** Outside rules the CRM may turn on: they can only pause or notify (UNPAUSE, budget, bid and other actions stay off). */
const OUTSIDE_ENABLE = new Set(['PAUSE', 'NOTIFICATION']);
const outsideType = (rule) => String(obj(rule.execution_spec).execution_type || 'UNKNOWN');

/** The summary of a rule made outside the CRM: Meta's raw action type, and what the CRM lets you do with it. */
export function outsideSummary(rule) {
  const t = outsideType(rule);
  const canEnable = OUTSIDE_ENABLE.has(t);
  return {
    text: `Made outside the CRM (Ads Manager or another tool). Its action at Meta: ${t}. ${canEnable
      ? 'You can turn it on or off, or delete it, here; edit it in Ads Manager.'
      : 'The CRM only turns on outside rules that pause or notify, so you can turn this one off or delete it here; turn it on in Ads Manager.'}`,
    action: `Action at Meta: ${t}`,
    actionType: t,
    outside: true,
    cap: null,
    changesDelivery: t !== 'NOTIFICATION',
  };
}

function presentRule(rule, { currency, reach = null }) {
  const spec = specFromMeta(rule, { currency });
  return {
    id: String(rule.id),
    name: rule.name || '',
    status: rule.status || '',
    enabled: rule.status === 'ENABLED',
    hasIssues: rule.status === 'HAS_ISSUES',
    disableErrorCode: rule.disable_error_code ?? null,
    createdTime: rule.created_time || null,
    updatedTime: rule.updated_time || null,
    editable: !!spec,
    /** False only for outside rules whose action isn't PAUSE or NOTIFICATION (409 NOT_EDITABLE on ENABLED). */
    canEnable: !!spec || OUTSIDE_ENABLE.has(outsideType(rule)),
    template: spec ? templateOf(spec) : 'custom',
    spec,
    summary: spec ? ruleSummary(spec, { currency, reach }) : outsideSummary(rule),
    summaryHash: spec ? summaryHashOf(spec, currency) : outsideHashOf(rule, currency),
  };
}

/** A rule id from the browser, read fresh; it must belong to the connected ad account. */
async function ownRule(row, id) {
  if (!isId(id)) throw new AdsError('Unknown rule.', { status: 400, code: 'BAD_ID' });
  let r;
  try {
    r = await gGet(row, String(id), { fields: RULE_FIELDS });
  } catch (e) {
    if (isMissing(e)) throw notInAccount('That rule');
    throw e;
  }
  if (actNumber(r?.account_id) !== actNumber(row.adAccountId) || r?.status === 'DELETED') throw notInAccount('That rule');
  return r;
}

async function ruleContext(row) {
  const acct = await accountInfo(row);
  return { currency: acct.currency, minDailyMinor: acct.minDailyBudgetMinor, timezone: acct.timezone, acct };
}

/** Scope ids: campaigns / ad sets of this ad account, of the right level. Returns id → name. */
async function assertRuleScope(row, spec) {
  if (spec.scope.type === 'all_active') return {};
  const list = await assertObjects(row, spec.scope.type === 'campaigns' ? 'campaign' : 'adset', spec.scope.ids, { field: 'scope.ids' });
  return Object.fromEntries(list.map((o) => [String(o.id), o.name || '']));
}

// --------------------------------------------- history → notifications --

const ACTION_LABEL = {
  PAUSED: 'Paused', UNPAUSED: 'Turned on', CHANGED_BUDGET: 'Budget changed', CHANGED_BID: 'Bid changed', FACEBOOK_NOTIFICATION_SENT: 'Notification sent',
  EMAIL: 'Email sent', ENDPOINT_PINGED: 'Webhook pinged', MESSAGE_SENT: 'Message sent', NOT_CHANGED: 'No change', ERROR: 'Error',
  BUDGET_NOT_REDISTRIBUTED: 'Budget not redistributed',
};
const DID_SOMETHING = new Set(['PAUSED', 'UNPAUSED', 'CHANGED_BUDGET', 'CHANGED_BID', 'FACEBOOK_NOTIFICATION_SENT', 'EMAIL', 'MESSAGE_SENT']);
const tsMs = (t) => {
  if (t === undefined || t === null || t === '') return NaN;
  if (/^\d+$/.test(String(t))) return Number(t) * (String(t).length <= 10 ? 1000 : 1);
  return Date.parse(String(t).replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
};
const moneyish = (field) => /budget|bid/i.test(String(field || ''));

function presentHistory(entries, { currency, names = {} }) {
  return entries.map((h) => {
    const at = tsMs(h.timestamp);
    const results = (Array.isArray(h.results) ? h.results : []).map((r) => ({
      objectId: String(r.object_id ?? ''),
      objectType: String(r.object_type || ''),
      objectName: names[String(r.object_id ?? '')] || '',
      actions: (Array.isArray(r.actions) ? r.actions : []).map((a) => {
        const money = moneyish(a.field) && a.old_value !== undefined && /^\d+(\.\d+)?$/.test(String(a.old_value));
        return {
          action: String(a.action || ''),
          label: ACTION_LABEL[a.action] || String(a.action || '').replace(/_/g, ' ').toLowerCase(),
          field: String(a.field || ''),
          oldValue: money ? fromMinor(a.old_value, currency) : (a.old_value ?? null),
          newValue: money ? fromMinor(a.new_value, currency) : (a.new_value ?? null),
          money,
          error: a.error_message || '',
        };
      }),
    }));
    return {
      at: Number.isFinite(at) ? new Date(at).toISOString() : null,
      manual: !!h.is_manual,
      error: h.exception_message || (h.exception_code ? `Error ${h.exception_code}` : ''),
      results,
      changed: results.reduce((n, r) => n + (r.actions.some((a) => DID_SOMETHING.has(a.action)) ? 1 : 0), 0),
    };
  });
}

async function readHistory(row, ruleId, { limit = 50 } = {}) {
  return gList(row, `${ruleId}/history`, { fields: 'timestamp,results,is_manual,exception_code,exception_message', hide_no_changes: 'true', limit }, 1);
}

async function namesFor(row, ids) {
  const list = [...new Set(ids.filter(isId))].slice(0, 50);
  if (!list.length) return {};
  try {
    const data = await gGet(row, '', { ids: list.join(','), fields: 'name,account_id' });
    const out = {};
    for (const [id, o] of Object.entries(obj(data))) if (actNumber(o?.account_id) === actNumber(row.adAccountId)) out[id] = o?.name || '';
    return out;
  } catch {
    return {};
  }
}

/** A forced mirror (the Reload button) still waits this long after the last one for the business. */
const MIRROR_FORCED_MIN_MS = 60 * 1000;
const mirrorAt = new Map(); // businessId -> last check (ms)
const mirroring = new Set();
const LEVEL_WORD = { CAMPAIGN: ['campaign', 'campaigns'], ADSET: ['ad set', 'ad sets'], AD: ['ad', 'ads'], ADGROUP: ['ad', 'ads'] };
function triggeredText(rule, entry) {
  const counts = {};
  for (const r of entry.results) {
    for (const a of r.actions) {
      if (!DID_SOMETHING.has(a.action)) continue;
      const k = `${a.action}|${r.objectType}`;
      counts[k] = (counts[k] || 0) + 1;
    }
  }
  const parts = Object.entries(counts).map(([k, n]) => {
    const [action, type] = k.split('|');
    const [one, many] = LEVEL_WORD[type] || ['item', 'items'];
    const verb = { PAUSED: 'paused', UNPAUSED: 'turned on', CHANGED_BUDGET: 'raised the budget of', CHANGED_BID: 'changed the bid of', FACEBOOK_NOTIFICATION_SENT: 'sent a notification for', EMAIL: 'emailed about', MESSAGE_SENT: 'sent a message about' }[action] || 'acted on';
    return `${verb} ${n} ${n === 1 ? one : many}`;
  });
  return parts.join(', ');
}

/**
 * Mirror rule executions into CRM notifications (ad_rule_triggered), once per
 * rule run (groupKey ad_rule:<rule>:<timestamp>), for runs in the last 3 days.
 * Throttled per business; never throws.
 */
export async function mirrorRuleHistory(row, rules, { force = false, now = Date.now() } = {}) {
  const key = String(row.businessId);
  if (mirroring.has(key)) return { checked: 0, notified: 0, skipped: 'running' };
  const since = now - (mirrorAt.get(key) || 0);
  if (since < (force ? Math.min(MIRROR_FORCED_MIN_MS, mirrorEveryMs()) : mirrorEveryMs())) return { checked: 0, notified: 0, skipped: 'recent' };
  mirroring.add(key);
  mirrorAt.set(key, now);
  let checked = 0;
  let notified = 0;
  try {
    const live = rules.filter((r) => r.status === 'ENABLED' || r.status === 'HAS_ISSUES').slice(0, 10);
    for (const rule of live) {
      if (notified >= 5) break;
      let entries;
      try {
        // eslint-disable-next-line no-await-in-loop
        entries = presentHistory(await readHistory(row, rule.id, { limit: 10 }), { currency: row.adAccountCurrency });
      } catch (e) {
        if (e?.code === 'RATE_LIMITED' || e?.code === 'ADS_REVOKED') break;
        continue;
      }
      checked += 1;
      for (const entry of entries) {
        if (notified >= 5) break;
        const at = Date.parse(entry.at || '');
        if (!Number.isFinite(at) || now - at > 3 * DAY_MS || !entry.changed) continue;
        const groupKey = `ad_rule:${rule.id}:${at}`;
        // eslint-disable-next-line no-await-in-loop
        const already = await Notification.findOne({ businessId: key, groupKey }).select('_id').lean();
        if (already) continue;
        const did = triggeredText(rule, entry);
        // eslint-disable-next-line no-await-in-loop
        const n = await notify(row.businessId, {
          type: 'ad_rule_triggered',
          title: `Rule ran: ${rule.name || rule.id}`,
          body: `Meta’s automated rule ${did || 'ran'}${entry.manual ? ' (run by hand)' : ''}. Open Ads → Automation to see the history.`,
          target: { view: 'ads', id: `rule:${rule.id}` },
          groupKey,
        });
        if (n) notified += 1;
      }
    }
  } catch (e) {
    logger.warn('ad rule history mirror failed', { error: e.message });
  } finally {
    mirroring.delete(key);
  }
  return { checked, notified };
}
/** Tests only: forget the per-business throttle, or (olderBy ms) make the last check that much older. */
export function resetMirror({ olderBy } = {}) {
  if (olderBy === undefined) mirrorAt.clear();
  else for (const [k, t] of mirrorAt) mirrorAt.set(k, t - olderBy);
}

// ------------------------------------------------------------ endpoints --

/** GET /meta/automation/rules → { canManage, account, rules, templates, options, mirror } */
export async function listRules(businessId, q = {}) {
  const row = await requireAdsRow(businessId);
  const refresh = String(q.refresh || '') === '1';
  const fresh = await refreshPermissions(row);
  const ctx = await ruleContext(row);
  const raw = await graphList(row, `${row.adAccountId}/adrules_library`, { fields: RULE_FIELDS, limit: 100 }, { refresh, maxPages: 2 });
  const kept = raw.filter((r) => r.status !== 'DELETED' && (!r.account_id || actNumber(r.account_id) === actNumber(row.adAccountId)));
  // Budget rules show how many ad sets the per-ad-set cap applies to (one
  // cached read per distinct scope, at most 5).
  const reachBy = new Map();
  for (const r of kept) {
    const spec = specFromMeta(r, ctx);
    if (spec?.action.type !== 'CHANGE_BUDGET' || spec.scope.type === 'adsets') continue;
    const k = stable(spec.scope);
    if (reachBy.has(k) || reachBy.size >= 5) continue;
    // eslint-disable-next-line no-await-in-loop
    reachBy.set(k, await budgetReach(row, spec, { refresh }));
  }
  const rules = kept
    .map((r) => {
      const spec = specFromMeta(r, ctx);
      return presentRule(r, { ...ctx, reach: spec ? reachBy.get(stable(spec.scope)) ?? null : null });
    })
    .sort((a, b) => String(b.updatedTime || b.createdTime || '').localeCompare(String(a.updatedTime || a.createdTime || '')));
  // ?refresh=1 re-reads Meta; it forces the history mirror only when asked
  // for (the Reload button), not after a write (?mirror=0), and even forced
  // runs keep a 60 s minimum interval per business.
  const forceMirror = refresh && String(q.mirror ?? '') !== '0';
  const mirror = await mirrorRuleHistory({ ...row, adAccountCurrency: ctx.currency }, rules, { force: forceMirror });
  return {
    canManage: !!fresh.canManageAds,
    account: { currency: ctx.currency, timezone: ctx.timezone, minDailyBudget: ctx.acct.minDailyBudget },
    rules,
    templates: Object.fromEntries(TEMPLATE_KEYS.map((k) => [k, { label: RULE_TEMPLATES[k].label, spec: RULE_TEMPLATES[k].spec }])),
    options: {
      levels: RULE_LEVELS, timePresets: TIME_PRESETS, metrics: RULE_METRICS, operators: RULE_OPERATORS, actions: RULE_ACTIONS, schedules: SCHEDULES,
    },
    mirror,
  };
}

/** POST /meta/automation/rules/preview { spec } → the summary and Meta's payload (nothing is written). */
export async function previewRule(businessId, { spec: raw } = {}) {
  const row = await requireAdsRow(businessId);
  const ctx = await ruleContext(row);
  const spec = validateRuleSpec(raw, ctx);
  const names = await assertRuleScope(row, spec);
  const reach = await budgetReach(row, spec);
  const payload = buildRulePayload(spec, ctx);
  return { spec, template: templateOf(spec), summary: ruleSummary(spec, { ...ctx, names, reach }), summaryHash: summaryHashOf(spec, ctx.currency), payload };
}

/** A submitted spec, validated and scope-checked, with the summary and hash of exactly that spec. */
async function summarised(row, raw, ctx) {
  const spec = validateRuleSpec(raw, ctx);
  const names = await assertRuleScope(row, spec);
  const reach = await budgetReach(row, spec);
  return { spec, summary: ruleSummary(spec, { ...ctx, names, reach }), summaryHash: summaryHashOf(spec, ctx.currency) };
}

/**
 * POST /meta/automation/rules { spec, enabled?, confirm?, summaryHash? } → { rule, summary, summaryHash }
 * (DISABLED unless enabled + confirm; confirm: true needs the summaryHash of this spec, else 409 SUMMARY_STALE).
 */
export async function createRule(business, { spec: raw, enabled = false, confirm, summaryHash } = {}) {
  const row = await requireWriter(business._id);
  const ctx = await ruleContext(row);
  const { spec, summary, summaryHash: hash } = await summarised(row, raw, ctx);
  const on = enabled === true;
  if (on && confirm !== true) throw new ConfirmError('Turning a rule on lets Meta act on your ads. Confirm it in the CRM first.', summary, hash);
  if (confirm === true) assertSummaryHash(summaryHash, summary, hash);
  const payload = buildRulePayload(spec, ctx);
  const res = await gPostForm(row, `${row.adAccountId}/adrules_library`, { ...payload, status: on ? 'ENABLED' : 'DISABLED' });
  afterWrite(business._id);
  if (!isId(res?.id)) throw new AdsError('Meta didn’t return the new rule.', { status: 502, code: 'META_ERROR' });
  logger.info('ad rule created from the CRM', { business: business.name, ruleId: String(res.id), template: templateOf(spec), action: spec.action.type, enabled: on });
  return { rule: presentRule({ ...payload, id: res.id, status: on ? 'ENABLED' : 'DISABLED', account_id: actNumber(row.adAccountId) }, ctx), summary, summaryHash: hash };
}

/**
 * PUT /meta/automation/rules/:id { spec, confirm?, summaryHash? } → { rule, summary, summaryHash }.
 * The status is kept; a rule that isn't DISABLED needs confirm, and confirm: true needs this spec's summaryHash.
 */
export async function updateRule(business, ruleId, { spec: raw, confirm, summaryHash } = {}) {
  const row = await requireWriter(business._id);
  const current = await ownRule(row, ruleId);
  const ctx = await ruleContext(row);
  if (!specFromMeta(current, ctx)) throw new AdsError('This rule was made outside the CRM. Edit it in Ads Manager (you can still turn it off, or delete it, here).', { status: 409, code: 'NOT_EDITABLE' });
  const { spec, summary, summaryHash: hash } = await summarised(row, raw, ctx);
  // ENABLED and HAS_ISSUES rules both still run at Meta: any rule that isn't off needs confirm.
  if (current.status !== 'DISABLED' && confirm !== true) throw new ConfirmError('This rule is on, so the change takes effect at Meta straight away. Confirm it in the CRM first.', summary, hash);
  if (confirm === true) assertSummaryHash(summaryHash, summary, hash);
  const payload = buildRulePayload(spec, ctx);
  // Meta: an update sends every spec, including the unchanged ones; no status.
  await gPostForm(row, String(ruleId), payload);
  afterWrite(business._id);
  logger.info('ad rule edited from the CRM', { business: business.name, ruleId: String(ruleId), action: spec.action.type });
  return { rule: presentRule({ ...current, ...payload }, ctx), summary, summaryHash: hash };
}

/**
 * POST /meta/automation/rules/:id/status { status: ENABLED|DISABLED, confirm?, summaryHash? }
 *   • ENABLED needs confirm: true and the summaryHash of the rule as Meta has it now (409 SUMMARY_STALE
 *     with the fresh summary otherwise). A rule made outside the CRM can be turned on only when its
 *     action is PAUSE or NOTIFICATION (409 NOT_EDITABLE).
 *   • DISABLED (a brake) needs no confirm and skips the Graph version check.
 */
export async function setRuleStatus(business, ruleId, { status, confirm, summaryHash } = {}) {
  const want = oneOf(status, ['ENABLED', 'DISABLED'], 'status', 'Status');
  const row = await requireWriter(business._id, { brake: want === 'DISABLED' });
  const current = await ownRule(row, ruleId);
  const ctx = await ruleContext(row);
  let rule = presentRule(current, ctx);
  if (want === 'ENABLED') {
    if (!rule.canEnable) {
      throw new AdsError(`This rule was made outside the CRM and its action at Meta is ${rule.summary.actionType}. The CRM only turns on outside rules that pause or notify. Turn it on in Ads Manager if you mean to.`, { status: 409, code: 'NOT_EDITABLE' });
    }
    if (rule.spec) rule = presentRule(current, { ...ctx, reach: await budgetReach(row, rule.spec) });
    if (confirm !== true) throw new ConfirmError('Turning a rule on lets Meta act on your ads. Confirm it in the CRM first.', rule.summary, rule.summaryHash);
    assertSummaryHash(summaryHash, rule.summary, rule.summaryHash);
  }
  if (current.status === want) return { rule, unchanged: true };
  await gPostForm(row, String(ruleId), { status: want });
  afterWrite(business._id);
  logger.info('ad rule status changed from the CRM', { business: business.name, ruleId: String(ruleId), status: want });
  return { rule: presentRule({ ...current, status: want }, ctx) };
}

/** POST /meta/automation/rules/:id/delete { confirm: true } */
export async function deleteRule(business, ruleId, { confirm } = {}) {
  if (confirm !== true) throw new AdsError('Deleting a rule can’t be undone. Confirm it in the CRM first.', { status: 400, code: 'CONFIRM_REQUIRED' });
  const row = await requireWriter(business._id);
  await ownRule(row, ruleId);
  await gDelete(row, String(ruleId));
  afterWrite(business._id);
  logger.info('ad rule deleted from the CRM', { business: business.name, ruleId: String(ruleId) });
  return { id: String(ruleId), deleted: true };
}

/** GET /meta/automation/rules/:id/history → { rule, entries } (runs that changed something, newest first). */
export async function ruleHistory(businessId, ruleId) {
  const row = await requireAdsRow(businessId);
  const current = await ownRule(row, ruleId);
  const ctx = await ruleContext(row);
  const raw = await readHistory(row, ruleId);
  const objectIds = raw.flatMap((h) => (Array.isArray(h.results) ? h.results : []).map((r) => String(r.object_id ?? '')));
  const names = await namesFor(row, objectIds);
  const entries = presentHistory(raw, { currency: ctx.currency, names })
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  return { rule: { id: String(current.id), name: current.name || '', status: current.status || '' }, currency: ctx.currency, entries };
}

// ================================================================ A/B tests ==

export const TEST_VARIABLES = { creative: 'Creative', audience: 'Audience', placement: 'Placement' };
export const TEST_METRICS = {
  cost_per_result: { label: 'Cost per result', better: 'down', basis: 'results' },
  results: { label: 'Results', better: 'up', basis: 'results' },
  ctr: { label: 'CTR (all)', better: 'up', basis: 'clicks' },
  cpc: { label: 'CPC (all)', better: 'down', basis: 'clicks' },
};
export const CONFIDENCE_LEVELS = [80, 90, 95];
const TEST_DAYS_MIN = 1;
const TEST_DAYS_MAX = 30;

/** Equal split that sums to exactly 100 (34/33/33 for three cells). */
export function splitPercentages(n) {
  const base = Math.floor(100 / n);
  return Array.from({ length: n }, (_, i) => base + (i < 100 - base * n ? 1 : 0));
}

const LETTERS = 'ABCDE';
const describeTest = (t) => `Variable: ${TEST_VARIABLES[t.variable]}. Metric: ${TEST_METRICS[t.metric].label}. Confidence: ${t.confidence}%.${t.description ? ` ${t.description}` : ''}`;
const DESC_HEAD = /^Variable: ([^.]+)\. Metric: ([^.]+)\. Confidence: (\d+)%\.\s*/;
/** The CRM writes the variable, metric and confidence into the study description; read them back. */
function parseDescription(d) {
  const s = String(d || '');
  const m = DESC_HEAD.exec(s);
  if (!m) return { variable: '', metric: '', confidence: null, note: s };
  return {
    variable: Object.keys(TEST_VARIABLES).find((k) => TEST_VARIABLES[k] === m[1]) || '',
    metric: Object.keys(TEST_METRICS).find((k) => TEST_METRICS[k].label === m[2]) || '',
    confidence: Number(m[3]),
    note: s.replace(DESC_HEAD, ''),
  };
}

/** The browser's test → validated fields (times as UTC ms). */
export function validateTest(raw, { timezone, now = Date.now() } = {}) {
  const r = obj(raw);
  const name = text(r.name, NAME_MAX, 'name', 'Test name', { required: true });
  const description = text(r.description, 300, 'description', 'Description');
  const level = oneOf(r.level, ['adset', 'campaign'], 'level', 'Compare');
  const ids = idList(r.ids, { min: 2, max: 5, field: 'ids', label: level === 'campaign' ? 'campaigns' : 'ad sets' });
  const variable = oneOf(r.variable, Object.keys(TEST_VARIABLES), 'variable', 'Variable');
  const metric = oneOf(r.metric, Object.keys(TEST_METRICS), 'metric', 'Metric');
  const confidence = Number(r.confidence);
  if (!CONFIDENCE_LEVELS.includes(confidence)) throw bad('confidence', 'Pick 80%, 90% or 95%.');
  const start = zonedToUtc(r.start, timezone);
  if (Number.isNaN(start)) throw bad('start', 'Pick a valid start date and time.');
  if (start < now + 5 * 60 * 1000) throw bad('start', 'The start must be at least 5 minutes from now.');
  const end = zonedToUtc(r.end, timezone);
  if (Number.isNaN(end)) throw bad('end', 'Pick a valid end date and time.');
  const days = (end - start) / DAY_MS;
  if (days < TEST_DAYS_MIN) throw bad('end', `A test runs for at least ${TEST_DAYS_MIN} day.`);
  if (days > TEST_DAYS_MAX) throw bad('end', `A test can run for at most ${TEST_DAYS_MAX} days.`);
  return { name, description, level, ids, variable, metric, confidence, start, end, days: Math.round(days * 10) / 10 };
}

/** Validated test → the exact POST /{business}/ad_studies fields. */
export function buildStudyPayload(t, names = {}) {
  const pct = splitPercentages(t.ids.length);
  return {
    name: t.name,
    description: describeTest(t).slice(0, DESC_MAX),
    type: 'SPLIT_TEST',
    start_time: Math.floor(t.start / 1000),
    end_time: Math.floor(t.end / 1000),
    confidence_level: t.confidence,
    cells: t.ids.map((id, i) => ({
      name: `${LETTERS[i]}: ${names[id] || id}`.slice(0, 100),
      treatment_percentage: pct[i],
      [t.level === 'campaign' ? 'campaigns' : 'adsets']: [id],
    })),
  };
}

function statusOfStudy(s, now = Date.now()) {
  if (s.canceled_time) return 'CANCELED';
  const start = tsMs(s.start_time);
  const end = tsMs(s.end_time);
  if (Number.isFinite(start) && now < start) return 'SCHEDULED';
  if (Number.isFinite(end) && now < end) return 'RUNNING';
  return 'COMPLETED';
}

function presentStudy(s, { timezone }) {
  const meta = parseDescription(s.description);
  const start = tsMs(s.start_time);
  const end = tsMs(s.end_time);
  return {
    id: String(s.id),
    name: s.name || '',
    type: s.type || '',
    status: statusOfStudy(s),
    variable: meta.variable,
    metric: meta.metric,
    confidence: meta.confidence ?? (Number.isFinite(Number(s.confidence_level)) ? Number(s.confidence_level) : null),
    description: meta.note,
    start: Number.isFinite(start) ? utcToLocal(start, timezone) : '',
    end: Number.isFinite(end) ? utcToLocal(end, timezone) : '',
    cells: (s.cells?.data || []).map((c) => ({ id: String(c.id || ''), name: c.name || '', percent: num(c.treatment_percentage) })),
  };
}

const STUDY_FIELDS = 'id,name,description,type,start_time,end_time,confidence_level,canceled_time,created_time,cells{id,name,treatment_percentage}';

async function accountStudies(row, refresh) {
  const list = await graphList(row, `${row.adAccountId}/impacting_ad_studies`, { fields: STUDY_FIELDS, limit: 50 }, { refresh, maxPages: 2 });
  return list.filter((s) => isId(s.id) && (!s.type || s.type === 'SPLIT_TEST'));
}

async function businessOf(row) {
  try {
    const a = await graphGet(row, row.adAccountId, { fields: 'business{id,name}' });
    return isId(a?.business?.id) ? { id: String(a.business.id), name: a.business.name || '' } : null;
  } catch (e) {
    if (soft(e)) return null;
    throw e;
  }
}

/** GET /meta/automation/tests → { canManage, business, tests, metaAvailable, note, options } */
export async function listTests(businessId, q = {}) {
  const row = await requireAdsRow(businessId);
  const refresh = String(q.refresh || '') === '1';
  const fresh = await refreshPermissions(row);
  const acct = await accountInfo(row);
  const business = await businessOf(row);
  let tests = [];
  let note = '';
  let metaAvailable = true;
  try {
    tests = (await accountStudies(row, refresh)).map((s) => presentStudy(s, acct));
  } catch (e) {
    if (!soft(e)) throw e;
    metaAvailable = false;
    note = 'Meta didn’t let the CRM read this ad account’s A/B tests. You can still compare campaigns or ad sets in the CRM below.';
  }
  if (!business) note = note || 'This ad account isn’t owned by a Meta Business portfolio, so Meta A/B tests can’t be created through the API. Use the CRM comparison instead.';
  return {
    canManage: !!fresh.canManageAds,
    business,
    metaAvailable: metaAvailable && !!business,
    note,
    tests,
    timezone: acct.timezone,
    options: { variables: TEST_VARIABLES, metrics: Object.fromEntries(Object.entries(TEST_METRICS).map(([k, v]) => [k, v.label])), confidence: CONFIDENCE_LEVELS, minDays: TEST_DAYS_MIN, maxDays: TEST_DAYS_MAX },
  };
}

const parseJsonish = (v) => {
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
};
/** Meta's objective results → { available, winnerId, confidence, byObject }. */
export function winnerOf(objectives = []) {
  const primary = objectives.find((o) => o.is_primary) || objectives[0];
  if (!primary) return { available: false, winnerId: '', confidence: null, byObject: {} };
  let res = parseJsonish(primary.results);
  if (Array.isArray(res)) res = parseJsonish(res[0]);
  res = obj(res);
  const winnerId = res.winner_ad_object_id ? String(res.winner_ad_object_id) : '';
  const wc = res.winner_confidence;
  const byObject = Object.fromEntries(Object.entries(obj(parseJsonish(res.confidence_by_ad_object_id))).map(([k, v]) => [k, num(v)]));
  const conf = wc === null || wc === undefined ? null : num(wc) <= 1 ? Math.round(num(wc) * 1000) / 10 : num(wc);
  return { available: !!winnerId || Object.keys(byObject).length > 0, winnerId, confidence: conf, byObject, objective: primary.name || primary.type || '' };
}

/** GET /meta/automation/tests/:id → { test, cells (with their ad sets / campaigns), results } */
export async function getTest(businessId, studyId) {
  const row = await requireAdsRow(businessId);
  if (!isId(studyId)) throw new AdsError('Unknown test.', { status: 400, code: 'BAD_ID' });
  const acct = await accountInfo(row);
  const studies = await accountStudies(row, true);
  const s = studies.find((x) => String(x.id) === String(studyId));
  if (!s) throw notInAccount('That test');
  const cells = await gList(row, `${studyId}/cells`, { fields: 'id,name,treatment_percentage,adsets{id,name},campaigns{id,name}', limit: 10 }, 1);
  let objectives = [];
  try {
    objectives = await gList(row, `${studyId}/objectives`, { fields: 'id,name,type,is_primary,results', limit: 10 }, 1);
  } catch (e) {
    if (!soft(e)) throw e;
  }
  const results = winnerOf(objectives);
  const cellsOut = cells.map((c) => ({
    id: String(c.id || ''), name: c.name || '', percent: num(c.treatment_percentage),
    objects: [...(c.adsets?.data || []).map((o) => ({ level: 'adset', id: String(o.id), name: o.name || '' })), ...(c.campaigns?.data || []).map((o) => ({ level: 'campaign', id: String(o.id), name: o.name || '' }))],
  }));
  const winnerCell = results.winnerId ? cellsOut.find((c) => c.objects.some((o) => o.id === results.winnerId) || c.id === results.winnerId) : null;
  const test = presentStudy(s, acct);
  if (winnerCell) {
    const groupKey = `ad_test_winner:${test.id}:${results.winnerId}`;
    const already = await Notification.findOne({ businessId: String(row.businessId), groupKey }).select('_id').lean().catch(() => null);
    if (!already) {
      notify(row.businessId, {
        type: 'ad_test_winner', title: `A/B test result: ${test.name}`, body: `Meta picked ${winnerCell.name} as the winner${results.confidence !== null ? ` (${results.confidence}% confidence)` : ''}.`,
        target: { view: 'ads', id: `test:${test.id}` }, groupKey,
      }).catch(() => {});
    }
  }
  return { test, cells: cellsOut, results: { ...results, winnerCell: winnerCell ? { id: winnerCell.id, name: winnerCell.name } : null } };
}

/** POST /meta/automation/tests { name, level, ids[2–5], variable, metric, confidence, start, end, confirm: true } → { test } */
export async function createTest(business, raw = {}) {
  const row = await requireWriter(business._id);
  const acct = await accountInfo(row);
  const t = validateTest(raw, { timezone: acct.timezone });
  const objects = await assertObjects(row, t.level, t.ids);
  const gone = objects.find((o) => ['ARCHIVED', 'DELETED'].includes(o.effective_status || o.status));
  if (gone) throw bad('ids', `“${gone.name || gone.id}” is archived. Pick campaigns or ad sets that can still deliver.`);
  const names = Object.fromEntries(objects.map((o) => [String(o.id), o.name || '']));
  const payload = buildStudyPayload(t, names);
  const fmt = (ms) => utcToLocal(ms, acct.timezone).replace('T', ' ');
  const summary = {
    text: `Meta splits the audience into ${t.ids.length} groups that don’t overlap (${payload.cells.map((c) => `${c.treatment_percentage}%`).join(' / ')}) from ${fmt(t.start)} to ${fmt(t.end)} (${acct.timezone}) and compares them on ${TEST_METRICS[t.metric].label.toLowerCase()} at ${t.confidence}% confidence. The test only delivers while these ${t.level === 'campaign' ? 'campaigns' : 'ad sets'} are on; the CRM doesn’t turn anything on.`,
    cells: payload.cells.map((c) => c.name),
  };
  if (raw.confirm !== true) throw new ConfirmError('Creating a test changes who sees these ads at Meta. Confirm it in the CRM first.', summary);
  const business0 = await businessOf(row);
  if (!business0) throw new AdsError('This ad account isn’t owned by a Meta Business portfolio, so Meta can’t run an A/B test for it through the API. Use the CRM comparison instead.', { status: 409, code: 'NO_BUSINESS' });
  const res = await gPostForm(row, `${business0.id}/ad_studies`, payload);
  afterWrite(business._id);
  if (!isId(res?.id)) throw new AdsError('Meta didn’t return the new test.', { status: 502, code: 'META_ERROR' });
  logger.info('A/B test created from the CRM', { business: business.name, studyId: String(res.id), level: t.level, cells: t.ids.length, variable: t.variable });
  return {
    test: presentStudy({ ...payload, id: res.id, cells: { data: payload.cells.map((c) => ({ name: c.name, treatment_percentage: c.treatment_percentage })) } }, acct),
    summary,
  };
}

// ------------------------------------------------ CRM-side comparison --

/** Standard normal CDF (Abramowitz–Stegun 7.1.26 erf, error < 1.5e-7). */
export function normCdf(z) {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

/** Two-proportion z-test: { z, pValue, confidence (two-sided, %) } or null when it can't be computed. */
export function twoProportion(e1, n1, e2, n2) {
  if (!(n1 > 0 && n2 > 0)) return null;
  const p1 = e1 / n1;
  const p2 = e2 / n2;
  const p = (e1 + e2) / (n1 + n2);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  if (!(se > 0)) return null;
  const z = (p1 - p2) / se;
  const pValue = 2 * (1 - normCdf(Math.abs(z)));
  return { z: Math.round(z * 1000) / 1000, pValue: Math.round(pValue * 10000) / 10000, confidence: Math.round((1 - pValue) * 1000) / 10 };
}

const MIN_IMPRESSIONS = 1000;
const MIN_EVENTS = 20;

/**
 * Compare items on a metric: the best one, and whether its lead is
 * significant. Significance uses the rate behind the metric per impression
 * (results / impressions, or clicks / impressions), tested between the best
 * and the runner-up.
 */
export function compareItems(items, metric, confidence) {
  const m = TEST_METRICS[metric];
  const valued = items.filter((i) => i.values[metric] !== null && i.values[metric] !== undefined);
  const sorted = [...valued].sort((a, b) => (m.better === 'down' ? a.values[metric] - b.values[metric] : b.values[metric] - a.values[metric]));
  const notes = [];
  const basisLabel = m.basis === 'results' ? 'results per impression' : 'clicks per impression';
  if (sorted.length < 2) {
    return { winner: null, ranking: sorted.map((i) => i.id), significance: { level: 'not_enough_data', confidence: null, z: null, pValue: null, basis: basisLabel }, notes: ['At least two of them need results for this metric.'] };
  }
  const [best, next] = sorted;
  const ev = (i) => (m.basis === 'results' ? i.values.results : i.values.clicks) || 0;
  const thin = items.some((i) => (i.values.impressions || 0) < MIN_IMPRESSIONS) || ev(best) + ev(next) < MIN_EVENTS;
  const t = twoProportion(ev(best), best.values.impressions || 0, ev(next), next.values.impressions || 0);
  let level = 'not_yet';
  if (thin || !t) {
    level = 'not_enough_data';
    notes.push(`Each needs at least ${MIN_IMPRESSIONS.toLocaleString('en-IN')} impressions, and the top two at least ${MIN_EVENTS} ${m.basis} together, before the CRM calls a winner.`);
  } else if (t.z <= 0) {
    notes.push(`The leader’s ${m.label.toLowerCase()} comes from cheaper delivery, not a higher rate of ${m.basis}; the CRM can’t call that significant.`);
  } else if (t.confidence >= confidence) level = 'significant';
  return {
    winner: level === 'significant' ? { id: best.id, name: best.name } : null,
    leader: { id: best.id, name: best.name },
    ranking: sorted.map((i) => i.id),
    significance: { level, confidence: t ? t.confidence : null, z: t ? t.z : null, pValue: t ? t.pValue : null, basis: basisLabel, threshold: confidence },
    notes,
  };
}

const COMPARE_COLUMNS = ['spend', 'impressions', 'reach', 'clicks', 'ctr', 'cpc', 'cpm', 'results', 'cost_per_result'];

/** GET /meta/automation/compare?level=campaign|adset&ids=a,b&metric=&confidence=&preset|since|until&refresh=1 */
export async function compareObjects(businessId, q = {}) {
  const row = await requireAdsRow(businessId);
  const level = oneOf(q.level, ['campaign', 'adset'], 'level', 'Compare');
  const ids = idList(String(q.ids || '').split(',').filter(Boolean), { min: 2, max: 5, field: 'ids', label: level === 'campaign' ? 'campaigns' : 'ad sets' });
  const metric = oneOf(q.metric || 'cost_per_result', Object.keys(TEST_METRICS), 'metric', 'Metric');
  const confidence = Number(q.confidence || 90);
  if (!CONFIDENCE_LEVELS.includes(confidence)) throw bad('confidence', 'Pick 80%, 90% or 95%.');
  const objects = await assertObjects(row, level, ids);
  const out = await insightsReport(businessId, {
    level, columns: COMPARE_COLUMNS.join(','), mode: 'sync', preset: q.preset, since: q.since, until: q.until, refresh: q.refresh,
  });
  const report = out.report;
  if (!report) throw new AdsError('Meta is still preparing these numbers. Try again in a minute.', { status: 503, code: 'REPORT_PENDING' });
  const byId = new Map((report.rows || []).filter((r) => r.object?.id).map((r) => [String(r.object.id), r]));
  const items = objects.map((o) => {
    const r = byId.get(String(o.id));
    const values = Object.fromEntries(COMPARE_COLUMNS.map((c) => [c, r ? (r.values?.[c] ?? null) : (['spend', 'impressions', 'reach', 'clicks', 'results'].includes(c) ? 0 : null)]));
    return { id: String(o.id), name: o.name || r?.object?.name || '', status: o.effective_status || o.status || '', values };
  });
  const verdict = compareItems(items, metric, confidence);
  return {
    level, metric, metricLabel: TEST_METRICS[metric].label, better: TEST_METRICS[metric].better, confidence, currency: report.currency, range: report.range, items, ...verdict,
  };
}

// ================================================================== pixels ==

/** Meta's custom_event_type → the fbq() standard event name. */
export const FBQ_EVENT = {
  PURCHASE: 'Purchase', ADD_TO_CART: 'AddToCart', INITIATED_CHECKOUT: 'InitiateCheckout', ADD_PAYMENT_INFO: 'AddPaymentInfo',
  COMPLETE_REGISTRATION: 'CompleteRegistration', LEAD: 'Lead', CONTENT_VIEW: 'ViewContent', CONTACT: 'Contact', SUBSCRIBE: 'Subscribe',
  SEARCH: 'Search', SCHEDULE: 'Schedule', START_TRIAL: 'StartTrial', SUBMIT_APPLICATION: 'SubmitApplication',
};

/** The Meta Pixel base code for a pixel id (digits only, checked before it gets here). */
export function pixelSnippet(pixelId) {
  if (!isId(pixelId)) throw new AdsError('Unknown pixel.', { status: 400, code: 'BAD_ID' });
  const id = String(pixelId);
  return [
    '<!-- Meta Pixel Code -->',
    '<script>',
    '!function(f,b,e,v,n,t,s)',
    '{if(f.fbq)return;n=f.fbq=function(){n.callMethod?',
    'n.callMethod.apply(n,arguments):n.queue.push(arguments)};',
    "if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';",
    'n.queue=[];t=b.createElement(e);t.async=!0;',
    't.src=v;s=b.getElementsByTagName(e)[0];',
    "s.parentNode.insertBefore(t,s)}(window, document,'script',",
    "'https://connect.facebook.net/en_US/fbevents.js');",
    `fbq('init', '${id}');`,
    "fbq('track', 'PageView');",
    '</script>',
    '<noscript><img height="1" width="1" style="display:none"',
    `src="https://www.facebook.com/tr?id=${id}&ev=PageView&noscript=1"`,
    '/></noscript>',
    '<!-- End Meta Pixel Code -->',
  ].join('\n');
}
export function eventSnippet(eventType, currency) {
  const ev = FBQ_EVENT[eventType];
  if (!ev) return '';
  const money = ['PURCHASE', 'INITIATED_CHECKOUT', 'ADD_TO_CART', 'ADD_PAYMENT_INFO', 'START_TRIAL', 'SUBSCRIBE'].includes(eventType);
  return money ? `fbq('track', '${ev}', {value: 0.00, currency: '${String(currency || 'USD').replace(/[^A-Z]/g, '')}'});` : `fbq('track', '${ev}');`;
}

function pixelState(p, now = Date.now()) {
  if (p.is_unavailable) return 'unavailable';
  const t = tsMs(p.last_fired_time);
  if (!Number.isFinite(t)) return 'never';
  return now - t <= DAY_MS ? 'active' : now - t <= 7 * DAY_MS ? 'recent' : 'inactive';
}
const presentPixel = (p) => ({
  id: String(p.id), name: p.name || `Pixel ${p.id}`, lastFiredTime: p.last_fired_time || null, createdTime: p.creation_time || null,
  unavailable: !!p.is_unavailable, state: pixelState(p),
});

async function accountPixels(row, refresh) {
  const list = await graphList(row, `${row.adAccountId}/adspixels`, { fields: 'id,name,last_fired_time,creation_time,is_unavailable', limit: 50 }, { refresh, maxPages: 2 });
  return list.filter((p) => isId(p.id));
}

/** act_/customconversions (soft: [] when Meta won't say). */
export async function accountConversions(row, refresh = false) {
  try {
    const list = await graphList(row, `${row.adAccountId}/customconversions`, { fields: 'id,name,custom_event_type,pixel{id},is_archived,is_unavailable', limit: 100 }, { refresh, maxPages: 2 });
    return list.filter((c) => isId(c.id)).map((c) => ({
      id: String(c.id), name: c.name || `Custom conversion ${c.id}`, eventType: c.custom_event_type || 'OTHER', pixelId: c.pixel?.id ? String(c.pixel.id) : '',
      archived: !!c.is_archived, unavailable: !!c.is_unavailable,
    }));
  } catch (e) {
    if (soft(e)) return null;
    throw e;
  }
}

/** GET /meta/automation/pixels → { pixels, customConversions, events } */
export async function listPixels(businessId, q = {}) {
  const row = await requireAdsRow(businessId);
  const refresh = String(q.refresh || '') === '1';
  const [pixels, conversions] = await Promise.all([accountPixels(row, refresh), accountConversions(row, refresh)]);
  return {
    pixels: pixels.map(presentPixel).sort((a, b) => String(b.lastFiredTime || '').localeCompare(String(a.lastFiredTime || ''))),
    customConversions: conversions || [],
    customConversionsAvailable: conversions !== null,
    events: CONVERSION_EVENTS.map((e) => ({ key: e, fbq: FBQ_EVENT[e] || e })),
  };
}

export const STATS_RANGES = { '24h': DAY_MS, '7d': 7 * DAY_MS };

/** /{pixel}/stats rows → events with totals and when each was last seen. */
export function statsOf(rows = []) {
  const byEvent = new Map();
  let total = 0;
  for (const bucket of rows) {
    const at = tsMs(bucket.start_time);
    for (const d of Array.isArray(bucket.data) ? bucket.data : []) {
      const ev = String(d.value || '');
      const c = num(d.count);
      if (!ev || c <= 0) continue;
      total += c;
      const cur = byEvent.get(ev) || { event: ev, count: 0, lastSeenAt: null };
      cur.count += c;
      if (Number.isFinite(at) && (!cur.lastSeenAt || at > Date.parse(cur.lastSeenAt))) cur.lastSeenAt = new Date(at).toISOString();
      byEvent.set(ev, cur);
    }
  }
  return { total, events: [...byEvent.values()].sort((a, b) => b.count - a.count) };
}

/** GET /meta/automation/pixels/:id?range=24h|7d → { pixel, stats, snippet, eventSnippets, customConversions } */
export async function pixelDetails(businessId, pixelId, q = {}) {
  const row = await requireAdsRow(businessId);
  if (!isId(pixelId)) throw new AdsError('Unknown pixel.', { status: 400, code: 'BAD_ID' });
  const range = oneOf(q.range || '24h', Object.keys(STATS_RANGES), 'range', 'Range');
  const refresh = String(q.refresh || '') === '1';
  const pixels = await accountPixels(row, refresh);
  const p = pixels.find((x) => String(x.id) === String(pixelId));
  if (!p) throw notInAccount('That pixel');
  const until = Math.floor(Date.now() / 1000);
  const since = until - STATS_RANGES[range] / 1000;
  let stats = null;
  let note = '';
  try {
    const rows = await graphList(row, `${pixelId}/stats`, { aggregation: 'event', start_time: String(since), end_time: String(until) }, { refresh, maxPages: 1 });
    stats = { range, since: new Date(since * 1000).toISOString(), until: new Date(until * 1000).toISOString(), ...statsOf(rows) };
  } catch (e) {
    if (!soft(e)) throw e;
    note = 'Meta didn’t share this pixel’s event counts with the CRM. Events Manager shows them.';
  }
  const acct = await accountInfo(row);
  const conversions = (await accountConversions(row, refresh)) || [];
  return {
    pixel: presentPixel(p),
    stats,
    note,
    snippet: pixelSnippet(p.id),
    eventSnippets: CONVERSION_EVENTS.map((e) => ({ key: e, fbq: FBQ_EVENT[e], code: eventSnippet(e, acct.currency) })),
    customConversions: conversions.filter((c) => c.pixelId === String(p.id)),
    eventsManagerUrl: `https://business.facebook.com/events_manager2/list/pixel/${p.id}/overview?act=${actNumber(row.adAccountId)}`,
  };
}

export const _internal = { fmtMoney, presentHistory, statusOfStudy, parseDescription, toMinor, fromMinor };

export default {
  listRules, previewRule, createRule, updateRule, setRuleStatus, deleteRule, ruleHistory, mirrorRuleHistory,
  listTests, getTest, createTest, compareObjects, listPixels, pixelDetails,
};
