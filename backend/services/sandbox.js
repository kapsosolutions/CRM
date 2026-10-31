// ---------------------------------------------------------------------------
// The shared "try it" WhatsApp number
//
// A business that hasn't connected its own WhatsApp yet can still try the CRM:
// one platform-owned number (SANDBOX_* in .env) is shared by all of them, and
// each business gets its own join code ("#K7MQ2X"). A customer who sends that
// code to the shared number is linked to that business (SandboxLink, one
// business per sender); everything they send afterwards lands in that
// business's chats exactly like a message to its own number, and the business
// can reply from the CRM within WhatsApp's 24-hour window.
//
// Each business may link at most SANDBOX_CONTACT_LIMIT (default 10) different
// senders. Once full, a new sender's join code is refused with a reply from
// the shared number; senders already linked keep working.
//
// The sandbox is not the business's WABA, so templates, Flows, catalog and
// payments are refused on it (metaCloud.js `sandbox` flag). The one exception
// is the platform's own sample templates in the shared WABA: every sandbox
// business can see them and send them from a chat (sharedTemplates /
// sendSharedTemplate below); creating or deleting them is not possible from
// the CRM. Its credentials
// never touch Business.accessToken / phoneNumberId, so a sandbox business is
// always "not connected" everywhere else in the app.
// ---------------------------------------------------------------------------
import crypto from 'crypto';
import Business from '../models/Business.js';
import SandboxLink from '../models/SandboxLink.js';
import Conversation from '../models/Conversation.js';
import Message from '../models/Message.js';
import { createMetaClient, getClientForBusiness, SANDBOX_UNSUPPORTED } from './metaCloud.js';
import { handleStatus, logInbound } from './chatbot.js';
import { processInboundMessage, contactNames } from './inbound.js';
import { touchOutbound } from './conversationState.js';
import { parkStatus, statusError } from './messageStatus.js';
import { notify } from './notifications.js';
import { emitSandboxContacts } from './eventBus.js';
import { renderTemplate } from './templateRender.js';
import logger from './logger.js';

export { SANDBOX_UNSUPPORTED };

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CONTACT_LIMIT = 10;
const HELP_EVERY_MS = 60 * 60 * 1000; // one "how to get a code" reply per sender per hour
const NOTICE_EVERY_MS = 60 * 1000; // invalid / inactive code replies
const digits = (s) => String(s || '').replace(/\D/g, '');

/** Same rule as Business.toSafeJSON().whatsappConnected: a number and a token. */
export const isWhatsAppConnected = (biz) => !!(biz?.accessToken && biz?.phoneNumberId);

/** The shared number's settings, from .env. `configured` = usable. */
export function sandboxConfig() {
  const e = process.env;
  const phoneNumberId = String(e.SANDBOX_PHONE_NUMBER_ID || '').trim();
  const displayPhone = String(e.SANDBOX_DISPLAY_PHONE || '').trim();
  return {
    configured: !!(phoneNumberId && e.SANDBOX_WABA_ID && e.SANDBOX_ACCESS_TOKEN && e.SANDBOX_APP_ID
      && displayPhone && e.META_APP_SECRET),
    phoneNumberId,
    wabaId: String(e.SANDBOX_WABA_ID || '').trim(),
    displayPhone,
    waNumber: digits(displayPhone),
  };
}

/**
 * How many different contacts one business may link on the shared number
 * (SANDBOX_CONTACT_LIMIT in .env). Anything that isn't a whole number above
 * zero falls back to the default of 10.
 */
export function sandboxContactLimit() {
  const raw = String(process.env.SANDBOX_CONTACT_LIMIT ?? '').trim();
  const n = /^\d+$/.test(raw) ? Number(raw) : 0;
  return n > 0 ? n : DEFAULT_CONTACT_LIMIT;
}

/** The Chats page counter: contacts linked to this business, and the limit. */
export async function sandboxContacts(businessId) {
  const linked = Number(await SandboxLink.countDocuments({ businessId })) || 0;
  const limit = sandboxContactLimit();
  return { linked, limit, full: linked >= limit };
}

/** Push the counter to the business's open CRM tabs. Never throws. */
async function pushContacts(businessId) {
  try {
    emitSandboxContacts(businessId, { enabled: true, ...(await sandboxContacts(businessId)) });
  } catch (err) {
    logger.warn('sandbox counter update failed', { error: err.message });
  }
}

/** Does this webhook phone_number_id belong to the shared number? */
export function isSandboxNumber(phoneNumberId) {
  const id = sandboxConfig().phoneNumberId;
  return !!id && String(phoneNumberId || '') === id;
}

// ---------------------------------------------------------------- codes --

// No look-alikes: 0/O, 1/I/L are left out so a code read off a screen can be
// typed back correctly.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_RE = /#([A-HJKMNP-Z2-9]{6})(?![A-Za-z0-9])/i;

export function generateJoinCode() {
  let s = '#';
  for (let i = 0; i < 6; i += 1) s += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return s;
}

/** A code no business holds yet. */
export async function uniqueJoinCode() {
  for (let i = 0; i < 8; i += 1) {
    const code = generateJoinCode();
    // eslint-disable-next-line no-await-in-loop
    if (!(await Business.exists({ sandboxCode: code }))) return code;
  }
  throw new Error('Could not generate a unique join code');
}

/** The join code inside a message ("hi #k7mq2x" → "#K7MQ2X"), or ''. */
export function extractJoinCode(text) {
  const m = CODE_RE.exec(String(text || ''));
  return m ? `#${m[1].toUpperCase()}` : '';
}

/**
 * This business's join code, created if it has none and isn't connected.
 * Returns '' for a connected business that never had one.
 */
export async function ensureJoinCode(biz) {
  if (biz.sandboxCode) return biz.sandboxCode;
  if (isWhatsAppConnected(biz)) return '';
  for (let i = 0; i < 8; i += 1) {
    const code = generateJoinCode();
    try {
      // Only fills an empty slot, so two concurrent calls can't hand out two codes.
      // eslint-disable-next-line no-await-in-loop
      const r = await Business.updateOne({ _id: biz._id, sandboxCode: null }, { $set: { sandboxCode: code } });
      if (r.matchedCount) {
        biz.sandboxCode = code;
        return code;
      }
      // eslint-disable-next-line no-await-in-loop
      const fresh = await Business.findById(biz._id).select('sandboxCode').lean();
      return fresh?.sandboxCode || '';
    } catch (err) {
      if (err.code !== 11000) throw err; // a collision: try another code
    }
  }
  throw new Error('Could not generate a unique join code');
}

/** Give every not-yet-connected business without a code one. Run at boot. */
export async function backfillJoinCodes() {
  const missing = (await Business.find({ sandboxCode: null })).filter((b) => !isWhatsAppConnected(b));
  let n = 0;
  for (const b of missing) {
    try {
      // eslint-disable-next-line no-await-in-loop
      if (await ensureJoinCode(b)) n += 1;
    } catch (err) {
      logger.warn('join code backfill failed', { business: b.name, error: err.message });
    }
  }
  if (n) logger.info('sandbox join codes backfilled', { businesses: n });
  return n;
}

// -------------------------------------------------------------- clients --

/**
 * A Meta client for the shared number. With a businessId, what it sends is
 * logged into that business's chat; `skipLog` sends without logging at all
 * (a reply to a sender who isn't linked to anyone).
 */
export function sandboxClient({ businessId = '', businessName = '', skipLog = false } = {}) {
  const e = process.env;
  return createMetaClient({
    token: e.SANDBOX_ACCESS_TOKEN,
    phoneNumberId: e.SANDBOX_PHONE_NUMBER_ID,
    wabaId: e.SANDBOX_WABA_ID,
    appId: e.SANDBOX_APP_ID,
    appSecret: e.META_APP_SECRET,
    graphVersion: e.WA_GRAPH_VERSION,
    businessId: businessId ? String(businessId) : '',
    businessName,
    sandbox: true,
    skipLog,
  });
}

/** The sender's link, only if it points at this (unconnected) business. */
async function linkFor(business, phone) {
  if (!business || isWhatsAppConnected(business) || !sandboxConfig().configured) return null;
  return SandboxLink.findOne({ phone: digits(phone), businessId: business._id }).lean();
}

/** Is this chat one the business holds through the shared number? */
export async function isSandboxChat(business, phone) {
  return !!(await linkFor(business, phone));
}

export const WINDOW_CLOSED = 'The 24-hour reply window with this customer has closed. '
  + 'On the shared test number you can only type a reply within 24 hours of their last message. Send them a Sample template from the Templates button instead.';

const pretty = (phone) => {
  const d = digits(phone);
  return d.length === 12 && d.startsWith('91') ? `+91 ${d.slice(2, 7)} ${d.slice(7)}` : `+${d}`;
};

/**
 * A business without its own WhatsApp can only message people who joined its
 * test number (sent its join code to the shared number). Anyone else gets this
 * instead of the generic "WhatsApp is not connected" (which read as if the
 * business had to pay or connect first). Null when the shared number isn't
 * set up (then "not connected" is right).
 */
export function notJoinedError(business, phone) {
  const cfg = sandboxConfig();
  if (!cfg.configured || isWhatsAppConnected(business)) return null;
  const code = business?.sandboxCode || '';
  const or = code ? ` (or ask them to send ${code} to ${cfg.displayPhone})` : '';
  return Object.assign(new Error(
    `${pretty(phone)} hasn’t messaged your test number yet, so you can’t type to them. `
    + `Send them a Sample template from the Templates button${or}. Once they reply, you can chat for 24 hours after each message they send.`,
  ), { code: 'SANDBOX_NOT_JOINED', status: 409 });
}

/**
 * The client a CRM reply to `phone` goes out on: the business's own number
 * when it has one, otherwise the shared number if this customer is linked to
 * the business (inside the 24-hour window only). Anything else gets the
 * business's own client, which refuses with "WhatsApp is not connected".
 */
export async function clientForChat(business, phone) {
  if (isWhatsAppConnected(business)) return getClientForBusiness(business);
  const link = await linkFor(business, phone);
  if (!link) {
    const notJoined = notJoinedError(business, phone);
    if (notJoined) throw notJoined;
    return getClientForBusiness(business);
  }
  const convo = await Conversation.findOne({ businessId: business._id, phone: digits(phone) })
    .select('lastInboundAt').lean();
  const last = convo?.lastInboundAt ? new Date(convo.lastInboundAt).getTime() : 0;
  if (!last || Date.now() - last > DAY_MS) {
    throw Object.assign(new Error(WINDOW_CLOSED), { code: 'SANDBOX_WINDOW_CLOSED', status: 409 });
  }
  return sandboxClient({ businessId: String(business._id), businessName: business.name });
}

// ------------------------------------------------------ shared templates --

const SHARED_TTL_MS = 60 * 1000;
let sharedCache = { at: 0, list: null };

/**
 * The templates in the shared number's WABA (Meta's copies, any status).
 * Cached for a minute: every sandbox business reads the same list.
 */
export async function sharedTemplates({ fresh = false } = {}) {
  if (!sandboxConfig().configured) return [];
  if (!fresh && sharedCache.list && Date.now() - sharedCache.at < SHARED_TTL_MS) return sharedCache.list;
  const list = await sandboxClient({ skipLog: true }).shared.listTemplates();
  sharedCache = { at: Date.now(), list };
  return list;
}

const VAR_RE = /\{\{\s*(\d+)\s*\}\}/g;
const bodyOf = (t) => (t?.components || []).find((c) => String(c?.type).toUpperCase() === 'BODY') || null;
/** How many {{n}} the body has (the highest n). */
function bodyVarCount(t) {
  let n = 0;
  for (const m of String(bodyOf(t)?.text || '').matchAll(VAR_RE)) n = Math.max(n, Number(m[1]));
  return n;
}
/** Meta's sample values for the body, used for any value the agent left blank. */
const bodyExamples = (t) => bodyOf(t)?.example?.body_text?.[0] || [];

/**
 * Send one of the shared number's templates in a sandbox chat. Returns null
 * when there's no such shared template (the caller refuses as before), else
 * `{ rendered }` for the chat list. Same 24-hour rule as every other reply on
 * the shared number (clientForChat throws SANDBOX_WINDOW_CLOSED).
 */
export async function sendSharedTemplate(business, phone, templateName, bodyParams = []) {
  const name = String(templateName || '');
  let tpl = (await sharedTemplates()).find((t) => t.name === name);
  if (!tpl) tpl = (await sharedTemplates({ fresh: true })).find((t) => t.name === name);
  // Authentication templates need a code button the drawer doesn't send here.
  if (!tpl || String(tpl.category).toUpperCase() === 'AUTHENTICATION') return null;
  if (tpl.status !== 'APPROVED') {
    throw Object.assign(new Error(`“${name}” isn’t approved by WhatsApp yet (status: ${tpl.status || 'unknown'}). It can be sent once it is.`), {
      status: 409, code: 'TEMPLATE_NOT_APPROVED',
    });
  }
  // The business connected meanwhile (or the shared number isn't set up): not ours to send.
  if (isWhatsAppConnected(business) || !sandboxConfig().configured) return null;
  const examples = bodyExamples(tpl);
  const given = Array.isArray(bodyParams) ? bodyParams : [];
  const params = Array.from({ length: bodyVarCount(tpl) }, (_, i) => {
    const v = String(given[i] ?? '').trim().slice(0, 1024);
    return v || String(examples[i] ?? '').trim() || '-';
  });
  const rendered = renderTemplate(tpl, { bodyParams: params });
  const p = digits(phone);
  const businessId = String(business._id);
  // Like a join: one at a time per business, so two sends can't both take the last slot.
  return serializeJoin(businessId, async () => {
    const current = await SandboxLink.findOne({ phone: p }).lean();
    const mine = !!current && String(current.businessId) === businessId;
    if (current && !mine) {
      throw Object.assign(new Error(`${pretty(p)} is already using the shared test number with another business, so you can’t message them from it. `
        + `They can switch to you by sending ${business.sandboxCode || 'your join code'} to ${sandboxConfig().displayPhone}.`), {
        status: 409, code: 'SANDBOX_LINKED_ELSEWHERE',
      });
    }
    const limit = sandboxContactLimit();
    if (!mine && (Number(await SandboxLink.countDocuments({ businessId: business._id })) || 0) >= limit) {
      throw Object.assign(new Error(`Your test inbox already has ${limit} contacts, so ${pretty(p)} can’t be added. `
        + 'Connect your own WhatsApp number to message anyone.'), { status: 409, code: 'SANDBOX_FULL' });
    }
    // Templates may go out at any time (Meta's rule); only typed replies need the 24-hour window.
    await sandboxClient({ businessId, businessName: business.name }).shared.sendTemplate(p, name, {
      languageCode: tpl.language || 'en_US',
      bodyParams: params,
      rendered,
    });
    if (!mine) {
      // Their reply now reaches this business, like a contact who sent the join code.
      await SandboxLink.findOneAndUpdate(
        { phone: p },
        { $set: { businessId: business._id, code: business.sandboxCode || '', linkedAt: new Date() } },
        { upsert: true, new: true },
      );
      logger.info('sandbox contact linked by a template', { business: business.name });
      pushContacts(business._id);
    }
    return { rendered, linked: !mine };
  });
}

/**
 * The business connected its own WhatsApp: it no longer needs the shared
 * number. Its senders are unlinked (their next message gets the "how to get a
 * code" reply); the chats they had stay in its CRM.
 */
export async function onWhatsAppConnected(biz, { pending = false } = {}) {
  const number = biz.meta?.displayPhoneNumber || '';
  const who = number ? `${number}${biz.meta?.verifiedName ? ` (${biz.meta.verifiedName})` : ''}` : '';
  notify(biz._id, pending
    // Linked, but Meta lists the number as Pending: it can't message yet.
    ? {
      type: 'whatsapp_connected',
      title: 'WhatsApp linked: activate your number',
      body: `${who || 'Your WhatsApp number'} is linked but still Pending at Meta. Open Channel Status and press Activate to start messaging.`,
      target: { view: 'channel-status' },
    }
    : {
      type: 'whatsapp_connected',
      title: 'WhatsApp connected',
      body: who ? `${who} is now connected to your CRM.` : 'Your WhatsApp Business number is now connected to your CRM.',
      target: { view: 'channel-status' },
    }).catch(() => {});
  const { deletedCount } = await SandboxLink.deleteMany({ businessId: biz._id });
  if (deletedCount) logger.info('sandbox links removed after WhatsApp connect', { business: biz.name, links: deletedCount });
  // Open Chats pages drop the test-inbox counter.
  emitSandboxContacts(biz._id, { enabled: false, linked: 0, limit: sandboxContactLimit(), full: false });
  return deletedCount;
}

// -------------------------------------------------------------- inbound --

const lastNotice = new Map(); // `${kind}:${phone}` -> ms
/** True if a notice of this kind already went to this sender recently. */
function throttled(key, everyMs) {
  const now = Date.now();
  const at = lastNotice.get(key);
  if (at && now - at < everyMs) return true;
  lastNotice.set(key, now);
  if (lastNotice.size > 5000) {
    for (const [k, t] of lastNotice) if (now - t > HELP_EVERY_MS) lastNotice.delete(k);
  }
  return false;
}

const publicUrl = () => String(process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
const helpText = () => '👋 This is the shared test number of Kapso CRM. To try it, send the join code shown on your '
  + "CRM's Chats page (it looks like #AB12CD)."
  + (publicUrl() ? ` No code yet? Register at ${publicUrl()}` : '');
const confirmText = (name) => `✅ You're connected to *${name}*'s test inbox. Messages you send here now appear in their CRM.`;
const fullText = (name, limit) => `⚠️ *${name}*'s test inbox is full: it already has ${limit} contacts on this shared `
  + "test number, so you weren't connected and your message didn't reach them. "
  + 'Please contact the business another way.';
const displayName = (biz) => biz.meta?.verifiedName || biz.name || 'this business';

/** Reply to a sender who isn't linked to anyone. Never logged anywhere. */
async function replyUnlinked(phone, text, key, everyMs) {
  if (throttled(key, everyMs)) return;
  try {
    await sandboxClient({ skipLog: true }).sendText(phone, text);
  } catch (err) {
    logger.warn('sandbox reply failed', { error: err.response?.data?.error?.message || err.message });
  }
}

const tenantCtx = (biz) => ({
  meta: sandboxClient({ businessId: String(biz._id), businessName: biz.name }),
  tenantId: String(biz._id),
  tenantName: displayName(biz),
  sandbox: true,
});

// Joins to one business run one after another, so two new senders arriving
// together can't both see room for one more contact. One backend process, so
// an in-process chain is enough (same approach as notifications.js).
const joinChains = new Map();
function serializeJoin(key, fn) {
  const prev = joinChains.get(key) || Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.catch(() => {});
  joinChains.set(key, tail);
  tail.then(() => {
    if (joinChains.get(key) === tail) joinChains.delete(key);
  });
  return run;
}

/**
 * Link the sender to `biz` unless its test inbox is full. A sender already
 * linked to it is re-linked without counting again; one linked elsewhere
 * keeps that link when this inbox is full.
 */
async function admit(biz, phone, code) {
  const limit = sandboxContactLimit();
  const current = await SandboxLink.findOne({ phone }).lean();
  const relink = !!current && String(current.businessId) === String(biz._id);
  if (!relink) {
    const linked = Number(await SandboxLink.countDocuments({ businessId: biz._id })) || 0;
    if (linked >= limit) return { full: true, limit };
  }
  // One business per sender: a newer code moves them.
  await SandboxLink.findOneAndUpdate(
    { phone },
    { $set: { businessId: biz._id, code, linkedAt: new Date() } },
    { upsert: true, new: true },
  );
  // Room was made and taken: the next time it fills up is news again.
  if (!relink) {
    await Business.updateOne({ _id: biz._id, sandboxFullNotifiedAt: { $ne: null } }, { $set: { sandboxFullNotifiedAt: null } })
      .catch((e) => logger.warn('could not reset the sandbox full notice', { error: e.message }));
  }
  return { full: false, relink, previous: current && !relink ? String(current.businessId || '') : '', limit };
}

/**
 * The inbox is full: the sender isn't linked and nothing they sent is filed.
 * They're told from the shared number; the business hears about it once.
 */
async function refuseFull(biz, phone, limit) {
  logger.info('sandbox join refused, test inbox full', { business: biz.name, limit });
  await replyUnlinked(phone, fullText(displayName(biz), limit), `full:${biz._id}:${phone}`, NOTICE_EVERY_MS);
  try {
    // Only the call that fills the empty slot notifies.
    const r = await Business.updateOne(
      { _id: biz._id, sandboxFullNotifiedAt: null },
      { $set: { sandboxFullNotifiedAt: new Date() } },
    );
    if (!r.matchedCount) return;
  } catch (err) {
    logger.warn('could not record the sandbox full notice', { error: err.message });
    return;
  }
  notify(biz._id, {
    type: 'sandbox_full',
    title: 'Test inbox is full',
    body: `Your test inbox on the shared number already has ${limit} contacts, so +${phone} couldn't join. `
      + 'Contacts already linked keep working. Connect your own WhatsApp number to remove the limit.',
    target: { view: 'channel-status' },
  }).catch(() => {});
}

/** A join code arrived: link the sender, file the message, confirm. */
async function join(phone, code, message, names) {
  const biz = await Business.findOne({ sandboxCode: code });
  if (!biz || !biz.active) {
    await replyUnlinked(phone, `That join code wasn't recognised. ${helpText()}`, `bad:${phone}`, NOTICE_EVERY_MS);
    return;
  }
  if (isWhatsAppConnected(biz)) {
    await replyUnlinked(phone, 'This join code is no longer active.', `inactive:${phone}`, NOTICE_EVERY_MS);
    return;
  }
  const outcome = await serializeJoin(String(biz._id), () => admit(biz, phone, code));
  if (outcome.full) {
    await refuseFull(biz, phone, outcome.limit);
    return;
  }
  lastNotice.delete(`help:${phone}`);
  logger.info('sandbox sender linked', { business: biz.name, relink: outcome.relink });
  if (!outcome.relink) {
    // A new contact: the counter moved here, and in the business they left.
    pushContacts(biz._id);
    if (outcome.previous) pushContacts(outcome.previous);
  }
  const who = String(names[message.from] || '').trim();
  notify(biz._id, {
    type: 'sandbox_linked',
    title: 'Test customer linked',
    body: `${who ? `${who} (+${phone})` : `+${phone}`} joined your test inbox on the shared number with your code.`,
    target: { view: 'chats', phone },
  }).catch(() => {});

  const ctx = tenantCtx(biz);
  const text = message.text?.body || '';
  await logInbound(phone, names[message.from] || '', 'text', text, message, message.id, null, ctx);
  const reply = confirmText(displayName(biz));
  try {
    await ctx.meta.sendText(phone, reply);
    await touchOutbound(phone, reply, ctx.tenantId);
  } catch (err) {
    logger.warn('sandbox confirmation failed', { error: err.response?.data?.error?.message || err.message });
  }
}

async function onMessage(message, names) {
  const phone = digits(message.from);
  if (!phone) return;

  const code = message.type === 'text' ? extractJoinCode(message.text?.body) : '';
  if (code) {
    await join(phone, code, message, names);
    return;
  }

  const link = await SandboxLink.findOne({ phone }).lean();
  const biz = link ? await Business.findById(link.businessId) : null;
  if (!biz || !biz.active || isWhatsAppConnected(biz)) {
    // A link left behind by a business that has since connected (or been
    // removed) is cleared, so the sender is told how to get a new code.
    if (link) await SandboxLink.deleteOne({ phone }).catch(() => {});
    if (message.type !== 'reaction') await replyUnlinked(phone, helpText(), `help:${phone}`, HELP_EVERY_MS);
    return;
  }
  await processInboundMessage(message, names, tenantCtx(biz));
}

/**
 * A delivery receipt for something the shared number sent. Only messages
 * logged as sandbox sends are touched, and only within their own business.
 */
async function onStatus(status) {
  if (!status?.id || !status.status) return;
  const row = await Message.findOne({ metaMessageId: status.id, 'raw.sandbox': true }).select('businessId').lean();
  if (!row) {
    // Usually the receipt beat our own save of the message; logOutbound
    // applies it. A help reply (never logged) simply expires here.
    parkStatus(status.id, status.status, status.status === 'failed' ? statusError(status) : null);
    return;
  }
  if (!row.businessId) return;
  const businessId = String(row.businessId);
  await handleStatus(status, { meta: sandboxClient({ businessId }), tenantId: businessId });
}

/** One `messages` change for the shared number (statuses and/or messages). */
export async function handleSandboxValue(value = {}) {
  if (!sandboxConfig().configured) {
    logger.warn('sandbox webhook received but the SANDBOX_* settings are incomplete, dropped');
    return;
  }
  for (const status of value.statuses || []) {
    // eslint-disable-next-line no-await-in-loop
    await onStatus(status).catch((e) => logger.error('sandbox status failed', { error: e.message }));
  }
  const names = contactNames(value);
  for (const message of value.messages || []) {
    // eslint-disable-next-line no-await-in-loop
    await onMessage(message, names).catch((e) => logger.error('sandbox message failed', { error: e.message }));
  }
}

export default {
  sandboxConfig, sandboxContactLimit, sandboxContacts,
  isSandboxNumber, isWhatsAppConnected, generateJoinCode, uniqueJoinCode, extractJoinCode,
  ensureJoinCode, backfillJoinCodes, sandboxClient, isSandboxChat, clientForChat, notJoinedError, onWhatsAppConnected,
  handleSandboxValue, sharedTemplates, sendSharedTemplate, SANDBOX_UNSUPPORTED,
};
