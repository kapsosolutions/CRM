// Every public website page: its URL, <title> and description. Plain data
// (no React), because the build reads it too (build/sitePages.ts writes one
// HTML file per page with these tags, plus sitemap.xml), so Google sees each
// page as its own result with its own title. Keep titles under ~60
// characters and descriptions under ~155.

export const SITE_ORIGIN = 'https://kapsosolutions.com';
export const SITE_NAME = 'Kapso Solutions';

export interface SitePageMeta {
  path: string;
  title: string;
  description: string;
  /** sitemap.xml priority, 0–1. */
  priority?: number;
}

const brand = (t: string) => `${t} | ${SITE_NAME}`;

export const HOME_META: SitePageMeta = {
  path: '/',
  title: 'Kapso Solutions | WhatsApp CRM, Automation & Business API',
  description: 'Official WhatsApp Business API platform: team inbox, broadcasts, chatbots, WhatsApp Flows, catalog, payments and bookings. Start a 7-day free trial.',
  priority: 1,
};

export const PRODUCT_SLUGS = [
  'team-inbox', 'broadcast', 'chatbot', 'whatsapp-flows', 'catalog', 'payments', 'appointments', 'notifications',
  'whatsapp-calling', 'templates', 'click-to-whatsapp-ads', 'instagram-messenger', 'whatsapp-business-api',
] as const;
export type ProductSlug = (typeof PRODUCT_SLUGS)[number];

export const TEAM_SLUGS = ['marketing', 'sales', 'support'] as const;
export const INDUSTRY_SLUGS = [
  'ecommerce', 'restaurants', 'grocery-pharmacy', 'healthcare', 'salons-spas', 'gyms-fitness', 'automobile',
  'professional-services', 'home-services', 'hotels', 'pg-coworking', 'events-venues', 'real-estate', 'education',
  'logistics', 'banking-insurance', 'it-software',
] as const;
export type TeamSlug = (typeof TEAM_SLUGS)[number];
export type IndustrySlug = (typeof INDUSTRY_SLUGS)[number];

export const DEV_SLUGS = ['messaging', 'otp', 'catalog', 'bookings', 'website-keys'] as const;
export type DevSlug = (typeof DEV_SLUGS)[number];

export const TOOL_SLUGS = ['whatsapp-link-generator', 'whatsapp-qr-code', 'whatsapp-chat-button', 'whatsapp-pricing-calculator'] as const;
export type ToolSlug = (typeof TOOL_SLUGS)[number];

/** Titles and descriptions. Pages fill their visible copy from content/*.ts. */
const PRODUCT_META: Record<ProductSlug, [string, string]> = {
  'team-inbox': ['WhatsApp Team Inbox', 'One shared WhatsApp inbox for your team, in any browser: reply fast, see every customer’s history and never miss a message.'],
  broadcast: ['WhatsApp Broadcast & Campaigns', 'Send approved WhatsApp templates to your customer lists, schedule them, add drip follow-ups and track delivered, read and replies.'],
  chatbot: ['No-code WhatsApp Chatbot', 'Build WhatsApp chatbots with a drag-and-drop journey builder: menus, buttons, lists, media and keyword replies, no coding needed.'],
  'whatsapp-flows': ['WhatsApp Flows Builder', 'Native WhatsApp forms for bookings, orders, sign-ups and surveys, built visually and submitted inside the chat.'],
  catalog: ['WhatsApp Catalog & Orders', 'Sell on WhatsApp: your products in the WhatsApp catalog, carts, offers and every order managed from one place.'],
  payments: ['WhatsApp Payments', 'Collect payments inside WhatsApp with UPI and payment gateways, with order confirmations sent automatically.'],
  appointments: ['WhatsApp Appointments & Bookings', 'Let customers book doctors, stylists, rooms or tables on WhatsApp, with live free slots, reminders and reschedules.'],
  notifications: ['Automatic WhatsApp Notifications', 'Send order updates, booking reminders and alerts on WhatsApp automatically, triggered by what happens in your business.'],
  'whatsapp-calling': ['WhatsApp Business Calling', 'Call customers and answer their WhatsApp calls from the CRM, right next to the chat history.'],
  templates: ['WhatsApp Message Templates', 'Create Meta-approved WhatsApp templates: text, media, buttons, carousels, limited-time offers and one-time codes.'],
  'click-to-whatsapp-ads': ['Click-to-WhatsApp Ads', 'Facebook and Instagram ads that open a WhatsApp chat with you, with every lead captured in your CRM.'],
  'instagram-messenger': ['Instagram & Messenger Inbox', 'Reply to Instagram DMs and Facebook Messenger from the same inbox as WhatsApp.'],
  'whatsapp-business-api': ['WhatsApp Business API', 'Get the official WhatsApp Business API on your own number in minutes, with Meta’s Embedded Signup and no setup fee.'],
};

const TEAM_META: Record<TeamSlug, [string, string]> = {
  marketing: ['WhatsApp for Marketing Teams', 'Grow sales with WhatsApp broadcasts, drip campaigns, offers and ads that open a chat, all measured in one place.'],
  sales: ['WhatsApp for Sales Teams', 'Capture leads, qualify them with a chatbot and close deals on WhatsApp with a shared inbox and your catalog.'],
  support: ['WhatsApp for Customer Support', 'Answer customers on WhatsApp faster with a team inbox, automatic replies, notifications and calling.'],
};

const INDUSTRY_META: Record<IndustrySlug, [string, string]> = {
  ecommerce: ['WhatsApp for E-commerce & Retail', 'Sell on WhatsApp with a product catalog, carts, offers, payments and automatic order updates.'],
  restaurants: ['WhatsApp for Restaurants & Food', 'Take food orders and table bookings on WhatsApp, with your menu as a catalog and payments in the chat.'],
  'grocery-pharmacy': ['WhatsApp for Grocery & Pharmacy', 'Let customers order groceries and medicines on WhatsApp, with your catalog, delivery charges and payments.'],
  healthcare: ['WhatsApp for Hospitals & Clinics', 'Patients book doctors on WhatsApp with live free slots, get reminders and reschedule without calling.'],
  'salons-spas': ['WhatsApp for Salons, Spas & Wellness', 'Clients book stylists and treatments on WhatsApp and get reminders, offers and follow-ups automatically.'],
  'gyms-fitness': ['WhatsApp for Gyms & Fitness', 'Sign up members, book trainers and classes, and send renewals and offers on WhatsApp.'],
  automobile: ['WhatsApp for Automobile & Service Centres', 'Book service appointments on WhatsApp and keep customers updated until their vehicle is ready.'],
  'professional-services': ['WhatsApp for Professional Services', 'CAs, lawyers and consultants: book consultations on WhatsApp and keep clients informed.'],
  'home-services': ['WhatsApp for Home & Local Services', 'Book electricians, plumbers and cleaners on WhatsApp, with time slots and job updates.'],
  hotels: ['WhatsApp for Hotels & Resorts', 'Take room bookings, share room types and send stay updates to guests on WhatsApp.'],
  'pg-coworking': ['WhatsApp for PG, Rooms & Co-working', 'Fill rooms, beds and desks with enquiries, visits and bookings on WhatsApp.'],
  'events-venues': ['WhatsApp for Events & Venues', 'Sell event passes and book venues on WhatsApp, with confirmations and reminders.'],
  'real-estate': ['WhatsApp for Real Estate', 'Capture property enquiries, qualify buyers and book site visits on WhatsApp.'],
  education: ['WhatsApp for Education & Coaching', 'Turn admission enquiries into students with WhatsApp, and keep students and parents informed.'],
  logistics: ['WhatsApp for Logistics & Delivery', 'Send pickup, shipment and delivery updates on WhatsApp and answer customers in one inbox.'],
  'banking-insurance': ['WhatsApp for Banking, NBFC & Insurance', 'Send policy, payment and loan updates on WhatsApp, with one-time codes and a secure team inbox.'],
  'it-software': ['WhatsApp for IT & Software Companies', 'Hire on WhatsApp with job applications, resumes and interview slots, and win clients with project enquiries, demos and support tickets.'],
};

const DEV_META: Record<DevSlug, [string, string]> = {
  messaging: ['WhatsApp Messaging API', 'Send approved WhatsApp templates from your own app or server with one REST call, and track delivery and reads.'],
  otp: ['WhatsApp OTP API', 'Send and verify one-time codes on WhatsApp with two API calls. Codes are hashed and expire on their own.'],
  catalog: ['WhatsApp Catalog API', 'Show your products, categories and live offers on your own website, and update price and stock from your server.'],
  bookings: ['Bookings & Members API', 'Show your doctors, stylists or rooms with live free slots on your website, and book them through the API.'],
  'website-keys': ['Website Keys for the Kapso API', 'Use the Kapso API safely from your website’s pages with read-only keys locked to your own domains.'],
};

const TOOL_META: Record<ToolSlug, [string, string]> = {
  'whatsapp-link-generator': ['Free WhatsApp Link Generator', 'Create a wa.me link that opens a WhatsApp chat with you and a ready message. Free, no sign-up.'],
  'whatsapp-qr-code': ['Free WhatsApp QR Code Generator', 'Make a QR code that opens a WhatsApp chat with your business. Download it as an image. Free, no sign-up.'],
  'whatsapp-chat-button': ['Free WhatsApp Chat Button for Websites', 'Add a floating WhatsApp chat button to your website. Pick colours and text, copy the code. Free.'],
  'whatsapp-pricing-calculator': ['WhatsApp Message Cost Calculator', 'Estimate your monthly WhatsApp Business API cost: Meta’s per-message charges plus your plan.'],
};

export const SITE_PAGES: SitePageMeta[] = [
  HOME_META,
  { path: '/pricing', title: brand('Pricing: WhatsApp CRM Plans from ₹499'), description: 'Simple monthly, quarterly and annual plans for the WhatsApp Business API, from ₹499 a month. Every plan starts with a 7-day free trial.', priority: 0.9 },
  { path: '/about', title: brand('About Us'), description: 'Kapso Solutions is a technology partner for WhatsApp automation, Meta business verification and custom website and app development.', priority: 0.6 },
  { path: '/contact', title: brand('Contact Us'), description: 'Talk to the Kapso Solutions team: sales, support, partnerships and the API. Call, WhatsApp or send us a message.', priority: 0.6 },
  { path: '/product', title: brand('Product: Everything for WhatsApp'), description: 'Every part of the Kapso WhatsApp CRM: team inbox, campaigns, chatbots, WhatsApp Flows, catalog, payments, bookings, calling and the API.', priority: 0.8 },
  ...PRODUCT_SLUGS.map((s) => ({ path: `/product/${s}`, title: brand(PRODUCT_META[s][0]), description: PRODUCT_META[s][1], priority: 0.7 })),
  { path: '/solutions', title: brand('Solutions by Team and Industry'), description: 'How marketing, sales and support teams, and businesses in every industry, use WhatsApp with Kapso Solutions.', priority: 0.8 },
  ...TEAM_SLUGS.map((s) => ({ path: `/solutions/${s}`, title: brand(TEAM_META[s][0]), description: TEAM_META[s][1], priority: 0.6 })),
  ...INDUSTRY_SLUGS.map((s) => ({ path: `/solutions/${s}`, title: brand(INDUSTRY_META[s][0]), description: INDUSTRY_META[s][1], priority: 0.6 })),
  { path: '/developers', title: brand('WhatsApp API for Developers'), description: 'REST API for WhatsApp templates, one-time codes, your catalog, members, free slots and bookings. Secret and website keys.', priority: 0.8 },
  ...DEV_SLUGS.map((s) => ({ path: `/developers/${s}`, title: brand(DEV_META[s][0]), description: DEV_META[s][1], priority: 0.6 })),
  { path: '/docs', title: brand('API Documentation'), description: 'Kapso API reference: authentication, website keys, errors, rate limits, and every endpoint with examples in cURL, JavaScript and Python.', priority: 0.8 },
  { path: '/help', title: brand('Help Center'), description: 'Answers about the WhatsApp Business API, getting started, templates, campaigns, plans and billing with Kapso Solutions.', priority: 0.6 },
  { path: '/resources/whatsapp-templates', title: brand('WhatsApp Template Examples'), description: 'Ready-to-use WhatsApp message template examples for marketing, orders, bookings, payments and one-time codes.', priority: 0.6 },
  { path: '/resources/whatsapp-pricing', title: brand('WhatsApp Business API Pricing Explained'), description: 'How Meta charges for WhatsApp Business messages: marketing, utility, authentication and service messages, explained simply.', priority: 0.6 },
  ...TOOL_SLUGS.map((s) => ({ path: `/tools/${s}`, title: brand(TOOL_META[s][0]), description: TOOL_META[s][1], priority: 0.6 })),
  { path: '/privacy', title: brand('Privacy Policy'), description: 'How Kapso Solutions collects, uses, protects and deletes personal data, including the data of your WhatsApp customers.', priority: 0.3 },
  { path: '/terms', title: brand('Terms and Conditions'), description: 'The terms for using the Kapso Solutions WhatsApp CRM, its plans, the free trial and the API.', priority: 0.3 },
  { path: '/refund', title: brand('Refund and Cancellation Policy'), description: 'When Kapso Solutions plans can be cancelled and refunded.', priority: 0.3 },
  { path: '/data-deletion', title: brand('Data Deletion Instructions'), description: 'How to delete your Kapso Solutions account and data, disconnect Meta, and how your customers can ask for deletion.', priority: 0.3 },
];

export const PAGE_META = new Map(SITE_PAGES.map((p) => [p.path, p]));

/** "/pricing/" → "/pricing". */
export const normalizePath = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p) || '/';

export const PRODUCT_TITLE = (s: ProductSlug) => PRODUCT_META[s][0];
export const TEAM_TITLE = (s: TeamSlug) => TEAM_META[s][0];
export const INDUSTRY_TITLE = (s: IndustrySlug) => INDUSTRY_META[s][0];
export const DEV_TITLE = (s: DevSlug) => DEV_META[s][0];
export const TOOL_TITLE = (s: ToolSlug) => TOOL_META[s][0];
export const PRODUCT_DESC = (s: ProductSlug) => PRODUCT_META[s][1];
export const TEAM_DESC = (s: TeamSlug) => TEAM_META[s][1];
export const INDUSTRY_DESC = (s: IndustrySlug) => INDUSTRY_META[s][1];
export const DEV_DESC = (s: DevSlug) => DEV_META[s][1];
export const TOOL_DESC = (s: ToolSlug) => TOOL_META[s][1];
