// Pin the browser window at the top while a full-screen app shell is mounted.
//
// The CRM and the admin portal fill the viewport exactly and scroll inside
// their own panes, so the window itself must never move. CSS alone can't
// guarantee that: browser extensions inject elements into <body> that make
// the document a few pixels taller, Chrome restores an old scroll position on
// reload, and focus()/scrollIntoView() scroll the window even when it has
// overflow:hidden. So lock it and snap back if anything moves it.
import { useEffect } from 'react';

export function useLockWindowScroll() {
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prev = { html: html.style.overflow, body: body.style.overflow, restore: history.scrollRestoration };
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    // Don't let a reload put the window back where an old layout left it.
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

    const reset = () => {
      if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
      if (html.scrollTop) html.scrollTop = 0;
      if (body.scrollTop) body.scrollTop = 0;
    };
    reset();
    window.addEventListener('scroll', reset, { passive: true });
    return () => {
      window.removeEventListener('scroll', reset);
      html.style.overflow = prev.html;
      body.style.overflow = prev.body;
      if ('scrollRestoration' in history) history.scrollRestoration = prev.restore;
    };
  }, []);
}
