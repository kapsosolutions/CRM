// How one form submission reads: its answers in the form's own order, the
// one-line summary for the list, and which answer is only the contact's own
// phone number again. Shared by the form pages' list (RegistrationsList) and
// the submission's details page (FormSubmissionDetails).
import type { FormRow, Registration } from './types';
import type { KOption } from './components/Dropdown';
import { presetById, presetOfSubmission, type FormPreset } from './flowForms';
import { rawAnswer } from './utils';

/** A submission's statuses, in workflow order. */
export const REG_STATUS: KOption[] = [
  { value: 'new', label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'done', label: 'Done' },
  { value: 'cancelled', label: 'Cancelled' },
];

const pretty = (k: string) => k.replace(/[_-]+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());

// The name is already the contact, so it isn't repeated among the answers.
const NAME_KEYS = new Set(['name', 'full_name', 'fullname', 'your_name', 'customer_name']);

/**
 * The question/answer pairs to show for a submission.
 *
 * The server resolves these against the flow definition: only it knows that
 * "field_11" was the question "Choose one" and "opt_1" was "Order Food". The
 * fallback covers a server that hasn't resolved them: it at least prefers the
 * runtime's "<field>_label" twin over the raw option id. Category and member
 * are shown from their own fields, so their raw ids are left out here.
 */
export function answerRows(r: Registration): FormRow[] {
  const rows: FormRow[] = r.rows?.length
    ? r.rows
    : Object.entries(r.fields || {})
        .filter(([k]) => !k.endsWith('_label'))
        .map(([k, v]) => ({ key: k, label: pretty(k), ...rawAnswer(v, (r.fields || {})[`${k}_label`]) }));

  return rows.filter(
    (row) =>
      !NAME_KEYS.has(row.key.toLowerCase()) &&
      !row.key.toLowerCase().includes('category') &&
      !String(row.value).startsWith('mem_') &&
      String(row.value).trim() !== '',
  );
}

const digits = (s?: string) => String(s || '').replace(/\D/g, '');

/** An answer that is only the contact's own number again (the WhatsApp number field). */
export function isContactPhone(row: FormRow, r: Registration): boolean {
  const mine = digits(r.phone);
  if (!mine) return false;
  if (row.type && row.type !== 'phone' && row.type !== 'text') return false;
  if (row.type !== 'phone' && !/whatsapp|phone|mobile/i.test(row.key)) return false;
  const theirs = digits(row.value);
  if (theirs.length < 8) return false;
  return theirs === mine || mine.endsWith(theirs) || theirs.endsWith(mine);
}

/** The preset field a stored answer belongs to (a renamed clash ends in _2, _3…). */
function fieldIndex(key: string, names: string[]): number {
  const i = names.indexOf(key);
  if (i >= 0) return i;
  return names.findIndex((n) => key.startsWith(`${n}_`) && /^\d+$/.test(kSlice(key, n)));
}

function kSlice(key: string, name: string): string {
  return key.slice(name.length + 1);
}

/**
 * The answers split into the form's own questions, in the order the form asks
 * them, and anything else the customer answered on the way (a flow's menu
 * choice, a field added by hand). Without a ready-made form everything is
 * "main", in the order it arrived.
 */
export function groupedAnswers(r: Registration, preset: FormPreset | null): { main: FormRow[]; other: FormRow[] } {
  const rows = answerRows(r);
  if (!preset) return { main: rows, other: [] };
  const names = preset.fields.map((f) => f.name);
  const at = new Map(rows.map((row) => [row, fieldIndex(row.key, names)]));
  const main = rows.filter((row) => at.get(row)! >= 0).sort((a, b) => at.get(a)! - at.get(b)!);
  const other = rows.filter((row) => at.get(row)! < 0);
  return { main, other };
}

/** The ready-made form a submission came from, from its answers alone. */
export function presetOf(r: Registration): FormPreset | null {
  const id = presetOfSubmission(r, new Map());
  return id ? presetById(id) : null;
}

function shortValue(row: FormRow): string {
  if (row.type === 'rating') return `${Math.max(0, Math.min(5, row.rating || 0))}/5 ★`;
  if (row.type === 'multi' && row.items?.length) return row.items.join(', ');
  return String(row.value).replace(/\s+/g, ' ').trim();
}

export interface SummaryPair {
  label: string;
  value: string;
  type?: FormRow['type'];
}

/**
 * The list row's one line: the first few answers that say what this
 * submission is about, in the form's order, plus how many photos and files it
 * carries. The contact's own number, the name, consent ticks and attachments
 * are left out of the text; a long text answer is used only when nothing
 * shorter was answered.
 */
export function submissionSummary(
  r: Registration,
  preset: FormPreset | null,
  max = 3,
): { text: string; items: SummaryPair[]; extra: number; files: number } {
  const { main, other } = groupedAnswers(r, preset);
  const allItems: SummaryPair[] = [];
  const long: SummaryPair[] = [];
  let files = 0;
  for (const row of [...main, ...other]) {
    if (row.type === 'photo' || row.type === 'document') {
      files += row.files?.length || 1;
      continue;
    }
    if (row.type === 'consent' || isContactPhone(row, r)) continue;
    const val = shortValue(row);
    if (!val) continue;
    if (row.type === 'longtext') {
      long.push({ label: row.label, value: val, type: row.type });
      continue;
    }
    allItems.push({ label: row.label, value: val, type: row.type });
  }
  if (r.category) allItems.push({ label: 'Category', value: r.category });
  if (r.memberName) allItems.push({ label: 'Member', value: r.memberName });
  if (!allItems.length && long.length) allItems.push(long[0]);
  const items = allItems.slice(0, max);
  const extra = Math.max(0, allItems.length - items.length);
  const text = items.map((it) => it.value).join(' · ');
  return { text, items, extra, files };
}
