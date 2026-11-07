// Flow MAP execution engine. Runs a saved Flow's visual map (the Start node →
// message/reply/cta/call/… blocks → screens / flow hand-offs) as a WhatsApp
// conversation, exactly like the Journeys runtime but Flow-aware:
//   • New conversation → start at the Start node's entryTarget and send blocks.
//   • Reply-button / list tap → advance along the wired port.
//   • When a port is wired to a SCREEN, open the native WhatsApp Flow at that
//     screen (publishing a Flow only registers the form with Meta — this is
//     what actually delivers it in chat).
//
// Interactive option ids are encoded as  f:<flowId>:<blockId>:btn:<i>  /  :opt:<i>
// so an inbound reply maps back to the exact flow, block and port. The `f:`
// prefix also keeps these distinct from the Journeys runtime's `n:` ids.
import Flow from '../models/Flow.js';
import Conversation from '../models/Conversation.js';
import Business from '../models/Business.js';
import { buildCategorySections } from './catalog.js';
import { cartTokens, chargeTokens, dropUnpricedLines, paymentSummary } from './cart.js';
import logger from './logger.js';
import { makeFlowToken, flowIdFromToken, orderTokens, orderCartTokens } from './flowRuntime.js';
import { ensureOrder } from './orders.js';
import { notify, money } from './notifications.js';
import Order from '../models/Order.js';
import Message from '../models/Message.js';
import { prefillKeysOf } from './flowJson.js';
import { fillTokens, locationTokens, dropEmptyLines } from './tokens.js';
import { renderBlockPdf } from './pdfDoc.js';
import { resolveCustomerName } from './templateVars.js';
import { addressFor, isCoordsText, withGeocodedAddress } from './geocode.js';

// Tenant-scoped: a flow id arriving from a reply id or a flow_token is
// attacker-influenceable, so ownership is checked rather than assumed.
async function loadFlow(id, businessId) {
  if (!id) return null;
  try {
    return await Flow.findOne({ _id: id, ...(businessId ? { businessId } : {}) }).lean();
  } catch {
    return null;
  }
}

/**
 * The flow that answers an inbound message: the most recently updated one with
 * a Start node wired to an entry.
 *
 * "Runnable" matters as much as "recent". A flow whose entry is a *screen* can
 * only be sent once it's published, because Meta needs the published flow id to
 * render it — so an unpublished draft that happened to be saved last would win
 * on recency and then silently answer nothing, taking the whole chatbot down
 * while the live flow sat there working. Prefer a flow that can actually run,
 * and fall back to the newest only when none can.
 *
 * Scoped to the tenant. It previously searched every flow in the database, so
 * whichever business had edited a flow most recently answered *everyone's*
 * WhatsApp number — a brand new tenant would greet its customers with another
 * company's menu. With no businessId there is nothing safe to run, so it
 * returns null rather than falling back to someone else's flow.
 */
async function pickEntryFlow(businessId) {
  if (!businessId) return null;
  try {
    // Flows only drive when the tenant has switched them on. Off by default,
    // in which case this returns null and the caller falls through to the
    // tenant's journeys.
    const biz = await Business.findById(businessId).select('flowsActive').lean();
    if (!biz?.flowsActive) return null;
    const flows = await Flow.find({ businessId, entryTarget: { $nin: ['', null] } })
      .sort({ updatedAt: -1 })
      .lean();
    if (!flows.length) return null;
    // A block entry is a plain WhatsApp message, so it needs no published id;
    // only a screen entry does.
    const runnable = flows.find(
      (f) => !String(f.entryTarget).startsWith('screen_') || f.metaFlowId,
    );
    if (!runnable) return flows[0]; // nothing publishable — let the caller log why
    if (runnable !== flows[0]) {
      logger.info('skipping an unpublished flow for the entry', {
        skipped: flows[0].name, using: runnable.name,
      });
    }
    return runnable;
  } catch (err) {
    logger.warn('flow map entry lookup failed', { error: err.message });
    return null;
  }
}

const mediaHeader = (b) => {
  if (!b.headerMediaUrl || !b.header || b.header === 'none') return null;
  if (b.header === 'image') return { type: 'image', link: b.headerMediaUrl };
  if (b.header === 'video') return { type: 'video', link: b.headerMediaUrl };
  if (b.header === 'pdf') return { type: 'document', link: b.headerMediaUrl };
  return null;
};

// Inbound kinds that mean "the customer is starting a conversation", as
// opposed to answering one. Any of these re-opens the flow at its entry.
const OPENING_TYPES = new Set([
  'text', 'image', 'video', 'audio', 'document', 'location',
]);

const blockById = (flow, id) => (flow.blocks || []).find((b) => b.id === id);
const resolveEntryScreenId = (flow) => {
  if (flow.entryTarget && flow.entryTarget.startsWith('screen_')) return flow.entryTarget.slice('screen_'.length);
  return flow.screens?.[0]?.id || 'WELCOME';
};

// Send a single map block. Returns 'wait' if it expects a reply, else 'continue'.
async function sendBlock(meta, phone, flow, b, tokens = {}, businessId = '') {
  const header = mediaHeader(b);
  const fid = String(flow._id);
  // Body text with live values substituted.
  const text = fillTokens(b.text, tokens);

  switch (b.kind) {
    // A generated A4 document (receipt / cancellation slip) delivered as a
    // single WhatsApp message: PDF attachment + body + reply buttons.
    case 'pdfdoc': {
      const buttons = (b.buttons || []).map((t, i) => ({ id: `f:${fid}:${b.id}:btn:${i}`, title: t }));
      const pdf = await renderBlockPdf(b, tokens, businessId);
      if (!pdf) {
        // Nothing designed yet — still send the wording so the chat continues.
        if (buttons.length) {
          await meta.sendButtons(phone, { body: text || ' ', buttons });
          return 'wait';
        }
        if (text) await meta.sendText(phone, text);
        return 'continue';
      }
      const docHeader = { type: 'document', link: pdf.url, filename: pdf.filename };
      if (buttons.length) {
        await meta.sendButtons(phone, { body: text || ' ', header: docHeader, buttons });
        return 'wait';
      }
      await meta.sendDocument(phone, pdf.url, pdf.filename, text);
      return 'continue';
    }
    case 'message': {
      if (header) {
        if (header.type === 'image') await meta.sendImage(phone, header.link, text);
        else if (header.type === 'video') await meta.sendVideo(phone, header.link, text);
        else await meta.sendDocument(phone, header.link, b.headerFileName || 'document.pdf', text);
      } else {
        await meta.sendText(phone, text || ' ');
      }
      return 'continue';
    }
    // 'paymethod' is the Payment-type block: the same interactive-buttons
    // message, pre-filled with Online / COD in the builder. The labels are the
    // business's own wording, so nothing here special-cases them — the chosen
    // button routes through buttonTargets exactly like any reply block.
    case 'reply': {
      const buttons = (b.buttons || []).map((t, i) => ({ id: `f:${fid}:${b.id}:btn:${i}`, title: t }));
      await meta.sendButtons(phone, { body: text || ' ', header, buttons });
      return 'wait';
    }
    // 'paymethod' is the Payment type block: the same interactive-buttons
    // message as 'reply', with a costed Items / Delivery / Total payable
    // summary built on top of the block's own wording. The summary is
    // generated (see paymentSummary) rather than typed, so the layout can't
    // drift between flows; the block's text is the prompt underneath it.
    // With no cart to cost there's no summary — just the prompt. Button labels
    // are the business's own wording, so nothing here special-cases them; the
    // tap routes through buttonTargets like any reply block.
    case 'paymethod': {
      const prompt = fillTokens(dropUnpricedLines(b.text, tokens), tokens);
      const body = [paymentSummary(b, tokens), prompt].filter(Boolean).join('\n\n');
      const buttons = (b.buttons || []).map((t, i) => ({ id: `f:${fid}:${b.id}:btn:${i}`, title: t }));
      await meta.sendButtons(phone, { body: body || ' ', header, buttons });
      return 'wait';
    }
    // The order confirmation: one message summarising everything the customer
    // chose on the way through — category, cart, charges, payment method,
    // delivery address. What makes it work across businesses is that the body
    // is their own wording and any line whose live value is empty is dropped,
    // so a shop that never asks for a location simply has no address line
    // rather than a dangling label. Buttons are optional; with none it reads as
    // a plain message and continues down the single output.
    // 'orderdetails' reports an order the customer already picked — its
    // reference, status, date, items and total. It reads the order_* tokens
    // the submission runtime resolved from their selection and never creates
    // an order, which is the whole difference from 'orderconfirm'. Lines whose
    // value is missing are dropped, so a business that doesn't track payment
    // status simply has no payment line.
    case 'orderconfirm':
    case 'orderdetails': {
      const body = fillTokens(dropEmptyLines(b.text, tokens), tokens);
      const buttons = (b.buttons || []).map((t, i) => ({ id: `f:${fid}:${b.id}:btn:${i}`, title: t }));
      if (!buttons.length) {
        if (header) {
          if (header.type === 'image') await meta.sendImage(phone, header.link, body);
          else if (header.type === 'video') await meta.sendVideo(phone, header.link, body);
          else await meta.sendDocument(phone, header.link, b.headerFileName || 'document.pdf', body);
        } else {
          await meta.sendText(phone, body || ' ');
        }
        return 'continue';
      }
      await meta.sendButtons(phone, { body: body || ' ', header, buttons });
      return 'wait';
    }
    case 'cta': {
      await meta.sendCtaUrl(phone, { body: text || ' ', displayText: b.ctaLabel, url: b.ctaUrl || 'https://', header });
      return 'continue';
    }
    case 'call': {
      const digits = (b.callPhone || '').replace(/[^\d+]/g, '');
      const label = b.callLabel || 'Call us';
      try {
        await meta.sendCtaUrl(phone, { body: text || label, displayText: label, url: `tel:${digits}`, header });
      } catch {
        await meta.sendText(phone, `${text ? text + '\n\n' : ''}📞 ${label}: ${digits}`.trim());
      }
      return 'continue';
    }
    case 'location': {
      await meta.sendLocationRequest(phone, text || 'Please share your location.');
      return 'wait';
    }
    case 'list': {
      const rows = (b.options || []).map((t, i) => ({ id: `f:${fid}:${b.id}:opt:${i}`, title: t }));
      await meta.sendList(phone, { body: text || ' ', buttonText: b.listTitle || 'Menu', rows });
      return 'wait';
    }
    case 'template': {
      if (b.templateName) await meta.sendTemplate(phone, b.templateName, {});
      return 'continue';
    }
    // A native catalog card listing the products of the category the customer
    // just chose. `tokens.category` is the readable category name resolved from
    // their flow answers; without one we list everything.
    case 'catalog': {
      const business = businessId ? await Business.findById(businessId).lean() : null;
      if (!business?.catalogId) {
        logger.warn('catalog block: business has no catalog ID', { businessId });
        if (text) await meta.sendText(phone, text);
        return 'continue';
      }
      const category = tokens.category || '';
      const built = await buildCategorySections(business, category);
      if (!built) {
        logger.warn('catalog block: no synced products to show', { businessId, category });
        // Say something rather than going silent on the customer.
        await meta.sendText(
          phone,
          text || (category ? `No items in ${category} right now.` : 'No items available right now.'),
        );
        return 'continue';
      }
      try {
        await meta.sendProductList(phone, {
          catalogId: business.catalogId,
          header: built.title,
          body: fillTokens(b.text, tokens) || `Browse our ${built.title}.`,
          footer: business.name,
          sections: built.sections,
        });
        logger.info('catalog block sent', { category: built.title, items: built.total });
      } catch (err) {
        const msg = err.response?.data?.error?.message || err.message;
        logger.error('catalog block send failed', { category: built.title, error: msg });
        if (text) await meta.sendText(phone, text);
        return 'continue';
      }
      // Park here: the next thing the customer does is send their cart, which
      // arrives as an `order` message and continues along this block's output.
      return 'wait';
    }
    /**
     * Native WhatsApp Pay — the real "Review and pay" card.
     *
     * Requires an order to charge for, so one is created (or reused) here and
     * stamped with this block's id. That stamp is what lets the status
     * webhook, which arrives later as a separate request carrying only a
     * reference id, resume the conversation on the right branch.
     *
     * Returns 'wait' because nothing should follow until the customer has
     * actually paid — the webhook drives the paid / failed continuation. When
     * payment isn't configured the block degrades to its own wording rather
     * than dead-ending the conversation.
     */
    case 'payment': {
      if (!meta.paymentReady?.()) {
        logger.warn('payment block: native payment is not configured for this tenant', { businessId });
        if (text) await meta.sendText(phone, text);
        return 'continue';
      }
      const biz = businessId ? await Business.findById(businessId).select('name').lean() : null;
      const ensured = await ensureOrder({
        tokens, businessId, phone, businessName: biz?.name || '',
      });
      const reference = ensured.order_id;
      const orderDoc = ensured.order_db_id
        ? await Order.findById(ensured.order_db_id).lean()
        : null;
      if (!reference || !orderDoc) {
        logger.warn('payment block: nothing to charge for (no order could be made)', {
          businessId, phone, hasCart: !!tokens.cart_lines,
        });
        if (text) await meta.sendText(phone, text);
        return 'continue';
      }

      // Charge the order's own lines. An appointment has no cart, so the fee
      // becomes a single line named after what was booked.
      const lines = (orderDoc.items || []).length
        ? orderDoc.items.map((i) => ({
          name: i.name, price: i.price, quantity: i.qty || 1, retailerId: i.retailerId, image: i.image || '',
        }))
        : [{
          name: tokens.member || tokens.category || 'Service',
          price: Number(orderDoc.total) || 0,
          quantity: 1,
        }];
      const total = Number(orderDoc.total) || lines.reduce((s, l) => s + l.price * l.quantity, 0);
      if (total <= 0) {
        logger.warn('payment block: order total is zero, nothing to pay', { reference });
        if (text) await meta.sendText(phone, text);
        return 'continue';
      }

      try {
        await meta.sendOrderDetails(phone, reference, lines, total, {
          shipping: Number(orderDoc.deliveryFee) || 0,
          headerImageUrl: header?.type === 'image' ? header.link : null,
          body: text || undefined,
        });
        await Order.updateOne(
          { _id: orderDoc._id },
          {
            $set: {
              'payment.status': 'pending',
              'payment.flowId': String(flow._id),
              'payment.blockId': b.id,
              'payment.requestedAt': new Date(),
              paymentMethod: orderDoc.paymentMethod || 'Online',
            },
          },
        );
        logger.info('native payment requested', { reference, total, phone });
      } catch (err) {
        const m = err.response?.data?.error?.message || err.message;
        logger.error('payment block: order_details send failed', { reference, error: m });
        // Say something rather than leaving the customer on a silent screen.
        await meta.sendText(
          phone,
          'Sorry, we could not start the payment just now. Please reply and we will help.',
        );
        return 'continue';
      }
      return 'wait';
    }
    default: {
      if (text) await meta.sendText(phone, text);
      return 'continue';
    }
  }
}

// Open the native WhatsApp Flow at a given screen (this is what delivers the
// published Flow form into the chat).
async function openScreen(meta, phone, flow, screenId) {
  if (!flow.metaFlowId) {
    logger.warn('flow map: cannot open screen, flow has no metaFlowId (publish it first)', { flow: String(flow._id) });
    return;
  }
  const screens = flow.screens || [];
  const screen = screens.find((s) => s.id === screenId) || screens[0];
  const mode = flow.status === 'PUBLISHED' ? 'published' : 'draft';

  // The chat message belongs to the flow (one message opens it, whichever
  // screen it lands on). Older flows stored it per screen, so fall back to that.
  const hType = flow.msgHeader && flow.msgHeader !== 'none' ? flow.msgHeader : screen?.msgHeader;
  const hUrl = flow.msgHeaderMediaUrl || screen?.msgHeaderMediaUrl;
  let header = null;
  if (hUrl && hType && hType !== 'none') {
    if (hType === 'image') header = { type: 'image', link: hUrl };
    else if (hType === 'video') header = { type: 'video', link: hUrl };
    else if (hType === 'pdf') {
      header = {
        type: 'document',
        link: hUrl,
        filename: flow.msgHeaderFileName || screen?.msgHeaderFileName || 'document.pdf',
      };
    }
  }
  // The entry screen is rendered straight from this payload (Meta doesn't call
  // our endpoint for it), so any prefilled values must travel with it.
  const screenData = {};
  for (const key of prefillKeysOf(screen || {})) {
    screenData[key] = key === 'whatsapp_number' ? `+${String(phone).replace(/\D/g, '')}` : '';
  }

  await meta.sendFlowMessage(phone, {
    flowId: flow.metaFlowId,
    flowCta: flow.cta || 'Open',
    screen: screen?.id || 'WELCOME',
    flowToken: makeFlowToken(flow._id, phone),
    body: flow.msgBody || screen?.msgBody || screen?.title || ' ',
    footer: flow.msgFooter || '',
    header,
    mode,
    flowAction: 'navigate',
    data: screenData,
  });
}

/**
 * Open a flow for a customer at its entry screen — the same message the chatbot
 * sends, used by the CRM composer so an agent can push a form into a chat.
 * @param {object} meta tenant Meta client
 * @param {string} phone recipient
 * @param {object} flow the Flow document (lean is fine)
 */
export async function sendFlowToChat(meta, phone, flow) {
  await openScreen(meta, phone, flow, resolveEntryScreenId(flow));
}

// Conversation state is per (tenant, phone). Keyed on phone alone, one
// tenant's flow progress was written onto another tenant's chat with the same
// customer.
async function setState(phone, flowState, businessId) {
  await Conversation.updateOne(
    { phone, businessId: businessId || null },
    { $set: { step: 'flow', 'context.flow': flowState } },
    { upsert: true },
  );
}
async function clearState(phone, flowId, businessId) {
  await Conversation.updateOne(
    { phone, businessId: businessId || null },
    { $set: { 'context.flow': { flowId: flowId ? String(flowId) : '', nodeId: null } } },
    { upsert: true },
  );
}

// Resolve a target node id (screen_/block_/flink_) and send it, chaining through
// plain blocks until something waits for a reply or opens a screen.
async function resolveAndSend(meta, phone, flow, nodeId, guard = 0, ctx = {}) {
  let { tokens = {} } = ctx;
  const { businessId = '', action = '' } = ctx;
  if (!nodeId || guard > 20) {
    await clearState(phone, flow._id, businessId);
    return;
  }

  // Seed {{name}} and {{customer_name}} so any message or document can greet
  // the customer by name even when no form was filled. A name typed into a
  // form wins (resolveCustomerName checks that first); otherwise the WhatsApp
  // profile name is used. `name` and `customer_name` are kept in step, and the
  // DB is only hit when neither is already known — later blocks and the
  // recursion reuse the resolved value.
  // A blank value counts as missing too: carried conversation state can hold
  // `customer_name: ''`, which used to stop the lookup and left orders (and
  // their slips) nameless.
  if (phone && (!tokens.name || !tokens.customer_name)) {
    const known = tokens.name || tokens.customer_name;
    const nm = known || (await resolveCustomerName(phone, businessId).catch(() => ''));
    tokens = { ...tokens, name: tokens.name || nm, customer_name: tokens.customer_name || nm };
  }
  // {{business_name}} for documents and messages sent from the chat flow —
  // only the form-submission path supplied it, so slips sent from here had a
  // blank header and "Thank you for choosing ·".
  if (!tokens.business_name && businessId) {
    const biz = await Business.findById(businessId).select('name').lean().catch(() => null);
    if (biz?.name) tokens = { ...tokens, business_name: biz.name };
  }

  if (nodeId.startsWith('screen_')) {
    // Always clear the waiting state, even if the Flow send fails, so a failed
    // open can never leave the conversation permanently stuck.
    try {
      await openScreen(meta, phone, flow, nodeId.slice('screen_'.length));
    } finally {
      await clearState(phone, flow._id, businessId);
    }
    return;
  }

  if (nodeId.startsWith('flink_')) {
    const linkId = nodeId.slice('flink_'.length);
    const link = (flow.flowLinks || []).find((l) => l.id === linkId);
    try {
      if (link?.flowId) {
        const other = await loadFlow(link.flowId, businessId);
        if (other) await openScreen(meta, phone, other, resolveEntryScreenId(other));
      }
    } finally {
      await clearState(phone, flow._id, businessId);
    }
    return;
  }

  if (nodeId.startsWith('block_')) {
    const block = blockById(flow, nodeId.slice('block_'.length));
    if (!block) {
      await clearState(phone, flow._id, businessId);
      return;
    }

    // A 'restart' block isn't a message — it loops back to the flow's entry
    // node so the customer begins again, exactly as a fresh "hi" would. The
    // `guard` above stops a mis-wired loop from running away.
    if (block.kind === 'restart') {
      const entry = flow.entryTarget;
      if (!entry || entry === nodeId) {
        logger.warn('restart block has no usable entry target', { flow: flow.name, entry });
        await clearState(phone, flow._id, businessId);
        return;
      }
      logger.info('flow map: restart block → entry', { phone, entry });
      await clearState(phone, flow._id, businessId);
      return resolveAndSend(meta, phone, flow, entry, guard + 1, ctx);
    }

    // Token enrichment happens here rather than inside the send, so whatever a
    // block works out is carried to every block after it.
    let live = tokens;
    if (block.kind === 'paymethod') {
      // A payment block adds its own charges (the delivery fee) on top of the
      // cart subtotal, so later blocks quote the same Total payable instead of
      // the pre-delivery figure.
      live = chargeTokens(block, tokens);
    } else if ((block.kind === 'orderconfirm' || block.kind === 'pdfdoc') && action !== 'reschedule') {
      // The commit point: the customer has been all the way through, so the
      // order becomes real and {{order_id}} starts resolving. `ensureOrder` is
      // idempotent, so a confirmation message followed by a confirmation PDF
      // produces one order quoted twice, not two orders.
      //
      // Skipped for a reschedule: that MOVES the existing appointment (done in
      // saveFlowSubmission) rather than booking a new one, so creating an order
      // here left every reschedule with a duplicate booking in the CRM. The
      // moved appointment's new date/time are already in `tokens` for the
      // confirmation document.
      const biz = businessId ? await Business.findById(businessId).select('name').lean() : null;
      // Last chance to swap raw coordinates for an address before the order is
      // saved and the confirmation goes out (usually a cache hit by now).
      const placed = await withGeocodedAddress(tokens, { waitMs: 3000 });
      live = {
        ...placed,
        ...(await ensureOrder({ tokens: placed, businessId, phone, businessName: biz?.name || '' })),
      };
    }

    const status = await sendBlock(meta, phone, flow, block, live, businessId);
    if (status === 'wait') {
      // Remember the tokens so a follow-up reply can keep substituting them.
      await setState(phone, { flowId: String(flow._id), nodeId: block.id, tokens: live }, businessId);
      return;
    }
    if (block.nextTarget) {
      return resolveAndSend(meta, phone, flow, block.nextTarget, guard + 1, { ...ctx, tokens: live });
    }
    await clearState(phone, flow._id, businessId);
    return;
  }

  await clearState(phone, flow._id, businessId);
}

/**
 * Run the flow map for an inbound message. Returns true if it handled it.
 * @param {object} meta  tenant Meta client
 * @param {string} businessId  tenant id — scopes every flow and conversation
 *   read/write below; without it nothing runs
 * @param {object} msg  parsed inbound { phone, type, selectedId, ... }
 * @param {object} convo  existing conversation doc (lean) or null
 */
export async function runFlowMap(meta, businessId, msg, convo) {
  const phone = msg.phone;

  // 1) A reply from one of our flow blocks → advance along the wired port.
  const sel = msg.selectedId || '';
  const m = sel.match(/^f:([^:]+):([^:]+):(btn|opt):(\d+)$/);
  if (m) {
    const [, flowId, blockId, , idxStr] = m;
    const idx = Number(idxStr);
    const flow = await loadFlow(flowId, businessId);
    if (!flow) return false;
    const block = blockById(flow, blockId);
    if (!block) return false;
    const target = (block.buttonTargets || [])[idx];
    if (!target) {
      await clearState(phone, flow._id, businessId);
      return true; // the tap was ours, just not wired anywhere
    }
    // Keep any tokens from earlier in this conversation (e.g. the order the
    // customer cancelled) so later blocks can still reference them, and record
    // what they just tapped. A Payment type block's label is the customer's
    // answer to "how will you pay?", so it becomes {{payment_method}} for
    // every block, document and order after it.
    const chosen = (block.buttons || [])[idx] || '';
    const tokens = { ...(convo?.context?.flow?.tokens || {}), last_choice: chosen };
    if (block.kind === 'paymethod' && chosen) tokens.payment_method = chosen;

    await resolveAndSend(meta, phone, flow, target, 0, { tokens, businessId });
    return true;
  }

  // 2) The customer sent their catalog cart → continue from the catalog block.
  //
  // A catalog block parks the conversation (the cart is the reply it's waiting
  // for), so normally the block is right there in the saved state. If it isn't
  // — they re-opened an older catalog message, or browsed outside the flow —
  // fall back to the first catalog block that's actually wired to something,
  // otherwise a sent cart would silently go nowhere.
  if (msg.type === 'order' && msg.cart) {
    const st = convo?.context?.flow || null;
    let flow = st?.flowId ? await loadFlow(st.flowId, businessId) : null;
    let block = flow && st?.nodeId ? blockById(flow, st.nodeId) : null;
    if (!block || block.kind !== 'catalog') {
      flow = flow || (await pickEntryFlow(businessId));
      block = (flow?.blocks || []).find((x) => x.kind === 'catalog' && x.nextTarget) || null;
    }
    if (!flow || !block?.nextTarget) {
      logger.info('cart received but no catalog block is wired to anything', { phone });
      return false;
    }
    // Cart figures join the tokens already collected (category, order id…) so
    // the payment block can print both.
    const tokens = { ...(st?.tokens || {}), ...(await cartTokens(msg.cart, businessId)) };
    logger.info('cart → next block', {
      phone, items: tokens.cart_count, total: tokens.items_total, target: block.nextTarget,
    });
    await resolveAndSend(meta, phone, flow, block.nextTarget, 0, { tokens, businessId });
    return true;
  }

  // 3) Shared location while a flow location block is waiting → "valid" branch.
  //
  // The pin becomes {{delivery_address}} / {{location_url}} for everything
  // downstream, so a confirmation can tell the customer where it's going.
  if (msg.type === 'location' && convo?.context?.flow?.nodeId) {
    const st = convo.context.flow;
    const flow = await loadFlow(st.flowId, businessId);
    const block = flow && blockById(flow, st.nodeId);
    if (flow && block && block.kind === 'location' && block.validTarget) {
      // A dropped pin has no street address — look one up (rate-limited
      // queue, cached). Waits briefly; if the queue is busy the flow carries on
      // with coordinates and the address lands on the order when it resolves.
      const tokens = await withGeocodedAddress(
        { ...(st.tokens || {}), ...locationTokens(msg.location) },
        { waitMs: 4000 },
      );
      logger.info('location shared → valid branch', {
        phone, address: tokens.delivery_address, target: block.validTarget,
      });
      await resolveAndSend(meta, phone, flow, block.validTarget, 0, { tokens, businessId });
      return true;
    }
    return false;
  }

  // 4) Anything the customer just *says* → (re)start the flow at its entry.
  //
  // "hi" is the obvious case, but any message means the same thing: they want
  // to begin. Photos, voice notes and a location shared out of the blue all
  // land here too, so the customer gets the menu instead of silence.
  //
  // Interactive replies are excluded — they're a selection, not an opening.
  // A `button`/`list` payload that reached this far belongs to the Journeys
  // runtime (its ids are `n:`-prefixed), and answering it here would return
  // true and stop journeys from ever running.
  //
  // This deliberately runs even when the conversation is parked at a block.
  // Every waiting block expects a tap or a shared location, so a plain message
  // means the customer ignored the buttons. Treating it as "start again" also
  // rescues a conversation whose `nodeId` was left set: that used to stay set
  // forever, so every later message was dropped and the chat went permanently
  // silent with nothing in the logs.
  if (OPENING_TYPES.has(msg.type) && !msg.selectedId) {
    const flow = await pickEntryFlow(businessId);
    if (flow && flow.entryTarget) {
      if (convo?.context?.flow?.nodeId) {
        logger.info('flow map: restarting from entry (customer messaged instead of tapping)', {
          phone,
          parkedAt: convo.context.flow.nodeId,
        });
      }
      await resolveAndSend(meta, phone, flow, flow.entryTarget, 0, { businessId });
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Flow completion → follow-up blocks
//
// When a customer submits a native Flow, Meta sends an nfm_reply with the
// answers but doesn't say which screen they finished on. We infer it by field
// names, then follow that screen's wiring on the map: either the chosen
// option's block or the footer's block. That's how a "cancel order" flow ends
// with a confirmation message carrying the real order id.
// ---------------------------------------------------------------------------
const footerOf = (s) => (s.components || []).find((c) => c.type === 'Footer');
const SELECTION_TYPES = new Set(['RadioButtonsGroup', 'CheckboxGroup', 'Dropdown']);

/**
 * Is this selection a branch, or just a question?
 *
 * Only a list whose options declare their own destination steers the flow. A
 * Gender dropdown has options too, but none of them lead anywhere — it's a
 * form field, and treating it as a branch is what made a form screen look
 * like the end of the flow.
 */
const isBranchField = (c) =>
  SELECTION_TYPES.has(c.type)
  && !!c.name
  && (c.options || []).some((o) => o.nextScreen || o.blockId || o.nextFlowId);

/**
 * Did this screen hand the customer on to another screen, given the answers
 * they actually submitted?
 *
 * Asked per submission rather than per screen, because the same screen can
 * both continue and finish depending on which option was chosen: on a menu
 * screen "Book" navigates on, while "My appointments" ends the flow right
 * there. A screen can only be where they finished if the path they took from
 * it goes nowhere.
 */
function navigatesOnward(screen, form = {}) {
  for (const c of screen.components || []) {
    if (!isBranchField(c)) continue;
    const answer = form[c.name];
    if (answer === undefined || answer === null || answer === '') continue;
    const chosen = Array.isArray(answer) ? answer : [answer];
    const picked = (c.options || []).filter((o) => chosen.includes(o.id));
    if (!picked.length) continue;
    // The branch the customer took decides it, and overrides the footer.
    return picked.some((o) => !!o.nextScreen);
  }
  // No branch was taken, so the footer is the only way out. Dynamic lists
  // (categories, members, slots) carry no stored options and always land here.
  return !!footerOf(screen)?.nextScreen;
}

/**
 * The next screen the submitted answers lead to from `screen`, or null when
 * this screen is where the path ends (a chosen option/footer that goes to a
 * block or finishes, or a footer that completes).
 */
function nextScreenFrom(screen, form = {}) {
  for (const c of screen.components || []) {
    if (!isBranchField(c)) continue;
    const answer = form[c.name];
    if (answer === undefined || answer === null || answer === '') continue;
    const chosen = Array.isArray(answer) ? answer : [answer];
    const nav = (c.options || []).find((o) => chosen.includes(o.id) && o.nextScreen);
    if (nav) return nav.nextScreen;
    // The chosen option ends the flow (hands off to a block / another flow).
    if ((c.options || []).some((o) => chosen.includes(o.id) && (o.blockId || o.nextFlowId))) return null;
  }
  const f = footerOf(screen);
  return f?.action === 'navigate' && f.nextScreen ? f.nextScreen : null;
}

/**
 * The screen the customer finished on, found by WALKING the flow along the
 * answers they actually submitted — from the entry screen, following each
 * screen's taken branch (or its footer) until the path ends.
 *
 * This replaces matching by field-name overlap, which was unreliable: the
 * completion payload carries every screen's answers forward, and two screens
 * can share field names (a booking's `preferred_date`/`selected_slot` are also
 * on the reschedule screen), so a booking's answers scored higher on the
 * reschedule screen and "Pay online" ended up sending the reschedule PDF.
 * Walking the real routing can't be fooled by shared names. The old ranking
 * stays as a fallback for a form the walk can't place (no entry, odd wiring).
 */
function walkToSubmissionScreen(flow, form = {}) {
  const byId = new Map((flow.screens || []).map((s) => [s.id, s]));
  let current = byId.get(resolveEntryScreenId(flow)) || (flow.screens || [])[0];
  const seen = new Set();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    const next = nextScreenFrom(current, form);
    if (!next) return current;
    const n = byId.get(next);
    if (!n) return current;
    current = n;
  }
  return current || null;
}

/** Field-name-overlap ranking — fallback only (see walkToSubmissionScreen). */
function rankScreenForSubmission(flow, form = {}) {
  const keys = new Set(Object.keys(form).filter((k) => k !== 'flow_token' && !k.endsWith('_label')));
  const ranked = (flow.screens || [])
    .map((s) => {
      const names = (s.components || []).map((c) => c.name).filter(Boolean);
      return {
        screen: s,
        score: names.filter((n) => keys.has(n)).length,
        ended: !navigatesOnward(s, form),
        wired: !!targetAfterSubmission(s, form),
      };
    })
    .filter((c) => c.score > 0)
    .sort(
      (a, b) =>
        Number(b.ended) - Number(a.ended) ||
        Number(b.wired) - Number(a.wired) ||
        b.score - a.score,
    );
  return ranked.length ? ranked[0].screen : null;
}

function screenForSubmission(flow, form = {}) {
  return walkToSubmissionScreen(flow, form) || rankScreenForSubmission(flow, form);
}

// The map node this submission should continue to, if any.
function targetAfterSubmission(screen, form = {}) {
  if (!screen) return '';
  // A chosen option can hand off to its own block.
  for (const c of screen.components || []) {
    if (!SELECTION_TYPES.has(c.type) || !c.name) continue;
    const answer = form[c.name];
    if (!answer) continue;
    const opt = (c.options || []).find((o) => o.id === answer);
    if (opt?.blockId) return `block_${opt.blockId}`;
    if (opt?.nextFlowId) return `flink_${opt.nextFlowId}`;
  }
  const f = footerOf(screen);
  if (f?.blockId) return `block_${f.blockId}`;
  if (f?.nextFlowId) return `flink_${f.nextFlowId}`;
  return '';
}

/**
 * Continue the conversation after a native Flow submission.
 * @param {object} meta tenant Meta client
 * @param {string} phone sender
 * @param {object} form parsed nfm_reply answers (includes flow_token)
 * @param {object} tokens values for {{…}} substitution in block bodies
 * @returns true when a follow-up block was sent
 */
export async function runFlowCompletion(meta, phone, form = {}, tokens = {}, businessId = '', action = '') {
  const flowId = flowIdFromToken(form.flow_token);
  if (!flowId) return false;
  const flow = await loadFlow(flowId, businessId);
  if (!flow) return false;

  const screen = screenForSubmission(flow, form);
  const target = targetAfterSubmission(screen, form);
  if (!target) {
    // Used to return silently, which looked identical to "the block failed".
    logger.info('flow completion: nothing wired after this screen', {
      flow: flow.name,
      screen: screen?.id || '<no screen matched>',
      answered: Object.keys(form).filter((k) => k !== 'flow_token' && !k.endsWith('_label')),
    });
    return false;
  }

  logger.info('flow completion → follow-up block', {
    flow: flow.name, screen: screen?.id, target, action: action || 'register',
  });
  await resolveAndSend(meta, phone, flow, target, 0, { tokens, businessId, action });
  return true;
}

/**
 * Settle a native payment and continue the conversation.
 *
 * Called from the status webhook, which arrives as its own request minutes
 * after the card was sent and carries only a reference id and an outcome. The
 * order was stamped with the flow and block that asked for the money, so the
 * right branch can be resumed instead of guessing or starting over.
 *
 * Idempotent: Meta and the gateway can both report the same capture, and a
 * customer must not be confirmed twice.
 *
 * @param {'paid'|'failed'} outcome
 * @returns {Promise<boolean>} true when a follow-up was sent
 */
export async function settlePayment(meta, {
  reference, outcome, transactionId = '', businessId = '', amount = null, currency = '',
}) {
  if (!reference || !['paid', 'failed'].includes(outcome)) return false;
  // Only ever settled inside the business the payment arrived for.
  if (!businessId) {
    logger.warn('payment settlement without a business, ignored', { reference, outcome });
    return false;
  }
  const order = await Order.findOne({
    reference: String(reference),
    businessId,
  });
  if (!order) {
    logger.warn('payment settlement: no order for that reference', { reference, outcome });
    return false;
  }
  const already = order.payment?.status;
  if (already === outcome) {
    logger.info('payment settlement ignored, already recorded', { reference, outcome });
    return false;
  }
  // A paid order is never turned back into a failed one by a late or
  // replayed update.
  if (already === 'paid' || order.paid) {
    logger.warn('payment settlement ignored, order already paid', { reference, outcome });
    return false;
  }
  // The amount (and currency) paid must match the order before it counts.
  if (outcome === 'paid' && amount !== null) {
    const due = Number(order.total || 0);
    const wrongAmount = Math.abs(Number(amount) - due) > 0.01;
    const wrongCurrency = currency && order.currency && String(order.currency).toUpperCase() !== currency;
    if (wrongAmount || wrongCurrency) {
      logger.warn('payment settlement refused: amount does not match the order', {
        reference, paid: amount, currency, due, orderCurrency: order.currency || '',
      });
      if (order.businessId) {
        notify(order.businessId, {
          type: 'payment_failed',
          title: `Payment mismatch for ${order.reference}`,
          body: `Received ${money(amount)} but the order total is ${money(due)}. Check it before confirming.`,
          target: { view: 'orders', id: String(order._id), phone: order.phone },
        }).catch(() => {});
      }
      return false;
    }
  }

  // One conditional write: of two copies of the same update arriving
  // together, only the first changes the order (and goes on to confirm).
  const settledAt = new Date();
  const set = {
    'payment.status': outcome,
    'payment.ref': transactionId || order.payment?.ref || '',
    'payment.settledAt': settledAt,
  };
  if (outcome === 'paid') {
    set.paid = true;
    // A paid order is confirmed; an unpaid one keeps whatever it had.
    if (!order.status || order.status === 'pending') set.status = 'confirmed';
  }
  const won = await Order.updateOne(
    { _id: order._id, paid: { $ne: true }, 'payment.status': { $ne: outcome } },
    { $set: set },
  );
  if (!Number(won?.modifiedCount ?? won?.matchedCount ?? 0)) {
    logger.info('payment settlement ignored, recorded by a concurrent update', { reference, outcome });
    return false;
  }
  order.payment = {
    ...(order.payment?.toObject ? order.payment.toObject() : order.payment),
    status: outcome,
    ref: set['payment.ref'],
    settledAt,
  };
  if (set.paid) order.paid = true;
  if (set.status) order.status = set.status;
  // The bell. Fire and forget: the follow-up below must go out regardless.
  if (order.businessId) {
    const who = order.customerName || (order.phone ? `+${order.phone}` : '');
    const target = { view: 'orders', id: String(order._id), phone: order.phone };
    const n = outcome === 'paid'
      ? {
        type: 'payment_received',
        title: `Payment received ${money(order.total)} for ${order.reference}`,
        body: who ? `Paid by ${who}` : '',
      }
      : {
        type: 'payment_failed',
        title: `Payment failed for ${order.reference}`,
        body: `${who ? `${who}'s` : 'The'} payment of ${money(order.total)} was not completed.`,
      };
    notify(order.businessId, { ...n, target }).catch(() => {});
  }

  const phone = order.phone;
  // The CRM's copy of the payment card follows the outcome too.
  await Message.updateMany(
    { 'raw.payment.orderId': String(reference), ...(order.businessId ? { businessId: order.businessId } : {}) },
    { $set: { 'raw.payment.status': outcome === 'paid' ? 'paid' : 'failed' } },
  ).catch(() => {});
  // Update the card itself so it stops reading "Review and pay".
  try {
    await meta.sendOrderStatusUpdate(
      phone,
      reference,
      outcome === 'paid' ? 'completed' : 'canceled',
      outcome === 'paid' ? '✅ Payment received.' : 'Payment was not completed.',
    );
  } catch (err) {
    logger.warn('could not update the order card at Meta', {
      reference, error: err.response?.data?.error?.message || err.message,
    });
  }

  const flow = order.payment?.flowId
    ? await loadFlow(order.payment.flowId, businessId || order.businessId)
    : null;
  const block = flow ? blockById(flow, order.payment.blockId) : null;
  if (!flow || !block) {
    logger.info('payment settled but no flow block to continue from', { reference, outcome });
    return false;
  }
  const target = outcome === 'paid' ? block.nextTarget : block.invalidTarget || block.nextTarget;
  if (!target) {
    logger.info('payment settled but that block has no continuation wired', {
      reference, outcome, block: block.id,
    });
    return false;
  }

  // Everything a confirmation document can ask for, rebuilt from the stored
  // order — this request has none of the conversation's live values.
  const plain = order.toObject();
  const bizId = businessId || String(order.businessId || '');
  const biz = bizId ? await Business.findById(bizId).select('name').lean().catch(() => null) : null;
  const customerName = plain.customerName
    || (await resolveCustomerName(phone, bizId).catch(() => ''));
  // Record it on the order too, so the CRM stops showing "Unnamed".
  if (!plain.customerName && customerName) {
    await Order.updateOne({ _id: order._id }, { $set: { customerName } }).catch(() => {});
  }
  // The order may still hold the raw pin (its lookup was queued). Resolve it
  // now so the paid confirmation slip shows the address.
  if (isCoordsText(plain.deliveryAddress) && Number.isFinite(plain.locationLat)) {
    const address = await addressFor(plain.locationLat, plain.locationLng, { waitMs: 4000 });
    if (address) {
      plain.deliveryAddress = address;
      await Order.updateOne({ _id: order._id }, { $set: { deliveryAddress: address } }).catch(() => {});
    }
  }
  const tokens = {
    ...orderTokens(plain),
    ...orderCartTokens(plain),
    business_name: biz?.name || '',
    customer_name: customerName,
    name: customerName,
    payment_status: outcome === 'paid' ? 'Paid' : 'Not paid',
    // The settlement arrives as its own request, so the booking-time tokens
    // (set in chatbot.js) aren't in scope here. A document rendered on this
    // path still needs {{today}} — without it the "Booked on"/"Generated"
    // lines came out blank on the online path.
    today: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'numeric', year: 'numeric' }),
  };
  logger.info('payment settled → continuing the flow', { reference, outcome, target });
  await resolveAndSend(meta, phone, flow, target, 0, {
    tokens,
    businessId: businessId || String(order.businessId || ''),
  });
  return true;
}

export { fillTokens };
export default { runFlowMap, runFlowCompletion, settlePayment, fillTokens };
