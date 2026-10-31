import { Schema, defineModel } from '../db/model.js';

// One upload of CRM contacts into a Meta customer-list custom audience
// (services/metaAdsAudiences.js): creating it, or refreshing it later with the
// current contacts. The upload runs in the background; the browser polls this
// row for progress.
//
// No phone number or hash is ever stored here: only the filter that picks the
// contacts, and counts. The hashes are computed again from the Conversation
// rows when an upload runs.
//
// `runner` is the id of the backend process running the upload. After a
// restart a row still marked running/waiting belongs to a process that is
// gone, so it is shown (and saved) as 'interrupted'; the business runs
// "Refresh" again to upload the contacts once more.
const AdAudienceJobSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', index: true, required: true },
    // The ad account ('act_<id>') and the Meta custom audience id.
    adAccountId: { type: String, default: '', index: true },
    audienceId: { type: String, default: '', index: true },
    audienceName: { type: String, default: '' },
    // create | refresh
    kind: { type: String, default: 'create' },
    // add (POST /{id}/users) | replace (POST /{id}/usersreplace)
    mode: { type: String, default: 'add' },
    // Why a refresh used add instead of replace ('' when it didn't).
    fallback: { type: String, default: '' },
    // The contact filter: all | contacted | inbound, and N days for the last two.
    filter: { type: String, default: 'all' },
    days: { type: Number, default: 0 },
    // queued | running | waiting (rate limited, retrying) | done | failed | interrupted
    status: { type: String, default: 'queued' },
    // Contacts picked (hashed numbers to send), sent so far, batches.
    total: { type: Number, default: 0 },
    sent: { type: Number, default: 0 },
    batches: { type: Number, default: 0 },
    batchesDone: { type: Number, default: 0 },
    // What Meta reported for the session (num_received / num_invalid_entries).
    received: { type: Number, default: 0 },
    invalid: { type: Number, default: 0 },
    // Rows skipped before hashing: Messenger / Instagram ids, not a phone number, duplicates.
    skipped: { type: Schema.Types.Mixed, default: {} },
    // The upload session id sent to Meta (a 64-bit number, kept as text).
    sessionId: { type: String, default: '' },
    error: { type: Schema.Types.Mixed, default: null },
    runner: { type: String, default: '' },
    startedAt: { type: Date, default: null },
    heartbeatAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
  },
  { timestamps: true, minimize: false },
);

AdAudienceJobSchema.index({ businessId: 1, audienceId: 1, createdAt: -1 });

export default defineModel('AdAudienceJob', AdAudienceJobSchema, 'ad_audience_jobs');
