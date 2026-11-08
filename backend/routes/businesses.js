import express from 'express';
import Business from '../models/Business.js';
import Message from '../models/Message.js';
import Conversation from '../models/Conversation.js';
import Flow from '../models/Flow.js';
import Journey from '../models/Journey.js';
import Member from '../models/Member.js';
import Product from '../models/Product.js';
import Order from '../models/Order.js';
import { query } from '../db/pool.js';
import { verifyCredentials } from '../services/metaVerify.js';
import {
  generateUsername,
  generatePasscode,
  generateVerifyToken,
  hashPasscode,
} from '../services/auth.js';
import logger from '../services/logger.js';
import storage from '../services/storage.js';
import { requireSuperAdmin } from '../middleware/auth.js';
import { syncWebhookSubscription, webhookCallbackUrl } from '../services/webhookSetup.js';
import { AuthError, createUser, updateUser, deleteUser } from '../services/supabaseAuth.js';
import { pickPayment, paymentProblem } from '../services/businessSettings.js';
import { purgeBusiness } from '../services/tenantPurge.js';
import { isWhatsAppConnected, onWhatsAppConnected } from '../services/sandbox.js';
import { getNumberStatus } from '../services/metaAccount.js';
import { planState, TRIAL_DAYS } from '../services/plans.js';
import { grantPlan, BillingError } from '../services/subscriptions.js';
import { forgetPlan } from '../services/planGate.js';
import { VERTICALS, DEFAULT_VERTICAL, verticalConfig } from '../services/verticals.js';
import { dashboardStats } from '../services/platformDashboard.js';
import { storageStats } from '../services/storageStats.js';
import { techPartnerStats } from '../services/techPartner.js';

const pickCategory = (c) => (VERTICALS[String(c || '').trim()] ? String(c).trim() : DEFAULT_VERTICAL);

// Per-business wording overrides. Only the six known keys are kept, each a
// trimmed string ('' means "use the category default").
const pickLabels = (l = {}) => {
  const s = (v) => String(v ?? '').trim();
  return {
    memberLabel: s(l.memberLabel),
    memberSingular: s(l.memberSingular),
    categoryLabel: s(l.categoryLabel),
    categoryPlural: s(l.categoryPlural),
    customerLabel: s(l.customerLabel),
    customerPlural: s(l.customerPlural),
  };
};


const router = express.Router();
router.use(requireSuperAdmin);

// Where Meta posts this business's messages (Embedded-Signup businesses get
// it as a per-WABA override on the platform app).
const callbackUrl = (biz) => webhookCallbackUrl(biz._id);

function pickCreds(b = {}) {
  return {
    accessToken: (b.accessToken || '').trim(),
    phoneNumberId: (b.phoneNumberId || '').trim(),
    wabaId: (b.wabaId || '').trim(),
    catalogId: (b.catalogId || '').trim(),
    graphVersion: (b.graphVersion || process.env.WA_GRAPH_VERSION || 'v22.0').trim(),
  };
}

// ---------- Verify credentials against Graph (no save) — the "Check" button ----------
router.post('/verify', async (req, res) => {
  const result = await verifyCredentials(pickCreds(req.body || {}));
  res.status(result.ok ? 200 : 400).json({ success: result.ok, ...result });
});

// ---------- List businesses ----------
// Each connected number's real Meta status (CONNECTED / PENDING / FLAGGED …)
// comes from the Channel Status cache (read-only Graph GETs, reused for 5
// minutes), falling back to the stored snapshot when Meta can't be read.
router.get('/', async (_req, res) => {
  const data = await Business.find().sort({ createdAt: -1 });
  const statuses = await Promise.all(data.map(async (b) => {
    if (!isWhatsAppConnected(b)) return { numberStatus: '', numberStatusLive: false };
    const s = await getNumberStatus(b).catch(() => null);
    const live = String(s?.number?.status || '').toUpperCase();
    return live
      ? { numberStatus: live, numberStatusLive: !s.stale }
      : { numberStatus: String(b.meta?.numberStatus || '').toUpperCase(), numberStatusLive: false };
  }));
  res.json({
    success: true,
    // planState: the plan in force (Plan column; "New" while the free trial runs).
    data: data.map((b, i) => ({ ...b.toSafeJSON(), callbackUrl: callbackUrl(b), planState: planState(b), ...statuses[i] })),
  });
});

// ---------- Platform overview (admin Dashboard) ----------
// Two-segment path, so it can't be shadowed by '/:id'.
router.get('/stats/overview', async (_req, res) => {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [businesses, active, messages, messages24h, inbound, outbound, conversations, flows, journeys, members, products, orders] =
      await Promise.all([
        Business.countDocuments(),
        Business.countDocuments({ active: true }),
        Message.countDocuments(),
        Message.countDocuments({ createdAt: { $gte: since } }),
        Message.countDocuments({ direction: 'in' }),
        Message.countDocuments({ direction: 'out' }),
        Conversation.countDocuments(),
        Flow.countDocuments(),
        Journey.countDocuments(),
        Member.countDocuments(),
        Product.countDocuments(),
        Order.countDocuments(),
      ]);

    // Tenants grouped by vertical, resolved to a label + archetype.
    const { rows: grouped } = await query(
      `SELECT category AS _id, count(*) AS count FROM ${Business.table} GROUP BY category`,
    );
    const byCategory = grouped
      .map((g) => {
        const cfg = verticalConfig(g._id || DEFAULT_VERTICAL);
        return { key: cfg.key, label: cfg.label, archetype: cfg.archetype, count: g.count };
      })
      .sort((a, b) => b.count - a.count);

    // Message volume per day for the last 7 days (for a simple trend bar).
    // Days are bucketed in UTC, as Mongo's $dateToString did.
    const weekAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
    weekAgo.setHours(0, 0, 0, 0);
    const { rows: daily } = await query(
      `SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS _id, count(*) AS count
         FROM ${Message.table}
        WHERE created_at >= $1
        GROUP BY 1
        ORDER BY 1`,
      [weekAgo],
    );

    const recent = await Business.find().sort({ createdAt: -1 }).limit(5);

    res.json({
      success: true,
      data: {
        businesses: { total: businesses, active, inactive: businesses - active },
        messages: { total: messages, last24h: messages24h, inbound, outbound },
        totals: { conversations, flows, journeys, members, products, orders },
        byCategory,
        daily: daily.map((d) => ({ date: d._id, count: d.count })),
        recent: recent.map((b) => ({
          _id: b._id,
          name: b.name,
          category: b.category,
          active: b.active,
          createdAt: b.createdAt,
        })),
      },
    });
  } catch (err) {
    logger.error('platform stats failed', { error: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
});

// ---------- Admin dashboard: revenue, messages, plans (India time) ----------
// Two-segment path, so it can't be shadowed by '/:id'.
router.get('/stats/dashboard', async (_req, res) => {
  try {
    res.json({ success: true, data: await dashboardStats() });
  } catch (err) {
    logger.error('dashboard stats failed', { error: err.message });
    res.status(500).json({ success: false, message: 'Could not load the dashboard. Please try again.' });
  }
});

// ---------- Storage used: Supabase (database, Storage) and Bunny ----------
// ?refresh=1 reads again (otherwise kept for 5 minutes).
router.get('/stats/storage', async (req, res) => {
  try {
    res.json({ success: true, data: await storageStats({ refresh: req.query.refresh === '1' }) });
  } catch (err) {
    logger.error('storage stats failed', { error: err.message });
    res.status(500).json({ success: false, message: 'Could not load the storage figures. Please try again.' });
  }
});

// ---------- Meta Tech Partner eligibility (admin "Tech Partner" page) ----------
// ?refresh=1 asks Meta again for each number's quality rating (otherwise the
// 5-minute Channel Status cache is used).
router.get('/stats/tech-partner', async (req, res) => {
  try {
    const refresh = req.query.refresh === '1';
    res.json({ success: true, data: await techPartnerStats(new Date(), { refresh }) });
  } catch (err) {
    logger.error('tech partner stats failed', { error: err.message });
    res.status(500).json({ success: false, message: 'Could not load the Tech Partner figures. Please try again.' });
  }
});

// ---------- Per-business stats (admin business detail page) ----------
router.get('/:id/stats', async (req, res) => {
  try {
    const id = req.params.id;
    const biz = await Business.findById(id).lean();
    if (!biz) return res.status(404).json({ success: false, message: 'Not found' });

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [messages, messages24h, inbound, outbound, journeys] = await Promise.all([
      Message.countDocuments({ businessId: id }),
      Message.countDocuments({ businessId: id, createdAt: { $gte: since } }),
      Message.countDocuments({ businessId: id, direction: 'in' }),
      Message.countDocuments({ businessId: id, direction: 'out' }),
      Journey.countDocuments({ businessId: id }),
    ]);
    // Distinct contacts that have messaged this tenant.
    const contacts = (await Message.distinct('phone', { businessId: id })).length;
    const lastMessage = await Message.findOne({ businessId: id }).sort({ createdAt: -1 }).lean();

    res.json({
      success: true,
      data: {
        messages: { total: messages, last24h: messages24h, inbound, outbound },
        contacts,
        journeys,
        lastMessageAt: lastMessage?.createdAt || null,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/:id', async (req, res) => {
  const b = await Business.findById(req.params.id);
  if (!b) return res.status(404).json({ success: false, message: 'Not found' });
  res.json({ success: true, data: { ...b.toSafeJSON(), callbackUrl: callbackUrl(b), planState: planState(b) } });
});

// (Businesses are no longer created here: owners register themselves and
// connect WhatsApp through Embedded Signup — see routes/auth.js and
// routes/onboarding.js.)

/**
 * Merge an edit onto the stored business.
 *
 * Two kinds of field, and the difference is deliberate:
 *
 *   • Required ones (phone number ID, WABA ID, access token, Graph version)
 *     and the secrets treat blank as "keep what's there". An edit form can't
 *     show a secret the server never sent it, and a tenant can't function
 *     without an id or a token, so an empty box means untouched — never
 *     cleared. Sending one blank is a no-op, not an error.
 *   • Optional ones (app ID, catalog ID) take whatever is given, so they
 *     *can* be deliberately emptied — dropping a catalog, for instance.
 */
function mergeCreds(biz, b = {}) {
  // Present and non-blank wins; otherwise keep the stored value.
  const keep = (key) => {
    const v = String(b[key] ?? '').trim();
    return v || biz[key] || '';
  };
  // Present wins even when blank, so the field can be cleared.
  const take = (key) => (b[key] === undefined ? (biz[key] || '') : String(b[key] || '').trim());
  return {
    phoneNumberId: keep('phoneNumberId'),
    wabaId: keep('wabaId'),
    graphVersion: keep('graphVersion'),
    accessToken: keep('accessToken'),
    appSecret: keep('appSecret'),
    catalogId: take('catalogId'),
    appId: take('appId'),
  };
}

// Which fields Meta actually has an opinion about. Changing any of these means
// the stored snapshot is stale and has to be re-checked; changing a payment
// toggle or an app secret does not.
const GRAPH_FIELDS = ['phoneNumberId', 'wabaId', 'catalogId', 'graphVersion', 'accessToken'];
const credsChanged = (biz, merged) =>
  GRAPH_FIELDS.some((k) => String(merged[k] || '') !== String(biz[k] || ''));

// Copy a verification result onto the snapshot field by field. Spreading the
// Mongoose subdocument would drag its internals along, and Meta returns more
// detail than the snapshot stores.
function applyMetaSnapshot(biz, details = {}) {
  for (const k of ['verifiedName', 'displayPhoneNumber', 'qualityRating', 'wabaName', 'catalogName']) {
    if (details[k] !== undefined && details[k] !== '') biz.meta[k] = details[k];
  }
  biz.meta.lastVerifiedAt = new Date();
}

// ---------- Check an edit before saving it — the detail page's "Check" button ----------
// Unlike POST /verify this one knows the tenant, so the stored access token is
// used when the form leaves that field blank. Without it an admin would have to
// paste the token again just to re-check a number they hadn't touched.
router.post('/:id/verify', async (req, res) => {
  const biz = await Business.findById(req.params.id);
  if (!biz) return res.status(404).json({ success: false, message: 'Not found' });
  const merged = mergeCreds(biz, req.body || {});
  if (!merged.accessToken) {
    return res.status(400).json({ success: false, ok: false, message: 'No access token stored for this business — paste one to check.' });
  }
  const result = await verifyCredentials(pickCreds(merged));
  res.status(result.ok ? 200 : 400).json({ success: result.ok, ...result });
});

/**
 * Update a tenant's credentials and payment settings.
 *
 * Re-verifies against Graph only when something Meta owns actually changed.
 * That matters for the common case the panel exists for: a business that
 * signs up for WhatsApp Pay months later should be switchable on without a
 * live token round-trip, and without a Meta outage blocking the save.
 *
 * Adding an app ID / secret also re-syncs the webhook subscription, because
 * that's the pair that was missing when a tenant's callback URL silently never
 * synced — fixing it in the form and then having to remember a separate action
 * is how it stays broken.
 */
router.put('/:id', async (req, res) => {
  try {
    const biz = await Business.findById(req.params.id);
    if (!biz) return res.status(404).json({ success: false, message: 'Not found' });
    const wasConnected = isWhatsAppConnected(biz);
    const b = req.body || {};
    const merged = mergeCreds(biz, b);
    // Only reachable if the stored row is itself incomplete — a blank field in
    // the request keeps the existing value rather than clearing it.
    if (!merged.phoneNumberId || !merged.wabaId || !merged.accessToken) {
      return res.status(400).json({ success: false, message: 'Phone number ID, WABA ID and an access token are required' });
    }

    const mustVerify = credsChanged(biz, merged);
    let verified = null;
    if (mustVerify) {
      verified = await verifyCredentials(pickCreds(merged));
      if (!verified.ok) {
        return res.status(400).json({
          success: false,
          message: verified.errors?.[0] || 'Verification failed',
          ...verified,
        });
      }
    }

    const appPairChanged = merged.appId !== (biz.appId || '') || merged.appSecret !== (biz.appSecret || '');

    if (typeof b.name === 'string' && b.name.trim()) biz.name = b.name.trim();
    if (b.category !== undefined) biz.category = pickCategory(b.category);
    if (b.labels !== undefined) biz.labels = pickLabels(b.labels);
    biz.phoneNumberId = merged.phoneNumberId;
    biz.wabaId = merged.wabaId;
    // A different catalog typed here drops the old one's Meta-login token.
    if (String(merged.catalogId || '') !== String(biz.catalogId || '')) {
      biz.catalogConnection = { method: merged.catalogId ? 'manual' : '', token: '', tokenSource: '', scopes: [], metaBusinessId: '', metaBusinessName: '' };
    }
    biz.catalogId = merged.catalogId;
    biz.graphVersion = merged.graphVersion;
    biz.accessToken = merged.accessToken;
    biz.appId = merged.appId;
    biz.appSecret = merged.appSecret;
    if (b.payment) {
      biz.payment = pickPayment(b.payment);
      const problem = paymentProblem(biz.payment);
      if (problem) return res.status(400).json({ success: false, message: problem });
      // The seller address is optional: it's a customs disclosure for physical
      // goods sold without a catalog, and a service fee never carries one. It
      // used to be enforced here, which only stopped a clinic enabling
      // payments at all.
    }
    if (verified) applyMetaSnapshot(biz, verified.details);
    await biz.save();
    // Connected for the first time: off the shared test number.
    if (!wasConnected && isWhatsAppConnected(biz)) {
      await onWhatsAppConnected(biz).catch((e) => logger.warn('sandbox cleanup after connect failed', { error: e.message }));
    }

    // Report the webhook outcome rather than logging it where nobody looks.
    let webhook = null;
    if (appPairChanged && biz.appId && biz.appSecret) {
      const sync = await syncWebhookSubscription(biz).catch((e) => ({ ok: false, reason: e.message }));
      webhook = sync.ok
        ? (sync.changed ? 'Webhook callback URL updated at Meta.' : 'Webhook callback URL was already correct.')
        : `Webhook not synced: ${sync.reason}`;
      logger.info('business updated', { business: biz.name, verified: !!verified, webhook });
    } else {
      logger.info('business updated', { business: biz.name, verified: !!verified });
    }

    res.json({
      success: true,
      data: { ...biz.toSafeJSON(), callbackUrl: callbackUrl(biz) },
      verified: !!verified,
      webhook,
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: 'Another business already uses that phone number ID' });
    }
    logger.error('update business failed', { error: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
});

// ---------- Update profile only (name / category) ----------
// Separate from PUT because PUT re-verifies the Meta credentials, which needs a
// live access token. Renaming or re-categorising shouldn't require that.
router.patch('/:id', async (req, res) => {
  try {
    const b = req.body || {};
    const update = {};
    if (typeof b.name === 'string' && b.name.trim()) update.name = b.name.trim();
    if (b.category !== undefined) update.category = pickCategory(b.category);
    if (b.labels !== undefined) update.labels = pickLabels(b.labels);
    if (!Object.keys(update).length) {
      return res.status(400).json({ success: false, message: 'Nothing to update' });
    }
    const biz = await Business.findByIdAndUpdate(req.params.id, { $set: update }, { new: true });
    if (!biz) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: { ...biz.toSafeJSON(), callbackUrl: callbackUrl(biz) } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ---------- Regenerate the 6-digit passcode ----------
// Bumping tokenVersion is what makes anyone signed in with the old passcode
// drop to the login screen on their next request.
router.post('/:id/regenerate', async (req, res) => {
  const biz = await Business.findById(req.params.id);
  if (!biz) return res.status(404).json({ success: false, message: 'Not found' });
  const passcode = generatePasscode();
  const { hash, salt } = await hashPasscode(passcode);
  biz.passcodeHash = hash;
  biz.passcodeSalt = salt;
  biz.tokenVersion = (biz.tokenVersion || 0) + 1;
  await biz.save();
  logger.info('passcode regenerated, existing sessions invalidated', { business: biz.name });
  res.json({ success: true, credentials: { username: biz.username, passcode } });
});

// ---------- Create a FREE TRIAL tenant ----------
// Identical Meta verification to a normal business. The tenant gets the same
// 7-day free trial (every feature) as a sign-up, then the Free plan unless it
// buys one (services/plans.js).
router.post('/trial', async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.name?.trim()) return res.status(400).json({ success: false, message: 'Business name required' });

    const creds = pickCreds(b);
    const result = await verifyCredentials(creds);
    if (!result.ok) {
      return res.status(400).json({ success: false, message: result.errors?.[0] || 'Verification failed', ...result });
    }

    const days = Number.isFinite(Number(b.trialDays)) && Number(b.trialDays) > 0
      ? Math.min(90, Math.floor(Number(b.trialDays)))
      : TRIAL_DAYS;
    const passcode = generatePasscode();
    const { hash, salt } = await hashPasscode(passcode);

    const biz = await Business.create({
      name: b.name.trim(),
      category: pickCategory(b.category),
      labels: pickLabels(b.labels),
      phoneNumberId: creds.phoneNumberId,
      wabaId: creds.wabaId,
      appId: (b.appId || '').trim(),
      appSecret: (b.appSecret || '').trim(),
      accessToken: creds.accessToken,
      catalogId: creds.catalogId,
      graphVersion: creds.graphVersion,
      meta: {
        verifiedName: result.details.verifiedName || '',
        displayPhoneNumber: result.details.displayPhoneNumber || '',
        qualityRating: result.details.qualityRating || '',
        wabaName: result.details.wabaName || '',
        catalogName: result.details.catalogName || '',
        lastVerifiedAt: new Date(),
      },
      trialEndsAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
      username: generateUsername(b.name),
      passcodeHash: hash,
      passcodeSalt: salt,
      verifyToken: generateVerifyToken(),
      active: true,
    });

    // Point the tenant's Meta app at our webhook straight away, so their first
    // inbound "hi" actually arrives during the trial.
    syncWebhookSubscription(biz)
      .then((r) => logger.info('trial webhook sync', { business: biz.name, ...r }))
      .catch(() => {});

    res.status(201).json({
      success: true,
      data: { ...biz.toSafeJSON(), callbackUrl: callbackUrl(biz) },
      credentials: {
        username: biz.username,
        passcode,
        verifyToken: biz.verifyToken,
        callbackUrl: callbackUrl(biz),
      },
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: 'A business with this phone number ID already exists' });
    }
    logger.error('create trial failed', { error: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
});

// ---------- Restart a trial: a new passcode + a fresh 7-day trial ----------
// One action, because restarting the trial without rotating the passcode
// would leave the old tester signed in.
router.post('/:id/trial/reset', async (req, res) => {
  const biz = await Business.findById(req.params.id);
  if (!biz) return res.status(404).json({ success: false, message: 'Not found' });
  const days = Number.isFinite(Number(req.body?.trialDays)) && Number(req.body.trialDays) > 0
    ? Math.min(90, Math.floor(Number(req.body.trialDays)))
    : TRIAL_DAYS;
  const passcode = generatePasscode();
  const { hash, salt } = await hashPasscode(passcode);
  await grantPlan(biz._id, { trialDays: days });
  await Business.updateOne({ _id: biz._id }, {
    $set: { passcodeHash: hash, passcodeSalt: salt, tokenVersion: (biz.tokenVersion || 0) + 1 }, // old session out
  });
  forgetPlan(biz._id);
  const fresh = await Business.findById(biz._id);
  logger.info('trial restarted', { business: fresh.name, days });
  res.json({
    success: true,
    data: { ...fresh.toSafeJSON(), callbackUrl: callbackUrl(fresh), planState: planState(fresh) },
    credentials: { username: fresh.username, passcode },
  });
});

// ---------- Give a business a plan without payment ----------
// { tier: 'free'|'basic'|'pro'|'premium', until: ISO date } — or { trialDays }
// to restart the free trial. Notifies the business (services/subscriptions.js).
router.post('/:id/plan', async (req, res) => {
  try {
    const b = req.body || {};
    const biz = await grantPlan(req.params.id, { tier: b.tier, until: b.until, trialDays: b.trialDays });
    if (!biz) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: { ...biz.toSafeJSON(), callbackUrl: callbackUrl(biz), planState: planState(biz) } });
  } catch (err) {
    if (err instanceof BillingError) return res.status(err.status).json({ success: false, message: err.message });
    logger.error('admin plan change failed', { error: err.message });
    return res.status(500).json({ success: false, message: 'Could not change the plan' });
  }
});

// ---------- Re-point this tenant's Meta app at our webhook URL ----------
// Needed whenever PUBLIC_BASE_URL changes (a new ngrok tunnel, a new deploy):
// until the app's callback URL is updated, Meta posts inbound messages to the
// old address and the chat stays silent.
router.post('/:id/sync-webhook', async (req, res) => {
  const biz = await Business.findById(req.params.id);
  if (!biz) return res.status(404).json({ success: false, message: 'Not found' });
  const result = await syncWebhookSubscription(biz);
  if (!result.ok) {
    logger.warn('manual webhook sync failed', { business: biz.name, reason: result.reason });
    return res.status(400).json({ success: false, message: result.reason, callbackUrl: callbackUrl(biz) });
  }
  res.json({
    success: true,
    changed: result.changed,
    callbackUrl: result.to,
    previousCallbackUrl: result.from || '',
    message: result.changed ? 'Webhook callback URL updated at Meta.' : 'Webhook callback URL was already correct.',
  });
});

router.post('/:id/active', async (req, res) => {
  const biz = await Business.findByIdAndUpdate(req.params.id, { $set: { active: !!req.body?.active } }, { new: true });
  if (!biz) return res.status(404).json({ success: false, message: 'Not found' });
  res.json({ success: true, data: biz.toSafeJSON() });
});

// ---------- Login email + password for a business ----------
// Businesses onboarded before sign-up existed only have a username + 6-digit
// passcode. This gives them the new login: an email and a password (stored in
// Supabase Auth). Also used to reset a registered owner's password.
router.post('/:id/login', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return res.status(400).json({ success: false, message: 'Enter a valid email address' });
  }
  if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return res.status(400).json({ success: false, message: 'Password must be at least 8 characters with letters and a number' });
  }
  try {
    const biz = await Business.findById(req.params.id);
    if (!biz) return res.status(404).json({ success: false, message: 'Not found' });
    const taken = await Business.findOne({ email, _id: { $ne: biz._id } }).select('name').lean();
    if (taken) return res.status(409).json({ success: false, message: `That email already signs in to “${taken.name}”.` });

    if (biz.authUserId) {
      await updateUser(biz.authUserId, { email, password, email_confirm: true });
    } else {
      const user = await createUser({ email, password, metadata: { business: biz.name } });
      biz.authUserId = user.id;
      biz.authProvider = biz.authProvider || 'password';
    }
    biz.email = email;
    // A new password ends sessions opened with the old credentials.
    biz.tokenVersion = (biz.tokenVersion || 0) + 1;
    await biz.save();
    logger.info('business login email set', { business: biz.name, email });
    res.json({ success: true, data: { ...biz.toSafeJSON(), callbackUrl: callbackUrl(biz) } });
  } catch (err) {
    if (err instanceof AuthError) return res.status(err.status).json({ success: false, message: err.message });
    logger.error('set business login failed', { error: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
});

// Delete a business AND everything it owns: chats, messages, catalog, flows,
// members, orders, submissions, its Bunny media folder, and its flows at Meta.
router.delete('/:id', async (req, res) => {
  try {
    const biz = await Business.findById(req.params.id);
    if (!biz) return res.status(404).json({ success: false, message: 'Not found' });
    const authUserId = biz.authUserId;
    const summary = await purgeBusiness(biz);
    // Free the email so the owner could register again.
    if (authUserId) await deleteUser(authUserId);
    res.json({ success: true, ...summary });
  } catch (err) {
    logger.error('delete business failed', { error: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
