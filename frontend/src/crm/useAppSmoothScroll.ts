// Lenis smooth wheel scrolling for the signed-in CRM (Ads, Chats, Templates,
// Campaigns, Automation…).
//
// The CRM's window never scrolls: each page scrolls inside its own panel
// (.page-body, the chat list, a dialog body…). So instead of one window-level
// Lenis (the public site's useSmoothScroll), a Lenis instance is attached to
// the scroll panel the mouse is over, the first time it's hovered, and dropped
// once that panel leaves the page. All instances share one animation loop.
//
// Left native on purpose:
//   • touch screens (their own scrolling is already smooth) and anyone who
//     asked for reduced motion;
//   • the Automation canvas (React Flow uses the wheel to zoom / pan), text
//     boxes, selects, editable areas, dropdown panels and anything marked
//     data-lenis-prevent;
//   • Ctrl + wheel (browser zoom) and horizontal-only scrolling.
// A smaller scroll area inside a smooth one (a table, a side list) gets its own
// instance when hovered; until then the outer one lets it scroll natively
// (allowNestedScroll).
import { useEffect } from 'react';
import Lenis from 'lenis';
import 'lenis/dist/lenis.css';

/** Never smooth inside these (and never attach to them). */
const NATIVE = [
  '.react-flow',
  '[data-lenis-prevent]',
  '[data-native-scroll]',
  'textarea',
  'select',
  'input',
  '[contenteditable="true"]',
  '.dd-panel',
  '.emoji-picker',
].join(',');

const isScrollable = (el: HTMLElement) => {
  if (el.scrollHeight <= el.clientHeight + 1) return false;
  const oy = getComputedStyle(el).overflowY;
  return oy === 'auto' || oy === 'scroll' || oy === 'overlay';
};

/** The nearest vertically scrollable panel around `node`, or null (or a native-only area). */
function scrollPanelOf(node: EventTarget | null): HTMLElement | null {
  let el = node instanceof Element ? (node as HTMLElement) : null;
  if (!el || el.closest(NATIVE)) return null;
  while (el && el !== document.body && el !== document.documentElement) {
    if (isScrollable(el)) return el;
    el = el.parentElement;
  }
  return null;
}

export function useAppSmoothScroll(enabled = true) {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return undefined;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const touchOnly = window.matchMedia?.('(hover: none) and (pointer: coarse)').matches;
    if (reduced || touchOnly) return undefined;

    const instances = new Map<HTMLElement, Lenis>();
    let raf = 0;
    const loop = (time: number) => {
      instances.forEach((l) => l.raf(time));
      raf = instances.size ? requestAnimationFrame(loop) : 0;
    };
    const start = () => {
      if (!raf) raf = requestAnimationFrame(loop);
    };

    const attach = (el: HTMLElement) => {
      if (instances.has(el)) return;
      const lenis = new Lenis({
        wrapper: el,
        content: el,
        eventsTarget: el,
        smoothWheel: true,
        syncTouch: false,
        lerp: 0.12,
        wheelMultiplier: 1,
        gestureOrientation: 'vertical',
        // The panel's own height is read each time: CRM lists grow and shrink as data loads.
        naiveDimensions: true,
        allowNestedScroll: true,
        overscroll: true,
        autoRaf: false,
        prevent: (node) => node.matches?.(NATIVE) ?? false,
      });
      instances.set(el, lenis);
      start();
    };

    const onOver = (e: MouseEvent) => {
      const panel = scrollPanelOf(e.target);
      if (panel) attach(panel);
    };
    document.addEventListener('mouseover', onOver, { passive: true });

    // Panels removed by React (another page, a closed dialog) are let go.
    const sweep = window.setInterval(() => {
      instances.forEach((l, el) => {
        if (!el.isConnected) {
          l.destroy();
          instances.delete(el);
        }
      });
    }, 3000);

    (window as unknown as { __crmLenis?: Map<HTMLElement, Lenis> }).__crmLenis = instances;
    return () => {
      document.removeEventListener('mouseover', onOver);
      window.clearInterval(sweep);
      if (raf) cancelAnimationFrame(raf);
      instances.forEach((l) => l.destroy());
      instances.clear();
      delete (window as unknown as { __crmLenis?: unknown }).__crmLenis;
    };
  }, [enabled]);
}
