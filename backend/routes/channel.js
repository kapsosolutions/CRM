// Channel Status page: live state of the business's own WhatsApp number
// (services/metaAccount.js), "Activate number" for a number Meta lists as
// Pending (services/numberActivation.js), and its two-step verification PIN
// (services/twoStepPin.js).
import express from 'express';
import { requireBusiness } from '../middleware/auth.js';
import { getNumberStatus } from '../services/metaAccount.js';
import { getServiceQuota } from '../services/serviceQuota.js';
import { getMessagingLimit } from '../services/messagingLimit.js';
import { activateNumber, ActivationError } from '../services/numberActivation.js';
import { setTwoStepPin } from '../services/twoStepPin.js';
import { otherSubscribedApps, clearThreadControl } from '../services/otherApps.js';
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
  res.json({
    success: true,
    ...data,
    otherApps: other?.ok ? other.apps : [],
    // Another app was seen holding chats on this number (refused sends / standby).
    threadControl: data.connected ? req.business.meta?.threadControl || null : null,
  });
});

// Meta's free tier of service messages this month (1,000 per number), for
// the profile sidebar. ?refresh=1 asks Meta again (throttled).
router.get('/service-quota', async (req, res) => {
  const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
  const data = await getServiceQuota(req.business, { refresh });
  res.json({ success: true, ...data });
});

// Meta's daily messaging limit and how much of it the last 24 hours used, for
// the sidebar bar. ?refresh=1 asks Meta for the tier again (throttled).
router.get('/messaging-limit', async (req, res) => {
  try {
    const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
    const data = await getMessagingLimit(req.business, { refresh });
    res.json({ success: true, ...data });
  } catch (err) {
    logger.warn('messaging limit read failed', { business: req.business?.name, error: err.message });
    res.status(500).json({ success: false, message: 'Couldn’t read the messaging limit right now.' });
  }
});

// "I've fixed it": hide the thread-control notice (it comes back if it happens again).
router.post('/thread-control/dismiss', async (req, res) => {
  await clearThreadControl(req.business._id);
  res.json({ success: true });
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

// Set or change the number's two-step verification PIN: { pin: '123456' }.
// The PIN never comes back in any response.
router.post('/two-step-pin', async (req, res) => {
  try {
    const r = await setTwoStepPin(req.business, (req.body || {}).pin);
    const status = await getNumberStatus(req.business);
    return res.json({ ...r, channel: { success: true, ...status } });
  } catch (err) {
    if (err instanceof ActivationError) {
      if (err.meta) {
        logger.warn('two-step PIN change refused by Meta', {
          business: req.business.name, code: err.code, metaCode: err.meta.code, error: err.meta.message,
        });
      }
      return res.status(err.status).json(err.toJSON());
    }
    logger.error('two-step PIN change failed', { business: req.business.name, error: err.message });
    return res.status(500).json({ success: false, code: 'PIN_CHANGE_FAILED', message: 'Setting the PIN failed. Please try again.' });
  }
});

export default router;
