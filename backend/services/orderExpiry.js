// ---------------------------------------------------------------------------
// Unpaid-order expiry.
//
// When a customer picks "Pay online" we create the order and send a native
// WhatsApp Pay card, then wait for the payment webhook. If they never pay, the
// order sits "confirmed but unpaid" forever — and for a booking it also keeps
// its slot held through the Registration row, so the doctor's time is blocked
// by someone who never paid.
//
// This sweep releases both after a timeout: the order is cancelled, and for a
// booking the appointment that held the slot is cancelled too, freeing it for
// someone else. It runs for every tenant — any order with a pending native
// payment qualifies, which only happens when payment is configured.
// ---------------------------------------------------------------------------
import Order from '../models/Order.js';
import Registration from '../models/Registration.js';
import Business from '../models/Business.js';
import { getClientForBusiness } from './metaCloud.js';
import logger from './logger.js';

// How long an unpaid online order is held before it's released. Minutes.
const TIMEOUT_MIN = Math.max(5, Number(process.env.ORDER_PAYMENT_TIMEOUT_MIN) || 30);
// How often the sweep runs. Minutes.
const SWEEP_EVERY_MIN = Math.max(1, Number(process.env.ORDER_EXPIRY_SWEEP_MIN) || 2);

/** scheduledAt → the local 'YYYY-MM-DD' and 'HH:MM' it was written from. */
function dateAndSlot(scheduledAt) {
  if (!scheduledAt) return { date: '', slot: '' };
  const d = new Date(scheduledAt);
  if (Number.isNaN(d.getTime())) return { date: '', slot: '' };
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const slot = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return { date, slot };
}

/**
 * Release the appointment that held a booking's slot.
 *
 * The payment order and the slot-holding Registration aren't linked by id —
 * the order is created at the payment step, after the Registration — so they
 * are matched on what they share: tenant, phone, member, date and slot. Only
 * live appointments are touched, never ones already cancelled or completed.
 */
async function releaseBookingSlot(order) {
  const { date, slot } = dateAndSlot(order.scheduledAt);
  if (!date) return;
  const q = {
    ...(order.businessId ? { businessId: order.businessId } : {}),
    phone: String(order.phone || ''),
    date,
    ...(slot ? { slot } : {}),
    status: { $nin: ['cancelled', 'done'] },
    action: { $ne: 'cancel' },
  };
  // Narrow to the right provider when we know who it was with — two doctors
  // can share a date and time.
  if (order.member) q.memberName = order.member;
  try {
    const r = await Registration.updateMany(q, { $set: { status: 'cancelled', cancelledAt: new Date() } });
    if (r.modifiedCount) {
      logger.info('expired booking slot released', {
        reference: order.reference, date, slot, appointments: r.modifiedCount,
      });
    }
  } catch (err) {
    logger.warn('could not release booking slot', { reference: order.reference, error: err.message });
  }
}

/** Tell the customer their held slot/order was released. Best-effort. */
async function notify(order) {
  if (!order.businessId || !order.phone) return;
  try {
    const biz = await Business.findById(order.businessId).lean();
    if (!biz) return;
    const meta = getClientForBusiness(biz);
    const what = order.kind === 'booking' ? 'reserved time' : 'order';
    await meta.sendText(
      order.phone,
      `Your ${what} (${order.reference}) was released because the payment wasn't completed in time. `
      + 'You\'re welcome to start again whenever you\'re ready.',
    );
  } catch (err) {
    logger.debug('expiry notice not sent', { reference: order.reference, error: err.message });
  }
}

/**
 * One pass: cancel every order whose online payment has been pending longer
 * than the timeout. Idempotent — a cancelled order no longer matches, so it is
 * only ever processed once.
 *
 * @returns {Promise<number>} how many orders were released
 */
export async function sweepExpiredOrders() {
  const cutoff = new Date(Date.now() - TIMEOUT_MIN * 60 * 1000);
  let rows = [];
  try {
    rows = await Order.find({
      'payment.status': 'pending',
      'payment.requestedAt': { $lte: cutoff },
      paid: { $ne: true },
      status: { $ne: 'cancelled' },
    }).limit(200);
  } catch (err) {
    logger.warn('order expiry sweep query failed', { error: err.message });
    return 0;
  }

  let released = 0;
  for (const order of rows) {
    try {
      order.status = 'cancelled';
      order.cancelledAt = new Date();
      order.payment = {
        ...(order.payment?.toObject ? order.payment.toObject() : order.payment),
        status: 'failed',
        settledAt: new Date(),
      };
      await order.save();
      if (order.kind === 'booking') await releaseBookingSlot(order);
      await notify(order);
      released += 1;
      logger.info('unpaid order expired and released', {
        reference: order.reference, kind: order.kind, minutes: TIMEOUT_MIN, businessId: String(order.businessId || ''),
      });
    } catch (err) {
      logger.warn('could not expire order', { reference: order.reference, error: err.message });
    }
  }
  return released;
}

let timer = null;

/** Start the periodic sweep. Safe to call once at boot. */
export function startOrderExpiry() {
  if (timer) return;
  logger.info('order expiry sweep started', { timeoutMinutes: TIMEOUT_MIN, everyMinutes: SWEEP_EVERY_MIN });
  // A first pass shortly after boot clears anything that expired while down.
  setTimeout(() => { sweepExpiredOrders().catch(() => {}); }, 15 * 1000);
  timer = setInterval(() => { sweepExpiredOrders().catch(() => {}); }, SWEEP_EVERY_MIN * 60 * 1000);
  if (timer.unref) timer.unref();
}

export default { startOrderExpiry, sweepExpiredOrders };
