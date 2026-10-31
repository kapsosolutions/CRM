import { Schema, defineModel } from '../db/model.js';

// A "Create campaign" wizard saved in the CRM before it was sent to Meta
// (services/metaAdsCreate.js), so a long wizard can be resumed from the Ads
// page's Campaigns tab. Nothing here exists at Meta: the spec is re-validated
// in full when the campaign is finally created. Removed after a successful
// create, or when the business deletes it.
const AdDraftSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', index: true, required: true },
    // The ad account ('act_<id>') the draft was started for.
    adAccountId: { type: String, default: '', index: true },
    // Shown in the drafts list (the campaign name typed so far).
    name: { type: String, default: '' },
    // whatsapp | traffic | leads | awareness | sales ('' = not picked yet)
    objective: { type: String, default: '' },
    // The wizard step the business was on (0 = goal … 6 = review).
    step: { type: Number, default: 0 },
    // The wizard's spec as the browser had it (sanitised, size-capped).
    spec: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, minimize: false },
);

AdDraftSchema.index({ businessId: 1, updatedAt: -1 });

export default defineModel('AdDraft', AdDraftSchema, 'ad_drafts');
