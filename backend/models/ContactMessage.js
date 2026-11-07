import { Schema, defineModel } from '../db/model.js';

// A message sent from the website's Contact page (kapsosolutions.com/contact).
// Not tied to a business: these are prospects and visitors. The super admin
// reads them in the admin panel (Demo Requests → Messages).
const ContactMessageSchema = new Schema(
  {
    name: { type: String, default: '' },
    email: { type: String, default: '' },
    phone: { type: String, default: '' },
    company: { type: String, default: '' },
    topic: { type: String, default: 'sales' }, // sales | support | partnership | api | other
    message: { type: String, default: '' },
    status: { type: String, enum: ['new', 'replied', 'closed'], default: 'new', index: true },
    notes: { type: String, default: '' },
    ip: { type: String, default: '' },
    page: { type: String, default: '' }, // the page it was sent from
  },
  { timestamps: true },
);

ContactMessageSchema.index({ createdAt: -1 });

export default defineModel('ContactMessage', ContactMessageSchema, 'contact_messages');
