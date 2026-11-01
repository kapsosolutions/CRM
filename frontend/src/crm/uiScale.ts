// The CRM is drawn smaller on desktop screens (CSS zoom on <html>, see
// theme/scale.css): 90%, or 80% on small laptops, picked from the window size.
//
// Under CSS zoom, mouse positions and getBoundingClientRect() are in screen
// pixels while lengths set in CSS / inline styles are in the page's own pixels.
// Code that turns one into the other divides by uiScale():
//   cssPx = screenPx / uiScale()
import { useLayoutEffect } from 'react';

let cached: { zoom: string; scale: number } | null = null;

/** Screen px per CSS px for the CRM's own elements (0.9 / 0.8 when scaled, else 1). */
export function uiScale(): number {
  if (typeof document === 'undefined') return 1;
  const zoom = getComputedStyle(document.documentElement).zoom || '1';
  if (zoom === '1' || zoom === 'normal') return 1;
  if (cached && cached.zoom === zoom) return cached.scale;
  // Measure rather than trust the zoom value: older engines report rects in
  // the zoomed element's own pixels, and then nothing needs converting.
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;left:0;top:0;width:100px;height:1px;visibility:hidden;pointer-events:none';
  document.body.appendChild(probe);
  const w = probe.getBoundingClientRect().width;
  probe.remove();
  const scale = w > 0 ? w / 100 : 1;
  cached = { zoom, scale };
  return scale;
}

/** While the CRM is mounted, <html data-crm-scale> switches the scaled view on. */
export function useCrmScale(): void {
  useLayoutEffect(() => {
    const html = document.documentElement;
    html.setAttribute('data-crm-scale', '');
    cached = null;
    return () => {
      html.removeAttribute('data-crm-scale');
      cached = null;
    };
  }, []);
}
