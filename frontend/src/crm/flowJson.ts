// Turn a builder flow definition into Meta WhatsApp Flow JSON (v6.3).
//
// Two modes:
//  • Client mode  — footers navigate/complete on-device; data passes screen→
//    screen through the Footer payload (${data.x}). Fully self-contained.
//  • Endpoint mode — used when a screen branches per-option (each radio option
//    goes to a different screen) or shows a dynamic list (categories). Footers
//    become `data_exchange`; our backend endpoint reads the choice, decides the
//    next screen and supplies its data (e.g. categories with 1:1 images).
import type { FlowComponent, FlowScreen, WaFlowDef } from './types';

const FLOW_VERSION = '6.3';

const STRING_FIELDS = new Set(['RadioButtonsGroup', 'CheckboxGroup', 'Dropdown', 'TextInput', 'TextArea', 'DatePicker']);
// Answers that aren't plain strings (files, a date range, a tick box) are only
// sent from the screen that completes the flow — a later screen's data can only
// declare strings, so they can't be passed along from an earlier one.
export const FINAL_SCREEN_ONLY = new Set(['PhotoPicker', 'DocumentPicker', 'CalendarPicker', 'OptIn']);
const ALL_FIELDS = new Set([...STRING_FIELDS, ...FINAL_SCREEN_ONLY]);
const SELECTION = new Set(['RadioButtonsGroup', 'CheckboxGroup', 'Dropdown']);

function toBase64(src: string): string {
  if (!src) return '';
  if (src.startsWith('data:')) return src.replace(/^data:[^;]+;base64,/, '');
  return src;
}

// A selection component whose options branch to different screens.
function branchField(s: FlowScreen): FlowComponent | undefined {
  return s.components.find((c) => SELECTION.has(c.type) && (c.options || []).some((o) => o.nextScreen));
}
const isDynamic = (c: FlowComponent) => !!c.source && c.source !== 'static';
// Dynamic data keys a screen needs (e.g. ['categories'] or ['orders']).
function dynamicSourcesOf(s: FlowScreen): string[] {
  return [...new Set(s.components.filter(isDynamic).map((c) => c.source as string))];
}

// A component's `prefill` source → the data key the runtime supplies.
export const PREFILL_KEYS: Record<string, string> = { phone: 'whatsapp_number' };
/** Data keys a screen needs because one of its components is prefilled. */
export function prefillKeysOf(s: FlowScreen): string[] {
  return [...new Set(s.components.filter((c) => c.prefill).map((c) => PREFILL_KEYS[c.prefill as string] || (c.prefill as string)))];
}

/**
 * A flow needs the data endpoint when any screen branches, lists dynamic data,
 * or has a prefilled input (the endpoint supplies the value).
 */
export function isEndpointMode(flow: WaFlowDef): boolean {
  return flow.screens.some(
    (s) => !!branchField(s) || dynamicSourcesOf(s).length > 0 || s.components.some((c) => c.prefill),
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
const DYNAMIC_SCHEMAS: Record<string, unknown> = {
  categories: CATEGORIES_SCHEMA,
  members: MEMBERS_SCHEMA,
  orders: ORDERS_SCHEMA,
  active_orders: ACTIVE_ORDERS_SCHEMA,
  slots: SLOTS_SCHEMA,
  appointments: APPOINTMENTS_SCHEMA,
};

/** 'YYYY-MM-DD' (local zone) — the format Meta's DatePicker bounds must be in. */
function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const todayISO = (): string => isoDate(new Date());
function daysAheadISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + (days || 0));
  return isoDate(d);
}
const pastDaysOf = (c: FlowComponent): number => (Number(c.pastDays) > 0 ? Math.min(Number(c.pastDays), 36500) : 0);

// Default booking horizon when a DatePicker doesn't set its own.
const MAX_DAYS_AHEAD_DEFAULT = 60;
const maxDaysAheadOf = (c: FlowComponent): number =>
  Number(c.maxDaysAhead) > 0 ? Number(c.maxDaysAhead) : MAX_DAYS_AHEAD_DEFAULT;

// A dynamic token embedded in a larger text string isn't interpolated by the
// Flow client — only a standalone ${data.key} is. Any text with a token is
// published as a single synthetic reference the runtime fills in. Shared shape
// with services/flowJson.js so published + preview JSON agree.
const TEXT_TOKEN_RE = /\$\{data\.[a-zA-Z0-9_]+\}/;
const textHasToken = (t?: string): boolean => TEXT_TOKEN_RE.test(t || '');
const dynamicTextKey = (screenId: string, index: number): string =>
  `txt_${String(screenId).replace(/[^a-zA-Z0-9_]/g, '_')}_${index}`;
const TEXT_TYPES = new Set(['TextHeading', 'TextSubheading', 'TextBody', 'TextCaption']);

function componentToJson(
  c: FlowComponent,
  opts: { endpoint?: boolean; screenId?: string; index?: number } = {},
): Record<string, unknown> | null {
  if (TEXT_TYPES.has(c.type)) {
    const text = textHasToken(c.text)
      ? `\${data.${dynamicTextKey(opts.screenId || '', opts.index || 0)}}`
      : (c.text || '');
    return { type: c.type, text };
  }
  switch (c.type) {
    case 'Image':
      // 8:1 banner displayed at 1000×125 (matches the welcome-flow spec).
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
        'data-source': isDynamic(c) ? `\${data.${c.source}}` : (c.options || []).map((o) => ({ id: o.id, title: o.title })),
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
      // A date in the past (date of an incident, of birth): up to today.
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
        // Visible hint of the allowed window; blocks past + too-far dates.
        'helper-text': c.helperText || `Pick a date within the next ${days} days`,
        // Static 'YYYY-MM-DD' bounds baked in at publish — a dynamic ${data.*}
        // min/max isn't honoured, and Meta's validator requires YYYY-MM-DD.
        'min-date': todayISO(),
        'max-date': daysAheadISO(days),
        // Doctor's off-days, filled dynamically by the endpoint.
        ...(opts.endpoint ? { 'unavailable-dates': '${data.unavailable_dates}' } : {}),
      };
    }
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
    default:
      return null;
  }
}

// Meta caps the files one `complete` payload can carry: the pickers' largest
// possible upload (files × max-file-size-kb, 25600 KB per file when unset)
// must add up to 102400 KB at most. Mirrors backend/services/flowJson.js.
export const UPLOAD_TOTAL_KB = 102400;
const DEFAULT_FILE_KB = 25600;
const MAX_FILES = 30;
export function capUploadSize(children: Record<string, unknown>[]): Record<string, unknown>[] {
  const pickers = children.filter((c) => c && (c.type === 'PhotoPicker' || c.type === 'DocumentPicker'));
  if (!pickers.length) return children;
  const countKey = (p: Record<string, unknown>) => (p.type === 'PhotoPicker' ? 'max-uploaded-photos' : 'max-uploaded-documents');
  let files = 0;
  for (const p of pickers) {
    const k = countKey(p);
    const n = Math.max(1, Math.min(MAX_FILES, Number(p[k]) || 1));
    p[k] = n;
    files += n;
  }
  if (files * DEFAULT_FILE_KB <= UPLOAD_TOTAL_KB) return children;
  const perFile = Math.max(1, Math.floor(UPLOAD_TOTAL_KB / files));
  for (const p of pickers) p['max-file-size-kb'] = perFile;
  return children;
}

const footerOf = (s: FlowScreen) => s.components.find((c) => c.type === 'Footer');
const navTargetOf = (s: FlowScreen): string | null => {
  const f = footerOf(s);
  return f?.action === 'navigate' && f.nextScreen ? f.nextScreen : null;
};
const stringFieldsOf = (s: FlowScreen): string[] =>
  s.components.filter((c) => STRING_FIELDS.has(c.type) && c.name).map((c) => c.name as string);
const allFieldsOf = (s: FlowScreen): string[] =>
  s.components.filter((c) => ALL_FIELDS.has(c.type) && c.name).map((c) => c.name as string);

// All screens a given screen can lead to (branch option targets + nav target).
// alid is the set of screen ids that exist; navigation to anything else is
// dropped, matching services/flowJson.js. Meta rejects a routing model that
// names a missing screen, so the preview must not show one either.
function targetsOf(s: FlowScreen, valid?: Set<string>): string[] {
  const bf = branchField(s);
  const opt = bf ? (bf.options || []).map((o) => o.nextScreen).filter(Boolean) as string[] : [];
  const nav = navTargetOf(s);
  const all = [...new Set([...opt, ...(nav ? [nav] : [])])];
  return valid ? all.filter((t) => valid.has(t)) : all;
}

function textTokens(s: FlowScreen): string[] {
  const keys: string[] = [];
  for (const c of s.components) {
    const re = /\$\{data\.([a-zA-Z0-9_]+)\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(c.text || ''))) keys.push(m[1]);
  }
  return keys;
}

// For every selection on a screen the runtime also publishes a readable
// "<field>_label" (e.g. selected_member_label = "Dr. Asha Rao"), so later
// screens can display the choice instead of a raw id.
// Date pickers too: their raw answer is epoch milliseconds, so a readable
// date is only available through the label.
const LABELLED = new Set([...SELECTION, 'DatePicker']);
const labelKeysOf = (s: FlowScreen): string[] =>
  s.components.filter((c) => LABELLED.has(c.type) && c.name).map((c) => `${c.name}_label`);

function computeIncoming(screens: FlowScreen[]): Record<string, Set<string>> {
  const incoming: Record<string, Set<string>> = {};
  const output: Record<string, Set<string>> = {};
  for (const s of screens) {
    incoming[s.id] = new Set();
    output[s.id] = new Set([...stringFieldsOf(s), ...labelKeysOf(s)]);
  }
  for (let i = 0; i <= screens.length; i++) {
    for (const s of screens) {
      for (const t of targetsOf(s)) if (incoming[t]) output[s.id].forEach((k) => incoming[t].add(k));
    }
    for (const s of screens) incoming[s.id].forEach((k) => output[s.id].add(k));
  }
  return incoming;
}

export function incomingDataKeys(screens: FlowScreen[], screenId: string): string[] {
  return [...(computeIncoming(screens)[screenId] || new Set<string>())];
}

export function buildFlowJson(flow: WaFlowDef): Record<string, unknown> {
  const screens = flow.screens;
  const endpoint = isEndpointMode(flow);
  const incoming = computeIncoming(screens);
  // Ids that exist, so navigation to a deleted screen is left out.
  const valid = new Set(screens.map((s) => s.id));

  const routing: Record<string, string[]> = {};
  for (const s of screens) routing[s.id] = targetsOf(s, valid);

  // `routing_model` is a whitelist: the endpoint may only move to a screen the
  // source screen declares. The server can substitute the "nothing found"
  // screen for *any* screen whose dynamic list came back empty, so every other
  // screen has to declare it as a permitted destination.
  //
  // Deliberately not folded into targetsOf(): a screen with no targets is
  // terminal, and terminal screens get a `complete` footer. Adding a
  // destination there would turn every ending into a data_exchange and the
  // flow would never finish.
  const emptyScreen = screens.find((s) => s.emptyState);
  if (emptyScreen) {
    for (const s of screens) {
      if (s.id === emptyScreen.id) continue;
      if (!routing[s.id].includes(emptyScreen.id)) {
        routing[s.id] = [...routing[s.id], emptyScreen.id];
      }
    }
  }

  const jsonScreens = screens.map((s) => {
    const targets = targetsOf(s, valid);
    const isTerminal = targets.length === 0;
    const received = [...(incoming[s.id] || new Set<string>())];
    const footer = footerOf(s);
    const label = footer?.buttonLabel || 'Continue';

    // Footer payload: own fields + forwarded data (+ flow_token in endpoint mode).
    const payload: Record<string, string> = {};
    const ownFields = isTerminal ? allFieldsOf(s) : stringFieldsOf(s);
    for (const f of ownFields) payload[f] = `\${form.${f}}`;
    for (const k of received) if (!(k in payload)) payload[k] = `\${data.${k}}`;
    if (endpoint) payload.flow_token = '${data.flow_token}';

    let footerJson: Record<string, unknown>;
    if (isTerminal) {
      footerJson = { type: 'Footer', label, 'on-click-action': { name: 'complete', payload } };
    } else if (endpoint) {
      // Server decides the next screen based on the selection.
      footerJson = { type: 'Footer', label, 'on-click-action': { name: 'data_exchange', payload } };
    } else {
      footerJson = {
        type: 'Footer',
        label,
        'on-click-action': { name: 'navigate', next: { type: 'screen', name: targets[0] }, payload },
      };
    }

    const nonFooter = s.components.filter((c) => c.type !== 'Footer');
    const children = nonFooter
      .map((c, i) => componentToJson(c, { endpoint, screenId: s.id, index: i }))
      .filter(Boolean) as Record<string, unknown>[];
    capUploadSize(children);
    children.push(footerJson);

    const dynSources = dynamicSourcesOf(s);
    const data: Record<string, unknown> = {};
    for (const k of new Set<string>([...received, ...textTokens(s)])) {
      if (dynSources.includes(k)) continue;
      data[k] = { type: 'string', __example__: '' };
    }
    for (const src of dynSources) data[src] = DYNAMIC_SCHEMAS[src] || ORDERS_SCHEMA;
    // Keys for prefilled inputs (e.g. whatsapp_number) must be declared too.
    for (const k of prefillKeysOf(s)) if (!(k in data)) data[k] = { type: 'string', __example__: '' };
    // Standalone synthetic keys for any text that embeds a token.
    nonFooter.forEach((c, i) => {
      if (TEXT_TYPES.has(c.type) && textHasToken(c.text)) {
        data[dynamicTextKey(s.id, i)] = { type: 'string', __example__: '' };
      }
    });
    // Dynamic unavailable-dates for a DatePicker (doctor's off-days).
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
