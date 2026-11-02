import express from 'express';
import crypto from 'crypto';
import logger from '../services/logger.js';
import Business from '../models/Business.js';
import Template from '../models/Template.js';
import { handleStatus } from '../services/chatbot.js';
import { processInboundMessage, contactNames, parseIncoming } from '../services/inbound.js';
import { getClientForBusiness } from '../services/metaCloud.js';
import { handleSandboxValue, isSandboxNumber } from '../services/sandbox.js';
import { notifyTemplateStatus } from '../services/notifications.js';
import { logEcho, recordThreadControl, clearThreadControl } from '../services/otherApps.js';

// mergeParams so the :tenantId from the mount path is available here.
const router = express.Router({ mergeParams: true });

/**
 * A `message_template_status_update` change: Meta approved, rejected, paused
 * or disabled one of a tenant's templates. The entry id is the WABA, which is
 * how the tenant is found (these changes carry no phone number).
 */
async function applyTemplateStatus(wabaId, value, urlBiz) {
  const status = String(value?.event || '').toUpperCase();
  const name = value?.message_template_name;
  if (!status || !name) return;
  const biz = (wabaId && (await Business.findOne({ wabaId: String(wabaId) }))) || urlBiz;
  if (!biz) {
    logger.warn('template status update for an unknown WABA, dropped', { wabaId, name, status });
    return;
  }
  // The row as it was before (findOneAndUpdate returns the original), so the
  // owner is only notified when the status actually changed.
  const before = await Template.findOneAndUpdate(
    {
      businessId: biz._id,
      $or: [
        { name, ...(value.message_template_language ? { language: value.message_template_language } : {}) },
        ...(value.message_template_id ? [{ metaId: String(value.message_template_id) }] : []),
      ],
    },
    {
      $set: {
        status,
        // Why it was rejected / paused ("NONE" when there's nothing to say).
        rejectedReason: value.reason && value.reason !== 'NONE' ? String(value.reason) : '',
      },
    },
  ).select('status').lean();
  logger.info('template status updated by Meta', {
    tenant: biz.username, name, status, reason: value.reason || '', matched: before ? 1 : 0,
  });
  if (before) {
    notifyTemplateStatus(biz._id, { name, previous: before.status, status, reason: value.reason })
      .catch(() => {});
  }
}

async function resolveTenant(req) {
  const id = req.params.tenantId;
  if (!id) return null;
  try {
    return await Business.findById(id);
  } catch {
    return null;
  }
}

/**
 * The tenant a single change belongs to, taken from the business number that
 * received it.
 *
 * `metadata.phone_number_id` is the authoritative answer: it IS the business
 * number the customer messaged. The tenant id in the callback URL is only a
 * hint, and trusting it is what let one customer's "hi" land in two different
 * businesses — a callback URL pointing at the wrong tenant, or one Meta app
 * subscribed to several WABAs (Meta then delivers all of them to that app's
 * single callback URL), attributed every message to whichever tenant the URL
 * happened to name.
 *
 * Resolved per change rather than per request, because one delivery can carry
 * changes for more than one phone number.
 */
async function tenantForChange(value, urlBiz) {
  const pnId = value?.metadata?.phone_number_id;
  if (pnId) {
    try {
      const byNumber = await Business.findOne({ phoneNumberId: String(pnId) });
      if (byNumber) {
        if (urlBiz && String(byNumber._id) !== String(urlBiz._id)) {
          // Worth shouting about: the callback URL and the number disagree, so
          // somebody's Meta app is pointed at the wrong tenant.
          logger.warn('webhook callback URL names the wrong tenant for this number', {
            urlTenant: urlBiz.username,
            actualTenant: byNumber.username,
            phoneNumberId: String(pnId),
          });
        }
        return byNumber;
      }
      // The payload names a number no business has stored. If the webhook came
      // in on a *specific* tenant's callback URL, that URL is a deliberate
      // ownership signal we set up ourselves, so attribute it there rather than
      // dropping — otherwise a tenant whose stored phone number id doesn't
      // match the number customers actually message (a mis-pasted credential,
      // or a WABA with more than one number) goes permanently silent. This is
      // safe: a number belonging to a *different* tenant would have matched
      // above and never reached here, so there's no cross-tenant leak.
      if (urlBiz) {
        logger.warn('webhook phone number not stored on any business — attributing by callback URL', {
          incomingPhoneNumberId: String(pnId),
          urlTenant: urlBiz.username,
          urlTenantStoredPhoneNumberId: urlBiz.phoneNumberId,
          hint: 'Update this business\'s Phone number ID to the number customers message, so replies go out from the right number.',
        });
        return urlBiz;
      }
      // No tenant in the URL and an unknown number: nothing safe to do.
      logger.warn('webhook for an unknown phone number with no tenant in the URL, dropped', {
        phoneNumberId: String(pnId),
      });
      return null;
    } catch (err) {
      logger.warn('tenant lookup by phone number failed', { error: err.message });
      return urlBiz;
    }
  }
  // No metadata at all — fall back to the URL so nothing that used to work
  // stops working.
  return urlBiz;
}

// ---------- GET: webhook verification handshake (per tenant) ----------
router.get('/', async (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (!req.params.tenantId) {
    // The platform app's shared callback (Embedded Signup businesses).
    const platformToken = process.env.META_WEBHOOK_VERIFY_TOKEN || '';
    if (mode === 'subscribe' && platformToken && token === platformToken) {
      logger.info('platform WhatsApp webhook verified');
      return res.status(200).send(challenge);
    }
    if (mode === 'subscribe') {
      logger.warn('platform webhook verification failed');
      return res.sendStatus(403);
    }
    return res.json({ status: 'WhatsApp CRM webhook active', timestamp: new Date().toISOString() });
  }
  const biz = await resolveTenant(req);
  if (!biz) {
    logger.warn('Webhook verify: unknown tenant', { tenantId: req.params.tenantId });
    return res.sendStatus(404);
  }
  if (mode === 'subscribe' && token === biz.verifyToken) {
    logger.info('WhatsApp webhook verified', { tenant: biz.username });
    return res.status(200).send(challenge);
  }
  logger.warn('Webhook verification failed', { tenant: biz.username, tokenMatch: token === biz.verifyToken });
  return res.sendStatus(403);
});

// ---------- POST: incoming messages / statuses (per tenant) ----------
router.post('/', async (req, res) => {
  // The tenant named by the callback URL. Only a hint now — each change is
  // attributed to the business number that actually received it.
  const urlBiz = await resolveTenant(req);

  // The shared platform callback has no tenant to vouch for it, so it only
  // accepts deliveries signed by the platform app. Meta signs every one.
  if (!req.params.tenantId) {
    const secret = process.env.META_APP_SECRET || '';
    const signature = req.get('x-hub-signature-256') || '';
    const expected = secret && req.rawBody
      ? 'sha256=' + crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex')
      : '';
    if (!expected || !signature || !timingSafeEqual(signature, expected)) {
      logger.warn('platform webhook rejected: missing or bad signature');
      return res.sendStatus(401);
    }
  }

  // Only a delivery signed by the platform app may speak for the shared test
  // number, whichever callback URL it arrived on.
  const platformSigned = signedWith(req, process.env.META_APP_SECRET);

  // Signature is verified against the app that delivered this request, which
  // is the one the callback URL belongs to.
  if (urlBiz?.appSecret && req.rawBody) {
    const signature = req.get('x-hub-signature-256') || '';
    const expected = 'sha256=' + crypto.createHmac('sha256', urlBiz.appSecret).update(req.rawBody).digest('hex');
    if (signature && !timingSafeEqual(signature, expected)) {
      logger.warn('Webhook signature mismatch', { tenant: urlBiz.username });
      return res.sendStatus(401);
    }
  }

  res.sendStatus(200); // ack immediately

  try {
    const body = req.body;
    if (body.object !== 'whatsapp_business_account') return;

    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        // Meta approved / rejected / paused a template. Recorded locally, since
        // auto-send only ever fires templates stored as APPROVED.
        if (change.field === 'message_template_status_update') {
          applyTemplateStatus(entry.id, change.value, urlBiz)
            .catch((e) => logger.error('template status update failed', { error: e.message }));
          continue;
        }
        // Another app on this number took or passed the chat (thread control).
        if (change.field === 'messaging_handovers') {
          logger.info('WhatsApp thread control changed', {
            urlTenant: req.params.tenantId || '(none)',
            value: JSON.stringify(change.value || {}).slice(0, 300),
          });
          continue;
        }
        // `standby`: the chat is held by another Meta app on this number, so the
        // message comes here instead of on `messages`. Same shape (sometimes
        // nested under `standby`), plus `message_echoes` for what that app sent.
        const standby = change.field === 'standby';
        if (change.field !== 'messages' && !standby) continue;
        const raw = change.value || {};
        const value = standby && raw.standby && typeof raw.standby === 'object' ? { ...raw, ...raw.standby } : raw;

        // The shared "try it" number belongs to no business: each sender is
        // routed to the business whose join code they sent. Checked before any
        // Business lookup, so its traffic can never be attributed by number or
        // by callback URL.
        if (isSandboxNumber(value?.metadata?.phone_number_id)) {
          if (!platformSigned) {
            logger.warn('sandbox webhook change without a platform-app signature, dropped');
            continue;
          }
          handleSandboxValue(value).catch((e) => logger.error('sandbox webhook failed', { error: e.message }));
          continue;
        }

        // Who this actually belongs to. Done per change, so a delivery that
        // carries two phone numbers is split between the right two tenants.
        const biz = await tenantForChange(value, urlBiz);
        if (!biz) {
          // Nothing to attribute it to: a deleted business, or Meta retrying
          // against an old callback URL. Already acked, so just leave a trail —
          // answering 404 would make Meta retry and risk throttling the
          // subscription.
          logger.warn('webhook change could not be attributed to a tenant, dropped', {
            urlTenant: req.params.tenantId || '(none)',
            phoneNumberId: value?.metadata?.phone_number_id || '(none)',
          });
          continue;
        }
        const meta = getClientForBusiness(biz);
        const tenantId = String(biz._id);
        // Carried into handlers so documents/messages can show the business name.
        const tenantName = biz.meta?.verifiedName || biz.name || '';

        if (value.statuses?.length) {
          for (const status of value.statuses) {
            handleStatus(status, { meta, tenantId, tenantName }).catch((e) => logger.error('handleStatus error', { error: e.message }));
          }
        }

        const names = contactNames(value);
        for (const message of value.messages || []) {
          // Logging, media, flow submissions, carts and automation — shared
          // with the sandbox number (services/inbound.js). On standby the
          // message is logged but our automation doesn't answer.
          await processInboundMessage(message, names, { meta, tenantId, tenantName, standby });
        }
        if (standby) {
          if (value.messages?.length) {
            recordThreadControl(tenantId, { phone: value.messages[0]?.from, via: 'standby' }).catch(() => {});
          }
          for (const echo of value.message_echoes || []) await logEcho(echo, { tenantId });
        } else if (value.messages?.length && biz.meta?.threadControl?.at) {
          // A customer message on `messages`: our app holds chats again.
          clearThreadControl(tenantId).catch(() => {});
        }
      }
    }
  } catch (err) {
    logger.error('Webhook processing error', { error: err.message, stack: err.stack });
  }
});

// Moved to services/inbound.js (shared with the sandbox number); re-exported
// so existing imports keep working.
export { parseIncoming };

// ---------- The shared "try it" number's own callback ----------
// <PUBLIC_BASE_URL>/api/whatsapp/webhook/sandbox, set as the sandbox WABA's
// override (services/webhookSetup.js syncSandboxWebhook). The sandbox lives
// under the platform app, so deliveries are signed with META_APP_SECRET.
export const sandboxWebhookRouter = express.Router();

sandboxWebhookRouter.get('/', (req, res) => {
  const want = process.env.SANDBOX_WEBHOOK_VERIFY_TOKEN || '';
  if (req.query['hub.mode'] === 'subscribe' && want && req.query['hub.verify_token'] === want) {
    logger.info('sandbox WhatsApp webhook verified');
    return res.status(200).send(req.query['hub.challenge']);
  }
  if (req.query['hub.mode'] === 'subscribe') {
    logger.warn('sandbox webhook verification failed');
    return res.sendStatus(403);
  }
  return res.json({ status: 'WhatsApp CRM sandbox webhook active', timestamp: new Date().toISOString() });
});

sandboxWebhookRouter.post('/', (req, res) => {
  if (!signedWith(req, process.env.META_APP_SECRET)) {
    logger.warn('sandbox webhook rejected: missing or bad signature');
    return res.sendStatus(401);
  }
  res.sendStatus(200); // ack immediately

  const body = req.body || {};
  if (body.object !== 'whatsapp_business_account') return;
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      // Template status changes are ignored: the sandbox's templates are not
      // any business's templates.
      if (change.field !== 'messages') continue;
      const value = change.value || {};
      if (!isSandboxNumber(value?.metadata?.phone_number_id)) {
        logger.warn('sandbox webhook change for another phone number, dropped', {
          phoneNumberId: value?.metadata?.phone_number_id || '(none)',
        });
        continue;
      }
      handleSandboxValue(value).catch((e) => logger.error('sandbox webhook failed', { error: e.message }));
    }
  }
});

/** Is this request signed (x-hub-signature-256) with `secret`? */
export function signedWith(req, secret) {
  if (!secret || !req.rawBody) return false;
  const signature = req.get('x-hub-signature-256') || '';
  if (!signature) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');
  return timingSafeEqual(signature, expected);
}

function timingSafeEqual(a, b) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export default router;
