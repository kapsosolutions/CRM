// What each developer page says (/developers/<slug>). Every endpoint named
// here exists in backend/routes/publicApi.js or publicData.js, and each links
// to its section of the API reference (/docs#<anchor>).
import type { DevSlug } from '../siteMeta';
import type { Faq, Feature } from './products';

export interface DevTopic {
  slug: DevSlug;
  icon: string;
  eyebrow: string;
  /** The h1; the part in *stars* is green. */
  title: string;
  lead: string;
  points: string[];
  /** The sample shown beside the hero. */
  sample: { label: string; code: string };
  features: Feature[];
  /** Endpoints this topic uses, linked to the reference. */
  endpoints: { method: 'GET' | 'POST' | 'PATCH'; path: string; anchor: string; text: string; key: 'secret' | 'any' }[];
  steps: { title: string; text: string }[];
  faqs: Faq[];
}

const BASE = 'https://kapsosolutions.com/api/v1';

export const DEV_TOPICS: DevTopic[] = [
  {
    slug: 'messaging',
    icon: 'send',
    eyebrow: 'Messaging API',
    title: 'Send WhatsApp messages *from your own code*',
    lead: 'Order confirmations, shipping updates, reminders and receipts: send any of your approved WhatsApp templates with one REST call from your server, and check whether it was delivered and read.',
    points: [
      'One call: the number, the template name and its variables',
      'Delivered, read and failed status for every message',
      'Every message also appears in your team inbox, so replies are answered there',
    ],
    sample: {
      label: 'Send a template',
      code: `curl -X POST ${BASE}/messages/template \\
  -H "Authorization: Bearer $KAPSO_SECRET_KEY" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: order-1042-confirmed" \\
  -d '{
    "to": "+919876543210",
    "template": "order_confirmed",
    "variables": ["Ravi", "#1042", "₹1,499"]
  }'`,
    },
    features: [
      { icon: 'description', title: 'Your approved templates', text: 'List them with GET /templates to see each one’s language, category, variables and header type.' },
      { icon: 'image', title: 'Media headers and offers', text: 'Send an image, video or document header from a public https link, and fill a limited-time offer’s code and end time.' },
      { icon: 'repeat', title: 'Safe retries', text: 'Send an Idempotency-Key and a retried request returns the first answer instead of messaging twice.' },
      { icon: 'fact_check', title: 'Clear errors', text: 'A wrong variable count, an unapproved template or an opted-out number comes back as a named error with what to do.' },
      { icon: 'forum', title: 'Replies in the inbox', text: 'The message shows in the customer’s chat in the CRM, so your team sees what was sent and answers their reply.' },
      { icon: 'block', title: 'Respects your settings', text: 'Blocked contacts are never messaged, and your plan’s limits apply like a send from the CRM.' },
    ],
    endpoints: [
      { method: 'GET', path: '/templates', anchor: 'list-templates', text: 'Your approved templates and what each needs', key: 'secret' },
      { method: 'POST', path: '/messages/template', anchor: 'send-template', text: 'Send a template to a WhatsApp number', key: 'secret' },
      { method: 'GET', path: '/messages/{id}', anchor: 'message-status', text: 'Delivery status of a sent message', key: 'secret' },
    ],
    steps: [
      { title: 'Create a template', text: 'Make it in Templates in the CRM and wait for Meta’s approval, usually a few minutes.' },
      { title: 'Create a secret key', text: 'In the CRM, open a template’s API panel and create a secret key. Keep it on your server.' },
      { title: 'Call the API', text: 'POST the number, template name and variables. You get the message id straight away.' },
    ],
    faqs: [
      { q: 'Can I send free-form text messages?', a: 'No. Messages you start must be approved templates (a WhatsApp rule). Replies to customers inside the 24-hour window are sent from the CRM’s inbox.' },
      { q: 'Who pays for the messages?', a: 'Meta charges each template message to your WhatsApp account at its published rate for the category (marketing, utility or authentication). The API has no extra per-message fee.' },
      { q: 'Which plans include the API?', a: 'Basic, Pro and Premium. Every new account can try it during the 7-day free trial.' },
    ],
  },
  {
    slug: 'otp',
    icon: 'password',
    eyebrow: 'OTP API',
    title: 'One-time codes on WhatsApp *in two calls*',
    lead: 'Send a login or verification code with your approved authentication template, then check what the user typed. We generate the code, store only its hash, and expire it on time.',
    points: [
      'POST /otp/send, then POST /otp/verify',
      'Codes are hashed, single-use and expire with your template’s setting',
      'Five wrong attempts lock the code',
    ],
    sample: {
      label: 'Send, then verify',
      code: `# 1. Send a code (we generate a 6-digit one)
curl -X POST ${BASE}/otp/send \\
  -H "Authorization: Bearer $KAPSO_SECRET_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"to": "+919876543210"}'

# 2. Check what the user typed
curl -X POST ${BASE}/otp/verify \\
  -H "Authorization: Bearer $KAPSO_SECRET_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"to": "+919876543210", "code": "482913"}'`,
    },
    features: [
      { icon: 'lock', title: 'Hashed and single-use', text: 'We keep a hash of the code, never the code. A verified code can’t be used again, and a new code replaces the old one.' },
      { icon: 'timer', title: 'Expires on time', text: 'The expiry is the one set on your authentication template (10 minutes if none is set).' },
      { icon: 'pin', title: 'Your code or ours', text: 'Let us generate 4 to 8 digits, or send a code your own system made.' },
      { icon: 'content_copy', title: 'Copy-code button', text: 'The message carries WhatsApp’s copy-code or one-tap button, as set on the template.' },
    ],
    endpoints: [
      { method: 'POST', path: '/otp/send', anchor: 'otp-send', text: 'Send a one-time code', key: 'secret' },
      { method: 'POST', path: '/otp/verify', anchor: 'otp-verify', text: 'Check the code the user typed', key: 'secret' },
    ],
    steps: [
      { title: 'Create an authentication template', text: 'In Templates, choose Authentication. Meta approves these quickly.' },
      { title: 'Send the code', text: 'Call /otp/send with the user’s number when they sign in or confirm an action.' },
      { title: 'Verify', text: 'Call /otp/verify with what they typed. The answer is valid true or false, with the reason.' },
    ],
    faqs: [
      { q: 'Do I get the code back?', a: 'Only if you ask for it with "returnCode": true. Most apps don’t need it: they just call /otp/verify.' },
      { q: 'Which plans include OTP?', a: 'Authentication templates and the API are in Basic, Pro and Premium.' },
    ],
  },
  {
    slug: 'catalog',
    icon: 'storefront',
    eyebrow: 'Catalog API',
    title: 'Your products on your website, *always in sync*',
    lead: 'The products, categories and offers you manage in the CRM, available to your own website or app: prices, variants, images, stock and live offer prices. Update price and stock from your server and the WhatsApp catalog follows.',
    points: [
      'Read with a website key, straight from your web pages',
      'Live offer prices worked out for you',
      'PATCH price, MRP and stock from your server',
    ],
    sample: {
      label: 'On your website',
      code: `const res = await fetch(
  'https://kapsosolutions.com/api/v1/catalog/products?inStock=true&limit=20',
  { headers: { Authorization: 'Bearer kp_pub_…' } }
);
const { data, total } = await res.json();
// data[0] → { name, price, mrp, offerPrice, imageUrl, variants, availability … }`,
    },
    features: [
      { icon: 'category', title: 'Categories', text: 'Your categories with images and order, to build menus and filters.' },
      { icon: 'inventory_2', title: 'Products and variants', text: 'Name, description, price, MRP, images, unit, delivery charge, variants and their options.' },
      { icon: 'local_offer', title: 'Offer prices', text: 'Each product and variant carries its lowest live offer price, and /offers lists the offers themselves.' },
      { icon: 'search', title: 'Search and filter', text: 'Filter by category or stock, search by name, and page through with limit and offset.' },
      { icon: 'sync', title: 'Update from your systems', text: 'Change price, MRP, stock or visibility with a secret key; the WhatsApp catalog is updated too.' },
      { icon: 'cached', title: 'Cache-friendly', text: 'Reads may be cached for a minute, so a busy shop page stays fast.' },
    ],
    endpoints: [
      { method: 'GET', path: '/catalog/categories', anchor: 'list-categories', text: 'Your categories', key: 'any' },
      { method: 'GET', path: '/catalog/products', anchor: 'list-products', text: 'Products, filtered and paged', key: 'any' },
      { method: 'GET', path: '/catalog/products/{id}', anchor: 'get-product', text: 'One product by id or SKU', key: 'any' },
      { method: 'PATCH', path: '/catalog/products/{id}', anchor: 'update-product', text: 'Change price, MRP, stock or visibility', key: 'secret' },
      { method: 'GET', path: '/offers', anchor: 'list-offers', text: 'Live offers and their prices', key: 'any' },
    ],
    steps: [
      { title: 'Add your products', text: 'Add them in Catalog in the CRM (or sync your WhatsApp catalog).' },
      { title: 'Create a website key', text: 'On the Catalog page, open API and create a website key for your domain.' },
      { title: 'Show them', text: 'Fetch the products from your page and render them your way.' },
    ],
    faqs: [
      { q: 'Is it safe to put a key in my web page?', a: 'Use a website key (kp_pub_…). It can only read your catalog, members and offers, and only from the websites you list on it. Secret keys are refused in browsers.' },
      { q: 'Which plans include it?', a: 'The catalog and the API are in Basic, Pro and Premium.' },
    ],
  },
  {
    slug: 'bookings',
    icon: 'event_available',
    eyebrow: 'Bookings & Members API',
    title: 'Doctors, stylists and rooms *with live free slots*',
    lead: 'Show the people or resources customers book (doctors, stylists, trainers, rooms, tables) on your own website with their free times, and book them through the API. Bookings land in Appointments in the CRM, next to the ones made on WhatsApp.',
    points: [
      'Members with photo, fee, schedule and details, never their phone or email',
      'Free slots per day, and a calendar view for up to 31 days',
      'Bookings respect each slot’s capacity, even when two arrive at once',
    ],
    sample: {
      label: 'Free slots, then book',
      code: `# Free slots on a day (works with a website key)
curl "${BASE}/members/66f1c0ffee0000000000abcd/slots?date=2026-12-01" \\
  -H "Authorization: Bearer $KAPSO_KEY"

# Book one (secret key, from your server)
curl -X POST ${BASE}/bookings \\
  -H "Authorization: Bearer $KAPSO_SECRET_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"memberId": "66f1c0ffee0000000000abcd", "date": "2026-12-01",
       "slot": "10:30", "name": "Priya Sharma", "phone": "+919876543210"}'`,
    },
    features: [
      { icon: 'groups', title: 'Your members', text: 'Name, title, category, photo, fee, experience, languages, location and weekly schedule.' },
      { icon: 'schedule', title: 'Live free slots', text: 'Slots already booked, past times and marked absences are left out, so only real free times show.' },
      { icon: 'calendar_month', title: 'Availability calendar', text: 'How many free slots each day has, to grey out full days in a date picker.' },
      { icon: 'event_available', title: 'Book and cancel', text: 'Create a booking for a free slot, look it up and cancel it, all from your server.' },
      { icon: 'notifications_active', title: 'Your team is told', text: 'Each API booking and cancellation shows in Appointments and raises a notification in the CRM.' },
      { icon: 'label', title: 'Your words', text: 'GET /business returns what you call members and categories (“Doctors”, “Specialisation”), to label your pages.' },
    ],
    endpoints: [
      { method: 'GET', path: '/business', anchor: 'get-business', text: 'Your business name, WhatsApp number and labels', key: 'any' },
      { method: 'GET', path: '/members', anchor: 'list-members', text: 'Your members', key: 'any' },
      { method: 'GET', path: '/members/{id}', anchor: 'get-member', text: 'One member', key: 'any' },
      { method: 'GET', path: '/members/{id}/slots', anchor: 'member-slots', text: 'Free slots on a date', key: 'any' },
      { method: 'GET', path: '/members/{id}/availability', anchor: 'member-availability', text: 'Free slots per day for up to 31 days', key: 'any' },
      { method: 'POST', path: '/bookings', anchor: 'create-booking', text: 'Book a free slot', key: 'secret' },
      { method: 'GET', path: '/bookings/{id}', anchor: 'get-booking', text: 'A booking’s details and status', key: 'secret' },
      { method: 'POST', path: '/bookings/{id}/cancel', anchor: 'cancel-booking', text: 'Cancel a booking', key: 'secret' },
    ],
    steps: [
      { title: 'Add members', text: 'Add your doctors, stylists or rooms in Members with their schedule and slot length.' },
      { title: 'Show them', text: 'Fetch members and free slots from your web page with a website key.' },
      { title: 'Book from your server', text: 'Send the chosen slot to your server, which books it with a secret key.' },
    ],
    faqs: [
      { q: 'Why does booking need a secret key?', a: 'A booking writes to your account and uses a customer’s phone number, so it must come from your server, where you can add your own checks (a captcha, a login, a payment).' },
      { q: 'Is the customer messaged on WhatsApp?', a: 'The booking is saved in Appointments and your team is notified. Send a confirmation with the Messaging API if you want one on WhatsApp.' },
      { q: 'Which plans include it?', a: 'Reading members and free slots is in Basic, Pro and Premium. Booking through the API (and the Appointments page) needs Pro or Premium.' },
    ],
  },
  {
    slug: 'website-keys',
    icon: 'key',
    eyebrow: 'Website keys',
    title: 'API keys that are *safe in a web page*',
    lead: 'Anything in a web page can be read by its visitors, so a normal API key can’t go there. Website keys (kp_pub_…) are made for it: they only read your public catalog, members and offers, and only from the websites you list.',
    points: [
      'Read-only: GET on business, catalog, members, slots and offers',
      'Locked to up to 10 websites you choose, including subdomains',
      'Rate-limited per visitor, so one visitor can’t use up your limit',
    ],
    sample: {
      label: 'In a web page',
      code: `<div id="doctors"></div>
<script>
  fetch('https://kapsosolutions.com/api/v1/members', {
    headers: { Authorization: 'Bearer kp_pub_…' }
  })
    .then((r) => r.json())
    .then(({ data }) => {
      const box = document.getElementById('doctors');
      for (const m of data) {
        const p = document.createElement('p');
        p.textContent = m.name + ' · ' + m.title;
        box.appendChild(p);
      }
    });
</script>`,
    },
    features: [
      { icon: 'visibility', title: 'Read-only', text: 'A website key can’t send messages, book, or change anything. Those need a secret key on your server.' },
      { icon: 'language', title: 'Your websites only', text: 'Requests from any other website are refused. Use https://*.yourdomain.com to include subdomains; http works for localhost while you build.' },
      { icon: 'speed', title: 'Fair limits', text: '60 requests a minute per visitor and 1,200 a minute for the key, with standard rate-limit headers.' },
      { icon: 'block', title: 'Secret keys refused in browsers', text: 'If a secret key is ever used from a web page, it’s refused, so a copy-paste mistake doesn’t leak write access.' },
      { icon: 'edit', title: 'Change websites any time', text: 'Add or remove websites on a key in the CRM without changing the key.' },
      { icon: 'delete', title: 'Revoke in one click', text: 'A revoked key stops working at once. Create a new one and update your page.' },
    ],
    endpoints: [
      { method: 'GET', path: '/business', anchor: 'get-business', text: 'Business details and labels', key: 'any' },
      { method: 'GET', path: '/catalog/products', anchor: 'list-products', text: 'Products', key: 'any' },
      { method: 'GET', path: '/members/{id}/slots', anchor: 'member-slots', text: 'Free slots', key: 'any' },
      { method: 'GET', path: '/offers', anchor: 'list-offers', text: 'Live offers', key: 'any' },
    ],
    steps: [
      { title: 'Open API in the CRM', text: 'On the Catalog, Categories, Members or Offers page, click API.' },
      { title: 'Create a website key', text: 'Choose “Website key” and enter the address of your site, like https://www.yourclinic.com.' },
      { title: 'Paste the snippet', text: 'Copy the ready-made snippet into your page, or call the API with your own code.' },
    ],
    faqs: [
      { q: 'Can someone copy my website key?', a: 'They can see it, as with any key in a page, but it only reads what your website already shows, only works from your listed websites in a browser, and is rate-limited. Revoke it any time.' },
      { q: 'What does a website key read?', a: 'Business details, categories, products, offers, members and their free slots. Never bookings, messages, contacts or a member’s phone and email.' },
    ],
  },
];

export const DEV_BY_SLUG = new Map(DEV_TOPICS.map((t) => [t.slug, t]));
