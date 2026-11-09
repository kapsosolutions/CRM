import { Schema, defineModel } from '../db/model.js';

// Tracks each WhatsApp user's conversation state + last-message timestamps
// (used by the CRM 24h session timer and the pause toggle).
const ConversationSchema = new Schema(
  {
    // Owning tenant. Set on every upsert so deleting a business can take its
    // conversations with it.
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', index: true },
    // Indexed but NOT globally unique: the same customer can message two
    // different tenants, and those are two separate conversations. A unique
    // index on phone alone made the second tenant's upsert collide with the
    // first tenant's chat, which is how one business ended up showing another's
    // contacts. Uniqueness is per tenant — see the compound index below.
    phone: { type: String, required: true, index: true },
    name: { type: String, default: '' },
    step: { type: String, default: 'new' },
    context: { type: Schema.Types.Mixed, default: {} },
    lastInboundAt: { type: Date, default: null },
    lastOutboundAt: { type: Date },
    lastMessageBody: { type: String, default: '' },
    // Time of the last message either way, for the chat list's time label.
    lastMessageAt: { type: Date },
    // The chat list's ticks: who sent the last message ('in' | 'out', '' =
    // neither, e.g. a call line), and for ours its WhatsApp id and status
    // (sent / delivered / read / failed), moved forward by the receipts.
    lastDirection: { type: String, default: '' },
    lastMessageId: { type: String, default: '', index: true },
    lastStatus: { type: String, default: '' },
    unread: { type: Number, default: 0 },
    // When true, the bot stops auto-replying so an agent can chat manually.
    botPaused: { type: Boolean, default: false },
    // Where the customer writes from: 'whatsapp' (empty on older rows, read as
    // WhatsApp), 'messenger' or 'instagram'. For Messenger / Instagram,
    // `phone` holds the sender's Page-scoped / Instagram-scoped id (PSID /
    // IGSID), so the (businessId, phone) key still names one conversation.
    channel: { type: String, default: '' },
    // Messenger / Instagram profile photo (copied to our storage), and when
    // the profile was last looked up.
    avatarUrl: { type: String, default: '' },
    // Instagram handle of the sender, when Meta shares it.
    handle: { type: String, default: '' },
    profileCheckedAt: { type: Date },
    // Chat ⋮ menu. Muted: no sound, pop-up or push for this chat's messages
    // until then (9999-12-31 = Always); unread counts still go up.
    mutedUntil: { type: Date, default: null },
    // Shown under the chat list's Favourites filter.
    favourite: { type: Boolean, default: false },
    // Blocked: their messages and calls are ignored and nothing is sent to
    // them. `blockedAtMeta`: also blocked on WhatsApp itself (Block Users API).
    blocked: { type: Boolean, default: false },
    blockedAt: { type: Date },
    blockedAtMeta: { type: Boolean, default: false },
    // "Delete chat" on a blocked contact: the row stays, out of the chat list,
    // so the block keeps holding. Adding the contact again clears it.
    hiddenAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// One conversation per (tenant, customer).
ConversationSchema.index({ businessId: 1, phone: 1 }, { unique: true });
// The chat list query: newest inbound first, within one tenant.
ConversationSchema.index({ businessId: 1, lastInboundAt: -1 });

export default defineModel('Conversation', ConversationSchema, 'conversations');
