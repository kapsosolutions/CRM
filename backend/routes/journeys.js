import express from 'express';
import { requireBusiness } from '../middleware/auth.js';
import Journey from '../models/Journey.js';
import storage from '../services/storage.js';
import logger from '../services/logger.js';
import { channelJourneyProblems, journeyChannel } from '../services/channelJourney.js';

const router = express.Router();
router.use(requireBusiness);

/**
 * The fields a request may set. On create everything has a value; on update
 * only what was sent changes (so { draft } alone leaves the published journey
 * as it is). The channel is fixed when the journey is created. Only published
 * blocks are checked against Meta's limits: a draft may be unfinished.
 */
const pick = (b, { create = false } = {}) => {
  const out = {};
  if (create || typeof b.name === 'string') out.name = String(b.name || '').trim() || 'Untitled journey';
  if (create || Array.isArray(b.nodes)) out.nodes = Array.isArray(b.nodes) ? b.nodes : [];
  if (create || Array.isArray(b.edges)) out.edges = Array.isArray(b.edges) ? b.edges : [];
  if (typeof b.active === 'boolean') out.active = b.active;
  if (create) out.channel = journeyChannel(b.channel);
  // { draft: {...} } saves unpublished changes; { draft: null } drops them
  // (sent with a publish, or "Discard draft").
  if ('draft' in b) out.draft = cleanDraft(b.draft);
  return out;
};

function cleanDraft(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
  return {
    name: String(d.name || '').trim() || 'Untitled journey',
    nodes: Array.isArray(d.nodes) ? d.nodes : [],
    edges: Array.isArray(d.edges) ? d.edges : [],
    savedAt: new Date().toISOString(),
  };
}

/** Instagram / Messenger journeys must fit what Meta's Send API accepts. */
function invalid(res, channel, nodes) {
  const problems = channelJourneyProblems(channel, nodes);
  if (!problems.length) return false;
  res.status(400).json({
    success: false, code: 'JOURNEY_INVALID', message: problems[0].message, problems,
  });
  return true;
}

router.get('/', async (req, res) => {
  const data = await Journey.find({ businessId: req.business._id }).sort({ updatedAt: -1 }).lean();
  res.json({ success: true, data: data.map((j) => ({ ...j, channel: journeyChannel(j.channel) || 'whatsapp' })) });
});

router.post('/', async (req, res) => {
  const body = pick(req.body || {}, { create: true });
  if (invalid(res, body.channel, body.nodes)) return undefined;
  const j = await Journey.create({ ...body, businessId: req.business._id });
  return res.status(201).json({ success: true, data: { ...j.toObject(), channel: body.channel || 'whatsapp' } });
});

router.put('/:id', async (req, res) => {
  const before = await Journey.findOne({ _id: req.params.id, businessId: req.business._id }).lean();
  if (!before) return res.status(404).json({ success: false, message: 'Not found' });
  const set = pick(req.body || {});
  if (set.nodes && invalid(res, journeyChannel(before.channel), set.nodes)) return undefined;
  const j = await Journey.findOneAndUpdate(
    { _id: req.params.id, businessId: req.business._id },
    { $set: set },
    { new: true },
  );
  if (!j) return res.status(404).json({ success: false, message: 'Not found' });

  // Media the journey no longer references (replaced/removed blocks) is orphaned.
  const after = storage.collectCdnUrls(j.toObject());
  const dropped = [...storage.collectCdnUrls(before)].filter((u) => !after.has(u));
  if (dropped.length) {
    storage.deleteMany(dropped)
      .then((n) => logger.info('journey media cleaned', { journey: String(j._id), removed: n }))
      .catch(() => {});
  }
  return res.json({ success: true, data: { ...j.toObject(), channel: journeyChannel(j.channel) || 'whatsapp' } });
});

router.delete('/:id', async (req, res) => {
  const j = await Journey.findOne({ _id: req.params.id, businessId: req.business._id }).lean();
  await Journey.deleteOne({ _id: req.params.id, businessId: req.business._id });
  if (j) {
    const media = [...storage.collectCdnUrls(j)];
    if (media.length) storage.deleteMany(media).catch(() => {});
  }
  res.json({ success: true });
});

export default router;
