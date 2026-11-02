// ---------------------------------------------------------------------------
// Web Push: desktop notifications that arrive even when no CRM tab is open.
//
// Every notification the bell gets (notifications.notify) is also pushed to
// the business's subscribed browsers whose Settings → Manage Notifications
// allow it. The browser's service worker (frontend/public/sw.js) shows it,
// unless a CRM tab is in front (that tab shows its own in-app alert).
//
// Needs VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY (and optionally VAPID_SUBJECT)
// in the environment. Without them pushes are simply off and the page falls
// back to notifications while a tab is open.
// ---------------------------------------------------------------------------
import webpush from 'web-push';
import PushSubscription from '../models/PushSubscription.js';
import { categoryOf } from './notificationCategories.js';
import logger from './logger.js';

const env = () => ({
  pub: String(process.env.VAPID_PUBLIC_KEY || '').trim(),
  priv: String(process.env.VAPID_PRIVATE_KEY || '').trim(),
  subject: String(process.env.VAPID_SUBJECT || process.env.PUBLIC_BASE_URL || 'https://kapsosolutions.com').trim(),
});

let readyFor = '';
/** True when keys are set (and web-push is set up with them). */
export function pushConfigured() {
  const { pub, priv, subject } = env();
  if (!pub || !priv) return false;
  const key = `${pub}|${subject}`;
  if (readyFor !== key) {
    try {
      webpush.setVapidDetails(/^(mailto:|https:)/.test(subject) ? subject : `mailto:${subject}`, pub, priv);
      readyFor = key;
    } catch (err) {
      logger.warn('web push keys are invalid', { error: err.message });
      return false;
    }
  }
  return true;
}

export const publicKey = () => (pushConfigured() ? env().pub : '');

/** Whether a browser's choices allow a desktop nudge for this category (missing = yes, the defaults). */
export function wantsPush(prefs, category) {
  if (!prefs || typeof prefs !== 'object') return true;
  if (prefs.allowDesktop === false) return false;
  const row = prefs.events && typeof prefs.events === 'object' ? prefs.events[category] : null;
  return !row || row.desktop !== false;
}

/** Only what a browser may send us: the push address and its two keys. */
export function cleanSubscription(s) {
  const endpoint = String(s?.endpoint || '');
  const p256dh = String(s?.keys?.p256dh || '');
  const auth = String(s?.keys?.auth || '');
  if (!/^https:\/\/[^\s]{10,2000}$/.test(endpoint) || !/^[\w-]{20,200}$/.test(p256dh) || !/^[\w-]{8,100}$/.test(auth)) return null;
  return { endpoint, keys: { p256dh, auth } };
}

/** The device's choices as stored: booleans and the sound name only. */
export function cleanPrefs(p) {
  if (!p || typeof p !== 'object') return null;
  const events = {};
  for (const [k, v] of Object.entries(p.events && typeof p.events === 'object' ? p.events : {})) {
    if (!/^[a-zA-Z]{2,40}$/.test(k) || !v || typeof v !== 'object') continue;
    events[k] = { desktop: v.desktop !== false, sound: v.sound !== false };
  }
  return {
    allowDesktop: p.allowDesktop !== false,
    allowSound: p.allowSound !== false,
    soundType: /^[a-z]{2,20}$/.test(String(p.soundType || '')) ? String(p.soundType) : 'default',
    events,
  };
}

const MAX_FAILURES = 10;

/**
 * Push one (presented) notification to the business's browsers. Never throws.
 * The notification's id is the tag, so a chat's grouped notification
 * replaces its earlier one on screen instead of stacking.
 */
export async function sendPush(businessId, n) {
  if (!businessId || !n || !pushConfigured()) return 0;
  let subs;
  try {
    subs = await PushSubscription.find({ businessId: String(businessId) }).lean();
  } catch (err) {
    logger.warn('push subscriptions not read', { error: err.message });
    return 0;
  }
  const category = n.category || categoryOf(n.type, n.title);
  const targets = subs.filter((s) => wantsPush(s.prefs, category));
  if (!targets.length) return 0;
  const payload = JSON.stringify({
    id: n._id,
    type: n.type,
    category,
    title: n.title || 'Kapso CRM',
    body: n.body || '',
    count: n.count || 1,
    target: n.target || {},
  });
  const urgent = ['message', 'chatNew', 'order', 'payment', 'booking'].includes(category);
  let sent = 0;
  await Promise.all(targets.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload, { TTL: 60 * 60, urgency: urgent ? 'high' : 'normal' });
      sent += 1;
      await PushSubscription.updateOne({ _id: s._id }, { $set: { failures: 0, lastSentAt: new Date() } }).catch(() => {});
    } catch (err) {
      const code = err?.statusCode || 0;
      // The browser unsubscribed or the address expired: forget it.
      if (code === 404 || code === 410 || (s.failures || 0) + 1 >= MAX_FAILURES) {
        await PushSubscription.deleteOne({ _id: s._id }).catch(() => {});
        logger.info('push subscription removed', { businessId: String(businessId), status: code || 'too many failures' });
      } else {
        await PushSubscription.updateOne({ _id: s._id }, { $set: { failures: (s.failures || 0) + 1 } }).catch(() => {});
        logger.warn('push not delivered', { businessId: String(businessId), status: code, error: String(err?.body || err?.message || '').slice(0, 200) });
      }
    }
  }));
  return sent;
}

export default { pushConfigured, publicKey, wantsPush, cleanSubscription, cleanPrefs, sendPush };
