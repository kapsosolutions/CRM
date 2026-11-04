// ---------------------------------------------------------------------------
// Campaign numbers, all computed from stored data
//
//   • per-campaign delivery counts: the recipients' send state on the
//     Campaign row (queued / refused by Meta) plus the status of each Message
//     the campaign sent, which the status webhook moves sent → delivered →
//     read, or to failed with Meta's reason. Nothing counts as delivered
//     until Meta says so.
//   • daily limit usage: unique customers sent a template in the last
//     rolling 24 hours (templates are the business-initiated messages Meta's
//     messaging limit counts).
//   • sending streak: consecutive days, up to today, with at least one
//     outbound message that didn't fail.
//
// The model layer has no aggregate(), so this is parameterized SQL.
// ---------------------------------------------------------------------------
import { query } from '../db/pool.js';
import Campaign from '../models/Campaign.js';
import Message from '../models/Message.js';

const C = `"${Campaign.table}"`;
const M = `"${Message.table}"`;
const DAY_MS = 24 * 60 * 60 * 1000;
// A message's status as a rank (read > delivered > sent > failed), so the
// best one reached per number can be taken with max().
const RANK_SQL = `CASE status WHEN 'read' THEN 3 WHEN 'delivered' THEN 2 WHEN 'failed' THEN 0 ELSE 1 END`;
// The campaign's main message (not a drip follow-up).
const MAIN_SQL = `(raw ->> 'dripStep') IS NULL`;
// A message from the number this long after the campaign's counts as a reply.
export const REPLY_DAYS = 7;

const emptyStats = (total = 0) => ({
  total, accepted: 0, delivered: 0, read: 0, failed: 0, pending: 0, sentOnly: 0, replied: 0, cancelled: 0, skipped: 0,
});

/**
 * Delivery counts for a set of campaigns, cumulative by the furthest status
 * reached:
 *   accepted  — Meta accepted the send (it has a message id)
 *   delivered — delivered or read
 *   read
 *   failed    — refused by Meta at send time, or a `failed` receipt later
 *   pending   — not sent yet (queued)
 *   sentOnly  — accepted, no delivered/read/failed receipt yet
 *   replied   — recipients who wrote back after the campaign message
 *   cancelled — never sent because the campaign was cancelled
 *
 * @param {string} businessId
 * @param {{_id:string, status:string}[]} campaigns
 * @returns {Promise<Map<string, object>>} campaign id → stats
 */
export async function campaignStats(businessId, campaigns) {
  const out = new Map();
  if (!campaigns.length) return out;
  const ids = campaigns.map((c) => String(c._id));
  const bid = String(businessId);

  const [recips, msgs, replies] = await Promise.all([
    query(
      `SELECT c.id,
              count(*) FILTER (WHERE r.value ->> 'state' = 'queued')::int AS queued,
              count(*) FILTER (WHERE r.value ->> 'state' = 'sent')::int AS sent,
              count(*) FILTER (WHERE r.value ->> 'state' = 'failed')::int AS refused,
              count(*) FILTER (WHERE r.value ->> 'state' = 'skipped')::int AS skipped,
              count(r.value)::int AS total
         FROM ${C} c
         LEFT JOIN LATERAL json_array_elements(
                CASE WHEN json_typeof(c.recipients) = 'array' THEN c.recipients ELSE '[]'::json END
              ) AS r(value) ON true
        WHERE c.business_id = $1 AND c.id = ANY($2::text[])
        GROUP BY c.id`,
      [bid, ids],
    ),
    // Each number once, at the best status any of its rows reached (a number
    // that somehow has two rows isn't counted twice). Drip follow-ups have
    // their own counts (dripProgress) and stay out of these.
    query(
      `SELECT campaign_id, status, count(*)::int AS n
         FROM (SELECT campaign_id, phone,
                      CASE max(${RANK_SQL}) WHEN 3 THEN 'read' WHEN 2 THEN 'delivered' WHEN 0 THEN 'failed' ELSE 'sent' END AS status
                 FROM ${M}
                WHERE business_id = $1 AND campaign_id = ANY($2::text[]) AND direction = 'out' AND ${MAIN_SQL}
                GROUP BY campaign_id, phone) best
        GROUP BY 1, 2`,
      [bid, ids],
    ),
    query(
      `SELECT m.campaign_id, count(DISTINCT m.phone)::int AS n
         FROM ${M} m
        WHERE m.business_id = $1 AND m.campaign_id = ANY($2::text[]) AND m.direction = 'out' AND ${MAIN_SQL.replace(/raw/g, 'm.raw')}
          AND EXISTS (SELECT 1 FROM ${M} i
                       WHERE i.business_id = $1 AND i.phone = m.phone
                         AND i.direction = 'in' AND i.created_at > m.created_at
                         AND i.created_at < m.created_at + interval '${REPLY_DAYS} days')
        GROUP BY 1`,
      [bid, ids],
    ),
  ]);

  const byStatus = new Map(); // id -> { sent, delivered, read, failed }
  for (const row of msgs.rows) {
    const m = byStatus.get(row.campaign_id) || { sent: 0, delivered: 0, read: 0, failed: 0 };
    const k = ['delivered', 'read', 'failed'].includes(row.status) ? row.status : 'sent';
    m[k] += row.n;
    byStatus.set(row.campaign_id, m);
  }
  const replied = new Map(replies.rows.map((r) => [r.campaign_id, r.n]));
  const statusOf = new Map(campaigns.map((c) => [String(c._id), c.status]));

  for (const r of recips.rows) {
    const m = byStatus.get(r.id) || { sent: 0, delivered: 0, read: 0, failed: 0 };
    const s = emptyStats(r.total);
    s.accepted = r.sent;
    s.read = m.read;
    s.delivered = m.delivered + m.read;
    s.failed = r.refused + m.failed;
    // Accepted but no receipt yet. A send whose Message row is missing still
    // lands here rather than being counted as delivered.
    s.sentOnly = Math.max(0, r.sent - s.delivered - m.failed);
    if (statusOf.get(r.id) === 'cancelled') s.cancelled = r.queued;
    else s.pending = r.queued;
    s.replied = replied.get(r.id) || 0;
    // Messenger / Instagram: outside the 24-hour window when their turn came.
    s.skipped = r.skipped || 0;
    out.set(r.id, s);
  }
  for (const id of ids) if (!out.has(id)) out.set(id, emptyStats());
  return out;
}

/**
 * One campaign's recipients with their real delivery state:
 * [{ phone, name, status, error, sentAt, replied }], where status is
 * pending | cancelled | sent | delivered | read | failed | skipped (Messenger /
 * Instagram, outside the 24-hour window) and error is Meta's
 * { code, title, message, details } for a failure.
 */
export async function campaignResults(businessId, campaign) {
  const bid = String(businessId);
  const id = String(campaign._id);
  const [msgs, replies] = await Promise.all([
    query(
      `SELECT meta_message_id, phone, status, error, created_at
         FROM ${M}
        WHERE business_id = $1 AND campaign_id = $2 AND direction = 'out' AND ${MAIN_SQL}
        ORDER BY created_at`,
      [bid, id],
    ),
    query(
      `SELECT DISTINCT m.phone
         FROM ${M} m
        WHERE m.business_id = $1 AND m.campaign_id = $2 AND m.direction = 'out' AND ${MAIN_SQL.replace(/raw/g, 'm.raw')}
          AND EXISTS (SELECT 1 FROM ${M} i
                       WHERE i.business_id = $1 AND i.phone = m.phone
                         AND i.direction = 'in' AND i.created_at > m.created_at
                         AND i.created_at < m.created_at + interval '${REPLY_DAYS} days')`,
      [bid, id],
    ),
  ]);
  const byWamid = new Map();
  const byPhone = new Map();
  for (const row of msgs.rows) {
    if (row.meta_message_id) byWamid.set(row.meta_message_id, row);
    byPhone.set(row.phone, row);
  }
  const repliedPhones = new Set(replies.rows.map((r) => r.phone));
  const list = Array.isArray(campaign.recipients) ? campaign.recipients : [];
  return list.map((r) => {
    const base = {
      phone: r.phone, name: r.name || '', status: 'pending', error: null, sentAt: null, replied: false, ...(r.via ? { via: r.via } : {}),
    };
    if (r.state === 'failed') return { ...base, status: 'failed', error: r.error || null };
    if (r.state === 'skipped') return { ...base, status: 'skipped', error: r.error || null };
    if (r.state !== 'sent') return { ...base, status: campaign.status === 'cancelled' ? 'cancelled' : 'pending' };
    const m = (r.metaMessageId && byWamid.get(r.metaMessageId)) || byPhone.get(r.phone);
    const st = m && ['delivered', 'read', 'failed'].includes(m.status) ? m.status : 'sent';
    return {
      ...base,
      status: st,
      error: st === 'failed' ? m?.error || null : null,
      sentAt: m?.created_at || null,
      replied: repliedPhones.has(r.phone),
    };
  });
}

/**
 * Drip campaigns: how each follow-up is doing. For follow-up n (1-based):
 *   sent / failed — went out / Meta refused it
 *   delivered / read — from Meta's receipts for those messages
 *   waiting — numbers whose next message this is, not due yet
 *   stopped — numbers that replied before it (stop on reply)
 * Plus when the next one is due.
 */
export async function dripProgress(businessId, campaign) {
  const steps = Array.isArray(campaign?.drip?.steps) ? campaign.drip.steps : [];
  if (campaign?.type !== 'drip' || !steps.length) return null;
  const { rows } = await query(
    `SELECT step, status, count(*)::int AS n
       FROM (SELECT (raw ->> 'dripStep')::int AS step, phone,
                    CASE max(${RANK_SQL}) WHEN 3 THEN 'read' WHEN 2 THEN 'delivered' WHEN 0 THEN 'failed' ELSE 'sent' END AS status
               FROM ${M}
              WHERE business_id = $1 AND campaign_id = $2 AND direction = 'out' AND (raw ->> 'dripStep') IS NOT NULL
              GROUP BY 1, 2) best
      GROUP BY 1, 2`,
    [String(businessId), String(campaign._id)],
  );
  const receipts = new Map(); // step -> { delivered, read, failed }
  for (const r of rows) {
    const m = receipts.get(r.step) || { delivered: 0, read: 0, failed: 0 };
    if (r.status === 'read') { m.read += r.n; m.delivered += r.n; } else if (r.status === 'delivered') m.delivered += r.n;
    else if (r.status === 'failed') m.failed += r.n;
    receipts.set(r.step, m);
  }
  const list = Array.isArray(campaign.recipients) ? campaign.recipients : [];
  let nextAt = null;
  const out = steps.map((s, k) => {
    const p = { step: k + 1, templateName: s.templateName, delayMs: Number(s.delayMs) || 0, sent: 0, failed: 0, delivered: 0, read: 0, waiting: 0, stopped: 0 };
    for (const r of list) {
      const d = r.drip;
      if (!d) {
        // Got the main message, the drip hasn't started yet: waiting for follow-up 1.
        if (k === 0 && r.state === 'sent') p.waiting += 1;
        continue;
      }
      const res = d.results?.[k];
      if (res?.state === 'sent') p.sent += 1;
      else if (res?.state === 'failed' || res?.state === 'skipped') p.failed += 1;
      else if (d.next === k && d.stopped === 'replied') p.stopped += 1;
      else if (d.next === k && !d.done) {
        p.waiting += 1;
        const t = new Date(d.dueAt).getTime();
        if (Number.isFinite(t) && (!nextAt || t < nextAt)) nextAt = t;
      }
    }
    const rc = receipts.get(k + 1);
    if (rc) {
      p.delivered = rc.delivered;
      p.read = rc.read;
      p.failed += rc.failed;
    }
    return p;
  });
  return {
    stopOnReply: !!campaign.drip.stopOnReply,
    steps: out,
    nextAt: nextAt ? new Date(nextAt).toISOString() : null,
  };
}

/**
 * Messaging-limit usage in the last rolling 24 hours: unique customers sent a
 * template (`used24h`) and how many template messages that was (`messages24h`).
 * Failed sends don't count.
 */
//
// Meta's limit is on unique customers reached OUTSIDE their 24-hour customer
// service window. So only templates count, and only those sent to someone who
// hadn't written (or called) in the 24 hours before: replies in a chat, and
// templates to a customer who just wrote, don't use it up. Messenger /
// Instagram and the shared test number aren't this number's limit either.
// `nextFreeAt`: when the first counted customer drops out of the 24 hours.
export async function limitUsage(businessId) {
  const { rows } = await query(
    `WITH counted AS (
       SELECT m.phone, m.created_at
         FROM ${M} m
        WHERE m.business_id = $1 AND m.direction = 'out' AND m.type = 'template'
          AND m.status <> 'failed' AND m.created_at > now() - interval '24 hours'
          AND coalesce(m.channel, '') = '' AND coalesce(m.raw->>'sandbox', '') <> 'true'
          AND NOT EXISTS (
            SELECT 1 FROM ${M} i
             WHERE i.business_id = m.business_id AND i.phone = m.phone AND i.direction = 'in'
               AND i.created_at <= m.created_at AND i.created_at > m.created_at - interval '24 hours'
          )
     ), per AS (
       SELECT phone, max(created_at) AS last_at, count(*) AS n FROM counted GROUP BY phone
     )
     SELECT count(*)::int AS used, coalesce(sum(n), 0)::int AS total, min(last_at) AS first_out FROM per`,
    [String(businessId)],
  );
  const r = rows[0] || {};
  const firstOut = r.first_out ? new Date(r.first_out).getTime() + DAY_MS : 0;
  return {
    used24h: r.used || 0,
    messages24h: r.total || 0,
    nextFreeAt: firstOut ? new Date(firstOut).toISOString() : null,
  };
}

/**
 * Consecutive days of messaging, in the viewer's local calendar.
 *
 * A day is active when the business sent at least one outbound message that
 * didn't fail. `current` counts active days in a row ending today; when
 * nothing has gone out yet today it ends yesterday, so the streak doesn't look
 * broken before the first send of the day. `days` is the last 7 days, oldest
 * first, today last.
 *
 * @param {string} businessId
 * @param {number} tz minutes east of UTC (the browser's -getTimezoneOffset())
 */
export async function sendingStreak(businessId, tz = 0, now = Date.now()) {
  const LOOKBACK = 60;
  const { rows } = await query(
    `SELECT DISTINCT to_char((created_at AT TIME ZONE 'UTC') + make_interval(mins => $2::int), 'YYYY-MM-DD') AS day
       FROM ${M}
      WHERE business_id = $1 AND direction = 'out' AND status <> 'failed'
        AND created_at > $3::timestamptz`,
    [String(businessId), tz, new Date(now - (LOOKBACK + 2) * DAY_MS).toISOString()],
  );
  const active = new Set(rows.map((r) => r.day));
  const dayKey = (back) => new Date(now + tz * 60000 - back * DAY_MS).toISOString().slice(0, 10);

  const start = active.has(dayKey(0)) ? 0 : 1;
  let current = 0;
  while (current < LOOKBACK && active.has(dayKey(start + current))) current += 1;

  const days = [];
  for (let back = 6; back >= 0; back -= 1) days.push({ date: dayKey(back), active: active.has(dayKey(back)) });
  return { current, days };
}

export default { campaignStats, campaignResults, dripProgress, limitUsage, sendingStreak };
