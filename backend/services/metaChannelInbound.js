// ---------------------------------------------------------------------------
// Inbound Messenger / Instagram webhooks (routes/metaWebhook.js), once the
// signature has been checked.
//
// Each entry is routed to a business by its id: the Page id for object 'page',
// the Instagram professional account id for object 'instagram', looked up in
// ChannelConnection. Instagram entries look the same whether the account was
// connected through its Facebook Page or through Business Login for
// Instagram (entry.id = the professional account id = igUserId, sender = the
// customer's IGSID), so both land here the same way. Messages become ordinary Conversation / Message rows with
// channel 'messenger' | 'instagram', keyed by the business and the sender's
// PSID / IGSID, so they show in Chats with the channel badge and use the same
// notification grouping as WhatsApp. Delivery / read events move the ticks of
// the CRM's own replies forward.
//
// The WhatsApp automation (flow maps, keyword templates, the WhatsApp journey)
// doesn't run here. The channel's own journey (Automation → Instagram /
// Messenger, services/channelJourney.js) answers a newly filed message or
// tapped button, unless the chat is set to Manual.
// ---------------------------------------------------------------------------
import axios from 'axios';
import ChannelConnection from '../models/ChannelConnection.js';
import Business from '../models/Business.js';
import Conversation from '../models/Conversation.js';
import Message from '../models/Message.js';
import storage from './storage.js';
import { emitMessage } from './eventBus.js';
import { setReaction } from './reactions.js';
import { recordOutboundPreview } from './conversationState.js';
import { handleStatus } from './chatbot.js';
import { statusesBelow } from './messageStatus.js';
import { notifyChatMessage } from './notifications.js';
import { outboundPreview } from './metaCloud.js';
import { withConnectionToken } from './metaChannels.js';
import { IG, isInstagramLogin } from './instagramGraph.js';
import { handleLeadgenEntry } from './metaAds.js';
import { handleTemplateStatusChange, TEMPLATE_STATUS_FIELDS } from './metaMessaging.js';
import { runChannelJourney } from './channelJourney.js';
import { handleCommentEntry } from './commentAutoDm.js';
import logger from './logger.js';

const version = () => process.env.WA_GRAPH_VERSION || 'v22.0';
const G = () => `https://graph.facebook.com/${version()}`;
const http = axios.create({ timeout: 15000 });
const digits = (s) => String(s || '').replace(/\D/g, '');
const PROFILE_EVERY_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_MEDIA_BYTES = 25 * 1024 * 1024;
const MEDIA_LABEL = { image: '📷 Photo', video: '🎥 Video', audio: '🎵 Audio', document: '📄 Document' };
const OBJECT_CHANNEL = { page: 'messenger', instagram: 'instagram' };

/** "Messenger user" / "@handle" when Meta shares no name. */
const fallbackName = (channel, handle) => (channel === 'instagram'
  ? (handle ? `@${handle}` : 'Instagram user')
  : 'Messenger user');

/** The connection (and so the business) a webhook entry belongs to. */
export async function connectionForEntry(channel, entryId) {
  const id = String(entryId || '');
  if (!id) return null;
  const filter = channel === 'messenger' ? { channel, pageId: id } : { channel, igUserId: id };
  const rows = await ChannelConnection.find(filter).sort({ updatedAt: -1 }).limit(5).lean();
  // A live connection wins; a disconnected one still files messages (the
  // customer's message is real), but only when it is the only candidate.
  return rows.find((r) => r.status === 'connected') || (rows.length === 1 ? rows[0] : null);
}

/** One message event → the rows to store: text, then one per attachment. */
export function parseChannelMessage(msg = {}) {
  if (msg.is_deleted) return [];
  const items = [];
  const text = String(msg.text || '').trim();
  if (text) items.push({ type: 'text', body: text });
  for (const a of msg.attachments || []) {
    const url = a?.payload?.url || '';
    switch (a?.type) {
      case 'image':
      case 'video':
      case 'audio':
        if (url) items.push({ type: a.type, body: '', media: { url, type: a.type } });
        break;
      case 'file':
        if (url) items.push({ type: 'document', body: '', media: { url, type: 'document', filename: a.payload?.title || 'File' } });
        break;
      case 'share':
      case 'ig_post': // replaces 'share' for Instagram post shares (2026)
        items.push({ type: 'text', body: `🔗 Shared a post${url ? `: ${url}` : ''}` });
        break;
      case 'story_mention':
        items.push({ type: 'text', body: `📣 Mentioned you in their story${url ? `: ${url}` : ''}` });
        break;
      case 'ig_reel':
      case 'reel':
        items.push({ type: 'text', body: `🎬 Shared a reel${url ? `: ${url}` : ''}` });
        break;
      case 'ephemeral':
        items.push({ type: 'text', body: 'Sent a disappearing photo or video (not available to the CRM)' });
        break;
      default:
        if (a?.type) items.push({ type: 'text', body: a.title || a.payload?.title || (url ? `🔗 ${url}` : `[${a.type}]`) });
    }
  }
  if (!items.length && msg.is_unsupported) items.push({ type: 'text', body: 'Sent a message the CRM can’t show (unsupported by Meta)' });
  if (!items.length && msg.quick_reply?.payload) items.push({ type: 'text', body: String(msg.quick_reply.payload) });
  return items;
}

/** Copy a Meta CDN file into our storage (its URL expires). Falls back to the original URL. */
async function rehost(url, businessId, kind) {
  try {
    const { data, headers } = await http.get(url, {
      responseType: 'arraybuffer', timeout: 30000, maxContentLength: MAX_MEDIA_BYTES, maxBodyLength: MAX_MEDIA_BYTES,
    });
    const buffer = Buffer.from(data);
    const resource = kind === 'image' ? 'image' : kind === 'video' || kind === 'audio' ? 'video' : 'raw';
    const stored = await storage.uploadBuffer(buffer, storage.mediaFolder(businessId, 'inbound'), resource);
    return { url: stored, mime: String(headers?.['content-type'] || '') };
  } catch (err) {
    logger.warn('channel media copy failed, keeping Meta’s URL', { error: err.message });
    return { url, mime: '' };
  }
}

/**
 * The sender's name and photo (User Profile API for Messenger, Instagram user
 * profile for Instagram), looked up at most once a week per chat. Needs the
 * "Business Asset User Profile Access" feature; without it Meta answers with
 * nothing or an error and the chat keeps the fallback name.
 */
async function lookupProfile(row, channel, psid, convo) {
  if (convo?.profileCheckedAt && Date.now() - new Date(convo.profileCheckedAt).getTime() < PROFILE_EVERY_MS) return null;
  const fields = channel === 'instagram' ? 'name,username,profile_pic' : 'first_name,last_name,profile_pic';
  const out = { checkedAt: new Date() };
  // Business Login for Instagram: the profile is on graph.instagram.com, read
  // with the Instagram user token.
  const host = isInstagramLogin(row) ? IG() : G();
  try {
    const data = await withConnectionToken(row, async (token) => (await http.get(`${host}/${psid}`, {
      params: { fields },
      headers: { Authorization: `Bearer ${token}` },
    })).data);
    const name = channel === 'instagram'
      ? String(data?.name || '').trim()
      : `${data?.first_name || ''} ${data?.last_name || ''}`.trim();
    if (name) out.name = name;
    if (data?.username) out.handle = String(data.username);
    if (data?.profile_pic) {
      const pic = await rehost(data.profile_pic, String(row.businessId), 'image');
      out.avatarUrl = pic.url;
    }
  } catch (err) {
    logger.info('channel profile lookup unavailable', {
      channel, error: err.response?.data?.error?.message || err.message,
    });
  }
  return out;
}

/** A customer's message (or postback) → Message rows, the conversation, the bell. */
async function onInbound(row, channel, ev, items) {
  const businessId = String(row.businessId);
  const psid = digits(ev.sender?.id);
  if (!psid || !items.length) return false;
  const mid = ev.message?.mid || ev.postback?.mid || '';
  // Meta retries deliveries it thinks failed: file each message once.
  if (mid && (await Message.exists({ businessId, metaMessageId: mid, direction: 'in' }))) return false;

  const convo = await Conversation.findOne({ businessId, phone: psid }).lean();
  // Blocked in the CRM (Messenger / Instagram have no block API): ignored,
  // not filed, no alert, no journey.
  if (convo?.blocked) return false;
  const profile = await lookupProfile(row, channel, psid, convo);
  const name = profile?.name || convo?.name || '';
  const handle = profile?.handle || convo?.handle || '';

  const docs = [];
  for (const it of items) {
    let media = null;
    if (it.media?.url) {
      // eslint-disable-next-line no-await-in-loop
      const copy = await rehost(it.media.url, businessId, it.media.type);
      media = { url: copy.url, type: it.media.type, mime: copy.mime, filename: it.media.filename || '', caption: '' };
    }
    // eslint-disable-next-line no-await-in-loop
    const doc = await Message.create({
      phone: psid,
      name,
      businessId,
      direction: 'in',
      type: it.type,
      body: it.body,
      raw: media ? { channel, event: ev, media } : { channel, event: ev },
      metaMessageId: mid || undefined,
      status: 'received',
      channel,
    });
    docs.push({ doc, preview: it.body || MEDIA_LABEL[it.type] || 'New message', type: it.type });
  }
  const last = docs[docs.length - 1];
  const at = ev.timestamp ? new Date(Number(ev.timestamp)) : new Date();
  const when = Number.isNaN(at.getTime()) || at.getTime() > Date.now() ? new Date() : at;
  // Conversation first, then the CRM is told (its chat list refresh is then current).
  await Conversation.findOneAndUpdate(
    { businessId, phone: psid },
    {
      $set: {
        businessId,
        channel,
        lastInboundAt: when,
        lastMessageAt: when,
        lastMessageBody: last.preview,
        ...(name ? { name } : {}),
        ...(handle ? { handle } : {}),
        ...(profile?.avatarUrl ? { avatarUrl: profile.avatarUrl } : {}),
        ...(profile?.checkedAt ? { profileCheckedAt: profile.checkedAt } : {}),
      },
      $inc: { unread: docs.length },
    },
    { upsert: true, new: true },
  );
  for (const d of docs) emitMessage(d.doc);
  for (const d of docs) {
    // eslint-disable-next-line no-await-in-loop
    await notifyChatMessage(businessId, {
      phone: psid, name: name || fallbackName(channel, handle), type: d.type, body: d.doc.body,
    }).catch(() => {});
  }
  return true;
}

/**
 * The channel's journey (Automation → Instagram / Messenger), for a message
 * just filed. Skipped when the chat is set to Manual.
 */
async function automate(row, channel, ev, payload) {
  const psid = digits(ev.sender?.id);
  if (!psid) return;
  const business = await Business.findById(row.businessId).lean().catch(() => null);
  if (!business) return;
  await runChannelJourney(business, channel, psid, { payload: String(payload || '') });
}

/**
 * A message the Page / Instagram account itself sent (Instagram echoes every
 * one). The CRM's own replies are already stored; one sent from the Instagram
 * app or Page inbox is added so the chat stays complete.
 */
async function onEcho(row, channel, ev) {
  const businessId = String(row.businessId);
  const psid = digits(ev.recipient?.id);
  const mid = ev.message?.mid;
  if (!psid || !mid) return;
  if (await Message.exists({ businessId, metaMessageId: mid })) return;
  // Our own send may still be saving its row: give it a moment.
  await new Promise((r) => setTimeout(r, Number(process.env.META_ECHO_WAIT_MS) || 2500));
  if (await Message.exists({ businessId, metaMessageId: mid })) return;
  if (!(await Conversation.exists({ businessId, phone: psid }))) return;
  for (const it of parseChannelMessage({ ...ev.message, is_echo: undefined })) {
    const d = {
      type: it.type, body: it.body || MEDIA_LABEL[it.type] || '', headerImageUrl: '', headerText: '', headerDocName: '',
      headerDocUrl: '', footer: '', buttons: [], cta: null, flowCta: '',
      mediaUrl: it.media?.url || '', mediaType: it.media ? it.type : '', filename: it.media?.filename || '',
    };
    // eslint-disable-next-line no-await-in-loop
    const doc = await Message.create({
      phone: psid, direction: 'out', type: it.type, body: d.body,
      raw: { outbound: d, channel, echo: true }, metaMessageId: mid, status: 'sent', businessId, channel,
    });
    // eslint-disable-next-line no-await-in-loop
    await recordOutboundPreview(psid, outboundPreview(d), businessId).catch(() => {});
    emitMessage(doc);
  }
}

/** Delivered / read up to a watermark (ms), or for the listed message ids. */
async function onReceipt(row, channel, ev, status) {
  const businessId = String(row.businessId);
  const psid = digits(ev.sender?.id);
  if (!psid) return;
  const info = status === 'read' ? ev.read : ev.delivery;
  const mids = new Set([...(info?.mids || []), ...(info?.mid ? [info.mid] : [])].filter(Boolean));
  let watermark = Number(info?.watermark) || 0;
  if (!watermark && info?.mid) {
    // Instagram's read event names the last message seen: everything before it was seen too.
    const m = await Message.findOne({ businessId, metaMessageId: info.mid }).select('createdAt').lean();
    if (m?.createdAt) watermark = new Date(m.createdAt).getTime();
  }
  if (watermark) {
    const older = await Message.find({
      businessId,
      phone: psid,
      channel,
      direction: 'out',
      createdAt: { $lte: new Date(watermark + 1000) },
      status: { $in: statusesBelow(status) },
    }).select('metaMessageId').sort({ createdAt: -1 }).limit(200).lean();
    for (const m of older) if (m.metaMessageId) mids.add(m.metaMessageId);
  }
  for (const id of mids) {
    // eslint-disable-next-line no-await-in-loop
    await handleStatus({ id, status }, { tenantId: businessId });
  }
}

async function onReaction(row, ev) {
  const businessId = String(row.businessId);
  const r = ev.reaction || {};
  if (!r.mid) return;
  const emoji = r.action === 'unreact' ? '' : r.emoji || (r.reaction === 'love' ? '❤️' : '👍');
  // The customer's reaction; the business's own (if any) stays beside it.
  await setReaction({ businessId, metaMessageId: r.mid, side: 'in', emoji });
}

/** One `messaging` event of an entry that belongs to `row`'s business. */
export async function handleChannelEvent(row, channel, ev = {}) {
  const ownId = channel === 'messenger' ? row.pageId : row.igUserId;
  if (ev.message?.is_echo) return onEcho(row, channel, ev);
  // Never file our own Page / account as a customer.
  if (String(ev.sender?.id || '') === String(ownId)) return undefined;
  if (ev.message) {
    const stored = await onInbound(row, channel, ev, parseChannelMessage(ev.message));
    if (stored) await automate(row, channel, ev, ev.message.quick_reply?.payload);
    return undefined;
  }
  if (ev.postback) {
    const title = String(ev.postback.title || ev.postback.payload || '').trim();
    if (!title) return undefined;
    const stored = await onInbound(row, channel, ev, [{ type: 'text', body: title }]);
    if (stored) await automate(row, channel, ev, ev.postback.payload);
    return undefined;
  }
  if (ev.delivery) return onReceipt(row, channel, ev, 'delivered');
  if (ev.read) return onReceipt(row, channel, ev, 'read');
  if (ev.reaction) return onReaction(row, ev);
  return undefined;
}

/** A signed delivery for object 'page' or 'instagram'. Never throws. */
export async function handleMetaWebhook(body = {}) {
  const channel = OBJECT_CHANNEL[body.object];
  if (!channel) {
    logger.warn('Meta webhook for an object this endpoint does not handle, dropped', { object: body.object || '(none)' });
    return;
  }
  for (const entry of body.entry || []) {
    // Lead ads (Feature F): 'leadgen' changes on a Page go to the business
    // whose ads connection uses that Page for lead forms.
    if (body.object === 'page' && (entry.changes || []).some((c) => c?.field === 'leadgen')) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await handleLeadgenEntry(entry);
      } catch (err) {
        logger.error('leadgen webhook failed', { error: err.message });
      }
    }
    // Messenger utility templates: Meta's review result (and later pauses,
    // disables) for a template on this Page.
    const statusChanges = body.object === 'page'
      ? (entry.changes || []).filter((c) => TEMPLATE_STATUS_FIELDS.includes(c?.field))
      : [];
    if (statusChanges.length) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const conn = await connectionForEntry('messenger', entry.id);
        if (!conn) {
          logger.warn('template status webhook for a Page no business has connected, dropped', { entryId: String(entry.id || '') });
        } else {
          for (const c of statusChanges) {
            // eslint-disable-next-line no-await-in-loop
            await handleTemplateStatusChange(conn, c.value || {});
          }
        }
      } catch (err) {
        logger.error('template status webhook failed', { error: err.message });
      }
    }
    // Comment auto-DM (Create): a new comment on a Page post ('feed') or an
    // Instagram post / reel ('comments').
    const commentField = body.object === 'page' ? 'feed' : 'comments';
    if ((entry.changes || []).some((c) => c?.field === commentField)) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await handleCommentEntry(body.object, entry);
      } catch (err) {
        logger.error('comment webhook failed', { error: err.message });
      }
    }
    // Nothing for the messaging inbox in this entry (e.g. a leadgen change only).
    if (!(entry.messaging || []).length) continue;
    let row = null;
    try {
      // eslint-disable-next-line no-await-in-loop
      row = await connectionForEntry(channel, entry.id);
    } catch (err) {
      logger.error('channel webhook lookup failed', { error: err.message });
      continue;
    }
    if (!row) {
      logger.warn('channel webhook for a Page / Instagram account no business has connected, dropped', {
        channel, entryId: String(entry.id || ''),
      });
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const biz = await Business.findById(row.businessId).select('active name').lean().catch(() => null);
    if (!biz || !biz.active) {
      logger.warn('channel webhook for an inactive or deleted business, dropped', { channel });
      continue;
    }
    for (const ev of entry.messaging || []) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await handleChannelEvent(row, channel, ev);
      } catch (err) {
        logger.error('channel webhook event failed', { channel, error: err.message });
      }
    }
  }
}

export default { handleMetaWebhook, handleChannelEvent, parseChannelMessage, connectionForEntry };
