// ---------------------------------------------------------------------------
// Named values for template placeholders.
//
// Meta only lets a template body use positional placeholders — {{1}}, {{2}} —
// so the template itself can't say what they mean. This module is the missing
// half: each position is mapped to a *named* source, and at send time the
// values are resolved from live data (the customer, their latest order, the
// business) and handed to the Cloud API in order.
//
// A business therefore writes "Hi {{1}}, your order {{2}} is {{3}}" once, maps
// 1 → customer name, 2 → order reference, 3 → order status, and every send
// fills itself in.
// ---------------------------------------------------------------------------
import Registration from '../models/Registration.js';
import Message from '../models/Message.js';
import Order from '../models/Order.js';
import { orderTokens } from './flowRuntime.js';
import logger from './logger.js';

/**
 * Everything a placeholder can be mapped to. Shared with the composer UI so
 * the list a business picks from is the list the runtime can actually fill.
 */
// `archetypes` controls which business types see a value, and `labelFor`
// renames it per type — so a clinic sees "Reference", not "Order reference",
// and never sees "Order items" or "Delivery address" at all. '*' means every
// type. The runtime still fills any key regardless, so an old template that
// mapped a now-hidden value keeps working; this only shapes the picker.
const ALL = '*';
// `customerKey: true` marks a label that should be re-worded to the tenant's
// term for the person it serves (Patient / Guest / Client / Customer).
export const TEMPLATE_SOURCES = [
  { key: 'customer_name', label: 'Customer name', hint: 'The name they gave in a flow form, else their WhatsApp name', archetypes: ALL, customerKey: true },
  { key: 'customer_phone', label: 'Customer phone', archetypes: ALL, customerKey: true },
  { key: 'business_name', label: 'Business name', archetypes: ALL },
  { key: 'order_id', label: 'Order reference', archetypes: ALL, labelFor: { person: 'Reference', unit: 'Reference', lead: 'Reference', notify: 'Reference' } },
  { key: 'order_status', label: 'Order status', archetypes: ALL, labelFor: { person: 'Status', unit: 'Status', lead: 'Status', notify: 'Status' } },
  { key: 'order_total', label: 'Order total', archetypes: ['catalog', 'unit', 'notify'], labelFor: { unit: 'Amount', notify: 'Amount' } },
  { key: 'order_date', label: 'Order date', archetypes: ALL, labelFor: { person: 'Booked on', unit: 'Booked on', lead: 'Enquiry date', notify: 'Date' } },
  { key: 'order_items', label: 'Order items', archetypes: ['catalog'] },
  { key: 'payment_status', label: 'Paid / not paid', archetypes: ALL },
  { key: 'payment_method', label: 'Payment method', archetypes: ALL },
  { key: 'delivery_address', label: 'Delivery address', archetypes: ['catalog'] },
  { key: 'today', label: "Today's date", archetypes: ALL },
  // Appointment values. Filled from the customer's booking — the member they
  // chose, the day and the time — so one "your appointment has changed"
  // template works for every doctor and every date. Not shown to a shop.
  { key: 'member_name', label: 'Staff name', hint: 'Whoever the appointment is with', archetypes: ['person', 'unit', 'lead'], labelFor: { unit: 'Host / staff name', lead: 'Agent name' } },
  { key: 'appointment_date', label: 'Appointment date', archetypes: ['person', 'unit', 'lead'], labelFor: { unit: 'Booking date', lead: 'Preferred date' } },
  { key: 'appointment_slot', label: 'Appointment time', archetypes: ['person', 'unit', 'lead'], labelFor: { unit: 'Booking time' } },
  { key: 'unavailable_reason', label: 'Reason for the change', hint: 'What you typed when marking them unavailable', archetypes: ['person', 'unit', 'lead'] },
];

const SOURCE_KEYS = new Set(TEMPLATE_SOURCES.map((s) => s.key));
export const isTemplateSource = (key) => SOURCE_KEYS.has(String(key));

/**
 * The live values a given business type should be offered, with its own
 * wording. A clinic gets appointment values and a plain "Reference"; a shop
 * gets the order and delivery values. Keys are unchanged — only the list and
 * the labels differ.
 */
export function templateSourcesFor(archetype, customerLabel = 'Customer', memberSingular = '') {
  const a = String(archetype || 'catalog');
  const cust = String(customerLabel || 'Customer');
  const member = String(memberSingular || '').trim();
  return TEMPLATE_SOURCES
    .filter((s) => s.archetypes === ALL || s.archetypes.includes(a))
    .map((s) => {
      let label = (s.labelFor && s.labelFor[a]) || s.label;
      // "Customer name" → "Patient name" / "Guest phone" etc.
      if (s.customerKey && cust !== 'Customer') label = label.replace(/^Customer\b/, cust);
      // Whoever (or whatever) the booking is with, in the business's own word:
      // "Doctor name", "Service name", "Room type name".
      if (s.key === 'member_name' && member && member !== 'Member') label = `${member} name`;
      return { key: s.key, label, ...(s.hint ? { hint: s.hint } : {}) };
    });
}

/** How many distinct {{n}} placeholders a body uses, and which numbers. */
export function placeholderIndexes(bodyText) {
  const found = [...String(bodyText || '').matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => Number(m[1]));
  return [...new Set(found)].sort((a, b) => a - b);
}

/**
 * The customer's name.
 *
 * A name they typed into a flow form is what they chose to be called, so it
 * wins over the WhatsApp profile name — which is often a nickname, emoji, or
 * missing entirely. Falls back to the profile name, then to nothing.
 */
export async function resolveCustomerName(phone, businessId = '', fallbackName = '') {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return String(fallbackName || '').trim();
  try {
    const reg = await Registration.findOne({
      phone: digits,
      name: { $nin: ['', null] },
      ...(businessId ? { businessId } : {}),
    })
      .sort({ createdAt: -1 })
      .select('name')
      .lean();
    if (reg?.name) return reg.name; // a name they typed into a form wins
  } catch (err) {
    logger.debug('template name lookup failed', { error: err.message });
  }
  // The WhatsApp profile name. The live one from the current message is used
  // first when given, since the inbound row may not be written yet; otherwise
  // the most recent stored inbound name.
  if (fallbackName && String(fallbackName).trim()) return String(fallbackName).trim();
  try {
    const msg = await Message.findOne({ phone: digits, direction: 'in', name: { $nin: ['', null] } })
      .sort({ createdAt: -1 })
      .select('name')
      .lean();
    return msg?.name || '';
  } catch {
    return '';
  }
}

/** The customer's most recent order, for status/reference placeholders. */
async function latestOrder(phone, businessId = '') {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return null;
  try {
    return await Order.findOne({ phone: digits, ...(businessId ? { businessId } : {}) })
      .sort({ createdAt: -1 })
      .lean();
  } catch {
    return null;
  }
}

/**
 * Meta rejects a template parameter containing a newline, a tab, or four or
 * more consecutive spaces, so anything multi-line is flattened rather than
 * failing the send.
 */
const safeParam = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

/**
 * Resolve a template's placeholders into ordered body parameters.
 *
 * @param {object} template the stored Template (uses `bodyText`, `variables`)
 * @param {object} ctx      { phone, business, order }
 * @returns {Promise<string[]>} one value per placeholder, in {{n}} order
 */
export async function resolveTemplateParams(template, ctx = {}) {
  const indexes = placeholderIndexes(template?.bodyText);
  if (!indexes.length) return [];

  const phone = String(ctx.phone || '').replace(/\D/g, '');
  const businessId = ctx.business?._id ? String(ctx.business._id) : '';
  const byIndex = new Map(
    (template?.variables || []).map((v) => [Number(v.index), v]),
  );

  // Only do the lookups the mapping actually asks for.
  const wanted = new Set(indexes.map((i) => byIndex.get(i)?.source).filter(Boolean));
  const needsOrder = [...wanted].some((k) => k.startsWith('order_') || k.startsWith('payment_') || k === 'delivery_address');

  const order = needsOrder ? (ctx.order || (await latestOrder(phone, businessId))) : null;
  const ot = order ? orderTokens(order) : {};
  const name = wanted.has('customer_name') ? await resolveCustomerName(phone, businessId) : '';
  // Appointment context is passed in by whoever triggered the send (a member
  // going unavailable knows the booking); there's nothing to look up.
  const appt = ctx.appointment || {};

  const values = {
    customer_name: name,
    customer_phone: phone ? `+${phone}` : '',
    business_name: ctx.business?.name || '',
    order_id: ot.order_id || '',
    order_status: ot.order_status || '',
    order_total: ot.order_total || '',
    order_date: ot.order_date || '',
    order_items: ot.order_items || '',
    payment_status: ot.payment_status || '',
    payment_method: order?.paymentMethod || '',
    delivery_address: order?.deliveryAddress || '',
    today: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'numeric', year: 'numeric' }),
    member_name: appt.memberName || '',
    appointment_date: appt.dateLabel || appt.date || '',
    appointment_slot: appt.slotLabel || '',
    unavailable_reason: appt.reason || '',
  };

  return indexes.map((i) => {
    const mapped = byIndex.get(i);
    const raw = mapped?.source ? values[mapped.source] : '';
    // A blank parameter is rejected by Meta, so an unmapped or unavailable
    // value falls back to the business's own wording, then to a dash.
    return safeParam(raw) || safeParam(mapped?.fallback) || '-';
  });
}

export default {
  TEMPLATE_SOURCES,
  templateSourcesFor,
  isTemplateSource,
  placeholderIndexes,
  resolveCustomerName,
  resolveTemplateParams,
};
