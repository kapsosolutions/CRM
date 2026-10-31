import { Schema, defineModel } from '../db/model.js';

// Catalog product. Trimmed vs. the FMCG reference: no Tamil fields, cover image
// or product video. Syncs to the Meta Commerce catalog.
const ProductSchema = new Schema(
  {
    // Owning tenant — deleting a business removes everything tagged with it.
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', index: true },
    name: { type: String, required: true },
    // Stable id for the WA catalog. Unique per tenant, not globally: each
    // business has its own Meta catalog, so two of them can both sell a
    // "carrot" — a global unique index made the second one fail to save.
    retailerId: { type: String, index: true },
    description: { type: String, default: '' },
    categories: [{ type: String, index: true }], // multi-select category names
    price: { type: Number, required: true },
    mrp: { type: Number, default: 0 },
    freeDelivery: { type: Boolean, default: true }, // if false, deliveryCharge applies
    deliveryCharge: { type: Number, default: 0 }, // per-product delivery charge (₹)
    unit: { type: String, default: 'unit' },
    quantity: { type: Number, default: 0 }, // pack size
    imageUrl: { type: String, default: '' },
    gallery: [{ type: String }],

    // Size/quantity variants (each with its own price + delivery), e.g. 500 ml / 1 L.
    variants: [
      {
        label: { type: String, default: '' },
        quantity: { type: Number, default: 0 },
        unit: { type: String, default: '' },
        price: { type: Number, default: 0 },
        deliveryCharge: { type: Number, default: 0 },
        // Primary image (kept in step with images[0]) plus up to 10 photos that
        // become the ‹ › carousel on the WhatsApp product detail screen.
        imageUrl: { type: String, default: '' },
        images: [{ type: String }],
        // Second-axis options for this size, e.g. ['Spicy', 'Hot'] or
        // ['Black', 'Yellow']. Each one pairs with the size to make a
        // separately selectable item in the catalog, so a size with two
        // sub-variants publishes as two items.
        subVariants: [{ type: String }],
        // Legacy single value, still read when `subVariants` is absent.
        subVariant: { type: String, default: '' },
      },
    ],

    // What the business calls this second axis, e.g. "Spice level". Used in our
    // own UI and written into the item description — WhatsApp supplies its own
    // (localised) heading for the picker and offers no way to override it.
    subVariantLabel: { type: String, default: '' },

    // Which Meta variant field the sub-variant is published as. Derived from
    // subVariantLabel when it obviously matches one, else 'color'.
    subVariantField: {
      type: String,
      enum: ['color', 'pattern', 'material'],
      default: 'color',
    },

    inStock: { type: Boolean, default: true },
    active: { type: Boolean, default: true },
    isPaused: { type: Boolean, default: false }, // manual availability toggle

    // Recurring availability window (outside the window = sold out).
    soldOutSchedule: {
      enabled: { type: Boolean, default: false },
      type: { type: String, enum: ['daily', 'custom'], default: 'daily' },
      dailyStartTime: { type: String },
      dailyEndTime: { type: String },
      days: [
        {
          day: { type: String, enum: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] },
          enabled: { type: Boolean, default: false },
          startTime: String,
          endTime: String,
        },
      ],
    },

    // Retailer IDs last pushed to Meta (base + per-variant) for stale cleanup.
    catalogItemIds: [{ type: String }],
    catalogSynced: { type: Boolean, default: false },
    // Why the last push to Meta failed, so a rejected item is visible in the
    // catalog list instead of failing silently.
    catalogError: { type: String, default: '' },
    catalogSyncedAt: { type: Date },
  },
  { timestamps: true },
);

ProductSchema.index({ businessId: 1, retailerId: 1 }, { unique: true });

export default defineModel('Product', ProductSchema, 'products');
