// In-memory demo dataset so the CRM can be explored with no backend.
import type { Chat, ChatMessage, FormSubmission, TemplateItem } from '../types';

const now = Date.now();
const iso = (msAgo: number) => new Date(now - msAgo).toISOString();

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

// ---- Conversations ----
export const demoChats: Chat[] = [
  {
    phone: '919845012345',
    name: 'Priya Nair',
    lastMessageBody: '🧾 Order · 3 items',
    lastInboundAt: iso(1 * MIN),
    unread: 1,
    windowOpen: true,
    windowMsLeft: 24 * HOUR - 1 * MIN,
    botPaused: false,
  },
  {
    phone: '919876543210',
    name: 'Aarav Sharma',
    lastMessageBody: 'Perfect, thanks! 🙏',
    lastInboundAt: iso(4 * MIN),
    unread: 2,
    windowOpen: true,
    windowMsLeft: 24 * HOUR - 4 * MIN,
    botPaused: false,
  },
  {
    phone: '919840078945',
    name: 'Karthik Raja',
    lastMessageBody: '📍 Shared location',
    lastInboundAt: iso(6 * MIN),
    unread: 0,
    windowOpen: true,
    windowMsLeft: 24 * HOUR - 6 * MIN,
    botPaused: false,
  },
  {
    phone: '34666112233',
    name: 'María García',
    lastMessageBody: '📷 Photo',
    lastInboundAt: iso(38 * MIN),
    unread: 0,
    windowOpen: true,
    windowMsLeft: 24 * HOUR - 38 * MIN,
    botPaused: false,
  },
  {
    phone: '14155550142',
    name: 'John Carter',
    lastMessageBody: 'Can you send the brochure?',
    lastInboundAt: iso(2 * HOUR),
    unread: 0,
    windowOpen: true,
    windowMsLeft: 24 * HOUR - 2 * HOUR,
    botPaused: true,
  },
  {
    phone: '971501234567',
    name: 'Fatima Al Mansoori',
    lastMessageBody: 'شكراً جزيلاً',
    lastInboundAt: iso(15 * HOUR),
    unread: 1,
    windowOpen: true,
    windowMsLeft: 24 * HOUR - 15 * HOUR,
    botPaused: false,
  },
  {
    phone: '447911123456',
    name: 'Oliver Smith',
    lastMessageBody: 'Thanks for the demo!',
    lastInboundAt: iso(30 * HOUR), // > 24h → session window closed
    unread: 0,
    windowOpen: false,
    windowMsLeft: 0,
    botPaused: false,
  },
];

// A submitted ready-made form, with every kind of typed answer the CRM draws.
export const DEMO_FORM: FormSubmission = {
  flowName: 'Vehicle service request',
  rows: [
    { key: 'name', label: 'Name', value: 'Oliver Smith', type: 'text' },
    { key: 'whatsapp_number', label: 'WhatsApp number', value: '+447911123456', type: 'phone' },
    { key: 'vehicle_type', label: 'Vehicle', value: 'Car / SUV', type: 'choice' },
    { key: 'registration_no', label: 'Registration no.', value: 'TS 09 AB 1234', type: 'text' },
    { key: 'work_needed', label: 'Work needed', value: 'General service, Brakes, AC service', type: 'multi', items: ['General service', 'Brakes', 'AC service'] },
    { key: 'visit_date', label: 'Preferred date', value: '18 Oct 2026', type: 'date' },
    { key: 'stay_dates', label: 'Courtesy car', value: '18 Oct 2026 → 20 Oct 2026', type: 'daterange' },
    { key: 'rating', label: 'Last visit', value: '★★★★ Good', type: 'rating', rating: 4 },
    { key: 'issue_details', label: 'What happened?', value: 'Squeaking from the front left wheel.\nWorse when braking.', type: 'longtext' },
    {
      key: 'issue_photo', label: 'Photo of the issue', value: '2 photos', type: 'photo',
      files: [
        { url: 'https://picsum.photos/id/111/600/400', name: 'wheel.jpg', mime: 'image/jpeg' },
        { url: 'https://picsum.photos/id/133/600/400', name: 'dashboard.jpg', mime: 'image/jpeg' },
      ],
    },
    {
      key: 'policy_document', label: 'Policy document', value: '1 document', type: 'document',
      files: [{ url: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf', name: 'policy-2026.pdf', mime: 'application/pdf' }],
    },
    { key: 'consent', label: 'I agree to be contacted about this request.', value: 'Agreed', type: 'consent', agreed: true },
  ],
};

// ---- Messages per phone ----
export const demoMessages: Record<string, ChatMessage[]> = {
  // --- Catalog → order → payment flow (FMCG style) ---
  '919845012345': [
    {
      _id: 'p1', phone: '919845012345', direction: 'in', type: 'text',
      body: 'Hi, I want to order some groceries', status: 'received',
      metaMessageId: 'wamid.p1', createdAt: iso(12 * MIN),
    },
    {
      _id: 'p2', phone: '919845012345', direction: 'out', type: 'interactive',
      body: 'Welcome to Devine Natural Foods! 🛒 Browse our catalog and add items to your cart.',
      status: 'read', metaMessageId: 'wamid.p2', createdAt: iso(11 * MIN),
      raw: {
        outbound: {
          type: 'interactive',
          headerImageUrl: 'https://picsum.photos/id/292/600/300',
          body: 'Welcome to Devine Natural Foods! 🛒 Browse our catalog and add items to your cart.',
          footer: 'Tap below to view products',
          buttons: [{ text: 'View catalog', kind: 'list' }],
          cta: null,
        },
      },
    },
    // The customer picks items from the WhatsApp catalog and submits the cart.
    {
      _id: 'p3', phone: '919845012345', direction: 'in', type: 'order',
      body: '', status: 'received', metaMessageId: 'wamid.p3', createdAt: iso(2 * MIN),
      raw: {
        order: {
          currency: 'INR',
          total: 955,
          note: 'Please deliver before Friday 🙏',
          items: [
            {
              name: 'Cold Pressed Groundnut Oil', variantLabel: '1 L', qty: 2, price: 320,
              currency: 'INR', lineTotal: 640, image: 'https://picsum.photos/id/1080/80/80',
            },
            {
              name: 'Organic Jaggery', variantLabel: '500 g', qty: 1, price: 90,
              currency: 'INR', lineTotal: 90, image: 'https://picsum.photos/id/431/80/80',
            },
            {
              name: 'Sun-dried Red Chilli', variantLabel: '250 g', qty: 3, price: 75,
              currency: 'INR', lineTotal: 225, image: 'https://picsum.photos/id/326/80/80',
            },
          ],
        },
      },
    },
    // Bot replies with the payment summary + Online / COD buttons.
    {
      _id: 'p4', phone: '919845012345', direction: 'out', type: 'interactive',
      body: 'Payment\n━━━━━━━━━━━━━━\nItems        ₹955\nDelivery     FREE\nTotal payable   ₹955\n\nSelect an option below to confirm.',
      status: 'delivered', metaMessageId: 'wamid.p4', createdAt: iso(1 * MIN),
      raw: {
        outbound: {
          type: 'interactive',
          headerText: 'Your Devine Cart',
          body: 'Payment\n━━━━━━━━━━━━━━\nItems        ₹955\nDelivery     FREE\nTotal payable   ₹955\n\nSelect an option below to confirm.',
          footer: 'Devine Natural Foods',
          buttons: [
            { text: 'Pay Online', kind: 'reply' },
            { text: 'Cash on Delivery', kind: 'reply' },
          ],
          cta: null,
        },
      },
    },
    // Customer chose "Pay Online" → bot sends a WhatsApp Pay order_details message.
    {
      _id: 'p5', phone: '919845012345', direction: 'out', type: 'interactive',
      body: 'Review your items and pay securely via UPI.', status: 'delivered',
      metaMessageId: 'wamid.p5', createdAt: iso(0.5 * MIN),
      raw: {
        payment: {
          orderId: 'ORDMPGVJUW35B971856',
          currency: 'INR',
          total: 955,
          body: 'Review your items and pay securely via UPI.',
          footer: 'Powered by WhatsApp Pay',
          status: 'pending',
          items: [
            { name: 'Cold Pressed Groundnut Oil - 1 L', qty: 2, image: 'https://picsum.photos/id/1080/80/80' },
            { name: 'Organic Jaggery - 500 g', qty: 1, image: 'https://picsum.photos/id/431/80/80' },
            { name: 'Sun-dried Red Chilli - 250 g', qty: 3, image: 'https://picsum.photos/id/326/80/80' },
          ],
        },
      },
    },
  ],
  '919876543210': [
    {
      _id: 'm1', phone: '919876543210', direction: 'in', type: 'text',
      body: 'Hi! I saw your ad about the WhatsApp automation. Is it still available?',
      status: 'received', metaMessageId: 'wamid.m1', createdAt: iso(22 * MIN),
    },
    {
      _id: 'm2', phone: '919876543210', direction: 'out', type: 'text',
      body: 'Hello Aarav! Yes it is 🎉 Would you like a quick demo?',
      status: 'read', metaMessageId: 'wamid.m2', createdAt: iso(20 * MIN),
      reaction: '👍',
    },
    {
      _id: 'm3', phone: '919876543210', direction: 'out', type: 'interactive',
      body: 'Pick a time that works for you:', status: 'read', metaMessageId: 'wamid.m3',
      createdAt: iso(19 * MIN),
      raw: {
        outbound: {
          type: 'interactive', body: 'Pick a time that works for you:',
          headerText: 'Book your demo', footer: 'Kapso • WhatsApp CRM',
          buttons: [
            { text: 'Today 5 PM', kind: 'reply' },
            { text: 'Tomorrow 11 AM', kind: 'reply' },
          ],
          cta: null,
        },
      },
    },
    {
      _id: 'm4', phone: '919876543210', direction: 'in', type: 'button',
      body: 'Tomorrow 11 AM', status: 'received', metaMessageId: 'wamid.m4', createdAt: iso(10 * MIN),
    },
    {
      _id: 'm5', phone: '919876543210', direction: 'out', type: 'text',
      body: 'Booked for tomorrow 11 AM. See you then!', status: 'delivered',
      metaMessageId: 'wamid.m5', createdAt: iso(9 * MIN),
    },
    {
      _id: 'm6', phone: '919876543210', direction: 'in', type: 'text',
      body: 'Perfect, thanks! 🙏', status: 'received', metaMessageId: 'wamid.m6', createdAt: iso(4 * MIN),
    },
    // Image header + body + footer + quick-reply buttons (one interactive message).
    {
      _id: 'm7', phone: '919876543210', direction: 'out', type: 'interactive',
      body: 'Here is our starter plan. Shall we set it up for you?', status: 'read',
      metaMessageId: 'wamid.m7', createdAt: iso(3.5 * MIN),
      raw: {
        outbound: {
          type: 'interactive',
          headerImageUrl: 'https://picsum.photos/id/180/600/300',
          body: 'Here is our starter plan. Shall we set it up for you?',
          footer: 'Kapso • WhatsApp CRM',
          buttons: [
            { text: 'Yes, set it up', kind: 'reply' },
            { text: 'Tell me more', kind: 'reply' },
          ],
          cta: null,
        },
      },
    },
    // URL CTA button.
    {
      _id: 'm8', phone: '919876543210', direction: 'out', type: 'interactive',
      body: 'You can review full pricing and features on our website.', status: 'read',
      metaMessageId: 'wamid.m8', createdAt: iso(3 * MIN),
      raw: {
        outbound: {
          type: 'interactive',
          body: 'You can review full pricing and features on our website.',
          footer: 'Opens in your browser',
          cta: { text: 'View pricing', url: 'https://www.whatsapp.com' },
        },
      },
    },
    // Call CTA button.
    {
      _id: 'm9', phone: '919876543210', direction: 'out', type: 'interactive',
      body: 'Prefer to talk it through? Give us a call.', status: 'delivered',
      metaMessageId: 'wamid.m9', createdAt: iso(2.5 * MIN),
      raw: {
        outbound: {
          type: 'interactive',
          body: 'Prefer to talk it through? Give us a call.',
          buttons: [{ text: '+91 98765 43210', kind: 'call' }],
          cta: null,
        },
      },
    },
    // Flow CTA button.
    {
      _id: 'm10', phone: '919876543210', direction: 'out', type: 'interactive',
      body: 'Fill in a few details and we will tailor your demo.', status: 'sent',
      metaMessageId: 'wamid.m10', createdAt: iso(2 * MIN),
      raw: {
        outbound: {
          type: 'interactive',
          headerText: 'Personalise your demo',
          body: 'Fill in a few details and we will tailor your demo.',
          footer: 'Takes less than a minute',
          flowCta: 'Start now',
          buttons: [{ text: 'Start now', kind: 'flow' }],
          cta: null,
        },
      },
    },
  ],
  // --- Delivery location flow (restaurant style) ---
  '919840078945': [
    {
      _id: 'k1', phone: '919840078945', direction: 'in', type: 'button',
      body: 'Delivery', status: 'received', metaMessageId: 'wamid.k1', createdAt: iso(10 * MIN),
    },
    {
      _id: 'k2', phone: '919840078945', direction: 'out', type: 'interactive',
      body: 'Please share your location for accurate delivery.', status: 'read',
      metaMessageId: 'wamid.k2', createdAt: iso(9 * MIN),
      raw: {
        outbound: {
          type: 'interactive',
          headerText: '📍 Share Your Delivery Location',
          body: 'Please share your location for accurate delivery.',
          footer: 'Restaurant Automation',
          buttons: [{ text: 'Send location', kind: 'location' }],
          cta: null,
        },
      },
    },
    {
      _id: 'k3', phone: '919840078945', direction: 'in', type: 'location',
      body: '', status: 'received', metaMessageId: 'wamid.k3', createdAt: iso(6 * MIN),
      raw: {
        location: {
          latitude: 13.0827,
          longitude: 80.2707,
          name: 'Pammal, Chennai',
          address: 'Pammal Main Rd, Samaya Puram, Chennai, Tamil Nadu 600075',
        },
      },
    },
  ],
  '34666112233': [
    {
      _id: 'g1', phone: '34666112233', direction: 'in', type: 'text',
      body: 'Hola! Me interesa el servicio.', status: 'received', metaMessageId: 'wamid.g1',
      createdAt: iso(55 * MIN),
    },
    {
      _id: 'g2', phone: '34666112233', direction: 'out', type: 'text',
      body: '¡Hola María! Encantado. Aquí tienes nuestro catálogo 👇', status: 'read',
      metaMessageId: 'wamid.g2', createdAt: iso(50 * MIN),
    },
    {
      _id: 'g3', phone: '34666112233', direction: 'out', type: 'document',
      body: '', status: 'read', metaMessageId: 'wamid.g3', createdAt: iso(49 * MIN),
      raw: {
        outbound: {
          type: 'document', body: '', mediaType: 'document',
          mediaUrl: '/sample.pdf',
          filename: 'catalogo-2026.pdf',
        },
      },
    },
    {
      _id: 'g4', phone: '34666112233', direction: 'in', type: 'image',
      body: 'Este es mi local', status: 'received', metaMessageId: 'wamid.g4', createdAt: iso(38 * MIN),
      raw: {
        media: {
          url: 'https://picsum.photos/id/1060/600/400', type: 'image',
          mime: 'image/jpeg', caption: 'Este es mi local',
        },
      },
    },
  ],
  '14155550142': [
    {
      _id: 'j1', phone: '14155550142', direction: 'in', type: 'text',
      body: 'Hey, do you offer this in the US?', status: 'received', metaMessageId: 'wamid.j1',
      createdAt: iso(3 * HOUR),
    },
    {
      _id: 'j2', phone: '14155550142', direction: 'out', type: 'text',
      body: 'Absolutely, John. We support WhatsApp Cloud API worldwide.', status: 'read',
      metaMessageId: 'wamid.j2', createdAt: iso(2.5 * HOUR),
    },
    {
      _id: 'j3', phone: '14155550142', direction: 'in', type: 'text',
      body: 'Can you send the brochure?', status: 'received', metaMessageId: 'wamid.j3',
      createdAt: iso(2 * HOUR),
    },
    // Document-header rich message: PDF attached above a titled body + button.
    {
      _id: 'j4', phone: '14155550142', direction: 'out', type: 'interactive',
      body: 'Please review the attached brochure for full plans and pricing.',
      status: 'read', metaMessageId: 'wamid.j4', createdAt: iso(1.9 * HOUR),
      raw: {
        outbound: {
          type: 'interactive',
          headerDocName: 'kapso_brochure_2026.pdf',
          headerDocUrl: '/sample.pdf',
          headerDocSize: 'PDF • 240 kB',
          headerText: 'Kapso Starter Plan',
          body: 'Please review the attached brochure for full plans and pricing.\n\nTap Talk to sales below for a personalised quote.',
          footer: 'Kapso • WhatsApp CRM',
          buttons: [{ text: 'Talk to sales', kind: 'reply' }],
          cta: null,
        },
      },
    },
  ],
  '971501234567': [
    {
      _id: 'f1', phone: '971501234567', direction: 'out', type: 'text',
      body: 'Welcome! How can we help you today?', status: 'read', metaMessageId: 'wamid.f1',
      createdAt: iso(16 * HOUR),
    },
    {
      // Voice note (PTT) → mic icon.
      _id: 'f2', phone: '971501234567', direction: 'in', type: 'audio',
      body: '', status: 'received', metaMessageId: 'wamid.f2', createdAt: iso(15.5 * HOUR),
      raw: {
        media: {
          url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-audio/t-rex-roar.mp3',
          type: 'audio', mime: 'audio/ogg', voice: true,
        },
      },
    },
    {
      // Audio file → headphones icon.
      _id: 'f2b', phone: '971501234567', direction: 'in', type: 'audio',
      body: '', status: 'received', metaMessageId: 'wamid.f2b', createdAt: iso(15.3 * HOUR),
      raw: {
        media: {
          url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-audio/t-rex-roar.mp3',
          type: 'audio', mime: 'audio/mpeg', filename: 'song.mp3', voice: false,
        },
      },
    },
    {
      _id: 'f3', phone: '971501234567', direction: 'in', type: 'text',
      body: 'شكراً جزيلاً', status: 'received', metaMessageId: 'wamid.f3', createdAt: iso(15 * HOUR),
    },
  ],
  '447911123456': [
    {
      _id: 'o1', phone: '447911123456', direction: 'in', type: 'text',
      body: 'Thanks for the demo!', status: 'received', metaMessageId: 'wamid.o1',
      createdAt: iso(30 * HOUR),
    },
    {
      _id: 'o2', phone: '447911123456', direction: 'out', type: 'text',
      body: 'You are welcome, Oliver! Reach out anytime. 😊', status: 'read',
      metaMessageId: 'wamid.o2', createdAt: iso(29.5 * HOUR),
    },
    // A ready-made form filled in on WhatsApp: every kind of answer.
    {
      _id: 'o3', phone: '447911123456', direction: 'in', type: 'flow_reply',
      body: '📝 Vehicle service request', status: 'received', metaMessageId: 'wamid.o3',
      createdAt: iso(29 * HOUR),
      raw: { form: DEMO_FORM },
    },
  ],
};

// ---- Templates ----
export const demoTemplates: TemplateItem[] = [
  {
    name: 'demo_followup',
    status: 'APPROVED',
    language: 'en_US',
    category: 'MARKETING',
    components: [
      { type: 'HEADER', format: 'TEXT', text: 'A quick follow-up 👋' },
      { type: 'BODY', text: 'Hi! Just checking in to see if you had any questions about our WhatsApp CRM. Happy to help!' },
      { type: 'FOOTER', text: 'Reply STOP to opt out' },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'URL', text: 'Visit website' },
          { type: 'QUICK_REPLY', text: 'Talk to us' },
        ],
      },
    ],
  },
  {
    name: 'welcome_offer',
    status: 'APPROVED',
    language: 'en_US',
    category: 'MARKETING',
    headerMediaUrl: 'https://picsum.photos/id/180/600/300',
    components: [
      { type: 'HEADER', format: 'IMAGE' },
      { type: 'BODY', text: 'Welcome aboard! 🎉 Enjoy 20% off your first month with code WELCOME20.' },
      { type: 'FOOTER', text: 'Limited time offer' },
      { type: 'BUTTONS', buttons: [{ type: 'URL', text: 'Claim offer' }] },
    ],
  },
  {
    name: 'login_code',
    status: 'APPROVED',
    language: 'en_US',
    category: 'AUTHENTICATION',
    components: [
      { type: 'BODY', text: '*{{1}}* is your verification code. For your security, do not share this code.' },
      { type: 'FOOTER', text: 'This code expires in 10 minutes.' },
      { type: 'BUTTONS', buttons: [{ type: 'OTP', text: 'Copy code' }] },
    ],
    auth: {
      otpType: 'COPY_CODE', addSecurityRecommendation: true, codeExpirationMinutes: 10, buttonText: 'Copy code',
      autofillText: '', supportedApps: [], zeroTapTermsAccepted: false, messageSendTtlSeconds: null,
    },
  },
  {
    name: 'appointment_reminder',
    status: 'PENDING',
    language: 'en_US',
    category: 'UTILITY',
    components: [
      { type: 'BODY', text: 'Reminder: your demo is scheduled for tomorrow at 11 AM. See you then!' },
    ],
  },
];
