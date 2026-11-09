// Other Meta apps on a business's WhatsApp number.
//
// A WhatsApp account can be subscribed to more than one Meta app: a business
// that used another tool or its own developer app before joining keeps that
// app attached. Meta then lets only one app hold each chat ("thread
// control"). The app that holds it gets the `messages` webhook and can reply;
// every other app gets the chat on the `standby` field and is refused when it
// sends (error 131070, "another app is controlling this thread").
//
// So the CRM subscribes to `standby` too (services/webhookSetup.js): the chat
// still shows up, including what the other app sent (its "echoes"), and the
// Channel Status page says which app is in the way and how to remove it.
import axios from 'axios';
import Message from '../models/Message.js';
import logger from './logger.js';
import { describeOutbound, outboundPreview } from './metaCloud.js';
import { recordOutboundPreview } from './conversationState.js';
import { emitMessage } from './eventBus.js';

export const THREAD_CONTROLLED_ELSEWHERE = 131070;

const graph = (biz) => `https://graph.facebook.com/${biz.graphVersion || process.env.WA_GRAPH_VERSION || 'v22.0'}`;

/**
 * The apps subscribed to this business's WhatsApp account other than ours.
 * @returns {Promise<{ ok: boolean, apps: {id: string, name: string}[], error?: string }>}
 */
const cache = new Map(); // wabaId -> { at, value }
const TTL_MS = 5 * 60 * 1000;

export async function otherSubscribedApps(biz, { refresh = false } = {}) {
  if (!biz?.wabaId || !biz?.accessToken) return { ok: false, apps: [], error: 'WhatsApp is not connected' };
  const key = String(biz.wabaId);
  const hit = cache.get(key);
  if (hit && !refresh && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = await readOtherApps(biz);
  if (value.ok) cache.set(key, { at: Date.now(), value });
  return value;
}

async function readOtherApps(biz) {
  const ours = String(process.env.META_APP_ID || '');
  try {
    const { data } = await axios.get(`${graph(biz)}/${encodeURIComponent(biz.wabaId)}/subscribed_apps`, {
      headers: { Authorization: `Bearer ${biz.accessToken}` },
      timeout: 10000,
    });
    const apps = (data?.data || [])
      .map((d) => ({ id: String(d.whatsapp_business_api_data?.id || ''), name: d.whatsapp_business_api_data?.name || '' }))
      .filter((a) => a.id && a.id !== ours);
    return { ok: true, apps };
  } catch (err) {
    return { ok: false, apps: [], error: err.response?.data?.error?.message || err.message };
  }
}

/**
 * A message another app sent on this number (a `standby` echo): kept in the
 * chat so the agent sees the whole conversation, marked as not sent by us.
 */
export async function logEcho(echo, { tenantId }) {
  try {
    const payload = echo?.message && typeof echo.message === 'object' ? echo.message : echo || {};
    const metaMessageId = String(echo?.id || echo?.message_id || payload.id || '');
    const phone = String(payload.to || echo?.to || echo?.recipient_id || '').replace(/\D/g, '');
    if (!phone || !tenantId) return;
    if (metaMessageId && (await Message.findOne({ metaMessageId, businessId: tenantId }).select('_id').lean())) return;
    const d = describeOutbound({ ...payload, type: payload.type || 'text' }) || { type: payload.type || 'text', body: '' };
    const at = Number(echo?.timestamp) ? new Date(Number(echo.timestamp) * 1000) : undefined;
    const doc = await Message.create({
      phone,
      direction: 'out',
      type: d.type || 'text',
      body: d.body || '',
      raw: { outbound: d, otherApp: true },
      ...(metaMessageId ? { metaMessageId } : {}),
      status: 'sent',
      businessId: tenantId,
      ...(at ? { createdAt: at } : {}),
    });
    await recordOutboundPreview(phone, outboundPreview(d), tenantId, { messageId: metaMessageId, status: 'sent' }).catch(() => {});
    emitMessage(doc);
  } catch (err) {
    logger.warn('could not log another app\'s message', { error: err.message });
  }
}

/** The agent-facing explanation for a send refused because another app holds the chat. */
export const THREAD_CONTROL_MESSAGE =
  'Another Meta app connected to this WhatsApp number (for example an old automation or a developer app) '
  + 'is controlling this chat, so WhatsApp refused the message. Remove that app from the WhatsApp account '
  + '(Channel Status shows which one), then send again.';

// ---------------------------------------------------------------------------
// "Another app holds this number's chats": remembered on the business
// (meta.threadControl) so Channel Status can say so, with one notification
// the first time. Cleared when our app answers a chat again, on a reconnect,
// or when the business dismisses it.
// ---------------------------------------------------------------------------
const lastWrite = new Map(); // businessId -> ms, so a burst of refusals is one write
const WRITE_EVERY_MS = 60 * 1000;

/**
 * Record that a chat on this business's number is held by another app.
 * @param {string} businessId
 * @param {{ phone?: string, via?: 'send'|'standby' }} info
 */
export async function recordThreadControl(businessId, { phone = '', via = 'send' } = {}) {
  const id = String(businessId || '');
  if (!id) return;
  const now = Date.now();
  if (now - (lastWrite.get(id) || 0) < WRITE_EVERY_MS) return;
  lastWrite.set(id, now);
  try {
    // Imported here: models/Business.js → … → metaCloud.js imports this file.
    const { default: Business } = await import('../models/Business.js');
    const biz = await Business.findById(id).select('name meta').lean();
    if (!biz) return;
    const prev = biz.meta?.threadControl;
    const next = {
      at: prev?.at || new Date(),
      lastAt: new Date(),
      phone: String(phone || '').replace(/\D/g, '') || prev?.phone || '',
      count: (Number(prev?.count) || 0) + 1,
      via,
    };
    await Business.updateOne({ _id: id }, { $set: { 'meta.threadControl': next } });
    if (prev?.at) return; // already told
    logger.warn('WhatsApp chats held by another app on this number', { business: biz.name, via });
    const { notify } = await import('./notifications.js');
    notify(id, {
      type: 'whatsapp_thread_control',
      title: 'Another app is answering your WhatsApp chats',
      body: 'A Meta app from an earlier setup still controls chats on your WhatsApp number, so its old replies go out and messages from the CRM are refused. Open Channel Status to see how to fix it.',
      target: { view: 'channel-status' },
      groupKey: 'whatsapp_thread_control',
    }).catch(() => {});
  } catch (err) {
    logger.warn('could not record thread control', { error: err.message });
  }
}

/** Our app is answering chats again (or the business dismissed the notice). */
export async function clearThreadControl(businessId) {
  const id = String(businessId || '');
  if (!id) return;
  lastWrite.delete(id);
  try {
    const { default: Business } = await import('../models/Business.js');
    await Business.updateOne({ _id: id }, { $set: { 'meta.threadControl': null } });
  } catch (err) {
    logger.warn('could not clear thread control', { error: err.message });
  }
}

/** Remove OUR app from a WhatsApp account (on disconnect), so Meta stops delivering to us. */
export async function unsubscribeOurApp(biz) {
  if (!biz?.wabaId || !biz?.accessToken) return { ok: false };
  try {
    await axios.delete(`${graph(biz)}/${encodeURIComponent(biz.wabaId)}/subscribed_apps`, {
      headers: { Authorization: `Bearer ${biz.accessToken}` },
      timeout: 10000,
    });
    cache.delete(String(biz.wabaId));
    return { ok: true };
  } catch (err) {
    const reason = err.response?.data?.error?.message || err.message;
    logger.warn('could not unsubscribe our app from the WhatsApp account', { business: biz.name, error: reason });
    return { ok: false, reason };
  }
}
