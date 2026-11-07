// The public website's own pages live at real paths (/pricing, /product/…),
// so search engines see each as its own page. The CRM and sign-in keep their
// hash routes at "/" (#/login, #/app/…).
//
//   navigate('/pricing')     go to a page without reloading
//   useSitePath()            the current path, re-rendered on Back/Forward
//   isSitePath('/pricing')   is this one of the website's pages?
//   useSeo(meta)             the page's <title>, description, canonical, OG tags
import { useEffect, useState } from 'react';
import { PAGE_META, SITE_NAME, SITE_ORIGIN, normalizePath, type SitePageMeta } from './siteMeta';

/** Fired after navigate() changes the URL (pushState fires no event of its own). */
export const NAV_EVENT = 'site:navigate';

export function navigate(to: string, { replace = false } = {}) {
  const url = new URL(to, window.location.origin);
  if (url.origin !== window.location.origin) {
    window.location.href = to;
    return;
  }
  if (replace) window.history.replaceState({}, '', url.pathname + url.search + url.hash);
  else window.history.pushState({}, '', url.pathname + url.search + url.hash);
  window.dispatchEvent(new Event(NAV_EVENT));
  if (url.hash && !url.hash.startsWith('#/')) {
    // An in-page anchor: let the page render, then scroll to it.
    window.setTimeout(() => document.getElementById(url.hash.slice(1))?.scrollIntoView({ behavior: 'smooth' }), 60);
  } else {
    window.scrollTo({ top: 0 });
  }
}

export function useSitePath(): string {
  const [path, setPath] = useState(() => normalizePath(window.location.pathname));
  useEffect(() => {
    const on = () => setPath(normalizePath(window.location.pathname));
    window.addEventListener('popstate', on);
    window.addEventListener(NAV_EVENT, on);
    return () => {
      window.removeEventListener('popstate', on);
      window.removeEventListener(NAV_EVENT, on);
    };
  }, []);
  return path;
}

/** Legal pages answer at paths too (/privacy …), as well as #/privacy. */
export const LEGAL_PATHS = ['/privacy', '/terms', '/refund', '/data-deletion'];

export const isSitePath = (p: string) => PAGE_META.has(normalizePath(p)) || LEGAL_PATHS.includes(normalizePath(p));

/**
 * A click on an internal link: navigate without a reload. Lets the browser
 * handle new-tab clicks, other origins and hash routes (#/register …).
 */
export function onSiteLinkClick(e: React.MouseEvent<HTMLAnchorElement>) {
  const a = e.currentTarget;
  const href = a.getAttribute('href') || '';
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.target === '_blank') return;
  if (!href.startsWith('/') || href.startsWith('//') || href.startsWith('/#/') || href.startsWith('/api/')) return;
  e.preventDefault();
  navigate(href);
}

function setMeta(attr: 'name' | 'property', key: string, value: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', value);
}

/** The page's title and tags (the build writes the same ones into its HTML file). */
export function useSeo(meta: SitePageMeta | undefined, { noindex = false } = {}) {
  useEffect(() => {
    if (!meta) return;
    document.title = meta.title;
    const url = `${SITE_ORIGIN}${meta.path === '/' ? '/' : meta.path}`;
    setMeta('name', 'description', meta.description);
    setMeta('name', 'robots', noindex ? 'noindex' : 'index, follow');
    setMeta('property', 'og:title', meta.title);
    setMeta('property', 'og:description', meta.description);
    setMeta('property', 'og:url', url);
    setMeta('property', 'og:site_name', SITE_NAME);
    setMeta('name', 'twitter:title', meta.title);
    setMeta('name', 'twitter:description', meta.description);
    let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'canonical';
      document.head.appendChild(link);
    }
    link.href = url;
  }, [meta, noindex]);
}
