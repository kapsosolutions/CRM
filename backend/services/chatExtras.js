// ---------------------------------------------------------------------------
// Polls and events sent from a chat (the composer's + menu).
//
// WhatsApp's Cloud API has no poll or event message (those exist only between
// people in the WhatsApp app), so each is built from what the API does have:
//   - A poll is reply buttons (up to 3 short options) or a list (up to 10).
//     The customer taps an option; that tap comes back as a button / list
//     reply whose id names the poll and the option, and the poll's chat row
//     records it. "Allow multiple answers" lets them tap more than one
//     (buttons stay tappable, the list can be reopened); otherwise their
//     latest tap is their answer.
//   - An event is a message with the name, time, place and description, and
//     an "Add to calendar" button (a Google Calendar link). "WhatsApp call
//     link" adds wa.me/call/<business number>, which starts a WhatsApp call
//     to the business.
// Both are messages, so they need the 24-hour window like any reply.
// ---------------------------------------------------------------------------
import crypto from 'crypto';
import Message from '../models/Message.js';
import { emitMessage } from './eventBus.js';
import logger from './logger.js';

export const POLL_MAX_OPTIONS = 10;
const BUTTONS_MAX = 3;
const BUTTON_TITLE_MAX = 20;
export const POLL_OPTION_MAX = 24; // a list row title
export const POLL_QUESTION_MAX = 255;

/** An input problem the route answers with 400. */
export class ExtraError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

const tidy = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** A poll's question and options, checked. */
export function checkPoll(input = {}) {
  const question = tidy(input.question, POLL_QUESTION_MAX);
  if (!question) throw new ExtraError('Ask a question.');
  const options = [];
  for (const raw of Array.isArray(input.options) ? input.options : []) {
    const o = tidy(raw, 1000);
    if (!o) continue;
    if (o.length > POLL_OPTION_MAX) throw new ExtraError(`“${o.slice(0, 30)}…” is too long: WhatsApp shows up to ${POLL_OPTION_MAX} characters per option.`);
    if (options.some((x) => x.toLowerCase() === o.toLowerCase())) throw new ExtraError(`“${o}” is in the poll twice.`);
    options.push(o);
  }
  if (options.length < 2) throw new ExtraError('Add at least two options.');
  if (options.length > POLL_MAX_OPTIONS) throw new ExtraError(`A poll can have up to ${POLL_MAX_OPTIONS} options.`);
  return { question, options, multiple: !!input.multiple };
}

/** How the poll goes out: buttons for up to 3 short options, else a list. */
export const pollStyle = (options) => (options.length <= BUTTONS_MAX && options.every((o) => o.length <= BUTTON_TITLE_MAX) ? 'buttons' : 'list');

export const pollOptionId = (pollId, i) => `poll:${pollId}:${i}`;

/** "poll:<id>:<index>" → { pollId, index }, or null. */
export function parsePollReply(id) {
  const m = /^poll:([a-f0-9]{8,32}):(\d{1,2})$/.exec(String(id || ''));
  return m ? { pollId: m[1], index: Number(m[2]) } : null;
}

/** Send a poll into a chat. `client` is the chat's Meta client. */
export async function sendPoll(client, phone, input) {
  const poll = checkPoll(input);
  const id = crypto.randomBytes(6).toString('hex');
  const hint = poll.multiple ? 'Tap one or more' : 'Tap one';
  const body = `📊 *${poll.question}*`;
  const extra = { poll: { id, ...poll, style: pollStyle(poll.options), votes: [], answeredAt: null } };
  if (extra.poll.style === 'buttons') {
    await client.sendButtons(phone, {
      body,
      footer: hint,
      buttons: poll.options.map((o, i) => ({ id: pollOptionId(id, i), title: o })),
    }, extra);
  } else {
    await client.sendList(phone, {
      body,
      buttonText: 'Vote',
      header: 'Options',
      footer: hint,
      rows: poll.options.map((o, i) => ({ id: pollOptionId(id, i), title: o })),
    }, extra);
  }
  return { id };
}

/**
 * A customer tapped a poll option: record it on the poll's chat row and push
 * the row again, so the poll card updates. Returns true when it was a poll answer.
 */
export async function recordPollVote(selectedId, { businessId, phone }) {
  const ref = parsePollReply(selectedId);
  if (!ref || !businessId) return false;
  try {
    const row = await Message.findOne({ businessId, phone, 'raw.poll.id': ref.pollId });
    const poll = row?.raw?.poll;
    if (!poll || ref.index >= (poll.options || []).length) return true;
    const had = Array.isArray(poll.votes) ? poll.votes : [];
    const votes = poll.multiple ? [...new Set([...had, ref.index])].sort((a, b) => a - b) : [ref.index];
    const raw = { ...row.raw, poll: { ...poll, votes, answeredAt: new Date().toISOString() } };
    const updated = await Message.findOneAndUpdate({ _id: row._id, businessId }, { $set: { raw } }, { new: true });
    if (updated) emitMessage(updated);
  } catch (err) {
    logger.warn('poll answer not recorded', { error: err.message });
  }
  return true;
}

// ------------------------------------------------------------------ events --

const isoOk = (v) => {
  const d = new Date(String(v || ''));
  return Number.isNaN(d.getTime()) ? null : d;
};
const gcal = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

function zoneOk(tz) {
  if (typeof tz !== 'string' || !tz.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-IN', { timeZone: tz }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

/** An event's fields, checked. Times are ISO strings; `timeZone` is how to show them. */
export function checkEvent(input = {}) {
  const name = tidy(input.name, 100);
  if (!name) throw new ExtraError('Give the event a name.');
  const start = isoOk(input.start);
  if (!start) throw new ExtraError('Choose when the event starts.');
  let end = input.end ? isoOk(input.end) : null;
  if (input.end && !end) throw new ExtraError('The end time isn’t valid.');
  if (end && end <= start) throw new ExtraError('The event must end after it starts.');
  const description = String(input.description ?? '').trim().slice(0, 600);
  const location = tidy(input.location, 200);
  const timeZone = zoneOk(input.timeZone) ? String(input.timeZone) : 'Asia/Kolkata';
  return { name, description, start: start.toISOString(), end: end ? end.toISOString() : null, location, callLink: !!input.callLink, timeZone };
}

/** "Wed, 5 Nov 2026 · 12:30 pm – 1:30 pm" in the event's time zone. */
export function eventWhen(ev) {
  const dayOf = (d) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-IN', {
      timeZone: ev.timeZone, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    }).formatToParts(d).map((x) => [x.type, x.value]));
    return `${p.weekday}, ${p.day} ${p.month} ${p.year}`;
  };
  const timeOf = (d) => new Intl.DateTimeFormat('en-IN', { timeZone: ev.timeZone, hour: 'numeric', minute: '2-digit' }).format(d).toLowerCase();
  const s = new Date(ev.start);
  if (!ev.end) return `${dayOf(s)} · ${timeOf(s)}`;
  const e = new Date(ev.end);
  const to = dayOf(s) === dayOf(e) ? timeOf(e) : `${dayOf(e)} ${timeOf(e)}`;
  return `${dayOf(s)} · ${timeOf(s)} – ${to}`;
}

/** Google Calendar "add event" link (an hour long when no end was given). */
export function calendarLink(ev, callUrl = '') {
  const s = new Date(ev.start);
  const e = ev.end ? new Date(ev.end) : new Date(s.getTime() + 60 * 60 * 1000);
  const details = [ev.description, callUrl ? `Join on WhatsApp: ${callUrl}` : ''].filter(Boolean).join('\n\n');
  const q = new URLSearchParams({
    action: 'TEMPLATE',
    text: ev.name,
    dates: `${gcal(s)}/${gcal(e)}`,
    ...(details ? { details: details.slice(0, 1200) } : {}),
    ...(ev.location ? { location: ev.location } : {}),
    ctz: ev.timeZone,
  });
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

/** The message text the customer gets. */
export function eventBody(ev, callUrl = '') {
  const lines = [`📅 *${ev.name}*`, '', `🗓️ ${eventWhen(ev)}`];
  if (ev.location) lines.push(`📍 ${ev.location}`);
  if (callUrl) lines.push(`📞 WhatsApp call: ${callUrl}`);
  if (ev.description) lines.push('', ev.description);
  return lines.join('\n').slice(0, 1024);
}

/**
 * Send an event into a chat.
 * @param {string} businessNumber the business's own number (digits), for the call link
 */
export async function sendEvent(client, phone, input, businessNumber = '') {
  const ev = checkEvent(input);
  const digits = String(businessNumber || '').replace(/\D/g, '');
  if (ev.callLink && !digits) throw new ExtraError('A WhatsApp call link needs your own WhatsApp number.');
  const callUrl = ev.callLink ? `https://wa.me/call/${digits}` : '';
  await client.sendCtaUrl(phone, {
    body: eventBody(ev, callUrl),
    displayText: 'Add to calendar',
    url: calendarLink(ev, callUrl),
  }, { event: { ...ev, callUrl, calendarUrl: calendarLink(ev, callUrl) } });
  return { ok: true };
}

export default {
  checkPoll, pollStyle, parsePollReply, sendPoll, recordPollVote,
  checkEvent, eventWhen, calendarLink, eventBody, sendEvent, ExtraError,
};
