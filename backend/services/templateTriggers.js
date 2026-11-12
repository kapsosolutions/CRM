// ---------------------------------------------------------------------------
// Automatic template sends.
//
// Two triggers, both opt-in per template:
//   • keyword      — the customer sends "price" and the price-list template
//                    goes out, without an agent or a flow in the way.
//   • order status — an order moves to "out for delivery" and the matching
//                    template is sent to whoever placed it.
//
// Only APPROVED templates are ever sent: Meta rejects anything else, and a
// pending template firing on a keyword would just produce failed sends.
// ---------------------------------------------------------------------------
import Template from '../models/Template.js';
import { resolveTemplateParams } from './templateVars.js';
import { renderTemplate, renderedPreview } from './templateRender.js';
import { touchOutbound } from './conversationState.js';
import { to12h } from './slots.js';
import { isAuthTemplate, authSendOptions } from './authTemplate.js';
import logger from './logger.js';

const scope = (businessId) => (businessId ? { businessId } : {});

/** "  Price List  " and "price list" are the same keyword. */
const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Everything Meta needs to send a stored template, besides its name: the
 * header media (Meta wants it on every send), the body's {{n}} values, a
 * carousel's card media, and a limited-time offer's code and end time.
 *
 * @param {object} template  the stored Template
 * @param {object} ctx       { phone, business, order, appointment } for placeholders
 * @param {object} overrides { bodyParams?, ltoCode?, ltoExpiresAt?, otpCode? } from the sender
 */
export async function templateSendOptions(template, ctx = {}, overrides = {}) {
  // Authentication templates take one value, the code: the one given (an
  // agent's, a campaign row's), or a fresh one for automatic sends.
  if (isAuthTemplate(template)) return authSendOptions(template, overrides);
  const opts = {
    languageCode: template.language || 'en_US',
    bodyParams: Array.isArray(overrides.bodyParams) && overrides.bodyParams.length
      ? overrides.bodyParams
      : await resolveTemplateParams(template, ctx),
  };
  const fmt = String(template.headerFormat || '').toLowerCase();
  if (template.headerMediaUrl && fmt !== 'text') {
    opts.headerImageUrl = template.headerMediaUrl;
    // Older rows have no headerFormat; they were all images.
    opts.headerFormat = fmt || 'image';
    if (fmt === 'document') opts.headerFileName = template.headerFileName || 'Document.pdf';
  }
  if (template.kind === 'carousel' && template.cards?.length) {
    opts.cards = template.cards.map((c) => ({ mediaUrl: c.mediaUrl, mediaFormat: c.mediaFormat }));
  }
  if (template.kind === 'lto') {
    const lto = template.lto || {};
    const code = String(overrides.ltoCode || lto.code || '').trim();
    const end = overrides.ltoExpiresAt ? new Date(overrides.ltoExpiresAt) : lto.endsAt ? new Date(lto.endsAt) : null;
    if (lto.hasCopyCode && !code) {
      throw Object.assign(new Error('This offer needs a code to send.'), { status: 400 });
    }
    if (lto.hasExpiration) {
      if (!end || Number.isNaN(end.getTime())) {
        throw Object.assign(new Error('Set when the offer ends before sending it.'), { status: 400 });
      }
      if (end.getTime() <= Date.now()) {
        throw Object.assign(new Error('This offer has already ended. Pick a later end time.'), { status: 400 });
      }
    }
    opts.lto = {
      ...(lto.hasCopyCode ? { code } : {}),
      ...(lto.hasExpiration ? { expiresAtMs: end.getTime() } : {}),
    };
  }
  return opts;
}

/**
 * Send one template to a number, filling its placeholders from live data.
 * @returns true when Meta accepted it
 */
export async function sendTemplateTo(meta, phone, template, ctx = {}) {
  try {
    const opts = await templateSendOptions(template, { ...ctx, phone });
    const bodyParams = opts.bodyParams;
    await meta.sendTemplate(phone, template.name, opts);
    await touchOutbound(phone, renderedPreview(renderTemplate(template, opts), template.name), ctx.business?._id);
    logger.info('template sent automatically', {
      template: template.name, phone, params: bodyParams.length, reason: ctx.reason || '',
    });
    return true;
  } catch (err) {
    // Surfaced rather than swallowed: a trigger that silently fails looks to
    // the business like the automation was never set up.
    logger.error('automatic template send failed', {
      template: template?.name, phone, error: err.response?.data?.error?.message || err.message,
    });
    return false;
  }
}

/**
 * An inbound message that exactly matches a keyword → send that template.
 *
 * Deliberately a whole-message match. Substring matching would hijack ordinary
 * sentences ("what's the price of biryani" would fire the price template and
 * swallow a real question), which is worse than not firing at all.
 *
 * @returns true when a template was sent, so the caller stops processing
 */
export async function runKeywordTrigger(meta, businessId, msg) {
  const text = norm(msg?.text);
  if (!text || msg.type !== 'text') return false;

  let templates = [];
  try {
    templates = await Template.find({
      ...scope(businessId),
      status: 'APPROVED',
      'trigger.enabled': true,
      'trigger.keywords.0': { $exists: true },
    }).lean();
  } catch (err) {
    logger.warn('keyword trigger lookup failed', { error: err.message });
    return false;
  }

  const hit = templates.find((t) => (t.trigger?.keywords || []).some((k) => norm(k) === text));
  if (!hit) return false;

  logger.info('keyword matched a template', { keyword: text, template: hit.name });
  return sendTemplateTo(meta, msg.phone, hit, { reason: `keyword:${text}` });
}

/**
 * An order reached a status some template is waiting on → send it.
 *
 * @param {object} order the order *after* the change (needs phone + status)
 * @returns the number of templates sent
 */
export async function runOrderStatusTrigger(meta, business, order) {
  if (!order?.phone || !order?.status) return 0;
  const businessId = business?._id ? String(business._id) : (order.businessId ? String(order.businessId) : '');

  let templates = [];
  try {
    templates = await Template.find({
      ...scope(businessId),
      status: 'APPROVED',
      'trigger.enabled': true,
      'trigger.statuses': order.status,
    }).lean();
  } catch (err) {
    logger.warn('order-status trigger lookup failed', { error: err.message });
    return 0;
  }
  if (!templates.length) return 0;

  let sent = 0;
  for (const t of templates) {
    // eslint-disable-next-line no-await-in-loop
    const okSend = await sendTemplateTo(meta, order.phone, t, {
      business, order, reason: `status:${order.status}`,
    });
    if (okSend) sent += 1;
  }
  return sent;
}

// Every form asks these, so they say nothing about which form it was.
const SHARED_FIELDS = new Set(['name', 'whatsapp_number']);
/**
 * Which ready-made form a submission came from: the form most of its answered
 * fields belong to in the flow that sent it (fields added from the Forms menu
 * carry the form's id, `preset`). '' when it was built by hand.
 * Mirrors the first rule of presetOfSubmission (frontend crm/flowForms.ts).
 */
export function formOfSubmission(reg, flow) {
  const answered = new Set(Object.keys(reg?.fields || {}).filter((k) => !k.endsWith('_label') && !SHARED_FIELDS.has(k)));
  const votes = new Map();
  for (const s of flow?.screens || []) {
    for (const c of s.components || []) {
      if (c.preset && c.name && answered.has(c.name)) votes.set(c.preset, (votes.get(c.preset) || 0) + 1);
    }
  }
  let best = '';
  let most = 0;
  for (const [id, n] of votes) if (n > most) [best, most] = [id, n];
  return best;
}

/**
 * A form answer moved to a status some template is waiting on ("when a
 * Pre-arrival check-in becomes Confirmed") → send it to whoever filled it in.
 *
 * @param {object} reg  the Registration after the change
 * @param {string} form its ready-made form id (formOfSubmission)
 * @returns the number of templates sent
 */
export async function runFormStatusTrigger(meta, business, reg, form) {
  if (!reg?.phone || !reg?.status || !form) return 0;
  const businessId = business?._id ? String(business._id) : (reg.businessId ? String(reg.businessId) : '');
  const key = `${form}:${reg.status}`;
  let templates = [];
  try {
    templates = await Template.find({
      ...scope(businessId),
      status: 'APPROVED',
      'trigger.enabled': true,
      'trigger.formStatuses': key,
    }).lean();
  } catch (err) {
    logger.warn('form-status trigger lookup failed', { error: err.message });
    return 0;
  }
  if (!templates.length) return 0;
  // What the answer was for, so {{member}}, the date and the time can be quoted.
  const appointment = {
    memberName: reg.memberName || '',
    date: reg.date || '',
    dateLabel: reg.date || '',
    slotLabel: reg.slot ? to12h(reg.slot) : '',
  };
  let sent = 0;
  for (const t of templates) {
    // eslint-disable-next-line no-await-in-loop
    const okSend = await sendTemplateTo(meta, reg.phone, t, { business, appointment, reason: `form:${key}` });
    if (okSend) sent += 1;
  }
  return sent;
}

/**
 * A member was marked unavailable → tell the patients it affects.
 *
 * Fires on templates whose trigger lists the `member_unavailable` event. The
 * appointment context is passed through to the placeholder resolver so one
 * template reads back the doctor, the date and the time it was booked for.
 *
 * @param {object} business the owning tenant
 * @param {object} member   the member who became unavailable
 * @param {object} block    the unavailability entry ({ date, wholeDay, from, to, reason })
 * @param {object[]} appointments the affected bookings
 * @returns {Promise<{sent:number, skipped:number, reason?:string}>}
 */
export async function runMemberUnavailableTrigger(meta, business, member, block, appointments = []) {
  if (!appointments.length) return { sent: 0, skipped: 0 };
  const businessId = business?._id ? String(business._id) : '';

  let templates = [];
  try {
    templates = await Template.find({
      ...scope(businessId),
      status: 'APPROVED',
      'trigger.enabled': true,
      'trigger.events': 'member_unavailable',
    }).lean();
  } catch (err) {
    logger.warn('member-unavailable trigger lookup failed', { error: err.message });
    return { sent: 0, skipped: appointments.length, reason: err.message };
  }
  if (!templates.length) {
    // Worth saying plainly: the usual cause is a template that exists but is
    // still PENDING at Meta, in which case nothing can be sent yet.
    logger.info('member marked unavailable but no approved template is set to announce it', {
      member: member?.name, date: block?.date, appointments: appointments.length,
    });
    return { sent: 0, skipped: appointments.length, reason: 'no approved template with the "doctor unavailable" trigger' };
  }

  const dateLabel = block?.date
    ? new Date(`${block.date}T00:00:00`).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric',
    })
    : '';

  let sent = 0;
  let skipped = 0;
  for (const appt of appointments) {
    if (!appt.phone) { skipped += 1; continue; }
    const appointment = {
      memberName: appt.memberName || member?.name || '',
      date: appt.date || block?.date || '',
      dateLabel,
      slotLabel: appt.slot ? to12h(appt.slot) : '',
      reason: block?.reason || '',
    };
    for (const t of templates) {
      // eslint-disable-next-line no-await-in-loop
      const okSend = await sendTemplateTo(meta, appt.phone, t, {
        business, appointment, reason: 'member_unavailable',
      });
      if (okSend) sent += 1; else skipped += 1;
    }
  }
  logger.info('doctor-unavailable notices processed', {
    member: member?.name, date: block?.date, appointments: appointments.length, sent, skipped,
  });
  return { sent, skipped };
}

export default {
  templateSendOptions,
  sendTemplateTo,
  runKeywordTrigger,
  runOrderStatusTrigger,
  runFormStatusTrigger,
  formOfSubmission,
  runMemberUnavailableTrigger,
};
