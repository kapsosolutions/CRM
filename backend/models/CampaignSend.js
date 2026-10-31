import { Schema, defineModel } from '../db/model.js';

// One campaign message to one number: the main template (step 0) or a drip
// follow-up (step 1, 2, …). The row is written BEFORE the message goes to
// Meta, and (campaignId, phone, step) is unique, so whatever happens — two
// runs at once, a crash mid-send, a restart — a number is never sent the same
// campaign message twice (services/campaignRunner.js).
const CampaignSendSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', index: true },
    campaignId: { type: String, required: true },
    phone: { type: String, required: true },
    step: { type: Number, default: 0 },
    templateName: { type: String, default: '' },
    // 'sending' (handed to Meta, no answer yet) | 'sent' | 'failed'
    state: { type: String, default: 'sending' },
    metaMessageId: { type: String, default: '' },
    error: { type: Schema.Types.Mixed, default: null },
    attemptedAt: { type: Date },
    sentAt: { type: Date },
  },
  { timestamps: true },
);

CampaignSendSchema.index({ campaignId: 1, phone: 1, step: 1 }, { unique: true });
// "Was this template just sent to this number by another campaign?"
CampaignSendSchema.index({ businessId: 1, phone: 1, templateName: 1, attemptedAt: -1 });

export default defineModel('CampaignSend', CampaignSendSchema, 'campaign_sends');
