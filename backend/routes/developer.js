// API keys for the public API, managed from the CRM (Templates, Catalog,
// Categories, Members and Offers → API).
//   GET    /api/developer/keys        the business's live keys (never the key itself)
//   POST   /api/developer/keys        { name, type: 'secret'|'publishable', allowedOrigins? }
//                                     → the new key, shown this once
//   PATCH  /api/developer/keys/:id    { name?, allowedOrigins? }
//   DELETE /api/developer/keys/:id    revoke
import express from 'express';
import { requireBusiness } from '../middleware/auth.js';
import { listKeys, createKey, updateKey, revokeKey } from '../services/apiKeys.js';
import { assertFeature } from '../services/plans.js';
import { sendPlanError } from '../services/planGate.js';
import logger from '../services/logger.js';

const router = express.Router();
router.use(requireBusiness);
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

const fail = (res, err) => {
  if (sendPlanError(res, err)) return undefined;
  const status = err.status && err.status < 500 ? err.status : 500;
  if (status === 500) logger.error('api key request failed', { error: err.message });
  return res.status(status).json({ success: false, message: status === 500 ? 'Something went wrong. Please try again.' : err.message, code: err.code });
};

router.get('/keys', async (req, res) => {
  try {
    res.json({ success: true, data: await listKeys(req.business._id) });
  } catch (err) {
    fail(res, err);
  }
});

router.post('/keys', async (req, res) => {
  try {
    // The API is a plan feature (Basic and up).
    assertFeature(req.business, 'api');
    const b = req.body || {};
    const key = await createKey(req.business._id, { name: b.name, type: b.type, allowedOrigins: b.allowedOrigins });
    logger.info('api key created', { business: req.business.name, prefix: key.prefix, type: key.type });
    res.json({ success: true, data: key });
  } catch (err) {
    fail(res, err);
  }
});

router.patch('/keys/:id', async (req, res) => {
  try {
    const b = req.body || {};
    const key = await updateKey(req.business._id, String(req.params.id), { name: b.name, allowedOrigins: b.allowedOrigins });
    if (!key) return res.status(404).json({ success: false, message: 'Key not found' });
    logger.info('api key updated', { business: req.business.name, prefix: key.prefix });
    res.json({ success: true, data: key });
  } catch (err) {
    fail(res, err);
  }
});

router.delete('/keys/:id', async (req, res) => {
  try {
    const ok = await revokeKey(req.business._id, String(req.params.id));
    if (!ok) return res.status(404).json({ success: false, message: 'Key not found' });
    logger.info('api key revoked', { business: req.business.name });
    res.json({ success: true });
  } catch (err) {
    fail(res, err);
  }
});

export default router;
