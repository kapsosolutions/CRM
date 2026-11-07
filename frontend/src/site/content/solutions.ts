// What each Solutions page says (/solutions/<slug>): by team and by industry.
// Industries match the business types a sign-up picks (crm/verticals.ts).
import type { IndustrySlug, ProductSlug, TeamSlug } from '../siteMeta';
import type { ChatLine, Faq, Feature } from './products';

export interface SolutionContent {
  slug: TeamSlug | IndustrySlug;
  kind: 'team' | 'industry';
  /** crm/verticals.ts key, for industries. */
  vertical?: string;
  icon: string;
  eyebrow: string;
  title: string;
  lead: string;
  uses: Feature[];
  chat: ChatLine[];
  products: ProductSlug[];
  faqs?: Faq[];
}

export const TEAMS: SolutionContent[] = [
  {
    slug: 'marketing', kind: 'team', icon: 'campaign', eyebrow: 'For marketing teams',
    title: 'Marketing on WhatsApp that *people actually read*',
    lead: 'Reach customers in the app they open many times a day: personalised broadcasts, drip follow-ups, offers with a countdown and ads that start a chat.',
    uses: [
      { icon: 'campaign', title: 'Broadcasts and drips', text: 'Send templates to your lists, schedule them and follow up automatically, stopping when someone replies.' },
      { icon: 'local_offer', title: 'Offers that convert', text: 'Carousels of products and limited-time offers with a copyable code and a countdown.' },
      { icon: 'insights', title: 'Measure everything', text: 'Delivered, read, replied and failed for every campaign, with the reason for each failure.' },
      { icon: 'ads_click', title: 'Ads that open a chat', text: 'Click-to-WhatsApp ads bring leads straight into your inbox (coming soon).' },
    ],
    chat: [
      { out: true, text: '🎁 Members-only: 25% off this weekend\nUse code VIP25 at checkout', button: 'Shop now' },
      { text: 'Does it work on sale items?' },
    ],
    products: ['broadcast', 'templates', 'click-to-whatsapp-ads', 'catalog'],
  },
  {
    slug: 'sales', kind: 'team', icon: 'trending_up', eyebrow: 'For sales teams',
    title: 'Turn WhatsApp chats into *closed deals*',
    lead: 'Every enquiry lands in one inbox. A chatbot qualifies leads, your catalog shows the products, and your team closes in the same chat.',
    uses: [
      { icon: 'account_tree', title: 'Qualify automatically', text: 'A journey asks what they need, their budget and timing, before a person steps in.' },
      { icon: 'storefront', title: 'Share products in the chat', text: 'Send catalog items, carousels and offers without leaving the conversation.' },
      { icon: 'call', title: 'Call when it matters', text: 'Switch to a WhatsApp voice call from the chat when a lead is ready.' },
      { icon: 'dynamic_form', title: 'Capture details', text: 'WhatsApp Flows collect name, requirement and preferred time in a native form.' },
    ],
    chat: [
      { text: 'Looking for a 3 BHK under 1.2 Cr' },
      { out: true, text: 'Got it! Which area do you prefer?', button: 'Whitefield · HSR · Sarjapur' },
    ],
    products: ['team-inbox', 'chatbot', 'whatsapp-flows', 'whatsapp-calling'],
  },
  {
    slug: 'support', kind: 'team', icon: 'support_agent', eyebrow: 'For support teams',
    title: 'Faster answers, *happier customers*',
    lead: 'Answer on the channel customers prefer. The bot handles the common questions, updates go out automatically, and your team handles the rest from a shared inbox.',
    uses: [
      { icon: 'inbox', title: 'Shared inbox', text: 'Every conversation with its full history, media, orders and form answers.' },
      { icon: 'smart_toy', title: 'Self-service', text: 'Journeys answer order status, timings and FAQs any time of day.' },
      { icon: 'notifications_active', title: 'Proactive updates', text: 'Order and booking updates sent automatically, so fewer people need to ask.' },
      { icon: 'call', title: 'Voice when needed', text: 'Take and make WhatsApp calls from the CRM.' },
    ],
    chat: [
      { text: 'Where is my order?' },
      { out: true, text: 'Order #1042 is out for delivery 🚚 and will reach you by 6 pm.' },
    ],
    products: ['team-inbox', 'chatbot', 'notifications', 'whatsapp-calling'],
  },
];

const ind = (
  slug: IndustrySlug, vertical: string, icon: string, eyebrow: string, title: string, lead: string,
  uses: Feature[], chat: ChatLine[], products: ProductSlug[],
): SolutionContent => ({ slug, kind: 'industry', vertical, icon, eyebrow, title, lead, uses, chat, products });

export const INDUSTRIES: SolutionContent[] = [
  ind('ecommerce', 'ecommerce', 'shopping_bag', 'E-commerce & Retail', 'Sell more with a *shop inside WhatsApp*',
    'Your catalog in WhatsApp, carts that become orders, payments in the chat and updates until the parcel arrives.',
    [
      { icon: 'storefront', title: 'Catalog and carts', text: 'Products with sizes, options and photos; customers order from the chat.' },
      { icon: 'payments', title: 'Payments', text: 'Pay in WhatsApp or cash on delivery, confirmed automatically.' },
      { icon: 'local_shipping', title: 'Order updates', text: 'Confirmed, shipped and delivered messages sent for you.' },
      { icon: 'campaign', title: 'Campaigns', text: 'New arrivals and sale broadcasts with product carousels.' },
    ],
    [{ out: true, text: 'New arrivals are here 👗', button: 'View catalog' }, { text: '🧺 Cart: 1 × Linen shirt (M)' }],
    ['catalog', 'payments', 'notifications', 'broadcast']),
  ind('restaurants', 'restaurant', 'restaurant', 'Restaurants & Food', 'Food orders and table bookings, *on WhatsApp*',
    'Your menu as a WhatsApp catalog, orders with delivery or pickup, payments in the chat and table bookings with real times.',
    [
      { icon: 'menu_book', title: 'Menu as a catalog', text: 'Dishes with sizes and add-ons; mark items sold out in a click.' },
      { icon: 'delivery_dining', title: 'Delivery or pickup', text: 'Customers share their location; orders carry the address and map pin.' },
      { icon: 'table_restaurant', title: 'Table bookings', text: 'Pick a date, time and number of people in WhatsApp.' },
      { icon: 'local_offer', title: 'Offers', text: 'Combo and weekend offers with a struck-through price.' },
    ],
    [{ text: 'Menu please' }, { out: true, text: 'Here’s today’s menu 🍛', button: 'View menu' }],
    ['catalog', 'payments', 'appointments', 'chatbot']),
  ind('grocery-pharmacy', 'grocery', 'local_pharmacy', 'Grocery & Pharmacy', 'Groceries and medicines, *ordered on WhatsApp*',
    'Customers order from your catalog, send a prescription photo, pay and track delivery, all in one chat.',
    [
      { icon: 'inventory_2', title: 'Your full catalog', text: 'Packs and sizes with their own prices and delivery charges.' },
      { icon: 'photo_camera', title: 'Photos in the chat', text: 'Prescriptions and lists arrive as photos your team can read.' },
      { icon: 'payments', title: 'Pay in the chat', text: 'Online payment or cash on delivery.' },
      { icon: 'notifications_active', title: 'Delivery updates', text: 'Out for delivery and delivered, sent automatically.' },
    ],
    [{ text: '📷 Prescription.jpg' }, { out: true, text: 'Thanks! All 3 medicines are in stock. Total ₹486.' }],
    ['catalog', 'payments', 'notifications', 'team-inbox']),
  ind('healthcare', 'hospital', 'local_hospital', 'Hospitals & Clinics', 'Patients book doctors *on WhatsApp*',
    'Specialities, doctors and their real free times in WhatsApp. Patients book, get reminders, reschedule and pay the consultation fee without calling the front desk.',
    [
      { icon: 'medical_services', title: 'Doctors and specialities', text: 'Each doctor with photo, qualifications, fee, hours and breaks.' },
      { icon: 'event_available', title: 'Live free slots', text: 'Only times that are really free; booked and past times never show.' },
      { icon: 'event_busy', title: 'Doctor away?', text: 'Mark the absence; booked patients are told automatically.' },
      { icon: 'code', title: 'On your website', text: 'Show doctors and free slots on your own website with the Bookings API.' },
    ],
    [{ out: true, text: 'Choose a speciality', button: 'Cardiology · Dermatology · Pediatrics' }, { text: 'Cardiology' }, { out: true, text: 'Dr. Asha Rao is free Mon 10:30 am. Book it?' }],
    ['appointments', 'whatsapp-flows', 'payments', 'notifications']),
  ind('salons-spas', 'salon', 'content_cut', 'Salons, Spas & Wellness', 'Clients book their stylist *in a few taps*',
    'Services, stylists and free times in WhatsApp, with reminders, offers and follow-ups that bring clients back.',
    [
      { icon: 'content_cut', title: 'Stylists and services', text: 'Each stylist with their hours, services and prices.' },
      { icon: 'event_available', title: 'Bookings', text: 'Clients pick a free time; reschedule and cancel from WhatsApp.' },
      { icon: 'local_offer', title: 'Offers and packages', text: 'Festive offers and packages sent to past clients.' },
      { icon: 'notifications_active', title: 'Reminders', text: 'Confirmation and change messages sent automatically.' },
    ],
    [{ text: 'Haircut on Saturday?' }, { out: true, text: 'Riya is free at 11 am and 3 pm ✂️' }],
    ['appointments', 'broadcast', 'notifications', 'chatbot']),
  ind('gyms-fitness', 'gym', 'fitness_center', 'Gyms & Fitness', 'Members, trainers and classes, *on WhatsApp*',
    'Trial sign-ups, trainer bookings, class schedules, renewals and offers in the chat your members already use.',
    [
      { icon: 'fitness_center', title: 'Trainers and classes', text: 'Book a trainer or a class slot with real availability.' },
      { icon: 'how_to_reg', title: 'Trial sign-ups', text: 'WhatsApp Flows collect goals and preferred times.' },
      { icon: 'autorenew', title: 'Renewals', text: 'Renewal and offer broadcasts to your members.' },
      { icon: 'inbox', title: 'One inbox', text: 'Every member question in one place.' },
    ],
    [{ text: 'Is there a free trial?' }, { out: true, text: 'Yes! Pick a time for your free session 💪' }],
    ['appointments', 'whatsapp-flows', 'broadcast', 'team-inbox']),
  ind('automobile', 'automobile', 'car_repair', 'Automobile & Service Centres', 'Service bookings and updates, *on WhatsApp*',
    'Customers book a service slot, get updates while the vehicle is in the workshop and pay when it’s ready.',
    [
      { icon: 'build', title: 'Service slots', text: 'Bays or advisors with their free times.' },
      { icon: 'photo_camera', title: 'Photos and estimates', text: 'Share photos and estimates in the chat.' },
      { icon: 'notifications_active', title: 'Ready-for-pickup alerts', text: 'Status updates sent automatically.' },
      { icon: 'payments', title: 'Payments', text: 'Collect the bill in the chat.' },
    ],
    [{ text: 'Book a general service' }, { out: true, text: 'Tuesday 9:30 am is free. Book it? 🚗' }],
    ['appointments', 'notifications', 'payments', 'team-inbox']),
  ind('professional-services', 'professional', 'work', 'Professional Services', 'Consultations booked *without the back-and-forth*',
    'CAs, lawyers and consultants: clients book a consultation, share documents and get updates on WhatsApp.',
    [
      { icon: 'work', title: 'Consultation slots', text: 'Your professionals with fees and free times.' },
      { icon: 'description', title: 'Documents in the chat', text: 'Clients send PDFs and photos straight to your inbox.' },
      { icon: 'notifications_active', title: 'Reminders and updates', text: 'Filing and appointment updates sent automatically.' },
      { icon: 'payments', title: 'Fees', text: 'Collect the consultation fee in the chat.' },
    ],
    [{ text: 'Need help with GST filing' }, { out: true, text: 'Sure! Pick a time for a 30-minute call 📅' }],
    ['appointments', 'team-inbox', 'notifications', 'payments']),
  ind('home-services', 'homeservices', 'handyman', 'Home & Local Services', 'Book a technician *in one chat*',
    'Electricians, plumbers, cleaners and repairs: customers book a slot, share their location and get job updates.',
    [
      { icon: 'handyman', title: 'Technicians and slots', text: 'Each technician with their hours.' },
      { icon: 'location_on', title: 'Location in the chat', text: 'Customers share the pin; the job carries the address.' },
      { icon: 'notifications_active', title: 'Job updates', text: 'On the way, arrived and done messages.' },
      { icon: 'payments', title: 'Payments', text: 'Collect payment when the job is done.' },
    ],
    [{ text: 'AC not cooling' }, { out: true, text: 'A technician can come today at 4 pm. Book it? 🔧' }],
    ['appointments', 'notifications', 'payments', 'chatbot']),
  ind('hotels', 'hotel', 'hotel', 'Hotels & Resorts', 'Room bookings and guest service, *on WhatsApp*',
    'Show room types with photos and prices, take bookings and look after guests before and during their stay.',
    [
      { icon: 'king_bed', title: 'Room types', text: 'Photos, capacity, amenities and price per night.' },
      { icon: 'event_available', title: 'Bookings', text: 'Guests pick dates and room type in WhatsApp.' },
      { icon: 'room_service', title: 'Guest requests', text: 'Room service and requests in one inbox.' },
      { icon: 'campaign', title: 'Offers', text: 'Seasonal packages to past guests.' },
    ],
    [{ text: 'Deluxe room for 2 nights?' }, { out: true, text: 'Available 12–14 Dec at ₹4,500/night 🏨' }],
    ['appointments', 'team-inbox', 'payments', 'broadcast']),
  ind('pg-coworking', 'rooms', 'meeting_room', 'Rooms, PG & Co-working', 'Fill rooms and desks *from WhatsApp*',
    'Enquiries, visits, bookings and rent reminders for PGs, hostels and co-working spaces.',
    [
      { icon: 'meeting_room', title: 'Rooms and desks', text: 'Each space with photos, capacity and price.' },
      { icon: 'event_available', title: 'Visits and bookings', text: 'Book a visit or a seat in WhatsApp.' },
      { icon: 'notifications_active', title: 'Rent reminders', text: 'Payment reminders as utility templates.' },
      { icon: 'inbox', title: 'Tenant questions', text: 'Every request in one inbox.' },
    ],
    [{ text: 'Any single rooms near the metro?' }, { out: true, text: 'Yes, 2 left from ₹12,000/month. Visit tomorrow?' }],
    ['appointments', 'notifications', 'team-inbox', 'chatbot']),
  ind('events-venues', 'events', 'celebration', 'Events & Venues', 'Passes and venue bookings, *on WhatsApp*',
    'Sell passes, book venues and send event-day updates in the chat your guests already use.',
    [
      { icon: 'celebration', title: 'Events and venues', text: 'Each event or hall with capacity and price.' },
      { icon: 'event_available', title: 'Bookings', text: 'Dates and times with real availability.' },
      { icon: 'payments', title: 'Payments', text: 'Collect in the chat.' },
      { icon: 'event', title: 'Event invites', text: 'Send an event with date, place and a calendar button.' },
    ],
    [{ out: true, text: '🎶 Live music night · Sat 8 pm', button: 'Book passes' }],
    ['appointments', 'payments', 'broadcast', 'notifications']),
  ind('real-estate', 'realestate', 'apartment', 'Real Estate', 'From enquiry to *site visit*, on WhatsApp',
    'Capture property enquiries, qualify buyers with a few questions and book site visits, with your agents replying from one inbox.',
    [
      { icon: 'account_tree', title: 'Qualify leads', text: 'Budget, location and timing asked automatically.' },
      { icon: 'photo_library', title: 'Share properties', text: 'Photos, videos and brochures in the chat.' },
      { icon: 'event_available', title: 'Site visits', text: 'Buyers book a visit slot with an agent.' },
      { icon: 'campaign', title: 'New launches', text: 'Broadcast new projects to interested buyers.' },
    ],
    [{ text: '2 BHK in Whitefield?' }, { out: true, text: 'We have 3 options. Visit on Saturday? 🏠' }],
    ['chatbot', 'appointments', 'team-inbox', 'broadcast']),
  ind('education', 'education', 'school', 'Education & Coaching', 'Admissions and updates, *on WhatsApp*',
    'Turn enquiries into enrolments with a chatbot and counselling slots, and keep students and parents informed.',
    [
      { icon: 'school', title: 'Courses and batches', text: 'Share courses, fees and batch timings.' },
      { icon: 'event_available', title: 'Counselling slots', text: 'Book a call or campus visit with a counsellor.' },
      { icon: 'dynamic_form', title: 'Admission forms', text: 'WhatsApp Flows collect applicant details.' },
      { icon: 'campaign', title: 'Announcements', text: 'Results, schedules and reminders to students and parents.' },
    ],
    [{ text: 'Fees for the JEE batch?' }, { out: true, text: 'Here’s the brochure 📘 Want a counselling call?' }],
    ['chatbot', 'whatsapp-flows', 'broadcast', 'appointments']),
  ind('logistics', 'logistics', 'local_shipping', 'Logistics & Delivery', 'Shipment updates customers *don’t have to ask for*',
    'Pickup, in-transit and delivery updates on WhatsApp, with one inbox for every customer question.',
    [
      { icon: 'local_shipping', title: 'Automatic updates', text: 'Send status templates from your systems with the API.' },
      { icon: 'inbox', title: 'One inbox', text: 'Customer questions answered in one place.' },
      { icon: 'location_on', title: 'Addresses and pins', text: 'Customers share their exact location.' },
      { icon: 'smart_toy', title: 'Track by chat', text: 'A journey answers “where is my parcel?”.' },
    ],
    [{ out: true, text: '📦 Your parcel AWB 7712 is out for delivery today.' }],
    ['notifications', 'team-inbox', 'chatbot', 'whatsapp-business-api']),
  ind('banking-insurance', 'finance', 'account_balance', 'Banking, NBFC & Insurance', 'Secure updates and service, *on WhatsApp*',
    'Policy, payment and loan updates, one-time codes, and a team inbox for customer service.',
    [
      { icon: 'password', title: 'One-time codes', text: 'Send and verify OTPs on WhatsApp with the OTP API.' },
      { icon: 'notifications_active', title: 'Payment and policy alerts', text: 'Due dates, receipts and renewals as utility templates.' },
      { icon: 'inbox', title: 'Service inbox', text: 'Customer requests with their history.' },
      { icon: 'lock', title: 'Privacy first', text: 'Data processed as our Privacy Policy describes.' },
    ],
    [{ out: true, text: '482913 is your verification code. Don’t share it.', button: 'Copy code' }],
    ['templates', 'notifications', 'team-inbox', 'whatsapp-business-api']),
];

export const SOLUTION_BY_SLUG = new Map<string, SolutionContent>([...TEAMS, ...INDUSTRIES].map((s) => [s.slug, s]));
