// "Buy Now": the plans dialog, and buying a plan with Razorpay.
//
// The cards are the landing page's (PlanCards). Each paid plan's button says
// what clicking it does for THIS business (Buy, Upgrade, Renew, or why not),
// shows the exact amount from the server (an upgrade's unused credit comes
// off), then goes to Razorpay's payment page (a Payment Link, crm/razorpay.ts).
// The plan changes only after the server has checked the payment with Razorpay.
import { useCallback, useState } from 'react';
import type { CrmApi } from '../api';
import type { PlanState, PlanTierKey } from '../types';
import { useConfirm, useNotify } from './Dialogs';
import { BuyNowSvg } from './TemplateIcons';
import { CycleToggle, PlanCards } from './PlanCards';
import { payForPlan } from '../razorpay';
import {
  TIER_NAMES, cycleLabel, rupees, tierRank, type BillingCycle, type PlanTier,
} from '../plans';
import '../../site/site.css';

const fmtDate = (s?: string | null) =>
  s ? new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

/**
 * Buy a plan: confirm the amount, pay in Razorpay, activate.
 * Resolves the new plan, or null if cancelled / failed (a toast says why).
 */
export function usePlanPurchase(api: CrmApi, onPaid?: (plan: PlanState) => void) {
  const confirm = useConfirm();
  const notify = useNotify();
  return useCallback(
    async (tier: PlanTierKey, cycle: BillingCycle): Promise<PlanState | null> => {
      let q;
      try {
        q = (await api.getPlanQuote(tier, cycle)).data;
      } catch (e) {
        notify('error', 'Couldn’t start the payment', e instanceof Error ? e.message : undefined);
        return null;
      }
      const points = [
        `${TIER_NAMES[tier]} · ${cycleLabel(cycle)}: ${rupees(q.listPaise)}`,
        ...(q.creditPaise > 0 ? [`Unused part of your current plan: −${rupees(q.creditPaise)}`] : []),
        q.kind === 'renew'
          ? `Extends your plan until ${fmtDate(q.endsAt)}`
          : `${TIER_NAMES[tier]} from today until ${fmtDate(q.endsAt)}`,
      ];
      const ok = await confirm({
        title: `Pay ${rupees(q.amountPaise)} for ${TIER_NAMES[tier]}?`,
        message: 'You’ll pay securely on Razorpay’s page (UPI, cards, net banking, wallets), then come back here. Your plan changes as soon as the payment is confirmed.',
        points,
        confirmLabel: `Pay ${rupees(q.amountPaise)}`,
        tone: 'primary',
      });
      if (!ok) return null;
      try {
        // Off to Razorpay's page; the result shows when it sends the browser back.
        await payForPlan(api, tier, cycle);
        notify('success', 'Opening Razorpay…', 'Pay there; you’ll come back to Billing when it’s done.');
        return null;
      } catch (e) {
        notify('error', 'Payment not completed', e instanceof Error ? e.message : 'Please try again.');
        return null;
      }
    },
    [api, confirm, notify, onPaid],
  );
}

/** The button(s) for one plan card, for this business's plan. */
export function PlanAction({
  plan, current, busy, onBuy,
}: {
  plan: PlanTier;
  current: PlanState | null | undefined;
  busy: string;
  onBuy: (tier: PlanTierKey) => void;
}) {
  const cur = current?.tier;
  const paidActive = current?.status === 'active';
  const lower = paidActive && cur && tierRank(plan.key) < tierRank(cur);
  const same = paidActive && cur === plan.key;
  const label = busy === plan.key
    ? 'Opening…'
    : same
      ? `Renew ${plan.name}`
      : paidActive && cur && tierRank(plan.key) > tierRank(cur)
        ? `Upgrade to ${plan.name}`
        : `Buy ${plan.name}`;
  return (
    <>
      <button
        type="button"
        className="lp-plan-try-btn"
        style={{ backgroundColor: plan.buttonColor }}
        disabled={!!busy || !!lower}
        onClick={() => onBuy(plan.key)}
        data-plan={plan.key}
      >
        {!lower && <BuyNowSvg width={16} height={16} stroke="currentColor" />}
        <span>{lower ? `After ${fmtDate(current?.endsAt)}` : label}</span>
      </button>
      {same && <span className="lp-plan-action-note">Adds to your current period (until {fmtDate(current?.endsAt)}).</span>}
      {lower && <span className="lp-plan-action-note">You can switch when your {current?.name} plan ends.</span>}
      {current?.status === 'trial' && <span className="lp-plan-action-note">Your remaining trial days are added on.</span>}
    </>
  );
}

interface Props {
  onClose: () => void;
  api: CrmApi;
  plan: PlanState | null | undefined;
  /** Highlight the plan a locked feature needs. */
  highlightTier?: PlanTierKey;
  /** Why the dialog opened ("Campaigns need the Basic plan"). */
  reason?: string;
  onPaid?: (plan: PlanState) => void;
}

export function BuyPlanModal({ onClose, api, plan, highlightTier, reason, onPaid }: Props) {
  const [cycle, setCycle] = useState<BillingCycle>('annual');
  const [busy, setBusy] = useState('');
  const buy = usePlanPurchase(api, onPaid);

  const handleBuy = async (tier: PlanTierKey) => {
    setBusy(tier);
    const r = await buy(tier, cycle);
    setBusy('');
    if (r) onClose();
  };

  return (
    <div className="bpm-backdrop" onClick={onClose}>
      <div className="bpm-dialog bpm-dialog-wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Choose your plan" data-testid="plans-dialog">
        <button type="button" className="bpm-close" onClick={onClose} aria-label="Close">
          <span className="material-icons">close</span>
        </button>

        <div className="bpm-header">
          <div className="bpm-badge">CHOOSE YOUR PLAN</div>
          <h2 className="bpm-title">Flexible Plans for Every Growing Business</h2>
          <p className="bpm-subtitle">
            {reason || 'Pay securely with Razorpay. Your plan changes the moment the payment is confirmed.'}
          </p>
        </div>

        <div className="lp-pricing-banner" style={{ marginBottom: 24 }}>
          <div className="lp-pricing-banner-text">
            Up to ~25% off with <span className="lp-pricing-banner-link">annual billing</span> · quarterly and annual are paid upfront
          </div>
          <CycleToggle value={cycle} onChange={setCycle} />
        </div>

        <PlanCards
          cycle={cycle}
          currentTier={plan?.status === 'active' || plan?.status === 'legacy' ? plan?.tier : undefined}
          highlightTier={highlightTier}
          action={(p) => <PlanAction plan={p} current={plan} busy={busy} onBuy={handleBuy} />}
        />

        <div className="bpm-footer-note" style={{ marginTop: 24 }}>
          Prices include all charges from us. Meta bills WhatsApp message charges separately, per message (see the rates).
        </div>
      </div>
    </div>
  );
}
