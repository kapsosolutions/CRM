// Light / dark theme for the CRM. Light is the default; the choice is kept in
// localStorage. While the CRM is open, <html data-theme="dark"> switches every
// CRM stylesheet to its dark variant: the token values in theme/dark.css, and
// the rules generated at build time by build/crmDarkTheme.ts. The landing page
// and the admin panel never see the attribute (it's removed when the CRM closes).
import { useCallback, useLayoutEffect, useState } from 'react';

export type CrmTheme = 'light' | 'dark';
const KEY = 'crm_theme';

function stored(): CrmTheme {
  try {
    return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function useCrmTheme(): [CrmTheme, () => void] {
  const [theme, setTheme] = useState<CrmTheme>(stored);
  useLayoutEffect(() => {
    const html = document.documentElement;
    if (theme === 'dark') html.setAttribute('data-theme', 'dark');
    else html.removeAttribute('data-theme');
    return () => html.removeAttribute('data-theme');
  }, [theme]);
  const toggle = useCallback(() => {
    setTheme((t) => {
      const next: CrmTheme = t === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem(KEY, next);
      } catch {
        /* private mode */
      }
      return next;
    });
  }, []);
  return [theme, toggle];
}

/** Moon in the light theme (switch to dark), sun in the dark one. */
export function ThemeToggleSvg({ theme }: { theme: CrmTheme }) {
  return theme === 'dark' ? (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <circle cx="10" cy="10" r="3.5" />
      <path d="M10 1.75V3.5M10 16.5V18.25M1.75 10H3.5M16.5 10H18.25M4.17 4.17L5.4 5.4M14.6 14.6L15.83 15.83M4.17 15.83L5.4 14.6M14.6 5.4L15.83 4.17" />
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">
      <path d="M16.9 12.2A7.25 7.25 0 0 1 7.8 3.1 7.25 7.25 0 1 0 16.9 12.2Z" />
    </svg>
  );
}
