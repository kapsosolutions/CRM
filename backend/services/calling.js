// ---------------------------------------------------------------------------
// WhatsApp voice calls (Cloud API Calling)
//
// Signalling only: the call's audio runs over WebRTC directly between the
// agent's browser and Meta. This file carries the SDP offers and answers
// between them, keeps track of each call, and writes one chat row per call.
//
//   Customer calls  →  `calls` webhook, event "connect" with an SDP offer
//                   →  crm:call {kind:'incoming'} rings every open CRM tab
//                   →  one tab answers: its SDP answer goes to Meta as
//                      pre_accept then accept; the other tabs stop ringing
//   Agent calls     →  POST /calls action "connect" with the browser's offer
//                   →  `calls` webhook "connect" carries Meta's SDP answer
//                      (crm:call {kind:'answer'}); a "calls" status ACCEPTED
//                      means the customer picked up
//   Either side     →  "terminate" webhook with the outcome and duration
//
// Meta's rules this follows: calling must be switched on per number and needs
// a messaging limit of 2,000; the business has about 30–60 s to answer; it
// can only call customers who allowed it (a call permission request, or
// automatically after they called with callback permission on); a customer's
// call opens or refreshes the 24-hour window, and so does them picking up.
// Video and screen sharing aren't in the API yet (the CRM shows them as Soon).
//
// Live calls are kept in memory (one backend process). The chat row is the
// record: it's found by the call id after a restart too.
// ---------------------------------------------------------------------------
import Message from '../models/Message.js';
import Conversation from '../models/Conversation.js';
import { getClientForBusiness } from './metaCloud.js';
import { isWhatsAppConnected } from './sandbox.js';
import { emitCall, emitMessage } from './eventBus.js';
import { notify } from './notifications.js';
import logger from './logger.js';

const SETTINGS_TTL_MS = 2 * 60 * 1000;
// How long a ringing call is kept for a tab that opens late (Meta gives up
// after about a minute).
const RING_MS = 75 * 1000;
// A business-initiated call: how long its id waits for Meta's answer.
const PENDING_OUT_MS = 60 * 1000;

const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
// Call states with nothing left to happen.
const TERMINAL = ['ended', 'missed', 'no_answer', 'failed', 'declined'];
const digits = (s) => String(s || '').replace(/\D/g, '');

/** Meta's error, as one message the CRM can show. */
export function callError(err) {
  const e = err?.response?.data?.error;
  const code = e?.code ?? err?.code ?? null;
  const known = {
    138006: 'This customer hasn’t allowed calls from you yet. Ask for permission first.',
    138000: 'Calling isn’t switched on for this number. Turn it on in Channel Status → Calling.',
    138001: 'This customer can’t be called right now.',
    138002: 'Too many calls to this customer. Try again later.',
    138003: 'This call is already being answered or has ended.',
    138005: 'Too many call permission requests to this customer. You can ask once a day and twice a week.',
    138007: 'The call couldn’t connect. Check your microphone and network, then try again.',
    138012: 'Calling is restricted on this number because of customer feedback.',
    131026: 'This customer’s WhatsApp is too old to receive this.',
    131047: 'The 24-hour window is closed. A call permission request can only be sent while it’s open.',
  };
  const message = known[code] || e?.error_user_msg || e?.error_data?.details || e?.message || err?.message || 'Meta refused the request';
  return { message, code };
}

/** An error the route can send as it is: { status, message, code }. */
export class CallError extends Error {
  constructor(message, { status = 400, code = null } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const own = (biz) => {
  if (!biz || !isWhatsAppConnected(biz)) {
    throw new CallError('Calls need your own WhatsApp number. Connect it in Channel Status.', { status: 409, code: 'NOT_CONNECTED' });
  }
  return getClientForBusiness(biz);
};

// ------------------------------------------------------------- settings --

const settingsCache = new Map(); // businessId -> { at, data }

const hhmm = (s) => {
  const m = /^(\d{1,2}):?(\d{2})$/.exec(String(s || '').trim());
  if (!m) return '';
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return '';
  return `${String(h).padStart(2, '0')}${String(min).padStart(2, '0')}`;
};
const colon = (s) => (/^\d{4}$/.test(String(s || '')) ? `${s.slice(0, 2)}:${s.slice(2)}` : '');

/** Meta's `calling` object in the CRM's shape. */
export function shapeSettings(c = {}) {
  const hours = c.call_hours || {};
  return {
    enabled: String(c.status || '').toUpperCase() === 'ENABLED',
    // NOT_SET = never configured on this number.
    configured: !!c.status && String(c.status).toUpperCase() !== 'NOT_SET',
    showCallButton: String(c.call_icon_visibility || 'DEFAULT').toUpperCase() !== 'DISABLE_ALL',
    callbackPermission: String(c.callback_permission_status || '').toUpperCase() === 'ENABLED',
    callHours: {
      enabled: String(hours.status || '').toUpperCase() === 'ENABLED',
      timezone: hours.timezone_id || 'Asia/Kolkata',
      weekly: (hours.weekly_operating_hours || []).map((w) => ({
        day: String(w.day_of_week || '').toUpperCase(),
        open: colon(w.open_time),
        close: colon(w.close_time),
      })),
      holidays: (hours.holiday_schedule || []).map((h) => ({
        date: h.date || '',
        start: colon(h.start_time),
        end: colon(h.end_time),
      })),
    },
    // Meta pauses calling on a number customers block or report.
    restrictions: (c.restrictions?.restrictions_list || []).map((r) => ({
      type: r.type || '',
      reason: r.reason || '',
      expiresAt: r.expiration ? new Date(Number(r.expiration) * 1000).toISOString() : null,
    })),
    sip: String(c.sip?.status || '').toUpperCase() === 'ENABLED',
  };
}

/**
 * The CRM's settings → Meta's `calling` object. Throws CallError on bad input.
 * Only what was given is sent; call hours always go as a whole, since Meta
 * replaces them.
 */
export function settingsPatch(input = {}) {
  const out = {};
  if (input.enabled !== undefined) out.status = input.enabled ? 'ENABLED' : 'DISABLED';
  if (input.showCallButton !== undefined) out.call_icon_visibility = input.showCallButton ? 'DEFAULT' : 'DISABLE_ALL';
  if (input.callbackPermission !== undefined) out.callback_permission_status = input.callbackPermission ? 'ENABLED' : 'DISABLED';
  const h = input.callHours;
  if (h) {
    if (!h.enabled) {
      // Open all day, every day. Meta still wants the rest of the object to be valid.
      out.call_hours = { status: 'DISABLED', timezone_id: h.timezone || 'Asia/Kolkata', weekly_operating_hours: [] };
    } else {
      const tz = String(h.timezone || '').trim();
      if (!/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)+$/.test(tz) && tz !== 'UTC') throw new CallError('Choose a time zone for the call hours.');
      const perDay = new Map();
      const weekly = [];
      for (const w of h.weekly || []) {
        const day = String(w.day || '').toUpperCase();
        if (!DAYS.includes(day)) throw new CallError('A call hours row has an unknown day.');
        const open = hhmm(w.open);
        const close = hhmm(w.close);
        if (!open || !close) throw new CallError(`Set both times for ${day.charAt(0) + day.slice(1).toLowerCase()}.`);
        if (open >= close) throw new CallError(`On ${day.charAt(0) + day.slice(1).toLowerCase()} the closing time must be after the opening time.`);
        const list = perDay.get(day) || [];
        if (list.length >= 2) throw new CallError('Meta allows at most two time ranges per day.');
        if (list.some((r) => open < r.close && r.open < close)) throw new CallError('Two time ranges on the same day overlap.');
        list.push({ open, close });
        perDay.set(day, list);
        weekly.push({ day_of_week: day, open_time: open, close_time: close });
      }
      if (!weekly.length) throw new CallError('Add at least one day with call hours, or turn call hours off.');
      const today = new Date().toISOString().slice(0, 10);
      const holidays = [];
      for (const d of (h.holidays || []).slice(0, 20)) {
        const date = String(d.date || '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new CallError('A closed day has no valid date.');
        if (date < today) throw new CallError('Closed days must be today or later.');
        const start = hhmm(d.start || '00:00');
        const end = hhmm(d.end || '23:59');
        if (!start || !end || start >= end) throw new CallError(`The closed hours on ${date} aren’t valid.`);
        holidays.push({ date, start_time: start, end_time: end });
      }
      out.call_hours = { status: 'ENABLED', timezone_id: tz, weekly_operating_hours: weekly, holiday_schedule: holidays };
    }
  }
  return out;
}

export async function getCallSettings(biz, { refresh = false } = {}) {
  const client = own(biz);
  const id = String(biz._id);
  const hit = settingsCache.get(id);
  if (hit && !refresh && Date.now() - hit.at < SETTINGS_TTL_MS) return hit.data;
  const data = shapeSettings(await client.getCallSettings());
  settingsCache.set(id, { at: Date.now(), data });
  return data;
}

export async function updateCallSettings(biz, input) {
  const client = own(biz);
  const patch = settingsPatch(input);
  if (!Object.keys(patch).length) throw new CallError('Nothing to change.');
  await client.updateCallSettings(patch);
  settingsCache.delete(String(biz._id));
  logger.info('call settings updated on Meta', { business: biz.name, keys: Object.keys(patch).join(',') });
  return getCallSettings(biz, { refresh: true });
}

/** Meta changed the settings (WhatsApp Manager, another tab): read them again next time. */
export function forgetCallSettings(businessId) {
  settingsCache.delete(String(businessId));
}

// ------------------------------------------------------------ the calls --

// callId -> { id, businessId, phone, name, direction, state, offerSdp, at,
//             answeredBy, answeredAt, messageId }
const live = new Map();
// `${businessId}|${phone}` -> { at, callId? } for a call we're placing whose
// connect webhook may beat the /calls response.
const placing = new Map();
const claimed = new Set(); // call ids an agent is answering right now

function sweep() {
  const now = Date.now();
  for (const [id, c] of live) {
    const done = c.state === 'ended' && now - c.at > 10 * 1000;
    const stale = now - c.at > 3 * 60 * 60 * 1000;
    if (done || stale || (c.state === 'ringing' && now - c.at > RING_MS * 2)) live.delete(id);
  }
  for (const [k, p] of placing) if (now - p.at > PENDING_OUT_MS) placing.delete(k);
}
setInterval(sweep, 30 * 1000).unref?.();

/** What the browser gets about a call (never the SDP unless asked). */
const present = (c, { withOffer = false } = {}) => ({
  id: c.id,
  phone: c.phone,
  name: c.name || '',
  direction: c.direction,
  state: c.state,
  at: new Date(c.at).toISOString(),
  answeredAt: c.answeredAt ? new Date(c.answeredAt).toISOString() : null,
  answeredBy: c.answeredBy || null,
  messageId: c.messageId || null,
  ...(withOffer && c.offerSdp ? { offerSdp: c.offerSdp } : {}),
});

const fmtDuration = (s) => {
  const n = Math.max(0, Math.round(Number(s) || 0));
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const sec = n % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
};

/** The chat line for a call in each state. */
export function callLabel({ direction, state, duration }) {
  const inbound = direction === 'in';
  if (state === 'ringing') return inbound ? 'Incoming voice call' : 'Calling…';
  if (state === 'answered') return inbound ? 'Voice call in progress' : 'Voice call in progress';
  if (state === 'ended') return `${inbound ? 'Incoming' : 'Outgoing'} voice call · ${fmtDuration(duration)}`;
  if (state === 'missed') return 'Missed voice call';
  if (state === 'declined') return inbound ? 'Declined voice call' : 'Call declined';
  if (state === 'no_answer') return 'Outgoing voice call · No answer';
  if (state === 'failed') return inbound ? 'Voice call failed' : 'Call didn’t connect';
  return 'Voice call';
}

/** Write (or move on) the chat row for a call, and push it to the CRM. */
async function upsertRow(c, extra = {}) {
  const call = {
    id: c.id,
    direction: c.direction,
    state: c.state,
    startedAt: c.answeredAt ? new Date(c.answeredAt).toISOString() : null,
    ...(extra.duration !== undefined ? { duration: Number(extra.duration) || 0 } : {}),
    ...(extra.endedAt ? { endedAt: extra.endedAt } : {}),
    ...(extra.error ? { error: extra.error } : {}),
    ...(c.answeredBy ? { answeredBy: c.answeredBy } : {}),
  };
  const body = callLabel({ direction: c.direction, state: c.state, duration: extra.duration });
  let doc = null;
  try {
    if (c.messageId) {
      doc = await Message.findOneAndUpdate(
        { _id: c.messageId, businessId: c.businessId },
        { $set: { body, raw: { call } } },
        { new: true },
      );
    }
    if (!doc) {
      doc = await Message.findOneAndUpdate(
        { businessId: c.businessId, metaMessageId: c.id },
        { $set: { body, raw: { call } } },
        { new: true },
      );
    }
    if (!doc) {
      doc = await Message.create({
        phone: c.phone,
        name: c.name || '',
        businessId: c.businessId,
        direction: c.direction,
        type: 'call',
        body,
        raw: { call },
        metaMessageId: c.id,
        // Not a message Meta delivers: no ticks.
        status: c.direction === 'in' ? 'received' : 'sent',
        ...(c.at ? { createdAt: new Date(c.at) } : {}),
      });
    }
    c.messageId = String(doc._id);
    emitMessage(doc);
  } catch (err) {
    logger.warn('call row not saved', { call: c.id, error: err.message });
  }
  return doc;
}

/**
 * The chat list follows the call: its line, and the 24-hour window, which a
 * customer's call opens (answered or not) and so does them picking up ours.
 */
async function touchChat(c, { opensWindow = false, unread = false } = {}) {
  const body = `📞 ${callLabel({ direction: c.direction, state: c.state })}`;
  const now = new Date();
  try {
    await Conversation.findOneAndUpdate(
      { businessId: c.businessId, phone: c.phone },
      {
        $set: {
          lastMessageAt: now,
          lastMessageBody: body,
          ...(opensWindow ? { lastInboundAt: now } : {}),
          ...(c.name ? { name: c.name } : {}),
        },
        ...(unread ? { $inc: { unread: 1 } } : {}),
      },
      { upsert: true, new: true },
    );
  } catch (err) {
    logger.debug('call chat touch failed', { error: err.message });
  }
}

const outcomeOf = (c, call) => {
  const status = String(Array.isArray(call.status) ? call.status[0] : call.status || '').toUpperCase();
  const talked = Number(call.duration) > 0 || !!call.start_time;
  if (status === 'FAILED' && !talked) return 'failed';
  if (talked || c.answeredAt) return 'ended';
  if (c.state === 'declined') return 'declined';
  return c.direction === 'in' ? 'missed' : 'no_answer';
};

/** Find a call we know, in memory or (after a restart) by its chat row. */
async function findCall(businessId, id) {
  const hit = live.get(id);
  if (hit && hit.businessId === businessId) return hit;
  const row = await Message.findOne({ businessId, metaMessageId: id, type: 'call' }).lean().catch(() => null);
  if (!row) return null;
  const c = {
    id,
    businessId,
    phone: row.phone,
    name: row.name || '',
    direction: row.direction,
    state: row.raw?.call?.state || 'ringing',
    at: new Date(row.createdAt).getTime() || Date.now(),
    answeredAt: row.raw?.call?.startedAt ? new Date(row.raw.call.startedAt).getTime() : null,
    answeredBy: row.raw?.call?.answeredBy || null,
    messageId: String(row._id),
    terminated: TERMINAL.includes(row.raw?.call?.state),
  };
  live.set(id, c);
  return c;
}

/**
 * One `calls` change from the webhook, already attributed to its business.
 * @param {object} value the change's value (calls[], statuses[], contacts[])
 */
export async function handleCallsValue(value = {}, biz) {
  const businessId = String(biz._id);
  const names = {};
  for (const ct of value.contacts || []) if (ct.wa_id && ct.profile?.name) names[ct.wa_id] = ct.profile.name;

  for (const call of value.calls || []) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await onCallEvent(call, biz, names);
    } catch (err) {
      logger.warn('call event failed', { business: biz.name, event: call?.event, error: err.message });
    }
  }
  for (const st of value.statuses || []) {
    if (String(st.type || '').toLowerCase() !== 'call') continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      await onCallStatus(st, businessId);
    } catch (err) {
      logger.warn('call status failed', { business: biz.name, error: err.message });
    }
  }
}

async function onCallEvent(call, biz, names) {
  const businessId = String(biz._id);
  const id = String(call.id || '');
  if (!id) return;
  const event = String(call.event || '').toLowerCase();
  const direction = String(call.direction || '').toUpperCase();

  if (event === 'connect') {
    const sdpType = call.session?.sdp_type;
    // Ours: Meta's answer to the offer the agent's browser sent.
    if (direction === 'BUSINESS_INITIATED' || sdpType === 'answer') {
      const phone = digits(call.to);
      let c = live.get(id);
      if (!c) {
        const p = placing.get(`${businessId}|${phone}`);
        c = {
          id, businessId, phone, name: names[phone] || '', direction: 'out', state: 'ringing', at: p?.at || Date.now(),
          answeredBy: p?.tabId || null,
        };
        live.set(id, c);
      }
      emitCall(businessId, { kind: 'answer', call: present(c), sdp: call.session?.sdp || '' });
      return;
    }
    // A customer is calling.
    const phone = digits(call.from);
    if (!phone || sdpType !== 'offer' || !call.session?.sdp) return;
    if (live.has(id)) return; // Meta retried
    const c = {
      id, businessId, phone, name: names[phone] || '', direction: 'in', state: 'ringing', at: Date.now(), offerSdp: call.session.sdp,
    };
    live.set(id, c);
    logger.info('incoming WhatsApp call', { business: biz.name, call: id });
    emitCall(businessId, { kind: 'incoming', call: present(c, { withOffer: true }) });
    await upsertRow(c);
    await touchChat(c, { opensWindow: true });
    return;
  }

  if (event === 'terminate') {
    const c = (await findCall(businessId, id)) || {
      id, businessId, phone: digits(direction === 'BUSINESS_INITIATED' ? call.to : call.from), name: '',
      direction: direction === 'BUSINESS_INITIATED' ? 'out' : 'in', state: 'ringing', at: Date.now(),
    };
    if (c.terminated) return; // logged already (Meta retried)
    const err = (call.errors || [])[0];
    c.state = outcomeOf(c, call);
    c.terminated = true;
    c.offerSdp = '';
    c.at = Date.now();
    const duration = Number(call.duration) || (c.answeredAt ? Math.round((Date.now() - c.answeredAt) / 1000) : 0);
    emitCall(businessId, { kind: 'ended', call: present(c), duration });
    await upsertRow(c, {
      duration,
      endedAt: new Date().toISOString(),
      ...(err ? { error: { code: err.code ?? null, message: err.error_data?.details || err.message || '' } } : {}),
    });
    await touchChat(c, { unread: c.state === 'missed' });
    if (c.state === 'missed') {
      const who = c.name || `+${c.phone}`;
      notify(businessId, {
        type: 'call_missed',
        title: `Missed call from ${who}`,
        body: 'They called your WhatsApp number. Call back from the chat, or send a message.',
        target: { view: 'chats', phone: c.phone },
      }).catch(() => {});
    }
  }
}

async function onCallStatus(st, businessId) {
  const id = String(st.id || '');
  const status = String(st.status || '').toUpperCase();
  const c = await findCall(businessId, id);
  if (!c) return;
  if (status === 'RINGING') {
    emitCall(businessId, { kind: 'status', status: 'ringing', call: present(c) });
  } else if (status === 'ACCEPTED') {
    c.state = 'answered';
    c.answeredAt = Date.now();
    emitCall(businessId, { kind: 'status', status: 'accepted', call: present(c) });
    await upsertRow(c);
    // The customer picking up opens (or refreshes) the 24-hour window.
    await touchChat(c, { opensWindow: true });
  } else if (status === 'REJECTED') {
    c.state = 'declined';
    emitCall(businessId, { kind: 'status', status: 'rejected', call: present(c) });
  }
}

// ------------------------------------------------------ agent actions --

/** Calls still ringing for this business (a tab opened after the ring began). */
export function ringingCalls(biz) {
  const businessId = String(biz._id);
  const now = Date.now();
  return [...live.values()]
    .filter((c) => c.businessId === businessId && c.direction === 'in' && c.state === 'ringing' && now - c.at < RING_MS)
    .map((c) => present(c, { withOffer: true }));
}

/**
 * Answer a customer's call with the browser's SDP answer. Only one tab can:
 * the first claim wins, and the others are told it was answered elsewhere.
 */
export async function acceptCall(biz, callId, { sdp, tabId } = {}) {
  const client = own(biz);
  const businessId = String(biz._id);
  const c = await findCall(businessId, String(callId || ''));
  if (!c || c.direction !== 'in') throw new CallError('This call has ended.', { status: 404 });
  if (c.state !== 'ringing') {
    throw new CallError(c.state === 'answered' ? 'Someone else answered this call.' : 'This call has ended.', { status: 409, code: 'CALL_TAKEN' });
  }
  if (!sdp || !/^v=0/.test(String(sdp).trim())) throw new CallError('The browser didn’t produce a call answer.');
  if (claimed.has(c.id)) throw new CallError('Someone else is answering this call.', { status: 409, code: 'CALL_TAKEN' });
  claimed.add(c.id);
  try {
    const session = { sdp_type: 'answer', sdp: String(sdp) };
    // pre_accept lets the audio path come up before the call is live, so the
    // first words aren't clipped. Then accept with the same answer.
    await client.callAction({ call_id: c.id, action: 'pre_accept', session });
    await client.callAction({ call_id: c.id, action: 'accept', session });
  } catch (err) {
    claimed.delete(c.id);
    const e = callError(err);
    logger.warn('accepting call failed', { business: biz.name, call: c.id, error: e.message, code: e.code });
    throw new CallError(e.message, { status: 502, code: e.code });
  }
  c.state = 'answered';
  c.answeredAt = Date.now();
  c.answeredBy = tabId ? String(tabId).slice(0, 64) : null;
  c.offerSdp = '';
  claimed.delete(c.id);
  emitCall(businessId, { kind: 'answered', call: present(c) });
  await upsertRow(c);
  // Answered here: the chat isn't waiting to be read.
  Conversation.updateOne({ businessId, phone: c.phone }, { $set: { unread: 0 } }).catch(() => {});
  return present(c);
}

export async function rejectCall(biz, callId) {
  const client = own(biz);
  const businessId = String(biz._id);
  const c = await findCall(businessId, String(callId || ''));
  if (!c || c.state !== 'ringing') return { ok: true };
  try {
    await client.callAction({ call_id: c.id, action: 'reject' });
  } catch (err) {
    const e = callError(err);
    // Already gone at Meta: nothing more to do.
    logger.info('rejecting call failed', { business: biz.name, call: c.id, error: e.message });
  }
  c.state = 'declined';
  emitCall(businessId, { kind: 'status', status: 'rejected', call: present(c) });
  return { ok: true };
}

export async function endCall(biz, callId) {
  const client = own(biz);
  const businessId = String(biz._id);
  const id = String(callId || '');
  try {
    await client.callAction({ call_id: id, action: 'terminate' });
  } catch (err) {
    const e = callError(err);
    logger.info('ending call failed', { business: biz.name, call: id, error: e.message });
  }
  // The terminate webhook records the outcome; the tabs can stop now.
  const c = live.get(id);
  if (c && c.businessId === businessId) emitCall(businessId, { kind: 'hangup', call: present(c) });
  return { ok: true };
}

/** Place a call to a customer with the browser's SDP offer. */
export async function startCall(biz, { phone, sdp, tabId, name = '' } = {}) {
  const client = own(biz);
  const businessId = String(biz._id);
  const to = digits(phone);
  if (to.length < 8) throw new CallError('This chat has no phone number to call.');
  if (!sdp || !/^v=0/.test(String(sdp).trim())) throw new CallError('The browser didn’t produce a call offer.');
  const key = `${businessId}|${to}`;
  placing.set(key, { at: Date.now(), tabId: tabId ? String(tabId).slice(0, 64) : null });
  let data;
  try {
    data = await client.callAction({ to, action: 'connect', session: { sdp_type: 'offer', sdp: String(sdp) } });
  } catch (err) {
    placing.delete(key);
    const e = callError(err);
    logger.warn('starting call failed', { business: biz.name, error: e.message, code: e.code });
    // 409, not 403: the CRM signs out on a 403.
    throw new CallError(e.message, { status: e.code === 138006 ? 409 : 502, code: e.code });
  }
  const id = String(data?.calls?.[0]?.id || '');
  if (!id) throw new CallError('Meta didn’t return a call id.', { status: 502 });
  placing.delete(key);
  // The connect webhook may have created it already.
  const c = live.get(id) || {
    id, businessId, phone: to, name: String(name || '').slice(0, 120), direction: 'out', state: 'ringing', at: Date.now(),
  };
  c.answeredBy = tabId ? String(tabId).slice(0, 64) : c.answeredBy || null;
  if (!c.name && name) c.name = String(name).slice(0, 120);
  live.set(id, c);
  await upsertRow(c);
  await touchChat(c);
  return present(c);
}

// --------------------------------------------------------- permissions --

/** Can the business call this customer now? */
export async function callPermission(biz, phone) {
  const client = own(biz);
  const p = digits(phone);
  if (!p) throw new CallError('This chat has no phone number.');
  try {
    const data = await client.getCallPermission(p);
    const action = (name) => (data.actions || []).find((a) => a.action_name === name) || null;
    const start = action('start_call');
    const ask = action('send_call_permission_request');
    const status = String(data.permission?.status || 'no_permission').toLowerCase();
    return {
      status, // no_permission | temporary | permanent
      expiresAt: data.permission?.expiration_time ? new Date(Number(data.permission.expiration_time) * 1000).toISOString() : null,
      canCall: start ? !!start.can_perform_action : status !== 'no_permission',
      canAsk: ask ? !!ask.can_perform_action : true,
      // When the next request / call becomes possible, if a limit is reached.
      askAgainAt: limitEnd(ask),
      callAgainAt: limitEnd(start),
    };
  } catch (err) {
    const e = callError(err);
    throw new CallError(e.message, { status: 502, code: e.code });
  }
}

function limitEnd(action) {
  const ends = (action?.limits || []).map((l) => Number(l.limit_expiration_time) || 0).filter(Boolean);
  return ends.length ? new Date(Math.max(...ends) * 1000).toISOString() : null;
}

export async function requestCallPermission(biz, phone, body = '') {
  const client = own(biz);
  const p = digits(phone);
  if (!p) throw new CallError('This chat has no phone number.');
  try {
    const data = await client.sendCallPermissionRequest(p, body || 'We’d like to call you about your request. Can we call you on WhatsApp?');
    return { ok: true, id: data?.messages?.[0]?.id || '' };
  } catch (err) {
    const e = callError(err);
    throw new CallError(e.message, { status: 502, code: e.code });
  }
}

/** Where the browser looks for its network path to Meta (STUN, optional TURN). */
export function iceServers() {
  const stun = String(process.env.CALL_STUN_URLS || 'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const out = stun.length ? [{ urls: stun }] : [];
  if (process.env.CALL_TURN_URL) {
    out.push({
      urls: String(process.env.CALL_TURN_URL).split(',').map((s) => s.trim()).filter(Boolean),
      username: process.env.CALL_TURN_USERNAME || '',
      credential: process.env.CALL_TURN_CREDENTIAL || '',
    });
  }
  return out;
}

export default {
  getCallSettings, updateCallSettings, forgetCallSettings, shapeSettings, settingsPatch,
  handleCallsValue, ringingCalls, acceptCall, rejectCall, endCall, startCall,
  callPermission, requestCallPermission, iceServers, callLabel, callError, CallError,
};
