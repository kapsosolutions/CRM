import { Schema, defineModel } from '../db/model.js';

// A bulk template send (Campaigns page). Sent by services/campaignRunner.js,
// so it keeps going with the browser closed and scheduled ones actually run.
// Delivery counts are not stored here: they come from the Message rows tagged
// with this campaign, which the status webhook keeps up to date.
const CampaignSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', index: true },
    name: { type: String, required: true },
    templateName: { type: String, default: '' },
    language: { type: String, default: 'en_US' },
    // 'single' | 'drip'
    type: { type: String, default: 'single' },
    // Drip only: the follow-ups after the main template, each `delayMs` after
    // the previous message to that number, stopped for a number that replies
    // when `stopOnReply`. { name, stopOnReply, steps: [{ templateName,
    // language, delayMs }] }. Per-number progress is on the recipient
    // (`drip: { next, dueAt, done, stopped, results: [...] }`).
    drip: { type: Schema.Types.Mixed, default: null },
    // The browser's id for one "Send" / "Schedule" click: the same id again
    // (a double click, a retry after a lost answer) returns the campaign
    // already created instead of making and sending a second one. No default:
    // NULL for older rows and drafts saved without one (a one-column unique
    // index allows any number of NULLs; a random id per click never repeats).
    requestId: { type: String, unique: true, index: true },
    // draft | scheduled | sending | completed | failed | cancelled
    status: { type: String, default: 'draft' },
    scheduledAt: { type: Date },
    startedAt: { type: Date },
    finishedAt: { type: Date },
    // Lease held by the runner sending it, so two runs never send twice.
    lockedUntil: { type: Date },
    lockedBy: { type: String, default: '' },
    ltoCode: { type: String, default: '' },
    ltoExpiresAt: { type: Date },
    // [{ phone, name, bodyParams, state: 'queued'|'sent'|'failed'|'skipped', metaMessageId, error }]
    // `error` is set when Meta refused the send outright (no Message row).
    // Messenger / Instagram: `phone` is the PSID / IGSID, 'skipped' means the
    // customer was outside the 24-hour window when their turn came, and `via`
    // says what went out ('quick' | 'utility').
    recipients: { type: Schema.Types.Mixed, default: () => [] },
    // '' (WhatsApp, every campaign before this field) | 'messenger' | 'instagram'
    channel: { type: String, default: '' },
    // Messenger / Instagram only (services/metaMessaging.js):
    // { mode: 'quick' | 'utility' | 'both' | 'text', quickMessageId, quickMessageName,
    //   utilityTemplateId, utilityTemplateName, utilityParams: [{ index, source, value }],
    //   text, imageUrl, confirmedNonPromotional }
    content: { type: Schema.Types.Mixed, default: null },
    // Messenger / Instagram: who was picked ({ activeDays: 0 = everyone }).
    audience: { type: Schema.Types.Mixed, default: null },
    total: { type: Number, default: 0 },
    // Why the whole campaign stopped (not connected, template not approved, credits).
    error: { type: String, default: '' },
  },
  { timestamps: true },
);

CampaignSchema.index({ businessId: 1, createdAt: -1 });
CampaignSchema.index({ status: 1, scheduledAt: 1 });


export default defineModel('Campaign', CampaignSchema, 'campaigns');
