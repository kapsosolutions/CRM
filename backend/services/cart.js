// ---------------------------------------------------------------------------
// Inbound catalog cart → readable lines and money tokens.
//
// When a customer taps "Send" on their WhatsApp cart, Meta posts a message of
// type `order` carrying only retailer ids, quantities and unit prices:
//
//   { product_retailer_id: 'carrot__v1s0', quantity: 2, item_price: 300 }
//
// That's unusable in a message body, so we resolve each id back to the product
// (and the exact size / sub-variant it refers to) and price the cart up. The
// result is a set of {{tokens}} any block body can use — which is what lets the
// Payment type block show live Items / Delivery / Total payable figures instead
// of hard-coded numbers.
//
// Retailer ids are minted by services/catalog.js as:
//   <base>            no variants
//   <base>__v<i>      size i
//   <base>__v<i>s<j>  size i, sub-variant j
// ---------------------------------------------------------------------------
import Product from '../models/Product.js';
import { variantLabel, subVariantsOf } from './catalog.js';
import logger from './logger.js';

/** Money as WhatsApp should read it: ₹1,249 (no trailing .00 on whole rupees). */
export const rupees = (n) => {
  const v = Number(n) || 0;
  return `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
};

/** Split a catalog retailer id back into product + which variant it points at. */
export function splitRetailerId(id) {
  const m = String(id || '').match(/^(.*?)__v(\d+)(?:s(\d+))?$/);
  if (!m) return { base: String(id || ''), variant: -1, sub: -1 };
  return { base: m[1], variant: Number(m[2]), sub: m[3] === undefined ? -1 : Number(m[3]) };
}

// "Carrot - 1 kg - Mild" for a resolved item; falls back to the retailer id so
// a product deleted since the customer added it still shows something.
function describe(product, parsed, retailerId) {
  if (!product) return retailerId;
  const v = parsed.variant >= 0 ? (product.variants || [])[parsed.variant] : null;
  const size = v ? variantLabel(v) : '';
  const subs = v ? subVariantsOf(v) : [];
  const sub = parsed.sub >= 0 ? subs[parsed.sub] || '' : '';
  return [product.name, size, sub].filter(Boolean).join(' - ');
}

/**
 * What this line costs to deliver, from the catalog.
 *
 * "Free delivery" on the product wins outright. Otherwise the variant's own
 * charge is used if it has one, falling back to the product's charge — which is
 * the field businesses actually fill in on the product editor.
 */
function deliveryChargeOf(product, parsed) {
  if (!product || product.freeDelivery) return 0;
  const v = parsed.variant >= 0 ? (product.variants || [])[parsed.variant] : null;
  return Number(v?.deliveryCharge) || Number(product.deliveryCharge) || 0;
}

const hosted = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : '');

/** Thumbnail for a cart line: the variant's own photo, else the product's. */
function photoOf(product, parsed) {
  if (!product) return '';
  const v = parsed.variant >= 0 ? (product.variants || [])[parsed.variant] : null;
  const candidates = [
    ...(Array.isArray(v?.images) ? v.images : []),
    v?.imageUrl,
    product.imageUrl,
  ];
  return candidates.map(hosted).find(Boolean) || '';
}

/**
 * Price up an inbound cart and resolve its lines to product names.
 * @param {object} cart parsed `{ items: [{ retailerId, quantity, price }] }`
 * @param {string} [businessId] owning tenant, so lookups stay scoped
 * @returns {Promise<{lines: object[], count: number, subtotal: number, delivery: number, currency: string}>}
 */
export async function priceCart(cart, businessId = '') {
  const items = (cart?.items || []).filter((it) => it.retailerId);
  if (!items.length) {
    return { lines: [], count: 0, subtotal: 0, delivery: 0, currency: cart?.currency || 'INR' };
  }

  const parsed = items.map((it) => ({ it, p: splitRetailerId(it.retailerId) }));
  const bases = [...new Set(parsed.map((x) => x.p.base))];

  let products = [];
  try {
    products = await Product.find({
      retailerId: { $in: bases },
      ...(businessId ? { businessId } : {}),
    })
      .select('name retailerId variants freeDelivery deliveryCharge imageUrl')
      .lean();
  } catch (err) {
    logger.warn('cart: could not resolve product names', { error: err.message });
  }
  const byRetailer = new Map(products.map((p) => [p.retailerId, p]));

  const lines = parsed.map(({ it, p }) => {
    const qty = Number(it.quantity) || 1;
    const unit = Number(it.price) || 0;
    const product = byRetailer.get(p.base);
    return {
      label: describe(product, p, it.retailerId),
      qty,
      unit,
      amount: unit * qty,
      delivery: deliveryChargeOf(product, p),
      image: photoOf(product, p),
    };
  });

  return {
    lines,
    count: lines.reduce((n, l) => n + l.qty, 0),
    subtotal: lines.reduce((n, l) => n + l.amount, 0),
    // One order goes to one address once, so the charges don't stack: the
    // dearest item's charge covers the delivery. Summing them would bill a
    // three-item order three times over for a single trip.
    delivery: lines.reduce((n, l) => Math.max(n, l.delivery), 0),
    currency: items[0]?.currency || 'INR',
  };
}

/**
 * {{tokens}} describing the cart, for any block body sent after it.
 *
 * `items_total_value` is the raw number kept alongside the formatted string:
 * the Payment type block adds its own delivery fee to it at send time, which it
 * can't do from "₹850".
 */
export async function cartTokens(cart, businessId = '') {
  const priced = await priceCart(cart, businessId);
  if (!priced.lines.length) return {};
  return {
    cart_items: priced.lines.map((l) => `${l.qty} x ${l.label} - ${rupees(l.amount)}`).join('\n'),
    cart_count: String(priced.count),
    // Structured lines, not for display — this is what an order is built from
    // when the customer confirms. Carried in the conversation state alongside
    // the readable tokens.
    cart_lines: priced.lines.map((l) => ({ name: l.label, qty: l.qty, price: l.unit, image: l.image || '' })),
    items_total: rupees(priced.subtotal),
    items_total_value: priced.subtotal,
    // The delivery charge the catalog asks for. 0 means every item in the cart
    // is free delivery — a payment block may still apply its own flat fee.
    delivery_value: priced.delivery,
    delivery_fee: priced.delivery > 0 ? rupees(priced.delivery) : 'FREE',
    total_payable: rupees(priced.subtotal + priced.delivery),
    total_payable_value: priced.subtotal + priced.delivery,
    cart_note: cart?.note || '',
  };
}

// Tokens that only mean anything once a cart is in play.
const CHARGE_KEYS = ['cart_items', 'cart_count', 'items_total', 'delivery_fee', 'total_payable'];

/**
 * The costed header of a Payment type message:
 *
 *   *Payment*
 *   ━━━━━━━━━━━━━━
 *   Items   ₹850
 *   Delivery   ₹99
 *   *Total payable   ₹949*
 *
 * Built here rather than left as {{tokens}} in the block's text, so the layout
 * is the same in every flow and every tenant, and businesses only write the
 * prompt underneath it. Returns '' when there's no cart to cost or the block
 * has the summary switched off — then only the prompt is sent.
 *
 * @param {object} block the flow block (uses `deliveryFee`, `summaryTitle`, `showSummary`)
 * @param {object} tokens tokens carried through the conversation
 */
export function paymentSummary(block, tokens = {}) {
  if (block?.showSummary === false) return '';
  const items = Number(tokens.items_total_value);
  if (!Number.isFinite(items)) return '';
  // Via resolveDelivery, so the catalog's per-product charge is honoured and
  // the block's flat fee is only the fallback.
  const fee = resolveDelivery(block, tokens);
  const title = String(block?.summaryTitle || '').trim() || 'Payment';
  return [
    `*${title}*`,
    '━━━━━━━━━━━━━━',
    `Items   ${rupees(items)}`,
    `Delivery   ${fee > 0 ? rupees(fee) : 'FREE'}`,
    `*Total payable   ${rupees(items + fee)}*`,
  ].join('\n');
}

/**
 * What to charge for delivery on this order.
 *
 * The catalog wins: a business that set a Delivery charge on the product means
 * it, so that's what the customer is billed. The payment block's own fee is the
 * fallback for businesses that charge a flat rate per order instead of pricing
 * delivery per product — and for flows with no catalog step at all.
 *
 * @param {object} block the flow block (uses `deliveryFee`)
 * @param {object} tokens tokens carried through the conversation
 */
export function resolveDelivery(block, tokens = {}) {
  const fromCatalog = Number(tokens.delivery_value);
  if (Number.isFinite(fromCatalog) && fromCatalog > 0) return fromCatalog;
  return Number(block?.deliveryFee) || 0;
}

/**
 * Apply a payment block's charges on top of the cart subtotal.
 * Returns the tokens unchanged when there's no cart to cost. Idempotent, so
 * it's safe to call again on already-charged tokens.
 * @param {object} block the flow block (uses `deliveryFee`)
 * @param {object} tokens tokens carried through the conversation
 */
export function chargeTokens(block, tokens = {}) {
  const items = Number(tokens.items_total_value);
  if (!Number.isFinite(items)) return { ...tokens };
  const fee = resolveDelivery(block, tokens);
  return {
    ...tokens,
    items_total: rupees(items),
    // A zero fee reads better as FREE than as ₹0, and keeps the line in place.
    delivery_fee: fee > 0 ? rupees(fee) : 'FREE',
    delivery_value: fee,
    total_payable: rupees(items + fee),
    total_payable_value: items + fee,
  };
}

/**
 * Remove summary lines we have no figures for.
 *
 * The Payment type block ships with Items / Delivery / Total payable lines. If
 * it's used without a catalog step there's no cart, and printing "Items ₹0" or
 * a raw {{items_total}} would look broken — so those lines are dropped and the
 * rest of the wording is sent as-is.
 */
export function dropUnpricedLines(text = '', tokens = {}) {
  const missing = CHARGE_KEYS.filter((k) => !tokens[k]);
  if (!missing.length) return String(text || '');
  const re = new RegExp(`\\{\\{\\s*(${missing.join('|')})\\s*\\}\\}`);
  return String(text || '')
    .split('\n')
    .filter((line) => !re.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * The cart as the CRM renders it (the `OrderInfo` shape in frontend types).
 *
 * Stored on the message instead of Meta's raw payload: only the backend can
 * turn `carrot__v1s0` into "Carrot - 500 piece - spicy" and find its photo, so
 * resolving it once here keeps the chat bubble readable.
 *
 * `total` is the items subtotal, matching the "estimated total" WhatsApp itself
 * showed the customer on the cart — delivery is quoted later, by the payment
 * step, and putting it here would contradict what they saw.
 */
export function cartBubble(priced, cart) {
  return {
    items: (priced?.lines || []).map((l) => ({
      name: l.label,
      qty: l.qty,
      price: l.unit,
      currency: priced.currency,
      lineTotal: l.amount,
      ...(l.image ? { image: l.image } : {}),
    })),
    total: priced?.subtotal || 0,
    currency: priced?.currency || 'INR',
    note: cart?.note || '',
    ...(cart?.catalogId ? { catalogId: cart.catalogId } : {}),
  };
}

/** One-line description of a cart, for the chat log and notifications. */
export function cartToText(priced) {
  const lines = (priced?.lines || []).map((l) => `${l.qty} x ${l.label} - ${rupees(l.amount)}`);
  const head = `🛒 Cart sent (${priced?.count || 0} item${priced?.count === 1 ? '' : 's'})`;
  return [head, ...lines, `Total ${rupees(priced?.subtotal || 0)}`].join('\n');
}

export default {
  priceCart, cartTokens, chargeTokens, resolveDelivery, dropUnpricedLines, paymentSummary,
  cartBubble, cartToText, rupees,
};
