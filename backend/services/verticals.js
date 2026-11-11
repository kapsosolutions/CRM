// Business verticals (categories) and the behavioural "archetype" each maps to.
//
// Dozens of business types want WhatsApp automation, but they collapse into a
// few archetypes. The archetype — not the category — decides what the product
// looks like: which sidebar pages a tenant sees, what its "members" are called,
// and which member fields are relevant.
//
//   catalog — sells products       → Catalog / Offers / Orders, no members
//   person  — books a person       → Members (staff) + slot fields
//   unit    — books a unit/space   → Members (rooms) + capacity / amenities
//   lead    — high-ticket enquiry  → Members (agents / courses) + lead fields
//   notify  — notification-led     → Templates + Campaigns only
//
// Adding a new vertical is one entry here — no new code paths.

// Sidebar pages available in the CRM.
export const ALL_PAGES = [
  'chats', 'templates', 'campaigns', 'flows',
  'catalog', 'categories', 'members', 'offers', 'orders',
];

// Every tenant gets the core conversation tools.
const CORE = ['chats', 'templates', 'campaigns', 'flows'];

// What the confirmation blocks are called per archetype. The default bodies
// live in the builder (frontend/src/crm/verticals.ts) since that's where a
// block is created; these labels are here so both sides agree on the naming.
const CONFIRM_LABELS = {
  catalog: { label: 'Order confirmed', detailsLabel: 'Order details' },
  person: { label: 'Appointment confirmed', detailsLabel: 'Appointment details' },
  unit: { label: 'Booking confirmed', detailsLabel: 'Booking details' },
  lead: { label: 'Enquiry received', detailsLabel: 'Enquiry details' },
  notify: { label: 'Confirmed', detailsLabel: 'Details' },
};

export const ARCHETYPES = {
  catalog: {
    label: 'Catalog commerce',
    pages: [...CORE, 'catalog', 'categories', 'offers', 'orders'],
    memberFields: ['fee', 'location'],
    ordersLabel: 'Orders',
    confirm: CONFIRM_LABELS.catalog,
  },
  person: {
    label: 'Person booking',
    pages: [...CORE, 'categories', 'members', 'orders'],
    memberFields: ['fee', 'duration', 'availability', 'experience', 'qualifications', 'languages', 'location', 'email'],
    ordersLabel: 'Appointments',
    confirm: CONFIRM_LABELS.person,
  },
  unit: {
    label: 'Unit booking',
    pages: [...CORE, 'categories', 'members', 'orders'],
    memberFields: ['fee', 'duration', 'availability', 'capacity', 'amenities', 'location'],
    ordersLabel: 'Bookings',
    confirm: CONFIRM_LABELS.unit,
  },
  lead: {
    label: 'Lead capture',
    pages: [...CORE, 'categories', 'members', 'orders'],
    memberFields: ['fee', 'experience', 'languages', 'location', 'email'],
    ordersLabel: 'Enquiries',
    confirm: CONFIRM_LABELS.lead,
  },
  notify: {
    label: 'Notification-led',
    pages: [...CORE],
    memberFields: ['fee'],
    ordersLabel: 'Records',
    confirm: CONFIRM_LABELS.notify,
  },
};

// category key → { label, archetype, member/fee/category wording }
export const VERTICALS = {
  ecommerce: {
    label: 'E-commerce & Retail', archetype: 'catalog',
    memberLabel: 'Stores', memberSingular: 'Store', feeLabel: 'Price', categoryLabel: 'Category',
    categoryPlural: 'Categories', categoryExample: 'Footwear', memberExample: 'Banjara Hills store', memberTitleExample: 'Flagship store',
  },
  restaurant: {
    label: 'Restaurant & Food', archetype: 'catalog',
    memberLabel: 'Outlets', memberSingular: 'Outlet', feeLabel: 'Price', categoryLabel: 'Menu category',
    categoryPlural: 'Menu categories', categoryExample: 'Biryani', memberExample: 'Jubilee Hills outlet', memberTitleExample: 'Dine-in & takeaway',
  },
  grocery: {
    label: 'Grocery & Pharmacy', archetype: 'catalog',
    memberLabel: 'Stores', memberSingular: 'Store', feeLabel: 'Price', categoryLabel: 'Category',
    categoryPlural: 'Categories', categoryExample: 'Fresh produce', memberExample: 'MG Road store', memberTitleExample: 'Pharmacy counter',
  },
  hospital: {
    label: 'Hospital & Clinic', archetype: 'person',
    memberLabel: 'Doctors', memberSingular: 'Doctor', feeLabel: 'Consultation fee', categoryLabel: 'Specialisation',
    categoryPlural: 'Specialisations', categoryExample: 'Cardiology', memberExample: 'Dr. Asha Rao', memberTitleExample: 'Cardiologist', qualificationsExample: 'MBBS, MD (Cardiology)',
  },
  salon: {
    label: 'Salon, Spa & Wellness', archetype: 'person',
    memberLabel: 'Stylists', memberSingular: 'Stylist', feeLabel: 'Service price', categoryLabel: 'Service type',
    categoryPlural: 'Service types', categoryExample: 'Hair & styling', memberExample: 'Meera Nair', memberTitleExample: 'Senior stylist', qualificationsExample: 'Certified in advanced colouring',
  },
  gym: {
    label: 'Gym & Fitness', archetype: 'person',
    memberLabel: 'Trainers', memberSingular: 'Trainer', feeLabel: 'Plan price', categoryLabel: 'Programme',
    categoryPlural: 'Programmes', categoryExample: 'Strength training', memberExample: 'Arjun Mehta', memberTitleExample: 'Strength coach', qualificationsExample: 'ACE Certified Personal Trainer',
  },
  automobile: {
    label: 'Automobile & Service Centre', archetype: 'person',
    memberLabel: 'Services', memberSingular: 'Service', feeLabel: 'Service charge', categoryLabel: 'Service type',
    categoryPlural: 'Service types', categoryExample: 'Oil change', memberExample: 'Periodic service', memberTitleExample: 'Scheduled maintenance', qualificationsExample: 'Manufacturer-trained technician',
  },
  professional: {
    label: 'Professional Services (CA / Legal / Consulting)', archetype: 'person',
    memberLabel: 'Consultants', memberSingular: 'Consultant', feeLabel: 'Consultation fee', categoryLabel: 'Practice area',
    categoryPlural: 'Practice areas', categoryExample: 'Tax & GST', memberExample: 'Ravi Kumar', memberTitleExample: 'Chartered Accountant', qualificationsExample: 'CA, LLB',
  },
  homeservices: {
    label: 'Home & Local Services', archetype: 'person',
    memberLabel: 'Professionals', memberSingular: 'Professional', feeLabel: 'Visit charge', categoryLabel: 'Service type',
    categoryPlural: 'Service types', categoryExample: 'Plumbing', memberExample: 'Suresh Kumar', memberTitleExample: 'Plumber', qualificationsExample: 'ITI Plumbing, 8 years on site',
  },
  hotel: {
    label: 'Hotels & Resorts', archetype: 'unit',
    memberLabel: 'Room types', memberSingular: 'Room type', feeLabel: 'Price per night', categoryLabel: 'Room category',
    categoryPlural: 'Room categories', categoryExample: 'Deluxe rooms', memberExample: 'Deluxe Double Room', memberTitleExample: 'Sea view',
  },
  rooms: {
    label: 'Rooms, PG & Co-working', archetype: 'unit',
    memberLabel: 'Rooms & Spaces', memberSingular: 'Space', feeLabel: 'Rent', categoryLabel: 'Space type',
    categoryPlural: 'Space types', categoryExample: 'Private cabins', memberExample: 'Cabin 4A', memberTitleExample: '4-seater cabin',
  },
  events: {
    label: 'Events & Venues', archetype: 'unit',
    memberLabel: 'Venues', memberSingular: 'Venue', feeLabel: 'Package price', categoryLabel: 'Venue type',
    categoryPlural: 'Venue types', categoryExample: 'Banquet halls', memberExample: 'Grand Ballroom', memberTitleExample: 'Up to 500 guests',
  },
  realestate: {
    label: 'Real Estate', archetype: 'lead',
    memberLabel: 'Agents', memberSingular: 'Agent', feeLabel: 'Price', categoryLabel: 'Property type',
    categoryPlural: 'Property types', categoryExample: '3 BHK apartments', memberExample: 'Priya Sharma', memberTitleExample: 'Senior agent',
  },
  education: {
    label: 'Education & Coaching', archetype: 'lead',
    memberLabel: 'Courses & Faculty', memberSingular: 'Course', feeLabel: 'Course fee', categoryLabel: 'Stream',
    categoryPlural: 'Streams', categoryExample: 'Science', memberExample: 'NEET Crash Course', memberTitleExample: '6-month programme',
  },
  logistics: {
    label: 'Logistics & Delivery', archetype: 'notify',
    memberLabel: 'Members', memberSingular: 'Member', feeLabel: 'Charge', categoryLabel: 'Category',
    categoryPlural: 'Categories', categoryExample: 'Same-day delivery', memberExample: 'Hyderabad hub', memberTitleExample: 'Dispatch centre',
  },
  finance: {
    label: 'Banking, NBFC & Insurance', archetype: 'notify',
    memberLabel: 'Advisors', memberSingular: 'Advisor', feeLabel: 'Fee', categoryLabel: 'Product',
    categoryPlural: 'Products', categoryExample: 'Home loans', memberExample: 'Rahul Verma', memberTitleExample: 'Relationship manager',
  },
  it: {
    label: 'IT & Software Services', archetype: 'person',
    memberLabel: 'Experts', memberSingular: 'Expert', feeLabel: 'Consultation fee', categoryLabel: 'Service',
    categoryPlural: 'Services', categoryExample: 'Web development', memberExample: 'Anil Reddy', memberTitleExample: 'Solutions architect', qualificationsExample: 'AWS Certified Solutions Architect',
    ordersLabel: 'Meetings',
  },
  other: {
    label: 'Other / Generic', archetype: 'catalog',
    memberLabel: 'Members', memberSingular: 'Member', feeLabel: 'Price', categoryLabel: 'Category',
    categoryPlural: 'Categories', categoryExample: 'Category name', memberExample: 'Member name', memberTitleExample: 'Role',
    allPages: true, // generic tenants see everything
  },
};

export const VERTICAL_KEYS = Object.keys(VERTICALS);
export const DEFAULT_VERTICAL = 'other';

export function getVertical(key) {
  return VERTICALS[key] || VERTICALS[DEFAULT_VERTICAL];
}

// What each vertical calls the person it serves. Anything not listed is a
// plain "Customer". Kept in step with frontend/src/crm/verticals.ts.
const CUSTOMER_TERMS = {
  hospital: { one: 'Patient', many: 'Patients' },
  salon: { one: 'Client', many: 'Clients' },
  gym: { one: 'Client', many: 'Clients' },
  automobile: { one: 'Client', many: 'Clients' },
  professional: { one: 'Client', many: 'Clients' },
  homeservices: { one: 'Client', many: 'Clients' },
  hotel: { one: 'Guest', many: 'Guests' },
  rooms: { one: 'Guest', many: 'Guests' },
  events: { one: 'Guest', many: 'Guests' },
  realestate: { one: 'Client', many: 'Clients' },
  education: { one: 'Client', many: 'Clients' },
  finance: { one: 'Client', many: 'Clients' },
  it: { one: 'Client', many: 'Clients' },
};
export const customerTerm = (key) => CUSTOMER_TERMS[String(key || '')] || { one: 'Customer', many: 'Customers' };

/**
 * Resolved presentation config for a business category.
 * @param {string} key        the vertical key (business.category)
 * @param {object} [overrides] per-business label overrides (business.labels)
 */
export function verticalConfig(key, overrides = null) {
  const v = getVertical(key);
  const a = ARCHETYPES[v.archetype] || ARCHETYPES.catalog;
  const cust = customerTerm(VERTICALS[key] ? key : DEFAULT_VERTICAL);
  const o = overrides || {};
  const ov = (val) => (typeof val === 'string' && val.trim() ? val.trim() : undefined);
  return {
    key: VERTICALS[key] ? key : DEFAULT_VERTICAL,
    label: v.label,
    archetype: v.archetype,
    archetypeLabel: a.label,
    memberLabel: ov(o.memberLabel) ?? v.memberLabel,
    memberSingular: ov(o.memberSingular) ?? v.memberSingular,
    feeLabel: v.feeLabel,
    categoryLabel: ov(o.categoryLabel) ?? v.categoryLabel,
    categoryPlural: ov(o.categoryPlural) ?? v.categoryPlural,
    // Example wording for form placeholders. Kept here rather than in the
    // pages: a hardcoded "e.g. Oils" asked a hospital for an oil change.
    categoryExample: v.categoryExample,
    memberExample: v.memberExample,
    memberTitleExample: v.memberTitleExample,
    qualificationsExample: v.qualificationsExample || 'Qualifications',
    customerLabel: ov(o.customerLabel) ?? cust.one,
    customerPlural: ov(o.customerPlural) ?? cust.many,
    ordersLabel: v.ordersLabel || a.ordersLabel,
    confirm: a.confirm,
    pages: v.allPages ? [...ALL_PAGES] : a.pages,
    memberFields: a.memberFields,
  };
}

export default {
  ALL_PAGES, ARCHETYPES, VERTICALS, VERTICAL_KEYS, DEFAULT_VERTICAL,
  getVertical, verticalConfig, customerTerm,
};
