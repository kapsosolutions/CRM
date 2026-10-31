import { Schema, defineModel } from '../db/model.js';

// One entry in the CRM's notification drawer (the bell in the top bar).
// Written by services/notifications.js from the places things happen:
// template status changes, inbound chats, finished campaigns, orders,
// bookings, payments, WhatsApp connected, sandbox customers linked.
const NotificationSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', index: true, required: true },
    // template_approved | template_rejected | template_paused | message | campaign_finished |
    // order_new | booking_new | booking_cancelled | booking_rescheduled |
    // payment_received | payment_failed | whatsapp_connected | sandbox_linked | sandbox_full |
    // plan_changed | channel_connected | channel_disconnected |
    // ads_connected | ads_disconnected | ad_lead | ad_campaign_created | ad_rejected |
    // ad_audience_ready | ad_rule_triggered | ad_test_winner
    type: { type: String, required: true },
    title: { type: String, default: '' },
    body: { type: String, default: '' },
    // Where clicking it goes: a CRM view plus the record (template name,
    // campaign id, order id) or the chat's phone.
    target: {
      view: { type: String, default: '' },
      id: { type: String, default: '' },
      phone: { type: String, default: '' },
    },
    // Rows with the same key are merged while unread ('chat:<phone>'), so a
    // burst of messages from one customer is one entry, not dozens.
    groupKey: { type: String, default: '' },
    count: { type: Number, default: 1 },
    // When it last changed (a grouped row moves up when a new message lands).
    lastAt: { type: Date, default: () => new Date() },
    readAt: { type: Date },
  },
  { timestamps: true },
);

NotificationSchema.index({ businessId: 1, lastAt: -1 });
NotificationSchema.index({ businessId: 1, readAt: 1 });
NotificationSchema.index({ businessId: 1, groupKey: 1 });

export default defineModel('Notification', NotificationSchema, 'notifications');
