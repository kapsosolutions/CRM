// Public landing page: what the platform is, with Log in / Register on top.
import { useState, useEffect } from 'react';
import { DemoModal } from './DemoModal';
import { useSmoothScroll } from './useSmoothScroll';
import { BookDemoSvg, BuyNowSvg } from '../crm/components/TemplateIcons';
import { CycleToggle, PlanCards } from '../crm/components/PlanCards';
import type { BillingCycle } from '../crm/plans';
import './site.css';

const BRAND = 'Kapso Solutions';

export function SiteHeader({ compact = false, onBookDemo }: { compact?: boolean; onBookDemo?: () => void }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Lock scroll when mobile sidebar is open
  useEffect(() => {
    if (sidebarOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [sidebarOpen]);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSidebarOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleNavClick = (sectionId: string) => {
    setSidebarOpen(false);
    const elem = document.getElementById(sectionId);
    if (elem) {
      const lenis = (window as unknown as { __lenis?: { scrollTo: (target: HTMLElement, options?: { offset?: number; duration?: number }) => void } }).__lenis;
      if (lenis) {
        lenis.scrollTo(elem, { offset: -24, duration: 1.2 });
      } else {
        elem.scrollIntoView({ behavior: 'smooth' });
      }
    } else {
      window.location.hash = `#${sectionId}`;
    }
  };

  const handleBookDemoClick = () => {
    setSidebarOpen(false);
    if (onBookDemo) {
      onBookDemo();
    } else {
      window.location.hash = '#/register';
    }
  };

  return (
    <>
      {!compact && (
        <div className="lp-top-bar">
          <div className="lp-top-bar-container">
            <div className="lp-top-bar-right">
              <a
                href="#faq"
                className="lp-top-bar-link lp-top-bar-contact"
                onClick={(e) => {
                  e.preventDefault();
                  handleNavClick('faq');
                }}
              >
                FAQ
              </a>
              <a
                href="#footer-contact"
                className="lp-top-bar-link"
                onClick={(e) => {
                  e.preventDefault();
                  handleNavClick('footer-contact');
                }}
              >
                Contact
              </a>
              <a href="#/login" className="lp-top-bar-link lp-top-bar-login">
                Log in
              </a>
            </div>
          </div>
        </div>
      )}

      <header className={`lp-header${compact ? ' compact' : ''}`}>
        <a className="lp-brand" href="#/" aria-label={BRAND}>
          <img className="lp-brand-logo" src="/logo.png" alt={BRAND} />
        </a>
        <div className="lp-actions">
          {onBookDemo ? (
            <button type="button" className="lp-nav-pill-btn book-demo lp-desktop-only" onClick={onBookDemo}>
              <BookDemoSvg width={16} height={16} />
              <span>Book a demo</span>
            </button>
          ) : (
            <a className="lp-nav-pill-btn book-demo lp-desktop-only" href="#/register">
              <BookDemoSvg width={16} height={16} />
              <span>Book a demo</span>
            </a>
          )}
          <a className="lp-nav-pill-btn try-free lp-desktop-only" href="#/register">
            Try for free
          </a>

          {/* Mobile Burger Button */}
          <label className="burger" htmlFor="burger" aria-label="Open navigation menu">
            <input
              type="checkbox"
              id="burger"
              checked={sidebarOpen}
              onChange={(e) => setSidebarOpen(e.target.checked)}
            />
            <span />
            <span />
            <span />
          </label>
        </div>
      </header>

      {/* Right Slide-In Mobile Sidebar & Overlay Backdrop */}
      <div
        className={`lp-sidebar-overlay ${sidebarOpen ? 'open' : ''}`}
        onClick={() => setSidebarOpen(false)}
        aria-hidden="true"
      />
      <aside
        className={`lp-mobile-sidebar ${sidebarOpen ? 'open' : ''}`}
        aria-label="Mobile Navigation"
        aria-hidden={!sidebarOpen}
      >
        <div className="lp-sidebar-header">
          <a className="lp-brand" href="#/" onClick={() => setSidebarOpen(false)} aria-label={BRAND}>
            <img className="lp-brand-logo" src="/logo.png" alt={BRAND} />
          </a>
          <button
            type="button"
            className="lp-sidebar-close"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close navigation menu"
          >
            ✕
          </button>
        </div>

        <nav className="lp-sidebar-nav">
          {/* Pricing Option */}
          <button
            type="button"
            className="lp-sidebar-link"
            onClick={() => handleNavClick('pricing')}
          >
            <div className="lp-sidebar-link-content">
              <svg className="lp-sidebar-svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
                <line x1="7" y1="7" x2="7.01" y2="7" />
              </svg>
              <span className="lp-sidebar-link-text">Pricing</span>
            </div>
            <span className="lp-sidebar-link-arrow">→</span>
          </button>

          {/* Book Demo Option */}
          <button
            type="button"
            className="lp-sidebar-link"
            onClick={handleBookDemoClick}
          >
            <div className="lp-sidebar-link-content">
              <svg className="lp-sidebar-svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
              <span className="lp-sidebar-link-text">Book Demo</span>
            </div>
            <span className="lp-sidebar-link-arrow">→</span>
          </button>



          {/* Contact Option */}
          <button
            type="button"
            className="lp-sidebar-link"
            onClick={() => handleNavClick('footer-contact')}
          >
            <div className="lp-sidebar-link-content">
              <svg className="lp-sidebar-svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              <span className="lp-sidebar-link-text">Contact</span>
            </div>
            <span className="lp-sidebar-link-arrow">→</span>
          </button>
        </nav>

        <div className="lp-sidebar-footer">
          <a
            href="#/register"
            className="lp-sidebar-btn primary"
            onClick={() => setSidebarOpen(false)}
          >
            Try for free →
          </a>
          <a
            href="#/login"
            className="lp-sidebar-btn secondary"
            onClick={() => setSidebarOpen(false)}
          >
            Log in to Account
          </a>
        </div>
      </aside>
    </>
  );
}

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
    a: 'WhatsApp charges are ₹1.09/ message for marketing messages & ₹0.145 for utility and authentication messages. You can recharge this from the Kapso Solutions Dashboard itself. Each message is charged separately by Meta. Service conversations (replies to user messages) are free of cost.',
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

      <footer className="lp-footer">
        <div className="lp-footer-container">
          <div className="lp-footer-grid">
            {/* Left Brand Column */}
            <div className="lp-footer-brand-col">
              <div className="lp-footer-copyright-title">
                © {new Date().getFullYear()} {BRAND} Private Limited
              </div>
              <div className="lp-footer-made-in">
                Made with <span className="lp-footer-heart" aria-label="love">❤️</span> in India
              </div>

              {/* Meta Business Partner Badge */}
              <div className="lp-footer-meta-badge">
                <svg className="lp-footer-meta-svg" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M6.915 4.03c-1.968 0-3.683 1.28-4.871 3.113C.704 9.208 0 11.883 0 14.449c0 .706.07 1.369.21 1.973a6.624 6.624 0 0 0 .265.86 5.297 5.297 0 0 0 .371.761c.696 1.159 1.818 1.927 3.593 1.927 1.497 0 2.633-.671 3.965-2.444.76-1.012 1.144-1.626 2.663-4.32l.756-1.339.186-.325c.061.1.121.196.183.3l2.152 3.595c.724 1.21 1.665 2.556 2.47 3.314 1.046.987 1.992 1.22 3.06 1.22 1.075 0 1.876-.355 2.455-.843a3.743 3.743 0 0 0 .81-.973c.542-.939.861-2.127.861-3.745 0-2.72-.681-5.357-2.084-7.45-1.282-1.912-2.957-2.93-4.716-2.93-1.047 0-2.088.467-3.053 1.308-.652.57-1.257 1.29-1.82 2.05-.69-.875-1.335-1.547-1.958-2.056-1.182-.966-2.315-1.303-3.454-1.303zm10.16 2.053c1.147 0 2.188.758 2.992 1.999 1.132 1.748 1.647 4.195 1.647 6.4 0 1.548-.368 2.9-1.839 2.9-.58 0-1.027-.23-1.664-1.004-.496-.601-1.343-1.878-2.832-4.358l-.617-1.028a44.908 44.908 0 0 0-1.255-1.98c.07-.109.141-.224.211-.327 1.12-1.667 2.118-2.602 3.358-2.602zm-10.201.553c1.265 0 2.058.791 2.675 1.446.307.327.737.871 1.234 1.579l-1.02 1.566c-.757 1.163-1.882 3.017-2.837 4.338-1.191 1.649-1.81 1.817-2.486 1.817-.524 0-1.038-.237-1.383-.794-.263-.426-.464-1.13-.464-2.046 0-2.221.63-4.535 1.66-6.088.454-.687.964-1.226 1.533-1.533a2.264 2.264 0 0 1 1.088-.285z" fill="#0081FB" />
                </svg>
                <div className="lp-footer-meta-texts">
                  <span className="lp-footer-meta-title">Meta</span>
                  <span className="lp-footer-meta-role">Business Partner</span>
                </div>
              </div>

              {/* Social Icons Row */}
              <div className="lp-footer-social-row">
                <a href="https://www.instagram.com/kapsosolutions/?hl=en" target="_blank" rel="noopener noreferrer" aria-label="Instagram" className="lp-footer-social-btn">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>
                </a>
                <a href="https://twitter.com" target="_blank" rel="noopener noreferrer" aria-label="Twitter / X" className="lp-footer-social-btn">
                  <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                </a>
                <a href="https://youtube.com" target="_blank" rel="noopener noreferrer" aria-label="YouTube" className="lp-footer-social-btn">
                  <svg viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
                </a>
                <a href="https://www.linkedin.com/company/kapsosolutions/posts/?viewAsMember=true" target="_blank" rel="noopener noreferrer" aria-label="LinkedIn" className="lp-footer-social-btn">
                  <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75M6.88 8.56a1.68 1.68 0 0 0 1.68-1.68c0-.93-.75-1.69-1.68-1.69a1.69 1.69 0 0 0-1.69 1.69c0 .93.76 1.68 1.69 1.68m1.39 9.94v-8.37H5.5v8.37h2.77z"/></svg>
                </a>
                <a href="https://play.google.com" target="_blank" rel="noopener noreferrer" aria-label="Google Play" className="lp-footer-social-btn">
                  <svg viewBox="0 0 24 24" fill="currentColor"><path d="M3.609 1.814L13.793 12 3.61 22.186a1.764 1.764 0 0 1-.61-.951V2.765a1.764 1.764 0 0 1 .609-.951zm11.3 9.072l2.366-1.365-11.89-6.864 9.524 8.229zm0 2.228L5.385 21.343l11.89-6.864-2.366-1.365zm1.536-.886l3.355 1.936c.866.5.866 1.314 0 1.814l-3.355 1.936-2.148-2.148 2.148-2.148-.001.001.001.61z"/></svg>
                </a>
                <a href="https://apple.com" target="_blank" rel="noopener noreferrer" aria-label="Apple App Store" className="lp-footer-social-btn">
                  <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.97 6.36c.64-.78 1.08-1.86.96-2.94-1 .04-2.14.65-2.82 1.43-.59.67-1.12 1.76-.98 2.82 1.11.09 2.2-.55 2.84-1.31z"/></svg>
                </a>
              </div>
            </div>

            {/* Platform Column */}
            <div className="lp-footer-nav-col">
              <h4 className="lp-footer-col-heading">Platform</h4>
              <ul className="lp-footer-link-list">
                <li><a href="#/features">Features</a></li>
                <li><a href="#/industries">Industries</a></li>
                <li><a href="#pricing">Pricing</a></li>
                <li>
                  <a
                    href="#/register"
                    onClick={(e) => {
                      e.preventDefault();
                      openDemo();
                    }}
                  >
                    Book a Demo
                  </a>
                </li>
                <li><a href="#/register">Become a Partner</a></li>
                <li><a href="#/register">WhatsApp Marketing</a></li>
                <li><a href="#/register">WhatsApp Business API</a></li>
              </ul>

              {/* Contact Us Block (Positioned directly under Platform column like reference image) */}
              <div className="lp-footer-contact-block" id="footer-contact">
                <h4 className="lp-footer-contact-title">Contact Us</h4>
                <div className="lp-footer-contact-sub">Contact Our Team</div>
                <div className="lp-footer-contact-items">
                  <a href="tel:+917989909361" className="lp-footer-contact-link">
                    Sales +91 79899 09361
                  </a>
                  <a href="tel:+917989909361" className="lp-footer-contact-link">
                    Support +91 79899 09361
                  </a>
                </div>
              </div>
            </div>

            {/* Resources Column */}
            <div className="lp-footer-nav-col">
              <h4 className="lp-footer-col-heading">Resources</h4>
              <ul className="lp-footer-link-list">
                <li><a href="#/help">Help Center</a></li>
                <li><a href="#/blog">Blog</a></li>
                <li><a href="#/about">About Kapso Solutions</a></li>
                <li><a href="#/careers">Careers</a></li>
              </ul>
            </div>

            {/* FREE Tools Column */}
            <div className="lp-footer-nav-col">
              <h4 className="lp-footer-col-heading">FREE Tools</h4>
              <ul className="lp-footer-link-list">
                <li><a href="#/register">WhatsApp Button</a></li>
                <li><a href="#/register">Generate WhatsApp Link</a></li>
                <li><a href="#/register">Download Android app</a></li>
                <li><a href="#/register">Download iOS app</a></li>
                <li><a href="#pricing">Pricing Calculator</a></li>
                <li><a href="#/register">AI Ad Generator</a></li>
                <li><a href="#/register">AI Template Generator</a></li>
              </ul>
            </div>

            {/* Legal Column */}
            <div className="lp-footer-nav-col">
              <h4 className="lp-footer-col-heading">Legal</h4>
              <ul className="lp-footer-link-list">
                <li><a href="#/privacy">Privacy Policy</a></li>
                <li><a href="#/terms">Terms &amp; Conditions</a></li>
                <li><a href="#/refund">Refund &amp; Cancellation</a></li>
                <li><a href="#/data-deletion">Data Deletion</a></li>
                <li><a href="#/contact">Contact Us</a></li>
              </ul>
            </div>
          </div>
        </div>
      </footer>

      {/* Floating WhatsApp Action Button */}
      <a
        href="https://wa.me/917989909361?text=Hello%20Kapso%20Solutions%20Team!%20I%20would%20like%20to%20learn%20more%20about%20your%20WhatsApp%20CRM."
        target="_blank"
        rel="noopener noreferrer"
        className="lp-wa-float-btn"
        aria-label="Chat with us on WhatsApp"
        title="Chat with us on WhatsApp"
      >
        <span className="lp-wa-float-pulse" aria-hidden="true" />
        <span className="lp-wa-float-tooltip">Chat with us 👋</span>
        <div className="lp-wa-float-icon-wrap">
          <svg
            className="lp-wa-float-svg"
            viewBox="0 0 175.216 175.552"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <defs>
              <linearGradient id="waFloatGrad" x1="85.915" x2="86.535" y1="32.567" y2="137.092" gradientUnits="userSpaceOnUse">
                <stop offset="0" stopColor="#57d163" />
                <stop offset="1" stopColor="#23b33a" />
              </linearGradient>
            </defs>
            <path fill="#ffffff" d="m12.966 161.238 10.439-38.114a73.42 73.42 0 0 1-9.821-36.772c.017-40.556 33.021-73.55 73.578-73.55 19.681.01 38.154 7.669 52.047 21.572s21.537 32.383 21.53 52.037c-.018 40.553-33.027 73.553-73.578 73.553h-.032c-12.313-.005-24.412-3.094-35.159-8.954z" />
            <path fill="url(#waFloatGrad)" d="M87.184 25.227c-33.733 0-61.166 27.423-61.178 61.13a60.98 60.98 0 0 0 9.349 32.535l1.455 2.313-6.179 22.558 23.146-6.069 2.235 1.324c9.387 5.571 20.15 8.517 31.126 8.523h.023c33.707 0 61.14-27.426 61.153-61.135a60.75 60.75 0 0 0-17.895-43.251 60.75 60.75 0 0 0-43.235-17.928z" />
            <path fill="#ffffff" fillRule="evenodd" d="M68.772 55.603c-1.378-3.061-2.828-3.123-4.137-3.176l-3.524-.043c-1.226 0-3.218.46-4.902 2.3s-6.435 6.287-6.435 15.332 6.588 17.785 7.506 19.013 12.718 20.381 31.405 27.75c15.529 6.124 18.689 4.906 22.061 4.6s10.877-4.447 12.408-8.74 1.532-7.971 1.073-8.74-1.685-1.226-3.525-2.146-10.877-5.367-12.562-5.981-2.91-.919-4.137.921-4.746 5.979-5.819 7.206-2.144 1.381-3.984.462-7.76-2.861-14.784-9.124c-5.465-4.873-9.154-10.891-10.228-12.73s-.114-2.835.808-3.751c.825-.824 1.838-2.147 2.759-3.22s1.224-1.84 1.836-3.065.307-2.301-.153-3.22-4.032-10.011-5.666-13.647" />
          </svg>
        </div>
      </a>
    </div>
  );
}
