import { Schema, defineModel } from '../db/model.js';

// One comment the auto-DM handled (services/commentAutoDm.js). The unique
// (businessId, commentId) index is how a comment Meta delivers twice is only
// ever answered once. Also the activity list on the Comment auto-DM tab.
const CommentReplySchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', index: true, required: true },
    commentId: { type: String, required: true },
    ruleId: { type: String, default: '' },
    // 'facebook' | 'instagram'
    channel: { type: String, default: '' },
    postId: { type: String, default: '' },
    fromId: { type: String, default: '' },
    fromName: { type: String, default: '' },
    text: { type: String, default: '' },
    // The chat the DM was filed in (Messenger PSID / Instagram-scoped id).
    psid: { type: String, default: '' },
    // 'processing' | 'sent' | 'failed' | 'skipped'
    status: { type: String, default: 'processing' },
    reason: { type: String, default: '' },
    error: { type: String, default: '' },
    dmMessageId: { type: String, default: '' },
    publicReplyId: { type: String, default: '' },
    publicReplyError: { type: String, default: '' },
  },
  { timestamps: true },
);

CommentReplySchema.index({ businessId: 1, commentId: 1 }, { unique: true });
CommentReplySchema.index({ businessId: 1, createdAt: -1 });
CommentReplySchema.index({ businessId: 1, channel: 1, postId: 1, fromId: 1 });

export default defineModel('CommentReply', CommentReplySchema, 'comment_replies');
