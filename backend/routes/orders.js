import express from 'express';
import { requireBusiness } from '../middleware/auth.js';
import Order from '../models/Order.js';
import Flow from '../models/Flow.js';
import { getClientForBusiness } from '../services/metaCloud.js';
import { runOrderStatusTrigger } from '../services/templateTriggers.js';
import { renderPdfBuffer } from '../services/pdfDoc.js';
import { orderTokens } from '../services/flowRuntime.js';
import logger from '../services/logger.js';

const router = express.Router();
router.use(requireBusiness);

/** Tenant filter — an order is only ever reachable by the business that owns it. */
const owner = (req) => ({ businessId: req.business._id });

const STATUSES = ['pending', 'confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled'];

router.get('/', async (req, res) => {
  const data = await Order.find(owner(req)).sort({ createdAt: -1 }).limit(200).lean();
  res.json({ success: true, data });
});

/**
 * Render this order's confirmation document as a PDF, inline.
 *
 * Reuses the appointment-confirmation PDF the tenant designed in a flow (the
 * first non-cancellation `pdfdoc` block), filled with this order's own values,
 * so the slip the customer received can be previewed/downloaded from the CRM.
 * Streamed as a buffer rather than hosted, so viewing a details page doesn't
 * litter storage with one-off files.
 */
router.get('/:id/pdf', async (req, res) => {
  try {
    const order = await Order.findOne({ _id: req.params.id, ...owner(req) }).lean();
    if (!order) return res.status(404).json({ success: false, message: 'Not found' });

    const flows = await Flow.find({ businessId: req.business._id }).select('blocks').lean();
    let block = null;
    for (const f of flows) {
      const b = (f.blocks || []).find(
        (x) => x.kind === 'pdfdoc'
          && x.pdfTemplate && Array.isArray(x.pdfTemplate.elements) && x.pdfTemplate.elements.length
          && !/cancel/i.test(x.pdfFileName || ''),
      );
      if (b) { block = b; break; }
    }
    if (!block) {
      return res.status(404).json({ success: false, message: 'No confirmation document is designed in any flow yet.' });
    }

    const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'numeric', year: 'numeric' });
    const tokens = { ...orderTokens(order), today, business_name: req.business.name || '' };
    const buffer = await renderPdfBuffer(block.pdfTemplate, tokens);
    const name = `${order.reference || 'document'}`.replace(/[^\w.-]+/g, '-');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${name}.pdf"`);
    return res.send(buffer);
  } catch (err) {
    logger.error('order pdf render failed', { error: err.message });
    return res.status(500).json({ success: false, message: 'Could not render the document.' });
  }
});

router.post('/:id/status', async (req, res) => {
  const status = req.body?.status;
  if (!STATUSES.includes(status)) return res.status(400).json({ success: false, message: 'invalid status' });
  const scope = { _id: req.params.id, ...owner(req) };
  const before = await Order.findOne(scope).select('status').lean();
  const order = await Order.findOneAndUpdate(scope, { $set: { status } }, { new: true });
  if (!order) return res.status(404).json({ success: false, message: 'Not found' });

  // Tell the customer, if a template is waiting on this status. Only on an
  // actual change — re-selecting the current status in the dropdown shouldn't
  // message them again.
  let notified = 0;
  if (before?.status !== status) {
    try {
      notified = await runOrderStatusTrigger(
        getClientForBusiness(req.business),
        req.business,
        order.toObject(),
      );
    } catch (err) {
      logger.error('order status trigger failed', { order: order.reference, error: err.message });
    }
  }
  res.json({ success: true, data: order, notified });
});

export default router;
