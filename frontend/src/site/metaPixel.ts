// The Meta Pixel (Events Manager → "Kapso website"), for Meta ads that send
// people to the website. Loaded only on the public pages (the website, log in,
// register): never inside the CRM or the admin panel, so nothing a business
// does in its CRM reaches Meta.
//
//   pixelPageView(key)   a page was opened (key = path + hash; repeats ignored)
//   pixelTrack(event)    a standard event: ViewContent (pricing), Lead (a demo
//                        booked, the contact form sent), CompleteRegistration
//                        (a business signed up)
// Allowed by the page's Content-Security-Policy (deploy/nginx/crm-csp.conf:
// connect.facebook.net scripts; images and requests to https:).

export const META_PIXEL_ID = '1804465024171398';

type Fbq = ((...args: unknown[]) => void) & { callMethod?: (...a: unknown[]) => void; queue: unknown[]; loaded: boolean; version: string; push: unknown };
declare global {
  interface Window {
    fbq?: Fbq;
    _fbq?: Fbq;
  }
}

let started = false;
let lastPage = '';

/** Inside the CRM or the admin panel (the demo dialog opens there too): send nothing. */
const inApp = () => !!document.querySelector('.crm-shell-root, .pa-shell');

/** Meta's loader, as Events Manager gives it: a queue now, the script in the background. */
function start(): boolean {
  if (typeof window === 'undefined' || inApp()) return false;
  if (started) return true;
  started = true;
  if (!window.fbq) {
    const n = function (...args: unknown[]) {
      if (n.callMethod) n.callMethod(...args);
      else n.queue.push(args);
    } as Fbq;
    n.push = n;
    n.loaded = true;
    n.version = '2.0';
    n.queue = [];
    window.fbq = n;
    if (!window._fbq) window._fbq = n;
    const s = document.createElement('script');
    s.async = true;
    s.src = 'https://connect.facebook.net/en_US/fbevents.js';
    document.head.appendChild(s);
  }
  window.fbq('init', META_PIXEL_ID);
  return true;
}

/** A public page was opened. The same page twice in a row counts once. */
export function pixelPageView(key: string) {
  if (key === lastPage) return;
  lastPage = key;
  if (start()) window.fbq?.('track', 'PageView');
}

/** A standard Meta event (ViewContent, Lead, CompleteRegistration …). */
export function pixelTrack(event: 'ViewContent' | 'Lead' | 'CompleteRegistration' | 'Contact', params?: Record<string, string | number>) {
  try {
    if (start()) window.fbq?.('track', event, params || {});
  } catch {
    /* blocked by an ad blocker: nothing to do */
  }
}
