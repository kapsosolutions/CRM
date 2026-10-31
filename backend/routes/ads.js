// Ads: leads that reached this business through a Click-to-WhatsApp ad.
//
// When someone taps a Facebook / Instagram ad that opens WhatsApp, Meta adds a
// `referral` block (ad id, headline, image, ctwa_clid…) to their first
// message. The webhook already stores every inbound message's raw payload, so
// this needs no extra Meta permission — it reads what's there. (Spend, reach
// and campaign stats would need ads_read on a connected ad account.)
//
// /api/ads/meta/*: the connected Meta ad account (services/metaAds.js):
// connect / disconnect through Facebook Login for Business, account insights,
// campaigns → ad sets → ads, pause / resume (ads_management only), lead forms
// and their leads (with CSV). Every route is scoped to req.business; the ad
// and Page tokens never appear in a response.
//
// /api/ads/meta/create*, /meta/campaigns/:id/publish|review, /meta/drafts*:
// the Ads Manager "Create campaign" wizard (services/metaAdsCreate.js).
//
// /api/ads/meta/manage/*: Ads Manager S2, editing, duplicating, archiving /
// deleting, bulk actions, review state and previews of existing objects
// (services/metaAdsManage.js).
//
// /api/ads/meta/reports/*: Ads Manager S3, reports with breakdowns, column
// presets, previous-period comparison, CSV export, async report runs and the
// account health card (services/metaAdsReports.js).
//
// /api/ads/meta/audiences*: Ads Manager S4, custom audiences from CRM
// contacts (hashed on the server, uploaded in the background), lookalikes,
// saved audiences and the Custom Audience terms (services/metaAdsAudiences.js).
//
// /api/ads/meta/automation/*: Ads Manager S5, automated rules (Meta's Ad
// Rules Engine) with history, A/B tests (split tests) plus a CRM-side
// comparison, and pixels with their events and base code
// (services/metaAdsAutomation.js).
import express from 'express';
import Message from '../models/Message.js';
import { requireBusiness } from '../middleware/auth.js';
import {
  AdsError, adsStatus, startAdsLogin, connectAdAccount, disconnectAds, accountSummary, accountTimeSeries,
  listCampaigns, listAdSets, listAds, setStatus, listLeadForms, listLeads, leadsCsv, linkAdIds,
} from '../services/metaAds.js';
import {
  createOptions, pageDetails, pagePosts, targetingSearch, targetingBrowse, estimateAudience, previewCreative, uploadImage,
  beginVideoUpload, startVideoUpload, videoUploadStatus, sweepVideoTemp,
  videoStatus, mediaLibrary, createLeadForm, createCampaign, reviewStatus, publishCampaign, listDrafts, getDraft, saveDraft, deleteDraft,
} from '../services/metaAdsCreate.js';
import {
  getDetails, editObject, duplicateObject, removeObject, startBulk, bulkStatus, reviewRows, archivedRows, adPreview,
} from '../services/metaAdsManage.js';
import {
  insightsReport, reportRun, reportCsv, accountHealth, accountActivity,
} from '../services/metaAdsReports.js';
import {
  listAudiences, getAudience, contactsPreview, createFromContacts, refreshAudience, createLookalike, deleteAudience, getJob,
  listSavedAudiences, createSavedAudience, deleteSavedAudience,
} from '../services/metaAdsAudiences.js';
import {
  listRules, previewRule, createRule, updateRule, setRuleStatus, deleteRule, ruleHistory, listTests, getTest, createTest, compareObjects,
  listPixels, pixelDetails,
} from '../services/metaAdsAutomation.js';
import { uploadAdImage, uploadAdVideo, AD_IMAGE_MAX, AD_VIDEO_MAX } from '../middleware/upload.js';
import fs from 'fs';
import logger from '../services/logger.js';

const router = express.Router();
router.use(requireBusiness);

function fail(res, err, what) {
  if (err instanceof AdsError) {
    if (err.meta) logger.warn(`${what} refused by Meta`, { code: err.code, metaCode: err.meta.code, error: err.meta.message });
    if (err.status === 429) res.set('Retry-After', '120');
    return res.status(err.status).json(err.toJSON());
  }
  logger.error(`${what} failed`, { error: err.message });
  return res.status(500).json({ success: false, code: 'ADS_FAILED', message: 'Something went wrong. Please try again.' });
}

/** Wrap an async handler with the ads error answer. */
const handle = (what, fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    fail(res, err, what);
  }
};

router.get('/meta', handle('ads status', async (req, res) => {
  res.json({ success: true, ...(await adsStatus(req.business._id)) });
}));

// { code } from FB.login → { sessionId, accounts, pages, canManage }
router.post('/meta/login', handle('Meta ads login', async (req, res) => {
  res.json({ success: true, ...(await startAdsLogin(req.business, req.body?.code)) });
}));

// { sessionId, adAccountId, pageId? }
router.post('/meta/connect', handle('Meta ads connect', async (req, res) => {
  const b = req.body || {};
  const connection = await connectAdAccount(req.business, { sessionId: b.sessionId, adAccountId: b.adAccountId, pageId: b.pageId });
  res.json({ success: true, connection });
}));

router.delete('/meta', handle('Meta ads disconnect', async (req, res) => {
  res.json({ success: true, ...(await disconnectAds(req.business)) });
}));

router.get('/meta/summary', handle('ads summary', async (req, res) => {
  res.json({ success: true, ...(await accountSummary(req.business._id, req.query)) });
}));

router.get('/meta/timeseries', handle('ads time series', async (req, res) => {
  res.json({ success: true, ...(await accountTimeSeries(req.business._id, req.query)) });
}));

router.get('/meta/campaigns', handle('ads campaigns', async (req, res) => {
  res.json({ success: true, ...(await listCampaigns(req.business._id, req.query)) });
}));

router.get('/meta/campaigns/:id/adsets', handle('ads ad sets', async (req, res) => {
  res.json({ success: true, ...(await listAdSets(req.business._id, String(req.params.id), req.query)) });
}));

router.get('/meta/adsets/:id/ads', handle('ads ads', async (req, res) => {
  res.json({ success: true, ...(await listAds(req.business._id, String(req.params.id), req.query)) });
}));

// { level: 'campaign' | 'adset' | 'ad', id, status: 'ACTIVE' | 'PAUSED' }
router.post('/meta/status', handle('ads status change', async (req, res) => {
  const b = req.body || {};
  res.json({ success: true, ...(await setStatus(req.business, { level: String(b.level || ''), id: String(b.id || ''), status: String(b.status || '') })) });
}));

router.get('/meta/leadforms', handle('lead forms', async (req, res) => {
  res.json({ success: true, ...(await listLeadForms(req.business._id, req.query)) });
}));

router.get('/meta/leadforms/:id/leads', handle('lead form leads', async (req, res) => {
  res.json({ success: true, ...(await listLeads(req.business._id, String(req.params.id), req.query)) });
}));

router.get('/meta/leadforms/:id/leads.csv', handle('lead form CSV', async (req, res) => {
  const { filename, csv } = await leadsCsv(req.business._id, String(req.params.id), req.query);
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${filename}"`);
  res.set('Cache-Control', 'no-store');
  res.send(csv);
}));

// ---- Ads Manager S1: "Create campaign" wizard (services/metaAdsCreate.js) ----
// Everything is created PAUSED; only POST /meta/campaigns/:id/publish with
// { confirm: true } sets ACTIVE. Writes answer 409 READ_ONLY without
// ads_management.

/** Multer errors (size, type) → the ads error answer. */
const withUpload = (mw, max, what) => (req, res, next) => mw(req, res, (err) => {
  if (!err) return next();
  const tooBig = err.code === 'LIMIT_FILE_SIZE';
  return fail(res, new AdsError(tooBig ? `That file is larger than ${Math.round(max / (1024 * 1024))} MB.` : err.message || 'That file can’t be used.', {
    status: tooBig ? 413 : 400, code: tooBig ? 'FILE_TOO_LARGE' : 'BAD_FILE',
  }), what);
});

router.get('/meta/create/options', handle('ads create options', async (req, res) => {
  res.json({ success: true, ...(await createOptions(req.business._id, req.query)) });
}));

router.get('/meta/create/pages/:id', handle('ads create Page', async (req, res) => {
  res.json({ success: true, ...(await pageDetails(req.business._id, String(req.params.id), req.query)) });
}));

// ?source=facebook|instagram&instagramId=…&refresh=1 → { source, pageId, posts: [{ id, source, text, picture, permalink, createdAt, mediaType, eligible, reason }] }
router.get('/meta/create/pages/:id/posts', handle('ads Page posts', async (req, res) => {
  res.json({ success: true, ...(await pagePosts(req.business._id, String(req.params.id), req.query)) });
}));

// ?type=geo|interest|locale&q=
router.get('/meta/create/search', handle('ads targeting search', async (req, res) => {
  res.json({ success: true, ...(await targetingSearch(req.business._id, req.query)) });
}));

// ?class=interests|behaviors|demographics
router.get('/meta/create/browse', handle('ads targeting browse', async (req, res) => {
  res.json({ success: true, ...(await targetingBrowse(req.business._id, req.query)) });
}));

router.post('/meta/create/estimate', handle('ads audience estimate', async (req, res) => {
  res.json({ success: true, ...(await estimateAudience(req.business._id, req.body || {})) });
}));

// { spec, format: facebook_feed | instagram_feed | instagram_story | reels }
router.post('/meta/create/preview', handle('ads preview', async (req, res) => {
  const b = req.body || {};
  res.json({ success: true, ...(await previewCreative(req.business._id, { spec: b.spec, format: b.format })) });
}));

// multipart 'file' (JPG/PNG/GIF, 8 MB)
router.post('/meta/create/images', withUpload(uploadAdImage.single('file'), AD_IMAGE_MAX, 'ad image upload'), handle('ad image upload', async (req, res) => {
  res.json({ success: true, image: await uploadImage(req.business._id, req.file) });
}));

/**
 * Before multer writes a byte of an ad video: stale temp files are swept,
 * then the Graph version, the connection and ads_management are checked and
 * an upload slot is taken (one per business, a server-wide cap). A refused
 * request is drained without touching the disk. When the request ends
 * without handing the file to the background job (refused file, aborted
 * upload, an error), the slot is released and the temp file deleted.
 */
const videoGate = async (req, res, next) => {
  try {
    await sweepVideoTemp().catch(() => 0);
    const ticket = await beginVideoUpload(req.business._id);
    req.adsVideoTicket = ticket;
    res.on('close', () => {
      if (ticket.handedOff) return;
      ticket.release();
      if (req.file?.path) fs.promises.unlink(req.file.path).catch(() => {});
    });
    next();
  } catch (err) {
    req.resume();
    fail(res, err, 'ad video upload');
  }
};

// multipart 'file' (MP4/MOV, 250 MB) → 202 { upload: { id, status: 'uploading' } };
// poll GET /meta/create/videos/uploads/:id for Meta's video id, then GET /meta/create/videos/:id until ready.
router.post('/meta/create/videos', videoGate, withUpload(uploadAdVideo.single('file'), AD_VIDEO_MAX, 'ad video upload'), handle('ad video upload', async (req, res) => {
  res.status(202).json({ success: true, upload: await startVideoUpload(req.adsVideoTicket, req.file) });
}));

router.get('/meta/create/videos/uploads/:id', handle('ad video upload status', async (req, res) => {
  res.json({ success: true, upload: await videoUploadStatus(req.business._id, String(req.params.id)) });
}));

router.get('/meta/create/videos/:id', handle('ad video status', async (req, res) => {
  res.json({ success: true, video: await videoStatus(req.business._id, String(req.params.id)) });
}));

// ?type=image|video
router.get('/meta/create/library', handle('ad media library', async (req, res) => {
  res.json({ success: true, ...(await mediaLibrary(req.business._id, req.query)) });
}));

router.post('/meta/create/leadforms', handle('lead form create', async (req, res) => {
  res.json({ success: true, form: await createLeadForm(req.business._id, req.body || {}) });
}));

// { spec, draftId?, requestId? } → campaign + ad set + creative + ad, all PAUSED
// (409 IN_PROGRESS while another create runs; the same requestId replays the first answer)
router.post('/meta/create', handle('ads campaign create', async (req, res) => {
  const b = req.body || {};
  res.json({ success: true, ...(await createCampaign(req.business, { spec: b.spec, draftId: b.draftId, requestId: b.requestId })) });
}));

router.get('/meta/campaigns/:id/review', handle('ads campaign review', async (req, res) => {
  res.json({ success: true, ...(await reviewStatus(req.business._id, String(req.params.id))) });
}));

// { confirm: true, adsetId, adId, requestId? } → that ad, that ad set, then the campaign ACTIVE
router.post('/meta/campaigns/:id/publish', handle('ads campaign publish', async (req, res) => {
  const b = req.body || {};
  res.json({ success: true, ...(await publishCampaign(req.business, String(req.params.id), { confirm: b.confirm, adsetId: b.adsetId, adId: b.adId, requestId: b.requestId })) });
}));

router.get('/meta/drafts', handle('ad drafts', async (req, res) => {
  res.json({ success: true, ...(await listDrafts(req.business._id)) });
}));

router.get('/meta/drafts/:id', handle('ad draft', async (req, res) => {
  res.json({ success: true, ...(await getDraft(req.business._id, String(req.params.id))) });
}));

// { step, spec }
router.post('/meta/drafts', handle('ad draft save', async (req, res) => {
  const b = req.body || {};
  res.json({ success: true, ...(await saveDraft(req.business._id, { step: b.step, spec: b.spec })) });
}));

router.put('/meta/drafts/:id', handle('ad draft save', async (req, res) => {
  const b = req.body || {};
  res.json({ success: true, ...(await saveDraft(req.business._id, { id: String(req.params.id), step: b.step, spec: b.spec })) });
}));

router.delete('/meta/drafts/:id', handle('ad draft delete', async (req, res) => {
  res.json({ success: true, ...(await deleteDraft(req.business._id, String(req.params.id))) });
}));

// ---- Ads Manager S2: manage existing campaigns, ad sets and ads (services/metaAdsManage.js) ----
// Edits never send a status; duplicates are always PAUSED; archive, delete,
// bulk resume and bulk archive need { confirm: true }. Writes answer 409
// READ_ONLY without ads_management, ids from another ad account 404
// NOT_IN_ACCOUNT.

// ?level=campaign|adset|ad&parentId=&refresh=1 → review state per row (+ notifies new rejections)
router.get('/meta/manage/review', handle('ads review state', async (req, res) => {
  res.json({ success: true, ...(await reviewRows(req.business._id, req.query)) });
}));

// ?level=&parentId= → archived rows (Meta's default lists leave them out)
router.get('/meta/manage/archived', handle('ads archived rows', async (req, res) => {
  res.json({ success: true, ...(await archivedRows(req.business._id, req.query)) });
}));

// { action: pause|resume|duplicate|archive, level, ids[], confirm?, key } → 202 { job } (background; the same key → the same job)
router.post('/meta/manage/bulk', handle('ads bulk action', async (req, res) => {
  res.status(202).json({ success: true, ...(await startBulk(req.business, req.body || {})) });
}));

// → { job: { status: running|done|failed, processed, total, results, done, failed, stopped, error } }
router.get('/meta/manage/bulk/:id', handle('ads bulk action status', async (req, res) => {
  res.json({ success: true, ...(await bulkStatus(req.business._id, String(req.params.id))) });
}));

// ?format=facebook_feed|instagram_feed|instagram_story|reels
router.get('/meta/manage/ad/:id/preview', handle('ad preview', async (req, res) => {
  res.json({ success: true, ...(await adPreview(req.business._id, String(req.params.id), req.query)) });
}));

router.get('/meta/manage/:level/:id', handle('ads object details', async (req, res) => {
  res.json({ success: true, ...(await getDetails(req.business._id, String(req.params.level), String(req.params.id))) });
}));

router.patch('/meta/manage/:level/:id', handle('ads object edit', async (req, res) => {
  res.json({ success: true, ...(await editObject(req.business, String(req.params.level), String(req.params.id), req.body || {})) });
}));

router.post('/meta/manage/:level/:id/duplicate', handle('ads object duplicate', async (req, res) => {
  res.json({ success: true, ...(await duplicateObject(req.business, String(req.params.level), String(req.params.id))) });
}));

// { confirm: true }
router.post('/meta/manage/:level/:id/archive', handle('ads object archive', async (req, res) => {
  res.json({ success: true, ...(await removeObject(req.business, String(req.params.level), String(req.params.id), { action: 'archive', confirm: req.body?.confirm })) });
}));

// { confirm: true }
router.post('/meta/manage/:level/:id/delete', handle('ads object delete', async (req, res) => {
  res.json({ success: true, ...(await removeObject(req.business, String(req.params.level), String(req.params.id), { action: 'delete', confirm: req.body?.confirm })) });
}));

// ---- Ads Manager S3: reports (services/metaAdsReports.js) ----
// Reads only (ads_read). Level, breakdown and columns are allow-listed on the
// server; parentId must be in the connected ad account. Large reports answer
// { mode: 'async', run } and the browser polls /meta/reports/runs/:id.

// ?level=account|campaign|adset|ad&breakdown=&columns=a,b&parentId=&compare=1&mode=auto|sync|async&preset|since|until&refresh=1
router.get('/meta/reports/insights', handle('ads report', async (req, res) => {
  res.json({ success: true, ...(await insightsReport(req.business._id, req.query)) });
}));

// the same query as a CSV file (built here, formula-safe)
router.get('/meta/reports/insights.csv', handle('ads report CSV', async (req, res) => {
  const { filename, csv } = await reportCsv(req.business._id, req.query);
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${filename}"`);
  res.set('Cache-Control', 'no-store');
  res.send(csv);
}));

router.get('/meta/reports/runs/:id', handle('ads report run', async (req, res) => {
  res.json({ success: true, ...(await reportRun(req.business._id, String(req.params.id))) });
}));

// ?refresh=1 → { health }: spend, spend cap, balance, status, payment method
router.get('/meta/reports/health', handle('ads account health', async (req, res) => {
  res.json({ success: true, ...(await accountHealth(req.business._id, req.query)) });
}));

// ?preset…&category=all|budget|status|targeting|schedule|creative|created|billing|other&refresh=1
// → { range, category, events: [{ time, date, type, category, label, objectName, objectType }] }
router.get('/meta/reports/activity', handle('ads activity history', async (req, res) => {
  res.json({ success: true, ...(await accountActivity(req.business._id, req.query)) });
}));

// ---- Ads Manager S4: audiences (services/metaAdsAudiences.js) ----
// Phones are normalised and SHA-256 hashed on the server; no number (raw or
// hashed) is ever in a response. Uploads run in the background: create /
// refresh answer at once with a job the browser polls. Writes answer 409
// READ_ONLY without ads_management, ids from another ad account 404
// NOT_IN_ACCOUNT, and 409 TERMS_NOT_ACCEPTED (+ termsUrl) until the
// Custom Audience terms are accepted at Meta.

// ?refresh=1 → { canManage, terms, audiences, jobs, limits }
router.get('/meta/audiences', handle('ads audiences', async (req, res) => {
  res.json({ success: true, ...(await listAudiences(req.business._id, req.query)) });
}));

// ?filter=all|contacted|inbound&days= → { count, skipped, batches } (counts only)
router.get('/meta/audiences/contacts', handle('ads audience contacts', async (req, res) => {
  res.json({ success: true, ...(await contactsPreview(req.business._id, req.query)) });
}));

router.get('/meta/audiences/saved', handle('ads saved audiences', async (req, res) => {
  res.json({ success: true, ...(await listSavedAudiences(req.business._id, req.query)) });
}));

// { name, description?, audience }
router.post('/meta/audiences/saved', handle('ads saved audience create', async (req, res) => {
  res.json({ success: true, ...(await createSavedAudience(req.business, req.body || {})) });
}));

router.delete('/meta/audiences/saved/:id', handle('ads saved audience delete', async (req, res) => {
  res.json({ success: true, ...(await deleteSavedAudience(req.business, String(req.params.id))) });
}));

router.get('/meta/audiences/jobs/:id', handle('ads audience upload', async (req, res) => {
  res.json({ success: true, ...(await getJob(req.business._id, String(req.params.id))) });
}));

// { name, description?, filter: all|contacted|inbound, days? } → { audience, job }
router.post('/meta/audiences', handle('ads audience create', async (req, res) => {
  res.json({ success: true, ...(await createFromContacts(req.business, req.body || {})) });
}));

// { name, originId, countries[], ratio: 1–10 } → { audience }
router.post('/meta/audiences/lookalike', handle('ads lookalike create', async (req, res) => {
  res.json({ success: true, ...(await createLookalike(req.business, req.body || {})) });
}));

router.get('/meta/audiences/:id', handle('ads audience', async (req, res) => {
  res.json({ success: true, ...(await getAudience(req.business._id, String(req.params.id))) });
}));

// { filter?, days? } → { audience, job } (replaces the people with the current contacts)
router.post('/meta/audiences/:id/refresh', handle('ads audience refresh', async (req, res) => {
  res.json({ success: true, ...(await refreshAudience(req.business, String(req.params.id), req.body || {})) });
}));

// { confirm: true }
router.post('/meta/audiences/:id/delete', handle('ads audience delete', async (req, res) => {
  res.json({ success: true, ...(await deleteAudience(req.business, String(req.params.id), { confirm: req.body?.confirm })) });
}));

// ---- Ads Manager S5: automation, A/B tests, pixels (services/metaAdsAutomation.js) ----
// Rules are built on the server from validated fields and created DISABLED
// unless { enabled: true, confirm: true }. Turning a rule on, editing an
// enabled rule, deleting a rule and creating an A/B test need
// { confirm: true } (400 CONFIRM_REQUIRED + summary otherwise). Writes answer
// 409 READ_ONLY without ads_management; ids from another ad account 404
// NOT_IN_ACCOUNT. Nothing here sets a campaign, ad set or ad status.

// ?refresh=1 → { canManage, account, rules, templates, options, mirror }
router.get('/meta/automation/rules', handle('ads rules', async (req, res) => {
  res.json({ success: true, ...(await listRules(req.business._id, req.query)) });
}));

// { spec } → { spec, template, summary, summaryHash, payload } (nothing is written)
router.post('/meta/automation/rules/preview', handle('ads rule preview', async (req, res) => {
  res.json({ success: true, ...(await previewRule(req.business._id, { spec: req.body?.spec })) });
}));

// { spec, enabled?, confirm?, summaryHash? } → { rule, summary, summaryHash } (confirm: true needs the preview's summaryHash; 409 SUMMARY_STALE otherwise)
router.post('/meta/automation/rules', handle('ads rule create', async (req, res) => {
  const b = req.body || {};
  res.json({ success: true, ...(await createRule(req.business, { spec: b.spec, enabled: b.enabled, confirm: b.confirm, summaryHash: b.summaryHash })) });
}));

// { spec, confirm?, summaryHash? } → { rule, summary, summaryHash }
router.put('/meta/automation/rules/:id', handle('ads rule edit', async (req, res) => {
  const b = req.body || {};
  res.json({ success: true, ...(await updateRule(req.business, String(req.params.id), { spec: b.spec, confirm: b.confirm, summaryHash: b.summaryHash })) });
}));

// { status: ENABLED|DISABLED, confirm?, summaryHash? } (ENABLED: confirm + the rule's summaryHash; outside rules only when they pause or notify)
router.post('/meta/automation/rules/:id/status', handle('ads rule status', async (req, res) => {
  const b = req.body || {};
  res.json({ success: true, ...(await setRuleStatus(req.business, String(req.params.id), { status: b.status, confirm: b.confirm, summaryHash: b.summaryHash })) });
}));

// { confirm: true }
router.post('/meta/automation/rules/:id/delete', handle('ads rule delete', async (req, res) => {
  res.json({ success: true, ...(await deleteRule(req.business, String(req.params.id), { confirm: req.body?.confirm })) });
}));

router.get('/meta/automation/rules/:id/history', handle('ads rule history', async (req, res) => {
  res.json({ success: true, ...(await ruleHistory(req.business._id, String(req.params.id))) });
}));

// ?refresh=1 → { canManage, business, metaAvailable, note, tests, timezone, options }
router.get('/meta/automation/tests', handle('ads A/B tests', async (req, res) => {
  res.json({ success: true, ...(await listTests(req.business._id, req.query)) });
}));

// { name, description?, level, ids[2–5], variable, metric, confidence, start, end, confirm: true } → { test, summary }
router.post('/meta/automation/tests', handle('ads A/B test create', async (req, res) => {
  res.json({ success: true, ...(await createTest(req.business, req.body || {})) });
}));

router.get('/meta/automation/tests/:id', handle('ads A/B test', async (req, res) => {
  res.json({ success: true, ...(await getTest(req.business._id, String(req.params.id))) });
}));

// ?level=campaign|adset&ids=a,b&metric=&confidence=&preset|since|until&refresh=1 → the CRM comparison
router.get('/meta/automation/compare', handle('ads comparison', async (req, res) => {
  res.json({ success: true, ...(await compareObjects(req.business._id, req.query)) });
}));

// ?refresh=1 → { pixels, customConversions, customConversionsAvailable, events }
router.get('/meta/automation/pixels', handle('ads pixels', async (req, res) => {
  res.json({ success: true, ...(await listPixels(req.business._id, req.query)) });
}));

// ?range=24h|7d → { pixel, stats, note, snippet, eventSnippets, customConversions, eventsManagerUrl }
router.get('/meta/automation/pixels/:id', handle('ads pixel', async (req, res) => {
  res.json({ success: true, ...(await pixelDetails(req.business._id, String(req.params.id), req.query)) });
}));

// Meta's free-entry-point window: replies within 72 hours of the ad message
// aren't charged.
const FREE_WINDOW_MS = 72 * 60 * 60 * 1000;

const referralOf = (m) => m.raw?.referral || m.raw?.meta?.referral || null;

router.get('/leads', async (req, res) => {
  const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await Message.find({
    businessId: req.business._id,
    direction: 'in',
    createdAt: { $gte: since },
    $or: [{ 'raw.referral': { $exists: true } }, { 'raw.meta.referral': { $exists: true } }],
  })
    .sort({ createdAt: -1 })
    .limit(2000)
    .select('phone name body raw createdAt')
    .lean();

  const ads = new Map();
  const leads = new Map(); // one row per person: their most recent ad message
  for (const m of rows) {
    const r = referralOf(m);
    if (!r) continue;
    const key = String(r.source_id || r.source_url || r.headline || 'unknown');
    const ad = ads.get(key) || {
      id: key,
      sourceType: r.source_type || 'ad',
      headline: r.headline || '',
      body: r.body || '',
      url: r.source_url || '',
      image: r.image_url || r.thumbnail_url || '',
      mediaType: r.media_type || '',
      phones: new Set(),
      messages: 0,
      lastAt: m.createdAt,
    };
    ad.phones.add(m.phone);
    ad.messages += 1;
    ads.set(key, ad);
    if (!leads.has(m.phone)) {
      const at = new Date(m.createdAt).getTime();
      leads.set(m.phone, {
        phone: m.phone,
        name: m.name || '',
        firstMessage: String(m.body || '').slice(0, 140),
        at: m.createdAt,
        adId: key,
        adHeadline: r.headline || '',
        sourceType: r.source_type || 'ad',
        freeWindowEndsAt: new Date(at + FREE_WINDOW_MS),
      });
    }
  }

  const now = Date.now();
  const leadList = [...leads.values()];
  // With an ad account connected, ad ids that belong to it get their ad,
  // ad set and campaign names (best effort; {} otherwise).
  const links = await linkAdIds(req.business._id, [...ads.keys()]);
  res.json({
    success: true,
    days,
    summary: {
      leads: leadList.length,
      ads: ads.size,
      inFreeWindow: leadList.filter((l) => new Date(l.freeWindowEndsAt).getTime() > now).length,
    },
    ads: [...ads.values()]
      .map(({ phones, ...a }) => ({ ...a, leads: phones.size }))
      .sort((a, b) => b.leads - a.leads),
    leads: leadList.slice(0, 200),
    links,
  });
});

export default router;
