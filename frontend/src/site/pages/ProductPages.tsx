// /product (every part of the product) and /product/<slug>.
import { CtaBand, CtaButtons, PageHero, SitePage } from '../SiteChrome';
import { PAGE_META, PRODUCT_DESC, PRODUCT_TITLE, type ProductSlug } from '../siteMeta';
import { MENUS } from '../siteMenus';
import { PRODUCT_BY_SLUG } from '../content/products';
import { ChatPhone, Crumbs, FaqList, FeatureGrid, LinkCard, PlanNote, Rich, Section, Steps } from './parts';
import { NotFoundPage } from './NotFoundPage';

export function ProductIndexPage() {
  const groups = MENUS.find((m) => m.key === 'product')?.groups || [];
  return (
    <SitePage meta={PAGE_META.get('/product')}>
      {(openDemo) => (
        <>
          <PageHero
            eyebrow="Product"
            title={<Rich text="Everything your business needs *on WhatsApp*" />}
            sub="One CRM on the official WhatsApp Business API: a team inbox, campaigns, chatbots, native WhatsApp forms, your catalog, payments, bookings and calling, plus an API for your own website and apps."
          >
            <CtaButtons onDemo={openDemo} />
          </PageHero>
          {groups.map((g, i) => (
            <Section key={g.title} title={g.title} tint={i % 2 === 1}>
              <div className="sx-grid">
                {g.links.map((l) => (
                  <LinkCard key={l.href} href={l.href} icon={l.icon} title={l.label} text={l.desc || ''} badge={l.badge} />
                ))}
              </div>
            </Section>
          ))}
          <CtaBand onDemo={openDemo} />
        </>
      )}
    </SitePage>
  );
}

export function ProductPage({ slug }: { slug: string }) {
  const p = PRODUCT_BY_SLUG.get(slug as ProductSlug);
  if (!p) return <NotFoundPage />;
  return (
    <SitePage meta={PAGE_META.get(`/product/${p.slug}`)}>
      {(openDemo) => (
        <>
          <section className="sx-hero left">
            <div className="sx-wrap sx-split">
              <div>
                <Crumbs items={[{ href: '/', label: 'Home' }, { href: '/product', label: 'Product' }, { label: p.eyebrow }]} />
                <div className="sx-eyebrow">
                  <span className="material-icons" aria-hidden="true">{p.icon}</span>
                  {p.eyebrow}
                  {p.soon && <span className="sx-badge-soon">Soon</span>}
                </div>
                <h1 className="sx-h1"><Rich text={p.title} /></h1>
                <p className="sx-lead">{p.lead}</p>
                <ul className="sx-check-list">
                  {p.points.map((x) => <li key={x}>{x}</li>)}
                </ul>
                <PlanNote feature={p.plan} soon={p.soon} />
                <CtaButtons onDemo={openDemo} />
              </div>
              <ChatPhone lines={p.chat} label={`${p.eyebrow} example`} />
            </div>
          </section>

          <Section title="What you get" sub={PRODUCT_DESC(p.slug)}>
            <FeatureGrid items={p.features} />
          </Section>

          <Section title="How it works" tint>
            <Steps items={p.steps} />
          </Section>

          {p.faqs.length > 0 && (
            <Section title="Questions" center>
              <FaqList items={p.faqs} />
            </Section>
          )}

          {p.related.length > 0 && (
            <Section title="Works well with" tint>
              <div className="sx-grid">
                {p.related.map((r) => {
                  const rp = PRODUCT_BY_SLUG.get(r);
                  return rp ? <LinkCard key={r} href={`/product/${r}`} icon={rp.icon} title={PRODUCT_TITLE(r)} text={PRODUCT_DESC(r)} badge={rp.soon ? 'Soon' : undefined} /> : null;
                })}
              </div>
            </Section>
          )}

          <CtaBand onDemo={openDemo} />
        </>
      )}
    </SitePage>
  );
}
