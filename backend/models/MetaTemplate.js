import { Schema, defineModel } from '../db/model.js';

// A Messenger utility message template (services/metaMessaging.js): created
// on, or cloned from Meta's library into, the business's connected Facebook
// Page (POST /<PAGE_ID>/message_templates). Meta approves or rejects it
// (usually within seconds) and reports later changes through the Page's
// `message_template_status_update` webhook. Only APPROVED ones can be sent,
// and only for non-promotional updates (orders, accounts, appointments,
// events). They are the one way to message a Messenger customer outside the
// 24-hour window.
const MetaTemplateSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', index: true, required: true },
    // Only 'messenger' today: Instagram has no approved templates.
    channel: { type: String, default: 'messenger' },
    // The Page the template lives on. A business that connects another Page
    // sees these as belonging to the old Page (they can't be sent from it).
    pageId: { type: String, default: '', index: true },
    // Meta's template id (the create / clone response `id`).
    metaId: { type: String, default: '' },
    name: { type: String, required: true },
    language: { type: String, default: 'en' },
    category: { type: String, default: 'UTILITY' },
    // APPROVED | PENDING | REJECTED | PAUSED | DISABLED | DELETED
    status: { type: String, default: 'PENDING' },
    // Meta's rejection reason, e.g. TAG_SHOULD_BE_MARKETING, INCORRECT_PARAMS.
    rejectedReason: { type: String, default: '' },
    bodyText: { type: String, default: '' },
    // One sample per {{n}}, in order (what was sent to Meta as the example).
    bodyExamples: { type: [String], default: [] },
    // [{ type: 'URL' | 'PHONE_NUMBER', text, url, phone, urlExample }]
    buttons: { type: Schema.Types.Mixed, default: () => [] },
    // What fills each {{n}} at send time: [{ index, source: 'contact_name' | 'text', fallback }]
    variables: { type: Schema.Types.Mixed, default: () => [] },
    // Cloned from Meta's library: the library template's name.
    libraryTemplateName: { type: String, default: '' },
    // 'create' | 'clone' | 'meta' (found on the Page by a refresh)
    origin: { type: String, default: 'create' },
    statusCheckedAt: { type: Date },
  },
  { timestamps: true },
);

MetaTemplateSchema.index({ businessId: 1, pageId: 1, name: 1, language: 1 }, { unique: true });

export default defineModel('MetaTemplate', MetaTemplateSchema, 'meta_templates');
