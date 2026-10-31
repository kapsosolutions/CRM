import { Schema, defineModel } from '../db/model.js';

// Saved targeting kept in the CRM (Ads → Audiences → Saved audiences).
// Meta's Marketing API can read an ad account's saved audiences
// (GET act_/saved_audiences) but not create them, so audiences saved from the
// CRM live here. They are a starting point for the "Create campaign" wizard
// and the ad set editor; nothing here exists at Meta. The audience is stored
// in the S1 editor shape after services/metaAdsCreate.js validateAudience and
// is validated again whenever it is used.
const AdSavedAudienceSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', index: true, required: true },
    // The ad account ('act_<id>') it was saved for (custom audience ids belong to it).
    adAccountId: { type: String, default: '', index: true },
    name: { type: String, default: '' },
    description: { type: String, default: '' },
    audience: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, minimize: false },
);

AdSavedAudienceSchema.index({ businessId: 1, updatedAt: -1 });

export default defineModel('AdSavedAudience', AdSavedAudienceSchema, 'ad_saved_audiences');
