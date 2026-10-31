import { Schema, defineModel } from '../db/model.js';

// Fulfilment record (order or booking). Also feeds a flow's dynamic "Orders"
// list so a customer can pick a past order to track / reorder.
const OrderLineSchema = new Schema(
  {
    name: { type: String, required: true },
    qty: { type: Number, default: 1 },
    price: { type: Number, default: 0 },
    // The product photo for this line, so the CRM's payment card and order
    // views can show a thumbnail like WhatsApp does.
    image: { type: String, default: '' },
  },
  { _id: false },
);

const OrderSchema = new Schema(
  {
    // Owning tenant — deleting a business removes everything tagged with it.
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', index: true },
    reference: { type: String, index: true },
    kind: { type: String, enum: ['order', 'booking'], default: 'order' },
    customerName: { type: String, default: '' },
    phone: { type: String, index: true },
    items: [OrderLineSchema],
    total: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['pending', 'confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled'],
      default: 'pending',
    },
    scheduledAt: { type: Date },
    // Appointment details for a booking, kept ON the order so a confirmation
    // sent *after* online payment can still show them. That confirmation is
    // driven by the payment webhook — a separate request minutes later with
    // none of the live flow answers in hand — so anything not stored here
    // dropped out of the message ({{member}}, the date and the time all went
    // blank). The slot's date/time live in scheduledAt; these are the rest.
    member: { type: String, default: '' }, // who the booking is with
    gender: { type: String, default: '' },
    age: { type: String, default: '' },
    // What the customer chose on the way through the flow. Captured when an
    // order is confirmed so the business sees it in the Orders list, and so a
    // confirmation document can quote it back. Undeclared fields are silently
    // dropped by Mongoose, which is why each one is listed here.
    paymentMethod: { type: String, default: '' }, // the button they tapped, e.g. "COD"
    deliveryFee: { type: Number, default: 0 },
    deliveryAddress: { type: String, default: '' },
    locationUrl: { type: String, default: '' }, // maps link for the shared pin
    // The pin itself, so the CRM can draw a map rather than only link out.
    locationLat: { type: Number },
    locationLng: { type: Number },
    category: { type: String, default: '' },
    // Whether the customer has paid — surfaced on receipts / cancellation PDFs.
    paid: { type: Boolean, default: false },

    /**
     * Native WhatsApp Pay state for this order.
     *
     * `flowId` + `blockId` record which payment block asked for the money, so
     * the status webhook — which arrives minutes later as a separate request
     * carrying only a reference_id — can resume the conversation at the right
     * place instead of guessing.
     */
    payment: {
      status: {
        type: String,
        enum: ['none', 'pending', 'paid', 'failed'],
        default: 'none',
      },
      ref: { type: String, default: '' }, // gateway transaction id
      flowId: { type: String, default: '' },
      blockId: { type: String, default: '' },
      requestedAt: { type: Date },
      settledAt: { type: Date },
    },
    // Stamped when an order is cancelled (e.g. from a cancel flow) so documents
    // can show the cancellation date.
    cancelledAt: { type: Date },
    // The appointment (Registration) this booking order was created for. A
    // booking stores the appointment on two rows that otherwise aren't linked;
    // without this, a reschedule that moves the Registration couldn't find the
    // order to move with it (date matching breaks once they drift apart).
    registrationId: { type: String, default: '', index: true },
  },
  { timestamps: true },
);

export default defineModel('Order', OrderSchema, 'orders');
