import { Schema, defineModel } from '../db/model.js';

// Product categories used to group catalog items (multi-select on products).
const CategorySchema = new Schema(
  {
    // Owning tenant — deleting a business removes everything tagged with it.
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', index: true },
    // Unique per tenant, not globally — two businesses may both sell "Biryani".
    name: { type: String, required: true },
    imageUrl: { type: String, default: '' },
    order: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

CategorySchema.index({ businessId: 1, name: 1 }, { unique: true });

export default defineModel('Category', CategorySchema, 'categories');
