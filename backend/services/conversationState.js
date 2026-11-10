// Conversation state helpers for the CRM 24h window + unread tracking.
//
// Every lookup and upsert is keyed on (businessId, phone), never phone alone.
// The same customer can hold a conversation with two different tenants, so a
// phone-only filter would read — and upsert into — whichever tenant's row
// happened to be found first. `businessId` is therefore part of the key, not
// just a field that gets stamped on write.
//
// A missing businessId scopes to untagged rows rather than to everything, so
// the worst case is a no-op instead of a cross-tenant write.
import Conversation from '../models/Conversation.js';

const key = (phone, businessId) => ({ businessId: businessId || null, phone });

/** The chat list's ticks for a last message from the customer: none. */
export const INBOUND_LAST = { lastDirection: 'in', lastMessageId: '', lastStatus: '' };
/** A last line that is neither side's message (a call, a cleared chat): no ticks. */
export const NEUTRAL_LAST = { lastDirection: '', lastMessageId: '', lastStatus: '' };

export async function getConversation(phone, businessId) {
  return Conversation.findOne(key(phone, businessId)).lean();
}

export async function touchInbound(phone, name, body, businessId) {
  return Conversation.findOneAndUpdate(
    key(phone, businessId),
    {
      $set: {
        lastInboundAt: new Date(),
        lastMessageAt: new Date(),
        lastMessageBody: body || '',
        ...INBOUND_LAST,
        ...(name ? { name } : {}),
      },
      $inc: { unread: 1 },
    },
    { upsert: true, new: true },
  );
}

/**
 * Record an outbound message on the conversation.
 *
 * `markRead` is for an agent replying from the CRM: they've plainly seen the
 * chat, so its unread count clears. Automatic sends (the bot, flows, journeys,
 * auto-send templates) leave it alone, otherwise every chat the bot answered
 * would look read and the unread badge would never show.
 */
export async function touchOutbound(phone, body, businessId, { markRead = false } = {}) {
  // "[flow]" / "[journey]" only say that automation answered. The real reply
  // text is already on the conversation (recordOutboundPreview, written as
  // each message goes out), so a bare marker must not overwrite it.
  const marker = /^\[(flow|journey)\]$/i.test(String(body || '').trim());
  return Conversation.findOneAndUpdate(
    key(phone, businessId),
    {
      $set: {
        lastOutboundAt: new Date(),
        // Its id and status were written with the message (recordOutboundPreview).
        ...(marker ? {} : { lastMessageBody: body || '', lastMessageAt: new Date(), lastDirection: 'out' }),
        ...(markRead ? { unread: 0 } : {}),
      },
    },
    { upsert: true, new: true },
  );
}

/**
 * The chat list's last-message line for an outbound message, written as the
 * message is logged — before the CRM is told about it, so a refresh triggered
 * by that event already reads the new text. Unread is left alone.
 */
export async function recordOutboundPreview(phone, body, businessId, { messageId = '', status = 'sent', upsert = false } = {}) {
  return Conversation.updateOne(
    key(phone, businessId),
    {
      $set: {
        lastOutboundAt: new Date(),
        lastMessageAt: new Date(),
        lastMessageBody: String(body || '').slice(0, 200),
        lastDirection: 'out',
        lastMessageId: messageId ? String(messageId) : '',
        lastStatus: status || 'sent',
      },
      // `upsert` (WhatsApp sends): the first message to a new number, e.g. a
      // campaign, creates its chat, the same row touchOutbound would make.
      ...(upsert ? { $setOnInsert: { unread: 0, channel: 'whatsapp' } } : {}),
    },
    upsert ? { upsert: true } : undefined,
  );
}

/**
 * A receipt for one of our messages: if it's still the chat's last message,
 * its ticks move forward (never back). `below` = statuses it may replace.
 */
export async function recordLastStatus(messageId, status, below, businessId) {
  if (!messageId || !status) return null;
  return Conversation.updateOne(
    {
      ...(businessId ? { businessId } : {}),
      lastMessageId: String(messageId),
      lastStatus: { $in: [...below, ''] },
    },
    { $set: { lastStatus: status } },
  );
}

export default { getConversation, touchInbound, touchOutbound, recordOutboundPreview, recordLastStatus };
