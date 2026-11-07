// /developers (the hub) and /developers/<slug>.
import { CtaBand, SiteLink, SitePage } from '../SiteChrome';
import { DEV_DESC, DEV_TITLE, PAGE_META, type DevSlug } from '../siteMeta';
import { DEV_BY_SLUG, DEV_TOPICS, type DevTopic } from '../content/developers';
import { API_BASE } from '../content/apiDocs';
import { CodeBlock, Crumbs, FaqList, FeatureGrid, LinkCard, PlanNote, Rich, Section, Steps } from './parts';
import { NotFoundPage } from './NotFoundPage';

function DevButtons() {
  return (
    <div className="sx-cta-row">
      <SiteLink className="sx-btn primary" href="/docs">Read the API docs <span aria-hidden="true">→</span></SiteLink>
      <a className="sx-btn secondary" href="/#/register">Get an API key</a>
    </div>
  );
}

export function EndpointTable({ rows }: { rows: DevTopic['endpoints'] }) {
  return (
    <div className="sx-table-wrap">
      <table className="sx-table sx-endpoints">
        <thead>
          <tr>
            <th scope="col">Endpoint</th>
            <th scope="col">What it does</th>
            <th scope="col">Key</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.method + e.path}>
              <td>
                <SiteLink href={`/docs#${e.anchor}`} className="sx-endpoint-link">
                  <span className={`sx-method ${e.method.toLowerCase()}`}>{e.method}</span>
                  <span className="sx-path">{e.path}</span>
                </SiteLink>
              </td>
              <td>{e.text}</td>
              <td>
                {e.key === 'secret'
                  ? <span className="sx-key-pill sec">Secret</span>
                  : <span className="sx-key-pill pub">Secret or website</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const QUICK = `curl ${API_BASE}/templates \\
  -H "Authorization: Bearer $KAPSO_SECRET_KEY"`;

const BASICS = [
  { href: '/docs#authentication', icon: 'key', title: 'Authentication', text: 'Send your key as a Bearer token. Secret keys for servers, website keys for web pages.' },
  { href: '/docs#errors', icon: 'error_outline', title: 'Errors', text: 'Every error is JSON with a stable code and a message that says what to do.' },
  { href: '/docs#rate-limits', icon: 'speed', title: 'Rate limits', text: '120 requests a minute per secret key, with standard rate-limit headers.' },
  { href: '/docs#idempotency', icon: 'repeat', title: 'Safe retries', text: 'An Idempotency-Key makes sends and bookings safe to retry.' },
];

export function DevelopersPage() {
  return (
    <SitePage meta={PAGE_META.get('/developers')}>
      {(openDemo) => (
        <>
          <section className="sx-hero left sx-dev-hero">
            <div className="sx-wrap sx-split">
              <div>
                <div className="sx-eyebrow">For developers</div>
                <h1 className="sx-h1"><Rich text="Build on WhatsApp with *the Kapso API*" /></h1>
                <p className="sx-lead">
                  A simple REST API for your apps, servers and websites: send WhatsApp templates and one-time codes, show your catalog,
                  members and free slots on your own site, and take bookings.
                </p>
                <PlanNote feature="api" />
                <DevButtons />
              </div>
              <div>
                <CodeBlock code={QUICK} label="List your templates" />
                <p className="sx-note">Base URL: <code>{API_BASE}</code> · JSON in, JSON out.</p>
              </div>
            </div>
          </section>

          <Section title="What you can build">
            <div className="sx-grid">
              {DEV_TOPICS.map((t) => (
                <LinkCard key={t.slug} href={`/developers/${t.slug}`} icon={t.icon} title={DEV_TITLE(t.slug)} text={DEV_DESC(t.slug)} />
              ))}
              <LinkCard href="/docs" icon="menu_book" title="API reference" text="Every endpoint with its parameters, answers and examples in cURL, JavaScript and Python." more="Open the docs" />
            </div>
          </Section>

          <Section title="Two kinds of keys" sub="Create and revoke both in the CRM. Up to 10 active keys per account." tint>
            <div className="sx-table-wrap">
              <table className="sx-table">
                <thead>
                  <tr><th scope="col" /><th scope="col">Secret key <code>kp_live_…</code></th><th scope="col">Website key <code>kp_pub_…</code></th></tr>
                </thead>
                <tbody>
                  <tr><th scope="row">Use it from</th><td>Your server or app backend</td><td>Your web pages (the visitor’s browser)</td></tr>
                  <tr><th scope="row">Can do</th><td>Everything: send messages and codes, update products, book</td><td>Read business, catalog, offers, members and free slots</td></tr>
                  <tr><th scope="row">Safety</th><td>Refused if used from a browser</td><td>Works only from the websites you list on it</td></tr>
                  <tr><th scope="row">Rate limit</th><td>120 requests a minute</td><td>60 a minute per visitor, 1,200 a minute in total</td></tr>
                </tbody>
              </table>
            </div>
          </Section>

          <Section title="Start in three steps">
            <Steps
              items={[
                { title: 'Sign up and connect WhatsApp', text: 'Create your account and connect your number with Meta’s official signup.' },
                { title: 'Create a key', text: 'Open API on the Templates, Catalog, Members or Offers page and create a secret or website key.' },
                { title: 'Make your first call', text: 'Call the API with your key as a Bearer token. The docs have copy-paste examples.' },
              ]}
            />
          </Section>

          <Section title="The basics" tint>
            <div className="sx-grid">
              {BASICS.map((b) => <LinkCard key={b.href} {...b} more="Read more" />)}
            </div>
          </Section>

          <CtaBand onDemo={openDemo} title="Questions about the API?" sub="Tell us what you’re building and we’ll help you set it up." />
        </>
      )}
    </SitePage>
  );
}

export function DevTopicPage({ slug }: { slug: string }) {
  const t = DEV_BY_SLUG.get(slug as DevSlug);
  if (!t) return <NotFoundPage />;
  const others = DEV_TOPICS.filter((x) => x.slug !== t.slug);
  return (
    <SitePage meta={PAGE_META.get(`/developers/${t.slug}`)}>
      {(openDemo) => (
        <>
          <section className="sx-hero left sx-dev-hero">
            <div className="sx-wrap sx-split">
              <div>
                <Crumbs items={[{ href: '/', label: 'Home' }, { href: '/developers', label: 'Developers' }, { label: t.eyebrow }]} />
                <div className="sx-eyebrow">
                  <span className="material-icons" aria-hidden="true">{t.icon}</span>
                  {t.eyebrow}
                </div>
                <h1 className="sx-h1"><Rich text={t.title} /></h1>
                <p className="sx-lead">{t.lead}</p>
                <ul className="sx-check-list">
                  {t.points.map((p) => <li key={p}>{p}</li>)}
                </ul>
                <PlanNote feature="api" />
                <DevButtons />
              </div>
              <div>
                <div className="sx-sample-label">{t.sample.label}</div>
                <CodeBlock code={t.sample.code} label={t.sample.label} />
              </div>
            </div>
          </section>

          <Section title="What you get">
            <FeatureGrid items={t.features} />
          </Section>

          <Section title="Endpoints" sub="Click one for its parameters, answer and examples." tint>
            <EndpointTable rows={t.endpoints} />
          </Section>

          <Section title="How to start">
            <Steps items={t.steps} />
          </Section>

          <Section title="Questions" center tint>
            <FaqList items={t.faqs} />
          </Section>

          <Section title="More of the API">
            <div className="sx-grid">
              {others.map((o) => <LinkCard key={o.slug} href={`/developers/${o.slug}`} icon={o.icon} title={DEV_TITLE(o.slug)} text={DEV_DESC(o.slug)} />)}
            </div>
          </Section>

          <CtaBand onDemo={openDemo} title="Start building today" sub="Every new account can try the API free for 7 days." />
        </>
      )}
    </SitePage>
  );
}
