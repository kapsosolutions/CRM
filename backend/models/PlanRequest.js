import { Schema, defineModel } from '../db/model.js';

// A business asking to move to a paid plan (Settings → Billing → Upgrade, or
// the "Buy" buttons in the plans modal). No payment is taken in the app: the
// super admin sees the request in the admin panel (Plan requests), arranges
// payment outside the CRM, and approves it (which moves the business to the
// paid plan) or declines it. One open request per business; asking again
// updates it. See services/billing.js.
const PlanRequestSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', index: true, required: true },
    // The plan asked for, by its name in the plans list: 'Basic' | 'Pro' | 'Premium'.
    plan: { type: String, required: true },
    // 'monthly' | 'quarterly' | 'annual'
    cycle: { type: String, default: 'annual' },
    // Optional message from the business.
    note: { type: String, default: '' },
    // The business's plan when it asked ('free' | 'paid', plus the paid plan's name).
    currentPlan: { type: String, default: '' },
    currentPlanName: { type: String, default: '' },
    status: { type: String, enum: ['open', 'approved', 'declined'], default: 'open', index: true },
    adminNote: { type: String, default: '' },
    handledAt: { type: Date },
  },
  { timestamps: true },
);

PlanRequestSchema.index({ businessId: 1, status: 1 });

export default defineModel('PlanRequest', PlanRequestSchema, 'plan_requests');
