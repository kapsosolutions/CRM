// Live-value tokens shared by message blocks and PDF templates.
//
// A business writes "Order {{order_id}} is cancelled" and the runtime fills in
// the real value. Unknown tokens are stripped so a customer never sees a raw
// {{placeholder}}. Kept in its own module so both the WhatsApp runtime and the
// PDF renderer can use it without importing each other.

/** Replace {{token}} occurrences in `text` using `tokens`. */
export function fillTokens(text, tokens = {}) {
  if (!text || typeof text !== 'string') return text || '';
  return text
    .replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key) => {
      const v = tokens[key];
      return v === undefined || v === null ? '' : String(v);
    })
    // Tidy up gaps left behind by an empty token.
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Drop whole lines whose live values are all empty.
 *
 * This is what lets one confirmation template serve every business. The block
 * ships with lines for category, address, payment method and so on; a business
 * whose flow never asks for a location has no `delivery_address`, so that line
 * disappears instead of sending "Deliver to:" with nothing after it.
 *
 * A line with no tokens at all is plain wording and always stays. A line keeps
 * its place if *any* of its tokens has a value, so "Pay {{total_payable}} to
 * {{business_name}}" survives on the business name alone.
 *
 * (services/cart.js has a stricter variant for the payment summary, which drops
 * a line as soon as one charge figure is missing.)
 */
export function dropEmptyLines(text = '', tokens = {}) {
  return String(text || '')
    .split('\n')
    .filter((line) => {
      const keys = [...line.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].map((m) => m[1]);
      if (!keys.length) return true;
      return keys.some((k) => {
        const v = tokens[k];
        return v !== undefined && v !== null && String(v).trim() !== '';
      });
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The tokens a tenant can use, for builder hints. */
export const TOKEN_HELP = [
  // The customer's name: a name they typed into a form wins, else their
  // WhatsApp profile name. `name` and `customer_name` are interchangeable.
  'name',
  'order_id', 'order_ref', 'order_total', 'order_status', 'order_date', 'order_items',
  'customer_name', 'customer_phone', 'customer_email', 'category', 'member',
  'amount_paid', 'payment_status', 'cancelled_date', 'business_name', 'today',
  // From an appointment booking or reschedule. Readable, not raw: the date is
  // "18 Oct 2026" and the time "10:30 am", never an epoch or 24h string.
  'appointment_date', 'appointment_slot', 'gender', 'age', 'member_fee',
  // From a Catalog block (the customer's cart) and the steps after it.
  'cart_items', 'cart_count', 'items_total', 'delivery_fee', 'total_payable',
  'payment_method', 'delivery_address', 'location_url',
];

/**
 * Tokens for a location the customer shared.
 *
 * WhatsApp sends a pin, and optionally a name and street address — which it
 * only includes when the customer picked a saved place rather than dropping a
 * pin. So `delivery_address` falls back through address → name → coordinates,
 * and is never blank once a location has actually been shared.
 *
 * @param {object} loc parsed `{ lat, lng, name, address }`
 */
export function locationTokens(loc) {
  if (!loc || (loc.lat === undefined && loc.lng === undefined)) return {};
  const lat = Number(loc.lat);
  const lng = Number(loc.lng);
  const coords = Number.isFinite(lat) && Number.isFinite(lng) ? `${lat}, ${lng}` : '';
  const parts = [loc.name, loc.address].map((s) => String(s || '').trim()).filter(Boolean);
  return {
    delivery_address: [...new Set(parts)].join(', ') || coords,
    location_name: String(loc.name || '').trim(),
    location_coords: coords,
    location_url: coords ? `https://maps.google.com/?q=${lat},${lng}` : '',
    // Kept separately from the formatted string so an order can store the pin
    // as numbers and the CRM can draw a map from it.
    location_lat: Number.isFinite(lat) ? lat : '',
    location_lng: Number.isFinite(lng) ? lng : '',
  };
}

export default { fillTokens, dropEmptyLines, TOKEN_HELP, locationTokens };
