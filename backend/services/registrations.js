// Turns a completed WhatsApp Flow submission (nfm_reply) into a Registration
// record the CRM can list. The tenant decides which fields exist in the flow
// builder, so we keep everything in `fields` and lift the well-known ones
// (name / business name / email / date) into columns for the list view.
import Registration from '../models/Registration.js';
import Flow from '../models/Flow.js';
import Order from '../models/Order.js';
import { toISODate, appointmentFromSelection } from './slots.js';
import {
  flowIdFromToken,
  memberLabel,
  categoryLabel,
  orderFromSelection,
  CLOSED_STATUSES,
} from './flowRuntime.js';
import { notify } from './notifications.js';
import logger from './logger.js';

// Meta echoes back internal keys we don't want stored as form answers.
const IGNORED = new Set(['flow_token', 'flow_name', '__version__']);

// Values the runtime prefixes to mark a selection rather than typed input.
const ID_PREFIX = /^(mem_|ord_|appt_|slot_|cat_)/;

const norm = (k) => String(k || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Map a submitted field name onto one of our columns. Deliberately fuzzy so a
// tenant renaming "name" to "full_name" or "Your Name" still lands correctly.
function classify(key) {
  const k = norm(key);
  if (!k) return null;
  if (k.includes('businessname') || k === 'company' || k.includes('companyname') || k.includes('shopname')) return 'businessName';
  if (k === 'email' || k.includes('email') || k.includes('mail')) return 'email';
  if (k.includes('whatsapp') || k === 'phone' || k.includes('phonenumber') || k.includes('mobile') || k.includes('contactnumber')) return 'phone';
  if (k === 'date' || k.includes('date') || k.includes('preferredday') || k.includes('appointment')) return 'date';
  if (k === 'name' || k.includes('fullname') || k.includes('yourname') || k.includes('customername') || k.includes('personname')) return 'name';
  return null;
}

const digits = (s) => String(s || '').replace(/\D/g, '');

/**
 * The bell: a new booking / registration, a cancellation or a reschedule.
 * Fire and forget — it never affects the submission itself.
 */
function notifyRegistration(businessId, reg, { action, order }) {
  if (!businessId || !reg) return;
  const who = reg.name || (reg.phone ? `+${reg.phone}` : 'A customer');
  const when = [reg.date, reg.slot].filter(Boolean).join(' ');
  const booking = !!(reg.slot || reg.memberName || order?.kind === 'booking');
  const target = { view: 'orders', id: order?._id ? String(order._id) : '', phone: reg.phone };
  let n;
  if (action === 'cancel') {
    const what = order?.kind === 'booking' ? 'Booking' : 'Order';
    const done = order?.status === 'cancelled';
    n = {
      type: 'booking_cancelled',
      title: done ? `${what} cancelled${order?.reference ? ` ${order.reference}` : ''}` : 'Cancellation requested',
      body: `${who}${order?.reference && !done ? ` · ${order.reference}` : ''}${done ? '' : ' (not changed: it is paid or already closed)'}`,
    };
  } else if (action === 'reschedule') {
    n = {
      type: 'booking_rescheduled',
      title: 'Booking rescheduled',
      body: [who, reg.memberName, when ? `moved to ${when}` : ''].filter(Boolean).join(' · '),
    };
  } else {
    n = {
      type: 'booking_new',
      title: booking ? 'New booking' : 'New registration',
      body: [who, reg.memberName || reg.category, when || '', reg.flowName && !booking ? reg.flowName : '']
        .filter(Boolean).join(' · '),
    };
  }
  notify(businessId, { ...n, target }).catch(() => {});
}

// Local 'YYYY-MM-DD' / 'HH:MM' for a stored Date, read in the server's zone —
// the same zone a booking's scheduledAt was written in (new Date(`${d}T${t}`)).
const localISO = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
const localHHMM = (d) => {
  const x = new Date(d);
  return `${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`;
};

/**
 * The booking Order behind an appointment being rescheduled.
 *
 * A booking stores the appointment on two rows — a Registration (the picker
 * reads these) and an Order (the Appointments list shows these) — and they
 * aren't linked by id, so the order is matched by the customer, the doctor and
 * the day the appointment currently sits on. Member + day pin it; when the day
 * has already drifted out of sync, a single active booking for that
 * customer+doctor is still unambiguous.
 */
async function bookingOrderFor(businessId, target) {
  const ph = digits(target.phone);
  if (!ph) return null;
  try {
    // The reliable path: the order created with this appointment carries its id.
    if (target._id) {
      const linked = await Order.findOne({
        ...(businessId ? { businessId } : {}),
        registrationId: String(target._id), kind: 'booking', status: { $ne: 'cancelled' },
      }).sort({ createdAt: -1 }).lean();
      if (linked) return linked;
    }
    // Fallback for orders made before the link existed: match by customer +
    // doctor + the day the appointment currently sits on.
    const orders = await Order.find({
      ...(businessId ? { businessId } : {}),
      phone: ph, kind: 'booking', status: { $ne: 'cancelled' },
    }).sort({ createdAt: -1 }).lean();
    if (!orders.length) return null;
    const byMember = target.memberName
      ? orders.filter((o) => (o.member || '') === target.memberName)
      : orders;
    const pool = byMember.length ? byMember : orders;
    const sameDay = pool.filter((o) => o.scheduledAt && localISO(o.scheduledAt) === target.date);
    if (sameDay.length) {
      const exact = target.slot && sameDay.find((o) => localHHMM(o.scheduledAt) === target.slot);
      return exact || sameDay[0];
    }
    // No day match (data already drifted) — only safe when there's exactly one.
    return pool.length === 1 ? pool[0] : null;
  } catch (err) {
    logger.warn('booking order lookup failed', { error: err.message });
    return null;
  }
}

// Selection components whose answers are option ids rather than typed text.
const SELECTION_TYPES = new Set(['RadioButtonsGroup', 'CheckboxGroup', 'Dropdown']);

/**
 * Readable "<field>_label" values for answers that came from a static picker.
 * Only fills gaps — anything the runtime already labelled is left alone.
 * @param {object} flow flow definition (needs `screens`)
 * @param {object} fields the submitted answers
 * @param {object} existing labels already resolved by the runtime
 */
function staticOptionLabels(flow, fields, existing) {
  const out = {};
  for (const screen of flow.screens || []) {
    for (const c of screen.components || []) {
      if (!c?.name || !SELECTION_TYPES.has(c.type)) continue;
      if (!(c.name in fields) || existing[`${c.name}_label`]) continue;
      // Checkbox groups arrive joined ("a, b") — resolve each id separately.
      const titles = String(fields[c.name])
        .split(',')
        .map((v) => v.trim())
        .map((v) => (c.options || []).find((o) => o.id === v)?.title || '')
        .filter(Boolean);
      if (titles.length) out[`${c.name}_label`] = titles.join(', ');
    }
  }
  return out;
}

/**
 * Store a flow submission.
 * @param {object} form parsed nfm_reply response_json
 * @param {string} phone the sender's WhatsApp number
 * @param {string} businessId owning tenant
 * @returns {Promise<null|{registration: object, order: object|null, action: string, declined: boolean}>}
 *   null when there's nothing worth storing. `order` is the order the customer
 *   selected (already cancelled when action === 'cancel').
 */
export async function saveFlowSubmission(form, phone, businessId) {
  if (!form || typeof form !== 'object') return null;

  const fields = {};
  const picked = { name: '', businessName: '', email: '', date: '' };
  let submittedPhone = '';
  let memberRaw = '';
  let categoryRaw = '';
  let orderRaw = ''; // any order the customer selected
  let cancelRaw = ''; // an order selected specifically to be cancelled
  let confirmAnswer = ''; // answer to a cancel_confirm question, if present
  let slotRaw = ''; // the appointment time chosen from a "Slot list"
  let apptRaw = ''; // an existing appointment picked for rescheduling
  const labels = {}; // "<field>_label" values the runtime already resolved

  for (const [key, value] of Object.entries(form)) {
    if (IGNORED.has(key)) continue;
    // Typed answers are kept as they are: files (a list of { url, name, mime }),
    // a date range ({ start-date, end-date }) and a tick box (true / false) —
    // the CRM draws them from that. Only lists of plain strings (checkbox
    // groups) are joined, as before.
    if (Array.isArray(value) && value.some((x) => x && typeof x === 'object')) {
      fields[key] = value;
      continue;
    }
    if ((value && typeof value === 'object' && !Array.isArray(value)) || typeof value === 'boolean') {
      fields[key] = value;
      continue;
    }
    const val = Array.isArray(value) ? value.join(', ') : value;
    if (val === '' || val === null || val === undefined) continue;

    // Readable labels published by the runtime aren't form answers themselves.
    if (key.endsWith('_label')) {
      labels[key] = String(val);
      continue;
    }
    fields[key] = val;

    // Remember the journey that led here: which category, which member, which
    // order. Only `cancel_order` triggers a cancellation — a read-only "track
    // order" list uses `selected_order`, which must never cancel anything.
    if (String(val).startsWith('mem_')) memberRaw = String(val);
    if (String(val).startsWith('slot_')) slotRaw = String(val);
    if (String(val).startsWith('appt_')) apptRaw = String(val);
    if (String(val).startsWith('ord_')) {
      orderRaw = String(val);
      // Only the exact field name cancels. This used to also accept anything
      // starting with "cancel", which meant a screen built from the "Open
      // orders" picker — whose field is `cancel_order` — cancelled the order
      // even when the screen was only meant to show it. A read-only list must
      // use `selected_order` (the "Order list" picker) and never land here.
      if (key === 'cancel_order') cancelRaw = String(val);
    }
    if (key === 'cancel_confirm') confirmAnswer = String(val).toLowerCase();
    if (key === 'selected_category' || (key.includes('category') && !key.includes('_label'))) {
      categoryRaw = String(val);
    }

    // A value carrying one of our id prefixes is a *selection*, never a typed
    // answer, so it must not be filed into a column like name/date/email.
    //
    // classify() is deliberately fuzzy on names, which made it claim the wrong
    // field: `reschedule_appointment` contains "appointment", so it was read as
    // the date, filled `picked.date` with "appt_<id>", and the real
    // `preferred_date` was then skipped because the slot was already taken —
    // a reschedule moved the time but silently kept the old day.
    if (!ID_PREFIX.test(String(val))) {
      const slot = classify(key);
      if (slot === 'phone') submittedPhone = String(val);
      else if (slot && !picked[slot]) picked[slot] = String(val);
    }
  }

  // Nothing but internal keys → not a form submission worth recording.
  if (!Object.keys(fields).length) return null;

  // Resolve the picks to readable names — prefer labels the runtime sent,
  // otherwise look them up now (direct submissions won't carry labels).
  const memberKey = Object.keys(fields).find((k) => String(fields[k]).startsWith('mem_'));
  const memberName =
    (memberKey && labels[`${memberKey}_label`])
    || (memberRaw ? await memberLabel(memberRaw, businessId) : '');
  const categoryKey = Object.keys(fields).find(
    (k) => k === 'selected_category' || k.includes('category'),
  );
  const categoryName =
    (categoryKey && labels[`${categoryKey}_label`])
    || (categoryRaw ? await categoryLabel(categoryRaw, businessId) : '');

  // ---- Order selection / cancellation -------------------------------------
  // "No, keep it" style answers must not cancel anything.
  //
  // Every lookup is tenant-scoped: the order id arrives in the submission, so
  // unscoped it was possible to reach another business's order and cancel it.
  const declined = !!confirmAnswer && !/^(y|yes|confirm|cancel_it|true|1)/.test(confirmAnswer);
  const order = orderRaw ? await orderFromSelection(orderRaw, businessId) : null;
  let action = 'register';
  let cancelled = null;

  if (cancelRaw && !declined) {
    const target = cancelRaw === orderRaw ? order : await orderFromSelection(cancelRaw, businessId);
    if (target) {
      action = 'cancel';
      if (target.paid) {
        // Paid orders/bookings are never self-cancelled — a refund has to be
        // handled by the business. Record the request, change nothing. (The
        // cancel picker already hides these; this guards a stale/crafted id.)
        logger.info('cancel requested on a PAID order, refusing', {
          order: target.reference, status: target.status,
        });
        cancelled = target;
      } else if (CLOSED_STATUSES.includes(target.status)) {
        // Already delivered or cancelled — record the request, change nothing.
        logger.info('cancel requested on a closed order, ignoring', {
          order: target.reference, status: target.status,
        });
        cancelled = target;
      } else {
        try {
          cancelled = await Order.findOneAndUpdate(
            { _id: target._id, ...(businessId ? { businessId } : {}) },
            { $set: { status: 'cancelled', cancelledAt: new Date() } },
            { new: true },
          ).lean();
          logger.info('order cancelled from flow', { order: cancelled?.reference, phone });
        } catch (err) {
          logger.warn('could not cancel order', { order: target.reference, error: err.message });
          cancelled = target;
        }
      }
    }
  } else if (cancelRaw && declined) {
    // They reached the confirm screen and said no — keep it as a record only.
    logger.info('cancellation declined by customer', { phone });
  }

  // ---- Reschedule ---------------------------------------------------------
  // An existing appointment is MOVED rather than duplicated: the stored row's
  // date and slot are updated in place, which releases the old time and takes
  // the new one in a single step (slots are derived from these rows, so there
  // is nothing else to keep in step). Creating a second row would leave the
  // patient holding two appointments and the old slot still blocked.
  const newDate = toISODate(picked.date);
  const newSlot = slotRaw.replace(/^slot_/, '');
  if (apptRaw) {
    const target = await appointmentFromSelection(apptRaw, businessId);
    if (!target) {
      logger.warn('reschedule referenced an unknown appointment', { phone });
    } else if (!newDate && !newSlot) {
      // No new date or time means this isn't a reschedule — it's a read-only
      // "My appointments" view. Hand the selected appointment straight back so
      // the follow-up "Appointment details" block fills its tokens (doctor,
      // date, time, name, status) from it, instead of the blank new row that
      // "ignoring" used to leave — which is why those lines came out empty.
      const linked = target.orderId
        ? await Order.findOne({ _id: target.orderId, ...(businessId ? { businessId } : {}) }).lean().catch(() => null)
        : null;
      logger.info('appointment viewed → returning its details', {
        phone, appointment: String(target._id),
      });
      return { registration: target, order: linked, action: 'view', declined: false };
    } else {
      try {
        const moved = await Registration.findOneAndUpdate(
          { _id: target._id, ...(businessId ? { businessId } : {}) },
          {
            $set: {
              ...(newDate ? { date: newDate } : {}),
              ...(newSlot ? { slot: newSlot } : {}),
              action: 'reschedule',
              status: 'new',
              fields: { ...(target.fields || {}), ...fields, ...labels },
            },
          },
          { new: true },
        ).lean();
        logger.info('appointment rescheduled from flow', {
          appointment: String(target._id),
          from: `${target.date} ${target.slot || ''}`.trim(),
          to: `${moved.date} ${moved.slot || ''}`.trim(),
          phone,
        });
        // Keep the booking Order in step: find the one this appointment belongs
        // to (matched before the move, so its stored day still lines up) and
        // move its scheduledAt too. Returning it also lets the reschedule
        // confirmation show the real REF and payment status instead of blanks.
        let bookingOrder = await bookingOrderFor(businessId, target);
        if (bookingOrder) {
          const movedSlot = moved.slot || target.slot || '00:00';
          const newAt = new Date(`${moved.date}T${movedSlot}:00`);
          try {
            bookingOrder = await Order.findByIdAndUpdate(
              bookingOrder._id,
              { $set: { scheduledAt: newAt } },
              { new: true },
            ).lean();
            logger.info('booking order moved with the appointment', {
              order: bookingOrder?.reference, to: `${moved.date} ${movedSlot}`,
            });
          } catch (err) {
            logger.warn('could not move booking order date', { error: err.message });
          }
        }
        notifyRegistration(businessId, moved, { action: 'reschedule', order: bookingOrder });
        // The moved row IS the record — returning it means the follow-up
        // message block fills its tokens from the appointment that changed.
        return { registration: moved, order: bookingOrder || null, action: 'reschedule', declined: false };
      } catch (err) {
        logger.warn('could not reschedule appointment', {
          appointment: String(target._id), error: err.message,
        });
      }
    }
  }

  const orderDoc = cancelled || order;
  const orderKey = Object.keys(fields).find((k) => String(fields[k]).startsWith('ord_'));
  const orderRefLabel =
    orderDoc?.reference || (orderKey && labels[`${orderKey}_label`]) || '';

  // Resolve which of our flows this came from (the token encodes the id).
  const flowId = flowIdFromToken(form.flow_token) || '';
  let flowName = '';
  if (flowId) {
    try {
      const f = await Flow.findById(flowId).select('name screens').lean();
      flowName = f?.name || '';
      // Static pickers (payment method, yes/no questions…) submit option *ids*
      // like "cod". The flow definition holds the wording the customer actually
      // tapped, so resolve it into a "<field>_label" the CRM can display — the
      // runtime only publishes those for its dynamic lists.
      if (f) Object.assign(labels, staticOptionLabels(f, fields, labels));
    } catch {
      /* ignore */
    }
  }

  try {
    const doc = await Registration.create({
      ...(businessId ? { businessId } : {}),
      // Trust the real sender over a typed value, but keep a typed one as backup.
      phone: digits(phone) || digits(submittedPhone),
      name: picked.name,
      businessName: picked.businessName,
      email: picked.email,
      // Normalised to 'YYYY-MM-DD'. A DatePicker submits epoch milliseconds as
      // a string, so storing it raw meant two bookings for the same day could
      // never be recognised as such — which is what slot counting depends on.
      date: newDate || picked.date,
      category: categoryName,
      memberId: memberRaw.replace(/^mem_/, ''),
      memberName,
      slot: newSlot,
      action,
      orderId: orderDoc ? String(orderDoc._id) : '',
      orderRef: orderRefLabel,
      // Keep the readable labels with the answers so the CRM never shows raw ids.
      fields: { ...fields, ...labels },
      flowId,
      flowName,
    });
    logger.info('flow submission stored', {
      phone: doc.phone,
      fields: Object.keys(fields).length,
      flow: flowName,
      action,
      category: categoryName || undefined,
      member: memberName || undefined,
      order: orderRefLabel || undefined,
    });
    // A declined cancellation changed nothing, so there's nothing to announce.
    if (!(cancelRaw && declined)) notifyRegistration(businessId, doc, { action, order: orderDoc });
    // `order` is handed back (not persisted on the doc) so the caller can fill
    // {{order_id}}-style tokens in the follow-up message block.
    return { registration: doc, order: orderDoc || null, action, declined };
  } catch (err) {
    logger.warn('could not store flow submission', { error: err.message });
    return null;
  }
}

export default { saveFlowSubmission };
