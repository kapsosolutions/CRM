import { Schema, defineModel } from '../db/model.js';

// Simplified offer (vs. the FMCG reference — no combo/b2b/date model). An offer
// can target multiple products; each item is one product size (variant) with an
// individual discount. A "whole product" selection in the UI just adds all of
// that product's variants as items. Each item stores its original price and the
// computed offer price so the discounted price renders with the original struck.
const OfferItemSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product' },
    productName: { type: String, default: '' }, // snapshot
    productImageUrl: { type: String, default: '' },
    variantIndex: { type: Number, default: 0 }, // index into the product's variants[]
    // Which sub-variant of that size the discount applies to (the second axis:
    // flavour / spice level / colour). -1 means the whole size — every one of
    // its sub-variants — which is also what older offers mean, since they
    // predate this field.
    subIndex: { type: Number, default: -1 },
    subLabel: { type: String, default: '' }, // snapshot, e.g. "spicy"
    label: { type: String, default: '' }, // snapshot of the variant label
    originalPrice: { type: Number, default: 0 },
    discountType: { type: String, enum: ['percent', 'flat'], default: 'percent' },
    discountValue: { type: Number, default: 0 }, // percent (0-100) or flat ₹ off
    offerPrice: { type: Number, default: 0 }, // computed final price
  },
  { _id: false },
);

const OfferSchema = new Schema(
  {
    // Owning tenant — deleting a business removes everything tagged with it.
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', index: true },
    title: { type: String, required: true },
    active: { type: Boolean, default: true },
    items: [OfferItemSchema],
    startsAt: { type: Date },
    endsAt: { type: Date },
  },
  { timestamps: true },
);

export default defineModel('Offer', OfferSchema, 'offers');
