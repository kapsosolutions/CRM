// /about: who we are and what we do. Only facts about the company.
import { BRAND, CtaBand, CtaButtons, PageHero, SALES_PHONE, SALES_TEL, SiteLink, SitePage, WHATSAPP_HREF } from '../SiteChrome';
import { PAGE_META } from '../siteMeta';
import { FeatureGrid, LinkCard, Section } from './parts';

const SERVICES = [
  { href: '/product', icon: 'forum', title: 'WhatsApp CRM & automation', text: 'Our own platform on the official WhatsApp Business API: team inbox, campaigns, chatbots, WhatsApp Flows, catalog, payments and bookings.' },
  { href: '/product/whatsapp-business-api', icon: 'verified', title: 'WhatsApp API & Meta verification', text: 'We get your number on the WhatsApp Business API and help you through Meta business verification and template approval.' },
  { href: '/contact', icon: 'language', title: 'Custom websites', text: 'Fast, search-friendly websites for your business, connected to WhatsApp, your catalog and bookings through our API.' },
  { href: '/contact', icon: 'smartphone', title: 'Mobile apps', text: 'Android and iOS apps built for your business, which can send WhatsApp updates and one-time codes through our API.' },
];

const VALUES = [
  { icon: 'verified_user', title: 'Official APIs only', text: 'Everything runs on Meta’s official WhatsApp Cloud API with your own number. No unofficial tools that get numbers banned.' },
  { icon: 'lock', title: 'Your data is yours', text: 'We process your customers’ data only to run the service, as our Privacy Policy describes, and delete it when you ask.' },
  { icon: 'currency_rupee', title: 'Priced for growing businesses', text: 'Plans from ₹499 a month with unlimited contacts, no setup fee and no automatic renewals.' },
  { icon: 'support_agent', title: 'People you can reach', text: 'Talk to us on WhatsApp, by phone or by email. We help you set up your number, templates and journeys.' },
];

export function AboutPage() {
  return (
    <SitePage meta={PAGE_META.get('/about')}>
      {(openDemo) => (
        <>
          <PageHero
            eyebrow="About us"
            title={<>We help businesses grow <em>on WhatsApp</em></>}
            sub={`${BRAND} is a technology partner specialising in WhatsApp automation, Meta business verification, and custom website and mobile app development.`}
          >
            <CtaButtons onDemo={openDemo} />
          </PageHero>

          <Section title="What we do" sub="One team for your WhatsApp, your website and your app.">
            <div className="sx-grid">
              {SERVICES.map((s) => <LinkCard key={s.title} {...s} />)}
            </div>
          </Section>

          <Section title="How we work" tint>
            <FeatureGrid items={VALUES} />
          </Section>

          <Section>
            <div className="sx-split">
              <div>
                <h2 className="sx-h2">Built in India, for businesses everywhere</h2>
                <p className="sx-sub">
                  {BRAND} Private Limited builds and runs the {BRAND} WhatsApp CRM. We are a Meta Business Partner, and we build for shops,
                  clinics, salons, restaurants, schools and service businesses that want to sell and serve on the app their customers already use.
                </p>
                <div className="sx-chip-row">
                  <SiteLink className="sx-chip" href="/solutions">Industries we serve</SiteLink>
                  <SiteLink className="sx-chip" href="/developers">Our API</SiteLink>
                  <SiteLink className="sx-chip" href="/pricing">Pricing</SiteLink>
                </div>
              </div>
              <div className="sx-panel-box">
                <h3 className="sx-about-h3">Talk to us</h3>
                <ul className="sx-contact-list">
                  <li>
                    <span className="material-icons" aria-hidden="true">call</span>
                    <div><strong>Sales</strong><a href={SALES_TEL}>{SALES_PHONE}</a></div>
                  </li>
                  <li>
                    <span className="material-icons" aria-hidden="true">chat</span>
                    <div><strong>WhatsApp</strong><a href={WHATSAPP_HREF} target="_blank" rel="noopener noreferrer">Chat with us</a></div>
                  </li>
                  <li>
                    <span className="material-icons" aria-hidden="true">mail</span>
                    <div><strong>Email</strong><a href="mailto:support@kapsosolutions.com">support@kapsosolutions.com</a></div>
                  </li>
                </ul>
              </div>
            </div>
          </Section>

          <CtaBand onDemo={openDemo} />
        </>
      )}
    </SitePage>
  );
}
