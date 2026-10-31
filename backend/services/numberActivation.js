// ---------------------------------------------------------------------------
// "Activate number": register a business's own number with the Cloud API
//
// A number Meta lists as PENDING (or DISCONNECTED) is in the WhatsApp Business
// Account but not registered with Cloud API, so it can't send or receive. The
// fix is POST /{phone-number-id}/register {messaging_product, pin} with the
// business's own token. The PIN is the number's two-step verification PIN:
// the existing one if it has one, otherwise a new one that the call sets.
//
// After Meta accepts, the WABA is re-subscribed (with this business's webhook
// override when it lives under the platform app), the cached Channel Status
// is dropped, and the status is polled — a bounded number of times — until it
// reads CONNECTED. The PIN is stored like waConnection.pin and never returned.
//
// Meta allows 10 register calls per number in 72 hours, so nothing here
// retries a register on its own.
// ---------------------------------------------------------------------------
import axios from 'axios';
import Business from '../models/Business.js';
import { isWhatsAppConnected } from './sandbox.js';
import { getNumberStatus, clearNumberStatus, recordNumberStatus } from './metaAccount.js';
import { subscribeWaba, usesPlatformApp } from './webhookSetup.js';
import logger from './logger.js';

const TIMEOUT_MS = 30000;
export const POLL_TRIES = 6;
export const POLL_EVERY_MS = 2500;

const graphBase = (biz) => `https://graph.facebook.com/${biz.graphVersion || process.env.WA_GRAPH_VERSION || 'v22.0'}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const isPin = (v) => /^\d{6}$/.test(String(v || ''));

export class ActivationError extends Error {
  constructor(message, { status = 400, code = 'ACTIVATION_FAILED', meta = null } = {}) {
    super(message);
    this.name = 'ActivationError';
    this.status = status;
    this.code = code;
    this.meta = meta; // { code, subcode, title, message, details } from Meta
  }

  toJSON() {
    return {
      success: false,
      code: this.code,
      message: this.message,
      metaCode: this.meta?.code ?? null,
      metaMessage: this.meta?.message || '',
    };
  }
}

const IN_USE = /already (?:registered|in use)|currently (?:registered|in use)|in use (?:on|with)|whatsapp business app|business app|consumer app|on-?prem|migrat|another (?:whatsapp )?(?:business )?account|coexist/i;

/**
 * Meta's error from a /register call → what the user is told. Meta's own
 * text always rides along in `meta.message`, so the UI can show both.
 */
export function mapRegisterError(err) {
  const e = err?.response?.data?.error || {};
  const code = Number(e.code) || null;
  const subcode = Number(e.error_subcode) || null;
  const details = e.error_data?.details || '';
  const metaText = [e.error_user_title, e.error_user_msg || e.message, details]
    .filter((s, i, a) => s && a.indexOf(s) === i)
    .join(' — ') || err?.message || 'Meta request failed';
  const meta = { code, subcode, title: e.error_user_title || '', message: metaText, details };
  const all = `${e.message || ''} ${e.error_user_msg || ''} ${e.error_user_title || ''} ${details}`;
  const make = (status, c, message) => new ActivationError(message, { status, code: c, meta });

  if (!err?.response) {
    return make(503, 'META_UNREACHABLE', "Couldn't reach Meta to activate the number. Check the connection and try again.");
  }
  switch (code) {
    case 133005:
      return make(400, 'WRONG_PIN',
        "That PIN doesn't match the two-step verification PIN already set on this number. Enter the number's current PIN. "
        + 'If nobody knows it, change it in WhatsApp Manager (the phone number → Two-step verification), then try again.');
    case 133008:
      return make(429, 'RATE_LIMITED',
        'Too many wrong PIN attempts for this number, so Meta has paused PIN checks. Wait a few hours, then try once with the correct PIN.');
    case 133009:
      return make(429, 'RATE_LIMITED', 'PIN attempts were made too quickly. Wait a few minutes, then try again.');
    case 133016:
      return make(429, 'RATE_LIMITED',
        'Meta allows 10 activation attempts per number in 72 hours, and this number has reached that limit. Try again later.');
    case 133015:
      return make(409, 'RECENTLY_DELETED',
        'This number was deleted recently and Meta is still finishing that. Wait about 5 minutes, then try again.');
    case 133006:
      return make(409, 'NEEDS_VERIFICATION',
        'This number has to be verified with a code (SMS or voice call) in WhatsApp Manager before it can be activated.');
    case 133000:
      return make(409, 'NUMBER_IN_USE',
        "A previous deregistration of this number didn't finish, so it still counts as in use elsewhere. "
        + 'Finish the migration (or deregistration) of this number, then try again.');
    case 190:
      return make(502, 'TOKEN_INVALID', "This business's WhatsApp access token is no longer valid. Reconnect WhatsApp, then try again.");
    case 10:
    case 200:
      return make(502, 'PERMISSION',
        "This business's access token isn't allowed to register the number (it needs whatsapp_business_management and whatsapp_business_messaging).");
    case 4:
    case 80007:
    case 130429:
      return make(429, 'RATE_LIMITED', 'Meta is rate-limiting requests for this account right now. Wait a few minutes, then try again.');
    case 1:
    case 2:
    case 133004:
    case 131016:
      return make(503, 'META_UNAVAILABLE', "Meta's service is temporarily unavailable. Try again in a few minutes.");
    default:
      break;
  }
  if (IN_USE.test(all)) {
    return make(409, 'NUMBER_IN_USE',
      'This number is still in use on the WhatsApp Business app (or another WhatsApp account), so it has to be moved first. '
      + 'Either migrate it to this WhatsApp Business Account, or delete the account in the WhatsApp Business app on the phone '
      + '(Settings → Account → Delete account), wait a few minutes, then try again.');
  }
  if (/\bpin\b/i.test(all)) {
    return make(400, 'PIN_REQUIRED', 'Meta needs the number\'s 6-digit two-step verification PIN to activate it. Enter the PIN and try again.');
  }
  return make(502, 'META_ERROR', "Meta couldn't activate the number.");
}

/** POST /{phone-number-id}/register with the business's own token. */
export async function registerNumber(biz, pin) {
  try {
    await axios.post(
      `${graphBase(biz)}/${encodeURIComponent(biz.phoneNumberId)}/register`,
      { messaging_product: 'whatsapp', pin: String(pin) },
      { headers: { Authorization: `Bearer ${biz.accessToken}`, 'Content-Type': 'application/json' }, timeout: TIMEOUT_MS },
    );
  } catch (err) {
    throw mapRegisterError(err);
  }
}

/** Read the status from Meta until it says CONNECTED, at most `tries` times. */
export async function pollUntilConnected(biz, { tries = POLL_TRIES, everyMs = POLL_EVERY_MS } = {}) {
  let last = null;
  for (let i = 0; i < tries; i += 1) {
    if (i > 0) await sleep(everyMs);
    const s = await getNumberStatus(biz, { force: true });
    if (s?.number && !s.stale) last = s;
    if (String(last?.number?.status || '').toUpperCase() === 'CONNECTED') return { status: last, polls: i + 1 };
  }
  return { status: last, polls: tries };
}

const running = new Set(); // business ids with an activation in progress

/**
 * Register the business's number and wait (bounded) for CONNECTED.
 * @param biz   the Business document
 * @param body  { pin?: '123456', useSavedPin?: boolean }
 * @returns {{ success, status, connected, alreadyConnected, polls, webhook, message }}
 * @throws {ActivationError}
 */
export async function activateNumber(biz, body = {}, { tries = POLL_TRIES, everyMs = POLL_EVERY_MS } = {}) {
  if (!isWhatsAppConnected(biz)) {
    throw new ActivationError('Connect your own WhatsApp number first.', { status: 409, code: 'NOT_CONNECTED' });
  }
  const id = String(biz._id);
  const typed = String(body.pin ?? '').trim();
  const saved = String(biz.waConnection?.pin || '');
  let pin = '';
  if (typed) {
    if (!isPin(typed)) throw new ActivationError('The PIN must be exactly 6 digits.', { status: 400, code: 'INVALID_PIN' });
    pin = typed;
  } else if (body.useSavedPin && isPin(saved)) {
    pin = saved;
  } else {
    throw new ActivationError(
      body.useSavedPin
        ? 'No two-step verification PIN is saved for this number. Enter its 6-digit PIN.'
        : "Enter the number's 6-digit two-step verification PIN (or a new one to set).",
      { status: 400, code: 'PIN_REQUIRED' },
    );
  }
  if (running.has(id)) {
    throw new ActivationError('This number is already being activated. Wait for that to finish.', { status: 409, code: 'ACTIVATION_RUNNING' });
  }
  running.add(id);
  try {
    // Already connected (e.g. activated in WhatsApp Manager meanwhile): no
    // register call, which would only spend one of Meta's 10 per 72 hours.
    const before = await getNumberStatus(biz, { force: true });
    if (String(before?.number?.status || '').toUpperCase() === 'CONNECTED' && !before.stale) {
      await recordNumberStatus(id, 'CONNECTED', { lastVerifiedAt: new Date() });
      return {
        success: true, status: 'CONNECTED', connected: true, alreadyConnected: true, polls: 0, webhook: null,
        message: 'This number is already connected.',
      };
    }

    await registerNumber(biz, pin);
    logger.info('phone number registered with Cloud API', { business: biz.name, phoneNumberId: biz.phoneNumberId });

    // The PIN Meta accepted is now the number's PIN. Only this key is
    // written, so the rest of waConnection stays as it was.
    await Business.updateOne({ _id: id }, { $set: { 'waConnection.pin': pin } });
    biz.waConnection = { ...(biz.waConnection || {}), pin };

    // Messages only arrive once the WABA is subscribed: platform-app
    // (Embedded Signup) businesses with their own callback override.
    const webhook = await subscribeWaba(biz, { override: usesPlatformApp(biz) });

    clearNumberStatus(id);
    const { status: after, polls } = await pollUntilConnected(biz, { tries, everyMs });
    const s = String(after?.number?.status || 'PENDING').toUpperCase();
    const extra = { lastVerifiedAt: new Date() };
    if (after?.number?.displayPhoneNumber) extra.displayPhoneNumber = after.number.displayPhoneNumber;
    if (after?.number?.verifiedName) extra.verifiedName = after.number.verifiedName;
    if (after?.number?.qualityRating) extra.qualityRating = after.number.qualityRating;
    await recordNumberStatus(id, s, extra);
    const connected = s === 'CONNECTED';
    return {
      success: true,
      status: s,
      connected,
      alreadyConnected: false,
      polls,
      webhook: webhook.ok ? { ok: true } : { ok: false, reason: webhook.reason || '' },
      message: connected
        ? 'Your number is connected and can send and receive messages.'
        : 'Meta accepted the activation. The number can take a few minutes to show as Connected; this page updates when it does.',
    };
  } finally {
    running.delete(id);
  }
}

export default { activateNumber, registerNumber, mapRegisterError, pollUntilConnected, isPin, ActivationError };
