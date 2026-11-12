import crypto from 'crypto';
// Runtime data + navigation for endpoint-mode flows. Serves dynamic screen data
// (e.g. the business's categories as a radio list with 1:1 images) and decides
// the next screen from the user's selection (per-option branching).
import Flow from '../models/Flow.js';
import Category from '../models/Category.js';
import Member from '../models/Member.js';
import Order from '../models/Order.js';
import { prefillKeysOf, dynamicTextKey, textHasToken } from './flowJson.js';
import { resizedBase64Cached, THUMB } from './flowImages.js';
import {
  availableSlots, memberFromSelection, appointmentFromSelection, upcomingAppointments,
  unavailableDatesFor, toISODate, toMinutes, to12h,
} from './slots.js';
import logger from './logger.js';
import { statusLabel } from './verticals.js';

const SELECTION = new Set(['RadioButtonsGroup', 'CheckboxGroup', 'Dropdown']);

const slug = (s) =>
  String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

// Row thumbnails go through the same resizer as the published Flow JSON: Meta
// budgets roughly 300 KB for all images in one response and won't render an
// oversized one, so a full-resolution upload (a 1080×1080 category photo is
// ~100 KB on its own) has to be downscaled to the 180×180 1:1 thumbnail box.
const thumb = (url) => (url ? resizedBase64Cached(url, THUMB) : Promise.resolve(''));

// ---------------------------------------------------------------------------
// Data sources for native Flow screens.
//
// Every one of these is scoped to the owning tenant, taken from the flow that
// is being rendered (`flow.businessId`). Unscoped, a customer opening a menu
// saw every business's categories, members and — worse — every business's
// orders under "My orders".
// ---------------------------------------------------------------------------
const tenant = (businessId) => (businessId ? { businessId } : {});

// Build the categories data-source rows (id/title/description/image base64).
export async function buildCategories(businessId, limit = 20) {
  const cats = await Category.find(tenant(businessId)).sort({ order: 1, name: 1 }).limit(limit).lean();
  // Encode in parallel — Meta times the endpoint out, so a serial fetch per row
  // is a real risk once a business has a dozen categories.
  const images = await Promise.all(cats.map((c) => thumb(c.imageUrl)));
  return cats.map((c, i) => ({
    id: slug(c.name) || String(c._id),
    title: c.name,
    description: '',
    image: images[i],
  }));
}

// Build the members data-source rows (doctors / agents / staff …). When the
// customer already picked a category on an earlier screen, only that category's
// members are returned — e.g. "Cardiology" → just the cardiologists.
export async function buildMembers(businessId, categorySlug = '', limit = 20) {
  const docs = await Member.find({ ...tenant(businessId), active: { $ne: false } })
    .sort({ order: 1, name: 1 })
    .lean();
  const wanted = slug(categorySlug);
  const filtered = wanted ? docs.filter((m) => slug(m.category) === wanted) : docs;
  const picked = filtered.slice(0, limit);
  const images = await Promise.all(picked.map((m) => thumb(m.imageUrl)));
  return picked.map((m, i) => {
    // e.g. "Cardiologist · ₹500 · 20 min"
    const fee = Number(m.fee) > 0 ? `₹${Number(m.fee).toLocaleString('en-IN')}` : '';
    const mins = Number(m.duration) > 0 ? `${m.duration} min` : '';
    return {
      id: `mem_${m._id}`,
      title: m.name,
      description: [m.title, fee, mins].filter(Boolean).join(' · ') || m.description || '',
      image: images[i],
    };
  });
}

// What the customer reads for a status: a booking that's done is "Completed",
// an order "Delivered" (services/verticals.js).
const statusText = (o) => statusLabel(o?.status, o?.kind);

// Build the orders data-source rows for a given customer (by phone, if known).
export async function buildOrders(businessId, phone, limit = 15) {
  const q = { ...tenant(businessId) };
  if (phone) q.phone = String(phone).replace(/\D/g, '');
  const docs = await Order.find(q).sort({ createdAt: -1 }).limit(limit).lean();
  return docs.map((o) => ({
    id: `ord_${o.reference || o._id}`,
    title: `${o.reference || 'Order'} — ₹${Number(o.total || 0).toLocaleString('en-IN')}`,
    description: statusText(o),
  }));
}

// Orders a customer can still act on — anything not finished or already
// cancelled. Used by the "Cancel order" flow so a customer is never offered a
// delivered or cancelled order.
export const CLOSED_STATUSES = ['delivered', 'cancelled'];

const orderDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'numeric', year: 'numeric' }) : '';
// The rupee sign, matching the cart and payment tokens. This used to be "Rs."
// because the PDF renderer's built-in Helvetica can't draw ₹ — services/pdfDoc
// now substitutes it on the way into a document, so chat can read properly
// without breaking receipts.
const rupees = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

/** Rows like "DVN-B2C-1AA1F8 - Rs.189" / "Confirmed - 15/8/2026". */
export async function buildActiveOrders(businessId, phone, limit = 15) {
  // Paid orders/bookings are deliberately excluded: once money has changed
  // hands a self-service cancel would need a refund, so those are left off the
  // cancel picker and can only be handled by the business. Only unpaid records
  // are cancellable.
  const q = { ...tenant(businessId), status: { $nin: CLOSED_STATUSES }, paid: { $ne: true } };
  if (phone) q.phone = String(phone).replace(/\D/g, '');
  const docs = await Order.find(q).sort({ createdAt: -1 }).limit(limit).lean();
  return docs.map((o) => ({
    // Always key on _id so the runtime can resolve the exact order to cancel.
    id: `ord_${o._id}`,
    title: `${o.reference || 'Order'} - ${rupees(o.total)}`,
    description: `${statusText(o)} - ${orderDate(o.scheduledAt || o.createdAt)}`,
  }));
}

/**
 * Resolve an "ord_…" selection back to its Order (by _id, else reference).
 *
 * Tenant-scoped because the value comes off the wire: it's whatever the client
 * submitted, so an unscoped lookup let a crafted reference reach — and cancel —
 * another business's order.
 */
export async function orderFromSelection(value, businessId) {
  const raw = String(value || '').replace(/^ord_/, '');
  if (!raw) return null;
  try {
    if (/^[a-f0-9]{24}$/i.test(raw)) {
      const byId = await Order.findOne({ _id: raw, ...tenant(businessId) }).lean();
      if (byId) return byId;
    }
    return await Order.findOne({ reference: raw, ...tenant(businessId) }).lean();
  } catch {
    return null;
  }
}

/** Human label for an order selection, e.g. "DVN-B2C-1AA1F8 - Rs.189". */
export async function orderLabel(value, businessId) {
  const o = await orderFromSelection(value, businessId);
  if (!o) return '';
  return `${o.reference || 'Order'} - ${rupees(o.total)}`;
}

/**
 * The cart tokens ({{cart_items}}, {{items_total}}, {{total_payable}} …)
 * rebuilt from a stored order.
 *
 * During a conversation these come from the customer's live cart. But a
 * confirmation sent after ONLINE payment is driven by the payment webhook — a
 * separate request minutes later with none of that conversation state — so
 * without this the order slip printed "Items ()" with an empty list and blank
 * totals. Same formatting as services/cart.js so both paths read identically.
 */
export function orderCartTokens(o) {
  if (!o) return {};
  const items = o.items || [];
  if (!items.length) return {};
  const subtotal = items.reduce((n, i) => n + (Number(i.price) || 0) * (Number(i.qty) || 1), 0);
  const delivery = Number(o.deliveryFee) || 0;
  const total = Number(o.total) || subtotal + delivery;
  return {
    cart_items: items.map((i) => `${i.qty || 1} x ${i.name} - ${rupees((Number(i.price) || 0) * (Number(i.qty) || 1))}`).join('\n'),
    cart_count: String(items.reduce((n, i) => n + (Number(i.qty) || 1), 0)),
    items_total: rupees(subtotal),
    delivery_fee: delivery > 0 ? rupees(delivery) : 'FREE',
    total_payable: rupees(total),
  };
}

/** Order fields exposed to message-block and PDF tokens like {{order_id}}. */
export function orderTokens(o) {
  if (!o) return {};
  return {
    order_id: o.reference || String(o._id),
    order_ref: o.reference || String(o._id),
    order_total: rupees(o.total),
    order_status: statusText(o),
    order_date: orderDate(o.scheduledAt || o.createdAt),
    // When the booking was actually made, for the document's "Booked on" line.
    // Distinct from order_date (which prefers the appointment day) and from
    // {{today}} (the render moment) — this is the creation date, full stop.
    booked_on: orderDate(o.createdAt),
    order_items: (o.items || []).map((i) => `${i.qty}× ${i.name}`).join(', '),
    customer_name: o.customerName || '',
    // Payment + cancellation details, for receipts and cancellation slips.
    // `amount_paid` reads the paid figure once the order is settled (online),
    // or "Not paid" otherwise (e.g. pay-at-hospital) — so a document can show
    // how much was actually collected.
    amount_paid: o.paid ? rupees(o.total) : 'Not paid',
    payment_status: o.paid ? 'Paid' : 'Not paid',
    cancelled_date: o.cancelledAt ? orderDate(o.cancelledAt) : '',

    // Details recorded ON the order when it was placed.
    //
    // These were missing, which is why an "Order details" block showed no
    // address: {{delivery_address}} is normally supplied by an Ask location
    // block *during* a conversation, but a block reporting an order the
    // customer picked from a list has no location step to read — the values
    // live on the stored order and nothing exposed them. Every one of these
    // was already saved; none of them could be shown.
    delivery_address: o.deliveryAddress || '',
    location_url: o.locationUrl || '',
    payment_method: o.paymentMethod || '',
    delivery_fee: Number(o.deliveryFee) > 0 ? rupees(o.deliveryFee) : '',
    category: o.category || '',
    customer_phone: o.phone ? `+${o.phone}` : '',

    // Booking specifics. A confirmation sent after online payment is driven by
    // the payment webhook, which has none of the live flow answers — so these
    // have to come off the stored order or {{member}}, the date and the time
    // all resolve to nothing and their lines are silently dropped. The member
    // falls back to the booking's single line when it wasn't stored on older
    // orders; the date and time are read back out of scheduledAt in the same
    // local zone they were written in.
    ...bookingTokens(o),
  };
}

/**
 * {{member}}, {{appointment_date}} and {{appointment_slot}} for a booking.
 * Empty object for an ordinary order, so nothing extra is added there.
 */
function bookingTokens(o) {
  const isBooking = o.kind === 'booking' || !!o.scheduledAt;
  if (!isBooking) return {};
  const member = o.member || (o.items || [])[0]?.name || '';
  let appointment_date = '';
  let appointment_slot = '';
  if (o.scheduledAt) {
    const d = new Date(o.scheduledAt);
    if (!Number.isNaN(d.getTime())) {
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      appointment_date = dateLabel(iso);
      appointment_slot = to12h(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
    }
  }
  return {
    member,
    appointment_date,
    appointment_slot,
    gender: o.gender || '',
    age: o.age || '',
  };
}

const branchFieldOf = (screen) =>
  (screen.components || []).find((c) => SELECTION.has(c.type) && (c.options || []).some((o) => o.nextScreen));
const navTargetOf = (screen) => {
  const f = (screen.components || []).find((c) => c.type === 'Footer');
  return f && f.action === 'navigate' && f.nextScreen ? f.nextScreen : null;
};
const dynamicSourcesOf = (screen) =>
  [...new Set((screen.components || []).filter((c) => c.source && c.source !== 'static').map((c) => c.source))];

// Dynamic data a screen needs rendered (categories, members, orders). `form`
// holds the answers collected so far, so a members list can narrow itself to
// the category the customer just chose.
async function dataForScreen(screen, phone, form = {}, businessId) {
  const data = {};
  for (const src of dynamicSourcesOf(screen || {})) {
    if (src === 'categories') data.categories = await buildCategories(businessId);
    else if (src === 'members') data.members = await buildMembers(businessId, pickedCategory(form));
    else if (src === 'orders') data.orders = await buildOrders(businessId, phone);
    else if (src === 'active_orders') data.active_orders = await buildActiveOrders(businessId, phone);
    else if (src === 'slots') data.slots = await buildSlots(businessId, form);
    else if (src === 'appointments') data.appointments = await buildAppointments(businessId, phone);
  }
  // Prefilled inputs (e.g. a locked WhatsApp number on a Register screen).
  for (const key of prefillKeysOf(screen || {})) {
    if (key === 'whatsapp_number') data[key] = phone ? `+${phone}` : '';
    else if (!(key in data)) data[key] = form[key] || '';
  }
  // A DatePicker's min-date/max-date are static values baked into the published
  // Flow JSON (see services/flowJson.js) — a dynamic `${data.min_date}` binding
  // isn't honoured by the picker. Its `unavailable-dates` IS honoured
  // dynamically, so grey out the days the chosen doctor doesn't work: no
  // working window that weekday, or whole-day leave.
  const datePicker = (screen?.components || []).find((c) => c.type === 'DatePicker');
  if (datePicker) {
    const member = await memberForForm(form, businessId);
    const days = Number(datePicker.maxDaysAhead) > 0 ? Number(datePicker.maxDaysAhead) : 60;
    data.unavailable_dates = member ? unavailableDatesFor(member, { days }) : [];
  }
  return data;
}

// The category chosen on an earlier screen, if any (set by a "Category list").
function pickedCategory(form = {}) {
  for (const [k, v] of Object.entries(form)) {
    if (typeof v !== 'string' || !v) continue;
    if (k === 'selected_category' || k.includes('category')) return v;
  }
  return '';
}

/** The member chosen on an earlier screen — a "mem_<id>" answer. */
function pickedMember(form = {}) {
  for (const [k, v] of Object.entries(form)) {
    if (typeof v === 'string' && v.startsWith('mem_')) return v;
    if (k === 'selected_member' && typeof v === 'string' && v) return v;
  }
  return '';
}

/** The appointment chosen on an earlier screen — an "appt_<id>" answer. */
function pickedAppointment(form = {}) {
  for (const v of Object.values(form)) {
    if (typeof v === 'string' && v.startsWith('appt_')) return v;
  }
  return '';
}

/**
 * The member a date/slot screen is for: whoever was picked for a new booking,
 * or the doctor the appointment being rescheduled is already with.
 */
async function memberForForm(form = {}, businessId) {
  const memberRaw = pickedMember(form);
  if (memberRaw) return memberFromSelection(memberRaw, businessId);
  const apptRaw = pickedAppointment(form);
  if (apptRaw) {
    const appt = await appointmentFromSelection(apptRaw, businessId);
    if (appt?.memberId) return memberFromSelection(appt.memberId, businessId);
  }
  return null;
}

/**
 * Compose any text that embeds a dynamic token into a single string, keyed by
 * the synthetic key the published JSON references (see services/flowJson.js).
 * The Flow client won't interpolate "...on ${data.x}" inline, so the fully
 * substituted string is supplied under that key instead.
 */
function composeDynamicTexts(screen, data) {
  const out = {};
  const comps = (screen?.components || []).filter((c) => c.type !== 'Footer');
  comps.forEach((c, i) => {
    if (/^Text/.test(c.type) && textHasToken(c.text)) {
      out[dynamicTextKey(screen.id, i)] = String(c.text).replace(
        /\$\{data\.([a-zA-Z0-9_]+)\}/g,
        (_, k) => (data[k] != null ? String(data[k]) : ''),
      );
    }
  });
  return out;
}

/**
 * The date chosen on an earlier screen.
 *
 * Checked by field name rather than by value shape, because a DatePicker
 * submits epoch milliseconds as a string and so looks like any other number.
 * `preferred_date` is what the builder's Register screen ships; anything with
 * "date" in the name is accepted so a renamed field still works.
 */
function pickedDate(form = {}) {
  const keys = Object.keys(form);
  const named = keys.find((k) => k === 'preferred_date' || k === 'selected_date' || k === 'appointment_date');
  const loose = keys.find((k) => /date/i.test(k) && !k.endsWith('_label'));
  const raw = form[named || loose || ''];
  return toISODate(raw);
}

/**
 * Build the slot rows for the member + date chosen earlier in the flow.
 *
 * Returns nothing when either is missing, which is deliberate: an empty list
 * routes through the flow's "nothing found" screen, where a sensible message
 * belongs, rather than inventing times nobody can keep.
 */
export async function buildSlots(businessId, form = {}, limit = 20) {
  const isoDate = pickedDate(form);
  const memberRaw = pickedMember(form);
  const apptRaw = pickedAppointment(form);

  // Booking picks the doctor explicitly. Rescheduling doesn't — the doctor is
  // whoever the existing appointment is with, so it's read off that booking.
  // The appointment is also excluded from the occupancy count, or the time the
  // patient currently holds would look taken to them.
  let member = null;
  let excludeId = '';
  if (memberRaw) {
    member = await memberFromSelection(memberRaw, businessId);
  } else if (apptRaw) {
    const appt = await appointmentFromSelection(apptRaw, businessId);
    if (appt?.memberId) {
      member = await memberFromSelection(appt.memberId, businessId);
      excludeId = String(appt._id);
    }
  }

  if (!member || !isoDate) {
    logger.info('slots list: nothing to compute from yet', {
      member: member?.name || '(none)',
      appointment: apptRaw || '(none)',
      date: isoDate || '(none)',
    });
    return [];
  }
  const slots = await availableSlots({ member, isoDate, businessId, excludeId });
  return slots.slice(0, limit).map((s) => ({
    // The value carries the 24h start so the booking records an exact time;
    // the title is what the patient reads.
    id: `slot_${s.start}`,
    title: s.label,
    description: member.slotCapacity > 1 ? `${s.left} left` : '',
  }));
}

/**
 * The customer's upcoming appointments, for a "Reschedule" picker.
 *
 * Only ones that can still be moved: future (or today), with a doctor and a
 * time on them, and not cancelled or finished.
 */
export async function buildAppointments(businessId, phone, limit = 15) {
  const rows = await upcomingAppointments({ businessId, phone, limit });
  return rows.map((r) => ({
    id: `appt_${r._id}`,
    title: [r.memberName || 'Appointment', r.slot ? to12h(r.slot) : ''].filter(Boolean).join(' · '),
    description: [dateLabel(r.date), r.category].filter(Boolean).join(' · '),
  }));
}

/** Readable label for an "appt_<id>" answer, e.g. "Dr. Asha Rao · 10:30 am · 18 Oct 2026". */
export async function appointmentLabel(value, businessId) {
  const appt = await appointmentFromSelection(value, businessId);
  if (!appt) return '';
  return [appt.memberName || 'Appointment', appt.slot ? to12h(appt.slot) : '', dateLabel(appt.date)]
    .filter(Boolean)
    .join(' · ');
}

/** Readable label for a "slot_HH:MM" answer, e.g. "2:30 pm". */
export function slotLabel(value) {
  const raw = String(value || '').replace(/^slot_/, '');
  return toMinutes(raw) >= 0 ? to12h(raw) : '';
}

/**
 * Readable label for a date answer, e.g. "15 Oct 2026".
 *
 * A DatePicker submits milliseconds-since-epoch as a string, so the raw answer
 * shown on a later screen reads "1793404800000". Anywhere a date is displayed
 * back to the customer has to use the `_label` twin instead.
 */
export function dateLabel(value) {
  const iso = toISODate(value);
  if (!iso) return '';
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

/** The declared type of a field, found by name across the flow's screens. */
function componentTypeOf(flow, name) {
  for (const s of flow?.screens || []) {
    for (const c of s.components || []) if (c.name === name) return c.type;
  }
  return '';
}

// ---------------------------------------------------------------------------
// Selection labels
//
// A radio/dropdown answer is an ID — "mem_6ac4…" for a member, "main_course"
// for a category. That's unreadable on a later screen, so for every answer we
// also publish a human label under "<field>_label". A Register screen can then
// show "Dr. Asha Rao" instead of an id, and the saved submission records both.
// ---------------------------------------------------------------------------
export async function memberLabel(id, businessId) {
  const raw = String(id || '').replace(/^mem_/, '');
  if (!/^[a-f0-9]{24}$/i.test(raw)) return '';
  try {
    const m = await Member.findOne({ _id: raw, ...tenant(businessId) }).lean();
    if (!m) return '';
    return [m.name, m.title].filter(Boolean).join(' · ');
  } catch {
    return '';
  }
}

export async function categoryLabel(value, businessId) {
  const want = slug(value);
  if (!want) return '';
  try {
    const cats = await Category.find(tenant(businessId)).select('name').lean();
    const hit = cats.find((c) => slug(c.name) === want);
    if (hit) return hit.name;
    if (/^[a-f0-9]{24}$/i.test(String(value))) {
      const byId = await Category.findOne({ _id: value, ...tenant(businessId) }).select('name').lean();
      if (byId) return byId.name;
    }
  } catch {
    /* ignore */
  }
  return '';
}

// A static option's title, looked up in the flow definition.
function staticOptionTitle(flow, fieldName, value) {
  for (const s of flow?.screens || []) {
    for (const c of s.components || []) {
      if (!SELECTION.has(c.type)) continue;
      if (fieldName && c.name !== fieldName) continue;
      const opt = (c.options || []).find((o) => o.id === value);
      if (opt?.title) return opt.title;
    }
  }
  return '';
}

/** `{ <field>_label: 'Readable value' }` for every resolvable answer in `form`. */
export async function resolveLabels(flow, form = {}) {
  const out = {};
  // The flow carries its owner, so labels resolve against that tenant's data.
  const biz = flow?.businessId;
  for (const [key, value] of Object.entries(form)) {
    if (key.endsWith('_label') || typeof value !== 'string' || !value) continue;
    let label = '';
    if (value.startsWith('mem_')) label = await memberLabel(value, biz);
    else if (value.startsWith('ord_')) label = await orderLabel(value, biz);
    else if (value.startsWith('appt_')) label = await appointmentLabel(value, biz);
    else if (value.startsWith('slot_')) label = slotLabel(value);
    // Checked by declared type rather than by the look of the value: an epoch
    // in milliseconds is indistinguishable from any other long number.
    else if (componentTypeOf(flow, key) === 'DatePicker') label = dateLabel(value);
    if (!label) label = staticOptionTitle(flow, key, value);
    if (!label && (key === 'selected_category' || key.includes('category'))) label = await categoryLabel(value, biz);
    // Always publish the key: a screen may reference ${data.<field>_label}, and
    // a missing key would break rendering. Fall back to the raw value.
    out[`${key}_label`] = label || value;
  }
  return out;
}

// A flow_token we mint when sending: "flow_<id>_<phone>_<sig>", where sig is
// an HMAC (AUTH_SECRET) of the id and phone. The data endpoint below answers
// only tokens with a valid sig, so nobody can read another business's flow
// data (members, categories, a customer's orders) by making up a token.
// Completed-flow webhooks (signed by Meta, scoped to the receiving business)
// still read the id from older unsigned tokens via flowIdFromToken.
const flowSig = (flowId, phone) =>
  crypto.createHmac('sha256', process.env.AUTH_SECRET || 'dev-insecure-secret-change-me')
    .update(`flow:${String(flowId).toLowerCase()}:${phone}`).digest('hex').slice(0, 24);

/** { flowId, phone } from a token we signed, or null. */
export function verifiedFlowToken(token) {
  const m = String(token || '').match(/^flow_([a-f0-9]{24})_(\d+)_([a-f0-9]{24})$/i);
  if (!m) return null;
  const want = Buffer.from(flowSig(m[1], m[2]));
  const got = Buffer.from(m[3].toLowerCase());
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
  return { flowId: m[1], phone: m[2] };
}

export function flowIdFromToken(token) {
  const m = String(token || '').match(/^flow_([a-f0-9]{24})_/i);
  return m ? m[1] : null;
}
export function makeFlowToken(flowId, phone) {
  const p = String(phone || '').replace(/\D/g, '');
  return `flow_${flowId}_${p}_${flowSig(flowId, p)}`;
}

async function loadFlow(flowId) {
  if (!flowId) return null;
  try {
    return await Flow.findById(flowId).lean();
  } catch {
    return null;
  }
}

// Human wording for a list that turned out to be empty, used only as the
// last-resort placeholder row below.
const EMPTY_ROW_TITLE = {
  orders: 'No orders yet',
  active_orders: 'No open orders',
  categories: 'Nothing available yet',
  members: 'No one available yet',
  slots: 'No times left that day',
  appointments: 'No upcoming appointments',
};

/**
 * Which dynamic lists on this screen came back with nothing.
 *
 * This is the whole problem: a WhatsApp Flow RadioButtonsGroup/Dropdown must
 * have at least one option, so handing Meta an empty `data-source` makes the
 * client show "Something went wrong. Try again later." — which is what a
 * customer with no orders saw when they tapped "My orders".
 */
const emptySourcesOf = (screen, data) =>
  dynamicSourcesOf(screen || {}).filter((src) => Array.isArray(data[src]) && data[src].length === 0);

/**
 * Resolve a screen into the screen that should actually be shown, plus its
 * data. When a list is empty we show the flow's "nothing found" screen.
 *
 * Without such a screen the flow would hard-fail, so a single placeholder row
 * is injected as a fallback: a dead-end row reading "No orders yet" is poor,
 * but it beats an error the customer can't get past. The builder offers the
 * proper screen — this is the safety net for flows that haven't added one.
 */
async function resolveScreen(flow, screen, phone, form = {}) {
  const biz = flow?.businessId;
  const data = await dataForScreen(screen, phone, form, biz);
  const empty = emptySourcesOf(screen, data);
  if (!empty.length) return { screen, data };

  const fallback = (flow.screens || []).find((s) => s.emptyState);
  if (fallback && fallback.id !== screen.id) {
    logger.info('dynamic list empty → showing the "nothing found" screen', {
      screen: screen.id, empty, fallback: fallback.id,
    });
    return { screen: fallback, data: await dataForScreen(fallback, phone, form, biz) };
  }

  logger.warn('dynamic list empty and this flow has no "nothing found" screen', {
    flow: flow.name, screen: screen.id, empty,
  });
  for (const src of empty) {
    data[src] = [{ id: '__empty', title: EMPTY_ROW_TITLE[src] || 'Nothing available', description: '' }];
  }
  return { screen, data };
}

// INIT: initial screen + its dynamic data. Honors the Start node's entryTarget
// when it designates a screen; otherwise opens on the first screen.
export async function handleInit(flowToken) {
  const verified = verifiedFlowToken(flowToken);
  const flow = verified ? await loadFlow(verified.flowId) : null;
  const screens = flow?.screens || [];
  let entry = screens[0];
  if (flow?.entryTarget && flow.entryTarget.startsWith('screen_')) {
    const wanted = screens.find((s) => s.id === flow.entryTarget.replace('screen_', ''));
    if (wanted) entry = wanted;
  }
  if (!entry) return { screen: 'WELCOME', data: {} };
  const { phone } = verified;
  const shown = await resolveScreen(flow, entry, phone);
  const data = { ...shown.data, flow_token: flowToken };
  return { screen: shown.screen.id, data: { ...data, ...composeDynamicTexts(shown.screen, data) } };
}

// data_exchange: decide the next screen from the selection + supply its data.
export async function handleDataExchange(flowToken, currentScreenId, form = {}) {
  const verified = verifiedFlowToken(flowToken);
  const flow = verified ? await loadFlow(verified.flowId) : null;
  if (!flow) return { screen: currentScreenId, data: { error_message: 'Flow not found.' } };

  const current = (flow.screens || []).find((s) => s.id === currentScreenId);
  if (!current) return { screen: flow.screens?.[0]?.id || 'WELCOME', data: {} };

  // Per-option branch: the chosen option's nextScreen wins.
  let nextId = navTargetOf(current);
  const bf = branchFieldOf(current);
  if (bf) {
    const chosen = form[bf.name];
    const opt = (bf.options || []).find((o) => o.id === chosen);
    if (opt?.nextScreen) nextId = opt.nextScreen;
  }

  const next = (flow.screens || []).find((s) => s.id === nextId);
  if (!next) {
    // No further screen → close the flow, returning the collected answers.
    return { screen: 'SUCCESS', data: { extension_message_response: { params: { flow_token: flowToken, ...form } } } };
  }
  const { phone } = verified;
  // Publish readable labels alongside the raw ids so the next screen (e.g. a
  // Register form) can show "Dr. Asha Rao" rather than "mem_6ac4…".
  const labels = await resolveLabels(flow, form);
  const shown = await resolveScreen(flow, next, phone, form);
  const data = { ...shown.data, ...form, ...labels, flow_token: flowToken };
  return {
    screen: shown.screen.id,
    data: { ...data, ...composeDynamicTexts(shown.screen, data) },
  };
}

export default {
  buildCategories,
  buildMembers,
  buildActiveOrders,
  buildSlots,
  buildAppointments,
  appointmentLabel,
  slotLabel,
  dateLabel,
  orderFromSelection,
  orderTokens,
  handleInit,
  handleDataExchange,
  makeFlowToken,
  flowIdFromToken,
  verifiedFlowToken,
};
