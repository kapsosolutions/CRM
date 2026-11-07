import { Schema, defineModel } from '../db/model.js';

// An event theme (Diwali, New Year, a sale…) the super admin sets up in the
// admin panel → Events. While one is live it decorates the website (hero
// backgrounds, hero text, logo, the floating WhatsApp button) and the CRM
// (sidebar logo for light / dark, an announcement bar). services/siteEvents.js
// cleans the `theme` object and decides which event is live.
const SiteEventSchema = new Schema(
  {
    name: { type: String, default: '' },
    // Switched on by the admin. At most one event is on at a time.
    active: { type: Boolean, default: false, index: true },
    // Optional window: an event that is on only shows between these.
    startsAt: { type: Date, default: null },
    endsAt: { type: Date, default: null },
    theme: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, minimize: false },
);

SiteEventSchema.index({ updatedAt: -1 });

export default defineModel('SiteEvent', SiteEventSchema, 'site_events');
