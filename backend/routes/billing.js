// Settings → Billing, and buying a plan with Razorpay.
//
//   GET  /api/billing                  plan, usage, messaging tier, contact, payments
//   GET  /api/billing/quote?tier&cycle what a plan costs now (upgrade credit, period)
//   POST /api/billing/link             { tier, cycle } → Razorpay Payment Link { url } (what the CRM uses)
//   GET  /api/razorpay/return          Razorpay → the customer's browser, back from the paid link (signed):
//                                      activates, then redirects to the CRM's Billing with ?payment=…
//   POST /api/billing/checkout         { tier, cycle } → Razorpay order for the Checkout popup (older path;
//                                      needs the website registered with Razorpay)
//   POST /api/billing/confirm          { orderId, paymentId, signature } → activates the plan
//   POST /api/razorpay/webhook         Razorpay → us (signed, optional): activates / records failures
// Payment Links need no webhook: an unpaid recent link is also checked with
// Razorpay when Billing is opened, and every few minutes.
import express from 'express';
import { requireBusiness } from '../middleware/auth.js';
import Business from '../models/Business.js';
import SubscriptionPayment from '../models/SubscriptionPayment.js';
import { billingSummary } from '../services/billing.js';
import {
  quote, presentQuote, checkout, confirmCheckout, activate, markFailed, BillingError,
  startPaymentLink, confirmPaymentLink, settleLink, syncPendingLinks,
} from '../services/subscriptions.js';
import { planState } from '../services/plans.js';
import { verifyWebhookSignature, webhookConfigured } from '../services/razorpay.js';
import logger from '../services/logger.js';

const router = express.Router();
router.use(requireBusiness);

function fail(res, err, what) {
  if (err instanceof BillingError) {
    return res.status(err.status).json({ success: false, code: err.code, message: err.message });
  }
  logger.error(`${what} failed`, { error: err.message });
  return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
}

router.get('/', async (req, res) => {
  // A link paid in a tab that closed before coming back: Razorpay says so now.
  let biz = req.business;
  try {
    const r = await syncPendingLinks({ businessId: biz._id, max: 3 });
    if (r.activated) biz = (await Business.findById(biz._id)) || biz;
  } catch (err) {
    logger.warn('billing: payment link check failed', { error: err.message });
  }
  res.json({ success: true, data: await billingSummary(biz) });
});

router.post('/link', async (req, res) => {
  try {
    const b = req.body || {};
    res.status(201).json({ success: true, data: await startPaymentLink(req.business, { tier: b.tier, cycle: b.cycle }) });
  } catch (err) {
    fail(res, err, 'plan payment link');
  }
});

router.get('/quote', (req, res) => {
  try {
    res.json({ success: true, data: presentQuote(quote(req.business, req.query.tier, req.query.cycle)) });
  } catch (err) {
    fail(res, err, 'plan quote');
  }
});

router.post('/checkout', async (req, res) => {
  try {
    const b = req.body || {};
    res.status(201).json({ success: true, data: await checkout(req.business, { tier: b.tier, cycle: b.cycle }) });
  } catch (err) {
    fail(res, err, 'plan checkout');
  }
});

router.post('/confirm', async (req, res) => {
  try {
    const b = req.body || {};
    const { payment, activated } = await confirmCheckout(req.business, {
      orderId: String(b.orderId || ''),
      paymentId: String(b.paymentId || ''),
      signature: String(b.signature || ''),
    });
    const biz = await Business.findById(req.business._id);
    res.json({ success: true, activated, plan: planState(biz), payment: { orderId: payment?.orderId, status: payment?.status } });
  } catch (err) {
    fail(res, err, 'plan payment confirm');
  }
});

// ------------------------------------------------------------- webhook --

const webhook = express.Router();

// Razorpay → us. The body is JSON (express.json keeps the raw bytes for the
// signature, server.js). Answers 200 for anything verified, so Razorpay
// doesn't retry events we don't act on.
webhook.post('/', async (req, res) => {
  if (!webhookConfigured()) {
    logger.warn('razorpay webhook received but RAZORPAY_WEBHOOK_SECRET is not set');
    return res.status(503).json({ success: false });
  }
  if (!verifyWebhookSignature(req.rawBody, req.headers['x-razorpay-signature'])) {
    logger.warn('razorpay webhook signature invalid');
    return res.status(400).json({ success: false });
  }
  const event = String(req.body?.event || '');
  const payment = req.body?.payload?.payment?.entity || null;
  const order = req.body?.payload?.order?.entity || null;
  const link = req.body?.payload?.payment_link?.entity || null;
  const orderId = payment?.order_id || order?.id || '';
  try {
    // A Payment Link (if a webhook is set up at all): Razorpay is asked for its status.
    if (link?.id && /^plink_/.test(link.id)) {
      const row = await SubscriptionPayment.findOne({ orderId: link.id }).lean();
      if (!row) return res.json({ success: true, ignored: true });
      if (event === 'payment_link.paid') {
        const r = await settleLink(row);
        logger.info('razorpay webhook', { event, link: link.id, activated: r.activated });
      }
      return res.json({ success: true });
    }
    if (!orderId || !(await SubscriptionPayment.exists({ orderId }))) {
      // Not a plan purchase (another product on the same Razorpay account).
      return res.json({ success: true, ignored: true });
    }
    if ((event === 'payment.captured' || event === 'order.paid') && payment && payment.status === 'captured') {
      const r = await activate(orderId, { paymentId: payment.id, method: payment.method || '', amount: Number(payment.amount) });
      logger.info('razorpay webhook', { event, orderId, activated: r.activated });
    } else if (event === 'payment.failed' && payment) {
      await markFailed(orderId, payment.error_description || payment.error_reason || 'Payment failed');
    }
    return res.json({ success: true });
  } catch (err) {
    if (err instanceof BillingError) {
      logger.error('razorpay webhook refused', { event, orderId, code: err.code, error: err.message });
      return res.json({ success: false, code: err.code });
    }
    logger.error('razorpay webhook failed', { event, orderId, error: err.message });
    return res.status(500).json({ success: false });
  }
});

// ------------------------------------------------- back from Razorpay --

const back = express.Router();

/**
 * Where the CRM shows the result: Settings → Billing, with ?payment=paid |
 * pending | failed (CrmShell reads it once and removes it). Same site, so a
 * path is enough (nginx serves the CRM and the API on one domain).
 */
function crmBilling(result, reason = '') {
  const open = encodeURIComponent(JSON.stringify({ target: { view: 'profile', id: 'billing' } }));
  return `/?payment=${result}${reason ? `&reason=${encodeURIComponent(reason)}` : ''}&crmOpen=${open}#/`;
}

// Razorpay redirects the customer's browser here (GET) after the hosted page.
back.get('/', async (req, res) => {
  const q = req.query || {};
  try {
    const r = await confirmPaymentLink({
      linkId: String(q.razorpay_payment_link_id || ''),
      referenceId: String(q.razorpay_payment_link_reference_id || ''),
      status: String(q.razorpay_payment_link_status || ''),
      paymentId: String(q.razorpay_payment_id || ''),
      signature: String(q.razorpay_signature || ''),
    });
    logger.info('razorpay return', { link: String(q.razorpay_payment_link_id || ''), status: r.status, activated: r.activated });
    return res.redirect(303, crmBilling(r.status === 'paid' ? 'paid' : r.status === 'failed' ? 'failed' : 'pending'));
  } catch (err) {
    const reason = err instanceof BillingError ? err.code : 'error';
    if (!(err instanceof BillingError)) logger.error('razorpay return failed', { error: err.message });
    return res.redirect(303, crmBilling('failed', reason));
  }
});

export { webhook as razorpayWebhookRouter, back as razorpayReturnRouter };
export default router;
