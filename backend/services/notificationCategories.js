// Which Settings → Manage Notifications row a notification belongs to.
//
// Each row of that page is one category with its own "Desktop nudge" and
// "Sound" boxes. The browser gets `category` with every notification
// (notifications.present) and Web Push checks it against the device's choices
// (webPush.wantsPush), so both sides use this one table.

const BY_TYPE = {
  message: 'message',
  // A missed WhatsApp call nudges like a new message.
  call_missed: 'message',
  chat_new: 'chatNew',
  order_new: 'order',
  payment_received: 'payment',
  payment_failed: 'payment',
  booking_new: 'booking',
  booking_cancelled: 'booking',
  booking_rescheduled: 'booking',
  template_approved: 'templateApproved',
  template_rejected: 'templateRejected',
  template_paused: 'templateRejected',
  campaign_created: 'campaignCreated',
  campaign_started: 'campaignStarted',
  campaign_finished: 'campaignCompleted',
  campaign_failed: 'campaignFailed',
  campaign_cancelled: 'campaignCancelled',
  plan_changed: 'plan',
  plan_ending: 'plan',
  plan_ended: 'plan',
  ad_lead: 'ads',
  ads_connected: 'ads',
  ads_disconnected: 'ads',
  ad_campaign_created: 'ads',
  ad_rejected: 'ads',
  ad_audience_ready: 'ads',
  ad_rule_triggered: 'ads',
  ad_test_winner: 'ads',
};

export const CATEGORIES = [
  'message', 'chatNew', 'order', 'payment', 'booking', 'templateApproved', 'templateRejected',
  'campaignCreated', 'campaignStarted', 'campaignCompleted', 'campaignFailed', 'campaignCancelled',
  'plan', 'account', 'ads',
];

/** The category of a notification type. Connections, the test inbox and anything new: 'account'. */
export function categoryOf(type, title = '') {
  // Messenger templates share one type for every status.
  if (type === 'meta_template_status') return /approved/i.test(String(title)) ? 'templateApproved' : 'templateRejected';
  return BY_TYPE[type] || 'account';
}

export default { categoryOf, CATEGORIES };
