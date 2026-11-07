// The website's frame, on every public page: the black strip, the header with
// the Solutions / Product / Resources / API / Pricing menus, the mobile menu,
// the footer and the WhatsApp button. SitePage wraps a page in all of it.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { DemoModal } from './DemoModal';
import { BookDemoSvg } from '../crm/components/TemplateIcons';
import { platformApi } from '../admin/platformApi';
import { FOOTER_COLUMNS, MENUS, type Menu, type MenuLink } from './siteMenus';
import { onSiteLinkClick, useSitePath, useSeo } from './siteNav';
import type { SitePageMeta } from './siteMeta';
import './site.css';
import './site-pages.css';

export const BRAND = 'Kapso Solutions';
export const SALES_PHONE = '+91 79899 09361';
export const SALES_TEL = 'tel:+917989909361';
export const WHATSAPP_HREF = 'https://wa.me/917989909361';

/** An internal link that doesn't reload the page. */
export function SiteLink({ href, className, children, onClick, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return (
    <a
      href={href}
      className={className}
      onClick={(e) => {
        onClick?.(e);
        onSiteLinkClick(e);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}

const API_SNIPPET = `curl -X POST \\
  https://kapsosolutions.com/api/v1/messages/template \\
  -H "Authorization: Bearer $KAPSO_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"to":"+919876543210","template":"order_update",
       "variables":["Ravi","#1042"]}'`;

function MenuItem({ l, onPick }: { l: MenuLink; onPick: () => void }) {
  return (
    <SiteLink href={l.href} className="sx-menu-link" onClick={onPick}>
      <span className="material-icons sx-menu-ico" aria-hidden="true">{l.icon}</span>
      <span className="sx-menu-text">
        <span className="sx-menu-label">
          {l.label}
          {l.badge && <span className="sx-menu-badge">{l.badge}</span>}
        </span>
        {l.desc && <span className="sx-menu-desc">{l.desc}</span>}
      </span>
    </SiteLink>
  );
}

function MenuPanel({ menu, onPick }: { menu: Menu; onPick: () => void }) {
  return (
    <div className={`sx-panel sx-panel-${menu.key}`} role="menu" data-testid={`menu-panel-${menu.key}`}>
      <div className="sx-panel-groups">
        {menu.groups.map((g) => (
          <div key={g.title} className={`sx-panel-group${g.tinted ? ' tinted' : ''}`}>
            <div className="sx-panel-title">{g.title}</div>
            <div className={`sx-panel-links${g.links.length > 5 ? ' two-col' : ''}`}>
              {g.links.map((l) => <MenuItem key={l.href + l.label} l={l} onPick={onPick} />)}
            </div>
          </div>
        ))}
      </div>
      {menu.key === 'api' && (
        <div className="sx-panel-dev">
          <div className="sx-panel-title light">For developers</div>
          <pre className="sx-panel-code"><code>{API_SNIPPET}</code></pre>
          <SiteLink href="/docs" className="sx-dev-link" onClick={onPick}>API reference <span aria-hidden="true">↗</span></SiteLink>
          <SiteLink href="/docs#authentication" className="sx-dev-link" onClick={onPick}>Authentication &amp; keys <span aria-hidden="true">↗</span></SiteLink>
          <SiteLink href="/docs#errors" className="sx-dev-link" onClick={onPick}>Errors &amp; rate limits <span aria-hidden="true">↗</span></SiteLink>
          <SiteLink href="/pricing" className="sx-dev-link" onClick={onPick}>Plans with the API <span aria-hidden="true">↗</span></SiteLink>
        </div>
      )}
      {menu.key === 'solutions' && (
        <div className="sx-panel-aside">
          <div className="sx-panel-title">Built for your business</div>
          <p>Pick your business type when you sign up: the CRM names things your way (Doctors, Stylists, Rooms…) and opens the pages you need.</p>
          <SiteLink href="/solutions" className="sx-aside-link" onClick={onPick}>See every industry →</SiteLink>
        </div>
      )}
      {menu.more && menu.key !== 'solutions' && (
        <SiteLink href={menu.more.href} className="sx-panel-more" onClick={onPick}>{menu.more.label} →</SiteLink>
      )}
    </div>
  );
}

export function SiteHeader({ compact = false, onBookDemo }: { compact?: boolean; onBookDemo?: () => void }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [mobileGroup, setMobileGroup] = useState<string | null>(null);
  const navRef = useRef<HTMLElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const path = useSitePath();
  const signedIn = platformApi.businessLoggedIn();

  // A new page closes every menu.
  useEffect(() => {
    setOpen(null);
    setSidebarOpen(false);
  }, [path]);

  useEffect(() => {
    document.body.style.overflow = sidebarOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [sidebarOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSidebarOpen(false);
        setOpen(null);
      }
    };
    const onDown = (e: PointerEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) setOpen(null);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, []);

  const hover = (key: string | null) => {
    window.clearTimeout(closeTimer.current);
    if (key) setOpen(key);
    else closeTimer.current = window.setTimeout(() => setOpen(null), 160);
  };

  const bookDemo = () => {
    setSidebarOpen(false);
    if (onBookDemo) onBookDemo();
    else window.location.href = '/#/register';
  };

  return (
    <>
      {!compact && (
        <div className="lp-top-bar">
          <div className="lp-top-bar-container">
            <div className="lp-top-bar-right">
              <SiteLink href="/help" className="lp-top-bar-link lp-top-bar-contact">Help</SiteLink>
              <SiteLink href="/contact" className="lp-top-bar-link">Contact</SiteLink>
              {signedIn ? (
                <a href="/#/" className="lp-top-bar-link lp-top-bar-login">Open CRM</a>
              ) : (
                <a href="/#/login" className="lp-top-bar-link lp-top-bar-login">Log in</a>
              )}
            </div>
          </div>
        </div>
      )}

      <header className={`lp-header sx-header${compact ? ' compact' : ''}`}>
        <SiteLink className="lp-brand" href="/" aria-label={BRAND}>
          <img className="lp-brand-logo" src="/logo.png" alt={BRAND} />
        </SiteLink>

        <nav className="sx-nav lp-desktop-only" aria-label="Main" ref={navRef} onMouseLeave={() => hover(null)}>
          {MENUS.map((m) => (
            <div key={m.key} className={`sx-nav-item${open === m.key ? ' open' : ''}`} onMouseEnter={() => hover(m.key)}>
              <button
                type="button"
                className={`sx-nav-btn${open === m.key ? ' on' : ''}`}
                aria-expanded={open === m.key}
                aria-haspopup="true"
                onClick={() => setOpen((o) => (o === m.key ? null : m.key))}
                data-testid={`menu-${m.key}`}
              >
                {m.label}
                <svg className="sx-nav-chev" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M7 10l5 5 5-5z" /></svg>
              </button>
              {open === m.key && <MenuPanel menu={m} onPick={() => setOpen(null)} />}
            </div>
          ))}
          <SiteLink href="/pricing" className={`sx-nav-btn${path === '/pricing' ? ' on' : ''}`} data-testid="menu-pricing">Pricing</SiteLink>
        </nav>

        <div className="lp-actions">
          <button type="button" className="lp-nav-pill-btn book-demo lp-desktop-only" onClick={bookDemo}>
            <BookDemoSvg width={16} height={16} />
            <span>Book a demo</span>
          </button>
          {signedIn ? (
            <a className="lp-nav-pill-btn try-free lp-desktop-only" href="/#/">Open CRM</a>
          ) : (
            <a className="lp-nav-pill-btn try-free lp-desktop-only" href="/#/register">Try for free</a>
          )}
          <label className="burger" htmlFor="burger" aria-label="Open navigation menu">
            <input type="checkbox" id="burger" checked={sidebarOpen} onChange={(e) => setSidebarOpen(e.target.checked)} />
            <span />
            <span />
            <span />
          </label>
        </div>
      </header>

      <div className={`lp-sidebar-overlay ${sidebarOpen ? 'open' : ''}`} onClick={() => setSidebarOpen(false)} aria-hidden="true" />
      <aside className={`lp-mobile-sidebar ${sidebarOpen ? 'open' : ''}`} aria-label="Mobile Navigation" aria-hidden={!sidebarOpen}>
        <div className="lp-sidebar-header">
          <SiteLink className="lp-brand" href="/" onClick={() => setSidebarOpen(false)} aria-label={BRAND}>
            <img className="lp-brand-logo" src="/logo.png" alt={BRAND} />
          </SiteLink>
          <button type="button" className="lp-sidebar-close" onClick={() => setSidebarOpen(false)} aria-label="Close navigation menu">✕</button>
        </div>
        <nav className="lp-sidebar-nav sx-mnav">
          {MENUS.map((m) => (
            <div key={m.key} className={`sx-mnav-group${mobileGroup === m.key ? ' open' : ''}`}>
              <button type="button" className="sx-mnav-head" aria-expanded={mobileGroup === m.key} onClick={() => setMobileGroup((g) => (g === m.key ? null : m.key))}>
                {m.label}
                <span className="material-icons" aria-hidden="true">expand_more</span>
              </button>
              {mobileGroup === m.key && (
                <div className="sx-mnav-body">
                  {m.groups.map((g) => (
                    <div key={g.title}>
                      <div className="sx-mnav-title">{g.title}</div>
                      {g.links.map((l) => (
                        <SiteLink key={l.href + l.label} href={l.href} className="sx-mnav-link" onClick={() => setSidebarOpen(false)}>
                          <span className="material-icons" aria-hidden="true">{l.icon}</span>
                          {l.label}
                          {l.badge && <span className="sx-menu-badge">{l.badge}</span>}
                        </SiteLink>
                      ))}
                    </div>
                  ))}
                  {m.more && <SiteLink href={m.more.href} className="sx-mnav-more" onClick={() => setSidebarOpen(false)}>{m.more.label} →</SiteLink>}
                </div>
              )}
            </div>
          ))}
          <SiteLink href="/pricing" className="sx-mnav-head" onClick={() => setSidebarOpen(false)}>Pricing</SiteLink>
          <SiteLink href="/contact" className="sx-mnav-head" onClick={() => setSidebarOpen(false)}>Contact</SiteLink>
          <button type="button" className="sx-mnav-head" onClick={bookDemo}>Book a demo</button>
        </nav>
        <div className="lp-sidebar-footer">
          {signedIn ? (
            <a href="/#/" className="lp-sidebar-btn primary" onClick={() => setSidebarOpen(false)}>Open CRM →</a>
          ) : (
            <>
              <a href="/#/register" className="lp-sidebar-btn primary" onClick={() => setSidebarOpen(false)}>Try for free →</a>
              <a href="/#/login" className="lp-sidebar-btn secondary" onClick={() => setSidebarOpen(false)}>Log in to Account</a>
            </>
          )}
        </div>
      </aside>
    </>
  );
}

function MetaMark({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M6.915 4.03c-1.968 0-3.683 1.28-4.871 3.113C.704 9.208 0 11.883 0 14.449c0 .706.07 1.369.21 1.973a6.624 6.624 0 0 0 .265.86 5.297 5.297 0 0 0 .371.761c.696 1.159 1.818 1.927 3.593 1.927 1.497 0 2.633-.671 3.965-2.444.76-1.012 1.144-1.626 2.663-4.32l.756-1.339.186-.325c.061.1.121.196.183.3l2.152 3.595c.724 1.21 1.665 2.556 2.47 3.314 1.046.987 1.992 1.22 3.06 1.22 1.075 0 1.876-.355 2.455-.843a3.743 3.743 0 0 0 .81-.973c.542-.939.861-2.127.861-3.745 0-2.72-.681-5.357-2.084-7.45-1.282-1.912-2.957-2.93-4.716-2.93-1.047 0-2.088.467-3.053 1.308-.652.57-1.257 1.29-1.82 2.05-.69-.875-1.335-1.547-1.958-2.056-1.182-.966-2.315-1.303-3.454-1.303zm10.16 2.053c1.147 0 2.188.758 2.992 1.999 1.132 1.748 1.647 4.195 1.647 6.4 0 1.548-.368 2.9-1.839 2.9-.58 0-1.027-.23-1.664-1.004-.496-.601-1.343-1.878-2.832-4.358l-.617-1.028a44.908 44.908 0 0 0-1.255-1.98c.07-.109.141-.224.211-.327 1.12-1.667 2.118-2.602 3.358-2.602zm-10.201.553c1.265 0 2.058.791 2.675 1.446.307.327.737.871 1.234 1.579l-1.02 1.566c-.757 1.163-1.882 3.017-2.837 4.338-1.191 1.649-1.81 1.817-2.486 1.817-.524 0-1.038-.237-1.383-.794-.263-.426-.464-1.13-.464-2.046 0-2.221.63-4.535 1.66-6.088.454-.687.964-1.226 1.533-1.533a2.264 2.264 0 0 1 1.088-.285z" fill="#0081FB" />
    </svg>
  );
}

export function SiteFooter() {
  return (
    <footer className="lp-footer sx-footer">
      <div className="lp-footer-container">
        <div className="sx-footer-grid">
          <div className="lp-footer-brand-col">
            <SiteLink href="/" className="lp-brand" aria-label={BRAND}>
              <img className="lp-brand-logo sx-footer-logo" src="/logo.png" alt={BRAND} />
            </SiteLink>
            <p className="sx-footer-about">WhatsApp CRM, automation and the official WhatsApp Business API for growing businesses.</p>
            <div className="lp-footer-meta-badge">
              <MetaMark className="lp-footer-meta-svg" />
              <div className="lp-footer-meta-texts">
                <span className="lp-footer-meta-title">Meta</span>
                <span className="lp-footer-meta-role">Business Partner</span>
              </div>
            </div>
            <div className="sx-footer-contact" id="footer-contact">
              <a href={SALES_TEL}>Sales {SALES_PHONE}</a>
              <a href={WHATSAPP_HREF} target="_blank" rel="noopener noreferrer">WhatsApp us</a>
              <a href="mailto:support@kapsosolutions.com">support@kapsosolutions.com</a>
            </div>
            <div className="lp-footer-social-row">
              <a href="https://www.instagram.com/kapsosolutions/?hl=en" target="_blank" rel="noopener noreferrer" aria-label="Instagram" className="lp-footer-social-btn">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5" /><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" /><line x1="17.5" y1="6.5" x2="17.51" y2="6.5" /></svg>
              </a>
              <a href="https://www.linkedin.com/company/kapsosolutions/" target="_blank" rel="noopener noreferrer" aria-label="LinkedIn" className="lp-footer-social-btn">
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75M6.88 8.56a1.68 1.68 0 0 0 1.68-1.68c0-.93-.75-1.69-1.68-1.69a1.69 1.69 0 0 0-1.69 1.69c0 .93.76 1.68 1.69 1.68m1.39 9.94v-8.37H5.5v8.37h2.77z" /></svg>
              </a>
            </div>
          </div>
          {FOOTER_COLUMNS.map((c) => (
            <div key={c.title} className="lp-footer-nav-col">
              <h4 className="lp-footer-col-heading">{c.title}</h4>
              <ul className="lp-footer-link-list">
                {c.links.map((l) => (
                  <li key={l.href}><SiteLink href={l.href}>{l.label}</SiteLink></li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="sx-footer-bottom">
          <span>© {new Date().getFullYear()} {BRAND} Private Limited</span>
          <span>Made with <span aria-label="love">❤️</span> in India</span>
        </div>
      </div>
    </footer>
  );
}

export function WhatsAppFloat() {
  return (
    <a
      href={`${WHATSAPP_HREF}?text=${encodeURIComponent('Hello Kapso Solutions Team! I would like to learn more about your WhatsApp CRM.')}`}
      target="_blank"
      rel="noopener noreferrer"
      className="lp-wa-float-btn"
      aria-label="Chat with us on WhatsApp"
      title="Chat with us on WhatsApp"
    >
      <span className="lp-wa-float-pulse" aria-hidden="true" />
      <span className="lp-wa-float-tooltip">Chat with us 👋</span>
      <div className="lp-wa-float-icon-wrap">
        <svg className="lp-wa-float-svg" viewBox="0 0 175.216 175.552" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <defs>
            <linearGradient id="waFloatGrad2" x1="85.915" x2="86.535" y1="32.567" y2="137.092" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#57d163" />
              <stop offset="1" stopColor="#23b33a" />
            </linearGradient>
          </defs>
          <path fill="#ffffff" d="m12.966 161.238 10.439-38.114a73.42 73.42 0 0 1-9.821-36.772c.017-40.556 33.021-73.55 73.578-73.55 19.681.01 38.154 7.669 52.047 21.572s21.537 32.383 21.53 52.037c-.018 40.553-33.027 73.553-73.578 73.553h-.032c-12.313-.005-24.412-3.094-35.159-8.954z" />
          <path fill="url(#waFloatGrad2)" d="M87.184 25.227c-33.733 0-61.166 27.423-61.178 61.13a60.98 60.98 0 0 0 9.349 32.535l1.455 2.313-6.179 22.558 23.146-6.069 2.235 1.324c9.387 5.571 20.15 8.517 31.126 8.523h.023c33.707 0 61.14-27.426 61.153-61.135a60.75 60.75 0 0 0-17.895-43.251 60.75 60.75 0 0 0-43.235-17.928z" />
          <path fill="#ffffff" fillRule="evenodd" d="M68.772 55.603c-1.378-3.061-2.828-3.123-4.137-3.176l-3.524-.043c-1.226 0-3.218.46-4.902 2.3s-6.435 6.287-6.435 15.332 6.588 17.785 7.506 19.013 12.718 20.381 31.405 27.75c15.529 6.124 18.689 4.906 22.061 4.6s10.877-4.447 12.408-8.74 1.532-7.971 1.073-8.74-1.685-1.226-3.525-2.146-10.877-5.367-12.562-5.981-2.91-.919-4.137.921-4.746 5.979-5.819 7.206-2.144 1.381-3.984.462-7.76-2.861-14.784-9.124c-5.465-4.873-9.154-10.891-10.228-12.73s-.114-2.835.808-3.751c.825-.824 1.838-2.147 2.759-3.22s1.224-1.84 1.836-3.065.307-2.301-.153-3.22-4.032-10.011-5.666-13.647" />
        </svg>
      </div>
    </a>
  );
}

/** A content page: header, the page, the footer, the WhatsApp button, the demo dialog. */
export function SitePage({ meta, children, className = '', noindex = false }: { meta?: SitePageMeta; children: (openDemo: () => void) => ReactNode; className?: string; noindex?: boolean }) {
  useSeo(meta, { noindex });
  const [demoOpen, setDemoOpen] = useState(false);
  const openDemo = () => setDemoOpen(true);
  return (
    <div className={`lp sx-page ${className}`}>
      <SiteHeader onBookDemo={openDemo} />
      {demoOpen && <DemoModal onClose={() => setDemoOpen(false)} />}
      <main className="sx-main">{children(openDemo)}</main>
      <SiteFooter />
      <WhatsAppFloat />
    </div>
  );
}

/** The green hero at the top of a content page. */
export function PageHero({
  eyebrow, title, sub, children, align = 'center',
}: { eyebrow?: string; title: ReactNode; sub?: ReactNode; children?: ReactNode; align?: 'center' | 'left' }) {
  return (
    <section className={`sx-hero ${align}`}>
      <div className="sx-wrap">
        {eyebrow && <div className="sx-eyebrow">{eyebrow}</div>}
        <h1 className="sx-h1">{title}</h1>
        {sub && <p className="sx-lead">{sub}</p>}
        {children && <div className="sx-hero-actions">{children}</div>}
      </div>
    </section>
  );
}

/** "Start free trial" + "Book a demo", used under most heroes and at page ends. */
export function CtaButtons({ onDemo, light = false }: { onDemo: () => void; light?: boolean }) {
  return (
    <div className="sx-cta-row">
      <a className={`sx-btn primary${light ? ' on-dark' : ''}`} href="/#/register">Start 7-day free trial <span aria-hidden="true">→</span></a>
      <button type="button" className={`sx-btn secondary${light ? ' on-dark' : ''}`} onClick={onDemo}>Book a demo</button>
    </div>
  );
}

export function CtaBand({ onDemo, title = 'Grow your business on WhatsApp', sub = 'Every plan starts with a 7-day free trial of every feature. No card needed.' }: { onDemo: () => void; title?: string; sub?: string }) {
  return (
    <section className="sx-cta-band">
      <div className="sx-wrap">
        <h2>{title}</h2>
        <p>{sub}</p>
        <CtaButtons onDemo={onDemo} light />
      </div>
    </section>
  );
}
