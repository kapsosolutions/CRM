// Convert a stored Flow definition into Meta WhatsApp Flow JSON (v6.3).
// Mirrors frontend/src/crm/flowJson.ts. Supports client mode (navigate/complete)
// and endpoint mode (data_exchange) for per-option branching and dynamic lists
// (categories with 1:1 images), plus PhotoPicker / DocumentPicker uploads.
const FLOW_VERSION = '6.3';

const STRING_FIELDS = new Set(['RadioButtonsGroup', 'CheckboxGroup', 'Dropdown', 'TextInput', 'TextArea', 'DatePicker']);
// Answers that aren't plain strings (files, a date range, a tick box) are only
// sent from the screen that completes the flow: a later screen's data can only
// declare strings, so they can't be passed along from an earlier one.
const FINAL_SCREEN_ONLY = new Set(['PhotoPicker', 'DocumentPicker', 'CalendarPicker', 'OptIn']);
const ALL_FIELDS = new Set([...STRING_FIELDS, ...FINAL_SCREEN_ONLY]);
const SELECTION = new Set(['RadioButtonsGroup', 'CheckboxGroup', 'Dropdown']);

function toBase64(src) {
  if (!src) return '';
  if (src.startsWith('data:')) return src.replace(/^data:[^;]+;base64,/, '');
  return src;
}

function branchField(s) {
  return (s.components || []).find((c) => SELECTION.has(c.type) && (c.options || []).some((o) => o.nextScreen));
}
const isDynamic = (c) => !!c.source && c.source !== 'static';
function dynamicSourcesOf(s) {
  return [...new Set((s.components || []).filter(isDynamic).map((c) => c.source))];
}
export function isEndpointMode(flow) {
  // Prefilled fields also need the endpoint: it supplies the value (e.g. the
  // sender's WhatsApp number) for whichever screen the customer reaches.
  return (flow.screens || []).some(
    (s) => !!branchField(s) || dynamicSourcesOf(s).length > 0 || (s.components || []).some((c) => c.prefill),
  );
}

const CATEGORIES_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      title: { type: 'string' },
      description: { type: 'string' },
      image: { type: 'string' },
    },
    required: ['id', 'title'],
  },
  __example__: [{ id: 'cat_1', title: 'Starters', description: 'Begin your meal', image: '' }],
};
const ORDERS_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: { id: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' } },
    required: ['id', 'title'],
  },
  __example__: [{ id: 'ord_1042', title: 'ORD-1042 — ₹500', description: 'Out for delivery' }],
};
const MEMBERS_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      title: { type: 'string' },
      description: { type: 'string' },
      image: { type: 'string' },
    },
    required: ['id', 'title'],
  },
  __example__: [{ id: 'mem_1', title: 'Dr. Asha Rao', description: 'Cardiologist', image: '' }],
};
const ACTIVE_ORDERS_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: { id: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' } },
    required: ['id', 'title'],
  },
  __example__: [{ id: 'ord_1', title: 'DVN-B2C-1AA1F8 - Rs.189', description: 'Confirmed - 15/8/2026' }],
};
const SLOTS_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: { id: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' } },
    required: ['id', 'title'],
  },
  __example__: [{ id: 'slot_10:00', title: '10:00 am', description: '' }],
};
const APPOINTMENTS_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: { id: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' } },
    required: ['id', 'title'],
  },
  __example__: [{ id: 'appt_1', title: 'Dr. Asha Rao · 10:30 am', description: '18 Oct 2026' }],
};
const DYNAMIC_SCHEMAS = {
  categories: CATEGORIES_SCHEMA,
  members: MEMBERS_SCHEMA,
  orders: ORDERS_SCHEMA,
  active_orders: ACTIVE_ORDERS_SCHEMA,
  slots: SLOTS_SCHEMA,
  appointments: APPOINTMENTS_SCHEMA,
};

// A component's `prefill` source → the data key the runtime supplies.
export const PREFILL_KEYS = { phone: 'whatsapp_number' };
// Data keys a screen needs because one of its components is prefilled.
export function prefillKeysOf(s) {
  return [...new Set((s.components || []).filter((c) => c.prefill).map((c) => PREFILL_KEYS[c.prefill] || c.prefill))];
}

/** 'YYYY-MM-DD' (local zone) for a Date — the format Meta's DatePicker bounds
 * must be in. Meta rejects a publish with "The date field must be in the format
 * YYYY-MM-DD" for anything else (e.g. an epoch-millisecond string). */
function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Today as 'YYYY-MM-DD' (local zone). */
function todayISO() {
  return isoDate(new Date());
}

/** 'YYYY-MM-DD' for a day `days` from today (local zone). */
function daysAheadISO(days) {
  const d = new Date();
  d.setDate(d.getDate() + Number(days || 0));
  return isoDate(d);
}

// How far ahead a date may be picked when the component doesn't say. An
// appointment calendar that let a patient book two years out is as wrong as one
// that let them book last week — so a sensible booking horizon is the default.
export const MAX_DAYS_AHEAD_DEFAULT = 60;
export const maxDaysAheadOf = (c) =>
  Number(c?.maxDaysAhead) > 0 ? Number(c.maxDaysAhead) : MAX_DAYS_AHEAD_DEFAULT;
// A DatePicker asking for a date in the PAST (an incident, a birthday): this
// many days back up to today. 0 = the usual upcoming-date picker.
const pastDaysOf = (c) => (Number(c?.pastDays) > 0 ? Math.min(Number(c.pastDays), 36500) : 0);

// A text with a dynamic token embedded in a larger string ("Available times on
// ${data.x}") is NOT interpolated by the Flow client — the whole string renders
// literally. Only a standalone `${data.key}` works. So any text carrying a
// token is published as a single standalone reference and the runtime supplies
// that key already composed. These two helpers are shared with the runtime so
// both sides agree on the synthetic key.
const TEXT_TOKEN_RE = /\$\{data\.[a-zA-Z0-9_]+\}/;
export const textHasToken = (t) => TEXT_TOKEN_RE.test(t || '');
export const dynamicTextKey = (screenId, index) =>
  `txt_${String(screenId).replace(/[^a-zA-Z0-9_]/g, '_')}_${index}`;

const TEXT_TYPES = new Set(['TextHeading', 'TextSubheading', 'TextBody', 'TextCaption']);

function componentToJson(c, opts = {}) {
  if (TEXT_TYPES.has(c.type)) {
    // Standalone synthetic token when the authored text embeds any ${data.*};
    // otherwise the literal text as-is.
    const text = textHasToken(c.text)
      ? `\${data.${dynamicTextKey(opts.screenId, opts.index)}}`
      : (c.text || '');
    return { type: c.type, text };
  }
  switch (c.type) {
    case 'Image':
      // 8:1 banner. Display size 1000×125 (matches the welcome-flow spec); the
      // embedded source is larger (1920×240) for crispness.
      return { type: 'Image', src: toBase64(c.src || ''), width: 1000, height: 125, 'scale-type': 'cover', 'alt-text': 'banner' };
    case 'RadioButtonsGroup':
    case 'CheckboxGroup': {
      return {
        type: c.type,
        name: c.name || 'field',
        label: c.label || '',
        required: !!c.required,
        'data-source': isDynamic(c)
          ? `\${data.${c.source}}`
          : (c.options || []).map((o) => ({
              id: o.id,
              title: o.title,
              ...(o.description ? { description: o.description } : {}),
              ...(o.image ? { image: toBase64(o.image) } : {}),
            })),
      };
    }
    case 'Dropdown': {
      return {
        type: 'Dropdown',
        name: c.name || 'field',
        label: c.label || '',
        required: !!c.required,
        // Carry the option's 1:1 logo (and description) through, the same as a
        // radio list — a Dropdown shows the image beside each row too. These
        // were being dropped, which is why uploaded option images never
        // appeared in the list.
        'data-source': isDynamic(c)
          ? `\${data.${c.source}}`
          : (c.options || []).map((o) => ({
              id: o.id,
              title: o.title,
              ...(o.description ? { description: o.description } : {}),
              ...(o.image ? { image: toBase64(o.image) } : {}),
            })),
      };
    }
    case 'TextInput':
      return {
        type: 'TextInput',
        name: c.name || 'field',
        label: c.label || '',
        required: !!c.required,
        'input-type': c.inputType || 'text',
        ...(c.helperText ? { 'helper-text': c.helperText } : {}),
        // Prefilled from runtime data (e.g. the sender's WhatsApp number) and
        // optionally locked so the customer can't edit it.
        ...(c.prefill ? { 'init-value': `\${data.${PREFILL_KEYS[c.prefill] || c.prefill}}` } : {}),
        ...(c.locked ? { enabled: false } : {}),
      };
    case 'TextArea':
      return { type: 'TextArea', name: c.name || 'field', label: c.label || '', required: !!c.required };
    case 'DatePicker': {
      const past = pastDaysOf(c);
      if (past) {
        return {
          type: 'DatePicker',
          name: c.name || 'field',
          label: c.label || '',
          required: !!c.required,
          ...(c.helperText ? { 'helper-text': c.helperText } : {}),
          'min-date': daysAheadISO(-past),
          'max-date': todayISO(),
        };
      }
      const days = maxDaysAheadOf(c);
      return {
        type: 'DatePicker',
        name: c.name || 'field',
        label: c.label || '',
        required: !!c.required,
        // A visible hint of the allowed window, so the customer knows why the
        // greyed-out days are greyed out. Respects an explicitly set helper.
        'helper-text': c.helperText || `Pick a date within the next ${days} days`,
        // Block past ("already completed") dates AND dates too far out: the
        // calendar greys out anything before today or after the booking
        // horizon, so the customer can't pick one and Continue won't advance.
        //
        // Both bounds are STATIC 'YYYY-MM-DD' values baked in at publish — a
        // DatePicker does NOT honour a dynamic `${data.min_date}` binding (both
        // the Flow preview tool and the WhatsApp client ignore it, leaving the
        // field unconstrained), and Meta's publish validator requires the
        // literal to be a YYYY-MM-DD date, not an epoch-millisecond string.
        // Republishing refreshes them; a flow left unpublished for weeks drifts
        // by that many days, the accepted trade for bounds that actually apply.
        'min-date': todayISO(),
        'max-date': daysAheadISO(days),
        // Grey out the days the chosen doctor doesn't work. This one IS honoured
        // dynamically (unlike min/max): the endpoint computes the off-days for
        // whoever was picked on the previous screen and supplies them per load.
        // Only in endpoint mode, where there's an endpoint to supply them.
        ...(opts.endpoint ? { 'unavailable-dates': '${data.unavailable_dates}' } : {}),
      };
    }
    case 'PhotoPicker':
      return {
        type: 'PhotoPicker',
        name: c.name || 'photo',
        label: c.label || 'Upload photo',
        ...(c.description ? { description: c.description } : {}),
        'photo-source': c.photoSource || 'camera_gallery',
        'min-uploaded-photos': c.required ? 1 : 0,
        'max-uploaded-photos': c.maxFiles || 1,
      };
    case 'DocumentPicker':
      return {
        type: 'DocumentPicker',
        name: c.name || 'document',
        label: c.label || 'Upload document',
        ...(c.description ? { description: c.description } : {}),
        'min-uploaded-documents': c.required ? 1 : 0,
        'max-uploaded-documents': c.maxFiles || 1,
      };
    case 'CalendarPicker': {
      // A check-in → check-out style range on WhatsApp's full calendar.
      const days = maxDaysAheadOf(c);
      return {
        type: 'CalendarPicker',
        name: c.name || 'dates',
        mode: 'range',
        label: { 'start-date': c.label || 'Start date', 'end-date': c.endLabel || 'End date' },
        required: { 'start-date': !!c.required, 'end-date': !!c.required },
        'min-date': todayISO(),
        'max-date': daysAheadISO(days),
      };
    }
    case 'OptIn':
      return {
        type: 'OptIn',
        name: c.name || 'consent',
        label: c.label || 'I agree',
        required: !!c.required,
        ...(c.linkUrl ? { 'on-click-action': { name: 'open_url', url: c.linkUrl } } : {}),
      };
    default:
      return null;
  }
}

// Meta caps the files one `complete` payload can carry: the pickers' largest
// possible upload (files × max-file-size-kb, 25600 KB per file when unset)
// must add up to 102400 KB at most. A screen allowing 10 photos was refused
// with "The aggregated size of maximum uploaded files … cannot exceed
// 102400 KB". Each picker on the screen gets an equal share per file.
export const UPLOAD_TOTAL_KB = 102400;
const DEFAULT_FILE_KB = 25600;
const MAX_FILES = 30;
export function capUploadSize(children) {
  const pickers = children.filter((c) => c && (c.type === 'PhotoPicker' || c.type === 'DocumentPicker'));
  if (!pickers.length) return children;
  const countKey = (p) => (p.type === 'PhotoPicker' ? 'max-uploaded-photos' : 'max-uploaded-documents');
  let files = 0;
  for (const p of pickers) {
    const k = countKey(p);
    p[k] = Math.max(1, Math.min(MAX_FILES, Number(p[k]) || 1));
    files += p[k];
  }
  if (files * DEFAULT_FILE_KB <= UPLOAD_TOTAL_KB) return children;
  const perFile = Math.max(1, Math.floor(UPLOAD_TOTAL_KB / files));
  for (const p of pickers) p['max-file-size-kb'] = perFile;
  return children;
}

const footerOf = (s) => (s.components || []).find((c) => c.type === 'Footer');
const navTargetOf = (s) => {
  const f = footerOf(s);
  return f && f.action === 'navigate' && f.nextScreen ? f.nextScreen : null;
};
const stringFieldsOf = (s) => (s.components || []).filter((c) => STRING_FIELDS.has(c.type) && c.name).map((c) => c.name);
const allFieldsOf = (s) => (s.components || []).filter((c) => ALL_FIELDS.has(c.type) && c.name).map((c) => c.name);

/**
 * The screens `s` can move to.
 *
 * `valid` is the set of screen ids that actually exist. Anything outside it is
 * dropped, because Meta rejects the whole flow with "Invalid screens found in
 * the routing model" if the model names a screen that isn't there — and a
 * reference can outlive its screen in several ways: a screen deleted while an
 * option still branched to it, a flow edited outside the builder, or an id
 * rewritten by normalizeScreenIds. Dropping the reference makes the flow
 * publishable; the publish route reports what it dropped.
 */
function targetsOf(s, valid = null) {
  const bf = branchField(s);
  const opt = bf ? (bf.options || []).map((o) => o.nextScreen).filter(Boolean) : [];
  const nav = navTargetOf(s);
  const all = [...new Set([...opt, ...(nav ? [nav] : [])])];
  return valid ? all.filter((t) => valid.has(t)) : all;
}

/**
 * Navigation that points at a screen which no longer exists.
 *
 * Reported as publish warnings so the operator is told their "Reschedule"
 * option now goes nowhere, rather than silently losing the branch.
 */
export function danglingTargets(flow) {
  const screens = flow?.screens || [];
  const valid = new Set(screens.map((s) => s.id));
  const out = [];
  for (const s of screens) {
    const f = footerOf(s);
    if (f && f.action === 'navigate' && f.nextScreen && !valid.has(f.nextScreen)) {
      out.push({ from: s.id, via: 'the footer button', to: f.nextScreen });
    }
    for (const c of s.components || []) {
      for (const o of c.options || []) {
        if (o.nextScreen && !valid.has(o.nextScreen)) {
          out.push({ from: s.id, via: `option "${o.title || o.id}"`, to: o.nextScreen });
        }
      }
    }
  }
  return out;
}

function textTokens(s) {
  const keys = [];
  for (const c of s.components || []) {
    const re = /\$\{data\.([a-zA-Z0-9_]+)\}/g;
    let m;
    while ((m = re.exec(c.text || ''))) keys.push(m[1]);
  }
  return keys;
}

// For every selection on a screen the runtime also publishes a readable
// "<field>_label" (e.g. selected_member_label = "Dr. Asha Rao"), so later
// screens can display the choice instead of a raw id.
//
// Date pickers are included for the same reason: the raw answer is epoch
// milliseconds, so "15 Oct 2026" is only available through the label.
const LABELLED = new Set([...SELECTION, 'DatePicker']);
const labelKeysOf = (s) =>
  (s.components || []).filter((c) => LABELLED.has(c.type) && c.name).map((c) => `${c.name}_label`);

function computeIncoming(screens, valid) {
  const incoming = {};
  const output = {};
  for (const s of screens) {
    incoming[s.id] = new Set();
    output[s.id] = new Set([...stringFieldsOf(s), ...labelKeysOf(s)]);
  }
  for (let i = 0; i <= screens.length; i++) {
    for (const s of screens) for (const t of targetsOf(s, valid)) if (incoming[t]) output[s.id].forEach((k) => incoming[t].add(k));
    for (const s of screens) incoming[s.id].forEach((k) => output[s.id].add(k));
  }
  return incoming;
}

export function buildFlowJson(flow) {
  const screens = flow.screens || [];
  const endpoint = isEndpointMode(flow);
  // Every id that exists. Used to filter navigation so the routing model can
  // never name a screen Meta won't find.
  const valid = new Set(screens.map((s) => s.id));
  const incoming = computeIncoming(screens, valid);

  const routing = {};
  for (const s of screens) routing[s.id] = targetsOf(s, valid);

  // `routing_model` is a whitelist: the endpoint may only move to a screen the
  // source screen declares. services/flowRuntime.js substitutes the "nothing
  // found" screen for any screen whose dynamic list came back empty, so every
  // other screen has to declare it as a permitted destination or Meta rejects
  // the transition.
  //
  // Deliberately not folded into targetsOf(): a screen with no targets is
  // terminal and gets a `complete` footer. Adding a destination there would
  // turn every ending into a data_exchange and the flow would never finish.
  const emptyScreen = screens.find((s) => s.emptyState);
  if (emptyScreen) {
    for (const s of screens) {
      if (s.id === emptyScreen.id) continue;
      if (!routing[s.id].includes(emptyScreen.id)) routing[s.id] = [...routing[s.id], emptyScreen.id];
    }
  }

  const jsonScreens = screens.map((s) => {
    const targets = targetsOf(s, valid);
    // A screen whose only destination was dangling becomes terminal and gets a
    // `complete` footer — an ending, rather than an unpublishable flow.
    const isTerminal = targets.length === 0;
    const received = [...(incoming[s.id] || new Set())];
    const footer = footerOf(s);
    const label = (footer && footer.buttonLabel) || 'Continue';

    const payload = {};
    const ownFields = isTerminal ? allFieldsOf(s) : stringFieldsOf(s);
    for (const f of ownFields) payload[f] = `\${form.${f}}`;
    for (const k of received) if (!(k in payload)) payload[k] = `\${data.${k}}`;
    if (endpoint) payload.flow_token = '${data.flow_token}';

    let footerJson;
    if (isTerminal) {
      footerJson = { type: 'Footer', label, 'on-click-action': { name: 'complete', payload } };
    } else if (endpoint) {
      footerJson = { type: 'Footer', label, 'on-click-action': { name: 'data_exchange', payload } };
    } else {
      footerJson = { type: 'Footer', label, 'on-click-action': { name: 'navigate', next: { type: 'screen', name: targets[0] }, payload } };
    }

    const nonFooter = (s.components || []).filter((c) => c.type !== 'Footer');
    const children = nonFooter
      .map((c, i) => componentToJson(c, { endpoint, screenId: s.id, index: i }))
      .filter(Boolean);
    capUploadSize(children);
    children.push(footerJson);

    const dynSources = dynamicSourcesOf(s);
    const data = {};
    for (const k of new Set([...received, ...textTokens(s)])) {
      if (dynSources.includes(k)) continue;
      data[k] = { type: 'string', __example__: '' };
    }
    for (const src of dynSources) data[src] = DYNAMIC_SCHEMAS[src] || ORDERS_SCHEMA;
    // Keys for prefilled inputs (e.g. whatsapp_number) must be declared too.
    for (const k of prefillKeysOf(s)) if (!(k in data)) data[k] = { type: 'string', __example__: '' };
    // Each text that embeds a token is published as a standalone synthetic key
    // (see componentToJson); declare those keys so the reference resolves.
    nonFooter.forEach((c, i) => {
      if (TEXT_TYPES.has(c.type) && textHasToken(c.text)) {
        data[dynamicTextKey(s.id, i)] = { type: 'string', __example__: '' };
      }
    });
    // A DatePicker's dynamic `unavailable-dates` reads this array of YYYY-MM-DD
    // strings; the endpoint fills it with the chosen doctor's off-days.
    if (endpoint && nonFooter.some((c) => c.type === 'DatePicker')) {
      data.unavailable_dates = { type: 'array', items: { type: 'string' }, __example__: [] };
    }
    if (endpoint) data.flow_token = { type: 'string', __example__: '' };

    return {
      id: s.id,
      title: s.title || s.id,
      ...(isTerminal ? { terminal: true, success: true } : {}),
      data,
      layout: { type: 'SingleColumnLayout', children },
    };
  });

  // `routing_model` is mandatory whenever `data_api_version` is set, even for a
  // single screen — without it Meta answers "The property 'routing_model' is
  // required for property 'data_api_version'" and the publish is rejected.
  const needsRouting = endpoint || screens.length > 1;
  return {
    version: FLOW_VERSION,
    ...(endpoint ? { data_api_version: '3.0' } : {}),
    ...(needsRouting ? { routing_model: routing } : {}),
    screens: jsonScreens,
  };
}

export default { buildFlowJson, isEndpointMode };
