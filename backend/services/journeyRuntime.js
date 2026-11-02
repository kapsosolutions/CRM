// Journey execution engine. Runs a business's saved journey (node/edge graph)
// against an inbound WhatsApp message:
//   • New conversation → start at the Start node, follow its edge, send the
//     first node (and chain through any plain leaf nodes).
//   • Interactive reply (button / list / shared location) → look up the matching
//     edge and advance to the next node.
// Interactive option ids are encoded as  n:<nodeId>:btn:<i>  /  n:<nodeId>:opt:<i>
// so an inbound reply maps straight back to the source node + handle.
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

// Send `node` and keep chaining through plain leaf nodes that have a single
// outgoing edge, stopping at an interactive node (which waits for a reply).
async function sendChain(meta, phone, journey, node, convo, tokens = {}) {
  let current = node;
  let guard = 0;
  // The journey carries its owner, so state writes land on the right tenant's
  // chat even when two tenants are talking to the same customer.
  const businessId = journey?.businessId || null;
  const sent = new Set();
  while (current && guard++ < 20) {
    // "Start again" sends nothing: it goes back to the block after Start, as a
    // fresh "hi" would. Not when that block already went out for this message
    // (Start → … → Start again with no question in between would repeat it).
    if (current.data?.kind === 'restart') {
      const start = startNode(journey);
      const first = start ? edgeTarget(journey, start.id, null) : null;
      if (!first || first.data?.kind === 'restart' || sent.has(first.id)) {
        await setState(convo.phone, { nodeId: null, done: true }, businessId);
        return;
      }
      current = first;
      continue;
    }
    sent.add(current.id);
    const status = await sendNode(meta, phone, current, tokens);
    if (status === 'wait') {
      await setState(convo.phone, { nodeId: current.id }, businessId);
      return;
    }
    // plain node: follow a single default edge if present, else stop.
    const next = edgeTarget(journey, current.id, null);
    if (!next) {
      await setState(convo.phone, { nodeId: null, done: true }, businessId);
      return;
    }
    current = next;
  }
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
  const m = sel.match(/^n:([^:]+):(btn|opt):(\d+)$/);
  if (m) {
    const [, srcNodeId, kind, idx] = m;
    const handle = kind === 'btn' ? `btn-${idx}` : `opt-${idx}`;
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

  // 3) Plain text. If we're not currently waiting at an interactive node,
  //    (re)start the journey from the top. If we ARE waiting (e.g. for a button
  //    tap) a stray text is ignored so the agent/auto-reply can handle it.
  const waiting = !!(convo?.context?.journey?.nodeId);
  if (!waiting) {
    const start = startNode(journey);
    const first = start ? edgeTarget(journey, start.id, null) : journey.nodes.find((n) => n.data?.kind !== 'start');
    if (first) {
      await sendChain(meta, phone, journey, first, { phone }, tokens);
      return true;
    }
  }
  return false;
}

export default { runJourney };
