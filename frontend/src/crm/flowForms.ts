// What the Flow builder offers each business type: which blocks it shows, what
// they're called, and the ready-made forms behind the "Forms" chip.
//
// A clinic has no catalog and a shop has no appointment book, so offering
// both to everyone gave each business blocks that could only ever come back
// empty. Hiding a block only removes its chip: a flow that already uses one
// keeps working and stays editable.
import type { FlowComponentType, FlowInputType } from './types';
import type { VerticalConfig } from './verticals';

/** Every chip in the Build palette. */
export type BlockId =
  | 'register' | 'booking' | 'reschedule' | 'cancel' | 'paymethod'
  | 'banner' | 'heading' | 'subheading' | 'body' | 'caption'
  | 'radio' | 'checkbox' | 'categories' | 'members' | 'orders' | 'active_orders' | 'slots' | 'appointments'
  | 'dropdown' | 'text' | 'textarea' | 'date' | 'photo' | 'document'
  | 'address' | 'rating' | 'yesno' | 'timewindow' | 'consent' | 'daterange';

// Blocks each kind of business has no data behind. "Other / Generic" sees all.
const HIDDEN: Record<VerticalConfig['archetype'], BlockId[]> = {
  // Shops: no appointment book and no staff schedules.
  catalog: ['booking', 'reschedule', 'members', 'slots', 'appointments', 'daterange'],
  // Appointments: "My appointments" is their list; there are no shop orders.
  person: ['orders', 'daterange'],
  // Bookings: rooms / spaces / venues, listed under "My bookings".
  unit: ['orders'],
  // Enquiries: agents and courses keep no working hours, so no times can be
  // offered, and an enquiry isn't paid for or cancelled here.
  lead: ['booking', 'reschedule', 'slots', 'appointments', 'orders', 'active_orders', 'cancel', 'paymethod', 'daterange'],
  // Notification-led: no categories, members or orders pages hold any data.
  notify: [
    'categories', 'members', 'slots', 'appointments', 'orders', 'active_orders',
    'booking', 'reschedule', 'cancel', 'paymethod', 'daterange',
  ],
};

/** Whether this business type gets the block's chip. */
export function blockShown(id: BlockId, v: VerticalConfig): boolean {
  if (v.key === 'other') return true;
  return !HIDDEN[v.archetype].includes(id);
}

const BOOK_LABEL: Record<string, string> = { hotel: 'Book a room', rooms: 'Book a space', events: 'Book a venue' };

/** The chip's name in this business's words ("Doctors list", "Cancel appointment"). */
export function blockLabel(id: BlockId, fallback: string, v: VerticalConfig): string {
  if (v.key === 'other') return fallback;
  switch (id) {
    case 'booking':
      return BOOK_LABEL[v.key] || 'Book appointment';
    case 'cancel':
      // "Cancel an appointment" → "Cancel appointment"
      return v.confirm.cancel.pickTitle.replace(/^(\w+) an? /, '$1 ');
    case 'categories':
      return `${v.categoryLabel} list`;
    case 'members':
      return `${v.memberLabel} list`;
    case 'appointments':
      return v.archetype === 'unit' ? 'My bookings' : 'My appointments';
    case 'orders':
      return 'My orders';
    case 'reschedule':
      return v.archetype === 'unit' ? 'Change dates' : 'Reschedule';
    default:
      return fallback;
  }
}

/** The two answers of the Payment method chip, worded for the business. */
export function payOptions(v: VerticalConfig): { cod: string; online: string } {
  if (v.archetype === 'person') return { cod: 'Pay at the visit', online: 'Pay online' };
  if (v.archetype === 'unit') return { cod: 'Pay on arrival', online: 'Pay online' };
  return { cod: 'Cash on delivery', online: 'Pay online' };
}

// ---------------------------------------------------------------------------
// Ready-made forms
// ---------------------------------------------------------------------------
/** One field of a ready-made form. Becomes an ordinary component when added. */
export interface FieldSpec {
  type: FlowComponentType;
  name: string;
  label: string;
  required?: boolean;
  inputType?: FlowInputType;
  helperText?: string;
  description?: string;
  /** Static options: [id, title]. */
  options?: [string, string][];
  /** A dynamic list instead (only "orders": the customer's own orders). */
  source?: 'orders';
  prefill?: 'phone';
  locked?: boolean;
  maxFiles?: number;
  photoSource?: 'camera' | 'gallery' | 'camera_gallery';
  maxDaysAhead?: number;
  pastDays?: number;
  endLabel?: string;
}

export interface FormPreset {
  id: string;
  title: string;
  icon: string;
  /** Heading shown on the screen. */
  heading: string;
  body?: string;
  /** The Submit button's label. */
  button: string;
  fields: FieldSpec[];
}

/** "Two-wheeler" → "two_wheeler", for option ids. */
const slug = (s: string) =>
  s.toLowerCase().replace(/₹/g, 'rs').replace(/\+/g, 'plus').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'opt';
const opts = (...titles: string[]): [string, string][] => titles.map((t) => [slug(t), t]);

// Field helpers. Labels stay within WhatsApp's limits: 20 characters for text
// inputs, text areas and dropdowns, 30 for lists and file pickers, 30 for an
// option's title (checked by the tests).
const text = (name: string, label: string, required = true, extra: Partial<FieldSpec> = {}): FieldSpec =>
  ({ type: 'TextInput', name, label, required, inputType: 'text', ...extra });
const num = (name: string, label: string, required = true): FieldSpec =>
  ({ type: 'TextInput', name, label, required, inputType: 'number' });
const area = (name: string, label: string, required = true): FieldSpec => ({ type: 'TextArea', name, label, required });
const drop = (name: string, label: string, options: [string, string][], required = true): FieldSpec =>
  ({ type: 'Dropdown', name, label, required, options });
const radio = (name: string, label: string, options: [string, string][], required = true): FieldSpec =>
  ({ type: 'RadioButtonsGroup', name, label, required, options });
const checks = (name: string, label: string, options: [string, string][], required = false): FieldSpec =>
  ({ type: 'CheckboxGroup', name, label, required, options });
const date = (name: string, label: string, days = 60, required = true): FieldSpec =>
  ({ type: 'DatePicker', name, label, required, maxDaysAhead: days });
const pastDate = (name: string, label: string, days = 365, required = true): FieldSpec =>
  ({ type: 'DatePicker', name, label, required, pastDays: days });
const photo = (name: string, label: string, required = false, maxFiles = 1): FieldSpec =>
  ({ type: 'PhotoPicker', name, label, required, maxFiles, photoSource: 'camera_gallery' });
const doc = (name: string, label: string, required = false, maxFiles = 1, description = ''): FieldSpec =>
  ({ type: 'DocumentPicker', name, label, required, maxFiles, ...(description ? { description } : {}) });
const consent = (label: string): FieldSpec => ({ type: 'OptIn', name: 'consent', label, required: true });

// Every form starts with who's asking: their name and their WhatsApp number,
// filled in from the chat and locked.
const NAME = (label = 'Name'): FieldSpec => text('name', label);
const PHONE: FieldSpec = {
  type: 'TextInput', name: 'whatsapp_number', label: 'WhatsApp number', inputType: 'phone',
  required: true, prefill: 'phone', locked: true, helperText: 'Auto-filled from your WhatsApp account',
};
const who = (nameLabel?: string) => [NAME(nameLabel), PHONE];

const TIMES = opts('Morning (9 am – 12 pm)', 'Afternoon (12 – 4 pm)', 'Evening (4 – 8 pm)');
const ID_TYPES = opts('Aadhaar', 'Passport', 'Driving licence', 'Voter ID', 'PAN card');

/** The 1–5 rating list, best first. Ids are rate_<n> so the CRM can draw stars. */
export const RATING_OPTIONS: [string, string][] = [
  ['rate_5', '★★★★★ Excellent'],
  ['rate_4', '★★★★ Good'],
  ['rate_3', '★★★ Okay'],
  ['rate_2', '★★ Poor'],
  ['rate_1', '★ Very poor'],
];
export const TIME_OPTIONS = TIMES;

// ---- forms every business gets --------------------------------------------
const COMMON: FormPreset[] = [
  {
    id: 'feedback', title: 'Feedback', icon: 'reviews', heading: 'Share your feedback',
    body: 'It takes less than a minute.', button: 'Send feedback',
    fields: [...who(), radio('rating', 'How was your experience?', RATING_OPTIONS), area('comments', 'Comments', false)],
  },
  {
    id: 'callback', title: 'Callback request', icon: 'phone_callback', heading: 'Request a callback',
    body: 'Tell us when to call and what it’s about.', button: 'Request callback',
    fields: [
      ...who(),
      drop('callback_topic', 'What is it about?', opts('New enquiry', 'Existing booking', 'Payment', 'Something else')),
      drop('callback_time', 'Best time to call', TIMES),
      area('callback_note', 'Anything to add?', false),
    ],
  },
  {
    id: 'complaint', title: 'Complaint / support', icon: 'support_agent', heading: 'Raise a complaint',
    body: 'We’re sorry something went wrong. Tell us and we’ll fix it.', button: 'Submit complaint',
    fields: [
      ...who(),
      drop('issue_type', 'Issue type', opts('Service quality', 'Delay', 'Billing', 'Staff behaviour', 'Other')),
      area('issue_details', 'What happened?'),
      photo('issue_photo', 'Photo (optional)'),
    ],
  },
];

// ---- forms for each business type -------------------------------------------
const BY_VERTICAL: Record<string, FormPreset[]> = {
  hospital: [
    {
      id: 'patient_registration', title: 'Patient registration', icon: 'badge', heading: 'Patient registration',
      body: 'Please fill this in before your first visit.', button: 'Register',
      fields: [
        ...who('Patient name'),
        num('age', 'Age'),
        drop('gender', 'Gender', opts('Male', 'Female', 'Other')),
        drop('blood_group', 'Blood group', opts('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'Don’t know'), false),
        area('allergies', 'Allergies', false),
        checks('conditions', 'Existing conditions', opts('Diabetes', 'Blood pressure', 'Heart condition', 'Asthma', 'Thyroid', 'None')),
        text('emergency_contact', 'Emergency contact', false, { inputType: 'phone' }),
      ],
    },
    {
      id: 'consultation_request', title: 'Consultation request', icon: 'medical_services', heading: 'Consultation request',
      body: 'Tell us how you’re feeling. A doctor will get back to you.', button: 'Send request',
      fields: [
        ...who('Patient name'),
        area('symptoms', 'Symptoms'),
        drop('symptoms_since', 'Since when?', opts('Today', '2–3 days', 'About a week', 'More than a week')),
        radio('severity', 'How severe is it?', opts('Mild', 'Moderate', 'Severe')),
        photo('symptom_photo', 'Photo (optional)'),
      ],
    },
    {
      id: 'upload_reports', title: 'Upload reports', icon: 'upload_file', heading: 'Upload your reports',
      button: 'Upload',
      fields: [
        ...who('Patient name'),
        drop('report_type', 'Report type', opts('Blood test', 'X-ray / scan', 'Prescription', 'Discharge summary', 'Other')),
        doc('reports', 'Reports', true, 5),
        area('report_notes', 'Notes', false),
      ],
    },
  ],
  salon: [
    {
      id: 'service_preferences', title: 'Service preferences', icon: 'content_cut', heading: 'Your service preferences',
      body: 'Help us get it right before you arrive.', button: 'Send',
      fields: [
        ...who(),
        checks('services_wanted', 'Services you want', opts('Haircut', 'Hair colour', 'Facial', 'Manicure / pedicure', 'Massage', 'Bridal makeup'), true),
        drop('hair_type', 'Hair type', opts('Straight', 'Wavy', 'Curly', 'Coily'), false),
        area('concerns', 'Any concerns?', false),
        photo('reference_photo', 'Reference photo'),
      ],
    },
    {
      id: 'skin_allergy_check', title: 'Skin & allergy check', icon: 'spa', heading: 'Skin & allergy check',
      button: 'Submit',
      fields: [
        ...who(),
        area('allergies', 'Allergies', false),
        radio('sensitive_skin', 'Do you have sensitive skin?', opts('Yes', 'No', 'Not sure')),
        area('products_used', 'Products you use', false),
        consent('I confirm these details are correct and agree to a patch test if needed.'),
      ],
    },
  ],
  gym: [
    {
      id: 'membership_enquiry', title: 'Membership enquiry', icon: 'fitness_center', heading: 'Membership enquiry',
      button: 'Send enquiry',
      fields: [
        ...who(),
        radio('fitness_goal', 'Your main goal', opts('Weight loss', 'Muscle gain', 'General fitness', 'Sports training')),
        drop('experience_level', 'Experience level', opts('Beginner', 'Intermediate', 'Advanced')),
        drop('preferred_time', 'Preferred time', TIMES),
        drop('plan_length', 'Plan length', opts('1 month', '3 months', '6 months', '12 months')),
      ],
    },
    {
      id: 'health_declaration', title: 'Health declaration', icon: 'health_and_safety', heading: 'Health declaration',
      body: 'For your safety, before you start training.', button: 'Submit',
      fields: [
        ...who(),
        checks('conditions', 'Health conditions', opts('Heart condition', 'High blood pressure', 'Diabetes', 'Asthma', 'Recent surgery', 'None')),
        area('injuries', 'Injuries', false),
        radio('doctor_clearance', 'Cleared by a doctor?', opts('Yes', 'No', 'Not needed')),
        consent('I confirm this information is true and I will exercise at my own risk.'),
      ],
    },
    {
      id: 'free_trial', title: 'Free trial request', icon: 'event_available', heading: 'Book a free trial',
      button: 'Request trial',
      fields: [...who(), date('trial_date', 'Trial date', 30), drop('trial_time', 'Preferred time', TIMES)],
    },
  ],
  automobile: [
    {
      id: 'vehicle_service', title: 'Vehicle service request', icon: 'car_repair', heading: 'Vehicle service request',
      button: 'Request service',
      fields: [
        ...who(),
        radio('vehicle_type', 'Vehicle', opts('Two-wheeler', 'Car / SUV', 'Commercial')),
        text('vehicle_model', 'Make & model'),
        text('registration_no', 'Registration no.'),
        num('km_reading', 'Km reading', false),
        checks('work_needed', 'Work needed', opts('General service', 'Oil change', 'Brakes', 'Tyres / alignment', 'AC service', 'Repair / noise', 'Washing'), true),
        radio('pickup_needed', 'Need pickup & drop?', opts('Yes', 'No')),
        photo('issue_photo', 'Photo of the issue'),
      ],
    },
    {
      id: 'accident_claim', title: 'Accident / insurance claim', icon: 'car_crash', heading: 'Accident / insurance claim',
      button: 'Submit claim',
      fields: [
        ...who(),
        text('registration_no', 'Registration no.'),
        pastDate('incident_date', 'Date of incident'),
        area('incident_details', 'What happened?'),
        photo('damage_photos', 'Damage photos', true, 5),
        doc('policy_document', 'Policy document'),
      ],
    },
  ],
  professional: [
    {
      id: 'client_intake', title: 'Client intake', icon: 'work', heading: 'Client intake',
      button: 'Submit',
      fields: [
        ...who(),
        text('email', 'Email', false, { inputType: 'email' }),
        drop('service_needed', 'Service needed', opts('Income tax / ITR', 'GST', 'Company registration', 'Audit', 'Legal advice', 'Other')),
        radio('entity_type', 'You are', opts('An individual', 'A company / firm')),
        text('pan_gstin', 'PAN / GSTIN', false),
        area('brief', 'Brief of your need'),
        doc('documents', 'Documents (optional)', false, 5),
      ],
    },
    {
      id: 'document_collection', title: 'Document collection', icon: 'folder_shared', heading: 'Share your documents',
      button: 'Upload',
      fields: [
        ...who(),
        drop('document_type', 'Document type', opts('Form 16', 'Bank statement', 'Invoices', 'PAN / Aadhaar', 'Other')),
        drop('financial_year', 'Financial year', opts('FY 2026–27', 'FY 2025–26', 'FY 2024–25', 'Older')),
        doc('documents', 'Documents', true, 10),
        area('notes', 'Notes', false),
      ],
    },
  ],
  homeservices: [
    {
      id: 'service_request', title: 'Service request', icon: 'home_repair_service', heading: 'Service request',
      button: 'Book visit',
      fields: [
        ...who(),
        drop('service_type', 'Service', opts('Plumbing', 'Electrical', 'Carpentry', 'Cleaning', 'Appliance repair', 'Pest control', 'Painting', 'Other')),
        area('address', 'Address'),
        num('pincode', 'Pincode'),
        area('problem', 'Describe the problem'),
        photo('problem_photo', 'Photo (optional)'),
        date('visit_date', 'Preferred date', 30),
        drop('visit_time', 'Preferred time', TIMES),
      ],
    },
  ],
  hotel: [
    {
      id: 'stay_enquiry', title: 'Stay enquiry', icon: 'hotel', heading: 'Stay enquiry',
      button: 'Send enquiry',
      fields: [
        ...who(),
        { type: 'CalendarPicker', name: 'stay_dates', label: 'Check-in', endLabel: 'Check-out', required: true, maxDaysAhead: 365 },
        num('adults', 'Adults'),
        num('children', 'Children', false),
        drop('room_preference', 'Room preference', opts('Standard', 'Deluxe', 'Suite', 'No preference')),
        area('special_requests', 'Special requests', false),
      ],
    },
    {
      id: 'pre_arrival', title: 'Pre-arrival check-in', icon: 'luggage', heading: 'Pre-arrival check-in',
      body: 'Check in now and skip the queue at the desk.', button: 'Submit',
      fields: [
        ...who('Guest name'),
        drop('id_type', 'ID type', ID_TYPES),
        photo('id_photo', 'Photo of your ID', true, 2),
        drop('arrival_time', 'Arrival time', opts('Before 12 pm', '12 pm – 4 pm', '4 pm – 8 pm', 'After 8 pm')),
        drop('visit_purpose', 'Purpose of visit', opts('Leisure', 'Business', 'Event', 'Other')),
      ],
    },
  ],
  rooms: [
    {
      id: 'space_enquiry', title: 'Space enquiry', icon: 'meeting_room', heading: 'Space enquiry',
      button: 'Send enquiry',
      fields: [
        ...who(),
        drop('space_type', 'Looking for', opts('PG / hostel bed', 'Private room', 'Co-working desk', 'Private cabin', 'Meeting room')),
        date('move_in_date', 'Move-in date', 90),
        drop('stay_duration', 'Duration', opts('Under a month', '1–3 months', '3–6 months', '6+ months')),
        num('occupancy', 'People / seats'),
      ],
    },
    {
      id: 'tenant_kyc', title: 'Tenant KYC', icon: 'badge', heading: 'Tenant KYC',
      button: 'Submit',
      fields: [
        ...who(),
        drop('id_type', 'ID type', ID_TYPES),
        photo('id_proof', 'ID proof', true, 2),
        text('occupation', 'Occupation / company'),
        text('emergency_contact', 'Emergency contact', true, { inputType: 'phone' }),
        consent('I confirm these details are correct.'),
      ],
    },
  ],
  events: [
    {
      id: 'event_enquiry', title: 'Event enquiry', icon: 'celebration', heading: 'Event enquiry',
      button: 'Send enquiry',
      fields: [
        ...who(),
        drop('event_type', 'Event type', opts('Wedding', 'Birthday', 'Corporate event', 'Conference', 'Other')),
        date('event_date', 'Event date', 365),
        num('guest_count', 'Number of guests'),
        drop('budget_range', 'Budget', opts('Under ₹1 lakh', '₹1–3 lakh', '₹3–5 lakh', 'Above ₹5 lakh')),
        checks('services_needed', 'Also needed', opts('Catering', 'Decor', 'Photography', 'DJ / music', 'Stay for guests')),
        area('event_notes', 'Anything else?', false),
      ],
    },
  ],
  realestate: [
    {
      id: 'property_requirement', title: 'Property requirement', icon: 'apartment', heading: 'What are you looking for?',
      button: 'Send',
      fields: [
        ...who(),
        radio('buy_or_rent', 'Looking to', opts('Buy', 'Rent')),
        drop('property_type', 'Property type', opts('Apartment', 'Independent house', 'Villa', 'Plot', 'Commercial')),
        drop('bhk', 'Size', opts('1 BHK', '2 BHK', '3 BHK', '4+ BHK', 'Not applicable')),
        drop('budget_range', 'Budget', opts('Under ₹50 lakh', '₹50 lakh – 1 crore', '₹1–2 crore', 'Above ₹2 crore')),
        text('preferred_location', 'Preferred location'),
        drop('timeline', 'When do you need it?', opts('Immediately', 'Within 3 months', '3–6 months', 'Just exploring')),
      ],
    },
    {
      id: 'site_visit', title: 'Site visit request', icon: 'directions_walk', heading: 'Book a site visit',
      button: 'Request visit',
      fields: [...who(), text('property_interest', 'Property / project', false), date('visit_date', 'Visit date', 30), drop('visit_time', 'Preferred time', TIMES)],
    },
    {
      id: 'list_property', title: 'List my property', icon: 'add_home', heading: 'List your property',
      button: 'Submit listing',
      fields: [
        ...who(),
        radio('listing_for', 'Listing for', opts('Sale', 'Rent')),
        drop('property_type', 'Property type', opts('Apartment', 'Independent house', 'Villa', 'Plot', 'Commercial')),
        text('property_location', 'Location'),
        text('expected_price', 'Expected price'),
        photo('property_photos', 'Property photos', false, 10),
      ],
    },
  ],
  education: [
    {
      id: 'admission_enquiry', title: 'Admission enquiry', icon: 'school', heading: 'Admission enquiry',
      button: 'Send enquiry',
      fields: [
        ...who('Your name'),
        text('student_name', 'Student name'),
        text('class_grade', 'Class / grade'),
        drop('course_interest', 'Course of interest', opts('School tuition', 'JEE / NEET', 'Competitive exams', 'Languages', 'Skill course', 'Other')),
        radio('study_mode', 'Mode', opts('Online', 'Offline / classroom', 'Either')),
      ],
    },
    {
      id: 'demo_class', title: 'Demo class request', icon: 'co_present', heading: 'Book a demo class',
      button: 'Request demo',
      fields: [...who(), text('subject', 'Subject'), date('demo_date', 'Demo date', 30), drop('demo_time', 'Preferred time', TIMES)],
    },
    {
      id: 'admission_documents', title: 'Admission documents', icon: 'folder_shared', heading: 'Admission documents',
      button: 'Upload',
      fields: [...who(), text('student_name', 'Student name'), doc('admission_docs', 'Documents', true, 10, 'Marksheet, ID proof, photo')],
    },
  ],
  ecommerce: [
    {
      id: 'return_exchange', title: 'Return / exchange', icon: 'assignment_return', heading: 'Return or exchange',
      button: 'Submit request',
      fields: [
        ...who(),
        { type: 'RadioButtonsGroup', name: 'selected_order', label: 'Which order?', required: true, source: 'orders' },
        drop('return_reason', 'Reason', opts('Damaged', 'Wrong item', 'Size / fit issue', 'Not as described', 'Changed my mind')),
        photo('item_photo', 'Photo of the item'),
        radio('resolution', 'What would you like?', opts('Refund', 'Exchange')),
      ],
    },
    {
      id: 'bulk_order', title: 'Bulk order enquiry', icon: 'inventory_2', heading: 'Bulk order enquiry',
      button: 'Send enquiry',
      fields: [
        ...who(),
        text('business_name', 'Business name', false),
        area('products_needed', 'Products needed'),
        text('quantity', 'Quantity'),
        date('needed_by', 'Needed by', 90, false),
      ],
    },
  ],
  restaurant: [
    {
      id: 'table_reservation', title: 'Table reservation', icon: 'table_restaurant', heading: 'Reserve a table',
      button: 'Request table',
      fields: [
        ...who(),
        date('reservation_date', 'Date', 30),
        drop('reservation_time', 'Time', opts('Lunch (12 – 3 pm)', 'Evening (6 – 8 pm)', 'Dinner (8 – 11 pm)')),
        num('guests', 'Guests'),
        drop('occasion', 'Occasion', opts('None', 'Birthday', 'Anniversary', 'Business', 'Other'), false),
        radio('seating', 'Seating', opts('Indoor', 'Outdoor', 'No preference')),
      ],
    },
    {
      id: 'party_catering', title: 'Party / catering enquiry', icon: 'restaurant', heading: 'Party / catering enquiry',
      button: 'Send enquiry',
      fields: [
        ...who(),
        date('event_date', 'Event date', 365),
        num('guest_count', 'Number of guests'),
        checks('cuisine', 'Cuisine', opts('North Indian', 'South Indian', 'Chinese', 'Continental', 'Desserts')),
        drop('budget_per_head', 'Budget per head', opts('Under ₹300', '₹300–600', '₹600–1,000', 'Above ₹1,000')),
      ],
    },
  ],
  grocery: [
    {
      id: 'prescription_upload', title: 'Upload prescription', icon: 'medication', heading: 'Upload your prescription',
      body: 'A photo or a PDF of the prescription is enough.', button: 'Send prescription',
      fields: [
        ...who(),
        text('patient_name', 'Patient name'),
        photo('prescription_photo', 'Prescription photo', false, 3),
        doc('prescription_pdf', 'Or a PDF'),
        area('address', 'Delivery address'),
      ],
    },
    {
      id: 'monthly_list', title: 'Monthly list', icon: 'list_alt', heading: 'Your monthly list',
      button: 'Send list',
      fields: [
        ...who(),
        area('item_list', 'Your list'),
        drop('delivery_day', 'Delivery day', opts('Weekday morning', 'Weekday evening', 'Weekend')),
        area('address', 'Delivery address'),
      ],
    },
  ],
  logistics: [
    {
      id: 'pickup_request', title: 'Pickup request', icon: 'local_shipping', heading: 'Book a pickup',
      button: 'Book pickup',
      fields: [
        ...who(),
        area('pickup_address', 'Pickup address'),
        area('drop_address', 'Drop address'),
        drop('package_type', 'Package type', opts('Documents', 'Small parcel', 'Large parcel', 'Fragile', 'Food')),
        num('weight_kg', 'Weight (kg)', false),
        date('pickup_date', 'Pickup date', 14),
        photo('package_photo', 'Package photo'),
      ],
    },
    {
      id: 'delivery_issue', title: 'Delivery issue', icon: 'report', heading: 'Report a delivery issue',
      button: 'Report issue',
      fields: [
        ...who(),
        text('tracking_no', 'Tracking number'),
        drop('issue_type', 'Issue', opts('Not delivered yet', 'Damaged package', 'Wrong item', 'Delivered elsewhere', 'Other')),
        area('issue_details', 'What happened?', false),
        photo('issue_photo', 'Photo (optional)'),
      ],
    },
  ],
  finance: [
    {
      id: 'loan_enquiry', title: 'Loan enquiry', icon: 'account_balance', heading: 'Loan enquiry',
      button: 'Check eligibility',
      fields: [
        ...who(),
        drop('loan_type', 'Loan type', opts('Home loan', 'Personal loan', 'Business loan', 'Car loan', 'Gold loan', 'Education loan')),
        num('loan_amount', 'Amount needed'),
        drop('income_range', 'Monthly income', opts('Under ₹25,000', '₹25,000–50,000', '₹50,000–1 lakh', 'Above ₹1 lakh')),
        radio('employment_type', 'You are', opts('Salaried', 'Self-employed', 'Business owner')),
        text('city', 'City'),
        consent('I agree to be contacted about this loan enquiry.'),
      ],
    },
    {
      id: 'kyc_documents', title: 'KYC documents', icon: 'verified_user', heading: 'KYC documents',
      button: 'Submit',
      fields: [
        ...who(),
        text('pan', 'PAN'),
        doc('id_proof', 'ID proof', true, 2),
        doc('address_proof', 'Address proof', true, 2),
        consent('I consent to the use of these documents for KYC verification.'),
      ],
    },
    {
      id: 'claim_intimation', title: 'Claim intimation', icon: 'policy', heading: 'Claim intimation',
      button: 'Submit claim',
      fields: [
        ...who(),
        text('policy_no', 'Policy number'),
        drop('claim_type', 'Claim type', opts('Health', 'Motor', 'Life', 'Home / property', 'Travel', 'Other')),
        pastDate('incident_date', 'Date of incident'),
        area('incident_details', 'What happened?'),
        doc('claim_documents', 'Documents', false, 10),
      ],
    },
  ],
  other: [
    {
      id: 'enquiry', title: 'Enquiry form', icon: 'contact_support', heading: 'Send us your enquiry',
      button: 'Send enquiry',
      fields: [
        ...who(),
        text('email', 'Email', false, { inputType: 'email' }),
        area('enquiry', 'Your enquiry'),
        drop('callback_time', 'Best time to call', TIMES, false),
      ],
    },
  ],
};

/** The forms the "Forms" chip offers this business: its own, then the common ones. */
export function formsFor(v: VerticalConfig): { own: FormPreset[]; common: FormPreset[] } {
  return { own: BY_VERTICAL[v.key] || [], common: COMMON };
}

/** Every preset (tests check their labels against WhatsApp's limits). */
export function allFormPresets(): FormPreset[] {
  return [...COMMON, ...Object.values(BY_VERTICAL).flat()];
}
