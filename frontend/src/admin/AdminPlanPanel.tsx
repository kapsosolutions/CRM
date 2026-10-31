// Super-admin → a business → Plan: the plan in force, and giving a plan
// without online payment (cash, partner, support) or restarting the free
// trial. The business is notified (backend services/subscriptions.js grantPlan).
import { useState } from 'react';
import { platformApi, type Business } from './platformApi';
import { useConfirm, useNotify } from '../crm/components/Dialogs';
import { TIER_NAMES } from '../crm/plans';
import type { PlanTierKey } from '../crm/types';
import { PlanCell } from './BusinessesPage';

const inDays = (d: number) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);

export function AdminPlanPanel({ biz, onChanged }: { biz: Business; onChanged: (b: Business) => void }) {
  const confirm = useConfirm();
  const notify = useNotify();
  const [tier, setTier] = useState<PlanTierKey>('basic');
  const [until, setUntil] = useState(inDays(30));
  const [busy, setBusy] = useState(false);

  async function give() {
    const ok = await confirm({
      title: `Give ${biz.name} the ${TIER_NAMES[tier]} plan?`,
      message: `Without payment, until ${new Date(until).toDateString()}. It replaces the current plan, and the business is notified.`,
      confirmLabel: `Give ${TIER_NAMES[tier]}`,
      tone: 'primary',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await platformApi.setPlan(biz._id, { tier, until: new Date(`${until}T23:59:59`).toISOString() });
      onChanged(r.data);
      notify('success', 'Plan changed', `${biz.name} is on ${TIER_NAMES[tier]} until ${new Date(until).toDateString()}.`);
    } catch (e) {
      notify('error', 'Could not change the plan', e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  async function restartTrial() {
    const ok = await confirm({
      title: `Restart the free trial for ${biz.name}?`,
      message: 'Every feature for 7 days from now, then the Free plan unless they buy one. Any current plan is replaced.',
      confirmLabel: 'Restart trial',
      tone: 'primary',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await platformApi.setPlan(biz._id, { trialDays: 7 });
      onChanged(r.data);
      notify('success', 'Trial restarted', `${biz.name} has every feature for 7 days.`);
    } catch (e) {
      notify('error', 'Could not restart the trial', e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="pa-panel" data-testid="admin-plan-panel">
      <div className="pa-panel-head">Plan</div>
      <div className="pa-plan-current"><PlanCell s={biz.planState} /></div>
      <p className="pa-panel-note">
        Businesses buy plans themselves in Settings → Billing (Razorpay). Use this only for a plan paid another
        way, or to give a trial again.
      </p>
      <div className="pa-plan-form">
        <label>
          Plan
          <select value={tier} onChange={(e) => setTier(e.target.value as PlanTierKey)} aria-label="Plan">
            {(['free', 'basic', 'pro', 'premium'] as PlanTierKey[]).map((t) => <option key={t} value={t}>{TIER_NAMES[t]}</option>)}
          </select>
        </label>
        <label>
          Until
          <input type="date" value={until} min={inDays(1)} onChange={(e) => setUntil(e.target.value)} aria-label="Until" />
        </label>
        <button type="button" className="pa-btn" onClick={give} disabled={busy || !until}>Give plan</button>
        <button type="button" className="pa-btn ghost" onClick={restartTrial} disabled={busy}>Restart 7-day trial</button>
      </div>
    </section>
  );
}
