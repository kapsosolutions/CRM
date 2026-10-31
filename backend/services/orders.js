// ---------------------------------------------------------------------------
// Turning a finished conversation into an Order.
//
// Until now nothing in the backend ever created an Order — they were read for
// the "my orders" lists and updated by the cancel flow, but `reference` had no
// generator and no code path wrote a new row. An order confirmation needs a
// real order behind it (the business has to see it, and {{order_id}} has to
// resolve), so this is that path.
//
// Everything comes from the tokens the flow has collected on the way through:
// the cart from the Catalog block, the charges from the Payment type block, the
// chosen payment method from the button they tapped, the address from a shared
// location. A business whose flow skips a step simply has no token for it, and
// the order records what was actually captured.
// ---------------------------------------------------------------------------
import crypto from 'crypto';
import Order from '../models/Order.js';
import { orderTokens } from './flowRuntime.js';
import { notify, money } from './notifications.js';
import logger from './logger.js';

/**
 * A readable, unguessable order reference, e.g. "NAI-261009-A3F19C".
 *
 * Business initials + date + random, rather than a counter: a counter needs a
 * shared sequence across tenants and leaks how many orders a business has.
 */
export function makeOrderReference(businessName = '') {
  const prefix = String(businessName).replace(/[^a-z]/gi, '').slice(0, 3).toUpperCase() || 'ORD';
  const d = new Date();
  const ymd = [
    String(d.getFullYear()).slice(2),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('');
  return `${prefix}-${ymd}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

const digits = (s) => String(s || '').replace(/\D/g, '');

/**
 * Create the order for this conversation, or return the one already created.
 *
 * Idempotent on `tokens.order_db_id`: a customer who taps a button twice, or a
 * flow that passes through two confirmation blocks, gets one order rather than
 * duplicates. Returns `{}` when there's no cart to turn into an order — a
 * booking-style flow with no catalog step shouldn't invent one.
 *
 * @param {object}  args
 * @param {object}  args.tokens      tokens collected so far in the conversation
 * @param {string}  args.businessId  owning tenant
 * @param {string}  args.phone       customer's WhatsApp number
 * @param {string}  [args.businessName] used for the reference prefix
 * @returns {Promise<object>} token patch to merge (order_db_id + all order_* tokens)
 */
export async function ensureOrder({ tokens = {}, businessId = '', phone = '', businessName = '' }) {
  // Already created earlier in this conversation — reuse it so later blocks and
  // documents all quote the same reference.
  if (tokens.order_db_id) {
    const existing = await Order.findById(tokens.order_db_id).lean().catch(() => null);
    if (existing) return { order_db_id: String(existing._id), ...orderTokens(existing) };
    // The row is gone (purged tenant, manual delete) — fall through and remake.
  }

  const lines = Array.isArray(tokens.cart_lines) ? tokens.cart_lines : [];

  /**
   * An appointment is an order too.
   *
   * This used to bail out whenever there was no cart, on the reasoning that a
   * booking flow shouldn't invent one. That was wrong for anything that
   * charges without a catalog: a clinic has no cart, so no order was created,
   * so there was no reference and nothing to pay for — native payment silently
   * fell back to plain text. A booking with a fee becomes a one-line order
   * named after what was booked.
   */
  const fee = Number(tokens.member_fee_value) || 0;
  const booking = !lines.length && !!(tokens.member || tokens.appointment_date) && fee > 0;
  if (!lines.length && !booking) return {};

  const items = booking
    ? [{
      name: String(tokens.member || tokens.category || 'Appointment').slice(0, 200),
      qty: 1,
      price: fee,
    }]
    : lines.map((l) => ({
      name: String(l.name || 'Item').slice(0, 200),
      qty: Number(l.qty) || 1,
      price: Number(l.price) || 0,
      image: typeof l.image === 'string' && /^https?:\/\//i.test(l.image) ? l.image : '',
    }));
  const subtotal = items.reduce((n, i) => n + i.price * i.qty, 0);
  const delivery = Number(tokens.delivery_value) || 0;
  // Prefer the figure the payment block actually quoted the customer: if a
  // business changes a price mid-conversation, the order must match the message
  // they were shown, not a freshly recomputed total.
  const quoted = Number(tokens.total_payable_value);
  const total = Number.isFinite(quoted) ? quoted : subtotal + delivery;

  const method = String(tokens.payment_method || '').trim();

  try {
    const order = await Order.create({
      ...(businessId ? { businessId } : {}),
      reference: makeOrderReference(businessName),
      kind: booking ? 'booking' : 'order',
      // The day and time the appointment is for, so the Appointments page and
      // any reminder can read it off the order rather than re-deriving it.
      ...(booking && tokens.appointment_at ? { scheduledAt: tokens.appointment_at } : {}),
      // Link the order back to the appointment row it was created for, so a
      // later reschedule can move this exact order even after dates drift.
      ...(tokens.registration_id ? { registrationId: String(tokens.registration_id) } : {}),
      // Appointment specifics, so a confirmation sent after online payment can
      // still quote them (the webhook that drives it has no live answers).
      ...(booking
        ? {
          member: String(tokens.member || '').trim(),
          gender: String(tokens.gender || '').trim(),
          age: String(tokens.age || '').trim(),
        }
        : {}),
      customerName: String(tokens.customer_name || '').trim(),
      phone: digits(phone),
      items,
      total,
      // Confirmed, not pending: the customer has been through the flow and
      // picked how to pay, so it's a live order the business must act on.
      status: 'confirmed',
      paymentMethod: method,
      deliveryFee: delivery,
      deliveryAddress: String(tokens.delivery_address || '').trim(),
      locationUrl: String(tokens.location_url || '').trim(),
      ...(Number.isFinite(Number(tokens.location_lat))
        && String(tokens.location_lat) !== ''
        ? { locationLat: Number(tokens.location_lat), locationLng: Number(tokens.location_lng) }
        : {}),
      category: String(tokens.category || '').trim(),
      // Online payment isn't collected yet, so nothing is marked paid here.
      paid: false,
    });
    logger.info('order created from flow', {
      reference: order.reference, phone: digits(phone), total, items: items.length, method,
    });
    // Bookings are announced once, from their Registration (services/registrations.js).
    if (businessId && order.kind === 'order') {
      const who = order.customerName || (order.phone ? `+${order.phone}` : 'a customer');
      const count = items.reduce((n, i) => n + (Number(i.qty) || 1), 0);
      notify(businessId, {
        type: 'order_new',
        title: `New order ${order.reference}`,
        body: `${money(total)} · ${count} item${count === 1 ? '' : 's'} from ${who}`,
        target: { view: 'orders', id: String(order._id), phone: order.phone },
      }).catch(() => {});
    }
    return { order_db_id: String(order._id), ...orderTokens(order.toObject()) };
  } catch (err) {
    // A confirmation that can't be saved shouldn't silence the customer — the
    // caller still sends the message, just without order_* tokens.
    logger.error('could not create order from flow', { error: err.message, phone: digits(phone) });
    return {};
  }
}

export default { ensureOrder, makeOrderReference };
