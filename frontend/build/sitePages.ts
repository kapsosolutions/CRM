// Vite build plugin: one HTML file per website page, so search engines (and
// link previews on WhatsApp, LinkedIn…) see each page with its own title,
// description, canonical address and Open Graph tags before any script runs.
//
//   dist/index.html                 home tags + Organization data
//   dist/pricing/index.html         /pricing's tags
//   dist/product/catalog/index.html …
//   dist/sitemap.xml, dist/robots.txt
//
// The files are copies of the built index.html with a different <head>; the
// same app then renders the page. nginx serves /pricing from
// /pricing/index.html (try_files $uri $uri/ …).
import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';
import { HOME_META, SITE_NAME, SITE_ORIGIN, SITE_PAGES, type SitePageMeta } from '../src/site/siteMeta';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const urlOf = (p: string) => `${SITE_ORIGIN}${p === '/' ? '/' : p}`;
const OG_IMAGE = `${SITE_ORIGIN}/hero.png`;

const ORGANIZATION = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': `${SITE_ORIGIN}/#organization`,
      name: SITE_NAME,
      url: `${SITE_ORIGIN}/`,
      logo: `${SITE_ORIGIN}/image.png`,
      email: 'support@kapsosolutions.com',
      contactPoint: [{ '@type': 'ContactPoint', telephone: '+91-79899-09361', contactType: 'sales', areaServed: 'IN', availableLanguage: ['en'] }],
      sameAs: ['https://www.instagram.com/kapsosolutions/', 'https://www.linkedin.com/company/kapsosolutions/'],
    },
    {
      '@type': 'WebSite',
      '@id': `${SITE_ORIGIN}/#website`,
      name: SITE_NAME,
      url: `${SITE_ORIGIN}/`,
      publisher: { '@id': `${SITE_ORIGIN}/#organization` },
    },
  ],
};

/** The tags for one page. */
export function headTags(meta: SitePageMeta): string {
  const url = urlOf(meta.path);
  const tags = [
    `<title>${esc(meta.title)}</title>`,
    `<meta name="description" content="${esc(meta.description)}" />`,
    `<link rel="canonical" href="${esc(url)}" />`,
    '<meta name="robots" content="index, follow" />',
    '<meta property="og:type" content="website" />',
    `<meta property="og:site_name" content="${esc(SITE_NAME)}" />`,
    `<meta property="og:title" content="${esc(meta.title)}" />`,
    `<meta property="og:description" content="${esc(meta.description)}" />`,
    `<meta property="og:url" content="${esc(url)}" />`,
    `<meta property="og:image" content="${OG_IMAGE}" />`,
    '<meta property="og:locale" content="en_IN" />',
    '<meta name="twitter:card" content="summary_large_image" />',
    `<meta name="twitter:title" content="${esc(meta.title)}" />`,
    `<meta name="twitter:description" content="${esc(meta.description)}" />`,
  ];
  if (meta.path === '/') {
    // JSON data, not a script: the page's CSP (script-src 'self') doesn't apply to it.
    tags.push(`<script type="application/ld+json">${JSON.stringify(ORGANIZATION).replace(/</g, '\\u003c')}</script>`);
  }
  return tags.join('\n    ');
}

/** index.html with this page's head. */
export function pageHtml(template: string, meta: SitePageMeta): string {
  const re = /<title>[^<]*<\/title>/;
  if (!re.test(template)) throw new Error('sitePages: index.html has no <title> to replace');
  return template.replace(re, headTags(meta));
}

export function sitemapXml(pages: SitePageMeta[], lastmod: string): string {
  const rows = pages.map((p) => [
    '  <url>',
    `    <loc>${esc(urlOf(p.path))}</loc>`,
    `    <lastmod>${lastmod}</lastmod>`,
    ...(p.priority !== undefined ? [`    <priority>${p.priority.toFixed(1)}</priority>`] : []),
    '  </url>',
  ].join('\n'));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.join('\n')}\n</urlset>\n`;
}

export const ROBOTS = [
  'User-agent: *',
  'Allow: /',
  // The API and the app's own callbacks aren't pages.
  'Disallow: /api/',
  'Disallow: /auth-callback.html',
  'Disallow: /instagram-callback.html',
  '',
  `Sitemap: ${SITE_ORIGIN}/sitemap.xml`,
  '',
].join('\n');

export default function sitePages(): Plugin {
  let outDir = 'dist';
  return {
    name: 'kapso-site-pages',
    apply: 'build',
    configResolved(cfg) {
      outDir = path.resolve(cfg.root, cfg.build.outDir);
    },
    writeBundle() {
      const indexFile = path.join(outDir, 'index.html');
      const template = fs.readFileSync(indexFile, 'utf8');
      // Home: the root file itself.
      fs.writeFileSync(indexFile, pageHtml(template, HOME_META));
      let n = 0;
      for (const meta of SITE_PAGES) {
        if (meta.path === '/') continue;
        const dir = path.join(outDir, ...meta.path.split('/').filter(Boolean));
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'index.html'), pageHtml(template, meta));
        n += 1;
      }
      const today = new Date().toISOString().slice(0, 10);
      fs.writeFileSync(path.join(outDir, 'sitemap.xml'), sitemapXml(SITE_PAGES, today));
      fs.writeFileSync(path.join(outDir, 'robots.txt'), ROBOTS);
      console.log(`[site-pages] wrote ${n} page files, sitemap.xml (${SITE_PAGES.length} URLs) and robots.txt`);
    },
  };
}
