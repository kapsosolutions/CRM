// -----------------------------------------------------------------------------
// Messenger / Instagram quick messages and Messenger utility templates: the
// limits and checks the builders show live. They mirror the server's
// (backend services/metaMessaging.js), which has the final say.
// -----------------------------------------------------------------------------
import type {
  FieldProblem, MetaChannel, QuickButton, QuickCard, QuickMessageInput, QuickMessageKind, UtilityButton, UtilityTemplateInput,
} from './types';

export const CHANNEL_LABEL: Record<MetaChannel, string> = { messenger: 'Messenger', instagram: 'Instagram' };

export const LIMITS: Record<MetaChannel, {
  text: number; textUnit: 'characters' | 'bytes'; buttonText: number; cards: number; cardTitle: number; cardSubtitle: number;
  buttons: number; buttonTitle: number; quickReplies: number; quickReplyTitle: number; payload: number;
}> = {
  messenger: { text: 2000, textUnit: 'characters', buttonText: 640, cards: 10, cardTitle: 80, cardSubtitle: 80, buttons: 3, buttonTitle: 20, quickReplies: 13, quickReplyTitle: 20, payload: 1000 },
  instagram: { text: 1000, textUnit: 'bytes', buttonText: 640, cards: 10, cardTitle: 80, cardSubtitle: 80, buttons: 3, buttonTitle: 20, quickReplies: 13, quickReplyTitle: 20, payload: 1000 },
};
export const UTILITY_LIMITS = { name: 512, body: 1024, buttons: 3, buttonText: 25 };
export const UTILITY_LANGUAGES: { value: string; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'en_US', label: 'English (US)' },
  { value: 'en_GB', label: 'English (UK)' },
  { value: 'hi', label: 'Hindi' },
  { value: 'ta', label: 'Tamil' },
  { value: 'te', label: 'Telugu' },
  { value: 'kn', label: 'Kannada' },
  { value: 'ml', label: 'Malayalam' },
  { value: 'mr', label: 'Marathi' },
  { value: 'bn', label: 'Bengali' },
  { value: 'gu', label: 'Gujarati' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'pt_BR', label: 'Portuguese (Brazil)' },
  { value: 'ar', label: 'Arabic' },
  { value: 'id', label: 'Indonesian' },
];
export const languageLabel = (code: string) => UTILITY_LANGUAGES.find((l) => l.value === code)?.label || code;

export const KIND_LABEL: Record<QuickMessageKind, string> = {
  text: 'Text',
  image: 'Image',
  cards: 'Cards',
  quick_replies: 'Quick replies',
};

export const bytes = (s: string) => new TextEncoder().encode(s || '').length;
export const isHttpUrl = (u: string) => {
  try {
    const x = new URL(String(u || ''));
    return x.protocol === 'https:' || x.protocol === 'http:';
  } catch {
    return false;
  }
};

export const emptyButton = (type: QuickButton['type'] = 'url'): QuickButton => ({ type, title: '', url: '', payload: '' });
export const emptyCard = (): QuickCard => ({ imageUrl: '', title: '', subtitle: '', buttons: [] });

export function emptyQuickMessage(channel: MetaChannel, kind: QuickMessageKind = 'text'): QuickMessageInput {
  return {
    name: '',
    channels: [channel],
    kind,
    text: '',
    imageUrl: '',
    buttons: [],
    cards: kind === 'cards' ? [emptyCard()] : [],
    quickReplies: kind === 'quick_replies' ? [{ title: '', payload: '' }] : [],
  };
}

function buttonProblems(out: FieldProblem[], list: QuickButton[], field: string, channel: MetaChannel, label: string) {
  const L = LIMITS[channel];
  if (list.length > L.buttons) out.push({ field, message: `${label}: at most ${L.buttons} buttons.` });
  list.forEach((b, i) => {
    const f = `${field}.${i}`;
    if (!b.title.trim()) out.push({ field: `${f}.title`, message: `${label}: button ${i + 1} needs a label.` });
    else if (b.title.trim().length > L.buttonTitle) out.push({ field: `${f}.title`, message: `${label}: button ${i + 1}'s label can be at most ${L.buttonTitle} characters.` });
    if (b.type === 'url' && !isHttpUrl(b.url.trim())) out.push({ field: `${f}.url`, message: `${label}: button ${i + 1} needs a web address starting with https://.` });
  });
}

/** What would stop this quick message on one channel ([] = it can be sent there). */
export function quickProblems(qm: QuickMessageInput, channel: MetaChannel): FieldProblem[] {
  const L = LIMITS[channel];
  const out: FieldProblem[] = [];
  const where = CHANNEL_LABEL[channel];
  const tooLong = (t: string) => (L.textUnit === 'bytes' ? bytes(t) > L.text : t.length > L.text);
  if (qm.kind === 'text') {
    if (!qm.text.trim()) out.push({ field: 'text', message: 'Write the message.' });
    else if (qm.buttons.length && qm.text.trim().length > L.buttonText) out.push({ field: 'text', message: `${where}: a message with buttons can be at most ${L.buttonText} characters.` });
    else if (!qm.buttons.length && tooLong(qm.text)) out.push({ field: 'text', message: `${where}: a message can be at most ${L.text.toLocaleString('en-US')} ${L.textUnit}.` });
    buttonProblems(out, qm.buttons, 'buttons', channel, where);
  } else if (qm.kind === 'image') {
    if (!isHttpUrl(qm.imageUrl.trim())) out.push({ field: 'imageUrl', message: 'Upload an image or paste its https:// address.' });
    if (qm.text.trim() && tooLong(qm.text)) out.push({ field: 'text', message: `${where}: the caption can be at most ${L.text.toLocaleString('en-US')} ${L.textUnit}.` });
  } else if (qm.kind === 'cards') {
    if (!qm.cards.length) out.push({ field: 'cards', message: 'Add at least one card.' });
    if (qm.cards.length > L.cards) out.push({ field: 'cards', message: `${where}: at most ${L.cards} cards.` });
    qm.cards.forEach((c, i) => {
      const f = `cards.${i}`;
      const label = `Card ${i + 1}`;
      const title = c.title.trim();
      if (!title) out.push({ field: `${f}.title`, message: `${label} needs a title.` });
      else if (title.length > L.cardTitle) out.push({ field: `${f}.title`, message: `${label}: the title can be at most ${L.cardTitle} characters.` });
      if (c.subtitle.trim().length > L.cardSubtitle) out.push({ field: `${f}.subtitle`, message: `${label}: the subtitle can be at most ${L.cardSubtitle} characters.` });
      if (c.imageUrl.trim() && !isHttpUrl(c.imageUrl.trim())) out.push({ field: `${f}.imageUrl`, message: `${label}: the image needs an https:// address.` });
      if (title && !c.subtitle.trim() && !c.imageUrl.trim() && !c.buttons.length) out.push({ field: `${f}.subtitle`, message: `${label}: add a subtitle, an image or a button as well as the title.` });
      buttonProblems(out, c.buttons, `${f}.buttons`, channel, label);
    });
  } else if (qm.kind === 'quick_replies') {
    if (!qm.text.trim()) out.push({ field: 'text', message: 'Write the question the chips answer.' });
    else if (tooLong(qm.text)) out.push({ field: 'text', message: `${where}: the message can be at most ${L.text.toLocaleString('en-US')} ${L.textUnit}.` });
    if (!qm.quickReplies.length) out.push({ field: 'quickReplies', message: 'Add at least one quick reply.' });
    if (qm.quickReplies.length > L.quickReplies) out.push({ field: 'quickReplies', message: `${where}: at most ${L.quickReplies} quick replies.` });
    qm.quickReplies.forEach((q, i) => {
      if (!q.title.trim()) out.push({ field: `quickReplies.${i}.title`, message: `Quick reply ${i + 1} needs a label.` });
      else if (q.title.trim().length > L.quickReplyTitle) out.push({ field: `quickReplies.${i}.title`, message: `Quick reply ${i + 1}: at most ${L.quickReplyTitle} characters.` });
    });
  }
  return out;
}

/** Every problem for every channel the message is for, de-duplicated. */
export function allQuickProblems(qm: QuickMessageInput): FieldProblem[] {
  const out: FieldProblem[] = [];
  if (!qm.name.trim()) out.push({ field: 'name', message: 'Give the quick message a name.' });
  if (!qm.channels.length) out.push({ field: 'channels', message: 'Choose Messenger, Instagram or both.' });
  const seen = new Set(out.map((p) => p.message));
  for (const ch of qm.channels) {
    for (const p of quickProblems(qm, ch)) {
      if (!seen.has(p.message)) {
        seen.add(p.message);
        out.push(p);
      }
    }
  }
  return out;
}

// ------------------------------------------------- utility templates --
const PARAM_RE = /\{\{\s*(\d+)\s*\}\}/g;
export function paramNumbers(text: string): number[] {
  const seen: number[] = [];
  for (const m of String(text || '').matchAll(PARAM_RE)) {
    const n = Number(m[1]);
    if (!seen.includes(n)) seen.push(n);
  }
  return seen;
}
export const paramCount = (text: string) => {
  const n = paramNumbers(text);
  return n.length ? Math.max(...n) : 0;
};
export const renderParams = (text: string, values: string[]) =>
  String(text || '').replace(PARAM_RE, (m, n) => values[Number(n) - 1] || m);

export const emptyUtilityButton = (type: UtilityButton['type'] = 'URL'): UtilityButton => ({ type, text: '', url: '', urlExample: '', phone: '' });

/** The create form's problems (the server checks the same rules). */
export function utilityProblems(v: UtilityTemplateInput): FieldProblem[] {
  const out: FieldProblem[] = [];
  const body = v.bodyText.trim();
  if (!v.name.trim()) out.push({ field: 'name', message: 'Give the template a name.' });
  else if (!/^[a-z0-9_]+$/.test(v.name.trim())) out.push({ field: 'name', message: 'Use lowercase letters, numbers and underscores only in the name.' });
  if (!body) out.push({ field: 'bodyText', message: 'Write the message body.' });
  else if (body.length > UTILITY_LIMITS.body) out.push({ field: 'bodyText', message: `The body can be at most ${UTILITY_LIMITS.body.toLocaleString('en-US')} characters.` });
  const stray = body.replace(PARAM_RE, '').match(/\{\{[^}]*\}\}|\{\{|\}\}/);
  if (stray) out.push({ field: 'bodyText', message: `Placeholders look like {{1}}, {{2}} (numbers only): fix “${stray[0]}”.` });
  const nums = [...paramNumbers(body)].sort((a, b) => a - b);
  if (nums.some((n, i) => n !== i + 1)) out.push({ field: 'bodyText', message: 'Number the placeholders in order: {{1}}, {{2}}, {{3}} … with none missing.' });
  if (/^\{\{\s*\d+\s*\}\}/.test(body) || /\{\{\s*\d+\s*\}\}[\s.!?]*$/.test(body)) out.push({ field: 'bodyText', message: 'The message can’t start or end with a placeholder: add some words before and after it.' });
  const count = paramCount(body);
  for (let i = 0; i < count; i += 1) {
    if (!(v.bodyExamples[i] || '').trim()) out.push({ field: `bodyExamples.${i}`, message: `Add a sample value for {{${i + 1}}} (Meta reviews the template with it).` });
  }
  if (v.buttons.length > UTILITY_LIMITS.buttons) out.push({ field: 'buttons', message: `At most ${UTILITY_LIMITS.buttons} buttons.` });
  v.buttons.forEach((b, i) => {
    const f = `buttons.${i}`;
    if (!b.text.trim()) out.push({ field: `${f}.text`, message: `Button ${i + 1} needs a label.` });
    else if (b.text.trim().length > UTILITY_LIMITS.buttonText) out.push({ field: `${f}.text`, message: `Button ${i + 1}: the label can be at most ${UTILITY_LIMITS.buttonText} characters.` });
    if (b.type === 'URL') {
      const ps = paramNumbers(b.url);
      if (!isHttpUrl(b.url.replace(PARAM_RE, '').trim())) out.push({ field: `${f}.url`, message: `Button ${i + 1} needs a web address starting with https://.` });
      if (ps.length > 1 || (ps.length === 1 && !/\{\{\s*1\s*\}\}$/.test(b.url.trim()))) out.push({ field: `${f}.url`, message: `Button ${i + 1}: a link can have one {{1}}, at the very end.` });
      if (ps.length === 1 && !isHttpUrl(b.urlExample.trim())) out.push({ field: `${f}.urlExample`, message: `Button ${i + 1}: add a full sample link for the {{1}} part.` });
    } else if (!/^\+\d{7,15}$/.test(b.phone.replace(/[\s()-]/g, ''))) {
      out.push({ field: `${f}.phone`, message: `Button ${i + 1}: the phone number needs the country code, like +919876543210.` });
    }
  });
  return out;
}

/** A thrown API error's field problems, if it has any. */
export function problemsOf(e: unknown): FieldProblem[] {
  const d = (e as { data?: { problems?: FieldProblem[] } } | null)?.data;
  return Array.isArray(d?.problems) ? d!.problems! : [];
}
export const errorCode = (e: unknown) => String((e as { data?: { code?: string } } | null)?.data?.code || '');
export const errorText = (e: unknown, fallback = 'Please try again.') => (e instanceof Error && e.message) || fallback;
export const fieldError = (problems: FieldProblem[], field: string) => problems.find((p) => p.field === field)?.message || '';

/** Meta's rejection reasons for utility templates, in plain words. */
export const UTILITY_REASONS: Record<string, string> = {
  TAG_SHOULD_BE_MARKETING: 'Meta thinks it is marketing. Utility templates must be updates about an order, account, appointment or event.',
  INCORRECT_PARAMS: 'The placeholders are written wrongly: use {{1}}, {{2}}… only.',
  PARAMS_TO_WORD_RATIO_EXCEED_LIMIT: 'Too many placeholders for the length of the message. Add more words or use fewer placeholders.',
  ABUSIVE_CONTENT: 'Meta found content it considers abusive or threatening.',
  INVALID_FORMAT: 'The template format is not valid.',
};
export const utilityReason = (code: string) => (code ? UTILITY_REASONS[code] || code.replace(/_/g, ' ').toLowerCase() : '');
