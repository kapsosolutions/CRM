// ---------------------------------------------------------------------------
// Webhook callback URL sync
//
// Meta delivers inbound messages to whatever callback URL is configured on the
// Meta *app* (App dashboard → WhatsApp → Configuration). During development
// that URL is an ngrok tunnel, and ngrok hands out a new hostname every time it
// restarts — so the app keeps posting to a dead address and nothing arrives.
// The symptom is silent: no error anywhere, the chat simply stays empty.
//
// Rather than asking the operator to re-paste the URL by hand, this keeps the
// app's subscription pointed at the current PUBLIC_BASE_URL. Meta verifies a
// new URL with a GET handshake before accepting it, which routes/webhook.js
// answers using the tenant's own verifyToken.
// ---------------------------------------------------------------------------
import axios from 'axios';
import Business from '../models/Business.js';
import logger from './logger.js';

const OBJECT = 'whatsapp_business_account';
// Always keep these, whatever the app had before: without `messages` no inbound
// message is delivered at all.
// `standby` + `messaging_handovers`: when another Meta app on a business's
// number holds a chat (an old automation still attached), its messages come on
// `standby` instead of `messages`, and would otherwise never reach the CRM
// (services/otherApps.js).
const REQUIRED_FIELDS = ['messages', 'message_template_status_update', 'standby', 'messaging_handovers'];

const graph = (business) =>
  `https://graph.facebook.com/${business.graphVersion || process.env.WA_GRAPH_VERSION || 'v22.0'}`;

export function webhookCallbackUrl(businessId, baseUrl = process.env.PUBLIC_BASE_URL) {
  const base = String(baseUrl || '').replace(/\/$/, '');
  return base ? `${base}/api/whatsapp/webhook/${businessId}` : '';
}

/**
 * The platform app's single callback URL.
 *
 * Businesses connected through Embedded Signup all live under OUR Meta app
 * (the Tech Provider app), and an app has exactly one callback URL — so they
 * can't each have their own. Meta delivers every one of their WABAs' events
 * here, and routes/webhook.js attributes each change by the phone number id
 * that received it.
 */
export function platformCallbackUrl(baseUrl = process.env.PUBLIC_BASE_URL) {
  const base = String(baseUrl || '').replace(/\/$/, '');
  return base ? `${base}/api/whatsapp/webhook` : '';
}

/** Is this business served by the platform's own Meta app? */
export const usesPlatformApp = (business) =>
  !!process.env.META_APP_ID && String(business?.appId || '') === String(process.env.META_APP_ID);

/**
 * Point the platform app's webhook at this server.
 * @returns {Promise<{ok: boolean, changed: boolean, to?: string, from?: string, reason?: string}>}
 */
export async function syncPlatformWebhook() {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN;
  const want = platformCallbackUrl();
  if (!appId || !appSecret || !verifyToken) return { ok: false, changed: false, reason: 'META_APP_ID / META_APP_SECRET / META_WEBHOOK_VERIFY_TOKEN not set' };
  if (!want) return { ok: false, changed: false, reason: 'PUBLIC_BASE_URL is not set' };
  const app = { appId, appSecret, graphVersion: process.env.WA_GRAPH_VERSION };
  let current = null;
  try {
    current = await readSubscription(app);
  } catch (e) {
    return { ok: false, changed: false, reason: e.response?.data?.error?.message || e.message };
  }
  const existing = (current?.fields || []).map((f) => f.name || f).filter(Boolean);
  const hasFields = REQUIRED_FIELDS.every((f) => existing.includes(f));
  if (current?.callback_url === want && current?.active && hasFields) return { ok: true, changed: false, to: want };
  try {
    await axios.post(
      `${graph(app)}/${appId}/subscriptions`,
      new URLSearchParams({
        object: OBJECT,
        callback_url: want,
        verify_token: verifyToken,
        fields: [...new Set([...existing, ...REQUIRED_FIELDS])].join(','),
        access_token: `${appId}|${appSecret}`,
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );
  } catch (e) {
    return { ok: false, changed: false, reason: e.response?.data?.error?.message || e.message };
  }
  return { ok: true, changed: true, from: current?.callback_url || '', to: want };
}

/** The app's current `whatsapp_business_account` subscription, or null. */
async function readSubscription(business) {
  const appToken = `${business.appId}|${business.appSecret}`;
  const { data } = await axios.get(`${graph(business)}/${business.appId}/subscriptions`, {
    params: { access_token: appToken },
  });
  return (data?.data || []).find((s) => s.object === OBJECT) || null;
}

/**
 * Point the tenant's Meta app at this server's webhook URL, if it isn't already.
 *
 * @returns {Promise<{ok: boolean, changed: boolean, from?: string, to?: string, reason?: string}>}
 */
export async function syncWebhookSubscription(business) {
  const want = webhookCallbackUrl(business._id);
  if (!want) return { ok: false, changed: false, reason: 'PUBLIC_BASE_URL is not set' };
  // Embedded-Signup businesses live under the shared platform app, whose
  // app-level callback must never be re-pointed from here. Their messages
  // reach us through a per-WABA override instead, re-asserted so it follows
  // PUBLIC_BASE_URL (a new tunnel, a new deploy).
  if (usesPlatformApp(business)) {
    const r = await subscribeWaba(business, { override: true });
    return r.ok
      ? { ok: true, changed: false, to: want, override: true }
      : { ok: false, changed: false, reason: r.reason, override: true };
  }
  if (!business.appId || !business.appSecret) {
    return { ok: false, changed: false, reason: 'App ID / App secret are not stored for this business' };
  }

  let current = null;
  try {
    current = await readSubscription(business);
  } catch (e) {
    return { ok: false, changed: false, reason: e.response?.data?.error?.message || e.message };
  }

  if (current?.callback_url === want && current?.active) {
    return { ok: true, changed: false, to: want };
  }

  // Re-sending a subscription replaces its field list, so carry the existing
  // fields over instead of silently narrowing what the app receives.
  const existing = (current?.fields || []).map((f) => f.name || f).filter(Boolean);
  const fields = [...new Set([...existing, ...REQUIRED_FIELDS])].join(',');

  try {
    await axios.post(
      `${graph(business)}/${business.appId}/subscriptions`,
      new URLSearchParams({
        object: OBJECT,
        callback_url: want,
        verify_token: business.verifyToken,
        fields,
        access_token: `${business.appId}|${business.appSecret}`,
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );
  } catch (e) {
    return { ok: false, changed: false, reason: e.response?.data?.error?.message || e.message };
  }

  // Inbound messages also need the WABA subscribed to the app. Already true for
  // a working tenant, but harmless to re-assert and it covers a fresh WABA.
  await subscribeWaba(business);

  return { ok: true, changed: true, from: current?.callback_url || '', to: want };
}

/**
 * Subscribe the business's WABA to its app, so its messages are delivered.
 * With `override`, the WABA's events go to this business's own callback URL
 * rather than the app-level one (Meta verifies it with the verify token).
 */
export async function subscribeWaba(business, { override = false } = {}) {
  if (!business.wabaId || !business.accessToken) return { ok: false, reason: 'WhatsApp is not connected' };
  const body = override
    ? { override_callback_uri: webhookCallbackUrl(business._id), verify_token: business.verifyToken }
    : {};
  try {
    await axios.post(
      `${graph(business)}/${business.wabaId}/subscribed_apps`,
      body,
      { headers: { Authorization: `Bearer ${business.accessToken}` } },
    );
    return { ok: true };
  } catch (e) {
    const reason = e.response?.data?.error?.message || e.message;
    logger.warn('subscribe WABA to app failed', { business: business.name, error: reason });
    return { ok: false, reason };
  }
}

/** The shared "try it" number's own callback URL. */
export function sandboxCallbackUrl(baseUrl = process.env.PUBLIC_BASE_URL) {
  const base = String(baseUrl || '').replace(/\/$/, '');
  return base ? `${base}/api/whatsapp/webhook/sandbox` : '';
}

/**
 * Subscribe the shared number's WABA (SANDBOX_WABA_ID, and only that one) to
 * the platform app, with its events overridden to the sandbox callback.
 * Re-asserted on every boot so it follows PUBLIC_BASE_URL.
 */
export async function syncSandboxWebhook() {
  const wabaId = process.env.SANDBOX_WABA_ID;
  const token = process.env.SANDBOX_ACCESS_TOKEN;
  const verifyToken = process.env.SANDBOX_WEBHOOK_VERIFY_TOKEN;
  const want = sandboxCallbackUrl();
  if (!wabaId || !token || !verifyToken) {
    return { ok: false, reason: 'SANDBOX_WABA_ID / SANDBOX_ACCESS_TOKEN / SANDBOX_WEBHOOK_VERIFY_TOKEN not set' };
  }
  if (!want) return { ok: false, reason: 'PUBLIC_BASE_URL is not set' };
  try {
    await axios.post(
      `${graph({})}/${wabaId}/subscribed_apps`,
      { override_callback_uri: want, verify_token: verifyToken },
      { headers: { Authorization: `Bearer ${token}` }, timeout: 30000 },
    );
    return { ok: true, to: want };
  } catch (e) {
    return { ok: false, reason: e.response?.data?.error?.message || e.message };
  }
}

/** Sync every active tenant. Called at startup; never throws. */
export async function syncAllWebhooks() {
  if (!process.env.PUBLIC_BASE_URL) {
    logger.warn('PUBLIC_BASE_URL is not set — skipping webhook URL sync, inbound messages will not arrive');
    return;
  }
  // The shared test number. Skipped quietly-but-visibly when not configured.
  const sandbox = await syncSandboxWebhook().catch((e) => ({ ok: false, reason: e.message }));
  if (sandbox.ok) logger.info(`sandbox WABA subscribed (override → ${sandbox.to})`);
  else logger.warn('sandbox WABA not subscribed', { reason: sandbox.reason });

  // The platform app's callback is shared by every deployment that uses this
  // Meta app, so re-pointing it is opt-in: a dev server must not silently
  // take a live deployment's webhook away from it.
  if (String(process.env.META_PLATFORM_WEBHOOK_SYNC || '').toLowerCase() === 'true') {
    const platform = await syncPlatformWebhook();
    if (platform.changed) logger.info('platform app webhook updated at Meta', { from: platform.from, to: platform.to });
    else if (platform.ok) logger.info('platform app webhook already correct', { url: platform.to });
    else logger.warn('platform app webhook not synced', { reason: platform.reason });
  }

  let businesses = [];
  try {
    // Not-yet-connected businesses have nothing at Meta to point anywhere.
    businesses = (await Business.find({ active: true })).filter((b) => b.accessToken && b.wabaId);
  } catch (e) {
    logger.warn('webhook sync: could not load businesses', { error: e.message });
    return;
  }
  for (const b of businesses) {
    const r = await syncWebhookSubscription(b);
    if (r.changed) logger.info('webhook callback URL updated at Meta', { business: b.name, from: r.from, to: r.to });
    else if (r.ok) logger.info('webhook callback URL already correct', { business: b.name, url: r.to });
    else logger.warn('webhook callback URL not synced', { business: b.name, reason: r.reason });
  }
}

export default {
  syncWebhookSubscription, syncAllWebhooks, syncPlatformWebhook, subscribeWaba, syncSandboxWebhook,
  webhookCallbackUrl, platformCallbackUrl, sandboxCallbackUrl, usesPlatformApp,
};
