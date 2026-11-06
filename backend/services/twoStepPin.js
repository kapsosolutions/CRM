// ---------------------------------------------------------------------------
// Two-step verification PIN of a business's own number (Channel Status →
// Two-step verification).
//
// Meta asks for this 6-digit PIN whenever the number is registered with the
// Cloud API again (a new provider, a re-activation), so someone who gets the
// number's access can't move it without it. POST /{phone-number-id} {pin}
// with the business's own token sets a new PIN, replacing the old one; Meta
// doesn't ask for the old PIN and has no endpoint to turn the PIN off.
//
// The PIN Meta accepted is stored as waConnection.pin (the same key signup
// and "Activate number" use, so a later activation can reuse it) and is
// never sent back to the browser.
// ---------------------------------------------------------------------------
import axios from 'axios';
import Business from '../models/Business.js';
import { isWhatsAppConnected } from './sandbox.js';
import { ActivationError, isPin } from './numberActivation.js';
import logger from './logger.js';

const TIMEOUT_MS = 30000;
// Changes per business per hour. Meta also throttles PIN changes; this keeps
// a stuck button or a script from spending them.
export const MAX_CHANGES_PER_HOUR = 5;
const HOUR_MS = 60 * 60 * 1000;

const graphBase = (biz) => `https://graph.facebook.com/${biz.graphVersion || process.env.WA_GRAPH_VERSION || 'v22.0'}`;

const recent = new Map(); // business id → timestamps of accepted changes
const running = new Set(); // business ids with a change in flight

/** For tests: forget the per-business counters. */
export function resetTwoStepLimits() {
  recent.clear();
  running.clear();
}

/** Meta's error from POST /{phone-number-id} {pin} → what the user is told. */
export function mapPinError(err) {
  const e = err?.response?.data?.error || {};
  const code = Number(e.code) || null;
  const details = e.error_data?.details || '';
  const metaText = [e.error_user_title, e.error_user_msg || e.message, details]
    .filter((s, i, a) => s && a.indexOf(s) === i)
    .join(' — ') || err?.message || 'Meta request failed';
  const meta = { code, subcode: Number(e.error_subcode) || null, title: e.error_user_title || '', message: metaText, details };
  const make = (status, c, message) => new ActivationError(message, { status, code: c, meta });

  if (!err?.response) {
    return make(503, 'META_UNREACHABLE', "Couldn't reach Meta to set the PIN. Check the connection and try again.");
  }
  switch (code) {
    case 190:
      return make(502, 'TOKEN_INVALID', "This business's WhatsApp access token is no longer valid. Reconnect WhatsApp, then try again.");
    case 10:
    case 200:
      return make(502, 'PERMISSION', "This business's access token isn't allowed to change the number's settings (it needs whatsapp_business_management).");
    case 4:
    case 80007:
    case 130429:
    case 133008:
    case 133009:
      return make(429, 'RATE_LIMITED', 'Meta is limiting PIN changes for this number right now. Wait a while, then try again.');
    case 1:
    case 2:
    case 131016:
      return make(503, 'META_UNAVAILABLE', "Meta's service is temporarily unavailable. Try again in a few minutes.");
    default:
      break;
  }
  return make(502, 'META_ERROR',
    "Meta didn't accept the new PIN. Meta is retiring the PIN for some numbers: if WhatsApp Manager no longer shows "
    + 'Two-step verification for this number, it has no PIN to set.');
}

/**
 * Set (or change) the number's two-step verification PIN.
 * @param biz  the Business document
 * @param pin  six digits
 * @returns {{ success: true, pinSetAt: Date, message: string }}
 * @throws {ActivationError}
 */
export async function setTwoStepPin(biz, pin) {
  if (!isWhatsAppConnected(biz) || !biz.phoneNumberId) {
    throw new ActivationError('Connect your own WhatsApp number first.', { status: 409, code: 'NOT_CONNECTED' });
  }
  const value = String(pin ?? '').trim();
  if (!isPin(value)) throw new ActivationError('The PIN must be exactly 6 digits.', { status: 400, code: 'INVALID_PIN' });

  const id = String(biz._id);
  const now = Date.now();
  const lastHour = (recent.get(id) || []).filter((t) => now - t < HOUR_MS);
  if (lastHour.length >= MAX_CHANGES_PER_HOUR) {
    throw new ActivationError(
      `The PIN has been changed ${MAX_CHANGES_PER_HOUR} times in the last hour. Wait a while before changing it again.`,
      { status: 429, code: 'TOO_MANY_CHANGES' },
    );
  }
  if (running.has(id)) {
    throw new ActivationError('The PIN is already being changed. Wait for that to finish.', { status: 409, code: 'PIN_CHANGE_RUNNING' });
  }
  running.add(id);
  try {
    try {
      await axios.post(
        `${graphBase(biz)}/${encodeURIComponent(biz.phoneNumberId)}`,
        { pin: value },
        { headers: { Authorization: `Bearer ${biz.accessToken}`, 'Content-Type': 'application/json' }, timeout: TIMEOUT_MS },
      );
    } catch (err) {
      throw mapPinError(err);
    }
    recent.set(id, [...lastHour, now]);

    // Meta accepted it, so it is the number's PIN now: keep it for a later
    // re-activation. Only these keys are written.
    const pinSetAt = new Date(now);
    await Business.updateOne({ _id: id }, { $set: { 'waConnection.pin': value, 'waConnection.pinSetAt': pinSetAt } });
    biz.waConnection = { ...(biz.waConnection || {}), pin: value, pinSetAt };
    logger.info('two-step verification PIN set', { business: biz.name, phoneNumberId: biz.phoneNumberId });
    return { success: true, pinSetAt, message: 'The new two-step verification PIN is set on your number.' };
  } finally {
    running.delete(id);
  }
}

export default { setTwoStepPin, mapPinError, resetTwoStepLimits, MAX_CHANGES_PER_HOUR };
