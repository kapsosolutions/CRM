import express from 'express';
import crypto from 'crypto';
import Business from '../models/Business.js';
import {
  signToken, verifyPasscode, generateUsername, generateVerifyToken,
  adminConfigured, adminCredentialsMatch, adminTokenVersion, adminUsername, ADMIN_TTL_SECONDS,
} from '../services/auth.js';
import {
  AuthError, createUser, updateUser, deleteUser, signInWithPassword, userFromAccessToken,
  authSettings, namesFromUser, supabaseUrl, isVerifiedGoogleUser,
} from '../services/supabaseAuth.js';
import {
  checkAttempt, recordFailure, recordSuccess, refuse,
} from '../services/loginGuard.js';
import { planSummary } from '../services/credits.js';
import { planState, TRIAL_DAYS } from '../services/plans.js';
import { webhookCallbackUrl } from '../services/webhookSetup.js';
import { VERTICALS } from '../services/verticals.js';
import { uniqueJoinCode } from '../services/sandbox.js';
import { channelFlags } from '../services/metaChannels.js';
import { instagramLoginConfig } from '../services/instagramGraph.js';
import { requireAuth } from '../middleware/auth.js';
import logger from '../services/logger.js';

const router = express.Router();

const envList = (name) => String(process.env[name] || '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

/**
 * Early access to the "coming soon" features: the business's username is on
 * EARLY_ACCESS_USERNAMES, or its login email on EARLY_ACCESS_EMAILS
 * (both comma-separated).
 */
export function hasEarlyAccess(biz) {
  const user = String(biz?.username || '').toLowerCase();
  const email = String(biz?.email || '').toLowerCase();
  return (!!user && envList('EARLY_ACCESS_USERNAMES').includes(user))
    || (!!email && envList('EARLY_ACCESS_EMAILS').includes(email));
}

// ---------- Public config for the sign-in pages + Embedded Signup ----------
// Nothing secret: the Supabase URL, which providers are on, and the Meta app /
// Embedded Signup configuration ids the browser SDK needs.
router.get('/config', async (_req, res) => {
  const providers = await authSettings();
  const igCfg = instagramLoginConfig();
  res.json({
    success: true,
    supabaseUrl: supabaseUrl(),
    googleEnabled: providers.google,
    // The site's public https address, so an http:// tab (localhost) can send
    // the user there for things Meta only allows over https.
    publicUrl: String(process.env.PUBLIC_BASE_URL || '').replace(/\/$/, ''),
    meta: {
      appId: process.env.META_APP_ID || '',
      configId: process.env.META_ES_CONFIG_ID || '',
      graphVersion: process.env.WA_GRAPH_VERSION || 'v22.0',
      // Facebook Login for Business configuration for Instagram + Messenger
      // ('' = not created yet; Channel Status then says so).
      businessLoginConfigId: process.env.META_BUSINESS_LOGIN_CONFIG_ID || '',
      // Channel Status → Messenger: its own (Pages-only) configuration when
      // META_MESSENGER_LOGIN_CONFIG_ID is set, else the Login for Business one.
      // Instagram's "Log in with Facebook" keeps businessLoginConfigId.
      messengerLoginConfigId: process.env.META_MESSENGER_LOGIN_CONFIG_ID || process.env.META_BUSINESS_LOGIN_CONFIG_ID || '',
      // Channel Status → Instagram → "Log in with Instagram" (Business Login
      // for Instagram): the Instagram app id and whether it is set up. The
      // Instagram app secret never leaves the server.
      instagramLoginConfigured: igCfg.configured,
      instagramAppId: igCfg.appId,
      // The configuration the Ads page's "Connect your Facebook account" uses:
      // its own when META_ADS_LOGIN_CONFIG_ID is set, else the one above.
      adsLoginConfigId: process.env.META_ADS_LOGIN_CONFIG_ID || process.env.META_BUSINESS_LOGIN_CONFIG_ID || '',
      // Catalog → Get started (services/metaCatalog.js): its own when
      // META_CATALOG_LOGIN_CONFIG_ID is set, else the Login for Business one.
      catalogLoginConfigId: process.env.META_CATALOG_LOGIN_CONFIG_ID || process.env.META_BUSINESS_LOGIN_CONFIG_ID || '',
    },
  });
});

// ---------- Super-admin (platform owner) login ----------
// Rate limited per IP and locked after repeated failures (one account that
// opens every tenant). Compared in constant time; the session lasts
// ADMIN_TOKEN_TTL_SECONDS (8h) and dies when the admin password changes.
router.post('/admin/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!adminConfigured()) return res.status(500).json({ success: false, message: 'Super admin not configured' });
  // One lock for the admin account, whatever username was typed.
  if (refuse(res, checkAttempt('admin', { ip: req.ip, account: 'super-admin' }))) return undefined;
  if (await adminCredentialsMatch(username, password)) {
    recordSuccess('admin', 'super-admin');
    const user = adminUsername();
    const token = signToken({ role: 'admin', sub: 'super-admin', username: user, av: adminTokenVersion() }, ADMIN_TTL_SECONDS);
    logger.info('super admin signed in', { ip: req.ip });
    return res.json({ success: true, token, role: 'admin', username: user });
  }
  recordFailure('admin', 'super-admin');
  logger.warn('super admin sign-in failed', { ip: req.ip });
  return res.status(401).json({ success: false, message: 'Invalid credentials' });
});

// ---------- Validation ----------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const normEmail = (s) => String(s || '').trim().toLowerCase();
const digits = (s) => String(s || '').replace(/\D/g, '');

/** Problems with a sign-up form, keyed by field (empty object = valid). */
function validateProfile(b, { needName = true, needLastName = true, needEmail = true, needPassword = true } = {}) {
  const errors = {};
  if (needName && !String(b.firstName || '').trim()) errors.firstName = 'First name is required';
  if (needName && needLastName && !String(b.lastName || '').trim()) errors.lastName = 'Last name is required';
  if (needEmail && !EMAIL_RE.test(normEmail(b.email))) errors.email = 'Enter a valid business email address';
  if (needPassword) {
    const pw = String(b.password || '');
    if (pw.length < 8) errors.password = 'Password must be at least 8 characters';
    else if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) errors.password = 'Use letters and at least one number';
    if (pw !== String(b.confirmPassword ?? '')) errors.confirmPassword = 'Passwords do not match';
  }
  const phone = digits(b.phone);
  // Country code + number (E.164 allows at most 15 digits).
  if (phone.length < 8 || phone.length > 15) errors.phone = 'Enter a valid phone number with country code';
  if (!VERTICALS[String(b.category || '').trim()]) errors.category = 'Choose your business category';
  return errors;
}

const firstError = (errors) => Object.values(errors)[0];

/** The session the CRM runs on, plus what the CRM shows straight after login. */
function sessionFor(biz, { master = false } = {}) {
  const token = signToken({
    role: 'business',
    sub: String(biz._id),
    username: biz.username,
    // `tv` pins the token to the current credential generation — see middleware.
    tv: biz.tokenVersion || 0,
    ...(master ? { master: true } : {}),
  });
  return {
    success: true, token, role: 'business', master, business: biz.toSafeJSON(), plan: planSummary(biz), planState: planState(biz),
  };
}

/** Create the business row for a newly signed-up owner. */
async function createOwnerBusiness({ firstName, lastName, email, phone, category, authUserId, provider }) {
  const name = `${firstName} ${lastName}`.trim();
  return Business.create({
    // A placeholder until WhatsApp is connected; Embedded Signup replaces it
    // with the verified WhatsApp business name.
    name,
    category,
    ownerFirstName: firstName,
    ownerLastName: lastName,
    ownerPhone: phone,
    email,
    authUserId,
    authProvider: provider,
    username: generateUsername(name),
    verifyToken: generateVerifyToken(),
    // Its join code for the shared "try it" WhatsApp number (Chats page).
    sandboxCode: await uniqueJoinCode(),
    // Every feature for the first 7 days, then the Free plan unless it buys one.
    trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000),
    active: true,
  });
}

const sendError = (res, err, fallback) => {
  if (err instanceof AuthError) return res.status(err.status).json({ success: false, message: err.message, code: err.code });
  if (err?.code === 11000) {
    return res.status(409).json({ success: false, message: 'An account with this email already exists. Sign in instead.' });
  }
  logger.error(fallback, { error: err.message });
  return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
};

// ---------- Register (email + password) ----------
router.post('/register', async (req, res) => {
  const b = req.body || {};
  if (refuse(res, checkAttempt('register', { ip: req.ip }))) return undefined;
  const errors = validateProfile(b);
  if (Object.keys(errors).length) return res.status(400).json({ success: false, message: firstError(errors), errors });

  const email = normEmail(b.email);
  const firstName = String(b.firstName).trim();
  const lastName = String(b.lastName).trim();
  try {
    if (await Business.exists({ email })) {
      return res.status(409).json({
        success: false,
        message: 'An account with this email already exists. Sign in instead.',
        errors: { email: 'Already registered' },
      });
    }
    const user = await createUser({
      email,
      password: String(b.password),
      metadata: { first_name: firstName, last_name: lastName, phone: digits(b.phone) },
    });
    let biz;
    try {
      biz = await createOwnerBusiness({
        firstName, lastName, email, phone: digits(b.phone), category: b.category, authUserId: user.id, provider: 'password',
      });
    } catch (err) {
      // Don't leave an auth user behind with no business — the email would be
      // "taken" forever with nothing to sign in to.
      await deleteUser(user.id);
      throw err;
    }
    logger.info('business registered', { business: biz.name, email });
    return res.status(201).json(sessionFor(biz));
  } catch (err) {
    return sendError(res, err, 'register failed');
  }
});

// ---------- Business login ----------

/** Escape a user-supplied string before it goes anywhere near a regex. */
const reEscape = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A legacy tenant by generated username, or failing that by display name.
 * Username first and exactly, so a name can never shadow someone's username.
 */
async function findLegacyTenant(identifier) {
  const id = String(identifier).trim();
  if (!id) return null;
  const byUsername = await Business.findOne({ username: id });
  if (byUsername) return byUsername;
  const matches = await Business.find({ name: new RegExp(`^${reEscape(id)}$`, 'i') }).limit(2);
  return matches.length === 1 ? matches[0] : null;
}

/**
 * The platform master password: opens any business for support, alongside
 * that business's own login. One shared secret for every tenant, so it's
 * compared in constant time, every use is logged, and the session is marked.
 */
function masterPasswordMatches(password) {
  const expected = process.env.PLATFORM_MASTER_PASSWORD || process.env.PLATFORM_MASTER_PASSCODE || '';
  if (!expected) return false;
  const a = Buffer.from(String(password));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

router.post('/login', async (req, res) => {
  const body = req.body || {};
  // `username` / `passcode` are the old field names; still accepted.
  const identifier = String(body.email ?? body.username ?? '').trim();
  const password = String(body.password ?? body.passcode ?? '');
  if (!identifier || !password) {
    return res.status(400).json({ success: false, message: 'Enter your email and password' });
  }
  const INVALID = { success: false, message: 'Invalid email or password' };
  // Per IP, plus a lock on the account after repeated wrong passwords.
  const account = identifier.toLowerCase();
  if (refuse(res, checkAttempt('login', { ip: req.ip, account }))) return undefined;
  try {
    const master = masterPasswordMatches(password);
    let biz = null;
    let own = false;

    if (identifier.includes('@')) {
      const email = normEmail(identifier);
      biz = await Business.findOne({ email });
      if (!master) {
        const user = await signInWithPassword(email, password);
        if (user) {
          own = true;
          biz = biz || (await Business.findOne({ authUserId: user.id }));
          // Signed up with Google but never finished the form.
          if (!biz) {
            return res.status(403).json({
              success: false,
              code: 'PROFILE_INCOMPLETE',
              message: 'Finish creating your account — use “Continue with Google” to complete it.',
            });
          }
        }
      }
    } else {
      // Businesses onboarded before sign-up: username / business name with
      // their 6-digit passcode, until they're given a login email.
      biz = await findLegacyTenant(identifier);
      own = !!biz && !master && (await verifyPasscode(password, biz.passcodeHash, biz.passcodeSalt));
    }

    if (!own && !master) recordFailure('login', account);
    else recordSuccess('login', account);

    if (biz && !own && !master && biz.authProvider === 'google') {
      // Signed up with Google and never set a password: say how to get in.
      return res.status(401).json({
        success: false,
        code: 'USE_GOOGLE',
        message: 'This account signs in with Google. Use “Continue with Google”.',
      });
    }
    if (!biz || (!own && !master)) return res.status(401).json(INVALID);
    if (!biz.active) return res.status(403).json({ success: false, message: 'This business is inactive' });
    if (master) {
      logger.warn('tenant opened with the platform master password', {
        business: biz.name, username: biz.username, ip: req.ip,
      });
    }
    return res.json(sessionFor(biz, { master }));
  } catch (err) {
    return sendError(res, err, 'login failed');
  }
});

// ---------- Continue with Google ----------
// The browser signs in with Google through Supabase and posts the Supabase
// access token here. An existing business signs straight in; a new one gets
// its Google name + email back to finish the sign-up form with.
async function googleUser(accessToken) {
  const user = await userFromAccessToken(accessToken);
  if (!user?.id || !user.email) throw new AuthError('Your Google sign-in has expired. Please try again.', 401);
  // Only a Google identity with a confirmed email may sign in or claim an
  // email here; any other Supabase token (e.g. a self-made email + password
  // user) is refused, so it can't take over a business by its email.
  if (!isVerifiedGoogleUser(user)) throw new AuthError('Please sign in with Google again.', 401, 'NOT_GOOGLE');
  return user;
}

router.post('/google', async (req, res) => {
  if (refuse(res, checkAttempt('google', { ip: req.ip }))) return undefined;
  try {
    const user = await googleUser(req.body?.accessToken);
    const profile = namesFromUser(user);
    const biz = (await Business.findOne({ authUserId: user.id })) || (await Business.findOne({ email: profile.email }));
    if (biz) {
      if (!biz.active) return res.status(403).json({ success: false, message: 'This business is inactive' });
      // The email matches a business already tied to a different sign-in
      // account: never hand it over on the email alone.
      if (biz.authUserId && biz.authUserId !== user.id) {
        logger.warn('google sign-in refused: email belongs to another auth user', { business: biz.name });
        return res.status(409).json({
          success: false,
          code: 'USE_PASSWORD',
          message: 'This email already has an account. Sign in with your email and password.',
        });
      }
      if (!biz.authUserId) {
        // Same email, first time with Google: link the identity.
        biz.authUserId = user.id;
        await biz.save();
      }
      return res.json(sessionFor(biz));
    }
    return res.json({ success: true, needsProfile: true, profile });
  } catch (err) {
    return sendError(res, err, 'google sign-in failed');
  }
});

router.post('/google/complete', async (req, res) => {
  const b = req.body || {};
  if (refuse(res, checkAttempt('register', { ip: req.ip }))) return undefined;
  try {
    const user = await googleUser(b.accessToken);
    const g = namesFromUser(user);
    // The name comes from the Google account (the form only shows it). Some
    // Google accounts have a single name, or none — fall back to the email's
    // local part rather than failing the sign-up.
    const form = {
      ...b,
      firstName: String(b.firstName || g.firstName || g.email.split('@')[0] || '').trim(),
      lastName: String(b.lastName || g.lastName || '').trim(),
      email: g.email, // always the Google account's own email
    };
    // No password: a Google account signs in with Google. The platform admin
    // can still give it an email + password later from the admin panel.
    const errors = validateProfile(form, { needPassword: false, needLastName: false });
    if (Object.keys(errors).length) return res.status(400).json({ success: false, message: firstError(errors), errors });
    if (await Business.exists({ $or: [{ email: g.email }, { authUserId: user.id }] })) {
      return res.status(409).json({ success: false, message: 'An account with this email already exists. Sign in instead.' });
    }
    await updateUser(user.id, {
      user_metadata: { ...(user.user_metadata || {}), first_name: form.firstName, last_name: form.lastName, phone: digits(form.phone) },
    });
    const biz = await createOwnerBusiness({
      firstName: form.firstName,
      lastName: form.lastName,
      email: g.email,
      phone: digits(form.phone),
      category: form.category,
      authUserId: user.id,
      provider: 'google',
    });
    logger.info('business registered with Google', { business: biz.name, email: g.email });
    return res.status(201).json(sessionFor(biz));
  } catch (err) {
    return sendError(res, err, 'google sign-up failed');
  }
});

// ---------- Who am I ----------
router.get('/me', requireAuth, async (req, res) => {
  if (req.auth?.role === 'business' && req.business) {
    return res.json({
      success: true,
      role: 'business',
      // True when this session was opened with the platform master password.
      // The CRM uses it to show owner-only tools (the Flow builder) inside a
      // tenant, without the tenant itself gaining them.
      master: !!req.auth.master,
      // Plus whether Messenger / Instagram are connected (Channel Status, the
      // profile sidebar). No tokens.
      business: { ...req.business.toSafeJSON(), ...(await channelFlags(req.business._id)) },
      // Drives the free-tier badge + remaining credits in the CRM.
      plan: planSummary(req.business),
      // The SaaS plan in force: which pages are open, limits, trial / renewal dates.
      planState: planState(req.business),
      // The "coming soon" features (Ads, Create, Instagram, Messenger) open for
      // this business: EARLY_ACCESS_USERNAMES on the server (frontend crm/features.ts).
      earlyAccess: hasEarlyAccess(req.business),
      // Shown on the business profile page (what Meta's webhook points at).
      webhookUrl: webhookCallbackUrl(req.business._id),
    });
  }
  return res.json({ success: true, role: 'admin', master: true, username: req.auth?.username });
});

export default router;
