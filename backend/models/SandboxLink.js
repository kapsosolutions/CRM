import { Schema, defineModel } from '../db/model.js';

// Which business a customer reaches on the shared "try it" WhatsApp number.
// Set when the customer sends that business's join code; one business per
// sender, so a newer code re-links them (see services/sandbox.js).
const SandboxLinkSchema = new Schema(
  {
    phone: { type: String, required: true, unique: true, index: true }, // digits only
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', index: true },
    code: { type: String, default: '' },
    linkedAt: { type: Date },
  },
  { timestamps: true },
);

export default defineModel('SandboxLink', SandboxLinkSchema, 'sandbox_links');
