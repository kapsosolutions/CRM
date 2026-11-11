// Ready-made WhatsApp journeys (Automation → Journeys → Templates), chosen by
// the business category: a shop gets catalog → cart → order journeys, a
// clinic gets specialisation → doctor → date & time → booking journeys, and
// every business gets an FAQ menu and a "talk to the team" journey.
//
// Each card builds a whole graph from the Journeys blocks (FlowsPage.tsx),
// worded for the business ("Doctors", "Room types", "See the menu"). Using
// one replaces the canvas; nothing reaches customers until it's published.
import type { VerticalConfig } from './verticals';
import type { CrmView } from './components/NavRail';

/** A block on the canvas, as the Journeys builder stores it. */
export interface JourneyTemplateNode {
  id: string;
  type: 'wa';
  position: { x: number; y: number };
  data: { kind: string; [k: string]: unknown };
}
export interface JourneyTemplateEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle: string | null;
}
export interface BuiltJourney {
  name: string;
  nodes: JourneyTemplateNode[];
  edges: JourneyTemplateEdge[];
}
export interface JourneyTemplateCard {
  id: string;
  title: string;
  description: string;
  /** Material icon ligature. */
  icon: string;
  /** What the customer goes through, in order (the card's tags). */
  steps: string[];
  build: () => BuiltJourney;
}

/** Lays the blocks out on a grid (col, row); "Organize" tidies it after. */
class Graph {
  nodes: JourneyTemplateNode[] = [];
  edges: JourneyTemplateEdge[] = [];
  add(id: string, data: JourneyTemplateNode['data'], col: number, row = 0): string {
    this.nodes.push({ id, type: 'wa', position: { x: 60 + col * 300, y: 180 + row * 150 }, data });
    return id;
  }
  link(source: string, target: string, handle = '') {
    this.edges.push({ id: `e-${source}-${handle || 'out'}-${target}`, source, target, sourceHandle: handle || null });
  }
  done(name: string): BuiltJourney {
    return { name, nodes: this.nodes, edges: this.edges };
  }
}

// ---- Wording -----------------------------------------------------------------
const low = (s: string) => s.toLowerCase();
const WELCOME = 'Hi {{name}} 👋 Welcome to {{business_name}}!';
const TALK_TEXT = 'Sure! Type your question here and our team will reply shortly. 🙂';
const TIMINGS_TEXT = '🕘 We’re open Monday to Saturday, 9 am to 8 pm. (Change this to your own hours.)';
const shopLabel = (v: VerticalConfig) => (v.key === 'restaurant' ? 'See the menu' : v.key === 'grocery' ? 'Order groceries' : 'Shop now');
const bookLabel = (v: VerticalConfig) => (v.key === 'it' ? 'Book a meeting' : v.archetype === 'unit' ? 'Check availability' : v.archetype === 'lead' ? 'Book a visit' : 'Book appointment');
const bookBlockTitle = (v: VerticalConfig) => (v.key === 'it' ? 'Book a meeting' : v.archetype === 'unit' ? 'Confirm booking' : v.archetype === 'lead' ? 'Book a visit' : 'Book appointment');

// ---- Block data (the same defaults the palette gives) ------------------------
const msg = (text: string) => ({ kind: 'message', header: 'none', text });
const reply = (text: string, buttons: string[]) => ({ kind: 'reply', header: 'none', text, buttons });
const list = (text: string, options: string[], listTitle = 'Menu') => ({ kind: 'list', text, listTitle, options });
const categories = (v: VerticalConfig) => ({ kind: 'categories', text: `Please choose a ${low(v.categoryLabel)}:`, listTitle: 'Choose' });
const members = (v: VerticalConfig) => ({ kind: 'members', text: `Please choose a ${low(v.memberSingular)}:`, listTitle: 'Choose' });
const slots = () => ({ kind: 'slots', text: 'Pick a day for {{member}}:', listTitle: 'Pick a day', days: 7 });
const book = () => ({
  kind: 'book',
  text: '✅ Booked: {{member}} on {{appointment_date}} at {{appointment_slot}}.\nYour reference: {{order_id}}\nSee you soon, {{name}}!',
  failText: 'Sorry, that time was just taken. Please pick another time.',
});
const catalog = (all = false) => ({ kind: 'catalog', text: 'Browse and add what you like to your cart, then send it to us 🛒', catalogCategory: all ? '*' : '' });
const placeOrder = () => ({ kind: 'order', text: '✅ Order {{order_id}} placed!\n{{cart_items}}\nTotal: {{total_payable}}\nWe’ll message you when it’s on its way.' });
const offers = () => ({ kind: 'offers', text: '🎉 Our offers right now:' });
const call = () => ({ kind: 'call', header: 'none', text: 'Tap below to call us.', callText: 'Call us', callPhone: '' });
const START = { kind: 'start' };
const END = { kind: 'end' };
const RESTART = { kind: 'restart' };

// ---- The booking chain: [category →] member → date & time → booking ----------
/** Adds the chain from column `col`; returns its first block. */
function bookingChain(g: Graph, v: VerticalConfig, col: number, row: number, withCategory: boolean, prefix = 'b'): string {
  const ids: string[] = [];
  let c = col;
  if (withCategory && v.showsPage('categories')) ids.push(g.add(`${prefix}cat`, categories(v), c++, row));
  ids.push(g.add(`${prefix}mem`, members(v), c++, row));
  ids.push(g.add(`${prefix}when`, slots(), c++, row));
  const bk = g.add(`${prefix}book`, book(), c++, row);
  ids.push(bk);
  for (let i = 0; i < ids.length - 1; i += 1) g.link(ids[i], ids[i + 1], 'pick');
  g.link(g.add(`${prefix}none`, msg('Sorry, there are no free times in the next few days. Reply here and we’ll find one for you.'), c - 1, row + 1), g.add(`${prefix}nend`, END, c, row + 1));
  g.link(`${prefix}when`, `${prefix}none`, 'none');
  g.link(bk, g.add(`${prefix}ok`, END, c, row), 'ok');
  // Not booked (the time was taken): ask again from the top.
  g.link(bk, g.add(`${prefix}again`, RESTART, c, row - 1 >= 0 ? row - 1 : row + 2), 'full');
  return ids[0];
}

/** The shop chain: [category →] catalog → cart → place order. Returns its first block. */
function shopChain(g: Graph, v: VerticalConfig, col: number, row: number, withCategory: boolean, prefix = 's'): string {
  let first = '';
  let c = col;
  if (withCategory && v.showsPage('categories')) {
    first = g.add(`${prefix}cat`, categories(v), c++, row);
  }
  const cat = g.add(`${prefix}catalog`, catalog(!first), c++, row);
  if (first) g.link(first, cat, 'pick');
  const end = g.add(`${prefix}end`, END, c + 1, row);
  if (v.showsPage('orders')) {
    const ord = g.add(`${prefix}order`, placeOrder(), c, row);
    g.link(cat, ord, 'cart');
    g.link(ord, end);
  } else {
    const thanks = g.add(`${prefix}thanks`, msg('Thanks! We’ve received your cart and will confirm it shortly.'), c, row);
    g.link(cat, thanks, 'cart');
    g.link(thanks, end);
  }
  return first || cat;
}

// ---- Cards -------------------------------------------------------------------
function faq(): JourneyTemplateCard {
  return {
    id: 'jt_faq',
    title: 'FAQ menu',
    description: 'A menu of common questions with an answer for each, then “Anything else?”.',
    icon: 'quiz',
    steps: ['Welcome', 'FAQ list', 'Answer', 'Anything else?'],
    build: () => {
      const g = new Graph();
      g.add('start', START, 0);
      g.add('menu', list(`${WELCOME}\nHow can we help you today?`, ['Timings', 'Location', 'Prices', 'Talk to us'], 'Choose'), 1);
      g.link('start', 'menu');
      const answers = [
        msg(TIMINGS_TEXT),
        msg('📍 You can find us at: (add your address and a map link here).'),
        msg('💰 Our prices: (add your price list here, or a link to it).'),
        msg(TALK_TEXT),
      ];
      answers.forEach((a, i) => {
        g.add(`a${i}`, a, 2, i);
        g.link('menu', `a${i}`, `opt-${i}`);
      });
      g.add('more', reply('Anything else we can help with?', ['Main menu', 'That’s all']), 3, 1);
      [0, 1, 2].forEach((i) => g.link(`a${i}`, 'more'));
      g.link('a3', g.add('talkend', END, 3, 3));
      g.link('more', g.add('again', RESTART, 4, 0), 'btn-0');
      g.link('more', g.add('bye', msg('Thank you, {{name}}! Have a great day 😊'), 4, 2), 'btn-1');
      g.link('bye', g.add('end', END, 5, 2));
      return g.done('FAQ menu');
    },
  };
}

function contact(): JourneyTemplateCard {
  return {
    id: 'jt_contact',
    title: 'Talk to the team',
    description: 'Welcomes the customer and offers a call button or a chat with your team.',
    icon: 'support_agent',
    steps: ['Welcome', 'Call or chat', 'Your team replies'],
    build: () => {
      const g = new Graph();
      g.add('start', START, 0);
      g.add('ask', reply(`${WELCOME}\nWould you like to call us or chat here?`, ['Call us', 'Chat here']), 1);
      g.link('start', 'ask');
      g.link('ask', g.add('call', call(), 2, 0), 'btn-0');
      g.link('ask', g.add('chat', msg(TALK_TEXT), 2, 1), 'btn-1');
      g.link('call', g.add('end1', END, 3, 0));
      g.link('chat', g.add('end2', END, 3, 1));
      return g.done('Talk to the team');
    },
  };
}

function shopCards(v: VerticalConfig): JourneyTemplateCard[] {
  const out: JourneyTemplateCard[] = [];
  const hasCats = v.showsPage('categories');
  const ordered = v.showsPage('orders') ? 'Place order' : 'Cart received';
  out.push({
    id: 'jt_shop',
    title: v.key === 'restaurant' ? 'Order food from the menu' : 'Order from your catalog',
    description: hasCats
      ? `The customer picks a ${low(v.categoryLabel)}, browses its products, sends the cart and gets the order confirmed.`
      : 'The customer browses your catalog, sends the cart and gets the order confirmed.',
    icon: v.key === 'restaurant' ? 'restaurant_menu' : 'shopping_bag',
    steps: ['Welcome', ...(hasCats ? [v.categoryPlural] : []), 'Catalog', 'Cart', ordered],
    build: () => {
      const g = new Graph();
      g.add('start', START, 0);
      g.add('hi', msg(`${WELCOME} Let’s get your order started.`), 1);
      g.link('start', 'hi');
      g.link('hi', shopChain(g, v, 2, 0, true));
      return g.done(v.key === 'restaurant' ? 'Order food' : 'Order from the catalog');
    },
  });
  if (hasCats) {
    out.push({
      id: 'jt_shop_direct',
      title: 'Straight to the catalog',
      description: `No ${low(v.categoryLabel)} step: the customer sees every product at once.`,
      icon: 'storefront',
      steps: ['Catalog', 'Cart', ordered],
      build: () => {
        const g = new Graph();
        g.add('start', START, 0);
        g.link('start', shopChain(g, v, 1, 0, false));
        return g.done('Straight to the catalog');
      },
    });
  }
  if (v.showsPage('offers')) {
    out.push({
      id: 'jt_offers',
      title: 'Offers first',
      description: 'Sends your live offers, then “Shop now” opens the catalog and “Talk to us” hands over to your team.',
      icon: 'local_offer',
      steps: ['Offers', 'Shop now or talk', 'Catalog', 'Cart', ordered],
      build: () => {
        const g = new Graph();
        g.add('start', START, 0);
        g.add('offers', offers(), 1);
        g.add('ask', reply('Would you like to order?', [shopLabel(v), 'Talk to us']), 2);
        g.link('start', 'offers');
        g.link('offers', 'ask');
        g.link('ask', shopChain(g, v, 3, 0, false), 'btn-0');
        g.link('ask', g.add('talk', msg(TALK_TEXT), 3, 2), 'btn-1');
        g.link('talk', g.add('tend', END, 4, 2));
        return g.done('Offers first');
      },
    });
  }
  out.push({
    id: 'jt_shop_menu',
    title: v.key === 'restaurant' ? 'Full restaurant menu' : 'Full store menu',
    description: `${shopLabel(v)}${v.showsPage('offers') ? ', offers' : ''}, timings and talk to us, in one menu.`,
    icon: 'menu_book',
    steps: ['Welcome menu', shopLabel(v), ...(v.showsPage('offers') ? ['Offers'] : []), 'Timings', 'Talk to us'],
    build: () => {
      const g = new Graph();
      const opts = [shopLabel(v), ...(v.showsPage('offers') ? ['Offers'] : []), 'Timings', 'Talk to us'];
      g.add('start', START, 0);
      g.add('menu', list(`${WELCOME}\nWhat would you like to do?`, opts, 'Menu'), 1);
      g.link('start', 'menu');
      let i = 0;
      g.link('menu', shopChain(g, v, 2, 0, true), `opt-${i++}`);
      if (v.showsPage('offers')) {
        g.link('menu', g.add('offers', offers(), 2, 2), `opt-${i++}`);
        g.link('offers', g.add('oagain', RESTART, 3, 2));
      }
      g.link('menu', g.add('timings', msg(TIMINGS_TEXT), 2, 3), `opt-${i++}`);
      g.link('timings', g.add('tend', END, 3, 3));
      g.link('menu', g.add('talk', msg(TALK_TEXT), 2, 4), `opt-${i++}`);
      g.link('talk', g.add('kend', END, 3, 4));
      return g.done(v.key === 'restaurant' ? 'Restaurant menu' : 'Store menu');
    },
  });
  return out;
}

function bookingCards(v: VerticalConfig): JourneyTemplateCard[] {
  const out: JourneyTemplateCard[] = [];
  const hasCats = v.showsPage('categories');
  const booked = v.showsPage('orders') ? bookBlockTitle(v) : 'Booking request';
  out.push({
    id: 'jt_book',
    title: hasCats ? `${bookLabel(v)} · ${low(v.categoryLabel)} → ${low(v.memberSingular)}` : bookLabel(v),
    description: `${hasCats ? `${v.categoryLabel} → ` : ''}${v.memberSingular.toLowerCase()} → a free day and time → booked on ${v.ordersLabel}, with a confirmation.`,
    icon: 'event_available',
    steps: ['Welcome', ...(hasCats ? [v.categoryPlural] : []), v.memberLabel, 'Date & time', booked],
    build: () => {
      const g = new Graph();
      g.add('start', START, 0);
      g.add('hi', msg(`${WELCOME} Let’s find you a time.`), 1);
      g.link('start', 'hi');
      g.link('hi', bookingChain(g, v, 2, 1, true));
      return g.done(bookLabel(v));
    },
  });
  if (hasCats) {
    out.push({
      id: 'jt_book_direct',
      title: `Book by ${low(v.memberSingular)}`,
      description: `No ${low(v.categoryLabel)} step: the customer picks a ${low(v.memberSingular)} straight away.`,
      icon: 'person_search',
      steps: [v.memberLabel, 'Date & time', booked],
      build: () => {
        const g = new Graph();
        g.add('start', START, 0);
        g.link('start', bookingChain(g, v, 1, 1, false));
        return g.done(`Book by ${low(v.memberSingular)}`);
      },
    });
  }
  out.push({
    id: 'jt_book_menu',
    title: 'Full menu',
    description: `${bookLabel(v)}, our timings and talk to us, as three buttons.`,
    icon: 'menu_book',
    steps: ['Welcome buttons', bookLabel(v), 'Timings', 'Talk to us'],
    build: () => {
      const g = new Graph();
      g.add('start', START, 0);
      g.add('ask', reply(`${WELCOME}\nHow can we help you today?`, [bookLabel(v), 'Our timings', 'Talk to us']), 1, 1);
      g.link('start', 'ask');
      g.link('ask', bookingChain(g, v, 2, 1, true), 'btn-0');
      g.link('ask', g.add('timings', msg(TIMINGS_TEXT), 2, 3), 'btn-1');
      g.link('timings', g.add('tend', END, 3, 3));
      g.link('ask', g.add('talk', msg(TALK_TEXT), 2, 4), 'btn-2');
      g.link('talk', g.add('kend', END, 3, 4));
      return g.done('Main menu');
    },
  });
  return out;
}

/** The ready-made journeys for this business category, most useful first. */
export function journeyTemplatesFor(v: VerticalConfig): JourneyTemplateCard[] {
  const shows = (p: CrmView) => v.showsPage(p);
  const out: JourneyTemplateCard[] = [];
  if (shows('members')) out.push(...bookingCards(v));
  if (shows('catalog')) out.push(...shopCards(v));
  out.push(faq(), contact());
  return out;
}

/** The block kinds a card uses (for its plan crown). */
export const kindsOf = (card: JourneyTemplateCard): string[] => [...new Set(card.build().nodes.map((n) => n.data.kind))];
