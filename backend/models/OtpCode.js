import { Schema, defineModel } from '../db/model.js';

// A one-time code sent through the public API (POST /api/v1/otp/send), so the
// business's app can check what its user typed (POST /api/v1/otp/verify).
// Only a hash of the code is kept.
const OtpCodeSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', index: true, required: true },
    phone: { type: String, required: true, index: true },
    templateName: { type: String, default: '' },
    codeHash: { type: String, required: true },
    metaMessageId: { type: String, default: '' },
    expiresAt: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
    verifiedAt: { type: Date, default: null },
    // Replaced by a newer code to the same number (only the latest one counts).
    supersededAt: { type: Date, default: null },
  },
  { timestamps: true },
);

OtpCodeSchema.index({ businessId: 1, phone: 1, createdAt: -1 });

export default defineModel('OtpCode', OtpCodeSchema, 'otp_codes');
