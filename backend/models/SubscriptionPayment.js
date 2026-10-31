import { Schema, defineModel } from '../db/model.js';

// One plan purchase through Razorpay (services/subscriptions.js).
//
// Created with the Razorpay order (status 'created'). Turned 'paid' exactly
// once — by the checkout's signed callback or Razorpay's webhook, whichever
// arrives first — with a conditional update on the status, so a payment can
// never activate (or extend) a plan twice.
const SubscriptionPaymentSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', index: true },
    orderId: { type: String, required: true, unique: true, index: true }, // Razorpay order_…
    paymentId: { type: String, default: '' }, // Razorpay pay_…
    tier: { type: String, required: true }, // basic | pro | premium
    cycle: { type: String, required: true }, // monthly | quarterly | annual
    months: { type: Number, default: 1 },
    // new (from trial / free / before plans) | renew (same plan, extends it) | upgrade (higher plan now)
    kind: { type: String, default: 'new' },
    listPaise: { type: Number, default: 0 }, // the plan's price for the period
    creditPaise: { type: Number, default: 0 }, // unused value of the plan being upgraded from
    amountPaise: { type: Number, required: true }, // what was charged
    currency: { type: String, default: 'INR' },
    // created | paid | failed
    status: { type: String, default: 'created', index: true },
    method: { type: String, default: '' },
    error: { type: String, default: '' },
    paidAt: { type: Date },
    startsAt: { type: Date },
    endsAt: { type: Date },
    receipt: { type: String, default: '' },
  },
  { timestamps: true },
);

export default defineModel('SubscriptionPayment', SubscriptionPaymentSchema, 'subscription_payments');
