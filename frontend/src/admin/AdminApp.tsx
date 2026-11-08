// Top-level router for the multi-tenant host. Hash routes come first:
//   #/admin            → super-admin panel (admin login gate)
//   #/demo             → demo CRM (in-memory, no backend)
//   #/login, #/register, #/app/…, #/privacy …  as before
// Then the path: the website's pages (/pricing, /product/…, /docs …, see
// site/SiteRoutes.tsx) show for everyone, signed in or not. At "/":
//   signed-in business → the CRM
//   otherwise          → the landing page
import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { platformApi } from './platformApi';
import { useConfirm } from '../crm/components/Dialogs';
import { exitApp, resetBackHandler, useBackHandler } from '../crm/useBackHandler';
import { LandingPage } from '../site/LandingPage';
import { LoginPage, RegisterPage, GoogleReturn, AuthCard, Field, useSignedOutReason } from '../site/AuthPages';
import { TermsPage, PrivacyPage, RefundPage, DataDeletionPage } from '../site/LegalPages';
import { readOAuthReturn } from '../site/siteApi';
import { NAV_EVENT, useSitePath } from '../site/siteNav';
import { Redirect, SiteRoutes } from '../site/SiteRoutes';
import { DesktopOnly } from '../site/DesktopOnly';
import '../site/site.css';
import './admin.css';

// The CRM and the admin panel are most of the app's code. They are downloaded
// only when someone opens them, so the landing, login and register pages load
// fast. After a deploy, an open tab whose old files are gone reloads itself
// (see main.tsx).
const CrmShell = lazy(() => import('../crm/components/CrmShell').then((m) => ({ default: m.CrmShell })));
const AdminShell = lazy(() => import('./AdminShell').then((m) => ({ default: m.AdminShell })));

// If the download fails (offline, or a deploy happened twice within a minute),
// say so and offer a reload instead of leaving a blank page.
class LoadFailed extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="app-loading" role="alert">
        <div className="app-load-failed">
          <strong>Couldn’t load this page</strong>
          <p>Something went wrong. Check your internet connection, then reload.</p>
          <button type="button" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}

function Loading({ children }: { children: ReactNode }) {
  return (
    <LoadFailed>
      <Suspense
        fallback={
          <div className="app-loading" role="status" aria-label="Loading">
            <span className="app-loading-spinner" />
          </div>
        }
      >
        {children}
      </Suspense>
    </LoadFailed>
  );
}

function useHashRoute() {
  const [hash, setHash] = useState(window.location.hash || '');
  useEffect(() => {
    const on = () => setHash(window.location.hash || '');
    window.addEventListener('hashchange', on);
    window.addEventListener('popstate', on);
    // A website link (navigate()) can drop the hash: /#/register → /pricing.
    window.addEventListener(NAV_EVENT, on);
    return () => {
      window.removeEventListener('hashchange', on);
      window.removeEventListener('popstate', on);
      window.removeEventListener(NAV_EVENT, on);
    };
  }, []);
  return hash.replace(/^#/, '');
}

function AdminLoginPage({
  onSignedIn,
}: {
  onSignedIn: (token: string) => void;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const signedOut = useSignedOutReason();

  return (
    <AuthCard
      title="Admin Sign In"
      subtitle="Sign in to platform management & tenant controls"
      imageSrc="/login.png"
      imageAlt="Platform Admin Portal"
      imageSide="left"
    >
      {signedOut && <div className="au-alert">{signedOut}</div>}
      {error && <div className="au-alert" role="alert">{error}</div>}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!username.trim() || !password) {
            setError('Enter your admin username and password.');
            return;
          }
          setBusy(true);
          setError('');
          try {
            const r = await platformApi.adminLogin(username.trim(), password);
            onSignedIn(r.token);
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Login failed');
          } finally {
            setBusy(false);
          }
        }}
        noValidate
      >
        <Field
          label="Admin Username"
          value={username}
          onChange={setUsername}
          autoComplete="username"
          placeholder="admin"
        />
        <Field
          label="Password"
          value={password}
          onChange={setPassword}
          type="password"
          autoComplete="current-password"
          placeholder="••••••••"
        />
        <div className="au-switch-link">
          Client workspace? <a href="#/login">Client Log in</a> &bull; <a href="#/">Back to Home</a>
        </div>
        <button className="au-submit" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in to Platform'}
        </button>
      </form>
    </AuthCard>
  );
}

/** Hash routes that win over the path (in-page anchors like #errors don't). */
const HASH_ROUTE = /^\/(admin|demo|login|register|app|terms|privacy|refund|data-deletion|contact)(\/|\?|$)/;

export function AdminApp() {
  const route = useHashRoute();
  const path = useSitePath();
  const [, force] = useState(0);
  const rerender = () => force((n) => n + 1);
  const confirm = useConfirm();

  // A website page (/pricing …) unless a hash route or a sign-in return says otherwise.
  const onSitePage = path !== '/' && !HASH_ROUTE.test(route) && !readOAuthReturn(route);

  // Signed in (CRM or admin panel): Back at the top level must not drop the
  // user onto the login screen (or out of the site) by accident. It asks.
  const isAdminArea = route.startsWith('/admin');
  const signedIn = onSitePage
    ? false
    : isAdminArea
      ? platformApi.adminLoggedIn()
      : !route.startsWith('/demo') && platformApi.businessLoggedIn();
  useBackHandler(
    signedIn,
    async () => {
      const leave = await confirm({
        title: isAdminArea ? 'Leave the admin panel?' : 'Leave the CRM?',
        message: 'You’ll stay signed in. Use the log-out button to sign out.',
        confirmLabel: 'Leave',
        cancelLabel: 'Stay',
        tone: 'primary',
      });
      if (leave) exitApp();
    },
    { base: true },
  );

  // The login screen and the app share one URL, so once signed in the guard
  // above is what keeps Back from landing on the login screen again.
  const signIn = (save: () => void) => {
    save();
    rerender();
  };

  // ----- Website pages (everyone) -----
  if (onSitePage) {
    return (
      <Loading>
        <SiteRoutes path={path} />
      </Loading>
    );
  }

  // ----- Super admin area -----
  if (route.startsWith('/admin')) {
    if (!platformApi.adminLoggedIn()) {
      return (
        <AdminLoginPage
          onSignedIn={(token) => {
            signIn(() => platformApi.setAdminToken(token));
          }}
        />
      );
    }
    const handleAdminLogout = async () => {
      const ok = await confirm({
        title: 'Log out?',
        message: 'Are you sure you want to log out of the admin panel?',
        confirmLabel: 'Log out',
        cancelLabel: 'Cancel',
        tone: 'danger',
      });
      if (!ok) return;
      resetBackHandler();
      platformApi.adminLogout();
      rerender();
    };
    return (
      <Loading>
        <AdminShell onLogout={handleAdminLogout} />
      </Loading>
    );
  }

  // ----- Demo escape hatch (explore with in-memory data) -----
  if (route.startsWith('/demo')) {
    return (
      <DesktopOnly>
        <Loading>
          <CrmShell
            demo
            onLogout={() => {
              window.location.hash = '#/login';
            }}
          />
        </Loading>
      </DesktopOnly>
    );
  }

  // ----- Business area -----
  // Signed in → the CRM. Signed out → the public site: landing page, with
  // Log in / Register on top.
  const businessSignIn = (token: string) => {
    platformApi.setBusinessToken(token);
    // Signed out on a CRM page (an expired session, a refresh after it): back
    // to that page. Anything else opens Chats.
    if (!window.location.hash.startsWith('#/app/')) window.location.hash = '#/';
    rerender();
  };

  const handleBusinessLogout = () => {
    // Disarm back handlers FIRST so no "Discard changes?" or "Leave" prompts fire
    resetBackHandler();
    // Clear business token
    platformApi.businessLogout();
    // Return to login screen
    window.location.hash = '#/login';
    rerender();
  };

  // Back from "Continue with Google": Supabase puts the tokens in the hash.
  const oauth = readOAuthReturn(route);
  if (oauth) return <GoogleReturn {...oauth} onSignedIn={businessSignIn} />;

  // Public legal pages (available to everyone)
  const page = route.split(/[/?#]/)[1] || '';
  if (page === 'terms') return <TermsPage />;
  if (page === 'privacy') return <PrivacyPage />;
  if (page === 'refund') return <RefundPage />;
  if (page === 'data-deletion') return <DataDeletionPage />;
  // The old contact page is now the website's /contact.
  if (page === 'contact') return <Redirect to="/contact" />;

  if (!platformApi.businessLoggedIn()) {
    // A CRM page (#/app/…) while signed out: sign in, then that page opens.
    // On a phone these say "open on your laptop" (DesktopOnly); the website works everywhere.
    if (route.startsWith('/login') || route.startsWith('/app/')) return <DesktopOnly what="login page"><LoginPage onSignedIn={businessSignIn} /></DesktopOnly>;
    if (route.startsWith('/register/google')) return <DesktopOnly what="sign-up page"><RegisterPage key="google" google onSignedIn={businessSignIn} /></DesktopOnly>;
    if (route.startsWith('/register')) return <DesktopOnly what="sign-up page"><RegisterPage key="email" onSignedIn={businessSignIn} /></DesktopOnly>;
    return <LandingPage />;
  }

  // Logged-in tenant → the real CRM (uses the cached business token in localStorage).
  return (
    <DesktopOnly>
      <div className="pa-crm-host">
        <Loading>
          <CrmShell
            config={{ tokenKey: 'crm_business_jwt' }}
            onLogout={handleBusinessLogout}
          />
        </Loading>
      </div>
    </DesktopOnly>
  );
}
