// Channel Status → Instagram → "Log in with Instagram" (Business Login for
// Instagram, services/instagramLogin.js). Mounted at /api/channels/instagram.
// Disconnecting works for both login methods through the existing
// DELETE /api/channels/meta/instagram. Tokens never appear in any response.
import express from 'express';
import { requireBusiness } from '../middleware/auth.js';
import { ChannelError } from '../services/metaChannels.js';
import { loginUrl, connectInstagramLogin } from '../services/instagramLogin.js';
import logger from '../services/logger.js';

const router = express.Router();
router.use(requireBusiness);

function fail(res, err, what) {
  if (err instanceof ChannelError) {
    if (err.meta) logger.warn(`${what} refused by Meta`, { code: err.code, metaCode: err.meta.code, error: err.meta.message });
    else if (err.status >= 500) logger.warn(`${what} failed`, { code: err.code });
    return res.status(err.status).json(err.toJSON());
  }
  logger.error(`${what} failed`, { error: err.message });
  return res.status(500).json({ success: false, code: 'CHANNEL_FAILED', message: 'Something went wrong. Please try again.' });
}

// → { url, state, expiresAt, redirectUri }: the authorize URL the popup opens.
router.get('/login-url', (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, ...loginUrl(req.business) });
  } catch (err) {
    fail(res, err, 'Instagram login URL');
  }
});

// { code, state } from instagram-callback.html → { connections }
router.post('/connect', async (req, res) => {
  try {
    const b = req.body || {};
    const connections = await connectInstagramLogin(req.business, { code: b.code, state: b.state });
    res.json({ success: true, connections });
  } catch (err) {
    fail(res, err, 'Instagram login connect');
  }
});

export default router;
