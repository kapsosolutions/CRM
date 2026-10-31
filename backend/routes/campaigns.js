// Campaigns page: create, schedule, send and track bulk template sends.
// Sending is done by services/campaignRunner.js; every number shown comes
// from stored data (services/campaignStats.js) or, for the messaging limit
// and quality, from Meta via the cached Channel Status read.
import express from 'express';
import { requireBusiness } from '../middleware/auth.js';
import Campaign from '../models/Campaign.js';
import CampaignSend from '../models/CampaignSend.js';
import Template from '../models/Template.js';
import { isWhatsAppConnected } from '../services/sandbox.js';
import { getNumberStatus } from '../services/metaAccount.js';
import { campaignStats, campaignResults, dripProgress, limitUsage, sendingStreak } from '../services/campaignStats.js';
import { runCampaign, newLease, NOT_CONNECTED_MSG } from '../services/campaignRunner.js';
import { isAuthTemplate, isValidOtpCode } from '../services/authTemplate.js';
import {
  CampaignInputError, META_CAMPAIGN_CHANNELS, buildMetaCampaignFields, audiencePreview,
} from '../services/metaCampaigns.js';
import logger from '../services/logger.js';
import { assertCampaignAllowed, sendPlanError } from '../services/planGate.js';

const router = express.Router();
router.use(requireBusiness);

/** Tenant filter, spread into every query here. */
const owner = (req) => ({ businessId: req.business._id });
const MAX_RECIPIENTS = 5000;
const MODES = ['draft', 'schedule', 'now'];

// Messenger / Instagram campaign checks (services/metaCampaigns.js) throw the
// same kind of error.
class Invalid extends CampaignInputError {}

function fail(res, err) {
  if (sendPlanError(res, err)) return undefined;
  if (err instanceof CampaignInputError) {
    return res.status(err.status).json({ success: false, message: err.message, ...(err.code ? { code: err.code } : {}) });
  }
  logger.error('campaign request failed', { error: err.message });
  return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
}

/** What the page gets for one campaign (no lease internals). */
function present(c, stats) {
  return {
    _id: String(c._id),
    name: c.name,
    templateName: c.templateName || '',
    language: c.language || '',
    type: c.type || 'single',
    status: c.status,
    scheduledAt: c.scheduledAt || null,
    startedAt: c.startedAt || null,
    finishedAt: c.finishedAt || null,
    createdAt: c.createdAt || null,
    updatedAt: c.updatedAt || null,
    total: c.total || 0,
    error: c.error || '',
    ltoCode: c.ltoCode || '',
    ltoExpiresAt: c.ltoExpiresAt || null,
    stats: stats || null,
    // 'whatsapp' | 'messenger' | 'instagram'; Messenger / Instagram campaigns
    // also say what they send and to whom.
    channel: META_CAMPAIGN_CHANNELS.includes(c.channel) ? c.channel : 'whatsapp',
    ...(META_CAMPAIGN_CHANNELS.includes(c.channel)
      ? { content: c.content || null, audienceFilter: c.audience || { activeDays: 0 } }
      : {}),
    // Drip: its follow-ups, and (while it waits for one) when the next is due.
    ...(c.type === 'drip' && c.drip
      ? {
        drip: {
          id: c.drip.id || '',
          name: c.drip.name || '',
          stopOnReply: !!c.drip.stopOnReply,
          steps: (c.drip.steps || []).map((s) => ({ templateName: s.templateName, language: s.language || '', delayMs: Number(s.delayMs) || 0 })),
        },
        dripNextAt: c.status === 'sending' && !c.lockedBy && c.scheduledAt && new Date(c.scheduledAt).getTime() > Date.now()
          ? c.scheduledAt
          : null,
      }
      : {}),
  };
}

const DRIP_MAX_STEPS = 10;
const DRIP_MAX_DELAY_MS = 90 * 24 * 60 * 60 * 1000;
const UNIT_MS = { minutes: 60 * 1000, hours: 60 * 60 * 1000, days: 24 * 60 * 60 * 1000 };

/**
 * A drip's follow-ups from the page: { name, stopOnReply, steps: [{ templateName,
 * delay, delayUnit: 'Minutes' | 'Hours' | 'Days', enabled }] } → what is stored
 * (enabled steps only, delays in ms). When sending, every template must exist
 * and be approved.
 */
async function parseDrip(req, raw, { sending }) {
  if (!raw || typeof raw !== 'object') throw new Invalid('Choose the drip sequence for this campaign.');
  const dripId = String(raw.id || '').replace(/[^\w-]/g, '').slice(0, 64);
  const list = Array.isArray(raw.steps) ? raw.steps : [];
  const steps = [];
  for (const s of list) {
    if (!s || s.enabled === false) continue;
    const templateName = String(s.templateName || '').trim();
    if (!templateName) throw new Invalid('Every follow-up in the drip needs a template.');
    const unit = UNIT_MS[String(s.delayUnit || 'minutes').toLowerCase()];
    const delay = Number(s.delay);
    if (!unit || !Number.isFinite(delay) || delay < 0) throw new Invalid('A follow-up’s wait must be 0 or more minutes, hours or days.');
    const delayMs = Math.round(delay * unit);
    if (delayMs > DRIP_MAX_DELAY_MS) throw new Invalid('A follow-up can wait at most 90 days.');
    steps.push({ templateName, language: '', delayMs });
  }
  if (!steps.length) throw new Invalid('The drip needs at least one follow-up message that is switched on.');
  if (steps.length > DRIP_MAX_STEPS) throw new Invalid(`A drip can have at most ${DRIP_MAX_STEPS} follow-ups.`);
  const names = [...new Set(steps.map((s) => s.templateName))];
  const found = new Map((await Template.find({ ...owner(req), name: { $in: names } }).lean()).map((t) => [t.name, t]));
  for (const s of steps) {
    const t = found.get(s.templateName);
    if (sending && !t) throw new Invalid(`The drip template "${s.templateName}" wasn't found. Sync your templates and try again.`);
    if (sending && t.status !== 'APPROVED') {
      throw new Invalid(`The drip template "${s.templateName}" is ${t.status}. Only approved templates can be sent.`);
    }
    s.language = t?.language || 'en_US';
  }
  return { id: dripId, name: String(raw.name || '').trim().slice(0, 120), stopOnReply: raw.stopOnReply !== false, steps };
}

/** Clean, dedupe and check a recipient list. */
function parseRecipients(list, { required }) {
  if (list !== undefined && list !== null && !Array.isArray(list)) throw new Invalid('Recipients must be a list.');
  const arr = list || [];
  if (arr.length > MAX_RECIPIENTS) {
    throw new Invalid(`A campaign can have at most ${MAX_RECIPIENTS.toLocaleString('en-US')} recipients; this one has ${arr.length.toLocaleString('en-US')}.`);
  }
  const seen = new Set();
  const out = [];
  const invalid = [];
  for (const r of arr) {
    const raw = String(r?.phone ?? '');
    // "+91 98…", "0091 98…" and "9198…" are one number: digits, without the
    // international "00" prefix, so the same person can't be on the list twice.
    const phone = raw.replace(/\D/g, '').replace(/^00(?=\d{8,})/, '');
    if (phone.length < 8 || phone.length > 15) {
      invalid.push(raw || '(empty)');
      continue;
    }
    if (seen.has(phone)) continue;
    seen.add(phone);
    let bodyParams = Array.isArray(r?.bodyParams)
      ? r.bodyParams.slice(0, 20).map((v) => String(v ?? '').slice(0, 1024))
      : [];
    // All blank: let the template's own variable mapping fill them at send time.
    if (bodyParams.every((v) => !v.trim())) bodyParams = [];
    out.push({ phone, name: String(r?.name || '').slice(0, 120), bodyParams, state: 'queued', metaMessageId: '', error: null });
  }
  if (invalid.length) {
    const sample = invalid.slice(0, 3).join(', ');
    throw new Invalid(`${invalid.length} phone number${invalid.length === 1 ? ' isn\'t' : 's aren\'t'} valid (8–15 digits with the country code): ${sample}${invalid.length > 3 ? ', …' : ''}`);
  }
  if (required && !out.length) throw new Invalid('Add at least one recipient.');
  return out;
}

/** Validate a create/edit body into the fields to store. */
async function buildFields(req, body) {
  const mode = MODES.includes(body.mode) ? body.mode : '';
  if (!mode) throw new Invalid('mode must be draft, schedule or now.');
  // Messenger / Instagram: their own audience and content rules.
  if (META_CAMPAIGN_CHANNELS.includes(String(body.channel || ''))) {
    return { mode, fields: await buildMetaCampaignFields(req.business, body, mode) };
  }
  if (body.channel && body.channel !== 'whatsapp') throw new Invalid('channel must be whatsapp, messenger or instagram.');
  const sending = mode !== 'draft';

  const name = String(body.name || '').trim();
  if (!name) throw new Invalid('Give the campaign a name.');
  if (name.length > 120) throw new Invalid('The campaign name can be at most 120 characters.');

  if (sending && !isWhatsAppConnected(req.business)) throw new Invalid(NOT_CONNECTED_MSG, 409, 'NOT_CONNECTED');

  const templateName = String(body.templateName || '').trim();
  const template = templateName ? await Template.findOne({ ...owner(req), name: templateName }).lean() : null;
  if (sending) {
    if (!templateName) throw new Invalid('Choose an approved template.');
    if (!template) throw new Invalid(`The template "${templateName}" wasn't found. Sync your templates and try again.`);
    if (template.status !== 'APPROVED') {
      throw new Invalid(`The template "${templateName}" is ${template.status}. Only approved templates can be sent.`);
    }
  }

  const recipients = parseRecipients(body.recipients, { required: sending });
  // Authentication template: each recipient's only value is their code. A
  // blank one is generated at send time, so every contact gets their own.
  if (template && isAuthTemplate(template)) {
    const bad = recipients.filter((r) => r.bodyParams[0]?.trim() && !isValidOtpCode(r.bodyParams[0]));
    if (bad.length) {
      const sample = bad.slice(0, 3).map((r) => `+${r.phone}`).join(', ');
      throw new Invalid(`A code can be at most 15 characters, with no spaces. Check the code for ${sample}${bad.length > 3 ? ', …' : ''}.`);
    }
    for (const r of recipients) r.bodyParams = r.bodyParams[0]?.trim() ? [r.bodyParams[0].trim()] : [];
  }

  const ltoCode = String(body.ltoCode || '').trim().toUpperCase().replace(/\s+/g, '').slice(0, 15);
  let ltoExpiresAt = null;
  if (body.ltoExpiresAt) {
    ltoExpiresAt = new Date(body.ltoExpiresAt);
    if (Number.isNaN(ltoExpiresAt.getTime())) throw new Invalid('The offer end time isn\'t a valid date.');
  }
  if (sending && template?.kind === 'lto') {
    const lto = template.lto || {};
    if (lto.hasCopyCode && !(ltoCode || lto.code)) throw new Invalid('Add the offer code for this campaign.');
    const end = ltoExpiresAt || (lto.endsAt ? new Date(lto.endsAt) : null);
    if (lto.hasExpiration && (!end || Number.isNaN(end.getTime()) || end.getTime() <= Date.now())) {
      throw new Invalid('Choose a future end time for the offer.');
    }
  }

  let scheduledAt = null;
  if (body.scheduledAt) {
    scheduledAt = new Date(body.scheduledAt);
    if (Number.isNaN(scheduledAt.getTime())) {
      if (mode === 'schedule') throw new Invalid('Pick a date and time to send this campaign.');
      scheduledAt = null;
    }
  }
  if (mode === 'schedule') {
    if (!scheduledAt) throw new Invalid('Pick a date and time to send this campaign.');
    if (scheduledAt.getTime() <= Date.now()) throw new Invalid('Pick a future date and time for this campaign.');
  }

  const type = body.type === 'drip' ? 'drip' : 'single';
  // A draft may be saved before its drip is picked.
  const drip = type === 'drip' && (sending || body.drip) ? await parseDrip(req, body.drip, { sending }) : null;

  return {
    mode,
    fields: {
      name,
      templateName,
      language: String(body.language || template?.language || 'en_US').slice(0, 20),
      type,
      drip,
      status: mode === 'draft' ? 'draft' : 'scheduled',
      scheduledAt,
      ltoCode,
      ltoExpiresAt,
      recipients,
      total: recipients.length,
      error: '',
      // A WhatsApp campaign (also when a Messenger / Instagram draft is
      // edited into one).
      channel: '',
      content: null,
      audience: null,
    },
  };
}

/** "Send now": the row is created already claimed, so no tick can race it. */
function sendNowFields(lease) {
  const now = new Date();
  return { status: 'sending', scheduledAt: now, startedAt: now, lockedBy: lease.by, lockedUntil: lease.until };
}

// ---------------- List ----------------
router.get('/', async (req, res) => {
  try {
    // ?channel=whatsapp | messenger | instagram (default: all)
    const ch = String(req.query.channel || '');
    const byChannel = META_CAMPAIGN_CHANNELS.includes(ch)
      ? { channel: ch }
      : ch === 'whatsapp' ? { channel: { $nin: META_CAMPAIGN_CHANNELS } } : {};
    const rows = await Campaign.find({ ...owner(req), ...byChannel }).select('-recipients').sort({ createdAt: -1 }).limit(500).lean();
    const stats = await campaignStats(req.business._id, rows);
    res.json({ success: true, data: rows.map((c) => present(c, stats.get(String(c._id)))) });
  } catch (err) {
    fail(res, err);
  }
});

// ---------------- Overview cards ----------------
// Daily limit (tier from Meta) and its use in the last 24 h, quality rating,
// and the sending streak in the viewer's local days (?tz = minutes east of UTC).
router.get('/overview', async (req, res) => {
  try {
    const tz = Math.max(-840, Math.min(840, parseInt(req.query.tz, 10) || 0));
    const id = req.business._id;
    const connected = isWhatsAppConnected(req.business);
    const [status, usage, streak] = await Promise.all([
      connected ? getNumberStatus(req.business) : Promise.resolve(null),
      limitUsage(id),
      sendingStreak(id, tz),
    ]);
    res.json({
      success: true,
      connected,
      limit: connected && status?.limit ? { ...status.limit, ...usage } : null,
      usage,
      quality: connected ? status?.number?.qualityRating || null : null,
      metaError: status?.error || '',
      stale: !!status?.stale,
      fetchedAt: status?.fetchedAt || null,
      streak,
    });
  } catch (err) {
    fail(res, err);
  }
});

// ---------------- Messenger / Instagram audience counts ----------------
// ?channel=messenger|instagram&activeDays=N → how many chats, and how many
// are inside the 24-hour window right now (the rest are outside it).
router.get('/audience', async (req, res) => {
  try {
    const r = await audiencePreview(req.business._id, String(req.query.channel || ''), { activeDays: req.query.activeDays });
    res.json({ success: true, ...r });
  } catch (err) {
    fail(res, err);
  }
});

// ---------------- One campaign, with each recipient's result ----------------
router.get('/:id', async (req, res) => {
  try {
    const c = await Campaign.findOne({ _id: req.params.id, ...owner(req) }).lean();
    if (!c) return res.status(404).json({ success: false, message: 'Campaign not found' });
    const [stats, results, drip] = await Promise.all([
      campaignStats(req.business._id, [c]),
      campaignResults(req.business._id, c),
      dripProgress(req.business._id, c),
    ]);
    const editable = c.status === 'draft' || c.status === 'scheduled';
    res.json({
      success: true,
      data: {
        ...present(c, stats.get(String(c._id))),
        recipients: results,
        ...(drip ? { dripProgress: drip } : {}),
        // What a draft or scheduled campaign is resumed with.
        ...(editable
          ? { audience: (c.recipients || []).map((r) => ({ phone: r.phone, name: r.name || '', bodyParams: r.bodyParams || [] })) }
          : {}),
      },
    });
  } catch (err) {
    fail(res, err);
  }
});

// ---------------- Create (draft, schedule, or send now) ----------------
// `requestId` (the page's id for one click): sent again — a double click, a
// retry after the answer was lost — it returns the campaign already created
// instead of creating and sending a second one.
router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const requestId = /^[\w-]{8,64}$/.test(String(body.requestId || '')) ? String(body.requestId) : null;
    if (requestId) {
      const prev = await Campaign.findOne({ ...owner(req), requestId }).select('-recipients').lean();
      if (prev) return res.status(200).json({ success: true, data: present(prev), duplicate: true });
    }
    const { mode, fields } = await buildFields(req, body);
    // The plan: campaigns (and that channel) included, and its monthly count.
    if (mode !== 'draft') await assertCampaignAllowed(req.business, { channel: fields.channel || 'whatsapp' });
    const lease = mode === 'now' ? newLease() : null;
    let doc;
    try {
      doc = await Campaign.create({ ...owner(req), ...fields, ...(requestId ? { requestId } : {}), ...(lease ? sendNowFields(lease) : {}) });
    } catch (err) {
      // The same click, arrived twice at once: the first one won.
      if (err?.code === 11000 && requestId) {
        const prev = await Campaign.findOne({ ...owner(req), requestId }).select('-recipients').lean();
        if (prev) return res.status(200).json({ success: true, data: present(prev), duplicate: true });
      }
      throw err;
    }
    if (lease) runCampaign(String(doc._id), lease);
    res.status(201).json({ success: true, data: present(doc) });
  } catch (err) {
    fail(res, err);
  }
});

// ---------------- Edit a draft or a scheduled campaign ----------------
router.put('/:id', async (req, res) => {
  try {
    const { mode, fields } = await buildFields(req, req.body || {});
    // A draft launched (or rescheduled) now counts; one already counted doesn't again.
    if (mode !== 'draft') {
      await assertCampaignAllowed(req.business, { channel: fields.channel || 'whatsapp', exceptId: req.params.id });
    }
    const now = new Date();
    const lease = mode === 'now' ? newLease() : null;
    const r = await Campaign.updateOne(
      {
        _id: req.params.id,
        ...owner(req),
        status: { $in: ['draft', 'scheduled'] },
        $or: [{ lockedUntil: null }, { lockedUntil: { $lt: now } }],
      },
      { $set: { ...fields, ...(lease ? sendNowFields(lease) : { lockedBy: '', lockedUntil: null }) } },
    );
    if (!r.matchedCount) {
      const exists = await Campaign.exists({ _id: req.params.id, ...owner(req) });
      if (!exists) return res.status(404).json({ success: false, message: 'Campaign not found' });
      return res.status(409).json({ success: false, message: 'This campaign has already started, so it can\'t be edited.' });
    }
    if (lease) runCampaign(String(req.params.id), lease);
    const c = await Campaign.findOne({ _id: req.params.id, ...owner(req) }).select('-recipients').lean();
    res.json({ success: true, data: present(c) });
  } catch (err) {
    fail(res, err);
  }
});

// ---------------- Cancel (scheduled, or stop one that is sending) ----------------
router.post('/:id/cancel', async (req, res) => {
  try {
    const r = await Campaign.updateOne(
      { _id: req.params.id, ...owner(req), status: { $in: ['scheduled', 'sending'] } },
      { $set: { status: 'cancelled', finishedAt: new Date() } },
    );
    if (!r.matchedCount) {
      const exists = await Campaign.exists({ _id: req.params.id, ...owner(req) });
      if (!exists) return res.status(404).json({ success: false, message: 'Campaign not found' });
      return res.status(409).json({ success: false, message: 'Only scheduled or sending campaigns can be cancelled.' });
    }
    res.json({ success: true });
  } catch (err) {
    fail(res, err);
  }
});

// ---------------- Delete (drafts, scheduled and cancelled) ----------------
router.delete('/:id', async (req, res) => {
  try {
    const now = new Date();
    const r = await Campaign.deleteOne({
      _id: req.params.id,
      ...owner(req),
      status: { $in: ['draft', 'scheduled', 'cancelled'] },
      $or: [{ lockedUntil: null }, { lockedUntil: { $lt: now } }],
    });
    if (!r.deletedCount) {
      const exists = await Campaign.exists({ _id: req.params.id, ...owner(req) });
      if (!exists) return res.status(404).json({ success: false, message: 'Campaign not found' });
      return res.status(409).json({ success: false, message: 'Only drafts, scheduled and cancelled campaigns can be deleted.' });
    }
    await CampaignSend.deleteMany({ campaignId: String(req.params.id), ...owner(req) }).catch(() => {});
    res.json({ success: true });
  } catch (err) {
    fail(res, err);
  }
});

export default router;
