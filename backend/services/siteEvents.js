// Event themes (models/SiteEvent.js): what an event may change, how its
// settings are cleaned, and which event is live right now.
//
//   theme = {
//     logos:        { site, crmLight, crmDark }                  image URLs
//     landing:      { heroBg, heroBgTablet, heroBgMobile, heroArt, badge,
//                     titleAccent, titleMain, desc, accent,
//                     tone: 'dark'|'light', overlay: 0–90 }
//     pages:        { heroBg, heroBgTablet, heroBgMobile, tone, overlay }   every other website page
//     whatsapp:     { image, tooltip }                           the floating chat button
//     announcement: { enabled, seconds, items: [{ text, linkLabel, linkUrl, bg, color, image }],
//                     text, linkLabel, linkUrl, bg, color, image }   CRM top bar
//   }
//
// heroBgTablet / heroBgMobile: the background on screens up to 1024 / 640 px
// wide (empty = the next larger one). Announcements: up to MAX_ANNOUNCEMENTS,
// shown one after another, `seconds` each. The first one is also copied to
// the old single fields (text, linkLabel, …) for CRM pages loaded before
// the list existed; an old theme with only those fields reads as one item.
//
// Every field is optional: an empty one keeps the normal design. Images must
// be https URLs (the admin uploads them to our storage), so a theme can never
// put a script or a CSS escape into a page.
import SiteEvent from '../models/SiteEvent.js';

const HTTPS_URL = /^https:\/\/[^\s"'()<>\\]{3,500}$/i;
const HEX = /^#[0-9a-f]{6}$/i;
// A link from the announcement: our own pages (/pricing, /#/app/…) or https.
const LINK = /^(\/[^\s"'<>\\]{0,300}|https:\/\/[^\s"'<>\\]{3,500})$/i;

const text = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
const url = (v) => {
  const s = String(v ?? '').trim();
  return HTTPS_URL.test(s) ? s : '';
};
const color = (v) => (HEX.test(String(v ?? '').trim()) ? String(v).trim().toLowerCase() : '');
const tone = (v) => (v === 'light' ? 'light' : 'dark');
const overlay = (v) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(90, Math.max(0, n)) : 0;
};
/** CRM announcements: how many, and how long each shows (seconds). */
export const MAX_ANNOUNCEMENTS = 5;
const seconds = (v) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(30, Math.max(3, n)) : 6;
};

/** A field that isn't an allowed value: { field: message } for the admin. */
export class ThemeError extends Error {
  constructor(errors) {
    super(Object.values(errors)[0]);
    this.errors = errors;
    this.status = 400;
  }
}

/**
 * The admin's theme, cleaned: only known fields, sizes capped, URLs and
 * colours checked. A URL or colour that was filled in but isn't valid is an
 * error (rather than silently dropped), so the admin knows.
 */
export function sanitizeTheme(raw = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const errors = {};
  const pickUrl = (path, v) => {
    const s = String(v ?? '').trim();
    if (s && !url(s)) errors[path] = 'Upload the image again (it must be an https:// link).';
    return url(s);
  };
  const pickColor = (path, v) => {
    const s = String(v ?? '').trim();
    if (s && !color(s)) errors[path] = 'Pick a colour like #16a34a.';
    return color(s);
  };
  const L = r.logos || {};
  const H = r.landing || {};
  const P = r.pages || {};
  const W = r.whatsapp || {};
  const A = r.announcement || {};
  // The list, or (an older theme) the single announcement as its one item.
  const rawItems = (Array.isArray(A.items) ? A.items : [A]).filter((x) => x && typeof x === 'object').slice(0, MAX_ANNOUNCEMENTS);
  // The first item's errors keep their old names (announcement.text…).
  const at = (i, k) => (i === 0 ? `announcement.${k}` : `announcement.items.${i}.${k}`);
  const items = rawItems.map((it, i) => {
    const linkUrl = String(it.linkUrl ?? '').trim();
    if (linkUrl && !LINK.test(linkUrl)) errors[at(i, 'linkUrl')] = 'Use a page of the site (like /pricing) or an https:// link.';
    return {
      text: text(it.text, 200),
      linkLabel: text(it.linkLabel, 30),
      linkUrl: LINK.test(linkUrl) ? linkUrl : '',
      bg: pickColor(at(i, 'bg'), it.bg),
      color: pickColor(at(i, 'color'), it.color),
      image: pickUrl(at(i, 'image'), it.image),
    };
  });
  // Empty items in the middle of the list are an error; trailing empty ones are dropped.
  while (items.length > 1 && !items[items.length - 1].text) items.pop();
  const enabled = A.enabled === true;
  if (enabled) items.forEach((it, i) => { if (!it.text) errors[at(i, 'text')] = 'Write the announcement, or switch it off.'; });
  const first = items[0] || { text: '', linkLabel: '', linkUrl: '', bg: '', color: '', image: '' };
  const theme = {
    logos: {
      site: pickUrl('logos.site', L.site),
      crmLight: pickUrl('logos.crmLight', L.crmLight),
      crmDark: pickUrl('logos.crmDark', L.crmDark),
    },
    landing: {
      heroBg: pickUrl('landing.heroBg', H.heroBg),
      heroBgTablet: pickUrl('landing.heroBgTablet', H.heroBgTablet),
      heroBgMobile: pickUrl('landing.heroBgMobile', H.heroBgMobile),
      heroArt: pickUrl('landing.heroArt', H.heroArt),
      badge: text(H.badge, 80),
      titleAccent: text(H.titleAccent, 60),
      titleMain: text(H.titleMain, 80),
      desc: text(H.desc, 300),
      accent: pickColor('landing.accent', H.accent),
      tone: tone(H.tone),
      overlay: overlay(H.overlay),
    },
    pages: {
      heroBg: pickUrl('pages.heroBg', P.heroBg),
      heroBgTablet: pickUrl('pages.heroBgTablet', P.heroBgTablet),
      heroBgMobile: pickUrl('pages.heroBgMobile', P.heroBgMobile),
      tone: tone(P.tone),
      overlay: overlay(P.overlay),
    },
    whatsapp: {
      image: pickUrl('whatsapp.image', W.image),
      tooltip: text(W.tooltip, 40),
    },
    announcement: {
      enabled,
      seconds: seconds(A.seconds),
      items,
      ...first,
    },
  };
  if (Object.keys(errors).length) throw new ThemeError(errors);
  return theme;
}

/** 'live' | 'scheduled' (on, not started) | 'ended' (on, past its end) | 'off'. */
export function statusOf(ev, now = new Date()) {
  if (!ev?.active) return 'off';
  const t = now.getTime();
  if (ev.startsAt && new Date(ev.startsAt).getTime() > t) return 'scheduled';
  if (ev.endsAt && new Date(ev.endsAt).getTime() <= t) return 'ended';
  return 'live';
}

/** What the website and the CRM receive: no admin-only fields. */
export function publicView(ev) {
  if (!ev) return null;
  return {
    id: String(ev._id),
    name: ev.name || '',
    theme: ev.theme || {},
    updatedAt: ev.updatedAt || null,
  };
}

// Read on every page load of the site and the CRM: kept for 30 s, and dropped
// as soon as the admin changes an event.
const TTL_MS = 30_000;
let cache = null; // { at, value }

export async function liveEvent(now = new Date()) {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const rows = await SiteEvent.find({ active: true }).sort({ updatedAt: -1 }).limit(5).lean();
  const ev = rows.find((r) => statusOf(r, now) === 'live') || null;
  const value = publicView(ev);
  // A scheduled event can start (or end) inside the window: never cache past that.
  const edges = rows
    .flatMap((r) => [r.startsAt, r.endsAt])
    .filter(Boolean)
    .map((d) => new Date(d).getTime())
    .filter((t) => t > Date.now());
  const until = edges.length ? Math.min(...edges) : Infinity;
  cache = { at: until - Date.now() < TTL_MS ? until - TTL_MS : Date.now(), value };
  return value;
}

export function clearEventCache() {
  cache = null;
}

export default { sanitizeTheme, statusOf, publicView, liveEvent, clearEventCache, ThemeError };
