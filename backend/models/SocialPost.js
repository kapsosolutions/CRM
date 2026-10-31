import { Schema, defineModel } from '../db/model.js';

// A post the business published (or scheduled) from Create: one row for every
// target it goes to (the connected Facebook Page, the Instagram account, or
// both). services/socialPublish.js publishes it; the scheduler there picks up
// rows whose time has come, under a lease (lockedBy + lockedUntil) so two
// ticks never publish the same row twice.
const SocialPostSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', index: true, required: true },
    // 'post' (text / one photo) | 'carousel' (2–10 photos or videos) | 'video'
    // (Facebook only) | 'reel' | 'story'
    kind: { type: String, enum: ['post', 'carousel', 'video', 'reel', 'story'], required: true },
    // 'facebook' | 'instagram'
    targets: { type: [String], default: [] },
    caption: { type: String, default: '' },
    // [{ url, type: 'image' | 'video', width, height }] — public CDN URLs in
    // the business's own storage folder (Meta fetches them from there).
    media: { type: Schema.Types.Mixed, default: () => [] },
    // When it goes out. Set to the creation time for "Publish now".
    scheduledAt: { type: Date, index: true },
    // 'scheduled' (waiting) | 'publishing' | 'published' | 'partial' (one
    // target failed) | 'failed'
    status: { type: String, default: 'scheduled', index: true },
    // Per target: { state: 'pending' | 'children' | 'processing' | 'published'
    // | 'failed', id, permalink, error: { code, message }, containerId,
    // childIds, videoId, attempts, startedAt, publishedAt }
    results: { type: Schema.Types.Mixed, default: () => ({}) },
    // The next time a target that is still processing at Meta is checked.
    nextCheckAt: { type: Date, default: null },
    publishedAt: { type: Date, default: null },
    lockedBy: { type: String, default: '' },
    lockedUntil: { type: Date, default: null },
  },
  { timestamps: true, minimize: false },
);

SocialPostSchema.index({ businessId: 1, createdAt: -1 });
SocialPostSchema.index({ status: 1, scheduledAt: 1 });

export default defineModel('SocialPost', SocialPostSchema, 'social_posts');
