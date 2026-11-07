// /solutions (by team and by industry) and /solutions/<slug>.
import { CtaBand, CtaButtons, PageHero, SitePage } from '../SiteChrome';
import { INDUSTRY_DESC, PAGE_META, PRODUCT_DESC, PRODUCT_TITLE, TEAM_DESC, type IndustrySlug, type TeamSlug } from '../siteMeta';
import { INDUSTRIES, SOLUTION_BY_SLUG, TEAMS } from '../content/solutions';
import { PRODUCT_BY_SLUG } from '../content/products';
import { ChatPhone, Crumbs, FaqList, FeatureGrid, LinkCard, Rich, Section } from './parts';
import { NotFoundPage } from './NotFoundPage';

const plain = (t: string) => t.replace(/\*/g, '');

export function SolutionsIndexPage() {
  return (
    <SitePage meta={PAGE_META.get('/solutions')}>
      {(openDemo) => (
        <>
          <PageHero
            eyebrow="Solutions"
            title={<Rich text="WhatsApp that fits *the way you work*" />}
            sub="Pick your business type when you sign up and the CRM names things your way (Doctors, Stylists, Rooms, Courses…) and opens the pages you need."
          >
            <CtaButtons onDemo={openDemo} />
          </PageHero>
          <Section title="By team" sub="How marketing, sales and support teams use Kapso every day.">
            <div className="sx-grid">
              {TEAMS.map((t) => (
                <LinkCard key={t.slug} href={`/solutions/${t.slug}`} icon={t.icon} title={t.eyebrow} text={TEAM_DESC(t.slug as TeamSlug)} />
              ))}
            </div>
          </Section>
          <Section title="By industry" sub="Every business type the CRM is set up for." tint>
            <div className="sx-grid">
              {INDUSTRIES.map((t) => (
                <LinkCard key={t.slug} href={`/solutions/${t.slug}`} icon={t.icon} title={t.eyebrow} text={INDUSTRY_DESC(t.slug as IndustrySlug)} />
              ))}
            </div>
          </Section>
          <CtaBand onDemo={openDemo} />
        </>
      )}
    </SitePage>
  );
}

export function SolutionPage({ slug }: { slug: string }) {
  const s = SOLUTION_BY_SLUG.get(slug);
  if (!s) return <NotFoundPage />;
  const others = (s.kind === 'team' ? TEAMS : INDUSTRIES).filter((x) => x.slug !== s.slug).slice(0, s.kind === 'team' ? 2 : 4);
  return (
    <SitePage meta={PAGE_META.get(`/solutions/${s.slug}`)}>
      {(openDemo) => (
        <>
          <section className="sx-hero left">
            <div className="sx-wrap sx-split">
              <div>
                <Crumbs items={[{ href: '/', label: 'Home' }, { href: '/solutions', label: 'Solutions' }, { label: s.eyebrow }]} />
                <div className="sx-eyebrow">
                  <span className="material-icons" aria-hidden="true">{s.icon}</span>
                  {s.eyebrow}
                </div>
                <h1 className="sx-h1"><Rich text={s.title} /></h1>
                <p className="sx-lead">{s.lead}</p>
                <CtaButtons onDemo={openDemo} />
              </div>
              <ChatPhone lines={s.chat} label={`${s.eyebrow} example chat`} />
            </div>
          </section>

          <Section title={s.kind === 'team' ? 'What your team can do' : `Kapso for ${plain(s.eyebrow)}`}>
            <FeatureGrid items={s.uses} />
          </Section>

          {s.kind === 'industry' && (
            <Section tint>
              <div className="sx-panel-box sx-made-for">
                <span className="material-icons" aria-hidden="true">tune</span>
                <div>
                  <h2 className="sx-h2">Set up for {plain(s.eyebrow)}</h2>
                  <p className="sx-sub">
                    Choose your business type when you sign up. The CRM then uses your own words for the people or things customers book
                    and the groups they belong to, and shows the pages your business needs.
                  </p>
                </div>
              </div>
            </Section>
          )}

          <Section title="The tools you’ll use" tint={s.kind === 'team'}>
            <div className="sx-grid">
              {s.products.map((p) => {
                const pc = PRODUCT_BY_SLUG.get(p);
                return pc ? <LinkCard key={p} href={`/product/${p}`} icon={pc.icon} title={PRODUCT_TITLE(p)} text={PRODUCT_DESC(p)} badge={pc.soon ? 'Soon' : undefined} /> : null;
              })}
            </div>
          </Section>

          {s.faqs && s.faqs.length > 0 && (
            <Section title="Questions" center>
              <FaqList items={s.faqs} />
            </Section>
          )}

          <Section title={s.kind === 'team' ? 'Other teams' : 'Other industries'} tint={s.kind === 'industry'}>
            <div className="sx-grid">
              {others.map((o) => (
                <LinkCard
                  key={o.slug}
                  href={`/solutions/${o.slug}`}
                  icon={o.icon}
                  title={o.eyebrow}
                  text={o.kind === 'team' ? TEAM_DESC(o.slug as TeamSlug) : INDUSTRY_DESC(o.slug as IndustrySlug)}
                />
              ))}
            </div>
          </Section>

          <CtaBand onDemo={openDemo} />
        </>
      )}
    </SitePage>
  );
}
