// Viewport units in the CRM's stylesheets, made zoom-proof.
//
// The CRM is shown at 90% on desktop with CSS zoom (src/crm/theme/scale.css),
// and CSS zoom shrinks vh / vw too: a 100vh drawer would stop 10% short of the
// bottom. This plugin rewrites every `Nvh` / `Nvw` / `Ndvh` / `Nsvh` in a CRM
// declaration to `calc(N * var(--crm-vh, 1vh))` (and so on). Unscaled, the
// variables are unset and the fallback is the plain unit; scaled, scale.css
// sets them to the real viewport. Media queries are left alone.
import type { Plugin, Root } from 'postcss';

const UNIT_RE = /(^|[\s(,*/+-])(-?\d*\.?\d+)(vh|vw|dvh|svh)\b/g;

function inScope(file: string | undefined): boolean {
  if (!file) return false;
  const f = file.replace(/\\/g, '/');
  if (f.endsWith('/src/crm/theme/scale.css')) return false;
  return f.includes('/src/crm/');
}

export function rewriteViewportUnits(value: string): string {
  if (!/\d(?:vh|vw|dvh|svh)\b/.test(value) || value.includes('var(--crm-')) return value;
  return value.replace(UNIT_RE, (_, pre: string, n: string, unit: string) => `${pre}calc(${n} * var(--crm-${unit}, 1${unit}))`);
}

export default function crmViewportUnits(): Plugin {
  return {
    postcssPlugin: 'crm-viewport-units',
    Once(root: Root) {
      root.walkDecls((d) => {
        if (!inScope(d.source?.input.file ?? root.source?.input.file)) return;
        const v = rewriteViewportUnits(d.value);
        if (v !== d.value) d.value = v;
      });
    },
  };
}
