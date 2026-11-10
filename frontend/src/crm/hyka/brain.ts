// Hyka AI: builds a WhatsApp Flow from a conversation.
//
// It is our own engine, with no outside AI service: lexicon.ts reads what the
// business types, and the flow itself is made by the same generator as the
// ready-made templates (flowTemplates.ts), so every flow Hyka builds is one
// that's known to be valid and wired. The conversation works out which
// journey the business wants (orders, bookings, a form, a full menu), asks
// each choice that journey has in the business's own words, then the extra
// menu items and their links, then a name, and shows a summary to publish.
//
// Everything here is pure: a state and a message in, a new state and Hyka's
// messages out. HykaChat.tsx renders it and does the saving and publishing.
import {
  buildTemplate, checkTemplateFlow, choicesFor, extrasFor, isLinkKind, LINK_INFO, linkProblem, MAX_EXTRAS, optionsFor,
  templateCardsFor, type BuiltTemplate, type ChoiceDef, type LinkKind, type TemplateCard, type TemplateOptions,
} from '../flowTemplates';
import { formsFor, presetById } from '../flowForms';
import type { VerticalConfig } from '../verticals';
import {
  COMMANDS, EXTRAS, find, FORM_WORDS, hasHit, MAINS, phrases, sameWord, scoreOf, SETTINGS, WEAK, words, YES_NO,
  type Hit, type Phrase,
} from './lexicon';

export const HYKA_NAME = 'Hyka AI';

export interface HykaChip {
  id: string;
  label: string;
  icon?: string;
  /** The recommended answer, or the main action. */
  primary?: boolean;
  /** Multi-select: picked. */
  on?: boolean;
}
export interface HykaSummary {
  name: string;
  title: string;
  icon: string;
  steps: string[];
  menu: string[];
  screens: number;
  /** Data the flow lists that the business hasn't added yet. */
  warnings: { text: string; page?: string; pageLabel?: string }[];
  /** Other setup. */
  needs: string[];
}
export interface HykaMsg {
  id: string;
  from: 'bot' | 'user';
  text: string;
  chips?: HykaChip[];
  /** Pick several of these, then Done. */
  multi?: { options: HykaChip[]; max: number };
  summary?: HykaSummary;
  tone?: 'ok' | 'warn' | 'error';
  issues?: string[];
}
export interface HykaInput {
  text?: string;
  chip?: string;
  picks?: string[];
}
export interface HykaCtx {
  v: VerticalConfig;
  businessName?: string;
  /** null = not known. */
  counts: { categories: number | null; members: number | null; products: number | null };
  /** Signed in with the master password: may open the builder. */
  staff: boolean;
}

type Stage = 'goal' | 'choiceA' | 'extras' | 'choiceB' | 'link' | 'name' | 'ready';
interface Core {
  stage: Stage;
  cardId: string;
  /** A form card made on the spot (a common form the gallery has no card for). */
  formCard: TemplateCard | null;
  opts: TemplateOptions | null;
  answered: string[];
  /** The choice key or link kind being asked. */
  asking: string;
  name: string;
  seq: number;
}
export interface HykaState extends Core {
  history: Core[];
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// ---------------------------------------------------------------------------
// The business type's journeys
// ---------------------------------------------------------------------------
function cardsOf(v: VerticalConfig) {
  const cards = templateCardsFor(v);
  const full = cards.find((c) => c.id.endsWith('_full')) || null;
  const rest = cards.filter((c) => c !== full);
  return {
    cards,
    full,
    order: rest.find((c) => c.main.kind === 'order') || null,
    booking: rest.find((c) => c.main.kind === 'booking') || null,
    track: rest.find((c) => c.main.kind === 'track') || null,
  };
}

/** Every form this business can have: its own, then the common ones. */
function formIds(v: VerticalConfig): string[] {
  const { own, common } = formsFor(v);
  return [...own, ...common].map((p) => p.id);
}

function cardForForm(v: VerticalConfig, presetId: string): TemplateCard {
  const found = cardsOf(v).cards.find((c) => !c.id.endsWith('_full') && c.main.kind === 'form' && c.main.form === presetId);
  if (found) return found;
  const p = presetById(presetId);
  return {
    id: `form_${presetId}`,
    title: p?.title || presetId,
    description: `The “${p?.title || presetId}” form.`,
    icon: p?.icon || 'assignment',
    main: { kind: 'form', form: presetId },
    defaults: { categoryStep: false },
  };
}

function cardOf(s: Core, v: VerticalConfig): TemplateCard | null {
  if (s.formCard && s.formCard.id === s.cardId) return s.formCard;
  return cardsOf(v).cards.find((c) => c.id === s.cardId) || null;
}

const orderWord = (v: VerticalConfig) => (v.key === 'restaurant' ? 'Food orders' : v.key === 'grocery' ? 'Grocery orders' : 'Orders');
const bookWord = (v: VerticalConfig) =>
  v.key === 'hotel' ? 'Room bookings' : v.key === 'rooms' ? 'Space bookings' : v.key === 'events' ? 'Venue bookings'
    : v.key === 'gym' ? 'Session bookings' : v.archetype === 'unit' ? 'Bookings' : 'Appointments';

/** The journeys offered as quick answers to "what should customers do?". */
export function goalChips(v: VerticalConfig): HykaChip[] {
  const c = cardsOf(v);
  const out: HykaChip[] = [];
  if (c.order) out.push({ id: 'goal:order', label: orderWord(v), icon: 'shopping_bag' });
  if (c.booking) out.push({ id: 'goal:booking', label: bookWord(v), icon: 'event_available' });
  if (c.track) out.push({ id: 'goal:track', label: 'Order tracking', icon: 'local_shipping' });
  const seen = new Set<string>();
  for (const card of c.cards) {
    if (card === c.full || card.main.kind !== 'form' || seen.has(card.main.form)) continue;
    seen.add(card.main.form);
    out.push({ id: `goal:form:${card.main.form}`, label: presetById(card.main.form)?.title || card.title, icon: card.icon });
  }
  if (c.full) out.push({ id: 'goal:full', label: `${c.full.title} (everything)`, icon: c.full.icon, primary: true });
  return out;
}

function example(v: VerticalConfig): string {
  const mem = lower(v.memberSingular);
  if (v.archetype === 'catalog') {
    return v.key === 'restaurant'
      ? 'Customers order food for delivery, pay online or cash, and can track their order'
      : 'Customers shop from my catalog, pay online or cash on delivery, and see their orders';
  }
  if (v.archetype === 'person') return `${v.customerPlural} book an appointment with a ${mem}, pay at the visit, and get a PDF slip`;
  if (v.archetype === 'unit') return `${v.customerPlural} book a ${mem} and pay online, with our location and a call button`;
  const own = formsFor(v).own[0];
  return own ? `A ${lower(own.title)} form, with a call button and our location in the menu` : 'An enquiry form with a call button';
}

// ---------------------------------------------------------------------------
// Reading the business's words
// ---------------------------------------------------------------------------
const phraseCache = new Map<string, Phrase[]>();
/** Everything Hyka can recognise for this business type. */
function vocabulary(v: VerticalConfig): Phrase[] {
  const cached = phraseCache.get(v.key);
  if (cached) return cached;
  const c = cardsOf(v);
  const table: Record<string, string[]> = { ...SETTINGS };
  if (c.full) table.full = MAINS.full;
  if (c.order) table['main:order'] = MAINS['main:order'];
  if (c.booking) table['main:booking'] = MAINS['main:booking'];
  // Extra menu items any of this business's journeys can have.
  const extraIds = new Set(c.cards.flatMap((card) => extrasFor(card, v).map((x) => x.id)));
  if (c.track) extraIds.add('track');
  for (const [id, list] of Object.entries(EXTRAS)) if (extraIds.has(id)) table[`extra:${id}`] = list;
  for (const id of formIds(v)) {
    const p = presetById(id);
    table[`form:${id}`] = [...(FORM_WORDS[id] || []), ...(p ? [p.title, p.heading] : [])];
  }
  // The business's own words for its categories and members.
  table['category:yes'] = [
    `${v.categoryLabel} first`, `pick ${v.categoryLabel}`, `choose ${v.categoryLabel}`, `by ${v.categoryLabel}`,
    'category first', 'pick category', 'choose category',
  ];
  table['member:yes'] = [`pick ${v.memberSingular}`, `choose ${v.memberSingular}`, `select ${v.memberSingular}`, `which ${v.memberSingular}`];
  const list = phrases(table, WEAK);
  phraseCache.set(v.key, list);
  return list;
}
const YN = phrases(YES_NO);
const CMD = phrases(COMMANDS);

/** Yes, no, or neither. "No need" is no even though it has a yes-ish word. */
export function yesNo(text: string): boolean | null {
  const hits = find(text, YN);
  if (hasHit(hits, 'no')) return false;
  if (hasHit(hits, 'yes')) return true;
  return null;
}
function command(text: string): string | null {
  const t = words(text);
  // Only short messages are commands: "go back to cash on delivery" isn't "back".
  if (!t.length || t.length > 4) return null;
  const hits = find(text, CMD);
  return hits.length ? hits[0].concept : null;
}

interface Settings {
  pay?: TemplateOptions['pay'];
  confirm?: TemplateOptions['confirm'];
  mode?: TemplateOptions['mode'];
  address?: TemplateOptions['address'];
  deliveryTime?: boolean;
  categoryStep?: boolean;
  memberStep?: boolean;
}
function settingsOf(hits: Hit[], v: VerticalConfig): Settings {
  const s: Settings = {};
  const on = (c: string) => hasHit(hits, c);
  if (on('pay:both') || (on('pay:online') && on('pay:cash'))) s.pay = 'both';
  else if (on('pay:none')) s.pay = 'none';
  else if (on('pay:online')) s.pay = 'online';
  else if (on('pay:cash')) s.pay = 'cash';
  if (on('confirm:pdf')) s.confirm = 'pdf';
  else if (on('confirm:message')) s.confirm = 'message';
  const modes = (['delivery', 'takeaway', 'dinein'] as const).filter((m) => on(`mode:${m}`) && (m !== 'dinein' || v.key === 'restaurant'));
  if (modes.length > 1) s.mode = 'choose';
  else if (modes.length === 1) s.mode = modes[0];
  if (on('address:pin')) s.address = 'pin';
  else if (on('address:typed')) s.address = 'typed';
  if (on('time:yes')) s.deliveryTime = true;
  if (on('category:yes')) s.categoryStep = true;
  if (on('member:yes')) {
    s.memberStep = true;
    s.categoryStep = s.categoryStep ?? true;
  }
  return s;
}

/** Apply the settings this card has; returns the keys it set. */
function applySettings(card: TemplateCard, v: VerticalConfig, o: TemplateOptions, s: Settings): string[] {
  const set: string[] = [];
  // Twice: setting the mode or the category step can bring in more choices.
  for (let pass = 0; pass < 2; pass += 1) {
    const keys = new Set(choicesFor(card, v, o).map((c) => c.key as string));
    for (const [k, val] of Object.entries(s)) {
      if (val === undefined || !keys.has(k) || set.includes(k)) continue;
      (o as unknown as Record<string, unknown>)[k] = val;
      set.push(k);
    }
  }
  return set;
}

function extraHits(hits: Hit[]): string[] {
  return [...new Set(hits.filter((h) => h.concept.startsWith('extra:')).map((h) => h.concept.slice(6)))];
}
/** Forms mentioned, best first. A form needs a whole phrase, not one vague word. */
function formHits(hits: Hit[], strong = 1): string[] {
  const score = new Map<string, number>();
  for (const h of hits) {
    if (!h.concept.startsWith('form:')) continue;
    const id = h.concept.slice(5);
    score.set(id, (score.get(id) || 0) + h.weight);
  }
  return [...score.entries()].filter(([, s]) => s >= strong).sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

function addExtras(card: TemplateCard, v: VerticalConfig, o: TemplateOptions, ids: string[]): string[] {
  const allowed = extrasFor(card, v).map((x) => x.id);
  const added: string[] = [];
  for (const id of ids) {
    if (!allowed.includes(id) || o.extras.includes(id) || o.extras.length >= MAX_EXTRAS) continue;
    o.extras.push(id);
    added.push(id);
  }
  o.extras.sort((a, b) => allowed.indexOf(a) - allowed.indexOf(b));
  return added;
}

const extraLabel = (card: TemplateCard, v: VerticalConfig, id: string) => extrasFor(card, v).find((x) => x.id === id)?.label || id;

interface Goal {
  card: TemplateCard;
  opts: TemplateOptions;
  answered: string[];
}
/** What journey the message asks for, with whatever choices it already says. */
function readGoal(text: string, v: VerticalConfig): Goal | { maybe: HykaChip[] } | null {
  const hits = find(text, vocabulary(v));
  const c = cardsOf(v);
  const orderScore = scoreOf(hits, 'main:order');
  const bookScore = scoreOf(hits, 'main:booking');
  const forms = formHits(hits);
  const extras = extraHits(hits);
  let card: TemplateCard | null = null;
  const more: string[] = [];

  if (hasHit(hits, 'full') && c.full) card = c.full;
  else if (orderScore >= 1 && c.order) {
    card = c.order;
    if (bookScore >= 1) more.push('book');
  } else if (bookScore >= 1 && c.booking) {
    card = c.booking;
    if (orderScore >= 1) more.push('order');
  } else if (extras.includes('track') && c.track && !forms.length) card = c.track;
  else if (forms.length) card = cardForForm(v, forms[0]);

  if (!card) {
    // Only vague words: offer the journeys they could mean.
    const weak = formHits(hits, 0.5);
    const maybe = goalChips(v).filter((g) =>
      weak.some((f) => g.id === `goal:form:${f}`)
      || (g.id === 'goal:order' && orderScore > 0) || (g.id === 'goal:booking' && bookScore > 0));
    return maybe.length ? { maybe } : null;
  }
  const chosen = card;
  const opts = optionsFor(chosen);
  const answered = applySettings(chosen, v, opts, settingsOf(hits, v));
  const mainForm = chosen.main.kind === 'form' ? chosen.main.form : '';
  addExtras(chosen, v, opts, [
    ...more,
    ...extras.filter((x) => !(x === 'track' && chosen.main.kind === 'track')),
    ...forms.filter((f) => f !== mainForm).map((f) => `form:${f}`),
  ]);
  return { card: chosen, opts, answered };
}

function goalFromChip(id: string, v: VerticalConfig): Goal | null {
  const c = cardsOf(v);
  let card: TemplateCard | null = null;
  if (id === 'goal:full') card = c.full;
  else if (id === 'goal:order') card = c.order;
  else if (id === 'goal:booking') card = c.booking;
  else if (id === 'goal:track') card = c.track;
  else if (id.startsWith('goal:form:')) card = cardForForm(v, id.slice(10));
  return card ? { card, opts: optionsFor(card), answered: [] } : null;
}

// ---------------------------------------------------------------------------
// The questions
// ---------------------------------------------------------------------------
function recommended(c: ChoiceDef, o: TemplateOptions, ctx: HykaCtx): string {
  // No categories or members yet: a list of them would be empty.
  if (c.key === 'categoryStep' && ctx.counts.categories === 0) return 'no';
  if (c.key === 'memberStep' && ctx.counts.members === 0) return 'no';
  const val = o[c.key];
  if (c.kind === 'bool') return val ? 'yes' : 'no';
  return String(val);
}

function question(c: ChoiceDef, o: TemplateOptions, ctx: HykaCtx): string {
  const { v, counts } = ctx;
  const cat = lower(v.categoryLabel);
  const cats = lower(v.categoryPlural);
  const mem = lower(v.memberSingular);
  switch (c.key) {
    case 'mode':
      return 'How do customers get their order?';
    case 'categoryStep': {
      const n = counts.categories;
      const tail = n === null ? '' : n === 0
        ? ` You haven’t added any ${cats} yet, so I’d say **No** for now (the list would be empty).`
        : ` You have ${plural(n, cat, cats)}.`;
      return `Should ${lower(v.customerPlural)} pick a ${cat} first?${tail}`;
    }
    case 'memberStep': {
      const n = counts.members;
      const many = lower(v.memberLabel);
      const tail = n === null ? '' : n === 0 ? ` You haven’t added any ${many} yet, so I’d say **No**.` : ` You have ${plural(n, mem, many)}.`;
      return `After the ${cat}, should they choose a ${mem}?${tail}`;
    }
    case 'address':
      return 'How should I take the delivery address?';
    case 'deliveryTime':
      return o.mode === 'takeaway' ? 'Should customers choose a pickup time?' : 'Should customers choose a delivery time?';
    case 'personal':
      return `Should I ask the ${lower(v.customerLabel)}’s age and gender?`;
    case 'pay':
      return 'How do customers pay?';
    case 'confirm':
      return 'When it’s done, what should they get on WhatsApp?';
    case 'design':
      return 'Which design should the PDF slip have?';
    case 'restart':
      return o.extras.length
        ? 'After the last message, add a “Main menu” button so they can do something else?'
        : 'After the last message, add a “Start again” button?';
    default:
      return `${c.label}?`;
  }
}

const HELP: Record<string, string> = {
  mode: 'Delivery brings the order to them, pickup means they collect it, and “Customer chooses” lets them pick each time.',
  categoryStep: 'With this on, the flow first lists your categories, then only what’s in the one they pick.',
  memberStep: 'With this on, after the category they pick from your list (a doctor, agent, room type, course…).',
  address: 'A location pin is one tap in WhatsApp. A typed address also asks for a landmark.',
  deliveryTime: 'They pick a time window, and it’s shown on the order.',
  personal: 'Two more questions on the booking form.',
  extraQuestions: 'The questions businesses like yours usually ask on a booking.',
  pay: '“Pay online” uses WhatsApp Pay. Paying later means cash, at the counter or at the visit.',
  confirm: 'A PDF slip looks like a receipt they can keep or show.',
  design: 'Only the look of the PDF changes.',
  restart: 'Lets them go back to the start without typing anything.',
};

function choiceChips(c: ChoiceDef, o: TemplateOptions, ctx: HykaCtx): HykaChip[] {
  const rec = recommended(c, o, ctx);
  if (c.kind === 'bool') return [{ id: 'yes', label: 'Yes', primary: rec === 'yes' }, { id: 'no', label: 'No', primary: rec === 'no' }];
  return (c.options || []).map((x) => ({ id: x.value, label: x.label, primary: x.value === rec }));
}

const KEY_WORDS: Record<string, Record<string, string[]>> = {
  mode: {
    choose: ['customer chooses', 'they choose', 'choose', 'both', 'all', 'any', 'all three', 'every way', 'let them pick'],
    delivery: SETTINGS['mode:delivery'],
    takeaway: SETTINGS['mode:takeaway'],
    dinein: SETTINGS['mode:dinein'],
  },
  pay: { both: SETTINGS['pay:both'], none: SETTINGS['pay:none'], online: SETTINGS['pay:online'], cash: SETTINGS['pay:cash'] },
  confirm: { pdf: SETTINGS['confirm:pdf'], message: SETTINGS['confirm:message'] },
  address: {
    none: ['dont ask', 'no address', 'skip', 'none', 'not needed', 'no'],
    pin: [...SETTINGS['address:pin'], 'location', 'map'],
    typed: [...SETTINGS['address:typed'], 'address', 'write', 'manually'],
  },
};
const keyPhrases = new Map<string, Phrase[]>();
function keyVocab(key: string): Phrase[] | null {
  if (!KEY_WORDS[key]) return null;
  if (!keyPhrases.has(key)) keyPhrases.set(key, phrases(KEY_WORDS[key]));
  return keyPhrases.get(key) || null;
}

const ORDINALS: Record<string, number> = {
  first: 0, '1': 0, one: 0, second: 1, '2': 1, two: 1, third: 2, '3': 2, three: 2, fourth: 3, '4': 3, four: 3,
};

/** The answer to choice `c`, or undefined if the message isn't one. */
function answerOf(c: ChoiceDef, input: HykaInput, o: TemplateOptions, ctx: HykaCtx): string | boolean | undefined {
  const opts = c.options || [];
  if (input.chip) {
    if (c.kind === 'bool') return input.chip === 'yes' ? true : input.chip === 'no' ? false : undefined;
    return opts.some((x) => x.value === input.chip) ? input.chip : undefined;
  }
  const text = input.text || '';
  const rec = recommended(c, o, ctx);
  if (command(text) === 'recommended') return c.kind === 'bool' ? rec === 'yes' : rec;
  if (c.kind === 'bool') {
    const yn = yesNo(text);
    if (yn !== null) return yn;
    // "department first please" answers "pick a department first?".
    const said = (settingsOf(find(text, vocabulary(ctx.v)), ctx.v) as Record<string, unknown>)[c.key as string];
    return typeof said === 'boolean' ? said : undefined;
  }
  const vocab = keyVocab(c.key as string);
  if (vocab) {
    const hits = find(text, vocab);
    if (c.key === 'pay' && hasHit(hits, 'online') && hasHit(hits, 'cash')) return 'both';
    if (c.key === 'mode') {
      const modes = ['delivery', 'takeaway', 'dinein'].filter((m) => hasHit(hits, m) && opts.some((x) => x.value === m));
      if (modes.length > 1) return 'choose';
    }
    const best = hits.find((h) => opts.some((x) => x.value === h.concept));
    if (best) return best.concept;
  }
  const t = words(text);
  if (t.length === 1 && t[0] in ORDINALS && opts[ORDINALS[t[0]]]) return opts[ORDINALS[t[0]]].value;
  // The option whose label the message is closest to.
  let pick: { value: string; score: number } | null = null;
  for (const x of opts) {
    const lw = words(x.label);
    if (!lw.length) continue;
    const matched = lw.filter((w) => t.some((tw) => sameWord(tw, w))).length;
    const score = matched / lw.length;
    if (matched && (!pick || score > pick.score)) pick = { value: x.value, score };
  }
  return pick && pick.score >= 0.5 ? pick.value : undefined;
}

function describe(c: ChoiceDef, val: unknown): string {
  if (c.kind === 'bool') return val ? 'yes' : 'no';
  return lower(c.options?.find((x) => x.value === val)?.label || String(val));
}

// ---------------------------------------------------------------------------
// The conversation
// ---------------------------------------------------------------------------
const core = (s: HykaState | Core): Core => {
  const { history: _history, ...rest } = s as HykaState;
  return JSON.parse(JSON.stringify(rest)) as Core;
};

function msg(s: Core, m: Omit<HykaMsg, 'id' | 'from'>): HykaMsg {
  s.seq += 1;
  return { id: `h${s.seq}`, from: 'bot', ...m };
}

const blank = (seq = 0): Core => ({ stage: 'goal', cardId: '', formCard: null, opts: null, answered: [], asking: '', name: '', seq });

export function hykaStart(ctx: HykaCtx, seq = 0, lead = ''): { state: HykaState; msgs: HykaMsg[] } {
  const s = blank(seq);
  const who = ctx.businessName ? ` for **${ctx.businessName}**` : '';
  const hello = lead || `Hi, I’m ${HYKA_NAME} 👋 I’ll build your WhatsApp flow${who}, step by step.`;
  const msgs = [
    msg(s, {
      text: `${hello}\n\nTell me in your own words what your ${lower(ctx.v.customerPlural)} should be able to do. For example: “${example(ctx.v)}”.\n\nOr pick one:`,
      chips: goalChips(ctx.v),
    }),
  ];
  return { state: { ...s, history: [] }, msgs };
}

/**
 * What the journey is, in plain words. Not the card's title: "Book appointment
 * · department → doctor" stops being true once the department step is off.
 */
function goalLabel(card: TemplateCard, v: VerticalConfig): string {
  if (card.id.endsWith('_full')) return card.title;
  if (card.main.kind === 'order') return orderWord(v);
  if (card.main.kind === 'booking') return bookWord(v);
  if (card.main.kind === 'track') return 'Order tracking';
  return presetById(card.main.form)?.title || card.title;
}

function suggestedName(card: TemplateCard, o: TemplateOptions, v: VerticalConfig): string {
  const label = goalLabel(card, v);
  if (card.id.endsWith('_full') || !o.extras.length) return label;
  return `${label} & more`.slice(0, 60);
}

function understood(card: TemplateCard, o: TemplateOptions, answered: string[], ctx: HykaCtx): string {
  const choices = choicesFor(card, ctx.v, o);
  const parts = answered
    .map((k) => choices.find((x) => x.key === k))
    .filter((c): c is ChoiceDef => !!c)
    .map((c) => `${lower(c.label)}: ${describe(c, o[c.key])}`);
  const menu = o.extras.map((x) => extraLabel(card, ctx.v, x));
  let text = `Got it. I’ll build your **${goalLabel(card, ctx.v)}** flow`;
  // A full menu's description lists its menu; the others' describe defaults
  // that the questions below may change.
  if (card.id.endsWith('_full')) text += ` (${lower(card.description).replace(/\.$/, '')})`;
  text += '.';
  if (parts.length) text += `\nFrom what you said: ${parts.join(', ')}.`;
  if (menu.length) text += `\nIn the menu as well: ${menu.join(', ')}.`;
  return `${text}\n\nA few quick questions so it works the way you want.`;
}

function extrasMsg(s: Core, ctx: HykaCtx, lead: string): HykaMsg {
  const card = cardOf(s, ctx.v) as TemplateCard;
  const o = s.opts as TemplateOptions;
  const options = extrasFor(card, ctx.v).map((x) => ({ id: x.id, label: x.label, icon: x.icon, on: o.extras.includes(x.id) }));
  const has = o.extras.map((x) => extraLabel(card, ctx.v, x));
  const main = goalLabel(card, ctx.v);
  const ask = has.length
    ? `The flow opens on a menu with “${main}” and: ${has.join(', ')}. Add or remove items (up to ${MAX_EXTRAS}), then tap **Done**.`
    : `Should the flow open on a menu with more things to do? Pick any (up to ${MAX_EXTRAS}) and tap **Done**, or tap **Done** for just “${main}”.`;
  return msg(s, { text: lead ? `${lead}\n\n${ask}` : ask, multi: { options, max: MAX_EXTRAS } });
}

function linkMsg(s: Core, k: LinkKind, lead: string): HykaMsg {
  const info = LINK_INFO[k];
  const what = info.valueLabel.startsWith('Google') ? info.valueLabel : lower(info.valueLabel);
  const ask = `For “${info.title}” in the menu: what’s your ${what}?\n${info.hint}`;
  return msg(s, { text: lead ? `${lead}\n\n${ask}` : ask, chips: [{ id: 'skip', label: 'Leave it out', icon: 'remove_circle_outline' }] });
}

/** Ask whatever comes next, after `lead` (what was just understood). */
function askNext(s: Core, ctx: HykaCtx, lead = ''): HykaMsg[] {
  const card = cardOf(s, ctx.v) as TemplateCard;
  const o = s.opts as TemplateOptions;
  const pre = (t: string) => (lead ? `${lead}\n\n${t}` : t);
  for (let guard = 0; guard < 10; guard += 1) {
    if (s.stage === 'choiceA' || s.stage === 'choiceB') {
      const next = choicesFor(card, ctx.v, o).find((c) => !s.answered.includes(c.key) && (s.stage === 'choiceB' || c.key !== 'restart'));
      if (next) {
        s.asking = next.key;
        return [msg(s, { text: pre(question(next, o, ctx)), chips: choiceChips(next, o, ctx) })];
      }
      s.stage = s.stage === 'choiceA' ? 'extras' : 'link';
    } else if (s.stage === 'extras') {
      s.asking = 'extras';
      return [extrasMsg(s, ctx, lead)];
    } else if (s.stage === 'link') {
      const k = o.extras.find((x) => isLinkKind(x) && !!linkProblem(x, o.links[x])) as LinkKind | undefined;
      if (k) {
        s.asking = k;
        return [linkMsg(s, k, lead)];
      }
      s.stage = s.answered.includes('name') ? 'ready' : 'name';
    } else if (s.stage === 'name') {
      s.asking = 'name';
      if (!s.name) s.name = suggestedName(card, o, ctx.v);
      return [msg(s, {
        text: pre('Last one: what should I call this flow? Only you see the name. Type a name, or keep mine:'),
        chips: [{ id: 'keep', label: s.name, primary: true, icon: 'check' }],
      })];
    } else {
      s.asking = '';
      return [summaryMsg(s, ctx, lead)];
    }
  }
  return [];
}

// ---------------------------------------------------------------------------
// The flow and its summary
// ---------------------------------------------------------------------------
/** The flow as it stands, built by the template generator. */
export function hykaBuild(s: HykaState | Core, ctx: HykaCtx): { built: BuiltTemplate; problems: string[]; card: TemplateCard } | null {
  const card = cardOf(s, ctx.v);
  if (!card || !s.opts) return null;
  const built = buildTemplate(card, ctx.v, s.opts);
  if (s.name) built.flow.name = s.name;
  return { built, problems: checkTemplateFlow(built.flow), card };
}

function summaryOf(s: Core, ctx: HykaCtx, built: BuiltTemplate, card: TemplateCard): HykaSummary {
  const { v, counts } = ctx;
  const o = s.opts as TemplateOptions;
  const flow = built.flow;
  const menu = flow.screens.find((x) => x.id === 'WELCOME')?.components.find((c) => c.name === 'menu_choice')?.options?.map((x) => x.title) || [];
  const uses = (src: string) => flow.screens.some((x) => x.components.some((c) => c.source === src));
  const warnings: HykaSummary['warnings'] = [];
  const cats = lower(v.categoryPlural);
  if (uses('categories') && counts.categories === 0) {
    warnings.push({
      text: `You have no ${cats} yet. Add at least 1, or customers see “Nothing here yet” at that step.`,
      page: 'categories', pageLabel: `Add ${cats}`,
    });
  }
  if (uses('members') && counts.members === 0) {
    warnings.push({
      text: `You have no ${lower(v.memberLabel)} yet. Add at least 1, or the list customers pick from is empty.`,
      page: 'members', pageLabel: `Add ${lower(v.memberLabel)}`,
    });
  }
  const orders = card.main.kind === 'order' || o.extras.includes('order');
  if (orders && counts.products === 0) {
    warnings.push({ text: 'Your catalog has no products yet. Add them so customers have something to order.', page: 'catalog', pageLabel: 'Open Catalog' });
  }
  const needs = built.needs.filter((n) => !/^Publish the flow/.test(n) && !/^Add your .+ on the .+ page$/.test(n)
    && !(/catalog/i.test(n) && counts.products !== null && counts.products > 0));
  return { name: s.name || flow.name, title: goalLabel(card, v), icon: card.icon, steps: built.steps, menu, screens: flow.screens.length, warnings, needs };
}

function summaryMsg(s: Core, ctx: HykaCtx, lead: string): HykaMsg {
  const b = hykaBuild(s, ctx);
  if (!b || b.problems.length) {
    return msg(s, {
      text: `${lead ? `${lead}\n\n` : ''}Something in this combination doesn’t build into a valid flow, so I won’t publish it. Tap **Start over** and try different choices.`,
      tone: 'error', issues: b?.problems || [], chips: [{ id: 'reset', label: 'Start over', icon: 'restart_alt' }],
    });
  }
  const chips = summaryChips(ctx);
  const ask = 'Here’s your flow. Tap **Continue to publish** and I’ll build it and put it live on WhatsApp. To change something, just tell me (for example “pay online”, “add our location”, “remove call”).';
  return msg(s, { text: lead ? `${lead}\n\n${ask}` : ask, summary: summaryOf(s, ctx, b.built, b.card), chips });
}

// ---------------------------------------------------------------------------
// Each stage's answer
// ---------------------------------------------------------------------------
function onGoal(s: Core, ctx: HykaCtx, input: HykaInput): HykaMsg[] {
  const { v } = ctx;
  const text = input.text || '';
  const g = input.chip ? goalFromChip(input.chip, v) : readGoal(text, v);
  if (!g) {
    const hi = /^(hi|hii+|hello|hey|hlo|namaste|good (morning|afternoon|evening))\b/i.test(text.trim());
    return [msg(s, {
      text: hi
        ? 'Hello! 😊 What should your customers be able to do on WhatsApp? Describe it, or pick one:'
        : `I couldn’t match that to a flow I can build for a ${lower(v.label)} business. Try saying it another way (for example “${example(v)}”), or pick one:`,
      chips: goalChips(v),
    })];
  }
  if ('maybe' in g) return [msg(s, { text: 'Did you mean one of these?', chips: [...g.maybe, { id: 'goal:full', label: 'Show everything', icon: 'apps' }] })];
  const known = cardsOf(v).cards.some((c) => c.id === g.card.id);
  s.cardId = g.card.id;
  s.formCard = known ? null : g.card;
  s.opts = g.opts;
  s.answered = g.answered;
  s.stage = 'choiceA';
  return askNext(s, ctx, understood(g.card, g.opts, g.answered, ctx));
}

function onChoice(s: Core, ctx: HykaCtx, input: HykaInput): HykaMsg[] {
  const card = cardOf(s, ctx.v) as TemplateCard;
  const o = s.opts as TemplateOptions;
  const c = choicesFor(card, ctx.v, o).find((x) => x.key === s.asking);
  if (!c) return askNext(s, ctx);
  const ans = answerOf(c, input, o, ctx);
  if (ans === undefined) {
    return [msg(s, {
      text: `Sorry, I didn’t catch that. ${HELP[c.key] || ''}\n\n${question(c, o, ctx)}`,
      chips: choiceChips(c, o, ctx),
    })];
  }
  (o as unknown as Record<string, unknown>)[c.key] = ans;
  s.answered.push(c.key);
  let lead = `✓ ${c.label}: ${describe(c, ans)}.`;
  // "Online, with a PDF slip" answers the next question too.
  if (input.text) {
    const more = applySettings(card, ctx.v, o, settingsOf(find(input.text, vocabulary(ctx.v)), ctx.v))
      .filter((k) => k !== c.key && !s.answered.includes(k));
    const all = choicesFor(card, ctx.v, o);
    for (const k of more) {
      s.answered.push(k);
      const d = all.find((x) => x.key === k);
      if (d) lead += `\n✓ ${d.label}: ${describe(d, o[d.key])}.`;
    }
  }
  return askNext(s, ctx, lead);
}

/** Menu items (and forms) a message names. */
function mentionedExtras(text: string, card: TemplateCard, ctx: HykaCtx): string[] {
  const hits = find(text, vocabulary(ctx.v));
  const mainForm = card.main.kind === 'form' ? card.main.form : '';
  const allowed = extrasFor(card, ctx.v).map((x) => x.id);
  const ids = [...extraHits(hits), ...formHits(hits).filter((f) => f !== mainForm).map((f) => `form:${f}`)];
  if (scoreOf(hits, 'main:order') >= 1) ids.push('order');
  if (scoreOf(hits, 'main:booking') >= 1) ids.push('book');
  return [...new Set(ids)].filter((id) => allowed.includes(id));
}

function onExtras(s: Core, ctx: HykaCtx, input: HykaInput): HykaMsg[] {
  const card = cardOf(s, ctx.v) as TemplateCard;
  const o = s.opts as TemplateOptions;
  const allowed = extrasFor(card, ctx.v).map((x) => x.id);
  const finish = () => {
    s.stage = 'choiceB';
    const labels = o.extras.map((x) => extraLabel(card, ctx.v, x));
    const main = goalLabel(card, ctx.v);
    return askNext(s, ctx, labels.length ? `✓ Menu: “${main}”, ${labels.join(', ')}.` : `✓ No menu: the flow opens straight on “${main}”.`);
  };
  if (input.picks || input.chip === 'done') {
    if (input.picks) o.extras = input.picks.filter((id) => allowed.includes(id)).slice(0, MAX_EXTRAS).sort((a, b) => allowed.indexOf(a) - allowed.indexOf(b));
    return finish();
  }
  const text = input.text || '';
  const ids = mentionedExtras(text, card, ctx);
  const yn = yesNo(text);
  if (!ids.length) {
    if (yn === false || command(text) === 'done') return finish();
    return [extrasMsg(s, ctx, 'Sorry, I didn’t catch which items you mean. Tap them below, or type their names (for example “location and call”).')];
  }
  let lead: string;
  if (yn === false) {
    o.extras = o.extras.filter((x) => !ids.includes(x));
    lead = `Removed: ${ids.map((x) => extraLabel(card, ctx.v, x)).join(', ')}.`;
  } else {
    const added = addExtras(card, ctx.v, o, ids);
    lead = added.length
      ? `Added: ${added.map((x) => extraLabel(card, ctx.v, x)).join(', ')}.`
      : o.extras.length >= MAX_EXTRAS ? `The menu is full (${MAX_EXTRAS} items at most).` : 'Those are already in the menu.';
  }
  return [extrasMsg(s, ctx, `${lead} Anything else?`)];
}

/** The link or phone number in a message, made https:// where it's a link. */
export function valueIn(kind: LinkKind, text: string): string {
  const t = text.trim();
  if (kind === 'call') {
    const m = t.match(/\+?\d[\d\s()-]{6,}\d/);
    return m ? m[0].trim() : '';
  }
  const m = t.match(/https?:\/\/[^\s]+/i) || t.match(/\b(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s]*)?/i);
  if (!m) return '';
  const url = m[0].replace(/[),.]+$/, '');
  return /^https?:\/\//i.test(url) ? url.replace(/^http:\/\//i, 'https://') : `https://${url}`;
}

function onLink(s: Core, ctx: HykaCtx, input: HykaInput): HykaMsg[] {
  const o = s.opts as TemplateOptions;
  const k = s.asking as LinkKind;
  const info = LINK_INFO[k];
  const text = input.text || '';
  const value = input.chip ? '' : valueIn(k, text);
  if (input.chip === 'skip' || (!value && (yesNo(text) === false || command(text) === 'done'))) {
    o.extras = o.extras.filter((x) => x !== k);
    return askNext(s, ctx, `✓ Left “${info.title}” out of the menu.`);
  }
  const det = { ...info.defaults, ...(o.links[k] || {}), value };
  const problem = value ? linkProblem(k, det) : (k === 'call' ? 'That doesn’t look like a phone number.' : 'That doesn’t look like a link.');
  if (problem) return [linkMsg(s, k, `${problem} ${info.hint}`)];
  o.links = { ...o.links, [k]: det };
  return askNext(s, ctx, `✓ “${info.title}” will send ${value}.`);
}

function cleanName(text: string): string {
  return text
    .replace(/^\s*(please\s+)?(call|name|rename|title)\s+(it|this|the flow)?\s*(as|to)?\s*[:-]?\s*/i, '')
    .replace(/^["“'‘]+|["”'’.]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

function onName(s: Core, ctx: HykaCtx, input: HykaInput): HykaMsg[] {
  const text = input.text || '';
  const keep = input.chip === 'keep' || yesNo(text) === true || command(text) === 'recommended';
  if (!keep) {
    const name = cleanName(text);
    if (!name) return askNext(s, ctx, 'The name can’t be empty.');
    s.name = name;
  }
  s.answered.push('name');
  s.stage = 'ready';
  return askNext(s, ctx, `✓ Named “${s.name}”.`);
}

/** Changes typed after the summary: "pay online", "add location", "remove call", "name it …". */
function onReady(s: Core, ctx: HykaCtx, input: HykaInput): { msgs: HykaMsg[]; action?: 'publish' } {
  const card = cardOf(s, ctx.v) as TemplateCard;
  const o = s.opts as TemplateOptions;
  const text = input.text || '';
  if (command(text) === 'publish' || (yesNo(text) === true && words(text).length <= 2)) return { msgs: [], action: 'publish' };
  const changes: string[] = [];
  const named = text.match(/\b(?:call|name|rename)\s+(?:it|this|the flow)\s+(.+)$/i);
  if (named && cleanName(named[1])) {
    s.name = cleanName(named[1]);
    changes.push(`name: “${s.name}”`);
  } else {
    const set = applySettings(card, ctx.v, o, settingsOf(find(text, vocabulary(ctx.v)), ctx.v));
    const all = choicesFor(card, ctx.v, o);
    for (const k of set) {
      const d = all.find((x) => x.key === k);
      if (d) changes.push(`${lower(d.label)}: ${describe(d, o[d.key])}`);
    }
    const ids = mentionedExtras(text, card, ctx);
    if (ids.length && yesNo(text) === false) {
      o.extras = o.extras.filter((x) => !ids.includes(x));
      changes.push(`removed ${ids.map((x) => extraLabel(card, ctx.v, x)).join(', ')}`);
    } else if (ids.length) {
      const added = addExtras(card, ctx.v, o, ids);
      if (added.length) changes.push(`added ${added.map((x) => extraLabel(card, ctx.v, x)).join(', ')}`);
    }
  }
  if (!changes.length) {
    return {
      msgs: [msg(s, {
        text: 'I didn’t find anything to change in that. You can say things like “pay online”, “send a PDF slip”, “add our location”, “remove call” or “name it Bookings”. Or tap **Continue to publish**.',
        chips: summaryChips(ctx),
      })],
    };
  }
  // A new Location / Call / Brochure / Website item needs its link first.
  s.stage = 'link';
  return { msgs: askNext(s, ctx, `✓ Updated: ${changes.join('; ')}.`) };
}

function summaryChips(ctx: HykaCtx): HykaChip[] {
  const chips: HykaChip[] = [{ id: 'act:publish', label: 'Continue to publish', icon: 'rocket_launch', primary: true }];
  if (ctx.staff) chips.push({ id: 'act:builder', label: 'Open in builder', icon: 'account_tree' });
  chips.push({ id: 'reset', label: 'Start over', icon: 'restart_alt' });
  return chips;
}

/** Re-ask what this state is waiting for (after "back" or "help"). */
function reask(s: Core, ctx: HykaCtx, lead: string): HykaMsg[] {
  if (s.stage === 'goal') return [msg(s, { text: `${lead}\n\nWhat should your customers be able to do on WhatsApp?`, chips: goalChips(ctx.v) })];
  return askNext(s, ctx, lead);
}

/** Hyka's reply to one message or tap. `action` asks the chat to publish. */
export function hykaReply(state: HykaState, ctx: HykaCtx, input: HykaInput): { state: HykaState; msgs: HykaMsg[]; action?: 'publish' } {
  const before = core(state);
  const s = core(state);
  const text = (input.text || '').trim();
  const cmd = input.chip === 'reset' ? 'reset' : input.chip ? null : command(text);

  if (cmd === 'reset') {
    const fresh = hykaStart(ctx, s.seq, 'Sure, let’s start again.');
    return { state: { ...fresh.state, history: [...state.history, before] }, msgs: fresh.msgs };
  }
  if (cmd === 'back') {
    const prev = state.history[state.history.length - 1];
    if (!prev) return { state, msgs: reask(s, ctx, 'We’re at the start already.') };
    const restored = { ...core(prev), seq: s.seq };
    const msgs = reask(restored, ctx, 'Okay, one step back.');
    return { state: { ...restored, history: state.history.slice(0, -1) }, msgs };
  }
  if (cmd === 'help' && s.stage !== 'goal') {
    return { state: { ...s, history: state.history }, msgs: reask(s, ctx, HELP[s.asking] || 'Answer the question below, or type “back” to go one step back, or “start over”.') };
  }

  let msgs: HykaMsg[];
  let action: 'publish' | undefined;
  if (s.stage === 'goal') msgs = onGoal(s, ctx, input);
  else if (s.stage === 'choiceA' || s.stage === 'choiceB') msgs = onChoice(s, ctx, input);
  else if (s.stage === 'extras') msgs = onExtras(s, ctx, input);
  else if (s.stage === 'link') msgs = onLink(s, ctx, input);
  else if (s.stage === 'name') msgs = onName(s, ctx, input);
  else ({ msgs, action } = onReady(s, ctx, input));

  // Only a turn that changed something can be stepped back over.
  const same = JSON.stringify({ ...before, seq: 0 }) === JSON.stringify({ ...s, seq: 0 });
  return { state: { ...s, history: same ? state.history : [...state.history, before] }, msgs, action };
}
