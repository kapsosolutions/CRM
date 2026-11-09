// Settings → Billing: the plan in force and how much of its limits is used,
// the number's messaging limit, the plans (the landing page's cards) with
// Razorpay payment, the billing contact and the payments made.
// Plans and prices: crm/plans.ts (the server enforces them: services/plans.js).
import { useCallback, useEffect, useState } from 'react';
import type { CrmApi } from '../api';
import type { BillingSummary, PlanTierKey } from '../types';
import type { CrmView } from './NavRail';
import { PlanAction, usePlanPurchase } from './BuyPlanModal';
import { CycleToggle, MessageChargesLink, PlanCards } from './PlanCards';
import { usePlan } from '../PlanContext';
import { TIER_NAMES, TRIAL_LIMITS, cycleLabel, rupees, type BillingCycle } from '../plans';
import '../../site/site.css';
import './Billing.css';

interface Props {
  api: CrmApi;
  demo?: boolean;
  onNavigate?: (view: CrmView) => void;
  /** Open the Business profile tab (where the contact details are edited). */
  onEditProfile?: () => void;
}

const fmtDate = (s?: string | null) =>
  s ? new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
const fmtPhone = (s?: string) => {
  const d = String(s || '').replace(/\D/g, '');
  return d ? `+${d}` : '';
};
const QUALITY: Record<string, string> = { GREEN: 'High', YELLOW: 'Medium', RED: 'Low' };
const KIND: Record<string, string> = { new: 'New plan', renew: 'Renewal', upgrade: 'Upgrade' };

function UsageRow({ label, used, limit, unit }: { label: string; used: number | null; limit: number | null; unit: string }) {
  if (limit === null) {
    return (
      <div className="bl-usage-row">
        <span>{label}</span>
        <strong>Unlimited</strong>
      </div>
    );
  }
  const u = used ?? 0;
  const pct = limit > 0 ? Math.min(100, Math.round((u / limit) * 100)) : 100;
  const full = limit === 0 || u >= limit;
  return (
    <div className="bl-usage-row has-bar" data-full={full ? 'true' : undefined}>
      <span>{label}</span>
      <strong>{limit === 0 ? 'Not included' : `${Math.min(u, limit)} of ${limit} ${unit}`}</strong>
      {limit > 0 && (
        <div className="bl-bar" role="progressbar" aria-valuemin={0} aria-valuemax={limit} aria-valuenow={Math.min(u, limit)} aria-label={label}>
          <span className={full ? 'out' : ''} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

export function BillingPage({ api, demo = false, onNavigate, onEditProfile }: Props) {
  const [data, setData] = useState<BillingSummary | null>(null);
  const [error, setError] = useState('');
  const [cycle, setCycle] = useState<BillingCycle>('annual');
  const [busy, setBusy] = useState('');
  const { refresh } = usePlan();

  const load = useCallback(() => {
    api
      .getBilling()
      .then((r) => {
        setData(r.data);
        setError('');
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load billing information.'));
  }, [api]);
  useEffect(() => {
    load();
  }, [load]);

  const buy = usePlanPurchase(api, () => {
    load();
    refresh();
  });

  if (error && !data) {
    return (
      <div className="bl-page" data-testid="billing-page">
        <h2 className="bp-section-title">Billing</h2>
        <p className="err">{error}</p>
        <button type="button" className="bl-btn ghost" onClick={load}>Try again</button>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="bl-page" data-testid="billing-page">
        <h2 className="bp-section-title">Billing</h2>
        <div className="page-note">Loading billing information…</div>
      </div>
    );
  }

  const { plan, usage, messaging, contact, payments, paymentsEnabled } = data;

  async function handleBuy(tier: PlanTierKey) {
    setBusy(tier);
    await buy(tier, cycle);
    setBusy('');
  }

  const pill = plan.status === 'trial'
    ? { cls: 'trial', text: 'Free trial' }
    : plan.status === 'free'
      ? { cls: 'free', text: 'No active plan' }
      : { cls: 'paid', text: plan.name };

  const statusLine = plan.status === 'trial'
    ? `Every feature is open during your trial, with up to ${TRIAL_LIMITS.templates} templates and ${TRIAL_LIMITS.campaigns} campaigns. It ends on ${fmtDate(plan.endsAt)} (${plan.daysLeft === 1 ? '1 day' : `${plan.daysLeft} days`} left); after that only the Starter features stay open unless you choose a plan.`
    : plan.status === 'active'
      ? `You're on ${plan.name}${plan.cycle ? ` (${cycleLabel(plan.cycle)})` : ''} until ${fmtDate(plan.endsAt)}. Renew before then to keep it.`
      : plan.status === 'legacy'
        ? `You're on ${plan.name}: every feature, as when you joined. Buy a plan any time; it starts straight away.`
        : plan.ended?.kind === 'plan'
          ? `Your ${plan.ended.name} plan ended on ${fmtDate(plan.ended.at)}. Choose a plan to unlock everything again; until then only the Starter features stay open (chats, 50 templates, 10 campaigns a month and journeys).`
          : `Your free trial ended${plan.ended?.at ? ` on ${fmtDate(plan.ended.at)}` : ''}. Choose a plan to unlock everything again; until then only the Starter features stay open (chats, 50 templates, 10 campaigns a month and journeys).`;

  return (
    <div className="bl-page" data-testid="billing-page">
      <h2 className="bp-section-title">Billing</h2>
      <p className="bp-section-sub">Your plan, what it includes, and your payments.</p>

      {plan.endingSoon && (plan.status === 'trial' || plan.status === 'active') && (
        <div className="bl-banner" data-testid="billing-ending">
          <span className="material-icons" aria-hidden="true">schedule</span>
          <div>
            <strong>
              {plan.status === 'trial' ? 'Your free trial' : `Your ${plan.name} plan`} ends {plan.daysLeft && plan.daysLeft > 1 ? `in ${plan.daysLeft} days` : 'today'}
            </strong>
            <span>Choose a plan below to keep every feature you use.</span>
          </div>
        </div>
      )}

      <div className="bl-grid">
        {/* ---- Current plan ---- */}
        <section className="bl-card" data-testid="billing-plan">
          <div className="bl-card-head">
            <h3>Current plan</h3>
            <span className={`bl-pill ${pill.cls}`} data-testid="billing-plan-badge">{pill.text}</span>
          </div>
          <p className="bl-text" data-testid="billing-plan-status">{statusLine}</p>

          <div className="bl-usage" data-testid="billing-usage">
            <UsageRow label="Contacts you can chat with" used={usage.contacts.used} limit={usage.contacts.limit} unit="contacts" />
            <UsageRow label="Templates" used={usage.templates.used} limit={usage.templates.limit} unit="templates" />
            <UsageRow label={usage.campaigns.period === 'trial' ? 'Campaigns during the trial' : 'Campaigns this month'} used={usage.campaigns.used} limit={usage.campaigns.limit} unit="campaigns" />
          </div>

          <dl className="bl-kv">
            {plan.customerSince && <div><dt>Customer since</dt><dd>{fmtDate(plan.customerSince)}</dd></div>}
            {plan.endsAt && (
              <div>
                <dt>{plan.status === 'trial' ? 'Trial ends' : 'Renews / ends'}</dt>
                <dd>{fmtDate(plan.endsAt)}</dd>
              </div>
            )}
          </dl>
          <MessageChargesLink />
        </section>

        {/* ---- Messaging limit (Channel Status) ---- */}
        <section className="bl-card" data-testid="billing-tier">
          <div className="bl-card-head">
            <h3>WhatsApp messaging limit</h3>
            {messaging.connected && messaging.status && (
              <span className={`bl-pill ${messaging.status === 'CONNECTED' ? 'paid' : 'trial'}`}>{messaging.status.replace(/_/g, ' ')}</span>
            )}
          </div>
          {messaging.connected ? (
            <>
              <div className="bl-tier" data-testid="billing-tier-value">
                {messaging.limit
                  ? messaging.limit.unlimited
                    ? 'Unlimited customers / 24 hours'
                    : messaging.limit.limit
                      ? `${messaging.limit.label} customers / 24 hours`
                      : messaging.limit.label
                  : 'Not available right now'}
              </div>
              <p className="bl-text">
                How many different customers{messaging.displayPhoneNumber ? ` ${messaging.displayPhoneNumber}` : ' your number'} can start
                conversations with in a rolling 24 hours, as Meta reports it.
              </p>
              <dl className="bl-kv">
                {messaging.qualityRating && (
                  <div><dt>Quality rating</dt><dd>{QUALITY[messaging.qualityRating] || 'Not rated yet'}</dd></div>
                )}
                {messaging.fetchedAt && <div><dt>Checked</dt><dd>{new Date(messaging.fetchedAt).toLocaleString('en-IN')}</dd></div>}
              </dl>
              {messaging.error && (
                <p className="bl-warn">
                  {messaging.stale ? 'Showing the last values Meta gave. ' : ''}Meta said: {messaging.error}
                </p>
              )}
            </>
          ) : (
            <>
              <div className="bl-tier muted" data-testid="billing-tier-value">No WhatsApp number connected</div>
              <p className="bl-text">
                Meta sets a messaging limit once you connect your own WhatsApp number.
                {messaging.sandbox
                  ? ` Until then, up to ${messaging.sandbox.limit} contacts can join your test inbox on the shared test number (${messaging.sandbox.linked} joined).`
                  : ''}
              </p>
            </>
          )}
          {onNavigate && (
            <div className="bl-actions">
              <button type="button" className="bl-btn ghost" onClick={() => onNavigate('channel-status')}>
                <span className="material-icons" aria-hidden="true">speed</span>
                {messaging.connected ? 'View Channel Status' : 'Connect your number'}
              </button>
            </div>
          )}
        </section>
      </div>

      {/* ---- Plans (the landing page's cards) ---- */}
      <section className="bl-card bl-plans" data-testid="billing-plans">
        <div className="bl-card-head">
          <h3>Plans</h3>
          {!paymentsEnabled && <span className="bl-pill trial">Online payment is being set up</span>}
        </div>
        <div className="lp-pricing-banner bl-plans-banner">
          <div className="lp-pricing-banner-text">
            Pay securely with <span className="lp-pricing-banner-link">Razorpay</span> · UPI, cards, net banking, wallets
          </div>
          <CycleToggle value={cycle} onChange={setCycle} />
        </div>
        <PlanCards
          cycle={cycle}
          currentTier={plan.status === 'active' || plan.status === 'legacy' ? plan.tier : undefined}
          action={(p) => <PlanAction plan={p} current={plan} busy={busy || (demo ? 'demo' : '')} onBuy={handleBuy} />}
        />
        {demo && <p className="bl-foot">Payments are switched off in the demo.</p>}
      </section>

      <div className="bl-grid">
        {/* ---- Billing contact ---- */}
        <section className="bl-card" data-testid="billing-contact">
          <div className="bl-card-head"><h3>Billing contact</h3></div>
          <dl className="bl-kv">
            <div><dt>Business name</dt><dd>{contact.name || 'Not set'}</dd></div>
            <div><dt>Email</dt><dd>{contact.email || 'Not set'}</dd></div>
            <div><dt>Phone</dt><dd>{fmtPhone(contact.phone) || 'Not set'}</dd></div>
            <div><dt>Address</dt><dd>{contact.address || 'Not set'}</dd></div>
          </dl>
          <p className="bl-text muted">From your account and business profile. Razorpay receipts go to this email.</p>
          {onEditProfile && !demo && (
            <div className="bl-actions">
              <button type="button" className="bl-btn ghost" onClick={onEditProfile}>
                <span className="material-icons" aria-hidden="true">edit</span>
                Edit business profile
              </button>
            </div>
          )}
        </section>

        {/* ---- Payments ---- */}
        <section className="bl-card" data-testid="billing-payments">
          <div className="bl-card-head"><h3>Payments</h3></div>
          <div className="bl-table-wrap">
            <table className="bl-table">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Plan</th>
                  <th scope="col">Period</th>
                  <th scope="col">Amount</th>
                </tr>
              </thead>
              <tbody>
                {payments.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="bl-empty" data-testid="billing-payments-empty">
                      <span className="material-icons" aria-hidden="true">receipt_long</span>
                      No payments yet.
                    </td>
                  </tr>
                ) : (
                  payments.map((p) => (
                    <tr key={p._id} data-testid="billing-payment-row">
                      <td>{fmtDate(p.paidAt)}</td>
                      <td>
                        {p.name || TIER_NAMES[p.tier]} · {cycleLabel(p.cycle)}
                        <span className="bl-muted">{KIND[p.kind] || ''}{p.method ? ` · ${p.method.toUpperCase()}` : ''}</span>
                      </td>
                      <td>{p.startsAt && p.endsAt ? `${fmtDate(p.startsAt)} – ${fmtDate(p.endsAt)}` : ''}</td>
                      <td>
                        <strong>{rupees(p.amountPaise)}</strong>
                        {p.creditPaise > 0 && <span className="bl-muted">{rupees(p.creditPaise)} credit used</span>}
                        <span className="bl-muted bl-mono" title="Razorpay payment id">{p.paymentId}</span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
