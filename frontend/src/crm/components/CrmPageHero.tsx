// A page with nothing on it yet, laid out like the Catalog's "connect" page:
// the page's own icon ⇄ WhatsApp, a headline that says what the page is for,
// a short line, what it gets you, and the one button that starts it.
import type { ReactNode } from 'react';
import './CrmPageHero.css';

export interface CrmPageHeroProps {
  /** The page's icon: its sidebar SVG, or a material icon name. */
  icon: ReactNode | string;
  /** The icon tile's colour. */
  tone?: 'green' | 'amber' | 'blue' | 'purple' | 'teal';
  title: string;
  subtitle: string;
  benefitsTitle?: string;
  benefits?: string[];
  actionLabel?: string;
  actionIcon?: string;
  onAction?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  /** A quiet line under the buttons. */
  note?: string;
  testId?: string;
}

function CheckIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="crm-hero-check">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <path d="M8.5 12.2L10.8 14.5L15.5 9.8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CrmPageHero({
  icon, tone = 'green', title, subtitle, benefitsTitle, benefits = [], actionLabel, actionIcon, onAction,
  secondaryLabel, onSecondary, note, testId,
}: CrmPageHeroProps) {
  return (
    <div className="crm-hero" data-testid={testId || 'crm-hero'}>
      <div className="crm-hero-logos" aria-hidden="true">
        <span className={`crm-hero-tile ${tone}`}>
          {typeof icon === 'string' ? <span className="material-icons">{icon}</span> : icon}
        </span>
        <span className="crm-hero-arrow">⇄</span>
        <img src="/whatsapp.svg" alt="" className="crm-hero-wa" />
      </div>
      <h2 className="crm-hero-title">{title}</h2>
      <p className="crm-hero-sub">{subtitle}</p>
      {benefits.length > 0 && (
        <>
          {benefitsTitle && <h3 className="crm-hero-benefits-title">{benefitsTitle}</h3>}
          <ul className="crm-hero-benefits">
            {benefits.map((b) => (
              <li key={b}>
                <CheckIcon />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {(actionLabel || secondaryLabel) && (
        <div className="crm-hero-actions">
          {actionLabel && onAction && (
            <button type="button" className="crm-hero-btn" onClick={onAction} data-testid="crm-hero-action">
              {actionIcon && <span className="material-icons">{actionIcon}</span>}
              {actionLabel}
            </button>
          )}
          {secondaryLabel && onSecondary && (
            <button type="button" className="crm-hero-btn ghost" onClick={onSecondary} data-testid="crm-hero-secondary">
              {secondaryLabel}
            </button>
          )}
        </div>
      )}
      {note && <p className="crm-hero-note">{note}</p>}
    </div>
  );
}
