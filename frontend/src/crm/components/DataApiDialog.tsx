// "Use on your website": the API for a business's own data, opened from the
// Catalog, Categories, Members (Doctors, Stylists…) and Offers pages. Website
// keys (kp_pub_…) read the list from the browser; secret keys (kp_live_…)
// do the rest from a server (bookings, stock and price updates). Every sample
// is ready to copy, with the new key filled in once one is made.
import { useEffect, useMemo, useState } from 'react';
import type { CrmApi } from '../api';
import type { ApiKeyInfo } from '../types';
import { useBackHandler } from '../useBackHandler';
import { API_DOCS_URL, ApiCode, ApiKeysSection } from './ApiKeys';
import { PlanCrown, useFeatureLock } from './PlanLocked';
import './TemplateApiDialog.css';

export type DataApiResource = 'catalog' | 'categories' | 'members' | 'offers';

interface Labels {
  /** "Doctors", "Products"… */
  many: string;
  /** "Doctor", "Product"… */
  one: string;
}

const PUB_PLACEHOLDER = 'YOUR_WEBSITE_KEY';
const SECRET_PLACEHOLDER = 'YOUR_SECRET_KEY';

interface Sample {
  title: string;
  note: string;
  method: 'GET' | 'POST' | 'PATCH';
  path: string;
  code: string;
  response?: unknown;
}

/** A browser snippet that lists the items safely (no innerHTML of API data). */
function websiteSnippet(url: string, key: string, resource: DataApiResource, labels: Labels): string {
  const id = `kapso-${resource}`;
  const line = {
    catalog: "card(p.imageUrl, p.name, '₹' + (p.offerPrice || p.price) + (p.availability === 'in_stock' ? '' : ' · Sold out'))",
    categories: "card(c.imageUrl, c.name, '')",
    members: "card(m.imageUrl, m.name, [m.title, m.fee ? '₹' + m.fee : ''].filter(Boolean).join(' · '))",
    offers: "card(o.items[0] && o.items[0].imageUrl, o.title, o.items.length + ' item(s) on offer')",
  }[resource];
  const v = { catalog: 'p', categories: 'c', members: 'm', offers: 'o' }[resource];
  return [
    `<!-- Your ${labels.many.toLowerCase()} from Kapso, on any page of your website -->`,
    `<div id="${id}"></div>`,
    '<script>',
    '(async () => {',
    `  const res = await fetch('${url}', {`,
    `    headers: { Authorization: 'Bearer ${key}' }, // a website key: read-only`,
    '  });',
    '  const { data } = await res.json();',
    `  const box = document.getElementById('${id}');`,
    '  const card = (img, title, sub) => {',
    "    const el = document.createElement('div');",
    "    el.className = 'kapso-card';",
    "    if (img) { const i = document.createElement('img'); i.src = img; i.alt = ''; el.append(i); }",
    "    const h = document.createElement('strong'); h.textContent = title; el.append(h);",
    "    if (sub) { const s = document.createElement('span'); s.textContent = sub; el.append(s); }",
    '    return el;',
    '  };',
    `  data.forEach((${v}) => box.append(${line}));`,
    '})();',
    '</script>',
  ].join('\n');
}

const curl = (method: string, url: string, key: string, body?: unknown) => [
  `curl ${method === 'GET' ? '' : `-X ${method} `}'${url}' \\`,
  `  -H 'Authorization: Bearer ${key}'${body ? ' \\' : ''}`,
  ...(body ? ["  -H 'Content-Type: application/json' \\", `  -d '${JSON.stringify(body, null, 2).replace(/'/g, "'\\''")}'`] : []),
].join('\n');

export function DataApiDialog({
  api, resource, labels, onClose,
}: {
  api: CrmApi;
  resource: DataApiResource;
  labels: Labels;
  onClose: () => void;
}) {
  const [fresh, setFresh] = useState<ApiKeyInfo | null>(null);
  useBackHandler(true, onClose);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('.app-dialog') && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  const origin = api.apiOrigin();
  const pub = (fresh?.type === 'publishable' && fresh.key) || PUB_PLACEHOLDER;
  const secret = (fresh?.type !== 'publishable' && fresh?.key) || SECRET_PLACEHOLDER;
  const v1 = `${origin}/api/v1`;

  const samples = useMemo<Sample[]>(() => {
    const list: Sample[] = [];
    if (resource === 'catalog') {
      list.push(
        { title: 'Show your products on your website', note: 'Paste into any page. It lists your active products with their price, offer price and stock.', method: 'GET', path: '/catalog/products', code: websiteSnippet(`${v1}/catalog/products?limit=50`, pub, 'catalog', labels) },
        { title: 'Filter and page', note: '?category=, ?q= (search the name), ?inStock=true, ?limit= (up to 100) and ?offset=.', method: 'GET', path: '/catalog/products', code: curl('GET', `${v1}/catalog/products?category=Biryani&inStock=true&limit=20`, pub), response: { data: [{ id: '66f…', sku: 'chicken_biryani', name: 'Chicken Biryani', price: 280, mrp: 320, offerPrice: 249, currency: 'INR', availability: 'in_stock', imageUrl: 'https://…', variants: [] }], total: 1, limit: 20, offset: 0, hasMore: false } },
        { title: 'Update price or stock from your server', note: 'A secret key, on your server. The WhatsApp catalog is updated too.', method: 'PATCH', path: '/catalog/products/{id or sku}', code: curl('PATCH', `${v1}/catalog/products/chicken_biryani`, secret, { price: 260, inStock: true }) },
      );
    } else if (resource === 'categories') {
      list.push(
        { title: `Show your ${labels.many.toLowerCase()} on your website`, note: 'Paste into any page.', method: 'GET', path: '/catalog/categories', code: websiteSnippet(`${v1}/catalog/categories`, pub, 'categories', labels) },
        { title: `List your ${labels.many.toLowerCase()}`, note: 'Active ones, in the order you set in the CRM.', method: 'GET', path: '/catalog/categories', code: curl('GET', `${v1}/catalog/categories`, pub), response: { data: [{ id: '66f…', name: 'Cardiology', imageUrl: 'https://…', order: 1 }] } },
      );
    } else if (resource === 'members') {
      list.push(
        { title: `Show your ${labels.many.toLowerCase()} on your website`, note: 'Paste into any page. Phone numbers and emails are never shared.', method: 'GET', path: '/members', code: websiteSnippet(`${v1}/members`, pub, 'members', labels) },
        { title: 'Free times on a day', note: 'The same times your WhatsApp booking flow offers. ?date=YYYY-MM-DD; /availability gives the next days at a glance.', method: 'GET', path: '/members/{id}/slots', code: curl('GET', `${v1}/members/MEMBER_ID/slots?date=2026-12-01`, pub), response: { memberId: '66f…', date: '2026-12-01', data: [{ start: '10:00', end: '10:30', label: '10:00 am', left: 1 }] } },
        { title: 'Book a slot from your server', note: 'A secret key, on your server. It appears in Appointments and in your notifications. Add an Idempotency-Key to retry safely.', method: 'POST', path: '/bookings', code: curl('POST', `${v1}/bookings`, secret, { memberId: 'MEMBER_ID', date: '2026-12-01', slot: '10:00', name: 'Ravi Kumar', phone: '+919876543210', email: 'ravi@example.com' }), response: { id: '67a…', member: 'Dr. Asha Rao', date: '2026-12-01', slot: '10:00', slotLabel: '10:00 am', status: 'confirmed', reference: 'CIT-261201-A3F19C', fee: 500 } },
      );
    } else {
      list.push(
        { title: 'Show your live offers on your website', note: 'Only offers that are on right now.', method: 'GET', path: '/offers', code: websiteSnippet(`${v1}/offers`, pub, 'offers', labels) },
        { title: 'List live offers', note: 'Each item has its original and offer price.', method: 'GET', path: '/offers', code: curl('GET', `${v1}/offers`, pub), response: { data: [{ id: '66f…', title: 'Weekend deal', endsAt: '2026-12-01T18:30:00.000Z', items: [{ productName: 'Chicken Biryani', originalPrice: 280, offerPrice: 249 }] }] } },
      );
    }
    return list;
  }, [resource, v1, pub, secret, labels]);

  return (
    <div className="tad-backdrop" onClick={onClose}>
      <div className="tad-box" role="dialog" aria-modal="true" aria-label="Use on your website" onClick={(e) => e.stopPropagation()} data-testid="data-api-dialog">
        <header className="tad-head">
          <span className="tad-head-ico" aria-hidden="true">
            <span className="material-icons">code</span>
          </span>
          <div className="tad-head-text">
            <h3>Your {labels.many.toLowerCase()} on your website</h3>
            <p>Show them on your own website or app, always up to date with the CRM, with an API key.</p>
          </div>
          <button type="button" className="tad-close" onClick={onClose} aria-label="Close">
            <span className="material-icons">close</span>
          </button>
        </header>

        <div className="tad-body">
          <ApiKeysSection api={api} heading="1. Your API keys" defaultType="publishable" onFresh={setFresh} />

          <section className="tad-sec">
            <h4>2. Use it</h4>
            {samples.map((r) => (
              <div key={r.title} className="tad-req" data-testid="data-api-sample">
                <div className="tad-req-title">
                  <span className={`tad-method${r.method !== 'GET' ? ' write' : ''}`}>{r.method}</span>
                  <code>/api/v1{r.path}</code>
                  <span className="tad-req-label">{r.title}</span>
                </div>
                <p className="tad-hint">{r.note}</p>
                <ApiCode text={r.code} />
                {r.response !== undefined && (
                  <details className="tad-resp">
                    <summary>Response</summary>
                    <ApiCode text={JSON.stringify(r.response, null, 2)} />
                  </details>
                )}
              </div>
            ))}
          </section>

          <section className="tad-sec tad-ref">
            <h4>3. Good to know</h4>
            <ul>
              <li>A <strong>website key</strong> can only read, and only on the websites you list on it, so it’s safe in your pages.</li>
              <li>A <strong>secret key</strong> does everything (bookings, price and stock updates, sending templates). Keep it on your server.</li>
              <li>Answers can be cached for a minute; free slots are always live.</li>
              <li>Website keys: 60 requests a minute per visitor. Secret keys: 120 a minute. Errors come back as <code>{'{ "error": { "code", "message" } }'}</code>.</li>
              <li>
                Every endpoint, field and error: <a href={API_DOCS_URL} target="_blank" rel="noopener noreferrer">kapsosolutions.com/docs</a>
              </li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

export default DataApiDialog;

/**
 * The "API" button for a page header: opens the dialog, or (outside the
 * plan) shows a crown and opens the plans.
 */
export function DataApiButton({ api, resource, labels }: { api: CrmApi; resource: DataApiResource; labels: Labels }) {
  const [open, setOpen] = useState(false);
  const apiPlan = useFeatureLock()('api');
  return (
    <>
      <button
        type="button"
        className={`k-btn ghost sm page-api-btn${apiPlan ? ' plan-locked' : ''}`}
        onClick={() => (apiPlan ? apiPlan.open() : setOpen(true))}
        title={apiPlan ? 'The API is included from the Basic plan' : `Show your ${labels.many.toLowerCase()} on your website`}
        data-testid={`${resource}-api-btn`}
        data-plan-locked={apiPlan ? apiPlan.tier : undefined}
      >
        <span className="material-icons" aria-hidden="true">code</span> API
        {apiPlan && <PlanCrown tier={apiPlan.tier} size={13} />}
      </button>
      {open && <DataApiDialog api={api} resource={resource} labels={labels} onClose={() => setOpen(false)} />}
    </>
  );
}
