import { Schema, defineModel } from '../db/model.js';

// A business's key for the public API (/api/v1). Only a hash of the key is
// stored (services/apiKeys.js); the key itself is shown once, when it's made.
//
//   secret       kp_live_…  server-side only: every endpoint (send templates,
//                           one-time codes, bookings, catalog updates)
//   publishable  kp_pub_…   for a website's browser code: read-only catalog,
//                           categories, members, slots and offers, and only
//                           from the website addresses in allowedOrigins
const ApiKeySchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', index: true, required: true },
    name: { type: String, default: '' },
    type: { type: String, enum: ['secret', 'publishable'], default: 'secret' },
    // Publishable keys: the websites allowed to use it, e.g. "https://shop.example.com"
    // or "https://*.example.com". Browsers on any other site are refused.
    allowedOrigins: [{ type: String }],
    // HMAC-SHA256 of the whole key (hex). Looked up by this, so unique.
    keyHash: { type: String, required: true, unique: true },
    // "kp_live_7Hq2" and the last 4 characters, to tell keys apart on screen.
    prefix: { type: String, default: '' },
    lastFour: { type: String, default: '' },
    lastUsedAt: { type: Date, default: null },
    lastUsedIp: { type: String, default: '' },
    requests: { type: Number, default: 0 },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export default defineModel('ApiKey', ApiKeySchema, 'api_keys');
