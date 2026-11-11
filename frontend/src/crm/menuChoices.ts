// "What do you want to do on WhatsApp?": the question asked once after sign-up
// (MenuSetup.tsx), and again from the profile menu. Each answer turns on the
// sidebar pages it needs; what isn't picked stays out of the menu.
//
// Chats, Templates, Campaigns and Automation are always there. Nothing a
// customer sent is ever hidden: a form page with answers, or an Orders page
// with records, shows even when it wasn't picked (CrmShell).
import type { CrmView } from './components/NavRail';
import { formsFor } from './flowForms';
import type { VerticalConfig } from './verticals';

export interface MenuChoice {
  /** 'main' | 'book' | 'offers' | 'payments' | 'form:<preset id>' */
  id: string;
  label: string;
  hint: string;
  icon: string;
  /** The pages it turns on. */
  pages: CrmView[];
  /** Ticked when the business is asked for the first time. */
  recommended: boolean;
}

/** What's stored on the business: `picks` null = every page (not chosen yet, or "keep all"). */
export interface MenuState {
  picks: string[] | null;
  seen: boolean;
  /** Signed up after this question existed: it starts from the recommended set. */
  isNew?: boolean;
}

/** Always in the menu, whatever was picked. */
export const ALWAYS: CrmView[] = ['chats', 'templates', 'campaigns', 'flows', 'ads', 'create'];

const low = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const an = (w: string) => (/^[aeiou]/i.test(w) ? `an ${w}` : `a ${w}`);

// The forms a business type is asked about first (otherwise its first two).
const RECOMMENDED_FORMS: Record<string, string[]> = {
  it: ['project_enquiry', 'job_application'],
};

export function menuChoicesFor(v: VerticalConfig): MenuChoice[] {
  const out: MenuChoice[] = [];
  const who = low(v.customerPlural);
  const one = low(v.memberSingular);
  const cats = low(v.categoryPlural);
  const shopToo = v.showsPage('catalog');
  const bookToo = v.showsPage('members');

  if (shopToo) {
    out.push({
      id: 'main', icon: 'storefront', recommended: true,
      label: v.key === 'restaurant' ? 'Take food orders from my menu' : 'Sell from my catalog and take orders',
      hint: `Catalog, ${cats} and the ${v.ordersLabel} page`,
      pages: ['catalog', 'categories', 'orders'],
    });
    out.push({
      id: 'offers', icon: 'local_offer', recommended: false,
      label: 'Send offers and coupons', hint: 'The Offers page', pages: ['offers'],
    });
  }
  if (bookToo && v.archetype !== 'catalog') {
    const lead = v.archetype === 'lead';
    out.push({
      id: 'main', icon: lead ? 'contact_support' : 'event_available', recommended: true,
      label: lead
        ? `Get enquiries for my ${cats}`
        : `${v.ordersLabel}: ${who} book ${an(one)}`,
      hint: `${v.categoryPlural}, ${v.memberLabel} and the ${v.ordersLabel} page`,
      pages: ['categories', 'members', 'orders'],
    });
  }
  // "Other / Generic" has both: a shop and bookings with its team.
  if (bookToo && v.archetype === 'catalog') {
    out.push({
      id: 'book', icon: 'event_available', recommended: false,
      label: `Bookings with my ${low(v.memberLabel)}`, hint: `${v.memberLabel} with their hours, booked on the ${v.ordersLabel} page`,
      pages: ['members', 'categories', 'orders'],
    });
  }
  const pays = v.archetype !== 'lead' && v.archetype !== 'notify';
  out.push({
    id: 'payments', icon: 'payments', recommended: pays,
    label: 'Collect payments in WhatsApp', hint: 'The Payment Configuration page (WhatsApp Pay)',
    pages: ['payment-config'],
  });

  const own = formsFor(v).own;
  const rec = new Set(RECOMMENDED_FORMS[v.key] || own.slice(0, 2).map((p) => p.id));
  for (const p of own) {
    out.push({
      id: `form:${p.id}`, icon: p.icon, recommended: rec.has(p.id),
      label: p.title, hint: 'A WhatsApp form, with its own page for the answers', pages: [],
    });
  }
  return out;
}

/** The picks a business starts from: recommended for a new one, everything for one that had all pages. */
export function startingPicks(v: VerticalConfig, menu: MenuState | null | undefined): string[] {
  const all = menuChoicesFor(v);
  if (menu?.picks) return menu.picks.filter((id) => all.some((c) => c.id === id));
  if (menu?.isNew) return all.filter((c) => c.recommended).map((c) => c.id);
  return all.map((c) => c.id);
}

/**
 * The pages to show, and the form pages picked (null = every form page).
 * `picks` null means nothing was chosen: the business type's full set.
 */
export function menuPages(v: VerticalConfig, picks: string[] | null | undefined): { pages: CrmView[]; forms: Set<string> | null } {
  if (!picks) return { pages: v.pages, forms: null };
  const on = new Set<CrmView>(ALWAYS);
  const choices = menuChoicesFor(v);
  for (const id of picks) for (const p of choices.find((c) => c.id === id)?.pages || []) on.add(p);
  const forms = new Set(picks.filter((id) => id.startsWith('form:')).map((id) => id.slice(5)));
  return { pages: v.pages.filter((p) => on.has(p)), forms };
}
