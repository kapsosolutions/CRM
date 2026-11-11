// What the Flow builder offers each business type: which blocks it shows, what
// they're called, and the ready-made forms behind the "Forms" chip.
//
// A clinic has no catalog and a shop has no appointment book, so offering
// both to everyone gave each business blocks that could only ever come back
// empty. Hiding a block only removes its chip: a flow that already uses one
// keeps working and stays editable.
import type { FlowComponentType, FlowInputType, Registration, WaFlowDef } from './types';
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

const BOOK_LABEL: Record<string, string> = { hotel: 'Book a room', rooms: 'Book a space', events: 'Book a venue', it: 'Book a meeting' };

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
const IT_ROLES = opts(
  'Software developer', 'Frontend developer', 'Backend developer', 'Mobile app developer', 'QA / testing',
  'UI / UX design', 'DevOps / cloud', 'Data / AI', 'Project manager', 'Sales / business', 'HR / admin', 'Other',
);
const IT_EXPERIENCE = opts('Fresher', '1–2 years', '3–5 years', '6–9 years', '10+ years');

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
    {
      id: 'home_sample_collection', title: 'Home sample collection', icon: 'science', heading: 'Book a home sample collection',
      body: 'A technician comes to your home to collect the sample.', button: 'Book collection',
      fields: [
        ...who('Patient name'),
        checks('tests_needed', 'Tests needed', opts('Complete blood count', 'Sugar (fasting / PP)', 'Thyroid profile', 'Lipid profile', 'Liver / kidney function', 'Vitamin D / B12', 'Other'), true),
        area('collection_address', 'Address'),
        date('collection_date', 'Collection date', 14),
        drop('collection_time', 'Preferred time', opts('6 – 8 am', '8 – 10 am', '10 am – 12 pm')),
        photo('prescription_photo', 'Prescription (optional)'),
      ],
    },
    {
      id: 'health_checkup', title: 'Health check-up enquiry', icon: 'favorite', heading: 'Health check-up packages',
      button: 'Send enquiry',
      fields: [
        ...who(),
        num('age', 'Age'),
        drop('gender', 'Gender', opts('Male', 'Female', 'Other')),
        drop('package_interest', 'Package', opts('Basic check-up', 'Full body check-up', 'Diabetes care', 'Heart care', 'Women’s health', 'Senior citizen')),
        radio('checkup_for', 'Who is it for?', opts('Myself', 'A family member', 'A couple')),
        date('checkup_date', 'Preferred date', 60, false),
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
    {
      id: 'bridal_enquiry', title: 'Bridal & event makeup', icon: 'face_retouching_natural', heading: 'Bridal & event makeup enquiry',
      button: 'Send enquiry',
      fields: [
        ...who(),
        drop('occasion_type', 'Occasion', opts('Wedding', 'Engagement', 'Reception', 'Party / function', 'Photoshoot')),
        date('occasion_date', 'Event date', 365),
        checks('looks_needed', 'Services needed', opts('Bridal makeup', 'Hair styling', 'Saree draping', 'Mehendi', 'Pre-bridal package', 'Family makeup'), true),
        radio('service_at', 'Where?', opts('At the salon', 'At my venue')),
        num('people_count', 'Number of people', false),
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
    {
      id: 'personal_training', title: 'Personal training enquiry', icon: 'sports', heading: 'Personal training',
      button: 'Send enquiry',
      fields: [
        ...who(),
        radio('fitness_goal', 'Your main goal', opts('Weight loss', 'Muscle gain', 'General fitness', 'Sports training')),
        drop('training_days', 'Days per week', opts('2 days', '3 days', '4 days', '5–6 days')),
        drop('preferred_time', 'Preferred time', TIMES),
        radio('trainer_pref', 'Trainer preference', opts('Male trainer', 'Female trainer', 'No preference')),
        area('health_notes', 'Injuries / notes', false),
      ],
    },
    {
      id: 'membership_freeze', title: 'Freeze membership', icon: 'pause_circle', heading: 'Freeze your membership',
      body: 'Going away or unwell? Pause your plan and we’ll extend it.', button: 'Request freeze',
      fields: [
        ...who(),
        text('member_id', 'Member ID', false),
        date('freeze_from', 'Freeze from', 30),
        drop('freeze_length', 'For how long?', opts('1 week', '2 weeks', '1 month', '2 months')),
        drop('freeze_reason', 'Reason', opts('Travel', 'Medical', 'Exams / work', 'Other')),
      ],
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
    {
      id: 'test_drive', title: 'Test drive booking', icon: 'directions_car', heading: 'Book a test drive',
      button: 'Book test drive',
      fields: [
        ...who(),
        text('car_model', 'Model'),
        radio('fuel_type', 'Fuel type', opts('Petrol', 'Diesel', 'CNG', 'Electric', 'Hybrid')),
        radio('drive_at', 'Where?', opts('At the showroom', 'At my home')),
        date('drive_date', 'Test drive date', 30),
        drop('drive_time', 'Preferred time', TIMES),
      ],
    },
    {
      id: 'car_valuation', title: 'Sell / exchange my vehicle', icon: 'price_check', heading: 'Get a price for your vehicle',
      button: 'Get valuation',
      fields: [
        ...who(),
        text('vehicle_model', 'Make & model'),
        drop('vehicle_year', 'Year', opts('2025–2026', '2022–2024', '2019–2021', '2015–2018', 'Before 2015')),
        drop('km_driven', 'Kilometres driven', opts('Under 20,000', '20,000–50,000', '50,000–1 lakh', 'Above 1 lakh')),
        radio('owners', 'Owners', opts('1st owner', '2nd owner', '3rd owner or more')),
        radio('sell_or_exchange', 'You want to', opts('Sell', 'Exchange for a new one')),
        photo('vehicle_photos', 'Vehicle photos', false, 4),
      ],
    },
    {
      id: 'roadside_assistance', title: 'Roadside assistance', icon: 'warning', heading: 'Need help on the road?',
      body: 'Tell us where you are and we’ll send help.', button: 'Send request',
      fields: [
        ...who(),
        text('registration_no', 'Registration no.'),
        drop('breakdown_type', 'Problem', opts('Won’t start', 'Flat tyre', 'Battery down', 'Accident', 'Out of fuel', 'Locked out', 'Other')),
        area('breakdown_location', 'Where are you?'),
        photo('breakdown_photo', 'Photo (optional)'),
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
    {
      id: 'tax_filing', title: 'Tax filing request', icon: 'receipt_long', heading: 'ITR / GST filing',
      button: 'Send request',
      fields: [
        ...who(),
        text('pan', 'PAN'),
        drop('filing_type', 'Filing needed', opts('Income tax return (ITR)', 'GST return', 'GST registration', 'TDS return', 'Tax notice reply', 'Other')),
        drop('financial_year', 'Financial year', opts('FY 2026–27', 'FY 2025–26', 'FY 2024–25', 'Older')),
        radio('income_source', 'Main income from', opts('Salary', 'Business / profession', 'Capital gains', 'Rent', 'Other')),
        doc('tax_docs', 'Documents (optional)', false, 5),
      ],
    },
    {
      id: 'case_enquiry', title: 'Legal case enquiry', icon: 'gavel', heading: 'Tell us about your legal matter',
      button: 'Send enquiry',
      fields: [
        ...who(),
        drop('case_type', 'Matter type', opts('Property / land', 'Family / divorce', 'Criminal', 'Consumer', 'Company / contract', 'Cheque bounce', 'Other')),
        area('case_summary', 'Brief of the matter'),
        radio('case_stage', 'Stage', opts('Not filed yet', 'Case filed', 'Hearing ongoing', 'Appeal')),
        doc('case_docs', 'Documents (optional)', false, 3),
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
    {
      id: 'amc_enquiry', title: 'Annual maintenance (AMC)', icon: 'build_circle', heading: 'Annual maintenance contract',
      button: 'Send enquiry',
      fields: [
        ...who(),
        checks('amc_items', 'What should it cover?', opts('AC', 'Water purifier (RO)', 'Washing machine', 'Refrigerator', 'Electrical', 'Plumbing', 'Pest control'), true),
        radio('property_kind', 'Property', opts('Apartment', 'Independent house', 'Office / shop')),
        area('address', 'Address'),
        drop('amc_start', 'Start from', opts('This week', 'This month', 'Next month')),
      ],
    },
    {
      id: 'site_inspection', title: 'Quote / site inspection', icon: 'design_services', heading: 'Get a quote for a bigger job',
      body: 'For painting, interiors, renovation or waterproofing.', button: 'Request inspection',
      fields: [
        ...who(),
        drop('job_type', 'Work needed', opts('Painting', 'Interiors / carpentry', 'Renovation', 'Waterproofing', 'False ceiling', 'Flooring', 'Other')),
        area('job_details', 'Describe the work'),
        area('address', 'Address'),
        date('inspection_date', 'Inspection date', 30),
        photo('site_photos', 'Photos (optional)', false, 4),
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
    {
      id: 'airport_transfer', title: 'Airport pickup / drop', icon: 'airport_shuttle', heading: 'Book an airport transfer',
      button: 'Book transfer',
      fields: [
        ...who('Guest name'),
        radio('transfer_type', 'Transfer', opts('Pickup from the airport', 'Drop to the airport', 'Both')),
        date('transfer_date', 'Date', 90),
        text('flight_no', 'Flight number', false),
        text('flight_time', 'Flight time'),
        num('passengers', 'Passengers'),
        drop('vehicle_type', 'Vehicle', opts('Sedan', 'SUV', 'Tempo traveller')),
      ],
    },
    {
      id: 'group_booking', title: 'Group / corporate booking', icon: 'groups', heading: 'Group or corporate stay',
      button: 'Send enquiry',
      fields: [
        ...who(),
        text('company', 'Company / group', false),
        { type: 'CalendarPicker', name: 'stay_dates', label: 'Check-in', endLabel: 'Check-out', required: true, maxDaysAhead: 365 },
        num('rooms_needed', 'Rooms needed'),
        num('group_size', 'Guests'),
        checks('group_needs', 'Also need', opts('Meeting hall', 'Meals included', 'Airport transfers', 'Sightseeing')),
        area('group_notes', 'Anything else?', false),
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
    {
      id: 'maintenance_request', title: 'Maintenance request', icon: 'plumbing', heading: 'Report a problem in your room',
      body: 'For residents: tell us what needs fixing.', button: 'Send request',
      fields: [
        ...who('Resident name'),
        text('room_no', 'Room / bed no.'),
        drop('problem_type', 'Problem', opts('Electrical', 'Plumbing / water', 'AC / fan', 'Wi-Fi', 'Cleaning', 'Furniture', 'Other')),
        area('problem_details', 'Details', false),
        photo('problem_photo', 'Photo (optional)'),
      ],
    },
    {
      id: 'move_out_notice', title: 'Move-out notice', icon: 'logout', heading: 'Give your move-out notice',
      button: 'Submit notice',
      fields: [
        ...who('Resident name'),
        text('room_no', 'Room / bed no.'),
        date('move_out_date', 'Move-out date', 90),
        drop('move_out_reason', 'Reason', opts('Job / college change', 'Moving to own home', 'Too expensive', 'Facilities', 'Other')),
        text('refund_upi', 'UPI ID for refund', false),
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
    {
      id: 'guest_rsvp', title: 'Event RSVP', icon: 'how_to_reg', heading: 'Will you join us?',
      button: 'Send RSVP',
      fields: [
        ...who(),
        radio('attending', 'Are you coming?', opts('Yes, I’ll be there', 'Maybe', 'Sorry, can’t make it')),
        num('plus_guests', 'Guests with you', false),
        drop('meal_pref', 'Meal preference', opts('Veg', 'Non-veg', 'Jain', 'No meal')),
        area('rsvp_note', 'Message', false),
      ],
    },
    {
      id: 'vendor_registration', title: 'Vendor registration', icon: 'storefront', heading: 'Work with us',
      body: 'Caterers, decorators, photographers and more.', button: 'Register',
      fields: [
        ...who(),
        text('vendor_business', 'Business name'),
        drop('vendor_type', 'Service', opts('Catering', 'Decoration', 'Photography / video', 'DJ / music', 'Makeup', 'Lighting / sound', 'Other')),
        text('vendor_city', 'City'),
        text('portfolio_link', 'Portfolio link', false),
        photo('portfolio_photos', 'Work samples (optional)', false, 4),
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
    {
      id: 'home_loan_help', title: 'Home loan assistance', icon: 'account_balance', heading: 'Get help with your home loan',
      button: 'Request help',
      fields: [
        ...who(),
        text('property_interest', 'Property / project', false),
        num('loan_amount', 'Loan amount'),
        drop('income_range', 'Monthly income', opts('Under ₹25,000', '₹25,000–50,000', '₹50,000–1 lakh', 'Above ₹1 lakh')),
        radio('employment_type', 'You are', opts('Salaried', 'Self-employed', 'Business owner')),
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
    {
      id: 'counselling_request', title: 'Career counselling', icon: 'psychology', heading: 'Book a counselling call',
      button: 'Request call',
      fields: [
        ...who('Your name'),
        text('student_name', 'Student name'),
        drop('current_class', 'Studying in', opts('Class 8–10', 'Class 11–12', 'Graduation', 'Working professional')),
        checks('interest_areas', 'Interested in', opts('Engineering', 'Medical', 'Commerce / CA', 'Government exams', 'Study abroad', 'Skill courses'), true),
        drop('callback_time', 'Best time to call', TIMES),
      ],
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
    {
      id: 'warranty_claim', title: 'Warranty / repair claim', icon: 'build', heading: 'Warranty or repair claim',
      button: 'Submit claim',
      fields: [
        ...who(),
        text('product_name', 'Product'),
        text('invoice_no', 'Invoice / order no.', false),
        pastDate('purchase_date', 'Purchase date', 730),
        area('fault_details', 'What’s wrong?'),
        photo('fault_photo', 'Photo of the issue', false, 3),
        doc('invoice_copy', 'Invoice copy (optional)'),
      ],
    },
    {
      id: 'product_enquiry', title: 'Product enquiry / restock', icon: 'notifications_active', heading: 'Ask about a product',
      body: 'Out of stock or can’t find it? Tell us and we’ll let you know here.', button: 'Send',
      fields: [
        ...who(),
        text('product_name', 'Product'),
        drop('enquiry_type', 'You want to', opts('Know when it’s back', 'Check a size / colour', 'Ask the price', 'Something else')),
        area('product_note', 'Details', false),
        photo('product_photo', 'Photo (optional)'),
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
    {
      id: 'franchise_enquiry', title: 'Franchise enquiry', icon: 'storefront', heading: 'Own a franchise',
      button: 'Send enquiry',
      fields: [
        ...who(),
        text('city', 'City'),
        drop('investment_range', 'Investment', opts('Under ₹10 lakh', '₹10–25 lakh', '₹25–50 lakh', 'Above ₹50 lakh')),
        radio('has_space', 'Do you have a space?', opts('Yes, owned', 'Yes, rented', 'Not yet')),
        area('franchise_note', 'About you', false),
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
    {
      id: 'product_request', title: 'Product request', icon: 'add_shopping_cart', heading: 'Can’t find a product?',
      body: 'Tell us what you need and we’ll try to stock it.', button: 'Send request',
      fields: [
        ...who(),
        text('product_name', 'Product'),
        text('brand', 'Brand', false),
        text('quantity_needed', 'Quantity', false),
        photo('product_photo', 'Photo (optional)'),
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
    {
      id: 'track_shipment', title: 'Track shipment', icon: 'travel_explore', heading: 'Track your shipment',
      body: 'Enter your tracking number and we’ll reply here with the latest status.', button: 'Track',
      fields: [...who(), text('tracking_no', 'Tracking number')],
    },
    {
      id: 'rate_enquiry', title: 'Rate enquiry', icon: 'request_quote', heading: 'Get a delivery quote',
      button: 'Get quote',
      fields: [
        ...who(),
        num('from_pincode', 'From pincode'),
        num('to_pincode', 'To pincode'),
        drop('package_type', 'Package type', opts('Documents', 'Small parcel', 'Large parcel', 'Fragile', 'Food')),
        num('weight_kg', 'Weight (kg)'),
      ],
    },
    {
      id: 'business_account', title: 'Business shipping account', icon: 'business', heading: 'Open a business account',
      body: 'Regular shipments? Get business rates and scheduled pickups.', button: 'Send enquiry',
      fields: [
        ...who(),
        text('company', 'Company name'),
        text('gstin', 'GSTIN', false),
        drop('monthly_volume', 'Shipments a month', opts('Under 100', '100–500', '500–2,000', 'Above 2,000')),
        checks('shipment_kind', 'You send', opts('Documents', 'E-commerce parcels', 'Heavy / bulk', 'International'), true),
        text('city', 'City'),
      ],
    },
    {
      id: 'delivery_partner', title: 'Become a delivery partner', icon: 'two_wheeler', heading: 'Join as a delivery partner',
      button: 'Apply',
      fields: [
        ...who(),
        num('age', 'Age'),
        text('city', 'City'),
        radio('vehicle', 'Your vehicle', opts('Bike / scooter', 'Cycle', 'Auto / van', 'No vehicle')),
        radio('driving_licence', 'Driving licence?', opts('Yes', 'No')),
        drop('work_hours', 'Availability', opts('Full time', 'Part time', 'Weekends only')),
        doc('id_document', 'ID proof (optional)'),
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
    {
      id: 'insurance_quote', title: 'Insurance quote', icon: 'health_and_safety', heading: 'Get an insurance quote',
      button: 'Get quote',
      fields: [
        ...who(),
        drop('insurance_type', 'Insurance', opts('Health', 'Term life', 'Motor', 'Home', 'Travel', 'Business')),
        radio('cover_for', 'Cover for', opts('Myself', 'My family', 'My business')),
        num('insured_age', 'Age of eldest member'),
        drop('cover_amount', 'Cover amount', opts('Under ₹5 lakh', '₹5–10 lakh', '₹10–25 lakh', 'Above ₹25 lakh')),
        text('city', 'City'),
        consent('I agree to be contacted about this insurance quote.'),
      ],
    },
    {
      id: 'account_opening', title: 'Account opening', icon: 'savings', heading: 'Open an account',
      button: 'Request call',
      fields: [
        ...who(),
        drop('account_type', 'Account type', opts('Savings account', 'Current account', 'Fixed deposit', 'Demat / trading', 'Credit card')),
        text('city', 'City'),
        drop('callback_time', 'Best time to call', TIMES),
        consent('I agree to be contacted about opening this account.'),
      ],
    },
  ],
  // IT & software companies: clients (projects, support, demos) and
  // candidates (jobs, resumes, interviews, internships).
  it: [
    {
      id: 'job_application', title: 'Job application', icon: 'work', heading: 'Apply for a job',
      body: 'Tell us about yourself and attach your resume.', button: 'Submit application',
      fields: [
        ...who('Full name'),
        text('email', 'Email', true, { inputType: 'email' }),
        drop('position', 'Applying for', IT_ROLES),
        drop('experience_years', 'Experience', IT_EXPERIENCE),
        text('current_ctc', 'Current CTC', false),
        text('expected_ctc', 'Expected CTC', false),
        drop('notice_period', 'Notice period', opts('Immediate', '15 days', '30 days', '60 days', '90 days')),
        text('portfolio_link', 'LinkedIn / portfolio', false),
        doc('resume', 'Resume / CV', true, 1, 'PDF or Word file'),
      ],
    },
    {
      id: 'resume_upload', title: 'Upload resume', icon: 'upload_file', heading: 'Share your resume',
      body: 'No opening right now? Send your resume and we’ll reach out when one fits.', button: 'Send resume',
      fields: [
        ...who('Full name'),
        text('email', 'Email', true, { inputType: 'email' }),
        drop('skill_area', 'Main skill', IT_ROLES),
        drop('experience_years', 'Experience', IT_EXPERIENCE),
        text('preferred_city', 'Preferred city', false),
        doc('cv', 'Resume / CV', true, 1, 'PDF or Word file'),
      ],
    },
    {
      id: 'interview_slot', title: 'Interview scheduling', icon: 'event_available', heading: 'Schedule your interview',
      body: 'Pick a day and a time that works for you. We’ll confirm here.', button: 'Request interview',
      fields: [
        ...who('Full name'),
        text('email', 'Email', true, { inputType: 'email' }),
        drop('interview_role', 'Role', IT_ROLES),
        radio('interview_round', 'Interview round', opts('First round', 'Technical round', 'HR / final round')),
        radio('interview_mode', 'How to meet', opts('Video call', 'In person', 'Phone call')),
        date('interview_date', 'Interview date', 21),
        drop('interview_time', 'Preferred time', TIMES),
      ],
    },
    {
      id: 'internship_application', title: 'Internship application', icon: 'school', heading: 'Apply for an internship',
      button: 'Apply',
      fields: [
        ...who('Full name'),
        text('email', 'Email', true, { inputType: 'email' }),
        text('college', 'College'),
        drop('degree', 'Course', opts('B.Tech / B.E.', 'BCA / MCA', 'B.Sc / M.Sc', 'MBA', 'Diploma', 'Other')),
        drop('graduation_year', 'Year of passing', opts('2026', '2027', '2028', '2029', 'Already passed')),
        drop('internship_area', 'Area of interest', IT_ROLES),
        drop('internship_length', 'Duration', opts('1 month', '2 months', '3 months', '6 months')),
        doc('intern_resume', 'Resume / CV', true, 1, 'PDF or Word file'),
      ],
    },
    {
      id: 'project_enquiry', title: 'Project enquiry', icon: 'request_quote', heading: 'Tell us about your project',
      body: 'We’ll reply with the next steps and a rough estimate.', button: 'Send enquiry',
      fields: [
        ...who(),
        text('company', 'Company name', false),
        text('email', 'Email', true, { inputType: 'email' }),
        checks('services_needed', 'Services needed', opts('Website', 'Mobile app', 'Custom software', 'Cloud / DevOps', 'AI / data', 'UI / UX design', 'IT support / AMC'), true),
        drop('project_budget', 'Budget', opts('Under ₹1 lakh', '₹1–5 lakh', '₹5–20 lakh', 'Above ₹20 lakh', 'Not sure yet')),
        drop('project_timeline', 'Timeline', opts('As soon as possible', '1–3 months', '3–6 months', 'Flexible')),
        area('project_brief', 'Project details'),
        doc('project_docs', 'Requirement document', false, 1, 'Optional: a brief, RFP or wireframes'),
      ],
    },
    {
      id: 'demo_request', title: 'Product demo request', icon: 'co_present', heading: 'Book a product demo',
      button: 'Request demo',
      fields: [
        ...who(),
        text('company', 'Company name'),
        text('email', 'Work email', true, { inputType: 'email' }),
        drop('team_size', 'Team size', opts('1–10', '11–50', '51–200', '201–1,000', 'Above 1,000')),
        radio('demo_mode', 'How to meet', opts('Video call', 'In person')),
        date('demo_on', 'Preferred date', 30),
        drop('demo_slot', 'Preferred time', TIMES),
      ],
    },
    {
      id: 'it_support', title: 'IT support ticket', icon: 'support_agent', heading: 'Raise a support ticket',
      body: 'Tell us what’s wrong and we’ll get back to you here.', button: 'Raise ticket',
      fields: [
        ...who(),
        text('company', 'Company name', false),
        drop('support_issue', 'Issue type', opts('Software bug', 'System down', 'Network / internet', 'Email / login', 'Hardware', 'Other')),
        radio('priority', 'Priority', opts('Low', 'Medium', 'High', 'Critical')),
        area('issue_description', 'Describe the issue'),
        photo('issue_screenshot', 'Screenshot (optional)', false, 3),
      ],
    },
    {
      id: 'client_onboarding', title: 'Client onboarding', icon: 'handshake', heading: 'Welcome aboard',
      body: 'A few details so we can set up your project.', button: 'Submit',
      fields: [
        ...who('Contact person'),
        text('company', 'Company name'),
        text('email', 'Email', true, { inputType: 'email' }),
        text('gstin', 'GSTIN', false),
        area('billing_address', 'Billing address'),
        drop('preferred_contact', 'Best way to reach', opts('WhatsApp', 'Email', 'Phone call')),
        doc('signed_docs', 'Signed agreement / PO', false, 2),
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

// ---------------------------------------------------------------------------
// Form pages: one sidebar page per ready-made form ("Pickup requests")
// ---------------------------------------------------------------------------
/** The page's name in the sidebar: what the business receives, in the plural. */
const PAGE_LABEL: Record<string, string> = {
  feedback: 'Feedback',
  callback: 'Callback requests',
  complaint: 'Complaints',
  patient_registration: 'Patient registrations',
  consultation_request: 'Consultation requests',
  upload_reports: 'Patient reports',
  service_preferences: 'Service preferences',
  skin_allergy_check: 'Allergy checks',
  membership_enquiry: 'Membership enquiries',
  health_declaration: 'Health declarations',
  free_trial: 'Free trials',
  vehicle_service: 'Service requests',
  accident_claim: 'Insurance claims',
  client_intake: 'Client intakes',
  document_collection: 'Client documents',
  service_request: 'Service requests',
  stay_enquiry: 'Stay enquiries',
  pre_arrival: 'Pre-arrival check-ins',
  space_enquiry: 'Space enquiries',
  tenant_kyc: 'Tenant KYC',
  event_enquiry: 'Event enquiries',
  property_requirement: 'Property requirements',
  site_visit: 'Site visits',
  list_property: 'Property listings',
  admission_enquiry: 'Admission enquiries',
  demo_class: 'Demo classes',
  admission_documents: 'Admission documents',
  return_exchange: 'Returns & exchanges',
  bulk_order: 'Bulk enquiries',
  table_reservation: 'Table reservations',
  party_catering: 'Catering enquiries',
  prescription_upload: 'Prescriptions',
  monthly_list: 'Monthly lists',
  pickup_request: 'Pickup requests',
  delivery_issue: 'Delivery issues',
  track_shipment: 'Tracking requests',
  rate_enquiry: 'Rate enquiries',
  loan_enquiry: 'Loan enquiries',
  kyc_documents: 'KYC documents',
  claim_intimation: 'Claims',
  home_sample_collection: 'Sample collections',
  health_checkup: 'Check-up enquiries',
  bridal_enquiry: 'Bridal enquiries',
  personal_training: 'Training enquiries',
  membership_freeze: 'Freeze requests',
  test_drive: 'Test drives',
  car_valuation: 'Vehicle valuations',
  roadside_assistance: 'Roadside requests',
  tax_filing: 'Tax filings',
  case_enquiry: 'Legal enquiries',
  amc_enquiry: 'AMC enquiries',
  site_inspection: 'Inspections & quotes',
  airport_transfer: 'Airport transfers',
  group_booking: 'Group bookings',
  maintenance_request: 'Maintenance requests',
  move_out_notice: 'Move-out notices',
  guest_rsvp: 'RSVPs',
  vendor_registration: 'Vendors',
  home_loan_help: 'Home loan requests',
  counselling_request: 'Counselling requests',
  warranty_claim: 'Warranty claims',
  product_enquiry: 'Product enquiries',
  franchise_enquiry: 'Franchise enquiries',
  product_request: 'Product requests',
  business_account: 'Business accounts',
  delivery_partner: 'Partner applications',
  insurance_quote: 'Insurance quotes',
  account_opening: 'Account requests',
  job_application: 'Job applications',
  resume_upload: 'Resumes',
  interview_slot: 'Interview requests',
  internship_application: 'Internship applications',
  project_enquiry: 'Project enquiries',
  demo_request: 'Demo requests',
  it_support: 'Support tickets',
  client_onboarding: 'Client onboarding',
  enquiry: 'Enquiries',
};

/** Submissions that came from no ready-made form (a form built by hand). */
export const OTHER_FORMS = 'other';

export interface FormPage {
  /** Preset id, or OTHER_FORMS. */
  id: string;
  label: string;
  icon: string;
  /** The ready-made form (none for OTHER_FORMS). */
  preset: FormPreset | null;
}

export function presetById(id: string): FormPreset | null {
  return allFormPresets().find((p) => p.id === id) || null;
}

export function formPageOf(id: string): FormPage {
  if (id === OTHER_FORMS) return { id, label: 'Other forms', icon: 'assignment', preset: null };
  const p = presetById(id);
  return { id, label: PAGE_LABEL[id] || (p ? `${p.title}s` : 'Form'), icon: p?.icon || 'assignment', preset: p };
}

// Every form asks for these, so they say nothing about which form it was.
const SHARED_FIELDS = new Set(['name', 'whatsapp_number']);

/** The answered field names of a submission (its stored answers and its resolved rows). */
function answeredKeys(r: Pick<Registration, 'fields' | 'rows'>): Set<string> {
  const keys = new Set<string>();
  for (const k of Object.keys(r.fields || {})) if (!k.endsWith('_label')) keys.add(k);
  for (const row of r.rows || []) keys.add(row.key);
  for (const k of SHARED_FIELDS) keys.delete(k);
  return keys;
}

/**
 * Which ready-made form a submission came from, or null for a form built by hand.
 *
 * Fields added from the Forms menu carry the form's id (`preset`), so the flow
 * that produced the submission says it directly: the form most of the answered
 * fields belong to. A flow saved before fields were tagged, or one since
 * deleted, falls back to the field names: at least two of the form's own
 * fields (a field renamed to avoid a clash ends in _2, _3…) and half of them.
 * Forms share some names (Complaint and Delivery issue both ask issue_type),
 * so the closest form wins: most of its fields answered AND most of the
 * answers its own (the F1 score of the two).
 */
export function presetOfSubmission(
  r: Pick<Registration, 'flowId' | 'fields' | 'rows'>,
  flows: Map<string, WaFlowDef>,
): string | null {
  const keys = answeredKeys(r);
  if (!keys.size) return null;
  const flow = r.flowId ? flows.get(r.flowId) : undefined;
  if (flow) {
    const votes = new Map<string, number>();
    for (const s of flow.screens || []) {
      for (const c of s.components || []) {
        if (c.preset && c.name && !SHARED_FIELDS.has(c.name) && keys.has(c.name)) {
          votes.set(c.preset, (votes.get(c.preset) || 0) + 1);
        }
      }
    }
    let best: string | null = null;
    let most = 0;
    for (const [id, n] of votes) if (n > most) [best, most] = [id, n];
    if (best) return best;
  }
  const answered = (name: string) =>
    keys.has(name) || [...keys].some((k) => k.startsWith(`${name}_`) && /^\d+$/.test(k.slice(name.length + 1)));
  let best: string | null = null;
  let score = 0;
  for (const p of allFormPresets()) {
    const own = p.fields.map((f) => f.name).filter((n) => !SHARED_FIELDS.has(n));
    if (!own.length) continue;
    const hits = own.filter(answered).length;
    if (hits < Math.min(2, own.length) || hits / own.length < 0.5) continue;
    const s = (2 * hits) / (own.length + keys.size);
    if (s > score) {
      best = p.id;
      score = s;
    }
  }
  return best;
}

/** The ready-made forms used anywhere in these flows. */
export function presetsInFlows(flows: WaFlowDef[]): Set<string> {
  const out = new Set<string>();
  for (const f of flows) for (const s of f.screens || []) for (const c of s.components || []) if (c.preset) out.add(c.preset);
  return out;
}

/**
 * The form pages this business gets in the sidebar: its own ready-made forms
 * always (a courier always has "Pickup requests" to look at), then any other
 * form it has put in a flow or received answers from, then "Other forms" for
 * answers from forms built by hand.
 */
export function formPagesFor(v: VerticalConfig, flows: WaFlowDef[], regs: Registration[], picked: Set<string> | null = null): FormPage[] {
  const byId = new Map(flows.map((f) => [f._id, f]));
  const used = presetsInFlows(flows);
  let other = false;
  for (const r of regs) {
    const id = presetOfSubmission(r, byId);
    if (id) used.add(id);
    else other = true;
  }
  // The business's own forms: the ones it picked (menuChoices.ts), or all of
  // them when it hasn't chosen. A form in a flow or with answers shows anyway.
  const ids = formsFor(v).own.map((p) => p.id).filter((id) => !picked || picked.has(id) || used.has(id));
  for (const p of allFormPresets()) if (used.has(p.id) && !ids.includes(p.id)) ids.push(p.id);
  const pages = ids.map(formPageOf);
  if (other) pages.push(formPageOf(OTHER_FORMS));
  return pages;
}
