import express from 'express';
import { requireBusiness, bizId } from '../middleware/auth.js';
import { uploadMedia } from '../middleware/upload.js';
import storage, { mediaFolder } from '../services/storage.js';
import Conversation from '../models/Conversation.js';
import Message from '../models/Message.js';
import Template from '../models/Template.js';
import Flow from '../models/Flow.js';
import { getClientForBusiness } from '../services/metaCloud.js';
import {
  clientForChat, isSandboxChat, isWhatsAppConnected, sandboxConfig, sharedTemplates, sendSharedTemplate, SANDBOX_UNSUPPORTED,
} from '../services/sandbox.js';
import { sendFlowToChat } from '../services/flowMapRuntime.js';
import { channelClientForChat, chatChannel, channelUnsupported } from '../services/metaChannels.js';
import { touchOutbound } from '../services/conversationState.js';
import { sendPoll, sendEvent, ExtraError } from '../services/chatExtras.js';
import { setReaction, resolveAgentReply } from '../services/reactions.js';
import { THREAD_CONTROLLED_ELSEWHERE, THREAD_CONTROL_MESSAGE } from '../services/otherApps.js';
import { notifyTemplateStatus, markChatRead } from '../services/notifications.js';
import { planState, hasFeature, assertFeature } from '../services/plans.js';
import {
  assertContact, contactAllowance, assertTemplateAllowed, sendPlanError,
} from '../services/planGate.js';
import { TEMPLATE_SOURCES, templateSourcesFor, isTemplateSource } from '../services/templateVars.js';
import { verticalConfig } from '../services/verticals.js';
import { templateSendOptions } from '../services/templateTriggers.js';
import { renderTemplate, renderedPreview } from '../services/templateRender.js';
import {
  isAuthTemplate, parseAuthSettings, authTemplatePayload, authBodyText, authFooterText, authFromComponents,
  authSendOptions,
} from '../services/authTemplate.js';
import { browseLibrary, useLibraryTemplate, LibraryError } from '../services/templateLibrary.js';
import { assertNotBlocked, MUTE_FOREVER } from '../services/chatFlags.js';
import { clearChatHistory, deleteChatAndContact, setContactBlocked } from '../services/chatActions.js';
import logger from '../services/logger.js';

// Mirrors the Order status enum — a template can be triggered by any of them.
const ORDER_STATUSES = [
  'pending', 'confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled',
];

// Named events a template can subscribe to, beyond keywords and order status.
const TRIGGER_EVENTS = [
  {
    key: 'member_unavailable',
    label: 'Doctor / staff unavailable',
    hint: 'Sent to every patient whose appointment is affected when you mark someone unavailable',
  },
];
const EVENT_KEYS = new Set(TRIGGER_EVENTS.map((e) => e.key));

const router = express.Router();
// Every route here reads or writes one tenant's data, so a business login is
// required rather than "any authenticated user". That makes req.business
// guaranteed, which is what lets the scoping below be unconditional — an
// `if (admin) show everything` fallback is exactly how data leaks back out.
router.use(requireBusiness);

/** Tenant filter. Spread into every query in this file, no exceptions. */
const owner = (req) => ({ businessId: req.business._id });
/** The Meta client bound to the logged-in tenant's own WABA credentials. */
const client = (req) => getClientForBusiness(req.business);
/**
 * The client a reply in one chat goes out on: the tenant's own number, or the
 * shared test number for a customer who joined through it (services/sandbox.js).
 */
// A Messenger / Instagram chat replies through that channel's Page instead
// (services/metaChannels.js); everything else is WhatsApp as before.
// A Messenger / Instagram reply needs that channel in the plan (after a
// downgrade, its chats stay readable but can't be answered).
// A blocked contact gets nothing (409 CONTACT_BLOCKED, passed through by sendFailure).
const chatClient = async (req, phone) => {
  await assertNotBlocked(req.business._id, phone);
  const ch = await channelClientForChat(req.business, phone);
  if (ch) {
    const channel = await chatChannel(req.business, phone);
    if (channel) assertFeature(req.business, channel);
    return ch;
  }
  return clientForChat(req.business, phone);
};
/** Templates and Flows can't go out on the shared test number. */
const sandboxRefusal = (res) =>
  res.status(409).json({ success: false, code: 'SANDBOX_UNSUPPORTED', message: SANDBOX_UNSUPPORTED });
/** Templates and Flows are WhatsApp-only: refused in a Messenger / Instagram chat. */
const channelRefusal = (res, channel) =>
  res.status(409).json({ success: false, code: 'CHANNEL_UNSUPPORTED', message: channelUnsupported(channel) });

const errMessage = (err) =>
  err.response?.data?.error?.code === THREAD_CONTROLLED_ELSEWHERE
    ? THREAD_CONTROL_MESSAGE
    : err.response?.data?.error?.message || err.message;
// Honour an error's own status so a spent free trial reports 402 with its own
// explanation rather than a generic 500.
const sendFailure = (res, err) => {
  if (sendPlanError(res, err)) return;
  res.status(err.status || 500).json({ success: false, message: errMessage(err), code: err.code || undefined });
};

// ---------------- Mark a chat as read (clear unread count) ----------------
router.post('/read', async (req, res) => {
  try {
    const { phone } = req.body || {};
    if (!phone) return res.status(400).json({ success: false, message: 'phone required' });
    await Conversation.updateOne(
      { ...owner(req), phone: String(phone).replace(/\D/g, '') },
      { $set: { unread: 0 } },
    );
    markChatRead(req.business._id, phone).catch(() => {});
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ---------------- Pause / resume bot automation for a chat ----------------
router.post('/pause', async (req, res) => {
  try {
    const { phone, paused } = req.body || {};
    if (!phone) return res.status(400).json({ success: false, message: 'phone required' });
    const clean = String(phone).replace(/\D/g, '');
    const convo = await Conversation.findOneAndUpdate(
      { ...owner(req), phone: clean },
      { $set: { botPaused: !!paused } },
      { upsert: true, new: true },
    );
    res.json({ success: true, botPaused: convo.botPaused });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ---------------- Chat ⋮ menu: mute, favourite, block ----------------
const cleanPhone = (v) => String(v || '').replace(/\D/g, '');
const MUTE_FOR = { '8h': 8 * 3600 * 1000, '1w': 7 * 24 * 3600 * 1000 };

/** { phone, until: '8h' | '1w' | 'always' | null } — null unmutes. */
router.post('/mute', async (req, res) => {
  try {
    const { phone, until } = req.body || {};
    const clean = cleanPhone(phone);
    if (!clean) return res.status(400).json({ success: false, message: 'phone required' });
    if (until != null && until !== 'always' && !MUTE_FOR[until]) {
      return res.status(400).json({ success: false, message: 'until must be 8h, 1w, always or null' });
    }
    const mutedUntil = until == null ? null : until === 'always' ? MUTE_FOREVER : new Date(Date.now() + MUTE_FOR[until]);
    const convo = await Conversation.findOneAndUpdate({ ...owner(req), phone: clean }, { $set: { mutedUntil } }, { new: true });
    if (!convo) return res.status(404).json({ success: false, message: 'Chat not found' });
    res.json({ success: true, mutedUntil: convo.mutedUntil || null });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/favourite', async (req, res) => {
  try {
    const { phone, favourite } = req.body || {};
    const clean = cleanPhone(phone);
    if (!clean) return res.status(400).json({ success: false, message: 'phone required' });
    const convo = await Conversation.findOneAndUpdate({ ...owner(req), phone: clean }, { $set: { favourite: !!favourite } }, { new: true });
    if (!convo) return res.status(404).json({ success: false, message: 'Chat not found' });
    res.json({ success: true, favourite: !!convo.favourite });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/** { phone, blocked } → { blocked, atMeta, note? } (note: why WhatsApp itself didn't block). */
router.post('/block', async (req, res) => {
  try {
    const { phone, blocked } = req.body || {};
    const clean = cleanPhone(phone);
    if (!clean) return res.status(400).json({ success: false, message: 'phone required' });
    const out = await setContactBlocked(req.business, clean, !!blocked);
    logger.info(blocked ? 'contact blocked' : 'contact unblocked', { business: req.business.name, atMeta: out.atMeta });
    res.json({ success: true, ...out });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message, code: err.code || undefined });
  }
});

// ---------------- Clear chat: messages + media go, the contact stays ----------------
router.delete('/chats/:phone', async (req, res) => {
  try {
    const phone = cleanPhone(req.params.phone);
    if (!phone) return res.status(400).json({ success: false, message: 'phone required' });
    const out = await clearChatHistory(req.business._id, phone);
    logger.info('chat cleared (contact kept)', { messages: out.deletedMessages, media: out.deletedMedia });
    res.json({ success: true, ...out });
  } catch (err) {
    logger.error('crm clear chat failed', { error: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
});

// ---------------- Delete chat: messages, media and the contact ----------------
router.delete('/contacts/:phone', async (req, res) => {
  try {
    const phone = cleanPhone(req.params.phone);
    if (!phone) return res.status(400).json({ success: false, message: 'phone required' });
    const out = await deleteChatAndContact(req.business._id, phone);
    logger.info('chat and contact deleted', { messages: out.deletedMessages, media: out.deletedMedia, keptBlocked: out.keptBlocked });
    res.json({ success: true, ...out });
  } catch (err) {
    logger.error('crm delete contact failed', { error: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
});

// ---------------- Conversations (chat list) ----------------
router.get('/chats', async (req, res) => {
  // A deleted blocked contact's row (hiddenAt) isn't a chat any more.
  const chats = await Conversation.find({ ...owner(req), hiddenAt: null }).sort({ lastMessageAt: -1, updatedAt: -1, _id: -1 }).limit(200).lean();
  const now = Date.now();
  // A plan with a contact limit (Free): contacts after the first N, and
  // Messenger / Instagram chats the plan doesn't include, are shown locked.
  const state = planState(req.business);
  const allowance = await contactAllowance(req.business._id, state);
  const lockedChat = (c) => {
    const ch = c.channel || 'whatsapp';
    if (ch !== 'whatsapp') return !hasFeature(state, ch);
    return !!allowance.allowed && !allowance.allowed.has(c.phone);
  };
  const data = chats.map((c) => {
    let lastInbound = c.lastInboundAt ? new Date(c.lastInboundAt).getTime() : 0;
    // Clear out false lastInboundAt if it was stamped on contact creation without any actual message
    if (lastInbound && c.createdAt && Math.abs(lastInbound - new Date(c.createdAt).getTime()) < 2000 && !c.lastMessageBody) {
      lastInbound = 0;
      Conversation.updateOne({ _id: c._id }, { $set: { lastInboundAt: null } }).catch(() => {});
    }
    const windowMsLeft = lastInbound > 0 ? Math.max(0, 24 * 60 * 60 * 1000 - (now - lastInbound)) : 0;
    // Every conversation arrives over WhatsApp today; the field lets the CRM
    // badge the avatar per channel once others are connected.
    return {
      ...c,
      lastInboundAt: lastInbound > 0 ? c.lastInboundAt : null,
      channel: c.channel || 'whatsapp',
      windowOpen: windowMsLeft > 0,
      windowMsLeft,
      ...(lockedChat(c) ? { locked: true } : {}),
    };
  });
  res.json({
    success: true,
    data,
    contactLimit: allowance.limit ? { limit: allowance.limit, used: allowance.total, full: allowance.total >= allowance.limit } : null,
  });
});

// ---------------- Add / Start a conversation with a contact ----------------
router.post('/chats', async (req, res) => {
  try {
    const { phone, name, channel } = req.body || {};
    const clean = String(phone || '').replace(/\D/g, '');
    if (!clean || clean.length < 7) {
      return res.status(400).json({ success: false, message: 'Valid phone number required' });
    }
    const cleanName = (name || '').trim();
    // Free plan: a new contact only while it has room (its first N).
    await assertContact(req.business._id, clean, planState(req.business));
    const now = new Date();
    const conv = await Conversation.findOneAndUpdate(
      { businessId: req.business._id, phone: clean },
      {
        $setOnInsert: {
          businessId: req.business._id,
          phone: clean,
          channel: channel || 'whatsapp',
          unread: 0,
          createdAt: now,
          lastInboundAt: null,
          lastMessageAt: now,
          lastMessageBody: '',
        },
        // Adding a deleted (blocked) contact again brings their chat back.
        $set: { hiddenAt: null, ...(cleanName ? { name: cleanName } : {}) },
      },
      { upsert: true, new: true, setDefaultsOnInsert: false }
    ).lean();

    res.json({
      success: true,
      data: {
        ...conv,
        lastInboundAt: null,
        channel: conv.channel || 'whatsapp',
        windowOpen: false,
        windowMsLeft: 0,
      },
    });
  } catch (err) {
    if (sendPlanError(res, err)) return;
    logger.error('crm create chat failed', { error: errMessage(err) });
    res.status(500).json({ success: false, message: err.message || 'Failed to create chat' });
  }
});

// ---------------- Messages for a phone ----------------
// A page of the chat, oldest first on screen: the newest `limit` messages, or
// with `before` (+ `beforeId`, the oldest message already shown) the `limit`
// before it, so the CRM opens a chat with its latest messages and loads older
// ones as the agent scrolls up instead of the whole history every time.
// Without `limit` (an older CRM tab) it's the newest 500, as before.
const PAGE_MAX = 200;
router.get('/messages/:phone', async (req, res) => {
  const phone = req.params.phone.replace(/\D/g, '');
  const paged = req.query.limit !== undefined;
  const limit = paged ? Math.min(PAGE_MAX, Math.max(1, Math.floor(Number(req.query.limit)) || 50)) : 500;
  const before = req.query.before ? new Date(String(req.query.before)) : null;
  const beforeId = String(req.query.beforeId || '');
  const filter = { ...owner(req), phone };
  if (before && !Number.isNaN(before.getTime())) {
    // Strictly older; messages from the same millisecond go by id, so a page
    // boundary never skips or repeats one.
    filter.$or = [
      { createdAt: { $lt: before } },
      ...(beforeId ? [{ createdAt: before, _id: { $lt: beforeId } }] : []),
    ];
  }
  const rows = await Message.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(paged ? limit + 1 : limit)
    .lean();
  const hasMore = paged && rows.length > limit;
  const messages = (hasMore ? rows.slice(0, limit) : rows).reverse();
  // Opening the chat (the first page) is what reads it.
  let lastInboundAt = null;
  if (!before) {
    const convo = await Conversation.findOneAndUpdate({ ...owner(req), phone }, { $set: { unread: 0 } }, { new: true }).lean();
    lastInboundAt = convo?.lastInboundAt || null;
    markChatRead(req.business._id, phone).catch(() => {});
  }
  // `lastInboundAt` lets the CRM time the 24-hour window even when the
  // customer's last message is older than this page.
  res.json({ success: true, data: messages, ...(paged ? { hasMore } : {}), ...(before ? {} : { lastInboundAt }) });
});

// ---------------- Send a free-text reply (within 24h window) ----------------
router.post('/send', async (req, res) => {
  try {
    const { phone, text, replyTo } = req.body || {};
    if (!phone || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ success: false, message: 'phone and text required' });
    }
    const clean = String(phone).replace(/\D/g, '');
    // A reply to one of the chat's messages: WhatsApp shows the quote on the
    // customer's phone, and the CRM keeps it above the bubble.
    const reply = replyTo ? await resolveAgentReply(replyTo, { businessId: req.business._id, phone: clean }) : null;
    await (await chatClient(req, clean)).sendText(clean, text.trim(), reply || undefined);
    await touchOutbound(clean, text.trim(), req.business._id, { markRead: true });
    res.json({ success: true });
  } catch (err) {
    logger.error('crm send failed', { error: errMessage(err) });
    sendFailure(res, err);
  }
});

// ---------------- Polls and events (the composer's + menu) ----------------
// WhatsApp's API has no native poll or event message: services/chatExtras.js
// builds them from buttons / lists and a calendar button. WhatsApp chats only.
async function sendExtra(req, res, what, send) {
  try {
    const clean = String(req.body?.phone || '').replace(/\D/g, '');
    if (!clean) return res.status(400).json({ success: false, message: 'phone required' });
    const otherChannel = await chatChannel(req.business, clean);
    if (otherChannel) return channelRefusal(res, otherChannel);
    const out = await send(await chatClient(req, clean), clean);
    await touchOutbound(clean, what, req.business._id, { markRead: true });
    return res.json({ success: true, ...out });
  } catch (err) {
    if (err instanceof ExtraError) return res.status(400).json({ success: false, message: err.message });
    logger.error(`crm send ${what} failed`, { error: errMessage(err) });
    return sendFailure(res, err);
  }
}

router.post('/send-poll', (req, res) => {
  const b = req.body || {};
  return sendExtra(req, res, `📊 ${String(b.question || 'Poll').slice(0, 80)}`, (c, phone) => sendPoll(c, phone, b));
});

router.post('/send-event', (req, res) => {
  const b = req.body || {};
  const own = req.business.meta?.displayPhoneNumber || req.business.whatsappNumber || '';
  return sendExtra(req, res, `📅 ${String(b.name || 'Event').slice(0, 80)}`, (c, phone) => sendEvent(c, phone, b, own));
});

// ---------------- Send a published Flow (interactive form) ----------------
// The same message the chatbot would send, pushed manually from the chat. The
// flow_token encodes the flow id, so the customer's submission still comes back
// resolved to this flow.
router.post('/send-flow', async (req, res) => {
  try {
    const { phone, flowId } = req.body || {};
    if (!phone || !flowId) {
      return res.status(400).json({ success: false, message: 'phone and flowId required' });
    }
    const otherChannel = await chatChannel(req.business, phone);
    if (otherChannel) return channelRefusal(res, otherChannel);
    const flow = await Flow.findOne({ _id: flowId, ...owner(req) }).lean();
    if (!flow) return res.status(404).json({ success: false, message: 'Flow not found' });
    if (!flow.metaFlowId) {
      return res.status(400).json({ success: false, message: `Publish "${flow.name}" before sending it.` });
    }
    const clean = String(phone).replace(/\D/g, '');
    await assertNotBlocked(req.business._id, clean);
    if (await isSandboxChat(req.business, clean)) return sandboxRefusal(res);
    await sendFlowToChat(client(req), clean, flow);
    await touchOutbound(clean, `📋 ${flow.name}`, req.business._id, { markRead: true });
    res.json({ success: true });
  } catch (err) {
    logger.error('crm send-flow failed', { error: errMessage(err) });
    sendFailure(res, err);
  }
});

// ---------------- React to a message with an emoji ----------------
router.post('/react', async (req, res) => {
  try {
    const { phone, messageId, emoji } = req.body || {};
    if (!phone || !messageId) {
      return res.status(400).json({ success: false, message: 'phone and messageId required' });
    }
    const clean = String(phone).replace(/\D/g, '');
    const value = typeof emoji === 'string' ? emoji.slice(0, 16) : '';
    await (await chatClient(req, clean)).sendReaction(clean, messageId, value);
    // The business's reaction; the customer's (if any) stays beside it.
    const reactions = await setReaction({ businessId: req.business._id, metaMessageId: messageId, side: 'out', emoji: value });
    res.json({ success: true, ...(reactions || {}) });
  } catch (err) {
    logger.error('crm react failed', { error: err.response?.data?.error?.message || err.message });
    // Carries a closed sandbox window's 409 through, like the other sends.
    sendFailure(res, err);
  }
});

// ---------------- Send a media file (image / video / audio / document) ----------------
router.post('/send-media', uploadMedia.single('file'), async (req, res) => {
  try {
    const { phone, caption } = req.body || {};
    if (!phone || !req.file) {
      return res.status(400).json({ success: false, message: 'phone and file required' });
    }
    const clean = String(phone).replace(/\D/g, '');
    // Resolved before the upload, so a closed window doesn't leave a file behind.
    const wa = await chatClient(req, clean);
    const mime = req.file.mimetype || 'application/octet-stream';

    let waType = 'document';
    if (mime.startsWith('image/')) waType = 'image';
    else if (mime.startsWith('video/')) waType = 'video';
    else if (mime.startsWith('audio/')) waType = 'audio';

    const resourceType =
      waType === 'image' ? 'image' : waType === 'video' || waType === 'audio' ? 'video' : 'raw';
    const url = await storage.uploadBuffer(req.file.buffer, mediaFolder(bizId(req), 'outbound'), resourceType);
    const filename = req.file.originalname || 'file';

    if (waType === 'image') await wa.sendImage(clean, url, caption || '');
    else if (waType === 'video') await wa.sendVideo(clean, url, caption || '');
    else if (waType === 'audio') await wa.sendAudio(clean, url);
    else await wa.sendDocument(clean, url, filename, caption || '');

    await touchOutbound(clean, `[${waType}] ${caption || filename}`, req.business._id, { markRead: true });
    res.json({ success: true });
  } catch (err) {
    logger.error('crm send-media failed', { error: errMessage(err) });
    sendFailure(res, err);
  }
});

// ---------------- Send an approved template (outside 24h window) ----------------
router.post('/send-template', async (req, res) => {
  try {
    const {
      phone, templateName, languageCode, headerImageUrl, bodyParams, ltoCode, ltoExpiresAt, otpCode,
    } = req.body || {};
    if (!phone || !templateName) {
      return res.status(400).json({ success: false, message: 'phone and templateName required' });
    }
    const clean = String(phone).replace(/\D/g, '');
    await assertNotBlocked(req.business._id, clean);
    const otherChannel = await chatChannel(req.business, clean);
    if (otherChannel) return channelRefusal(res, otherChannel);
    if (!isWhatsAppConnected(req.business) && sandboxConfig().configured) {
      // No own number yet: the shared test number's sample templates go out on
      // it, to a contact who joined with the code or to a number added in Chats
      // (which then joins this business's test inbox, within its contact limit).
      const shared = await sendSharedTemplate(req.business, clean, templateName, bodyParams);
      if (!shared) return sandboxRefusal(res);
      await touchOutbound(clean, renderedPreview(shared.rendered, templateName), req.business._id);
      return res.json({ success: true, ...(shared.linked ? { linked: true } : {}) });
    }
    // Our own copy knows what Meta needs on every send: the header media, what
    // each {{n}} means, carousel card media, and an offer's code and end time.
    const local = await Template.findOne({ ...owner(req), name: templateName }).lean();
    // An authentication template takes the agent's code (or a generated one).
    // One made outside the CRM has no row here; the code says what it is.
    const opts = local
      ? await templateSendOptions(local, { phone: clean, business: req.business }, {
        bodyParams, ltoCode, ltoExpiresAt, ...(otpCode !== undefined ? { otpCode } : {}),
      })
      : otpCode !== undefined
        ? authSendOptions(null, { otpCode })
        : { bodyParams: bodyParams || [] };
    await client(req).sendTemplate(clean, templateName, {
      ...opts,
      languageCode: languageCode || opts.languageCode,
      ...(headerImageUrl ? { headerImageUrl } : {}),
    });
    // The chat list shows the message's own text, like any other message.
    const preview = local ? renderedPreview(renderTemplate(local, opts), templateName) : `[template] ${templateName}`;
    await touchOutbound(clean, preview, req.business._id);
    // The agent sees which code went out (it's also in the chat).
    res.json({ success: true, ...(opts.otpCode ? { otpCode: opts.otpCode } : {}) });
  } catch (err) {
    sendFailure(res, err);
  }
});

// ---------------- Templates ----------------

/**
 * Normalise the {{n}} → named-source mapping.
 *
 * Arrives as a JSON string on the multipart create, or as an array on a JSON
 * patch. Unknown sources are dropped rather than stored, so a typo can't end
 * up silently resolving to nothing at send time.
 */
function parseVariables(raw) {
  let list = raw;
  if (typeof raw === 'string') {
    try {
      list = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  return list
    .map((v) => {
      const src = String(v?.source || '').trim();
      const isOther = src === 'other';
      const validSrc = isTemplateSource(src) || isOther ? src : '';
      return {
        index: Number(v?.index),
        source: validSrc,
        name: String(v?.name || '').slice(0, 120),
        fallback: String(v?.fallback || '').slice(0, 120),
      };
    })
    .filter((v) => Number.isInteger(v.index) && v.index > 0 && v.source);
}

/**
 * standard | carousel | lto. Our stored kind wins; otherwise read it off
 * Meta's components (templates made outside the CRM, or before kinds existed).
 */
function templateKind(remote, local) {
  if (local?.kind && local.kind !== 'standard') return local.kind;
  const types = (remote?.components || []).map((c) => String(c.type).toUpperCase());
  if (types.includes('CAROUSEL')) return 'carousel';
  if (types.includes('LIMITED_TIME_OFFER')) return 'lto';
  return 'standard';
}

// ---------------- Meta's WhatsApp Template Library (services/templateLibrary.js) ----------------
// Browse with the business's own WABA token (or read-only with the shared test
// number's, for a business without its own number); create into its own WABA.
function libraryFailure(res, err, what) {
  if (err instanceof LibraryError) {
    if (err.meta) logger.warn(`${what} refused by Meta`, { code: err.code, metaCode: err.meta.code });
    return res.status(err.status).json(err.toJSON());
  }
  logger.error(`${what} failed`, { error: err.message });
  return res.status(500).json({ success: false, code: 'FAILED', message: 'Something went wrong. Please try again.' });
}

// GET /templates/library?q=&language=&topic=&usecase=&industry=&name=
router.get('/templates/library', async (req, res) => {
  try {
    const q = req.query || {};
    const pick = (k) => (typeof q[k] === 'string' ? q[k] : '');
    res.json({
      success: true,
      ...(await browseLibrary(req.business, {
        q: pick('q'), language: pick('language'), topic: pick('topic'), usecase: pick('usecase'), industry: pick('industry'), name: pick('name'),
      })),
    });
  } catch (err) {
    libraryFailure(res, err, 'template library search');
  }
});

// POST /templates/library/use { libraryTemplateName, name, language, buttonInputs, bodyInputs }
router.post('/templates/library/use', async (req, res) => {
  try {
    res.status(201).json({ success: true, data: await useLibraryTemplate(req.business, req.body || {}) });
  } catch (err) {
    libraryFailure(res, err, 'create template from library');
  }
});

router.get('/templates', async (req, res) => {
  try {
    const locals = await Template.find(owner(req)).lean();
    const byName = {};
    locals.forEach((l) => (byName[l.name] = l));

    // The chat's Templates panel (?include=shared) for a business still on the
    // shared test number: its own drafts plus the shared number's sample
    // templates, marked `shared`. Read-only; nothing is written to its rows.
    if (req.query.include === 'shared' && !isWhatsAppConnected(req.business) && sandboxConfig().configured) {
      const shared = await sharedTemplates().catch((e) => {
        logger.warn('shared templates unavailable', { error: e.message });
        return [];
      });
      const own = locals.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      const ownNames = new Set(own.map((l) => l.name));
      return res.json({
        success: true,
        data: [
          ...own,
          ...shared.filter((r) => !ownNames.has(r.name) && r.status !== 'DELETED').map((r) => ({
            ...r,
            rejectedReason: r.rejected_reason && r.rejected_reason !== 'NONE' ? r.rejected_reason : '',
            kind: templateKind(r, null),
            shared: true,
          })),
        ],
      });
    }

    // Prefer live Meta status, but Meta only knows about the template itself —
    // the header media URL (it returns a handle, not a viewable image), the
    // placeholder mapping and the automation triggers are all ours. Read from
    // this tenant's own WABA, so the list can't show another tenant's templates.
    const remote = await client(req).listTemplates().catch(() => null);
    if (remote) {
      // Keep our copy's status in step with Meta's. Auto-send only fires
      // templates stored as APPROVED, so a missed status webhook would
      // otherwise leave an approved template silently never sending.
      const reasonOf = (r) => (r.rejected_reason && r.rejected_reason !== 'NONE' ? r.rejected_reason : '');
      const stale = remote.filter(
        (r) => byName[r.name] && r.status
          && (byName[r.name].status !== r.status || (byName[r.name].rejectedReason || '') !== reasonOf(r)),
      );
      if (stale.length) {
        // A status change the webhook missed: tell the owner, once. The
        // update is guarded on the old status, so a concurrent list load (or
        // the webhook landing meanwhile) can't notify the same change twice.
        for (const r of stale) {
          const previous = byName[r.name].status;
          if (previous === r.status) continue;
          // eslint-disable-next-line no-await-in-loop
          const moved = await Template.updateOne(
            { ...owner(req), name: r.name, status: previous },
            { $set: { status: r.status } },
          ).catch(() => null);
          if (moved?.matchedCount) {
            notifyTemplateStatus(req.business._id, {
              name: r.name, previous, status: r.status, reason: reasonOf(r),
            }).catch(() => {});
          }
        }
        await Template.bulkWrite(
          stale.map((r) => ({
            updateOne: {
              filter: { ...owner(req), name: r.name },
              update: { $set: { status: r.status, rejectedReason: reasonOf(r), metaId: r.id || byName[r.name].metaId } },
            },
          })),
        ).catch((e) => logger.warn('template status sync failed', { error: e.message }));
        for (const r of stale) byName[r.name].status = r.status;
      }
      const remoteNames = new Set(remote.map((r) => r.name));
      const localOnly = locals.filter((l) => l.status === 'DRAFT' || !remoteNames.has(l.name));
      const merged = [
        ...localOnly.map((l) => ({
          ...l,
          status: l.status || 'DRAFT',
          kind: l.kind || 'standard',
        })),
        ...remote.map((r) => {
          const local = byName[r.name];
          return {
            ...r,
            headerMediaUrl: local?.headerMediaUrl || '',
            headerFileName: local?.headerFileName || '',
            rejectedReason: r.rejected_reason && r.rejected_reason !== 'NONE' ? r.rejected_reason : '',
            // Our own media copies + offer defaults, for previews and sends.
            kind: templateKind(r, local),
            cards: local?.cards || [],
            lto: local?.lto || null,
            bodyText: local?.bodyText || '',
            footerText: local?.footerText || '',
            // Authentication: the settings asked of Meta (ours), or read back
            // off Meta's components for one made outside the CRM.
            ...(isAuthTemplate(r)
              ? { auth: local?.auth?.otpType ? local.auth : authFromComponents(r.components) }
              : {}),
            variables: local?.variables || [],
            trigger: local?.trigger || { enabled: false, keywords: [], statuses: [], events: [] },
            // Meta doesn't report when a template last changed; our row does.
            createdAt: local?.createdAt || null,
            updatedAt: local?.updatedAt || null,
          };
        }),
      ];
      return res.json({ success: true, data: merged });
    }
    res.json({
      success: true,
      data: locals.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * Normalise auto-send settings: keywords, order statuses and named events.
 * Unknown statuses/events are dropped. Switching it on with nothing to match
 * would do nothing, so `enabled` follows the content.
 */
function parseTrigger(b = {}) {
  const keywords = (Array.isArray(b.keywords) ? b.keywords : [])
    .map((k) => String(k || '').trim())
    .filter(Boolean)
    .slice(0, 20);
  const statuses = (Array.isArray(b.statuses) ? b.statuses : [])
    .map((s) => String(s || '').trim())
    .filter((s) => ORDER_STATUSES.includes(s));
  const events = (Array.isArray(b.events) ? b.events : [])
    .map((e) => String(e || '').trim())
    .filter((e) => EVENT_KEYS.has(e));
  return {
    enabled: !!b.enabled && (keywords.length > 0 || statuses.length > 0 || events.length > 0),
    keywords,
    statuses,
    events,
  };
}

/** A JSON field off a multipart body (arrives as a string), or the value itself. */
function jsonField(raw, fallback) {
  if (raw == null || raw === '') return fallback;
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

const HAS_VAR = /\{\{\s*\d+\s*\}\}/;

/**
 * Normalise one button from the composer into Meta's shape. Returns null for
 * a button with no label (or a URL/call button missing its target).
 * `allowUrlVar` is off for carousel cards and offers: their URL buttons are
 * sent without parameters, so a {{1}} in the URL could never be filled.
 */
function metaButton(b, { allowUrlVar = true } = {}) {
  const text = String(b?.text || '').trim().slice(0, 25);
  const type = String(b?.type || '').toUpperCase();
  if (type === 'URL') {
    const url = String(b.url || '').trim();
    if (!text || !url) return null;
    if (HAS_VAR.test(url)) {
      if (!allowUrlVar) throw Object.assign(new Error('Links on carousel cards and offer templates can’t contain {{…}} variables.'), { status: 400 });
      return { type: 'URL', text, url, example: [url.replace(/\{\{\s*\d+\s*\}\}/g, 'sample')] };
    }
    return { type: 'URL', text, url };
  }
  if (type === 'PHONE_NUMBER') {
    const phone = String(b.phone || '').trim();
    return text && phone ? { type: 'PHONE_NUMBER', text, phone_number: phone } : null;
  }
  return text ? { type: 'QUICK_REPLY', text } : null;
}

/**
 * Media for one header/card: our stored copy (for previews and sends) + the
 * sample handle Meta wants on create.
 *
 * Either a freshly uploaded `file`, or — when duplicating a template — the
 * `existingUrl` of media we already stored. Only URLs in this tenant's own
 * storage folder are accepted, so the server can't be pointed at an arbitrary
 * address (or another tenant's files) to fetch.
 */
async function uploadTemplateMedia(req, file, kind, existingUrl = '') {
  if (!file && existingUrl) {
    const url = String(existingUrl);
    if (!storage.isInFolder(url, mediaFolder(bizId(req), 'templates'))) {
      throw Object.assign(new Error('That media file can’t be reused. Please upload it again.'), { status: 400 });
    }
    const fileName = decodeURIComponent(url.split('/').pop()?.split('?')[0] || 'header');
    const handle = await client(req).uploadHeaderSample({ fileUrl: url, fileName });
    return { url, handle };
  }
  const resource = kind === 'video' ? 'video' : kind === 'document' ? 'raw' : 'image';
  const url = await storage.uploadBuffer(file.buffer, mediaFolder(bizId(req), 'templates'), resource);
  const handle = await client(req).uploadHeaderSample({
    fileUrl: url, fileName: file.originalname, fileType: file.mimetype,
  });
  return { url, handle };
}

router.post('/templates', uploadMedia.any(), async (req, res) => {
  try {
    const {
      name, language = 'en', headerType = 'none',
      headerText, bodyText, footerText, buttons,
    } = req.body || {};
    let { category = 'MARKETING' } = req.body || {};
    const kind = ['carousel', 'lto'].includes(req.body?.kind) ? req.body.kind : 'standard';
    // Carousels and limited-time offers only exist as Marketing templates.
    if (kind !== 'standard') category = 'MARKETING';
    const files = req.files || [];
    const fileFor = (field) => files.find((f) => f.fieldname === field) || null;
    const isDraft = String(req.body?.isDraft || req.body?.status || '').toUpperCase() === 'DRAFT' || req.body?.isDraft === 'true';
    if (!name?.trim()) {
      return res.status(400).json({ success: false, message: 'Template name is required' });
    }
    // The plan: how many templates, and carousel / authentication ones (services/plans.js).
    try {
      await assertTemplateAllowed(req.business, { name, category, kind });
    } catch (e) {
      if (sendPlanError(res, e)) return undefined;
      throw e;
    }

    // ---- Authentication (one-time code) ----
    // No body, header or buttons of our own: Meta writes the text, and the
    // request only chooses the optional lines and the OTP button.
    if (String(category).toUpperCase() === 'AUTHENTICATION') {
      const authName = name.trim().toLowerCase().replace(/\s+/g, '_');
      if (!/^[a-z0-9_]{1,512}$/.test(authName)) {
        return res.status(400).json({ success: false, message: 'The name can only use lowercase letters, numbers and underscores (at most 512 characters).' });
      }
      const lang = String(language || '').trim();
      if (!/^[a-z]{2,3}(_[A-Z]{2})?$/.test(lang)) {
        return res.status(400).json({ success: false, message: 'Choose the template language.' });
      }
      let auth;
      try {
        auth = parseAuthSettings(jsonField(req.body?.auth, {}), { draft: isDraft });
      } catch (e) {
        return res.status(e.status || 400).json({ success: false, message: e.message });
      }
      const payload = authTemplatePayload({ name: authName, language: lang, auth });
      let created = { id: '', status: 'DRAFT' };
      if (!isDraft) created = await client(req).createTemplate(payload);
      const status = isDraft ? 'DRAFT' : (created.status || 'PENDING');
      await Template.findOneAndUpdate(
        { ...owner(req), name: authName },
        {
          $set: {
            name: authName, metaId: created.id || '', language: lang, category: 'AUTHENTICATION', kind: 'standard',
            status, rejectedReason: '', headerText: '', headerMediaUrl: '', headerFormat: '', headerFileName: '',
            // Meta's own wording, kept for previews and the chat copy of each send.
            bodyText: authBodyText(auth), footerText: authFooterText(auth),
            components: payload.components, cards: [], auth, variables: [],
            ...(req.body?.trigger ? { trigger: parseTrigger(jsonField(req.body.trigger, {})) } : {}),
          },
        },
        { upsert: true },
      );
      logger.info('authentication template saved', { name: authName, otpType: auth.otpType, draft: isDraft, status });
      return res.status(201).json({ success: true, data: { ...created, name: authName, status } });
    }

    if (!isDraft && !bodyText?.trim()) {
      return res.status(400).json({ success: false, message: 'name and bodyText are required' });
    }

    // Meta requires an `example` for any component that carries {{n}}
    // placeholders — without it the create fails with "Invalid parameter".
    // Build one sample value per placeholder, preferring the operator's own
    // "if blank" fallback, then a representative sample for the mapped source,
    // then a generic word so the value is never empty.
    const SAMPLE_FOR_SOURCE = {
      customer_name: 'Riya', patient_name: 'Riya', guest_name: 'Riya', client_name: 'Riya',
      customer_phone: '+91 98765 43210', business_name: 'Acme',
      order_id: 'ORD-1042', order_ref: 'ORD-1042', order_status: 'Confirmed',
      order_total: '500', order_date: '15 Oct 2026', order_items: '2x Item',
      amount_paid: '500', payment_method: 'Online', payment_status: 'Paid',
      delivery_address: '12 MG Road', today: '15 Oct 2026',
      member: 'Dr. Rao', appointment_date: '18 Oct 2026', appointment_slot: '10:30 am',
    };
    const vars = parseVariables(req.body?.variables);
    const varsByIndex = {};
    for (const v of vars) if (v.index) varsByIndex[v.index] = v;
    // Ordered sample values 1..N for the placeholders found in `text`.
    const placeholderExamples = (text) => {
      const nums = [...String(text || '').matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => Number(m[1]));
      if (!nums.length) return null;
      const max = Math.max(...nums);
      const out = [];
      for (let i = 1; i <= max; i += 1) {
        const v = varsByIndex[i];
        out.push((v?.fallback && v.fallback.trim()) || SAMPLE_FOR_SOURCE[v?.source] || 'Sample');
      }
      return out;
    };

    const bad = (message) => res.status(400).json({ success: false, message });
    const body = bodyText.trim();
    const parsedButtons = jsonField(buttons, []);
    const buttonList = Array.isArray(parsedButtons) ? parsedButtons : [];

    const components = [];
    let headerMediaUrl = '';
    let headerFormat = '';
    let headerFileName = '';
    let cardsStored = [];
    let ltoStored;

    const bodyEx = placeholderExamples(body);
    const bodyComponent = {
      type: 'BODY',
      text: body,
      // Meta wants the body example as an array OF rows; one row of samples.
      ...(bodyEx ? { example: { body_text: [bodyEx] } } : {}),
    };

    if (kind === 'carousel') {
      // ---- Media card carousel: a message bubble + 2–10 swipeable cards ----
      // Every card must have the same shape (header format, body or not, and
      // the same buttons in the same order), and each needs its own media.
      const cardsIn = jsonField(req.body?.cards, []);
      if (!Array.isArray(cardsIn) || cardsIn.length < 2 || cardsIn.length > 10) {
        return bad('A carousel needs between 2 and 10 cards.');
      }
      const fmt = req.body?.cardFormat === 'video' ? 'video' : 'image';
      const shapeOf = (c) => `${c.body ? 'B' : '-'}|${c.buttons.map((b) => b.type).join(',')}`;
      const normalised = [];
      for (const [i, c] of cardsIn.entries()) {
        const cardBody = String(c?.body || '').trim();
        if (cardBody.length > 160) return bad(`Card ${i + 1}: the card text can be at most 160 characters.`);
        if (HAS_VAR.test(cardBody)) return bad(`Card ${i + 1}: card text can’t contain {{…}} variables.`);
        const btns = (Array.isArray(c?.buttons) ? c.buttons : [])
          .map((b) => metaButton(b, { allowUrlVar: false }))
          .filter(Boolean)
          .slice(0, 2);
        if (!btns.length) return bad(`Card ${i + 1} needs at least one button.`);
        // A new upload, or (duplicating) the card's already-stored media.
        const existing = typeof c?.mediaUrl === 'string' ? c.mediaUrl : '';
        if (!fileFor(`card_${i}`) && !existing) return bad(`Card ${i + 1} needs an ${fmt}.`);
        normalised.push({ body: cardBody, buttons: btns, existing });
      }
      const shape = shapeOf(normalised[0]);
      const odd = normalised.findIndex((c) => shapeOf(c) !== shape);
      if (odd > 0) {
        return bad(`Card ${odd + 1} doesn’t match card 1. WhatsApp needs every card to have the same buttons (same types, same order) and either all or none with text.`);
      }

      const metaCards = [];
      for (const [i, c] of normalised.entries()) {
        // eslint-disable-next-line no-await-in-loop
        const { url, handle } = await uploadTemplateMedia(req, fileFor(`card_${i}`), fmt, c.existing);
        metaCards.push({
          components: [
            { type: 'HEADER', format: fmt.toUpperCase(), example: { header_handle: [handle] } },
            ...(c.body ? [{ type: 'BODY', text: c.body }] : []),
            { type: 'BUTTONS', buttons: c.buttons },
          ],
        });
        cardsStored.push({
          mediaUrl: url,
          mediaFormat: fmt,
          body: c.body,
          buttons: c.buttons.map((b) => ({ type: b.type, text: b.text, url: b.url || '', phone: b.phone_number || '' })),
        });
      }
      components.push(bodyComponent, { type: 'CAROUSEL', cards: metaCards });
    } else {
      // ---- Header (standard + limited-time offer) ----
      const offer = kind === 'lto';
      if (headerType === 'text' && headerText?.trim()) {
        if (offer) return bad('Limited-time offers support an image or video header, not text.');
        const headerEx = placeholderExamples(headerText);
        components.push({
          type: 'HEADER',
          format: 'TEXT',
          text: headerText.trim(),
          ...(headerEx ? { example: { header_text: headerEx } } : {}),
        });
        headerFormat = 'TEXT';
      } else if (['image', 'video', 'document'].includes(headerType)) {
        if (offer && headerType === 'document') return bad('Limited-time offers support an image or video header.');
        const file = fileFor('headerMedia');
        const existing = String(req.body?.headerMediaUrl || '');
        if (!file && !existing) return bad(`A ${headerType} file is required for this header.`);
        const { url, handle } = await uploadTemplateMedia(req, file, headerType, existing);
        headerMediaUrl = url;
        headerFormat = headerType.toUpperCase();
        if (headerType === 'document') {
          headerFileName = file?.originalname || String(req.body?.headerFileName || '') || 'Document.pdf';
        }
        components.push({ type: 'HEADER', format: headerFormat, example: { header_handle: [handle] } });
      }

      if (offer) {
        // ---- Limited-time offer block: label, optional countdown ----
        const lt = jsonField(req.body?.lto, {}) || {};
        const label = String(lt.text || '').trim();
        if (!label) return bad('Add the offer label (for example “Expiring offer!”).');
        if (label.length > 16) return bad('The offer label can be at most 16 characters.');
        if (body.length > 600) return bad('A limited-time offer’s message can be at most 600 characters.');
        const code = String(lt.code || '').trim();
        if (lt.hasCopyCode && (!code || code.length > 15)) return bad('Add an offer code of up to 15 characters.');
        const endsAt = lt.endsAt ? new Date(lt.endsAt) : null;
        if (lt.hasExpiration && endsAt && Number.isNaN(endsAt.getTime())) return bad('The offer end time isn’t a valid date.');
        components.push({
          type: 'LIMITED_TIME_OFFER',
          limited_time_offer: { text: label, has_expiration: !!lt.hasExpiration },
        });
        components.push(bodyComponent);
        // Buttons: optional copy-code first, then exactly one link (required).
        const urlBtn = metaButton(buttonList.find((b) => String(b?.type).toUpperCase() === 'URL'), { allowUrlVar: false });
        if (!urlBtn) return bad('A limited-time offer needs a link button (text + URL).');
        components.push({
          type: 'BUTTONS',
          buttons: [...(lt.hasCopyCode ? [{ type: 'COPY_CODE', example: code }] : []), urlBtn],
        });
        ltoStored = {
          text: label,
          hasExpiration: !!lt.hasExpiration,
          hasCopyCode: !!lt.hasCopyCode,
          code: lt.hasCopyCode ? code : '',
          endsAt: lt.hasExpiration && endsAt ? endsAt : null,
        };
      } else {
        // ---- Standard ----
        components.push(bodyComponent);
        if (footerText?.trim()) components.push({ type: 'FOOTER', text: footerText.trim() });
        const btns = buttonList.map((b) => metaButton(b)).filter(Boolean);
        if (btns.length) components.push({ type: 'BUTTONS', buttons: btns });
      }
    }

    const payload = {
      name: name.trim().toLowerCase().replace(/\s+/g, '_'),
      language, category, components,
    };
    let created = { id: '', status: 'DRAFT' };
    if (!isDraft) {
      created = await client(req).createTemplate(payload);
    }

    await Template.findOneAndUpdate(
      { ...owner(req), name: payload.name },
      {
        $set: {
          name: payload.name, metaId: created.id || '', language, category, kind,
          status: isDraft ? 'DRAFT' : (created.status || 'PENDING'), headerText: headerText || '', headerMediaUrl,
          headerFormat, headerFileName,
          bodyText: body, footerText: kind === 'standard' ? footerText || '' : '', components,
          cards: cardsStored,
          ...(ltoStored ? { lto: ltoStored } : {}),
          // Auto-send chosen while creating. Saved now, but it can only fire
          // once Meta approves the template (triggers only send APPROVED ones).
          ...(req.body?.trigger ? { trigger: parseTrigger(jsonField(req.body.trigger, {})) } : {}),
          // What each {{n}} means. Sent as JSON because the request is
          // multipart (the header image rides along with it).
          variables: parseVariables(req.body?.variables),
        },
      },
      { upsert: true },
    );
    res.status(201).json({ success: true, data: { ...created, name: payload.name, status: isDraft ? 'DRAFT' : (created.status || 'PENDING') } });
  } catch (err) {
    // Meta's generic "message" is usually "Invalid parameter"; its
    // `error_user_msg` says the actual reason (e.g. "Variables can't be at the
    // start or end of the template"), so surface that to the operator.
    const e = err.response?.data?.error;
    const message = e?.error_user_msg || e?.message || err.message;
    logger.error('create template failed', { error: message, title: e?.error_user_title });
    res.status(err.status && !e ? err.status : 500).json({ success: false, message });
  }
});

/** The named values a placeholder can map to — shaped to the tenant's type. */
router.get('/template-sources', (req, res) => {
  const v = verticalConfig(req.business?.category, req.business?.labels);
  res.json({
    success: true,
    data: templateSourcesFor(v.archetype, v.customerLabel),
    statuses: ORDER_STATUSES,
    events: TRIGGER_EVENTS,
  });
});

/**
 * Set a template's automation: which keywords fire it, which order statuses
 * fire it, and what its {{n}} placeholders mean.
 *
 * Separate from the create route because triggers are normally configured
 * *after* Meta approves the template, and nothing here is sent to Meta — it's
 * all local behaviour.
 */
router.patch('/templates/:name/automation', async (req, res) => {
  try {
    const b = req.body || {};
    const trigger = parseTrigger(b);
    const { keywords, statuses, events } = trigger;
    const set = { trigger };
    if (b.variables !== undefined) set.variables = parseVariables(b.variables);

    const doc = await Template.findOneAndUpdate(
      { ...owner(req), name: req.params.name },
      { $set: set },
      { new: true },
    );
    if (!doc) return res.status(404).json({ success: false, message: 'Template not found' });
    logger.info('template automation updated', {
      template: doc.name, enabled: doc.trigger?.enabled, keywords, statuses, events,
    });
    res.json({ success: true, data: doc });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Deletes at Meta (WABA-level) and locally. If Meta refuses, stop: dropping the
// local row anyway would hide a template that still exists in the WABA, and the
// name would then collide on the next create.
router.delete('/templates/:name', async (req, res) => {
  const name = req.params.name;
  try {
    await client(req).deleteTemplate(name);
  } catch (err) {
    const message = err.response?.data?.error?.message || err.message;
    logger.error('template delete at Meta failed', { name, error: message });
    return res.status(502).json({
      success: false,
      message: `Meta refused to delete "${name}": ${message}`,
    });
  }
  try {
    await Template.deleteOne({ ...owner(req), name });
    res.json({ success: true, message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
