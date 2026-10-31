import { Schema, defineModel } from '../db/model.js';

// A saved Messenger / Instagram message built in the CRM (Templates →
// Messenger / Instagram → Quick messages). No Meta approval: these can only
// be sent inside the 24-hour window after the customer's last message
// (services/metaMessaging.js validates them against each channel's limits).
const QuickMessageSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', index: true, required: true },
    name: { type: String, required: true },
    // Where it can be sent: ['messenger'], ['instagram'] or both.
    channels: { type: [String], default: () => ['messenger', 'instagram'] },
    // 'text' (optionally with up to 3 buttons: the button template) |
    // 'image' | 'cards' (generic template, 1–10 cards) | 'quick_replies'
    kind: { type: String, default: 'text' },
    text: { type: String, default: '' },
    imageUrl: { type: String, default: '' },
    // text kind: [{ type: 'url' | 'postback', title, url, payload }]
    buttons: { type: Schema.Types.Mixed, default: () => [] },
    // [{ imageUrl, title, subtitle, buttons: [{ type, title, url, payload }] }]
    cards: { type: Schema.Types.Mixed, default: () => [] },
    // [{ title, payload }]
    quickReplies: { type: Schema.Types.Mixed, default: () => [] },
  },
  { timestamps: true },
);

QuickMessageSchema.index({ businessId: 1, updatedAt: -1 });

export default defineModel('QuickMessage', QuickMessageSchema, 'quick_messages');
