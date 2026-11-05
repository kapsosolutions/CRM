// API keys for the public API, managed from the CRM (Templates → API keys).
//   GET    /api/developer/keys        the business's live keys (never the secret)
//   POST   /api/developer/keys        { name } → the new key, shown this once
//   DELETE /api/developer/keys/:id    revoke
import express from 'express';
import { requireBusiness } from '../middleware/auth.js';
import { listKeys, createKey, revokeKey } from '../services/apiKeys.js';
import { assertFeature } from '../services/plans.js';
import { sendPlanError } from '../services/planGate.js';
import logger from '../services/logger.js';

const router = express.Router();
router.use(requireBusiness);
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

router.get('/keys', async (req, res) => {
  try {
    res.json({ success: true, data: await listKeys(req.business._id) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/keys', async (req, res) => {
  try {
    assertFeature(req.business, 'templates');
    const key = await createKey(req.business._id, req.body?.name);
    logger.info('api key created', { business: req.business.name, prefix: key.prefix });
    res.json({ success: true, data: key });
  } catch (err) {
    if (sendPlanError(res, err)) return;
    res.status(err.status || 500).json({ success: false, message: err.message, code: err.code });
  }
});

router.delete('/keys/:id', async (req, res) => {
  try {
    const ok = await revokeKey(req.business._id, String(req.params.id));
    if (!ok) return res.status(404).json({ success: false, message: 'Key not found' });
    logger.info('api key revoked', { business: req.business.name });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
