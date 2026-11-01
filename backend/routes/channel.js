// Channel Status page: live state of the business's own WhatsApp number
// (services/metaAccount.js), and "Activate number" for a number Meta lists
// as Pending (services/numberActivation.js).
import express from 'express';
import { requireBusiness } from '../middleware/auth.js';
import { getNumberStatus } from '../services/metaAccount.js';
import { activateNumber, ActivationError } from '../services/numberActivation.js';
import { otherSubscribedApps } from '../services/otherApps.js';
import logger from '../services/logger.js';

const router = express.Router();
router.use(requireBusiness);

// Messaging limit, quality, number status, display name and account review,
// cached for a few minutes. ?refresh=1 asks Meta again (throttled).
router.get('/status', async (req, res) => {
  const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
  const data = await getNumberStatus(req.business, { refresh });
  // Other Meta apps still attached to the WhatsApp account (an old automation):
  // they can hold chats away from the CRM, so the page names them.
  const other = data.connected ? await otherSubscribedApps(req.business, { refresh }).catch(() => null) : null;
  res.json({ success: true, ...data, otherApps: other?.ok ? other.apps : [] });
});

// Register the number with Cloud API: { pin: '123456' } or { useSavedPin: true }.
// The PIN never comes back in any response.
router.post('/activate', async (req, res) => {
  const b = req.body || {};
  try {
    const r = await activateNumber(req.business, { pin: b.pin, useSavedPin: b.useSavedPin === true });
    const status = await getNumberStatus(req.business);
    return res.json({ ...r, channel: { success: true, ...status } });
  } catch (err) {
    if (err instanceof ActivationError) {
      if (err.meta) {
        logger.warn('number activation refused by Meta', {
          business: req.business.name, code: err.code, metaCode: err.meta.code, error: err.meta.message,
        });
      }
      return res.status(err.status).json(err.toJSON());
    }
    logger.error('number activation failed', { business: req.business.name, error: err.message });
    return res.status(500).json({ success: false, code: 'ACTIVATION_FAILED', message: 'Activating the number failed. Please try again.' });
  }
});

export default router;
