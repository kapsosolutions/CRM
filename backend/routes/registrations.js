// Form submissions captured from native WhatsApp Flows (the "Register" block).
// Scoped to the logged-in tenant so one business never sees another's leads.
import express from 'express';
import { requireBusiness } from '../middleware/auth.js';
import Registration from '../models/Registration.js';
import Flow from '../models/Flow.js';
import { rowsForFields } from '../services/flowSubmission.js';
import { formOfSubmission, runFormStatusTrigger } from '../services/templateTriggers.js';
import { getClientForBusiness } from '../services/metaCloud.js';
import logger from '../services/logger.js';

const router = express.Router();
router.use(requireBusiness);

const STATUSES = ['new', 'contacted', 'confirmed', 'done', 'cancelled'];

/**
 * Tenant filter.
 *
 * This used to fall back to `{}` — an empty filter — whenever bizId(req) was
 * blank, on the reasoning that only the super admin lacks a tenant. An empty
 * filter matches every row, so any request that reached here without a
 * business id read every tenant's leads. requireBusiness now guarantees the id
 * exists, and the filter is unconditional.
 */
const scope = (req) => ({ businessId: req.business._id });

router.get('/', async (req, res) => {
  const data = await Registration.find(scope(req)).sort({ createdAt: -1 }).limit(300).lean();

  // Resolve each submission's answers into readable rows. Stored answers are
  // raw ("field_11": "opt_1"); only the flow definition knows the question was
  // "Choose one" and the option was "Order Food". Flows are fetched once each
  // and reused across submissions.
  const flows = new Map();
  const flowFor = async (id) => {
    if (!id) return null;
    if (!flows.has(id)) {
      flows.set(
        id,
        await Flow.findOne({ _id: id, ...scope(req) })
          .select('name screens businessId')
          .lean()
          .catch(() => null),
      );
    }
    return flows.get(id);
  };

  const enriched = [];
  for (const doc of data) {
    // eslint-disable-next-line no-await-in-loop
    const flow = await flowFor(doc.flowId);
    // eslint-disable-next-line no-await-in-loop
    enriched.push({ ...doc, rows: await rowsForFields(flow, doc.fields || {}) });
  }
  res.json({ success: true, data: enriched });
});

router.post('/:id/status', async (req, res) => {
  const status = req.body?.status;
  if (!STATUSES.includes(status)) {
    return res.status(400).json({ success: false, message: 'invalid status' });
  }
  const before = await Registration.findOne({ _id: req.params.id, ...scope(req) }).select('status').lean();
  const doc = await Registration.findOneAndUpdate(
    { _id: req.params.id, ...scope(req) },
    { $set: { status } },
    { new: true },
  );
  if (!doc) return res.status(404).json({ success: false, message: 'Not found' });
  // Tell the customer, if a template waits on this form's status. Only on an
  // actual change, like an order's status.
  let notified = 0;
  if (before?.status !== status) {
    try {
      const reg = doc.toObject ? doc.toObject() : doc;
      const flow = reg.flowId ? await Flow.findOne({ _id: reg.flowId, ...scope(req) }).select('screens').lean().catch(() => null) : null;
      const form = formOfSubmission(reg, flow);
      if (form) notified = await runFormStatusTrigger(getClientForBusiness(req.business), req.business, reg, form);
    } catch (err) {
      logger.error('form status trigger failed', { registration: String(doc._id), error: err.message });
    }
  }
  res.json({ success: true, data: doc, notified });
});

router.delete('/:id', async (req, res) => {
  await Registration.deleteOne({ _id: req.params.id, ...scope(req) });
  res.json({ success: true });
});

export default router;
