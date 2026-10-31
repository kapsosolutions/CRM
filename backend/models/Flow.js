import { Schema, defineModel } from '../db/model.js';

// A no-code native WhatsApp Flow definition built in the CRM. Stored as screens
// of components; converted to Meta Flow JSON and published on demand. One flow
// maps to one Meta flow id (metaFlowId) once created.
const FlowOptionSchema = new Schema(
  {
    id: { type: String, required: true },
    title: { type: String, required: true },
    description: { type: String, default: '' },
    image: { type: String, default: '' }, // optional 1:1 image (base64)
    nextScreen: { type: String, default: '' }, // per-option branch target
    blockId: { type: String, default: '' }, // send this message block when chosen (no screen branch)
    nextFlowId: { type: String, default: '' }, // hand off to a flow-link node (its id)
  },
  { _id: false },
);

// A flow-reference node placed on the map (hands off to another flow).
const FlowLinkSchema = new Schema(
  {
    id: { type: String, required: true },
    flowId: { type: String, default: '' },
  },
  { _id: false },
);

const FlowComponentSchema = new Schema(
  {
    cid: { type: String },
    type: { type: String, required: true }, // Image | TextHeading | ... | Footer
    src: { type: String, default: '' }, // banner image (data URL / base64)
    text: { type: String, default: '' },
    name: { type: String, default: '' },
    label: { type: String, default: '' },
    required: { type: Boolean, default: false },
    inputType: { type: String, default: 'text' },
    helperText: { type: String, default: '' },
    description: { type: String, default: '' },
    // DatePicker only: how many days ahead a date may be picked. 0/unset falls
    // back to the generator's default booking horizon. Blocks "too far" dates.
    maxDaysAhead: { type: Number, default: 0 },
    photoSource: { type: String, default: 'camera_gallery' }, // camera | gallery | camera_gallery
    maxFiles: { type: Number, default: 1 },
    // Where a selection list gets its rows: static options, or live data served
    // by the flow endpoint (catalog categories / members directory / orders).
    // Without this declared, Mongoose strict mode would silently drop it and
    // dynamic lists would publish as empty static lists.
    source: {
      type: String,
      // Every dynamic source the runtime can serve must be listed here, or
      // saving a flow that uses it fails validation rather than the component
      // simply not working — which is how `slots` first showed up as a bug.
      enum: ['static', 'categories', 'members', 'orders', 'active_orders', 'slots', 'appointments'],
      default: 'static',
    },
    // Prefill an input from runtime data ('phone' = the sender's WhatsApp
    // number) and optionally lock it so the customer can't edit it.
    prefill: { type: String, default: '' },
    locked: { type: Boolean, default: false },
    options: [FlowOptionSchema],
    buttonLabel: { type: String, default: '' },
    action: { type: String, enum: ['complete', 'navigate'], default: 'complete' },
    nextScreen: { type: String, default: '' },
    nextFlowId: { type: String, default: '' }, // hand off to another flow (chatbot-driven)
    blockId: { type: String, default: '' }, // send this message block on completion (chatbot-driven)
  },
  { _id: false },
);

// A message block the flow can hand off to (sent on completion by the chatbot).
const FlowBlockSchema = new Schema(
  {
    id: { type: String, required: true },
    kind: {
      type: String,
      // 'restart' isn't a message — it sends the conversation back to the
      // flow's entry node, as if the customer had typed "hi" again.
      // 'paymethod' is a reply-button block pre-filled with Online / COD — it
      // sends and routes identically, the labels are just editable defaults.
      // 'orderconfirm' is the order confirmation summary — a message built from
      // everything the conversation captured, with empty lines dropped.
      // 'orderdetails' reports a previously selected order (status / total /
      // reference); unlike 'orderconfirm' it never creates one.
      enum: [
        'message', 'reply', 'cta', 'call', 'location', 'list', 'template', 'payment',
        'catalog', 'pdfdoc', 'restart', 'paymethod', 'orderconfirm', 'orderdetails',
      ],
      default: 'message',
    },
    text: { type: String, default: '' },
    header: { type: String, enum: ['none', 'image', 'video', 'pdf'], default: 'none' },
    headerMediaUrl: { type: String, default: '' },
    headerFileName: { type: String, default: '' },
    buttons: [{ type: String }],
    ctaLabel: { type: String, default: '' },
    ctaUrl: { type: String, default: '' },
    callLabel: { type: String, default: '' },
    callPhone: { type: String, default: '' },
    listTitle: { type: String, default: '' },
    options: [{ type: String }],
    templateName: { type: String, default: '' },
    validTarget: { type: String, default: '' }, // location branch targets (node ids)
    invalidTarget: { type: String, default: '' },
    nextTarget: { type: String, default: '' }, // single continuation (message/cta/call/template)
    buttonTargets: [{ type: String }], // per reply-button continuation (node ids)

    // ----- PDF document block ('pdfdoc') -----
    // An A4 design laid out in the builder's PDF designer. Stored loosely since
    // the element shape is owned by the designer; rendered + hosted at send
    // time by services/pdfDoc.js with {{tokens}} filled from live data.
    pdfTemplate: { type: Schema.Types.Mixed, default: null },
    pdfFileName: { type: String, default: '' }, // may contain tokens
    // Payment (WhatsApp Pay order details via UPI)
    reference: { type: String, default: '' },
    currency: { type: String, default: 'INR' },
    items: [{ name: String, qty: Number, price: Number }],
    // ----- Payment type block ('paymethod') -----
    // Added to the cart subtotal to give the Total payable line.
    deliveryFee: { type: Number, default: 0 },
    // The generated Items / Delivery / Total payable summary above the prompt,
    // and its heading. Turn the summary off for a plain "how do you want to
    // pay?" question. Undeclared fields are dropped by Mongoose, hence these.
    showSummary: { type: Boolean, default: true },
    summaryTitle: { type: String, default: 'Payment' },
  },
  { _id: false },
);

const FlowScreenSchema = new Schema(
  {
    id: { type: String, required: true },
    title: { type: String, default: '' },
    components: [FlowComponentSchema],
    // Config for the chat message that opens this flow (interactive flow CTA).
    msgBody: { type: String, default: '' },
    msgHeader: { type: String, enum: ['none', 'image', 'video', 'pdf'], default: 'none' },
    msgHeaderMediaUrl: { type: String, default: '' },
    msgHeaderFileName: { type: String, default: '' },
    // The "nothing found" screen. A Flow picker must have at least one option,
    // so a dynamic list that comes back empty (no orders to track, no open
    // orders to cancel) makes the WhatsApp client fail with "Something went
    // wrong". The runtime shows this screen instead. Undeclared fields are
    // dropped by Mongoose, which is why it's listed here.
    emptyState: { type: Boolean, default: false },
  },
  { _id: false },
);

const FlowSchema = new Schema(
  {
    // Owning tenant — deleting a business removes everything tagged with it.
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', index: true },
    name: { type: String, required: true },
    categories: [{ type: String }], // Meta flow categories, e.g. ['OTHER']

    // ----- The chat message that opens this flow -----
    // One interactive message per flow: an optional media header, body text, a
    // small footer line and the CTA button label. Not part of the Flow JSON —
    // it's assembled at send time, so editing it needs no republish.
    cta: { type: String, default: 'Open' }, // chat button text that opens the flow
    msgHeader: { type: String, enum: ['none', 'image', 'video', 'pdf'], default: 'none' },
    msgHeaderMediaUrl: { type: String, default: '' },
    msgHeaderFileName: { type: String, default: '' },
    msgBody: { type: String, default: '' },
    msgFooter: { type: String, default: '' },
    screens: [FlowScreenSchema],
    blocks: [FlowBlockSchema],
    flowLinks: [FlowLinkSchema],
    entryTarget: { type: String, default: '' }, // Start node → flow entry node id
    positions: { type: Schema.Types.Mixed, default: {} }, // saved map layout
    metaFlowId: { type: String, default: '' },
    status: { type: String, enum: ['DRAFT', 'PUBLISHED'], default: 'DRAFT' },
  },
  { timestamps: true },
);

export default defineModel('Flow', FlowSchema, 'flows');
