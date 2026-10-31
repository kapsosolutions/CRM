// "Book a demo": a public booking endpoint for the landing page, plus the
// admin panel's Demo Requests list.
import express from 'express';
import DemoRequest from '../models/DemoRequest.js';
import { requireSuperAdmin } from '../middleware/auth.js';
import { VERTICALS } from '../services/verticals.js';
import { slotsFor, dateProblem, calendarWindow, istToDate, istToday, DEMO_TZ } from '../services/demoSlots.js';
import logger from '../services/logger.js';

const router = express.Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const STATUSES = ['scheduled', 'completed', 'not_answered', 'not_interested', 'cancelled'];
const s = (v, max = 200) => String(v ?? '').trim().slice(0, max);

// ------------------------------------------------------------- public --

// The endpoint has no login, so cap how often one address can book. Kept in
// memory: enough to stop a form being hammered from one browser.
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 60 * 60_000);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > 5;
}

router.get('/calendar', (_req, res) => res.json({ success: true, ...calendarWindow() }));

router.get('/slots', async (req, res) => {
  const date = s(req.query.date, 10);
  const problem = dateProblem(date);
  if (problem) return res.json({ success: true, date, slots: [], closed: problem });
  res.json({ success: true, date, timezone: DEMO_TZ, slots: await slotsFor(date) });
});

router.post('/requests', async (req, res) => {
  const b = req.body || {};
  const form = {
    name: s(b.name, 120),
    businessName: s(b.businessName, 160),
    email: s(b.email, 160).toLowerCase(),
    phone: String(b.phone || '').replace(/\D/g, ''),
    category: s(b.category, 40),
    date: s(b.date, 10),
    slot: s(b.slot, 5),
  };
  const errors = {};
  if (!form.name) errors.name = 'Enter your name';
  if (!form.businessName) errors.businessName = 'Enter your business name';
  if (!EMAIL_RE.test(form.email)) errors.email = 'Enter a valid business email';
  if (form.phone.length < 8 || form.phone.length > 15) errors.phone = 'Enter a valid WhatsApp number';
  if (!VERTICALS[form.category]) errors.category = 'Choose your business category';
  const dp = dateProblem(form.date);
  if (dp) errors.date = dp;
  if (Object.keys(errors).length) {
    return res.status(400).json({ success: false, message: Object.values(errors)[0], errors });
  }
  if (rateLimited(req.ip)) {
    return res.status(429).json({ success: false, message: 'Too many bookings from this connection. Please try again later.' });
  }

  try {
    const slot = (await slotsFor(form.date)).find((x) => x.slot === form.slot);
    if (!slot) return res.status(400).json({ success: false, message: 'Choose a time', errors: { slot: 'Choose a time' } });
    if (slot.left <= 0) {
      return res.status(409).json({ success: false, message: 'That time was just taken. Please pick another one.', errors: { slot: 'Full' } });
    }
    // One upcoming demo per email: a second booking moves the first.
    const existing = await DemoRequest.findOne({ email: form.email, status: 'scheduled', date: { $gte: istToday() } });
    const fields = { ...form, timezone: DEMO_TZ, scheduledAt: istToDate(form.date, form.slot) };
    let doc;
    if (existing) {
      Object.assign(existing, fields);
      doc = await existing.save();
    } else {
      doc = await DemoRequest.create({ ...fields, status: 'scheduled', source: 'landing' });
    }
    logger.info('demo booked', { email: form.email, date: form.date, slot: form.slot, rescheduled: !!existing });
    return res.status(existing ? 200 : 201).json({
      success: true,
      rescheduled: !!existing,
      data: { _id: doc._id, date: doc.date, slot: doc.slot, timezone: doc.timezone, name: doc.name },
    });
  } catch (err) {
    logger.error('demo booking failed', { error: err.message });
    return res.status(500).json({ success: false, message: 'Could not book the demo. Please try again.' });
  }
});

// -------------------------------------------------------------- admin --

const admin = express.Router();
admin.use(requireSuperAdmin);

/** Counts for the tabs. "Today" = scheduled for today (IST), any status. */
async function counts() {
  const today = istToday();
  const [todayN, upcoming, completed, notAnswered, notInterested, cancelled, all] = await Promise.all([
    DemoRequest.countDocuments({ date: today, status: { $ne: 'cancelled' } }),
    DemoRequest.countDocuments({ status: 'scheduled', date: { $gte: today } }),
    DemoRequest.countDocuments({ status: 'completed' }),
    DemoRequest.countDocuments({ status: 'not_answered' }),
    DemoRequest.countDocuments({ status: 'not_interested' }),
    DemoRequest.countDocuments({ status: 'cancelled' }),
    DemoRequest.countDocuments({}),
  ]);
  return {
    today: todayN, upcoming, completed, not_answered: notAnswered, not_interested: notInterested, cancelled, all,
  };
}

admin.get('/', async (req, res) => {
  const view = s(req.query.view, 20) || 'today';
  const today = istToday();
  let filter = {};
  let sort = { scheduledAt: 1 };
  if (view === 'today') filter = { date: today, status: { $ne: 'cancelled' } };
  else if (view === 'upcoming') filter = { status: 'scheduled', date: { $gte: today } };
  else if (view === 'missed') filter = { status: 'scheduled', date: { $lt: today } }; // booked but never updated
  else if (STATUSES.includes(view)) { filter = { status: view }; sort = { scheduledAt: -1 }; }
  else sort = { scheduledAt: -1 }; // 'all'
  const q = s(req.query.q, 80);
  if (q) {
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter = { ...filter, $or: [{ name: re }, { businessName: re }, { email: re }, { phone: re }] };
  }
  const data = await DemoRequest.find(filter).sort(sort).limit(500).lean();
  res.json({ success: true, data, counts: await counts(), today, timezone: DEMO_TZ });
});

admin.patch('/:id', async (req, res) => {
  const b = req.body || {};
  const doc = await DemoRequest.findById(req.params.id);
  if (!doc) return res.status(404).json({ success: false, message: 'Not found' });
  if (b.status !== undefined) {
    if (!STATUSES.includes(b.status)) return res.status(400).json({ success: false, message: 'Unknown status' });
    if (b.status !== doc.status) doc.statusChangedAt = new Date();
    doc.status = b.status;
  }
  if (b.notes !== undefined) doc.notes = s(b.notes, 2000);
  // Reschedule: the admin can move a demo to any valid date / listed time.
  if (b.date !== undefined || b.slot !== undefined) {
    const date = s(b.date ?? doc.date, 10);
    const slot = s(b.slot ?? doc.slot, 5);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(slot)) {
      return res.status(400).json({ success: false, message: 'Pick a valid date and time' });
    }
    doc.date = date;
    doc.slot = slot;
    doc.scheduledAt = istToDate(date, slot);
    if (b.status === undefined && doc.status !== 'scheduled') doc.status = 'scheduled';
  }
  await doc.save();
  res.json({ success: true, data: doc.toObject(), counts: await counts() });
});

admin.delete('/:id', async (req, res) => {
  await DemoRequest.deleteOne({ _id: req.params.id });
  res.json({ success: true, counts: await counts() });
});

export { admin as demoAdminRouter };
export default router;
