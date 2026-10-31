// Demo booking calendar: which days and times can be booked.
//
// Times are India Standard Time (the team's working hours). A group demo, so
// each slot takes a few bookings before it shows as full.
//   DEMO_SLOTS          comma list of HH:MM (default below)
//   DEMO_SLOT_CAPACITY  bookings per slot (default 3)
//   DEMO_DAYS_AHEAD     how far ahead can be booked (default 30)
//   DEMO_CLOSED_DAYS    weekdays with no demos, 0=Sun…6=Sat (default "0")
import DemoRequest from '../models/DemoRequest.js';

export const DEMO_TZ = 'Asia/Kolkata';
const IST_OFFSET_MIN = 330; // UTC+05:30, no daylight saving

const list = (v, d) => String(v ?? d).split(',').map((s) => s.trim()).filter(Boolean);
export const SLOTS = () =>
  list(process.env.DEMO_SLOTS, '11:00,12:00,15:00,16:00,16:30,18:00').filter((s) => /^\d{2}:\d{2}$/.test(s)).sort();
const capacity = () => Math.max(1, Number(process.env.DEMO_SLOT_CAPACITY || 3));
const daysAhead = () => Math.max(1, Number(process.env.DEMO_DAYS_AHEAD || 30));
const closedDays = () => list(process.env.DEMO_CLOSED_DAYS, '0').map(Number);

/** 'YYYY-MM-DD' + 'HH:MM' in IST → a Date. */
export function istToDate(date, slot) {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = slot.split(':').map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh, mm) - IST_OFFSET_MIN * 60_000);
}

/** Today's date in IST, 'YYYY-MM-DD'. */
export function istToday(now = new Date()) {
  return new Date(now.getTime() + IST_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
}

const addDays = (date, n) => {
  const t = new Date(`${date}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};

/** Why a date can't be booked, or '' when it can. */
export function dateProblem(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return 'Choose a date';
  const today = istToday();
  if (date < today) return 'That date has passed';
  if (date > addDays(today, daysAhead())) return `Demos can be booked up to ${daysAhead()} days ahead`;
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  if (closedDays().includes(dow)) return 'No demos on this day';
  return '';
}

/** The slots of one date with how many places are left (0 = full or past). */
export async function slotsFor(date) {
  if (dateProblem(date)) return [];
  const taken = await DemoRequest.find({ date, status: { $ne: 'cancelled' } }).select('slot').lean();
  const count = {};
  for (const t of taken) count[t.slot] = (count[t.slot] || 0) + 1;
  // A slot starting within the next 30 minutes can't be booked any more.
  const cutoff = Date.now() + 30 * 60_000;
  return SLOTS().map((slot) => {
    const left = Math.max(0, capacity() - (count[slot] || 0));
    const past = istToDate(date, slot).getTime() < cutoff;
    return { slot, left: past ? 0 : left, past };
  });
}

/** Bookable window, for the calendar: first/last date and closed weekdays. */
export function calendarWindow() {
  const today = istToday();
  return { from: today, to: addDays(today, daysAhead()), closedDays: closedDays(), timezone: DEMO_TZ };
}

export default { slotsFor, dateProblem, calendarWindow, istToDate, istToday, SLOTS, DEMO_TZ };
