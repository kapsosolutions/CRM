// The chat ⋮ menu's actions that do more than flip a flag: Clear chat, Delete
// chat (and the contact), Block / Unblock.
import Conversation from '../models/Conversation.js';
import Message from '../models/Message.js';
import Notification from '../models/Notification.js';
import storage from './storage.js';
import { getClientForBusiness } from './metaCloud.js';
import { isWhatsAppConnected } from './sandbox.js';
import logger from './logger.js';

const digits = (v) => String(v ?? '').replace(/\D/g, '');
const isWhatsApp = (c) => !c?.channel || c.channel === 'whatsapp';

/**
 * Clear chat: every message and the files this chat owns go; the contact
 * stays (name, Bot / Manual, favourite, mute, block).
 */
export async function clearChatHistory(businessId, phone) {
  const owner = { businessId };
  const messages = await Message.find({ ...owner, phone }).lean();
  // Only files from the chat buckets: a message can also point at a TEMPLATE's
  // header image or a journey / flow block's picture, which belong to those.
  // The documents bucket is the PDFs made for this customer (order slips).
  const owned = (url) => {
    const key = storage.keyFromUrl(url);
    return !!key && (key.includes('/inbound/') || key.includes('/outbound/') || key.includes('/documents/'));
  };
  const urls = new Set();
  for (const m of messages) {
    for (const url of storage.collectCdnUrls(m.raw)) {
      if (owned(url)) urls.add(url);
    }
  }
  const deletedMedia = await storage.deleteMany([...urls], String(owner.businessId || ''));
  await Message.deleteMany({ ...owner, phone });
  await Conversation.updateOne(
    { ...owner, phone },
    {
      $set: {
        lastMessageBody: '',
        lastMessageAt: null,
        lastInboundAt: null,
        lastOutboundAt: null,
        unread: 0,
        lastDirection: '',
        lastStatus: '',
      },
      $unset: { lastMessageMedia: '', lastMessageId: '', lastMessageType: '' },
    },
  );
  return { deletedMessages: messages.length, deletedMedia };
}

/**
 * Delete chat: the messages, then the contact itself. A blocked contact's row
 * is kept out of sight instead, so the block still holds (their messages stay
 * ignored); adding them again brings the chat back, still blocked.
 */
export async function deleteChatAndContact(businessId, phone) {
  const convo = await Conversation.findOne({ businessId, phone }).lean();
  const cleared = await clearChatHistory(businessId, phone);
  // The bell's rows for this chat would open a chat that's gone.
  await Notification.deleteMany({ businessId, groupKey: `chat:${phone}` }).catch(() => {});
  if (convo?.blocked) {
    await Conversation.updateOne(
      { businessId, phone },
      { $set: { hiddenAt: new Date(), favourite: false, mutedUntil: null, step: 'new', context: {} } },
    );
    return { ...cleared, keptBlocked: true };
  }
  await Conversation.deleteOne({ businessId, phone });
  return { ...cleared, keptBlocked: false };
}

/** Why Meta refused a block / unblock, in words for the agent. */
function metaReason(err) {
  const data = err?.response?.data || {};
  const failed = data.block_users?.failed_users?.[0]?.errors?.[0];
  const code = Number(failed?.code || data.error?.code || 0);
  if (code === 131047) return { code, text: 'WhatsApp only lets you block someone who messaged you in the last 24 hours.' };
  if (code === 131021) return { code, text: 'You can’t block your own number.' };
  if (code === 139101) return { code, text: 'Your WhatsApp block list is full (64,000 numbers).' };
  if (code === 130429) return { code, text: 'WhatsApp is rate-limiting block requests. Try again in a minute.' };
  return { code, text: failed?.error_data?.details || failed?.message || data.error?.message || err?.message || 'WhatsApp refused the request.' };
}

/**
 * Block or unblock a contact.
 *
 * In the CRM a block means: their messages and calls are ignored (not saved,
 * no alerts, no bot), and nothing can be sent to them. On the business's own
 * WhatsApp number it's also a block at Meta, so they can't message or call
 * at all, which WhatsApp allows only within 24 hours of their last message.
 * Outside that (and on Messenger / Instagram, or the shared test number) the
 * block is the CRM's alone.
 *
 * @returns {Promise<{ blocked: boolean, atMeta: boolean, note?: string }>}
 */
export async function setContactBlocked(business, phoneIn, blocked) {
  const businessId = business._id;
  const phone = digits(phoneIn);
  const convo = await Conversation.findOne({ businessId, phone }).lean();
  if (!convo) throw Object.assign(new Error('Chat not found'), { status: 404 });
  const metaCapable = isWhatsApp(convo) && isWhatsAppConnected(business);

  if (blocked) {
    let atMeta = false;
    let note;
    if (metaCapable) {
      try {
        await getClientForBusiness(business).blockUsers([phone]);
        atMeta = true;
      } catch (err) {
        const why = metaReason(err);
        logger.info('block at Meta refused, blocked in the CRM only', { business: business.name, code: why.code, error: why.text });
        note = why.text;
      }
    }
    await Conversation.updateOne(
      { businessId, phone },
      { $set: { blocked: true, blockedAt: new Date(), blockedAtMeta: atMeta } },
    );
    return { blocked: true, atMeta, ...(note ? { note } : {}) };
  }

  if (convo.blockedAtMeta && isWhatsAppConnected(business)) {
    try {
      await getClientForBusiness(business).unblockUsers([phone]);
    } catch (err) {
      // Still blocked at Meta: saying "unblocked" here would be untrue.
      const why = metaReason(err);
      logger.warn('unblock at Meta failed', { business: business.name, code: why.code, error: why.text });
      throw Object.assign(new Error(`WhatsApp couldn’t unblock them: ${why.text}`), { status: 502, code: 'UNBLOCK_FAILED' });
    }
  }
  await Conversation.updateOne(
    { businessId, phone },
    { $set: { blocked: false, blockedAtMeta: false }, $unset: { blockedAt: '' } },
  );
  return { blocked: false, atMeta: !!convo.blockedAtMeta };
}
