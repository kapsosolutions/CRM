// Event themes.
//
// Public (no sign-in; the website and the CRM read it on load):
//   GET  /api/events/live                   the live event's theme, or null
//
// Super admin (admin panel → Events):
//   GET    /api/admin/events                every event, with its status
//   GET    /api/admin/events/:id            one event (also for "Preview")
//   POST   /api/admin/events                create   { name, startsAt?, endsAt?, theme }
//   PUT    /api/admin/events/:id            save     { name, startsAt?, endsAt?, theme }
//   POST   /api/admin/events/:id/activate   switch it on (every other event off)
//   POST   /api/admin/events/:id/deactivate
//   DELETE /api/admin/events/:id            and its uploaded images
//   POST   /api/admin/events/upload         one image or GIF (field "file") → { url }
import express from 'express';
import multer from 'multer';
import SiteEvent from '../models/SiteEvent.js';
import { requireSuperAdmin } from '../middleware/auth.js';
import storage, { mediaFolder } from '../services/storage.js';
import { sanitizeTheme, statusOf, liveEvent, clearEventCache, ThemeError } from '../services/siteEvents.js';
import logger from '../services/logger.js';

const router = express.Router();

router.get('/live', async (_req, res) => {
  try {
    const data = await liveEvent();
    res.set('Cache-Control', 'public, max-age=60');
    res.json({ success: true, data });
  } catch (err) {
    // The site and the CRM simply keep their normal look.
    logger.warn('live event read failed', { error: err.message });
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, data: null });
  }
});

// ---------------------------------------------------------------- admin

export const eventsAdminRouter = express.Router();
const admin = eventsAdminRouter;
admin.use(requireSuperAdmin);
admin.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

const FOLDER = mediaFolder('', 'events'); // shared/events
const MAX_BYTES = 10 * 1024 * 1024;
const TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const ID_RE = /^[a-f0-9]{24}$/i;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => (TYPES.includes(file.mimetype)
    ? cb(null, true)
    : cb(Object.assign(new Error('Use a JPG, PNG, GIF or WebP image.'), { code: 'BAD_FILE_TYPE' }))),
});

/** The real type, from the first bytes (the browser's label can't be trusted). */
function imageKind(b) {
  if (!b || b.length < 12) return '';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  const head = b.subarray(0, 6).toString('latin1');
  if (head === 'GIF87a' || head === 'GIF89a') return 'gif';
  if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return '';
}

admin.post('/upload', (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      const message = err.code === 'LIMIT_FILE_SIZE' ? 'The image can be at most 10 MB.' : err.message || 'Upload failed.';
      return res.status(400).json({ success: false, message });
    }
    if (!req.file) return res.status(400).json({ success: false, message: 'Choose an image.' });
    if (!imageKind(req.file.buffer)) return res.status(400).json({ success: false, message: 'That file isn’t a JPG, PNG, GIF or WebP image.' });
    try {
      const url = await storage.uploadBuffer(req.file.buffer, FOLDER, 'image');
      return res.json({ success: true, url });
    } catch (e) {
      logger.error('event image upload failed', { error: e.message });
      return res.status(500).json({ success: false, message: 'Couldn’t upload the image. Please try again.' });
    }
  });
});

const view = (ev, now = new Date()) => ({ ...ev, _id: String(ev._id), status: statusOf(ev, now) });

/** name / dates / theme from a request body, checked. */
function fieldsOf(b = {}) {
  const errors = {};
  const name = String(b.name ?? '').trim().slice(0, 80);
  if (!name) errors.name = 'Give the event a name, like “Diwali 2026”.';
  const date = (k) => {
    if (b[k] === undefined || b[k] === null || b[k] === '') return null;
    const d = new Date(b[k]);
    if (Number.isNaN(d.getTime())) {
      errors[k] = 'That isn’t a valid date.';
      return null;
    }
    return d;
  };
  const startsAt = date('startsAt');
  const endsAt = date('endsAt');
  if (startsAt && endsAt && endsAt <= startsAt) errors.endsAt = 'The end must be after the start.';
  let theme = {};
  try {
    theme = sanitizeTheme(b.theme);
  } catch (e) {
    if (e instanceof ThemeError) Object.assign(errors, e.errors);
    else throw e;
  }
  if (Object.keys(errors).length) throw new ThemeError(errors);
  return { name, startsAt, endsAt, theme };
}

function fail(res, err, what) {
  if (err instanceof ThemeError) return res.status(400).json({ success: false, message: err.message, errors: err.errors });
  logger.error(`event ${what} failed`, { error: err.message });
  return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
}

/** Delete images an event no longer uses (only from our events folder). */
async function dropUnused(before, after) {
  const keep = storage.collectCdnUrls(after);
  const gone = [...storage.collectCdnUrls(before)].filter((u) => !keep.has(u) && storage.isInFolder(u, FOLDER));
  if (gone.length) storage.deleteMany(gone).catch(() => {});
}

admin.get('/', async (_req, res) => {
  try {
    const rows = await SiteEvent.find({}).sort({ updatedAt: -1 }).limit(200).lean();
    const now = new Date();
    res.json({ success: true, data: rows.map((r) => view(r, now)) });
  } catch (err) {
    fail(res, err, 'list');
  }
});

admin.get('/:id', async (req, res) => {
  try {
    if (!ID_RE.test(req.params.id)) return res.status(404).json({ success: false, message: 'Not found' });
    const ev = await SiteEvent.findById(req.params.id).lean();
    if (!ev) return res.status(404).json({ success: false, message: 'Not found' });
    return res.json({ success: true, data: view(ev) });
  } catch (err) {
    return fail(res, err, 'read');
  }
});

admin.post('/', async (req, res) => {
  try {
    const f = fieldsOf(req.body);
    const ev = await SiteEvent.create({ ...f, active: false });
    logger.info('event created', { name: f.name });
    res.status(201).json({ success: true, data: view(ev.toObject ? ev.toObject() : ev) });
  } catch (err) {
    fail(res, err, 'create');
  }
});

admin.put('/:id', async (req, res) => {
  try {
    if (!ID_RE.test(req.params.id)) return res.status(404).json({ success: false, message: 'Not found' });
    const before = await SiteEvent.findById(req.params.id).lean();
    if (!before) return res.status(404).json({ success: false, message: 'Not found' });
    const f = fieldsOf(req.body);
    await SiteEvent.updateOne({ _id: before._id }, { $set: f });
    clearEventCache();
    dropUnused(before.theme, f.theme);
    const ev = await SiteEvent.findById(before._id).lean();
    logger.info('event saved', { name: f.name });
    return res.json({ success: true, data: view(ev) });
  } catch (err) {
    return fail(res, err, 'save');
  }
});

admin.post('/:id/activate', async (req, res) => {
  try {
    if (!ID_RE.test(req.params.id)) return res.status(404).json({ success: false, message: 'Not found' });
    const ev = await SiteEvent.findById(req.params.id).lean();
    if (!ev) return res.status(404).json({ success: false, message: 'Not found' });
    // One event at a time.
    await SiteEvent.updateMany({ active: true, _id: { $ne: ev._id } }, { $set: { active: false } });
    await SiteEvent.updateOne({ _id: ev._id }, { $set: { active: true } });
    clearEventCache();
    logger.info('event switched on', { name: ev.name });
    return res.json({ success: true, data: view({ ...ev, active: true }) });
  } catch (err) {
    return fail(res, err, 'activate');
  }
});

admin.post('/:id/deactivate', async (req, res) => {
  try {
    if (!ID_RE.test(req.params.id)) return res.status(404).json({ success: false, message: 'Not found' });
    const r = await SiteEvent.updateOne({ _id: req.params.id }, { $set: { active: false } });
    if (!r.matchedCount) return res.status(404).json({ success: false, message: 'Not found' });
    clearEventCache();
    return res.json({ success: true });
  } catch (err) {
    return fail(res, err, 'deactivate');
  }
});

admin.delete('/:id', async (req, res) => {
  try {
    if (!ID_RE.test(req.params.id)) return res.status(404).json({ success: false, message: 'Not found' });
    const ev = await SiteEvent.findById(req.params.id).lean();
    if (!ev) return res.status(404).json({ success: false, message: 'Not found' });
    await SiteEvent.deleteOne({ _id: ev._id });
    clearEventCache();
    dropUnused(ev.theme, {});
    logger.info('event deleted', { name: ev.name });
    return res.json({ success: true });
  } catch (err) {
    return fail(res, err, 'delete');
  }
});

export default router;
