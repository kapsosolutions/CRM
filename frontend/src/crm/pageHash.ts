// The open page lives in the URL hash, so a refresh (or a copied link) opens
// the same page instead of the first one:
//   CRM    #/              Chats       #/app/templates, #/app/form/pickup_request
//   demo   #/demo          Chats       #/demo/templates
//   admin  #/admin         Dashboard   #/admin/businesses, #/admin/businesses/<id>
// The hash is written with replaceState, keeping history.state, so the
// browser's Back keeps working through useBackHandler's own entries (a
// pushState here would read as "depth 0" and close every layer at once).
import { useEffect, useState } from 'react';
import type { CrmView } from './components/NavRail';
import { OTHER_FORMS, presetById } from './flowForms';

const CRM_PAGES: readonly CrmView[] = [
  'templates', 'campaigns', 'flows', 'catalog', 'categories', 'members', 'offers', 'orders',
  'ads', 'create', 'payment-config', 'profile', 'settings', 'channel-status',
];

const crmBase = (demo: boolean) => (demo ? '#/demo' : '#/');
const crmPrefix = (demo: boolean) => (demo ? '#/demo/' : '#/app/');

/** The CRM page a hash names, or null (Chats, or not a CRM page). */
export function viewFromHash(hash: string, demo: boolean): CrmView | null {
  const prefix = crmPrefix(demo);
  if (!hash.startsWith(prefix)) return null;
  const parts = hash.slice(prefix.length).split(/[?#]/)[0].split('/').map((p) => {
    try {
      return decodeURIComponent(p);
    } catch {
      return '';
    }
  });
  const [page, id] = parts;
  if (page === 'form' && id && (id === OTHER_FORMS || presetById(id))) return `form:${id}`;
  return (CRM_PAGES as readonly string[]).includes(page) ? (page as CrmView) : null;
}

const SUBMISSION_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** The form submission a hash opens (#/app/form/<form>/<submission id>), or null. */
export function formSubmissionFromHash(hash: string, demo: boolean): string | null {
  const prefix = crmPrefix(demo);
  if (!hash.startsWith(prefix)) return null;
  const [page, , sub] = hash.slice(prefix.length).split(/[?#]/)[0].split('/');
  if (page !== 'form' || !sub) return null;
  let id = '';
  try {
    id = decodeURIComponent(sub);
  } catch {
    return null;
  }
  return SUBMISSION_ID.test(id) ? id : null;
}

/** The hash for a CRM page (and, on a form page, the submission open on it). */
export function hashForView(view: CrmView, demo: boolean, submissionId?: string | null): string {
  if (view === 'chats') return crmBase(demo);
  if (view.startsWith('form:')) {
    const sub = submissionId && SUBMISSION_ID.test(submissionId) ? `/${encodeURIComponent(submissionId)}` : '';
    return `${crmPrefix(demo)}form/${encodeURIComponent(view.slice(5))}${sub}`;
  }
  return `${crmPrefix(demo)}${encodeURIComponent(view)}`;
}

/**
 * Keep the URL hash on `target`. `prefix` is what this area's page hashes
 * start with: the home page's hash (`target` without a page) only replaces a
 * page hash of the area, so an unrelated hash (#/login while signing out) is
 * left alone. Re-applied after Back / Forward, which can land on an older
 * history entry that still holds a previous page's URL.
 */
export function useHashSync(target: string, home: boolean, prefix: string) {
  const [popped, setPopped] = useState(0);
  useEffect(() => {
    const on = () => setPopped((n) => n + 1);
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  useEffect(() => {
    const now = window.location.hash;
    if (now === target) return;
    if (home && !now.startsWith(prefix)) return;
    try {
      window.history.replaceState(window.history.state, '', target);
    } catch {
      /* a sandboxed frame */
    }
  }, [target, home, prefix, popped]);
}

/** The CRM's current page → the URL hash. */
export function useCrmPageHash(view: CrmView, demo: boolean, submissionId?: string | null) {
  useHashSync(hashForView(view, demo, submissionId), view === 'chats', crmPrefix(demo));
}

// ---- Admin panel ----------------------------------------------------------

const ADMIN_PREFIX = '#/admin/';
const ID = /^[A-Za-z0-9_-]{1,64}$/;

/** The admin page (and business id) a hash names; Dashboard when it names none. */
export function adminFromHash<V extends string>(hash: string, views: readonly V[], home: V, withDetail: readonly V[]): { view: V; detailId: string | null } {
  if (!hash.startsWith(ADMIN_PREFIX)) return { view: home, detailId: null };
  const [page, id] = hash.slice(ADMIN_PREFIX.length).split(/[?#]/)[0].split('/');
  if (!(views as readonly string[]).includes(page)) return { view: home, detailId: null };
  const view = page as V;
  return { view, detailId: id && ID.test(id) && withDetail.includes(view) ? id : null };
}

/** The admin panel's current page → the URL hash. */
export function useAdminPageHash(view: string, detailId: string | null, home: string) {
  const target = view === home ? '#/admin' : `${ADMIN_PREFIX}${view}${detailId ? `/${encodeURIComponent(detailId)}` : ''}`;
  useHashSync(target, view === home, ADMIN_PREFIX);
}
