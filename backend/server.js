import express from 'express';
// Must load before the routers: makes a failed await in any route a 500
// response rather than a crash (see the file for why).
import './services/asyncRoutes.js';
import http from 'http';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server as SocketServer } from 'socket.io';

import logger from './services/logger.js';
import db from './db/index.js';
import { setIO, roomFor } from './services/eventBus.js';
import { businessFromToken } from './middleware/auth.js';
import { apiCors } from './middleware/apiKey.js';
import { syncAllWebhooks } from './services/webhookSetup.js';
import { runTenantMigration } from './services/tenantMigration.js';
import { backfillJoinCodes } from './services/sandbox.js';
import { startOrderExpiry } from './services/orderExpiry.js';
import { startGeocodeQueue } from './services/geocode.js';
import { startCampaignRunner } from './services/campaignRunner.js';

import webhookRouter, { sandboxWebhookRouter } from './routes/webhook.js';
import sandboxRouter from './routes/sandbox.js';
import channelRouter from './routes/channel.js';
import callsRouter from './routes/calls.js';
import campaignsRouter from './routes/campaigns.js';
import notificationsRouter from './routes/notifications.js';
import pushRouter from './routes/push.js';
import authRouter from './routes/auth.js';
import businessesRouter from './routes/businesses.js';
import crmRouter from './routes/crm.js';
import catalogRouter from './routes/catalog.js';
import offersRouter from './routes/offers.js';
import flowsRouter from './routes/flows.js';
import flowEndpointRouter from './routes/flowEndpoint.js';
import ordersRouter from './routes/orders.js';
import journeysRouter from './routes/journeys.js';
import membersRouter from './routes/members.js';
import registrationsRouter from './routes/registrations.js';
import mediaRouter from './routes/media.js';
import onboardingRouter from './routes/onboarding.js';
import settingsRouter from './routes/settings.js';
import demosRouter, { demoAdminRouter } from './routes/demos.js';
import eventsRouter, { eventsAdminRouter } from './routes/events.js';
import adsRouter from './routes/ads.js';
import billingRouter, { razorpayWebhookRouter } from './routes/billing.js';
import { requireFeature } from './services/planGate.js';
import { startPlanReminders } from './services/planReminders.js';
import { startBuilderMediaSweep } from './services/builderMediaSweep.js';
import metaChannelsRouter, { metaSubscriptionsAdminRouter } from './routes/metaChannels.js';
import metaWebhookRouter from './routes/metaWebhook.js';
import instagramChannelRouter from './routes/instagramChannel.js';
import metaMessagingRouter from './routes/metaMessaging.js';
import { ensureAppSubscriptions } from './services/metaChannels.js';
import { startInstagramTokenRefresh } from './services/instagramLogin.js';
import { startPostScheduler } from './services/socialPublish.js';
import socialRouter from './routes/social.js';
import publicApiRouter from './routes/publicApi.js';
import developerRouter from './routes/developer.js';
import { ensureTokenKey } from './services/tokenCrypto.js';
import { assertAuthSecret } from './services/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });
// Refuse to run in production with the public dev signing secret.
assertAuthSecret();

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5000;
const DATABASE_URL = process.env.DATABASE_URL;
const STARTED_AT = new Date();
// True once the database is connected and the schema is ready (see /api/health).
let ready = false;

// CORS — allow a comma-separated list of origins, or * for any.
const corsOrigin = process.env.CORS_ORIGIN || '*';
const corsOptions =
  corsOrigin === '*'
    ? { origin: '*' }
    : { origin: corsOrigin.split(',').map((o) => o.trim()) };

// Socket.IO for live CRM updates.
//
// Each socket is put into its own tenant's room during the handshake, and
// nothing is ever broadcast to all connections. The browser proves who it is
// with the same JWT it uses for HTTP, so a tenant can't opt into another
// tenant's feed by asking for it.
const io = new SocketServer(server, { cors: corsOptions });
setIO(io);
io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token || '';
  try {
    const biz = await businessFromToken(token);
    if (biz) {
      socket.data.businessId = String(biz._id);
      socket.data.businessName = biz.name;
      socket.join(roomFor(biz._id));
    }
  } catch (err) {
    logger.debug('socket auth failed', { error: err.message });
  }
  // An unauthenticated socket still connects, but joins no room and so
  // receives nothing. Rejecting it outright would break the login screen and
  // the demo mode, which both open a socket before anyone has signed in — and
  // silently receiving nothing is the safe default anyway.
  next();
});
io.on('connection', (socket) => {
  logger.debug('CRM socket connected', {
    id: socket.id,
    tenant: socket.data.businessName || '(not signed in)',
  });
});

// Requests arrive through local proxies (the Vite dev server, the ngrok agent).
// Trust only loopback hops, so req.ip is the visitor's address — what the
// public demo-booking rate limit counts by — and can't be spoofed from outside.
app.set('trust proxy', 'loopback');
// Don't advertise the server software.
app.disable('x-powered-by');
// The public API (/api/v1) is called from businesses' own websites, so it
// has its own CORS (middleware/apiKey.js apiCors: the key decides who may
// use it). Everything else keeps the CRM's own origins.
app.use('/api/v1', apiCors);
app.use((req, res, next) => (req.path.startsWith('/api/v1/') || req.path === '/api/v1' ? next() : cors(corsOptions)(req, res, next)));
// Capture raw body for WhatsApp signature verification.
app.use(
  express.json({
    limit: '2mb',
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);
app.use(express.urlencoded({ extended: true }));

if (!DATABASE_URL) {
  logger.error('DATABASE_URL not set — copy .env.example to .env and add the Supabase connection string.');
} else {
  // Connects, then creates any missing tables / columns / indexes.
  db.init()
    .then(() => {
      ready = true;
      // Tag any pre-tenancy rows before serving traffic, so tenant scoping has
      // something to scope on.
      runTenantMigration().catch((err) => logger.error('tenant migration failed', { error: err.message }));
      // Every business that hasn't connected WhatsApp gets a join code for the
      // shared "try it" number (new sign-ups get one at registration).
      backfillJoinCodes().catch((err) => logger.error('join code backfill failed', { error: err.message }));
      // Keep each tenant's Meta app pointed at this server. The dev tunnel URL
      // changes whenever ngrok restarts, and a stale callback URL means inbound
      // messages are delivered nowhere, with no error to show for it.
      syncAllWebhooks().catch((err) => logger.warn('webhook sync failed', { error: err.message }));
      // The key Page access tokens are encrypted with (generated into .env if missing).
      try {
        ensureTokenKey();
      } catch (err) {
        logger.error('TOKEN_ENC_KEY is unusable', { error: err.message });
      }
      // Messenger / Instagram: the platform app's 'page' and 'instagram'
      // subscriptions follow PUBLIC_BASE_URL. Opt-in, like the platform
      // WhatsApp callback; otherwise run it from the admin API
      // (POST /api/admin/meta-subscriptions).
      // META_LEADGEN_WEBHOOK_SYNC=true (opt-in, Feature F) also adds 'leadgen'
      // to the 'page' object for lead ads.
      const leadgenSync = String(process.env.META_LEADGEN_WEBHOOK_SYNC || '').toLowerCase() === 'true';
      if (leadgenSync || String(process.env.META_CHANNEL_WEBHOOK_SYNC || '').toLowerCase() === 'true') {
        ensureAppSubscriptions(leadgenSync ? { extraFields: { page: ['leadgen'] } } : undefined)
          .then((r) => (r.ok
            ? logger.info('Messenger / Instagram app subscriptions ok', { results: r.results.map((x) => `${x.object}:${x.changed ? 'updated' : 'unchanged'}`) })
            : logger.warn('Messenger / Instagram app subscriptions not synced', { reason: r.reason, results: r.results })))
          .catch((err) => logger.warn('Messenger / Instagram app subscriptions failed', { error: err.message }));
      }
      // Release unpaid online orders (and the slots bookings hold) after the
      // payment timeout, so an abandoned "Pay online" doesn't block a slot or
      // clutter the Orders list forever.
      startOrderExpiry();
      // Rate-limited (1/s) reverse-geocoding queue for shared locations.
      // Falls back to an in-process limiter if Redis isn't reachable.
      startGeocodeQueue();
      // Sends campaigns (scheduled ones when due) and resumes any a restart
      // interrupted.
      startCampaignRunner();
      // "Your trial / plan ends in N days" and "… has ended" notifications.
      startPlanReminders();
      // Instagram connected with "Log in with Instagram": its 60-day tokens
      // are refreshed once a day when they are within 10 days of expiring
      // (also refreshed on use). No-op unless INSTAGRAM_APP_ID / _SECRET are set.
      startInstagramTokenRefresh();
      // Create: Facebook / Instagram posts scheduled for later (and ones Meta
      // is still processing) are published by this ticker.
      startPostScheduler();
      // Daily: journey / flow uploads no definition uses (tab closed mid-edit…).
      startBuilderMediaSweep();
    })
    .catch((err) => logger.error('Database connection error', { error: err.message }));
}

// ---------------- Health ----------------
function buildHealthReport() {
  const database = db.dbState();
  const has = (v) => Boolean(v && String(v).trim());
  const baseUrl = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;
  return {
    service: 'WhatsApp CRM Backend (multi-tenant)',
    status: database.connected ? 'OK' : 'DEGRADED',
    timestamp: new Date().toISOString(),
    startedAt: STARTED_AT.toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    connections: {
      database: { provider: 'supabase-postgres', connected: database.connected, state: database.state },
      storage: {
        provider: 'bunny.net',
        configured: has(process.env.BUNNY_STORAGE_ZONE) && has(process.env.BUNNY_STORAGE_PASSWORD),
      },
    },
    // WhatsApp credentials are per business (configured in the admin panel).
    // Each tenant's webhook is at /api/whatsapp/webhook/<businessId>.
    whatsapp: {
      multiTenant: true,
      webhookBase: `${baseUrl}/api/whatsapp/webhook`,
    },
  };
}
// A database round-trip at most every 5 s (cheap; probes can't pile up on it).
let lastPing = { at: 0, ok: false, pending: null };
async function databaseOk() {
  if (Date.now() - lastPing.at < 5000) return lastPing.ok;
  if (!lastPing.pending) {
    lastPing.pending = Promise.race([
      db.ping(),
      new Promise((resolve) => { setTimeout(() => resolve(false), 3000).unref(); }),
    ]).then((ok) => {
      lastPing = { at: Date.now(), ok, pending: null };
      return ok;
    });
  }
  return lastPing.pending;
}
async function health(_req, res) {
  const dbOk = ready && (await databaseOk());
  const report = buildHealthReport();
  report.status = dbOk ? 'OK' : 'DEGRADED';
  report.ready = ready;
  // 503 tells the deploy script and any monitor the backend can't serve.
  res.status(dbOk ? 200 : 503).json(report);
}
app.get('/', health);
app.get('/api/health', health);

// ---------------- Routes ----------------
// Per-tenant webhook: /api/whatsapp/webhook/:tenantId. The base path (no tenant)
// still answers the status probe. The shared test number's callback is mounted
// first, so "sandbox" is never read as a tenant id.
app.use('/api/whatsapp/webhook/sandbox', sandboxWebhookRouter);
app.use('/api/whatsapp/webhook/:tenantId', webhookRouter);
app.use('/api/whatsapp/webhook', webhookRouter);
app.use('/api/auth', authRouter);
app.use('/api/businesses', businessesRouter);
app.use('/api/crm', crmRouter);
// Plan gates (services/plans.js): changes to a page's data need that page in
// the business's plan. Reads, and requests without a business token
// (public callbacks), pass straight through.
app.use('/api/catalog', requireFeature((req) => (/^\/categories(\/|$)/.test(req.path) ? 'categories' : 'catalog')), catalogRouter);
app.use('/api/offers', requireFeature('offers'), offersRouter);
app.use('/api/flows', requireFeature('flows'), flowsRouter); // native WhatsApp Flows (Basic and up)
app.use('/api/orders', requireFeature('orders'), ordersRouter);
app.use('/api/journeys', requireFeature('journeys'), journeysRouter); // basic automation (every plan)
app.use('/api/members', requireFeature('members'), membersRouter);
app.use('/api/registrations', requireFeature('orders'), registrationsRouter);
app.use('/api/media', mediaRouter);
app.use('/api/onboarding', onboardingRouter);
// Only the WhatsApp Pay / catalog settings (PUT /api/settings); the business
// profile under /whatsapp-profile is part of every plan.
app.use('/api/settings', requireFeature('payment-config', { only: (req) => req.path === '/' }), settingsRouter);
app.use('/api/sandbox', sandboxRouter); // shared "try it" number panel
app.use('/api/channel', channelRouter); // Channel Status: live number status from Meta
app.use('/api/calls', requireFeature('calls'), callsRouter); // WhatsApp voice calls: settings, answer, call, permission (Basic and up)
// Cancelling or deleting a campaign stays possible after a downgrade.
app.use('/api/campaigns', requireFeature('campaigns', { only: (req) => req.method !== 'DELETE' && !/\/cancel$/.test(req.path) }), campaignsRouter); // Campaigns: server-side sends and real stats
app.use('/api/notifications', notificationsRouter); // header bell + notification drawer
app.use('/api/push', pushRouter); // desktop notifications (Web Push) for this browser
app.use('/api/demo', demosRouter); // public: book a demo
app.use('/api/admin/demos', demoAdminRouter); // super admin: Demo Requests
app.use('/api/events', eventsRouter); // public: the live event theme (website + CRM)
app.use('/api/admin/events', eventsAdminRouter); // super admin: Events
app.use('/api/ads', requireFeature('ads', { only: (req) => !(req.method === 'DELETE' && req.path === '/meta') }), adsRouter); // Click-to-WhatsApp ad leads + the connected Meta ad account (/api/ads/meta)
app.use('/api/billing', billingRouter); // Settings → Billing: plan, usage, Razorpay plan purchases
app.use('/api/razorpay/webhook', razorpayWebhookRouter); // Razorpay → us (signed): plan payments
// Messenger / Instagram: the channel in the request (connecting one, its templates).
const metaChannelOf = (req) => (String(req.body?.channel || req.query?.channel || '').toLowerCase() === 'instagram' ? 'instagram' : 'messenger');
// Disconnecting (DELETE) a channel stays possible after a downgrade.
const notDelete = { only: (req) => req.method !== 'DELETE' };
app.use('/api/channels/meta', requireFeature(metaChannelOf, notDelete), metaChannelsRouter); // Channel Status: connect Messenger / Instagram
app.use('/api/channels/instagram', requireFeature('instagram', notDelete), instagramChannelRouter); // Channel Status: Instagram via Business Login for Instagram
app.use('/api/admin/meta-subscriptions', metaSubscriptionsAdminRouter); // super admin: app 'page' / 'instagram' webhooks
app.use('/api/meta/webhook', metaWebhookRouter); // Messenger + Instagram webhooks (signed)
app.use('/api/meta-messaging', requireFeature(metaChannelOf), metaMessagingRouter); // Messenger utility templates + Messenger / Instagram quick messages
app.use('/api/social', requireFeature('create'), socialRouter); // Create: publish to Facebook / Instagram, Comment auto-DM
app.use('/api/whatsapp/flow-endpoint', flowEndpointRouter);
// Public API for a business's own apps (API key auth), and its key management.
app.use('/api/v1', publicApiRouter);
app.use('/api/developer', developerRouter);

// Last resort: anything a route passed to next(err) (a database blip, a bad
// payload) becomes a clean 500 JSON response.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  const offline = /ENOTFOUND|ECONNRESET|ETIMEDOUT|Connection terminated|connect ECONNREFUSED/i.test(err?.message || '');
  logger.error('request failed', { method: req.method, path: req.originalUrl, error: err?.message });
  if (res.headersSent) return;
  res.status(offline ? 503 : 500).json({
    success: false,
    message: offline ? 'The database is unreachable right now. Please try again in a moment.' : 'Something went wrong. Please try again.',
  });
});

// A promise nobody awaited, or an error thrown outside a request (a timer, a
// background job), must not take every tenant offline. Log it and stay up.
process.on('unhandledRejection', (reason) => {
  logger.error('unhandled rejection (kept running)', { error: reason?.message || String(reason) });
});
// An uncaught exception leaves the process in an unknown state: log it and
// exit, and systemd (Restart=always) starts a clean one.
process.on('uncaughtException', (err) => {
  logger.error('uncaught exception, exiting', { error: err?.message, stack: err?.stack?.split('\n').slice(0, 4).join(' | ') });
  setTimeout(() => process.exit(1), 200).unref();
});

// systemd stop / restart: stop taking requests, let in-flight ones finish
// (at most 10 s), then close the database pool.
let stopping = false;
function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  ready = false;
  logger.info(`${signal} received, shutting down`);
  setTimeout(() => process.exit(0), 10_000).unref();
  io.close();
  server.close(() => {
    db.close().finally(() => process.exit(0));
  });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

const HOST = process.env.HOST || (process.env.NODE_ENV === 'production' ? '127.0.0.1' : undefined);
server.listen(PORT, HOST, () => {
  logger.info(`WhatsApp CRM backend listening on http://${HOST || 'localhost'}:${PORT}`);
});
