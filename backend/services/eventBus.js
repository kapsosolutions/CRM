// Tiny event bus so services can emit CRM socket events without importing the
// Socket.IO server directly. server.js registers the io instance via setIO().
//
// Every event is addressed to one tenant's room.
//
// This used to be `io.emit(...)`, which is a broadcast to every connected
// browser regardless of who it belongs to. A customer messaging business A
// made business B's CRM beep, raise a desktop notification carrying A's
// message text, and — whenever both tenants had a chat open with the same
// phone number, which is exactly what happens when one person is a customer
// of both — append A's message straight into B's open thread. Addressing the
// event is not cosmetic, it's the isolation boundary.
import logger from './logger.js';

let io = null;

export function setIO(instance) {
  io = instance;
}

/** The Socket.IO room every one of a tenant's open CRM tabs sits in. */
export const roomFor = (businessId) => `biz:${String(businessId)}`;

/**
 * Send one event to one tenant.
 * @returns {boolean} whether it was delivered anywhere
 */
function send(event, businessId, payload) {
  if (!io) return false;
  const id = businessId ? String(businessId) : '';
  if (!id) {
    // No tenant means no addressee. Falling back to a broadcast "so it isn't
    // lost" is the bug this replaced: better a missing live update, which a
    // refresh fixes, than another tenant's data on someone else's screen.
    logger.warn('socket event dropped — no businessId to address it to', { event });
    return false;
  }
  io.to(roomFor(id)).emit(event, payload);
  return true;
}

/** A new inbound/outbound message. The stored doc already names its tenant. */
export function emitMessage(message) {
  return send('crm:message', message?.businessId, message);
}

/** A delivery/read receipt. Status payloads carry no tenant, so pass one. */
export function emitStatus(update, businessId) {
  return send('crm:status', businessId ?? update?.businessId, update);
}

/** An emoji reaction. As above — the tenant has to come from the caller. */
export function emitReaction(update, businessId) {
  return send('crm:reaction', businessId ?? update?.businessId, update);
}

/** A new or updated notification (bell + drawer), with the tenant's unread count. */
export function emitNotification(businessId, payload) {
  return send('crm:notification', businessId, payload);
}

/** The unread notification count changed (marked read, here or in another tab). */
export function emitNotificationCount(businessId, unread) {
  return send('crm:notification-count', businessId, { unread });
}

/**
 * The shared test number's contact counter changed (Chats page): someone
 * joined or left, or `enabled:false` once the business connected its own number.
 */
export function emitSandboxContacts(businessId, payload) {
  return send('crm:sandbox', businessId, { ...payload, businessId: String(businessId) });
}

export default {
  setIO, roomFor, emitMessage, emitStatus, emitReaction, emitNotification, emitNotificationCount,
  emitSandboxContacts,
};
