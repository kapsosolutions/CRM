import { Schema, defineModel } from '../db/model.js';

// Comment auto-DM (Create → Comment auto-DM): when someone comments on the
// business's Facebook Page post or Instagram post / reel, send them a private
// reply (a DM) and, optionally, answer the comment publicly.
// services/commentAutoDm.js matches comments to these rules.
const CommentRuleSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', index: true, required: true },
    name: { type: String, default: '' },
    // 'facebook' (the connected Page) | 'instagram'
    channel: { type: String, enum: ['facebook', 'instagram'], required: true },
    active: { type: Boolean, default: true },
    // '' = every post; otherwise one post / reel id (Meta's id, as the
    // comment webhook names it), with what the picker showed for it.
    postId: { type: String, default: '' },
    postLabel: { type: String, default: '' },
    postThumb: { type: String, default: '' },
    // 'any' = every comment; 'keywords' = only comments containing a keyword.
    matchMode: { type: String, enum: ['any', 'keywords'], default: 'keywords' },
    keywords: { type: [String], default: [] },
    // The DM. {name} becomes the commenter's first name / username.
    dmText: { type: String, default: '' },
    // Optional public answers under the comment; one is picked at random.
    publicReplies: { type: [String], default: [] },
    // Send the DM once per person per post, even if they comment again.
    oncePerUser: { type: Boolean, default: true },
    sentCount: { type: Number, default: 0 },
    lastSentAt: { type: Date, default: null },
  },
  { timestamps: true },
);

CommentRuleSchema.index({ businessId: 1, channel: 1, active: 1 });

export default defineModel('CommentRule', CommentRuleSchema, 'comment_rules');
