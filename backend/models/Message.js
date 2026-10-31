import { Schema, defineModel } from '../db/model.js';

// CRM chat log — every inbound/outbound WhatsApp message, per phone.
const MessageSchema = new Schema(
  {
    phone: { type: String, required: true, index: true },
    name: { type: String, default: '' },
    // Owning tenant. Set on inbound messages by the webhook; without this field
    // declared, Mongoose's strict mode would silently drop it.
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', index: true },
    direction: { type: String, enum: ['in', 'out'], required: true },
    type: { type: String, default: 'text' },
    body: { type: String, default: '' },
    raw: { type: Schema.Types.Mixed },
    metaMessageId: { type: String, index: true },
    status: { type: String, default: 'sent' }, // sent, delivered, read, failed
    // Why Meta couldn't deliver it, from the `failed` receipt:
    // { code, title, message, details }.
    error: { type: Schema.Types.Mixed },
    // The campaign this message went out in (services/campaignRunner.js).
    campaignId: { type: Schema.Types.ObjectId, index: true },
    reaction: { type: String, default: '' }, // emoji reaction on this message
    // 'messenger' | 'instagram' for those channels; empty = WhatsApp.
    channel: { type: String, default: '' },
  },
  { timestamps: true },
);

MessageSchema.index({ phone: 1, createdAt: -1 });

export default defineModel('Message', MessageSchema, 'messages');
