import { Schema, defineModel } from '../db/model.js';

// One browser that asked for desktop notifications (Web Push). The endpoint
// is the browser's own push address, so it is unique: signing in to another
// business in the same browser moves the row to that business, and signing
// out removes it. `prefs` are that browser's Settings → Manage Notifications
// choices, so a push is only sent for what it wants.
const PushSubscriptionSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', index: true },
    endpoint: { type: String, required: true },
    // { p256dh, auth }: the keys the browser gave for encrypting pushes to it.
    keys: { type: Schema.Types.Mixed, default: null },
    prefs: { type: Schema.Types.Mixed, default: null },
    userAgent: { type: String, default: '' },
    // Failed sends in a row (not "gone"): the row is dropped after too many.
    failures: { type: Number, default: 0 },
    lastSentAt: { type: Date },
  },
  { timestamps: true },
);

PushSubscriptionSchema.index({ endpoint: 1 }, { unique: true });

export default defineModel('PushSubscription', PushSubscriptionSchema, 'push_subscriptions');
