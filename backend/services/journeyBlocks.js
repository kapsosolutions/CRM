// Journey blocks that send an approved template or the business's own data:
// its catalog, categories, members (doctors, stylists, rooms… whatever the
// business type calls them), their free times, bookings, orders and offers.
// WhatsApp journeys only (the Instagram / Messenger runner refuses them).
//
// Loaded by journeyRuntime.js only when one of these blocks runs.
//
// Each sender returns what the walk does next:
//   'wait'          the block asked a question (a list, a catalog): park here
//   'continue'      follow the block's next connection
//   'stop'          send nothing more for this message
//   { handle }      follow that output only ('pick', 'ok', 'full', 'none', '')
//
// Choices made in these blocks are kept in `tokens` (journeyRuntime saves
// them with the chat), so later blocks can use them: the members of the
// category picked, the free times of the member picked, the booking of the
// time picked, and {{category}}, {{member}}, {{appointment_date}},
// {{appointment_slot}}, {{order_id}} in any text.
//
// List rows are encoded n:<block>:<what>:<value> (journeyRuntime routes the
// tap back here, see onBusinessReply):
//   cat:<categoryId> · mem:<memberId> · day:<memberId>.<YYYYMMDD>
//   more:<memberId>.<YYYYMMDD>.<page> · slot:<memberId>.<YYYYMMDDHHMM>
// The member travels in the row id so an older list still books the right one.
import Business from '../models/Business.js';
import Category from '../models/Category.js';
import Member from '../models/Member.js';
import Offer from '../models/Offer.js';
import Order from '../models/Order.js';
import Product from '../models/Product.js';
import Registration from '../models/Registration.js';
import Template from '../models/Template.js';
import { buildCategorySections } from './catalog.js';
import { cartTokens } from './cart.js';
import { availableSlots, bookedCounts, todayISO, to12h } from './slots.js';
import { ensureOrder, makeOrderReference } from './orders.js';
import { orderTokens } from './flowRuntime.js';
import { isLive } from './offers.js';
import { notify } from './notifications.js';
import { templateSendOptions } from './templateTriggers.js';
import { placeholderIndexes } from './templateVars.js';
import { tenantHasFeature } from './planGate.js';
import { fillTokens } from './tokens.js';
import logger from './logger.js';

/** The kinds this module sends (besides 'template'). */
export const BUSINESS_KINDS = ['catalog', 'categories', 'members', 'slots', 'book', 'order', 'offers'];

const LIST_ROWS = 10; // WhatsApp list messages: at most 10 rows
const DAYS_MIN = 1;
const DAYS_MAX = 14;
const ID_RE = /^[a-f0-9]{24}$/i;
const scope = (businessId) => (businessId ? { businessId } : {});
const digits = (s) => String(s || '').replace(/\D/g, '');
const norm = (s) => String(s || '').trim().toLowerCase();
const rupees = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const fill = (text, tokens) => fillTokens(String(text || ''), tokens).trim();

/** The output a block has a connection on (exact port). */
const wired = (ctx, node, handle) => (ctx?.journey?.edges || []).some((e) => e.source === node.id && (e.sourceHandle || '') === handle);

/** 'YYYY-MM-DD' ↔ 'YYYYMMDD' (row ids can't carry '-'… they can, but stay short). */
const compact = (iso) => String(iso).replace(/-/g, '');
const isoOf = (ymd) => (/^\d{8}$/.test(ymd) ? `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}` : '');
const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
/** "Mon, 6 Oct" (a list row) / "Mon, 6 Oct 2026" (a message). */
export function dayLabel(iso, withYear = false) {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return String(iso || '');
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) });
}

async function loadMember(id, businessId) {
  if (!ID_RE.test(String(id || ''))) return null;
  const m = await Member.findOne({ _id: String(id), ...scope(businessId) }).lean().catch(() => null);
  return m && m.active !== false ? m : null;
}

/** The member a block works with: the one chosen, or the only one there is. */
async function memberFor(tokens, businessId) {
  const chosen = await loadMember(tokens.member_id, businessId);
  if (chosen) return chosen;
  const all = await Member.find({ ...scope(businessId), active: { $ne: false } }).limit(2).lean().catch(() => []);
  return all.length === 1 ? all[0] : null;
}

/** The member's values as {{tokens}}. */
function memberTokens(m) {
  const fee = Number(m.fee) || 0;
  return {
    member: m.name,
    member_name: m.name,
    member_id: String(m._id),
    member_fee: fee > 0 ? rupees(fee) : '',
    member_fee_value: fee,
    ...(m.category ? { category: m.category } : {}),
  };
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

/** The template's buttons (Meta's components), in order. */
const templateButtons = (tpl) => ((tpl?.components || []).find((c) => String(c?.type).toUpperCase() === 'BUTTONS')?.buttons || []);
const isQuick = (b) => String(b?.type || '').toUpperCase() === 'QUICK_REPLY';

/**
 * The approved template, sent the way a campaign sends it: in its own
 * language, with its header media and its {{n}} values filled from live data
 * (the block can set any value itself, with journey tokens). Each quick-reply
 * button carries n:<block>:tbtn:<i>, so a tap continues from that button's
 * output. With quick-reply outputs wired the block continues along "Next"
 * straight away (or waits there when Next isn't connected).
 */
export async function sendTemplateBlock(meta, phone, node, tokens = {}, ctx = {}) {
  const d = node.data || {};
  const businessId = ctx.businessId || null;
  const hasQuick = (ctx.journey?.edges || []).some((e) => e.source === node.id && /^tbtn-\d+$/.test(e.sourceHandle || ''));
  const after = hasQuick ? (wired(ctx, node, '') ? { handle: '' } : 'wait') : 'continue';
  const skip = hasQuick ? { handle: '' } : 'continue';
  if (!d.templateName) return skip;

  const tpl = await Template.findOne({ ...scope(businessId), name: d.templateName }).lean().catch(() => null);
  if (!tpl || String(tpl.status).toUpperCase() !== 'APPROVED') {
    logger.warn('journey template step skipped: the template is not approved (or was deleted)', { template: d.templateName, status: tpl?.status || 'missing' });
    return skip;
  }
  try {
    const business = businessId ? await Business.findById(businessId).lean().catch(() => null) : null;
    const order = ID_RE.test(String(tokens.order_db_id || ''))
      ? await Order.findOne({ _id: String(tokens.order_db_id), ...scope(businessId) }).lean().catch(() => null)
      : null;
    const opts = await templateSendOptions(tpl, {
      phone,
      business,
      ...(order ? { order } : {}),
      appointment: { memberName: tokens.member || '', dateLabel: tokens.appointment_date || '', slotLabel: tokens.appointment_slot || '' },
    });
    // The block's own values for {{1}}, {{2}}…: journey tokens like {{name}},
    // {{member}}, {{appointment_date}}. Empty = the template's own mapping.
    const vars = d.templateVars && typeof d.templateVars === 'object' ? d.templateVars : {};
    const indexes = placeholderIndexes(tpl.bodyText);
    if (indexes.length && String(tpl.category).toUpperCase() !== 'AUTHENTICATION') {
      opts.bodyParams = indexes.map((n, k) => {
        const own = String(vars[n] ?? vars[String(n)] ?? '').trim();
        const v = own ? oneLine(fillTokens(own, tokens)) : '';
        return v || opts.bodyParams?.[k] || '-';
      });
    }
    // The block's header media replaces the template's stored one.
    const fmt = String(tpl.headerFormat || '').toLowerCase();
    if (/^https:\/\/\S+$/i.test(String(d.templateMediaUrl || '')) && ['image', 'video', 'document'].includes(fmt)) {
      opts.headerImageUrl = d.templateMediaUrl;
      opts.headerFormat = fmt;
      if (fmt === 'document') opts.headerFileName = d.templateFileName || tpl.headerFileName || 'Document.pdf';
    }
    const quick = templateButtons(tpl)
      .map((b, i) => (isQuick(b) ? { index: i, payload: `n:${node.id}:tbtn:${i}` } : null))
      .filter(Boolean);
    if (quick.length) opts.quickReplies = quick;
    await meta.sendTemplate(phone, tpl.name, opts);
    logger.info('journey template sent', { template: tpl.name, language: opts.languageCode, params: (opts.bodyParams || []).length });
    return after;
  } catch (err) {
    // The shared test number has no templates; a refused template mustn't
    // leave the customer with nothing either: the journey carries on.
    if (err.code === 'SANDBOX_UNSUPPORTED') {
      logger.info('journey template step skipped on the shared test number', { template: d.templateName });
    } else {
      logger.error('journey template send failed', { template: d.templateName, error: err.response?.data?.error?.message || err.message });
    }
    return skip;
  }
}

/** A typed-back tap on a template sent without our payload: which quick reply it was. */
export async function templateButtonIndex(node, text, businessId) {
  const name = node?.data?.templateName;
  const t = norm(text);
  if (!name || !t) return -1;
  const tpl = await Template.findOne({ ...scope(businessId), name }).lean().catch(() => null);
  return templateButtons(tpl).findIndex((b) => isQuick(b) && norm(b.text) === t);
}

// ---------------------------------------------------------------------------
// The business's data
// ---------------------------------------------------------------------------

/** A text list of products, when the WhatsApp catalog can't be shown. */
async function productLines(businessId, category) {
  const q = { ...scope(businessId), active: true, ...(category ? { categories: category } : {}) };
  const rows = await Product.find(q).sort({ createdAt: -1 }).limit(LIST_ROWS).lean().catch(() => []);
  return rows
    .filter((p) => p.inStock !== false && !p.isPaused)
    .map((p) => {
      const price = Number(p.price) || Number(p.variants?.[0]?.price) || 0;
      return `• ${p.name}${price ? ` · ${rupees(price)}` : ''}`;
    });
}

async function sendCatalog(meta, phone, node, tokens, ctx) {
  const d = node.data || {};
  const businessId = ctx.businessId;
  // '' = the category the customer chose (else everything), '*' = everything.
  const category = d.catalogCategory === '*' ? '' : String(d.catalogCategory || tokens.category || '').trim();
  const text = fill(d.text, tokens);
  const business = businessId ? await Business.findById(businessId).lean().catch(() => null) : null;
  const built = business?.catalogId ? await buildCategorySections(business, category).catch(() => null) : null;
  if (built) {
    try {
      await meta.sendProductList(phone, {
        catalogId: business.catalogId,
        header: built.title,
        body: text || `Browse our ${built.title}.`,
        footer: business.name || '',
        sections: built.sections,
      });
      logger.info('journey catalog sent', { category: built.title, items: built.total });
      // The cart is the answer: it arrives as an `order` message.
      return 'wait';
    } catch (err) {
      if (err.code !== 'SANDBOX_UNSUPPORTED') {
        logger.error('journey catalog send failed', { error: err.response?.data?.error?.message || err.message });
      }
    }
  } else {
    logger.warn('journey catalog: no WhatsApp catalog to show (not connected or nothing synced)', { businessId, category });
  }
  // The products as text: something to read rather than silence. No cart can
  // come from it, so the journey stops here.
  const lines = await productLines(businessId, category);
  const body = [text, lines.length ? lines.join('\n') : (category ? `No items in ${category} right now.` : 'No items available right now.')]
    .filter(Boolean).join('\n\n');
  await meta.sendText(phone, body.slice(0, 4000));
  return 'stop';
}

async function sendCategories(meta, phone, node, tokens, ctx) {
  const d = node.data || {};
  const cats = await Category.find({ ...scope(ctx.businessId), active: { $ne: false } }).sort({ order: 1, name: 1 }).limit(LIST_ROWS).lean().catch(() => []);
  // Nothing to choose from: carry on as if one had been chosen (the members
  // list then shows everyone).
  if (!cats.length) {
    logger.warn('journey categories: the business has no categories', { businessId: ctx.businessId });
    return { handle: 'pick' };
  }
  await meta.sendList(phone, {
    body: fill(d.text, tokens) || 'Please choose one:',
    buttonText: d.listTitle || 'Choose',
    rows: cats.map((c) => ({ id: `n:${node.id}:cat:${c._id}`, title: oneLine(c.name).slice(0, 24) })),
  });
  return 'wait';
}

async function sendMembers(meta, phone, node, tokens, ctx) {
  const d = node.data || {};
  let docs = await Member.find({ ...scope(ctx.businessId), active: { $ne: false } }).sort({ order: 1, name: 1 }).lean().catch(() => []);
  const category = String(tokens.category || '').trim();
  if (category) docs = docs.filter((m) => norm(m.category) === norm(category));
  if (!docs.length) {
    if (category) {
      await meta.sendText(phone, `Sorry, nothing is available in ${category} right now.`);
      return 'stop';
    }
    logger.warn('journey members: the business has no members', { businessId: ctx.businessId });
    return { handle: 'pick' };
  }
  await meta.sendList(phone, {
    body: fill(d.text, tokens) || 'Please choose one:',
    buttonText: d.listTitle || 'Choose',
    rows: docs.slice(0, LIST_ROWS).map((m) => {
      const fee = Number(m.fee) > 0 ? rupees(m.fee) : '';
      const mins = Number(m.duration) > 0 ? `${m.duration} min` : '';
      return {
        id: `n:${node.id}:mem:${m._id}`,
        title: oneLine(m.name).slice(0, 24),
        description: [m.title, fee, mins].filter(Boolean).join(' · ').slice(0, 72),
      };
    }),
  });
  return 'wait';
}

const daysOf = (d) => Math.min(DAYS_MAX, Math.max(DAYS_MIN, Math.round(Number(d?.days) || 7)));

/** "No free time": the block's own branch, or a line of text when it has none. */
async function noTime(meta, phone, node, ctx, text) {
  if (!wired(ctx, node, 'none')) await meta.sendText(phone, text);
  return { handle: 'none' };
}

/** The days with free times, as a list (step 1 of the Date & time block). */
async function sendDays(meta, phone, node, tokens, ctx, note = '') {
  const d = node.data || {};
  const m = await memberFor(tokens, ctx.businessId);
  if (!m) return noTime(meta, phone, node, ctx, 'Please choose who you’d like to book first.');
  Object.assign(tokens, memberTokens(m));
  const days = daysOf(d);
  const today = todayISO();
  const dates = Array.from({ length: days }, (_, i) => addDays(today, i));
  const free = await Promise.all(dates.map((iso) => availableSlots({ member: m, isoDate: iso, businessId: ctx.businessId }).catch(() => [])));
  const open = dates.map((iso, i) => ({ iso, slots: free[i] })).filter((x) => x.slots.length).slice(0, LIST_ROWS);
  if (!open.length) {
    return noTime(meta, phone, node, ctx, `Sorry, ${m.name} has no free times in the next ${days} day${days === 1 ? '' : 's'}.`);
  }
  await meta.sendList(phone, {
    body: [note, fill(d.text, tokens) || `Pick a day for ${m.name}:`].filter(Boolean).join('\n\n'),
    buttonText: d.listTitle || 'Pick a day',
    rows: open.map(({ iso, slots }) => ({
      id: `n:${node.id}:day:${m._id}.${compact(iso)}`,
      title: iso === today ? `Today, ${dayLabel(iso).replace(/^\w+, /, '')}` : dayLabel(iso),
      description: `${slots.length} free time${slots.length === 1 ? '' : 's'} · from ${slots[0].label}`,
    })),
  });
  return 'wait';
}

/** The free times on a day, 10 to a list (9 and "Later times" when there are more). */
async function sendTimes(meta, phone, node, tokens, ctx, m, iso, page = 0, note = '') {
  const slots = await availableSlots({ member: m, isoDate: iso, businessId: ctx.businessId }).catch(() => []);
  if (!slots.length) return sendDays(meta, phone, node, tokens, ctx, 'That day just filled up. Please pick another day.');
  const per = slots.length > LIST_ROWS ? LIST_ROWS - 1 : LIST_ROWS;
  const start = Math.min(page * per, Math.max(0, slots.length - 1));
  const shown = slots.slice(start, start + per);
  const rows = shown.map((s) => ({
    id: `n:${node.id}:slot:${m._id}.${compact(iso)}${s.start.replace(':', '')}`,
    title: s.label,
    ...(Number(m.slotCapacity) > 1 ? { description: `${s.left} place${s.left === 1 ? '' : 's'} left` } : {}),
  }));
  if (start + per < slots.length) rows.push({ id: `n:${node.id}:more:${m._id}.${compact(iso)}.${page + 1}`, title: 'Later times', description: `${slots.length - start - per} more` });
  Object.assign(tokens, memberTokens(m), { date: iso });
  await meta.sendList(phone, {
    body: [note, `Free times with ${m.name} on ${dayLabel(iso, true)}:`].filter(Boolean).join('\n\n'),
    buttonText: 'Pick a time',
    rows,
  });
  return 'wait';
}

/** The booking the journey has collected: Registration + Order, as the Bookings API makes it. */
async function sendBook(meta, phone, node, tokens, ctx) {
  const d = node.data || {};
  const businessId = ctx.businessId;
  const failText = fill(d.failText, tokens) || 'Sorry, that time was just taken. Please pick another time.';
  const fail = async (why) => {
    logger.info('journey booking not made', { businessId, why });
    if (!wired(ctx, node, 'full')) await meta.sendText(phone, failText);
    return { handle: 'full' };
  };
  // The Appointments page (bookings) is a Pro feature.
  if (businessId && !(await tenantHasFeature(businessId, 'orders').catch(() => true))) return fail('plan without orders');
  const m = await loadMember(tokens.member_id, businessId);
  const date = String(tokens.date || '');
  const slot = String(tokens.slot || '');
  if (!m || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(slot)) return fail('member, day or time not chosen');
  const free = await availableSlots({ member: m, isoDate: date, businessId });
  if (!free.some((s) => s.start === slot)) return fail('slot no longer free');

  const name = oneLine(tokens.customer_name || tokens.name || '').slice(0, 120);
  const ph = digits(phone);
  const reg = await Registration.create({
    ...scope(businessId),
    phone: ph,
    name,
    date,
    slot,
    category: m.category || tokens.category || '',
    memberId: String(m._id),
    memberName: m.name,
    action: 'register',
    status: 'new',
    fields: { source: 'journey' },
    flowName: 'Journey',
  });
  // Two customers racing for the last place: the later one gives it back.
  const capacity = Number(m.slotCapacity) > 0 ? Math.floor(Number(m.slotCapacity)) : 1;
  const taken = (await bookedCounts(businessId, m._id, date)).get(slot) || 0;
  if (taken > capacity) {
    await Registration.deleteOne({ _id: reg._id, ...scope(businessId) });
    return fail('slot taken at the same moment');
  }
  const business = businessId ? await Business.findById(businessId).select('name').lean().catch(() => null) : null;
  const fee = Number(m.fee) || 0;
  const order = await Order.create({
    ...scope(businessId),
    reference: makeOrderReference(business?.name || ''),
    kind: 'booking',
    scheduledAt: new Date(`${date}T${slot}:00`),
    registrationId: String(reg._id),
    member: m.name,
    customerName: name,
    phone: ph,
    items: [{ name: m.name, qty: 1, price: fee }],
    total: fee,
    status: 'confirmed',
    paymentMethod: '',
    category: m.category || tokens.category || '',
    paid: false,
  });
  const o = order.toObject ? order.toObject() : order;
  await Registration.updateOne({ _id: reg._id }, { $set: { orderId: String(o._id), orderRef: o.reference } });
  if (businessId) {
    notify(businessId, {
      type: 'booking_new',
      title: 'New booking',
      body: [name || `+${ph}`, m.name, `${date} ${to12h(slot)}`, 'via WhatsApp'].join(' · '),
      target: { view: 'orders', id: String(o._id), phone: ph },
    }).catch(() => {});
  }
  Object.assign(tokens, orderTokens(o), { order_db_id: String(o._id), registration_id: String(reg._id) });
  logger.info('journey booking created', { businessId, member: m.name, date, slot, reference: o.reference });
  const text = fill(d.text, tokens);
  if (text) await meta.sendText(phone, text);
  return { handle: 'ok' };
}

/** The cart the customer sent becomes an order (Orders page). */
async function sendOrder(meta, phone, node, tokens, ctx) {
  const d = node.data || {};
  const businessId = ctx.businessId;
  if (!Array.isArray(tokens.cart_lines) || !tokens.cart_lines.length) {
    logger.info('journey place-order: no cart in this chat yet', { businessId });
    return 'continue';
  }
  if (businessId && !(await tenantHasFeature(businessId, 'orders').catch(() => true))) {
    // Orders are a Pro feature: the cart is in the chat for the team to handle.
    logger.info('journey place-order skipped: the plan has no Orders page', { businessId });
    await meta.sendText(phone, 'Thanks! We’ve received your cart and will confirm it shortly.');
    return 'continue';
  }
  const business = businessId ? await Business.findById(businessId).select('name').lean().catch(() => null) : null;
  const patch = await ensureOrder({ tokens, businessId, phone, businessName: business?.name || '' });
  Object.assign(tokens, patch);
  const text = fill(d.text, tokens);
  if (text) await meta.sendText(phone, text);
  return 'continue';
}

/** The live offers (Offers page), as one message. */
async function sendOffers(meta, phone, node, tokens, ctx) {
  const d = node.data || {};
  const rows = await Offer.find({ ...scope(ctx.businessId), active: true }).sort({ createdAt: -1 }).lean().catch(() => []);
  const live = rows.filter((o) => isLive(o)).slice(0, 5);
  const blocks = live.map((o) => {
    const items = (o.items || []).slice(0, 6).map((it) => {
      const opt = it.subLabel || it.label;
      const was = Number(it.originalPrice) || 0;
      const now = Number(it.offerPrice) || 0;
      const price = now ? `${was > now ? `~${rupees(was)}~ ` : ''}*${rupees(now)}*` : '';
      return `• ${it.productName || 'Item'}${opt ? ` (${opt})` : ''}${price ? `: ${price}` : ''}`;
    });
    const ends = o.endsAt ? `Ends ${new Date(o.endsAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : '';
    return [`🏷️ *${oneLine(o.title)}*`, ...items, ends].filter(Boolean).join('\n');
  });
  const body = [fill(d.text, tokens), blocks.length ? blocks.join('\n\n') : 'No offers are running right now.'].filter(Boolean).join('\n\n');
  await meta.sendText(phone, body.slice(0, 4000));
  return 'continue';
}

/** Send one of BUSINESS_KINDS. */
export async function sendBusinessBlock(meta, phone, node, tokens = {}, ctx = {}) {
  switch (node?.data?.kind) {
    case 'catalog': return sendCatalog(meta, phone, node, tokens, ctx);
    case 'categories': return sendCategories(meta, phone, node, tokens, ctx);
    case 'members': return sendMembers(meta, phone, node, tokens, ctx);
    case 'slots': return sendDays(meta, phone, node, tokens, ctx);
    case 'book': return sendBook(meta, phone, node, tokens, ctx);
    case 'order': return sendOrder(meta, phone, node, tokens, ctx);
    case 'offers': return sendOffers(meta, phone, node, tokens, ctx);
    default: return 'continue';
  }
}

/**
 * A tap on one of these blocks' list rows (`what`/`value` from its id).
 * Updates `tokens` with the choice and returns what the walk does next, as a
 * sender does ('wait' when it asked the next question itself).
 */
export async function onBusinessReply(meta, phone, node, what, value, tokens = {}, ctx = {}) {
  const businessId = ctx.businessId;
  switch (what) {
    case 'cat': {
      const c = ID_RE.test(value) ? await Category.findOne({ _id: value, ...scope(businessId) }).lean().catch(() => null) : null;
      if (c) Object.assign(tokens, { category: c.name, category_id: String(c._id) });
      // A new category: the member chosen before belongs to another one.
      delete tokens.member_id;
      return { handle: 'pick' };
    }
    case 'mem': {
      const m = await loadMember(value, businessId);
      if (!m) {
        await meta.sendText(phone, 'Sorry, that choice isn’t available any more.');
        return sendMembers(meta, phone, node, tokens, ctx);
      }
      Object.assign(tokens, memberTokens(m));
      return { handle: 'pick' };
    }
    case 'day':
    case 'more': {
      const [mid, ymd, page] = value.split('.');
      const m = await loadMember(mid, businessId);
      const iso = isoOf(ymd || '');
      if (!m || !iso) return sendDays(meta, phone, node, tokens, ctx);
      return sendTimes(meta, phone, node, tokens, ctx, m, iso, what === 'more' ? Math.max(0, Number(page) || 0) : 0);
    }
    case 'slot': {
      const [mid, stamp = ''] = value.split('.');
      const m = await loadMember(mid, businessId);
      const iso = isoOf(stamp.slice(0, 8));
      const hhmm = /^\d{4}$/.test(stamp.slice(8)) ? `${stamp.slice(8, 10)}:${stamp.slice(10, 12)}` : '';
      if (!m || !iso || !hhmm) return sendDays(meta, phone, node, tokens, ctx);
      const free = await availableSlots({ member: m, isoDate: iso, businessId }).catch(() => []);
      if (!free.some((s) => s.start === hhmm)) {
        return sendTimes(meta, phone, node, tokens, ctx, m, iso, 0, 'Sorry, that time was just taken.');
      }
      Object.assign(tokens, memberTokens(m), {
        date: iso,
        slot: hhmm,
        appointment_date: dayLabel(iso, true),
        appointment_slot: to12h(hhmm),
      });
      return { handle: 'pick' };
    }
    default:
      return 'stop';
  }
}

/** {{tokens}} for a cart the customer sent (cart.js). */
export const cartTokensFor = (cart, businessId) => cartTokens(cart, businessId);
