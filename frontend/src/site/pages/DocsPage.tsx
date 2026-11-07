// /docs: the API reference. Guides first, then every endpoint from
// content/apiDocs.ts with examples in cURL, JavaScript and Python.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { SiteLink, SitePage } from '../SiteChrome';
import { PAGE_META } from '../siteMeta';
import { API_BASE, ERRORS, GROUPS, LANGS, exampleCode, type Endpoint, type Lang, type Param } from '../content/apiDocs';
import { CodeBlock, Rich } from './parts';

const LANG_KEY = 'kapso-docs-lang';

const GUIDES: { id: string; title: string }[] = [
  { id: 'introduction', title: 'Introduction' },
  { id: 'authentication', title: 'Authentication' },
  { id: 'website-keys', title: 'Website keys' },
  { id: 'errors', title: 'Errors' },
  { id: 'rate-limits', title: 'Rate limits' },
  { id: 'idempotency', title: 'Safe retries' },
  { id: 'pagination', title: 'Pages & caching' },
];
const EXAMPLES: { id: string; title: string }[] = [
  { id: 'example-products', title: 'Products on your website' },
  { id: 'example-booking', title: 'A booking form' },
];

const PRODUCTS_EXAMPLE = `<div id="products"></div>
<script>
  // A website key (kp_pub_…) that lists this website. Safe in a page.
  const KEY = 'kp_pub_…';
  fetch('${API_BASE}/catalog/products?inStock=true&limit=24', {
    headers: { Authorization: 'Bearer ' + KEY },
  })
    .then((r) => r.json())
    .then(({ data }) => {
      const box = document.getElementById('products');
      for (const p of data) {
        const card = document.createElement('div');
        if (p.imageUrl) {
          const img = document.createElement('img');
          img.src = p.imageUrl;
          img.alt = p.name;
          img.width = 160;
          card.appendChild(img);
        }
        const name = document.createElement('h3');
        name.textContent = p.name;               // textContent: never innerHTML
        const price = document.createElement('p');
        price.textContent = '₹' + (p.offerPrice ?? p.price);
        card.append(name, price);
        box.appendChild(card);
      }
    });
</script>`;

const BOOKING_BROWSER = `// In the page: show free slots with a website key.
const KEY = 'kp_pub_…';
const api = (path) =>
  fetch('${API_BASE}' + path, { headers: { Authorization: 'Bearer ' + KEY } })
    .then((r) => r.json());

const { data: members } = await api('/members');
const { data: slots } = await api('/members/' + members[0].id + '/slots?date=2026-12-01');
// slots → [{ start: "10:00", label: "10:00 AM", left: 1 }, …]

// When the visitor picks a slot, send it to YOUR server (not to Kapso):
await fetch('/book', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ memberId: members[0].id, date: '2026-12-01', slot: '10:00',
                         name: 'Priya Sharma', phone: '+919876543210' }),
});`;

const BOOKING_SERVER = `// On your server (Node.js + Express): book with the secret key.
import express from 'express';
import crypto from 'node:crypto';

const app = express();
app.use(express.json());

app.post('/book', async (req, res) => {
  // Add your own checks here: a captcha, a signed-in user, a payment…
  const r = await fetch('${API_BASE}/bookings', {
    method: 'POST',
    headers: {
      Authorization: \`Bearer \${process.env.KAPSO_SECRET_KEY}\`,
      'Content-Type': 'application/json',
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify(req.body),
  });
  const data = await r.json();
  res.status(r.status).json(data); // 201 → booked; 409 slot_unavailable → pick another
});

app.listen(3000);`;

function useActiveSection(ids: string[]) {
  const [active, setActive] = useState(ids[0]);
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return undefined;
    const seen = new Map<string, boolean>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target.id, e.isIntersecting);
        const first = ids.find((id) => seen.get(id));
        if (first) setActive(first);
      },
      { rootMargin: '-90px 0px -65% 0px' },
    );
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, [ids]);
  return active;
}

function KeyPill({ kind }: { kind: Endpoint['key'] }) {
  return kind === 'secret'
    ? <span className="sx-key-pill sec" title="Needs a secret key, from your server">Secret key</span>
    : <span className="sx-key-pill pub" title="A secret key or a website key">Secret or website key</span>;
}

function Params({ title, rows }: { title: string; rows?: Param[] }) {
  if (!rows?.length) return null;
  return (
    <>
      <h4 className="sx-docs-h4">{title}</h4>
      <div className="sx-table-wrap">
        <table className="sx-table sx-params">
          <tbody>
            {rows.map((p) => (
              <tr key={p.name}>
                <td className="sx-param-name">
                  <code>{p.name}</code>
                  <span className="sx-param-type">{p.type}</span>
                  {p.required && <span className="sx-param-req">required</span>}
                </td>
                <td><Rich text={p.text} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function LangTabs({ lang, onLang }: { lang: Lang; onLang: (l: Lang) => void }) {
  return (
    <div className="sx-tabs" role="tablist" aria-label="Example language">
      {LANGS.map((l) => (
        <button key={l.key} type="button" role="tab" aria-selected={lang === l.key} className={`sx-tab${lang === l.key ? ' on' : ''}`} onClick={() => onLang(l.key)}>
          {l.label}
        </button>
      ))}
    </div>
  );
}

function EndpointDoc({ e, lang, onLang }: { e: Endpoint; lang: Lang; onLang: (l: Lang) => void }) {
  return (
    <article className="sx-endpoint" id={e.id} data-testid={`doc-${e.id}`}>
      <div className="sx-endpoint-head">
        <h3>{e.title}</h3>
        <KeyPill kind={e.key} />
      </div>
      <div className="sx-endpoint-line">
        <span className={`sx-method ${e.method.toLowerCase()}`}>{e.method}</span>
        <span className="sx-path">/api/v1{e.path}</span>
      </div>
      <p><Rich text={e.text} /></p>
      <Params title="Path" rows={e.pathParams} />
      <Params title="Query" rows={e.query} />
      <Params title="Body (JSON)" rows={e.body} />
      <h4 className="sx-docs-h4">Example</h4>
      <LangTabs lang={lang} onLang={onLang} />
      <CodeBlock code={exampleCode(e, lang)} label={`${e.title} example`} />
      <h4 className="sx-docs-h4">Answer <span className="sx-status">{e.status || 200}</span></h4>
      <CodeBlock code={e.response} label={`${e.title} answer`} />
      {e.notes && e.notes.length > 0 && (
        <ul className="sx-docs-notes">
          {e.notes.map((n) => <li key={n}><Rich text={n} /></li>)}
        </ul>
      )}
    </article>
  );
}

function H2({ id, children }: { id: string; children: ReactNode }) {
  return <h2 id={id}>{children}</h2>;
}

export function DocsPage() {
  const [lang, setLangState] = useState<Lang>(() => {
    try {
      const v = localStorage.getItem(LANG_KEY) as Lang | null;
      return v && LANGS.some((l) => l.key === v) ? v : 'curl';
    } catch {
      return 'curl';
    }
  });
  const setLang = (l: Lang) => {
    setLangState(l);
    try { localStorage.setItem(LANG_KEY, l); } catch { /* ignore */ }
  };

  const ids = useMemo(
    () => [...GUIDES.map((g) => g.id), ...GROUPS.flatMap((g) => [g.id, ...g.endpoints.map((e) => e.id)]), ...EXAMPLES.map((x) => x.id)],
    [],
  );
  const active = useActiveSection(ids);

  // Opened at /docs#something: go there once the page is drawn.
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (id && !id.startsWith('/')) window.setTimeout(() => document.getElementById(id)?.scrollIntoView(), 50);
  }, []);

  const navLink = (id: string, label: ReactNode, sub = false) => (
    <a key={id} href={`#${id}`} className={`${active === id ? 'on' : ''}${sub ? ' sub' : ''}`} aria-current={active === id ? 'true' : undefined}>
      {label}
    </a>
  );

  return (
    <SitePage meta={PAGE_META.get('/docs')} className="sx-docs-page">
      {() => (
        <div className="sx-wrap">
          <div className="sx-docs">
            <nav className="sx-docs-nav" aria-label="API documentation">
              <div className="grp">Getting started</div>
              {GUIDES.map((g) => navLink(g.id, g.title))}
              {GROUPS.map((g) => (
                <div key={g.id}>
                  <div className="grp">{g.title}</div>
                  {g.endpoints.map((e) => navLink(e.id, (
                    <>
                      <span className={`sx-method mini ${e.method.toLowerCase()}`}>{e.method}</span>
                      {e.title}
                    </>
                  ), true))}
                </div>
              ))}
              <div className="grp">Examples</div>
              {EXAMPLES.map((x) => navLink(x.id, x.title))}
            </nav>

            <div className="sx-docs-body">
              <div className="sx-crumbs">
                <SiteLink href="/developers">Developers</SiteLink><span aria-hidden="true">/</span><strong>API reference</strong>
              </div>
              <h1 className="sx-h1 sx-docs-title">Kapso API reference</h1>

              <H2 id="introduction">Introduction</H2>
              <p>
                The Kapso API lets your own servers, apps and websites use your Kapso account: send WhatsApp templates and one-time codes,
                read your catalog, offers, members and their free slots, update products, and take bookings. It is a REST API over HTTPS
                that takes and returns JSON.
              </p>
              <CodeBlock code={`Base URL   ${API_BASE}`} label="Base URL" />
              <ul>
                <li><strong>Phone numbers</strong> include the country code: <code>+919876543210</code> (spaces, dashes and the <code>+</code> are optional).</li>
                <li><strong>Dates</strong> are <code>YYYY-MM-DD</code> and slot times are <code>HH:MM</code> (24-hour), in the business’s local time (IST).</li>
                <li><strong>Timestamps</strong> such as <code>createdAt</code> are ISO 8601 in UTC.</li>
                <li><strong>Money</strong> is in rupees as a number (<code>1499</code> is ₹1,499).</li>
                <li><strong>Versions:</strong> this is v1. Within v1 we only add things (new fields, endpoints and error codes), so write code that ignores fields it doesn’t know.</li>
                <li><strong>Plans:</strong> the API is part of the Basic, Pro and Premium plans (and the 7-day free trial). See <SiteLink href="/pricing">pricing</SiteLink>.</li>
              </ul>

              <H2 id="authentication">Authentication</H2>
              <p>Every request carries an API key, in either header:</p>
              <CodeBlock code={'Authorization: Bearer kp_live_…\n# or\nX-API-Key: kp_live_…'} label="Authentication headers" />
              <p>There are two kinds of key. Create them in the CRM: open <strong>API</strong> on the Templates, Catalog, Categories, Members or Offers page.</p>
              <div className="sx-table-wrap">
                <table className="sx-table">
                  <thead><tr><th scope="col" /><th scope="col">Secret key</th><th scope="col">Website key</th></tr></thead>
                  <tbody>
                    <tr><th scope="row">Looks like</th><td><code>kp_live_…</code></td><td><code>kp_pub_…</code></td></tr>
                    <tr><th scope="row">Use from</th><td>Your server or backend</td><td>Your web pages</td></tr>
                    <tr><th scope="row">Can call</th><td>Every endpoint</td><td><code>GET</code> on <code>/business</code>, <code>/catalog/…</code>, <code>/offers</code>, <code>/members/…</code></td></tr>
                    <tr><th scope="row">From a browser</th><td>Refused (<code>secret_key_in_browser</code>)</td><td>Only from the websites listed on the key</td></tr>
                  </tbody>
                </table>
              </div>
              <ul>
                <li>The full key is shown once, when you create it. We store only a hash of it, so copy it somewhere safe.</li>
                <li>Keep secret keys out of web pages, mobile apps and code repositories. Put them in your server’s environment variables.</li>
                <li>Revoke a key in the CRM and it stops working at once. You can have up to 10 active keys.</li>
                <li>Messaging and code endpoints also need your own WhatsApp number connected (<code>whatsapp_not_connected</code> otherwise).</li>
              </ul>

              <H2 id="website-keys">Website keys</H2>
              <p>
                A website key is made to sit in a web page, where visitors can see it. It can only read what your website shows anyway (business
                details, categories, products, offers, members and free slots), never messages, contacts, bookings or a member’s phone and email.
              </p>
              <p>When you create one, list the websites that will use it (up to 10):</p>
              <ul>
                <li><code>https://www.yourclinic.com</code>: that exact website.</li>
                <li><code>https://*.yourclinic.com</code>: every subdomain of it.</li>
                <li><code>http://localhost:5173</code>: your computer while you build (plain <code>http</code> is allowed only for localhost).</li>
              </ul>
              <p>
                Browsers tell us which website a request comes from (the <code>Origin</code> header), and a website key refuses any website it doesn’t list
                (<code>origin_not_allowed</code>). The API answers browsers’ CORS checks for every website, and sends no cookies. Change the websites on a key in
                the CRM at any time without changing the key.
              </p>

              <H2 id="errors">Errors</H2>
              <p>Errors use the HTTP status and a JSON body with a stable <code>code</code> to check in your code, and a <code>message</code> to show or log:</p>
              <CodeBlock code={`HTTP/1.1 400 Bad Request

{
  "error": {
    "code": "variables_mismatch",
    "message": "\\"order_confirmed\\" takes 3 variables; 2 given.",
    "expected": 3
  }
}`} label="Error example" />
              {ERRORS.map((g) => (
                <div key={g.group}>
                  <h3>{g.group}</h3>
                  <div className="sx-table-wrap">
                    <table className="sx-table sx-errors">
                      <thead><tr><th scope="col">Status</th><th scope="col">Code</th><th scope="col">Meaning</th></tr></thead>
                      <tbody>
                        {g.rows.map(([status, code, text]) => (
                          <tr key={code}>
                            <td>{status}</td>
                            <td><code>{code}</code></td>
                            <td><Rich text={text} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}

              <H2 id="rate-limits">Rate limits</H2>
              <div className="sx-table-wrap">
                <table className="sx-table">
                  <thead><tr><th scope="col">What</th><th scope="col">Limit</th></tr></thead>
                  <tbody>
                    <tr><td>Secret key</td><td>120 requests a minute</td></tr>
                    <tr><td>Website key, per visitor (IP address)</td><td>60 requests a minute</td></tr>
                    <tr><td>Website key, in total</td><td>1,200 requests a minute</td></tr>
                    <tr><td>Requests with a wrong key, per IP address</td><td>20 in 10 minutes, then blocked for the rest of the 10 minutes</td></tr>
                  </tbody>
                </table>
              </div>
              <p>
                Answers carry <code>X-RateLimit-Limit</code>, <code>X-RateLimit-Remaining</code> and <code>X-RateLimit-Reset</code> (a Unix time). Over the limit you get
                <code> 429 rate_limited</code> with a <code>Retry-After</code> header in seconds. WhatsApp also limits how fast and how many people your number can
                message each day; those come back as <code>throughput_limited</code> or <code>pair_rate_limited</code>.
              </p>

              <H2 id="idempotency">Safe retries</H2>
              <p>
                A network error can leave you unsure whether a send or booking went through. Send an <code>Idempotency-Key</code> header (any unique string up to 128
                characters, such as your order id or a UUID) with <code>POST /messages/template</code>, <code>POST /otp/send</code> and <code>POST /bookings</code>. Retrying with the same key
                returns the first answer, with the header <code>Idempotent-Replayed: true</code>, instead of doing it again.
              </p>
              <ul>
                <li>Keys are remembered for up to 24 hours, per account.</li>
                <li>While the first request is still running, a retry gets <code>409 idempotency_in_progress</code>.</li>
                <li>Server errors (5xx) aren’t remembered, so a retry runs again.</li>
              </ul>

              <H2 id="pagination">Pages &amp; caching</H2>
              <p>
                Lists of products and members come in pages: pass <code>limit</code> (1 to 100, default 50) and <code>offset</code>. The answer has <code>total</code>,
                <code> limit</code>, <code>offset</code> and <code>hasMore</code>.
              </p>
              <p>
                Catalog, offer and member answers may be cached for 60 seconds (<code>/business</code> for 5 minutes), so a busy page stays fast. Free slots and
                everything that changes data are never cached.
              </p>

              {GROUPS.map((g) => (
                <section key={g.id} className="sx-docs-group">
                  <H2 id={g.id}>{g.title}</H2>
                  <p><Rich text={g.text} /></p>
                  {g.endpoints.map((e) => <EndpointDoc key={e.id} e={e} lang={lang} onLang={setLang} />)}
                </section>
              ))}

              <H2 id="example-products">Example: products on your website</H2>
              <p>
                Paste this into any page of a website listed on your website key. It shows your in-stock products with their offer prices.
                It builds the page with <code>textContent</code>, so product names can never inject code into your site.
              </p>
              <CodeBlock code={PRODUCTS_EXAMPLE} label="Products on your website" />

              <H2 id="example-booking">Example: a booking form</H2>
              <p>
                The page shows members and free slots with a website key. The booking itself goes through your server, which holds the secret key
                and can add its own checks.
              </p>
              <CodeBlock code={BOOKING_BROWSER} label="Booking form, in the page" />
              <div className="sx-gap" />
              <CodeBlock code={BOOKING_SERVER} label="Booking form, on your server" />

              <div className="sx-docs-help">
                <strong>Need help?</strong> Email <a href="mailto:support@kapsosolutions.com">support@kapsosolutions.com</a> or <SiteLink href="/contact?topic=api">send us a message</SiteLink>.
              </div>
            </div>
          </div>
        </div>
      )}
    </SitePage>
  );
}
