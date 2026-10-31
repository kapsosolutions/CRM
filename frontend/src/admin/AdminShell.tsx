// Super-admin shell, laid out like the CRM (CrmShell): a black utility bar,
// the white top nav with the logo, an icon rail on the left and the active
// page in the content area. Only the content area scrolls.
//   Dashboard     → platform-wide stats
//   Businesses    → tenant list (drills into a business detail page)
//   Demo Requests → demos booked from the website
//   Free tier     → trials created by the admin
import { useState } from 'react';
import { DashboardPage } from './DashboardPage';
import { BusinessesPage } from './BusinessesPage';
import { BusinessDetailPage } from './BusinessDetailPage';
import { FreeTierPage } from './FreeTierPage';
import { DemoRequestsPage } from './DemoRequestsPage';
import { LogoutSvg } from '../crm/components/NavRail';
import { useLockWindowScroll } from '../crm/useLockWindowScroll';
import { useBackHandler } from '../crm/useBackHandler';

export type AdminView = 'dashboard' | 'businesses' | 'demos' | 'freeTier';

// Plans are bought in the CRM (Razorpay); there are no plan requests to handle.
const NAV: { key: AdminView; icon: string; label: string }[] = [
  { key: 'dashboard', icon: 'space_dashboard', label: 'Dashboard' },
  { key: 'businesses', icon: 'apartment', label: 'Businesses' },
  { key: 'demos', icon: 'event_available', label: 'Demo Requests' },
  { key: 'freeTier', icon: 'card_giftcard', label: 'Free tier' },
];

const today = () =>
  new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

export function AdminShell({ onLogout }: { onLogout: () => void }) {
  // Full-screen portal: the content pane scrolls, the window never moves.
  useLockWindowScroll();
  const [view, setView] = useState<AdminView>('dashboard');
  // When set, we're on the detail page for that business id.
  const [detailId, setDetailId] = useState<string | null>(null);
  // Bumped by Refresh: remounts the open page so it loads its data again.
  const [reloadKey, setReloadKey] = useState(0);

  function go(v: AdminView) {
    setDetailId(null);
    setView(v);
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
  // Back: a business's page closes first, then other tabs return to Dashboard.
  useBackHandler(view !== 'dashboard', () => go('dashboard'));
  useBackHandler(!!detailId, () => setDetailId(null));

  return (
    <div className="pa-shell">
      {/* Utility bar: same black strip as the CRM's top bar. */}
      <div className="pa-top-bar">
        <div className="pa-top-left">
          <span className="pa-top-badge">
            <span className="pa-top-dot" aria-hidden="true" />
            Super admin
          </span>
        </div>
        <div className="pa-top-center">
          Kapso Solutions <span className="pa-top-sep">·</span> <strong>Platform console</strong>
        </div>
        <div className="pa-top-right">{today()}</div>
      </div>

      {/* Main nav: logo left, actions right (as in the CRM). */}
      <header className="pa-main-nav">
        <button type="button" className="pa-main-nav-logo-btn" onClick={() => go('dashboard')} title="Dashboard">
          <img src="/logo.png" alt="Kapso Solutions" className="pa-main-nav-logo" />
          <span className="pa-main-nav-tag">Admin</span>
        </button>

        <div className="pa-main-nav-right">
          <a className="pa-nav-outline-btn" href="/#/" target="_blank" rel="noopener noreferrer" title="Open the website in a new tab">
            <span className="material-icons" aria-hidden="true">open_in_new</span>
            <span>Open website</span>
          </a>
          <div className="pa-nav-sep" />
          <button
            type="button"
            className="pa-nav-icon-btn"
            onClick={() => setReloadKey((k) => k + 1)}
            title="Refresh this page"
            aria-label="Refresh this page"
          >
            <span className="material-icons">refresh</span>
          </button>
          <div className="pa-nav-sep" />
          <div className="pa-nav-user" title="Signed in as the platform super admin">
            <span className="pa-nav-user-avatar" aria-hidden="true">A</span>
            <span className="pa-nav-user-text">
              <strong>Super admin</strong>
              <small>Platform owner</small>
            </span>
          </div>
          <button
            type="button"
            className="pa-nav-icon-btn logout"
            onClick={onLogout}
            title="Log out"
            aria-label="Log out"
            data-testid="pa-logout"
          >
            <LogoutSvg size={18} />
          </button>
        </div>
      </header>

      <div className="pa-body">
        <nav className="pa-rail" aria-label="Admin sections">
          {NAV.map((n) => (
            <button
              key={n.key}
              type="button"
              className={`pa-rail-btn${view === n.key ? ' active' : ''}`}
              onClick={() => go(n.key)}
              aria-label={n.label}
              aria-current={view === n.key ? 'page' : undefined}
              data-label={n.label}
            >
              <span className="material-icons" aria-hidden="true">{n.icon}</span>
              <span className="pa-rail-label">{n.label}</span>
            </button>
          ))}
        </nav>

        <main className="pa-main" key={reloadKey}>
          {view === 'dashboard' && <DashboardPage onOpenBusiness={openBusiness} />}
          {view === 'businesses' && !detailId && <BusinessesPage onOpen={openBusiness} />}
          {view === 'businesses' && detailId && (
            <BusinessDetailPage id={detailId} onBack={() => setDetailId(null)} />
          )}
          {view === 'demos' && <DemoRequestsPage />}
          {view === 'freeTier' && !detailId && <FreeTierPage onOpen={openTrial} />}
          {view === 'freeTier' && detailId && (
            <BusinessDetailPage id={detailId} onBack={() => setDetailId(null)} />
          )}
        </main>
      </div>
    </div>
  );
}
