// Ready-made flows for every business type (Automation → Flows → Templates).
//
// A business picks a card ("Delivery · pay online", "Book appointment ·
// department → doctor"), changes any of its choices — how customers pay, a
// message or a PDF slip, how the address is taken, which extra menu items are
// there — and gets the whole flow built and wired on the Map: screens, blocks,
// the opening chat message, the Start node and a tidy layout.
//
// Every combination of choices is a valid flow, which is why this is a
// generator rather than a list of saved flows: a restaurant's delivery order
// alone has thousands of combinations. The pieces are the same ones the
// builder's chips make (booking, reschedule, cancel, forms…), with the field
// names the runtime reads left exactly as they are.
import type { FlowBlock, FlowComponent, FlowOption, FlowScreen, WaFlowDef } from './types';
import { ARCHETYPES, type ConfirmWording, type VerticalConfig } from './verticals';
import { makeBlock } from './flowBlocks';
import { blockLabel, formsFor, payOptions, presetById, TIME_OPTIONS, type FieldSpec, type FormPreset } from './flowForms';
import { buildPdfDesign, PDF_DESIGNS, type PdfDesignId } from './components/pdfDesigns';
import { buildFlowJson, FINAL_SCREEN_ONLY } from './flowJson';

// ---------------------------------------------------------------------------
// Choices
// ---------------------------------------------------------------------------
export type PayChoice = 'online' | 'cash' | 'both' | 'none';
export type OrderMode = 'delivery' | 'takeaway' | 'dinein' | 'choose';
export type AddressChoice = 'pin' | 'typed' | 'none';

export interface TemplateOptions {
  /** Orders: how the customer gets it (or let them choose). */
  mode: OrderMode;
  /** Delivery orders: a shared location pin, a typed address, or neither. */
  address: AddressChoice;
  /** Orders: ask a delivery / pickup time window. */
  deliveryTime: boolean;
  /** Pick a category (menu category, specialisation…) first. */
  categoryStep: boolean;
  /** Forms: pick a member (agent, course, room type) after the category. */
  memberStep: boolean;
  /** Bookings: ask age and gender. */
  personal: boolean;
  /** Bookings: the business type's own questions (vehicle, address, guests…). */
  extraQuestions: boolean;
  pay: PayChoice;
  /** The confirmation: a message, or a message with a PDF slip. */
  confirm: 'message' | 'pdf';
  design: PdfDesignId;
  /** Extra menu items: my_list, track, cancel, reschedule, location, call, brochure, book, order, form:<preset id>. */
  extras: string[];
  /** A "Main menu" / "Start again" button after the last message. */
  restart: boolean;
  /** What the Location / Call / Brochure menu items send (asked in a pop-up). */
  links: Partial<Record<LinkKind, LinkDetails>>;
}

/** Menu items that are a single message with a button, and need the business's own details. */
export type LinkKind = 'location' | 'call' | 'brochure' | 'website';
export interface LinkDetails {
  /** The message above the button. */
  text: string;
  /** The button's label (WhatsApp: 20 characters at most). */
  label: string;
  /** A map / brochure link (https://…) or a phone number. */
  value: string;
}
export const LINK_KINDS: LinkKind[] = ['location', 'call', 'brochure', 'website'];
export const isLinkKind = (x: string): x is LinkKind => (LINK_KINDS as string[]).includes(x);

/** What each one starts with, and what its pop-up asks. */
export const LINK_INFO: Record<LinkKind, {
  title: string; icon: string; color: string; valueLabel: string; placeholder: string; hint: string; defaults: LinkDetails;
}> = {
  location: {
    title: 'Our location', icon: 'location_on', color: '#ea4335',
    valueLabel: 'Google Maps link', placeholder: 'https://maps.app.goo.gl/…',
    hint: 'In Google Maps, find your business, tap Share and copy the link.',
    defaults: { text: '📍 Here’s where to find us.', label: 'Open map', value: '' },
  },
  call: {
    title: 'Call us', icon: 'call', color: '#f59e0b',
    valueLabel: 'Phone number', placeholder: '+91 98765 43210',
    hint: 'With the country code. The customer’s phone dials it when they tap the button.',
    defaults: { text: 'Call us and we’ll help right away.', label: 'Call now', value: '' },
  },
  brochure: {
    title: 'Get the brochure', icon: 'menu_book', color: '#0d9488',
    valueLabel: 'Brochure link', placeholder: 'https://…/brochure.pdf',
    hint: 'A PDF or a web page, starting with https://.',
    defaults: { text: '📘 Here’s our brochure with all the details.', label: 'Open brochure', value: '' },
  },
  website: {
    title: 'Visit our website', icon: 'language', color: '#0096de',
    valueLabel: 'Website link', placeholder: 'https://www.yourbusiness.com',
    hint: 'Your website or any page on it, starting with https://.',
    defaults: { text: '🌐 See more on our website.', label: 'Visit website', value: '' },
  },
};

/** Why these details can't be used yet ('' = they're fine). */
export function linkProblem(kind: LinkKind, d?: Partial<LinkDetails>): string {
  const value = String(d?.value || '').trim();
  const label = String(d?.label || '').trim();
  if (!label) return 'Add the button text.';
  if (label.length > 20) return 'The button text can be 20 characters at most.';
  if (kind === 'call') {
    const digits = value.replace(/\D/g, '');
    if (!value) return 'Add the phone number.';
    if (!/^\+?[\d\s()-]+$/.test(value) || digits.length < 8 || digits.length > 15) return 'Enter a phone number with its country code, e.g. +91 98765 43210.';
    return '';
  }
  if (!value) return kind === 'location' ? 'Add your Google Maps link.' : kind === 'website' ? 'Add your website link.' : 'Add the brochure link.';
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || !u.hostname.includes('.')) return 'The link must start with https://.';
  } catch {
    return 'That isn’t a link. It must start with https://.';
  }
  return '';
}

export const DEFAULT_OPTIONS: TemplateOptions = {
  mode: 'delivery',
  address: 'pin',
  deliveryTime: false,
  categoryStep: true,
  memberStep: false,
  personal: true,
  extraQuestions: true,
  pay: 'both',
  confirm: 'message',
  design: 'classic',
  extras: [],
  restart: true,
  links: {},
};

/** The journey a card builds. */
export type TemplateMain =
  | { kind: 'order' }
  | { kind: 'booking' }
  | { kind: 'form'; form: string }
  | { kind: 'track' };

export interface TemplateCard {
  id: string;
  title: string;
  description: string;
  /** Material icon ligature. */
  icon: string;
  main: TemplateMain;
  defaults: Partial<TemplateOptions>;
}

export interface ChoiceDef {
  key: keyof TemplateOptions;
  label: string;
  /** 'one': pick one of the options; 'bool': on / off. */
  kind: 'one' | 'bool';
  options?: { value: string; label: string }[];
  hint?: string;
}

export interface ExtraDef {
  id: string;
  label: string;
  icon: string;
}

export interface BuiltTemplate {
  flow: Pick<WaFlowDef, 'name' | 'categories' | 'cta' | 'msgBody' | 'screens' | 'blocks' | 'flowLinks' | 'entryTarget' | 'positions'>;
  /** What the customer goes through, in order. */
  steps: string[];
  /** What the business has to set up for it to work. */
  needs: string[];
}

// ---------------------------------------------------------------------------
// The cards for each business type
// ---------------------------------------------------------------------------
const order = (id: string, title: string, description: string, defaults: Partial<TemplateOptions>, icon = 'shopping_bag'): TemplateCard =>
  ({ id, title, description, icon, main: { kind: 'order' }, defaults });
const booking = (id: string, title: string, description: string, defaults: Partial<TemplateOptions>, icon = 'event_available'): TemplateCard =>
  ({ id, title, description, icon, main: { kind: 'booking' }, defaults });
// A form opens on the form itself. Only a card that says so asks the category
// (and maybe the member) first: a site visit, a report upload or feedback
// don't need one, and a category step with no categories made is a dead end.
const form = (presetId: string, defaults: Partial<TemplateOptions> = {}, title?: string, description?: string, id?: string): TemplateCard => {
  const p = presetById(presetId);
  return {
    id: id || `form_${presetId}`,
    title: title || p?.title || presetId,
    description: description || `The “${p?.title || presetId}” form: answers land on its page under Forms in the sidebar.`,
    icon: p?.icon || 'assignment',
    main: { kind: 'form', form: presetId },
    defaults: { categoryStep: false, ...defaults },
  };
};

/** Does this card's flow open with a category list (as built, not just as set)? */
export function asksCategoryFirst(card: TemplateCard, v: VerticalConfig): boolean {
  const o = optionsFor(card);
  if (!o.categoryStep || !v.showsPage('categories') || card.main.kind === 'track') return false;
  // A form asks it only in the business types whose forms are about a member.
  if (card.main.kind === 'form') return v.archetype === 'lead' || v.archetype === 'unit' || v.archetype === 'person' || v.key === 'other';
  return true;
}
const track = (id: string, title: string, description: string): TemplateCard =>
  ({ id, title, description, icon: 'local_shipping', main: { kind: 'track' }, defaults: {} });

const CARDS: Record<string, TemplateCard[]> = {
  restaurant: [
    order('rest_delivery_online', 'Delivery · pay online', 'Menu category → menu → cart → location pin → WhatsApp Pay → order confirmed.', { mode: 'delivery', pay: 'online' }, 'delivery_dining'),
    order('rest_delivery_cod', 'Delivery · cash on delivery', 'Customers order from the menu and pay the rider in cash.', { mode: 'delivery', pay: 'cash' }, 'payments'),
    order('rest_delivery_both', 'Delivery · online or cash, PDF bill', 'Customers choose how to pay and get a PDF bill with their order.', { mode: 'delivery', pay: 'both', confirm: 'pdf' }, 'receipt_long'),
    order('rest_takeaway', 'Takeaway', 'Order ahead with a pickup time, pay at the counter or online.', { mode: 'takeaway', pay: 'both' }, 'takeout_dining'),
    order('rest_dinein', 'Dine-in at the table', 'Guests enter their table number, order from the menu and pay at the table.', { mode: 'dinein', pay: 'cash' }, 'table_restaurant'),
    order('rest_choose', 'Delivery, takeaway or dine-in', 'Customers pick how they want their order, and each way has its own steps.', { mode: 'choose', pay: 'both', confirm: 'pdf' }, 'alt_route'),
    form('table_reservation'),
    form('party_catering'),
    form('feedback'),
    form('franchise_enquiry'),
    order('rest_full', 'Full restaurant menu', 'Order food, my orders, track, cancel, reserve a table, location and call, in one menu.', { mode: 'delivery', pay: 'both', confirm: 'pdf', extras: ['my_list', 'track', 'cancel', 'form:table_reservation', 'location', 'call'] }, 'menu_book'),
  ],
  ecommerce: [
    order('shop_online', 'Shop & pay online', 'Category → catalog → typed delivery address → WhatsApp Pay.', { address: 'typed', pay: 'online' }),
    order('shop_cod', 'Cash on delivery', 'Orders are paid in cash when they arrive.', { address: 'typed', pay: 'cash' }, 'payments'),
    order('shop_both_pdf', 'Online or COD, PDF invoice', 'Customers choose how to pay and get a PDF invoice.', { address: 'typed', pay: 'both', confirm: 'pdf' }, 'receipt_long'),
    order('shop_direct', 'Straight to the catalog', 'No category step: customers browse every product at once and share a location pin.', { categoryStep: false, address: 'pin', pay: 'both' }, 'storefront'),
    order('shop_pickup', 'Store pickup', 'Order on WhatsApp, collect from the store.', { mode: 'takeaway', pay: 'both' }, 'store'),
    track('shop_track', 'Track my order', 'Customers pick one of their open orders and get its latest status.'),
    form('return_exchange'),
    form('bulk_order'),
    form('feedback'),
    form('warranty_claim'),
    form('product_enquiry'),
    order('shop_full', 'Full store menu', 'Shop, my orders, track, cancel, returns and call, in one menu.', { address: 'typed', pay: 'both', confirm: 'pdf', extras: ['my_list', 'track', 'cancel', 'form:return_exchange', 'call'] }, 'menu_book'),
  ],
  grocery: [
    order('groc_delivery', 'Grocery delivery with a time slot', 'Category → products → address and delivery time → pay online or cash.', { address: 'typed', deliveryTime: true, pay: 'both' }, 'local_grocery_store'),
    order('groc_cod', 'Cash on delivery', 'Customers share a location pin and pay in cash on delivery.', { address: 'pin', pay: 'cash' }, 'payments'),
    order('groc_online_pdf', 'Pay online, PDF bill', 'Typed address, WhatsApp Pay and a PDF bill.', { address: 'typed', pay: 'online', confirm: 'pdf' }, 'receipt_long'),
    order('groc_pickup', 'Store pickup', 'Order ahead with a pickup time and pay at the counter.', { mode: 'takeaway', pay: 'cash' }, 'store'),
    form('prescription_upload'),
    form('monthly_list'),
    form('feedback'),
    form('product_request'),
    order('groc_full', 'Full store menu', 'Order, my orders, track, cancel, prescriptions, monthly list and call, in one menu.', { address: 'typed', deliveryTime: true, pay: 'both', extras: ['my_list', 'track', 'cancel', 'form:prescription_upload', 'form:monthly_list', 'call'] }, 'menu_book'),
  ],
  hospital: [
    booking('hosp_book', 'Book appointment · department → doctor', 'Department → doctor → patient details → time → pay at the hospital or online → PDF slip.', { categoryStep: true, pay: 'both', confirm: 'pdf' }),
    booking('hosp_doctor', 'Book by doctor', 'Patients pick a doctor straight away, with no department step.', { categoryStep: false, pay: 'cash' }, 'person_search'),
    booking('hosp_quick', 'Quick booking', 'Only name, number, doctor and a time: no age, gender or reason.', { categoryStep: false, personal: false, extraQuestions: false, pay: 'cash' }, 'bolt'),
    booking('hosp_online', 'Book & pay online first', 'The consultation fee is paid on WhatsApp before the slip is sent.', { pay: 'online', confirm: 'pdf' }, 'credit_card'),
    booking('hosp_free', 'Free consultation', 'Booking with no payment step.', { pay: 'none' }, 'volunteer_activism'),
    form('patient_registration'),
    form('consultation_request', { categoryStep: true }),
    form('upload_reports'),
    form('home_sample_collection'),
    form('health_checkup'),
    booking('hosp_full', 'Full hospital menu', 'Book, my appointments, reschedule, cancel, upload reports, location and call, in one menu.', { pay: 'both', confirm: 'pdf', extras: ['my_list', 'reschedule', 'cancel', 'form:upload_reports', 'location', 'call'] }, 'local_hospital'),
  ],
  salon: [
    booking('salon_book', 'Book a service', 'Service type → stylist → details → time → pay at the salon or online.', { pay: 'both' }, 'content_cut'),
    booking('salon_online', 'Book & pay online, PDF slip', 'The service is paid on WhatsApp and a PDF slip is sent.', { pay: 'online', confirm: 'pdf' }, 'credit_card'),
    booking('salon_quick', 'Quick booking', 'Pick a stylist and a time; pay at the salon.', { categoryStep: false, personal: false, extraQuestions: false, pay: 'cash' }, 'bolt'),
    form('service_preferences'),
    form('skin_allergy_check'),
    form('feedback'),
    form('bridal_enquiry'),
    booking('salon_full', 'Full salon menu', 'Book, my appointments, reschedule, cancel, location and call, in one menu.', { pay: 'both', extras: ['my_list', 'reschedule', 'cancel', 'location', 'call'] }, 'spa'),
  ],
  gym: [
    booking('gym_session', 'Book a session', 'Programme → trainer → details → time; pay at the gym.', { pay: 'cash' }, 'fitness_center'),
    booking('gym_online', 'Book & pay online', 'The session is paid on WhatsApp first.', { pay: 'online', confirm: 'pdf' }, 'credit_card'),
    form('free_trial'),
    form('membership_enquiry'),
    form('health_declaration'),
    form('personal_training'),
    form('membership_freeze'),
    booking('gym_full', 'Full gym menu', 'Book, my sessions, reschedule, cancel, free trial, location and call, in one menu.', { pay: 'both', extras: ['my_list', 'reschedule', 'cancel', 'form:free_trial', 'location', 'call'] }, 'sports_gymnastics'),
  ],
  automobile: [
    booking('auto_slot', 'Book a service slot', 'Service type → service → vehicle details and pickup → time → pay at the centre or online.', { pay: 'both' }, 'car_repair'),
    booking('auto_quick', 'Quick service booking', 'Pick a service and a time, with no vehicle questions.', { categoryStep: false, extraQuestions: false, pay: 'cash' }, 'bolt'),
    form('vehicle_service'),
    form('accident_claim'),
    form('test_drive'),
    form('car_valuation'),
    form('roadside_assistance'),
    booking('auto_full', 'Full service-centre menu', 'Book, my bookings, reschedule, cancel, insurance claim, location and call, in one menu.', { pay: 'both', confirm: 'pdf', extras: ['my_list', 'reschedule', 'cancel', 'form:accident_claim', 'location', 'call'] }, 'garage'),
  ],
  professional: [
    booking('pro_online', 'Book a consultation · pay first', 'Practice area → consultant → details → time → WhatsApp Pay → PDF slip.', { pay: 'online', confirm: 'pdf' }, 'work'),
    booking('pro_meeting', 'Book · pay at the meeting', 'Clients book a time and pay when they meet.', { pay: 'cash' }, 'handshake'),
    booking('pro_free', 'Free first call', 'A short intro call with no payment and no personal questions.', { pay: 'none', personal: false }, 'call'),
    form('client_intake'),
    form('document_collection'),
    form('tax_filing'),
    form('case_enquiry'),
    booking('pro_full', 'Full practice menu', 'Book, my appointments, reschedule, cancel, share documents and call, in one menu.', { pay: 'both', extras: ['my_list', 'reschedule', 'cancel', 'form:document_collection', 'call'] }, 'business_center'),
  ],
  homeservices: [
    booking('home_visit', 'Book a visit', 'Service type → professional → address and problem → time; pay after the visit.', { pay: 'cash', personal: false }, 'home_repair_service'),
    booking('home_online', 'Book a visit · pay online', 'The visit charge is paid on WhatsApp first.', { pay: 'online', personal: false, confirm: 'pdf' }, 'credit_card'),
    form('service_request'),
    form('feedback'),
    form('amc_enquiry'),
    form('site_inspection'),
    booking('home_full', 'Full services menu', 'Book, my bookings, reschedule, cancel, service request and call, in one menu.', { pay: 'both', personal: false, extras: ['my_list', 'reschedule', 'cancel', 'form:service_request', 'call'] }, 'handyman'),
  ],
  hotel: [
    booking('hotel_room', 'Book a room', 'Room category → room type → guest details → check-in → pay on arrival or online → PDF.', { pay: 'both', confirm: 'pdf' }, 'hotel'),
    booking('hotel_arrival', 'Book · pay on arrival', 'Guests book and pay at the hotel.', { pay: 'cash' }, 'payments'),
    booking('hotel_online', 'Book & pay online', 'The room is paid on WhatsApp first and a PDF slip is sent.', { pay: 'online', confirm: 'pdf' }, 'credit_card'),
    form('stay_enquiry'),
    form('pre_arrival'),
    form('airport_transfer'),
    form('group_booking'),
    booking('hotel_full', 'Full hotel menu', 'Book, my bookings, change dates, cancel, pre-arrival check-in, location and call, in one menu.', { pay: 'both', confirm: 'pdf', extras: ['my_list', 'reschedule', 'cancel', 'form:pre_arrival', 'location', 'call'] }, 'king_bed'),
  ],
  rooms: [
    booking('rooms_book', 'Book a space or a visit', 'Space type → space → details → date and time; pay on arrival.', { pay: 'cash' }, 'meeting_room'),
    booking('rooms_online', 'Book & pay online', 'The booking is paid on WhatsApp first.', { pay: 'online', confirm: 'pdf' }, 'credit_card'),
    form('space_enquiry'),
    form('tenant_kyc'),
    form('maintenance_request'),
    form('move_out_notice'),
    booking('rooms_full', 'Full menu', 'Book, my bookings, change dates, cancel, KYC, location and call, in one menu.', { pay: 'both', extras: ['my_list', 'reschedule', 'cancel', 'form:tenant_kyc', 'location', 'call'] }, 'apartment'),
  ],
  events: [
    booking('events_visit', 'Book a venue visit', 'Venue type → venue → details → date and time, free of charge.', { pay: 'none' }, 'celebration'),
    booking('events_online', 'Book & pay online', 'The booking is paid on WhatsApp first and a PDF slip is sent.', { pay: 'online', confirm: 'pdf' }, 'credit_card'),
    form('event_enquiry'),
    form('feedback'),
    form('guest_rsvp'),
    form('vendor_registration'),
    booking('events_full', 'Full venue menu', 'Book, my bookings, change dates, cancel, event enquiry, location and call, in one menu.', { pay: 'both', extras: ['my_list', 'reschedule', 'cancel', 'form:event_enquiry', 'location', 'call'] }, 'festival'),
  ],
  realestate: [
    form('property_requirement', { categoryStep: true }, 'Property enquiry', 'Property type → requirement form → the enquiry lands on its page under Forms.'),
    form('property_requirement', { categoryStep: true, memberStep: true }, 'Property enquiry · pick an agent', 'Property type → agent → requirement form.', 'form_property_agent'),
    form('site_visit'),
    form('list_property'),
    form('home_loan_help'),
    form('property_requirement', { categoryStep: true, extras: ['form:site_visit', 'form:list_property', 'brochure', 'call', 'location'] }, 'Full real-estate menu', 'Enquiry, site visit, list a property, brochure, call and location, in one menu.', 'realestate_full'),
  ],
  education: [
    form('admission_enquiry', { categoryStep: true, memberStep: true }, 'Admission enquiry · stream → course', 'Stream → course → enquiry form.'),
    form('admission_enquiry', {}, 'Admission enquiry', 'The enquiry form on its own.', 'form_admission_plain'),
    form('demo_class'),
    form('admission_documents'),
    form('counselling_request'),
    form('admission_enquiry', { categoryStep: true, extras: ['form:demo_class', 'form:admission_documents', 'brochure', 'call', 'location'] }, 'Full admissions menu', 'Enquiry, demo class, documents, brochure, call and location, in one menu.', 'education_full'),
  ],
  logistics: [
    form('pickup_request'),
    form('delivery_issue'),
    form('track_shipment'),
    form('rate_enquiry'),
    form('business_account'),
    form('delivery_partner'),
    form('pickup_request', { extras: ['form:delivery_issue', 'form:track_shipment', 'form:rate_enquiry', 'call'] }, 'Full courier menu', 'Book a pickup, report an issue, track, get a quote and call, in one menu.', 'logistics_full'),
  ],
  finance: [
    form('loan_enquiry'),
    form('kyc_documents'),
    form('claim_intimation'),
    form('callback', {}, 'Callback from an advisor'),
    form('insurance_quote'),
    form('account_opening'),
    form('loan_enquiry', { extras: ['form:kyc_documents', 'form:claim_intimation', 'form:callback', 'call', 'location'] }, 'Full banking menu', 'Loan enquiry, KYC, claims, callback, call and location, in one menu.', 'finance_full'),
  ],
  it: [
    booking('it_meeting', 'Book a meeting · service → expert', 'Service → expert → your details and project → a free time → meeting confirmed.', { personal: false, pay: 'none' }, 'video_call'),
    booking('it_quick', 'Quick meeting', 'Pick an expert and a free time, with no service step or questions.', { categoryStep: false, personal: false, extraQuestions: false, pay: 'none' }, 'bolt'),
    booking('it_paid', 'Paid consultation', 'Service → expert → time → the consultation fee is paid on WhatsApp → PDF slip.', { personal: false, pay: 'online', confirm: 'pdf' }, 'credit_card'),
    form('job_application'),
    form('resume_upload'),
    form('interview_slot'),
    form('internship_application'),
    form('project_enquiry'),
    form('demo_request'),
    form('it_support'),
    form('client_onboarding'),
    form('job_application', { extras: ['form:resume_upload', 'form:interview_slot', 'form:internship_application'] }, 'Careers menu', 'Apply for a job, send a resume, schedule an interview and apply for an internship, in one menu.', 'it_careers'),
    form('project_enquiry', { extras: ['form:demo_request', 'form:it_support', 'form:client_onboarding', 'call', 'website'] }, 'Client services menu', 'Project enquiry, product demo, support ticket, onboarding, call and website, in one menu.', 'it_clients'),
    booking('it_full', 'Full company menu', 'Book a meeting, my meetings, reschedule, cancel, project enquiry, careers, support and call, in one menu.', { personal: false, pay: 'none', extras: ['my_list', 'reschedule', 'cancel', 'form:project_enquiry', 'form:job_application', 'form:it_support', 'call'] }, 'business_center'),
  ],
  other: [
    order('other_order', 'Order from the catalog', 'Category → catalog → location → pay online or cash.', { pay: 'both' }),
    booking('other_booking', 'Booking with time slots', 'Category → member → details → time; pay at the visit.', { pay: 'cash', personal: false }),
    form('enquiry'),
    form('callback'),
    form('feedback'),
    order('other_full', 'Full menu', 'Order, my orders, track, cancel, enquiry, location and call, in one menu.', { pay: 'both', extras: ['my_list', 'track', 'cancel', 'form:enquiry', 'location', 'call'] }, 'menu_book'),
  ],
};

/** The ready-made cards for this business type. */
export function templateCardsFor(v: VerticalConfig): TemplateCard[] {
  return CARDS[v.key] || CARDS.other;
}
export function allTemplateCards(): { vertical: string; card: TemplateCard }[] {
  return Object.entries(CARDS).flatMap(([vertical, cards]) => cards.map((card) => ({ vertical, card })));
}

export function optionsFor(card: TemplateCard): TemplateOptions {
  return { ...DEFAULT_OPTIONS, ...card.defaults, extras: [...(card.defaults.extras || [])], links: { ...(card.defaults.links || {}) } };
}

// ---------------------------------------------------------------------------
// Wording
// ---------------------------------------------------------------------------
const MODE_LABEL = (v: VerticalConfig): Record<Exclude<OrderMode, 'choose'>, string> => ({
  delivery: 'Delivery',
  takeaway: v.key === 'restaurant' ? 'Takeaway' : 'Store pickup',
  dinein: 'Dine-in',
});
const ordersOf = (v: VerticalConfig): Exclude<OrderMode, 'choose'>[] =>
  v.key === 'restaurant' ? ['delivery', 'takeaway', 'dinein'] : ['delivery', 'takeaway'];
const cashLabel = (v: VerticalConfig, mode: Exclude<OrderMode, 'choose'>) =>
  mode === 'takeaway' ? 'Pay at the counter' : mode === 'dinein' ? 'Pay at the table' : payOptions(v).cod;
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
/** Bookings in a shop-type business ("Other") still read as appointments. */
const bookingWording = (v: VerticalConfig): ConfirmWording => (v.archetype === 'catalog' ? ARCHETYPES.person.confirm : v.confirm);
const isBookingType = (v: VerticalConfig) => v.archetype === 'person' || v.archetype === 'unit' || v.key === 'other';
const isOrderType = (v: VerticalConfig) => v.archetype === 'catalog';
const seeItems = (v: VerticalConfig) => (v.key === 'restaurant' ? 'See the menu' : 'See products');
const orderLabel = (v: VerticalConfig) =>
  v.key === 'restaurant' ? 'Order food' : v.key === 'grocery' ? 'Order groceries' : v.key === 'ecommerce' ? 'Shop now' : 'Order now';
const bookLabel = (v: VerticalConfig) => blockLabel('booking', 'Book appointment', v);
const dateLabelFor = (v: VerticalConfig) =>
  v.key === 'hotel' ? 'Check-in date' : v.key === 'events' ? 'Event date' : v.key === 'rooms' ? 'Visit or move-in date' : 'Preferred date';

/** The business type's own booking questions, and the confirmation lines quoting them. */
function bookingQuestions(v: VerticalConfig): { fields: FieldSpec[]; lines: string[]; label: string } {
  const opts = (...titles: string[]): [string, string][] => titles.map((t) => [t.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''), t]);
  switch (v.key) {
    case 'hospital':
      return { label: 'Ask the reason for the visit', fields: [{ type: 'TextArea', name: 'visit_reason', label: 'Reason for visit', required: false }], lines: ['Reason: {{visit_reason}}'] };
    case 'gym':
      return { label: 'Ask their fitness goal', fields: [{ type: 'Dropdown', name: 'fitness_goal', label: 'Your goal', required: true, options: opts('Weight loss', 'Muscle gain', 'General fitness', 'Sports training') }], lines: ['Goal: {{fitness_goal}}'] };
    case 'automobile':
      return {
        label: 'Ask the vehicle and pickup',
        fields: [
          { type: 'TextInput', name: 'vehicle_model', label: 'Make & model', required: true, inputType: 'text' },
          { type: 'TextInput', name: 'registration_no', label: 'Registration no.', required: true, inputType: 'text' },
          { type: 'RadioButtonsGroup', name: 'pickup_needed', label: 'Need pickup & drop?', required: true, options: opts('Yes', 'No') },
        ],
        lines: ['Vehicle: {{vehicle_model}} {{registration_no}}', 'Pickup & drop: {{pickup_needed}}'],
      };
    case 'professional':
      return {
        label: 'Ask how to meet and the topic',
        fields: [
          { type: 'Dropdown', name: 'meeting_mode', label: 'How to meet', required: true, options: opts('In person', 'Video call', 'Phone call') },
          { type: 'TextArea', name: 'topic', label: 'What is it about?', required: false },
        ],
        lines: ['Meeting: {{meeting_mode}}'],
      };
    case 'homeservices':
      return {
        label: 'Ask the address and the problem',
        fields: [
          { type: 'TextArea', name: 'visit_address', label: 'Address', required: true },
          { type: 'TextArea', name: 'problem', label: 'Describe the problem', required: false },
        ],
        lines: ['Address: {{visit_address}}'],
      };
    case 'hotel':
      return {
        label: 'Ask guests and special requests',
        fields: [
          { type: 'TextInput', name: 'guests', label: 'Guests', required: true, inputType: 'number' },
          { type: 'TextArea', name: 'special_request', label: 'Special requests', required: false },
        ],
        lines: ['Guests: {{guests}}'],
      };
    case 'rooms':
      return {
        label: 'Ask the stay type and people',
        fields: [
          { type: 'Dropdown', name: 'stay_type', label: 'Looking for', required: true, options: opts('Short stay', 'Monthly stay', 'Day pass') },
          { type: 'TextInput', name: 'people', label: 'People', required: true, inputType: 'number' },
        ],
        lines: ['Looking for: {{stay_type}}', 'People: {{people}}'],
      };
    case 'events':
      return {
        label: 'Ask the event type and guests',
        fields: [
          { type: 'Dropdown', name: 'event_type', label: 'Event type', required: true, options: opts('Wedding', 'Birthday', 'Corporate', 'Other') },
          { type: 'TextInput', name: 'guests', label: 'Guests', required: true, inputType: 'number' },
        ],
        lines: ['Event: {{event_type}}', 'Guests: {{guests}}'],
      };
    case 'it':
      return {
        label: 'Ask how to meet and the project',
        fields: [
          { type: 'Dropdown', name: 'meeting_mode', label: 'How to meet', required: true, options: opts('Video call', 'In person', 'Phone call') },
          { type: 'TextInput', name: 'company', label: 'Company name', required: false, inputType: 'text' },
          { type: 'TextArea', name: 'topic', label: 'What is it about?', required: false },
        ],
        lines: ['Meeting: {{meeting_mode}}', 'Company: {{company}}'],
      };
    case 'salon':
      return { label: 'Ask for notes', fields: [{ type: 'TextArea', name: 'notes', label: 'Anything to add?', required: false }], lines: [] };
    default:
      return { label: 'Ask for notes', fields: [{ type: 'TextArea', name: 'notes', label: 'Anything to add?', required: false }], lines: [] };
  }
}

/** Lines added to a confirmation body after its "Paying by" line (or before its last paragraph). */
function withLines(body: string, lines: string[]): string {
  if (!lines.length) return body;
  const rows = body.split('\n');
  let at = rows.findIndex((r) => /^Paying by:/.test(r));
  if (at >= 0) at += 1;
  else {
    const lastBreak = rows.lastIndexOf('');
    at = lastBreak > 0 ? lastBreak : rows.length;
  }
  rows.splice(at, 0, ...lines);
  return rows.join('\n');
}

// ---------------------------------------------------------------------------
// What a card lets you change
// ---------------------------------------------------------------------------
const PAY_LABELS = (v: VerticalConfig, main: 'order' | 'booking'): { value: PayChoice; label: string }[] => [
  { value: 'online', label: main === 'order' ? 'Online only' : 'Pay online first' },
  { value: 'cash', label: main === 'order' ? 'Cash only' : `${payOptions(v).cod} only` },
  { value: 'both', label: 'Customer chooses' },
  { value: 'none', label: main === 'order' ? 'No payment step' : 'Free / no payment' },
];

const hasOrderPart = (card: TemplateCard, o: TemplateOptions) => card.main.kind === 'order' || o.extras.includes('order');
const hasBookingPart = (card: TemplateCard, o: TemplateOptions) => card.main.kind === 'booking' || o.extras.includes('book');

export function choicesFor(card: TemplateCard, v: VerticalConfig, o: TemplateOptions): ChoiceDef[] {
  const out: ChoiceDef[] = [];
  const modes = MODE_LABEL(v);
  if (hasOrderPart(card, o)) {
    out.push({
      key: 'mode', label: 'How customers get it', kind: 'one',
      options: [...ordersOf(v).map((m) => ({ value: m, label: modes[m] })), { value: 'choose', label: 'Customer chooses' }],
    });
    if (v.showsPage('categories')) out.push({ key: 'categoryStep', label: `Pick a ${lower(v.categoryLabel)} first`, kind: 'bool' });
    if (o.mode === 'delivery' || o.mode === 'choose') {
      out.push({
        key: 'address', label: 'Delivery address', kind: 'one',
        options: [{ value: 'pin', label: 'Share location pin' }, { value: 'typed', label: 'Type the address' }, { value: 'none', label: 'Don’t ask' }],
      });
    }
    if (o.mode !== 'dinein') out.push({ key: 'deliveryTime', label: o.mode === 'takeaway' ? 'Ask a pickup time' : 'Ask a delivery time', kind: 'bool' });
  }
  if (hasBookingPart(card, o)) {
    if (v.showsPage('categories') && !hasOrderPart(card, o)) out.push({ key: 'categoryStep', label: `Pick a ${lower(v.categoryLabel)} first`, kind: 'bool' });
    if (v.archetype === 'person') out.push({ key: 'personal', label: 'Ask age and gender', kind: 'bool' });
    out.push({ key: 'extraQuestions', label: bookingQuestions(v).label, kind: 'bool' });
  }
  if (hasOrderPart(card, o) || hasBookingPart(card, o)) {
    out.push({ key: 'pay', label: 'Payment', kind: 'one', options: PAY_LABELS(v, hasOrderPart(card, o) ? 'order' : 'booking') });
    out.push({
      key: 'confirm', label: 'Confirmation', kind: 'one',
      options: [{ value: 'message', label: 'Message' }, { value: 'pdf', label: 'Message + PDF slip' }],
    });
    if (o.confirm === 'pdf' || o.extras.includes('cancel')) {
      out.push({ key: 'design', label: 'PDF design', kind: 'one', options: PDF_DESIGNS.map((d) => ({ value: d.id, label: d.name })) });
    }
  }
  if (card.main.kind === 'form' && (v.archetype === 'lead' || v.archetype === 'unit' || v.archetype === 'person' || v.key === 'other')) {
    if (v.showsPage('categories')) out.push({ key: 'categoryStep', label: `Ask the ${lower(v.categoryLabel)} first`, kind: 'bool' });
    if (v.showsPage('members') && o.categoryStep) out.push({ key: 'memberStep', label: `Then the ${lower(v.memberSingular)}`, kind: 'bool' });
  }
  out.push({ key: 'restart', label: o.extras.length ? 'A “Main menu” button at the end' : 'A “Start again” button at the end', kind: 'bool' });
  // One entry per key (an order + booking menu would ask the category twice).
  const seen = new Set<string>();
  return out.filter((c) => (seen.has(c.key) ? false : (seen.add(c.key), true)));
}

/** The extra menu items this card can have. */
export function extrasFor(card: TemplateCard, v: VerticalConfig): ExtraDef[] {
  const out: ExtraDef[] = [];
  const unit = v.archetype === 'unit';
  if (isOrderType(v)) {
    if (card.main.kind !== 'order') out.push({ id: 'order', label: orderLabel(v), icon: 'shopping_bag' });
    out.push({ id: 'my_list', label: 'My orders', icon: 'receipt_long' });
    if (card.main.kind !== 'track') out.push({ id: 'track', label: 'Track my order', icon: 'local_shipping' });
    out.push({ id: 'cancel', label: 'Cancel an order', icon: 'cancel' });
  }
  if (isBookingType(v)) {
    if (card.main.kind !== 'booking') out.push({ id: 'book', label: bookLabel(v), icon: 'event_available' });
    out.push({ id: 'my_list', label: unit ? 'My bookings' : 'My appointments', icon: 'event_note' });
    out.push({ id: 'reschedule', label: unit ? 'Change dates' : 'Reschedule', icon: 'event_repeat' });
    out.push({ id: 'cancel', label: unit ? 'Cancel a booking' : 'Cancel an appointment', icon: 'event_busy' });
  }
  if (v.archetype === 'lead') out.push({ id: 'brochure', label: 'Get the brochure', icon: 'menu_book' });
  out.push({ id: 'location', label: 'Our location', icon: 'location_on' });
  out.push({ id: 'call', label: 'Call us', icon: 'call' });
  out.push({ id: 'website', label: 'Visit our website', icon: 'language' });
  const { own, common } = formsFor(v);
  for (const p of [...own, ...common]) {
    if (card.main.kind === 'form' && card.main.form === p.id) continue;
    out.push({ id: `form:${p.id}`, label: p.title, icon: p.icon });
  }
  // One per id (Other has both an order and a booking part).
  const seen = new Set<string>();
  return out.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
}

/** The most extra menu items a flow can have (WhatsApp lists stay short). */
export const MAX_EXTRAS = 8;

// ---------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------
type Target = { screen: string } | { block: FlowBlock } | null;
const nodeOf = (t: Target): string => (!t ? '' : 'screen' in t ? `screen_${t.screen}` : `block_${t.block.id}`);

class Draft {
  screens: FlowScreen[] = [];
  blocks: FlowBlock[] = [];
  steps: string[] = [];
  needs: string[] = [];
  private cidN = 0;
  private restartBlock: FlowBlock | null = null;
  readonly hasMenu: boolean;

  constructor(readonly v: VerticalConfig, readonly o: TemplateOptions) {
    this.hasMenu = o.extras.length > 0;
  }

  c(x: Omit<FlowComponent, 'cid'>): FlowComponent {
    this.cidN += 1;
    return { cid: `tpl_${this.cidN}`, ...x } as FlowComponent;
  }
  /** A screen id that's free: letters and underscores only (Meta's rule). */
  private freeId(base: string): string {
    const clean = base.toUpperCase().replace(/[^A-Z_]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 36) || 'SCREEN';
    const taken = new Set(this.screens.map((s) => s.id));
    if (!taken.has(clean)) return clean;
    for (const l of 'BCDEFGHIJKLMNOPQRSTUVWXYZ') if (!taken.has(`${clean}_${l}`)) return `${clean}_${l}`;
    return `${clean}_${'Z'.repeat(this.screens.length)}`;
  }
  screen(base: string, title: string, components: FlowComponent[], extra: Partial<FlowScreen> = {}): FlowScreen {
    const s: FlowScreen = { id: this.freeId(base), title: title.slice(0, 30), components, ...extra };
    this.screens.push(s);
    return s;
  }
  block(b: FlowBlock): FlowBlock {
    this.blocks.push(b);
    return b;
  }
  need(text: string) {
    if (!this.needs.includes(text)) this.needs.push(text);
  }
  footer(label: string, to: Target): FlowComponent {
    if (to && 'screen' in to) return this.c({ type: 'Footer', buttonLabel: label, action: 'navigate', nextScreen: to.screen });
    return this.c({ type: 'Footer', buttonLabel: label, action: 'complete', ...(to ? { blockId: to.block.id } : {}) });
  }
  /** The label of the button after the last message. */
  get endLabel(): string {
    return this.hasMenu ? 'Main menu' : 'Start again';
  }
  /** Buttons for a block that ends a path, wired to the shared Start over block. */
  endWith(b: FlowBlock): FlowBlock {
    if (!this.o.restart) {
      b.buttons = [];
      b.buttonTargets = [];
      return b;
    }
    if (!this.restartBlock) this.restartBlock = this.block(makeBlock({ kind: 'restart' }));
    b.buttons = [this.endLabel];
    b.buttonTargets = [`block_${this.restartBlock.id}`];
    return b;
  }
  /** A plain closing message (a reply block when it offers "Main menu"). */
  closing(text: string): FlowBlock {
    const b = makeBlock({ kind: this.o.restart ? 'reply' : 'message' });
    b.text = text;
    if (this.o.restart) this.endWith(b);
    return this.block(b);
  }
  /** The PDF slip in the chosen design. */
  pdf(wording: ConfirmWording, slip: 'confirm' | 'cancel'): FlowBlock {
    const b = makeBlock({ kind: 'pdfdoc', preset: slip }, wording);
    if (this.o.design !== 'classic') {
      const opts = slip === 'cancel' ? { ...wording.pdf, title: wording.cancel.pdfTitle, note: wording.cancel.pdfNote } : wording.pdf;
      b.pdfTemplate = { ...buildPdfDesign(this.o.design, opts), design: this.o.design, slip };
    }
    return b;
  }
  /** The confirmation: a message, or a message with the PDF slip. */
  confirmBlock(wording: ConfirmWording, lines: string[] = []): FlowBlock {
    let b: FlowBlock;
    if (this.o.confirm === 'pdf') {
      b = this.pdf(wording, 'confirm');
    } else {
      b = makeBlock({ kind: 'orderconfirm' }, wording);
      b.text = withLines(wording.body, lines);
    }
    return this.block(this.endWith(b));
  }
  /** "Your payment didn't go through." */
  failBlock(): FlowBlock {
    return this.closing('Your payment didn’t go through, so nothing has been charged. Reply here and we’ll help you finish.');
  }
  /** WhatsApp Pay, continuing to `confirm` once paid. */
  paymentBlock(confirm: FlowBlock, text?: string): FlowBlock {
    const b = makeBlock({ kind: 'payment' });
    if (text) b.text = text;
    b.nextTarget = `block_${confirm.id}`;
    b.invalidTarget = `block_${this.failBlock().id}`;
    return this.block(b);
  }
  fieldComp(f: FieldSpec, preset?: string): FlowComponent {
    return this.c({
      type: f.type,
      name: f.name,
      label: f.label,
      required: !!f.required,
      ...(preset ? { preset } : {}),
      ...(f.inputType ? { inputType: f.inputType } : {}),
      ...(f.helperText ? { helperText: f.helperText } : {}),
      ...(f.description ? { description: f.description } : {}),
      ...(f.prefill ? { prefill: f.prefill } : {}),
      ...(f.locked ? { locked: true } : {}),
      ...(f.maxFiles ? { maxFiles: f.maxFiles } : {}),
      ...(f.photoSource ? { photoSource: f.photoSource } : {}),
      ...(f.maxDaysAhead ? { maxDaysAhead: f.maxDaysAhead } : {}),
      ...(f.pastDays ? { pastDays: f.pastDays } : {}),
      ...(f.endLabel ? { endLabel: f.endLabel } : {}),
      ...(f.options ? { source: 'static' as const, options: f.options.map(([id, title]) => ({ id, title, description: '' })) } : {}),
    });
  }
  identity(): FlowComponent[] {
    return [
      this.c({ type: 'TextInput', name: 'name', label: 'Name', inputType: 'text', required: true }),
      this.c({
        type: 'TextInput', name: 'whatsapp_number', label: 'WhatsApp number', inputType: 'phone', required: true,
        prefill: 'phone', locked: true, helperText: 'Auto-filled from your WhatsApp account',
      }),
    ];
  }
  categoriesList(): FlowComponent {
    this.need(`Add your ${lower(this.v.categoryPlural)} on the ${this.v.categoryPlural} page`);
    return this.c({ type: 'RadioButtonsGroup', name: 'selected_category', label: this.v.key === 'other' ? 'Categories' : this.v.categoryPlural, required: true, source: 'categories', options: [] });
  }
  membersList(): FlowComponent {
    return this.c({
      type: 'RadioButtonsGroup', name: 'selected_member',
      label: this.v.key === 'other' ? 'Choose a member' : `Choose a ${lower(this.v.memberSingular)}`.slice(0, 30),
      required: true, source: 'members', options: [],
    });
  }
}

/** The first node of a part of the flow, and its menu label. */
interface Part {
  label: string;
  entry: Target;
}

// ---- Orders (catalog) ------------------------------------------------------
function buildOrder(d: Draft): Part {
  const { v, o } = d;
  const modes = o.mode === 'choose' ? ordersOf(v) : [o.mode as Exclude<OrderMode, 'choose'>];
  const names = MODE_LABEL(v);
  const wording = v.confirm;
  const starts: Record<string, string> = {};
  d.need('Connect your WhatsApp catalog and add products on the Catalog page');

  for (const m of modes) {
    // After the cart: (location) → payment → confirmation.
    const lines: string[] = [];
    if (m === 'dinein') lines.push('Table: {{table_no}}');
    if (m === 'takeaway' && o.deliveryTime) lines.push('Pickup time: {{pickup_time}}');
    if (m === 'delivery' && o.deliveryTime) lines.push('Delivery time: {{delivery_slot}}');
    if (m === 'delivery' && o.address === 'typed') lines.push('Landmark: {{landmark}}');
    if (o.mode === 'choose') lines.unshift(`Order type: ${names[m]}`);
    const confirm = d.confirmBlock(wording, lines);

    const cash = cashLabel(v, m);
    let payEntry: FlowBlock;
    if (o.pay === 'online') {
      payEntry = d.paymentBlock(confirm);
    } else if (o.pay === 'cash' || o.pay === 'both') {
      const pm = makeBlock({ kind: 'paymethod' });
      pm.header = 'none';
      if (o.pay === 'cash') {
        pm.text = 'Tap below to place your order.';
        pm.buttons = [cash];
        pm.buttonTargets = [`block_${confirm.id}`];
      } else {
        pm.text = 'How would you like to pay?';
        const pay = d.paymentBlock(confirm);
        pm.buttons = ['Pay online', cash];
        pm.buttonTargets = [`block_${pay.id}`, `block_${confirm.id}`];
      }
      payEntry = d.block(pm);
    } else {
      payEntry = confirm;
    }

    let afterCart: FlowBlock = payEntry;
    if (m === 'delivery' && o.address === 'pin') {
      const loc = makeBlock({ kind: 'location' });
      loc.text = 'Please share your delivery location: tap 📎 and choose Location.';
      loc.validTarget = `block_${payEntry.id}`;
      const again = makeBlock({ kind: 'message' });
      again.text = 'We need your location to deliver. Please tap 📎, choose Location and send it.';
      again.nextTarget = `block_${loc.id}`;
      loc.invalidTarget = `block_${again.id}`;
      d.block(loc);
      d.block(again);
      afterCart = loc;
    }

    const catalog = makeBlock({ kind: 'catalog' });
    catalog.text = v.key === 'restaurant' ? 'Here’s our menu. Add what you’d like to the cart and send it.' : 'Here are our products. Add what you need to the cart and send it.';
    catalog.nextTarget = `block_${afterCart.id}`;
    d.block(catalog);

    // The screen before the catalog: what this way of ordering needs to know.
    const comps: FlowComponent[] = [];
    const heading = m === 'delivery' ? 'Order for delivery' : m === 'takeaway' ? (v.key === 'restaurant' ? 'Order for takeaway' : 'Order for store pickup') : 'Order at your table';
    comps.push(d.c({ type: 'TextHeading', text: heading }));
    if (m === 'dinein') comps.push(d.c({ type: 'TextInput', name: 'table_no', label: 'Table number', inputType: 'number', required: true }));
    if (m === 'delivery' && o.address === 'typed') {
      comps.push(d.c({ type: 'TextArea', name: 'delivery_address', label: 'Delivery address', required: true }));
      comps.push(d.c({ type: 'TextInput', name: 'landmark', label: 'Landmark', inputType: 'text', required: false }));
    }
    const times: FlowOption[] = [{ id: 'asap', title: 'As soon as possible', description: '' }, ...TIME_OPTIONS.map(([id, title]) => ({ id, title, description: '' }))];
    if (m === 'delivery' && o.deliveryTime) comps.push(d.c({ type: 'Dropdown', name: 'delivery_slot', label: 'Delivery time', required: true, source: 'static', options: times }));
    if (m === 'takeaway' && o.deliveryTime) comps.push(d.c({ type: 'Dropdown', name: 'pickup_time', label: 'Pickup time', required: true, source: 'static', options: times }));
    if (o.categoryStep && v.showsPage('categories')) {
      comps.push(d.c({ type: 'TextBody', text: `Pick a ${lower(v.categoryLabel)}, then add items to your cart.` }));
      comps.push(d.categoriesList());
    } else {
      comps.push(d.c({ type: 'TextBody', text: 'Tap below to see everything we have, then add items to your cart.' }));
    }
    comps.push(d.footer(seeItems(v), { block: catalog }));
    const s = d.screen(o.mode === 'choose' ? `ORDER_${m}` : 'ORDER', names[m], comps);
    starts[m] = s.id;
  }

  // Steps, for the card.
  const m0 = modes[0];
  if (o.mode === 'choose') d.steps.push(`Chooses ${modes.map((m) => names[m]).join(', ')}`);
  if (modes.includes('dinein')) d.steps.push('Dine-in: enters the table number');
  if (o.address === 'typed' && modes.includes('delivery')) d.steps.push('Delivery: types the address');
  if (o.deliveryTime && modes.some((m) => m !== 'dinein')) d.steps.push(modes.length > 1 ? 'Picks a delivery / pickup time' : m0 === 'takeaway' ? 'Picks a pickup time' : 'Picks a delivery time');
  if (o.categoryStep && v.showsPage('categories')) d.steps.push(`Picks a ${lower(v.categoryLabel)}`);
  d.steps.push(v.key === 'restaurant' ? 'Browses the menu and sends a cart' : 'Browses the catalog and sends a cart');
  if (o.address === 'pin' && modes.includes('delivery')) d.steps.push('Delivery: shares a location pin');
  payStep(d, o.pay, payOptions(v).cod);
  confirmStep(d, wording);
  if (o.pay === 'online' || o.pay === 'both') d.need('Set up WhatsApp Pay on the Payment Configuration page');

  if (o.mode !== 'choose') return { label: orderLabel(v), entry: { screen: starts[m0] } };
  const choose = d.screen('ORDER_TYPE', 'How to order', [
    d.c({ type: 'TextHeading', text: 'How would you like your order?' }),
    d.c({
      type: 'RadioButtonsGroup', name: 'order_type', label: 'Order type', required: true, source: 'static',
      options: modes.map((m) => ({ id: m, title: names[m], description: '', nextScreen: starts[m] })),
    }),
    d.footer('Continue', null),
  ]);
  return { label: orderLabel(v), entry: { screen: choose.id } };
}

function payStep(d: Draft, pay: PayChoice, cash: string) {
  if (pay === 'online') d.steps.push('Pays with WhatsApp Pay (UPI)');
  else if (pay === 'cash') d.steps.push(`Pays later (${lower(cash)})`);
  else if (pay === 'both') d.steps.push(`Chooses Pay online (WhatsApp Pay) or ${lower(cash)}`);
}
function confirmStep(d: Draft, wording: ConfirmWording) {
  d.steps.push(`Gets “${wording.label}”${d.o.confirm === 'pdf' ? ' with a PDF slip' : ''}`);
}

// ---- Bookings (a person, a room, a venue) ----------------------------------
function buildBooking(d: Draft): Part {
  const { v, o } = d;
  const wording = bookingWording(v);
  const unit = v.archetype === 'unit';
  const q = bookingQuestions(v);
  const lines = o.extraQuestions ? q.lines : [];
  const confirm = d.confirmBlock(wording, lines);
  const cod = payOptions(v).cod;

  // After the time: payment, then the confirmation.
  let slotTo: Target;
  let paymentScreen: FlowScreen | null = null;
  if (o.pay === 'online') {
    slotTo = { block: d.paymentBlock(confirm, 'Review your booking and pay securely via UPI.') };
  } else if (o.pay === 'both') {
    const pay = d.paymentBlock(confirm, 'Review your booking and pay securely via UPI.');
    paymentScreen = d.screen('PAYMENT', 'Payment', [
      d.c({ type: 'TextHeading', text: 'How would you like to pay?' }),
      d.c({
        type: 'RadioButtonsGroup', name: 'payment_method', label: 'Payment', required: true, source: 'static',
        options: [
          { id: 'cod', title: cod, description: '', blockId: confirm.id },
          { id: 'online', title: payOptions(v).online, description: '', blockId: pay.id },
        ],
      }),
      d.footer('Confirm booking', null),
    ]);
    slotTo = { screen: paymentScreen.id };
  } else {
    slotTo = { block: confirm };
  }

  const slot = d.screen('PICK_SLOT', v.key === 'hotel' ? 'Check-in time' : 'Pick a time', [
    d.c({ type: 'TextHeading', text: v.key === 'hotel' ? 'Pick a check-in time' : 'Pick a time' }),
    d.c({ type: 'TextBody', text: 'Available times on ${data.preferred_date_label}' }),
    d.c({ type: 'Dropdown', name: 'selected_slot', label: 'Available times', required: true, source: 'slots', options: [] }),
    ...(o.pay === 'cash' ? [d.c({ type: 'TextCaption', text: `Payment: ${lower(cod)}.` })] : []),
    d.footer(o.pay === 'both' ? 'Continue' : 'Confirm booking', slotTo),
  ]);

  const personal = o.personal && v.archetype === 'person';
  const details = d.screen('DETAILS', 'Your details', [
    d.c({ type: 'TextHeading', text: unit || v.key === 'other' ? bookLabel(v) : 'Book an appointment' }),
    d.c({ type: 'TextBody', text: `${o.categoryStep && v.showsPage('categories') ? `For: \${data.selected_category_label} · ` : ''}\${data.selected_member_label}` }),
    ...d.identity(),
    d.c({ type: 'TextInput', name: 'email', label: 'Email', inputType: 'email', required: false }),
    ...(personal
      ? [
          d.c({
            type: 'Dropdown', name: 'gender', label: 'Gender', required: true, source: 'static',
            options: [{ id: 'male', title: 'Male', description: '' }, { id: 'female', title: 'Female', description: '' }, { id: 'other', title: 'Other', description: '' }],
          }),
          d.c({ type: 'TextInput', name: 'age', label: 'Age', inputType: 'number', required: true }),
        ]
      : []),
    ...(o.extraQuestions ? q.fields.map((f) => d.fieldComp(f)) : []),
    d.c({ type: 'DatePicker', name: 'preferred_date', label: dateLabelFor(v), required: true }),
    d.footer('See times', { screen: slot.id }),
  ]);

  const member = d.screen('CHOOSE_MEMBER', v.key === 'other' ? 'Choose' : v.memberLabel, [
    d.c({ type: 'TextHeading', text: v.key === 'other' ? 'Who would you like to book?' : `Choose a ${lower(v.memberSingular)}` }),
    d.membersList(),
    d.footer('Continue', { screen: details.id }),
  ]);
  d.need(`Add your ${lower(v.memberLabel)} and their ${v.archetype === 'unit' ? 'bookable times' : 'working hours'} on the ${v.memberLabel} page`);

  let entry: Target = { screen: member.id };
  if (o.categoryStep && v.showsPage('categories')) {
    const cat = d.screen('CHOOSE_CATEGORY', v.categoryLabel, [
      d.c({ type: 'TextHeading', text: `Choose a ${lower(v.categoryLabel)}` }),
      d.categoriesList(),
      d.footer('Continue', { screen: member.id }),
    ]);
    entry = { screen: cat.id };
    d.steps.push(`Picks a ${lower(v.categoryLabel)}`);
  }
  d.steps.push(`Picks a ${lower(v.memberSingular)}`);
  d.steps.push(`Fills in their details${personal ? ' (with age and gender)' : ''} and picks a day`);
  d.steps.push('Picks a free time');
  payStep(d, o.pay, cod);
  confirmStep(d, wording);
  if (o.pay === 'online' || o.pay === 'both') {
    d.need('Set up WhatsApp Pay on the Payment Configuration page');
    d.need(`Give each ${lower(v.memberSingular)} a ${lower(v.feeLabel)}: online payment charges it`);
  }
  return { label: bookLabel(v), entry };
}

// ---- Forms -----------------------------------------------------------------
function summaryLines(p: FormPreset): string[] {
  return p.fields
    .filter((f) => f.name !== 'name' && f.name !== 'whatsapp_number' && ['TextInput', 'TextArea', 'Dropdown', 'RadioButtonsGroup'].includes(f.type))
    .slice(0, 3)
    .map((f) => `${f.label}: {{${f.name}}}`);
}

function buildForm(d: Draft, presetId: string, asMain: boolean): Part | null {
  const { v, o } = d;
  const p = presetById(presetId);
  if (!p) return null;
  const thanks = d.closing(
    [`✅ *${p.title} received*`, '', 'Thanks {{customer_name}}! We’ve got your details and will reply here shortly.', '', ...summaryLines(p)].join('\n'),
  );
  const lead = asMain && (v.archetype === 'lead' || v.archetype === 'unit' || v.archetype === 'person' || v.key === 'other');
  const withCategory = lead && o.categoryStep && v.showsPage('categories');
  const withMember = withCategory && o.memberStep && v.showsPage('members');

  const comps: FlowComponent[] = [d.c({ type: 'TextHeading', text: p.heading })];
  if (withCategory) {
    comps.push(d.c({ type: 'TextBody', text: `For: \${data.selected_category_label}${withMember ? ' · ${data.selected_member_label}' : ''}` }));
  } else if (p.body) {
    comps.push(d.c({ type: 'TextBody', text: p.body }));
  }
  for (const f of p.fields) comps.push(d.fieldComp(f, p.id));
  comps.push(d.footer(p.button, { block: thanks }));
  const formScreen = d.screen(p.id, p.title, comps);

  let entry: Target = { screen: formScreen.id };
  if (withMember) {
    const mem = d.screen(`${p.id}_member`, v.memberSingular, [
      d.c({ type: 'TextHeading', text: `Choose a ${lower(v.memberSingular)}` }),
      d.membersList(),
      d.footer('Continue', entry),
    ]);
    d.need(`Add your ${lower(v.memberLabel)} on the ${v.memberLabel} page`);
    entry = { screen: mem.id };
  }
  if (withCategory) {
    const cat = d.screen(`${p.id}_category`, v.categoryLabel, [
      d.c({ type: 'TextHeading', text: `Choose a ${lower(v.categoryLabel)}` }),
      d.categoriesList(),
      d.footer('Continue', entry),
    ]);
    entry = { screen: cat.id };
  }
  if (asMain) {
    if (withCategory) d.steps.push(`Picks a ${lower(v.categoryLabel)}`);
    if (withMember) d.steps.push(`Picks a ${lower(v.memberSingular)}`);
    d.steps.push(`Fills in the “${p.title}” form`);
    d.steps.push('Gets a thank-you message quoting their answers');
  }
  return { label: p.title, entry };
}

// ---- My orders / track / cancel / reschedule -------------------------------
function detailsBlock(d: Draft): FlowBlock {
  const wording = isOrderType(d.v) ? d.v.confirm : bookingWording(d.v);
  const b = makeBlock({ kind: 'orderdetails' }, wording);
  b.header = 'none';
  return d.block(d.endWith(b));
}

function buildMyList(d: Draft): Part {
  const { v } = d;
  const unit = v.archetype === 'unit';
  if (isOrderType(v)) {
    const s = d.screen('MY_ORDERS', 'My orders', [
      d.c({ type: 'TextHeading', text: 'Your orders' }),
      d.c({ type: 'RadioButtonsGroup', name: 'selected_order', label: 'Your orders', required: true, source: 'orders', options: [] }),
      d.footer('See details', { block: detailsBlock(d) }),
    ]);
    return { label: 'My orders', entry: { screen: s.id } };
  }
  const s = d.screen(unit ? 'MY_BOOKINGS' : 'MY_APPOINTMENTS', unit ? 'My bookings' : 'My appointments', [
    d.c({ type: 'TextHeading', text: unit ? 'Your bookings' : 'Your appointments' }),
    d.c({ type: 'RadioButtonsGroup', name: 'reschedule_appointment', label: unit ? 'Your bookings' : 'Your appointments', required: true, source: 'appointments', options: [] }),
    d.footer('See details', { block: detailsBlock(d) }),
  ]);
  return { label: unit ? 'My bookings' : 'My appointments', entry: { screen: s.id } };
}
function buildTrack(d: Draft, asMain: boolean): Part {
  const s = d.screen('TRACK_ORDER', 'Track my order', [
    d.c({ type: 'TextHeading', text: 'Track your order' }),
    d.c({ type: 'TextBody', text: 'Pick an order to see its latest status.' }),
    // `selected_order`, never `cancel_order`: looking must not cancel anything.
    d.c({ type: 'RadioButtonsGroup', name: 'selected_order', label: 'Your orders', required: true, source: 'active_orders', options: [] }),
    d.footer('See status', { block: detailsBlock(d) }),
  ]);
  if (asMain) {
    d.steps.push('Picks one of their open orders');
    d.steps.push(`Gets “${d.v.confirm.detailsLabel}” with its latest status`);
  }
  return { label: 'Track my order', entry: { screen: s.id } };
}

function buildCancel(d: Draft): Part {
  const { v, o } = d;
  const wording = isOrderType(v) ? v.confirm : bookingWording(v);
  const cw = wording.cancel;
  const thing = isOrderType(v) ? 'order' : v.archetype === 'unit' ? 'booking' : 'appointment';
  let done: FlowBlock;
  if (o.confirm === 'pdf') {
    done = d.block(d.endWith(d.pdf(wording, 'cancel')));
  } else {
    done = d.closing(`❌ Your ${thing} {{order_id}} has been cancelled.\n\nIf this was a mistake, reply here and we’ll help.`);
  }
  const kept = d.closing(`No problem: your ${thing} is unchanged.`);
  const confirmScreen = d.screen('CANCEL_CONFIRM', cw.confirmTitle, [
    d.c({ type: 'TextHeading', text: cw.confirmTitle }),
    d.c({ type: 'TextBody', text: `${cw.confirmPrefix}\n\${data.cancel_order_label}` }),
    d.c({
      type: 'RadioButtonsGroup', name: 'cancel_confirm', label: 'Are you sure?', required: true, source: 'static',
      options: [
        { id: 'yes', title: cw.yesLabel, description: '', blockId: done.id },
        { id: 'no', title: cw.noLabel, description: '', blockId: kept.id },
      ],
    }),
    d.footer('Submit', null),
  ]);
  const pick = d.screen('CANCEL', cw.pickTitle, [
    d.c({ type: 'TextHeading', text: cw.pickTitle }),
    d.c({ type: 'TextBody', text: cw.pickBody }),
    d.c({ type: 'RadioButtonsGroup', name: 'cancel_order', label: `Your ${thing}s`, required: true, source: 'active_orders', options: [] }),
    d.footer('Continue', { screen: confirmScreen.id }),
  ]);
  return { label: cw.pickTitle, entry: { screen: pick.id } };
}

function buildReschedule(d: Draft): Part {
  const { v } = d;
  const unit = v.archetype === 'unit';
  const confirm = d.confirmBlock(bookingWording(v));
  const time = d.screen('NEW_TIME', 'Pick a new time', [
    d.c({ type: 'TextHeading', text: 'Pick a new time' }),
    d.c({ type: 'TextBody', text: 'Available times on ${data.preferred_date_label}' }),
    d.c({ type: 'Dropdown', name: 'selected_slot', label: 'Available times', required: true, source: 'slots', options: [] }),
    d.footer('Confirm change', { block: confirm }),
  ]);
  const date = d.screen('NEW_DATE', 'Pick a new date', [
    d.c({ type: 'TextHeading', text: 'Pick a new date' }),
    d.c({ type: 'TextBody', text: 'Currently booked: ${data.reschedule_appointment_label}' }),
    d.c({ type: 'DatePicker', name: 'preferred_date', label: 'New date', required: true }),
    d.footer('See times', { screen: time.id }),
  ]);
  const pick = d.screen('RESCHEDULE', unit ? 'Change dates' : 'Reschedule', [
    d.c({ type: 'TextHeading', text: unit ? 'Change your booking' : 'Reschedule an appointment' }),
    d.c({ type: 'TextBody', text: unit ? 'Which booking would you like to move?' : 'Which appointment would you like to move?' }),
    d.c({ type: 'RadioButtonsGroup', name: 'reschedule_appointment', label: unit ? 'Your bookings' : 'Your appointments', required: true, source: 'appointments', options: [] }),
    d.footer('Continue', { screen: date.id }),
  ]);
  return { label: unit ? 'Change dates' : 'Reschedule', entry: { screen: pick.id } };
}

// ---- Blocks reached straight from the menu ---------------------------------
/** The setup line for a Location / Call / Brochure item whose details are missing. */
export const LINK_NEED: Record<LinkKind, string> = {
  location: 'Add your Google Maps link to “Our location”',
  call: 'Add your phone number to “Call us”',
  brochure: 'Add your brochure link to “Get the brochure”',
  website: 'Add your website link to “Visit our website”',
};

function buildLink(d: Draft, kind: LinkKind): Part {
  const info = LINK_INFO[kind];
  const given = d.o.links[kind];
  const ok = !linkProblem(kind, given);
  // Details that don't check out yet start from the defaults, so the block is
  // still well-formed; the setup list asks for the real ones.
  const det: LinkDetails = {
    text: String(given?.text || '').trim() || info.defaults.text,
    label: ok ? String(given?.label).trim() : String(given?.label || '').trim().slice(0, 20) || info.defaults.label,
    value: ok ? String(given?.value).trim() : '',
  };
  if (!ok) d.need(LINK_NEED[kind]);
  if (kind === 'call') {
    const b = makeBlock({ kind: 'call' });
    b.text = det.text;
    b.callLabel = det.label;
    if (det.value) b.callPhone = det.value;
    return { label: info.title, entry: { block: d.block(b) } };
  }
  const b = makeBlock({ kind: 'cta' });
  b.text = det.text;
  b.ctaLabel = det.label;
  // A missing link stays as "https://", which the Map flags as "Add the link".
  b.ctaUrl = det.value || 'https://';
  return { label: info.title, entry: { block: d.block(b) } };
}

// ---------------------------------------------------------------------------
// Assemble
// ---------------------------------------------------------------------------
/** Build the flow a card makes with these choices. */
export function buildTemplate(card: TemplateCard, v: VerticalConfig, opts: TemplateOptions): BuiltTemplate {
  const o: TemplateOptions = { ...opts, extras: opts.extras.slice(0, MAX_EXTRAS), links: opts.links || {} };
  // A choice that doesn't apply is ignored rather than refused.
  if (!v.showsPage('categories')) o.categoryStep = false;
  if (!o.categoryStep) o.memberStep = false;
  if (o.mode === 'dinein' && v.key !== 'restaurant') o.mode = 'delivery';
  const d = new Draft(v, o);

  let main: Part | null = null;
  if (card.main.kind === 'order') main = buildOrder(d);
  else if (card.main.kind === 'booking') main = buildBooking(d);
  else if (card.main.kind === 'form') main = buildForm(d, card.main.form, true);
  else main = buildTrack(d, true);
  if (!main) throw new Error(`Unknown form in template ${card.id}`);

  const parts: Part[] = [main];
  const mainSteps = d.steps.length;
  for (const x of o.extras) {
    let p: Part | null = null;
    if (x === 'order' && isOrderType(v)) p = buildOrder(d);
    else if (x === 'book' && isBookingType(v)) p = buildBooking(d);
    else if (x === 'my_list') p = buildMyList(d);
    else if (x === 'track' && isOrderType(v)) p = buildTrack(d, false);
    else if (x === 'cancel') p = buildCancel(d);
    else if (x === 'reschedule' && isBookingType(v)) p = buildReschedule(d);
    else if (isLinkKind(x)) p = buildLink(d, x);
    else if (x.startsWith('form:')) p = buildForm(d, x.slice(5), false);
    if (p) parts.push(p);
  }
  // Steps of the extra parts aren't the main path; keep the main path's only.
  d.steps.splice(mainSteps);

  let entry: Target = main.entry;
  if (parts.length > 1) {
    const menu = d.screen('WELCOME', 'Welcome', [
      d.c({ type: 'TextHeading', text: 'How can we help?' }),
      d.c({
        type: 'RadioButtonsGroup', name: 'menu_choice', label: 'Choose one', required: true, source: 'static',
        options: parts.map((p, i) => ({
          id: `menu_${String.fromCharCode(97 + i)}`,
          title: p.label.slice(0, 30),
          description: '',
          ...(p.entry && 'screen' in p.entry ? { nextScreen: p.entry.screen } : p.entry ? { blockId: p.entry.block.id } : {}),
        })),
      }),
      d.footer('Continue', null),
    ]);
    // The menu leads the screen list, so the builder opens on it.
    d.screens = [menu, ...d.screens.filter((s) => s.id !== menu.id)];
    entry = { screen: menu.id };
    d.steps.unshift(`Opens the menu and picks “${main.label}”`);
    d.steps.push(`The menu also has: ${parts.slice(1).map((p) => p.label).join(', ')}`);
  }

  // The first screen opens straight from the chat message, with no call to our
  // endpoint, so a live list there (categories, doctors, orders) would have
  // nothing in it. Such a flow starts on a short welcome screen instead.
  const firstId = entry && 'screen' in entry ? entry.screen : '';
  const first = d.screens.find((s) => s.id === firstId) || null;
  if (first && hasLiveList(first)) {
    const intro = d.screen('START', main.label, [
      d.c({ type: 'TextHeading', text: main.label }),
      d.c({ type: 'TextBody', text: introText(card, v, o) }),
      d.footer('Start', { screen: first.id }),
    ]);
    d.screens = [intro, ...d.screens.filter((s) => s.id !== intro.id)];
    entry = { screen: intro.id };
  }

  // The start screen leads the list: the builder opens on it, and a flow with
  // no Start wiring falls back to the first screen.
  const startId = entry && 'screen' in entry ? entry.screen : '';
  const startAt = d.screens.findIndex((s) => s.id === startId);
  if (startAt > 0) d.screens = [d.screens[startAt], ...d.screens.filter((_, i) => i !== startAt)];

  // A dynamic list with nothing in it shows this instead of an error.
  const dynamic = d.screens.some((s) => s.components.some((c) => c.source && c.source !== 'static' && c.source !== 'slots'));
  if (dynamic) {
    d.screen('NOT_FOUND', 'Nothing found', [
      d.c({ type: 'TextHeading', text: 'Nothing here yet' }),
      d.c({ type: 'TextBody', text: 'There’s nothing to show here at the moment. Please check back later or message us.' }),
      d.footer('Back', null),
    ], { emptyState: true });
  }
  if (o.restart) d.steps.push(`Taps “${d.endLabel}” to start again`);
  d.need('Publish the flow, then switch “Flows” on');

  const cta = (card.main.kind === 'order' ? (v.key === 'restaurant' ? 'Order now' : 'Shop now')
    : card.main.kind === 'booking' ? 'Book now'
      : card.main.kind === 'track' ? 'Track order'
        : (presetById(card.main.form)?.button || 'Open')).slice(0, 20);
  const msgBody = parts.length > 1
    ? 'Hi! 👋 Tap below to get started.'
    : card.main.kind === 'order'
      ? (v.key === 'restaurant' ? 'Hi! 👋 Tap below to see our menu and order.' : 'Hi! 👋 Tap below to shop with us.')
      : card.main.kind === 'booking'
        ? 'Hi! 👋 Tap below to book in a few taps.'
        : card.main.kind === 'track'
          ? 'Hi! 👋 Tap below to track your order.'
          : `Hi! 👋 Tap below to fill in the ${lower(presetById(card.main.form)?.title || 'form')} form.`;

  const flow: BuiltTemplate['flow'] = {
    name: card.title,
    categories: ['OTHER'],
    cta: parts.length > 1 ? 'Get started' : cta,
    msgBody,
    screens: d.screens,
    blocks: d.blocks,
    flowLinks: [],
    entryTarget: nodeOf(entry),
    positions: {},
  };
  // Screens in the order the customer meets them (the builder lists them so),
  // the "Nothing found" screen last.
  const reached = pathOrder(flow);
  const rank = (s: FlowScreen) => (s.emptyState ? 1e6 : (reached.indexOf(`screen_${s.id}`) + 1 || 1e5));
  flow.screens = [...flow.screens].sort((a, b) => rank(a) - rank(b));
  flow.positions = layout(flow);
  return { flow, steps: d.steps, needs: d.needs };
}

const hasLiveList = (s: FlowScreen) => s.components.some((c) => !!c.source && c.source !== 'static');

function introText(card: TemplateCard, v: VerticalConfig, o: TemplateOptions): string {
  switch (card.main.kind) {
    case 'booking':
      return `${o.categoryStep ? `Pick a ${lower(v.categoryLabel)}, then a ${lower(v.memberSingular)}` : `Pick a ${lower(v.memberSingular)}`} and a time. It takes about a minute.`;
    case 'order':
      return `Pick a ${lower(v.categoryLabel)}, then add items to your cart.`;
    case 'track':
      return 'See the latest status of your open orders.';
    default:
      return 'Answer a few quick questions and we’ll get back to you here.';
  }
}

// ---------------------------------------------------------------------------
// Map layout: columns by distance from the start, rows in the order reached
// ---------------------------------------------------------------------------
function outgoing(flow: BuiltTemplate['flow'], node: string): string[] {
  if (node.startsWith('screen_')) {
    const s = flow.screens.find((x) => `screen_${x.id}` === node);
    if (!s) return [];
    const out: string[] = [];
    for (const c of s.components) {
      for (const op of c.options || []) {
        if (op.nextScreen) out.push(`screen_${op.nextScreen}`);
        if (op.blockId) out.push(`block_${op.blockId}`);
      }
      if (c.type === 'Footer') {
        if (c.nextScreen) out.push(`screen_${c.nextScreen}`);
        if (c.blockId) out.push(`block_${c.blockId}`);
      }
    }
    return out;
  }
  const b = (flow.blocks || []).find((x) => `block_${x.id}` === node);
  if (!b) return [];
  return [b.nextTarget, ...(b.buttonTargets || []), b.validTarget, b.invalidTarget].filter(Boolean) as string[];
}

/** Nodes in the order reached from the start (breadth first), with their depth. */
function walk(flow: BuiltTemplate['flow']): { order: string[]; depth: Map<string, number>; restartId: string } {
  const depth = new Map<string, number>();
  const order: string[] = [];
  const queue: string[] = [];
  const start = flow.entryTarget || '';
  if (start) {
    depth.set(start, 0);
    queue.push(start);
  }
  // The shared Start over block goes last, not wherever it's first reached.
  const restart = (flow.blocks || []).find((b) => b.kind === 'restart');
  const restartId = restart ? `block_${restart.id}` : '';
  while (queue.length) {
    const n = queue.shift() as string;
    order.push(n);
    for (const next of outgoing(flow, n)) {
      if (depth.has(next) || next === restartId) continue;
      depth.set(next, (depth.get(n) || 0) + 1);
      queue.push(next);
    }
  }
  return { order, depth, restartId };
}
/** Nodes depth first: each menu item's whole path before the next item's. */
function pathOrder(flow: BuiltTemplate['flow']): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const visit = (n: string) => {
    if (!n || seen.has(n)) return;
    seen.add(n);
    out.push(n);
    for (const next of outgoing(flow, n)) visit(next);
  };
  visit(flow.entryTarget || '');
  return out;
}

function layout(flow: BuiltTemplate['flow']): Record<string, { x: number; y: number }> {
  const { order, depth, restartId } = walk(flow);
  const all = [...flow.screens.map((s) => `screen_${s.id}`), ...(flow.blocks || []).map((b) => `block_${b.id}`)];
  const maxDepth = Math.max(0, ...depth.values());
  const rows = new Map<number, number>();
  const pos: Record<string, { x: number; y: number }> = {};
  const place = (id: string, col: number) => {
    const row = rows.get(col) || 0;
    rows.set(col, row + 1);
    pos[id] = { x: 320 + col * 380, y: 60 + row * 340 };
  };
  for (const id of order) place(id, depth.get(id) || 0);
  // Not reached from the start (the "Nothing found" screen, the Start over block).
  for (const id of all) if (!pos[id]) place(id, id === restartId ? maxDepth + 1 : 0);
  return pos;
}

// ---------------------------------------------------------------------------
// Checks (the tests run every combination through these)
// ---------------------------------------------------------------------------
const LIMIT = { option: 30, button: 20, footer: 35, screenTitle: 30, cta: 20 };
const FIELD_LABEL: Record<string, number> = {
  TextInput: 20, TextArea: 20, Dropdown: 20, RadioButtonsGroup: 30, CheckboxGroup: 30, PhotoPicker: 30, DocumentPicker: 30, DatePicker: 40, CalendarPicker: 40, OptIn: 120,
};

/** Problems that would stop the flow working or publishing (empty = fine). */
export function checkTemplateFlow(flow: BuiltTemplate['flow']): string[] {
  const bad: string[] = [];
  const screenIds = new Set(flow.screens.map((s) => s.id));
  const blockIds = new Set((flow.blocks || []).map((b) => b.id));
  const node = (n: string) => (n.startsWith('screen_') ? screenIds.has(n.slice(7)) : n.startsWith('block_') ? blockIds.has(n.slice(6)) : false);
  if (screenIds.size !== flow.screens.length) bad.push('duplicate screen ids');
  if (!flow.screens.length) bad.push('no screens');
  if (!flow.entryTarget || !node(flow.entryTarget)) bad.push(`entry ${flow.entryTarget} missing`);
  const entryScreen = flow.screens.find((s) => `screen_${s.id}` === flow.entryTarget);
  if (!entryScreen) bad.push('the flow must start on a screen');
  else if (hasLiveList(entryScreen)) bad.push(`entry screen ${entryScreen.id} has a live list (opened without the endpoint)`);
  if (flow.screens[0] && entryScreen && flow.screens[0].id !== entryScreen.id) bad.push('entry screen is not the first screen');
  if ((flow.cta || '').length > LIMIT.cta) bad.push(`cta too long: ${flow.cta}`);
  if (flow.screens.filter((s) => s.emptyState).length > 1) bad.push('more than one empty-state screen');
  for (const s of flow.screens) {
    if (!/^[A-Z_]+$/.test(s.id)) bad.push(`screen id ${s.id}`);
    if (s.title.length > LIMIT.screenTitle) bad.push(`screen title ${s.title}`);
    const footers = s.components.filter((c) => c.type === 'Footer');
    if (footers.length !== 1) bad.push(`${s.id}: ${footers.length} footers`);
    const f = footers[0];
    if (f && (f.buttonLabel || '').length > LIMIT.footer) bad.push(`${s.id}: footer label`);
    if (f?.nextScreen && !screenIds.has(f.nextScreen)) bad.push(`${s.id}: footer → ${f.nextScreen}`);
    if (f?.blockId && !blockIds.has(f.blockId)) bad.push(`${s.id}: footer → block ${f.blockId}`);
    const terminal = !f?.nextScreen;
    const names = new Set<string>();
    for (const c of s.components) {
      if (!c.cid) bad.push(`${s.id}: component without cid`);
      if (c.name) {
        if (names.has(c.name)) bad.push(`${s.id}: field ${c.name} twice`);
        names.add(c.name);
      }
      const max = FIELD_LABEL[c.type];
      if (max && (c.label || '').length > max) bad.push(`${s.id}: label "${c.label}" over ${max}`);
      if (FINAL_SCREEN_ONLY.has(c.type) && !terminal) bad.push(`${s.id}: ${c.type} on a screen that continues`);
      for (const op of c.options || []) {
        if (op.title.length > LIMIT.option) bad.push(`${s.id}: option "${op.title}"`);
        if (op.nextScreen && !screenIds.has(op.nextScreen)) bad.push(`${s.id}: option → ${op.nextScreen}`);
        if (op.blockId && !blockIds.has(op.blockId)) bad.push(`${s.id}: option → block ${op.blockId}`);
      }
      if ((c.options || []).length > 20) bad.push(`${s.id}: more than 20 options`);
    }
  }
  for (const b of flow.blocks || []) {
    for (const t of [b.nextTarget, b.validTarget, b.invalidTarget, ...(b.buttonTargets || [])]) {
      if (t && !node(t)) bad.push(`block ${b.kind} → ${t}`);
    }
    if ((b.buttons || []).length > 3) bad.push(`block ${b.kind}: more than 3 buttons`);
    for (const t of b.buttons || []) if (t.length > LIMIT.button) bad.push(`block ${b.kind}: button "${t}"`);
    if ((b.buttons || []).length && b.kind !== 'list' && (b.buttonTargets || []).length !== (b.buttons || []).length) bad.push(`block ${b.kind}: buttons not all wired`);
    if (b.kind === 'payment' && !b.nextTarget) bad.push('payment without a Paid continuation');
  }
  for (const p of Object.values(flow.positions || {})) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.abs(p.x) > 20000 || Math.abs(p.y) > 20000) bad.push('position out of range');
  }
  try {
    buildFlowJson({ _id: 'check', ...flow } as WaFlowDef);
  } catch (e) {
    bad.push(`flow json: ${e instanceof Error ? e.message : String(e)}`);
  }
  return bad;
}
