// The API reference (/docs). Every endpoint, parameter, field and error code
// here matches backend/middleware/apiKey.js, routes/publicApi.js and
// routes/publicData.js; change them together.

export const API_BASE = 'https://kapsosolutions.com/api/v1';

export type Method = 'GET' | 'POST' | 'PATCH';
export type KeyKind = 'secret' | 'any';

export interface Param {
  name: string;
  type: string;
  required?: boolean;
  text: string;
}

export interface Endpoint {
  /** The #anchor. */
  id: string;
  title: string;
  method: Method;
  path: string;
  /** Which key: secret only, or secret or website. */
  key: KeyKind;
  text: string;
  pathParams?: Param[];
  query?: Param[];
  body?: Param[];
  /** The example request. */
  example: { path: string; body?: Record<string, unknown>; idempotent?: boolean };
  /** An example answer (JSON). */
  response: string;
  /** HTTP status of the example answer. */
  status?: number;
  notes?: string[];
}

export interface EndpointGroup {
  id: string;
  title: string;
  text: string;
  endpoints: Endpoint[];
}

const ID = '66f1c0ffee0000000000abcd';

export const GROUPS: EndpointGroup[] = [
  {
    id: 'messaging',
    title: 'Messaging',
    text: 'Send your approved WhatsApp templates and check their delivery. Messages you start on WhatsApp must be approved templates; replies inside the 24-hour window are sent from the CRM inbox.',
    endpoints: [
      {
        id: 'list-templates',
        title: 'List templates',
        method: 'GET',
        path: '/templates',
        key: 'secret',
        text: 'Your approved templates, with what each one needs to be sent: how many variables, the header type, and whether it’s a one-time-code template.',
        example: { path: '/templates' },
        response: `{
  "data": [
    {
      "name": "order_confirmed",
      "language": "en_US",
      "category": "UTILITY",
      "kind": "standard",
      "variables": 3,
      "header": "image",
      "otp": false,
      "body": "Hi {{1}}, your order {{2}} for {{3}} is confirmed."
    }
  ]
}`,
        notes: ['`kind` is `standard`, `carousel` or `lto` (limited-time offer). An `lto` template also has `offer: { code, expiration }` saying which offer fields it takes.'],
      },
      {
        id: 'send-template',
        title: 'Send a template',
        method: 'POST',
        path: '/messages/template',
        key: 'secret',
        text: 'Sends one approved template to one WhatsApp number. The answer comes as soon as WhatsApp accepts the message; delivery and read status follow (see Message status).',
        body: [
          { name: 'to', type: 'string', required: true, text: 'The WhatsApp number with country code, e.g. `+919876543210`.' },
          { name: 'template', type: 'string', required: true, text: 'The template name.' },
          { name: 'variables', type: 'string[]', text: 'Values for `{{1}}`, `{{2}}`, … in order. Leave it out to use the variable mapping set on the template in the CRM (such as the contact’s name).' },
          { name: 'headerMediaUrl', type: 'string', text: 'A public `https://` link to the image, video or document for a media header. Leave it out to use the template’s own sample.' },
          { name: 'offerCode', type: 'string', text: 'Limited-time offer templates: the coupon code to show.' },
          { name: 'offerExpiresAt', type: 'string', text: 'Limited-time offer templates: when the offer ends, as an ISO date-time.' },
        ],
        example: { path: '/messages/template', body: { to: '+919876543210', template: 'order_confirmed', variables: ['Ravi', '#1042', '₹1,499'] }, idempotent: true },
        status: 202,
        response: `{
  "id": "wamid.HBgMOTE5ODc2NTQzMjEwFQIAERgS…",
  "to": "919876543210",
  "template": "order_confirmed",
  "status": "accepted"
}`,
        notes: [
          'Authentication (OTP) templates are sent with `POST /otp/send` instead.',
          'Contacts you blocked in the CRM are never messaged (`contact_blocked`).',
        ],
      },
      {
        id: 'message-status',
        title: 'Message status',
        method: 'GET',
        path: '/messages/{id}',
        key: 'secret',
        text: 'Where a message you sent is now: `sent`, `delivered`, `read` or `failed`, with WhatsApp’s reason when it failed.',
        pathParams: [{ name: 'id', type: 'string', required: true, text: 'The `id` you got when sending.' }],
        example: { path: '/messages/wamid.HBgMOTE5ODc2NTQzMjEwFQIAERgS' },
        response: `{
  "id": "wamid.HBgMOTE5ODc2NTQzMjEwFQIAERgS…",
  "to": "919876543210",
  "status": "read",
  "createdAt": "2026-10-04T09:12:31.000Z",
  "updatedAt": "2026-10-04T09:13:02.000Z"
}`,
      },
    ],
  },
  {
    id: 'otp',
    title: 'One-time codes',
    text: 'Send a verification code with your approved authentication template, then check the code the user typed. We store only a hash of the code; it can be used once and expires on time.',
    endpoints: [
      {
        id: 'otp-send',
        title: 'Send a code',
        method: 'POST',
        path: '/otp/send',
        key: 'secret',
        text: 'Generates a code (or sends yours) with an authentication template. Sending a new code to a number replaces its previous one.',
        body: [
          { name: 'to', type: 'string', required: true, text: 'The WhatsApp number with country code.' },
          { name: 'template', type: 'string', text: 'Which authentication template. Default: your newest approved one.' },
          { name: 'code', type: 'string', text: 'Send this code instead of generating one (up to 15 characters, no spaces).' },
          { name: 'codeLength', type: 'number', text: 'Digits in a generated code, 4 to 8. Default 6.' },
          { name: 'returnCode', type: 'boolean', text: '`true` to get a generated code back in the answer. Not needed if you verify with `/otp/verify`.' },
        ],
        example: { path: '/otp/send', body: { to: '+919876543210' }, idempotent: true },
        status: 202,
        response: `{
  "id": "wamid.HBgMOTE5ODc2NTQzMjEwFQIAERgS…",
  "to": "919876543210",
  "template": "login_code",
  "status": "accepted",
  "expiresAt": "2026-10-04T09:22:31.000Z"
}`,
        notes: ['The code expires after the time set on the template (10 minutes if none is set).'],
      },
      {
        id: 'otp-verify',
        title: 'Verify a code',
        method: 'POST',
        path: '/otp/verify',
        key: 'secret',
        text: 'Checks the code the user typed against the latest code sent to that number. A wrong code is not an HTTP error: the answer says `valid: false` and why.',
        body: [
          { name: 'to', type: 'string', required: true, text: 'The number the code was sent to.' },
          { name: 'code', type: 'string', required: true, text: 'What the user typed.' },
        ],
        example: { path: '/otp/verify', body: { to: '+919876543210', code: '482913' } },
        response: `{ "valid": true }

// or, for example:
{ "valid": false, "reason": "wrong_code", "attemptsLeft": 3 }`,
        notes: ['`reason` is one of `wrong_code`, `expired`, `already_used`, `too_many_attempts` (after 5 wrong tries) or `not_found` (no code was sent to this number).'],
      },
    ],
  },
  {
    id: 'business',
    title: 'Business',
    text: 'Your business’s public details, and what it calls things, so your website can use the same words.',
    endpoints: [
      {
        id: 'get-business',
        title: 'Get the business',
        method: 'GET',
        path: '/business',
        key: 'any',
        text: 'The business name, type, WhatsApp number and its labels for members and categories (a clinic’s members are “Doctors”, a salon’s are “Stylists”).',
        example: { path: '/business' },
        response: `{
  "name": "Sunrise Clinic",
  "category": { "key": "healthcare", "label": "Hospital / Clinic" },
  "labels": {
    "member": "Doctor", "members": "Doctors",
    "category": "Specialisation", "categories": "Specialisations",
    "fee": "Consultation fee"
  },
  "whatsapp": { "number": "+919876500000", "link": "https://wa.me/919876500000" },
  "currency": "INR"
}`,
      },
    ],
  },
  {
    id: 'catalog',
    title: 'Catalog',
    text: 'Your categories and products as managed in the CRM, with live offer prices.',
    endpoints: [
      {
        id: 'list-categories',
        title: 'List categories',
        method: 'GET',
        path: '/catalog/categories',
        key: 'any',
        text: 'Your active categories, in the order you set.',
        example: { path: '/catalog/categories' },
        response: `{
  "data": [
    { "id": "${ID}", "name": "Kurtas", "imageUrl": "https://…/kurtas.jpg", "order": 1 }
  ]
}`,
      },
      {
        id: 'list-products',
        title: 'List products',
        method: 'GET',
        path: '/catalog/products',
        key: 'any',
        text: 'Your active products, sorted by name.',
        query: [
          { name: 'category', type: 'string', text: 'Only products in this category (its name).' },
          { name: 'q', type: 'string', text: 'Search product names.' },
          { name: 'inStock', type: 'boolean', text: '`true` for in-stock products only.' },
          { name: 'limit', type: 'number', text: 'Page size, 1 to 100. Default 50.' },
          { name: 'offset', type: 'number', text: 'How many to skip. Default 0.' },
        ],
        example: { path: '/catalog/products?category=Kurtas&inStock=true&limit=20' },
        response: `{
  "data": [
    {
      "id": "${ID}",
      "sku": "KURTA-BLUE",
      "name": "Blue cotton kurta",
      "description": "Hand-block printed, pure cotton.",
      "price": 1499,
      "mrp": 1999,
      "offerPrice": 1199,
      "currency": "INR",
      "unit": "piece",
      "quantity": 1,
      "imageUrl": "https://…/kurta.jpg",
      "images": ["https://…/kurta.jpg"],
      "categories": ["Kurtas"],
      "availability": "in_stock",
      "delivery": { "free": false, "charge": 49 },
      "variants": [],
      "variantOptionLabel": null,
      "updatedAt": "2026-10-01T10:00:00.000Z"
    }
  ],
  "total": 1,
  "limit": 20,
  "offset": 0,
  "hasMore": false
}`,
        notes: [
          '`mrp` is shown only when it’s above `price`. `offerPrice` is the lowest live offer price, or `null`.',
          'A product with variants has `variants: [{ index, label, price, offerPrice, imageUrl, images, options: [{ label, offerPrice }] }]`, and its own `offerPrice` is `null`.',
        ],
      },
      {
        id: 'get-product',
        title: 'Get a product',
        method: 'GET',
        path: '/catalog/products/{id}',
        key: 'any',
        text: 'One product, by its id or its SKU (the retailer id in your WhatsApp catalog).',
        pathParams: [{ name: 'id', type: 'string', required: true, text: 'Product id or SKU.' }],
        example: { path: '/catalog/products/KURTA-BLUE' },
        response: `{ "id": "${ID}", "sku": "KURTA-BLUE", "name": "Blue cotton kurta", "price": 1499, … }`,
      },
      {
        id: 'update-product',
        title: 'Update a product',
        method: 'PATCH',
        path: '/catalog/products/{id}',
        key: 'secret',
        text: 'Change a product’s price, MRP, stock or visibility from your own systems (your billing software or warehouse, say). The change is also sent to your WhatsApp catalog.',
        pathParams: [{ name: 'id', type: 'string', required: true, text: 'Product id or SKU.' }],
        body: [
          { name: 'price', type: 'number', text: 'New price, above 0.' },
          { name: 'mrp', type: 'number', text: 'New MRP, 0 or more (0 hides it).' },
          { name: 'inStock', type: 'boolean', text: 'In stock or not.' },
          { name: 'active', type: 'boolean', text: '`false` hides the product from the API and your catalog pages.' },
        ],
        example: { path: '/catalog/products/KURTA-BLUE', body: { price: 1399, inStock: true } },
        response: `{ "id": "${ID}", "sku": "KURTA-BLUE", "price": 1399, "availability": "in_stock", … }`,
        notes: ['Send at least one field. The answer is the updated product.'],
      },
    ],
  },
  {
    id: 'offers',
    title: 'Offers',
    text: 'Your offers that are live right now (switched on, started and not ended).',
    endpoints: [
      {
        id: 'list-offers',
        title: 'List live offers',
        method: 'GET',
        path: '/offers',
        key: 'any',
        text: 'Each live offer with its products and prices.',
        example: { path: '/offers' },
        response: `{
  "data": [
    {
      "id": "${ID}",
      "title": "Diwali sale",
      "startsAt": "2026-10-20T00:00:00.000Z",
      "endsAt": "2026-11-05T23:59:59.000Z",
      "items": [
        {
          "productId": "${ID}",
          "productName": "Blue cotton kurta",
          "imageUrl": "https://…/kurta.jpg",
          "variantIndex": 0,
          "option": null,
          "originalPrice": 1499,
          "offerPrice": 1199,
          "discount": { "type": "percent", "value": 20 }
        }
      ]
    }
  ]
}`,
      },
    ],
  },
  {
    id: 'members',
    title: 'Members & free slots',
    text: 'The people or resources customers book: doctors, stylists, trainers, rooms, tables. A member’s phone, email and absence reasons are never returned.',
    endpoints: [
      {
        id: 'list-members',
        title: 'List members',
        method: 'GET',
        path: '/members',
        key: 'any',
        text: 'Your active members, in the order you set.',
        query: [
          { name: 'category', type: 'string', text: 'Only members in this category (e.g. a specialisation).' },
          { name: 'limit', type: 'number', text: 'Page size, 1 to 100. Default 50.' },
          { name: 'offset', type: 'number', text: 'How many to skip. Default 0.' },
        ],
        example: { path: '/members?category=Cardiology' },
        response: `{
  "data": [
    {
      "id": "${ID}",
      "name": "Dr. Ananya Rao",
      "title": "Senior Cardiologist",
      "category": "Cardiology",
      "description": "15 years in interventional cardiology.",
      "imageUrl": "https://…/ananya.jpg",
      "fee": 800,
      "currency": "INR",
      "slotMinutes": 15,
      "slotCapacity": 1,
      "experienceYears": 15,
      "qualifications": "MBBS, MD, DM",
      "languages": ["English", "Telugu", "Hindi"],
      "location": "Block A, 2nd floor",
      "capacity": null,
      "amenities": [],
      "bookable": true,
      "schedule": [
        { "day": "monday", "windows": [{ "from": "10:00", "to": "13:00" }] }
      ]
    }
  ],
  "total": 1, "limit": 50, "offset": 0, "hasMore": false
}`,
        notes: ['`bookable` is `false` when the member has no weekly schedule. `capacity` and `amenities` are for rooms and venues.'],
      },
      {
        id: 'get-member',
        title: 'Get a member',
        method: 'GET',
        path: '/members/{id}',
        key: 'any',
        text: 'One member.',
        pathParams: [{ name: 'id', type: 'string', required: true, text: 'Member id.' }],
        example: { path: `/members/${ID}` },
        response: `{ "id": "${ID}", "name": "Dr. Ananya Rao", "fee": 800, "bookable": true, … }`,
      },
      {
        id: 'member-slots',
        title: 'Free slots on a date',
        method: 'GET',
        path: '/members/{id}/slots',
        key: 'any',
        text: 'The member’s free start times on one day. Full slots, past times (today) and marked absences are left out.',
        pathParams: [{ name: 'id', type: 'string', required: true, text: 'Member id.' }],
        query: [{ name: 'date', type: 'string', required: true, text: '`YYYY-MM-DD`, from today up to 180 days ahead.' }],
        example: { path: `/members/${ID}/slots?date=2026-12-01` },
        response: `{
  "memberId": "${ID}",
  "date": "2026-12-01",
  "data": [
    { "start": "10:00", "end": "10:15", "label": "10:00 AM", "left": 1 },
    { "start": "10:30", "end": "10:45", "label": "10:30 AM", "left": 1 }
  ]
}`,
        notes: ['`left` is how many more bookings the slot takes. Times are the business’s local time (IST).', 'Slots are never cached, so they are always current.'],
      },
      {
        id: 'member-availability',
        title: 'Availability by day',
        method: 'GET',
        path: '/members/{id}/availability',
        key: 'any',
        text: 'How many free slots each day has, for a date picker that greys out full days.',
        pathParams: [{ name: 'id', type: 'string', required: true, text: 'Member id.' }],
        query: [
          { name: 'from', type: 'string', text: 'First day, `YYYY-MM-DD`. Default today.' },
          { name: 'days', type: 'number', text: 'How many days, 1 to 31. Default 14.' },
        ],
        example: { path: `/members/${ID}/availability?days=7` },
        response: `{
  "memberId": "${ID}",
  "from": "2026-10-04",
  "days": 7,
  "data": [
    { "date": "2026-10-04", "freeSlots": 0, "firstSlot": null },
    { "date": "2026-10-05", "freeSlots": 9, "firstSlot": "10:00" }
  ]
}`,
      },
    ],
  },
  {
    id: 'bookings',
    title: 'Bookings',
    text: 'Book a member’s free slot. Bookings appear in Appointments in the CRM with the source “API”, and your team gets a notification. These endpoints need a secret key: call them from your server.',
    endpoints: [
      {
        id: 'create-booking',
        title: 'Create a booking',
        method: 'POST',
        path: '/bookings',
        key: 'secret',
        text: 'Books one free slot. The slot is checked again at the moment of booking, so two customers can never take the last place.',
        body: [
          { name: 'memberId', type: 'string', required: true, text: 'Who or what is booked.' },
          { name: 'date', type: 'string', required: true, text: '`YYYY-MM-DD`.' },
          { name: 'slot', type: 'string', required: true, text: 'Start time `HH:MM` (24-hour), from Free slots.' },
          { name: 'name', type: 'string', required: true, text: 'Who the booking is for.' },
          { name: 'phone', type: 'string', required: true, text: 'Their phone number with country code.' },
          { name: 'email', type: 'string', text: 'Their email.' },
          { name: 'notes', type: 'string', text: 'Anything your team should know, up to 500 characters.' },
        ],
        example: {
          path: '/bookings',
          body: { memberId: ID, date: '2026-12-01', slot: '10:30', name: 'Priya Sharma', phone: '+919876543210', notes: 'First visit' },
          idempotent: true,
        },
        status: 201,
        response: `{
  "id": "6700a1b2c3d4e5f6a7b8c9d0",
  "memberId": "${ID}",
  "member": "Dr. Ananya Rao",
  "category": "Cardiology",
  "date": "2026-12-01",
  "slot": "10:30",
  "slotLabel": "10:30 AM",
  "name": "Priya Sharma",
  "phone": "+919876543210",
  "email": "",
  "status": "confirmed",
  "reference": "SUN-261004-4F7K2A",
  "fee": 800,
  "createdAt": "2026-10-04T09:15:00.000Z"
}`,
        notes: ['A taken or closed slot answers `409 slot_unavailable`: fetch the free slots again and let the customer pick another.'],
      },
      {
        id: 'get-booking',
        title: 'Get a booking',
        method: 'GET',
        path: '/bookings/{id}',
        key: 'secret',
        text: 'A booking and its status: `confirmed`, `completed` or `cancelled`.',
        pathParams: [{ name: 'id', type: 'string', required: true, text: 'Booking id.' }],
        example: { path: '/bookings/6700a1b2c3d4e5f6a7b8c9d0' },
        response: `{ "id": "6700a1b2c3d4e5f6a7b8c9d0", "status": "confirmed", "date": "2026-12-01", "slot": "10:30", … }`,
      },
      {
        id: 'cancel-booking',
        title: 'Cancel a booking',
        method: 'POST',
        path: '/bookings/{id}/cancel',
        key: 'secret',
        text: 'Cancels a booking and frees its slot. Cancelling an already-cancelled booking returns it unchanged.',
        pathParams: [{ name: 'id', type: 'string', required: true, text: 'Booking id.' }],
        example: { path: '/bookings/6700a1b2c3d4e5f6a7b8c9d0/cancel' },
        response: `{ "id": "6700a1b2c3d4e5f6a7b8c9d0", "status": "cancelled", … }`,
        notes: ['A completed booking can’t be cancelled (`409 booking_completed`).'],
      },
    ],
  },
];

export const ALL_ENDPOINTS = GROUPS.flatMap((g) => g.endpoints);

/** Every error code the API answers with. */
export const ERRORS: { group: string; rows: [number, string, string][] }[] = [
  {
    group: 'Keys and access',
    rows: [
      [401, 'missing_api_key', 'No key sent. Send `Authorization: Bearer <key>`.'],
      [401, 'invalid_api_key', 'The key is wrong or was revoked.'],
      [403, 'secret_key_in_browser', 'A secret key was used from a web page. Use a website key there, or call from your server.'],
      [403, 'publishable_key_read_only', 'A website key tried something only a secret key can do.'],
      [403, 'origin_not_allowed', 'A website key was used from a website it doesn’t list. Add the website to the key in the CRM.'],
      [403, 'account_inactive', 'The account is switched off.'],
      [402, 'plan_limit', 'Your plan doesn’t include this (the message says which plan does), or a plan limit was reached.'],
      [429, 'rate_limited', 'Too many requests this minute. Wait for `Retry-After` seconds.'],
      [429, 'too_many_failed_attempts', 'Too many requests with bad keys from your IP address. Try again in 10 minutes.'],
    ],
  },
  {
    group: 'Requests',
    rows: [
      [400, 'invalid_phone', 'The number isn’t 8 to 15 digits with the country code.'],
      [400, 'invalid_id', 'The id in the URL isn’t in the right format.'],
      [400, 'invalid_idempotency_key', 'The Idempotency-Key is longer than 128 characters.'],
      [409, 'idempotency_in_progress', 'A request with the same Idempotency-Key is still running.'],
      [404, 'not_found', 'No such endpoint.'],
      [500, 'internal_error', 'Something failed on our side. Retry; with an Idempotency-Key a retry is safe.'],
      [503, 'unavailable', 'The API is briefly unavailable. Retry.'],
    ],
  },
  {
    group: 'Messaging and codes',
    rows: [
      [409, 'whatsapp_not_connected', 'Connect your own WhatsApp number in the CRM first.'],
      [400, 'missing_template', 'No `template` name sent.'],
      [404, 'template_not_found', 'No template with this name in your account (or no approved authentication template, for `/otp/send`).'],
      [409, 'template_not_approved', 'The template is pending or rejected.'],
      [400, 'use_otp_endpoint', 'An authentication template was sent to `/messages/template`. Use `/otp/send`.'],
      [400, 'not_otp_template', 'The template given to `/otp/send` isn’t an authentication template.'],
      [400, 'invalid_variables', '`variables` isn’t a list of non-empty values up to 1,024 characters.'],
      [400, 'variables_mismatch', 'Wrong number of variables. `expected` says how many.'],
      [400, 'invalid_media_url', '`headerMediaUrl` isn’t a public https link.'],
      [400, 'invalid_code', 'The code is missing, too long or has spaces.'],
      [409, 'contact_blocked', 'You blocked this contact in the CRM.'],
      [404, 'message_not_found', 'No message with this id (a new one can take a second to appear).'],
    ],
  },
  {
    group: 'From WhatsApp',
    rows: [
      [422, 'recipient_unavailable', 'The number isn’t on WhatsApp, or its app is too old.'],
      [422, 'recipient_opted_out', 'The person stopped marketing messages from you.'],
      [422, 'not_delivered', 'WhatsApp held the message back to protect its users’ experience. Try later.'],
      [429, 'pair_rate_limited', 'Too many messages to this number in a short time.'],
      [429, 'throughput_limited', 'Your number’s sending rate was reached. Retry shortly.'],
      [429, 'spam_rate_limited', 'WhatsApp limited your number after spam reports.'],
      [400, 'variables_format', 'A variable isn’t in the format the template expects.'],
      [400, 'text_too_long', 'A variable makes the message too long.'],
      [400, 'media_failed', 'WhatsApp couldn’t download the header media.'],
      [403, 'number_restricted', 'Meta has temporarily restricted your number.'],
      [502, 'whatsapp_error', 'Another WhatsApp error. `whatsappCode` holds Meta’s code.'],
    ],
  },
  {
    group: 'Catalog, members and bookings',
    rows: [
      [404, 'product_not_found', 'No product with this id or SKU.'],
      [400, 'invalid_price', '`price` isn’t a number above 0.'],
      [400, 'invalid_mrp', '`mrp` isn’t a number of 0 or more.'],
      [400, 'invalid_instock', '`inStock` isn’t true or false (`invalid_active` likewise).'],
      [400, 'nothing_to_update', 'The PATCH had none of the fields it accepts.'],
      [404, 'member_not_found', 'No active member with this id.'],
      [400, 'invalid_date', 'The date isn’t `YYYY-MM-DD`.'],
      [400, 'date_in_past', 'The date is before today.'],
      [400, 'date_too_far', 'The date is more than 180 days ahead.'],
      [400, 'invalid_slot', '`slot` isn’t `HH:MM`.'],
      [400, 'missing_name', 'No `name` for the booking.'],
      [400, 'invalid_email', '`email` isn’t a valid address.'],
      [409, 'slot_unavailable', 'The slot isn’t free (taken, past, closed or an absence).'],
      [404, 'booking_not_found', 'No booking with this id.'],
      [409, 'booking_completed', 'A completed booking can’t be cancelled.'],
    ],
  },
];

// ------------------------------------------------------------- examples

export type Lang = 'curl' | 'js' | 'python';
export const LANGS: { key: Lang; label: string }[] = [
  { key: 'curl', label: 'cURL' },
  { key: 'js', label: 'JavaScript' },
  { key: 'python', label: 'Python' },
];

const pyValue = (v: unknown): string => {
  if (v === true) return 'True';
  if (v === false) return 'False';
  if (v === null) return 'None';
  if (Array.isArray(v)) return `[${v.map(pyValue).join(', ')}]`;
  if (typeof v === 'object') return `{${Object.entries(v as Record<string, unknown>).map(([k, x]) => `"${k}": ${pyValue(x)}`).join(', ')}}`;
  return JSON.stringify(v);
};

/** The example request of an endpoint, in a language. */
export function exampleCode(e: Endpoint, lang: Lang): string {
  const url = `${API_BASE}${e.example.path}`;
  const keyVar = e.key === 'secret' ? 'KAPSO_SECRET_KEY' : 'KAPSO_KEY';
  const body = e.example.body;
  const idem = e.example.idempotent ? 'unique-id-for-this-request' : '';
  if (lang === 'curl') {
    const lines = [e.method === 'GET' ? `curl "${url}"` : `curl -X ${e.method} "${url}"`, `  -H "Authorization: Bearer $${keyVar}"`];
    if (body) lines.push('  -H "Content-Type: application/json"');
    if (idem) lines.push(`  -H "Idempotency-Key: ${idem}"`);
    if (body) lines.push(`  -d '${JSON.stringify(body, null, 2).replace(/\n/g, '\n  ')}'`);
    return lines.join(' \\\n');
  }
  if (lang === 'js') {
    const headers = [`Authorization: \`Bearer \${process.env.${keyVar}}\``];
    if (body) headers.push(`'Content-Type': 'application/json'`);
    if (idem) headers.push(`'Idempotency-Key': '${idem}'`);
    const opts = [
      ...(e.method !== 'GET' ? [`  method: '${e.method}',`] : []),
      `  headers: {\n    ${headers.join(',\n    ')},\n  },`,
      ...(body ? [`  body: JSON.stringify(${JSON.stringify(body, null, 2).replace(/\n/g, '\n  ')}),`] : []),
    ];
    return `const res = await fetch('${url}', {\n${opts.join('\n')}\n});\nconst data = await res.json();\nif (!res.ok) throw new Error(data.error.message);`;
  }
  const headers = [`"Authorization": f"Bearer {os.environ['${keyVar}']}"`];
  if (idem) headers.push(`"Idempotency-Key": "${idem}"`);
  const args = [`"${url}"`, `headers={${headers.join(', ')}}`];
  if (body) args.push(`json=${pyValue(body)}`);
  return `import os, requests\n\nres = requests.${e.method.toLowerCase()}(\n    ${args.join(',\n    ')},\n    timeout=15,\n)\ndata = res.json()\nif not res.ok:\n    raise RuntimeError(data["error"]["message"])`;
}
