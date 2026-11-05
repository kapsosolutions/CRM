// One inbound WhatsApp message, once the tenant it belongs to is known.
//
// Shared by the tenant webhooks (routes/webhook.js) and the shared "try it"
// number (services/sandbox.js), so a sandbox chat goes through exactly the
// same logging and automation as a business's own number.
import logger from './logger.js';
import {
  handleMessage, handleReaction, handlePaymentUpdate, logInbound,
} from './chatbot.js';
import { buildSubmissionSummary, summaryToText, storeFlowMedia } from './flowSubmission.js';
import storage from './storage.js';
import metaCloud from './metaCloud.js';
import { priceCart, cartToText, cartBubble } from './cart.js';
import { replyToFromContext } from './reactions.js';
import { emitCall } from './eventBus.js';
import { parsePollReply, recordPollVote } from './chatExtras.js';
import { isBlocked } from './chatFlags.js';

// Per chat and second: the last time handed out, so messages sent in the same
// second keep the order they reached us in.
const lastAtBySecond = new Map();

/**
 * When to file a customer message in the chat: when the customer sent it
 * (Meta's `timestamp`), not when it reached us. Meta delivers each message as
 * its own webhook and doesn't promise their order, and a photo is only saved
 * after its download, so messages sent back to back could show up swapped.
 *
 * Meta's time is in whole seconds. The latest moment of that second is used
 * (but never later than now), so a customer's reply never lands above our
 * message it answered; messages in the same second follow arrival order, 1 ms
 * apart. A missing or far-future timestamp falls back to now.
 * @returns {Date}
 */
export function inboundTime(message, tenantId, now = Date.now()) {
  const sec = Number(message?.timestamp);
  if (!Number.isFinite(sec) || sec <= 0 || sec * 1000 > now + 5 * 60 * 1000) return new Date(now);
  let at = Math.max(sec * 1000, Math.min(now, sec * 1000 + 999));
  const key = `${tenantId || ''}|${message.from || ''}|${sec}`;
  const prev = lastAtBySecond.get(key);
  if (prev !== undefined && at <= prev) at = prev + 1;
  lastAtBySecond.set(key, at);
  if (lastAtBySecond.size > 5000) {
    // Forget seconds older than an hour (Meta retries arrive well within it).
    const cutoff = Math.floor(now / 1000) - 3600;
    for (const k of lastAtBySecond.keys()) if (Number(k.slice(k.lastIndexOf('|') + 1)) < cutoff) lastAtBySecond.delete(k);
  }
  return new Date(at);
}

/**
 * Log and handle one entry of a change's `messages` array.
 * @param {object} message Meta's message object
 * @param {Record<string,string>} names wa_id → profile name, from `contacts`
 * @param {object} ctx { meta, tenantId, tenantName, sandbox? }
 */
export async function processInboundMessage(message, names, ctx) {
  // A contact the business blocked: ignored entirely (not filed, no alert, no
  // bot). Once WhatsApp itself blocks them nothing arrives anyway; this covers
  // a block the CRM alone holds (WhatsApp allows one only within 24 hours).
  if (message?.from && (await isBlocked(ctx?.tenantId, message.from))) {
    logger.info('message from a blocked contact ignored', { business: ctx?.tenantName, type: message.type });
    return;
  }
  // Emoji reactions arrive as their own message type — handle + skip.
  if (message.type === 'reaction') {
    handleReaction(message.reaction, ctx).catch((e) =>
      logger.error('handleReaction error', { error: e.message }),
    );
    return;
  }

  const msg = parseIncoming(message);
  if (!msg) return;
  msg.name = names[message.from] || '';
  // Taken now, before any download or lookup, so arrival order is kept.
  const at = inboundTime(message, ctx.tenantId);

  // A payment outcome isn't a chat message: it settles the order and
  // resumes the flow on the paid / not-paid branch. Logged so the CRM
  // shows it in the thread, then handled and skipped.
  if (msg.type === 'payment') {
    logInbound(msg.phone, msg.name, 'payment', msg.logBody, message, message.id, null, { ...ctx, at }).catch(() => {});
    handlePaymentUpdate(msg.payment, ctx).catch((e) =>
      logger.error('handlePaymentUpdate error', { error: e.message }),
    );
    return;
  }

  // The customer allowed (or declined) calls from the business. Shown in the
  // chat, and the open chat's call button follows it; it isn't something to
  // auto-reply to, so automation never sees it.
  if (msg.type === 'call_permission') {
    // The automatic "call back for 7 days" after every customer call would
    // bury the call itself in the chat list, so only their own choices are
    // written to the chat.
    const automaticYes = msg.callPermission.source === 'automatic' && msg.callPermission.response === 'accept';
    if (!automaticYes) {
      await logInbound(msg.phone, msg.name, 'call_permission', msg.logBody, { ...message, callPermission: msg.callPermission }, message.id, null, { ...ctx, at }).catch(() => {});
    }
    if (ctx.tenantId) {
      emitCall(ctx.tenantId, { kind: 'permission', phone: msg.phone, permission: msg.callPermission });
    }
    return;
  }

  // Resolve a flow submission into labelled rows before logging it, so
  // the chat shows the questions and the chosen wording rather than
  // component names and option ids.
  if (msg.type === 'flow_reply') {
    // Photos / documents attached to the form arrive as short-lived media ids:
    // saved first, so the chat, the submission record and the bot all get the
    // stored file.
    await storeFlowMedia(msg.formData, { meta: ctx.meta || metaCloud, tenantId: ctx.tenantId }, storage).catch((e) =>
      logger.warn('flow media could not be stored', { error: e.message }),
    );
    msg.form = await buildSubmissionSummary(msg.formData);
    msg.logBody = summaryToText(msg.form);
  }

  // Likewise a cart: resolve retailer ids to product names and price it
  // up, so the chat shows what was ordered rather than "carrot__v1s0".
  // `orderInfo` is the resolved bubble the CRM renders; without it the
  // chat only has Meta's raw `product_items` to work from.
  if (msg.type === 'order') {
    try {
      const priced = await priceCart(msg.cart, ctx.tenantId);
      msg.logBody = cartToText(priced);
      msg.orderInfo = cartBubble(priced, msg.cart);
    } catch (e) {
      logger.warn('could not price inbound cart', { error: e.message });
    }
  }

  // A reply to one of the chat's messages (swiped, or a tapped quick-reply
  // button): WhatsApp says which in `context.id`. The CRM shows that message
  // as a quote above this one.
  const replyTo = message.context?.id
    ? await replyToFromContext(message.context, { businessId: ctx.tenantId || null, phone: msg.phone, name: msg.name })
    : null;

  logInbound(msg.phone, msg.name, msg.type, msg.logBody, msg.voicemail ? { ...message, voicemail: true } : message, message.id, msg.media, {
    ...ctx, form: msg.form, order: msg.orderInfo, replyTo, at,
  }).catch(() => {});
  // An answer to a poll sent from the chat: counted on the poll, and not
  // something for the bot to answer.
  if (parsePollReply(msg.selectedId)) {
    await recordPollVote(msg.selectedId, { businessId: ctx.tenantId, phone: msg.phone });
    return;
  }
  // A voicemail isn't a question for the bot.
  if (msg.voicemail) return;
  // Delivered on `standby`: another Meta app on the same number holds the
  // chat, so it's the one answering. The CRM shows the message, but our
  // automation stays quiet (its reply would be refused, or answer twice).
  if (ctx.standby) return;
  handleMessage(msg, ctx).catch((e) =>
    logger.error('handleMessage error', { error: e.message, stack: e.stack }),
  );
}

/** wa_id → profile name, from a change's `contacts`. */
export function contactNames(value) {
  const names = {};
  for (const c of value?.contacts || []) {
    if (c.wa_id && c.profile?.name) names[c.wa_id] = c.profile.name;
  }
  return names;
}

// Exported so the shape of each message type can be checked in isolation.
export function parseIncoming(message) {
  const phone = message.from;
  const out = { phone, type: 'text', text: '', selectedId: null, logBody: '' };

  switch (message.type) {
    case 'text':
      out.text = message.text?.body || '';
      out.logBody = out.text;
      break;
    case 'interactive': {
      const it = message.interactive || {};
      if (it.type === 'button_reply') {
        out.type = 'button';
        out.selectedId = it.button_reply?.id || '';
        out.text = it.button_reply?.title || '';
        out.logBody = out.text;
      } else if (it.type === 'list_reply') {
        out.type = 'list';
        out.selectedId = it.list_reply?.id || '';
        out.text = it.list_reply?.title || '';
        out.logBody = out.text;
      } else if (it.type === 'payment' || it.payment) {
        // A native WhatsApp Pay outcome. Depending on API version it arrives
        // here under `interactive`, or as a top-level `payment` message (see
        // the case below) — never assume only one shape.
        out.type = 'payment';
        out.payment = it.payment || {};
        out.logBody = '💳 Payment update';
      } else if (it.type === 'call_permission_reply') {
        // The customer answered "Allow calls?" (or allowed it from our
        // profile, or by calling us with callback permission on).
        const r = it.call_permission_reply || {};
        const yes = String(r.response || '').toLowerCase() === 'accept';
        out.type = 'call_permission';
        out.callPermission = {
          response: yes ? 'accept' : 'reject',
          permanent: !!r.is_permanent,
          expiresAt: r.expiration_timestamp ? new Date(Number(r.expiration_timestamp) * 1000).toISOString() : null,
          source: r.response_source || 'user_action',
        };
        out.logBody = !yes
          ? (r.response_source === 'automatic' ? 'Call permission removed after unanswered calls' : 'Declined calls from you')
          : r.is_permanent
            ? 'Allowed you to call them anytime'
            : r.response_source === 'automatic'
              ? 'Allowed you to call back for 7 days'
              : 'Allowed you to call them for 7 days';
      } else if (it.type === 'nfm_reply') {
        // A native Flow was completed — response_json holds the typed answers.
        // The readable version is resolved by buildSubmissionSummary once the
        // flow definition is in hand; this is just the raw fallback.
        out.type = 'flow_reply';
        try {
          out.formData = JSON.parse(it.nfm_reply?.response_json || '{}');
        } catch {
          out.formData = {};
        }
        // Files, date ranges and tick boxes aren't strings: shown by kind here
        // (the readable version replaces this once the flow is resolved).
        const show = (v) => {
          if (Array.isArray(v)) return v.map((x) => (x && typeof x === 'object' ? x.file_name || 'file' : x)).join(', ');
          if (v && typeof v === 'object') return Object.values(v).join(' → ');
          return v;
        };
        const answers = Object.entries(out.formData)
          .filter(([k]) => k !== 'flow_token' && k !== '__version__')
          .map(([k, v]) => `${k}: ${show(v)}`);
        out.text = answers.join('\n');
        out.logBody = `📝 Form submitted${answers.length ? `\n${answers.join('\n')}` : ''}`;
      }
      break;
    }
    // The other shape a payment outcome takes: its own top-level message type.
    // Missing this is why a payment could succeed and the conversation still
    // never reach the confirmation block.
    case 'payment':
      out.type = 'payment';
      out.payment = message.payment || {};
      out.logBody = '💳 Payment update';
      break;
    case 'image':
      out.type = 'image';
      out.media = { id: message.image?.id, mime: message.image?.mime_type, caption: message.image?.caption || '' };
      out.logBody = message.image?.caption || '📷 Photo';
      break;
    case 'video':
      out.type = 'video';
      out.media = { id: message.video?.id, mime: message.video?.mime_type, caption: message.video?.caption || '' };
      out.logBody = message.video?.caption || '🎥 Video';
      break;
    case 'audio':
      out.type = 'audio';
      out.media = { id: message.audio?.id, mime: message.audio?.mime_type, caption: '' };
      out.logBody = '🎵 Audio';
      // A voicemail left on a missed call carries the call's id (wacid.…).
      if (String(message.id || '').startsWith('wacid.')) {
        out.voicemail = true;
        out.logBody = '🎙️ Voicemail';
      }
      break;
    case 'document':
      out.type = 'document';
      out.media = {
        id: message.document?.id, mime: message.document?.mime_type,
        filename: message.document?.filename || 'Document', caption: message.document?.caption || '',
      };
      out.logBody = message.document?.filename || '📄 Document';
      break;
    case 'sticker':
      out.type = 'image';
      out.media = { id: message.sticker?.id, mime: message.sticker?.mime_type, caption: '' };
      out.logBody = 'Sticker';
      break;
    // A shared pin. This was missing entirely, so every location message was
    // discarded as "no content" — which is why an Ask location block could
    // never advance down its valid branch. `name`/`address` are only present
    // when the customer picked a saved place rather than dropping a pin.
    case 'location': {
      const l = message.location || {};
      out.type = 'location';
      out.location = {
        lat: l.latitude,
        lng: l.longitude,
        name: l.name || '',
        address: l.address || '',
      };
      const where = [l.name, l.address].filter(Boolean).join(', ');
      out.text = where || `${l.latitude}, ${l.longitude}`;
      out.logBody = `📍 ${out.text}`;
      break;
    }
    // The customer tapped "Send" on their catalog cart. Only retailer ids and
    // unit prices arrive — services/cart.js resolves them to product names and
    // totals, which is what prices up the Payment type block.
    case 'order': {
      const o = message.order || {};
      out.type = 'order';
      out.cart = {
        catalogId: o.catalog_id || '',
        note: o.text || '',
        items: (o.product_items || []).map((it) => ({
          retailerId: it.product_retailer_id || '',
          quantity: Number(it.quantity) || 1,
          price: Number(it.item_price) || 0,
          currency: it.currency || 'INR',
        })),
      };
      out.text = o.text || '';
      // Replaced with the itemised version once the cart has been priced.
      out.logBody = `🛒 Cart sent (${out.cart.items.length} line${out.cart.items.length === 1 ? '' : 's'})`;
      break;
    }
    default:
      out.text = '';
  }

  // A payment outcome has no text, no selection and no media, so it has to be
  // listed here explicitly or it gets dropped as "nothing to see" — the same
  // way location messages used to be.
  const hasContent = out.text || out.selectedId || out.media || out.formData
    || out.cart || out.location || out.payment || out.callPermission;
  return hasContent ? out : null;
}

export default { processInboundMessage, contactNames, parseIncoming };
