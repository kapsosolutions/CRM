// Channel Status → Instagram / Messenger: connect a Facebook Page (and its
// linked Instagram account) through Facebook Login for Business, list and
// remove connections (services/metaChannels.js). Tokens never appear in any
// response.
//
// Super admin: the platform app's 'page' / 'instagram' webhook subscriptions.
import express from 'express';
import { requireBusiness, requireSuperAdmin } from '../middleware/auth.js';
import {
  ChannelError, businessLoginConfig, startLogin, connectPage, disconnectChannel, listConnections,
  readAppSubscriptions, ensureAppSubscriptions, metaWebhookUrl,
} from '../services/metaChannels.js';
import { instagramLoginConfig } from '../services/instagramGraph.js';
import logger from '../services/logger.js';

const router = express.Router();
router.use(requireBusiness);

function fail(res, err, what) {
  if (err instanceof ChannelError) {
    if (err.meta) logger.warn(`${what} refused by Meta`, { code: err.code, metaCode: err.meta.code, error: err.meta.message });
    return res.status(err.status).json(err.toJSON());
  }
  logger.error(`${what} failed`, { error: err.message });
  return res.status(500).json({ success: false, code: 'CHANNEL_FAILED', message: 'Something went wrong. Please try again.' });
}

// Whether Login for Business is configured, and this business's connections.
router.get('/', async (req, res) => {
  const cfg = businessLoginConfig();
  res.json({
    success: true,
    configured: cfg.configured,
    // Business Login for Instagram (routes/instagramChannel.js) is set up too.
    instagramLoginConfigured: instagramLoginConfig().configured,
    connections: await listConnections(req.business._id),
  });
});

// { code } from FB.login → { sessionId, pages: [{ id, name, picture, instagram }] }
router.post('/login', async (req, res) => {
  try {
    const r = await startLogin(req.business, req.body?.code);
    res.json({ success: true, ...r });
  } catch (err) {
    fail(res, err, 'Meta business login');
  }
});

// { sessionId, pageId, channels: ['messenger', 'instagram'] }
router.post('/connect', async (req, res) => {
  try {
    const b = req.body || {};
    const connections = await connectPage(req.business, { sessionId: b.sessionId, pageId: b.pageId, channels: b.channels });
    res.json({ success: true, connections });
  } catch (err) {
    fail(res, err, 'Meta channel connect');
  }
});

router.delete('/:channel', async (req, res) => {
  try {
    const r = await disconnectChannel(req.business, String(req.params.channel || ''));
    res.json({ success: true, ...r });
  } catch (err) {
    fail(res, err, 'Meta channel disconnect');
  }
});

// ---------------- Super admin: app-level webhook subscriptions ----------------
export const metaSubscriptionsAdminRouter = express.Router();
metaSubscriptionsAdminRouter.use(requireSuperAdmin);

// Read-only: what the platform app is subscribed to (no tokens in it).
metaSubscriptionsAdminRouter.get('/', async (_req, res) => {
  try {
    res.json({ success: true, callbackUrl: metaWebhookUrl(), subscriptions: await readAppSubscriptions() });
  } catch (err) {
    const message = err.response?.data?.error?.message || err.message;
    res.status(502).json({ success: false, message });
  }
});

// Point the 'page' and 'instagram' objects at /api/meta/webhook (idempotent).
// Never touches the 'whatsapp_business_account' subscription.
metaSubscriptionsAdminRouter.post('/', async (_req, res) => {
  const r = await ensureAppSubscriptions();
  logger.info('Meta app subscriptions for page / instagram', {
    ok: r.ok, results: (r.results || []).map((x) => ({ object: x.object, ok: x.ok, changed: x.changed, error: x.error })),
  });
  res.status(r.ok ? 200 : 502).json({ success: r.ok, ...r });
});

// Lead ads (Feature F, opt-in): the same, plus 'leadgen' on the 'page' object
// so new leads reach /api/meta/webhook. Run it once when lead ads go live.
metaSubscriptionsAdminRouter.post('/leadgen', async (_req, res) => {
  const r = await ensureAppSubscriptions({ extraFields: { page: ['leadgen'] } });
  logger.info('Meta app subscriptions with leadgen', {
    ok: r.ok, results: (r.results || []).map((x) => ({ object: x.object, ok: x.ok, changed: x.changed, error: x.error })),
  });
  res.status(r.ok ? 200 : 502).json({ success: r.ok, ...r });
});

// Messenger utility templates (opt-in, like leadgen): the same, plus
// 'message_template_status_update' on the 'page' object, so Meta's review
// results reach /api/meta/webhook. Each Page also gets the field on its own
// subscription the first time the business uses utility templates.
metaSubscriptionsAdminRouter.post('/utility-templates', async (_req, res) => {
  const r = await ensureAppSubscriptions({ extraFields: { page: ['message_template_status_update'] } });
  logger.info('Meta app subscriptions with message_template_status_update', {
    ok: r.ok, results: (r.results || []).map((x) => ({ object: x.object, ok: x.ok, changed: x.changed, error: x.error })),
  });
  res.status(r.ok ? 200 : 502).json({ success: r.ok, ...r });
});

// Comment auto-DM (opt-in, like leadgen): 'feed' on the 'page' object and
// 'comments' on 'instagram', so new comments reach /api/meta/webhook. Each
// Page (and each Instagram-login account) also gets the field on its own
// subscription when the business saves a comment rule.
metaSubscriptionsAdminRouter.post('/comments', async (_req, res) => {
  const r = await ensureAppSubscriptions({ extraFields: { page: ['feed'], instagram: ['comments'] } });
  logger.info('Meta app subscriptions with feed / comments', {
    ok: r.ok, results: (r.results || []).map((x) => ({ object: x.object, ok: x.ok, changed: x.changed, error: x.error })),
  });
  res.status(r.ok ? 200 : 502).json({ success: r.ok, ...r });
});

export default router;
