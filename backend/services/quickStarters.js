// CRM starter quick messages (Templates → Template Library → "CRM starters").
//
// Instagram has no Meta template library, so the CRM ships its own set of
// ready-made quick messages for Messenger and Instagram. They are NOT Meta
// templates: "Use template" saves a copy as one of the business's quick
// messages (models/QuickMessage.js), which can then be edited, used in a
// campaign or sent from a chat, inside the 24-hour window like any other
// quick message.
//
// The quick message builder has no send-time placeholders, so the starters are
// written without {{…}} values; buttons are postbacks (no links to fill in),
// and the business edits the wording after saving if it wants to.
// Every starter fits both channels' limits (services/metaMessaging.js
// LIMITS; the starter harness check validates each one for both).

export const STARTER_CATEGORIES = [
  { key: 'greeting', label: 'Greeting / Welcome' },
  { key: 'order', label: 'Order update' },
  { key: 'appointment', label: 'Appointment reminder' },
  { key: 'offer', label: 'Offer within 24 h' },
  { key: 'feedback', label: 'Feedback request' },
  { key: 'faq', label: 'FAQ' },
];

const pb = (title, payload) => ({ type: 'postback', title, url: '', payload });
const qr = (title, payload = '') => ({ title, payload: payload || title });
const card = (title, subtitle, buttons) => ({ imageUrl: '', title, subtitle, buttons });

const base = { text: '', imageUrl: '', buttons: [], cards: [], quickReplies: [] };

export const QUICK_STARTERS = [
  { key: 'welcome_hello', category: 'greeting', name: 'Welcome message', kind: 'text', text: 'Hi there! 👋 Thanks for messaging us. How can we help you today?' },
  {
    key: 'welcome_menu', category: 'greeting', name: 'Welcome menu', kind: 'quick_replies', text: 'Welcome! What would you like to do?',
    quickReplies: [qr('See products', 'STARTER_PRODUCTS'), qr('Track my order', 'STARTER_TRACK'), qr('Talk to us', 'STARTER_TALK')],
  },
  { key: 'welcome_away', category: 'greeting', name: 'Away message', kind: 'text', text: 'Thanks for your message! Our team is away right now and will reply as soon as we’re back.' },
  {
    key: 'order_received', category: 'order', name: 'Order received', kind: 'text',
    text: 'Thanks for your order! We’ve received it and will send you an update as soon as it ships.',
    buttons: [pb('Order status', 'STARTER_ORDER_STATUS'), pb('Talk to us', 'STARTER_TALK')],
  },
  { key: 'order_shipped', category: 'order', name: 'Order on its way', kind: 'text', text: 'Good news: your order is on its way! Reply here if you have any questions about the delivery.' },
  {
    key: 'order_delivered', category: 'order', name: 'Order delivered check', kind: 'quick_replies',
    text: 'Your order has been delivered. Did everything arrive in good condition?',
    quickReplies: [qr('Yes, all good', 'STARTER_DELIVERED_OK'), qr('Something’s wrong', 'STARTER_DELIVERED_ISSUE')],
  },
  {
    key: 'appointment_reminder', category: 'appointment', name: 'Appointment reminder', kind: 'quick_replies',
    text: 'Reminder: you have an appointment with us soon. Can you make it?',
    quickReplies: [qr('Yes, I’ll be there', 'STARTER_APPT_YES'), qr('Reschedule', 'STARTER_APPT_RESCHEDULE'), qr('Cancel it', 'STARTER_APPT_CANCEL')],
  },
  {
    key: 'appointment_confirmed', category: 'appointment', name: 'Appointment confirmed', kind: 'text',
    text: 'Your appointment is confirmed. We look forward to seeing you!',
    buttons: [pb('Reschedule', 'STARTER_APPT_RESCHEDULE'), pb('Ask a question', 'STARTER_TALK')],
  },
  {
    key: 'offer_today', category: 'offer', name: 'Today’s offers', kind: 'cards',
    cards: [
      card('Today only: 10% off', 'Reply within 24 hours to claim your discount.', [pb('Claim offer', 'STARTER_OFFER_CLAIM')]),
      card('New arrivals', 'Fresh picks added this week.', [pb('Show me', 'STARTER_OFFER_NEW')]),
    ],
  },
  {
    key: 'offer_back_in_stock', category: 'offer', name: 'Back in stock', kind: 'text',
    text: 'The item you asked about is back in stock! Want us to keep one aside for you?',
    buttons: [pb('Yes, please', 'STARTER_STOCK_YES'), pb('No, thanks', 'STARTER_STOCK_NO')],
  },
  {
    key: 'feedback_rating', category: 'feedback', name: 'Rate your experience', kind: 'quick_replies', text: 'How was your experience with us today?',
    quickReplies: [qr('😍 Great', 'STARTER_RATE_5'), qr('🙂 Good', 'STARTER_RATE_4'), qr('😐 Okay', 'STARTER_RATE_3'), qr('🙁 Not good', 'STARTER_RATE_1')],
  },
  { key: 'feedback_review', category: 'feedback', name: 'Ask for feedback', kind: 'text', text: 'Thank you for choosing us! We’d love to hear your feedback: just reply to this message and tell us how we did.' },
  { key: 'faq_hours', category: 'faq', name: 'Opening hours', kind: 'text', text: 'We’re open Monday to Saturday, 10 am to 8 pm. Send us a message any time and we’ll reply during opening hours.' },
  {
    key: 'faq_topics', category: 'faq', name: 'Help topics', kind: 'cards',
    cards: [
      card('Delivery & shipping', 'Delivery times and charges', [pb('Ask about delivery', 'STARTER_FAQ_DELIVERY')]),
      card('Returns & refunds', 'How to return an item', [pb('Ask about returns', 'STARTER_FAQ_RETURNS')]),
      card('Payments', 'Ways you can pay', [pb('Ask about payment', 'STARTER_FAQ_PAYMENT')]),
    ],
  },
  {
    key: 'faq_help', category: 'faq', name: 'What do you need help with?', kind: 'quick_replies', text: 'What do you need help with?',
    quickReplies: [qr('Prices', 'STARTER_HELP_PRICES'), qr('Delivery', 'STARTER_HELP_DELIVERY'), qr('Returns', 'STARTER_HELP_RETURNS'), qr('Something else', 'STARTER_HELP_OTHER')],
  },
].map((s) => ({ ...base, ...s, channels: ['messenger', 'instagram'], language: 'en' }));

const LABEL = Object.fromEntries(STARTER_CATEGORIES.map((c) => [c.key, c.label]));

/** A starter as the gallery shows it (a deep copy, so callers can't change the constant). */
export function presentStarter(s) {
  return JSON.parse(JSON.stringify({ ...s, categoryLabel: LABEL[s.category] || s.category, source: 'crm_starter' }));
}

export const starterByKey = (key) => QUICK_STARTERS.find((s) => s.key === String(key || '')) || null;
