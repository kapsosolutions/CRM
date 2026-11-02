// Generic inbound handling for the CRM.
//
// This is intentionally minimal and reusable: it logs every inbound message
// (downloading + re-hosting media), tracks delivery/read receipts and emoji
// reactions, and — only if AUTO_REPLY_ENABLED is true and the chat is not
// paused — sends a single configurable auto-reply. Drop your own automation
// into handleMessage() if a project needs a richer bot.
import metaCloud from './metaCloud.js';
import storage from './storage.js';
import logger from './logger.js';
import Message from '../models/Message.js';
import Member from '../models/Member.js';
import { emitMessage, emitStatus } from './eventBus.js';
import { setReaction } from './reactions.js';
import { touchInbound, touchOutbound, getConversation } from './conversationState.js';
import { runJourney } from './journeyRuntime.js';
import { tenantHasFeature } from './planGate.js';
import { runFlowMap, runFlowCompletion, settlePayment } from './flowMapRuntime.js';
import { saveFlowSubmission } from './registrations.js';
import { runKeywordTrigger } from './templateTriggers.js';
import { orderTokens, dateLabel } from './flowRuntime.js';
import { to12h } from './slots.js';
import { addressFor, mapImageFor } from './geocode.js';
import { statusesBelow, parkStatus, takeParkedStatus, statusError } from './messageStatus.js';
import { notifyChatMessage } from './notifications.js';

// Log an inbound message to the CRM chat log. For media messages we download
// the bytes from Meta, host them on Cloudinary, and store the URL so the CRM
// can render the image/video/audio/document.
export async function logInbound(phone, name, type, body, raw, metaMessageId, media, ctx = {}) {
  const meta = ctx.meta || metaCloud;
  const businessId = ctx.tenantId || null;
  try {
    let mediaInfo = null;
    if (media?.id) {
      try {
        const { buffer, mime } = await meta.downloadMedia(media.id);
        const resourceType = mime.startsWith('image/')
          ? 'image'
          : mime.startsWith('video/') || mime.startsWith('audio/')
            ? 'video'
            : 'raw';
        const url = await storage.uploadBuffer(buffer, storage.mediaFolder(businessId, 'inbound'), resourceType);
        mediaInfo = { url, type, mime, filename: media.filename || '', caption: media.caption || '' };
      } catch (e) {
        logger.warn('inbound media download failed', {
          error: e.response?.data?.error?.message || e.message,
        });
      }
    }
    // A resolved flow submission rides along in `raw` so the CRM can render it
    // as a table without re-reading the flow definition.
    const base = mediaInfo ? { meta: raw, media: mediaInfo } : { ...raw };
    if (ctx.form) base.form = ctx.form;
    // A resolved cart replaces Meta's raw `order` payload: the CRM needs
    // product names, line totals and photos, which only this side can work out
    // from the retailer ids.
    if (ctx.order) base.order = ctx.order;
    // A reply to one of the chat's messages: the quote the CRM shows above it.
    if (ctx.replyTo) base.replyTo = ctx.replyTo;
    const doc = await Message.create({
      phone, name, direction: 'in', type,
      body: media ? media.caption || '' : body || '',
      raw: base,
      metaMessageId, status: 'received',
      ...(businessId ? { businessId } : {}),
      // When the customer sent it (services/inbound.js inboundTime), so quick
      // messages and photos stay in the order they were sent.
      ...(ctx.at instanceof Date && !Number.isNaN(ctx.at.getTime()) ? { createdAt: ctx.at } : {}),
    });
    // Conversation first (24h window, unread, last message), then the CRM is
    // told — so the chat list it refreshes on that event is already current.
    await touchInbound(phone, name, body, businessId);
    emitMessage(doc);
    // The bell: one unread notification per chat, updated per message. A
    // payment outcome is reported by its own notification instead.
    if (businessId && type !== 'payment') {
      // Their first message to this business opens a new chat.
      Message.exists({ businessId, phone, direction: 'in', _id: { $ne: doc._id } })
        .then((before) => notifyChatMessage(businessId, { phone, name, type, body: doc.body, isNew: !before }))
        .catch(() => {});
    }

    // A dropped pin has no name or address. Saved first (so the chat keeps its
    // order), then the address is resolved — cached, rate-limited queue — and
    // the updated message is pushed again so the CRM bubble can say where it
    // is, like WhatsApp's map label.
    const loc = base.location;
    if (type === 'location' && loc) {
      const set = {};
      // A saved place already has its name/address; only a bare pin needs one.
      if (!loc.name && !loc.address) {
        const address = await addressFor(loc.latitude, loc.longitude, { waitMs: 10000 }).catch(() => '');
        if (address) set['raw.location.resolvedAddress'] = address;
      }
      // Ola map picture, fetched once and hosted (the CRM falls back to its
      // own tile map when there isn't one).
      const mapUrl = await mapImageFor(loc.latitude, loc.longitude).catch(() => '');
      if (mapUrl) set['raw.location.mapUrl'] = mapUrl;
      if (Object.keys(set).length) {
        const updated = await Message.findByIdAndUpdate(doc._id, { $set: set }, { new: true }).catch(() => null);
        if (updated) emitMessage(updated);
      }
    }
  } catch (err) {
    logger.warn('logInbound failed', { error: err.message });
  }
}

// Inbound emoji reaction on a message -> store it as the customer's (an empty
// emoji removes it) + notify the CRM. The business's own reaction stays.
export async function handleReaction(reaction, ctx = {}) {
  try {
    const messageId = reaction?.message_id;
    if (!messageId) return;
    await setReaction({ businessId: ctx.tenantId || null, metaMessageId: messageId, side: 'in', emoji: reaction.emoji || '' });
  } catch (err) {
    logger.debug('handleReaction error', { error: err.message });
  }
}

const PAID_STATES = ['captured', 'success', 'successful', 'completed', 'paid', 'authorized'];
const FAILED_STATES = ['failed', 'cancelled', 'canceled', 'declined', 'expired', 'error'];

/**
 * A native WhatsApp Pay outcome, from wherever it arrived.
 *
 * Meta delivers this in more than one shape depending on API version: as a
 * `payment` object on a delivery status, nested under an inbound interactive
 * message, or as its own top-level `payment` message. We only handled the
 * first, so a customer could pay and the conversation would still never reach
 * the confirmation — the money moved and the booking stayed unconfirmed.
 *
 * Keyed by the reference_id we put on the card, which is the order's own
 * reference. Field names also vary, so each is read from every known location.
 *
 * @returns {Promise<boolean>} true when this update actually changed something.
 *   A duplicate of an outcome already recorded, a non-final status, or one we
 *   can't tie to an order all return false — Meta and the gateway can both
 *   report the same capture, and a customer must not be confirmed twice.
 */
export async function handlePaymentUpdate(payment, ctx = {}) {
  if (!payment) return false;
  const reference = payment.reference_id
    || payment.referenceId
    || payment.transaction?.reference_id
    || payment.receipt
    || '';
  const state = String(
    payment.status || payment.transaction?.status || payment.payment_status || '',
  ).toLowerCase();
  const transactionId = payment.transaction?.id
    || payment.transaction_id
    || payment.payment_id
    || payment.id
    || '';

  logger.info('native payment update', { reference, state, transactionId, tenant: ctx.tenantName });
  if (!reference) {
    // Nothing to tie it to. Logged with the raw object because this is the one
    // case where guessing would settle the wrong order.
    logger.warn('payment update carried no reference id, ignored', { state, raw: JSON.stringify(payment).slice(0, 400) });
    return false;
  }

  const outcome = PAID_STATES.includes(state) ? 'paid' : FAILED_STATES.includes(state) ? 'failed' : '';
  if (!outcome) {
    logger.info('payment status not final, waiting', { reference, state });
    return false;
  }
  return settlePayment(ctx.meta || metaCloud, {
    reference, outcome, transactionId, businessId: ctx.tenantId,
  });
}

// Delivery/read receipts -> update the stored message + notify the CRM (ticks).
export async function handleStatus(status, ctx = {}) {
  try {
    // A native WhatsApp Pay outcome can arrive as a status carrying a
    // `payment` object rather than a delivery receipt.
    if (status?.payment) {
      await handlePaymentUpdate(status.payment, ctx);
      return;
    }

    const { id, status: st } = status;
    if (!id || !st) return;
    const scope = { metaMessageId: id, ...(ctx.tenantId ? { businessId: ctx.tenantId } : {}) };
    // A failure carries Meta's reason (code, title, details); keep it so the
    // chat and the campaign results can say why it wasn't delivered.
    const error = st === 'failed' ? statusError(status) : null;
    const set = { status: st, ...(error ? { error } : {}) };
    // Only move forward: a late "sent" must not undo "delivered"/"read".
    const res = await Message.updateOne(
      { ...scope, status: { $in: statusesBelow(st) } },
      { $set: set },
    );
    if (!res.matchedCount) {
      // Already at/after this status: nothing to do.
      if (await Message.exists(scope)) return;
      // The receipt beat our own save of the message: park it for logOutbound,
      // then try once more in case the save finished in between.
      parkStatus(id, st, error);
      const again = await Message.updateOne(
        { ...scope, status: { $in: statusesBelow(st) } },
        { $set: set },
      );
      if (!again.matchedCount) return;
      takeParkedStatus(id);
    }
    emitStatus({ metaMessageId: id, status: st, ...(error ? { error } : {}) }, ctx.tenantId);
  } catch (err) {
    logger.debug('handleStatus error', { error: err.message });
  }
}

// Main inbound handler. Pause-aware: if an agent paused automation for this
// chat, never auto-reply (the message is still logged for the CRM).
export async function handleMessage(msg, ctx = {}) {
  const meta = ctx.meta || metaCloud;
  const { phone, type } = msg;

  const convo = await getConversation(phone, ctx.tenantId);
  if (convo?.botPaused) {
    logger.debug('automation paused, skipping auto-reply', { phone });
    return;
  }
  // Automation (journeys, flows, auto-replies) is a plan feature: on the Free
  // plan the message is only logged for the team inbox (services/plans.js).
  if (ctx.tenantId && !(await tenantHasFeature(ctx.tenantId, 'flows'))) {
    logger.debug('automation not in this plan, skipping auto-reply', { tenant: ctx.tenantName || String(ctx.tenantId) });
    return;
  }

  // A completed native Flow (register / booking form) → store the submission so
  // it shows up in the CRM, then stop (there's nothing to auto-reply to).
  if (type === 'flow_reply') {
    try {
      const result = await saveFlowSubmission(msg.formData, phone, ctx.tenantId);
      // Continue the conversation along the map: the submitting screen may be
      // wired to a confirmation block. Live values (order id, customer name…)
      // are passed through for {{token}} substitution in the block body.
      const reg = result?.registration;
      const ot = orderTokens(result?.order);
      const fields = reg?.fields || {};
      // The fee for whoever the appointment is with. Needed as a real number,
      // not just display text: it's what an appointment is charged for, and
      // without it there's nothing for native payment to collect.
      const member = reg?.memberId
        ? await Member.findOne({
          _id: reg.memberId,
          ...(ctx.tenantId ? { businessId: ctx.tenantId } : {}),
        }).select('fee duration').lean().catch(() => null)
        : null;
      const feeValue = Number(member?.fee) || 0;
      const tokens = {
        ...ot,
        // Link any order created at this confirmation back to the appointment
        // row, so a future reschedule can find and move the exact same order.
        registration_id: reg?._id ? String(reg._id) : '',
        // A "My appointments" view has no order, so Ref/Status fall back to the
        // appointment's own reference and a readable status. A real order (when
        // one exists) still wins through `...ot`.
        order_id: ot.order_id || reg?.orderRef || '',
        order_status: ot.order_status
          || ({ new: 'Confirmed', contacted: 'Confirmed', confirmed: 'Confirmed', done: 'Completed', cancelled: 'Cancelled' }[reg?.status] || ''),
        // Appointment values, readable rather than raw: a date picker submits
        // epoch milliseconds and a slot is stored 24h, neither of which can be
        // shown to a customer. Without these, {{appointment_date}} in a
        // confirmation block resolved to nothing and the line was dropped.
        appointment_date: reg?.date ? dateLabel(reg.date) : '',
        appointment_slot: reg?.slot ? to12h(reg.slot) : '',
        member_fee: feeValue > 0 ? `₹${feeValue.toLocaleString('en-IN')}` : '',
        // Numeric twin, for the order total rather than for display.
        member_fee_value: feeValue,
        // The appointment as a real instant, for the order's scheduledAt.
        appointment_at: reg?.date && reg?.slot ? new Date(`${reg.date}T${reg.slot}:00`) : undefined,
        // Answers the business added to its own form. The resolved label is
        // preferred so a gender dropdown reads "Female", not "female".
        gender: fields.gender_label || fields.gender || '',
        age: fields.age || '',
        // Everything a document or message body might want to show. These are
        // what make one template work across businesses and flows.
        customer_name: reg?.name || ot.customer_name || '',
        member: reg?.memberName || '',
        // Fall through to the order's own value rather than blanking it: an
        // "Order details" block reports a *stored* order, so the category it
        // was placed under is on the order, not on this submission.
        category: reg?.category || ot.category || '',
        business_name: ctx.tenantName || '',
        customer_phone: phone ? `+${phone}` : '',
        customer_email: reg?.email || '',
        today: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'numeric', year: 'numeric' }),
        // On a cancellation the stamp is set; otherwise fall back to today so a
        // "cancelled on" line is never blank on a cancellation document.
        cancelled_date: ot.cancelled_date
          || (result?.action === 'cancel'
            ? new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'numeric', year: 'numeric' })
            : ''),
      };
      const sent = await runFlowCompletion(meta, phone, msg.formData || {}, tokens, ctx.tenantId, result?.action);
      if (sent) await touchOutbound(phone, '[flow]', ctx.tenantId);
    } catch (e) {
      logger.warn('flow submission handling failed', { error: e.message, stack: e.stack });
    }
    return;
  }

  // On the shared test number (ctx.sandbox) only journeys run: keyword
  // templates and native Flows belong to the business's own WABA.
  //
  // A keyword-triggered template is checked first, and only first: the flow map
  // below treats *any* message as "start", so anything downstream of it would
  // never see the keyword.
  if (ctx.tenantId && !ctx.sandbox) {
    try {
      const fired = await runKeywordTrigger(meta, ctx.tenantId, msg);
      if (fired) return;
    } catch (e) {
      logger.warn('keyword trigger failed', { error: e.message });
    }
  }

  // Run the Flow map next — it owns native-Flow screens and its reply ids are
  // `f:…`. If a Flow has a Start node wired to an entry (entryTarget), it drives
  // the conversation; otherwise this is a no-op and journeys take over.
  try {
    const handled = !ctx.sandbox && (await runFlowMap(meta, ctx.tenantId, msg, convo));
    if (handled) {
      await touchOutbound(phone, '[flow]', ctx.tenantId);
      return;
    }
  } catch (e) {
    // Surface Meta's actual reason, not just "status code 400" — a bad token,
    // a number not on the allowed list, or the 24h window all look identical
    // without it.
    const meta400 = e.response?.data?.error;
    logger.warn('flow map run failed', {
      error: e.message,
      metaError: meta400 ? { message: meta400.message, code: meta400.code, subcode: meta400.error_subcode, details: meta400.error_data?.details } : undefined,
    });
  }

  // Then the tenant's journey (welcome on first contact + advance on reply-
  // button / list / shared-location). Reply ids are `n:…`. If it handled it, stop.
  if (ctx.tenantId) {
    try {
      const handled = await runJourney(meta, ctx.tenantId, msg, convo);
      if (handled) {
        await touchOutbound(phone, '[journey]', ctx.tenantId);
        return;
      }
    } catch (e) {
      // Meta's reason, not just "status code 400" (that hid a duplicate
      // button title that stopped a whole journey).
      const metaErr = e.response?.data?.error;
      logger.warn('journey run failed', {
        error: e.message,
        tenant: ctx.tenantName || String(ctx.tenantId),
        metaError: metaErr ? { message: metaErr.message, code: metaErr.code, details: metaErr.error_data?.details } : undefined,
        hint: metaErr?.code === 131056
          ? 'Meta pair rate limit: too many messages to this customer in a short time (fast testing). Meta clears it after a short wait.'
          : undefined,
      });
    }
  }

  // Media nobody claimed is logged for the agent and left alone. (With a flow
  // wired up this is unreachable — runFlowMap treats any message as "start".)
  if (['image', 'video', 'audio', 'document'].includes(type)) return;

  // Optional generic auto-reply.
  const enabled = String(process.env.AUTO_REPLY_ENABLED || 'false').toLowerCase() === 'true';
  if (!enabled) return;

  const text =
    process.env.AUTO_REPLY_TEXT ||
    'Thanks for your message! Our team will get back to you shortly.';
  try {
    await meta.sendText(phone, text);
    await touchOutbound(phone, text, ctx.tenantId);
  } catch (e) {
    logger.warn('auto-reply failed', { error: e.response?.data?.error?.message || e.message });
  }
}

export default { handleMessage, handleStatus, handleReaction, logInbound };
