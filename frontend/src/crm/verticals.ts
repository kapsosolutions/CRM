// Business verticals (categories) → behavioural archetype.
// Mirrors backend/services/verticals.js — keep the two in sync.
//
// The archetype decides what the product looks like for a tenant: which sidebar
// pages it sees, what its "members" are called, and which member fields apply.
//   catalog — sells products      → Catalog / Offers / Orders, no members
//   person  — books a person      → Members (staff) + slot fields
//   unit    — books a unit/space  → Members (rooms) + capacity / amenities
//   lead    — high-ticket enquiry → Members (agents / courses) + lead fields
//   notify  — notification-led    → Templates + Campaigns only
import type { CrmView } from './components/NavRail';

export type Archetype = 'catalog' | 'person' | 'unit' | 'lead' | 'notify';

/** Optional member fields a vertical can ask for. */
export type MemberField =
  | 'fee' | 'duration' | 'availability' | 'experience'
  | 'qualifications' | 'languages' | 'location' | 'capacity' | 'amenities' | 'email';

export const ALL_PAGES: CrmView[] = [
  'chats', 'templates', 'campaigns', 'flows',
  'catalog', 'categories', 'members', 'offers', 'orders', 'ads', 'create', 'payment-config',
];

// Every business type gets these. Ads is here because any business can run a
// Click-to-WhatsApp ad, whatever it sells; Create (Facebook / Instagram posts)
// likewise.
const CORE: CrmView[] = ['chats', 'templates', 'campaigns', 'flows', 'ads', 'create', 'payment-config'];

/**
 * Default wording for the confirmation blocks, per archetype.
 *
 * These used to be hardcoded for a shop — "Order confirmed", cart lines,
 * "Deliver to" — which is wrong for most businesses using them. A clinic
 * confirming an appointment has no cart and no delivery address, so every one
 * of those lines was dropped at send time and the patient got a near-empty
 * message with the wrong title.
 *
 * Only tokens that can actually resolve for that archetype are used. A line
 * whose value is empty is still dropped at send time, so a business that skips
 * a step loses that line rather than sending a dangling label.
 */
export interface ConfirmWording {
  /** Block + palette label, e.g. "Appointment confirmed". */
  label: string;
  /** Label for the read-back block, e.g. "Appointment details". */
  detailsLabel: string;
  /** Default body for the confirmation block. */
  body: string;
  /** Default body for the details block. */
  detailsBody: string;
  /** One-line wording for the PDF variant. */
  pdfText: string;
  /** Generated file name for the PDF variant. */
  pdfFileName: string;
  /**
   * How the A4 slip is laid out. A clinic's slip has no cart, no delivery
   * address and no totals — left in, those printed as headings with nothing
   * under them and a third of the page blank.
   */
  pdf: {
    title: string;
    refLabel: string;
    dateLabel: string;
    customerLabel: string;
    appointment: boolean;
    address: boolean;
    items: boolean;
    note: string;
  };
  /**
   * Wording for the cancellation journey, which was hardcoded to "order"
   * everywhere — wrong for a clinic cancelling an appointment. The picker and
   * confirm screens, the message that accompanies the cancellation slip, and
   * the slip itself all take their words from here. The slip reuses the
   * confirm `pdf` layout above, overriding only its title and note.
   */
  cancel: {
    pickTitle: string; // "Cancel an appointment"
    pickBody: string; // "Select the appointment you want to cancel."
    confirmTitle: string; // "Confirm cancellation"
    confirmPrefix: string; // text above the picked item's label
    yesLabel: string; // "Yes, cancel this appointment"
    noLabel: string; // "No, keep it"
    docText: string; // message sent with the cancellation slip
    pdfFileName: string;
    pdfTitle: string; // slip heading
    pdfNote: string; // slip footer note
  };
}

/** One selectable status: the stored value, and what this vertical calls it. */
export interface OrderStatusOption {
  value: string;
  label: string;
}

// The status workflow per archetype. All values are drawn from the canonical
// set the backend stores (pending / confirmed / preparing / out_for_delivery /
// delivered / cancelled) — only the wording and which ones are offered change,
// so no database migration is needed. A shop walks an order through delivery
// stages; a clinic just needs Confirmed → Completed, with "delivered" standing
// in as the terminal "done" state everything shares.
const STATUS_FLOWS: Record<Archetype, OrderStatusOption[]> = {
  catalog: [
    { value: 'pending', label: 'Pending' },
    { value: 'confirmed', label: 'Confirmed' },
    { value: 'preparing', label: 'Preparing' },
    { value: 'out_for_delivery', label: 'Out for delivery' },
    { value: 'delivered', label: 'Delivered' },
    { value: 'cancelled', label: 'Cancelled' },
  ],
  person: [
    { value: 'pending', label: 'Pending' },
    { value: 'confirmed', label: 'Confirmed' },
    { value: 'delivered', label: 'Completed' },
    { value: 'cancelled', label: 'Cancelled' },
  ],
  unit: [
    { value: 'pending', label: 'Pending' },
    { value: 'confirmed', label: 'Confirmed' },
    { value: 'delivered', label: 'Completed' },
    { value: 'cancelled', label: 'Cancelled' },
  ],
  lead: [
    { value: 'pending', label: 'New' },
    { value: 'confirmed', label: 'In progress' },
    { value: 'delivered', label: 'Closed' },
    { value: 'cancelled', label: 'Cancelled' },
  ],
  notify: [
    { value: 'pending', label: 'Pending' },
    { value: 'confirmed', label: 'Confirmed' },
    { value: 'delivered', label: 'Completed' },
    { value: 'cancelled', label: 'Cancelled' },
  ],
};

export const ARCHETYPES: Record<
  Archetype,
  {
    label: string;
    pages: CrmView[];
    memberFields: MemberField[];
    ordersLabel: string;
    /** Whether the Orders page offers the "Form submissions" tab. */
    formsTab: boolean;
    confirm: ConfirmWording;
    /** The status options this archetype offers, in workflow order. */
    orderStatuses: OrderStatusOption[];
  }
> = {
  catalog: {
    label: 'Catalog commerce',
    pages: [...CORE, 'catalog', 'categories', 'offers', 'orders'],
    memberFields: ['fee', 'location'],
    ordersLabel: 'Orders',
    orderStatuses: STATUS_FLOWS.catalog,
    // A shop's record is the order. Form submissions are an enquiry/booking
    // idea, so a restaurant or store has no use for that tab.
    formsTab: false,
    confirm: {
      label: 'Order confirmed',
      detailsLabel: 'Order details',
      body:
        '✅ *Order confirmed*\n'
        + 'Order: {{order_id}}\n\n'
        + '{{cart_items}}\n\n'
        + 'Items: {{items_total}}\n'
        + 'Delivery: {{delivery_fee}}\n'
        + '*Total payable: {{total_payable}}*\n\n'
        + 'Paying by: {{payment_method}}\n'
        + 'Deliver to: {{delivery_address}}\n'
        + 'Category: {{category}}\n\n'
        + 'We are preparing your order and will keep you posted here.',
      detailsBody:
        '*Order details*\n'
        + 'Order: {{order_id}}\n'
        + 'Status: {{order_status}}\n'
        + 'Placed: {{order_date}}\n'
        + 'Items: {{order_items}}\n'
        + 'Total: {{order_total}}\n'
        + 'Payment: {{payment_status}}\n'
        + 'Deliver to: {{delivery_address}}\n\n'
        + 'Need anything else? Tap below.',
      pdfText: 'Your order {{order_id}} is confirmed. The details are attached.',
      pdfFileName: 'order-{{order_id}}',
      pdf: {
        title: 'Order confirmation',
        refLabel: 'ORDER ID',
        dateLabel: 'ORDER DATE',
        customerLabel: 'CUSTOMER',
        appointment: false,
        address: true,
        items: true,
        note: 'Your order is confirmed and is being prepared. We will message you on WhatsApp with every update.',
      },
      cancel: {
        pickTitle: 'Cancel an order',
        pickBody: 'Select the order you want to cancel.',
        confirmTitle: 'Confirm cancellation',
        confirmPrefix: 'You are about to cancel:',
        yesLabel: 'Yes, cancel this order',
        noLabel: 'No, keep my order',
        docText: 'Your order {{order_id}} has been cancelled. The cancellation receipt is attached.',
        pdfFileName: 'cancellation-{{order_id}}',
        pdfTitle: 'Order cancellation',
        pdfNote: 'This order has been cancelled. If this was a mistake, reply here and we will help.',
      },
    },
  },
  person: {
    label: 'Person booking',
    pages: [...CORE, 'categories', 'members', 'orders'],
    memberFields: ['fee', 'duration', 'availability', 'experience', 'qualifications', 'languages', 'location', 'email'],
    ordersLabel: 'Appointments',
    orderStatuses: STATUS_FLOWS.person,
    // The appointment IS the record on this page, so the raw "Form submissions"
    // tab only duplicates it — hidden to keep the Appointments view clean.
    formsTab: false,
    confirm: {
      label: 'Appointment confirmed',
      detailsLabel: 'Appointment details',
      body:
        '✅ *Appointment confirmed*\n'
        + 'Ref: {{order_id}}\n\n'
        + 'With: {{member}}\n'
        + 'For: {{category}}\n'
        + 'Date: {{appointment_date}}\n'
        + 'Time: {{appointment_slot}}\n\n'
        + 'Name: {{customer_name}}\n'
        + 'Age: {{age}}\n'
        + 'Gender: {{gender}}\n\n'
        + 'Paying by: {{payment_method}}\n\n'
        + 'Please arrive 10 minutes early. Reply here to change or cancel.',
      detailsBody:
        '*Appointment details*\n'
        + 'Ref: {{order_id}}\n'
        + 'Status: {{order_status}}\n'
        + 'With: {{member}}\n'
        + 'Date: {{appointment_date}}\n'
        + 'Time: {{appointment_slot}}\n'
        + 'Name: {{customer_name}}\n\n'
        + 'Need anything else? Tap below.',
      pdfText: 'Your appointment with {{member}} is confirmed. The details are attached.',
      pdfFileName: 'appointment-{{appointment_date}}',
      pdf: {
        title: 'Appointment confirmation',
        refLabel: 'REF',
        dateLabel: 'BOOKED ON',
        customerLabel: 'PATIENT',
        appointment: true,
        address: false,
        items: false,
        note: 'Please arrive 10 minutes early and bring this slip. Reply on WhatsApp to change or cancel.',
      },
      cancel: {
        pickTitle: 'Cancel an appointment',
        pickBody: 'Select the appointment you want to cancel.',
        confirmTitle: 'Confirm cancellation',
        confirmPrefix: 'You are about to cancel:',
        yesLabel: 'Yes, cancel this appointment',
        noLabel: 'No, keep it',
        docText: 'Your appointment ({{order_id}}) with {{member}} on {{appointment_date}} has been cancelled. The cancellation slip is attached.',
        pdfFileName: 'cancellation-{{appointment_date}}',
        pdfTitle: 'Appointment cancellation',
        pdfNote: 'This appointment has been cancelled. Reply on WhatsApp to book a new time.',
      },
    },
  },
  unit: {
    label: 'Unit booking',
    pages: [...CORE, 'categories', 'members', 'offers', 'orders'],
    memberFields: ['fee', 'capacity', 'amenities', 'location'],
    ordersLabel: 'Bookings',
    orderStatuses: STATUS_FLOWS.unit,
    formsTab: true,
    confirm: {
      label: 'Booking confirmed',
      detailsLabel: 'Booking details',
      body:
        '✅ *Booking confirmed*\n'
        + 'Ref: {{order_id}}\n\n'
        + '{{member}}\n'
        + 'Type: {{category}}\n'
        + 'Date: {{appointment_date}}\n'
        + 'Time: {{appointment_slot}}\n\n'
        + 'Name: {{customer_name}}\n'
        + 'Total: {{total_payable}}\n'
        + 'Paying by: {{payment_method}}\n\n'
        + 'We look forward to having you. Reply here if anything changes.',
      detailsBody:
        '*Booking details*\n'
        + 'Ref: {{order_id}}\n'
        + 'Status: {{order_status}}\n'
        + '{{member}}\n'
        + 'Date: {{appointment_date}}\n'
        + 'Time: {{appointment_slot}}\n'
        + 'Total: {{order_total}}\n\n'
        + 'Need anything else? Tap below.',
      pdfText: 'Your booking is confirmed. The details are attached.',
      pdfFileName: 'booking-{{appointment_date}}',
      pdf: {
        title: 'Booking confirmation',
        refLabel: 'REF',
        dateLabel: 'BOOKED ON',
        customerLabel: 'GUEST',
        appointment: true,
        address: false,
        items: true,
        note: 'Please present this slip on arrival. Reply on WhatsApp if anything changes.',
      },
      cancel: {
        pickTitle: 'Cancel a booking',
        pickBody: 'Select the booking you want to cancel.',
        confirmTitle: 'Confirm cancellation',
        confirmPrefix: 'You are about to cancel:',
        yesLabel: 'Yes, cancel this booking',
        noLabel: 'No, keep it',
        docText: 'Your booking ({{order_id}}) on {{appointment_date}} has been cancelled. The cancellation slip is attached.',
        pdfFileName: 'cancellation-{{appointment_date}}',
        pdfTitle: 'Booking cancellation',
        pdfNote: 'This booking has been cancelled. Reply on WhatsApp to book again.',
      },
    },
  },
  lead: {
    label: 'Lead capture',
    pages: [...CORE, 'categories', 'members', 'orders'],
    memberFields: ['fee', 'experience', 'languages', 'location', 'email'],
    ordersLabel: 'Enquiries',
    orderStatuses: STATUS_FLOWS.lead,
    // The whole point of this archetype — the form *is* the record.
    formsTab: true,
    confirm: {
      label: 'Enquiry received',
      detailsLabel: 'Enquiry details',
      body:
        '✅ *Enquiry received*\n\n'
        + 'Thanks {{customer_name}}, we have your details.\n\n'
        + 'Interested in: {{category}}\n'
        + 'Looking at: {{member}}\n'
        + 'Preferred date: {{appointment_date}}\n\n'
        + 'Our team will call you on {{customer_phone}} shortly.',
      detailsBody:
        '*Enquiry details*\n'
        + 'Ref: {{order_id}}\n'
        + 'Status: {{order_status}}\n'
        + 'Interested in: {{category}}\n'
        + 'Looking at: {{member}}\n'
        + 'Name: {{customer_name}}\n\n'
        + 'Need anything else? Tap below.',
      pdfText: 'Thanks {{customer_name}} — your enquiry details are attached.',
      pdfFileName: 'enquiry-{{customer_name}}',
      pdf: {
        title: 'Enquiry summary',
        refLabel: 'REF',
        dateLabel: 'RECEIVED',
        customerLabel: 'ENQUIRY FROM',
        appointment: true,
        address: false,
        items: false,
        note: 'Thanks for your interest. Our team will be in touch shortly.',
      },
      cancel: {
        pickTitle: 'Withdraw an enquiry',
        pickBody: 'Select the enquiry you want to withdraw.',
        confirmTitle: 'Confirm withdrawal',
        confirmPrefix: 'You are about to withdraw:',
        yesLabel: 'Yes, withdraw it',
        noLabel: 'No, keep it',
        docText: 'Your enquiry ({{order_id}}) has been withdrawn. A summary is attached.',
        pdfFileName: 'withdrawal-{{order_id}}',
        pdfTitle: 'Enquiry withdrawal',
        pdfNote: 'This enquiry has been withdrawn. Reply on WhatsApp if you change your mind.',
      },
    },
  },
  notify: {
    label: 'Notification-led',
    pages: [...CORE],
    memberFields: ['fee'],
    ordersLabel: 'Records',
    orderStatuses: STATUS_FLOWS.notify,
    formsTab: false,
    confirm: {
      label: 'Confirmed',
      detailsLabel: 'Details',
      body:
        '✅ *Confirmed*\n'
        + 'Ref: {{order_id}}\n\n'
        + 'Name: {{customer_name}}\n'
        + 'Date: {{appointment_date}}\n'
        + 'Total: {{total_payable}}\n\n'
        + "Thanks — we'll keep you posted here.",
      detailsBody:
        '*Details*\n'
        + 'Ref: {{order_id}}\n'
        + 'Status: {{order_status}}\n'
        + 'Name: {{customer_name}}\n'
        + 'Total: {{order_total}}\n\n'
        + 'Need anything else? Tap below.',
      pdfText: 'Your confirmation {{order_id}} is attached.',
      pdfFileName: 'confirmation-{{order_id}}',
      pdf: {
        title: 'Confirmation',
        refLabel: 'REF',
        dateLabel: 'DATE',
        customerLabel: 'CUSTOMER',
        appointment: false,
        address: false,
        items: true,
        note: "Thanks — we'll keep you posted on WhatsApp.",
      },
      cancel: {
        pickTitle: 'Cancel a request',
        pickBody: 'Select the request you want to cancel.',
        confirmTitle: 'Confirm cancellation',
        confirmPrefix: 'You are about to cancel:',
        yesLabel: 'Yes, cancel it',
        noLabel: 'No, keep it',
        docText: 'Your request ({{order_id}}) has been cancelled.',
        pdfFileName: 'cancellation-{{order_id}}',
        pdfTitle: 'Cancellation',
        pdfNote: "This request has been cancelled. Reply on WhatsApp if you need anything.",
      },
    },
  },
};

export interface Vertical {
  label: string;
  archetype: Archetype;
  memberLabel: string;
  memberSingular: string;
  feeLabel: string;
  /** Singular wording for one category, e.g. "Specialisation". */
  categoryLabel: string;
  /** Plural wording, for page headings and the sidebar. */
  categoryPlural: string;
  /**
   * Example category for the input placeholder.
   *
   * These used to be hardcoded in the pages ("e.g. Oils"), which read as a
   * mistake to anyone who wasn't a shop — a hospital was being asked for an
   * oil change. Example wording belongs with the vertical, not in the form.
   */
  categoryExample: string;
  /** Example member name, e.g. "Dr. Asha Rao" / "Deluxe Double Room". */
  memberExample: string;
  /** Example member title/role, e.g. "Cardiologist" / "Sea view". */
  memberTitleExample: string;
  /** Example qualifications, only shown for verticals that ask for them. */
  qualificationsExample?: string;
  allPages?: boolean;
}

export const VERTICALS: Record<string, Vertical> = {
  ecommerce: {
    label: 'E-commerce & Retail', archetype: 'catalog',
    memberLabel: 'Stores', memberSingular: 'Store', feeLabel: 'Price',
    categoryLabel: 'Category', categoryPlural: 'Categories', categoryExample: 'Footwear',
    memberExample: 'Banjara Hills store', memberTitleExample: 'Flagship store',
  },
  restaurant: {
    label: 'Restaurant & Food', archetype: 'catalog',
    memberLabel: 'Outlets', memberSingular: 'Outlet', feeLabel: 'Price',
    categoryLabel: 'Menu category', categoryPlural: 'Menu categories', categoryExample: 'Biryani',
    memberExample: 'Jubilee Hills outlet', memberTitleExample: 'Dine-in & takeaway',
  },
  grocery: {
    label: 'Grocery & Pharmacy', archetype: 'catalog',
    memberLabel: 'Stores', memberSingular: 'Store', feeLabel: 'Price',
    categoryLabel: 'Category', categoryPlural: 'Categories', categoryExample: 'Fresh produce',
    memberExample: 'MG Road store', memberTitleExample: 'Pharmacy counter',
  },
  hospital: {
    label: 'Hospital & Clinic', archetype: 'person',
    memberLabel: 'Doctors', memberSingular: 'Doctor', feeLabel: 'Consultation fee',
    categoryLabel: 'Specialisation', categoryPlural: 'Specialisations', categoryExample: 'Cardiology',
    memberExample: 'Dr. Asha Rao', memberTitleExample: 'Cardiologist',
    qualificationsExample: 'MBBS, MD (Cardiology)',
  },
  salon: {
    label: 'Salon, Spa & Wellness', archetype: 'person',
    memberLabel: 'Stylists', memberSingular: 'Stylist', feeLabel: 'Service price',
    categoryLabel: 'Service type', categoryPlural: 'Service types', categoryExample: 'Hair & styling',
    memberExample: 'Meera Nair', memberTitleExample: 'Senior stylist',
    qualificationsExample: 'Certified in advanced colouring',
  },
  gym: {
    label: 'Gym & Fitness', archetype: 'person',
    memberLabel: 'Trainers', memberSingular: 'Trainer', feeLabel: 'Plan price',
    categoryLabel: 'Programme', categoryPlural: 'Programmes', categoryExample: 'Strength training',
    memberExample: 'Arjun Mehta', memberTitleExample: 'Strength coach',
    qualificationsExample: 'ACE Certified Personal Trainer',
  },
  automobile: {
    label: 'Automobile & Service Centre', archetype: 'person',
    memberLabel: 'Services', memberSingular: 'Service', feeLabel: 'Service charge',
    categoryLabel: 'Service type', categoryPlural: 'Service types', categoryExample: 'Oil change',
    memberExample: 'Periodic service', memberTitleExample: 'Scheduled maintenance',
    qualificationsExample: 'Manufacturer-trained technician',
  },
  professional: {
    label: 'Professional Services (CA / Legal / Consulting)', archetype: 'person',
    memberLabel: 'Consultants', memberSingular: 'Consultant', feeLabel: 'Consultation fee',
    categoryLabel: 'Practice area', categoryPlural: 'Practice areas', categoryExample: 'Tax & GST',
    memberExample: 'Ravi Kumar', memberTitleExample: 'Chartered Accountant',
    qualificationsExample: 'CA, LLB',
  },
  homeservices: {
    label: 'Home & Local Services', archetype: 'person',
    memberLabel: 'Professionals', memberSingular: 'Professional', feeLabel: 'Visit charge',
    categoryLabel: 'Service type', categoryPlural: 'Service types', categoryExample: 'Plumbing',
    memberExample: 'Suresh Kumar', memberTitleExample: 'Plumber',
    qualificationsExample: 'ITI Plumbing, 8 years on site',
  },
  hotel: {
    label: 'Hotels & Resorts', archetype: 'unit',
    memberLabel: 'Room types', memberSingular: 'Room type', feeLabel: 'Price per night',
    categoryLabel: 'Room category', categoryPlural: 'Room categories', categoryExample: 'Deluxe rooms',
    memberExample: 'Deluxe Double Room', memberTitleExample: 'Sea view',
  },
  rooms: {
    label: 'Rooms, PG & Co-working', archetype: 'unit',
    memberLabel: 'Rooms & Spaces', memberSingular: 'Space', feeLabel: 'Rent',
    categoryLabel: 'Space type', categoryPlural: 'Space types', categoryExample: 'Private cabins',
    memberExample: 'Cabin 4A', memberTitleExample: '4-seater cabin',
  },
  events: {
    label: 'Events & Venues', archetype: 'unit',
    memberLabel: 'Venues', memberSingular: 'Venue', feeLabel: 'Package price',
    categoryLabel: 'Venue type', categoryPlural: 'Venue types', categoryExample: 'Banquet halls',
    memberExample: 'Grand Ballroom', memberTitleExample: 'Up to 500 guests',
  },
  realestate: {
    label: 'Real Estate', archetype: 'lead',
    memberLabel: 'Agents', memberSingular: 'Agent', feeLabel: 'Price',
    categoryLabel: 'Property type', categoryPlural: 'Property types', categoryExample: '3 BHK apartments',
    memberExample: 'Priya Sharma', memberTitleExample: 'Senior agent',
  },
  education: {
    label: 'Education & Coaching', archetype: 'lead',
    memberLabel: 'Courses & Faculty', memberSingular: 'Course', feeLabel: 'Course fee',
    categoryLabel: 'Stream', categoryPlural: 'Streams', categoryExample: 'Science',
    memberExample: 'NEET Crash Course', memberTitleExample: '6-month programme',
  },
  logistics: {
    label: 'Logistics & Delivery', archetype: 'notify',
    memberLabel: 'Members', memberSingular: 'Member', feeLabel: 'Charge',
    categoryLabel: 'Category', categoryPlural: 'Categories', categoryExample: 'Same-day delivery',
    memberExample: 'Hyderabad hub', memberTitleExample: 'Dispatch centre',
  },
  finance: {
    label: 'Banking, NBFC & Insurance', archetype: 'notify',
    memberLabel: 'Advisors', memberSingular: 'Advisor', feeLabel: 'Fee',
    categoryLabel: 'Product', categoryPlural: 'Products', categoryExample: 'Home loans',
    memberExample: 'Rahul Verma', memberTitleExample: 'Relationship manager',
  },
  other: {
    label: 'Other / Generic', archetype: 'catalog',
    memberLabel: 'Members', memberSingular: 'Member', feeLabel: 'Price',
    categoryLabel: 'Category', categoryPlural: 'Categories', categoryExample: 'Category name',
    memberExample: 'Member name', memberTitleExample: 'Role',
    allPages: true,
  },
};

export const VERTICAL_KEYS = Object.keys(VERTICALS);
export const DEFAULT_VERTICAL = 'other';

/** Options for a <select> of business categories, grouped-friendly order. */
export const VERTICAL_OPTIONS = VERTICAL_KEYS.map((k) => ({ value: k, label: VERTICALS[k].label }));

export interface VerticalConfig {
  key: string;
  label: string;
  archetype: Archetype;
  archetypeLabel: string;
  memberLabel: string;
  memberSingular: string;
  feeLabel: string;
  categoryLabel: string;
  categoryPlural: string;
  categoryExample: string;
  memberExample: string;
  memberTitleExample: string;
  qualificationsExample: string;
  /** What this tenant calls the person it serves: Customer / Patient / Guest / Client. */
  customerLabel: string;
  customerPlural: string;
  /** What this tenant calls its Orders page: Orders / Appointments / Bookings… */
  ordersLabel: string;
  /** The status options this vertical offers, in workflow order. */
  orderStatuses: OrderStatusOption[];
  /** Whether the Orders page shows the "Form submissions" tab. */
  formsTab: boolean;
  /** Default wording for the confirmation / details blocks. */
  confirm: ConfirmWording;
  pages: CrmView[];
  memberFields: MemberField[];
  /** True when this member field applies to the tenant's vertical. */
  has: (f: MemberField) => boolean;
  /** True when this sidebar page applies to the tenant's vertical. */
  showsPage: (p: CrmView) => boolean;
}

// What each vertical calls the person it serves. Anything not listed is a
// plain "Customer" (shops, restaurants, logistics, generic).
const CUSTOMER_TERMS: Record<string, { one: string; many: string }> = {
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
};
export const customerTerm = (key?: string) =>
  CUSTOMER_TERMS[String(key || '')] || { one: 'Customer', many: 'Customers' };

/**
 * Per-business overrides an admin can set, replacing the category defaults for
 * what members / categories / the customer are called. Empty strings mean
 * "use the default".
 */
export interface LabelOverrides {
  memberLabel?: string;
  memberSingular?: string;
  categoryLabel?: string;
  categoryPlural?: string;
  customerLabel?: string;
  customerPlural?: string;
}

/** Resolve the presentation config for a business category key. */
export function verticalConfig(key?: string, overrides?: LabelOverrides | null): VerticalConfig {
  const k = key && VERTICALS[key] ? key : DEFAULT_VERTICAL;
  const v = VERTICALS[k];
  const a = ARCHETYPES[v.archetype];
  const pages = v.allPages ? [...ALL_PAGES] : a.pages;
  const cust = customerTerm(k);
  // An override wins only when it's a non-blank string.
  const ov = (val?: string) => (typeof val === 'string' && val.trim() ? val.trim() : undefined);
  const o = overrides || {};
  return {
    key: k,
    label: v.label,
    archetype: v.archetype,
    archetypeLabel: a.label,
    memberLabel: ov(o.memberLabel) ?? v.memberLabel,
    memberSingular: ov(o.memberSingular) ?? v.memberSingular,
    feeLabel: v.feeLabel,
    categoryLabel: ov(o.categoryLabel) ?? v.categoryLabel,
    categoryPlural: ov(o.categoryPlural) ?? v.categoryPlural,
    categoryExample: v.categoryExample,
    memberExample: v.memberExample,
    memberTitleExample: v.memberTitleExample,
    qualificationsExample: v.qualificationsExample || 'Qualifications',
    customerLabel: ov(o.customerLabel) ?? cust.one,
    customerPlural: ov(o.customerPlural) ?? cust.many,
    ordersLabel: a.ordersLabel,
    orderStatuses: a.orderStatuses,
    // "Other / Generic" opts into every page, so it keeps the forms tab too.
    formsTab: v.allPages ? true : a.formsTab,
    confirm: a.confirm,
    pages,
    memberFields: a.memberFields,
    has: (f) => a.memberFields.includes(f),
    showsPage: (p) => pages.includes(p),
  };
}
