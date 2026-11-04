// Per-chat flags set from the chat's ⋮ menu that other services must respect:
// a blocked contact (nothing in or out), a muted chat (no alerts).
//
// A leaf module (only the Conversation model) so the inbound, notification
// and calling code can all import it without import cycles.
import Conversation from '../models/Conversation.js';

const digits = (v) => String(v ?? '').replace(/\D/g, '');

/** "Always": a mute that never runs out. */
export const MUTE_FOREVER = new Date('9999-12-31T00:00:00.000Z');

export const BLOCKED_MESSAGE = 'You blocked this contact. Unblock them to send a message or call.';

async function flagsOf(businessId, phone) {
  const p = digits(phone);
  if (!businessId || !p) return null;
  try {
    return await Conversation.findOne({ businessId: String(businessId), phone: p })
      .select('blocked mutedUntil')
      .lean();
  } catch {
    // A failed lookup never blocks or silences anything.
    return null;
  }
}

/** The business blocked this contact (in the CRM, and at Meta when it could). */
export async function isBlocked(businessId, phone) {
  return !!(await flagsOf(businessId, phone))?.blocked;
}

/** The chat is muted right now: its messages make no sound, pop-up or push. */
export function mutedNow(convo, now = Date.now()) {
  const until = convo?.mutedUntil ? new Date(convo.mutedUntil).getTime() : 0;
  return until > now;
}

export async function isMuted(businessId, phone) {
  return mutedNow(await flagsOf(businessId, phone));
}

/** Throws a 409 the routes pass straight through when the contact is blocked. */
export async function assertNotBlocked(businessId, phone) {
  if (await isBlocked(businessId, phone)) {
    throw Object.assign(new Error(BLOCKED_MESSAGE), { status: 409, code: 'CONTACT_BLOCKED' });
  }
}
