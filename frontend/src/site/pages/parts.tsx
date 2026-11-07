// Small building blocks shared by the website's pages.
import { Fragment, useState, type ReactNode } from 'react';
import { SiteLink } from '../SiteChrome';
import { TIER_NAMES, tierFor } from '../../crm/plans';
import type { PlanFeature } from '../../crm/types';
import type { ChatLine, Faq, Feature } from '../content/products';

/**
 * Inline text: *green words* become <em>, `code` becomes <code>. Content is
 * our own copy, never user input, and nothing is parsed as HTML.
 */
export function Rich({ text }: { text: string }) {
  const parts = text.split(/(\*[^*]+\*|`[^`]+`)/g).filter(Boolean);
  return (
    <>
      {parts.map((p, i) => {
        if (p.length > 2 && p.startsWith('*') && p.endsWith('*')) return <em key={i}>{p.slice(1, -1)}</em>;
        if (p.length > 2 && p.startsWith('`') && p.endsWith('`')) return <code key={i}>{p.slice(1, -1)}</code>;
        return <Fragment key={i}>{p}</Fragment>;
      })}
    </>
  );
}

export function Crumbs({ items }: { items: { href?: string; label: string }[] }) {
  return (
    <nav className="sx-crumbs" aria-label="Breadcrumb">
      {items.map((c, i) => (
        <Fragment key={c.label}>
          {i > 0 && <span aria-hidden="true">/</span>}
          {c.href ? <SiteLink href={c.href}>{c.label}</SiteLink> : <strong aria-current="page">{c.label}</strong>}
        </Fragment>
      ))}
    </nav>
  );
}

/** A phone with a short WhatsApp chat in it. */
export function ChatPhone({ lines, label = 'Example WhatsApp chat' }: { lines: ChatLine[]; label?: string }) {
  return (
    <div className="sx-visual">
      <div className="sx-phone" role="img" aria-label={label}>
        {lines.map((l, i) => (
          <div key={i} className={`sx-bubble${l.out ? ' out' : ''}`}>
            {l.text}
            {l.button && <span className="sx-bubble-btn">{l.button}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

export function FeatureGrid({ items }: { items: Feature[] }) {
  return (
    <div className="sx-grid">
      {items.map((f) => (
        <div key={f.title} className="sx-card">
          <div className="sx-card-ico"><span className="material-icons" aria-hidden="true">{f.icon}</span></div>
          <h3>{f.title}</h3>
          <p>{f.text}</p>
        </div>
      ))}
    </div>
  );
}

export function Steps({ items }: { items: { title: string; text: string }[] }) {
  return (
    <div className="sx-steps">
      {items.map((s) => (
        <div key={s.title} className="sx-step">
          <h3>{s.title}</h3>
          <p>{s.text}</p>
        </div>
      ))}
    </div>
  );
}

export function FaqList({ items }: { items: Faq[] }) {
  return (
    <div className="sx-faq">
      {items.map((f) => (
        <details key={f.q}>
          <summary>{f.q}</summary>
          <p>{f.a}</p>
        </details>
      ))}
    </div>
  );
}

export function Section({ title, sub, tint = false, center = false, id, children }: { title?: ReactNode; sub?: ReactNode; tint?: boolean; center?: boolean; id?: string; children: ReactNode }) {
  return (
    <section className={`sx-section${tint ? ' tint' : ''}`} id={id}>
      <div className="sx-wrap">
        {(title || sub) && (
          <div className={center ? 'sx-center' : undefined}>
            {title && <h2 className="sx-h2">{title}</h2>}
            {sub && <p className="sx-sub">{sub}</p>}
          </div>
        )}
        {children}
      </div>
    </section>
  );
}

/** A dark code block with a Copy button. */
export function CodeBlock({ code, label }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="sx-code-wrap">
      <pre className="sx-code" aria-label={label}><code>{code}</code></pre>
      <button
        type="button"
        className="sx-code-copy"
        onClick={() => {
          navigator.clipboard?.writeText(code).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          }).catch(() => {});
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

/** "Included in every plan" / "Included from the Basic plan". */
export function PlanNote({ feature, soon }: { feature?: PlanFeature | 'carousel' | 'lto' | 'authTemplates'; soon?: boolean }) {
  if (soon) return <div className="sx-plan-note"><span className="material-icons" aria-hidden="true">schedule</span>Coming soon</div>;
  if (!feature) return null;
  const tier = tierFor(feature);
  return (
    <div className="sx-plan-note">
      <span className="material-icons" aria-hidden="true">workspace_premium</span>
      {tier === 'free' ? 'Included in every plan' : `Included from the ${TIER_NAMES[tier]} plan`}
      {' · '}
      <SiteLink href="/pricing">See plans</SiteLink>
    </div>
  );
}

/** A card that links to another page. */
export function LinkCard({ href, icon, title, text, more = 'Learn more', badge }: { href: string; icon: string; title: string; text: string; more?: string; badge?: string }) {
  return (
    <SiteLink href={href} className="sx-card">
      <div className="sx-card-ico"><span className="material-icons" aria-hidden="true">{icon}</span></div>
      <h3>
        {title}
        {badge && <span className="sx-badge-soon">{badge}</span>}
      </h3>
      <p>{text}</p>
      <span className="sx-card-more">{more} →</span>
    </SiteLink>
  );
}
