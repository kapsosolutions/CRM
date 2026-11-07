// The website's pages at real paths (/pricing, /product/…, /docs …). Each
// group of pages is its own download, so the landing page and the CRM don't
// carry them. AdminApp decides when a path is a website page (isSitePage).
import { lazy, useEffect } from 'react';
import { PAGE_META, normalizePath } from './siteMeta';
import { LEGAL_PATHS, navigate } from './siteNav';
import { DataDeletionPage, PrivacyPage, RefundPage, TermsPage } from './LegalPages';
import { NotFoundPage } from './pages/NotFoundPage';

const PricingPage = lazy(() => import('./pages/PricingPage').then((m) => ({ default: m.PricingPage })));
const AboutPage = lazy(() => import('./pages/AboutPage').then((m) => ({ default: m.AboutPage })));
const ContactPage = lazy(() => import('./pages/ContactPage').then((m) => ({ default: m.ContactPage })));
const HelpPage = lazy(() => import('./pages/HelpPage').then((m) => ({ default: m.HelpPage })));
const ProductIndexPage = lazy(() => import('./pages/ProductPages').then((m) => ({ default: m.ProductIndexPage })));
const ProductPage = lazy(() => import('./pages/ProductPages').then((m) => ({ default: m.ProductPage })));
const SolutionsIndexPage = lazy(() => import('./pages/SolutionPages').then((m) => ({ default: m.SolutionsIndexPage })));
const SolutionPage = lazy(() => import('./pages/SolutionPages').then((m) => ({ default: m.SolutionPage })));
const DevelopersPage = lazy(() => import('./pages/DeveloperPages').then((m) => ({ default: m.DevelopersPage })));
const DevTopicPage = lazy(() => import('./pages/DeveloperPages').then((m) => ({ default: m.DevTopicPage })));
const DocsPage = lazy(() => import('./pages/DocsPage').then((m) => ({ default: m.DocsPage })));
const TemplatesLibraryPage = lazy(() => import('./pages/ResourcePages').then((m) => ({ default: m.TemplatesLibraryPage })));
const PricingGuidePage = lazy(() => import('./pages/ResourcePages').then((m) => ({ default: m.PricingGuidePage })));
const ToolPage = lazy(() => import('./pages/ToolPages').then((m) => ({ default: m.ToolPage })));

/** Replace the URL (an old #/contact link → /contact). */
export function Redirect({ to }: { to: string }) {
  useEffect(() => {
    navigate(to, { replace: true });
  }, [to]);
  return null;
}

export function SiteRoutes({ path: raw }: { path: string }) {
  const path = normalizePath(raw);
  const [, first = '', second = '', extra] = path.split('/');

  if (LEGAL_PATHS.includes(path)) {
    if (path === '/privacy') return <PrivacyPage />;
    if (path === '/terms') return <TermsPage />;
    if (path === '/refund') return <RefundPage />;
    return <DataDeletionPage />;
  }
  // Only listed pages exist; anything else under a known section is a 404.
  if (!PAGE_META.has(path) || extra !== undefined) return <NotFoundPage />;

  switch (first) {
    case 'pricing': return <PricingPage />;
    case 'about': return <AboutPage />;
    case 'contact': return <ContactPage />;
    case 'help': return <HelpPage />;
    case 'docs': return <DocsPage />;
    case 'product': return second ? <ProductPage key={second} slug={second} /> : <ProductIndexPage />;
    case 'solutions': return second ? <SolutionPage key={second} slug={second} /> : <SolutionsIndexPage />;
    case 'developers': return second ? <DevTopicPage key={second} slug={second} /> : <DevelopersPage />;
    case 'tools': return <ToolPage key={second} slug={second} />;
    case 'resources':
      if (second === 'whatsapp-templates') return <TemplatesLibraryPage />;
      if (second === 'whatsapp-pricing') return <PricingGuidePage />;
      return <NotFoundPage />;
    default: return <NotFoundPage />;
  }
}
