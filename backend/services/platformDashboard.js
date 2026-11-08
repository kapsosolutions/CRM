// ---------------------------------------------------------------------------
// Super-admin dashboard: revenue from plan purchases (Razorpay), message
// volume, sign-ups, the spread of plans, paying businesses and active clients.
//
// Days and months are India time (Asia/Kolkata, UTC+05:30, no daylight
// saving), so "today" on the dashboard is the owner's today.
//
// fetchDashboardRaw() only reads (SQL); assembleDashboard() is pure: it fills
// every day / month (zeros included) and shapes the result, so the bucketing
// can be tested without a database. The browser works out the windows
// (this week vs last week, last 30 days vs the 30 before) from the series.
// ---------------------------------------------------------------------------
import { query } from '../db/pool.js';
import Business from '../models/Business.js';
import Message from '../models/Message.js';
import SubscriptionPayment from '../models/SubscriptionPayment.js';
import { planState, TIER_NAMES } from './plans.js';
import { verticalConfig } from './verticals.js';
import { isWhatsAppConnected } from './sandbox.js';

export const TZ = 'Asia/Kolkata';
const IST = '+05:30';
const DAY = 24 * 60 * 60 * 1000;
/** Daily series length: two 30-day windows. */
export const DAYS = 60;
/** Monthly series length: two 6-month windows. */
export const MONTHS = 12;

const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
/** The India-time calendar day of an instant, "YYYY-MM-DD". */
export const istDay = (d) => ymd.format(d);
/** The instant an India-time day ("YYYY-MM-DD") or month ("YYYY-MM") starts. */
export const istStart = (key) => new Date(`${key.length === 7 ? `${key}-01` : key}T00:00:00${IST}`);

/** The last `n` India-time days, oldest first, ending today. */
export function dayKeys(now = new Date(), n = DAYS) {
  const today = istStart(istDay(now)).getTime();
  const out = [];
  // Noon of each day, so the key never slips across midnight.
  for (let i = n - 1; i >= 0; i -= 1) out.push(istDay(new Date(today - i * DAY + 12 * 60 * 60 * 1000)));
  return out;
}

/** The last `n` India-time months, oldest first, ending this month ("YYYY-MM"). */
export function monthKeys(now = new Date(), n = MONTHS) {
  const [y, m] = istDay(now).split('-').map(Number);
  const out = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

const num = (v) => Number(v) || 0;
const dayCol = (col) => `to_char(${col} AT TIME ZONE '${TZ}', 'YYYY-MM-DD')`;
const monthCol = (col) => `to_char(${col} AT TIME ZONE '${TZ}', 'YYYY-MM')`;

/** Every number the dashboard needs, straight from the database (read-only). */
export async function fetchDashboardRaw(now = new Date()) {
  const days = dayKeys(now);
  const months = monthKeys(now);
  const daysFrom = istStart(days[0]);
  const thirtyFrom = istStart(days[DAYS - 30]);
  const monthsFrom = istStart(months[0]);
  const since24h = new Date(now.getTime() - DAY);
  const M = Message.table;
  const B = Business.table;
  const P = SubscriptionPayment.table;
  // "Sent through the app": outgoing, not refused by Meta, from a business.
  const sentByBusiness = `direction = 'out' AND status <> 'failed' AND business_id IS NOT NULL AND business_id <> ''`;

  const rows = (sql, params) => query(sql, params).then((r) => r.rows);
  const [
    msgDaily, msgMonthly, msgTotals, activeDaily, activeWindows, signupsDaily,
    payDaily, payMonthly, payTotals, payByTier, payRecent, payPeriods, businesses,
  ] = await Promise.all([
    rows(`SELECT ${dayCol('created_at')} AS k,
                 count(*) FILTER (WHERE direction = 'out') AS sent,
                 count(*) FILTER (WHERE direction = 'in') AS received
            FROM ${M} WHERE created_at >= $1 GROUP BY 1`, [daysFrom]),
    rows(`SELECT ${monthCol('created_at')} AS k,
                 count(*) FILTER (WHERE direction = 'out') AS sent,
                 count(*) FILTER (WHERE direction = 'in') AS received
            FROM ${M} WHERE created_at >= $1 GROUP BY 1`, [monthsFrom]),
    rows(`SELECT count(*) AS total, count(*) FILTER (WHERE created_at >= $1) AS last24h FROM ${M}`, [since24h]),
    rows(`SELECT ${dayCol('created_at')} AS k, count(DISTINCT business_id) AS n
            FROM ${M} WHERE created_at >= $1 AND ${sentByBusiness} GROUP BY 1`, [daysFrom]),
    rows(`SELECT count(DISTINCT business_id) FILTER (WHERE created_at >= $2) AS cur,
                 count(DISTINCT business_id) FILTER (WHERE created_at < $2) AS prev
            FROM ${M} WHERE created_at >= $1 AND ${sentByBusiness}`, [daysFrom, thirtyFrom]),
    rows(`SELECT ${dayCol('created_at')} AS k, count(*) AS n FROM ${B} WHERE created_at >= $1 GROUP BY 1`, [daysFrom]),
    rows(`SELECT ${dayCol('paid_at')} AS k, count(*) AS n, COALESCE(sum(amount_paise), 0)::float8 AS paise
            FROM ${P} WHERE status = 'paid' AND paid_at >= $1 GROUP BY 1`, [daysFrom]),
    rows(`SELECT ${monthCol('paid_at')} AS k, count(*) AS n, COALESCE(sum(amount_paise), 0)::float8 AS paise
            FROM ${P} WHERE status = 'paid' AND paid_at >= $1 GROUP BY 1`, [monthsFrom]),
    rows(`SELECT count(*) AS n, COALESCE(sum(amount_paise), 0)::float8 AS paise FROM ${P} WHERE status = 'paid'`),
    rows(`SELECT tier, count(*) AS n, COALESCE(sum(amount_paise), 0)::float8 AS paise
            FROM ${P} WHERE status = 'paid' GROUP BY tier`),
    rows(`SELECT p.id, p.business_id, b.name AS business_name, p.tier, p.cycle, p.kind,
                 p.amount_paise, p.paid_at, p.payment_id, p.method
            FROM ${P} p LEFT JOIN ${B} b ON b.id = p.business_id
           WHERE p.status = 'paid'
           ORDER BY p.paid_at DESC NULLS LAST, p.created_at DESC
           LIMIT 8`),
    // Paid periods still running at some point in the window (businesses that
    // were deleted since are left out).
    rows(`SELECT p.business_id, p.starts_at, p.ends_at
            FROM ${P} p JOIN ${B} b ON b.id = p.business_id
           WHERE p.status = 'paid' AND p.starts_at IS NOT NULL AND p.ends_at >= $1`, [daysFrom]),
    Business.find().sort({ createdAt: -1 }).lean(),
  ]);

  return {
    now, msgDaily, msgMonthly, msgTotals: msgTotals[0] || {}, activeDaily, activeWindows: activeWindows[0] || {},
    signupsDaily, payDaily, payMonthly, payTotals: payTotals[0] || {}, payByTier, payRecent, payPeriods, businesses,
  };
}

const PLAN_ORDER = [
  { key: 'premium', label: 'Premium' },
  { key: 'pro', label: 'Pro' },
  { key: 'basic', label: 'Basic' },
  // A bought (or granted) Starter plan; the tier key is still 'free'.
  { key: 'starter', label: 'Starter' },
  { key: 'trial', label: 'Free trial' },
  // Nothing bought: the trial or a plan has ended.
  { key: 'free', label: 'No plan' },
];

/** Which slice of the "Plans" chart a business is in right now. */
export function planSlice(ps) {
  if (!ps) return 'free';
  if (ps.status === 'trial') return 'trial';
  if (ps.status === 'active' || ps.status === 'legacy') {
    if (ps.tier === 'free') return 'starter';
    return ['basic', 'pro', 'premium'].includes(ps.tier) ? ps.tier : 'free';
  }
  return 'free';
}

/**
 * How many businesses had a paid period running on each day: one whose
 * period overlaps that India-time day. `now` counts the ones running now.
 */
export function payingByDay(periods, days, now) {
  const spans = periods
    .map((p) => ({ id: String(p.business_id), s: new Date(p.starts_at).getTime(), e: new Date(p.ends_at).getTime() }))
    .filter((p) => p.id && Number.isFinite(p.s) && Number.isFinite(p.e));
  const daily = days.map((date) => {
    const start = istStart(date).getTime();
    const end = start + DAY;
    return { date, count: new Set(spans.filter((p) => p.s < end && p.e > start).map((p) => p.id)).size };
  });
  const t = now.getTime();
  return { daily, now: new Set(spans.filter((p) => p.s <= t && p.e > t).map((p) => p.id)).size };
}

/** Shape the raw rows: every day / month filled in, India time. Pure. */
export function assembleDashboard(raw) {
  const now = raw.now instanceof Date ? raw.now : new Date(raw.now);
  const days = dayKeys(now);
  const months = monthKeys(now);
  const index = (list) => new Map((list || []).map((r) => [r.k, r]));

  const msgD = index(raw.msgDaily);
  const msgM = index(raw.msgMonthly);
  const actD = index(raw.activeDaily);
  const signD = index(raw.signupsDaily);
  const payD = index(raw.payDaily);
  const payM = index(raw.payMonthly);

  const businesses = raw.businesses || [];
  const plans = PLAN_ORDER.map((p) => ({ ...p, count: 0 }));
  const states = new Map();
  for (const b of businesses) {
    const ps = planState(b, now);
    states.set(String(b._id), ps);
    const slice = plans.find((p) => p.key === planSlice(ps));
    if (slice) slice.count += 1;
  }

  const paying = payingByDay(raw.payPeriods || [], days, now);

  return {
    generatedAt: now.toISOString(),
    timezone: TZ,
    currency: 'INR',
    revenue: {
      totalPaise: num(raw.payTotals?.paise),
      payments: num(raw.payTotals?.n),
      daily: days.map((date) => ({ date, paise: num(payD.get(date)?.paise), count: num(payD.get(date)?.n) })),
      monthly: months.map((month) => ({ month, paise: num(payM.get(month)?.paise), count: num(payM.get(month)?.n) })),
      byTier: ['free', 'basic', 'pro', 'premium'].map((tier) => {
        const r = (raw.payByTier || []).find((x) => x.tier === tier);
        return { tier, name: TIER_NAMES[tier], paise: num(r?.paise), count: num(r?.n) };
      }),
      recent: (raw.payRecent || []).map((p) => ({
        _id: String(p.id),
        businessId: p.business_name ? String(p.business_id) : '',
        businessName: p.business_name || '',
        tier: p.tier,
        name: TIER_NAMES[p.tier] || p.tier,
        cycle: p.cycle,
        kind: p.kind || 'new',
        amountPaise: num(p.amount_paise),
        paidAt: p.paid_at ? new Date(p.paid_at).toISOString() : null,
        paymentId: p.payment_id || '',
        method: p.method || '',
      })),
    },
    messages: {
      total: num(raw.msgTotals?.total),
      last24h: num(raw.msgTotals?.last24h),
      daily: days.map((date) => ({ date, sent: num(msgD.get(date)?.sent), received: num(msgD.get(date)?.received) })),
      monthly: months.map((month) => ({ month, sent: num(msgM.get(month)?.sent), received: num(msgM.get(month)?.received) })),
    },
    businesses: {
      total: businesses.length,
      active: businesses.filter((b) => b.active !== false).length,
      signupsDaily: days.map((date) => ({ date, count: num(signD.get(date)?.n) })),
      recent: businesses.slice(0, 6).map((b) => {
        const ps = states.get(String(b._id));
        return {
          _id: String(b._id),
          name: b.name || '',
          category: verticalConfig(b.category).label,
          active: b.active !== false,
          whatsappConnected: isWhatsAppConnected(b),
          createdAt: b.createdAt ? new Date(b.createdAt).toISOString() : null,
          plan: {
            slice: planSlice(ps),
            // Nothing bought: "No plan" (not "Starter", which is a plan they'd pay for).
            name: !ps || ps.status === 'free' ? 'No plan' : ps.name,
            status: ps?.status || 'free',
            daysLeft: ps?.daysLeft ?? null,
          },
        };
      }),
    },
    plans,
    paying,
    activeClients: {
      current: num(raw.activeWindows?.cur),
      previous: num(raw.activeWindows?.prev),
      daily: days.map((date) => ({ date, count: num(actD.get(date)?.n) })),
    },
  };
}

export async function dashboardStats(now = new Date()) {
  return assembleDashboard(await fetchDashboardRaw(now));
}

export default { dashboardStats, assembleDashboard, fetchDashboardRaw };
