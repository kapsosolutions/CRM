// Settings → Billing, and buying a plan with Razorpay.
//
//   GET  /api/billing                  plan, usage, messaging tier, contact, payments
//   GET  /api/billing/quote?tier&cycle what a plan costs now (upgrade credit, period)
//   POST /api/billing/checkout         { tier, cycle } → Razorpay order for the Checkout
//   POST /api/billing/confirm          { orderId, paymentId, signature } → activates the plan
//   POST /api/razorpay/webhook         Razorpay → us (signed): activates / records failures
import express from 'express';
import { requireBusiness } from '../middleware/auth.js';
import Business from '../models/Business.js';
import SubscriptionPayment from '../models/SubscriptionPayment.js';
import { billingSummary } from '../services/billing.js';
import {
  quote, presentQuote, checkout, confirmCheckout, activate, markFailed, BillingError,
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
  res.json({ success: true, data: await billingSummary(req.business) });
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
  const orderId = payment?.order_id || order?.id || '';
  try {
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

export { webhook as razorpayWebhookRouter };
export default router;
