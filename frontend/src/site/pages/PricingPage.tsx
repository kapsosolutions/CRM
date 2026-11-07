// /pricing: the plan cards (shared with the landing page and the CRM), a
// full comparison built from crm/plans.ts LIMITS, and billing questions.
import { Fragment, useState } from 'react';
import { CtaBand, PageHero, SiteLink, SitePage } from '../SiteChrome';
import { PAGE_META } from '../siteMeta';
import { CycleToggle, MessageChargesLink, PlanCards } from '../../crm/components/PlanCards';
import { BuyNowSvg } from '../../crm/components/TemplateIcons';
import { LIMITS, TIER_NAMES, TIER_ORDER, TRIAL_DAYS, kindsOf, type BillingCycle } from '../../crm/plans';
import type { PlanFeature, PlanTierKey } from '../../crm/types';
import { FaqList, Section } from './parts';

type Cell = boolean | string;
type Row = { label: string; cell: (t: PlanTierKey) => Cell };

const has = (f: PlanFeature) => (t: PlanTierKey) => LIMITS[t].features.includes(f);
const count = (v: number | null, unit = '') => (v === null ? 'Unlimited' : `${v.toLocaleString('en-IN')}${unit}`);

const ROWS: { group: string; rows: Row[] }[] = [
  {
    group: 'WhatsApp CRM',
    rows: [
      { label: 'Team inbox on the official WhatsApp Business API', cell: has('chats') },
      { label: 'Contacts', cell: (t) => count(LIMITS[t].contacts) },
      { label: 'Your own WhatsApp number', cell: () => true },
      { label: 'Free service messages from Meta', cell: () => '1,000 a month' },
    ],
  },
  {
    group: 'Templates',
    rows: [
      { label: 'Message templates', cell: (t) => count(LIMITS[t].templates) },
      { label: 'Standard templates (text, media, buttons)', cell: (t) => kindsOf(LIMITS[t]).includes('standard') },
      { label: 'Carousel templates', cell: (t) => kindsOf(LIMITS[t]).includes('carousel') },
      { label: 'Limited-time offer templates', cell: (t) => kindsOf(LIMITS[t]).includes('lto') },
      { label: 'Authentication (OTP) templates', cell: (t) => LIMITS[t].authTemplates },
    ],
  },
  {
    group: 'Campaigns',
    rows: [
      { label: 'Campaigns a month (broadcast & drip)', cell: (t) => count(LIMITS[t].campaignsPerMonth) },
      { label: 'Sending speed', cell: (t) => `${LIMITS[t].sendRate} messages / second` },
    ],
  },
  {
    group: 'Automation',
    rows: [
      { label: 'Journeys & keyword replies (chatbot)', cell: has('journeys') },
      { label: 'WhatsApp Flows (native forms)', cell: has('flows') },
    ],
  },
  {
    group: 'In the chat',
    rows: [
      { label: 'WhatsApp calls', cell: has('calls') },
      { label: 'Polls', cell: has('polls') },
      { label: 'Events', cell: has('events') },
    ],
  },
  {
    group: 'Sell & book',
    rows: [
      { label: 'Catalog & categories', cell: has('catalog') },
      { label: 'Offers', cell: has('offers') },
      { label: 'Members (doctors, stylists, rooms…) & their slots', cell: has('members') },
      { label: 'Orders & appointments (bookings)', cell: has('orders') },
      { label: 'WhatsApp Pay configuration', cell: has('payment-config') },
    ],
  },
  {
    group: 'Channels & ads',
    rows: [
      { label: 'Instagram & Messenger', cell: has('instagram') },
      { label: 'Click-to-WhatsApp ads & lead forms', cell: has('ads') },
      { label: 'Create: Facebook & Instagram posts', cell: has('create') },
    ],
  },
  {
    group: 'Developers',
    rows: [
      { label: 'API keys: messaging, OTP, catalog & members', cell: has('api') },
      { label: 'Bookings API (book & cancel slots)', cell: (t) => has('api')(t) && has('orders')(t) },
      { label: 'Website keys for your web pages', cell: has('api') },
    ],
  },
  {
    group: 'Support',
    rows: [
      { label: 'Help by WhatsApp, phone and email', cell: () => true },
      { label: 'Priority support', cell: (t) => t === 'premium' },
    ],
  },
];

function CellView({ v }: { v: Cell }) {
  if (v === true) return <span className="yes" aria-label="Included">✓</span>;
  if (v === false) return <span className="no" aria-label="Not included">—</span>;
  return <>{v}</>;
}

const FAQS = [
  { q: 'Is there a free trial?', a: `Yes. Every new account gets ${TRIAL_DAYS} days with every feature of every plan. No card is needed to start.` },
  { q: 'What happens when the trial ends?', a: 'Your data is kept. Without a plan, only the Starter features stay open; the rest unlock again when you buy a plan that includes them.' },
  { q: 'Do plans renew automatically?', a: 'No. You pay for a month, a quarter or a year in advance, and we never charge you again on our own. Renew before the period ends to continue without a break.' },
  { q: 'How do I pay?', a: 'Online through Razorpay: UPI, cards, net banking and wallets. The price shown at checkout is what you pay.' },
  { q: 'Are WhatsApp message charges included?', a: 'No. Meta charges each delivered message directly to your WhatsApp account, at its published rate for the category (marketing, utility, authentication or service). Every number gets 1,000 free service messages a month. See our WhatsApp pricing guide for the rates.' },
  { q: 'Is there a setup fee?', a: 'No. Connecting your WhatsApp number to the official API through Meta’s signup is free.' },
  { q: 'Can I change my plan?', a: 'You can upgrade at any time. A lower plan can be bought once your current paid period has ended.' },
  { q: 'Can I get a refund?', a: 'See our Refund and Cancellation Policy for when refunds apply.' },
];

export function PricingPage() {
  const [cycle, setCycle] = useState<BillingCycle>('quarterly');
  return (
    <SitePage meta={PAGE_META.get('/pricing')}>
      {(openDemo) => (
        <>
          <PageHero
            eyebrow="Pricing"
            title={<>Simple plans, <em>no setup fee</em></>}
            sub={`Plans from ₹499 a month on the official WhatsApp Business API, with unlimited contacts on every plan. Start with a ${TRIAL_DAYS}-day free trial of every feature.`}
          />
          <section className="lp-pricing-section sx-pricing" id="plans">
            <div className="lp-pricing-container">
              <div className="lp-pricing-banner">
                <div className="lp-pricing-banner-text">
                  Every plan starts with a <span className="lp-pricing-banner-link">{TRIAL_DAYS}-day free trial</span> of every feature · up to ~25% off with annual billing
                </div>
                <CycleToggle value={cycle} onChange={setCycle} />
              </div>
              <PlanCards
                cycle={cycle}
                action={(plan) => (
                  <>
                    <a href="/#/register" className="lp-plan-try-btn" style={{ backgroundColor: plan.buttonColor }}>
                      Start {TRIAL_DAYS}-day free trial
                    </a>
                    <a href="/#/register" className="lp-plan-buy-link">
                      <BuyNowSvg width={16} height={16} stroke="currentColor" />
                      <span>Buy now</span>
                    </a>
                  </>
                )}
              />
              <div className="sx-pricing-charges">
                Prices are per month. Meta’s WhatsApp message charges are separate. <MessageChargesLink />
              </div>
            </div>
          </section>

          <Section title="Compare plans" sub="Everything each plan includes." id="compare">
            <div className="sx-table-wrap">
              <table className="sx-table sx-compare" data-testid="pricing-compare">
                <thead>
                  <tr>
                    <th scope="col">Feature</th>
                    {TIER_ORDER.map((t) => <th key={t} scope="col" className="c">{TIER_NAMES[t]}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {ROWS.map((g) => (
                    <Fragment key={g.group}>
                      <tr className="grp"><td colSpan={TIER_ORDER.length + 1}>{g.group}</td></tr>
                      {g.rows.map((r) => (
                        <tr key={r.label}>
                          <th scope="row">{r.label}</th>
                          {TIER_ORDER.map((t) => <td key={t} className="c"><CellView v={r.cell(t)} /></td>)}
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section title="Billing questions" tint center>
            <FaqList items={FAQS} />
            <p className="sx-note sx-center">
              More in the <SiteLink href="/help">Help center</SiteLink>, the <SiteLink href="/resources/whatsapp-pricing">WhatsApp pricing guide</SiteLink> and
              our <SiteLink href="/refund">Refund and Cancellation Policy</SiteLink>.
            </p>
          </Section>

          <CtaBand onDemo={openDemo} title="Try every feature free for 7 days" />
        </>
      )}
    </SitePage>
  );
}
