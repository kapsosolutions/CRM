// What each Product page says (/product/<slug>). Only what the CRM really does.
import type { PlanFeature } from '../../crm/types';
import type { ProductSlug } from '../siteMeta';

export interface Feature { icon: string; title: string; text: string }
export interface Faq { q: string; a: string }
export interface ChatLine { out?: boolean; text: string; button?: string }

export interface ProductContent {
  slug: ProductSlug;
  icon: string;
  eyebrow: string;
  /** The h1; the part in *stars* is green. */
  title: string;
  lead: string;
  points: string[];
  chat: ChatLine[];
  features: Feature[];
  steps: { title: string; text: string }[];
  faqs: Faq[];
  /** The plan feature it needs (for "Included from …"). */
  plan?: PlanFeature | 'carousel' | 'lto' | 'authTemplates';
  soon?: boolean;
  related: ProductSlug[];
}

export const PRODUCTS: ProductContent[] = [
  {
    slug: 'team-inbox',
    icon: 'inbox',
    eyebrow: 'Team inbox',
    title: 'One WhatsApp number, *your whole team* replying',
    lead: 'Every customer chat in one shared inbox, open in any browser. Your team sees each conversation live, picks up where a colleague left off, and no message is stuck on someone’s phone again.',
    points: ['Unlimited contacts on every plan', 'Full chat history with media, orders and form answers', 'Bot or manual per chat: switch the chatbot off when a person takes over'],
    chat: [
      { text: 'Hi, is the 2 BHK still available?' },
      { out: true, text: 'Yes! Would you like to visit this Saturday?' },
      { text: 'Saturday 11 am works 👍' },
      { out: true, text: 'Booked. See you then, Priya.' },
    ],
    features: [
      { icon: 'forum', title: 'Every chat in one place', text: 'Text, photos, videos, voice notes, documents, locations, polls and events, exactly as the customer sent them.' },
      { icon: 'smart_toy', title: 'Bot or person', text: 'The chatbot answers first. One tap pauses it for that chat while your team takes over.' },
      { icon: 'reply_all', title: 'Templates in the chat', text: 'Approved templates are a click away, with the 24-hour reply window shown on every chat.' },
      { icon: 'notifications', title: 'Alerts that reach you', text: 'Desktop notifications, an unread count and a bell for new orders, bookings and messages.' },
      { icon: 'block', title: 'Block, mute and favourites', text: 'Keep the inbox clean: block spam, mute noisy chats and pin the customers who matter.' },
      { icon: 'history', title: 'Context on every customer', text: 'Their orders, bookings and form answers sit beside the chat, so nobody asks twice.' },
    ],
    steps: [
      { title: 'Connect your number', text: 'Sign up and connect your WhatsApp number through Meta’s official signup in a few minutes.' },
      { title: 'Open it anywhere', text: 'Your team signs in from any computer or phone browser and sees every chat in real time.' },
      { title: 'Reply together', text: 'Answer, hand over to the bot, or send a template when the 24-hour window has closed.' },
    ],
    faqs: [
      { q: 'Can I keep using WhatsApp on my phone?', a: 'Your number moves to the WhatsApp Business API, which works through the CRM. Your team answers from any browser instead of one phone.' },
      { q: 'Is there a limit on contacts?', a: 'No. Every plan includes unlimited contacts and chats.' },
    ],
    plan: 'chats',
    related: ['chatbot', 'templates', 'whatsapp-calling'],
  },
  {
    slug: 'broadcast',
    icon: 'campaign',
    eyebrow: 'WhatsApp broadcast',
    title: 'Campaigns that land in the *one app everyone opens*',
    lead: 'Send approved WhatsApp templates to your customer lists, now or on a schedule, add drip follow-ups, and see exactly who received, read and replied.',
    points: ['Upload a list or pick contacts from the CRM', 'Schedule for later, or add timed follow-ups (drip)', 'Delivered, read, replied and failed, per message'],
    chat: [
      { out: true, text: '🎉 Weekend sale! 20% off every kurta till Sunday.\nShow this message at the store.', button: 'Shop now' },
      { text: 'Is the blue one in M size?' },
      { out: true, text: 'Yes, we have it. Shall I keep one for you?' },
    ],
    features: [
      { icon: 'group_add', title: 'Your lists, your way', text: 'Upload a spreadsheet or choose contacts in the CRM. Personalise each message with the contact’s name and your own fields.' },
      { icon: 'schedule_send', title: 'Now, later or as a drip', text: 'Send at once, schedule a date and time, or add follow-ups that go out after hours or days, and stop when someone replies.' },
      { icon: 'insights', title: 'Real stats', text: 'Delivered, read, replied and failed counts with Meta’s reason for every failure.' },
      { icon: 'speed', title: 'Fast and safe sending', text: 'Up to 40 messages a second depending on your plan, with automatic retries when WhatsApp asks to slow down.' },
      { icon: 'content_copy', title: 'Never sent twice', text: 'Every message is recorded before it goes out, so a restart or a double click never messages someone twice.' },
      { icon: 'image', title: 'Rich templates', text: 'Images, videos, documents, buttons, carousels and limited-time offers with a countdown.' },
    ],
    steps: [
      { title: 'Pick an approved template', text: 'Create it in the CRM or start from Meta’s template library. Meta reviews it, usually within minutes.' },
      { title: 'Choose who gets it', text: 'Upload your list or pick contacts, and fill in each person’s details.' },
      { title: 'Send or schedule', text: 'Send now, schedule it, or add a drip, then watch the results come in.' },
    ],
    faqs: [
      { q: 'How many campaigns can I send?', a: 'Starter includes 10 campaigns a month, Basic 25, Pro 50 and Premium is unlimited. Each campaign can go to as many people as your WhatsApp number’s daily limit allows.' },
      { q: 'Who pays for the messages?', a: 'Meta charges per message (marketing, utility or authentication) directly to your WhatsApp account. See our WhatsApp pricing guide for the current rates.' },
    ],
    plan: 'campaigns',
    related: ['templates', 'notifications', 'click-to-whatsapp-ads'],
  },
  {
    slug: 'chatbot',
    icon: 'account_tree',
    eyebrow: 'No-code chatbot',
    title: 'A WhatsApp chatbot you build by *dragging boxes*',
    lead: 'Journeys answer your customers day and night: menus, buttons, lists, photos, locations and templates, wired together on a canvas. No code.',
    points: ['Reply buttons, list menus, links, call buttons and carousels', 'Keyword replies: “price”, “menu”, “timings”…', 'Every plan includes journeys'],
    chat: [
      { text: 'Hi' },
      { out: true, text: 'Welcome to Spice Garden 🌶️ How can we help?', button: 'Order food · Book a table · Talk to us' },
      { text: 'Book a table' },
      { out: true, text: 'For how many people?' },
    ],
    features: [
      { icon: 'hub', title: 'Visual journey builder', text: 'Drag messages, buttons, lists and media onto a canvas and connect them. See the whole conversation at a glance.' },
      { icon: 'touch_app', title: 'Every interactive message', text: 'Reply buttons, list menus, call-to-action links, call buttons, location requests and swipeable carousels.' },
      { icon: 'key', title: 'Keyword replies', text: 'Send a template automatically when a customer writes a keyword, like “price list” or “menu”.' },
      { icon: 'person', title: 'Hand over to a person', text: 'Pause the bot for a chat in one tap; it never talks over your team.' },
      { icon: 'shield', title: 'Built-in brakes', text: 'A chat that floods the bot gets a short pause, so WhatsApp’s rate limits and your quality rating stay safe.' },
      { icon: 'share', title: 'Instagram & Messenger too', text: 'Journeys can answer Instagram and Messenger once those channels are switched on.' },
    ],
    steps: [
      { title: 'Add the first message', text: 'Start with what customers get when they write in: a welcome with buttons or a menu.' },
      { title: 'Wire the replies', text: 'Each button or list row leads to the next message. Add media, links and templates where you need them.' },
      { title: 'Switch it on', text: 'New chats get the journey straight away. Edit it any time; changes apply at once.' },
    ],
    faqs: [
      { q: 'Do I need to code?', a: 'No. Everything is built by dragging and connecting boxes.' },
      { q: 'What is the difference with WhatsApp Flows?', a: 'Journeys are a conversation of messages and buttons. WhatsApp Flows are native forms that open inside WhatsApp (bookings, sign-ups, orders). Journeys are on every plan; Flows come with Basic and up.' },
    ],
    plan: 'journeys',
    related: ['whatsapp-flows', 'team-inbox', 'notifications'],
  },
  {
    slug: 'whatsapp-flows',
    icon: 'dynamic_form',
    eyebrow: 'WhatsApp Flows',
    title: 'Forms that open *inside WhatsApp*',
    lead: 'Bookings, sign-ups, orders and surveys as native WhatsApp screens: dropdowns, date pickers and checkboxes your customers fill in without leaving the chat.',
    points: ['Built visually: screens, fields and branches', 'Live data: your doctors, categories and free slots', 'Every answer saved in the CRM'],
    chat: [
      { out: true, text: 'Book your appointment in a few taps 👇', button: 'Book now' },
      { text: '✓ Appointment request sent\nDr. Asha Rao · Mon 10:30 am' },
      { out: true, text: 'Confirmed! We’ll remind you the day before.' },
    ],
    features: [
      { icon: 'view_carousel', title: 'Screens and fields', text: 'Text inputs, dropdowns, radio buttons, checkboxes, date pickers and images, arranged across screens.' },
      { icon: 'sync', title: 'Live options', text: 'Lists fill from the CRM when the customer opens them: your categories, members and their free time slots.' },
      { icon: 'alt_route', title: 'Branches', text: 'Different screens for different answers, and the chat continues on the right path after the form is sent.' },
      { icon: 'fact_check', title: 'Answers in the CRM', text: 'Each submission is filed on the customer, with orders and bookings created for you.' },
    ],
    steps: [
      { title: 'Design the screens', text: 'Add fields and screens in the builder, or start from a ready-made form for your business type.' },
      { title: 'Publish to WhatsApp', text: 'One click publishes the Flow to Meta from your own WhatsApp account.' },
      { title: 'Send it', text: 'Send it from a chat or let the automation open it. Answers arrive in the CRM.' },
    ],
    faqs: [
      { q: 'Which plan includes WhatsApp Flows?', a: 'Basic, Pro and Premium. Starter includes journeys (basic automation) without native Flows.' },
      { q: 'Does my number need anything special?', a: 'Meta opens Flows to numbers that can message at least 2,000 customers a day. Your messaging limit grows on its own as you message more customers.' },
    ],
    plan: 'flows',
    related: ['chatbot', 'appointments', 'catalog'],
  },
  {
    slug: 'catalog',
    icon: 'storefront',
    eyebrow: 'WhatsApp catalog',
    title: 'Your shop, *inside WhatsApp*',
    lead: 'Your products in the WhatsApp catalog with photos, sizes and prices. Customers browse, add to cart and order without leaving the chat, and every order lands in the CRM.',
    points: ['Sizes, options and photos per product', 'Offers with a struck-through price', 'Orders with status updates sent automatically'],
    chat: [
      { out: true, text: '🛒 Fresh from the farm today', button: 'View catalog' },
      { text: '🧺 Cart: 2 × Alphonso mangoes (1 kg)\n1 × Organic honey' },
      { out: true, text: 'Order SG-261201-A3F19C placed!\nTotal ₹1,240 · Delivery today' },
    ],
    features: [
      { icon: 'inventory_2', title: 'Products and variants', text: 'Sizes and options, each with its own price, photos and delivery charge. Pause an item or mark it sold out in a click.' },
      { icon: 'category', title: 'Categories', text: 'Group products so customers find them fast, in WhatsApp and on your website through the API.' },
      { icon: 'local_offer', title: 'Offers', text: 'Discounts by percent or amount on chosen items, with start and end dates.' },
      { icon: 'receipt_long', title: 'Orders', text: 'Every cart becomes an order with a reference, the customer’s address and location, and status updates.' },
      { icon: 'sync', title: 'Synced to Meta', text: 'The CRM keeps your WhatsApp catalog in step whenever you change a product.' },
      { icon: 'code', title: 'On your website too', text: 'The Catalog API shows the same products and offers on your own website.' },
    ],
    steps: [
      { title: 'Connect a catalog', text: 'Link your Meta catalog in one step from the CRM.' },
      { title: 'Add your products', text: 'Add them in the CRM; they sync to WhatsApp automatically.' },
      { title: 'Take orders', text: 'Customers order from the chat; you see and update every order in one place.' },
    ],
    faqs: [
      { q: 'Which plan includes the catalog?', a: 'Basic, Pro and Premium.' },
      { q: 'Can customers pay in WhatsApp?', a: 'Yes, with payment configuration you can collect payments in the chat or offer cash on delivery.' },
    ],
    plan: 'catalog',
    related: ['payments', 'notifications', 'broadcast'],
  },
  {
    slug: 'payments',
    icon: 'payments',
    eyebrow: 'Payments',
    title: 'Get paid *in the same chat*',
    lead: 'Send the order with a pay button, let the customer pay with UPI or your payment gateway, and confirm the order automatically when the money arrives.',
    points: ['Pay in WhatsApp or cash on delivery', 'The amount is checked before an order counts as paid', 'Unpaid orders are released after a timeout'],
    chat: [
      { out: true, text: 'Order NAI-261201-7C2D11\n2 × Chicken Biryani · ₹560', button: 'Review and pay' },
      { text: '✅ Paid ₹560' },
      { out: true, text: 'Payment received! Your order is being prepared 🍛' },
    ],
    features: [
      { icon: 'account_balance_wallet', title: 'Payment in the chat', text: 'WhatsApp’s order and payment messages, with your configured payment provider.' },
      { icon: 'verified', title: 'Checked payments', text: 'An order is marked paid only when the amount matches; a late or repeated update can’t undo it.' },
      { icon: 'timer', title: 'Timeouts', text: 'Orders and booked slots that are never paid are released automatically after the time you set.' },
      { icon: 'receipt', title: 'Confirmations and receipts', text: 'The customer gets the confirmation, with a PDF receipt if you add one to the journey.' },
    ],
    steps: [
      { title: 'Configure payments', text: 'Set up your payment details once in Payment configuration.' },
      { title: 'Add a pay step', text: 'Add payment to your order or booking journey.' },
      { title: 'Get paid', text: 'Paid orders are confirmed automatically, and you’re notified.' },
    ],
    faqs: [
      { q: 'Which plan includes payments?', a: 'Payment configuration is part of Basic, Pro and Premium.' },
    ],
    plan: 'payment-config',
    related: ['catalog', 'appointments', 'notifications'],
  },
  {
    slug: 'appointments',
    icon: 'event_available',
    eyebrow: 'Appointments & bookings',
    title: 'Bookings with *live free slots*, on WhatsApp',
    lead: 'Customers pick a doctor, stylist, trainer or room and a time that’s actually free. You set working hours, breaks and absences once; WhatsApp, your website and the CRM all use the same slots.',
    points: ['Per-day hours with breaks, and slot length', 'Absences tell booked customers automatically', 'Reschedule and cancel from WhatsApp'],
    chat: [
      { out: true, text: 'Choose a doctor', button: 'Dr. Asha Rao · Cardiology' },
      { out: true, text: 'Free times on Monday:', button: '10:00 am · 10:30 am · 11:30 am' },
      { text: '10:30 am' },
      { out: true, text: 'Booked ✅ Mon 10:30 am with Dr. Asha Rao' },
    ],
    features: [
      { icon: 'groups', title: 'Your people or rooms', text: 'Doctors, stylists, trainers, rooms or tables, named the way your business names them, with fees and photos.' },
      { icon: 'schedule', title: 'Real availability', text: 'Working windows per day, slot length and how many people fit in a slot. Booked and past times never show.' },
      { icon: 'event_busy', title: 'Absences', text: 'Mark a day or a few hours off; customers already booked are told automatically.' },
      { icon: 'update', title: 'Reschedule and cancel', text: 'Customers move or cancel their booking from WhatsApp, and the slot frees up.' },
      { icon: 'list_alt', title: 'Appointments list', text: 'Every booking with its time, customer and payment, in one list.' },
      { icon: 'code', title: 'Bookings API', text: 'Show free slots and take bookings on your own website too.' },
    ],
    steps: [
      { title: 'Add who can be booked', text: 'Add your doctors, stylists or rooms with their hours.' },
      { title: 'Use the booking journey', text: 'Start from the booking flow made for your business type.' },
      { title: 'Customers book', text: 'They pick a free time on WhatsApp; you see it in Appointments.' },
    ],
    faqs: [
      { q: 'Can two people book the same slot?', a: 'Only if you allow it: set how many people fit in one slot. Once it’s full, the time disappears for everyone.' },
      { q: 'Which plan includes appointments?', a: 'Members and orders (appointments) are part of Basic, Pro and Premium.' },
    ],
    plan: 'members',
    related: ['whatsapp-flows', 'notifications', 'payments'],
  },
  {
    slug: 'notifications',
    icon: 'notifications_active',
    eyebrow: 'Automatic notifications',
    title: 'The updates customers want, *sent for you*',
    lead: 'Order confirmed, out for delivery, appointment tomorrow: choose a template once and the CRM sends it whenever that happens.',
    points: ['Order status updates', 'Booking confirmations and changes', 'From your own systems with the Messaging API'],
    chat: [
      { out: true, text: 'Hi Ravi, your order #1042 is out for delivery 🚚\nArriving by 6 pm today.' },
      { text: 'Thanks!' },
    ],
    features: [
      { icon: 'local_shipping', title: 'Order updates', text: 'Pick a template for each order status; it goes out when you change the status in the CRM.' },
      { icon: 'event', title: 'Booking messages', text: 'Confirmations, reschedules and absences reach the customer automatically.' },
      { icon: 'webhook', title: 'From your apps', text: 'Your own website, billing or delivery system can send any approved template through the API.' },
      { icon: 'rule', title: 'Only approved templates', text: 'Automatic sends only use templates Meta approved, so they’re delivered outside the 24-hour window.' },
    ],
    steps: [
      { title: 'Create a utility template', text: 'Write the update with placeholders like the order number.' },
      { title: 'Choose when it sends', text: 'Set it to an order status or event in the template’s auto-send.' },
      { title: 'Done', text: 'Customers get the update each time it happens.' },
    ],
    faqs: [
      { q: 'Do automatic messages cost money?', a: 'They are utility templates, which Meta charges at its utility rate. Replies within 24 hours of a customer’s message are service messages.' },
    ],
    plan: 'templates',
    related: ['templates', 'catalog', 'appointments'],
  },
  {
    slug: 'whatsapp-calling',
    icon: 'call',
    eyebrow: 'WhatsApp calling',
    title: 'Talk to customers *with one tap*',
    lead: 'Answer customers’ WhatsApp calls and call them back from the CRM, right next to the chat, on your business number.',
    points: ['Incoming and outgoing voice calls', 'Ask permission to call, the way WhatsApp requires', 'Call history in the chat'],
    chat: [
      { text: 'Can someone call me about the order?' },
      { out: true, text: '📞 Calling you now…' },
      { out: true, text: 'Voice call · 3 min' },
    ],
    features: [
      { icon: 'phone_in_talk', title: 'Answer from the browser', text: 'Incoming WhatsApp calls ring in the CRM for your team.' },
      { icon: 'phone_forwarded', title: 'Call customers', text: 'Call customers who gave permission, from the chat header.' },
      { icon: 'schedule', title: 'Calling hours', text: 'Set when calls are taken; outside them customers see your hours.' },
    ],
    steps: [
      { title: 'Turn on calling', text: 'Switch it on in Channel Status and set your hours.' },
      { title: 'Take calls', text: 'Calls ring in the CRM; answer from any browser.' },
      { title: 'Call back', text: 'Ask permission in the chat, then call with one tap.' },
    ],
    faqs: [
      { q: 'Which plan includes calling?', a: 'Basic, Pro and Premium.' },
      { q: 'Video calls?', a: 'Not yet: Meta’s Calling API supports voice for now.' },
    ],
    plan: 'calls',
    related: ['team-inbox', 'whatsapp-business-api'],
  },
  {
    slug: 'templates',
    icon: 'description',
    eyebrow: 'Message templates',
    title: 'Every WhatsApp template format, *approved fast*',
    lead: 'Write templates with text, media and buttons, carousels, limited-time offers and one-time codes. Submit them to Meta from the CRM and use them everywhere.',
    points: ['Standard, carousel and limited-time offer formats', 'Marketing, Utility and Authentication categories', 'Meta’s template library to start from'],
    chat: [
      { out: true, text: '🔥 Diwali offer · ends in 2 days\nGet ₹500 off on orders above ₹2,999\nCode: DIWALI500', button: 'Copy code · Shop now' },
    ],
    features: [
      { icon: 'text_snippet', title: 'Standard', text: 'Text, image, video or document header, body with placeholders, footer and buttons.' },
      { icon: 'view_carousel', title: 'Carousel', text: '2–10 swipeable cards, each with its own photo or video and buttons.' },
      { icon: 'timer', title: 'Limited-time offer', text: 'A countdown and a copyable offer code.' },
      { icon: 'password', title: 'Authentication', text: 'One-time codes with copy-code buttons, sent with the OTP API.' },
      { icon: 'library_books', title: 'Template library', text: 'Start from Meta’s pre-approved templates for common updates.' },
      { icon: 'tune', title: 'Live values', text: 'Map each placeholder to the contact’s name, order number and more, with fallbacks.' },
    ],
    steps: [
      { title: 'Write or pick a template', text: 'Use the builder with a live phone preview, or start from the library.' },
      { title: 'Submit', text: 'Meta reviews it, usually within minutes; you’re notified when it’s approved.' },
      { title: 'Use it', text: 'In chats, campaigns, journeys, automatic updates and the API.' },
    ],
    faqs: [
      { q: 'How many templates can I have?', a: 'Starter 50, Basic 100, Pro 300 and Premium unlimited.' },
      { q: 'Which formats are in my plan?', a: 'Starter: standard templates (Marketing and Utility). Basic adds carousels and Authentication. Pro and Premium include every format, including limited-time offers.' },
    ],
    plan: 'templates',
    related: ['broadcast', 'notifications', 'whatsapp-business-api'],
  },
  {
    slug: 'click-to-whatsapp-ads',
    icon: 'ads_click',
    eyebrow: 'Click-to-WhatsApp ads',
    title: 'Ads that open *a WhatsApp chat* with you',
    lead: 'Run Facebook and Instagram ads whose button starts a WhatsApp conversation. Every lead lands in your inbox with the ad it came from.',
    points: ['Leads tagged with the ad they clicked', 'Spend, reach and leads in one dashboard', 'Lead forms saved as contacts'],
    chat: [
      { text: 'Hi! I saw your ad about the summer collection.' },
      { out: true, text: 'Hello! Here are this week’s best sellers 👇', button: 'View catalog' },
    ],
    features: [
      { icon: 'campaign', title: 'Create from the CRM', text: 'Build Click-to-WhatsApp campaigns without switching to Ads Manager.' },
      { icon: 'leaderboard', title: 'Reports', text: 'Spend, reach and leads for every campaign.' },
      { icon: 'person_add', title: 'Lead forms', text: 'Every lead form answer saved as a contact.' },
    ],
    steps: [
      { title: 'Connect your ad account', text: 'Log in with Facebook and pick your ad account.' },
      { title: 'Create the ad', text: 'Pick the audience, budget and the message people see.' },
      { title: 'Chat with leads', text: 'Leads arrive in your inbox, ready for the bot or your team.' },
    ],
    faqs: [
      { q: 'When will Ads be available?', a: 'Ads are waiting for Meta’s approval and switch on automatically when it’s granted. They will be part of Pro and Premium.' },
    ],
    plan: 'ads',
    soon: true,
    related: ['broadcast', 'team-inbox', 'instagram-messenger'],
  },
  {
    slug: 'instagram-messenger',
    icon: 'forum',
    eyebrow: 'Instagram & Messenger',
    title: 'Instagram DMs and Messenger, *in the same inbox*',
    lead: 'Answer Instagram and Facebook Messenger conversations next to WhatsApp, with the same team, quick replies and journeys.',
    points: ['One inbox for three channels', 'Journeys on Instagram and Messenger', 'Comment auto-DM for posts'],
    chat: [
      { text: 'Do you ship to Pune? 📦' },
      { out: true, text: 'Yes! Free shipping above ₹999.' },
    ],
    features: [
      { icon: 'all_inbox', title: 'Unified inbox', text: 'WhatsApp, Instagram and Messenger chats side by side.' },
      { icon: 'account_tree', title: 'Automation', text: 'The same journeys answer on every channel.' },
      { icon: 'comment', title: 'Comment auto-DM', text: 'Message everyone who comments on a post.' },
    ],
    steps: [
      { title: 'Connect', text: 'Connect your Instagram account and Facebook Page in Channel Status.' },
      { title: 'Reply', text: 'Their messages arrive in your inbox.' },
      { title: 'Automate', text: 'Turn on a journey for each channel.' },
    ],
    faqs: [
      { q: 'When will this be available?', a: 'Instagram and Messenger are waiting for Meta’s approval. They will be part of Basic, Pro and Premium.' },
    ],
    plan: 'instagram',
    soon: true,
    related: ['team-inbox', 'chatbot', 'click-to-whatsapp-ads'],
  },
  {
    slug: 'whatsapp-business-api',
    icon: 'verified',
    eyebrow: 'WhatsApp Business API',
    title: 'The official WhatsApp Business API, *on your number*',
    lead: 'Connect your own number to the WhatsApp Business Platform through Meta’s Embedded Signup in a few minutes. No setup fee, no waiting for a reseller.',
    points: ['Meta’s official Cloud API', 'Your own number and business name', 'No setup fee: you pay your plan and Meta’s message charges'],
    chat: [
      { out: true, text: '✅ Kapso Solutions is a verified business' },
      { text: 'Great, how do I start?' },
      { out: true, text: 'Sign up, connect your number, and you’re live.' },
    ],
    features: [
      { icon: 'bolt', title: 'Minutes, not weeks', text: 'Meta’s Embedded Signup connects your number and business account in one window.' },
      { icon: 'shield', title: 'Official and secure', text: 'Built on Meta’s Cloud API. Your data is processed as our Privacy Policy describes.' },
      { icon: 'badge', title: 'Display name and quality', text: 'See your display name status, quality rating and messaging limit in Channel Status.' },
      { icon: 'lock', title: 'Two-step verification', text: 'Set or change your number’s PIN from the CRM.' },
    ],
    steps: [
      { title: 'Start a free trial', text: 'Sign up with your email or Google.' },
      { title: 'Connect WhatsApp', text: 'Log in with Facebook in Meta’s signup window and pick or add your number.' },
      { title: 'Start messaging', text: 'Your number is live on the API; use every feature for 7 days.' },
    ],
    faqs: [
      { q: 'Is there a setup fee?', a: 'No. You pay your Kapso plan; Meta charges its per-message fees directly to your WhatsApp account.' },
      { q: 'Can I try it first?', a: 'Yes: every new account gets 7 days of every feature, and a shared test number to try chats before you connect your own.' },
    ],
    plan: 'chats',
    related: ['team-inbox', 'templates', 'broadcast'],
  },
];

export const PRODUCT_BY_SLUG = new Map(PRODUCTS.map((p) => [p.slug, p]));
