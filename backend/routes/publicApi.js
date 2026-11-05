// ---------------------------------------------------------------------------
// Public API, v1: a business's own apps and servers send its approved WhatsApp
// templates (and one-time codes) with an API key (middleware/apiKey.js).
//
//   GET  /api/v1/templates                 approved templates and what each needs
//   POST /api/v1/messages/template         send a template          { to, template, variables?, ... }
//   GET  /api/v1/messages/:id              delivery status of a sent message
//   POST /api/v1/otp/send                  send a one-time code     { to, template?, code?, codeLength? }
//   POST /api/v1/otp/verify                check the code the user typed { to, code }
//
// Errors are { error: { code, message } } with a meaningful HTTP status.
// Sends go through the same path as the CRM's (plan, contact limit, credits,
// blocked contacts), and show up in the business's chats.
// An Idempotency-Key header makes a retried send safe: the same key within
// 24 hours returns the first answer instead of sending again.
// ---------------------------------------------------------------------------
import express from 'express';
import Template from '../models/Template.js';
import Message from '../models/Message.js';
import { requireApiKey, apiError } from '../middleware/apiKey.js';
import { getClientForBusiness } from '../services/metaCloud.js';
import { isWhatsAppConnected } from '../services/sandbox.js';
import { templateSendOptions } from '../services/templateTriggers.js';
import { isAuthTemplate, generateOtp, checkOtpCode, authSendOptions } from '../services/authTemplate.js';
import { renderTemplate, renderedPreview } from '../services/templateRender.js';
import { touchOutbound } from '../services/conversationState.js';
import { isBlocked } from '../services/chatFlags.js';
import { assertFeature, PlanLimitError } from '../services/plans.js';
import { storeOtp, verifyOtp } from '../services/apiKeys.js';
import logger from '../services/logger.js';

const router = express.Router();
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
router.use(requireApiKey);

const VAR_RE = /\{\{\s*(\d+)\s*\}\}/g;

class ApiFail extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

/** A WhatsApp number as digits: 8–15 of them (E.164 without the +). */
function phoneOf(raw) {
  const d = String(raw ?? '').replace(/[\s()+.-]/g, '');
  if (!/^\d{8,15}$/.test(d)) throw new ApiFail(400, 'invalid_phone', '"to" must be a phone number with country code, e.g. "+919876543210".');
  return d;
}

const bodyOf = (t) => (t.components || []).find((c) => String(c.type).toUpperCase() === 'BODY')?.text || t.bodyText || '';
function varCount(t) {
  let n = 0;
  for (const m of bodyOf(t).matchAll(VAR_RE)) n = Math.max(n, Number(m[1]));
  return n;
}
const headerFormatOf = (t) => {
  const h = (t.components || []).find((c) => String(c.type).toUpperCase() === 'HEADER');
  const f = String(t.headerFormat || h?.format || '').toLowerCase();
  return ['image', 'video', 'document', 'text'].includes(f) ? f : null;
};

/** What a caller needs to know to send a template. */
function describe(t) {
  return {
    name: t.name,
    language: t.language || 'en_US',
    category: String(t.category || '').toUpperCase(),
    kind: t.kind || 'standard',
    variables: isAuthTemplate(t) ? 0 : varCount(t),
    header: headerFormatOf(t),
    otp: isAuthTemplate(t),
    ...(t.kind === 'lto' ? { offer: { code: !!t.lto?.hasCopyCode, expiration: !!t.lto?.hasExpiration } } : {}),
    body: isAuthTemplate(t) ? '' : bodyOf(t),
  };
}

function ready(biz) {
  if (!isWhatsAppConnected(biz)) {
    throw new ApiFail(409, 'whatsapp_not_connected', 'Connect your own WhatsApp number in the CRM before using the API.');
  }
  // Templates are part of the plan (every paid plan and the trial today).
  assertFeature(biz, 'templates');
}

async function approvedTemplate(businessId, name) {
  const n = String(name || '').trim();
  if (!n) throw new ApiFail(400, 'missing_template', '"template" is required: the template name, e.g. "order_update".');
  const t = await Template.findOne({ businessId, name: n }).lean();
  if (!t) throw new ApiFail(404, 'template_not_found', `No template named "${n}" in your account.`);
  const status = String(t.status || '').toUpperCase();
  if (status !== 'APPROVED') {
    throw new ApiFail(409, 'template_not_approved', `"${n}" is ${status.toLowerCase() || 'not approved'}. Only templates WhatsApp approved can be sent.`);
  }
  return t;
}

/** Meta's refusal, as an API error the caller can act on. */
function whatsappFailure(err) {
  const e = err?.response?.data?.error;
  if (!e) return null;
  const code = Number(e.code) || null;
  const known = {
    131026: [422, 'recipient_unavailable', 'This number can’t receive WhatsApp messages (not on WhatsApp, or an old app).'],
    131049: [422, 'not_delivered', 'WhatsApp didn’t deliver this to keep a healthy experience for its users. Try later.'],
    131050: [422, 'recipient_opted_out', 'This person stopped marketing messages from your business.'],
    131056: [429, 'pair_rate_limited', 'Too many messages to this number in a short time. Wait a little and retry.'],
    130429: [429, 'throughput_limited', 'WhatsApp’s sending rate for your number was reached. Retry shortly.'],
    131048: [429, 'spam_rate_limited', 'WhatsApp limited your number because of spam reports. Retry later.'],
    132000: [400, 'variables_mismatch', 'The number of variables doesn’t match the template.'],
    132001: [404, 'template_not_found', 'WhatsApp has no template with this name and language.'],
    132005: [400, 'text_too_long', 'A variable makes the message too long.'],
    132012: [400, 'variables_format', 'A variable isn’t in the format the template expects.'],
    131053: [400, 'media_failed', 'WhatsApp couldn’t fetch the header media. Check the URL is public.'],
    368: [403, 'number_restricted', 'Your WhatsApp number is temporarily restricted by Meta.'],
  };
  const [status, c, message] = known[code] || [502, 'whatsapp_error', e.error_data?.details || e.message || 'WhatsApp refused the message.'];
  return new ApiFail(status, c, message, { whatsappCode: code });
}

function respondError(res, err, what) {
  if (err instanceof ApiFail) return apiError(res, err.status, err.code, err.message, err.extra);
  if (err instanceof PlanLimitError) return apiError(res, err.status || 402, 'plan_limit', err.message);
  const wa = whatsappFailure(err);
  if (wa) {
    logger.info(`api ${what} refused by WhatsApp`, { code: wa.extra?.whatsappCode });
    return apiError(res, wa.status, wa.code, wa.message, wa.extra);
  }
  // Our own checks (e.g. an offer code or end time) carry a 400 and a message.
  if (err?.status && err.status < 500) return apiError(res, err.status, err.code ? String(err.code).toLowerCase() : 'invalid_request', err.message);
  logger.error(`api ${what} failed`, { error: err?.message });
  return apiError(res, 500, 'internal_error', 'Something went wrong on our side. Please retry.');
}

// ---------------------------------------------------------------- idempotency
const IDEM_TTL = 24 * 3600_000;
const idem = new Map(); // `${businessId}|${key}` -> { at, status, body } | { at, pending: true }
function idemKey(req) {
  const k = String(req.get('idempotency-key') || '').trim();
  if (!k) return null;
  if (k.length > 128) throw new ApiFail(400, 'invalid_idempotency_key', 'Idempotency-Key can be at most 128 characters.');
  return `${req.business._id}|${k}`;
}
async function once(req, res, run) {
  const k = idemKey(req);
  if (!k) return run();
  const hit = idem.get(k);
  if (hit && Date.now() - hit.at < IDEM_TTL) {
    if (hit.pending) return apiError(res, 409, 'idempotency_in_progress', 'A request with this Idempotency-Key is still running.');
    res.set('Idempotent-Replayed', 'true');
    return res.status(hit.status).json(hit.body);
  }
  idem.set(k, { at: Date.now(), pending: true });
  if (idem.size > 20000) for (const [key, v] of idem) if (Date.now() - v.at > IDEM_TTL) idem.delete(key);
  const json = res.json.bind(res);
  res.json = (body) => {
    // Only a settled answer is replayed; a server error can be retried.
    if (res.statusCode < 500) idem.set(k, { at: Date.now(), status: res.statusCode, body });
    else idem.delete(k);
    return json(body);
  };
  return run();
}

async function deliver(req, phone, template, opts) {
  const biz = req.business;
  if (await isBlocked(biz._id, phone)) throw new ApiFail(409, 'contact_blocked', 'You blocked this contact in the CRM.');
  const data = await getClientForBusiness(biz).sendTemplate(phone, template.name, opts);
  const id = data?.messages?.[0]?.id || '';
  // The chat list shows it like any other message.
  touchOutbound(phone, renderedPreview(renderTemplate(template, opts), template.name), biz._id).catch(() => {});
  logger.info('api template sent', { business: biz.name, template: template.name, key: req.apiKey.prefix });
  return id;
}

// ---------------------------------------------------------------- routes

router.get('/templates', async (req, res) => {
  try {
    const rows = await Template.find({ businessId: req.business._id, status: 'APPROVED' }).sort({ name: 1 }).lean();
    res.json({ data: rows.map(describe) });
  } catch (err) {
    respondError(res, err, 'templates');
  }
});

router.post('/messages/template', (req, res) => once(req, res, async () => {
  try {
    ready(req.business);
    const b = req.body || {};
    const phone = phoneOf(b.to);
    const t = await approvedTemplate(req.business._id, b.template);
    if (isAuthTemplate(t)) {
      throw new ApiFail(400, 'use_otp_endpoint', `"${t.name}" is an authentication template: send it with POST /api/v1/otp/send.`);
    }
    let variables;
    if (b.variables !== undefined) {
      if (!Array.isArray(b.variables) || b.variables.some((v) => typeof v === 'object' && v !== null)) {
        throw new ApiFail(400, 'invalid_variables', '"variables" must be a list of values for {{1}}, {{2}}, … in order.');
      }
      variables = b.variables.map((v) => String(v ?? '').trim());
      const need = varCount(t);
      if (variables.length !== need) {
        throw new ApiFail(400, 'variables_mismatch', `"${t.name}" takes ${need} variable${need === 1 ? '' : 's'}; ${variables.length} given.`, { expected: need });
      }
      if (variables.some((v) => !v)) throw new ApiFail(400, 'invalid_variables', 'Every variable needs a value.');
      if (variables.some((v) => v.length > 1024)) throw new ApiFail(400, 'invalid_variables', 'A variable can be at most 1,024 characters.');
    }
    const headerMediaUrl = b.headerMediaUrl ? String(b.headerMediaUrl) : '';
    if (headerMediaUrl && !/^https:\/\/\S+$/i.test(headerMediaUrl)) {
      throw new ApiFail(400, 'invalid_media_url', '"headerMediaUrl" must be a public https:// URL.');
    }
    // Without "variables", the template's own mapping fills them (the
    // contact's name and so on, with its fallbacks), like an automatic send.
    const opts = await templateSendOptions(t, { phone, business: req.business }, {
      ...(variables ? { bodyParams: variables } : {}),
      ...(b.offerCode !== undefined ? { ltoCode: b.offerCode } : {}),
      ...(b.offerExpiresAt !== undefined ? { ltoExpiresAt: b.offerExpiresAt } : {}),
    });
    if (headerMediaUrl) opts.headerImageUrl = headerMediaUrl;
    const id = await deliver(req, phone, t, opts);
    res.status(202).json({ id, to: phone, template: t.name, status: 'accepted' });
  } catch (err) {
    respondError(res, err, 'send');
  }
}));

router.get('/messages/:id', async (req, res) => {
  try {
    const id = String(req.params.id || '');
    if (!/^[\w.=:-]{8,200}$/.test(id)) throw new ApiFail(400, 'invalid_id', 'That isn’t a message id.');
    const m = await Message.findOne({ businessId: req.business._id, metaMessageId: id, direction: 'out' })
      .select('phone status error createdAt updatedAt').lean();
    if (!m) throw new ApiFail(404, 'message_not_found', 'No message with this id (a just-sent one can take a second to appear).');
    res.json({
      id, to: m.phone, status: m.status || 'sent',
      ...(m.status === 'failed' && m.error ? { error: { code: m.error.code ?? null, message: m.error.message || m.error.title || '' } } : {}),
      createdAt: m.createdAt, updatedAt: m.updatedAt,
    });
  } catch (err) {
    respondError(res, err, 'status');
  }
});

router.post('/otp/send', (req, res) => once(req, res, async () => {
  try {
    ready(req.business);
    const b = req.body || {};
    const phone = phoneOf(b.to);
    let t;
    if (b.template) {
      t = await approvedTemplate(req.business._id, b.template);
      if (!isAuthTemplate(t)) throw new ApiFail(400, 'not_otp_template', `"${t.name}" isn’t an authentication template.`);
    } else {
      // The business's approved authentication template (the newest).
      const auths = await Template.find({ businessId: req.business._id, status: 'APPROVED', category: 'AUTHENTICATION' }).sort({ updatedAt: -1 }).limit(1).lean();
      t = auths[0];
      if (!t) throw new ApiFail(404, 'template_not_found', 'You have no approved authentication template. Create one in Templates first.');
    }
    const given = b.code !== undefined && String(b.code).trim() !== '';
    let code;
    try {
      code = given ? checkOtpCode(b.code) : generateOtp(b.codeLength);
    } catch (e) {
      throw new ApiFail(400, 'invalid_code', e.message);
    }
    const opts = authSendOptions(t, { otpCode: code });
    const id = await deliver(req, phone, t, opts);
    const ttl = Number(t.auth?.codeExpirationMinutes) || 10;
    const expiresAt = await storeOtp({ businessId: req.business._id, phone, templateName: t.name, code, metaMessageId: id, ttlMinutes: ttl });
    res.status(202).json({
      id, to: phone, template: t.name, status: 'accepted', expiresAt,
      // A generated code is only returned when asked for (most apps just verify).
      ...(!given && b.returnCode === true ? { code } : {}),
    });
  } catch (err) {
    respondError(res, err, 'otp send');
  }
}));

router.post('/otp/verify', async (req, res) => {
  try {
    const b = req.body || {};
    const phone = phoneOf(b.to);
    const code = String(b.code ?? '').trim();
    if (!code || code.length > 15) throw new ApiFail(400, 'invalid_code', '"code" is required: what the user typed.');
    const out = await verifyOtp({ businessId: req.business._id, phone, code });
    res.json(out);
  } catch (err) {
    respondError(res, err, 'otp verify');
  }
});

router.use((req, res) => apiError(res, 404, 'not_found', `No API endpoint ${req.method} ${req.baseUrl}${req.path}.`));

export default router;
