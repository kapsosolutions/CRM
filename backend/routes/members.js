// CRUD for the generic "Members" directory. What a member *is* depends on the
// business vertical (see services/verticals.js): doctors, stylists, agents,
// room types, courses… The schema is shared; only the labels differ.
// Mirrors the Category routes: multipart (optional image) + Bunny storage,
// `{ success, data }` responses, bearer-auth via requireBusiness.
import express from 'express';
import { requireBusiness, bizId } from '../middleware/auth.js';
import { uploadMedia } from '../middleware/upload.js';
import storage, { mediaFolder } from '../services/storage.js';
import Member from '../models/Member.js';
import { DAY_KEYS, toMinutes, affectedAppointments, availableSlots } from '../services/slots.js';
import { runMemberUnavailableTrigger } from '../services/templateTriggers.js';
import { getClientForBusiness } from '../services/metaCloud.js';
import logger from '../services/logger.js';

const router = express.Router();
router.use(requireBusiness);

/** Tenant filter — a member is only reachable by the business that owns it. */
const owner = (req) => ({ businessId: req.business._id });

const str = (v, fallback = '') => (typeof v === 'string' ? v.trim() : fallback);
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};
// Multipart sends arrays as a JSON string or a comma-separated list.
function list(v) {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  if (typeof v !== 'string' || !v.trim()) return [];
  try {
    const parsed = JSON.parse(v);
    if (Array.isArray(parsed)) return parsed.map((x) => String(x).trim()).filter(Boolean);
  } catch {
    /* not JSON — fall through to CSV */
  }
  return v.split(',').map((x) => x.trim()).filter(Boolean);
}
function obj(v) {
  if (v && typeof v === 'object') return v;
  if (typeof v !== 'string' || !v.trim()) return {};
  try {
    const parsed = JSON.parse(v);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}
/** Structured values arrive as JSON strings on a multipart save. */
function parseJson(v, fallback) {
  if (v == null) return fallback;
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
}

// Build the fields present in `body`. On create we take everything; on update
// we only touch keys the client actually sent, so partial saves are safe.
function pickFields(b, { partial = false } = {}) {
  const out = {};
  const setStr = (k) => {
    if (!partial || b[k] !== undefined) out[k] = str(b[k]);
  };
  const setNum = (k) => {
    if (!partial || b[k] !== undefined) out[k] = num(b[k]);
  };
  const setList = (k) => {
    if (!partial || b[k] !== undefined) out[k] = list(b[k]);
  };

  ['category', 'title', 'phone', 'email', 'description', 'qualifications', 'location',
    'availableFrom', 'availableTo'].forEach(setStr);
  ['fee', 'duration', 'experience', 'capacity'].forEach(setNum);
  ['availableDays', 'languages', 'amenities'].forEach(setList);
  if (!partial || b.currency !== undefined) out.currency = str(b.currency) || 'INR';
  if (!partial || b.extras !== undefined) out.extras = obj(b.extras);
  if (b.active !== undefined) out.active = !(b.active === 'false' || b.active === false);
  // At least one patient per slot: a zero would publish slots nobody can book.
  if (!partial || b.slotCapacity !== undefined) {
    out.slotCapacity = Math.max(1, num(b.slotCapacity) || 1);
  }
  if (!partial || b.schedule !== undefined) out.schedule = cleanSchedule(b.schedule);
  if (!partial || b.unavailability !== undefined) {
    out.unavailability = cleanUnavailability(b.unavailability);
  }
  return out;
}

const HHMM = /^\d{1,2}:\d{2}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Per-day working windows, normalised.
 *
 * Windows are sorted and reversed pairs dropped, because an end before its
 * start would silently produce a day with no slots — the kind of thing that
 * looks like the feature is broken rather than like a typo.
 */
function cleanSchedule(raw) {
  const list = Array.isArray(raw) ? raw : parseJson(raw, []);
  if (!Array.isArray(list)) return [];
  const byDay = new Map();
  for (const entry of list) {
    const day = String(entry?.day || '').toLowerCase();
    if (!DAY_KEYS.includes(day)) continue;
    const windows = (Array.isArray(entry.windows) ? entry.windows : [])
      .map((w) => ({ from: str(w?.from), to: str(w?.to) }))
      .filter((w) => HHMM.test(w.from) && HHMM.test(w.to) && toMinutes(w.to) > toMinutes(w.from))
      .sort((a, b2) => toMinutes(a.from) - toMinutes(b2.from));
    if (!windows.length) continue;
    // Merge a day sent twice rather than letting the later entry win.
    byDay.set(day, [...(byDay.get(day) || []), ...windows]);
  }
  return DAY_KEYS.filter((d) => byDay.has(d)).map((day) => ({ day, windows: byDay.get(day) }));
}

/** Dated absences, normalised. A bad time range falls back to the whole day. */
function cleanUnavailability(raw) {
  const list = Array.isArray(raw) ? raw : parseJson(raw, []);
  if (!Array.isArray(list)) return [];
  return list
    .map((u) => {
      const date = str(u?.date);
      if (!ISO_DATE.test(date)) return null;
      const from = str(u?.from);
      const to = str(u?.to);
      const ranged =
        u?.wholeDay === false || u?.wholeDay === 'false';
      const validRange = HHMM.test(from) && HHMM.test(to) && toMinutes(to) > toMinutes(from);
      return {
        date,
        wholeDay: !(ranged && validRange),
        from: ranged && validRange ? from : '',
        to: ranged && validRange ? to : '',
        reason: str(u?.reason).slice(0, 200),
        notifiedAt: u?.notifiedAt ? new Date(u.notifiedAt) : undefined,
      };
    })
    .filter(Boolean);
}

/** Absences present in `after` that weren't in `before` and haven't been sent. */
function newBlocks(before = [], after = []) {
  const seen = new Set(
    (before || []).map((u) => `${u.date}|${u.wholeDay !== false}|${u.from || ''}|${u.to || ''}`),
  );
  return (after || []).filter(
    (u) => !u.notifiedAt && !seen.has(`${u.date}|${u.wholeDay !== false}|${u.from || ''}|${u.to || ''}`),
  );
}

/**
 * Tell the affected patients that a member has become unavailable.
 *
 * Returns a per-absence summary so the CRM can report what happened — this is
 * the kind of thing that must not fail silently: the business believes their
 * patients have been told.
 */
async function announceAbsences(req, member, blocks) {
  const notices = [];
  for (const block of blocks) {
    // eslint-disable-next-line no-await-in-loop
    const appointments = await affectedAppointments({
      businessId: req.business._id, member, block,
    });
    // eslint-disable-next-line no-await-in-loop
    const result = await runMemberUnavailableTrigger(
      getClientForBusiness(req.business), req.business, member, block, appointments,
    );
    notices.push({ date: block.date, affected: appointments.length, ...result });
  }
  return notices;
}

router.get('/', async (req, res) => {
  const data = await Member.find(owner(req)).sort({ order: 1, name: 1 }).lean();
  res.json({ success: true, data });
});

router.post('/', uploadMedia.single('image'), async (req, res) => {
  try {
    const b = req.body || {};
    const name = str(b.name);
    if (!name) return res.status(400).json({ success: false, message: 'name required' });
    let imageUrl = '';
    if (req.file) imageUrl = await storage.uploadBuffer(req.file.buffer, mediaFolder(bizId(req), 'members'), 'image');
    // Per-tenant ordering, so one business's list doesn't start numbering
    // after another's.
    const count = await Member.countDocuments(owner(req));
    const member = await Member.create({
      businessId: req.business._id,
      name,
      ...pickFields(b),
      imageUrl,
      order: count + 1,
    });
    res.status(201).json({ success: true, data: member });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/:id', uploadMedia.single('image'), async (req, res) => {
  try {
    const b = req.body || {};
    const existing = await Member.findOne({ _id: req.params.id, ...owner(req) }).lean();
    if (!existing) return res.status(404).json({ success: false, message: 'Not found' });
    const update = pickFields(b, { partial: true });
    const name = str(b.name);
    if (name) update.name = name;
    if (req.file) update.imageUrl = await storage.uploadBuffer(req.file.buffer, mediaFolder(bizId(req), 'members'), 'image');
    // Absences added by this save, worked out before the write so the previous
    // state is still available to compare against.
    const added = update.unavailability
      ? newBlocks(existing.unavailability, update.unavailability)
      : [];

    const member = await Member.findOneAndUpdate(
      { _id: req.params.id, ...owner(req) },
      { $set: update },
      { new: true },
    );
    if (!member) return res.status(404).json({ success: false, message: 'Not found' });
    // Photo replaced → drop the old file.
    if (update.imageUrl && existing.imageUrl && existing.imageUrl !== update.imageUrl) {
      storage.deleteByUrl(existing.imageUrl, String(req.business?._id || '')).catch(() => {});
    }

    // Message the affected patients, then stamp those entries so saving the
    // member again never messages the same people twice.
    let notices = [];
    if (added.length) {
      try {
        notices = await announceAbsences(req, member, added);
        const stamped = new Set(added.map((u) => `${u.date}|${u.from}|${u.to}`));
        member.unavailability = (member.unavailability || []).map((u) =>
          stamped.has(`${u.date}|${u.from || ''}|${u.to || ''}`) && !u.notifiedAt
            ? { ...(u.toObject ? u.toObject() : u), notifiedAt: new Date() }
            : u);
        await member.save();
      } catch (err) {
        logger.error('could not announce member absence', { error: err.message });
        notices = [{ error: err.message }];
      }
    }
    res.json({ success: true, data: member, notices });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * The slots this member actually has free on a date.
 *
 * Same engine the WhatsApp flow uses, so what the business previews here is
 * exactly what a patient would be offered — including bookings already taken
 * and any absence on that date.
 */
router.get('/:id/slots', async (req, res) => {
  const member = await Member.findOne({ _id: req.params.id, ...owner(req) }).lean();
  if (!member) return res.status(404).json({ success: false, message: 'Not found' });
  const date = String(req.query.date || '').trim();
  if (!ISO_DATE.test(date)) {
    return res.status(400).json({ success: false, message: 'date must be YYYY-MM-DD' });
  }
  const slots = await availableSlots({ member, isoDate: date, businessId: req.business._id });
  res.json({ success: true, date, capacity: member.slotCapacity || 1, data: slots });
});

router.delete('/:id', async (req, res) => {
  const member = await Member.findOne({ _id: req.params.id, ...owner(req) }).lean();
  if (member) {
    await Member.deleteOne({ _id: req.params.id, ...owner(req) });
    if (member.imageUrl) storage.deleteByUrl(member.imageUrl, String(req.business?._id || '')).catch(() => {});
  }
  res.json({ success: true });
});

export default router;
