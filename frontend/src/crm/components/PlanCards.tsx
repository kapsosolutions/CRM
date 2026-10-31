// The four plan cards, as the landing page shows them. Used by the landing
// page, the plans dialog (Buy Now) and Settings → Billing, so all three
// always show the same plans, prices and limits (crm/plans.ts). Only the
// button under each price differs (`action`). Styles: site/site.css (lp-plan-*).
import type { ReactNode } from 'react';
import {
  BILLING_CYCLES, META_PRICING_PDF, PLANS, billedText, monthlyPrice, type BillingCycle, type PlanTier,
} from '../plans';

export function CycleToggle({ value, onChange }: { value: BillingCycle; onChange: (c: BillingCycle) => void }) {
  return (
    <div className="lp-pricing-billing-toggle" role="radiogroup" aria-label="Billing cycle">
      {BILLING_CYCLES.map((c) => (
        <button
          key={c.key}
          type="button"
          role="radio"
          aria-checked={value === c.key}
          className={`lp-billing-btn ${value === c.key ? 'active' : ''}`}
          onClick={() => onChange(c.key)}
          data-cycle={c.key}
        >
          <span className="lp-billing-name">{c.label}</span>
          {c.save && <span className="lp-billing-save">{c.save}</span>}
        </button>
      ))}
    </div>
  );
}

/** "Additional charges apply for messages ⓘ": opens Meta's per-message prices. */
export function MessageChargesLink() {
  return (
    <a
      className="lp-plan-charges-link"
      href={META_PRICING_PDF}
      target="_blank"
      rel="noopener noreferrer"
      title="Meta charges per message, by category and country. See every rate."
      data-testid="plan-charges-link"
    >
      Additional charges apply for messages
      <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="10" fill="currentColor" />
        <rect x="11" y="10.5" width="2" height="7" rx="1" fill="#fff" />
        <circle cx="12" cy="7.5" r="1.25" fill="#fff" />
      </svg>
    </a>
  );
}

interface Props {
  cycle: BillingCycle;
  /** The button(s) under the price, per plan. */
  action: (plan: PlanTier) => ReactNode;
  /** Marks the card of the plan in force ("Current plan" ribbon). */
  currentTier?: string;
  /** Draws attention to one card (e.g. the plan a locked feature needs). */
  highlightTier?: string;
}

export function PlanCards({ cycle, action, currentTier, highlightTier }: Props) {
  return (
    <div className="lp-pricing-grid-flat">
      {PLANS.map((plan) => (
        <div
          key={plan.key}
          className={`lp-plan-card lp-plan-${plan.theme}${currentTier === plan.key ? ' is-current' : ''}${highlightTier === plan.key ? ' is-highlight' : ''}`}
          data-plan={plan.key}
        >
          <div className="lp-plan-card-header">
            <h3 className="lp-plan-card-title">{plan.name}</h3>
            {currentTier === plan.key ? (
              <span className="lp-plan-card-badge is-current">Current plan</span>
            ) : (
              plan.badge && <span className="lp-plan-card-badge">{plan.badge}</span>
            )}
          </div>

          <p className="lp-plan-card-desc">{plan.description}</p>

          <div className="lp-plan-price-row">
            <span className="lp-plan-price-val">{monthlyPrice(plan.key, cycle)}</span>
            <div className="lp-plan-price-period-wrap">
              <span className="lp-plan-price-period">/month</span>
              <span className="lp-plan-price-note">{billedText(plan.key, cycle)}</span>
            </div>
          </div>

          <div className="lp-plan-specs">
            <div className="lp-plan-spec-main">
              {plan.key === 'free' ? 'Up to 10 contacts · 3 templates' : 'Unlimited contacts & templates'}
            </div>
            <div className="lp-plan-spec-sub">
              {plan.key === 'free' ? 'After your 7-day free trial' : 'Every feature free for 7 days'}
            </div>
            <div className="lp-plan-spec-charges">
              <MessageChargesLink />
            </div>
          </div>

          <div className="lp-plan-actions">{action(plan)}</div>

          <div className="lp-plan-features-sec">
            <h4 className="lp-plan-features-title">Key features</h4>
            <ul className="lp-plan-features-list">
              {plan.includes.map((feat) => (
                <li key={feat} className="lp-plan-feature-item">
                  <span className="lp-plan-feature-check">✓</span>
                  <span className="lp-plan-feature-text">{feat}</span>
                </li>
              ))}
              {plan.excludes.map((feat) => (
                <li key={feat} className="lp-plan-feature-item is-excluded">
                  <span className="lp-plan-feature-check" aria-label="Not included">✕</span>
                  <span className="lp-plan-feature-text">{feat}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ))}
    </div>
  );
}
