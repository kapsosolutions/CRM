import { Schema, defineModel } from '../db/model.js';

// Local mirror of WhatsApp message templates created from the CRM.
const TemplateSchema = new Schema(
  {
    // Owning tenant — deleting a business removes everything tagged with it.
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', index: true },
    // Unique per tenant, not globally. Template names live in a tenant's own
    // WABA, so two businesses can both have "order_confirmed" — a global unique
    // index let whichever tenant created it first own the name forever.
    name: { type: String, required: true },
    metaId: { type: String, default: '' },
    language: { type: String, default: 'en_US' },
    category: { type: String, default: 'MARKETING' }, // MARKETING | UTILITY | AUTHENTICATION
    status: { type: String, default: 'PENDING' }, // PENDING | APPROVED | REJECTED
    // Meta's reason when it rejects (or pauses) a template, e.g. INCORRECT_CATEGORY.
    rejectedReason: { type: String, default: '' },
    bodyText: { type: String, default: '' },
    headerText: { type: String, default: '' },
    headerMediaUrl: { type: String, default: '' }, // stored copy of the image/video/document header
    // TEXT | IMAGE | VIDEO | DOCUMENT ('' = no header). Needed at send time:
    // Meta wants the header parameter typed to match the template.
    headerFormat: { type: String, default: '' },
    headerFileName: { type: String, default: '' }, // shown on document headers
    footerText: { type: String, default: '' },
    components: { type: Schema.Types.Mixed },

    // 'standard' | 'carousel' | 'lto' (limited-time offer).
    kind: { type: String, default: 'standard' },
    // Carousel cards, in order. Every send has to supply each card's header
    // media again, so the stored copies are kept here.
    cards: [
      {
        mediaUrl: { type: String, default: '' },
        mediaFormat: { type: String, default: 'image' }, // image | video
        body: { type: String, default: '' },
        buttons: [
          {
            type: { type: String }, // QUICK_REPLY | URL | PHONE_NUMBER
            text: { type: String, default: '' },
            url: { type: String, default: '' },
            phone: { type: String, default: '' },
            _id: false,
          },
        ],
        _id: false,
      },
    ],
    // Limited-time offer settings. The code and end time are what get sent
    // by default; a campaign can override both per send.
    lto: {
      text: { type: String, default: '' }, // the offer label, e.g. "Expiring offer!"
      hasExpiration: { type: Boolean, default: false },
      hasCopyCode: { type: Boolean, default: false },
      code: { type: String, default: '' },
      endsAt: { type: Date, default: null },
    },

    // Authentication (one-time code) templates: what was asked of Meta. Meta
    // writes the body itself, so these settings are the template's content.
    // See services/authTemplate.js.
    auth: {
      otpType: { type: String, default: '' }, // COPY_CODE | ONE_TAP | ZERO_TAP
      addSecurityRecommendation: { type: Boolean, default: false },
      codeExpirationMinutes: { type: Number, default: null }, // 1–90, or none
      buttonText: { type: String, default: '' }, // copy-code button label ('' = Meta's default)
      autofillText: { type: String, default: '' }, // one-tap / zero-tap autofill label
      supportedApps: [
        {
          packageName: { type: String, default: '' },
          signatureHash: { type: String, default: '' },
          _id: false,
        },
      ],
      zeroTapTermsAccepted: { type: Boolean, default: false },
      messageSendTtlSeconds: { type: Number, default: null }, // 30–900, or Meta's default (10 min)
    },

    // What each {{n}} in the body means. Meta only allows positional
    // placeholders, so the meaning has to live here: index 1 -> 'customer_name'
    // and so on. Resolved at send time by services/templateVars.js.
    variables: [
      {
        index: { type: Number, required: true }, // the n in {{n}}
        source: { type: String, default: '' }, // a key from TEMPLATE_SOURCES or 'other'
        name: { type: String, default: '' }, // custom variable/column name when source is 'other'
        fallback: { type: String, default: '' }, // used when the value is blank
        _id: false,
      },
    ],

    // Send this template automatically. Both triggers are opt-in and a
    // template can use either or both.
    trigger: {
      enabled: { type: Boolean, default: false },
      // Inbound text that fires it, matched case-insensitively on the whole
      // message (so "price" fires on "Price" but not on "what is the price").
      keywords: [{ type: String }],
      // Order statuses that fire it when an order moves to one of them.
      statuses: [{ type: String }],
      // Named events that fire it. Currently 'member_unavailable' — sent to
      // every patient whose appointment a doctor's absence affects.
      events: [{ type: String }],
      // Form answers that fire it when one moves to a status: '<form id>:<status>',
      // e.g. 'pre_arrival:confirmed' (a form page's New → Confirmed).
      formStatuses: [{ type: String }],
    },
    // A FLOW button made from an Automation flow (services/updateTemplates.js):
    // { index, flowId, prefill: [field names] }. Meta wants a flow token on
    // every send, so the send builds one for the recipient from this.
    flowButton: { type: Schema.Types.Mixed, default: null },
    // Reply buttons that act on their own when tapped: [{ index, action }],
    // action 'talk' = "Talk to us" (services/talkToUs.js). Set by update templates.
    buttonActions: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true },
);

TemplateSchema.index({ businessId: 1, name: 1 }, { unique: true });

export default defineModel('Template', TemplateSchema, 'templates');
