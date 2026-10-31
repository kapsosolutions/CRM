// A page the business's plan doesn't include: what it is, which plan has
// it, and "See plans" (opens the plans dialog on that plan). The server
// refuses its changes as well (services/plans.js), so this isn't the only lock.
import type { PlanFeature } from '../types';
import { usePlan } from '../PlanContext';
import { TIER_NAMES, tierFor } from '../plans';
import './PlanLocked.css';

const INFO: Partial<Record<PlanFeature, { title: string; icon: string; points: string[] }>> = {
  templates: { title: 'Templates', icon: 'description', points: ['Create and send Meta-approved templates'] },
  campaigns: {
    title: 'Campaigns',
    icon: 'campaign',
    points: ['Broadcast a template to your customer lists', 'Drip campaigns with timed follow-ups', 'Delivery, read and reply stats'],
  },
  flows: {
    title: 'Automation',
    icon: 'account_tree',
    points: ['Journeys that reply for you, day and night', 'WhatsApp Flows: forms, bookings and orders in the chat', 'Keyword and order-status auto-replies'],
  },
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

export function PlanLockedPage({ feature }: { feature: PlanFeature }) {
  const { plan, openPlans } = usePlan();
  const need = tierFor(feature);
  const info = INFO[feature] || { title: 'This page', icon: 'lock', points: [] };
  return (
    <div className="pl-wrap" data-testid="plan-locked" data-feature={feature}>
      <div className="pl-card">
        <div className="pl-icon" aria-hidden="true">
          <span className="material-icons">{info.icon}</span>
          <span className="pl-lock"><span className="material-icons">lock</span></span>
        </div>
        <span className="pl-pill">{TIER_NAMES[need]} plan</span>
        <h2 className="pl-title">{info.title} isn&apos;t in your {plan?.name || 'current'} plan</h2>
        <p className="pl-sub">
          {plan?.status === 'free' && plan.ended?.kind === 'trial'
            ? `Your free trial has ended. Upgrade to ${TIER_NAMES[need]} or higher to use ${info.title} again.`
            : `Upgrade to ${TIER_NAMES[need]} or higher to use ${info.title}.`}
        </p>
        {info.points.length > 0 && (
          <ul className="pl-points">
            {info.points.map((p) => (
              <li key={p}>
                <span className="material-icons" aria-hidden="true">check_circle</span>
                {p}
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          className="pl-btn"
          onClick={() => openPlans({ tier: need, reason: `${info.title} is included from the ${TIER_NAMES[need]} plan.` })}
          data-testid="plan-locked-upgrade"
        >
          <span className="material-icons" aria-hidden="true">workspace_premium</span>
          See plans
        </button>
      </div>
    </div>
  );
}

/** A small lock + "Basic" pill for an option the plan doesn't include. */
export function PlanPill({ tier }: { tier: string }) {
  return (
    <span className="pl-mini" aria-label={`Needs the ${tier} plan`}>
      <span className="material-icons" aria-hidden="true">lock</span>
      {tier}
    </span>
  );
}
