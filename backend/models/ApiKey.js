import { Schema, defineModel } from '../db/model.js';

// A business's key for the public API (/api/v1): its other apps and servers
// send the business's WhatsApp templates with it. Only a hash of the key is
// stored (services/apiKeys.js); the key itself is shown once, when it's made.
const ApiKeySchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', index: true, required: true },
    name: { type: String, default: '' },
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
