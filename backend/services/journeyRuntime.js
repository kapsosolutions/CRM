// Journey execution engine. Runs a business's saved journey (node/edge graph)
// against an inbound WhatsApp message:
//   • New conversation → start at the Start node, follow its edge, send the
//     first node (and chain through any plain leaf nodes).
//   • Interactive reply (button / list / shared location) → look up the matching
//     edge and advance to the next node.
// Interactive option ids are encoded as  n:<nodeId>:btn:<i>  /  n:<nodeId>:opt:<i>
// so an inbound reply maps straight back to the source node + handle.
//   • An Extender block sends what is connected to its numbered outputs
//     (ext-0, ext-1, …) one after another, in that order: each output's block
//     and the plain blocks after it, then the next output (walkJourney).
import Journey from '../models/Journey.js';
import Conversation from '../models/Conversation.js';
import Business from '../models/Business.js';
import { fillTokens } from './tokens.js';
import { resolveCustomerName } from './templateVars.js';
import logger from './logger.js';

/**
 * The live values a journey message can use: {{name}} / {{customer_name}}
 * (a name typed into a form wins, else the WhatsApp profile name),
 * {{business_name}}, {{customer_phone}} and {{today}}. Resolved once per run.
 */
async function journeyTokens(businessId, msg) {
  const digits = String(msg?.phone || '').replace(/\D/g, '');
  const name = await resolveCustomerName(digits, businessId, msg?.name).catch(() => '');
  let businessName = '';
  try {
    const b = await Business.findById(businessId).select('name').lean();
    businessName = b?.name || '';
  } catch { /* name is optional */ }
  return {
    name,
    customer_name: name,
    business_name: businessName,
    customer_phone: digits ? `+${digits}` : '',
    today: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'numeric', year: 'numeric' }),
  };
}

const nodeById = (journey, id) => (journey.nodes || []).find((n) => n.id === id);
const edgesFrom = (journey, sourceId) => (journey.edges || []).filter((e) => e.source === sourceId);
const startNode = (journey) => (journey.nodes || []).find((n) => n.data?.kind === 'start');

function edgeTarget(journey, sourceId, handle) {
  const edges = edgesFrom(journey, sourceId);
  const match = handle ? edges.find((e) => (e.sourceHandle || '') === handle) : edges[0];
  const e = match || edges[0];
  return e ? nodeById(journey, e.target) : null;
}

const mediaHeader = (d) => {
  if (!d.headerMediaUrl || !d.header || d.header === 'none') return null;
  if (d.header === 'image') return { type: 'image', link: d.headerMediaUrl };
  if (d.header === 'video') return { type: 'video', link: d.headerMediaUrl };
  if (d.header === 'pdf') return { type: 'document', link: d.headerMediaUrl };
  return null;
};

// ---- WhatsApp carousel (Meta's interactive media carousel, no template) ----
// 2 to 10 cards, each with a photo or video; every card has either one link
// button or the same number (1 or 2) of quick replies, which branch from the
// block's card-<c>-<b> ports like reply buttons.
const WA_CARDS_MIN = 2;
const WA_CARDS_MAX = 10;
const WA_CARD_REPLIES = 2;
const https = (u) => /^https:\/\/\S+$/i.test(String(u || '').trim());

/** 'link' (one link button per card) or 'reply' (quick replies). */
export function waCarouselMode(d) {
  if (d?.waButtons === 'link' || d?.waButtons === 'reply') return d.waButtons;
  return (d?.cards || []).some((c) => (c?.buttons || []).some((b) => b?.url)) ? 'link' : 'reply';
}

/** A card's text: the title in bold, then its line (WhatsApp allows 160 characters). */
export function waCardText(c, tokens = {}) {
  const title = fillTokens(String(c?.title || ''), tokens).trim();
  const sub = fillTokens(String(c?.subtitle || ''), tokens).trim();
  return [title ? `*${title}*` : '', sub].filter(Boolean).join('\n').slice(0, 160);
}

/**
 * What the carousel block sends: { body, cards, chatCards, wait }, or null
 * when WhatsApp would refuse it (fewer than 2 cards, a card without its
 * photo / video, a link that isn't https).
 */
export function waCarousel(node, tokens = {}) {
  const d = node?.data || {};
  const cards = (d.cards || []).slice(0, WA_CARDS_MAX);
  if (cards.length < WA_CARDS_MIN || cards.some((c) => !https(c?.imageUrl))) return null;
  const mode = waCarouselMode(d);
  const replies = Math.min(WA_CARD_REPLIES, Math.max(1, ...cards.map((c) => (c.buttons || []).filter((b) => !b.url).length)));
  const out = [];
  for (const [ci, c] of cards.entries()) {
    const card = { mediaUrl: c.imageUrl, mediaType: c.mediaType === 'video' ? 'video' : 'image', body: waCardText(c, tokens) };
    if (mode === 'link') {
      const b = (c.buttons || []).find((x) => x?.url) || (c.buttons || [])[0] || {};
      if (!https(b.url)) return null;
      card.url = String(b.url).trim();
      card.urlText = fillTokens(String(b.title || 'Open'), tokens).trim().slice(0, 20) || 'Open';
    } else {
      // Same count on every card (Meta's rule); a repeated title gets a number.
      const seen = new Set();
      card.buttons = Array.from({ length: replies }, (_, bi) => {
        let title = fillTokens(String(c.buttons?.[bi]?.title || ''), tokens).trim().slice(0, 20) || (bi ? 'More' : 'Choose');
        if (seen.has(title.toLowerCase())) title = `${title.slice(0, 18)} ${bi + 1}`;
        seen.add(title.toLowerCase());
        return { id: `n:${node.id}:card:${ci}:${bi}`, title };
      });
    }
    out.push(card);
  }
  return {
    body: fillTokens(String(d.text || ''), tokens).trim() || ' ',
    cards: out,
    // The CRM's chat bubble (MessageItem draws raw.template.cards).
    chatCards: out.map((c) => ({
      mediaUrl: c.mediaUrl,
      mediaFormat: c.mediaType,
      body: c.body.replace(/\*/g, ''),
      buttons: c.url ? [{ text: c.urlText, kind: 'cta', url: c.url }] : c.buttons.map((b) => ({ text: b.title, kind: 'reply' })),
    })),
    wait: mode === 'reply',
  };
}

// Send a single node. Returns 'wait' if it expects a reply, else 'continue'.
// `tokens` carries the live values ({{name}} etc.) substituted into any text.
async function sendNode(meta, phone, node, tokens = {}) {
  const d = node.data || {};
  const kind = d.kind;
  const header = mediaHeader(d);
  const body = fillTokens(d.text || '', tokens);

  switch (kind) {
    case 'message': {
      if (header) {
        if (header.type === 'image') await meta.sendImage(phone, header.link, body);
        else if (header.type === 'video') await meta.sendVideo(phone, header.link, body);
        else await meta.sendDocument(phone, header.link, d.headerFileName || 'document.pdf', body);
      } else {
        await meta.sendText(phone, body || ' ');
      }
      return 'continue';
    }
    case 'reply': {
      const buttons = (d.buttons || []).map((t, i) => ({ id: `n:${node.id}:btn:${i}`, title: fillTokens(t, tokens) }));
      await meta.sendButtons(phone, { body: body || ' ', header, buttons });
      return 'wait';
    }
    case 'cta': {
      await meta.sendCtaUrl(phone, { body: body || ' ', displayText: d.ctaText, url: d.ctaUrl || 'https://', header });
      return 'continue';
    }
    case 'call': {
      const digits = (d.callPhone || '').replace(/[^\d+]/g, '');
      const label = d.callText || 'Call us';
      // WhatsApp has no native call button in free-form messages (only in
      // approved templates), so try a tel: CTA and fall back to tap-to-call text.
      try {
        await meta.sendCtaUrl(phone, { body: body || label, displayText: label, url: `tel:${digits}`, header });
      } catch {
        await meta.sendText(phone, `${body ? body + '\n\n' : ''}📞 ${label}: ${digits}`.trim());
      }
      return 'continue';
    }
    case 'list': {
      const rows = (d.options || []).map((t, i) => ({ id: `n:${node.id}:opt:${i}`, title: fillTokens(t, tokens) }));
      await meta.sendList(phone, { body: body || ' ', buttonText: d.listTitle || 'Menu', rows });
      return 'wait';
    }
    case 'location': {
      await meta.sendLocationRequest(phone, body || 'Please share your location.');
      return 'wait';
    }
    case 'carousel': {
      const c = waCarousel(node, tokens);
      if (!c) {
        // WhatsApp would refuse it: the text still goes, so the journey carries on.
        logger.warn('journey carousel not sendable (needs 2+ cards, each with a photo or video)', { node: node.id });
        if (body) await meta.sendText(phone, body);
        return 'continue';
      }
      await meta.sendCarousel(phone, { body: c.body, cards: c.cards }, { template: { cards: c.chatCards } });
      return c.wait ? 'wait' : 'continue';
    }
    case 'template': {
      try {
        if (d.templateName) await meta.sendTemplate(phone, d.templateName, {});
      } catch (err) {
        // The shared test number has no templates: skip the step and carry on
        // with the rest of the journey.
        if (err.code !== 'SANDBOX_UNSUPPORTED') throw err;
        logger.info('journey template step skipped on the shared test number', { template: d.templateName });
      }
      return 'continue';
    }
    default:
      return 'continue';
  }
}

// Blocks one inbound message may send at most (Extender branches included).
export const MAX_JOURNEY_STEPS = 30;
// An Extender has 2 to 10 numbered outputs (as the builder allows).
const EXT_MIN = 2;
const EXT_MAX = 10;
// Extender inside an Extender inside…: deeper than this is cut off.
const EXT_DEPTH = 5;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The pause between an Extender's messages, so they arrive in their order:
 * Meta doesn't promise to deliver messages sent at the same moment in order
 * (a photo can overtake the text before it). JOURNEY_EXTENDER_GAP_MS
 * overrides it (0 in tests).
 */
export function extenderGapMs() {
  const v = Number(process.env.JOURNEY_EXTENDER_GAP_MS);
  return Number.isFinite(v) && v >= 0 ? v : 700;
}

/** The blocks an Extender sends, in its number order (output 1 first), each once. */
export function extenderTargets(journey, node) {
  const slots = Math.min(EXT_MAX, Math.max(EXT_MIN, Math.round(Number(node?.data?.slots) || EXT_MIN)));
  const edges = edgesFrom(journey, node?.id);
  const out = [];
  for (let i = 0; i < slots; i += 1) {
    // Exact port only: edgeTarget would fall back to the Extender's first connection.
    const e = edges.find((x) => (x.sourceHandle || '') === `ext-${i}`);
    const t = e ? nodeById(journey, e.target) : null;
    if (t && !out.some((x) => x.id === t.id)) out.push(t);
  }
  return out;
}

/**
 * Walk the journey from `node` for one inbound message: send it and the plain
 * blocks after it, until a block that waits for a tap, an End, or a block
 * with nothing after it. An Extender sends each numbered output's chain in
 * turn. `sendOne(node)` sends one block and returns 'wait', 'continue' or
 * 'stop'.
 * @returns the id of the block left waiting for a tap (the last one, if
 *          several Extender branches end in one), or null when it finished.
 */
export async function walkJourney(journey, node, sendOne, { maxSteps = MAX_JOURNEY_STEPS, gapMs = extenderGapMs() } = {}) {
  const ctx = { steps: 0, sent: new Set(), open: new Set(), parked: null, maxSteps, gapMs };
  await walkFrom(journey, node, sendOne, ctx, 0);
  return ctx.parked;
}

async function walkFrom(journey, node, sendOne, ctx, depth) {
  let current = node;
  while (current && ctx.steps < ctx.maxSteps) {
    ctx.steps += 1;
    const kind = current.data?.kind;
    // "Start again" sends nothing: it goes back to the block after Start, as a
    // fresh "hi" would. Not when that block already went out for this message
    // (Start → … → Start again with no question in between would repeat it).
    if (kind === 'restart') {
      const start = startNode(journey);
      const first = start ? edgeTarget(journey, start.id, null) : null;
      if (!first || first.data?.kind === 'restart' || ctx.sent.has(first.id)) return;
      current = first;
      continue;
    }
    if (kind === 'extender') {
      // An Extender reached again from one of its own outputs would loop.
      if (ctx.open.has(current.id) || depth >= EXT_DEPTH) return;
      ctx.open.add(current.id);
      const targets = extenderTargets(journey, current);
      for (let i = 0; i < targets.length && ctx.steps < ctx.maxSteps; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        if (i > 0 && ctx.gapMs) await sleep(ctx.gapMs);
        // eslint-disable-next-line no-await-in-loop
        await walkFrom(journey, targets[i], sendOne, ctx, depth + 1);
      }
      ctx.open.delete(current.id);
      return;
    }
    ctx.sent.add(current.id);
    // eslint-disable-next-line no-await-in-loop
    const status = await sendOne(current);
    if (status === 'wait') {
      ctx.parked = current.id;
      return;
    }
    if (status === 'stop') return;
    // plain node: follow its default edge if present, else stop.
    current = edgeTarget(journey, current.id, null);
  }
}

// Send `node` and keep chaining through plain blocks, stopping at an
// interactive one (which waits for a reply); an Extender sends its outputs in order.
async function sendChain(meta, phone, journey, node, convo, tokens = {}) {
  // The journey carries its owner, so state writes land on the right tenant's
  // chat even when two tenants are talking to the same customer.
  const businessId = journey?.businessId || null;
  const parked = await walkJourney(journey, node, (n) => sendNode(meta, phone, n, tokens));
  await setState(convo.phone, parked ? { nodeId: parked } : { nodeId: null, done: true }, businessId);
}

async function setState(phone, journeyState, businessId) {
  await Conversation.updateOne(
    { phone, businessId: businessId || null },
    { $set: { step: 'journey', 'context.journey': journeyState } },
    { upsert: true },
  );
}

/**
 * The channel's journey: the most recently updated one for that channel ('' /
 * missing = WhatsApp), or null when there is none.
 *
 * A saved journey always runs. The journey editor no longer has a Bot on /
 * off switch, so an old `active: false` is ignored (nothing could switch it
 * back). On WhatsApp, Flows take over when the Flows tab's switch is on
 * (flowMapRuntime.pickEntryFlow runs first); a single chat can be set to
 * Manual in Chats (Conversation.botPaused).
 */
export async function pickJourney(businessId, channel = '') {
  const want = channel === 'instagram' || channel === 'messenger' ? channel : '';
  const rows = await Journey.find({ businessId }).sort({ updatedAt: -1 }).lean();
  const j = rows.find((r) => ((r.channel === 'instagram' || r.channel === 'messenger') ? r.channel : '') === want);
  return j || null;
}
export { nodeById, edgesFrom, startNode, edgeTarget };

/**
 * Run the journey for an inbound message. Returns true if it handled the message.
 * @param {object} meta tenant Meta client
 * @param {object} msg  parsed inbound { phone, type, selectedId, ... }
 * @param {object} convo existing conversation doc (lean) or null
 */
export async function runJourney(meta, businessId, msg, convo) {
  if (!businessId) return false;
  let journey;
  try {
    journey = await pickJourney(businessId);
  } catch (err) {
    logger.warn('journey lookup failed', { error: err.message });
    return false;
  }
  if (!journey || !(journey.nodes || []).length) return false;

  const phone = msg.phone;
  // Live values ({{name}} etc.), resolved once for this message.
  const tokens = await journeyTokens(businessId, msg);

  // 1) Interactive reply → advance from the encoded source node + handle.
  const sel = msg.selectedId || '';
  // A carousel card's quick reply is n:<node>:card:<card>:<button>.
  const m = sel.match(/^n:([^:]+):(?:(btn|opt):(\d+)|card:(\d+):(\d+))$/);
  if (m) {
    const [, srcNodeId, kind, idx, card, btn] = m;
    const handle = card !== undefined ? `card-${card}-${btn}` : kind === 'btn' ? `btn-${idx}` : `opt-${idx}`;
    const next = edgeTarget(journey, srcNodeId, handle);
    if (next) {
      await sendChain(meta, phone, journey, next, { phone }, tokens);
      return true;
    }
    return false;
  }

  // 2) Shared location → advance via the "valid" branch of the current node.
  if (msg.type === 'location') {
    const curId = convo?.context?.journey?.nodeId;
    if (curId) {
      const next = edgeTarget(journey, curId, 'loc-yes') || edgeTarget(journey, curId, null);
      if (next) {
        await sendChain(meta, phone, journey, next, { phone }, tokens);
        return true;
      }
    }
    return false;
  }

  // 3) Anything else (typed text, a photo, …) starts the journey again from
  //    the top, as Flows do. This includes a chat parked at a block that waits
  //    for a tap: ignoring a typed "hi" there left the customer with no reply
  //    for good. A location block that is waiting takes its "Not valid" branch
  //    when one is wired.
  const curId = convo?.context?.journey?.nodeId;
  const cur = curId ? nodeById(journey, curId) : null;
  if (cur?.data?.kind === 'location') {
    // Exact handle only: edgeTarget falls back to the first edge ("Valid").
    const edge = edgesFrom(journey, cur.id).find((e) => (e.sourceHandle || '') === 'loc-no');
    const notValid = edge ? nodeById(journey, edge.target) : null;
    if (notValid) {
      await sendChain(meta, phone, journey, notValid, { phone }, tokens);
      return true;
    }
  }
  const start = startNode(journey);
  const first = start ? edgeTarget(journey, start.id, null) : journey.nodes.find((n) => n.data?.kind !== 'start');
  if (first) {
    await sendChain(meta, phone, journey, first, { phone }, tokens);
    return true;
  }
  return false;
}

export default { runJourney };
