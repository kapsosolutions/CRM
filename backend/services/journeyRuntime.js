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
//   • Template, Catalog, Categories, Members, Date & time, Book, Place order
//     and Offers blocks are sent by journeyBlocks.js. Their choices are saved
//     with the chat (context.journey.tokens) while it waits for the next tap.
import Journey from '../models/Journey.js';
import Conversation from '../models/Conversation.js';
import Business from '../models/Business.js';
import { fillTokens } from './tokens.js';
import { resolveCustomerName } from './templateVars.js';
import logger from './logger.js';

// Template and business-data blocks (catalog, categories, members, free
// times, booking, order, offers) live in journeyBlocks.js, loaded the first
// time one of them runs.
const BUSINESS_KINDS = new Set(['catalog', 'categories', 'members', 'slots', 'book', 'order', 'offers']);
let blocksModule = null;
const blocks = async () => {
  blocksModule ||= await import('./journeyBlocks.js');
  return blocksModule;
};

// Live values worked out for every message; never saved with the chat.
const LIVE_TOKENS = ['name', 'customer_name', 'business_name', 'customer_phone', 'today'];
/** The choices to keep with the chat (category, member, day, time, cart, order…). */
function carried(tokens = {}) {
  const out = {};
  for (const [k, v] of Object.entries(tokens || {})) {
    if (LIVE_TOKENS.includes(k) || v === undefined || v === null || v === '') continue;
    out[k] = v instanceof Date ? v.toISOString() : v;
  }
  return out;
}

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

/** The block on exactly this output ('' = the plain "Next"), or null: no fallback. */
function exactTarget(journey, sourceId, handle) {
  const e = edgesFrom(journey, sourceId).find((x) => (x.sourceHandle || '') === (handle || ''));
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

// Send a single node. Returns 'wait' if it expects a reply, else 'continue'
// (or 'stop', or { handle } to follow one output: see journeyBlocks.js).
// `tokens` carries the live values ({{name}} etc.) substituted into any text,
// and the choices made so far; `ctx` is { businessId, journey }.
async function sendNode(meta, phone, node, tokens = {}, ctx = {}) {
  const d = node.data || {};
  const kind = d.kind;
  if (kind === 'template') return (await blocks()).sendTemplateBlock(meta, phone, node, tokens, ctx);
  if (BUSINESS_KINDS.has(kind)) return (await blocks()).sendBusinessBlock(meta, phone, node, tokens, ctx);
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
    // One named output (a booking's "Booked" / "Not booked"…), exactly.
    if (status && typeof status === 'object') {
      current = exactTarget(journey, current.id, status.handle);
      continue;
    }
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
  const ctx = { businessId, journey };
  const parked = await walkJourney(journey, node, (n) => sendNode(meta, phone, n, tokens, ctx));
  await setState(convo.phone, parkedState(parked, tokens), businessId);
}

/** What's saved with the chat: the block waiting for a tap, and the choices so far. */
function parkedState(nodeId, tokens) {
  if (!nodeId) return { nodeId: null, done: true };
  const keep = carried(tokens);
  return Object.keys(keep).length ? { nodeId, tokens: keep } : { nodeId };
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
  const live = await journeyTokens(businessId, msg);
  // An answer continues with the choices made so far (category, member, day…);
  // a fresh start (step 3) begins without them.
  const saved = convo?.context?.journey?.tokens;
  const tokens = { ...(saved && typeof saved === 'object' ? saved : {}), ...live };
  const ctx = { businessId: journey.businessId || businessId, journey };

  // 1) Interactive reply → advance from the encoded source node + handle.
  const sel = msg.selectedId || '';
  // A carousel card's quick reply is n:<node>:card:<card>:<button>; a
  // template's quick reply is n:<node>:tbtn:<button>.
  const m = sel.match(/^n:([^:]+):(?:(btn|opt|tbtn):(\d+)|card:(\d+):(\d+))$/);
  if (m) {
    const [, srcNodeId, kind, idx, card, btn] = m;
    const handle = card !== undefined ? `card-${card}-${btn}` : `${kind}-${idx}`;
    // A template button is exact: its "Next" is not where a tap goes.
    const next = kind === 'tbtn' ? exactTarget(journey, srcNodeId, handle) : edgeTarget(journey, srcNodeId, handle);
    if (next) {
      await sendChain(meta, phone, journey, next, { phone }, kind === 'tbtn' ? { ...tokens, last_choice: msg.text || '' } : tokens);
      return true;
    }
    return false;
  }

  // 1b) A row of a categories / members / date & time list.
  const row = sel.match(/^n:([^:]+):(cat|mem|day|more|slot):([A-Za-z0-9_.-]{1,80})$/);
  if (row) {
    const [, srcNodeId, what, value] = row;
    const src = nodeById(journey, srcNodeId);
    if (!src || !BUSINESS_KINDS.has(src.data?.kind)) return false;
    const B = await blocks();
    const res = await B.onBusinessReply(meta, phone, src, what, value, tokens, ctx);
    if (res === 'wait') {
      await setState(phone, parkedState(src.id, tokens), ctx.businessId);
      return true;
    }
    const next = res && typeof res === 'object' ? exactTarget(journey, src.id, res.handle) : null;
    if (next) await sendChain(meta, phone, journey, next, { phone }, tokens);
    else await setState(phone, parkedState(null, tokens), ctx.businessId);
    return true;
  }

  // 1c) A template quick reply that came back without our id: the template
  //     was sent some other way (a keyword trigger such as "hi", a campaign,
  //     a send from Chats) or before journeys tagged their buttons. Matched by
  //     the button's text: first on the Template block the chat is waiting
  //     at, then on any Template block of this journey with that template
  //     and that button wired. A tap is never a reason to start over: with no
  //     match the journey stays quiet (re-sending the welcome on "Interested"
  //     looked like the bot ignoring the customer).
  if (msg.templateReply && !sel) {
    const B = await blocks();
    const parkedId = convo?.context?.journey?.nodeId;
    const candidates = (journey.nodes || [])
      .filter((n) => n.data?.kind === 'template')
      .sort((a, b) => (a.id === parkedId ? -1 : b.id === parkedId ? 1 : 0));
    for (const node of candidates) {
      // eslint-disable-next-line no-await-in-loop
      const i = await B.templateButtonIndex(node, msg.text, ctx.businessId);
      const next = i >= 0 ? exactTarget(journey, node.id, `tbtn-${i}`) : null;
      if (next) {
        await sendChain(meta, phone, journey, next, { phone }, { ...tokens, last_choice: msg.text || '' });
        return true;
      }
    }
    logger.info('template button tap not wired in the journey: no reply', { text: msg.text || '' });
    return false;
  }

  // 1d) The customer sent their cart from a Catalog block → its "Cart sent"
  //     output. The chat normally waits at that block; if it doesn't (an
  //     older catalog message), the first Catalog block with "Cart sent"
  //     wired takes it. No such block: the journey starts again (step 3).
  if (msg.type === 'order' && msg.cart) {
    const cur = nodeById(journey, convo?.context?.journey?.nodeId);
    const from = cur?.data?.kind === 'catalog' && exactTarget(journey, cur.id, 'cart')
      ? cur
      : (journey.nodes || []).find((n) => n.data?.kind === 'catalog' && exactTarget(journey, n.id, 'cart'));
    if (from) {
      const cartTokens = await (await blocks()).cartTokensFor(msg.cart, ctx.businessId).catch(() => ({}));
      await sendChain(meta, phone, journey, exactTarget(journey, from.id, 'cart'), { phone }, { ...tokens, ...cartTokens });
      return true;
    }
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
    // From the top: earlier choices don't carry into a new conversation.
    await sendChain(meta, phone, journey, first, { phone }, { ...live });
    return true;
  }
  return false;
}

export default { runJourney };
