// Public landing page (/): what the platform is, with the website's header
// (Solutions / Product / Resources / API / Pricing menus) and footer from
// SiteChrome. The other website pages live under site/pages/.
import { useState } from 'react';
import { DemoModal } from './DemoModal';
import { useSmoothScroll } from './useSmoothScroll';
import { BuyNowSvg } from '../crm/components/TemplateIcons';
import { CycleToggle, PlanCards } from '../crm/components/PlanCards';
import type { BillingCycle } from '../crm/plans';
import { SiteFooter, SiteHeader, WhatsAppFloat } from './SiteChrome';
import { HOME_META } from './siteMeta';
import { useSeo } from './siteNav';
import './site.css';

interface FaqItem {
  q: string;
  a: string;
}

const FAQ_ITEMS: FaqItem[] = [
  {
    q: 'What does Kapso Solutions do?',
    a: 'Kapso Solutions provides businesses with a WhatsApp marketing software they can use to Broadcast & automate messages, run Click to WhatsApp Ads, build Chatbots, showcase catalogues, provide multi-agent Live chat support, collect payments within WhatsApp and much more.',
  },
  {
    q: 'Is Kapso Solutions an Official WhatsApp Marketing Software?',
    a: 'Yes, Kapso Solutions is an Official WhatsApp Business Solution Partner (BSP) built on WhatsApp Business APIs.',
  },
  {
    q: 'Can I try Kapso Solutions for free?',
    a: 'Yes. Every new account gets a 7-day free trial with every feature, and no card is needed. After that, plans start at ₹499 a month with the Starter plan: a team inbox for unlimited contacts on the official WhatsApp Business API.',
  },
  {
    q: 'Is there any WhatsApp Business API procurement fee for a brand/business?',
    a: 'No. There is no Setup fee, just a subscription fee. Kapso Solutions doesn’t charge a single penny to procure the WhatsApp Business API for a Brand/Business. Businesses can procure the API completely free through Kapso Solutions.',
  },
  {
    q: 'How do you handle Customer Support?',
    a: 'We have a dedicated customer support team available via Live Chat, Email, Phone, and Zoom, ready to assist our customers with any questions or support they may need.',
  },
  {
    q: 'What is the Cost of Broadcasting messages?',
    a: 'Meta charges each delivered message to your own WhatsApp account. In India its rates are about ₹0.86 per marketing message and ₹0.115 per utility, authentication or service message, plus 18% GST. Every number gets 1,000 free service messages (replies) a month. See our WhatsApp pricing guide at kapsosolutions.com/resources/whatsapp-pricing.',
  },
  {
    q: 'How many messages can I Broadcast in a day to my customers?',
    a: 'You will start with 2000 Messages/day. As you send 500+ Messages, your limit will be upgraded to 10,000 messages/day and as you send 5000 messages within 7 days, your limit will be upgraded to 100,000 messages/day. Last limit is infinite messages/day which can be enabled by sending 50,000 messages within 7 days. The Limit upgrades happen in 24 hours.',
  },
];

export function FaqSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  const toggle = (idx: number) => {
    setOpenIndex(openIndex === idx ? null : idx);
  };

  return (
    <section className="lp-faq-section" id="faq">
      <div className="lp-faq-container">
        <h2 className="lp-faq-main-title">FAQ</h2>

        <div className="lp-faq-accordion">
          {FAQ_ITEMS.map((item, idx) => {
            const isOpen = openIndex === idx;
            return (
              <div key={idx} className={`lp-faq-item ${isOpen ? 'open' : ''}`}>
                <button
                  type="button"
                  className="lp-faq-question-btn"
                  onClick={() => toggle(idx)}
                  aria-expanded={isOpen}
                >
                  <span className="lp-faq-question-text">{item.q}</span>
                  <span className="lp-faq-chevron" aria-hidden="true">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </span>
                </button>
                {isOpen && (
                  <div className="lp-faq-answer">
                    <p>{item.a}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export function LandingPage() {
  useSmoothScroll();
  useSeo(HOME_META);
  const [demoOpen, setDemoOpen] = useState(false);
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('quarterly');
  const openDemo = () => setDemoOpen(true);

  return (
    <div className="lp">
      <SiteHeader onBookDemo={openDemo} />
      {demoOpen && <DemoModal onClose={() => setDemoOpen(false)} />}

      <main>
        {/* ---------- Hero Section (Centered Layout) ---------- */}
        <section className="lp-hero-centered">
          <img
            src="/design1.png"
            alt=""
            className="lp-hero-bg-left"
            aria-hidden="true"
          />

          <div className="lp-hero-centered-container">
            <div className="lp-hero-badge">
              <span className="lp-hero-badge-sparkle">✨</span>
              <span>— AI-Powered WhatsApp Marketing Platform</span>
            </div>

            <h1 className="lp-hero-title">
              <span className="lp-hero-title-green">5X Your Revenue</span>{' '}
              <span className="lp-hero-title-black">with the Power of WhatsApp</span>
            </h1>

            <p className="lp-hero-desc">
              Broadcast, Automate, Engage, Sell - do everything with the AI-powered WhatsApp Marketing &amp; Engagement Platform. Powered by Official WhatsApp APIs ⚡
            </p>

            <div className="lp-hero-actions">
              <a className="lp-hero-btn primary" href="#/register">
                <span>Start 7-Day FREE Trial</span>
                <span className="lp-hero-arrow">→</span>
              </a>
              <button type="button" className="lp-hero-btn secondary" onClick={openDemo}>
                <span>Join Live Demo</span>
                <span className="lp-hero-arrow">→</span>
              </button>
            </div>

            <div className="lp-hero-trust-row lp-desktop-only">
              <span className="lp-hero-trust-item">
                <span className="lp-hero-trust-check">✓</span> Official Meta Cloud API
              </span>
              <span className="lp-hero-trust-item">
                <span className="lp-hero-trust-check">✓</span> No credit card required
              </span>
              <span className="lp-hero-trust-item">
                <span className="lp-hero-trust-check">✓</span> 2-minute instant setup
              </span>
            </div>
          </div>
        </section>

        {/* ---------- Meta Business Partners Strip ---------- */}
        <section className="lp-meta-partner">
          <div className="lp-meta-partner-line" />
          <div className="lp-meta-partner-content">
            <div className="lp-meta-partner-badge">
              <svg className="lp-meta-logo" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M6.915 4.03c-1.968 0-3.683 1.28-4.871 3.113C.704 9.208 0 11.883 0 14.449c0 .706.07 1.369.21 1.973a6.624 6.624 0 0 0 .265.86 5.297 5.297 0 0 0 .371.761c.696 1.159 1.818 1.927 3.593 1.927 1.497 0 2.633-.671 3.965-2.444.76-1.012 1.144-1.626 2.663-4.32l.756-1.339.186-.325c.061.1.121.196.183.3l2.152 3.595c.724 1.21 1.665 2.556 2.47 3.314 1.046.987 1.992 1.22 3.06 1.22 1.075 0 1.876-.355 2.455-.843a3.743 3.743 0 0 0 .81-.973c.542-.939.861-2.127.861-3.745 0-2.72-.681-5.357-2.084-7.45-1.282-1.912-2.957-2.93-4.716-2.93-1.047 0-2.088.467-3.053 1.308-.652.57-1.257 1.29-1.82 2.05-.69-.875-1.335-1.547-1.958-2.056-1.182-.966-2.315-1.303-3.454-1.303zm10.16 2.053c1.147 0 2.188.758 2.992 1.999 1.132 1.748 1.647 4.195 1.647 6.4 0 1.548-.368 2.9-1.839 2.9-.58 0-1.027-.23-1.664-1.004-.496-.601-1.343-1.878-2.832-4.358l-.617-1.028a44.908 44.908 0 0 0-1.255-1.98c.07-.109.141-.224.211-.327 1.12-1.667 2.118-2.602 3.358-2.602zm-10.201.553c1.265 0 2.058.791 2.675 1.446.307.327.737.871 1.234 1.579l-1.02 1.566c-.757 1.163-1.882 3.017-2.837 4.338-1.191 1.649-1.81 1.817-2.486 1.817-.524 0-1.038-.237-1.383-.794-.263-.426-.464-1.13-.464-2.046 0-2.221.63-4.535 1.66-6.088.454-.687.964-1.226 1.533-1.533a2.264 2.264 0 0 1 1.088-.285z" fill="#0081FB" />
              </svg>
              <h2>Meta Business Partners</h2>
            </div>
            <p className="lp-meta-partner-sub">Trusted by worldwide business</p>
          </div>
        </section>

        {/* ---------- Dual-Direction Scrolling Typography Marquee ---------- */}
        <section className="lp-marquee-section">
          {/* Row 1: Right-to-Left (Muted Text) */}
          <div className="lp-marquee-track track-left">
            <div className="lp-marquee-content muted">
              <span>ai-powered</span>
              <span className="lp-marquee-dot">•</span>
              <span>more leads</span>
              <span className="lp-marquee-dot">•</span>
              <span>more bookings</span>
              <span className="lp-marquee-dot">•</span>
              <span>5x revenue</span>
              <span className="lp-marquee-dot">•</span>
              <span>automated sales</span>
              <span className="lp-marquee-dot">•</span>
              <span>instant replies</span>
              <span className="lp-marquee-dot">•</span>
              <span>official meta api</span>
              <span className="lp-marquee-dot">•</span>
            </div>
            <div className="lp-marquee-content muted" aria-hidden="true">
              <span>ai-powered</span>
              <span className="lp-marquee-dot">•</span>
              <span>more leads</span>
              <span className="lp-marquee-dot">•</span>
              <span>more bookings</span>
              <span className="lp-marquee-dot">•</span>
              <span>5x revenue</span>
              <span className="lp-marquee-dot">•</span>
              <span>automated sales</span>
              <span className="lp-marquee-dot">•</span>
              <span>instant replies</span>
              <span className="lp-marquee-dot">•</span>
              <span>official meta api</span>
              <span className="lp-marquee-dot">•</span>
            </div>
          </div>

          {/* Row 2: Left-to-Right (Bold Black Text with Highlighted "inbox") */}
          <div className="lp-marquee-track track-right">
            <div className="lp-marquee-content bold">
              <span>all conversations</span>
              <span className="lp-marquee-dot">•</span>
              <span>one <mark className="lp-marquee-mark">inbox</mark></span>
              <span className="lp-marquee-dot">•</span>
              <span>every channel</span>
              <span className="lp-marquee-dot">•</span>
              <span>seamless engagement</span>
              <span className="lp-marquee-dot">•</span>
              <span>zero missed leads</span>
              <span className="lp-marquee-dot">•</span>
              <span>smart automation</span>
              <span className="lp-marquee-dot">•</span>
            </div>
            <div className="lp-marquee-content bold" aria-hidden="true">
              <span>all conversations</span>
              <span className="lp-marquee-dot">•</span>
              <span>one <mark className="lp-marquee-mark">inbox</mark></span>
              <span className="lp-marquee-dot">•</span>
              <span>every channel</span>
              <span className="lp-marquee-dot">•</span>
              <span>seamless engagement</span>
              <span className="lp-marquee-dot">•</span>
              <span>zero missed leads</span>
              <span className="lp-marquee-dot">•</span>
              <span>smart automation</span>
              <span className="lp-marquee-dot">•</span>
            </div>
          </div>
        </section>

        {/* ---------- Showcase Center Image (hero.png) ---------- */}
        <section className="lp-hero-center-showcase">
          <div className="lp-hero-center-showcase-container">
            <img
              src="/hero.png"
              alt="WhatsApp CRM & Marketing Platform"
              className="lp-hero-center-img"
            />
          </div>
        </section>

        {/* ---------- Pricing Plans Section (Flat Cards Matching Design) ---------- */}
        <section className="lp-pricing-section" id="pricing">
          <div className="lp-pricing-container">
            {/* Top Banner with Discount & Billing Cycle Switcher */}
            <div className="lp-pricing-banner">
              <div className="lp-pricing-banner-text">
                Every plan starts with a <span className="lp-pricing-banner-link">7-day free trial</span> of every feature · up to ~25% off with annual billing
              </div>
              <CycleToggle value={billingCycle} onChange={setBillingCycle} />
            </div>

            {/* 4 Flat Cards Grid (shared with the CRM's plans dialog and Billing) */}
            <PlanCards
              cycle={billingCycle}
              action={(plan) => (
                <>
                  <a
                    href="#/register"
                    className="lp-plan-try-btn"
                    style={{ backgroundColor: plan.buttonColor }}
                  >
                    Start 7-day free trial
                  </a>
                  <a href="#/register" className="lp-plan-buy-link">
                    <BuyNowSvg width={16} height={16} stroke="currentColor" />
                    <span>Buy now</span>
                  </a>
                </>
              )}
            />
          </div>
        </section>

        {/* ---------- FAQ Section (Replaces Contact Section) ---------- */}
        <FaqSection />
      </main>

      <SiteFooter />
      <WhatsAppFloat />
    </div>
  );
}
