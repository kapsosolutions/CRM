// The notification drawer: list, unread count, mark read, clear all. Every query is
// scoped to the signed-in business, so one tenant can never read or mark
// another's notifications (an id from another tenant is simply "not found").
import express from 'express';
import { requireBusiness } from '../middleware/auth.js';
import Notification from '../models/Notification.js';
import { present, unreadCount } from '../services/notifications.js';
import { emitNotificationCount } from '../services/eventBus.js';
import logger from '../services/logger.js';

const router = express.Router();
router.use(requireBusiness);

/** Tenant filter, spread into every query here. */
const owner = (req) => ({ businessId: req.business._id });

const fail = (res, err) => {
  logger.error('notification request failed', { error: err.message });
  res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
};

// Cursor for "older than this row": `<lastAt ISO>_<id>`. The id breaks ties
// between rows stamped in the same millisecond.
const cursorOf = (n) => `${new Date(n.lastAt || n.createdAt).toISOString()}_${String(n._id)}`;
function parseCursor(raw) {
  const s = String(raw || '');
  const i = s.lastIndexOf('_');
  const at = new Date(i > 0 ? s.slice(0, i) : s);
  if (Number.isNaN(at.getTime())) return null;
  return { at, id: i > 0 ? s.slice(i + 1) : '' };
}

// GET /api/notifications?before=<cursor>&limit=20 — newest first.
router.get('/', async (req, res) => {
  try {
    const limit = Math.min(50, Math.max(1, Math.floor(Number(req.query.limit)) || 20));
    const filter = { ...owner(req) };
    if (req.query.before) {
      const c = parseCursor(req.query.before);
      if (!c) return res.status(400).json({ success: false, message: 'Invalid cursor' });
      filter.$or = c.id
        ? [{ lastAt: { $lt: c.at } }, { lastAt: c.at, _id: { $lt: c.id } }]
        : [{ lastAt: { $lt: c.at } }];
    }
    const rows = await Notification.find(filter).sort({ lastAt: -1, _id: -1 }).limit(limit + 1).lean();
    const page = rows.slice(0, limit);
    res.json({
      success: true,
      data: page.map(present),
      nextBefore: rows.length > limit ? cursorOf(page[page.length - 1]) : null,
      unread: await unreadCount(req.business._id),
    });
  } catch (err) {
    fail(res, err);
  }
});

router.get('/unread-count', async (req, res) => {
  try {
    res.json({ success: true, count: await unreadCount(req.business._id) });
  } catch (err) {
    fail(res, err);
  }
});

router.post('/read-all', async (req, res) => {
  try {
    const r = await Notification.updateMany({ ...owner(req), readAt: null }, { $set: { readAt: new Date() } });
    const unread = await unreadCount(req.business._id);
    if (r.modifiedCount) emitNotificationCount(req.business._id, unread);
    res.json({ success: true, updated: r.modifiedCount || 0, unread });
  } catch (err) {
    fail(res, err);
  }
});

// DELETE /api/notifications: "Clear all" in the drawer. Removes every
// notification of this business (read or not); chats, orders and everything
// else they point to stay. The bell drops to 0 in every open tab.
router.delete('/', async (req, res) => {
  try {
    const r = await Notification.deleteMany(owner(req));
    const deleted = r.deletedCount || 0;
    emitNotificationCount(req.business._id, 0);
    logger.info('notifications cleared', { business: req.business.name, deleted });
    res.json({ success: true, deleted, unread: 0 });
  } catch (err) {
    fail(res, err);
  }
});

router.post('/:id/read', async (req, res) => {
  try {
    const id = String(req.params.id || '');
    const row = await Notification.findOne({ _id: id, ...owner(req) }).select('_id readAt').lean();
    if (!row) return res.status(404).json({ success: false, message: 'Notification not found' });
    let changed = false;
    if (!row.readAt) {
      const r = await Notification.updateOne({ _id: id, ...owner(req), readAt: null }, { $set: { readAt: new Date() } });
      changed = !!r.modifiedCount;
    }
    const unread = await unreadCount(req.business._id);
    if (changed) emitNotificationCount(req.business._id, unread);
    res.json({ success: true, unread });
  } catch (err) {
    fail(res, err);
  }
});

export default router;
