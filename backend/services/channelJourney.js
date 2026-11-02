// Journeys on Instagram and Messenger chats: the same node graph the
// Automation builder saves, run against an inbound Instagram / Messenger
// message with Meta's Send API (services/metaChannels.js sendChannelMessage):
//
//   message   text, or a photo / video / audio / file (+ its text after it,
//             attachments carry no caption on these channels)
//   reply     a button template: text + up to 3 postback buttons, each branching
//   quick     text + up to 13 quick replies (chips), each branching
//   cta       a button template with one link button
//   call      Messenger only: a button template with a phone_number button
//   carousel  a generic template: 1 card, or up to 10 cards side by side; a card
//             button with a link opens it, one without branches
//   end
//
// Branching works like WhatsApp journeys: a postback / quick-reply payload is
// `n:<nodeId>:btn:<i>`, `n:<nodeId>:opt:<i>` or `n:<nodeId>:card:<c>:<b>`, and
// maps straight back to the source node's port (btn-i / opt-i / card-c-b).
// Replies go out inside the 24-hour window only (a journey answers a message
// the customer just sent). A chat set to Manual (botPaused) is left alone.
import Business from '../models/Business.js';
import Conversation from '../models/Conversation.js';
import { fillTokens } from './tokens.js';
import { sendChannelMessage, CHANNEL_LABEL } from './metaChannels.js';
import { pickJourney, startNode, edgeTarget } from './journeyRuntime.js';
import logger from './logger.js';

export const JOURNEY_CHANNELS = ['whatsapp', 'instagram', 'messenger'];
/** 'instagram' | 'messenger', or '' for WhatsApp (how the row stores it). */
export const journeyChannel = (v) => (v === 'instagram' || v === 'messenger' ? v : '');

// Meta's Send API limits (Messenger Platform / Instagram Messaging docs).
export const CHANNEL_LIMITS = {
  messenger: { text: 2000, templateText: 640, buttons: 3, buttonTitle: 20, quickReplies: 13, quickReplyTitle: 20, cards: 10, cardTitle: 80, cardSubtitle: 80 },
  instagram: { text: 1000, templateText: 640, buttons: 3, buttonTitle: 20, quickReplies: 13, quickReplyTitle: 20, cards: 10, cardTitle: 80, cardSubtitle: 80 },
};
const KINDS = {
  messenger: ['start', 'message', 'reply', 'quick', 'cta', 'call', 'carousel', 'restart', 'end'],
  instagram: ['start', 'message', 'reply', 'quick', 'cta', 'carousel', 'restart', 'end'],
};
const MEDIA = ['image', 'video', 'audio', 'pdf'];
const isHttps = (u) => /^https:\/\/[^\s]+$/i.test(String(u || '').trim());
const len = (channel, s) => (channel === 'instagram' ? Buffer.byteLength(String(s || ''), 'utf8') : String(s || '').length);

/**
 * What would stop this journey on Instagram / Messenger ([] = fine, and always
 * [] for WhatsApp). Each problem names the block: { nodeId, field, message }.
 */
export function channelJourneyProblems(channel, nodes = []) {
  const ch = journeyChannel(channel);
  if (!ch) return [];
  const L = CHANNEL_LIMITS[ch];
  const label = CHANNEL_LABEL[ch];
  const out = [];
  const add = (n, field, message) => out.push({ nodeId: String(n?.id || ''), field, message });
  for (const n of Array.isArray(nodes) ? nodes : []) {
    const d = n?.data || {};
    const kind = d.kind;
    if (!KINDS[ch].includes(kind)) {
      add(n, 'kind', `The “${kind}” block isn’t available on ${label}. Remove it.`);
      continue;
    }
    const text = String(d.text || '');
    const unit = ch === 'instagram' ? 'bytes' : 'characters';
    if (['message', 'quick'].includes(kind) && len(ch, text) > L.text) add(n, 'text', `A ${label} message can be at most ${L.text} ${unit}.`);
    if (['reply', 'cta', 'call'].includes(kind) && text.length > L.templateText) add(n, 'text', `Text with buttons can be at most ${L.templateText} characters.`);
    if (['reply', 'cta', 'call', 'quick'].includes(kind) && !text.trim()) add(n, 'text', 'Write the message text for the buttons.');
    if (kind === 'message' && !text.trim() && !(d.header && d.header !== 'none' && d.headerMediaUrl)) add(n, 'text', 'Write the message, or add a photo, video, audio or file.');
    if (d.header && d.header !== 'none') {
      if (!MEDIA.includes(d.header)) add(n, 'header', 'Unknown media type.');
      else if (!isHttps(d.headerMediaUrl)) add(n, 'header', `Upload the ${d.header === 'pdf' ? 'file' : d.header} for this block.`);
    }
    if (kind === 'reply') {
      const b = d.buttons || [];
      if (!b.length || b.length > L.buttons) add(n, 'buttons', `Use 1 to ${L.buttons} buttons.`);
      b.forEach((t, i) => {
        if (!String(t || '').trim()) add(n, `buttons.${i}`, `Button ${i + 1} needs a title.`);
        else if (String(t).length > L.buttonTitle) add(n, `buttons.${i}`, `Button titles can be at most ${L.buttonTitle} characters (“${t}”).`);
      });
    }
    if (kind === 'quick') {
      const o = d.options || [];
      if (!o.length || o.length > L.quickReplies) add(n, 'options', `Use 1 to ${L.quickReplies} quick replies.`);
      o.forEach((t, i) => {
        if (!String(t || '').trim()) add(n, `options.${i}`, `Quick reply ${i + 1} needs a title.`);
        else if (String(t).length > L.quickReplyTitle) add(n, `options.${i}`, `Quick replies can be at most ${L.quickReplyTitle} characters (“${t}”).`);
      });
    }
    if (kind === 'cta') {
      if (!String(d.ctaText || '').trim() || String(d.ctaText).length > L.buttonTitle) add(n, 'ctaText', `Give the link button a title of up to ${L.buttonTitle} characters.`);
      if (!isHttps(d.ctaUrl)) add(n, 'ctaUrl', 'The link must start with https://.');
    }
    if (kind === 'call') {
      if (!String(d.callText || '').trim() || String(d.callText).length > L.buttonTitle) add(n, 'callText', `Give the call button a title of up to ${L.buttonTitle} characters.`);
      if (!/^\+\d{6,15}$/.test(String(d.callPhone || '').replace(/[\s()-]/g, ''))) add(n, 'callPhone', 'Write the phone number with the country code, e.g. +91 98765 43210.');
    }
    if (kind === 'carousel') {
      const cards = d.cards || [];
      if (!cards.length || cards.length > L.cards) add(n, 'cards', `Use 1 to ${L.cards} cards.`);
      cards.forEach((c, i) => {
        const at = `Card ${i + 1}`;
        if (!String(c?.title || '').trim()) add(n, `cards.${i}.title`, `${at} needs a title.`);
        else if (String(c.title).length > L.cardTitle) add(n, `cards.${i}.title`, `${at}: the title can be at most ${L.cardTitle} characters.`);
        if (String(c?.subtitle || '').length > L.cardSubtitle) add(n, `cards.${i}.subtitle`, `${at}: the text can be at most ${L.cardSubtitle} characters.`);
        if (c?.imageUrl && !isHttps(c.imageUrl)) add(n, `cards.${i}.imageUrl`, `${at}: upload the image again.`);
        const btns = c?.buttons || [];
        if (btns.length > L.buttons) add(n, `cards.${i}.buttons`, `${at}: at most ${L.buttons} buttons.`);
        btns.forEach((b, j) => {
          if (!String(b?.title || '').trim()) add(n, `cards.${i}.buttons.${j}`, `${at}, button ${j + 1} needs a title.`);
          else if (String(b.title).length > L.buttonTitle) add(n, `cards.${i}.buttons.${j}`, `${at}: button titles can be at most ${L.buttonTitle} characters.`);
          if (b?.url && !isHttps(b.url)) add(n, `cards.${i}.buttons.${j}`, `${at}, button ${j + 1}: the link must start with https://.`);
        });
      });
    }
  }
  return out;
}

// ------------------------------------------------------------- sending --

const base = () => ({
  type: 'text', body: '', headerImageUrl: '', headerText: '', headerDocName: '', headerDocUrl: '', footer: '',
  buttons: [], cta: null, flowCta: '', mediaUrl: '', mediaType: '', filename: '',
});
const ATTACH = { image: 'image', video: 'video', audio: 'audio', pdf: 'file' };
const MEDIA_KIND = { image: 'image', video: 'video', audio: 'audio', pdf: 'document' };
const MEDIA_LABEL = { image: '📷 Photo', video: '🎥 Video', audio: '🎵 Audio', document: '📄 Document' };

/** The Send API messages for one block (in order), and whether it waits for a tap. */
export function channelNodeSends(channel, node, tokens = {}) {
  const d = node?.data || {};
  const id = String(node?.id || '');
  const text = fillTokens(String(d.text || ''), tokens).trim();
  const out = [];
  const media = d.header && d.header !== 'none' && d.headerMediaUrl ? d.header : '';
  if (media && ['message', 'reply', 'cta', 'call'].includes(d.kind)) {
    const kind = MEDIA_KIND[media] || 'document';
    out.push({
      message: { attachment: { type: ATTACH[media] || 'file', payload: { url: d.headerMediaUrl, ...(channel === 'messenger' ? { is_reusable: true } : {}) } } },
      d: { ...base(), type: kind, body: MEDIA_LABEL[kind], mediaType: kind, mediaUrl: d.headerMediaUrl, filename: kind === 'document' ? d.headerFileName || 'Document' : '' },
    });
  }
  const buttonTemplate = (buttons, chat) => ({
    message: { attachment: { type: 'template', payload: { template_type: 'button', text: text || ' ', buttons } } },
    d: { ...base(), type: 'interactive', body: text, buttons: chat },
  });
  switch (d.kind) {
    case 'message':
      if (text) out.push({ message: { text }, d: { ...base(), body: text } });
      return { sends: out, wait: false };
    case 'reply': {
      const titles = (d.buttons || []).map((t) => fillTokens(String(t || ''), tokens).slice(0, 20));
      out.push(buttonTemplate(
        titles.map((title, i) => ({ type: 'postback', title, payload: `n:${id}:btn:${i}` })),
        titles.map((t) => ({ text: t, kind: 'reply' })),
      ));
      return { sends: out, wait: true };
    }
    case 'quick': {
      const titles = (d.options || []).map((t) => fillTokens(String(t || ''), tokens).slice(0, 20));
      out.push({
        message: { text: text || ' ', quick_replies: titles.map((title, i) => ({ content_type: 'text', title, payload: `n:${id}:opt:${i}` })) },
        d: { ...base(), type: 'interactive', body: text, buttons: titles.map((t) => ({ text: t, kind: 'reply' })) },
      });
      return { sends: out, wait: true };
    }
    case 'cta':
      out.push(buttonTemplate(
        [{ type: 'web_url', url: String(d.ctaUrl || '').trim(), title: String(d.ctaText || 'Open').slice(0, 20) }],
        [{ text: d.ctaText || 'Open', kind: 'cta', url: d.ctaUrl }],
      ));
      return { sends: out, wait: false };
    case 'call': {
      const phone = String(d.callPhone || '').replace(/[\s()-]/g, '');
      out.push(buttonTemplate(
        [{ type: 'phone_number', title: String(d.callText || 'Call us').slice(0, 20), payload: phone }],
        [{ text: d.callText || 'Call us', kind: 'cta', url: `tel:${phone}` }],
      ));
      return { sends: out, wait: false };
    }
    case 'carousel': {
      const cards = (d.cards || []).slice(0, 10);
      let branches = false;
      const elements = cards.map((c, ci) => {
        const buttons = (c.buttons || []).slice(0, 3).map((b, bi) => {
          const title = fillTokens(String(b.title || ''), tokens).slice(0, 20);
          if (b.url) return { type: 'web_url', url: String(b.url).trim(), title };
          branches = true;
          return { type: 'postback', title, payload: `n:${id}:card:${ci}:${bi}` };
        });
        return {
          title: fillTokens(String(c.title || ''), tokens).slice(0, 80) || ' ',
          ...(c.subtitle ? { subtitle: fillTokens(String(c.subtitle), tokens).slice(0, 80) } : {}),
          ...(c.imageUrl ? { image_url: c.imageUrl } : {}),
          ...(buttons.length ? { buttons } : {}),
        };
      });
      if (text) out.push({ message: { text }, d: { ...base(), body: text } });
      const chatButtons = (c) => (c.buttons || []).map((b) => ({ text: b.title, kind: b.url ? 'cta' : 'reply', ...(b.url ? { url: b.url } : {}) }));
      out.push({
        message: { attachment: { type: 'template', payload: { template_type: 'generic', elements } } },
        d: cards.length === 1
          ? { ...base(), type: 'interactive', headerImageUrl: cards[0].imageUrl || '', headerText: cards[0].title || '', body: cards[0].subtitle || '', buttons: chatButtons(cards[0]) }
          : { ...base(), type: 'interactive', body: `🗂 ${cards.length} cards: ${cards.map((c) => c.title).join(' · ')}` },
        ...(cards.length > 1 ? {
          extra: {
            template: {
              cards: cards.map((c) => ({ mediaUrl: c.imageUrl || '', mediaFormat: 'image', body: [c.title, c.subtitle].filter(Boolean).join('\n'), buttons: chatButtons(c) })),
            },
          },
        } : {}),
      });
      return { sends: out, wait: branches };
    }
    default:
      return { sends: out, wait: false };
  }
}

async function setState(businessId, phone, journeyState) {
  await Conversation.updateOne(
    { phone, businessId },
    { $set: { step: 'journey', 'context.journey': journeyState } },
  );
}

async function tokensFor(businessId, convo) {
  let businessName = '';
  try {
    const b = await Business.findById(businessId).select('name').lean();
    businessName = b?.name || '';
  } catch { /* optional */ }
  const name = String(convo?.name || '').trim();
  return {
    name,
    customer_name: name,
    business_name: businessName,
    customer_phone: '',
    today: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'numeric', year: 'numeric' }),
  };
}

/** Send `node` and the plain blocks after it, stopping at one that waits for a tap. */
async function sendChain(business, channel, convo, journey, node, tokens) {
  const businessId = String(business._id);
  let current = node;
  const sent = new Set();
  for (let guard = 0; current && guard < 20; guard += 1) {
    // "Start again": back to the block after Start, unless that block already
    // went out for this message (a loop with no question in between).
    if (current.data?.kind === 'restart') {
      const start = startNode(journey);
      const first = start ? edgeTarget(journey, start.id, null) : null;
      if (!first || first.data?.kind === 'restart' || sent.has(first.id)) {
        // eslint-disable-next-line no-await-in-loop
        await setState(businessId, convo.phone, { nodeId: null, done: true });
        return;
      }
      current = first;
      continue;
    }
    sent.add(current.id);
    const { sends, wait } = channelNodeSends(channel, current, tokens);
    for (const s of sends) {
      // eslint-disable-next-line no-await-in-loop
      await sendChannelMessage(business, channel, convo, convo.phone, s.message, s.d, { extra: { ...(s.extra || {}), journey: String(journey._id) } });
    }
    if (wait) {
      // eslint-disable-next-line no-await-in-loop
      await setState(businessId, convo.phone, { nodeId: current.id });
      return;
    }
    const next = edgeTarget(journey, current.id, null);
    if (!next || current.data?.kind === 'end') {
      // eslint-disable-next-line no-await-in-loop
      await setState(businessId, convo.phone, { nodeId: null, done: true });
      return;
    }
    current = next;
  }
}

const PAYLOAD = /^n:([^:]+):(?:(btn|opt):(\d+)|card:(\d+):(\d+))$/;

/**
 * Run the channel's journey for one inbound Instagram / Messenger event.
 * `payload` is the postback / quick-reply payload, if the customer tapped one.
 * Returns true when the journey sent something. Never throws.
 */
export async function runChannelJourney(business, channel, psid, { payload = '' } = {}) {
  try {
    const businessId = String(business?._id || '');
    if (!businessId || !journeyChannel(channel)) return false;
    const convo = await Conversation.findOne({ businessId, phone: psid }).lean();
    if (!convo || convo.botPaused) return false;
    const journey = await pickJourney(businessId, channel);
    if (!journey || !(journey.nodes || []).length) return false;
    const tokens = await tokensFor(businessId, convo);

    // A tapped button / quick reply / card button → that port's next block.
    const m = PAYLOAD.exec(String(payload || ''));
    if (m) {
      const [, nodeId, kind, idx, card, btn] = m;
      const handle = card !== undefined ? `card-${card}-${btn}` : kind === 'btn' ? `btn-${idx}` : `opt-${idx}`;
      const edge = (journey.edges || []).find((e) => e.source === nodeId && (e.sourceHandle || '') === handle);
      const next = edge ? (journey.nodes || []).find((n) => n.id === edge.target) : null;
      if (!next) return false;
      await sendChain(business, channel, convo, journey, next, tokens);
      return true;
    }

    // Anything else: start from the top, unless the journey waits for a tap
    // (then a typed message is left for the team).
    if (convo.context?.journey?.nodeId) return false;
    const start = startNode(journey);
    const first = start ? edgeTarget(journey, start.id, null) : null;
    if (!first) return false;
    await sendChain(business, channel, convo, journey, first, tokens);
    return true;
  } catch (err) {
    logger.warn('channel journey run failed', { channel, error: err.message, code: err.code || '' });
    return false;
  }
}

export default { runChannelJourney, channelJourneyProblems, channelNodeSends, journeyChannel };
