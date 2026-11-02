// Web Push for the signed-in business: the public key the browser subscribes
// with, and saving / removing this browser's subscription and choices.
// Every write is scoped to the signed-in business.
import express from 'express';
import { requireBusiness } from '../middleware/auth.js';
import PushSubscription from '../models/PushSubscription.js';
import { cleanPrefs, cleanSubscription, publicKey, pushConfigured, sendPush } from '../services/webPush.js';
import logger from '../services/logger.js';

const router = express.Router();
router.use(requireBusiness);

const MAX_PER_BUSINESS = 50;

// GET /api/push/key → { enabled, publicKey }
router.get('/key', (req, res) => {
  res.json({ success: true, enabled: pushConfigured(), publicKey: publicKey() });
});

// POST /api/push/subscribe { subscription, prefs }: this browser wants desktop notifications.
router.post('/subscribe', async (req, res) => {
  if (!pushConfigured()) return res.status(503).json({ success: false, message: 'Desktop notifications aren’t set up on the server.' });
  const sub = cleanSubscription(req.body?.subscription);
  if (!sub) return res.status(400).json({ success: false, message: 'Invalid subscription' });
  const businessId = req.business._id;
  // A browser that subscribed under another business moves here (same device, new sign-in).
  await PushSubscription.findOneAndUpdate(
    { endpoint: sub.endpoint },
    {
      $set: {
        businessId, keys: sub.keys, prefs: cleanPrefs(req.body?.prefs), failures: 0,
        userAgent: String(req.get('user-agent') || '').slice(0, 300),
      },
    },
    { upsert: true, new: true },
  );
  // Keep the newest browsers only.
  const all = await PushSubscription.find({ businessId }).select('_id').sort({ updatedAt: -1 }).lean();
  if (all.length > MAX_PER_BUSINESS) {
    await PushSubscription.deleteMany({ _id: { $in: all.slice(MAX_PER_BUSINESS).map((s) => s._id) } });
  }
  res.json({ success: true });
});

// PUT /api/push/prefs { endpoint, prefs }: the choices changed on Settings.
router.put('/prefs', async (req, res) => {
  const endpoint = String(req.body?.endpoint || '');
  if (!endpoint) return res.status(400).json({ success: false, message: 'endpoint required' });
  const r = await PushSubscription.updateOne({ endpoint, businessId: req.business._id }, { $set: { prefs: cleanPrefs(req.body?.prefs) } });
  res.json({ success: true, found: !!r.matchedCount });
});

// POST /api/push/unsubscribe { endpoint }: signed out, or desktop nudges turned off.
router.post('/unsubscribe', async (req, res) => {
  const endpoint = String(req.body?.endpoint || '');
  if (endpoint) await PushSubscription.deleteOne({ endpoint, businessId: req.business._id });
  res.json({ success: true });
});

// POST /api/push/test: a test notification to this business's browsers.
router.post('/test', async (req, res) => {
  if (!pushConfigured()) return res.status(503).json({ success: false, message: 'Desktop notifications aren’t set up on the server.' });
  const sent = await sendPush(req.business._id, {
    _id: `test-${Date.now()}`,
    type: 'test',
    category: 'test',
    title: 'Desktop notifications are on',
    body: 'You’ll get alerts like this even when the CRM is closed.',
    target: { view: 'profile', id: 'notifications' },
  });
  logger.info('push test sent', { business: req.business.name, sent });
  res.json({ success: true, sent });
});

export default router;
