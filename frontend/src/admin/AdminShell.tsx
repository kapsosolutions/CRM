// Super-admin shell in the "Rocker" dark admin style: a sidebar with grouped
// sections (it collapses to icons, and becomes a drawer on small screens), a
// top bar with business search, refresh, today's demos and the admin, the
// page, and a footer. Only the page area scrolls; the window never moves.
//   Dashboard     → revenue, messages, plans
//   Businesses    → tenant list (drills into a business detail page)
//   Free tier     → trials created by the admin
//   Demo Requests → demos booked from the website
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { DashboardPage } from './DashboardPage';
import { BusinessesPage } from './BusinessesPage';
import { BusinessDetailPage } from './BusinessDetailPage';
import { FreeTierPage } from './FreeTierPage';
import { DemoRequestsPage } from './DemoRequestsPage';
import { platformApi } from './platformApi';
import {
  BellIcon, CalendarIcon, CollapseIcon, DashboardIcon, GlobeIcon, LogoutIcon, MenuIcon, RefreshIcon, SearchIcon, StoreIcon, TagIcon,
} from './AdminIcons';
import { useLockWindowScroll } from '../crm/useLockWindowScroll';
import { useBackHandler } from '../crm/useBackHandler';

export type AdminView = 'dashboard' | 'businesses' | 'demos' | 'freeTier';

// Plans are bought in the CRM (Razorpay); there are no plan requests to handle.
const GROUPS: { label?: string; items: { key: AdminView; label: string; icon: ReactNode }[] }[] = [
  { items: [{ key: 'dashboard', label: 'Dashboard', icon: <DashboardIcon /> }] },
  {
    label: 'Customers',
    items: [
      { key: 'businesses', label: 'Businesses', icon: <StoreIcon /> },
      { key: 'freeTier', label: 'Free tier', icon: <TagIcon /> },
    ],
  },
  { label: 'Sales', items: [{ key: 'demos', label: 'Demo Requests', icon: <CalendarIcon /> }] },
];

const COLLAPSED_KEY = 'pa_sidebar_collapsed';

export function AdminShell({ onLogout }: { onLogout: () => void }) {
  // Full-screen portal: the content pane scrolls, the window never moves.
  useLockWindowScroll();
  const [view, setView] = useState<AdminView>('dashboard');
  // When set, we're on the detail page for that business id.
  const [detailId, setDetailId] = useState<string | null>(null);
  // Bumped by Refresh: remounts the open page so it loads its data again.
  const [reloadKey, setReloadKey] = useState(0);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSED_KEY) === '1';
    } catch {
      return false;
    }
  });
  // Small screens: the sidebar is a drawer.
  const [drawer, setDrawer] = useState(false);
  const [search, setSearch] = useState('');
  const [searchRequest, setSearchRequest] = useState<{ q: string; n: number } | null>(null);
  // Demos still to do today (the bell).
  const [demosToday, setDemosToday] = useState(0);

  // Dialogs and toasts render outside the shell: the body class themes them too.
  useEffect(() => {
    document.body.classList.add('pa-dark');
    return () => document.body.classList.remove('pa-dark');
  }, []);

  useEffect(() => {
    let live = true;
    platformApi
      .listDemos('today', '')
      .then((r) => live && setDemosToday((r.data || []).filter((d) => d.status === 'scheduled').length))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [view, reloadKey]);

  function go(v: AdminView) {
    setDetailId(null);
    setView(v);
    setDrawer(false);
  }
  function openBusiness(id: string) {
    setDetailId(id);
    setView('businesses');
  }
  // Opening a trial from the Free tier list keeps you on that tab, so Back
  // returns to the trials rather than the full tenant list.
  function openTrial(id: string) {
    setDetailId(id);
    setView('freeTier');
  }
  function toggleCollapsed() {
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSED_KEY, c ? '0' : '1');
      } catch {
        /* private mode */
      }
      return !c;
    });
  }
  function submitSearch(e: FormEvent) {
    e.preventDefault();
    setDetailId(null);
    setView('businesses');
    setSearchRequest({ q: search.trim(), n: Date.now() });
    setDrawer(false);
  }

  // Back: the drawer closes first, then a business's page, then other tabs
  // return to Dashboard.
  useBackHandler(view !== 'dashboard', () => go('dashboard'));
  useBackHandler(!!detailId, () => setDetailId(null));
  useBackHandler(drawer, () => setDrawer(false));

  return (
    <div className={`pa-shell${collapsed ? ' collapsed' : ''}${drawer ? ' drawer-open' : ''}`}>
      <aside className="pa-sidebar" aria-label="Admin navigation">
        <div className="pa-brand">
          <button type="button" className="pa-brand-logo" onClick={() => go('dashboard')} title="Dashboard">
            <img src="/logo1.png" alt="Kapso Solutions" className="pa-brand-full" />
            <span className="pa-brand-mark" aria-hidden="true">K</span>
          </button>
          <button
            type="button"
            className="pa-collapse"
            onClick={toggleCollapsed}
            aria-label={collapsed ? 'Expand the menu' : 'Collapse the menu'}
            title={collapsed ? 'Expand the menu' : 'Collapse the menu'}
          >
            <CollapseIcon />
          </button>
        </div>

        <nav className="pa-menu">
          {GROUPS.map((g, gi) => (
            <div className="pa-menu-group" key={g.label || gi}>
              {g.label && <div className="pa-menu-label">{g.label}</div>}
              {g.items.map((it) => {
                const on = view === it.key;
                return (
                  <button
                    key={it.key}
                    type="button"
                    className={`pa-menu-item${on ? ' active' : ''}`}
                    onClick={() => go(it.key)}
                    aria-current={on ? 'page' : undefined}
                    title={collapsed ? it.label : undefined}
                    data-label={it.label}
                  >
                    <span className="pa-menu-icon" aria-hidden="true">{it.icon}</span>
                    <span className="pa-menu-text">{it.label}</span>
                    {it.key === 'demos' && demosToday > 0 && (
                      <span className="pa-menu-badge" aria-label={`${demosToday} today`}>{demosToday}</span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="pa-sidebar-foot">
          <a className="pa-menu-item" href="/#/" target="_blank" rel="noopener noreferrer" title={collapsed ? 'Open the website' : undefined}>
            <span className="pa-menu-icon" aria-hidden="true"><GlobeIcon /></span>
            <span className="pa-menu-text">Open website</span>
          </a>
          <button
            type="button"
            className="pa-menu-item logout"
            onClick={onLogout}
            data-testid="pa-logout"
            title={collapsed ? 'Log out' : undefined}
          >
            <span className="pa-menu-icon" aria-hidden="true"><LogoutIcon size={20} /></span>
            <span className="pa-menu-text">Log out</span>
          </button>
        </div>
      </aside>
      <div className="pa-drawer-backdrop" onClick={() => setDrawer(false)} aria-hidden="true" />

      <div className="pa-main-col">
        <header className="pa-topbar">
          <button type="button" className="pa-icon-btn pa-burger" onClick={() => setDrawer(true)} aria-label="Open the menu">
            <MenuIcon />
          </button>
          <form className="pa-top-search" role="search" onSubmit={submitSearch}>
            <SearchIcon />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search businesses…"
              aria-label="Search businesses by name, email or number"
            />
          </form>
          <div className="pa-topbar-right">
            <button
              type="button"
              className="pa-icon-btn"
              onClick={() => setReloadKey((k) => k + 1)}
              title="Refresh this page"
              aria-label="Refresh this page"
            >
              <RefreshIcon />
            </button>
            <button
              type="button"
              className="pa-icon-btn"
              onClick={() => go('demos')}
              title={demosToday ? `${demosToday} demo${demosToday === 1 ? '' : 's'} still to do today` : 'No demos left today'}
              aria-label={demosToday ? `Demo requests, ${demosToday} still to do today` : 'Demo requests'}
              data-testid="pa-bell"
            >
              <BellIcon />
              {demosToday > 0 && <span className="pa-dot-badge">{demosToday > 9 ? '9+' : demosToday}</span>}
            </button>
            <div className="pa-user" title="Signed in as the platform super admin">
              <span className="pa-user-avatar" aria-hidden="true">A</span>
              <span className="pa-user-text">
                <strong>Super admin</strong>
                <small>Platform owner</small>
              </span>
            </div>
          </div>
        </header>

        <main className="pa-main" key={reloadKey}>
          {view === 'dashboard' && <DashboardPage onOpenBusiness={openBusiness} />}
          {view === 'businesses' && !detailId && <BusinessesPage onOpen={openBusiness} searchRequest={searchRequest} />}
          {view === 'businesses' && detailId && (
            <BusinessDetailPage id={detailId} onBack={() => setDetailId(null)} />
          )}
          {view === 'demos' && <DemoRequestsPage />}
          {view === 'freeTier' && !detailId && <FreeTierPage onOpen={openTrial} />}
          {view === 'freeTier' && detailId && (
            <BusinessDetailPage id={detailId} onBack={() => setDetailId(null)} />
          )}
        </main>

        <footer className="pa-footer">Copyright © {new Date().getFullYear()} Kapso Solutions. All rights reserved.</footer>
      </div>
    </div>
  );
}
