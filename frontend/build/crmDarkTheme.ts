// Build-time dark theme for the CRM.
//
// The CRM's stylesheets hard-code their colours (hundreds of #fff / #e5e7eb /
// #0f172a ...), so a dark theme can't come from flipping a few variables. This
// PostCSS plugin reads every rule in the CRM's own stylesheets and, right after
// it, adds a copy scoped to html[data-theme="dark"] that holds the rule's
// colour declarations with dark values:
//   - light backgrounds become dark ones (white -> near-black, pale tints -> deep tints)
//   - dark text becomes light text, saturated text gets a lighter shade
//   - light borders become subtle dark ones
//   - everything else (brand greens, reds, overlays, white text) stays as it is
//
// The prefix is wrapped in :where(), which adds no specificity, and each copy
// sits right after its original. So a copy beats exactly its own original and
// the cascade between CRM rules is the same in both themes (a `.a.b` override
// still beats `.a`); declarations whose value doesn't change aren't copied.
// Shorthands are reduced to their colour longhands (`border` -> `border-color`,
// `background` -> `background-color` / `background-image`) so a copy never
// resets widths, sizes or positions.
//
// The copies only match while the CRM sets <html data-theme="dark"> (see
// src/crm/theme.tsx); the landing page and the admin panel never set it.
// Token values (--wa-*) and the few hand-tuned spots live in
// src/crm/theme/dark.css, which this plugin leaves alone.
import type { AtRule, Container, Declaration, Plugin, Root, Rule } from 'postcss';

const DARK = ':where(html[data-theme="dark"])';

/**
 * Which rules get dark copies: everything in the CRM's stylesheets, plus the
 * pricing / plan-card rules of the site stylesheet, which the CRM's plan picker
 * and Billing page reuse. (The landing page never sets data-theme, so those
 * copies never match there.)
 */
const SITE_IN_CRM = /\.lp-(?:plan|pricing|billing|cycle)/;
function themed(file: string | undefined, selector: string): boolean {
  if (!file) return false;
  const f = file.replace(/\\/g, '/');
  if (f.endsWith('/src/crm/theme/dark.css')) return false;
  if (f.endsWith('/src/site/site.css')) return SITE_IN_CRM.test(selector);
  return f.includes('/src/crm/') || f.endsWith('/src/styles/global.css');
}

// ---------------------------------------------------------------------------
// Colour maths
// ---------------------------------------------------------------------------
type Rgba = { r: number; g: number; b: number; a: number };
type Role = 'bg' | 'fg' | 'border' | 'shadow';

const NAMED: Record<string, Rgba> = {
  white: { r: 255, g: 255, b: 255, a: 1 },
  black: { r: 0, g: 0, b: 0, a: 1 },
};

function parseColor(tok: string): Rgba | null {
  const t = tok.trim().toLowerCase();
  if (NAMED[t]) return { ...NAMED[t] };
  let m = /^#([0-9a-f]{3,8})$/.exec(t);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
    };
  }
  m = /^rgba?\(([^)]*)\)$/.exec(t);
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const ch = (s: string) => (s.endsWith('%') ? (parseFloat(s) * 255) / 100 : parseFloat(s));
    const al = parts[3] === undefined ? 1 : parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
    const c = { r: ch(parts[0]), g: ch(parts[1]), b: ch(parts[2]), a: al };
    return [c.r, c.g, c.b, c.a].some((n) => Number.isNaN(n)) ? null : c;
  }
  return null;
}

function toHsl({ r, g, b }: Rgba): [number, number, number] {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  h *= 60;
  return [h, s, l];
}

function fromHsl(h: number, s: number, l: number, a: number): string {
  const k = (n: number) => (n + h / 30) % 12;
  const q = s * Math.min(l, 1 - l);
  const f = (n: number) => l - q * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const [r, g, b] = [f(0), f(8), f(4)].map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255));
  if (a >= 1) return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
  return `rgba(${r}, ${g}, ${b}, ${+a.toFixed(3)})`;
}

const white = (a: number) => `rgba(255, 255, 255, ${+Math.min(1, a).toFixed(3)})`;

/** Dark-theme value for one colour; null = keep the original text. */
function mapColor(c: Rgba, role: Role): string | null {
  const [h, s, l] = toHsl(c);
  const chroma = (Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b)) / 255;
  const neutral = chroma < 0.2 || (role !== 'fg' && chroma < 0.06);
  const translucentDark = c.a < 1 && l < 0.3 && chroma < 0.15;
  const NH = 213, NS = 0.12; // the dark greys share one cool hue

  if (role === 'bg' || role === 'shadow') {
    if (translucentDark) {
      if (role === 'shadow') return null; // shadows stay dark
      return c.a < 0.3 ? white(c.a * 1.2) : null; // hover tints flip; overlays stay
    }
    if (chroma < 0.06) {
      if (l < 0.55) return null; // already dark
      return fromHsl(NH, NS, 0.104 + (1 - l) * 0.85, c.a);
    }
    if (l >= 0.7) return fromHsl(h, Math.min(s, 0.5), 0.11 + (1 - l) * 0.5, c.a);
    return null;
  }
  if (role === 'border') {
    if (translucentDark) return white(c.a * 1.6);
    if (chroma < 0.06) {
      if (c.a < 1 && l >= 0.55) return fromHsl(NH, NS, 0.2 + (1 - l) * 0.5, c.a);
      if (l >= 0.55) return fromHsl(NH, NS, 0.2 + (1 - l) * 0.5, 1);
      return fromHsl(NH, NS, 0.45 - l * 0.4, c.a);
    }
    if (l >= 0.75) return fromHsl(h, Math.min(s, 0.5), 0.24 + (1 - l) * 0.4, c.a);
    return null;
  }
  // fg: text, icons
  if (translucentDark) return white(c.a);
  if (neutral) {
    const ns = Math.min(s, NS);
    if (l < 0.55) return fromHsl(h, ns, 0.93 - l * 0.5, c.a);
    if (l < 0.8) return fromHsl(h, ns, 0.655 - (l - 0.55) * 0.6, c.a);
    return null; // white / near-white text stays
  }
  if (l < 0.5) return fromHsl(h, s, 0.62 + (0.5 - l) * 0.3, c.a);
  return null;
}

// ---------------------------------------------------------------------------
// Value helpers
// ---------------------------------------------------------------------------
/** Split on a separator outside (), [] and quotes. */
function splitTop(value: string, sep: ',' | ' '): string[] {
  const out: string[] = [];
  let depth = 0, quote = '', cur = '';
  for (const ch of value) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    const isSep = sep === ' ' ? /\s/.test(ch) : ch === sep;
    if (isSep && depth === 0) {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|rgba?\([^()]*\)|\b(?:white|black)\b/g;

/**
 * Background images with a dark twin in public/ (the light ones have a white /
 * beige backdrop baked in). Regenerate the twins with build/make-dark-images.mjs.
 */
const DARK_IMAGES: Record<string, string> = { '/crm_bg.png': '/crm_bg-dark.webp' };

/** Replace every colour in a value (outside url(...)), and swap images that have a dark twin. */
function mapValue(value: string, role: Role): string {
  const urls: string[] = [];
  const masked = value.replace(/url\((?:[^()"']|"[^"]*"|'[^']*')*\)/gi, (u) => {
    for (const [from, to] of Object.entries(DARK_IMAGES)) u = u.replace(new RegExp(`(['"(])${from.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}(['")])`), `$1${to}$2`);
    urls.push(u);
    return `\u0000${urls.length - 1}\u0000`;
  });
  const mapped = masked.replace(COLOR_RE, (tok) => {
    const c = parseColor(tok);
    return (c && mapColor(c, role)) || tok;
  });
  return mapped.replace(/\u0000(\d+)\u0000/g, (_, i) => urls[+i]);
}

const BORDER_STYLES = new Set(['none', 'hidden', 'dotted', 'dashed', 'solid', 'double', 'groove', 'ridge', 'inset', 'outset', 'auto']);
const WIDTHS = new Set(['thin', 'medium', 'thick']);
const GLOBAL = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer']);

/** The colour part of a `border` / `outline` shorthand. */
function borderColorOf(value: string): string {
  const v = value.replace(/\s*!important\s*$/i, '').trim();
  if (GLOBAL.has(v.toLowerCase())) return v;
  let color = 'currentcolor';
  for (const tok of splitTop(v, ' ')) {
    const t = tok.toLowerCase();
    if (BORDER_STYLES.has(t) || WIDTHS.has(t)) continue;
    if (/^-?[\d.]/.test(t) || /^calc\(/.test(t)) continue;
    color = tok; // width, style, colour: whatever is left is the colour
  }
  return color;
}

const IMAGE_RE = /^(?:-webkit-)?(?:repeating-)?(?:linear|radial|conic)-gradient\(|^url\(|^image-set\(|^-webkit-image-set\(/i;

/** `background` shorthand -> [background-color, background-image]. */
function splitBackground(value: string): [string, string] {
  const v = value.trim();
  const low = v.toLowerCase();
  if (GLOBAL.has(low)) return [v, v];
  if (low === 'none') return ['transparent', 'none'];
  const layers = splitTop(v, ',');
  const images: string[] = [];
  let color = 'transparent';
  layers.forEach((layer, i) => {
    let img = 'none';
    for (const tok of splitTop(layer, ' ')) {
      if (IMAGE_RE.test(tok)) img = tok;
      else if (i === layers.length - 1 && (parseColor(tok) || /^(?:var\(|transparent$|currentcolor$|hsla?\()/i.test(tok))) color = tok;
    }
    images.push(img);
  });
  return [color, images.join(', ')];
}

// ---------------------------------------------------------------------------
// Rule copies
// ---------------------------------------------------------------------------
type Out = { prop: string; value: string; important: boolean };

function darkDecls(d: Declaration): Out[] {
  const prop = d.prop.toLowerCase();
  const imp = !!d.important;
  // Only values the dark theme changes are copied (see the note at the top).
  const o = (p: string, v: string, role: Role): Out[] => {
    const value = mapValue(v, role);
    return value === v ? [] : [{ prop: p, value, important: imp }];
  };
  if (prop === 'color' || prop === 'fill' || prop === 'stroke' || prop === 'caret-color') return o(prop, d.value, 'fg');
  if (prop === 'background-color' || prop === 'background-image') return o(prop, d.value, 'bg');
  if (prop === 'background') {
    const [color, image] = splitBackground(d.value);
    return [...o('background-color', color, 'bg'), ...o('background-image', image, 'bg')];
  }
  if (prop === 'box-shadow') return o(prop, d.value, 'shadow');
  if (prop === 'outline') return o('outline-color', borderColorOf(d.value), 'border');
  if (prop === 'outline-color') return o(prop, d.value, 'border');
  if (prop === 'border-color' || /^border-(?:top|right|bottom|left|block|inline|block-start|block-end|inline-start|inline-end)-color$/.test(prop)) {
    return o(prop, d.value, 'border');
  }
  if (prop === 'border' || /^border-(?:top|right|bottom|left|block|inline|block-start|block-end|inline-start|inline-end)$/.test(prop)) {
    return o(`${prop}-color`, borderColorOf(d.value), 'border');
  }
  return [];
}

function prefixSelector(sel: string): string {
  return splitTop(sel, ',')
    .map((s) => {
      const t = s.trim();
      if (/^:root\b/.test(t)) return DARK + t.slice(5);
      if (/^html\b/i.test(t)) return DARK + t.slice(4);
      return `${DARK} ${t}`;
    })
    .join(',\n');
}

function insideKeyframes(rule: Rule): boolean {
  for (let p: Container | Root | undefined = rule.parent as Container | undefined; p; p = p.parent as Container | undefined) {
    if (p.type === 'atrule' && /keyframes$/i.test((p as AtRule).name)) return true;
  }
  return false;
}

export default function crmDarkTheme(): Plugin {
  return {
    postcssPlugin: 'crm-dark-theme',
    // Once (not OnceExit): Vite's own url() rewrite runs after the user plugins'
    // Once hooks, so the image paths in DARK_IMAGES are still readable here.
    Once(root: Root) {
      const work: Array<[Rule, Out[]]> = [];
      root.walkRules((rule) => {
        if (!themed(rule.source?.input.file ?? root.source?.input.file, rule.selector)) return;
        if (rule.selector.includes('data-theme') || insideKeyframes(rule)) return;
        const outs: Out[] = [];
        rule.each((n) => {
          if (n.type === 'decl' && !n.prop.startsWith('--')) outs.push(...darkDecls(n));
        });
        if (outs.length) work.push([rule, outs]);
      });
      for (const [rule, outs] of work) {
        const copy = rule.clone({ selector: prefixSelector(rule.selector) });
        copy.removeAll();
        for (const d of outs) copy.append({ prop: d.prop, value: d.value, important: d.important });
        rule.after(copy);
      }
    },
  };
}
