// ---------------------------------------------------------------------------
// CRM notifications (the bell in the top bar and its drawer)
//
// notify() stores one row per event and pushes it live to the tenant's room
// (eventBus → biz:<id>). Chat messages are grouped per conversation: while a
// chat's notification is unread, a new message updates it ("3 new messages
// from Riya") instead of adding a row.
//
// It never throws. A notification is a side effect of something that matters
// more (a customer's message, a payment, an order), so a failure here is
// logged and swallowed, and the caller carries on. Callers fire and forget:
//   notify(...).catch(() => {})
// ---------------------------------------------------------------------------
import Notification from '../models/Notification.js';
import { emitNotification, emitNotificationCount } from './eventBus.js';
import { categoryOf } from './notificationCategories.js';
import { sendPush } from './webPush.js';
import { isMuted } from './chatFlags.js';
import logger from './logger.js';

const TITLE_MAX = 200;
const BODY_MAX = 300;
const clip = (s, n) => {
  const v = String(s ?? '').replace(/\s+/g, ' ').trim();
  return v.length > n ? `${v.slice(0, n - 1)}…` : v;
};
const digits = (s) => String(s || '').replace(/\D/g, '');

/** What the browser gets for one notification. */
export function present(n) {
  return {
    _id: String(n._id),
    type: n.type,
    // The Settings → Manage Notifications row it falls under.
    category: categoryOf(n.type, n.title),
    title: n.title || '',
    body: n.body || '',
    target: {
      view: n.target?.view || '',
      id: n.target?.id || '',
      phone: n.target?.phone || '',
    },
    count: n.count || 1,
    createdAt: n.createdAt || null,
    lastAt: n.lastAt || n.createdAt || null,
    readAt: n.readAt || null,
    read: !!n.readAt,
  };
}

// The bell keeps 7 days. Anything older, read or not, is out of date (the
// chat, order or template it points to has its own page) and is deleted by
// startNotificationPrune; until that runs it's already left out of the list
// and the unread count.
export const KEEP_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
/** The oldest a notification shown in the bell can be. */
export const keptSince = (now = Date.now()) => new Date(now - KEEP_DAYS * DAY_MS);

/** Unread notifications of one tenant (the last 7 days). */
export async function unreadCount(businessId) {
  return Number(await Notification.countDocuments({ businessId: String(businessId), readAt: null, lastAt: { $gte: keptSince() } })) || 0;
}

/** Delete every tenant's notifications older than 7 days, read or not. */
export async function pruneOldNotifications(now = Date.now()) {
  const before = keptSince(now);
  const r = await Notification.deleteMany({
    $or: [{ lastAt: { $lt: before } }, { lastAt: null, createdAt: { $lt: before } }],
  });
  const deleted = r?.deletedCount || 0;
  if (deleted) logger.info('old notifications deleted', { deleted, olderThanDays: KEEP_DAYS });
  return deleted;
}

let pruneTimer = null;
/** Start the sweep: a few minutes after boot, then every 6 hours. */
export function startNotificationPrune() {
  if (pruneTimer) return;
  const run = () => pruneOldNotifications().catch((err) => logger.warn('notification prune failed', { error: err.message }));
  const first = setTimeout(run, 3 * 60 * 1000);
  if (first.unref) first.unref();
  pruneTimer = setInterval(run, 6 * 60 * 60 * 1000);
  if (pruneTimer.unref) pruneTimer.unref();
}

// Writes for one (tenant, groupKey) run one after another, so two messages
// arriving together can't both miss the unread row and create two. One
// backend process, so an in-process chain is enough.
const chains = new Map();
function serialize(key, fn) {
  const prev = chains.get(key) || Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.catch(() => {});
  chains.set(key, tail);
  tail.then(() => {
    if (chains.get(key) === tail) chains.delete(key);
  });
  return run;
}

async function write(bid, { type, title, body, target, groupKey }) {
  const now = new Date();
  const titleFor = (count) => clip(typeof title === 'function' ? title(count) : title, TITLE_MAX);
  const fields = {
    body: clip(body, BODY_MAX),
    target: {
      view: String(target?.view || ''),
      id: String(target?.id || ''),
      phone: digits(target?.phone),
    },
    lastAt: now,
  };
  if (groupKey) {
    // Only a row still in the bell: an unread one older than 7 days isn't brought back.
    const open = await Notification.findOne({ businessId: bid, groupKey, readAt: null, lastAt: { $gte: keptSince() } }).sort({ lastAt: -1 }).lean();
    if (open) {
      const count = (Number(open.count) || 1) + 1;
      const updated = await Notification.findOneAndUpdate(
        { _id: open._id, businessId: bid, readAt: null },
        { $set: { ...fields, type, title: titleFor(count), count } },
        { new: true },
      ).lean();
      // Marked read in between: start a new row instead.
      if (updated) return updated;
    }
  }
  const doc = await Notification.create({
    businessId: bid, type, title: titleFor(1), groupKey: groupKey || '', count: 1, ...fields,
  });
  return doc.toObject ? doc.toObject() : doc;
}

/**
 * Store a notification for one tenant and push it to their open CRM tabs.
 *
 * @param {string} businessId
 * @param {object} n
 * @param {string} n.type        e.g. 'template_approved', 'message', 'order_new'
 * @param {string|((count:number)=>string)} n.title  a function for grouped rows
 * @param {string} [n.body]
 * @param {{view?:string,id?:string,phone?:string}} [n.target] what a click opens
 * @param {string} [n.groupKey]  merge into this key's unread row ('chat:<phone>')
 * @returns {Promise<object|null>} the presented notification, or null
 */
export async function notify(businessId, n = {}) {
  const bid = businessId ? String(businessId) : '';
  if (!bid || !n.type) return null;
  try {
    const run = () => write(bid, n);
    const doc = n.groupKey ? await serialize(`${bid}|${n.groupKey}`, run) : await run();
    const notification = present(doc);
    const unread = await unreadCount(bid);
    emitNotification(bid, { notification, unread });
    // Desktop notifications for browsers with no CRM tab open (Web Push).
    sendPush(bid, notification).catch(() => {});
    return notification;
  } catch (err) {
    logger.warn('notification not saved', { type: n.type, businessId: bid, error: err.message });
    return null;
  }
}

// ------------------------------------------------------------ helpers --

const MEDIA_LABEL = {
  image: '📷 Photo',
  video: '🎥 Video',
  audio: '🎵 Audio',
  voice: '🎵 Voice message',
  document: '📄 Document',
  sticker: 'Sticker',
  location: '📍 Location',
  contacts: '👤 Contact',
  order: '🧾 Order',
  flow_reply: '📝 Form submitted',
};

/**
 * A customer wrote in: one unread row per chat, updated per message.
 * `isNew`: their first message ever to this business (a new chat).
 */
export async function notifyChatMessage(businessId, { phone, name, type, body, isNew = false }) {
  const p = digits(phone);
  if (!p) return null;
  // Muted from the chat's ⋮ menu: no bell row, sound, pop-up or push. The
  // message itself and its unread count still arrive.
  if (!isNew && (await isMuted(businessId, p))) return null;
  const who = String(name || '').trim() || `+${p}`;
  const preview = String(body || '').trim() || MEDIA_LABEL[type] || 'New message';
  return notify(businessId, {
    type: isNew ? 'chat_new' : 'message',
    title: (count) => (count > 1 ? `${count} new messages from ${who}` : isNew ? `New chat from ${who}` : `New message from ${who}`),
    body: preview,
    target: { view: 'chats', phone: p },
    groupKey: `chat:${p}`,
  });
}

/** The owner opened a chat: its message notification is read. */
export async function markChatRead(businessId, phone) {
  const bid = businessId ? String(businessId) : '';
  const p = digits(phone);
  if (!bid || !p) return 0;
  try {
    const res = await Notification.updateMany(
      { businessId: bid, groupKey: `chat:${p}`, readAt: null },
      { $set: { readAt: new Date() } },
    );
    const n = res.modifiedCount || 0;
    if (n) emitNotificationCount(bid, await unreadCount(bid));
    return n;
  } catch (err) {
    logger.warn('could not mark chat notification read', { businessId: bid, error: err.message });
    return 0;
  }
}

const humanReason = (r) => {
  const s = String(r || '').trim();
  if (!s || s === 'NONE') return '';
  return /^[A-Z0-9_]+$/.test(s) ? s.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase()) : s;
};

/**
 * A template's status changed at Meta (webhook or the list sync). Only a real
 * change notifies: same status as before, or a status nobody needs to hear
 * about (PENDING, IN_APPEAL…), does nothing.
 */
export function notifyTemplateStatus(businessId, { name, previous, status, reason }) {
  const s = String(status || '').toUpperCase();
  if (!name || !s || String(previous || '').toUpperCase() === s) return Promise.resolve(null);
  const why = humanReason(reason);
  const q = `“${name}”`;
  const notice = {
    APPROVED: { type: 'template_approved', title: 'Template approved', body: `${q} is approved and ready to send.` },
    REJECTED: { type: 'template_rejected', title: 'Template rejected', body: `${q} was rejected${why ? `: ${why}` : '.'}` },
    PAUSED: { type: 'template_paused', title: 'Template paused', body: `${q} was paused by Meta${why ? `: ${why}` : '.'}` },
    DISABLED: { type: 'template_paused', title: 'Template disabled', body: `${q} was disabled by Meta${why ? `: ${why}` : '.'}` },
  }[s];
  if (!notice) return Promise.resolve(null);
  return notify(businessId, { ...notice, target: { view: 'templates', id: name } });
}

export const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

export default {
  notify, notifyChatMessage, markChatRead, notifyTemplateStatus, unreadCount, present, money,
  KEEP_DAYS, keptSince, pruneOldNotifications, startNotificationPrune,
};
