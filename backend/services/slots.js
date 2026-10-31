// ---------------------------------------------------------------------------
// Appointment slots.
//
// A member's bookable times are never stored as a list — they're derived from
// three things, every time they're asked for:
//
//   1. the per-day windows on the member (`schedule`), cut into `duration`
//      minute slots. Two windows on one day leave the gap between them as a
//      break, so "morning + evening" needs no extra concept.
//   2. minus anything inside a dated `unavailability` entry.
//   3. minus slots already full — `slotCapacity` bookings deep, counted from
//      the appointments actually recorded against that member and date.
//
// Deriving rather than storing means a changed working hour, a cancelled
// appointment or a doctor's leave is reflected immediately, with nothing to
// re-generate and nothing to go stale.
// ---------------------------------------------------------------------------
import Member from '../models/Member.js';
import Registration from '../models/Registration.js';
import logger from './logger.js';

export const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** 'HH:MM' → minutes since midnight. -1 when unparseable. */
export function toMinutes(hhmm) {
  const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return -1;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return -1;
  return h * 60 + min;
}

/** minutes since midnight → 'HH:MM'. */
export const toHHMM = (mins) =>
  `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

/** 'HH:MM' → '2:30 pm', for anything a customer reads. */
export function to12h(hhmm) {
  const mins = toMinutes(hhmm);
  if (mins < 0) return String(hhmm || '');
  const h24 = Math.floor(mins / 60);
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(mins % 60).padStart(2, '0')} ${h24 < 12 ? 'am' : 'pm'}`;
}

/**
 * Normalise whatever a date arrives as into 'YYYY-MM-DD'.
 *
 * WhatsApp's Flow DatePicker submits milliseconds-since-epoch as a *string*,
 * not a date, so a raw submitted value can be "1793404800000" as easily as
 * "2026-10-15". Both have to land on the same key or a booking will never
 * match the day it was made for.
 */
export function toISODate(value) {
  if (!value) return '';
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const d = new Date(/^\d{10,}$/.test(raw) ? Number(raw) : raw);
  if (Number.isNaN(d.getTime())) return '';

  // Which day an instant belongs to depends on the zone you read it in, and
  // reading it in the wrong one silently shifts a booking by a day.
  //
  // Meta's DatePicker submits UTC midnight for the date tapped, so an exact
  // UTC midnight is read as a UTC date. Anything else is an instant inside a
  // real day — including local midnight, which in IST is 18:30 UTC the day
  // before — so it's read in the server's own zone, the same way dayKeyOf and
  // todayISO do.
  const isUtcMidnight =
    d.getUTCHours() === 0 && d.getUTCMinutes() === 0
    && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
  if (isUtcMidnight) return d.toISOString().slice(0, 10);

  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The weekday key for an ISO date, read in local time. */
export function dayKeyOf(isoDate) {
  const m = String(isoDate || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  // Constructed from parts so it is local midnight, not UTC midnight shifted
  // back a day for anyone east of Greenwich.
  return DAY_KEYS[new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay()] || '';
}

/** Today's ISO date in local time. */
export function todayISO() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

/**
 * The member's schedule in its current shape.
 *
 * Members saved before per-day windows existed carry `availableDays` plus one
 * from/to pair. Rather than migrate the collection, that shape is widened on
 * read into the same structure the rest of this module expects.
 */
export function scheduleOf(member) {
  const sched = (member?.schedule || [])
    .map((d) => ({
      day: String(d.day || '').toLowerCase(),
      windows: (d.windows || [])
        .map((w) => ({ from: String(w.from || ''), to: String(w.to || '') }))
        .filter((w) => toMinutes(w.from) >= 0 && toMinutes(w.to) > toMinutes(w.from)),
    }))
    .filter((d) => DAY_KEYS.includes(d.day) && d.windows.length);
  if (sched.length) return sched;

  const from = member?.availableFrom;
  const to = member?.availableTo;
  if (toMinutes(from) < 0 || toMinutes(to) <= toMinutes(from)) return [];
  return (member?.availableDays || [])
    .map((d) => String(d).toLowerCase())
    .filter((d) => DAY_KEYS.includes(d))
    .map((day) => ({ day, windows: [{ from, to }] }));
}

/** The windows a member works on one specific date. */
export function windowsOn(member, isoDate) {
  const key = dayKeyOf(isoDate);
  if (!key) return [];
  const entry = scheduleOf(member).find((d) => d.day === key);
  return entry ? entry.windows : [];
}

/**
 * The dates in [today, today+days] the member can't be booked on, as
 * 'YYYY-MM-DD' strings — for a DatePicker's `unavailable-dates`, so the
 * calendar greys out any day the doctor doesn't actually work.
 *
 * A date is unavailable when the member has no working window that weekday
 * (their days off) or is on whole-day leave then. Per-slot capacity isn't
 * considered here — a fully-booked but working day stays pickable and the slot
 * screen simply shows no times, which is cheaper than 60 availability queries.
 */
export function unavailableDatesFor(member, { days = 60 } = {}) {
  if (!member) return [];
  const out = [];
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  for (let i = 0; i <= days; i += 1) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const worksThatDay = windowsOn(member, iso).length > 0;
    const wholeDayOff = blocksOn(member, iso).some((b) => b.wholeDay);
    if (!worksThatDay || wholeDayOff) out.push(iso);
  }
  return out;
}

/** Does [aFrom,aTo) overlap [bFrom,bTo)? All in minutes. */
const overlaps = (aFrom, aTo, bFrom, bTo) => aFrom < bTo && bFrom < aTo;

/**
 * The unavailability entries that block part or all of a date.
 * A whole-day entry is returned as the full 00:00–24:00 range.
 */
export function blocksOn(member, isoDate) {
  return (member?.unavailability || [])
    .filter((u) => toISODate(u.date) === isoDate)
    .map((u) => {
      if (u.wholeDay !== false) return { from: 0, to: 24 * 60, wholeDay: true, reason: u.reason || '' };
      const from = toMinutes(u.from);
      const to = toMinutes(u.to);
      // A partial block with unusable times would otherwise block nothing,
      // silently leaving the doctor bookable on a day they said they're out.
      if (from < 0 || to <= from) return { from: 0, to: 24 * 60, wholeDay: true, reason: u.reason || '' };
      return { from, to, wholeDay: false, reason: u.reason || '' };
    });
}

/** Every slot the member's hours define on a date, before bookings or leave. */
export function rawSlots(member, isoDate) {
  const step = Number(member?.duration) > 0 ? Math.floor(Number(member.duration)) : 30;
  const out = [];
  for (const w of windowsOn(member, isoDate)) {
    const from = toMinutes(w.from);
    const to = toMinutes(w.to);
    // `+ step <= to` so a trailing part-slot isn't offered: a 10:00–11:15 window
    // at 30 minutes gives 10:00 and 10:30, not a 15-minute 11:00.
    for (let t = from; t + step <= to; t += step) out.push({ start: t, end: t + step });
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * How many appointments are already booked per slot for this member/date.
 *
 * Appointments are flow submissions (services/registrations.js), which is
 * where `memberId`, the date and the chosen slot are recorded. Cancelled ones
 * free their slot again.
 */
export async function bookedCounts(businessId, memberId, isoDate, excludeId = '') {
  const counts = new Map();
  if (!memberId || !isoDate) return counts;
  try {
    const rows = await Registration.find({
      ...(businessId ? { businessId } : {}),
      memberId: String(memberId),
      date: isoDate,
      status: { $ne: 'cancelled' },
      action: { $ne: 'cancel' },
      // When rescheduling, the appointment being moved must not count against
      // itself — otherwise its own time looks taken and the patient can't pick
      // the slot they already hold.
      ...(excludeId ? { _id: { $ne: excludeId } } : {}),
    })
      .select('slot')
      .lean();
    for (const r of rows) {
      const key = String(r.slot || '');
      if (key) counts.set(key, (counts.get(key) || 0) + 1);
    }
  } catch (err) {
    logger.warn('booked slot lookup failed', { error: err.message });
  }
  return counts;
}

/**
 * The slots a customer can actually pick for a member on a date.
 *
 * @returns {Promise<{start:string,end:string,label:string,left:number}[]>}
 */
export async function availableSlots({
  member, isoDate, businessId, now = new Date(), excludeId = '',
}) {
  if (!member || !isoDate) return [];
  const capacity = Number(member.slotCapacity) > 0 ? Math.floor(Number(member.slotCapacity)) : 1;
  const blocks = blocksOn(member, isoDate);
  const counts = await bookedCounts(businessId, member._id, isoDate, excludeId);

  // Only filter by clock time when the date in question is today.
  const isToday = isoDate === todayISO();
  const nowMins = now.getHours() * 60 + now.getMinutes();

  return rawSlots(member, isoDate)
    .filter((s) => !blocks.some((b) => overlaps(s.start, s.end, b.from, b.to)))
    .filter((s) => !isToday || s.start > nowMins)
    .map((s) => {
      const start = toHHMM(s.start);
      const left = capacity - (counts.get(start) || 0);
      return { start, end: toHHMM(s.end), label: to12h(start), left };
    })
    .filter((s) => s.left > 0);
}

/**
 * Appointments that a new unavailability clashes with.
 *
 * Used to message the patients whose booking has just been cut. A whole-day
 * entry catches every appointment on the date, including ones with no slot
 * recorded; a partial entry only catches overlapping slots, and keeps a
 * slotless appointment because there's no evidence it's unaffected.
 */
export async function affectedAppointments({ businessId, member, block }) {
  const isoDate = toISODate(block?.date);
  if (!member?._id || !isoDate) return [];
  const step = Number(member.duration) > 0 ? Math.floor(Number(member.duration)) : 30;
  let rows = [];
  try {
    rows = await Registration.find({
      ...(businessId ? { businessId } : {}),
      memberId: String(member._id),
      date: isoDate,
      status: { $nin: ['cancelled', 'done'] },
      action: { $ne: 'cancel' },
    }).lean();
  } catch (err) {
    logger.warn('affected appointment lookup failed', { error: err.message });
    return [];
  }
  if (block?.wholeDay !== false) return rows;

  const bFrom = toMinutes(block.from);
  const bTo = toMinutes(block.to);
  if (bFrom < 0 || bTo <= bFrom) return rows;
  return rows.filter((r) => {
    const s = toMinutes(r.slot);
    if (s < 0) return true; // unknown time — safer to tell them than not
    return overlaps(s, s + step, bFrom, bTo);
  });
}

/** Load the member a flow submission picked, scoped to the tenant. */
export async function memberFromSelection(value, businessId) {
  const raw = String(value || '').replace(/^mem_/, '');
  if (!/^[a-f0-9]{24}$/i.test(raw)) return null;
  try {
    return await Member.findOne({ _id: raw, ...(businessId ? { businessId } : {}) }).lean();
  } catch {
    return null;
  }
}

/**
 * Load the appointment an "appt_<id>" answer refers to, scoped to the tenant.
 *
 * Tenant-scoped for the same reason orders are: the id arrives from the client,
 * so an unscoped lookup would let a crafted value reach — and move — somebody
 * else's booking.
 */
export async function appointmentFromSelection(value, businessId) {
  const raw = String(value || '').replace(/^appt_/, '');
  if (!/^[a-f0-9]{24}$/i.test(raw)) return null;
  try {
    return await Registration.findOne({
      _id: raw,
      ...(businessId ? { businessId } : {}),
    }).lean();
  } catch {
    return null;
  }
}

/** Appointments a customer can still change — future, with a slot, not cancelled. */
export async function upcomingAppointments({ businessId, phone, limit = 15 }) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return [];
  try {
    return await Registration.find({
      ...(businessId ? { businessId } : {}),
      phone: digits,
      memberId: { $nin: ['', null] },
      // Today counts: a morning appointment can still be moved to the evening.
      date: { $gte: todayISO() },
      status: { $nin: ['cancelled', 'done'] },
      action: { $ne: 'cancel' },
    })
      .sort({ date: 1, slot: 1 })
      .limit(limit)
      .lean();
  } catch (err) {
    logger.warn('upcoming appointment lookup failed', { error: err.message });
    return [];
  }
}

export default {
  DAY_KEYS,
  toMinutes,
  toHHMM,
  to12h,
  toISODate,
  dayKeyOf,
  todayISO,
  scheduleOf,
  windowsOn,
  blocksOn,
  rawSlots,
  bookedCounts,
  availableSlots,
  affectedAppointments,
  memberFromSelection,
  appointmentFromSelection,
  upcomingAppointments,
};
