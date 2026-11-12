// ---------------------------------------------------------------------------
// Update templates for a published flow.
//
// A flow answers the customer while they're in it, so its own replies need no
// template. What comes later does: "your booking is confirmed", "your order is
// out for delivery", "your pre-arrival check-in is confirmed". Those go out
// after the 24-hour window, so they must be Meta-approved templates.
//
// planUpdateTemplates reads what a flow does (bookings, orders, which ready-made
// forms) and proposes the templates it needs, worded for the business type,
// each with its auto-send already set (an order / booking status, or a form's
// status) and its buttons: a flow button that opens this flow again ("Book
// again", "Manage booking"), a reply button ("Talk to us"), or a call button.
// createUpdateTemplates submits the ones the business ticked to Meta as
// UTILITY templates in English.
// ---------------------------------------------------------------------------
import Template from '../models/Template.js';
import { verticalConfig } from './verticals.js';
import { assertTemplateAllowed } from './planGate.js';
import { prefillKeysOf } from './flowJson.js';
import logger from './logger.js';

const ORDER_BLOCKS = new Set(['orderconfirm', 'payment', 'paymethod', 'pdfdoc', 'catalog']);
const lower = (s) => String(s || '').charAt(0).toLowerCase() + String(s || '').slice(1);
const singular = (plural) => {
  const w = String(plural || 'Orders').toLowerCase();
  return w.endsWith('ies') ? `${w.slice(0, -3)}y` : w.replace(/s$/, '');
};

// Ready-made forms the planner writes updates for (the frontend's flowForms.ts
// presets): their title as the customer reads it, and the two updates that make
// sense for them. Forms with no follow-up (feedback, tracking) aren't listed.
const FORM_UPDATES = {
  callback: { title: 'callback request', confirmed: 'We’ll call you at the time you chose.', done: null },
  complaint: { title: 'complaint', confirmed: 'Our team is looking into it and will update you here.', done: 'It has been resolved. Thank you for your patience.' },
  patient_registration: { title: 'patient registration', confirmed: 'Your details are on file for your visit.', done: null },
  consultation_request: { title: 'consultation request', confirmed: 'A doctor will get back to you here shortly.', done: 'Your consultation is complete. Take care.' },
  upload_reports: { title: 'report upload', confirmed: 'Our team has received your reports and is reviewing them.', done: 'Your reports have been reviewed.' },
  home_sample_collection: { title: 'home sample collection', confirmed: 'Our technician will visit at the time you chose.', done: 'Your sample has been collected. We’ll share the report here.' },
  health_checkup: { title: 'health check-up enquiry', confirmed: 'We’ve noted your check-up and will share the details here.', done: null },
  service_preferences: { title: 'service preferences', confirmed: 'We’ve noted your preferences for your visit.', done: null },
  skin_allergy_check: { title: 'skin and allergy check', confirmed: 'We’ve noted your details for your visit.', done: null },
  bridal_enquiry: { title: 'bridal and event enquiry', confirmed: 'Your date is noted and our team will share the details here.', done: null },
  membership_enquiry: { title: 'membership enquiry', confirmed: 'Our team will share the plan details here.', done: null },
  health_declaration: { title: 'health declaration', confirmed: 'Your declaration is on file.', done: null },
  free_trial: { title: 'free trial', confirmed: 'Your trial is booked for the day you chose.', done: 'Thanks for trying us out. We hope to see you again.' },
  personal_training: { title: 'personal training enquiry', confirmed: 'A trainer will contact you here shortly.', done: null },
  membership_freeze: { title: 'membership freeze request', confirmed: 'Your membership has been paused as requested.', done: 'Your membership is active again.' },
  vehicle_service: { title: 'vehicle service request', confirmed: 'Your vehicle service is scheduled.', done: 'Your vehicle service is complete and it’s ready.' },
  accident_claim: { title: 'insurance claim', confirmed: 'We’ve started work on your claim and will update you here.', done: 'Your claim has been processed.' },
  test_drive: { title: 'test drive', confirmed: 'Your test drive is booked for the day you chose.', done: 'Thanks for the test drive. Let us know if you have any questions.' },
  car_valuation: { title: 'vehicle valuation request', confirmed: 'Our team will share the price for your vehicle here.', done: null },
  roadside_assistance: { title: 'roadside assistance request', confirmed: 'Help is on the way.', done: 'Glad we could help. Drive safe.' },
  client_intake: { title: 'client intake', confirmed: 'Your details are with our team and we’ll be in touch here.', done: null },
  document_collection: { title: 'document submission', confirmed: 'We’ve received your documents.', done: 'Your documents have been processed.' },
  tax_filing: { title: 'tax filing request', confirmed: 'Our team has started on your filing.', done: 'Your filing is complete.' },
  case_enquiry: { title: 'legal enquiry', confirmed: 'Our team is reviewing your matter and will update you here.', done: null },
  service_request: { title: 'service request', confirmed: 'Our professional will visit at the time you chose.', done: 'Your service is complete. Thank you.' },
  amc_enquiry: { title: 'maintenance contract enquiry', confirmed: 'Our team will share the plan and price here.', done: null },
  site_inspection: { title: 'site inspection', confirmed: 'Your inspection is scheduled for the day you chose.', done: 'The inspection is done. We’ll share the quote here.' },
  stay_enquiry: { title: 'stay enquiry', confirmed: 'Your dates are available and our team will share the details here.', done: null },
  pre_arrival: { title: 'pre-arrival check-in', confirmed: 'You’re checked in, so you can skip the desk queue on arrival.', done: null },
  airport_transfer: { title: 'airport transfer', confirmed: 'Your driver is booked for the time you gave.', done: 'Your transfer is complete. Welcome!' },
  group_booking: { title: 'group booking enquiry', confirmed: 'Our team will share the group rates here.', done: null },
  space_enquiry: { title: 'space enquiry', confirmed: 'Our team will share the available spaces here.', done: null },
  tenant_kyc: { title: 'tenant KYC', confirmed: 'Your KYC has been verified.', done: null },
  maintenance_request: { title: 'maintenance request', confirmed: 'Our team is on it.', done: 'The problem has been fixed.' },
  move_out_notice: { title: 'move-out notice', confirmed: 'Your notice is accepted.', done: 'Your move-out is complete and your refund is on its way.' },
  event_enquiry: { title: 'event enquiry', confirmed: 'Our team will share the venue and package details here.', done: null },
  guest_rsvp: { title: 'RSVP', confirmed: 'We’ve saved your place.', done: null },
  vendor_registration: { title: 'vendor registration', confirmed: 'Your registration is approved.', done: null },
  property_requirement: { title: 'property enquiry', confirmed: 'An agent will share matching properties here.', done: null },
  site_visit: { title: 'site visit', confirmed: 'Your site visit is booked for the day you chose.', done: 'Thanks for visiting. Let us know if you have any questions.' },
  list_property: { title: 'property listing', confirmed: 'Your property listing is live.', done: null },
  home_loan_help: { title: 'home loan request', confirmed: 'A loan advisor will contact you here shortly.', done: null },
  admission_enquiry: { title: 'admission enquiry', confirmed: 'A counsellor will share the details here.', done: 'Your admission is complete. Welcome aboard!' },
  demo_class: { title: 'demo class', confirmed: 'Your demo class is booked for the day you chose.', done: 'Thanks for attending the demo class.' },
  admission_documents: { title: 'admission documents', confirmed: 'We’ve received your documents.', done: 'Your documents are verified.' },
  counselling_request: { title: 'counselling request', confirmed: 'A counsellor will call you at the time you chose.', done: null },
  return_exchange: { title: 'return request', confirmed: 'Your return is approved and pickup will be arranged.', done: 'Your return is complete.' },
  bulk_order: { title: 'bulk order enquiry', confirmed: 'Our team will share a quote here.', done: null },
  warranty_claim: { title: 'warranty claim', confirmed: 'Your claim is accepted and our team will arrange the repair.', done: 'Your repair is complete.' },
  product_enquiry: { title: 'product enquiry', confirmed: 'The product is available. Reply here to order it.', done: null },
  table_reservation: { title: 'table reservation', confirmed: 'Your table is reserved for the day and time you chose.', done: 'Thanks for dining with us. We hope to see you again.' },
  party_catering: { title: 'catering enquiry', confirmed: 'Our team will share the menu and price here.', done: null },
  franchise_enquiry: { title: 'franchise enquiry', confirmed: 'Our franchise team will contact you here shortly.', done: null },
  prescription_upload: { title: 'prescription', confirmed: 'Your medicines are being packed.', done: 'Your medicines are on their way.' },
  monthly_list: { title: 'monthly list', confirmed: 'Your list is being packed.', done: 'Your monthly order is on its way.' },
  product_request: { title: 'product request', confirmed: 'The product is now in stock. Reply here to order it.', done: null },
  pickup_request: { title: 'pickup request', confirmed: 'Your pickup is scheduled for the day you chose.', done: 'Your parcel has been picked up.' },
  delivery_issue: { title: 'delivery issue report', confirmed: 'Our team is looking into it.', done: 'Your delivery issue has been resolved.' },
  rate_enquiry: { title: 'rate enquiry', confirmed: 'Our team will share the quote here.', done: null },
  business_account: { title: 'business account request', confirmed: 'Your business account is approved.', done: null },
  delivery_partner: { title: 'delivery partner application', confirmed: 'Your application is shortlisted and our team will call you.', done: null },
  loan_enquiry: { title: 'loan enquiry', confirmed: 'A loan advisor will contact you here shortly.', done: 'Your loan request has been processed.' },
  kyc_documents: { title: 'KYC', confirmed: 'Your KYC has been verified.', done: null },
  claim_intimation: { title: 'claim', confirmed: 'We’ve registered your claim and will update you here.', done: 'Your claim has been settled.' },
  insurance_quote: { title: 'insurance quote request', confirmed: 'An advisor will share your quote here.', done: null },
  account_opening: { title: 'account opening request', confirmed: 'An advisor will call you at the time you chose.', done: 'Your account is open.' },
  job_application: { title: 'job application', confirmed: 'Your application is shortlisted and our team will contact you about the next round.', done: 'Thank you for applying. We’ll keep your profile on file.' },
  resume_upload: { title: 'resume', confirmed: 'Your resume is with our hiring team.', done: null },
  interview_slot: { title: 'interview', confirmed: 'Your interview is confirmed for the day and time you chose.', done: 'Thank you for interviewing with us. We’ll share the result here.' },
  internship_application: { title: 'internship application', confirmed: 'Your application is shortlisted and our team will contact you.', done: null },
  project_enquiry: { title: 'project enquiry', confirmed: 'Our team is reviewing your project and will share the next steps here.', done: null },
  demo_request: { title: 'product demo', confirmed: 'Your demo is booked for the day and time you chose.', done: 'Thanks for joining the demo. Reply here with any questions.' },
  it_support: { title: 'support ticket', confirmed: 'Our team is working on your ticket.', done: 'Your ticket has been resolved.' },
  client_onboarding: { title: 'onboarding', confirmed: 'Your account is being set up.', done: 'Your onboarding is complete. Welcome aboard!' },
  enquiry: { title: 'enquiry', confirmed: 'Our team will get back to you here shortly.', done: null },
};

// What fills each {{n}} when a value is missing, so the sentence still reads.
const FALLBACK = {
  customer_name: 'there', member_name: 'our team', appointment_date: 'your chosen day',
  appointment_slot: 'the booked time', order_id: 'your order', order_total: 'your order',
  business_name: 'us',
};

/** What the flow does: books, takes orders, delivers, which forms, which menu items. */
export function flowFeatures(flow) {
  const comps = (flow?.screens || []).flatMap((s) => s.components || []);
  const blocks = flow?.blocks || [];
  const books = comps.some((c) => c.source === 'slots' || c.name === 'selected_slot');
  const orders = !books && blocks.some((b) => ORDER_BLOCKS.has(b.kind));
  const delivers = orders && (blocks.some((b) => b.kind === 'location') || comps.some((c) => /^(delivery_address|address|landmark)$/.test(c.name || '')));
  const forms = [...new Set(comps.map((c) => c.preset).filter((p) => p && FORM_UPDATES[p]))];
  const manage = comps.some((c) => c.source === 'appointments' || c.source === 'active_orders' || c.source === 'orders');
  return { books, orders, delivers, forms, manage };
}

// The screen a flow opens on (same rule as flowMapRuntime's resolveEntryScreenId).
const entryScreen = (flow) => (flow?.entryTarget && flow.entryTarget.startsWith('screen_')
  ? flow.entryTarget.slice(7) : flow?.screens?.[0]?.id || 'WELCOME');
// Fields the entry screen prefills ("whatsapp_number"): Meta renders that
// screen from the send's data, so each send has to carry them.
const prefill = (flow) => prefillKeysOf((flow?.screens || []).find((s) => s.id === entryScreen(flow)) || {});

/**
 * The update templates a flow needs. Each item:
 *   { key, name, title, why, bodyText, variables, buttons, trigger, preview }
 * `buttons` use our template button shape ({ type: 'FLOW' | 'QUICK_REPLY' | 'PHONE_NUMBER', text, … }).
 */
export function planUpdateTemplates(flow, business) {
  const v = verticalConfig(business?.category, business?.labels);
  const f = flowFeatures(flow);
  const one = singular(v.ordersLabel);
  // The business's own word for a status ("Completed" for a clinic, "Closed"
  // for an enquiry desk). A type with no statuses (notify) gets no status updates.
  const statusWord = new Map((v.orderStatuses || []).map((o) => [o.value, o.label]));
  const hasStatus = (s) => statusWord.has(s);
  const phone = String(business?.meta?.displayPhoneNumber || '').replace(/[^\d+]/g, '');
  const flowBtn = (text) => (flow?.metaFlowId ? [{ type: 'FLOW', text }] : []);
  const talk = [{ type: 'QUICK_REPLY', text: 'Talk to us' }];
  const call = phone ? [{ type: 'PHONE_NUMBER', text: 'Call us', phone: phone.startsWith('+') ? phone : `+${phone}` }] : talk;
  const items = [];
  const add = (key, title, why, bodyText, sources, buttons, trigger) => items.push({
    key, name: key, title, why, bodyText,
    variables: sources.map((source, i) => ({ index: i + 1, source, fallback: FALLBACK[source] || '' })),
    buttons, trigger: { enabled: true, keywords: [], statuses: [], events: [], formStatuses: [], ...trigger },
  });

  // Wording stays about this one booking or order: Meta moves "order again"
  // style text to MARKETING, which costs more and needs opt-in.
  const when = (word, status) => `When you mark ${an(word)} ${word} ${statusWord.get(status)}`;
  if (f.books && hasStatus('confirmed')) {
    const word = one === 'appointment' || one === 'booking' ? one : 'booking';
    add(`${word}_confirmed`, `${cap(word)} confirmed`, when(word, 'confirmed'),
      `Hi {{1}}, your ${word} with {{2}} on {{3}} at {{4}} is confirmed. Your reference number is {{5}}. Please reply here if you need to change anything.`,
      ['customer_name', 'member_name', 'appointment_date', 'appointment_slot', 'order_id'],
      f.manage && flow?.metaFlowId ? flowBtn(`Manage ${word}`) : talk, { statuses: ['confirmed'] });
    if (hasStatus('delivered')) {
      add(`${word}_completed`, `${cap(word)} completed`, when(word, 'delivered'),
        `Hi {{1}}, your ${word} with {{2}} is complete. Thank you for visiting. If you need a follow-up, tap below to book it.`,
        ['customer_name', 'member_name'], flowBtn('Book follow-up'), { statuses: ['delivered'] });
    }
    if (hasStatus('cancelled')) {
      add(`${word}_cancelled`, `${cap(word)} cancelled`, when(word, 'cancelled'),
        `Hi {{1}}, your ${word} on {{2}} at {{3}} has been cancelled. Your reference number was {{4}}. Tap below to pick a new time.`,
        ['customer_name', 'appointment_date', 'appointment_slot', 'order_id'], flow?.metaFlowId ? flowBtn('Pick a new time') : talk, { statuses: ['cancelled'] });
    }
  }
  if (f.orders && hasStatus('confirmed')) {
    add('order_confirmed', 'Order confirmed', when('order', 'confirmed'),
      'Hi {{1}}, your order {{2}} for {{3}} is confirmed. We’ll message you here as soon as it’s on its way.',
      ['customer_name', 'order_id', 'order_total'], talk, { statuses: ['confirmed'] });
    if (v.key === 'restaurant' && hasStatus('preparing')) {
      add('order_preparing', 'Order being prepared', when('order', 'preparing'),
        'Hi {{1}}, our kitchen has started on your order {{2}}. We’ll let you know the moment it leaves.',
        ['customer_name', 'order_id'], [], { statuses: ['preparing'] });
    }
    if (f.delivers && hasStatus('out_for_delivery')) {
      add('order_out_for_delivery', 'Out for delivery', when('order', 'out_for_delivery'),
        'Hi {{1}}, your order {{2}} is out for delivery and will reach you soon. Please keep your phone nearby.',
        ['customer_name', 'order_id'], call, { statuses: ['out_for_delivery'] });
    }
    if (hasStatus('delivered')) {
      add('order_delivered', `Order ${lower(statusWord.get('delivered'))}`, when('order', 'delivered'),
        `Hi {{1}}, your order {{2}} ${statusWord.get('delivered') === 'Delivered' ? 'has been delivered' : `is ${lower(statusWord.get('delivered'))}`}. If anything is missing or not right, reply here and we’ll sort it out.`,
        ['customer_name', 'order_id'], talk, { statuses: ['delivered'] });
    }
    if (hasStatus('cancelled')) {
      add('order_cancelled', 'Order cancelled', when('order', 'cancelled'),
        'Hi {{1}}, your order {{2}} has been cancelled. If you’ve already paid, your refund is on its way.',
        ['customer_name', 'order_id'], talk, { statuses: ['cancelled'] });
    }
  }
  for (const id of f.forms) {
    const u = FORM_UPDATES[id];
    add(`${id}_confirmed`, `${cap(u.title)} confirmed`, `When you mark ${an(u.title)} ${u.title} Confirmed on its page`,
      `Hi {{1}}, your ${u.title} is confirmed. ${u.confirmed} Reply here if you have any questions.`,
      ['customer_name'], talk, { formStatuses: [`${id}:confirmed`] });
    if (u.done) {
      add(`${id}_done`, `${cap(u.title)} done`, `When you mark ${an(u.title)} ${u.title} Done on its page`,
        `Hi {{1}}, an update on your ${u.title}: ${lower(u.done)} Reply here if you need anything else.`,
        ['customer_name'], [], { formStatuses: [`${id}:done`] });
    }
  }
  const SAMPLE = { customer_name: 'Riya', member_name: v.memberExample || 'our team', appointment_date: '18 Oct 2026', appointment_slot: '10:30 am', order_id: 'ORD-1042', order_total: '₹500', business_name: business?.name || 'us' };
  for (const it of items) {
    it.preview = it.bodyText.replace(/\{\{(\d+)\}\}/g, (_, n) => SAMPLE[it.variables[Number(n) - 1]?.source] || 'Sample');
  }
  return { items, entryScreen: entryScreen(flow), published: !!flow?.metaFlowId && flow?.status === 'PUBLISHED' };
}

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function an(word) { return /^[aeiou]/i.test(word) ? 'an' : 'a'; }

/** Our button shape → Meta's (a flow button opens this flow at its entry screen). */
function metaButtons(buttons, flow) {
  return buttons.map((b) => {
    if (b.type === 'FLOW') return { type: 'FLOW', text: b.text, flow_id: flow.metaFlowId, flow_action: 'navigate', navigate_screen: entryScreen(flow) };
    if (b.type === 'PHONE_NUMBER') return { type: 'PHONE_NUMBER', text: b.text, phone_number: b.phone };
    return { type: 'QUICK_REPLY', text: b.text };
  });
}

/**
 * Submit the chosen update templates to Meta (UTILITY, English) and save them
 * with their auto-send on. A name already used here is skipped; a name Meta
 * still holds (deleted lately) gets a suffix.
 * @returns [{ key, name, ok, status?, skipped?, error? }]
 */
export async function createUpdateTemplates(meta, business, flow, keys = []) {
  const { items } = planUpdateTemplates(flow, business);
  const wanted = items.filter((it) => keys.includes(it.key));
  const out = [];
  for (const it of wanted) {
    // eslint-disable-next-line no-await-in-loop
    const exists = await Template.findOne({ businessId: business._id, name: it.name }).select('_id').lean();
    if (exists) { out.push({ key: it.key, name: it.name, ok: true, skipped: true }); continue; }
    try {
      // eslint-disable-next-line no-await-in-loop
      await assertTemplateAllowed(business, { name: it.name, category: 'UTILITY', kind: 'standard' });
    } catch (e) {
      out.push({ key: it.key, name: it.name, ok: false, error: e.message || 'Your plan’s template limit is reached.' });
      continue;
    }
    const examples = it.variables.map((x) => ({ customer_name: 'Riya', member_name: 'Dr. Rao', appointment_date: '18 Oct 2026', appointment_slot: '10:30 am', order_id: 'ORD-1042', order_total: '₹500' }[x.source] || 'Sample'));
    const buttons = metaButtons(it.buttons, flow);
    const components = [
      { type: 'BODY', text: it.bodyText, ...(examples.length ? { example: { body_text: [examples] } } : {}) },
      ...(buttons.length ? [{ type: 'BUTTONS', buttons }] : []),
    ];
    let name = it.name;
    let created = null;
    let error = '';
    for (let attempt = 0; attempt < 3 && !created; attempt += 1) {
      try {
        // eslint-disable-next-line no-await-in-loop
        created = await meta.createTemplate({ name, language: 'en_US', category: 'UTILITY', components });
      } catch (e) {
        const m = e.response?.data?.error;
        error = m?.error_user_msg || m?.message || e.message;
        // Meta keeps a deleted template's name for a while: try another.
        if (/already exists|same name|being deleted/i.test(error)) { name = `${it.name}_${attempt + 2}`; continue; }
        break;
      }
    }
    if (!created) {
      logger.warn('update template not created', { business: business.name, template: it.name, error });
      out.push({ key: it.key, name, ok: false, error });
      continue;
    }
    const flowIndex = it.buttons.findIndex((b) => b.type === 'FLOW');
    // eslint-disable-next-line no-await-in-loop
    await Template.findOneAndUpdate(
      { businessId: business._id, name },
      {
        $set: {
          businessId: business._id, name, metaId: created.id || '', language: 'en_US', category: 'UTILITY', kind: 'standard',
          status: created.status || 'PENDING', rejectedReason: '', headerText: '', headerMediaUrl: '', headerFormat: '', headerFileName: '',
          bodyText: it.bodyText, footerText: '', components, cards: [], variables: it.variables, trigger: it.trigger,
          // The flow its flow button opens: each send carries a fresh flow token.
          flowButton: flowIndex >= 0 ? { index: flowIndex, flowId: String(flow._id), prefill: prefill(flow) } : null,
        },
      },
      { upsert: true },
    );
    out.push({ key: it.key, name, ok: true, status: created.status || 'PENDING' });
  }
  logger.info('update templates submitted', { business: business.name, flow: flow.name, created: out.filter((r) => r.ok && !r.skipped).length, failed: out.filter((r) => !r.ok).length });
  return out;
}

export default { planUpdateTemplates, createUpdateTemplates, flowFeatures };
