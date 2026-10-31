// ---------------------------------------------------------------------------
// Messenger utility templates and Messenger / Instagram quick messages.
//
// Meta's rules this file applies (report: .agents/tasks/meta-templates-campaigns/report.md):
//   • Inside the standard messaging window (24 h after the customer's last
//     message) anything may be sent, promotional content included: text,
//     images, the generic template (cards / carousel), the button template and
//     quick replies. Those are the "quick messages" saved here, no approval.
//   • Outside the window, Messenger allows only utility messages: approved
//     templates for non-marketing updates (orders, accounts, appointments,
//     events), sent with messaging_type UTILITY. The old message tags
//     (ACCOUNT_UPDATE, CONFIRMED_EVENT_UPDATE, POST_PURCHASE_UPDATE) are
//     refused by Meta since 27 April 2026 and are never used here.
//   • Instagram has no approved templates: outside the window nothing is sent
//     automatically. The HUMAN_AGENT tag is never used (it is for a person
//     replying by hand, and needs Meta's Human Agent permission).
//
// Meta endpoints (Page access token, graph.facebook.com):
//   GET    /message_template_library            search Meta's utility templates
//   POST   /<PAGE_ID>/message_templates         create (components) or clone (library_template_name)
//   GET    /<PAGE_ID>/message_templates         the Page's templates (status refresh)
//   DELETE /<PAGE_ID>/message_templates?name=   delete
//   POST   /<PAGE_ID>/messages                  send (template: messaging_type UTILITY)
// Quick messages go through metaChannels.sendChannelMessage: the Page's
// /messages, or graph.instagram.com/<IG_ID>/messages for an Instagram login.
// Status changes arrive on the Page's `message_template_status_update`
// webhook field (metaChannelInbound.js → handleTemplateStatusChange).
// ---------------------------------------------------------------------------
import axios from 'axios';
import ChannelConnection from '../models/ChannelConnection.js';
import MetaTemplate from '../models/MetaTemplate.js';
import QuickMessage from '../models/QuickMessage.js';
import {
  ChannelError, CHANNEL_LABEL, PAGE_FIELDS, withConnectionToken, sendChannelMessage, subscribePage, pageFieldsInUse,
} from './metaChannels.js';
import { notify } from './notifications.js';
import logger from './logger.js';

const version = () => process.env.WA_GRAPH_VERSION || 'v22.0';
const G = () => `https://graph.facebook.com/${version()}`;
const http = axios.create({ timeout: 20000 });
const bearer = (token) => ({ headers: { Authorization: `Bearer ${token}` } });

export const TEMPLATE_STATUS_FIELD = 'message_template_status_update';
// The Messenger webhooks guide also lists the field as
// `messenger_template_status_update`; both names are accepted inbound.
export const TEMPLATE_STATUS_FIELDS = [TEMPLATE_STATUS_FIELD, 'messenger_template_status_update'];

const metaErr = (err) => err?.response?.data?.error || null;
const metaText = (err) => {
  const e = metaErr(err);
  return e?.error_user_msg || e?.message || err?.message || 'Unknown error';
};
const metaInfo = (err) => {
  const e = metaErr(err);
  return e ? { code: e.code, subcode: e.error_subcode, message: e.error_user_msg || e.message || '' } : null;
};

/** A Graph error from template management → a ChannelError the routes answer with. */
function graphFailure(err, what) {
  if (err instanceof ChannelError) return err;
  if (metaErr(err)) {
    return new ChannelError(`Meta refused to ${what}: ${metaText(err)}`, { status: 502, code: 'META_ERROR', meta: metaInfo(err) });
  }
  return new ChannelError(`Could not reach Meta to ${what}: ${err.message}`, { status: 503, code: 'META_UNREACHABLE' });
}

// --------------------------------------------------------------- limits --

// Messenger: Send API, generic / button template and quick reply references.
// Instagram: the same objects in the Instagram Messaging API (both logins).
export const LIMITS = {
  messenger: {
    text: 2000, textUnit: 'characters', buttonText: 640, cards: 10, cardTitle: 80, cardSubtitle: 80,
    buttons: 3, buttonTitle: 20, quickReplies: 13, quickReplyTitle: 20, payload: 1000,
  },
  instagram: {
    text: 1000, textUnit: 'bytes', buttonText: 640, cards: 10, cardTitle: 80, cardSubtitle: 80,
    buttons: 3, buttonTitle: 20, quickReplies: 13, quickReplyTitle: 20, payload: 1000,
  },
};
export const QUICK_KINDS = ['text', 'image', 'cards', 'quick_replies'];
export const META_CHANNELS = ['messenger', 'instagram'];

// Utility templates (Messenger). Meta documents the {{n}} rules and the
// rejection reasons; the length limits follow Meta's template limits
// (name 512, body 1024, button text 25).
export const UTILITY_LIMITS = { name: 512, body: 1024, buttons: 3, buttonText: 25, sample: 200, url: 2000 };
export const UTILITY_LANGUAGES = ['en', 'en_US', 'en_GB', 'hi', 'ta', 'te', 'kn', 'ml', 'mr', 'bn', 'gu', 'pa', 'ur',
  'es', 'es_ES', 'es_MX', 'fr', 'de', 'it', 'pt_BR', 'pt_PT', 'ar', 'id', 'ms', 'th', 'vi', 'tr', 'nl', 'ru', 'ja', 'ko', 'zh_CN'];

const str = (v, max = 5000) => String(v ?? '').slice(0, max);
const trim = (v, max) => str(v, max + 50).trim();
const isHttpUrl = (u) => {
  try {
    const x = new URL(String(u || ''));
    return x.protocol === 'https:' || x.protocol === 'http:';
  } catch {
    return false;
  }
};
const bytes = (s) => Buffer.byteLength(String(s || ''), 'utf8');

class Problems {
  constructor() { this.list = []; }
  add(field, message) { this.list.push({ field, message }); }
  get ok() { return this.list.length === 0; }
}

export class InvalidInput extends ChannelError {
  constructor(problems) {
    super(problems[0]?.message || 'Check the form.', { status: 400, code: 'INVALID_INPUT' });
    this.problems = problems;
  }

  toJSON() {
    return { ...super.toJSON(), problems: this.problems };
  }
}

// ------------------------------------------------------ quick messages --

function cleanButton(b = {}) {
  const type = b.type === 'postback' ? 'postback' : 'url';
  return {
    type,
    title: trim(b.title, 60),
    url: type === 'url' ? trim(b.url, 2100) : '',
    payload: type === 'postback' ? trim(b.payload, 1100) : '',
  };
}

/** The stored shape of a quick message (unknown fields dropped, strings bounded). */
export function cleanQuickMessage(input = {}) {
  const channels = [...new Set((Array.isArray(input.channels) ? input.channels : [input.channels]).map(String))]
    .filter((c) => META_CHANNELS.includes(c));
  return {
    name: trim(input.name, 120),
    channels,
    kind: QUICK_KINDS.includes(input.kind) ? input.kind : '',
    text: str(input.text, 4100),
    imageUrl: trim(input.imageUrl, 2100),
    buttons: (Array.isArray(input.buttons) ? input.buttons : []).slice(0, 10).map(cleanButton),
    cards: (Array.isArray(input.cards) ? input.cards : []).slice(0, 20).map((c = {}) => ({
      imageUrl: trim(c.imageUrl, 2100),
      title: trim(c.title, 200),
      subtitle: trim(c.subtitle, 200),
      buttons: (Array.isArray(c.buttons) ? c.buttons : []).slice(0, 10).map(cleanButton),
    })),
    quickReplies: (Array.isArray(input.quickReplies) ? input.quickReplies : []).slice(0, 30).map((q = {}) => ({
      title: trim(q.title, 60),
      payload: trim(q.payload, 1100),
    })),
  };
}

function checkButtons(p, list, field, L, label) {
  if (list.length > L.buttons) p.add(field, `${label}: at most ${L.buttons} buttons.`);
  list.forEach((b, i) => {
    const f = `${field}.${i}`;
    if (!b.title) p.add(`${f}.title`, `${label}: button ${i + 1} needs a label.`);
    else if (b.title.length > L.buttonTitle) p.add(`${f}.title`, `${label}: button ${i + 1}'s label can be at most ${L.buttonTitle} characters.`);
    if (b.type === 'url' && !isHttpUrl(b.url)) p.add(`${f}.url`, `${label}: button ${i + 1} needs a web address starting with https://.`);
    if (b.type === 'postback' && b.payload.length > L.payload) p.add(`${f}.payload`, `${label}: button ${i + 1}'s reply value can be at most ${L.payload} characters.`);
  });
}

/** Problems with a quick message for one channel ([] = it can be sent there). */
export function quickMessageProblems(qm, channel) {
  const L = LIMITS[channel];
  const p = new Problems();
  const where = CHANNEL_LABEL[channel];
  const textTooLong = (t) => (L.textUnit === 'bytes' ? bytes(t) > L.text : t.length > L.text);
  switch (qm.kind) {
    case 'text':
      if (!qm.text.trim()) p.add('text', 'Write the message.');
      else if (qm.buttons.length) {
        // Button template: text up to 640 characters, 1–3 buttons.
        if (qm.text.length > L.buttonText) p.add('text', `${where}: a message with buttons can be at most ${L.buttonText} characters.`);
      } else if (textTooLong(qm.text)) {
        p.add('text', `${where}: a message can be at most ${L.text.toLocaleString('en-US')} ${L.textUnit}.`);
      }
      checkButtons(p, qm.buttons, 'buttons', L, where);
      break;
    case 'image':
      if (!isHttpUrl(qm.imageUrl)) p.add('imageUrl', 'Upload an image or paste its https:// address.');
      if (qm.text.trim() && textTooLong(qm.text)) p.add('text', `${where}: the caption can be at most ${L.text.toLocaleString('en-US')} ${L.textUnit}.`);
      break;
    case 'cards':
      if (!qm.cards.length) p.add('cards', 'Add at least one card.');
      if (qm.cards.length > L.cards) p.add('cards', `${where}: at most ${L.cards} cards.`);
      qm.cards.forEach((c, i) => {
        const f = `cards.${i}`;
        const label = `Card ${i + 1}`;
        if (!c.title) p.add(`${f}.title`, `${label} needs a title.`);
        else if (c.title.length > L.cardTitle) p.add(`${f}.title`, `${label}: the title can be at most ${L.cardTitle} characters.`);
        if (c.subtitle.length > L.cardSubtitle) p.add(`${f}.subtitle`, `${label}: the subtitle can be at most ${L.cardSubtitle} characters.`);
        if (c.imageUrl && !isHttpUrl(c.imageUrl)) p.add(`${f}.imageUrl`, `${label}: the image needs an https:// address.`);
        // Meta: at least one property besides the title.
        if (c.title && !c.subtitle && !c.imageUrl && !c.buttons.length) p.add(`${f}.subtitle`, `${label}: add a subtitle, an image or a button as well as the title.`);
        checkButtons(p, c.buttons, `${f}.buttons`, L, label);
      });
      break;
    case 'quick_replies':
      if (!qm.text.trim()) p.add('text', 'Write the question the chips answer.');
      else if (textTooLong(qm.text)) p.add('text', `${where}: the message can be at most ${L.text.toLocaleString('en-US')} ${L.textUnit}.`);
      if (!qm.quickReplies.length) p.add('quickReplies', 'Add at least one quick reply.');
      if (qm.quickReplies.length > L.quickReplies) p.add('quickReplies', `${where}: at most ${L.quickReplies} quick replies.`);
      qm.quickReplies.forEach((q, i) => {
        if (!q.title) p.add(`quickReplies.${i}.title`, `Quick reply ${i + 1} needs a label.`);
        else if (q.title.length > L.quickReplyTitle) p.add(`quickReplies.${i}.title`, `Quick reply ${i + 1}: at most ${L.quickReplyTitle} characters.`);
        if (q.payload.length > L.payload) p.add(`quickReplies.${i}.payload`, `Quick reply ${i + 1}: the reply value can be at most ${L.payload} characters.`);
      });
      break;
    default:
      p.add('kind', 'Choose text, image, cards or quick replies.');
  }
  return p.list;
}

/** Validate a quick message for every channel it's for; throws InvalidInput. */
export function validateQuickMessage(input) {
  const qm = cleanQuickMessage(input);
  const p = new Problems();
  if (!qm.name) p.add('name', 'Give the quick message a name.');
  else if (qm.name.length > 80) p.add('name', 'The name can be at most 80 characters.');
  if (!qm.channels.length) p.add('channels', 'Choose Messenger, Instagram or both.');
  const seen = new Set(p.list.map((x) => x.message));
  for (const ch of qm.channels) {
    for (const x of quickMessageProblems(qm, ch)) {
      if (!seen.has(x.message)) {
        seen.add(x.message);
        p.add(x.field, x.message);
      }
    }
  }
  if (!p.ok) throw new InvalidInput(p.list);
  // Unused parts of other kinds aren't stored.
  return {
    ...qm,
    text: ['text', 'image', 'quick_replies'].includes(qm.kind) ? qm.text : '',
    imageUrl: qm.kind === 'image' ? qm.imageUrl : '',
    buttons: qm.kind === 'text' ? qm.buttons : [],
    cards: qm.kind === 'cards' ? qm.cards : [],
    quickReplies: qm.kind === 'quick_replies' ? qm.quickReplies : [],
  };
}

export function presentQuickMessage(q) {
  return {
    _id: String(q._id),
    name: q.name,
    channels: q.channels || [],
    kind: q.kind,
    text: q.text || '',
    imageUrl: q.imageUrl || '',
    buttons: q.buttons || [],
    cards: q.cards || [],
    quickReplies: q.quickReplies || [],
    createdAt: q.createdAt || null,
    updatedAt: q.updatedAt || null,
  };
}

const graphButton = (b) => (b.type === 'url'
  ? { type: 'web_url', url: b.url, title: b.title }
  : { type: 'postback', title: b.title, payload: b.payload || b.title });

/**
 * The Send API `message` objects for a quick message on one channel, each
 * with the descriptor the chat shows for it. An image with a caption is two
 * messages (attachments carry no caption on Messenger / Instagram).
 */
export function quickMessageSends(qm, channel) {
  const base = {
    body: '', headerImageUrl: '', headerText: '', headerDocName: '', headerDocUrl: '', footer: '',
    buttons: [], cta: null, flowCta: '', mediaUrl: '', mediaType: '', filename: '',
  };
  const chatButtons = (list) => list.map((b) => ({ text: b.title, kind: b.type === 'url' ? 'cta' : 'reply', ...(b.type === 'url' ? { url: b.url } : {}) }));
  switch (qm.kind) {
    case 'text':
      if (qm.buttons.length) {
        return [{
          message: { attachment: { type: 'template', payload: { template_type: 'button', text: qm.text, buttons: qm.buttons.map(graphButton) } } },
          d: { ...base, type: 'interactive', body: qm.text, buttons: chatButtons(qm.buttons) },
        }];
      }
      return [{ message: { text: qm.text }, d: { ...base, type: 'text', body: qm.text } }];
    case 'image': {
      const out = [{
        message: { attachment: { type: 'image', payload: { url: qm.imageUrl, ...(channel === 'messenger' ? { is_reusable: true } : {}) } } },
        d: { ...base, type: 'image', body: '📷 Photo', mediaType: 'image', mediaUrl: qm.imageUrl },
      }];
      if (qm.text.trim()) out.push({ message: { text: qm.text }, d: { ...base, type: 'text', body: qm.text } });
      return out;
    }
    case 'cards': {
      const elements = qm.cards.map((c) => ({
        title: c.title,
        ...(c.subtitle ? { subtitle: c.subtitle } : {}),
        ...(c.imageUrl ? { image_url: c.imageUrl } : {}),
        ...(c.buttons.length ? { buttons: c.buttons.map(graphButton) } : {}),
      }));
      const message = { attachment: { type: 'template', payload: { template_type: 'generic', elements } } };
      if (qm.cards.length === 1) {
        const c = qm.cards[0];
        return [{ message, d: { ...base, type: 'interactive', headerImageUrl: c.imageUrl, headerText: c.title, body: c.subtitle, buttons: chatButtons(c.buttons) } }];
      }
      // A carousel: the chat shows the cards under a one-line summary.
      return [{
        message,
        d: { ...base, type: 'interactive', body: `🗂 ${qm.cards.length} cards: ${qm.cards.map((c) => c.title).join(' · ')}` },
        extra: {
          template: {
            cards: qm.cards.map((c) => ({
              mediaUrl: c.imageUrl, mediaFormat: 'image', body: [c.title, c.subtitle].filter(Boolean).join('\n'), buttons: chatButtons(c.buttons),
            })),
          },
        },
      }];
    }
    case 'quick_replies':
      return [{
        message: {
          text: qm.text,
          quick_replies: qm.quickReplies.map((q) => ({ content_type: 'text', title: q.title, payload: q.payload || q.title })),
        },
        d: { ...base, type: 'interactive', body: qm.text, buttons: qm.quickReplies.map((q) => ({ text: q.title, kind: 'reply' })) },
      }];
    default:
      return [];
  }
}

/**
 * Send a quick message in a Messenger / Instagram chat. Refused outside the
 * 24-hour window (CHANNEL_WINDOW_CLOSED). `messagingType`: RESPONSE for an
 * agent's reply, UPDATE for a campaign (proactive, inside the window).
 */
export async function sendQuickMessage(business, convo, qmRow, { messagingType = 'RESPONSE', campaignId = null } = {}) {
  const channel = convo?.channel;
  if (!META_CHANNELS.includes(channel)) throw new ChannelError('Quick messages are for Messenger and Instagram chats.', { status: 409, code: 'CHANNEL_UNSUPPORTED' });
  const qm = cleanQuickMessage(qmRow);
  qm.kind = qmRow.kind;
  if (!(qmRow.channels || []).includes(channel)) {
    throw new ChannelError(`“${qmRow.name}” isn’t set up for ${CHANNEL_LABEL[channel]}.`, { status: 409, code: 'QUICK_MESSAGE_CHANNEL' });
  }
  const problems = quickMessageProblems(qm, channel);
  if (problems.length) throw new InvalidInput(problems);
  let first = null;
  const sends = quickMessageSends(qm, channel);
  for (let i = 0; i < sends.length; i += 1) {
    const s = sends[i];
    try {
      // eslint-disable-next-line no-await-in-loop
      const r = await sendChannelMessage(business, channel, convo, convo.phone, s.message, s.d, {
        messagingType, enforceWindow: true, campaignId, extra: s.extra || {},
      });
      if (!first) first = r;
    } catch (err) {
      // The caption after an image that went out: logged, the image counts.
      if (first) {
        logger.warn('quick message: a follow-up part failed', { channel, code: err.code, error: err.message });
        break;
      }
      throw err;
    }
  }
  return first;
}

// --------------------------------------------------- utility templates --

const PARAM_RE = /\{\{\s*(\d+)\s*\}\}/g;
/** The positional {{n}} numbers in a text, in order of appearance (unique). */
export function paramNumbers(text) {
  const seen = [];
  for (const m of String(text || '').matchAll(PARAM_RE)) {
    const n = Number(m[1]);
    if (!seen.includes(n)) seen.push(n);
  }
  return seen;
}

function cleanUtilityButton(b = {}) {
  const type = String(b.type || '').toUpperCase() === 'PHONE_NUMBER' ? 'PHONE_NUMBER' : 'URL';
  return {
    type,
    text: trim(b.text, 60),
    url: type === 'URL' ? trim(b.url, UTILITY_LIMITS.url + 10) : '',
    urlExample: type === 'URL' ? trim(b.urlExample, UTILITY_LIMITS.url + 10) : '',
    phone: type === 'PHONE_NUMBER' ? trim(b.phone, 30).replace(/[\s()-]/g, '') : '',
  };
}

function cleanVariables(list, count) {
  const byIndex = new Map((Array.isArray(list) ? list : []).map((v) => [Number(v?.index), v]));
  return Array.from({ length: count }, (_, i) => {
    const v = byIndex.get(i + 1) || {};
    return {
      index: i + 1,
      source: v.source === 'contact_name' ? 'contact_name' : 'text',
      fallback: trim(v.fallback, 60),
    };
  });
}

/** Validate a "Create template" form; throws InvalidInput. */
export function validateUtilityTemplate(input = {}) {
  const p = new Problems();
  const name = trim(input.name, UTILITY_LIMITS.name).toLowerCase();
  const language = trim(input.language, 10);
  const bodyText = str(input.bodyText, UTILITY_LIMITS.body + 100).trim();
  const examples = (Array.isArray(input.bodyExamples) ? input.bodyExamples : []).map((s) => trim(s, UTILITY_LIMITS.sample + 10));
  const buttons = (Array.isArray(input.buttons) ? input.buttons : []).slice(0, 10).map(cleanUtilityButton);

  if (!name) p.add('name', 'Give the template a name.');
  else if (!/^[a-z0-9_]+$/.test(name)) p.add('name', 'Use lowercase letters, numbers and underscores only in the name.');
  else if (name.length > UTILITY_LIMITS.name) p.add('name', `The name can be at most ${UTILITY_LIMITS.name} characters.`);
  if (!UTILITY_LANGUAGES.includes(language)) p.add('language', 'Choose a language.');

  if (!bodyText) p.add('bodyText', 'Write the message body.');
  else if (bodyText.length > UTILITY_LIMITS.body) p.add('bodyText', `The body can be at most ${UTILITY_LIMITS.body.toLocaleString('en-US')} characters.`);
  // Meta: positional {{1}}, {{2}}… only, in sequence, not at the very start
  // or end of the message, nothing like {{name}} or {1}.
  const stray = bodyText.replace(PARAM_RE, '').match(/\{\{[^}]*\}\}|\{\{|\}\}/);
  if (stray) p.add('bodyText', `Placeholders look like {{1}}, {{2}} (numbers only): fix “${stray[0]}”.`);
  const nums = paramNumbers(bodyText);
  const sorted = [...nums].sort((a, b) => a - b);
  if (sorted.some((n, i) => n !== i + 1)) p.add('bodyText', 'Number the placeholders in order: {{1}}, {{2}}, {{3}} … with none missing.');
  if (/^\{\{\s*\d+\s*\}\}/.test(bodyText) || /\{\{\s*\d+\s*\}\}[\s.!?]*$/.test(bodyText)) {
    p.add('bodyText', 'The message can’t start or end with a placeholder: add some words before and after it.');
  }
  const count = nums.length ? Math.max(...nums) : 0;
  for (let i = 0; i < count; i += 1) {
    const s = examples[i] || '';
    if (!s) p.add(`bodyExamples.${i}`, `Add a sample value for {{${i + 1}}} (Meta reviews the template with it).`);
    else if (s.length > UTILITY_LIMITS.sample) p.add(`bodyExamples.${i}`, `The sample for {{${i + 1}}} is too long.`);
    else if (/[\n\r]/.test(s)) p.add(`bodyExamples.${i}`, `The sample for {{${i + 1}}} must be on one line.`);
  }

  if (buttons.length > UTILITY_LIMITS.buttons) p.add('buttons', `At most ${UTILITY_LIMITS.buttons} buttons.`);
  buttons.forEach((b, i) => {
    const f = `buttons.${i}`;
    if (!b.text) p.add(`${f}.text`, `Button ${i + 1} needs a label.`);
    else if (b.text.length > UTILITY_LIMITS.buttonText) p.add(`${f}.text`, `Button ${i + 1}: the label can be at most ${UTILITY_LIMITS.buttonText} characters.`);
    if (b.type === 'URL') {
      const params = paramNumbers(b.url);
      const plain = b.url.replace(PARAM_RE, '');
      if (!isHttpUrl(plain)) p.add(`${f}.url`, `Button ${i + 1} needs a web address starting with https://.`);
      if (params.length > 1 || (params.length === 1 && (params[0] !== 1 || !/\{\{\s*1\s*\}\}$/.test(b.url)))) {
        p.add(`${f}.url`, `Button ${i + 1}: a link can have one {{1}}, at the very end.`);
      }
      if (params.length === 1 && !isHttpUrl(b.urlExample)) p.add(`${f}.urlExample`, `Button ${i + 1}: add a full sample link for the {{1}} part.`);
    } else if (!/^\+\d{7,15}$/.test(b.phone)) {
      p.add(`${f}.phone`, `Button ${i + 1}: the phone number needs the country code, like +919876543210.`);
    }
  });
  if (!p.ok) throw new InvalidInput(p.list);
  return {
    name,
    language,
    bodyText,
    bodyExamples: examples.slice(0, count),
    buttons: buttons.map((b) => ({ ...b, urlExample: paramNumbers(b.url).length ? b.urlExample : '' })),
    variables: cleanVariables(input.variables, count),
  };
}

/** POST /<PAGE_ID>/message_templates body for a custom utility template. */
export function utilityCreatePayload(v) {
  const components = [{
    type: 'BODY',
    text: v.bodyText,
    ...(v.bodyExamples.length ? { example: { body_text: [v.bodyExamples] } } : {}),
  }];
  if (v.buttons.length) {
    components.push({
      type: 'BUTTONS',
      buttons: v.buttons.map((b) => (b.type === 'URL'
        ? { type: 'URL', text: b.text, url: b.url, ...(b.urlExample ? { example: { url_suffix_example: b.urlExample } } : {}) }
        : { type: 'PHONE_NUMBER', text: b.text, phone_number: b.phone })),
    });
  }
  return { name: v.name, language: v.language, category: 'UTILITY', components };
}

export function presentTemplate(t, currentPageId = '') {
  const urlParams = (t.buttons || []).filter((b) => b.type === 'URL' && paramNumbers(b.url).length).length;
  return {
    _id: String(t._id),
    channel: t.channel || 'messenger',
    pageId: t.pageId || '',
    onCurrentPage: !!currentPageId && t.pageId === currentPageId,
    name: t.name,
    language: t.language,
    category: t.category || 'UTILITY',
    status: String(t.status || 'PENDING').toUpperCase(),
    rejectedReason: t.rejectedReason || '',
    bodyText: t.bodyText || '',
    bodyExamples: t.bodyExamples || [],
    buttons: t.buttons || [],
    variables: t.variables?.length ? t.variables : cleanVariables([], paramNumbers(t.bodyText).length ? Math.max(...paramNumbers(t.bodyText)) : 0),
    paramCount: paramNumbers(t.bodyText).length ? Math.max(...paramNumbers(t.bodyText)) : 0,
    urlParamCount: urlParams,
    libraryTemplateName: t.libraryTemplateName || '',
    origin: t.origin || 'create',
    createdAt: t.createdAt || null,
    updatedAt: t.updatedAt || null,
    statusCheckedAt: t.statusCheckedAt || null,
  };
}

/** The business's Messenger connection, connected; else a CHANNEL_NOT_CONNECTED error. */
export async function messengerConnection(businessId) {
  const row = await ChannelConnection.findOne({ businessId: String(businessId), channel: 'messenger' }).lean();
  if (!row || !row.pageId) {
    throw new ChannelError('Connect your Facebook Page for Messenger on Channel Status to use utility templates.', { status: 409, code: 'CHANNEL_NOT_CONNECTED' });
  }
  if (row.status !== 'connected') {
    throw new ChannelError('Messenger was disconnected at Meta. Reconnect it on Channel Status to use utility templates.', { status: 409, code: 'CHANNEL_DISCONNECTED' });
  }
  return row;
}

/**
 * Best effort: add `message_template_status_update` to the Page's webhook
 * fields (POST /{page-id}/subscribed_apps replaces the list, so the
 * messaging fields, and 'leadgen' when this Page is the lead-forms Page, are
 * sent again). Without it, statuses still come from Refresh.
 */
export async function ensureTemplateWebhook(row) {
  if ((row.subscribedFields || []).includes(TEMPLATE_STATUS_FIELD)) return true;
  const adsOnPage = await ChannelConnection.findOne({
    businessId: row.businessId, channel: 'ads', pageId: row.pageId, status: 'connected', leadgenSubscribed: true,
  }).select('_id').lean();
  // Whatever else the Page's connections rely on ('feed' for Comment auto-DM) is kept.
  const inUse = await pageFieldsInUse(row.pageId, [TEMPLATE_STATUS_FIELD]);
  const fields = [...inUse, ...(adsOnPage ? ['leadgen'] : [])];
  try {
    await withConnectionToken(row, (token) => subscribePage(row.pageId, token, fields));
    const stored = [...new Set([...PAGE_FIELDS, ...(row.subscribedFields || []), TEMPLATE_STATUS_FIELD])];
    await ChannelConnection.updateOne({ _id: row._id }, { $set: { subscribedFields: stored } });
    row.subscribedFields = stored;
    return true;
  } catch (err) {
    logger.warn('could not subscribe the Page to template status webhooks (Refresh still works)', {
      pageId: row.pageId, code: err.code, error: err.meta?.message || metaText(err),
    });
    return false;
  }
}

/** Create a custom utility template on the business's Page. */
export async function createUtilityTemplate(business, input) {
  const v = validateUtilityTemplate(input);
  const row = await messengerConnection(business._id);
  const exists = await MetaTemplate.exists({ businessId: business._id, pageId: row.pageId, name: v.name, language: v.language });
  if (exists) throw new InvalidInput([{ field: 'name', message: `A template named “${v.name}” in this language already exists. Pick another name.` }]);
  const payload = utilityCreatePayload(v);
  let data;
  try {
    data = await withConnectionToken(row, async (token) => (await http.post(`${G()}/${row.pageId}/message_templates`, payload, bearer(token))).data);
  } catch (err) {
    throw graphFailure(err, 'create the template');
  }
  const doc = await MetaTemplate.create({
    businessId: business._id,
    channel: 'messenger',
    pageId: row.pageId,
    metaId: String(data?.id || ''),
    name: v.name,
    language: v.language,
    category: String(data?.category || 'UTILITY').toUpperCase(),
    status: String(data?.status || 'PENDING').toUpperCase(),
    bodyText: v.bodyText,
    bodyExamples: v.bodyExamples,
    buttons: v.buttons,
    variables: v.variables,
    origin: 'create',
    statusCheckedAt: new Date(),
  });
  await ensureTemplateWebhook(row);
  logger.info('Messenger utility template created', { business: business.name, name: v.name, status: doc.status });
  return presentTemplate(doc, row.pageId);
}

const presentLibrary = (t) => ({
  id: String(t.id || ''),
  name: String(t.name || ''),
  language: String(t.language || ''),
  category: String(t.category || 'UTILITY'),
  topic: String(t.topic || ''),
  usecase: String(t.usecase || ''),
  industry: Array.isArray(t.industry) ? t.industry.map(String) : [],
  body: String(t.body || ''),
  bodyParams: Array.isArray(t.body_params) ? t.body_params.map(String) : [],
  bodyParamTypes: Array.isArray(t.body_param_types) ? t.body_param_types.map(String) : [],
  buttons: (Array.isArray(t.buttons) ? t.buttons : []).map((b) => ({
    type: String(b.type || '').toUpperCase(),
    text: String(b.text || ''),
    url: String(b.url || ''),
    phone: String(b.phone_number || ''),
  })),
});

/** Search Meta's utility template library (GET /message_template_library). */
export async function searchLibrary(business, { q = '', language = '' } = {}) {
  const row = await messengerConnection(business._id);
  const params = { limit: 50 };
  const query = trim(q, 100);
  if (query) params.name_or_content = query;
  if (language && UTILITY_LANGUAGES.includes(language)) params.language = language;
  try {
    const data = await withConnectionToken(row, async (token) => (await http.get(`${G()}/message_template_library`, { params, ...bearer(token) })).data);
    return (data?.data || []).map(presentLibrary);
  } catch (err) {
    throw graphFailure(err, 'search the template library');
  }
}

/**
 * Clone one of Meta's library templates to the Page (POST
 * /<PAGE_ID>/message_templates with library_template_name). A library URL
 * button needs the business's own address (base_url) and a phone button its
 * number; both are filled in by the business.
 */
export async function cloneLibraryTemplate(business, input = {}) {
  const p = new Problems();
  const libraryName = trim(input.libraryTemplateName, 200);
  const name = trim(input.name, UTILITY_LIMITS.name).toLowerCase();
  const language = trim(input.language, 10);
  if (!libraryName) p.add('libraryTemplateName', 'Pick a template from the library.');
  if (!name) p.add('name', 'Give your copy a name.');
  else if (!/^[a-z0-9_]+$/.test(name)) p.add('name', 'Use lowercase letters, numbers and underscores only in the name.');
  if (!UTILITY_LANGUAGES.includes(language)) p.add('language', 'Choose a language.');
  const libButtons = (Array.isArray(input.libraryButtons) ? input.libraryButtons : []).slice(0, 3).map((b) => ({
    type: String(b?.type || '').toUpperCase() === 'PHONE_NUMBER' ? 'PHONE_NUMBER' : 'URL',
    text: trim(b?.text, 60),
  }));
  const inputs = (Array.isArray(input.buttonInputs) ? input.buttonInputs : []).slice(0, 3);
  const buttonInputs = libButtons.map((b, i) => {
    const v = inputs[i] || {};
    if (b.type === 'URL') {
      const url = trim(v.url, UTILITY_LIMITS.url);
      if (!isHttpUrl(url)) p.add(`buttonInputs.${i}.url`, `“${b.text || `Button ${i + 1}`}” needs your web address (https://…).`);
      return { type: 'URL', url: { base_url: url } };
    }
    const phone = trim(v.phone, 30).replace(/[\s()-]/g, '');
    if (!/^\+\d{7,15}$/.test(phone)) p.add(`buttonInputs.${i}.phone`, `“${b.text || `Button ${i + 1}`}” needs your phone number with the country code.`);
    return { type: 'PHONE_NUMBER', phone_number: phone };
  });
  if (!p.ok) throw new InvalidInput(p.list);
  const row = await messengerConnection(business._id);
  if (await MetaTemplate.exists({ businessId: business._id, pageId: row.pageId, name, language })) {
    throw new InvalidInput([{ field: 'name', message: `A template named “${name}” in this language already exists. Pick another name.` }]);
  }
  const payload = {
    name,
    category: 'UTILITY',
    language,
    library_template_name: libraryName,
    ...(buttonInputs.length ? { library_template_button_inputs: buttonInputs } : {}),
  };
  let data;
  try {
    data = await withConnectionToken(row, async (token) => (await http.post(`${G()}/${row.pageId}/message_templates`, payload, bearer(token))).data);
  } catch (err) {
    throw graphFailure(err, 'copy the library template');
  }
  const body = str(input.libraryBody, UTILITY_LIMITS.body + 100);
  const count = paramNumbers(body).length ? Math.max(...paramNumbers(body)) : 0;
  const examples = (Array.isArray(input.libraryBodyParams) ? input.libraryBodyParams : []).map((s) => trim(s, UTILITY_LIMITS.sample));
  const doc = await MetaTemplate.create({
    businessId: business._id,
    channel: 'messenger',
    pageId: row.pageId,
    metaId: String(data?.id || ''),
    name,
    language,
    category: String(data?.category || 'UTILITY').toUpperCase(),
    status: String(data?.status || 'PENDING').toUpperCase(),
    bodyText: body,
    bodyExamples: examples.slice(0, count),
    buttons: libButtons.map((b, i) => (b.type === 'URL'
      ? { type: 'URL', text: b.text, url: buttonInputs[i].url.base_url, urlExample: '', phone: '' }
      : { type: 'PHONE_NUMBER', text: b.text, url: '', urlExample: '', phone: buttonInputs[i].phone_number })),
    variables: cleanVariables(input.variables, count),
    libraryTemplateName: libraryName,
    origin: 'clone',
    statusCheckedAt: new Date(),
  });
  await ensureTemplateWebhook(row);
  logger.info('Messenger utility template cloned from the library', { business: business.name, name, library: libraryName });
  return presentTemplate(doc, row.pageId);
}

export async function listUtilityTemplates(businessId) {
  const conn = await ChannelConnection.findOne({ businessId: String(businessId), channel: 'messenger' }).select('pageId status').lean();
  const rows = await MetaTemplate.find({ businessId: String(businessId) }).sort({ updatedAt: -1 }).limit(500).lean();
  return { pageId: conn?.pageId || '', rows: rows.map((t) => presentTemplate(t, conn?.status === 'connected' ? conn.pageId : '')) };
}

/** Map a Meta status/event word onto the statuses the page shows. */
function statusFrom(word) {
  const s = String(word || '').toUpperCase();
  if (s === 'REINSTATED') return 'APPROVED';
  if (s === 'PENDING_DELETION') return 'DELETED';
  return s || 'PENDING';
}

/**
 * Re-read the Page's templates from Meta (GET /<PAGE_ID>/message_templates)
 * and update the local status of each. Templates found on the Page that the
 * CRM has no copy of are added (origin 'meta'), so they can be sent too.
 */
export async function refreshUtilityTemplates(business) {
  const row = await messengerConnection(business._id);
  const remote = [];
  try {
    await withConnectionToken(row, async (token) => {
      let url = `${G()}/${row.pageId}/message_templates`;
      let params = { limit: 100 };
      for (let i = 0; i < 5 && url; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        const { data } = await http.get(url, { params, ...bearer(token) });
        remote.push(...(data?.data || []));
        url = data?.paging?.next || '';
        params = undefined;
      }
    });
  } catch (err) {
    throw graphFailure(err, 'read the templates');
  }
  const local = await MetaTemplate.find({ businessId: business._id, pageId: row.pageId }).lean();
  const now = new Date();
  let updated = 0;
  let added = 0;
  for (const r of remote) {
    const name = String(r.name || '');
    const language = String(r.language || '');
    if (!name) continue;
    const mine = local.find((t) => (r.id && t.metaId === String(r.id)) || (t.name === name && t.language === language));
    const status = statusFrom(r.status);
    const reason = String(r.rejected_reason || r.reason || '');
    const body = String(r.body || (r.components || []).find((c) => String(c.type).toUpperCase() === 'BODY')?.text || '');
    if (mine) {
      // eslint-disable-next-line no-await-in-loop
      await MetaTemplate.updateOne({ _id: mine._id, businessId: business._id }, {
        $set: {
          ...(r.status ? { status } : {}),
          rejectedReason: status === 'REJECTED' ? reason || mine.rejectedReason || '' : '',
          ...(r.id && !mine.metaId ? { metaId: String(r.id) } : {}),
          statusCheckedAt: now,
        },
      });
      if (r.status && status !== mine.status) {
        updated += 1;
        // eslint-disable-next-line no-await-in-loop
        await notifyStatus(business._id, mine, status, reason);
      }
    } else {
      const count = paramNumbers(body).length ? Math.max(...paramNumbers(body)) : 0;
      // eslint-disable-next-line no-await-in-loop
      await MetaTemplate.create({
        businessId: business._id,
        channel: 'messenger',
        pageId: row.pageId,
        metaId: String(r.id || ''),
        name,
        language: language || 'en',
        category: String(r.category || 'UTILITY').toUpperCase(),
        status: r.status ? status : 'APPROVED',
        rejectedReason: status === 'REJECTED' ? reason : '',
        bodyText: body,
        bodyExamples: Array.isArray(r.body_params) ? r.body_params.map(String).slice(0, count) : [],
        buttons: presentLibrary(r).buttons.map((b) => ({ type: b.type === 'PHONE_NUMBER' ? 'PHONE_NUMBER' : 'URL', text: b.text, url: b.url, urlExample: '', phone: b.phone })),
        variables: cleanVariables([], count),
        origin: 'meta',
        statusCheckedAt: now,
      }).catch((e) => logger.warn('could not add a Page template', { name, error: e.message }));
      added += 1;
    }
  }
  await MetaTemplate.updateMany({ businessId: business._id, pageId: row.pageId }, { $set: { statusCheckedAt: now } });
  await ensureTemplateWebhook(row);
  return { remote: remote.length, updated, added };
}

/** Delete a template at Meta (by name: every language of it) and here. */
export async function deleteUtilityTemplate(business, id) {
  const t = await MetaTemplate.findOne({ _id: id, businessId: business._id }).lean();
  if (!t) throw new ChannelError('Template not found.', { status: 404, code: 'NOT_FOUND' });
  const conn = await ChannelConnection.findOne({ businessId: business._id, channel: 'messenger' }).lean();
  // On the current, connected Page it is deleted at Meta first; a copy left
  // from a Page that is no longer connected can only be removed here.
  if (conn?.status === 'connected' && conn.pageId === t.pageId) {
    try {
      await withConnectionToken(conn, async (token) => (await http.delete(`${G()}/${t.pageId}/message_templates`, { params: { name: t.name }, ...bearer(token) })).data);
    } catch (err) {
      const e = metaErr(err);
      // Already gone at Meta: remove the local copy too.
      const gone = e && Number(e.code) === 100 && /not exist|not found|no template/i.test(String(e.message || ''));
      if (!gone) throw graphFailure(err, 'delete the template');
    }
  }
  const r = await MetaTemplate.deleteMany({ businessId: business._id, pageId: t.pageId, name: t.name });
  logger.info('Messenger utility template deleted', { business: business.name, name: t.name, rows: r.deletedCount });
  return { deleted: r.deletedCount || 0 };
}

async function notifyStatus(businessId, t, status, reason) {
  if (!['APPROVED', 'REJECTED', 'PAUSED', 'DISABLED'].includes(status)) return;
  const word = { APPROVED: 'approved', REJECTED: 'rejected', PAUSED: 'paused', DISABLED: 'disabled' }[status];
  await notify(businessId, {
    type: 'meta_template_status',
    title: `Messenger template “${t.name}” ${word}`,
    body: status === 'APPROVED'
      ? 'It can now be sent to Messenger customers, also outside the 24-hour window, for order, account, appointment or event updates.'
      : `Meta ${word} it${reason ? `: ${reason.replace(/_/g, ' ').toLowerCase()}` : ''}.`,
    target: { view: 'templates', id: `messenger:${t.name}` },
  }).catch(() => {});
}

/**
 * A `message_template_status_update` change on the Page of `row` (the
 * business's Messenger connection). value: { event, message_template_id,
 * message_template_name, message_template_language, reason }.
 */
export async function handleTemplateStatusChange(row, value = {}) {
  const id = String(value.message_template_id || value.template_id || value.id || '');
  const name = String(value.message_template_name || value.name || '');
  const language = String(value.message_template_language || value.language || '');
  const status = statusFrom(value.event || value.status);
  const reason = String(value.reason || value.rejected_reason || '');
  if (!id && !name) return 0;
  const or = [...(id ? [{ metaId: id }] : []), ...(name ? [language ? { name, language } : { name }] : [])];
  const rows = await MetaTemplate.find({ businessId: row.businessId, pageId: row.pageId, $or: or }).lean();
  for (const t of rows) {
    // eslint-disable-next-line no-await-in-loop
    await MetaTemplate.updateOne({ _id: t._id, businessId: row.businessId }, {
      $set: {
        status,
        rejectedReason: status === 'REJECTED' ? (reason && reason !== 'NONE' ? reason : t.rejectedReason || '') : '',
        statusCheckedAt: new Date(),
      },
    });
    // eslint-disable-next-line no-await-in-loop
    if (status !== t.status) await notifyStatus(row.businessId, t, status, reason && reason !== 'NONE' ? reason : '');
  }
  logger.info('Messenger template status webhook', { pageId: row.pageId, name, status, matched: rows.length });
  return rows.length;
}

// ------------------------------------------------ sending a template --

/**
 * The values for a template's {{n}} and URL-button suffixes for one contact:
 * a 'contact_name' variable takes the chat's name (else its fallback, else
 * "there"); the rest come from `values` (body: [..], buttons: [..]).
 */
export function utilityValues(t, convo, values = {}) {
  const count = paramNumbers(t.bodyText).length ? Math.max(...paramNumbers(t.bodyText)) : 0;
  const vars = t.variables?.length ? t.variables : cleanVariables([], count);
  const given = Array.isArray(values.body) ? values.body : [];
  const body = Array.from({ length: count }, (_, i) => {
    const v = vars.find((x) => Number(x.index) === i + 1) || { source: 'text', fallback: '' };
    const typed = trim(given[i], 300);
    if (typed) return typed;
    if (v.source === 'contact_name') return trim(convo?.name, 100) || v.fallback || 'there';
    return v.fallback || '';
  });
  const urlButtons = (t.buttons || []).filter((b) => b.type === 'URL' && paramNumbers(b.url).length);
  const btnGiven = Array.isArray(values.buttons) ? values.buttons : [];
  const buttons = urlButtons.map((_, i) => trim(btnGiven[i], 500));
  return { body, buttons };
}

/** Problems with the values (empty ones), [] when it can be sent. */
export function utilityValueProblems(t, vals) {
  const out = [];
  vals.body.forEach((v, i) => { if (!v) out.push({ field: `params.body.${i}`, message: `Fill in {{${i + 1}}}.` }); });
  vals.buttons.forEach((v, i) => { if (!v) out.push({ field: `params.buttons.${i}`, message: `Fill in the end of link button ${i + 1}.` }); });
  return out;
}

const renderBody = (text, values) => String(text || '').replace(PARAM_RE, (m, n) => values[Number(n) - 1] ?? m);

/** The Send API message for a utility template (messaging_type UTILITY). */
export function utilitySendMessage(t, vals) {
  const components = [];
  if (vals.body.length) components.push({ type: 'body', parameters: vals.body.map((text) => ({ type: 'text', text })) });
  if (vals.buttons.length) components.push({ type: 'buttons', parameters: vals.buttons.map((url) => ({ type: 'URL', url })) });
  return { template: { name: t.name, language: { code: t.language }, ...(components.length ? { components } : {}) } };
}

/**
 * Send an approved utility template to a Messenger customer: allowed inside
 * and outside the 24-hour window, only for non-promotional updates.
 */
export async function sendUtilityTemplate(business, convo, t, values = {}, { campaignId = null } = {}) {
  if (convo?.channel !== 'messenger') {
    throw new ChannelError('Utility templates can only be sent in Messenger chats (Instagram has no approved templates).', { status: 409, code: 'CHANNEL_UNSUPPORTED' });
  }
  if (String(t.status).toUpperCase() !== 'APPROVED') {
    throw new ChannelError(`“${t.name}” is ${String(t.status || 'pending').toLowerCase()} at Meta. Only approved templates can be sent.`, { status: 409, code: 'TEMPLATE_NOT_APPROVED' });
  }
  const conn = await ChannelConnection.findOne({ businessId: String(business._id), channel: 'messenger' }).select('pageId status').lean();
  if (conn && conn.status === 'connected' && conn.pageId !== t.pageId) {
    throw new ChannelError(`“${t.name}” belongs to a Facebook Page that is no longer connected. Create it again for the current Page.`, { status: 409, code: 'TEMPLATE_OTHER_PAGE' });
  }
  const vals = utilityValues(t, convo, values);
  const problems = utilityValueProblems(t, vals);
  if (problems.length) throw new InvalidInput(problems);
  const urlButtons = (t.buttons || []).filter((b) => b.type === 'URL' && paramNumbers(b.url).length);
  const body = renderBody(t.bodyText, vals.body);
  const d = {
    type: 'utility', body, headerImageUrl: '', headerText: '', headerDocName: '', headerDocUrl: '', footer: '',
    buttons: (t.buttons || []).map((b) => (b.type === 'URL'
      ? { text: b.text, kind: 'cta', url: urlButtons.includes(b) ? b.url.replace(PARAM_RE, vals.buttons[urlButtons.indexOf(b)] || '') : b.url }
      : { text: b.text, kind: 'call', url: b.phone })),
    cta: null, flowCta: '', mediaUrl: '', mediaType: '', filename: '', templateName: t.name,
  };
  // The chat list's last-message line is written by the send's own log.
  return sendChannelMessage(business, 'messenger', convo, convo.phone, utilitySendMessage(t, vals), d, {
    messagingType: 'UTILITY', enforceWindow: false, campaignId, extra: { utilityTemplate: { id: String(t._id), name: t.name, language: t.language } },
  });
}

export default {
  LIMITS, UTILITY_LIMITS, UTILITY_LANGUAGES, QUICK_KINDS, InvalidInput, cleanQuickMessage, validateQuickMessage,
  quickMessageProblems, quickMessageSends, presentQuickMessage, sendQuickMessage, paramNumbers, validateUtilityTemplate,
  utilityCreatePayload, presentTemplate, createUtilityTemplate, searchLibrary, cloneLibraryTemplate, listUtilityTemplates,
  refreshUtilityTemplates, deleteUtilityTemplate, handleTemplateStatusChange, utilityValues, utilityValueProblems,
  utilitySendMessage, sendUtilityTemplate, ensureTemplateWebhook, messengerConnection, TEMPLATE_STATUS_FIELD,
  TEMPLATE_STATUS_FIELDS, QuickMessage,
};
