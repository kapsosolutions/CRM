import { Schema, defineModel } from '../db/model.js';

// A "Book a demo" request from the public landing page. Not tenant-owned:
// these are prospects, managed by the platform owner in the admin panel.
const DemoRequestSchema = new Schema(
  {
    name: { type: String, required: true },
    businessName: { type: String, required: true },
    email: { type: String, required: true, index: true },
    phone: { type: String, required: true }, // WhatsApp number, digits incl. country code
    category: { type: String, default: 'other' },

    // The booked slot. `date` + `slot` are the wall-clock values the visitor
    // picked (in `timezone`); `scheduledAt` is the same moment as a real
    // timestamp, for sorting and "today" filtering.
    date: { type: String, required: true, index: true }, // 'YYYY-MM-DD'
    slot: { type: String, required: true }, // 'HH:MM', 24h
    timezone: { type: String, default: 'Asia/Kolkata' },
    scheduledAt: { type: Date, index: true },

    status: {
      type: String,
      enum: ['scheduled', 'completed', 'not_answered', 'not_interested', 'cancelled'],
      default: 'scheduled',
      index: true,
    },
    notes: { type: String, default: '' }, // the admin's call notes
    statusChangedAt: { type: Date },
    source: { type: String, default: 'landing' },
  },
  { timestamps: true },
);

DemoRequestSchema.index({ date: 1, slot: 1 });

export default defineModel('DemoRequest', DemoRequestSchema, 'demo_requests');
