// A business's own settings: the things Embedded Signup can't fill in —
// the Meta catalog id and the WhatsApp Pay payment configuration — and the
// WhatsApp business profile of its own number.
import express from 'express';
import axios from 'axios';
import multer from 'multer';
import { requireBusiness } from '../middleware/auth.js';
import { pickPayment, paymentProblem } from '../services/businessSettings.js';
import { getClientForBusiness } from '../services/metaCloud.js';
import {
  VERTICALS, PICTURE_MAX_BYTES, isWhatsAppConnected, validateProfile, pictureType, metaError,
  getProfile, clearProfileCache, mirrorProfile,
} from '../services/businessProfile.js';
import logger from '../services/logger.js';
import Business from '../models/Business.js';

const router = express.Router();
router.use(requireBusiness);

const view = (biz) => ({
  catalogId: biz.catalogId || '',
  catalogName: biz.meta?.catalogName || '',
  catalogMethod: biz.catalogConnection?.method || '',
  payment: pickPayment(biz.payment || {}),
  whatsappConnected: !!(biz.accessToken && biz.phoneNumberId),
});

router.get('/', (req, res) => res.json({ success: true, data: view(req.business) }));

// ---------------------------------------------------------------------------
// When each sidebar page was last opened (the CRM counts what arrived since).
// ---------------------------------------------------------------------------
const SEEN_PAGE = /^(orders|form:[a-z0-9_]{1,48})$/;
const SEEN_MAX_PAGES = 60;

/** The stored map, started (with _since = now) the first time it's asked for. */
async function seenMap(biz) {
  const m = biz.pagesSeenAt && typeof biz.pagesSeenAt === 'object' ? biz.pagesSeenAt : null;
  if (m?._since) return m;
  const fresh = { _since: new Date().toISOString() };
  await Business.updateOne({ _id: biz._id }, { $set: { pagesSeenAt: fresh } });
  return fresh;
}

router.get('/pages-seen', async (req, res) => {
  try {
    return res.json({ success: true, data: await seenMap(req.business), now: new Date().toISOString() });
  } catch (err) {
    logger.warn('pages-seen read failed', { business: req.business.name, error: err.message });
    return res.status(500).json({ success: false, message: 'Could not read the page counts.' });
  }
});

router.post('/pages-seen', async (req, res) => {
  const page = String(req.body?.page || '');
  if (!SEEN_PAGE.test(page)) return res.status(400).json({ success: false, message: 'Unknown page.' });
  try {
    const now = new Date().toISOString();
    const before = await seenMap(req.business);
    const next = { ...before, [page]: now };
    // Keep it small: the oldest pages drop off (they count from _since again).
    const pages = Object.keys(next).filter((k) => k !== '_since');
    if (pages.length > SEEN_MAX_PAGES) {
      pages.sort((a, b) => String(next[a]).localeCompare(String(next[b])));
      for (const k of pages.slice(0, pages.length - SEEN_MAX_PAGES)) delete next[k];
    }
    await Business.updateOne({ _id: req.business._id }, { $set: { pagesSeenAt: next } });
    return res.json({ success: true, data: next, now });
  } catch (err) {
    logger.warn('pages-seen save failed', { business: req.business.name, error: err.message });
    return res.status(500).json({ success: false, message: 'Could not save.' });
  }
});

// ---------------------------------------------------------------------------
// "What do you want to do on WhatsApp?": the menu items picked (null = every
// page). The CRM turns them into pages (frontend crm/menuChoices.ts).
// ---------------------------------------------------------------------------
const MENU_PICK = /^(main|book|offers|payments|form:[a-z0-9_]{1,48})$/;
const MENU_MAX = 40;

/** { picks } from the browser → what's stored; null when it isn't valid. */
export function pickMenu(body) {
  const raw = body?.picks;
  if (raw === null) return { picks: null };
  if (!Array.isArray(raw) || raw.length > MENU_MAX) return null;
  const picks = [...new Set(raw.map((x) => String(x || '')))];
  if (!picks.every((x) => MENU_PICK.test(x))) return null;
  return { picks };
}

router.put('/menu', async (req, res) => {
  const picked = pickMenu(req.body);
  if (!picked) return res.status(400).json({ success: false, message: 'Unknown menu items.' });
  try {
    const menu = { ...picked, seen: true, at: new Date().toISOString() };
    await Business.updateOne({ _id: req.business._id }, { $set: { menu } });
    logger.info('menu chosen', { business: req.business.name, picks: menu.picks ? menu.picks.length : 'all' });
    return res.json({ success: true, data: menu });
  } catch (err) {
    logger.warn('menu save failed', { business: req.business.name, error: err.message });
    return res.status(500).json({ success: false, message: 'Could not save your menu.' });
  }
});

router.put('/', async (req, res) => {
  const biz = req.business;
  const b = req.body || {};
  try {
    if (b.catalogId !== undefined) {
      const catalogId = String(b.catalogId || '').replace(/\s/g, '');
      if (catalogId && !/^\d{5,25}$/.test(catalogId)) {
        return res.status(400).json({ success: false, message: 'A catalog ID is the number shown in Commerce Manager, e.g. 1234567890123456.' });
      }
      let catalogName = catalogId === biz.catalogId ? biz.meta?.catalogName || '' : '';
      // With WhatsApp connected, check the id is a catalog this business can use.
      if (catalogId && catalogId !== biz.catalogId && biz.accessToken) {
        try {
          const { data } = await axios.get(
            `https://graph.facebook.com/${biz.graphVersion || 'v22.0'}/${catalogId}`,
            { params: { fields: 'name' }, headers: { Authorization: `Bearer ${biz.accessToken}` }, timeout: 15000 },
          );
          catalogName = data?.name || '';
        } catch (err) {
          const m = err.response?.data?.error?.message || err.message;
          return res.status(400).json({
            success: false,
            message: `Meta couldn't open that catalog with your WhatsApp account: ${m}. Make sure the catalog is connected to your WhatsApp Business Account in Commerce Manager.`,
          });
        }
      }
      // A typed id (or disconnect) drops the Meta-login token of the old catalog.
      if (catalogId !== biz.catalogId) {
        biz.catalogConnection = { method: catalogId ? 'manual' : '', token: '', tokenSource: '', scopes: [], metaBusinessId: '', metaBusinessName: '', connectedAt: catalogId ? new Date() : undefined };
      }
      biz.catalogId = catalogId;
      biz.meta = { ...(biz.meta || {}), catalogName };
    }
    if (b.payment) {
      const payment = pickPayment(b.payment);
      const problem = paymentProblem(payment);
      if (problem) return res.status(400).json({ success: false, message: problem });
      biz.payment = payment;
    }
    await biz.save();
    logger.info('business settings updated', { business: biz.name });
    return res.json({ success: true, data: view(biz) });
  } catch (err) {
    logger.error('settings update failed', { business: biz.name, error: err.message });
    return res.status(500).json({ success: false, message: 'Could not save the settings.' });
  }
});

// ---------------------------------------------------------------------------
// WhatsApp business profile of the business's own number. Meta is the source
// of truth; see services/businessProfile.js. A business without its own number
// (unconnected, or trying the shared test number) can't read or change it.
// ---------------------------------------------------------------------------
const NOT_CONNECTED_MSG = 'Connect your own WhatsApp number to see and edit its WhatsApp profile. '
  + 'The shared test number’s profile can’t be changed.';

function requireOwnNumber(req, res, next) {
  if (isWhatsAppConnected(req.business)) return next();
  return res.status(409).json({ success: false, code: 'NOT_CONNECTED', message: NOT_CONNECTED_MSG });
}

function sendMetaFailure(res, biz, what, err) {
  const { message, code } = metaError(err);
  logger.warn(`WhatsApp profile ${what} failed`, { business: biz.name, error: message, code });
  // Our own guards (e.g. not connected) keep their status; anything Meta
  // answered or a network failure is a bad gateway.
  const status = err?.status && !err.response ? err.status : 502;
  return res.status(status).json({ success: false, message, code });
}

router.get('/whatsapp-profile', async (req, res) => {
  const biz = req.business;
  if (!isWhatsAppConnected(biz)) {
    return res.json({ success: true, connected: false, message: NOT_CONNECTED_MSG, verticals: VERTICALS });
  }
  try {
    const data = await getProfile(biz, { refresh: req.query.refresh === '1' });
    return res.json({ success: true, connected: true, data, verticals: VERTICALS });
  } catch (err) {
    return sendMetaFailure(res, biz, 'read', err);
  }
});

router.put('/whatsapp-profile', requireOwnNumber, async (req, res) => {
  const biz = req.business;
  const { fields, errors } = validateProfile(req.body || {});
  if (Object.keys(errors).length) {
    return res.status(400).json({ success: false, message: Object.values(errors)[0], errors });
  }
  if (!Object.keys(fields).length) {
    return res.status(400).json({ success: false, message: 'Nothing to update.', errors: {} });
  }
  try {
    await getClientForBusiness(biz).updateBusinessProfile(fields);
  } catch (err) {
    return sendMetaFailure(res, biz, 'update', err);
  }
  clearProfileCache(biz._id);
  logger.info('WhatsApp business profile updated on Meta', { business: biz.name, fields: Object.keys(fields) });
  // Meta has it now; the local columns are only a mirror.
  try {
    mirrorProfile(biz, fields);
    await biz.save();
  } catch (err) {
    logger.warn('WhatsApp profile mirror save failed', { business: biz.name, error: err.message });
  }
  let data = null;
  try {
    data = await getProfile(biz, { refresh: true });
  } catch (err) {
    logger.warn('WhatsApp profile re-read failed', { business: biz.name, error: metaError(err).message });
  }
  return res.json({ success: true, data });
});

// JPEG or PNG up to 5 MB (Meta's profile photo formats). Kept in memory and
// sent straight to Meta; no copy is stored.
const pictureUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: PICTURE_MAX_BYTES, files: 1 },
}).single('file');

function parsePicture(req, res, next) {
  pictureUpload(req, res, (err) => {
    if (!err) return next();
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? 'The photo must be 5 MB or smaller.'
      : `Could not read the photo: ${err.message}`;
    return res.status(400).json({ success: false, message, errors: { picture: message } });
  });
}

router.post('/whatsapp-profile/picture', requireOwnNumber, parsePicture, async (req, res) => {
  const biz = req.business;
  const file = req.file;
  if (!file?.buffer?.length) {
    return res.status(400).json({ success: false, message: 'Choose a photo to upload.', errors: { picture: 'Choose a photo to upload.' } });
  }
  const mime = pictureType(file.buffer);
  if (!mime) {
    const message = 'The photo must be a JPEG or PNG image.';
    return res.status(400).json({ success: false, message, errors: { picture: message } });
  }
  if (!biz.appId || !biz.appSecret) {
    return res.status(400).json({
      success: false,
      message: 'This business has no Meta app ID/secret stored, so a photo can’t be uploaded. Ask the platform admin to add them.',
    });
  }
  const client = getClientForBusiness(biz);
  try {
    const fileName = `profile.${mime === 'image/png' ? 'png' : 'jpg'}`;
    const handle = await client.resumableUpload(file.buffer, mime, fileName, { timeout: 60000, what: 'photo' });
    await client.setProfilePicture(handle);
  } catch (err) {
    return sendMetaFailure(res, biz, 'photo update', err);
  }
  clearProfileCache(biz._id);
  logger.info('WhatsApp profile photo updated on Meta', { business: biz.name });
  let data = null;
  try {
    data = await getProfile(biz, { refresh: true });
  } catch (err) {
    logger.warn('WhatsApp profile re-read failed', { business: biz.name, error: metaError(err).message });
  }
  return res.json({ success: true, profilePictureUrl: data?.profilePictureUrl || '', data });
});

export default router;
