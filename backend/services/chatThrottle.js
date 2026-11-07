// Per-chat brake on automation (keyword templates, flows, journeys).
//
// A customer (or another bot) tapping buttons dozens of times a minute makes
// the bot answer every tap. Meta then refuses with the pair rate limit
// (131056), which counts against the number, and a bot-to-bot exchange would
// never stop. When one chat sends more than LIMIT messages in WINDOW, the bot
// stays quiet for that chat for PAUSE. Messages are still filed in the CRM,
// so an agent sees them and can answer by hand.
import logger from './logger.js';

const WINDOW_MS = Number(process.env.CHAT_AUTOMATION_WINDOW_MS || 5 * 60_000);
const LIMIT = Number(process.env.CHAT_AUTOMATION_LIMIT || 40);
const PAUSE_MS = Number(process.env.CHAT_AUTOMATION_PAUSE_MS || 10 * 60_000);

const hits = new Map(); // "<businessId>|<phone>" -> number[] (ms)
const paused = new Map(); // same key -> paused until (ms)

/**
 * Count one incoming message for automation in this chat.
 * @returns {boolean} false while the chat's automation is paused
 */
export function automationAllowed(businessId, phone, { name = '', now = Date.now() } = {}) {
  if (!phone) return true;
  const key = `${businessId || ''}|${phone}`;
  const until = paused.get(key) || 0;
  if (until > now) return false;
  if (until) paused.delete(key);

  const list = (hits.get(key) || []).filter((t) => now - t < WINDOW_MS);
  list.push(now);
  hits.set(key, list);
  if (list.length > LIMIT) {
    paused.set(key, now + PAUSE_MS);
    hits.delete(key);
    logger.warn('chat automation paused: too many messages from one chat', {
      business: name || String(businessId || ''),
      phone: `…${String(phone).slice(-4)}`,
      messages: list.length,
      windowMinutes: Math.round(WINDOW_MS / 60_000),
      pauseMinutes: Math.round(PAUSE_MS / 60_000),
    });
    return false;
  }
  if (hits.size > 20000) {
    for (const [k, l] of hits) if (!l.length || now - l[l.length - 1] > WINDOW_MS) hits.delete(k);
    for (const [k, t] of paused) if (t <= now) paused.delete(k);
  }
  return true;
}

/** Tests only. */
export function _resetChatThrottle() {
  hits.clear();
  paused.clear();
}
