// ---------------------------------------------------------------------------
// Offers → the discounted price a product is actually selling at.
//
// An offer targets individual product sizes, each with its own discount, and
// stores the computed `offerPrice`. Meta's catalog expresses a discount as
// `sale_price` alongside the regular `price`, which is what renders the struck
// -through original in WhatsApp — so this module answers one question for the
// catalog sync: for this product, what is each variant's offer price right now?
//
// Deliberately dependency-light (Offer only) so services/catalog.js can import
// it without the two ending up in a cycle.
// ---------------------------------------------------------------------------
import Offer from '../models/Offer.js';
import logger from './logger.js';

/**
 * Is this offer running right now?
 *
 * The create/update routes don't currently write `startsAt`/`endsAt`, so in
 * practice this is the `active` flag — but the window is honoured so a
 * scheduled offer behaves correctly the moment the API starts setting it.
 */
export function isLive(offer, now = new Date()) {
  if (!offer || offer.active === false) return false;
  if (offer.startsAt && new Date(offer.startsAt) > now) return false;
  if (offer.endsAt && new Date(offer.endsAt) < now) return false;
  return true;
}

/** The distinct products an offer touches, for deciding what to re-sync. */
export function productIdsOf(offer) {
  return [...new Set((offer?.items || []).map((it) => String(it.product || '')).filter(Boolean))];
}

/**
 * The key an offer item prices, as read by services/catalog.js:
 *   "1"    → the whole of variant 1, every sub-variant
 *   "1:0"  → variant 1, sub-variant 0 only
 */
export const priceKey = (variantIndex, subIndex) =>
  (Number(subIndex) >= 0 ? `${variantIndex}:${subIndex}` : String(variantIndex));

/**
 * Offer prices for one product, keyed by `priceKey`.
 *
 * Both granularities can be present: a business can discount a whole size, or
 * one flavour of it, or both. A product with no variants uses index 0, matching
 * what the offer editor stores. When two live offers cover the same item the
 * cheaper one wins — the customer should never be quoted the worse of two
 * advertised prices.
 *
 * Not filtered by tenant: a product belongs to exactly one business, so any
 * offer referencing it is already that business's.
 */
export async function offerPricesForProduct(productId) {
  const out = new Map();
  if (!productId) return out;

  let offers = [];
  try {
    offers = await Offer.find({ 'items.product': productId, active: true })
      .select('active startsAt endsAt items')
      .lean();
  } catch (err) {
    logger.warn('could not read offers for product', { productId: String(productId), error: err.message });
    return out;
  }

  for (const offer of offers) {
    if (!isLive(offer)) continue;
    for (const it of offer.items || []) {
      if (String(it.product) !== String(productId)) continue;
      const price = Number(it.offerPrice);
      if (!(price > 0)) continue;
      const idx = Number(it.variantIndex) || 0;
      // An offer saved before sub-variants were targetable has no subIndex,
      // and means the whole size.
      const sub = it.subIndex === undefined || it.subIndex === null ? -1 : Number(it.subIndex);
      const key = priceKey(idx, sub);
      const best = out.get(key);
      if (best === undefined || price < best) out.set(key, price);
    }
  }
  return out;
}

export default { isLive, productIdsOf, offerPricesForProduct, priceKey };
