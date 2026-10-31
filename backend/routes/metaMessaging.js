// Templates → Messenger / Instagram, and the chat composer's "Quick messages"
// picker (services/metaMessaging.js):
//
//   GET    /utility-templates                 the business's Messenger utility templates
//   POST   /utility-templates                 create one on the connected Page
//   GET    /utility-templates/library?q=&language=   search Meta's template library
//   POST   /utility-templates/clone           copy a library template to the Page
//   POST   /utility-templates/refresh         re-read the statuses from Meta
//   DELETE /utility-templates/:id             delete (at Meta and here)
//   GET    /quick-messages?channel=           saved quick messages
//   POST   /quick-messages                    create
//   PUT    /quick-messages/:id                edit
//   POST   /quick-messages/:id/duplicate      copy
//   DELETE /quick-messages/:id                delete
//   POST   /send-quick    { phone, quickMessageId }           in a chat, inside 24 h
//   POST   /send-utility  { phone, templateId, params }       Messenger chat, any time
//   GET    /starters?channel=                 the CRM's starter quick messages
//   POST   /starters/use  { key, channel, name? }            save one as a quick message
//
// Every id is looked up together with the logged-in business; no token ever
// appears in a response.
import express from 'express';
import { requireBusiness } from '../middleware/auth.js';
import Conversation from '../models/Conversation.js';
import MetaTemplate from '../models/MetaTemplate.js';
import QuickMessage from '../models/QuickMessage.js';
import { ChannelError } from '../services/metaChannels.js';
import {
  LIMITS, UTILITY_LIMITS, UTILITY_LANGUAGES, META_CHANNELS, validateQuickMessage, presentQuickMessage,
  sendQuickMessage, createUtilityTemplate, searchLibrary, cloneLibraryTemplate, listUtilityTemplates,
  refreshUtilityTemplates, deleteUtilityTemplate, sendUtilityTemplate, presentTemplate,
} from '../services/metaMessaging.js';
import { touchOutbound } from '../services/conversationState.js';
import { QUICK_STARTERS, STARTER_CATEGORIES, presentStarter, starterByKey } from '../services/quickStarters.js';
import logger from '../services/logger.js';

const router = express.Router();
router.use(requireBusiness);

const owner = (req) => ({ businessId: req.business._id });
const digits = (s) => String(s || '').replace(/\D/g, '');
const validId = (id) => /^[a-f0-9]{24}$/i.test(String(id || ''));

function fail(res, err, what) {
  if (err instanceof ChannelError) {
    if (err.meta) logger.warn(`${what} refused by Meta`, { code: err.code, metaCode: err.meta.code, error: err.meta.message });
    return res.status(err.status).json(err.toJSON());
  }
  logger.error(`${what} failed`, { error: err.message });
  return res.status(500).json({ success: false, code: 'FAILED', message: 'Something went wrong. Please try again.' });
}
const notFound = (res, what = 'Not found') => res.status(404).json({ success: false, code: 'NOT_FOUND', message: what });

// ---------------- Limits (the builder's live validation uses the same numbers) ----------------
router.get('/limits', (_req, res) => {
  res.json({ success: true, quick: LIMITS, utility: UTILITY_LIMITS, languages: UTILITY_LANGUAGES });
});

// ---------------- Messenger utility templates ----------------
router.get('/utility-templates', async (req, res) => {
  try {
    const { pageId, rows } = await listUtilityTemplates(req.business._id);
    res.json({ success: true, pageId, data: rows });
  } catch (err) {
    fail(res, err, 'list utility templates');
  }
});

router.post('/utility-templates', async (req, res) => {
  try {
    res.status(201).json({ success: true, data: await createUtilityTemplate(req.business, req.body || {}) });
  } catch (err) {
    fail(res, err, 'create utility template');
  }
});

router.get('/utility-templates/library', async (req, res) => {
  try {
    const data = await searchLibrary(req.business, { q: String(req.query.q || ''), language: String(req.query.language || '') });
    res.json({ success: true, data });
  } catch (err) {
    fail(res, err, 'search template library');
  }
});

router.post('/utility-templates/clone', async (req, res) => {
  try {
    res.status(201).json({ success: true, data: await cloneLibraryTemplate(req.business, req.body || {}) });
  } catch (err) {
    fail(res, err, 'clone library template');
  }
});

router.post('/utility-templates/refresh', async (req, res) => {
  try {
    const r = await refreshUtilityTemplates(req.business);
    const { pageId, rows } = await listUtilityTemplates(req.business._id);
    res.json({ success: true, ...r, pageId, data: rows });
  } catch (err) {
    fail(res, err, 'refresh utility templates');
  }
});

// Change what fills each {{n}} (contact name or typed per send), local only.
router.patch('/utility-templates/:id/variables', async (req, res) => {
  try {
    if (!validId(req.params.id)) return notFound(res, 'Template not found');
    const t = await MetaTemplate.findOne({ _id: req.params.id, ...owner(req) }).lean();
    if (!t) return notFound(res, 'Template not found');
    const list = Array.isArray(req.body?.variables) ? req.body.variables : [];
    const variables = (t.variables || []).map((v) => {
      const n = list.find((x) => Number(x?.index) === Number(v.index)) || {};
      return {
        index: v.index,
        source: n.source === 'contact_name' ? 'contact_name' : n.source === 'text' ? 'text' : v.source,
        fallback: n.fallback !== undefined ? String(n.fallback).slice(0, 60) : v.fallback,
      };
    });
    await MetaTemplate.updateOne({ _id: t._id, ...owner(req) }, { $set: { variables } });
    res.json({ success: true, data: presentTemplate({ ...t, variables }, t.pageId) });
  } catch (err) {
    fail(res, err, 'update template variables');
  }
});

router.delete('/utility-templates/:id', async (req, res) => {
  try {
    if (!validId(req.params.id)) return notFound(res, 'Template not found');
    res.json({ success: true, ...(await deleteUtilityTemplate(req.business, req.params.id)) });
  } catch (err) {
    fail(res, err, 'delete utility template');
  }
});

// ---------------- Quick messages ----------------
router.get('/quick-messages', async (req, res) => {
  try {
    const channel = String(req.query.channel || '');
    const filter = { ...owner(req), ...(META_CHANNELS.includes(channel) ? { channels: channel } : {}) };
    const rows = await QuickMessage.find(filter).sort({ updatedAt: -1 }).limit(500).lean();
    res.json({ success: true, data: rows.map(presentQuickMessage) });
  } catch (err) {
    fail(res, err, 'list quick messages');
  }
});

router.post('/quick-messages', async (req, res) => {
  try {
    const v = validateQuickMessage(req.body || {});
    const doc = await QuickMessage.create({ ...owner(req), ...v });
    res.status(201).json({ success: true, data: presentQuickMessage(doc) });
  } catch (err) {
    fail(res, err, 'create quick message');
  }
});

router.put('/quick-messages/:id', async (req, res) => {
  try {
    if (!validId(req.params.id)) return notFound(res, 'Quick message not found');
    const v = validateQuickMessage(req.body || {});
    const r = await QuickMessage.updateOne({ _id: req.params.id, ...owner(req) }, { $set: v });
    if (!r.matchedCount) return notFound(res, 'Quick message not found');
    const doc = await QuickMessage.findOne({ _id: req.params.id, ...owner(req) }).lean();
    res.json({ success: true, data: presentQuickMessage(doc) });
  } catch (err) {
    fail(res, err, 'update quick message');
  }
});

router.post('/quick-messages/:id/duplicate', async (req, res) => {
  try {
    if (!validId(req.params.id)) return notFound(res, 'Quick message not found');
    const q = await QuickMessage.findOne({ _id: req.params.id, ...owner(req) }).lean();
    if (!q) return notFound(res, 'Quick message not found');
    const doc = await QuickMessage.create({
      ...owner(req),
      name: `${q.name} (copy)`.slice(0, 80),
      channels: q.channels,
      kind: q.kind,
      text: q.text,
      imageUrl: q.imageUrl,
      buttons: q.buttons,
      cards: q.cards,
      quickReplies: q.quickReplies,
    });
    res.status(201).json({ success: true, data: presentQuickMessage(doc) });
  } catch (err) {
    fail(res, err, 'duplicate quick message');
  }
});

router.delete('/quick-messages/:id', async (req, res) => {
  try {
    if (!validId(req.params.id)) return notFound(res, 'Quick message not found');
    const r = await QuickMessage.deleteOne({ _id: req.params.id, ...owner(req) });
    if (!r.deletedCount) return notFound(res, 'Quick message not found');
    res.json({ success: true });
  } catch (err) {
    fail(res, err, 'delete quick message');
  }
});

// ---------------- CRM starter quick messages (services/quickStarters.js) ----------------
// Built into the CRM, not Meta templates. "Use" saves one as a quick message.
router.get('/starters', (req, res) => {
  const channel = String(req.query.channel || '');
  const list = QUICK_STARTERS.filter((s) => !META_CHANNELS.includes(channel) || s.channels.includes(channel));
  res.json({ success: true, categories: STARTER_CATEGORIES, data: list.map(presentStarter) });
});

router.post('/starters/use', async (req, res) => {
  try {
    const b = req.body || {};
    const starter = starterByKey(b.key);
    const channel = String(b.channel || '');
    const problems = [];
    if (!starter) problems.push({ field: 'key', message: 'Pick one of the CRM starters.' });
    if (!META_CHANNELS.includes(channel)) problems.push({ field: 'channel', message: 'Choose Messenger or Instagram.' });
    else if (starter && !starter.channels.includes(channel)) problems.push({ field: 'channel', message: 'This starter isn’t available on that channel.' });
    if (problems.length) return res.status(400).json({ success: false, code: 'INVALID_INPUT', message: problems[0].message, problems });
    const name = String(b.name ?? '').trim().slice(0, 80) || starter.name;
    // The same checks as a quick message built by hand (both channels' limits).
    const v = validateQuickMessage({ ...starter, name, channels: [channel] });
    const doc = await QuickMessage.create({ ...owner(req), ...v });
    res.status(201).json({ success: true, starterKey: starter.key, data: presentQuickMessage(doc) });
  } catch (err) {
    fail(res, err, 'use starter quick message');
  }
});

// ---------------- Chat composer ----------------
async function chatOf(req, res) {
  const phone = digits(req.body?.phone);
  if (!phone) {
    res.status(400).json({ success: false, code: 'PHONE_REQUIRED', message: 'phone required' });
    return null;
  }
  const convo = await Conversation.findOne({ ...owner(req), phone }).lean();
  if (!convo || !META_CHANNELS.includes(convo.channel)) {
    res.status(409).json({ success: false, code: 'CHANNEL_UNSUPPORTED', message: 'Quick messages and utility templates are for Messenger and Instagram chats.' });
    return null;
  }
  return convo;
}

router.post('/send-quick', async (req, res) => {
  try {
    const convo = await chatOf(req, res);
    if (!convo) return undefined;
    const id = req.body?.quickMessageId;
    const qm = validId(id) ? await QuickMessage.findOne({ _id: id, ...owner(req) }).lean() : null;
    if (!qm) return notFound(res, 'Quick message not found');
    const r = await sendQuickMessage(req.business, convo, qm, { messagingType: 'RESPONSE' });
    await touchOutbound(convo.phone, r?.doc?.body || qm.name, req.business._id, { markRead: true }).catch(() => {});
    res.json({ success: true, messageId: r?.messageId || '' });
  } catch (err) {
    fail(res, err, 'send quick message');
  }
});

router.post('/send-utility', async (req, res) => {
  try {
    const convo = await chatOf(req, res);
    if (!convo) return undefined;
    const id = req.body?.templateId;
    const t = validId(id) ? await MetaTemplate.findOne({ _id: id, ...owner(req) }).lean() : null;
    if (!t) return notFound(res, 'Template not found');
    const r = await sendUtilityTemplate(req.business, convo, t, req.body?.params || {});
    await touchOutbound(convo.phone, r?.doc?.body || t.name, req.business._id, { markRead: true }).catch(() => {});
    res.json({ success: true, messageId: r?.messageId || '' });
  } catch (err) {
    fail(res, err, 'send utility template');
  }
});

export default router;
