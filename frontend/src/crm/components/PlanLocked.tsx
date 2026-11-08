// A page the business's plan doesn't include: what it is, which plan has
// it, and "See plans" (opens the plans dialog on that plan). The server
// refuses its changes as well (services/plans.js), so this isn't the only lock.
import type { PlanFeature, PlanTierKey } from '../types';
import { usePlan } from '../PlanContext';
import { TIER_NAMES, hasFeature, tierFor } from '../plans';
import type { VerticalConfig } from '../verticals';
import {
  catalogHero, categoriesHero, flowsHero, membersHero, offersHero, ordersHero, type HeroCopy,
} from '../emptyPages';
import { BenefitCheckIcon } from './WhatsAppConnectRequired';
import './WhatsAppConnectRequired.css';
import './ComingSoon.css';
import './PlanLocked.css';

/** The crown: marks anything the business's plan doesn't include. */
export function CrownIcon({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg className={`crown-svg${className ? ` ${className}` : ''}`} xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M7.51 4.87C7.01 6.27 6.45 6.95 5.94 7c-.57.07-1.07-.18-1.54-.8a.54.54 0 0 0-.1-.1 1 1 0 1 0-.8.4l.01.12.82 3.24A1.5 1.5 0 0 0 5.78 11h4.44a1.5 1.5 0 0 0 1.45-1.14l.82-3.24a.54.54 0 0 0 .01-.12 1 1 0 1 0-.8-.4.54.54 0 0 0-.1.09c-.49.62-1 .87-1.54.81-.5-.05-1.04-.74-1.57-2.13a1 1 0 1 0-.98 0zM11 11.75a.5.5 0 1 1 0 1H5a.5.5 0 1 1 0-1h6z"
      />
    </svg>
  );
}

/** A small gold crown badge: "this needs the X plan". */
export function PlanCrown({ tier, size = 16, className = '' }: { tier: PlanTierKey; size?: number; className?: string }) {
  return (
    <span
      className={`plan-crown${className ? ` ${className}` : ''}`}
      title={`Needs the ${TIER_NAMES[tier]} plan`}
      aria-label={`Needs the ${TIER_NAMES[tier]} plan`}
      data-testid="plan-crown"
      data-tier={tier}
    >
      <CrownIcon size={size} />
    </span>
  );
}

/**
 * Is `feature` outside the plan? → the plan that has it and an "open the
 * plans dialog" for it; null when the plan includes it.
 */
export function useFeatureLock() {
  const { plan, openPlans } = usePlan();
  return (feature: PlanFeature) => {
    if (hasFeature(plan, feature)) return null;
    const tier = tierFor(feature);
    const title = INFO[feature]?.title || 'This feature';
    return {
      tier,
      open: () => openPlans({ tier, reason: `${title} ${title.endsWith('s') ? 'are' : 'is'} included from the ${TIER_NAMES[tier]} plan.` }),
    };
  };
}

const INFO: Partial<Record<PlanFeature, { title: string; icon: string; points: string[] }>> = {
  templates: { title: 'Templates', icon: 'description', points: ['Create and send Meta-approved templates'] },
  campaigns: {
    title: 'Campaigns',
    icon: 'campaign',
    points: ['Broadcast a template to your customer lists', 'Drip campaigns with timed follow-ups', 'Delivery, read and reply stats'],
  },
  journeys: {
    title: 'Automation',
    icon: 'account_tree',
    points: ['Journeys that reply for you, day and night', 'Keyword and order-status auto-replies'],
  },
  flows: {
    title: 'WhatsApp Flows',
    icon: 'account_tree',
    points: ['Native WhatsApp forms: bookings, orders and sign-ups inside the chat', 'Flows that continue the conversation when a form is sent'],
  },
  calls: { title: 'WhatsApp calls', icon: 'call', points: ['Call customers and answer their calls from the CRM'] },
  polls: { title: 'Polls', icon: 'poll', points: ['Ask customers a question with tap-to-answer options'] },
  events: { title: 'Events', icon: 'event', points: ['Send an event with its date, place and a calendar button'] },
  api: { title: 'Template API keys', icon: 'key', points: ['Send templates and one-time codes from your website, app or server'] },
  catalog: { title: 'Catalog', icon: 'storefront', points: ['Your products in WhatsApp', 'Customers order straight from the chat'] },
  categories: { title: 'Categories', icon: 'category', points: ['Group your products, services or team'] },
  members: { title: 'Members', icon: 'groups', points: ['Your team or staff, bookable by customers'] },
  offers: { title: 'Offers', icon: 'local_offer', points: ['Coupons and limited-time deals sent in the chat'] },
  orders: { title: 'Orders & bookings', icon: 'receipt_long', points: ['Every WhatsApp order and booking in one place', 'Status updates sent to the customer automatically'] },
  'payment-config': { title: 'Payment configuration', icon: 'payments', points: ['Collect payments inside WhatsApp (WhatsApp Pay)'] },
  ads: { title: 'Ads', icon: 'ads_click', points: ['Click-to-WhatsApp ads and lead forms'] },
  create: { title: 'Create', icon: 'add_photo_alternate', points: ['Publish Facebook and Instagram posts', 'Auto-DM everyone who comments'] },
  instagram: { title: 'Instagram', icon: 'photo_camera', points: ['Instagram DMs in your team inbox'] },
  messenger: { title: 'Messenger', icon: 'forum', points: ['Facebook Messenger in your team inbox'] },
};

/** The page's own "what you get" words (emptyPages.ts), in the business's terms. */
function lockedCopy(feature: PlanFeature, v: VerticalConfig | undefined, info: { title: string; points: string[] }): HeroCopy {
  if (v) {
    if (feature === 'catalog') return catalogHero(v);
    if (feature === 'categories') return categoriesHero(v);
    if (feature === 'members') return membersHero(v);
    if (feature === 'orders') return ordersHero(v);
    if (feature === 'flows') return flowsHero(v);
  }
  if (feature === 'offers') return offersHero();
  return {
    title: `Use ${info.title} in your CRM`,
    subtitle: `${info.title} ${info.title.endsWith('s') ? 'are' : 'is'} part of the higher plans.`,
    benefitsTitle: 'What you get',
    benefits: info.points,
    actionLabel: '',
  };
}

/**
 * A page outside the plan, laid out like the page's own "connect" screen
 * (the Ads screen): its icon with a crown, what the page does, what you get,
 * and "Upgrade to Basic" (opens the plans dialog on that plan).
 */
export function PlanLockedPage({ feature, vertical }: { feature: PlanFeature; vertical?: VerticalConfig }) {
  const { plan, openPlans } = usePlan();
  const need = tierFor(feature);
  const info = INFO[feature] || { title: 'This page', icon: 'lock', points: [] };
  const copy = lockedCopy(feature, vertical, info);
  return (
    <div className="wa-req-wrapper pl-screen" data-testid="plan-locked" data-feature={feature}>
      <div className="wa-req-box">
        <div className="pl-icon" aria-hidden="true">
          <span className="material-icons">{info.icon}</span>
          <span className="pl-lock"><CrownIcon size={15} /></span>
        </div>
        <span className="pl-pill"><CrownIcon size={13} /> {TIER_NAMES[need]} plan</span>

        <h2 className="wa-req-headline">{copy.title}</h2>
        <p className="wa-req-subline">{copy.subtitle}</p>

        <div className="wa-req-benefits-box">
          {copy.benefits.length > 0 && (
            <>
              <h3 className="wa-req-benefits-title">{copy.benefitsTitle}</h3>
              <ul className="wa-req-benefits-list">
                {copy.benefits.map((b) => (
                  <li key={b} className="wa-req-benefit-item">
                    <BenefitCheckIcon />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="pl-screen-note">
            {info.title} isn&apos;t in your {plan?.name || 'current'} plan.{' '}
            {plan?.status === 'free' && plan.ended?.kind === 'trial'
              ? `Your free trial has ended. Upgrade to ${TIER_NAMES[need]} or higher to use it again.`
              : `Upgrade to ${TIER_NAMES[need]} or higher to use it.`}
          </p>
          <div className="wa-req-cta-row">
            <button
              type="button"
              className="soon-start-btn"
              onClick={() => openPlans({ tier: need, reason: `${info.title} is included from the ${TIER_NAMES[need]} plan.` })}
              data-testid="plan-locked-upgrade"
            >
              <CrownIcon size={18} />
              Upgrade to {TIER_NAMES[need]}
              <span className="material-icons" aria-hidden="true">arrow_forward</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** A small crown + "Basic" pill for an option the plan doesn't include. */
export function PlanPill({ tier }: { tier: PlanTierKey }) {
  return (
    <span className="pl-mini" aria-label={`Needs the ${TIER_NAMES[tier]} plan`}>
      <CrownIcon size={12} />
      {TIER_NAMES[tier]}
    </span>
  );
}
