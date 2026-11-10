// Hyka AI's own language matcher. No outside AI service is called: a message is
// cut into words, filler words are dropped, and the words are matched against
// phrase lists ("pay online", "my orders", "site visit"…). Matching allows
// typing mistakes ("dioctors", "catelog", "appoinment"), plural forms and a
// little Hinglish ("haan", "nahi"). Longer phrases win over shorter ones, so
// "my orders" means the My orders menu item and not "take orders".

/** Words that carry no meaning for building a flow. */
const STOP = new Set([
  'a', 'an', 'the', 'to', 'for', 'of', 'and', 'or', 'with', 'is', 'are', 'am', 'be', 'been', 'will', 'can', 'could',
  'should', 'would', 'shall', 'i', 'we', 'me', 'us', 'our', 'ours', 'it', 'its', 'this', 'that', 'these', 'those',
  'in', 'on', 'at', 'by', 'from', 'into', 'please', 'pls', 'plz', 'so', 'then', 'also', 'just', 'only', 'want',
  'wants', 'wanted', 'need', 'needs', 'needed', 'like', 'customer', 'customers', 'client', 'clients', 'patient',
  'patients', 'guest', 'guests', 'user', 'users', 'people', 'they', 'them', 'their', 'he', 'she', 'you', 'your',
  'whatsapp', 'flow', 'flows', 'able', 'let', 'lets', 'allow', 'have', 'has', 'get', 'gets', 'make', 'create',
  'build', 'do', 'does', 'there', 'here', 'some', 'very', 'really', 'kindly', 'thing', 'things',
  'aur', 'ka', 'ki', 'ke', 'se', 'ko', 'hai', 'hain', 'chahiye', 'karna', 'karo', 'kare', 'karein', 'mujhe', 'hum',
  'mera', 'meri', 'apna', 'apni', 'bhi', 'toh', 'eg', 'etc',
]);

/** "Book an appointment!" → ["book", "appointment"]. */
export function words(text: string): string[] {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’'`]/g, '')
    .replace(/[^a-z0-9₹+]+/g, ' ')
    .split(' ')
    .filter((w) => w && !STOP.has(w));
}

const stem = (w: string) => {
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
};

/** Edit distance with swapped neighbours counted once ("aopintment"). */
export function distance(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 2) return 3;
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) => [i, ...new Array(n).fill(0)]);
  for (let j = 0; j <= n; j += 1) d[0][j] = j;
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[m][n];
}

/** Is the typed word `t` the phrase word `p`, allowing a typing mistake? */
export function sameWord(t: string, p: string): boolean {
  if (t === p) return true;
  const a = stem(t);
  const b = stem(p);
  if (a === b) return true;
  // Short words must be exact: "no" isn't "to", "cod" isn't "cold".
  if (b.length < 4 || a.length < 3) return false;
  // A typo rarely hits the first letter, and allowing it matched "form" to "from".
  if (a[0] !== b[0]) return false;
  return distance(a, b) <= (b.length >= 7 ? 2 : 1);
}

export interface Phrase {
  concept: string;
  words: string[];
  weight: number;
}
export interface Hit {
  concept: string;
  weight: number;
  /** Index of the first matched word. */
  at: number;
}

/** Phrase lists → matchable phrases, longest first. */
export function phrases(table: Record<string, string[]>, weak: Set<string> = new Set()): Phrase[] {
  const out: Phrase[] = [];
  for (const [concept, list] of Object.entries(table)) {
    for (const p of list) {
      const w = words(p);
      if (!w.length) continue;
      out.push({ concept, words: w, weight: w.length === 1 && weak.has(w[0]) ? 0.6 : w.length });
    }
  }
  return out.sort((x, y) => y.words.length - x.words.length || y.weight - x.weight);
}

/** Every phrase found in the text; a word is used by one phrase at most. */
export function find(text: string, list: Phrase[]): Hit[] {
  const t = words(text);
  const used = new Array(t.length).fill(false);
  const hits: Hit[] = [];
  for (const p of list) {
    const n = p.words.length;
    for (let i = 0; i + n <= t.length; i += 1) {
      let ok = true;
      for (let j = 0; j < n && ok; j += 1) ok = !used[i + j] && sameWord(t[i + j], p.words[j]);
      if (!ok) continue;
      for (let j = 0; j < n; j += 1) used[i + j] = true;
      hits.push({ concept: p.concept, weight: p.weight, at: i });
    }
  }
  return hits.sort((a, b) => a.at - b.at);
}

export const scoreOf = (hits: Hit[], concept: string) => hits.filter((h) => h.concept === concept).reduce((s, h) => s + h.weight, 0);
export const hasHit = (hits: Hit[], concept: string) => hits.some((h) => h.concept === concept);

// ---------------------------------------------------------------------------
// What the words mean
// ---------------------------------------------------------------------------
export const YES_NO: Record<string, string[]> = {
  no: [
    'no', 'n', 'nope', 'nah', 'nahi', 'nahin', 'na', 'nai', 'skip', 'dont', 'do not', 'not', 'no need', 'not required',
    'without', 'none', 'never', 'remove', 'leave it', 'leave', 'nothing', 'off', 'disable', 'mat', 'nko', 'vaddu',
  ],
  yes: [
    'yes', 'y', 'yeah', 'yep', 'yup', 'yes please', 'sure', 'ok', 'okay', 'k', 'haan', 'han', 'ha', 'haa', 'ji', 'hanji',
    'of course', 'ofcourse', 'correct', 'right', 'go ahead', 'do it', 'add', 'include', 'fine', 'good', 'great', 'perfect',
    'agree', 'on', 'enable', 'definitely', 'absolutely', 'sounds good', 'avunu', 'aamam',
  ],
};

export const COMMANDS: Record<string, string[]> = {
  reset: ['start over', 'reset', 'begin again', 'from beginning', 'from scratch', 'new flow', 'something else', 'change everything'],
  back: ['back', 'go back', 'previous', 'undo'],
  help: ['help', 'explain', 'what mean', 'dont understand', 'confused', 'samajh nahi'],
  done: ['done', 'finish', 'finished', 'thats all', 'nothing else', 'no more', 'enough', 'complete', 'next', 'continue', 'proceed', 'bas'],
  recommended: ['recommended', 'default', 'you decide', 'you choose', 'whatever', 'anything', 'best', 'suggest', 'your choice', 'same'],
  publish: ['publish', 'go live', 'make live', 'launch', 'live'],
};

/** Payment, confirmation, how an order reaches the customer, the address. */
export const SETTINGS: Record<string, string[]> = {
  'pay:both': [
    'both', 'either', 'customer chooses', 'customer choose', 'they choose', 'choose', 'online or cash', 'cash or online',
    'online and cash', 'cash and online', 'online or later', 'any payment', 'all payment', 'both payment',
  ],
  'pay:none': ['free', 'no payment', 'without payment', 'no pay', 'not paid', 'no charge', 'free of cost', 'no fee', 'free consultation', 'no money'],
  'pay:online': [
    'online', 'upi', 'gpay', 'google pay', 'phonepe', 'paytm', 'card', 'credit card', 'debit card', 'prepaid', 'pay first',
    'advance', 'whatsapp pay', 'pay online', 'net banking', 'netbanking', 'razorpay', 'digital payment', 'online payment', 'pay now',
  ],
  'pay:cash': [
    'cash', 'cod', 'cash on delivery', 'pay later', 'later', 'counter', 'pay counter', 'pay visit', 'arrival', 'pay arrival',
    'offline', 'pay hospital', 'pay clinic', 'pay shop', 'pay store', 'pay salon', 'pay gym', 'pay centre', 'pay center',
    'pay hotel', 'pay table', 'after visit', 'after service', 'pay meeting', 'postpaid', 'pay delivery', 'pay rider',
  ],
  'confirm:pdf': ['pdf', 'slip', 'invoice', 'bill', 'receipt', 'pdf slip', 'pdf bill', 'pdf invoice', 'ticket'],
  'confirm:message': ['message', 'msg', 'text message', 'plain message', 'simple message', 'just message', 'normal message', 'no pdf'],
  'mode:delivery': ['delivery', 'deliver', 'home delivery', 'door delivery', 'doorstep', 'ship', 'shipping', 'courier', 'deliver home'],
  'mode:takeaway': ['takeaway', 'take away', 'pickup', 'pick up', 'self pickup', 'store pickup', 'collect', 'parcel', 'carry out'],
  'mode:dinein': ['dine in', 'dinein', 'dine', 'table order', 'eat here', 'table number', 'order table'],
  'address:pin': ['share location', 'location pin', 'send location', 'live location', 'current location', 'pin', 'gps', 'map pin'],
  'address:typed': ['type address', 'typed address', 'write address', 'written address', 'enter address', 'full address', 'address text', 'manual address', 'typed', 'type'],
  'time:yes': ['delivery time', 'time slot', 'pickup time', 'delivery slot', 'choose time', 'pick time', 'schedule delivery', 'slot time'],
};

/** The extra menu items. */
export const EXTRAS: Record<string, string[]> = {
  my_list: [
    'my orders', 'my order', 'order history', 'past orders', 'previous orders', 'old orders', 'see orders', 'view orders',
    'my appointments', 'my appointment', 'my bookings', 'my booking', 'booking history', 'appointment history', 'history',
    'my sessions', 'my visits',
  ],
  track: ['track', 'tracking', 'track order', 'track my order', 'order status', 'where my order', 'status'],
  cancel: ['cancel', 'cancellation', 'cancel order', 'cancel booking', 'cancel appointment', 'cancel orders'],
  reschedule: ['reschedule', 're schedule', 'change date', 'change dates', 'change time', 'postpone', 'move appointment', 'change booking', 'rebook'],
  location: ['location', 'our location', 'map', 'maps', 'google map', 'google maps', 'directions', 'direction', 'route', 'find us', 'where are', 'address shop', 'shop address', 'store location'],
  call: ['call', 'call us', 'call button', 'phone', 'phone number', 'contact number', 'contact', 'talk', 'dial', 'mobile number'],
  brochure: ['brochure', 'brouchure', 'broucher', 'prospectus', 'pdf brochure', 'price list', 'pricelist', 'e brochure', 'catalogue pdf'],
  website: ['website', 'web site', 'webpage', 'web page', 'www', 'site link', 'our site', 'web link'],
};

/** Words for each ready-made form, beyond its title. */
export const FORM_WORDS: Record<string, string[]> = {
  feedback: ['feedback', 'review', 'reviews', 'rating', 'ratings', 'rate us', 'experience', 'suggestion', 'suggestions'],
  callback: ['callback', 'call back', 'call me back', 'request call', 'callback request', 'advisor call', 'call from advisor'],
  complaint: ['complaint', 'complaints', 'complain', 'support', 'grievance', 'help desk', 'support ticket', 'raise issue'],
  patient_registration: ['patient registration', 'register patient', 'registration', 'new patient', 'register'],
  consultation_request: ['consultation request', 'consultation form', 'ask doctor', 'symptoms', 'online consultation', 'video consultation', 'doctor advice'],
  upload_reports: ['upload reports', 'upload report', 'reports', 'report', 'lab report', 'test report', 'scan', 'x ray', 'xray', 'upload'],
  service_preferences: ['service preferences', 'preferences', 'preference', 'hair type'],
  skin_allergy_check: ['allergy', 'allergies', 'skin check', 'patch test', 'sensitive skin', 'skin'],
  membership_enquiry: ['membership', 'membership enquiry', 'membership plan', 'join gym', 'gym plan', 'plans'],
  health_declaration: ['health declaration', 'declaration', 'medical history', 'health form', 'fitness declaration', 'health'],
  free_trial: ['free trial', 'trial', 'trial session', 'demo session'],
  vehicle_service: ['vehicle service', 'car service', 'bike service', 'servicing', 'service request', 'repair'],
  accident_claim: ['accident', 'insurance claim', 'claim', 'damage', 'accident claim'],
  client_intake: ['client intake', 'intake', 'new client', 'onboarding', 'onboard'],
  document_collection: ['document collection', 'documents', 'document', 'share documents', 'upload documents', 'papers', 'files'],
  service_request: ['service request', 'repair request', 'plumber', 'electrician', 'technician', 'home service'],
  stay_enquiry: ['stay enquiry', 'stay', 'room enquiry', 'availability', 'room availability'],
  pre_arrival: ['pre arrival', 'check in', 'checkin', 'web check in', 'id upload', 'online check in'],
  space_enquiry: ['space enquiry', 'space', 'pg', 'hostel', 'coworking', 'co working', 'desk', 'cabin'],
  tenant_kyc: ['tenant kyc', 'kyc', 'tenant verification', 'tenant', 'police verification'],
  event_enquiry: ['event enquiry', 'event', 'events', 'wedding', 'function', 'banquet', 'venue enquiry'],
  property_requirement: [
    'property enquiry', 'property requirement', 'requirement', 'property', 'properties', 'flat', 'flats', 'apartment',
    'house', 'villa', 'plot', 'bhk', 'buy', 'rent', 'looking for', 'enquiry',
  ],
  site_visit: ['site visit', 'visit site', 'property visit', 'see property', 'site', 'visit', 'site seeing'],
  list_property: ['list my property', 'list property', 'listing', 'sell my', 'sell property', 'owner', 'post property', 'list'],
  admission_enquiry: ['admission enquiry', 'admission', 'admissions', 'enrol', 'enroll', 'join course', 'course enquiry', 'enquiry'],
  demo_class: ['demo class', 'demo', 'trial class', 'free class'],
  admission_documents: ['admission documents', 'documents', 'marksheet', 'certificates', 'document'],
  return_exchange: ['return', 'returns', 'exchange', 'refund', 'replacement'],
  bulk_order: ['bulk order', 'bulk', 'wholesale', 'b2b', 'large quantity'],
  table_reservation: ['table reservation', 'reserve table', 'book table', 'table booking', 'reservation', 'reserve', 'table'],
  party_catering: ['party', 'catering', 'caterer', 'party order', 'bulk food', 'party catering'],
  prescription_upload: ['prescription', 'upload prescription', 'medicine', 'medicines', 'rx'],
  monthly_list: ['monthly list', 'monthly', 'grocery list', 'list'],
  pickup_request: ['pickup request', 'book pickup', 'collect parcel', 'send parcel', 'pickup', 'pick up'],
  delivery_issue: ['delivery issue', 'damaged', 'late delivery', 'not delivered', 'issue', 'problem'],
  track_shipment: ['track shipment', 'shipment status', 'awb', 'track', 'tracking'],
  rate_enquiry: ['rate enquiry', 'rate', 'rates', 'quote', 'quotation', 'price', 'pricing', 'charges'],
  loan_enquiry: ['loan enquiry', 'loan', 'loans', 'emi', 'eligibility', 'credit'],
  kyc_documents: ['kyc documents', 'kyc', 'id proof', 'address proof', 'verification'],
  claim_intimation: ['claim intimation', 'claim', 'insurance claim', 'intimation'],
  enquiry: ['enquiry', 'inquiry', 'enquiry form', 'question', 'contact form', 'lead', 'leads'],
};

/** Single words that mean several things: they only count with others. */
export const WEAK = new Set([
  'table', 'list', 'issue', 'problem', 'visit', 'site', 'register', 'document', 'documents', 'track', 'tracking', 'claim',
  'rate', 'price', 'event', 'space', 'trial', 'demo', 'stay', 'upload', 'report', 'buy', 'rent', 'health', 'skin',
  'plans', 'desk', 'owner', 'enquiry', 'support', 'contact', 'phone', 'talk', 'status', 'history', 'map', 'route',
  'reserve', 'credit', 'question', 'lead', 'repair', 'monthly', 'pickup', 'collect', 'parcel', 'damage', 'scan',
]);

/** Order / book / track / full-menu words. */
export const MAINS: Record<string, string[]> = {
  full: [
    'full menu', 'full', 'everything', 'all in one', 'all options', 'all features', 'complete menu', 'main menu',
    'all services', 'whole menu', 'every option', 'menu with everything', 'full flow', 'complete flow',
  ],
  'main:order': [
    'order', 'orders', 'ordering', 'buy', 'purchase', 'shop', 'shopping', 'cart', 'sell', 'selling', 'catalog', 'catalogue',
    'products', 'product', 'food', 'food order', 'place order', 'online store', 'store', 'groceries', 'grocery', 'checkout',
    'menu', 'items', 'dishes', 'medicine order',
  ],
  'main:booking': [
    'book', 'booking', 'bookings', 'appointment', 'appointments', 'appoinment', 'apointment', 'slot', 'slots', 'schedule',
    'reserve', 'reservation', 'session', 'sessions', 'consultation', 'consult', 'time slot', 'room booking', 'book room',
    'book doctor', 'doctor appointment', 'book visit', 'meeting', 'book service',
  ],
};
