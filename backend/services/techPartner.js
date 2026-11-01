// Meta Tech Partner eligibility, from the CRM's own records (admin panel).
//
// Meta's upgrade requirements (developers.facebook.com/docs/whatsapp/
// solution-providers/upgrade-to-tech-partner):
//   1. ≥ 2,500 WhatsApp messages a day, sent or received, averaged over the
//      last 7 days (≈ 17,500 in 7 days);
//   2. ≥ 10 active clients: businesses that used the app to send at least one
//      message in the last 30 days;
//   3. a business phone number quality rating of 90% or better.
//
// Meta keeps the official figures in the App Dashboard (WhatsApp → Quickstart
// → Become a Partner); these are the CRM's own counts, to see the progress.
// For 3, Meta doesn't publish the formula: here it is the share of rated
// client numbers whose quality rating is High (GREEN). Numbers Meta hasn't
// rated yet (UNKNOWN) are listed but left out of the percentage.
import { query } from '../db/pool.js';
import Business from '../models/Business.js';
import Message from '../models/Message.js';
import { isWhatsAppConnected } from './sandbox.js';
import { getNumberStatus } from './metaAccount.js';
import { otherSubscribedApps } from './otherApps.js';
import { dayKeys, istStart, TZ } from './platformDashboard.js';

export const TARGETS = { messagesPerDay: 2500, activeClients: 10, qualityPct: 90 };
const DAY = 24 * 60 * 60 * 1000;
const num = (v) => Number(v) || 0;
const dayCol = (col) => `to_char(${col} AT TIME ZONE '${TZ}', 'YYYY-MM-DD')`;

// WhatsApp only (Messenger / Instagram rows carry their channel), and only
// messages that went out or came in (Meta refused the failed ones).
const WHATSAPP = `COALESCE(channel, '') IN ('', 'whatsapp')`;
const DELIVERED = `NOT (direction = 'out' AND status = 'failed')`;
// A client's own number: not the shared test number the CRM lends to new sign-ups.
const NOT_SANDBOX = `(raw->>'sandbox') IS DISTINCT FROM 'true'`;

const QUALITY = ['GREEN', 'YELLOW', 'RED'];
const up = (s) => String(s || '').trim().toUpperCase();

/** Everything the page needs from the database and Meta (read-only). */
export async function fetchTechPartnerRaw(now = new Date(), { refresh = false } = {}) {
  // The 7 complete India-time days before today, plus today so far.
  const days = dayKeys(now, 8);
  const from = istStart(days[0]);
  const since30 = new Date(now.getTime() - 30 * DAY);
  const M = Message.table;
  const B = Business.table;
  const rows = (sql, params) => query(sql, params).then((r) => r.rows);

  const [daily, perBusiness, active, businesses] = await Promise.all([
    rows(`SELECT ${dayCol('created_at')} AS k,
                 count(*) FILTER (WHERE direction = 'out') AS sent,
                 count(*) FILTER (WHERE direction = 'in') AS received
            FROM ${M}
           WHERE created_at >= $1 AND ${WHATSAPP} AND ${DELIVERED}
           GROUP BY 1`, [from]),
    // Each client's own volume over the same 7 days (for the numbers table).
    rows(`SELECT business_id, count(*) AS n
            FROM ${M}
           WHERE created_at >= $1 AND created_at < $2 AND ${WHATSAPP} AND ${DELIVERED}
             AND business_id IS NOT NULL AND business_id <> ''
           GROUP BY 1`, [from, istStart(days[7])]),
    // Active clients: sent at least one message of their own in 30 days.
    rows(`SELECT m.business_id, b.name, count(*) AS sent, max(m.created_at) AS last_sent
            FROM ${M} m JOIN ${B} b ON b.id = m.business_id
           WHERE m.created_at >= $1 AND m.direction = 'out' AND m.status <> 'failed'
             AND ${WHATSAPP.replace('channel', 'm.channel')} AND ${NOT_SANDBOX.replace('raw', 'm.raw')}
           GROUP BY 1, 2
           ORDER BY 4 DESC`, [since30]),
    Business.find().sort({ createdAt: -1 }).lean(),
  ]);

  // Each client number's quality rating, live from Meta (cached 5 minutes per
  // number), else the snapshot stored when it was connected.
  const connected = businesses.filter((b) => isWhatsAppConnected(b));
  const numbers = await Promise.all(connected.map(async (b) => {
    const [s, other] = await Promise.all([
      getNumberStatus(b, { refresh }).catch(() => null),
      otherSubscribedApps(b, { refresh }).catch(() => null),
    ]);
    const live = s?.number || null;
    return {
      businessId: String(b._id),
      name: b.name || '',
      active: b.active !== false,
      displayPhoneNumber: live?.displayPhoneNumber || b.meta?.displayPhoneNumber || '',
      qualityRating: up(live?.qualityRating) || up(b.meta?.qualityRating) || 'UNKNOWN',
      qualityLive: !!live && !s?.stale,
      status: up(live?.status) || up(b.meta?.numberStatus),
      limit: s?.limit?.label || '',
      error: s?.error || '',
      // Other Meta apps on the WhatsApp account: they can hold chats away from us.
      otherApps: other?.ok ? other.apps : [],
    };
  }));

  return { now, days, daily, perBusiness, active, numbers };
}

/** Shape the raw numbers into the page's data. Pure. */
export function assembleTechPartner(raw) {
  const now = raw.now instanceof Date ? raw.now : new Date(raw.now);
  const days = raw.days || dayKeys(now, 8);
  const byDay = new Map((raw.daily || []).map((r) => [r.k, r]));
  const series = days.map((date) => {
    const r = byDay.get(date);
    return { date, sent: num(r?.sent), received: num(r?.received), total: num(r?.sent) + num(r?.received) };
  });
  const week = series.slice(0, 7);
  const today = series[7] || { date: '', sent: 0, received: 0, total: 0 };
  const total7 = week.reduce((a, d) => a + d.total, 0);
  const avgPerDay = Math.round(total7 / 7);

  const activeList = (raw.active || []).map((r) => ({
    businessId: String(r.business_id),
    name: r.name || '',
    sent30: num(r.sent),
    lastSentAt: r.last_sent ? new Date(r.last_sent).toISOString() : null,
  }));

  const volume = new Map((raw.perBusiness || []).map((r) => [String(r.business_id), num(r.n)]));
  const activeIds = new Set(activeList.map((a) => a.businessId));
  const numbers = (raw.numbers || [])
    .map((n) => ({
      ...n,
      qualityRating: QUALITY.includes(n.qualityRating) ? n.qualityRating : 'UNKNOWN',
      messages7d: volume.get(n.businessId) || 0,
      activeClient: activeIds.has(n.businessId),
    }))
    // Lowest quality first: those are the ones to look at.
    .sort((a, b) => {
      const rank = (q) => ({ RED: 0, YELLOW: 1, UNKNOWN: 3, GREEN: 2 }[q]);
      return rank(a.qualityRating) - rank(b.qualityRating) || b.messages7d - a.messages7d;
    });
  const counts = { GREEN: 0, YELLOW: 0, RED: 0, UNKNOWN: 0 };
  for (const n of numbers) counts[n.qualityRating] += 1;
  const rated = counts.GREEN + counts.YELLOW + counts.RED;
  const qualityPct = rated ? Math.round((counts.GREEN / rated) * 1000) / 10 : null;

  const checks = [
    {
      key: 'messages',
      label: 'WhatsApp messages a day (7-day average)',
      value: avgPerDay,
      target: TARGETS.messagesPerDay,
      met: avgPerDay >= TARGETS.messagesPerDay,
    },
    {
      key: 'activeClients',
      label: 'Active clients (sent a message in the last 30 days)',
      value: activeList.length,
      target: TARGETS.activeClients,
      met: activeList.length >= TARGETS.activeClients,
    },
    {
      key: 'quality',
      label: 'Phone number quality rating (High)',
      value: qualityPct,
      target: TARGETS.qualityPct,
      met: qualityPct !== null && qualityPct >= TARGETS.qualityPct,
    },
  ];

  return {
    generatedAt: now.toISOString(),
    timezone: TZ,
    targets: TARGETS,
    eligible: checks.every((c) => c.met),
    metCount: checks.filter((c) => c.met).length,
    checks,
    messages: {
      daily: week,
      today,
      total7,
      avgPerDay,
      // Still needed over the 7 days to reach the average.
      shortBy7: Math.max(0, TARGETS.messagesPerDay * 7 - total7),
    },
    activeClients: { count: activeList.length, list: activeList },
    quality: { pct: qualityPct, rated, counts, numbers },
  };
}

export async function techPartnerStats(now = new Date(), opts = {}) {
  return assembleTechPartner(await fetchTechPartnerRaw(now, opts));
}

export default { techPartnerStats, assembleTechPartner, fetchTechPartnerRaw, TARGETS };
