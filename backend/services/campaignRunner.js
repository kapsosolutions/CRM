// ---------------------------------------------------------------------------
// Campaign sender
//
// Campaigns used to be sent by the browser, one /send-template call per
// recipient: closing the tab stopped them, scheduled ones never ran, and the
// counts shown afterwards were invented at send time. They are sent here now.
//
// A campaign is sent under a lease (lockedBy + lockedUntil) that is renewed as
// it goes. Whoever holds the lease is the only one sending it, so a second run
// (another tick, a second process) never sends twice. If the process dies the
// lease runs out and the next tick resumes it; recipients that already have a
// campaign Message row are not sent again.
//
// Each send goes through the same path as a single /send-template: stored
// template → templateSendOptions → client.sendTemplate, with the campaign id
// stored on the Message. Delivery counts then come from the status webhook
// (services/campaignStats.js).
// ---------------------------------------------------------------------------
import crypto from 'crypto';
import Campaign from '../models/Campaign.js';
import CampaignSend from '../models/CampaignSend.js';
import Business from '../models/Business.js';
import Template from '../models/Template.js';
import Message from '../models/Message.js';
import { getClientForBusiness } from './metaCloud.js';
import { isWhatsAppConnected } from './sandbox.js';
import { templateSendOptions } from './templateTriggers.js';
import { renderTemplate, renderedPreview } from './templateRender.js';
import { touchOutbound } from './conversationState.js';
import { campaignStats } from './campaignStats.js';
import { notify } from './notifications.js';
import { META_CAMPAIGN_CHANNELS, runMetaRecipients } from './metaCampaigns.js';
import { planState, hasFeature } from './plans.js';
import logger from './logger.js';

const TICK_MS = 20 * 1000; // how often due campaigns are looked for
const LEASE_MS = 2 * 60 * 1000; // a run's claim, renewed while it sends
const SPACING_MS = 200; // between two sends, as the browser loop did
const FLUSH_EVERY = 10; // recipients between progress saves
const FLUSH_MS = 10 * 1000;
const MAX_ACTIVE = 3; // campaigns sent at once by this process
// Meta's "too many messages" answers: nothing was sent, so waiting and trying
// again is safe (throughput 130429, pair rate 131056, app / account limits).
const RATE_LIMIT_CODES = new Set([4, 80007, 130429, 131056]);
// The request never reached Meta (DNS, connection refused): safe to retry.
const NOT_REACHED_CODES = new Set(['ENOTFOUND', 'ECONNREFUSED', 'EAI_AGAIN']);
// Another campaign sending the same template to the same number within this
// window is taken as a campaign started twice.
export const DUP_WINDOW_MS = 30 * 60 * 1000;
const UNCONFIRMED = {
  code: 'UNCONFIRMED',
  title: '',
  message: 'WhatsApp didn’t confirm this message in time. It may still have been delivered, so it isn’t sent again.',
  details: '',
};

export const NOT_CONNECTED_MSG = 'Campaigns need your own WhatsApp number. Connect it to send templates; '
  + 'the shared test number can only reply to customers within 24 hours.';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const active = new Map(); // campaign id -> Promise of its run

/** A fresh lease: who holds it and until when. */
export function newLease() {
  return { by: crypto.randomBytes(8).toString('hex'), until: new Date(Date.now() + LEASE_MS) };
}

/**
 * Why a send failed, in the same shape as a failed receipt's error:
 * { code, title, message, details }. Meta's own wording when it refused.
 */
export function sendError(err) {
  const e = err?.response?.data?.error;
  if (e) {
    return {
      code: e.code ?? null,
      // error_user_title is Meta's readable title; `type` ("OAuthException") isn't.
      title: String(e.error_user_title || ''),
      message: String(e.error_user_msg || e.message || 'Meta refused the message'),
      details: String(e.error_data?.details || ''),
    };
  }
  return { code: err?.code ?? null, title: '', message: String(err?.message || 'The message could not be sent'), details: '' };
}

/** Errors that mean no later recipient can succeed either. */
function stopsCampaign(err) {
  return err?.status === 402 // free-trial credits used up
    || err?.code === 'WA_NOT_CONNECTED'
    || err?.response?.data?.error?.code === 190; // access token invalid or expired
}

/** Every recipient still queued becomes failed with this reason. */
function failQueued(recipients, error) {
  for (const r of recipients) if (r.state === 'queued') Object.assign(r, { state: 'failed', error });
}

/** Take the lease on a due campaign. Returns the lease, or null if someone else has it. */
export async function claimCampaign(id) {
  const now = new Date();
  const lease = newLease();
  const res = await Campaign.updateOne(
    {
      _id: id,
      status: { $in: ['scheduled', 'sending'] },
      scheduledAt: { $lte: now },
      $or: [{ lockedUntil: null }, { lockedUntil: { $lt: now } }],
    },
    { $set: { status: 'sending', lockedBy: lease.by, lockedUntil: lease.until } },
  );
  if (!res.matchedCount) return null;
  await Campaign.updateOne({ _id: id, startedAt: null }, { $set: { startedAt: now } });
  return lease;
}

/**
 * Send a campaign the caller holds the lease for. Resolves when it is done
 * (completed, failed, cancelled, or the lease was lost).
 */
async function execute(id, lease) {
  const c = await Campaign.findOne({ _id: id, lockedBy: lease.by }).lean();
  if (!c) return;
  const recipients = Array.isArray(c.recipients) ? c.recipients.map((r) => ({ ...r })) : [];
  let stopError = '';
  let cancelled = false;
  let lost = false;

  const save = async (extra = {}) => {
    const res = await Campaign.updateOne(
      { _id: id, lockedBy: lease.by },
      { $set: { recipients, lockedUntil: new Date(Date.now() + LEASE_MS), ...extra } },
    );
    if (!res.matchedCount) lost = true;
  };

  // The plan, when it runs (a campaign scheduled during the trial, or a
  // drip's follow-ups, after a downgrade): no campaigns → nothing more is sent.
  const planBiz = await Business.findById(c.businessId).select('createdAt trialEndsAt subscription name').lean();
  const pState = planBiz ? planState(planBiz) : null;
  const metaChannel = META_CAMPAIGN_CHANNELS.includes(c.channel) ? c.channel : '';
  if (pState && (!hasFeature(pState, 'campaigns') || (metaChannel && !hasFeature(pState, metaChannel)))) {
    stopError = `Campaigns${metaChannel ? ` on ${metaChannel === 'instagram' ? 'Instagram' : 'Messenger'}` : ''} aren't included in your ${pState.name} plan. Upgrade to send them.`;
    failQueued(recipients, { code: 'PLAN_LOCKED', title: '', message: stopError, details: '' });
    for (const r of recipients) {
      if (r.drip && !r.drip.done) r.drip = { ...r.drip, done: true, stopped: 'plan' };
    }
    return finish(c, id, recipients, { stopError, cancelled, lost, save, lease });
  }

  // Messenger / Instagram: the same lease, cancel and resume handling, with
  // the 24-hour window checked per recipient (services/metaCampaigns.js).
  if (META_CAMPAIGN_CHANNELS.includes(c.channel)) {
    try {
      const r = await runMetaRecipients(c, recipients, { id, lease, save, isLost: () => lost });
      stopError = r.stopError;
      cancelled = r.cancelled;
      lost = lost || r.lost;
    } catch (err) {
      logger.error('campaign run failed', { campaignId: id, channel: c.channel, error: err.message });
      await save().catch(() => {});
      return;
    }
    return finish(c, id, recipients, { stopError, cancelled, lost, save, lease });
  }

  const steps = dripSteps(c);
  try {
    const biz = await Business.findById(c.businessId).lean();
    const names = [...new Set([c.templateName, ...steps.map((s) => s.templateName)].filter(Boolean))];
    const tplByName = new Map(
      biz ? (await Template.find({ businessId: c.businessId, name: { $in: names } }).lean()).map((t) => [t.name, t]) : [],
    );
    const template = tplByName.get(c.templateName) || null;
    const anyQueued = recipients.some((r) => r.state === 'queued');
    if (!biz || !biz.active || !isWhatsAppConnected(biz)) {
      stopError = NOT_CONNECTED_MSG;
    } else if (anyQueued && (!template || template.status !== 'APPROVED')) {
      // Only matters while someone still has to get the main message; a drip
      // that is past it carries on with its follow-ups.
      stopError = template
        ? `The template "${c.templateName}" is ${template.status}. Only approved templates can be sent.`
        : `The template "${c.templateName}" no longer exists.`;
    }
    if (stopError) {
      failQueued(recipients, { code: null, title: '', message: stopError, details: '' });
    } else {
      // A run that stopped before this ledger existed: anyone who already has
      // a Message from this campaign was sent, so isn't sent again.
      const prior = await Message.find({ businessId: c.businessId, campaignId: id, direction: 'out' })
        .select('phone metaMessageId raw').lean();
      const sentTo = new Map(prior.filter((m) => !m.raw?.dripStep).map((m) => [m.phone, m.metaMessageId || '']));
      for (const r of recipients) {
        if (r.state === 'queued' && sentTo.has(r.phone)) Object.assign(r, { state: 'sent', metaMessageId: sentTo.get(r.phone) });
      }

      const ctx = { c, id, biz, meta: getClientForBusiness(biz), tplByName, steps };
      let sinceFlush = 0;
      let flushedAt = Date.now();
      // Before each send: still ours (the lease is renewed here, so a long
      // run never lapses into a second run), and not cancelled.
      const gate = async () => {
        const t = await Campaign.updateOne(
          { _id: id, lockedBy: lease.by, status: { $ne: 'cancelled' } },
          { $set: { lockedUntil: new Date(Date.now() + LEASE_MS) } },
        );
        if (t.matchedCount) return true;
        const cur = await Campaign.findOne({ _id: id }).select('status lockedBy').lean();
        if (!cur || cur.lockedBy !== lease.by) lost = true;
        else cancelled = true;
        return false;
      };
      const progress = async () => {
        sinceFlush += 1;
        if (sinceFlush >= FLUSH_EVERY || Date.now() - flushedAt >= FLUSH_MS) {
          await save();
          sinceFlush = 0;
          flushedAt = Date.now();
        }
        await sleep(SPACING_MS);
        return !lost;
      };

      // 1. The main template, to everyone still queued.
      for (const r of recipients) {
        if (r.state !== 'queued') continue;
        // eslint-disable-next-line no-await-in-loop
        if (!(await gate())) break;
        // eslint-disable-next-line no-await-in-loop
        const res = await deliver(ctx, r, 0);
        Object.assign(r, {
          state: res.state, metaMessageId: res.metaMessageId || '', error: res.error || null,
          ...(res.state === 'sent' ? { sentAt: res.sentAt || new Date().toISOString() } : {}),
        });
        if (res.stop) {
          stopError = res.error?.message || 'The campaign stopped.';
          failQueued(recipients, res.error);
          break;
        }
        // eslint-disable-next-line no-await-in-loop
        if (!(await progress())) break;
      }

      // 2. Drip: every follow-up that is due now.
      if (steps.length && !stopError && !cancelled && !lost) {
        for (const r of recipients) startDrip(r, steps);
        outer: for (const r of recipients) {
          while (dripDue(r)) {
            // eslint-disable-next-line no-await-in-loop
            if (!(await gate())) break outer;
            const k = r.drip.next;
            // eslint-disable-next-line no-await-in-loop
            if (c.drip?.stopOnReply && (await repliedSince(c, r))) {
              Object.assign(r.drip, { done: true, stopped: 'replied' });
              break;
            }
            // eslint-disable-next-line no-await-in-loop
            const res = await deliver(ctx, r, k + 1);
            r.drip.results[k] = {
              state: res.state, metaMessageId: res.metaMessageId || '', error: res.error || null, at: new Date().toISOString(),
            };
            if (res.stop) {
              stopError = res.error?.message || 'The campaign stopped.';
              break outer;
            }
            r.drip.next = k + 1;
            if (r.drip.next >= steps.length) r.drip.done = true;
            else r.drip.dueAt = new Date(Date.now() + steps[r.drip.next].delayMs).toISOString();
            // eslint-disable-next-line no-await-in-loop
            if (!(await progress())) break outer;
          }
        }
      }
    }
  } catch (err) {
    // Unexpected (database down mid-run). Progress so far is saved and the
    // lease is left to expire, so the next tick resumes it.
    logger.error('campaign run failed', { campaignId: id, error: err.message });
    await save().catch(() => {});
    return;
  }

  // A drip with follow-ups still to come: wait for the next one (the tick
  // claims it again when it is due), lease released.
  if (steps.length && !stopError && !cancelled && !lost) {
    const waiting = recipients.filter((r) => r.drip && !r.drip.done && r.state === 'sent');
    if (waiting.length) {
      const nextAt = new Date(Math.min(...waiting.map((r) => new Date(r.drip.dueAt).getTime())));
      const w = await Campaign.updateOne(
        { _id: id, lockedBy: lease.by, status: { $ne: 'cancelled' } },
        { $set: { recipients, status: 'sending', scheduledAt: nextAt, lockedBy: '', lockedUntil: null } },
      );
      if (w.matchedCount) {
        logger.info('drip campaign waiting for its next follow-up', { campaignId: id, nextAt: nextAt.toISOString(), waiting: waiting.length });
        return;
      }
      // Cancelled meanwhile: finish as cancelled below.
      cancelled = true;
    }
  }

  await finish(c, id, recipients, { stopError, cancelled, lost, save, lease });
}

/** The drip's follow-ups, as stored on the campaign (only enabled ones are stored). */
export function dripSteps(c) {
  if (c?.type !== 'drip' || !Array.isArray(c?.drip?.steps)) return [];
  return c.drip.steps.filter((s) => s && s.templateName).map((s) => ({
    templateName: String(s.templateName), language: String(s.language || ''), delayMs: Math.max(0, Number(s.delayMs) || 0),
  }));
}

/** A number that got the main message starts its drip: follow-up 1 is due `delay` after it. */
function startDrip(r, steps) {
  if (r.drip || r.state !== 'sent' || !steps.length) return;
  const base = new Date(r.sentAt || Date.now()).getTime();
  r.drip = { next: 0, dueAt: new Date(base + steps[0].delayMs).toISOString(), done: false, stopped: '', results: [] };
}

const dripDue = (r, now = Date.now()) => !!r.drip && !r.drip.done && new Date(r.drip.dueAt).getTime() <= now;

/** The number wrote to the business after the campaign's main message. */
async function repliedSince(c, r) {
  if (!r.sentAt) return false;
  return !!(await Message.exists({
    businessId: c.businessId, phone: r.phone, direction: 'in', createdAt: { $gt: new Date(r.sentAt) },
  }));
}

/** Meta, or the network before it, refused: nothing went out, so it can be tried again. */
export function retryableSend(err) {
  if (err?.response) return RATE_LIMIT_CODES.has(Number(err.response.data?.error?.code));
  return NOT_REACHED_CODES.has(err?.code);
}

/** The request reached Meta but no answer came back: the message may have gone out. */
export function outcomeUnknown(err) {
  return !err?.response && !!err?.request && !NOT_REACHED_CODES.has(err?.code);
}

const retryWaits = () => String(process.env.CAMPAIGN_RETRY_WAITS_MS || '3000,10000,30000')
  .split(',').map((n) => Math.max(0, Number(n) || 0));

/** The ledger row of an earlier attempt → what the recipient is. Never a second send. */
async function fromLedger(ctx, r, step, prev) {
  if (prev?.state === 'sent') return { state: 'sent', metaMessageId: prev.metaMessageId || '', sentAt: prev.sentAt };
  if (prev?.state === 'failed') return { state: 'failed', error: prev.error || null };
  // 'sending': a run stopped between handing it to Meta and hearing back. If
  // its Message row is there, it went out.
  const m = await Message.findOne({
    businessId: ctx.c.businessId, campaignId: ctx.id, phone: r.phone, direction: 'out',
    'raw.dripStep': step ? step : { $exists: false },
  }).select('metaMessageId createdAt').lean();
  if (m) return { state: 'sent', metaMessageId: m.metaMessageId || '', sentAt: m.createdAt };
  return { state: 'failed', error: UNCONFIRMED };
}

/**
 * One campaign message to one number: step 0 is the main template, step n the
 * drip's follow-up n. Booked in the ledger before it goes to Meta, so it can
 * never go twice; a rate limit is waited out and tried again (Meta didn't
 * send it); no answer at all isn't retried (Meta may have sent it).
 * → { state: 'sent' | 'failed' | 'skipped', metaMessageId, error, stop }
 */
async function deliver(ctx, r, step) {
  const { c, id, biz, meta, tplByName, steps } = ctx;
  const s = step === 0 ? { templateName: c.templateName, language: c.language } : steps[step - 1];
  const tpl = tplByName.get(s.templateName);
  if (!tpl || tpl.status !== 'APPROVED') {
    const message = tpl
      ? `The template "${s.templateName}" is ${tpl.status}. Only approved templates can be sent.`
      : `The template "${s.templateName}" no longer exists.`;
    return { state: 'failed', error: { code: null, title: '', message, details: '' } };
  }
  // The same template to the same number from another campaign just now:
  // almost always a campaign started twice. Not sent again.
  const dup = await CampaignSend.findOne({
    businessId: c.businessId, phone: r.phone, templateName: s.templateName, campaignId: { $ne: id },
    state: { $in: ['sending', 'sent'] }, attemptedAt: { $gt: new Date(Date.now() - DUP_WINDOW_MS) },
  }).select('_id').lean();
  if (dup) {
    return {
      state: 'skipped',
      error: {
        code: 'DUPLICATE', title: '',
        message: `“${s.templateName}” was sent to this number by another campaign in the last ${DUP_WINDOW_MS / 60000} minutes, so it wasn’t sent again.`,
        details: '',
      },
    };
  }
  const key = { campaignId: id, phone: r.phone, step };
  try {
    await CampaignSend.create({ ...key, businessId: c.businessId, templateName: s.templateName, state: 'sending', attemptedAt: new Date() });
  } catch (err) {
    if (err?.code !== 11000) throw err;
    return fromLedger(ctx, r, step, await CampaignSend.findOne(key).lean());
  }

  const waits = retryWaits();
  for (let attempt = 0; ; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const opts = await templateSendOptions(
        tpl,
        { phone: r.phone, business: biz },
        { bodyParams: step === 0 ? r.bodyParams : [], ltoCode: c.ltoCode, ltoExpiresAt: c.ltoExpiresAt },
      );
      // eslint-disable-next-line no-await-in-loop
      const data = await meta.sendTemplate(r.phone, s.templateName, {
        ...opts,
        languageCode: s.language || opts.languageCode,
        campaignId: id,
        ...(step ? { dripStep: step } : {}),
      });
      const metaMessageId = data?.messages?.[0]?.id || '';
      const sentAt = new Date();
      // eslint-disable-next-line no-await-in-loop
      await CampaignSend.updateOne(key, { $set: { state: 'sent', metaMessageId, sentAt, error: null } });
      // eslint-disable-next-line no-await-in-loop
      await touchOutbound(r.phone, renderedPreview(renderTemplate(tpl, opts), s.templateName), biz._id).catch(() => {});
      return { state: 'sent', metaMessageId, sentAt: sentAt.toISOString() };
    } catch (err) {
      if (retryableSend(err) && attempt < waits.length) {
        logger.warn('campaign send rate-limited, trying again', { campaignId: id, step, attempt: attempt + 1, code: err?.response?.data?.error?.code ?? err?.code });
        // eslint-disable-next-line no-await-in-loop
        await sleep(waits[attempt]);
        continue;
      }
      if (outcomeUnknown(err)) {
        // eslint-disable-next-line no-await-in-loop
        await CampaignSend.updateOne(key, { $set: { error: UNCONFIRMED } }).catch(() => {});
        logger.warn('campaign send unconfirmed, not retried', { campaignId: id, step, error: err.message });
        return { state: 'failed', error: UNCONFIRMED };
      }
      const error = sendError(err);
      // eslint-disable-next-line no-await-in-loop
      await CampaignSend.updateOne(key, { $set: { state: 'failed', error } }).catch(() => {});
      return { state: 'failed', error, stop: stopsCampaign(err) };
    }
  }
}

/** The end of a run: the final status, the lease released, the bell. */
async function finish(c, id, recipients, { stopError, cancelled, lost, save, lease }) {
  if (lost) {
    logger.warn('campaign lease lost, another run continues it', { campaignId: id });
    return;
  }
  const accepted = recipients.filter((r) => r.state === 'sent').length;
  // Messenger / Instagram: a campaign where everyone was outside the window
  // (skipped, nothing failed) completed; it didn't fail.
  const skipped = recipients.filter((r) => r.state === 'skipped').length;
  const failedAll = accepted === 0 && recipients.length && (stopError || skipped < recipients.length);
  let status = cancelled ? 'cancelled' : failedAll ? 'failed' : 'completed';
  const end = { finishedAt: new Date(), lockedUntil: null, lockedBy: '', ...(stopError ? { error: stopError } : {}) };
  if (status === 'cancelled') {
    await save({ status, ...end });
  } else {
    // Cancelled from the page after the last send: it stays cancelled.
    const r = await Campaign.updateOne(
      { _id: id, lockedBy: lease.by, status: { $ne: 'cancelled' } },
      { $set: { recipients, status, ...end } },
    );
    if (!r.matchedCount) {
      status = 'cancelled';
      await save(end);
    }
  }
  logger.info('campaign finished', {
    campaignId: id, business: String(c.businessId), status, recipients: recipients.length, accepted,
    ...(c.channel ? { channel: c.channel, skipped } : {}),
  });
  // The bell, with the counts as they stand now. A cancel was the owner's own
  // doing, so it isn't announced back to them.
  if (status !== 'cancelled') {
    notifyCampaignFinished(c, status)
      .catch((e) => logger.warn('campaign notification failed', { campaignId: id, error: e.message }));
  }
}

async function notifyCampaignFinished(c, status) {
  const stats = (await campaignStats(c.businessId, [{ _id: c._id, status }]))?.get(String(c._id));
  const s = stats || { accepted: 0, delivered: 0, failed: 0, skipped: 0 };
  return notify(c.businessId, {
    type: 'campaign_finished',
    title: status === 'failed' ? `Campaign “${c.name}” failed` : `Campaign “${c.name}” finished`,
    body: `Sent ${s.accepted} · Delivered ${s.delivered} · Failed ${s.failed}${s.skipped ? ` · Skipped ${s.skipped} (outside the 24-hour window)` : ''}`,
    target: { view: 'campaigns', id: String(c._id) },
  });
}

/**
 * Run a campaign. With a `lease` the caller already holds it (a "send now"
 * claims at creation); without, it is claimed here and nothing happens when
 * someone else holds it.
 */
export async function runCampaign(id, lease = null) {
  const key = String(id);
  if (active.has(key)) return active.get(key);
  const l = lease || (await claimCampaign(key));
  if (!l) return undefined;
  const p = execute(key, l)
    .catch((err) => logger.error('campaign run crashed', { campaignId: key, error: err.message }))
    .finally(() => active.delete(key));
  active.set(key, p);
  return p;
}

/** The run in progress for a campaign in this process, if any (tests wait on it). */
export function campaignRun(id) {
  return active.get(String(id));
}

/** One pass: claim and start every due campaign, up to MAX_ACTIVE at once. */
export async function runDueCampaigns() {
  const room = MAX_ACTIVE - active.size;
  if (room <= 0) return 0;
  const now = new Date();
  let due = [];
  try {
    due = await Campaign.find({
      status: { $in: ['scheduled', 'sending'] },
      scheduledAt: { $lte: now },
      $or: [{ lockedUntil: null }, { lockedUntil: { $lt: now } }],
    }).select('_id').sort({ scheduledAt: 1 }).limit(room).lean();
  } catch (err) {
    logger.warn('campaign tick query failed', { error: err.message });
    return 0;
  }
  let started = 0;
  for (const { _id } of due) {
    // Still running here (a stall let its lease lapse): it renews it itself.
    if (active.has(String(_id))) continue;
    // eslint-disable-next-line no-await-in-loop
    const lease = await claimCampaign(String(_id)).catch(() => null);
    if (lease) {
      runCampaign(String(_id), lease);
      started += 1;
    }
  }
  return started;
}

let timer = null;

/** Start the periodic tick. Safe to call once at boot. */
export function startCampaignRunner() {
  if (timer) return;
  logger.info('campaign runner started', { everySeconds: TICK_MS / 1000 });
  setTimeout(() => { runDueCampaigns().catch(() => {}); }, 10 * 1000);
  timer = setInterval(() => { runDueCampaigns().catch(() => {}); }, TICK_MS);
  if (timer.unref) timer.unref();
}

export default {
  startCampaignRunner, runCampaign, runDueCampaigns, claimCampaign, campaignRun, newLease, sendError,
  retryableSend, outcomeUnknown, dripSteps, DUP_WINDOW_MS,
};
