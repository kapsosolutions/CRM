// ---------------------------------------------------------------------------
// "Talk to us" on an update template (services/updateTemplates.js).
//
// The customer is asking for a person. A tap used to go nowhere: the flow map
// only starts on typed messages and a journey only follows taps it wired
// itself, so the customer got no reply at all. Now the tap:
//   • gets an answer straight away ("Someone from <business> will reply here"),
//   • alerts the team (bell, sound and push, opening that chat),
//   • switches the chat to Manual for HANDOFF_HOURS, so whatever they type next
//     reaches the team instead of restarting the flow. Chats → Auto ends it
//     early; it ends by itself after that.
// ---------------------------------------------------------------------------
import Conversation from '../models/Conversation.js';
import { notify } from './notifications.js';
import { touchOutbound } from './conversationState.js';
import logger from './logger.js';

/** The reply button's label, and the payload each send gives it. */
export const TALK_TEXT = 'Talk to us';
export const TALK_PAYLOAD = 'u:talk';
export const HANDOFF_HOURS = 24;

const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Is this inbound a "Talk to us" tap?
 * `byText`: also a tap with no payload of ours (a template sent before the
 * payload existed, or one the business made with that button), matched on its
 * label. Callers use that only once a journey has had its chance to claim it.
 */
export function isTalkTap(msg, { byText = false } = {}) {
  if (!msg?.templateReply) return false;
  if (msg.buttonPayload === TALK_PAYLOAD) return true;
  return byText && !/^[nfu]:/.test(String(msg.buttonPayload || '')) && norm(msg.text) === norm(TALK_TEXT);
}

/** The customer's reply: their first name, then who will answer. */
export function talkReplyText(name, businessName) {
  const first = String(name || '').trim().split(/\s+/)[0] || '';
  const who = String(businessName || '').trim() || 'our team';
  return `Sure${first ? `, ${first}` : ''}. Someone from ${who} will reply to you here shortly.`;
}

/**
 * Answer the tap, alert the team and hand the chat to them.
 * @returns true once the reply went out
 */
export async function runTalkToUs(meta, { businessId, businessName, phone, name }) {
  const p = String(phone || '').replace(/\D/g, '');
  if (!p) return false;
  const text = talkReplyText(name, businessName);
  let sent = false;
  try {
    await meta.sendText(p, text);
    await touchOutbound(p, text, businessId);
    sent = true;
  } catch (err) {
    logger.warn('talk-to-us reply failed', { phone: p, error: err.response?.data?.error?.message || err.message });
  }
  if (businessId) {
    try {
      await Conversation.findOneAndUpdate(
        { businessId, phone: p },
        { $set: { botPaused: true, botPausedUntil: new Date(Date.now() + HANDOFF_HOURS * 3600e3) } },
        { upsert: true },
      );
    } catch (err) {
      logger.warn('talk-to-us: could not hand the chat to the team', { phone: p, error: err.message });
    }
    const who = String(name || '').trim() || `+${p}`;
    await notify(businessId, {
      type: 'talk_request',
      title: `${who} wants to talk to you`,
      body: `They tapped “${TALK_TEXT}”. Automation is paused in this chat for ${HANDOFF_HOURS} hours so you can reply.`,
      target: { view: 'chats', phone: p },
      groupKey: `talk:${p}`,
    });
  }
  logger.info('talk-to-us tap handled', { phone: p, replied: sent });
  return sent;
}

export default { isTalkTap, runTalkToUs, talkReplyText, TALK_TEXT, TALK_PAYLOAD, HANDOFF_HOURS };
