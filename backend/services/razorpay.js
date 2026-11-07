// Razorpay, for plan purchases: Payment Links (what the CRM uses: Razorpay's
// hosted page, no website registration, no webhook needed), and the older
// Checkout popup's order / signature / webhook. Keys come from the environment only:
//   RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET  (Dashboard → Settings → API Keys)
//   RAZORPAY_CONFIG_ID                    (optional: Checkout payment configuration)
//   RAZORPAY_WEBHOOK_SECRET               (Dashboard → Settings → Webhooks)
// RAZORPAY_API_BASE points the client at a fake Razorpay in tests.
import crypto from 'crypto';
import axios from 'axios';
import logger from './logger.js';

const env = (k) => String(process.env[k] || '').trim();
const base = () => env('RAZORPAY_API_BASE') || 'https://api.razorpay.com/v1';

export const razorpayConfigured = () => !!(env('RAZORPAY_KEY_ID') && env('RAZORPAY_KEY_SECRET'));
export const razorpayKeyId = () => env('RAZORPAY_KEY_ID');
export const webhookConfigured = () => !!env('RAZORPAY_WEBHOOK_SECRET');

const http = () => axios.create({
  baseURL: base(),
  timeout: 20000,
  auth: { username: env('RAZORPAY_KEY_ID'), password: env('RAZORPAY_KEY_SECRET') },
  headers: { 'Content-Type': 'application/json' },
});

/** Razorpay's own error text, without anything secret. */
export function razorpayError(err) {
  const e = err?.response?.data?.error;
  return e?.description || e?.reason || err?.message || 'Razorpay request failed';
}

/**
 * Create an order. The Checkout payment configuration (RAZORPAY_CONFIG_ID)
 * is applied when set; if Razorpay refuses that id, the order is created
 * without it rather than blocking the purchase.
 */
export async function createOrder({ amount, receipt, notes }) {
  const body = { amount, currency: 'INR', receipt: String(receipt).slice(0, 40), notes, payment_capture: 1 };
  const configId = env('RAZORPAY_CONFIG_ID');
  try {
    const { data } = await http().post('/orders', configId ? { ...body, checkout_config_id: configId } : body);
    return data;
  } catch (err) {
    if (configId && err?.response?.status === 400 && /checkout_config|config/i.test(razorpayError(err))) {
      logger.warn('razorpay refused the checkout config id; creating the order without it', { error: razorpayError(err) });
      const { data } = await http().post('/orders', body);
      return data;
    }
    throw err;
  }
}

export async function fetchPayment(paymentId) {
  const { data } = await http().get(`/payments/${encodeURIComponent(paymentId)}`);
  return data;
}

export async function capturePayment(paymentId, amount) {
  const { data } = await http().post(`/payments/${encodeURIComponent(paymentId)}/capture`, { amount, currency: 'INR' });
  return data;
}

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a || ''), 'utf8');
  const y = Buffer.from(String(b || ''), 'utf8');
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
};

/** The checkout handler's razorpay_signature: HMAC-SHA256(order_id|payment_id, key secret). */
export function verifyCheckoutSignature(orderId, paymentId, signature) {
  if (!env('RAZORPAY_KEY_SECRET') || !orderId || !paymentId) return false;
  const expected = crypto.createHmac('sha256', env('RAZORPAY_KEY_SECRET')).update(`${orderId}|${paymentId}`).digest('hex');
  return safeEqual(expected, signature);
}

// ---------------------------------------------------------------------------
// Payment Links: the customer pays on Razorpay's own hosted page (rzp.io),
// then Razorpay sends the browser back to `callback_url` with a signed
// result. Unlike the Checkout popup, no website has to be registered with
// Razorpay, and no webhook is needed (subscriptions.js also asks Razorpay
// for a link's status, for a payment whose tab was closed before returning).
// ---------------------------------------------------------------------------

/** A customer phone as Razorpay takes it (+91…), or undefined. */
function contactOf(v) {
  let d = String(v || '').replace(/\D/g, '');
  if (d.length === 10) d = `91${d}`;
  return d.length >= 11 && d.length <= 15 ? `+${d}` : undefined;
}

/**
 * Create a Payment Link for `amount` paise.
 * @returns {Promise<{id: string, short_url: string, amount: number, status: string}>}
 */
export async function createPaymentLink({ amount, referenceId, description, customer = {}, notes = {}, callbackUrl, expireBy }) {
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(customer.email || '')) ? String(customer.email) : undefined;
  const cust = { name: String(customer.name || '').slice(0, 100) || undefined, email, contact: contactOf(customer.contact) };
  const body = {
    amount,
    currency: 'INR',
    accept_partial: false,
    description: String(description || 'Plan').slice(0, 2048),
    reference_id: String(referenceId).slice(0, 40),
    customer: cust,
    // Razorpay sends no SMS / email of its own: the CRM opens the link.
    notify: { sms: false, email: false },
    reminder_enable: false,
    notes,
    callback_url: callbackUrl,
    callback_method: 'get',
    ...(expireBy ? { expire_by: expireBy } : {}),
  };
  try {
    const { data } = await http().post('/payment_links', body);
    return data;
  } catch (err) {
    // A customer detail Razorpay doesn't accept mustn't block the purchase.
    if (err?.response?.status === 400 && /customer|contact|email/i.test(razorpayError(err))) {
      logger.warn('razorpay refused the customer details; creating the link without them', { error: razorpayError(err) });
      const { data } = await http().post('/payment_links', { ...body, customer: { name: cust.name } });
      return data;
    }
    throw err;
  }
}

/** A Payment Link as Razorpay has it now: status (created | paid | expired | cancelled…), amount_paid, payments. */
export async function fetchPaymentLink(id) {
  const { data } = await http().get(`/payment_links/${encodeURIComponent(id)}`);
  return data;
}

/**
 * The signature on the Payment Link callback:
 * HMAC-SHA256(link_id|reference_id|status|payment_id, key secret).
 */
export function verifyPaymentLinkSignature({ linkId, referenceId, status, paymentId, signature }) {
  if (!env('RAZORPAY_KEY_SECRET') || !linkId || !paymentId) return false;
  const payload = `${linkId}|${referenceId || ''}|${status || ''}|${paymentId}`;
  const expected = crypto.createHmac('sha256', env('RAZORPAY_KEY_SECRET')).update(payload).digest('hex');
  return safeEqual(expected, signature);
}

/** X-Razorpay-Signature: HMAC-SHA256(raw body, webhook secret). */
export function verifyWebhookSignature(rawBody, signature) {
  if (!webhookConfigured() || !rawBody) return false;
  const expected = crypto.createHmac('sha256', env('RAZORPAY_WEBHOOK_SECRET')).update(rawBody).digest('hex');
  return safeEqual(expected, signature);
}

export default {
  razorpayConfigured, razorpayKeyId, webhookConfigured, createOrder, fetchPayment, capturePayment,
  verifyCheckoutSignature, verifyWebhookSignature, razorpayError,
  createPaymentLink, fetchPaymentLink, verifyPaymentLinkSignature,
};
