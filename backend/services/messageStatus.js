// Delivery-receipt bookkeeping for outbound messages.
//
// Meta's status webhooks race our own write: a "delivered" receipt can land
// before logOutbound() has saved the message it refers to, and receipts are not
// guaranteed to arrive in order (a late "sent" can follow "read"). So:
//   - statuses only ever move forward (sent → delivered → read), and
//   - a receipt for a message we haven't saved yet is parked briefly and
//     applied when the message is created.

const RANK = { pending: 0, sent: 1, delivered: 2, read: 3 };
const PARK_MS = 5 * 60 * 1000;
const MAX_PARKED = 5000;

/** Would moving from `current` to `next` be a step forward? */
export function isStatusUpgrade(current, next) {
  if (!next || next === current) return false;
  // A failure only counts if the message never reached the phone.
  if (next === 'failed') return (RANK[current] ?? 0) < RANK.delivered;
  if (current === 'failed') return (RANK[next] ?? 0) >= RANK.delivered;
  return (RANK[next] ?? 0) > (RANK[current] ?? 0);
}

/** The further-along of two statuses. */
export function laterStatus(a, b) {
  return isStatusUpgrade(a, b) ? b : a;
}

/** Statuses `next` may replace (used as a Mongo filter so updates stay monotonic). */
export function statusesBelow(next) {
  return ['pending', 'sent', 'delivered', 'read', 'failed'].filter((s) => isStatusUpgrade(s, next));
}

/**
 * Meta's reason from a `failed` receipt (`statuses[].errors[0]`), in the shape
 * stored on Message.error: { code, title, message, details }.
 */
export function statusError(status) {
  const e = Array.isArray(status?.errors) ? status.errors[0] : null;
  if (!e) return null;
  return {
    code: e.code ?? null,
    title: String(e.title || ''),
    message: String(e.message || e.title || ''),
    details: String(e.error_data?.details || ''),
  };
}

const parked = new Map(); // metaMessageId -> { status, error, at }

/** Remember a receipt that arrived before its message was saved. */
export function parkStatus(metaMessageId, status, error = null) {
  if (!metaMessageId || !status) return;
  const prev = parked.get(metaMessageId);
  const next = laterStatus(prev?.status, status);
  // A failure's reason travels with it, so it isn't lost while parked.
  let err = null;
  if (next === status) err = status === 'failed' ? error : null;
  else err = prev?.error || null;
  parked.set(metaMessageId, { status: next, error: err || null, at: Date.now() });
  if (parked.size > MAX_PARKED) {
    const cutoff = Date.now() - PARK_MS;
    for (const [id, v] of parked) if (v.at < cutoff) parked.delete(id);
    // Still too many (a flood): drop the oldest.
    while (parked.size > MAX_PARKED) parked.delete(parked.keys().next().value);
  }
}

/** Collect (and forget) a parked receipt: { status, error } or null. */
export function takeParked(metaMessageId) {
  if (!metaMessageId) return null;
  const v = parked.get(metaMessageId);
  parked.delete(metaMessageId);
  if (!v || Date.now() - v.at > PARK_MS) return null;
  return { status: v.status, error: v.error || null };
}

/** Collect (and forget) a parked receipt for a message being saved now. */
export function takeParkedStatus(metaMessageId) {
  return takeParked(metaMessageId)?.status || null;
}
