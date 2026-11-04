// ---------------------------------------------------------------------------
// Messenger and Instagram campaigns (Campaigns → New campaign → Messenger /
// Instagram). Created by routes/campaigns.js, sent by the same runner as
// WhatsApp campaigns (services/campaignRunner.js: lease, schedule, cancel,
// resume after a restart); this file holds what differs.
//
// The audience is the business's own Messenger / Instagram chats (a PSID /
// IGSID only exists once the customer has written). What each one gets is
// decided when their turn comes, from the chat's last inbound message:
//   • inside the 24-hour window: the quick message (or text / image);
//   • outside it, Messenger: the approved utility template, when the campaign
//     has one (non-promotional updates only, confirmed by the user);
//   • outside it otherwise (always on Instagram): skipped, "Outside the
//     24-hour window". No message tag is ever used.
//
// Sends are paced (META_CAMPAIGN_SPACING_MS, default 250 ms ≈ 4 a second) and
// a rate-limit answer from Meta (codes 4, 17, 32, 613, 80001, 80002, 80006)
// is retried with exponential backoff. Error 190 marks the connection
// disconnected (metaChannels.withConnectionToken → markRevoked) and stops the
// campaign. Messenger / Instagram messages use no message credits: only
// WhatsApp sends are metered (services/credits.js).
// ---------------------------------------------------------------------------
import Business from '../models/Business.js';
import Campaign from '../models/Campaign.js';
import ChannelConnection from '../models/ChannelConnection.js';
import Conversation from '../models/Conversation.js';
import Message from '../models/Message.js';
import MetaTemplate from '../models/MetaTemplate.js';
import QuickMessage from '../models/QuickMessage.js';
import { ChannelError, CHANNEL_LABEL, windowIsOpen } from './metaChannels.js';
import {
  quickMessageProblems, cleanQuickMessage, sendQuickMessage, sendUtilityTemplate, utilityValues, utilityValueProblems,
} from './metaMessaging.js';
import logger from './logger.js';

export const META_CAMPAIGN_CHANNELS = ['messenger', 'instagram'];
export const OUTSIDE_WINDOW = 'Outside the 24-hour window';
export const MAX_RECIPIENTS = 5000;
const DAY_MS = 24 * 60 * 60 * 1000;
const FLUSH_EVERY = 10;
const FLUSH_MS = 10 * 1000;
export const MAX_RETRIES = 4;
// Meta's throttling answers (Graph rate limiting, Messenger / Instagram BUC limits).
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80001, 80002, 80006]);
const MODES = { messenger: ['quick', 'utility', 'both'], instagram: ['quick', 'text'] };

const spacingMs = () => Math.max(0, Number(process.env.META_CAMPAIGN_SPACING_MS ?? 250));
const backoffMs = (attempt) => Math.min(60000, (Number(process.env.META_CAMPAIGN_BACKOFF_MS) || 2000) * 2 ** attempt);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A create / edit request that can't be accepted (routes/campaigns.js answers with its status). */
export class CampaignInputError extends Error {
  constructor(message, status = 400, code = undefined) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const Invalid = CampaignInputError;

// ------------------------------------------------------------ audience --

/**
 * The business's chats on a channel that can be messaged: everyone who has
 * written at least once, or only those whose last message is within
 * `activeDays` days.
 */
export async function audienceFor(businessId, channel, { activeDays = 0 } = {}) {
  const days = Math.max(0, Math.min(365, Math.floor(Number(activeDays) || 0)));
  const filter = {
    businessId: String(businessId),
    channel,
    lastInboundAt: days ? { $gte: new Date(Date.now() - days * DAY_MS) } : { $ne: null },
    // Blocked contacts never get a campaign.
    blocked: { $ne: true },
  };
  const rows = await Conversation.find(filter).select('phone name handle lastInboundAt').sort({ lastInboundAt: -1 })
    .limit(MAX_RECIPIENTS + 1).lean();
  return { days, rows, capped: rows.length > MAX_RECIPIENTS };
}

/** How many of them are inside the 24-hour window right now. */
export function windowCounts(rows, now = Date.now()) {
  const inWindow = rows.filter((r) => windowIsOpen(r, now)).length;
  return { total: rows.length, inWindow, outsideWindow: rows.length - inWindow };
}

export async function audiencePreview(businessId, channel, opts = {}) {
  if (!META_CAMPAIGN_CHANNELS.includes(channel)) throw new Invalid('channel must be messenger or instagram.');
  const { days, rows, capped } = await audienceFor(businessId, channel, opts);
  const list = rows.slice(0, MAX_RECIPIENTS);
  return { channel, activeDays: days, capped, ...windowCounts(list) };
}

// ------------------------------------------------------ create / edit --

function scheduleOf(body, mode) {
  let scheduledAt = null;
  if (body.scheduledAt) {
    scheduledAt = new Date(body.scheduledAt);
    if (Number.isNaN(scheduledAt.getTime())) {
      if (mode === 'schedule') throw new Invalid('Pick a date and time to send this campaign.');
      scheduledAt = null;
    }
  }
  if (mode === 'schedule') {
    if (!scheduledAt) throw new Invalid('Pick a date and time to send this campaign.');
    if (scheduledAt.getTime() <= Date.now()) throw new Invalid('Pick a future date and time for this campaign.');
  }
  return scheduledAt;
}

const idOk = (id) => /^[a-f0-9]{24}$/i.test(String(id || ''));

/**
 * Validate a Messenger / Instagram campaign body into the fields to store.
 * body: { name, channel, mode, scheduledAt, audience: { activeDays },
 *         recipients?: [{ phone }] (a subset of that audience),
 *         content: { mode, quickMessageId, utilityTemplateId, utilityParams: { body, buttons },
 *                    text, imageUrl, confirmedNonPromotional } }
 */
export async function buildMetaCampaignFields(business, body, mode) {
  const channel = String(body.channel || '');
  const label = CHANNEL_LABEL[channel];
  const sending = mode !== 'draft';
  const bid = business._id;

  const name = String(body.name || '').trim();
  if (!name) throw new Invalid('Give the campaign a name.');
  if (name.length > 120) throw new Invalid('The campaign name can be at most 120 characters.');

  const conn = await ChannelConnection.findOne({ businessId: bid, channel }).select('status pageId').lean();
  if (sending && conn?.status !== 'connected') {
    throw new Invalid(`${label} isn’t connected. Connect it on Channel Status to send this campaign.`, 409, 'NOT_CONNECTED');
  }

  const raw = body.content && typeof body.content === 'object' ? body.content : {};
  const cmode = MODES[channel].includes(raw.mode) ? raw.mode : '';
  if (!cmode) throw new Invalid(channel === 'messenger' ? 'Choose what to send: a quick message, a utility template, or both.' : 'Choose what to send: a quick message, or text with an optional image.');
  const content = { mode: cmode, quickMessageId: '', quickMessageName: '', utilityTemplateId: '', utilityTemplateName: '', utilityParams: { body: [], buttons: [] }, text: '', imageUrl: '', confirmedNonPromotional: false };

  if (cmode === 'quick' || cmode === 'both') {
    const qm = idOk(raw.quickMessageId) ? await QuickMessage.findOne({ _id: raw.quickMessageId, businessId: bid }).lean() : null;
    if (!qm && (sending || raw.quickMessageId)) throw new Invalid('Choose a quick message.');
    if (qm) {
      if (!(qm.channels || []).includes(channel)) throw new Invalid(`“${qm.name}” isn’t set up for ${label}. Edit it on the Templates page or pick another.`);
      const problems = quickMessageProblems({ ...cleanQuickMessage(qm), kind: qm.kind }, channel);
      if (problems.length) throw new Invalid(`“${qm.name}” can’t be sent on ${label}: ${problems[0].message}`);
      Object.assign(content, { quickMessageId: String(qm._id), quickMessageName: qm.name });
    }
  }
  if (cmode === 'text') {
    const text = String(raw.text ?? '').slice(0, 4000);
    const imageUrl = String(raw.imageUrl || '').trim().slice(0, 2000);
    const pseudo = imageUrl ? { kind: 'image', text, imageUrl, buttons: [], cards: [], quickReplies: [] } : { kind: 'text', text, imageUrl: '', buttons: [], cards: [], quickReplies: [] };
    if (sending || text.trim() || imageUrl) {
      const problems = quickMessageProblems(pseudo, channel);
      if (problems.length) throw new Invalid(problems[0].message);
    }
    Object.assign(content, { text, imageUrl });
  }
  if (cmode === 'utility' || cmode === 'both') {
    const t = idOk(raw.utilityTemplateId) ? await MetaTemplate.findOne({ _id: raw.utilityTemplateId, businessId: bid }).lean() : null;
    if (!t && (sending || raw.utilityTemplateId)) throw new Invalid('Choose an approved utility template.');
    if (t) {
      const p = raw.utilityParams && typeof raw.utilityParams === 'object' ? raw.utilityParams : {};
      const params = {
        body: (Array.isArray(p.body) ? p.body : []).slice(0, 20).map((v) => String(v ?? '').slice(0, 300)),
        buttons: (Array.isArray(p.buttons) ? p.buttons : []).slice(0, 3).map((v) => String(v ?? '').slice(0, 500)),
      };
      if (sending) {
        if (t.status !== 'APPROVED') throw new Invalid(`The template “${t.name}” is ${String(t.status).toLowerCase()} at Meta. Only approved templates can be sent.`);
        if (conn?.pageId && t.pageId !== conn.pageId) throw new Invalid(`“${t.name}” belongs to a Facebook Page that is no longer connected.`);
        // The contact-name values are filled per contact; check the rest with a sample contact.
        const problems = utilityValueProblems(t, utilityValues(t, { name: 'Sample' }, params));
        if (problems.length) throw new Invalid(`Template “${t.name}”: ${problems[0].message}`);
        if (raw.confirmedNonPromotional !== true) {
          throw new Invalid('Confirm that this template is an update or reminder, not marketing: Meta only allows utility messages for non-promotional updates.', 400, 'CONFIRM_REQUIRED');
        }
      }
      Object.assign(content, {
        utilityTemplateId: String(t._id), utilityTemplateName: t.name, utilityParams: params, confirmedNonPromotional: raw.confirmedNonPromotional === true,
      });
    }
  }

  // Audience: the business's chats on this channel, optionally only a subset of them.
  const activeDays = Math.max(0, Math.min(365, Math.floor(Number(body.audience?.activeDays) || 0)));
  const { rows, capped } = await audienceFor(bid, channel, { activeDays });
  if (capped) throw new Invalid(`A campaign can have at most ${MAX_RECIPIENTS.toLocaleString('en-US')} recipients. Narrow the audience (active in the last N days).`);
  let list = rows;
  if (Array.isArray(body.recipients) && body.recipients.length) {
    const want = new Set(body.recipients.map((r) => String(r?.phone ?? r ?? '').replace(/\D/g, '')).filter(Boolean));
    list = rows.filter((r) => want.has(r.phone));
  }
  if (sending && !list.length) {
    throw new Invalid(activeDays
      ? `No ${label} contacts wrote to you in the last ${activeDays} day${activeDays === 1 ? '' : 's'}.`
      : `You have no ${label} contacts yet. Customers appear here once they message your ${channel === 'messenger' ? 'Page' : 'Instagram account'}.`);
  }
  const recipients = list.map((r) => ({
    phone: r.phone, name: String(r.name || (r.handle ? `@${r.handle}` : '')).slice(0, 120), bodyParams: [], state: 'queued', via: '', metaMessageId: '', error: null,
  }));

  return {
    name,
    channel,
    templateName: content.quickMessageName || content.utilityTemplateName || (cmode === 'text' ? 'Text message' : ''),
    language: '',
    type: 'single',
    status: mode === 'draft' ? 'draft' : 'scheduled',
    scheduledAt: scheduleOf(body, mode),
    ltoCode: '',
    ltoExpiresAt: null,
    recipients,
    total: recipients.length,
    error: '',
    content,
    audience: { activeDays },
  };
}

// --------------------------------------------------------------- send --

/** Meta's error from a channel send, in the campaign's { code, title, message, details } shape. */
export function channelSendError(err) {
  if (err instanceof ChannelError) {
    return {
      code: err.meta?.code ?? null,
      title: '',
      message: err.meta?.message ? `${err.meta.message}` : err.message,
      details: err.meta?.subcode ? `subcode ${err.meta.subcode}` : '',
    };
  }
  const e = err?.response?.data?.error;
  if (e) return { code: e.code ?? null, title: String(e.error_user_title || ''), message: String(e.error_user_msg || e.message || 'Meta refused the message'), details: '' };
  return { code: null, title: '', message: String(err?.message || 'The message could not be sent'), details: '' };
}

const isRateLimited = (err) => RATE_LIMIT_CODES.has(Number(err?.meta?.code)) || err?.code === 'META_UNREACHABLE';
/** Errors after which no later recipient can be sent either. */
const STOP_CODES = new Set(['CHANNEL_TOKEN_INVALID', 'CHANNEL_DISCONNECTED', 'CHANNEL_NOT_CONNECTED']);

function stopReason(err, channel) {
  const label = CHANNEL_LABEL[channel];
  if (err.code === 'CHANNEL_TOKEN_INVALID') {
    return `Meta removed the CRM's access to ${label}${err.meta?.code ? ` (error ${err.meta.code})` : ''}. `
      + 'Reconnect it on Channel Status. The campaign was stopped; the contacts not reached yet were not sent.';
  }
  return `${label} was disconnected, so the campaign was stopped. Reconnect it on Channel Status.`;
}

function failQueued(recipients, error) {
  for (const r of recipients) if (r.state === 'queued') Object.assign(r, { state: 'failed', error });
}

/**
 * Send a Messenger / Instagram campaign the runner holds the lease for.
 * `save()` writes the recipients and renews the lease (setting the run's
 * lost flag when someone else has it); `isLost()` reads that flag.
 * Returns { stopError, cancelled, lost }.
 */
export async function runMetaRecipients(c, recipients, { id, lease, save, isLost }) {
  const out = { stopError: '', cancelled: false, lost: false };
  const channel = c.channel;
  const label = CHANNEL_LABEL[channel];
  const stop = (message) => {
    out.stopError = message;
    failQueued(recipients, { code: null, title: '', message, details: '' });
    return out;
  };
  const content = c.content || {};
  const biz = await Business.findById(c.businessId).lean();
  if (!biz || !biz.active) return stop('The business is inactive, so the campaign was not sent.');
  const conn = await ChannelConnection.findOne({ businessId: String(c.businessId), channel }).lean();
  if (!conn || conn.status !== 'connected') return stop(`${label} isn’t connected. Reconnect it on Channel Status to send campaigns.`);

  let qm = null;
  if (content.mode === 'quick' || content.mode === 'both') {
    qm = await QuickMessage.findOne({ _id: content.quickMessageId, businessId: String(c.businessId) }).lean();
    if (!qm) return stop(`The quick message “${content.quickMessageName || ''}” no longer exists.`);
  } else if (content.mode === 'text') {
    qm = content.imageUrl
      ? { name: 'Text message', channels: [channel], kind: 'image', text: content.text || '', imageUrl: content.imageUrl }
      : { name: 'Text message', channels: [channel], kind: 'text', text: content.text || '' };
  }
  let tpl = null;
  if (content.mode === 'utility' || content.mode === 'both') {
    tpl = await MetaTemplate.findOne({ _id: content.utilityTemplateId, businessId: String(c.businessId) }).lean();
    if (!tpl) return stop(`The utility template “${content.utilityTemplateName || ''}” no longer exists.`);
    if (tpl.status !== 'APPROVED') return stop(`The template “${tpl.name}” is ${String(tpl.status).toLowerCase()} at Meta. Only approved templates can be sent.`);
    if (tpl.pageId !== conn.pageId) return stop(`The template “${tpl.name}” belongs to a Facebook Page that is no longer connected.`);
  }

  // Resumed run: whoever already has a Message from this campaign was sent.
  const prior = await Message.find({ businessId: String(c.businessId), campaignId: id, direction: 'out' }).select('phone metaMessageId').lean();
  const sentTo = new Map(prior.map((m) => [m.phone, m.metaMessageId || '']));
  for (const r of recipients) {
    if (r.state === 'queued' && sentTo.has(r.phone)) Object.assign(r, { state: 'sent', metaMessageId: sentTo.get(r.phone) });
  }

  let sinceFlush = 0;
  let flushedAt = Date.now();
  for (let i = 0; i < recipients.length; i += 1) {
    const r = recipients[i];
    if (r.state !== 'queued') continue;
    // eslint-disable-next-line no-await-in-loop
    const now = await Campaign.findOne({ _id: id }).select('status lockedBy').lean();
    if (!now || now.lockedBy !== lease.by) { out.lost = true; break; }
    if (now.status === 'cancelled') { out.cancelled = true; break; }

    // The window is decided now, from the chat as it is at this moment.
    // eslint-disable-next-line no-await-in-loop
    const convo = await Conversation.findOne({ businessId: String(c.businessId), phone: r.phone }).lean();
    let via = '';
    if (!convo || convo.channel !== channel || convo.hiddenAt) {
      Object.assign(r, { state: 'failed', error: { code: null, title: '', message: 'This contact is no longer in your chats.', details: '' } });
    } else if (convo.blocked) {
      Object.assign(r, { state: 'skipped', error: { code: null, title: '', message: 'You blocked this contact.', details: '' } });
    } else {
      const open = windowIsOpen(convo);
      if (content.mode === 'utility') via = 'utility';
      else if (content.mode === 'both') via = open ? 'quick' : 'utility';
      else via = open ? 'quick' : '';
      if (!via) Object.assign(r, { state: 'skipped', error: { code: null, title: '', message: OUTSIDE_WINDOW, details: '' } });
    }

    let stopNow = false;
    for (let attempt = 0; via; attempt += 1) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const res = via === 'quick'
          ? await sendQuickMessage(biz, convo, qm, { messagingType: 'UPDATE', campaignId: id })
          : await sendUtilityTemplate(biz, convo, tpl, content.utilityParams || {}, { campaignId: id });
        Object.assign(r, { state: 'sent', via, metaMessageId: res?.messageId || '', error: null });
        break;
      } catch (err) {
        if (isRateLimited(err) && attempt < MAX_RETRIES) {
          logger.warn('campaign send rate limited by Meta, backing off', { campaignId: id, channel, attempt: attempt + 1, metaCode: err.meta?.code ?? null });
          // eslint-disable-next-line no-await-in-loop
          await sleep(backoffMs(attempt));
          continue;
        }
        if (err?.code === 'CHANNEL_WINDOW_CLOSED') {
          // Meta (or the chat) says the window closed meanwhile.
          if (via === 'quick' && tpl) { via = 'utility'; attempt = -1; continue; }
          Object.assign(r, { state: 'skipped', via: '', error: { code: err.meta?.code ?? null, title: '', message: OUTSIDE_WINDOW, details: '' } });
          break;
        }
        const error = channelSendError(err);
        Object.assign(r, { state: 'failed', via, error });
        if (STOP_CODES.has(err?.code)) {
          out.stopError = stopReason(err, channel);
          failQueued(recipients, { ...error, message: out.stopError });
          stopNow = true;
        }
        break;
      }
    }
    if (stopNow) break;

    sinceFlush += 1;
    if (sinceFlush >= FLUSH_EVERY || Date.now() - flushedAt >= FLUSH_MS) {
      // eslint-disable-next-line no-await-in-loop
      await save();
      if (isLost()) { out.lost = true; break; }
      sinceFlush = 0;
      flushedAt = Date.now();
    }
    // eslint-disable-next-line no-await-in-loop
    if (via) await sleep(spacingMs());
  }
  return out;
}

export default {
  META_CAMPAIGN_CHANNELS, OUTSIDE_WINDOW, CampaignInputError, audienceFor, windowCounts, audiencePreview,
  buildMetaCampaignFields, runMetaRecipients, channelSendError,
};
