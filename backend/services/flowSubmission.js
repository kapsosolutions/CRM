// ---------------------------------------------------------------------------
// Flow submission → readable rows
//
// Meta's nfm_reply hands us the raw form payload, keyed by the component names
// from the Flow JSON and valued with option ids:
//
//   { selected_category: 'neuro', field_51: 'opt_1', field_51_label: 'Order Food' }
//
// Shown as-is that's unreadable in the chat. The flow definition knows the real
// question for each key (`component.label`) and the real wording of each option
// (`option.title`), and the endpoint runtime already publishes a resolved
// "<field>_label" for selections — so we resolve everything once, here, and
// store the result on the message. The CRM then renders a table without having
// to fetch the flow definition itself.
// ---------------------------------------------------------------------------
import Flow from '../models/Flow.js';
import { flowIdFromToken, memberLabel, categoryLabel, orderLabel, slotLabel, dateLabel } from './flowRuntime.js';

// Internal keys Meta echoes back that aren't answers.
const IGNORED = new Set(['flow_token', 'flow_name', '__version__']);
const SELECTION = new Set(['RadioButtonsGroup', 'CheckboxGroup', 'Dropdown']);

/** "field_51" → "Field 51"; used when the flow definition has no label. */
const prettyKey = (key) =>
  String(key || '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (c) => c.toUpperCase());

/** A component's question text, without a trailing colon. */
const cleanLabel = (label) => String(label || '').trim().replace(/[:：]\s*$/, '');

// First component carrying each name, across all screens.
function componentsByName(flow) {
  const byName = new Map();
  for (const screen of flow?.screens || []) {
    for (const c of screen.components || []) {
      if (c.name && !byName.has(c.name)) byName.set(c.name, c);
    }
  }
  return byName;
}

/** The title of the static option whose id matches `value`. */
function optionTitle(component, value) {
  if (!component || !SELECTION.has(component.type)) return '';
  const hit = (component.options || []).find((o) => o.id === value);
  return hit?.title || '';
}

// Values the runtime prefixes so they can be resolved back to a record.
// `businessId` scopes the lookup to the flow's owner, so one tenant's
// submission can never render another tenant's member, order or category name.
async function resolveId(key, value, businessId) {
  const v = String(value || '');
  if (v.startsWith('mem_')) return (await memberLabel(v, businessId)) || '';
  if (v.startsWith('ord_')) return (await orderLabel(v, businessId)) || '';
  if (v.startsWith('slot_')) return slotLabel(v);
  if (key === 'selected_category' || key.includes('category')) {
    return (await categoryLabel(v, businessId)) || '';
  }
  return '';
}

// One answer → its display text. Checkbox groups arrive as arrays, so each
// entry is resolved separately and then joined.
async function displayValue(form, key, component, value, businessId) {
  if (Array.isArray(value)) {
    const parts = await Promise.all(
      value.map((v) => displayValue(form, key, component, v, businessId)),
    );
    return parts.filter(Boolean).join(', ');
  }
  const supplied = form[`${key}_label`];
  // A single-answer field can use the label the runtime already resolved; for a
  // multi-answer field that label covers the whole set, so skip it per entry.
  if (supplied && !Array.isArray(form[key])) return String(supplied);
  const resolved = optionTitle(component, value) || (await resolveId(key, value, businessId));
  if (resolved) return resolved;
  // Last resort: an option id whose flow definition no longer exists, so the
  // wording the customer actually tapped died with it. "Option 4" at least
  // reads as something, where "opt_4" is an internal id leaking to a business.
  const raw = String(value);
  const opt = raw.match(/^opt_(\d+)$/i);
  return opt ? `Option ${opt[1]}` : raw;
}

/**
 * Resolve a set of submitted answers into labelled rows.
 *
 * Split out from `buildSubmissionSummary` so a stored Registration can be
 * resolved the same way on read: it keeps the raw answers (`field_11: opt_1`),
 * and only the flow definition knows that the question was "Choose one" and the
 * option was "Order Food". Doing it on read means submissions captured before
 * any of this existed render correctly too, with no migration.
 *
 * @param {object|null} flow the Flow document (needs `screens`), or null
 * @param {object} fields the submitted answers, including any "_label" twins
 */
export async function rowsForFields(flow, fields = {}) {
  const byName = flow ? componentsByName(flow) : new Map();
  const businessId = flow?.businessId;
  const rows = [];
  for (const [key, value] of Object.entries(fields)) {
    // "<field>_label" rows are display helpers, not answers — they're consumed
    // as the value of their own field instead of listed separately.
    if (IGNORED.has(key) || key.endsWith('_label')) continue;
    if (value === '' || value === null || value === undefined) continue;
    if (Array.isArray(value) && !value.length) continue;

    const component = byName.get(key);
    const label = cleanLabel(component?.label) || prettyKey(key);
    // eslint-disable-next-line no-await-in-loop
    const typed = await typedRow(fields, key, component, value, businessId);
    rows.push({ key, label, ...typed });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Typed answers
//
// A date picker submits epoch milliseconds, a date range an object, a tick box
// a boolean and a photo picker a list of files. Each is turned into readable
// text (`value`, for the chat list and notifications) plus what the CRM needs
// to draw it properly: stars for a rating, chips for ticked options, thumbnails
// for photos.
// ---------------------------------------------------------------------------
const FILE_TYPES = new Set(['PhotoPicker', 'DocumentPicker']);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** A stored file answer → { url, name, mime } ('' url when it couldn't be fetched). */
export function fileOf(f) {
  if (!f || typeof f !== 'object') return null;
  return {
    url: String(f.url || ''),
    name: String(f.name || f.file_name || f.filename || 'file'),
    mime: String(f.mime || f.mime_type || ''),
  };
}
const looksLikeFiles = (v) =>
  Array.isArray(v) && v.length > 0 && v.every((x) => x && typeof x === 'object' && ('url' in x || 'file_name' in x || 'id' in x || 'media_id' in x));
const rangeOf = (v) => (v && typeof v === 'object' && !Array.isArray(v) && ('start-date' in v || 'end-date' in v) ? v : null);

async function typedRow(form, key, component, value, businessId) {
  const type = component?.type || '';
  const supplied = form[`${key}_label`];

  // Photos and documents.
  if (FILE_TYPES.has(type) || looksLikeFiles(value)) {
    const files = (Array.isArray(value) ? value : [value]).map(fileOf).filter(Boolean);
    const isPhoto = type === 'PhotoPicker' || (!type && files.every((f) => f.mime.startsWith('image/')));
    return {
      type: isPhoto ? 'photo' : 'document',
      files,
      value: isPhoto ? plural(files.length, 'photo', 'photos') : plural(files.length, 'document', 'documents'),
    };
  }

  // A start → end date range.
  const range = rangeOf(value);
  if (type === 'CalendarPicker' || range) {
    const r = range || {};
    const from = dateLabel(r['start-date']) || String(r['start-date'] || '');
    const to = dateLabel(r['end-date']) || String(r['end-date'] || '');
    return { type: 'daterange', value: [from, to].filter(Boolean).join(' → ') };
  }

  // An "I agree" tick box.
  if (type === 'OptIn' || typeof value === 'boolean') {
    const agreed = value === true || value === 'true';
    return { type: 'consent', agreed, value: agreed ? 'Agreed' : 'Not agreed' };
  }

  // A date: readable, whether or not the runtime published a label for it.
  if (type === 'DatePicker') {
    return { type: 'date', value: (supplied && String(supplied)) || dateLabel(value) || String(value) };
  }

  const text = await displayValue(form, key, component, value, businessId);

  // A 1–5 rating (the Rating block's ids are rate_1 … rate_5).
  const rate = String(Array.isArray(value) ? '' : value).match(/^rate_([1-5])$/);
  if (rate) return { type: 'rating', rating: Number(rate[1]), value: text };

  if (type === 'CheckboxGroup' || Array.isArray(value)) {
    const items = text.split(', ').filter(Boolean);
    return { type: 'multi', items, value: text };
  }
  if (type === 'RadioButtonsGroup' || type === 'Dropdown') return { type: 'choice', value: text };
  if (type === 'TextArea') return { type: 'longtext', value: text };
  if (type === 'TextInput' && component?.inputType === 'phone') return { type: 'phone', value: text };
  if (type === 'TextInput' && component?.inputType === 'email') return { type: 'email', value: text };
  return { type: 'text', value: text };
}

/**
 * Resolve a submitted flow form into labelled rows for the CRM.
 * @param {object} form parsed nfm_reply response_json
 * @returns {Promise<{flowName: string, rows: {key: string, label: string, value: string}[]}>}
 */
export async function buildSubmissionSummary(form = {}) {
  const summary = { flowName: '', rows: [] };
  if (!form || typeof form !== 'object') return summary;

  // The flow_token we minted when sending encodes which flow this came from.
  let flow = null;
  const flowId = flowIdFromToken(form.flow_token);
  if (flowId) {
    // businessId is selected because rowsForFields scopes its id lookups by it.
    flow = await Flow.findById(flowId).select('name screens businessId').lean().catch(() => null);
    if (flow) summary.flowName = flow.name || '';
  }
  summary.rows = await rowsForFields(flow, form);
  return summary;
}

/** Plain-text version, for the chat-list preview and notification bodies. */
export function summaryToText(summary) {
  const lines = (summary?.rows || []).map((r) => `${r.label}: ${r.value}`);
  // Named after the form ("📝 Patient registration"), so the chat list and the
  // notification say which form came in.
  const title = String(summary?.flowName || '').trim() || 'Form submitted';
  return `📝 ${title}${lines.length ? `\n${lines.join('\n')}` : ''}`;
}

/**
 * Save the photos and documents a customer attached to a form.
 *
 * WhatsApp hands back each file as a media reference ({ file_name, mime_type,
 * sha256, id }) on the completed form. Those ids expire, so the bytes are
 * fetched with the business's WhatsApp access and stored with the rest of the
 * chat's media; the answer then holds { url, name, mime } instead. A file that
 * can't be fetched keeps its name with an empty url, so the CRM can still say
 * one was sent. Changes `form` in place.
 * @param {object} form parsed nfm_reply response_json
 * @param {{ meta?: object, tenantId?: string }} ctx the tenant's WhatsApp client
 * @param {{ uploadBuffer: Function, mediaFolder: Function }} storage
 */
export async function storeFlowMedia(form, ctx = {}, storage) {
  if (!form || typeof form !== 'object' || !ctx.meta?.downloadMedia || !storage) return form;
  for (const [key, value] of Object.entries(form)) {
    if (!looksLikeFiles(value)) continue;
    const saved = [];
    for (const f of value) {
      const id = f.id || f.media_id;
      const base = { url: '', name: String(f.file_name || f.name || 'file'), mime: String(f.mime_type || f.mime || '') };
      if (f.url) {
        saved.push({ ...base, url: String(f.url) });
        continue;
      }
      if (!id) {
        saved.push(base);
        continue;
      }
      try {
        // eslint-disable-next-line no-await-in-loop
        const { buffer, mime } = await ctx.meta.downloadMedia(id);
        const m = mime || base.mime;
        const kind = m.startsWith('image/') ? 'image' : 'raw';
        // eslint-disable-next-line no-await-in-loop
        const url = await storage.uploadBuffer(buffer, storage.mediaFolder(ctx.tenantId, 'inbound'), kind);
        saved.push({ ...base, url, mime: m });
      } catch {
        saved.push(base);
      }
    }
    form[key] = saved;
  }
  return form;
}

export default { buildSubmissionSummary, rowsForFields, summaryToText, storeFlowMedia };
