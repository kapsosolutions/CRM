import { Schema, defineModel } from '../db/model.js';

// A form submission captured from a native WhatsApp Flow (the "Register" block
// in the flow builder, or any flow screen with input fields). Whatever fields
// the tenant put on the screen land in `fields`; the well-known ones are also
// lifted to top-level columns so the CRM can list them.
const RegistrationSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', index: true },
    phone: { type: String, index: true }, // WhatsApp number that submitted it
    name: { type: String, default: '' },
    businessName: { type: String, default: '' },
    email: { type: String, default: '' },
    date: { type: String, default: '' }, // as submitted (date picker value)
    // What the customer picked on the way to the form (category → member).
    category: { type: String, default: '' }, // resolved category name
    memberId: { type: String, default: '' }, // Member _id, when one was chosen
    memberName: { type: String, default: '' }, // resolved member name
    /**
     * The appointment time, as 'HH:MM' 24h — the slot the customer picked.
     *
     * Stored separately from `date` because it's what makes a booking a
     * booking: it's how a slot is counted as taken, and how a half-day
     * absence can tell which patients are actually affected.
     */
    slot: { type: String, default: '' },

    // What this submission did. 'cancel' means the customer cancelled an order
    // through the flow; the referenced order is recorded below. 'reschedule'
    // means an existing appointment was moved — the row that moved is updated
    // in place rather than a second booking being created, so the old slot is
    // released and the new one taken in one step.
    action: { type: String, enum: ['register', 'cancel', 'reschedule'], default: 'register' },
    orderId: { type: String, default: '' }, // Order _id
    orderRef: { type: String, default: '' }, // human reference, e.g. DVN-B2C-1AA1F8
    // Every submitted field, including ones we don't model.
    fields: { type: Schema.Types.Mixed, default: {} },
    flowId: { type: String, default: '' }, // our Flow definition id
    flowName: { type: String, default: '' },
    status: {
      type: String,
      enum: ['new', 'contacted', 'confirmed', 'done', 'cancelled'],
      default: 'new',
    },
    // When the appointment was cancelled — set by a cancel flow or by the
    // unpaid-order sweep that releases a slot a never-paid booking was holding.
    // Undeclared fields are dropped by Mongoose, so freeing a slot silently
    // failed to record when it happened without this.
    cancelledAt: { type: Date },
  },
  { timestamps: true },
);

RegistrationSchema.index({ businessId: 1, createdAt: -1 });
// The slot-availability query: this member, this date, excluding cancellations.
RegistrationSchema.index({ businessId: 1, memberId: 1, date: 1 });

export default defineModel('Registration', RegistrationSchema, 'registrations');
