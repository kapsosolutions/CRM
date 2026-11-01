// Emoji reactions and quoted replies on chat messages.
//
// WhatsApp keeps one reaction per person on a message, so a message can carry
// the customer's reaction and the business's at the same time ("😂 ❤️ 2").
// They're stored per side: reactionIn (the customer) and reactionOut (the
// business, from the CRM). `reaction` stays as the latest of the two.
import Message from '../models/Message.js';
import { emitReaction } from './eventBus.js';
import logger from './logger.js';

/**
 * Set one side's reaction ('' removes it) on the message with this Meta id.
 * Scoped to the tenant: a message id belongs to one WABA, so one business's
 * webhook must never rewrite another's row.
 * @returns {Promise<{reactionIn: string, reactionOut: string} | null>}
 */
export async function setReaction({ businessId, metaMessageId, side, emoji }) {
  if (!metaMessageId) return null;
  const field = side === 'out' ? 'reactionOut' : 'reactionIn';
  const filter = { metaMessageId, ...(businessId ? { businessId } : {}) };
  const doc = await Message.findOne(filter).select('reactionIn reactionOut').lean();
  if (!doc) return null;
  const value = String(emoji || '');
  const next = { reactionIn: doc.reactionIn || '', reactionOut: doc.reactionOut || '', [field]: value };
  // The latest reaction, falling back to the other side's when this one was removed.
  const reaction = value || (side === 'out' ? next.reactionIn : next.reactionOut);
  await Message.updateOne(filter, { $set: { [field]: value, reaction } });
  emitReaction({ metaMessageId, emoji: reaction, reactionIn: next.reactionIn, reactionOut: next.reactionOut }, businessId);
  return next;
}

const TYPE_LABEL = {
  image: '📷 Photo',
  video: '🎥 Video',
  audio: '🎵 Audio',
  voice: '🎤 Voice message',
  document: '📄 Document',
  sticker: 'Sticker',
  location: '📍 Location',
  contacts: '👤 Contact',
  order: '🛒 Order',
};

/** One line describing a message, for the quote above a reply. */
export function quotePreview(m) {
  const text = String(m?.body || '').replace(/\s+/g, ' ').trim();
  if (text) return text.slice(0, 200);
  return TYPE_LABEL[m?.type] || 'Message';
}

/**
 * The quote shown above an inbound reply: the customer replied to (swiped on)
 * one of the chat's messages, which WhatsApp reports as `context.id`.
 * `author` is the customer's name for their own message, "You" for ours.
 * Null when the quoted message isn't in this tenant's chat log.
 */
export async function replyToFromContext(context, { businessId, phone, name }) {
  const id = context?.id;
  if (!id) return null;
  try {
    const quoted = await Message.findOne({
      metaMessageId: id,
      ...(businessId ? { businessId } : {}),
      ...(phone ? { phone } : {}),
    }).select('direction body type name').lean();
    if (!quoted) return null;
    return {
      id: String(quoted._id),
      author: quoted.direction === 'out' ? 'You' : name || quoted.name || (phone ? `+${phone}` : 'Customer'),
      preview: quotePreview(quoted),
    };
  } catch (err) {
    logger.debug('reply lookup failed', { error: err.message });
    return null;
  }
}

/**
 * An agent's reply from the CRM: resolve the quoted message (tenant + chat
 * scoped) so the reply goes to WhatsApp with its context, and so the stored
 * quote shows the real text. Null when there's nothing valid to quote.
 * @returns {Promise<{ contextId: string, replyTo: {id, author, preview} } | null>}
 */
export async function resolveAgentReply(replyTo, { businessId, phone }) {
  const id = typeof replyTo?.id === 'string' ? replyTo.id.trim() : '';
  if (!id || id.startsWith('tmp-') || id.length > 64) return null;
  try {
    const quoted = await Message.findOne({ _id: id, phone, ...(businessId ? { businessId } : {}) })
      .select('direction body type name metaMessageId')
      .lean();
    if (!quoted) return null;
    const given = typeof replyTo.author === 'string' ? replyTo.author.trim().slice(0, 80) : '';
    return {
      contextId: quoted.metaMessageId || '',
      replyTo: {
        id: String(quoted._id),
        author: quoted.direction === 'out' ? 'You' : given || quoted.name || `+${phone}`,
        preview: quotePreview(quoted),
      },
    };
  } catch (err) {
    logger.debug('reply lookup failed', { error: err.message });
    return null;
  }
}
