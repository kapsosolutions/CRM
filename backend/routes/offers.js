import express from 'express';
import { requireBusiness } from '../middleware/auth.js';
import Offer from '../models/Offer.js';
import catalog from '../services/catalog.js';
import { productIdsOf } from '../services/offers.js';
import logger from '../services/logger.js';

const router = express.Router();
router.use(requireBusiness);

/** Tenant filter — an offer is only reachable by the business that owns it. */
const owner = (req) => ({ businessId: req.business._id });

/**
 * Republish the products an offer change affects.
 *
 * An offer is only a discount if Meta knows about it: the catalog carries it as
 * `sale_price`, which is what draws the struck-through original in WhatsApp. So
 * every create / edit / toggle / delete has to re-push the products involved —
 * including ones the offer no longer covers, so a finished discount is cleared
 * rather than left on the catalog.
 *
 * Awaited and returned, like the product routes: a silent failure here would
 * mean the CRM shows an offer the customer can't see.
 */
async function republish(req, ...offers) {
  const ids = offers.flatMap((o) => productIdsOf(o));
  if (!ids.length) return undefined;
  try {
    return await catalog.syncProducts(ids, req.business);
  } catch (err) {
    logger.error('offer republish failed', { error: err.message });
    return { pushed: 0, failed: ids.length, total: ids.length, error: err.message };
  }
}

// Final price after a discount, clamped at ₹0 and rounded to whole rupees.
function computeOfferPrice(original, type, value) {
  const off = type === 'flat' ? Number(value) || 0 : ((Number(original) || 0) * (Number(value) || 0)) / 100;
  return Math.max(0, Math.round((Number(original) || 0) - off));
}

// Normalise incoming items into the stored shape (recomputing offer prices
// server-side so the client can't send an inconsistent price). The frontend
// sends `productId`; the model stores it as `product`.
function buildItems(items) {
  return (Array.isArray(items) ? items : []).map((it) => ({
    product: it.productId || it.product || undefined,
    productName: it.productName || '',
    productImageUrl: it.productImageUrl || '',
    variantIndex: Number(it.variantIndex) || 0,
    // Absent means "the whole size", so it must land on -1 rather than 0 —
    // 0 would silently narrow the offer to the first sub-variant.
    subIndex: it.subIndex === undefined || it.subIndex === null || it.subIndex === ''
      ? -1
      : Number(it.subIndex),
    subLabel: it.subLabel || '',
    label: it.label || '',
    originalPrice: Number(it.originalPrice) || 0,
    discountType: it.discountType === 'flat' ? 'flat' : 'percent',
    discountValue: Number(it.discountValue) || 0,
    offerPrice: computeOfferPrice(it.originalPrice, it.discountType, it.discountValue),
  }));
}

// Map a stored offer doc to the API shape the frontend expects
// (item.product -> item.productId).
function serialize(o) {
  if (!o) return o;
  const obj = typeof o.toObject === 'function' ? o.toObject() : o;
  return {
    ...obj,
    items: (obj.items || []).map((it) => {
      const { product, ...rest } = it;
      return { ...rest, productId: product ? String(product) : '' };
    }),
  };
}

router.get('/', async (req, res) => {
  const data = await Offer.find(owner(req)).sort({ createdAt: -1 }).lean();
  res.json({ success: true, data: data.map(serialize) });
});

router.post('/', async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.title?.trim()) return res.status(400).json({ success: false, message: 'title required' });
    const offer = await Offer.create({
      businessId: req.business._id,
      title: b.title.trim(),
      active: b.active !== false,
      items: buildItems(b.items),
    });
    const sync = await republish(req, offer);
    res.status(201).json({ success: true, data: serialize(offer), sync });
  } catch (err) {
    logger.error('create offer failed', { error: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const b = req.body || {};
    const update = {
      title: b.title?.trim(),
      active: b.active !== false,
      items: buildItems(b.items),
    };
    // Kept so a product removed from the offer gets its sale price cleared.
    const before = await Offer.findOne({ _id: req.params.id, ...owner(req) }).lean();
    const offer = await Offer.findOneAndUpdate(
      { _id: req.params.id, ...owner(req) },
      { $set: update },
      { new: true },
    );
    if (!offer) return res.status(404).json({ success: false, message: 'Not found' });
    const sync = await republish(req, before, offer);
    res.json({ success: true, data: serialize(offer), sync });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/:id/active', async (req, res) => {
  const offer = await Offer.findOneAndUpdate(
    { _id: req.params.id, ...owner(req) },
    { $set: { active: !!req.body?.active } },
    { new: true },
  );
  if (!offer) return res.status(404).json({ success: false, message: 'Not found' });
  // Switching off has to reach Meta too, or the discount keeps showing.
  const sync = await republish(req, offer);
  res.json({ success: true, data: serialize(offer), sync });
});

router.delete('/:id', async (req, res) => {
  const before = await Offer.findOne({ _id: req.params.id, ...owner(req) }).lean();
  if (before) await Offer.deleteOne({ _id: req.params.id, ...owner(req) });
  const sync = await republish(req, before);
  res.json({ success: true, sync });
});

export default router;
