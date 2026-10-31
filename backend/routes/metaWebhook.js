// Webhook for Messenger (object 'page') and Instagram (object 'instagram'):
// <PUBLIC_BASE_URL>/api/meta/webhook, set as the platform app's callback for
// those two objects (services/metaChannels.js ensureAppSubscriptions), and as
// the callback of the Instagram product's "API setup with Instagram login"
// (Business Login for Instagram, services/instagramLogin.js).
// The WhatsApp webhooks stay where they are (routes/webhook.js).
//
// Verification uses META_WEBHOOK_VERIFY_TOKEN. Every delivery must be signed
// (x-hub-signature-256) or it is refused with 401: with META_APP_SECRET for
// Page / Facebook-login events, or with INSTAGRAM_APP_SECRET for events of
// accounts connected through Business Login for Instagram (Meta signs those
// with the Instagram app secret).
import express from 'express';
import { signedWith } from './webhook.js';
import { handleMetaWebhook } from '../services/metaChannelInbound.js';
import logger from '../services/logger.js';

const router = express.Router();

router.get('/', (req, res) => {
  const want = process.env.META_WEBHOOK_VERIFY_TOKEN || '';
  if (req.query['hub.mode'] === 'subscribe' && want && req.query['hub.verify_token'] === want) {
    logger.info('Messenger / Instagram webhook verified');
    return res.status(200).send(String(req.query['hub.challenge'] ?? ''));
  }
  if (req.query['hub.mode'] === 'subscribe') {
    logger.warn('Messenger / Instagram webhook verification failed');
    return res.sendStatus(403);
  }
  return res.json({ status: 'Messenger / Instagram webhook active', timestamp: new Date().toISOString() });
});

/** 'meta' | 'instagram' — which app secret signed this delivery — or '' for neither. */
export function webhookSigner(req) {
  if (signedWith(req, process.env.META_APP_SECRET)) return 'meta';
  if (signedWith(req, process.env.INSTAGRAM_APP_SECRET)) return 'instagram';
  return '';
}

router.post('/', (req, res) => {
  const signer = webhookSigner(req);
  if (!signer) {
    logger.warn('Messenger / Instagram webhook rejected: missing or bad signature');
    return res.sendStatus(401);
  }
  res.sendStatus(200); // ack straight away; Meta retries slow answers
  // The Instagram app only ever speaks for object 'instagram' (never Pages or leads).
  if (signer === 'instagram' && req.body?.object !== 'instagram') {
    logger.warn('webhook signed with the Instagram app secret for another object, dropped', { object: req.body?.object || '(none)' });
    return undefined;
  }
  handleMetaWebhook(req.body || {}).catch((err) => logger.error('Messenger / Instagram webhook failed', { error: err.message }));
  return undefined;
});

export default router;
