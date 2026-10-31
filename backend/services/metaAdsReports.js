// ---------------------------------------------------------------------------
// Ads Manager S3: reports like Ads Manager (Ads page → Reports, the Campaigns
// tables' column presets, the Overview comparison and account health card).
//
// Everything here is a read with the stored ad token (ads_read is enough):
//   • insightsReport: one Insights query built from allow-listed values only:
//     level (account | campaign | adset | ad), breakdown (age, gender,
//     age + gender, country, region, placement = publisher_platform +
//     platform_position, impression_device, hour of day, or day / week / month
//     through time_increment), columns from COLUMNS (presets in PRESETS) and
//     the dashboard's date range. Optionally compared with the previous period
//     of the same length (deltas per row and for the totals).
//   • Small reports run synchronously (GET …/insights, cached like the rest
//     of the ads reads; refresh=1 skips the cache). Large ones run as Meta
//     async report runs: POST …/insights → report_run_id → poll
//     GET /{report_run_id} → GET /{report_run_id}/insights. "Large" is an
//     estimate of the rows the query returns (estimateRows) above
//     ADS_REPORT_ASYNC_ROWS (default 2000). A sync query Meta refuses for its
//     size (error 100 / subcode 1487534, code 1 or 2, or a timeout) is retried
//     as an async run, and so is an impression_device query that comes back
//     empty (Meta's August 2026 notice: that breakdown may only be available
//     to async jobs for some accounts).
//   • The browser polls GET /meta/reports/runs/:id with an opaque CRM run id;
//     the report_run_id never leaves the server, and each run is tied to the
//     business and its ad account.
//   • reportCsv: the same report as a spreadsheet-safe CSV (csvCell, as the
//     lead CSV).
//   • accountHealth: amount spent, spend cap, balance, status, disable
//     reason, payment method (funding_source_details needs the MANAGE task;
//     unknown when Meta won't say) and the daily spending limit.
//
// v25.0 notes (developers.facebook.com, Insights API breakdowns / limits and
// best practices / v25 changelog): hourly breakdowns return no reach,
// frequency or unique metrics and allow no video_* fields; region allows no
// video_p25…p100 or video_avg_time; off-Meta actions (website leads) aren't
// returned with region or hourly; hourly data is kept 13 months; a failed
// async run returns error_code / error_message / error_user_msg (v25+).
// Columns Meta can't return for the chosen breakdown are left out and listed
// in report.dropped with the reason.
// ---------------------------------------------------------------------------
import crypto from 'crypto';
import {
  AdsError, requireAdsRow, withAdsToken, graphList, graphGet, assertInAccount, auth, proof, http, G, metricsOf, parseRange,
  isId, actNumber, NO_MINOR_UNIT, csvCell, ACCOUNT_STATUS,
} from './metaAds.js';
import logger from './logger.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const CACHE_MS = () => Math.max(0, Number(process.env.ADS_CACHE_MS) || 5 * 60 * 1000);
/** Estimated rows above which a report runs as a Meta async job. */
export const asyncRowThreshold = () => Math.max(1, Number(process.env.ADS_REPORT_ASYNC_ROWS) || 2000);
const RUN_TIMEOUT_MS = () => Math.max(500, Number(process.env.ADS_REPORT_RUN_TIMEOUT_MS) || 10 * 60 * 1000);
const POLL_MIN_MS = () => Math.max(0, Number(process.env.ADS_REPORT_POLL_MIN_MS ?? 2000));
const CSV_WAIT_MS = () => Math.max(0, Number(process.env.ADS_REPORT_CSV_WAIT_MS ?? 60000));
const RUN_TTL_MS = 60 * 60 * 1000;
const MAX_RUNS_PER_BUSINESS = 3;
const MAX_COLUMNS = 40;
const PAGE_LIMIT = 500;
const MAX_PAGES = 10; // 5,000 rows per report
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (v) => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const round = (v, d) => (v === null || v === undefined ? null : Math.round(v * 10 ** d) / 10 ** d);
const div = (a, b) => (b ? a / b : null);
const ymd = (d) => d.toISOString().slice(0, 10);
const noMinor = (cur) => NO_MINOR_UNIT.has(String(cur || '').toUpperCase());
const fromMinor = (v, cur) => (numOrNull(v) === null ? null : noMinor(cur) ? num(v) : num(v) / 100);

// ------------------------------------------------------------- columns --

/** The largest value of these action types (the same rule as metricsOf: no double counting of grouped types). */
const actionOf = (r, types) => {
  const v = (r.actions || []).filter((a) => types.includes(a.action_type)).map((a) => num(a.value));
  return v.length ? Math.max(...v) : 0;
};
/** A list<AdsActionStats> field (video_*_watched_actions, outbound_clicks) → its total. */
const listSum = (list) => (Array.isArray(list) ? list.reduce((s, a) => s + num(a.value), 0) : 0);
const listFirst = (list) => (Array.isArray(list) && list.length ? numOrNull(list[0].value) : null);
const A = (...types) => (r) => actionOf(r, types);

const MESSAGING = ['onsite_conversion.messaging_conversation_started_7d'];
const FIRST_REPLY = ['onsite_conversion.messaging_first_reply'];
const LEADS = ['lead', 'onsite_conversion.lead_grouped', 'leadgen_grouped', 'onsite_conversion.lead', 'offsite_conversion.fb_pixel_lead'];

const NO_HOURLY = 'Meta doesn’t report this by hour of day.';
const NO_REGION = 'Meta doesn’t report this by region.';
const OFF_META = 'Meta doesn’t return off-Meta (website) actions by region or hour of day.';

/**
 * Every column the CRM can show. fields: the Insights fields it needs;
 * get(row, metricsOf(row)) → number | null; better: which way is good for the
 * comparison colours; notWith: breakdowns Meta can't combine it with.
 */
export const COLUMNS = {
  spend: { label: 'Amount spent', group: 'Delivery', format: 'money', fields: ['spend'], get: (r) => num(r.spend), better: 'neutral' },
  impressions: { label: 'Impressions', group: 'Delivery', format: 'int', fields: ['impressions'], get: (r) => num(r.impressions), better: 'up' },
  reach: { label: 'Reach', group: 'Delivery', format: 'int', fields: ['reach'], get: (r) => numOrNull(r.reach), better: 'up', notWith: { hourly: NO_HOURLY } },
  frequency: { label: 'Frequency', group: 'Delivery', format: 'dec', fields: ['frequency'], get: (r) => numOrNull(r.frequency), better: 'neutral', notWith: { hourly: NO_HOURLY } },
  cpm: { label: 'CPM (cost per 1,000 impressions)', group: 'Delivery', format: 'money', fields: ['spend', 'impressions'], get: (r) => (num(r.impressions) ? (num(r.spend) / num(r.impressions)) * 1000 : null), better: 'down' },
  cpp: { label: 'Cost per 1,000 people reached', group: 'Delivery', format: 'money', fields: ['spend', 'reach'], get: (r) => (numOrNull(r.reach) ? (num(r.spend) / num(r.reach)) * 1000 : null), better: 'down', notWith: { hourly: NO_HOURLY } },
  clicks: { label: 'Clicks (all)', group: 'Clicks', format: 'int', fields: ['clicks'], get: (r) => num(r.clicks), better: 'up' },
  ctr: { label: 'CTR (all)', group: 'Clicks', format: 'pct', fields: ['clicks', 'impressions'], get: (r) => (num(r.impressions) ? (num(r.clicks) / num(r.impressions)) * 100 : null), better: 'up' },
  cpc: { label: 'CPC (all)', group: 'Clicks', format: 'money', fields: ['spend', 'clicks'], get: (r) => div(num(r.spend), num(r.clicks)), better: 'down' },
  link_clicks: { label: 'Link clicks', group: 'Clicks', format: 'int', fields: ['inline_link_clicks'], get: (r) => num(r.inline_link_clicks), better: 'up' },
  link_ctr: { label: 'Link CTR', group: 'Clicks', format: 'pct', fields: ['inline_link_clicks', 'impressions'], get: (r) => (num(r.impressions) ? (num(r.inline_link_clicks) / num(r.impressions)) * 100 : null), better: 'up' },
  cost_per_link_click: { label: 'Cost per link click', group: 'Clicks', format: 'money', fields: ['spend', 'inline_link_clicks'], get: (r) => div(num(r.spend), num(r.inline_link_clicks)), better: 'down' },
  outbound_clicks: { label: 'Outbound clicks', group: 'Clicks', format: 'int', fields: ['outbound_clicks'], get: (r) => listSum(r.outbound_clicks), better: 'up' },
  landing_page_views: { label: 'Landing page views', group: 'Clicks', format: 'int', fields: ['actions'], get: A('landing_page_view'), better: 'up' },
  results: { label: 'Results', group: 'Results', format: 'int', fields: ['spend', 'actions'], get: (r, m) => m.results, better: 'up' },
  cost_per_result: { label: 'Cost per result', group: 'Results', format: 'money', fields: ['spend', 'actions'], get: (r, m) => m.costPerResult, better: 'down' },
  post_engagement: { label: 'Post engagements', group: 'Engagement', format: 'int', fields: ['actions'], get: A('post_engagement'), better: 'up' },
  cost_per_post_engagement: { label: 'Cost per post engagement', group: 'Engagement', format: 'money', fields: ['spend', 'actions'], get: (r) => div(num(r.spend), actionOf(r, ['post_engagement'])), better: 'down' },
  page_engagement: { label: 'Page engagements', group: 'Engagement', format: 'int', fields: ['actions'], get: A('page_engagement'), better: 'up' },
  post_reactions: { label: 'Post reactions', group: 'Engagement', format: 'int', fields: ['actions'], get: A('post_reaction'), better: 'up' },
  post_comments: { label: 'Post comments', group: 'Engagement', format: 'int', fields: ['actions'], get: A('comment'), better: 'up' },
  post_shares: { label: 'Post shares', group: 'Engagement', format: 'int', fields: ['actions'], get: A('post'), better: 'up' },
  post_saves: { label: 'Post saves', group: 'Engagement', format: 'int', fields: ['actions'], get: A('onsite_conversion.post_save'), better: 'up' },
  page_likes: { label: 'Page likes', group: 'Engagement', format: 'int', fields: ['actions'], get: A('like'), better: 'up' },
  video_plays: { label: 'Video plays', group: 'Video', format: 'int', fields: ['video_play_actions'], get: (r) => listSum(r.video_play_actions), better: 'up', notWith: { hourly: NO_HOURLY } },
  video_3s: { label: '3-second video plays', group: 'Video', format: 'int', fields: ['actions'], get: A('video_view'), better: 'up' },
  thruplays: { label: 'ThruPlays', group: 'Video', format: 'int', fields: ['video_thruplay_watched_actions'], get: (r) => listSum(r.video_thruplay_watched_actions), better: 'up', notWith: { hourly: NO_HOURLY } },
  cost_per_thruplay: { label: 'Cost per ThruPlay', group: 'Video', format: 'money', fields: ['spend', 'video_thruplay_watched_actions'], get: (r) => div(num(r.spend), listSum(r.video_thruplay_watched_actions)), better: 'down', notWith: { hourly: NO_HOURLY } },
  video_p25: { label: 'Video plays at 25%', group: 'Video', format: 'int', fields: ['video_p25_watched_actions'], get: (r) => listSum(r.video_p25_watched_actions), better: 'up', notWith: { hourly: NO_HOURLY, region: NO_REGION } },
  video_p50: { label: 'Video plays at 50%', group: 'Video', format: 'int', fields: ['video_p50_watched_actions'], get: (r) => listSum(r.video_p50_watched_actions), better: 'up', notWith: { hourly: NO_HOURLY, region: NO_REGION } },
  video_p75: { label: 'Video plays at 75%', group: 'Video', format: 'int', fields: ['video_p75_watched_actions'], get: (r) => listSum(r.video_p75_watched_actions), better: 'up', notWith: { hourly: NO_HOURLY, region: NO_REGION } },
  video_p95: { label: 'Video plays at 95%', group: 'Video', format: 'int', fields: ['video_p95_watched_actions'], get: (r) => listSum(r.video_p95_watched_actions), better: 'up', notWith: { hourly: NO_HOURLY, region: NO_REGION } },
  video_p100: { label: 'Video plays at 100%', group: 'Video', format: 'int', fields: ['video_p100_watched_actions'], get: (r) => listSum(r.video_p100_watched_actions), better: 'up', notWith: { hourly: NO_HOURLY, region: NO_REGION } },
  video_avg_time: { label: 'Average video play time', group: 'Video', format: 'secs', fields: ['video_avg_time_watched_actions'], get: (r) => listFirst(r.video_avg_time_watched_actions), better: 'up', notWith: { hourly: NO_HOURLY, region: NO_REGION } },
  messaging_conversations: { label: 'Messaging conversations started', group: 'Messaging', format: 'int', fields: ['actions'], get: A(...MESSAGING), better: 'up' },
  cost_per_messaging_conversation: { label: 'Cost per messaging conversation', group: 'Messaging', format: 'money', fields: ['spend', 'actions'], get: (r) => div(num(r.spend), actionOf(r, MESSAGING)), better: 'down' },
  messaging_first_reply: { label: 'New messaging contacts', group: 'Messaging', format: 'int', fields: ['actions'], get: A(...FIRST_REPLY), better: 'up' },
  cost_per_new_messaging_contact: { label: 'Cost per new messaging contact', group: 'Messaging', format: 'money', fields: ['spend', 'actions'], get: (r) => div(num(r.spend), actionOf(r, FIRST_REPLY)), better: 'down' },
  messaging_connections: { label: 'Messaging contacts', group: 'Messaging', format: 'int', fields: ['actions'], get: A('onsite_conversion.total_messaging_connection'), better: 'up' },
  leads: { label: 'Leads', group: 'Leads', format: 'int', fields: ['actions'], get: (r, m) => m.leads, better: 'up' },
  cost_per_lead: { label: 'Cost per lead', group: 'Leads', format: 'money', fields: ['spend', 'actions'], get: (r, m) => div(num(r.spend), m.leads), better: 'down' },
  onmeta_leads: { label: 'On-Facebook leads', group: 'Leads', format: 'int', fields: ['actions'], get: A('onsite_conversion.lead_grouped', 'leadgen_grouped'), better: 'up' },
  website_leads: { label: 'Website leads (pixel)', group: 'Leads', format: 'int', fields: ['actions'], get: A('offsite_conversion.fb_pixel_lead'), better: 'up', notWith: { region: OFF_META, hourly: OFF_META } },
};

/** Ads Manager's column presets. Performance is the Campaigns table's classic set. */
export const PRESETS = {
  performance: ['spend', 'impressions', 'clicks', 'ctr', 'results', 'cost_per_result'],
  delivery: ['reach', 'frequency', 'impressions', 'cpm', 'cpp', 'spend'],
  engagement: ['post_engagement', 'cost_per_post_engagement', 'page_engagement', 'post_reactions', 'post_comments', 'post_shares', 'link_clicks', 'link_ctr'],
  video: ['spend', 'impressions', 'video_plays', 'video_3s', 'thruplays', 'cost_per_thruplay', 'video_p25', 'video_p50', 'video_p75', 'video_p100', 'video_avg_time'],
  messaging: ['spend', 'messaging_conversations', 'cost_per_messaging_conversation', 'messaging_first_reply', 'cost_per_new_messaging_contact', 'messaging_connections', 'link_clicks'],
  leads: ['spend', 'leads', 'cost_per_lead', 'onmeta_leads', 'website_leads', 'link_clicks', 'link_ctr'],
  cost_per_result: ['results', 'cost_per_result', 'cost_per_messaging_conversation', 'cost_per_lead', 'cost_per_link_click', 'cpc', 'cpm', 'cost_per_thruplay', 'cpp'],
};

/**
 * Breakdowns. `breakdowns` goes to Meta's breakdowns parameter; time ones use
 * time_increment instead. `factor` is the rough number of values, for the
 * async estimate. Only permutations from Meta's breakdown table are offered.
 */
export const BREAKDOWNS = {
  none: { label: 'None', kind: 'none', breakdowns: [] },
  age: { label: 'Age', kind: 'dim', breakdowns: ['age'], factor: 7 },
  gender: { label: 'Gender', kind: 'dim', breakdowns: ['gender'], factor: 3 },
  age_gender: { label: 'Age and gender', kind: 'dim', breakdowns: ['age', 'gender'], factor: 21 },
  country: { label: 'Country', kind: 'dim', breakdowns: ['country'], factor: 30 },
  region: { label: 'Region', kind: 'dim', breakdowns: ['region'], factor: 60 },
  placement: { label: 'Placement', kind: 'dim', breakdowns: ['publisher_platform', 'platform_position'], factor: 25 },
  device: { label: 'Impression device', kind: 'dim', breakdowns: ['impression_device'], factor: 12 },
  hourly: { label: 'Hour of day', kind: 'dim', breakdowns: ['hourly_stats_aggregated_by_advertiser_time_zone'], factor: 24 },
  day: { label: 'Day', kind: 'time', breakdowns: [], timeIncrement: 1 },
  week: { label: 'Week', kind: 'time', breakdowns: [], timeIncrement: 7 },
  month: { label: 'Month', kind: 'time', breakdowns: [], timeIncrement: 'monthly' },
};

/** Report levels: 'account' is the total of the scope (no level parameter). */
export const LEVELS = { account: '', campaign: 'campaign', adset: 'adset', ad: 'ad' };
const OBJECTS_ESTIMATE = { account: 1, campaign: 20, adset: 50, ad: 150 };
const LEVEL_LABEL = { campaign: 'Campaign', adset: 'Ad set', ad: 'Ad' };
const DIM_LABEL = {
  age: 'Age', gender: 'Gender', country: 'Country', region: 'Region', publisher_platform: 'Platform', platform_position: 'Placement',
  impression_device: 'Device', hourly_stats_aggregated_by_advertiser_time_zone: 'Hour',
};
const TIME_LABEL = { day: 'Date', week: 'Week starting', month: 'Month' };
const GENDER = { male: 'Men', female: 'Women', unknown: 'Unknown' };
const PLATFORM = { facebook: 'Facebook', instagram: 'Instagram', messenger: 'Messenger', audience_network: 'Audience Network', threads: 'Threads', whatsapp: 'WhatsApp' };
const DEVICE = { iphone: 'iPhone', ipad: 'iPad', ipod: 'iPod', android_smartphone: 'Android phone', android_tablet: 'Android tablet', desktop: 'Desktop', other: 'Other' };
let regionNames = null;
try {
  regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
} catch {
  regionNames = null;
}
const humanize = (s) => String(s || '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

function dimLabel(key, v) {
  if (v === undefined || v === null || v === '') return 'Unknown';
  const s = String(v);
  if (key === 'gender') return GENDER[s] || humanize(s);
  if (key === 'country') {
    try {
      return (/^[A-Z]{2}$/i.test(s) && regionNames?.of(s.toUpperCase())) || s;
    } catch {
      return s;
    }
  }
  if (key === 'publisher_platform') return PLATFORM[s] || humanize(s);
  if (key === 'impression_device') return DEVICE[s] || humanize(s);
  if (key === 'platform_position') return humanize(s.replace(/^instagram_/, '').replace(/^facebook_/, ''));
  if (key === 'hourly_stats_aggregated_by_advertiser_time_zone') {
    const m = /^(\d{2}):\d{2}/.exec(s);
    if (!m) return s;
    const h = Number(m[1]);
    return `${m[1]}:00–${String((h + 1) % 24).padStart(2, '0')}:00`;
  }
  return s;
}

// --------------------------------------------------------- date ranges --

function tzToday(tz) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  } catch {
    return ymd(new Date());
  }
}
const addDays = (s, n) => ymd(new Date(Date.parse(`${s}T00:00:00Z`) + n * DAY_MS));
export const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS) + 1;

/** The dates a range covers in the ad account's time zone (Meta's last_Nd presets end yesterday). */
export function resolveRange(range, tz) {
  if (range.preset === 'custom') return { since: range.since, until: range.until };
  const today = tzToday(tz);
  if (range.preset === 'today') return { since: today, until: today };
  const n = { last_7d: 7, last_30d: 30, last_90d: 90 }[range.preset] || 7;
  return { since: addDays(today, -n), until: addDays(today, -1) };
}

/** The period of the same length just before. */
export function previousOf({ since, until }) {
  const len = daysBetween(since, until);
  return { since: addDays(since, -len), until: addDays(since, -1) };
}

// ------------------------------------------------------------- the query --

/** Validates the browser's query against the allow-lists. Nothing else reaches Meta. */
export function parseReportQuery(q = {}) {
  const level = String(q.level || 'account');
  if (!Object.hasOwn(LEVELS, level)) throw new AdsError('Unknown report level.', { code: 'BAD_LEVEL' });
  const breakdown = String(q.breakdown || 'none');
  if (!Object.hasOwn(BREAKDOWNS, breakdown)) throw new AdsError('Unknown breakdown.', { code: 'BAD_BREAKDOWN' });
  const raw = Array.isArray(q.columns) ? q.columns.join(',') : String(q.columns || '');
  let columns = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (columns.length > MAX_COLUMNS) throw new AdsError(`Pick at most ${MAX_COLUMNS} columns.`, { code: 'TOO_MANY_COLUMNS' });
  const unknown = columns.find((c) => !Object.hasOwn(COLUMNS, c));
  if (unknown) throw new AdsError(`Unknown column: ${unknown.slice(0, 60)}`, { code: 'BAD_COLUMN' });
  columns = [...new Set(columns)];
  if (!columns.length) columns = [...PRESETS.performance];
  const parentId = String(q.parentId || '');
  if (parentId && !isId(parentId)) throw new AdsError('Unknown id.', { code: 'BAD_ID' });
  const cmp = String(q.compare ?? '');
  if (!['', '0', '1', 'true', 'false'].includes(cmp)) throw new AdsError('compare must be 1 or 0.', { code: 'BAD_COMPARE' });
  const mode = String(q.mode || 'auto');
  if (!['auto', 'sync', 'async'].includes(mode)) throw new AdsError('Unknown report mode.', { code: 'BAD_MODE' });
  const range = parseRange(q);
  if (breakdown === 'hourly' && range.preset === 'custom') {
    const oldest = new Date();
    oldest.setUTCMonth(oldest.getUTCMonth() - 13);
    if (range.since < ymd(oldest)) throw new AdsError('Meta keeps results by hour of day for 13 months. Pick a later start date.', { code: 'BAD_RANGE' });
  }
  return { level, breakdown, columns, parentId, compare: cmp === '1' || cmp === 'true', mode, range, refresh: String(q.refresh || '') === '1' };
}

/** Rough number of rows a query returns (decides sync vs async). */
export function estimateRows(query, dates) {
  const bd = BREAKDOWNS[query.breakdown];
  const days = Math.max(1, daysBetween(dates.since, dates.until));
  const buckets = bd.timeIncrement === 1 ? days : bd.timeIncrement === 7 ? Math.ceil(days / 7) : bd.timeIncrement === 'monthly' ? Math.ceil(days / 30) + 1 : 1;
  return buckets * (bd.factor || 1) * OBJECTS_ESTIMATE[query.level] * (query.compare ? 2 : 1);
}

/** The Graph request(s) for a validated query. */
function planOf(row, query) {
  const bd = BREAKDOWNS[query.breakdown];
  const dropped = [];
  const columns = [];
  for (const id of query.columns) {
    const why = COLUMNS[id].notWith?.[query.breakdown];
    if (why) dropped.push({ id, label: COLUMNS[id].label, reason: why });
    else columns.push(id);
  }
  const metricFields = new Set(['spend', 'impressions']);
  for (const id of columns) for (const f of COLUMNS[id].fields) metricFields.add(f);
  const lvl = LEVELS[query.level];
  const fields = [...(lvl ? [`${lvl}_id`, `${lvl}_name`] : []), ...metricFields];
  const params = { fields: fields.join(','), limit: PAGE_LIMIT };
  if (metricFields.has('actions')) params.action_breakdowns = 'action_type';
  if (lvl) params.level = lvl;
  if (bd.breakdowns.length) params.breakdowns = bd.breakdowns.join(',');
  if (bd.timeIncrement) params.time_increment = bd.timeIncrement;
  const totalParams = { fields: [...metricFields].join(','), limit: 1 };
  if (metricFields.has('actions')) totalParams.action_breakdowns = 'action_type';
  const dates = resolveRange(query.range, row.adAccountTimezone);
  const prev = query.compare ? previousOf(dates) : null;
  return {
    path: `${query.parentId || row.adAccountId}/insights`,
    columns,
    dropped,
    params,
    totalParams,
    needTotals: !(query.level === 'account' && query.breakdown === 'none'),
    rangeParams: query.range.params,
    dates,
    prev,
    prevParams: prev ? { time_range: JSON.stringify(prev) } : null,
  };
}

// ------------------------------------------------------------ the report --

const FORMAT_DIGITS = { money: 2, int: 0, pct: 2, dec: 2, secs: 1 };

export function valuesOf(r = {}, columns) {
  const m = metricsOf(r);
  const out = {};
  for (const id of columns) {
    const c = COLUMNS[id];
    const v = c.get(r, m);
    out[id] = v === null || v === undefined || !Number.isFinite(v) ? null : round(v, FORMAT_DIGITS[c.format] ?? 2);
  }
  return out;
}

/** Change from the previous period: absolute and percent (null when it can't be said). */
export function deltaOf(now, prev) {
  if (now === null || now === undefined || prev === null || prev === undefined) return { abs: null, pct: null };
  const abs = round(now - prev, 2);
  if (prev === 0) return { abs, pct: now === 0 ? 0 : null };
  return { abs, pct: round(((now - prev) / Math.abs(prev)) * 100, 1) };
}
const deltas = (now, prev, columns) => Object.fromEntries(columns.map((id) => [id, deltaOf(now?.[id], prev?.[id])]));

function rowOf(r, query) {
  const bd = BREAKDOWNS[query.breakdown];
  const lvl = LEVELS[query.level];
  const object = lvl ? { id: String(r[`${lvl}_id`] || ''), name: String(r[`${lvl}_name`] || '') } : null;
  const dims = bd.breakdowns.map((k) => ({ key: k, value: r[k] === undefined || r[k] === null ? '' : String(r[k]), label: dimLabel(k, r[k]) }));
  let date = null;
  if (bd.kind === 'time') {
    const start = String(r.date_start || '');
    const stop = String(r.date_stop || start);
    const label = query.breakdown === 'day' ? start : query.breakdown === 'week' ? `${start} – ${stop}` : start.slice(0, 7);
    date = { start, stop, label };
  }
  const groupKey = [object?.id || '', ...dims.map((d) => d.value)].join('|');
  const label = [object ? object.name || object.id : '', ...dims.map((d) => d.label), date?.label || ''].filter(Boolean).join(' · ') || 'Total';
  return { key: `${groupKey}|${date?.start || ''}`, groupKey, label, object, dims, date, raw: r };
}

const AGE_ORDER = (v) => (/^\d+/.test(v) ? Number(/^\d+/.exec(v)[0]) : 999);
const GENDER_ORDER = { female: 0, male: 1, unknown: 2 };
function sortRows(query, rows) {
  const bd = BREAKDOWNS[query.breakdown];
  const spend = (x) => num(x.raw.spend);
  const cmp = (a, b) => {
    if (bd.kind === 'time') return a.date.start.localeCompare(b.date.start) || spend(b) - spend(a) || a.key.localeCompare(b.key);
    if (query.breakdown === 'hourly') return a.dims[0].value.localeCompare(b.dims[0].value) || a.key.localeCompare(b.key);
    if (query.breakdown === 'age' || query.breakdown === 'age_gender' || query.breakdown === 'gender') {
      if (a.object?.id !== b.object?.id) return spend(b) - spend(a) || a.key.localeCompare(b.key);
      const age = (x) => AGE_ORDER(x.dims.find((d) => d.key === 'age')?.value || '');
      const gen = (x) => GENDER_ORDER[x.dims.find((d) => d.key === 'gender')?.value] ?? 3;
      return age(a) - age(b) || gen(a) - gen(b) || a.key.localeCompare(b.key);
    }
    return spend(b) - spend(a) || a.key.localeCompare(b.key);
  };
  const sorted = [...rows].sort(cmp);
  // Time rows of each group are compared with the same position in the previous period.
  const seen = new Map();
  for (const x of sorted) {
    const i = seen.get(x.groupKey) || 0;
    seen.set(x.groupKey, i + 1);
    x.matchKey = bd.kind === 'time' ? `${x.groupKey}#${i}` : x.groupKey;
  }
  return sorted;
}

function buildReport(row, query, plan, { cur, totals, prev, prevTotals, source, truncated }) {
  const bd = BREAKDOWNS[query.breakdown];
  const cols = plan.columns;
  const now = sortRows(query, (cur || []).map((r) => rowOf(r, query)));
  let before = null;
  if (query.compare) before = new Map(sortRows(query, (prev || []).map((r) => rowOf(r, query))).map((x) => [x.matchKey, x]));
  const rows = now.map((x) => {
    const values = valuesOf(x.raw, cols);
    const out = { key: x.key, label: x.label, object: x.object, dims: x.dims, date: x.date, values };
    if (before) {
      const b = before.get(x.matchKey);
      out.previous = valuesOf(b ? b.raw : {}, cols);
      out.previousDate = b?.date || null;
      out.delta = deltas(values, out.previous, cols);
    }
    return out;
  });
  const totalValues = valuesOf(totals || {}, cols);
  const total = { values: totalValues };
  if (query.compare) {
    total.previous = valuesOf(prevTotals || {}, cols);
    total.delta = deltas(totalValues, total.previous, cols);
  }
  const lvl = LEVELS[query.level];
  const notes = [];
  const oldest = new Date();
  oldest.setUTCMonth(oldest.getUTCMonth() - 13);
  if (bd.kind === 'dim' && plan.dates.since < ymd(oldest) && cols.some((c) => ['reach', 'frequency', 'cpp'].includes(c))) {
    notes.push('Meta doesn’t return reach (or frequency) for breakdowns of dates more than 13 months ago.');
  }
  if (query.breakdown === 'week') notes.push(`Weeks are 7-day periods starting ${plan.dates.since}.`);
  if (query.breakdown === 'hourly') notes.push('Hours are in the ad account’s time zone.');
  if (truncated) notes.push(`Only the first ${PAGE_LIMIT * MAX_PAGES} rows are shown. Narrow the date range or the level for the rest.`);
  return {
    level: query.level,
    parentId: query.parentId || '',
    breakdown: query.breakdown,
    breakdownLabel: bd.label,
    kind: bd.kind,
    headers: [
      ...(lvl ? [{ key: 'object', label: LEVEL_LABEL[lvl] }] : []),
      ...bd.breakdowns.map((k) => ({ key: k, label: DIM_LABEL[k] || humanize(k) })),
      ...(bd.kind === 'time' ? [{ key: 'date', label: TIME_LABEL[query.breakdown] }] : []),
    ],
    columns: cols.map((id) => ({ id, label: COLUMNS[id].label, group: COLUMNS[id].group, format: COLUMNS[id].format, better: COLUMNS[id].better })),
    dropped: plan.dropped,
    notes,
    currency: row.adAccountCurrency || '',
    timezone: row.adAccountTimezone || '',
    range: { preset: query.range.preset, label: query.range.label, since: plan.dates.since, until: plan.dates.until },
    compare: plan.prev ? { since: plan.prev.since, until: plan.prev.until, label: `${plan.prev.since} – ${plan.prev.until}` } : null,
    rows,
    totals: total,
    deliveredImpressions: num(totals?.impressions),
    rowCount: rows.length,
    truncated: !!truncated,
    source,
    generatedAt: new Date().toISOString(),
  };
}

// --------------------------------------------------------------- caches --

const reports = new Map(); // `${businessId}|${act}|${query}` -> { at, report }
const keyOf = (row, query) => `${String(row.businessId)}|${row.adAccountId}|${JSON.stringify({
  l: query.level, b: query.breakdown, c: query.columns, p: query.parentId, x: query.compare, r: query.range.params,
})}`;
function cachedReport(key) {
  const hit = reports.get(key);
  return hit && Date.now() - hit.at < CACHE_MS() ? hit.report : null;
}
function remember(key, report) {
  if (reports.size > 500) {
    for (const [k, v] of reports) if (Date.now() - v.at >= CACHE_MS()) reports.delete(k);
    if (reports.size > 500) reports.clear();
  }
  reports.set(key, { at: Date.now(), report });
}
/** Forget a business's built reports (the raw Graph reads are cleared by clearCache). */
export function clearReportCache(businessId) {
  const prefix = `${String(businessId)}|`;
  for (const k of reports.keys()) if (k.startsWith(prefix)) reports.delete(k);
}

// ---------------------------------------------------------------- sync --

async function syncReport(row, query, plan) {
  const opts = { refresh: query.refresh, maxPages: MAX_PAGES };
  const tot = { refresh: query.refresh, maxPages: 1 };
  const [cur, totals, prev, prevTotals] = await Promise.all([
    graphList(row, plan.path, { ...plan.params, ...plan.rangeParams }, opts),
    plan.needTotals ? graphList(row, plan.path, { ...plan.totalParams, ...plan.rangeParams }, tot) : null,
    plan.prev ? graphList(row, plan.path, { ...plan.params, ...plan.prevParams }, opts) : null,
    plan.prev && plan.needTotals ? graphList(row, plan.path, { ...plan.totalParams, ...plan.prevParams }, tot) : null,
  ]);
  return buildReport(row, query, plan, {
    cur,
    totals: plan.needTotals ? totals?.[0] : cur[0],
    prev,
    prevTotals: plan.prev ? (plan.needTotals ? prevTotals?.[0] : prev?.[0]) : null,
    source: 'sync',
    truncated: cur.length >= PAGE_LIMIT * MAX_PAGES,
  });
}

/** Meta refused a sync query for its size or timed out: worth an async run. */
function tooMuchData(e) {
  if (!(e instanceof AdsError)) return false;
  if (e.code === 'META_UNREACHABLE') return /timeout|ECONNABORTED|socket hang up/i.test(e.message);
  if (e.code !== 'META_ERROR' || !e.meta) return false;
  const c = Number(e.meta.code);
  return c === 1 || c === 2 || (c === 100 && Number(e.meta.subcode) === 1487534);
}

// --------------------------------------------------------------- async --

const runs = new Map(); // CRM run id -> run
const RUN_FIELDS = 'id,account_id,async_status,async_percent_completion,error_code,error_message,error_subcode,error_user_title,error_user_msg';

function sweepRuns() {
  const now = Date.now();
  for (const [id, r] of runs) if (now - r.createdAt > RUN_TTL_MS) runs.delete(id);
}

const presentRun = (run) => ({
  id: run.id,
  status: run.status,
  percent: run.percent,
  reason: run.reason,
  startedAt: new Date(run.createdAt).toISOString(),
  estimatedRows: run.estimatedRows,
  jobs: run.jobs.length,
});

function postAsync(row, path, params) {
  return withAdsToken(row, 'ad', async (token) => {
    const form = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (k !== 'limit') form.set(k, String(v));
    const { data } = await http.post(`${G()}/${path}`, form.toString(), {
      params: { appsecret_proof: proof(token) },
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    const id = String(data?.report_run_id || '');
    if (!isId(id)) throw new AdsError('Meta didn’t start the report. Try again.', { status: 502, code: 'REPORT_FAILED' });
    return id;
  });
}

async function startRun(row, query, plan, key, estimatedRows, reason) {
  sweepRuns();
  const businessId = String(row.businessId);
  const active = [...runs.values()].filter((r) => r.businessId === businessId && r.status === 'running').length;
  if (active >= MAX_RUNS_PER_BUSINESS) {
    throw new AdsError('Several large reports are already being prepared. Wait for them to finish, then try again.', { status: 429, code: 'TOO_MANY_RUNS' });
  }
  const jobs = [{ which: 'current', reportRunId: await postAsync(row, plan.path, { ...plan.params, ...plan.rangeParams }) }];
  if (plan.prev) jobs.push({ which: 'previous', reportRunId: await postAsync(row, plan.path, { ...plan.params, ...plan.prevParams }) });
  const id = crypto.randomBytes(12).toString('hex');
  const run = {
    // lastPoll = now: Meta has only just accepted the job, the first status read waits POLL_MIN_MS.
    id, businessId, adAccountId: row.adAccountId, key, query, plan, jobs, createdAt: Date.now(), lastPoll: Date.now(),
    status: 'running', percent: 0, reason, estimatedRows, report: null, error: null,
  };
  runs.set(id, run);
  logger.info('ads report: async run started', { businessId, adAccountId: row.adAccountId, breakdown: query.breakdown, level: query.level, estimatedRows, reason, jobs: jobs.length });
  return { mode: 'async', run: presentRun(run) };
}

/** All rows of a finished report run (bounded). */
function readRun(row, reportRunId) {
  return withAdsToken(row, 'ad', async (token) => {
    const out = [];
    let next = `${G()}/${reportRunId}/insights`;
    let opts = auth(token, { limit: PAGE_LIMIT });
    let more = false;
    for (let i = 0; i < MAX_PAGES && next; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const { data } = await http.get(next, opts);
      out.push(...(data?.data || []));
      next = data?.paging?.next || '';
      opts = { headers: { Authorization: `Bearer ${token}` } };
      more = !!next;
    }
    return { rows: out, truncated: more };
  });
}

function failRun(run, error) {
  run.status = 'failed';
  run.error = error;
  logger.warn('ads report: async run failed', { businessId: run.businessId, code: error.code, error: error.message });
  return error;
}

async function pollRun(row, run) {
  if (run.status === 'done') return { mode: 'async', run: presentRun(run), report: run.report };
  if (run.status === 'failed') throw run.error;
  if (Date.now() - run.createdAt > RUN_TIMEOUT_MS()) {
    run.status = 'timeout';
    throw failRun(run, new AdsError('Meta is taking too long to prepare this report. Try a shorter date range, a higher level or fewer breakdowns.', {
      status: 504, code: 'REPORT_TIMEOUT',
    }));
  }
  if (Date.now() - run.lastPoll < POLL_MIN_MS()) return { mode: 'async', run: presentRun(run) };
  run.lastPoll = Date.now();
  for (const job of run.jobs) {
    if (job.done) continue;
    let s;
    try {
      // eslint-disable-next-line no-await-in-loop
      s = await withAdsToken(row, 'ad', async (token) => (await http.get(`${G()}/${job.reportRunId}`, auth(token, { fields: RUN_FIELDS }))).data);
    } catch (e) {
      // A rate limit leaves the run going (the browser polls again later); anything else ends it.
      if (e.code !== 'RATE_LIMITED') failRun(run, e);
      throw e;
    }
    if (s?.account_id && actNumber(s.account_id) !== actNumber(row.adAccountId)) {
      throw failRun(run, new AdsError('That report isn’t part of your connected ad account.', { status: 404, code: 'NOT_IN_ACCOUNT' }));
    }
    job.status = String(s?.async_status || '');
    job.percent = Math.max(0, Math.min(100, num(s?.async_percent_completion)));
    if (job.status === 'Job Completed') job.done = true;
    else if (job.status === 'Job Failed' || job.status === 'Job Skipped') {
      const why = s?.error_user_msg || s?.error_message || (job.status === 'Job Skipped' ? 'The job expired before it ran.' : 'Review the report and try again.');
      throw failRun(run, new AdsError(`Meta couldn’t prepare this report: ${why}`, {
        status: 502, code: 'REPORT_FAILED', meta: { code: s?.error_code ?? null, subcode: s?.error_subcode ?? null, message: String(why) },
      }));
    }
  }
  run.percent = Math.round(run.jobs.reduce((t, j) => t + (j.done ? 100 : j.percent || 0), 0) / run.jobs.length);
  if (!run.jobs.every((j) => j.done)) return { mode: 'async', run: presentRun(run) };
  try {
    const { plan, query } = run;
    const cur = await readRun(row, run.jobs[0].reportRunId);
    const prev = run.jobs[1] ? await readRun(row, run.jobs[1].reportRunId) : null;
    const tot = { refresh: query.refresh, maxPages: 1 };
    const [totals, prevTotals] = await Promise.all([
      plan.needTotals ? graphList(row, plan.path, { ...plan.totalParams, ...plan.rangeParams }, tot) : null,
      plan.prev && plan.needTotals ? graphList(row, plan.path, { ...plan.totalParams, ...plan.prevParams }, tot) : null,
    ]);
    const report = buildReport(row, query, plan, {
      cur: cur.rows,
      totals: plan.needTotals ? totals?.[0] : cur.rows[0],
      prev: prev?.rows || null,
      prevTotals: plan.prev ? (plan.needTotals ? prevTotals?.[0] : prev?.rows?.[0]) : null,
      source: 'async',
      truncated: cur.truncated,
    });
    run.status = 'done';
    run.percent = 100;
    run.report = report;
    remember(run.key, report);
    return { mode: 'async', run: presentRun(run), report };
  } catch (e) {
    if (e.code !== 'RATE_LIMITED') failRun(run, e);
    throw e;
  }
}

// ------------------------------------------------------------- services --

async function runReport(businessId, query) {
  const row = await requireAdsRow(businessId);
  if (query.parentId) await assertInAccount(row, query.parentId, query.refresh);
  const plan = planOf(row, query);
  const key = keyOf(row, query);
  if (!query.refresh) {
    const hit = cachedReport(key);
    if (hit) return { mode: 'sync', cached: true, report: hit };
    sweepRuns();
    const pending = [...runs.values()].find((r) => r.key === key && r.status === 'running');
    if (pending) return pollRun(row, pending);
  }
  const estimatedRows = estimateRows(query, plan.dates);
  if (query.mode === 'async' || (query.mode === 'auto' && estimatedRows > asyncRowThreshold())) {
    return startRun(row, query, plan, key, estimatedRows, query.mode === 'async' ? 'requested' : 'large');
  }
  let report;
  try {
    report = await syncReport(row, query, plan);
  } catch (e) {
    if (query.mode === 'auto' && tooMuchData(e)) return startRun(row, query, plan, key, estimatedRows, 'too_much_data');
    throw e;
  }
  if (query.mode === 'auto' && query.breakdown === 'device' && !report.rows.length && report.deliveredImpressions > 0) {
    return startRun(row, query, plan, key, estimatedRows, 'device_async_only');
  }
  remember(key, report);
  return { mode: 'sync', report };
}

/** GET /meta/reports/insights: { mode: 'sync', report } or { mode: 'async', run } (poll reportRun). */
export async function insightsReport(businessId, q = {}) {
  return runReport(businessId, parseReportQuery(q));
}

/** GET /meta/reports/runs/:id: the run's progress, and the report once Meta has finished it. */
export async function reportRun(businessId, runId) {
  const row = await requireAdsRow(businessId);
  sweepRuns();
  const run = runs.get(String(runId || ''));
  if (!run || run.businessId !== String(businessId) || run.adAccountId !== row.adAccountId) {
    throw new AdsError('That report isn’t available any more. Run it again.', { status: 404, code: 'RUN_NOT_FOUND' });
  }
  return pollRun(row, run);
}

// ------------------------------------------------------------------ CSV --

/** A report → CSV text (raw numbers; names and labels through csvCell, so no cell can start a formula). */
export function reportToCsv(report) {
  const money = (c) => (c.format === 'money' && report.currency ? ` (${report.currency})` : '');
  const labelCols = [];
  if (report.level !== 'account') labelCols.push(report.headers[0].label, `${report.headers[0].label} ID`);
  for (const h of report.headers) if (h.key !== 'object' && h.key !== 'date') labelCols.push(h.label);
  if (report.kind === 'time') labelCols.push('Date start', 'Date end');
  // A plain total (account, no breakdown) is one row: it gets a "Dates" column instead of a Total line.
  const single = !labelCols.length;
  const head = single ? ['Dates'] : [...labelCols];
  for (const c of report.columns) {
    head.push(`${c.label}${money(c)}`);
    if (report.compare) head.push(`${c.label} previous period${money(c)}`, `${c.label} change %`);
  }
  // Numbers stay numbers; every text cell goes through csvCell (quoted, no leading = + - @).
  const line = (cells) => cells.map((v) => (v === null || v === undefined ? '' : typeof v === 'number' ? String(v) : csvCell(v))).join(',');
  const valueCells = (values, previous, delta) => report.columns.flatMap((c) => (report.compare
    ? [values?.[c.id] ?? null, previous?.[c.id] ?? null, delta?.[c.id]?.pct ?? null]
    : [values?.[c.id] ?? null]));
  const lines = [line(head)];
  if (single) {
    lines.push(line([`${report.range.since} – ${report.range.until}`, ...valueCells(report.totals.values, report.totals.previous, report.totals.delta)]));
  } else {
    for (const r of report.rows) {
      const cells = [];
      if (report.level !== 'account') cells.push(r.object?.name || '', r.object?.id || '');
      for (const d of r.dims) cells.push(d.label);
      if (report.kind === 'time') cells.push(r.date?.start || '', r.date?.stop || '');
      cells.push(...valueCells(r.values, r.previous, r.delta));
      lines.push(line(cells));
    }
    lines.push(line(['Total', ...Array(labelCols.length - 1).fill(''), ...valueCells(report.totals.values, report.totals.previous, report.totals.delta)]));
  }
  const csv = `\uFEFF${lines.join('\r\n')}\r\n`;
  const safe = (s) => String(s || '').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '');
  const filename = `ads-report-${safe(report.level)}-${safe(report.breakdown)}-${safe(report.range.since)}_${safe(report.range.until)}${report.compare ? '-compared' : ''}.csv`;
  return { filename, csv, count: report.rows.length };
}

/** GET /meta/reports/insights.csv: the same report as a file. A large one waits (bounded) for Meta's async run. */
export async function reportCsv(businessId, q = {}) {
  const query = parseReportQuery(q);
  let out = await runReport(businessId, query);
  const deadline = Date.now() + CSV_WAIT_MS();
  while (!out.report) {
    if (Date.now() >= deadline) {
      throw new AdsError('Meta is still preparing this report. Try the download again in a minute.', { status: 504, code: 'REPORT_PENDING' });
    }
    // eslint-disable-next-line no-await-in-loop
    await sleep(Math.max(200, POLL_MIN_MS()));
    // eslint-disable-next-line no-await-in-loop
    out = await reportRun(businessId, out.run.id);
  }
  return reportToCsv(out.report);
}

// --------------------------------------------------------------- health --

export const DISABLE_REASON = {
  0: '', 1: 'Ads integrity policy', 2: 'Intellectual property review', 3: 'Payment risk', 4: 'Account shut down', 5: 'Ads review',
  6: 'Business integrity review', 7: 'Permanently closed', 8: 'Unused reseller account', 9: 'Unused account', 10: 'Umbrella ad account',
  11: 'Business Manager integrity policy', 12: 'Misrepresented ad account', 13: 'Legal entity de-shared', 14: 'Thread review',
  15: 'Compromised ad account',
};
const FUNDING_TYPE = {
  1: 'Credit card', 2: 'Facebook wallet', 3: 'Paid credit', 4: 'Extended credit', 5: 'Order', 6: 'Invoice', 7: 'Facebook token',
  8: 'External funding', 12: 'PayPal', 13: 'PayPal billing agreement', 15: 'External deposit', 17: 'Direct debit', 19: 'Alternative payment',
  20: 'Stored balance',
};
/** Lookups that mean "Meta won't say", not "stop". */
const soft = (e) => e instanceof AdsError && ['PERMISSION_MISSING', 'META_ERROR'].includes(e.code);

/** GET /meta/reports/health: the ad account's billing and status, plus warnings. */
export async function accountHealth(businessId, q = {}) {
  const row = await requireAdsRow(businessId);
  const refresh = String(q.refresh || '') === '1';
  const a = await graphGet(row, row.adAccountId, {
    fields: 'id,name,currency,timezone_name,account_status,disable_reason,amount_spent,spend_cap,balance',
  }, { refresh });
  // The payment method needs the MANAGE task on the ad account; null = unknown.
  let funding = null;
  let fundingKnown = true;
  try {
    funding = await graphGet(row, row.adAccountId, { fields: 'funding_source,funding_source_details' }, { refresh });
  } catch (e) {
    if (!soft(e)) throw e;
    fundingKnown = false;
  }
  // The daily spending limit (adtrust_dsl) isn't documented for every version; unknown when Meta refuses it.
  let dsl = null;
  try {
    const d = await graphGet(row, row.adAccountId, { fields: 'adtrust_dsl' }, { refresh });
    dsl = numOrNull(d?.adtrust_dsl);
  } catch (e) {
    if (!soft(e)) throw e;
  }
  const currency = String(a?.currency || row.adAccountCurrency || '').toUpperCase();
  const status = num(a?.account_status) || num(row.adAccountStatus);
  const reason = num(a?.disable_reason);
  const amountSpent = fromMinor(a?.amount_spent, currency) ?? 0;
  const capRaw = numOrNull(a?.spend_cap);
  const spendCap = capRaw && capRaw > 0 ? fromMinor(capRaw, currency) : null;
  const balance = fromMinor(a?.balance, currency);
  const details = funding?.funding_source_details || null;
  const hasPaymentMethod = fundingKnown ? !!(funding?.funding_source || details?.id) : null;
  const usedPct = spendCap ? Math.round((amountSpent / spendCap) * 1000) / 10 : null;
  const actNum = actNumber(row.adAccountId);
  const warnings = [];
  const closed = status === 100 || status === 101 || status === 202;
  if (status === 2) warnings.push({ code: 'ACCOUNT_DISABLED', tone: 'red', text: `Meta disabled this ad account${DISABLE_REASON[reason] ? ` (${DISABLE_REASON[reason]})` : ''}. Ads don’t run until Meta restores it; check Account Quality in Meta Business Suite.` });
  if (closed) warnings.push({ code: 'ACCOUNT_CLOSED', tone: 'red', text: 'This ad account is closed or closing. Ads don’t run.' });
  if (status === 3 || status === 8) warnings.push({ code: 'PAYMENT_DUE', tone: 'red', text: 'There’s an unpaid balance. Ads stop until it’s paid in Meta billing.' });
  if (status === 9) warnings.push({ code: 'IN_GRACE_PERIOD', tone: 'amber', text: 'A payment failed and the account is in its grace period. Update the payment method in Meta billing.' });
  if (status === 7) warnings.push({ code: 'RISK_REVIEW', tone: 'amber', text: 'Meta is reviewing this account’s payments. Delivery may pause until the review ends.' });
  if (hasPaymentMethod === false && status !== 2 && !closed) warnings.push({ code: 'NO_PAYMENT_METHOD', tone: 'red', text: 'This ad account has no payment method. Meta won’t deliver ads until you add one in Meta billing.' });
  if (hasPaymentMethod === null) warnings.push({ code: 'PAYMENT_METHOD_UNKNOWN', tone: 'gray', text: 'Meta didn’t share the payment method with the CRM (that needs the Manage task on the ad account). Check it in Meta billing.' });
  if (usedPct !== null && usedPct >= 100) warnings.push({ code: 'SPEND_CAP_REACHED', tone: 'red', text: 'The account spending limit is reached, so all ads have stopped. Raise or reset it in Meta billing.' });
  else if (usedPct !== null && usedPct >= 90) warnings.push({ code: 'SPEND_CAP_NEAR', tone: 'amber', text: `${usedPct}% of the account spending limit is used. Ads stop when it’s reached.` });
  return {
    health: {
      account: { id: row.adAccountId, name: a?.name || row.adAccountName || '', currency, timezone: a?.timezone_name || row.adAccountTimezone || '' },
      accountStatus: status,
      accountStatusLabel: ACCOUNT_STATUS[status] || 'Unknown',
      disableReason: reason,
      disableReasonLabel: DISABLE_REASON[reason] || (reason ? `Reason ${reason}` : ''),
      amountSpent,
      spendCap,
      spendCapUsedPct: usedPct,
      spendCapRemaining: spendCap !== null ? Math.max(0, Math.round((spendCap - amountSpent) * 100) / 100) : null,
      balance,
      dailySpendLimit: dsl !== null && dsl > 0 ? dsl : null,
      paymentMethod: {
        known: fundingKnown,
        hasPaymentMethod,
        display: String(details?.display_string || ''),
        type: FUNDING_TYPE[num(details?.type)] || '',
      },
      billingUrl: `https://business.facebook.com/billing_hub/payment_settings/?asset_id=${encodeURIComponent(actNum)}`,
      warnings,
      checkedAt: new Date().toISOString(),
    },
  };
}

export default { insightsReport, reportRun, reportCsv, accountHealth, parseReportQuery, COLUMNS, PRESETS, BREAKDOWNS, LEVELS };

// ------------------------------------------------------- activity history --
// The Overview's "Activity history" markers: the ad account's activity log
// (GET act_/activities, AdActivity: event_time, event_type,
// translated_event_type, object_name, object_type). ads_read is enough.
// Only the date, type, label and object name leave the server (no actor names
// or extra_data).

const ACTIVITY_FIELDS = 'event_time,event_type,translated_event_type,object_id,object_name,object_type';
/** Activity categories for the filter (Meta's own groups, simplified). */
export const ACTIVITY_CATEGORIES = ['budget', 'status', 'targeting', 'schedule', 'creative', 'created', 'billing', 'other'];
export function activityCategory(type) {
  const t = String(type || '');
  if (/billing|funding|charge|refund|payment/.test(t)) return 'billing';
  if (/^create_/.test(t)) return 'created';
  if (/budget|bid|spend_cap|spend_limit|min_spend|spending_limit|lifetime_budget/.test(t)) return 'budget';
  if (/run_status|update_status|review_approved|review_declined|campaign_ended|first_delivery|stop_delivery/.test(t)) return 'status';
  if (/target|audience|optimization_goal|keywords|conversion_goal|conversion_event|delivery_destination/.test(t)) return 'targeting';
  if (/duration|schedul|high_demand/.test(t)) return 'schedule';
  if (/creative|friendly_name|images|_name$|labels/.test(t)) return 'creative';
  return 'other';
}

function tzDate(iso, tz) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  } catch {
    return ymd(d);
  }
}

/** GET /meta/reports/activity?preset…&category=all|budget|…: the edits in the dashboard's range. */
export async function accountActivity(businessId, q = {}) {
  const row = await requireAdsRow(businessId);
  const range = parseRange(q);
  const category = String(q.category || 'all');
  if (category !== 'all' && !ACTIVITY_CATEGORIES.includes(category)) throw new AdsError('Unknown activity category.', { code: 'BAD_CATEGORY' });
  const dates = resolveRange(range, row.adAccountTimezone);
  // since / until narrow Meta's answer; the dates are checked again below.
  const since = Math.floor(Date.parse(`${addDays(dates.since, -1)}T00:00:00Z`) / 1000);
  const until = Math.floor(Date.parse(`${addDays(dates.until, 2)}T00:00:00Z`) / 1000);
  const data = await graphList(row, `${row.adAccountId}/activities`, { fields: ACTIVITY_FIELDS, since, until, limit: 100 }, { refresh: q.refresh === '1', maxPages: 3 });
  const events = (Array.isArray(data) ? data : [])
    .map((a) => {
      const type = String(a.event_type || '');
      return {
        time: String(a.event_time || ''),
        date: tzDate(a.event_time, row.adAccountTimezone),
        type,
        category: activityCategory(type),
        label: String(a.translated_event_type || humanize(type)).slice(0, 120),
        objectName: String(a.object_name || '').slice(0, 200),
        objectType: String(a.object_type || '').toLowerCase().slice(0, 40),
      };
    })
    .filter((e) => e.date && e.date >= dates.since && e.date <= dates.until && (category === 'all' || e.category === category))
    .sort((a, b) => a.time.localeCompare(b.time))
    .slice(0, 300);
  return { range: { preset: range.preset, since: dates.since, until: dates.until }, category, events };
}
