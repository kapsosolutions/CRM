// /resources/whatsapp-templates (template examples) and
// /resources/whatsapp-pricing (how Meta charges, explained).
import { Fragment, useState } from 'react';
import { CtaBand, PageHero, SiteLink, SitePage } from '../SiteChrome';
import { PAGE_META } from '../siteMeta';
import { META_RATES, inrRate } from '../content/metaRates';
import { FaqList, FeatureGrid, Section } from './parts';

type Cat = 'marketing' | 'utility' | 'authentication';
interface Example {
  name: string;
  category: Cat;
  use: string;
  header?: string;
  body: string;
  footer?: string;
  buttons?: string[];
}

const EXAMPLES: Example[] = [
  { name: 'welcome_offer', category: 'marketing', use: 'Welcome a new subscriber', header: '🎉 Welcome to {{1}}', body: 'Hi {{1}}, thanks for joining us! Here’s 10% off your first order with code WELCOME10. Valid till {{2}}.', footer: 'Reply STOP to opt out', buttons: ['Shop now', 'Stop promotions'] },
  { name: 'festive_sale', category: 'marketing', use: 'A festival or season sale', header: '[Image]', body: 'Hi {{1}}, our Diwali sale is live! Up to 40% off on {{2}}. Only till Sunday.', buttons: ['View offers'] },
  { name: 'cart_reminder', category: 'marketing', use: 'Bring back an abandoned cart', body: 'Hi {{1}}, you left {{2}} in your cart. It’s still waiting for you, and delivery is free today.', buttons: ['Complete my order'] },
  { name: 'back_in_stock', category: 'marketing', use: 'Tell people a product is back', header: '[Image]', body: 'Good news, {{1}}! {{2}} is back in stock. Sizes go fast, so grab yours now.', buttons: ['Buy now'] },
  { name: 'order_confirmed', category: 'utility', use: 'Confirm an order', body: 'Hi {{1}}, your order {{2}} for {{3}} is confirmed. We’ll message you when it ships.', buttons: ['Track order'] },
  { name: 'order_shipped', category: 'utility', use: 'Shipping update', body: 'Your order {{1}} has shipped with {{2}}. Tracking number: {{3}}. Expected by {{4}}.', buttons: ['Track shipment'] },
  { name: 'payment_received', category: 'utility', use: 'Payment receipt', body: 'We received your payment of {{1}} for {{2}}. Thank you, {{3}}!', footer: 'Keep this message as your receipt' },
  { name: 'appointment_reminder', category: 'utility', use: 'Remind about a booking', body: 'Reminder: your appointment with {{1}} is on {{2}} at {{3}}. Reply 1 to confirm or 2 to reschedule.', buttons: ['Confirm', 'Reschedule'] },
  { name: 'booking_confirmed', category: 'utility', use: 'Confirm a booking', body: 'Hi {{1}}, your booking for {{2}} on {{3}} at {{4}} is confirmed. Booking id: {{5}}.', buttons: ['Get directions'] },
  { name: 'payment_due', category: 'utility', use: 'An upcoming payment', body: 'Hi {{1}}, your payment of {{2}} for {{3}} is due on {{4}}.', buttons: ['Pay now'] },
  { name: 'login_code', category: 'authentication', use: 'Sign-in or verification code', body: '{{1}} is your verification code. For your security, do not share this code.', footer: 'This code expires in 10 minutes.', buttons: ['Copy code'] },
];

const CATS: { key: Cat | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'marketing', label: 'Marketing' },
  { key: 'utility', label: 'Utility' },
  { key: 'authentication', label: 'Authentication' },
];

/** The body with {{n}} variables highlighted. */
function Body({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\{\{\d+\}\})/g).map((p, i) => (/^\{\{\d+\}\}$/.test(p) ? <mark key={i} className="sx-var">{p}</mark> : <Fragment key={i}>{p}</Fragment>))}
    </>
  );
}

const TIPS = [
  { icon: 'category', title: 'Pick the right category', text: 'Order, booking and payment updates the customer expects are Utility. Offers, news and anything promotional is Marketing. Meta re-labels templates in the wrong category.' },
  { icon: 'data_object', title: 'Keep variables in a sentence', text: 'Don’t start or end the message with a variable, or put two side by side. Give Meta a realistic sample for each.' },
  { icon: 'block', title: 'Let people opt out', text: 'Marketing templates with a “Stop promotions” button get fewer blocks and reports, which protects your number’s quality.' },
  { icon: 'spellcheck', title: 'Be clear and short', text: 'Say who you are and why you’re writing in the first line. Avoid all capitals, long links and lots of emojis.' },
];

export function TemplatesLibraryPage() {
  const [cat, setCat] = useState<Cat | 'all'>('all');
  const shown = EXAMPLES.filter((e) => cat === 'all' || e.category === cat);
  return (
    <SitePage meta={PAGE_META.get('/resources/whatsapp-templates')}>
      {(openDemo) => (
        <>
          <PageHero
            eyebrow="Resources"
            title={<>WhatsApp template <em>examples</em></>}
            sub="Start from these. Copy one into Templates in the CRM, change the words to yours and send it to Meta for approval, usually done in minutes."
          />
          <Section>
            <div className="sx-tabs sx-template-tabs" role="tablist" aria-label="Template category">
              {CATS.map((c) => (
                <button key={c.key} type="button" role="tab" aria-selected={cat === c.key} className={`sx-tab${cat === c.key ? ' on' : ''}`} onClick={() => setCat(c.key)}>
                  {c.label}
                </button>
              ))}
            </div>
            <div className="sx-grid sx-template-grid">
              {shown.map((e) => (
                <div key={e.name} className="sx-template" data-testid={`tpl-${e.name}`}>
                  <span className={`sx-template-tag ${e.category}`}>{e.category}</span>
                  <div className="sx-template-name"><code>{e.name}</code> · {e.use}</div>
                  <div className="sx-template-bubble">
                    {e.header && <div className="sx-template-header">{e.header === '[Image]' ? <span className="sx-template-media"><span className="material-icons" aria-hidden="true">image</span>Image</span> : <Body text={e.header} />}</div>}
                    <div><Body text={e.body} /></div>
                    {e.footer && <div className="sx-template-footer">{e.footer}</div>}
                  </div>
                  {e.buttons && (
                    <div className="sx-template-buttons">
                      {e.buttons.map((b) => <span key={b}>{b}</span>)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Section>
          <Section title="Tips for fast approval" tint>
            <FeatureGrid items={TIPS} />
          </Section>
          <Section center>
            <p className="sx-sub">
              Send them from the CRM as <SiteLink href="/product/broadcast">campaigns</SiteLink>, automatically as <SiteLink href="/product/notifications">notifications</SiteLink>,
              or from your own code with the <SiteLink href="/developers/messaging">Messaging API</SiteLink>.
            </p>
          </Section>
          <CtaBand onDemo={openDemo} title="Create your first template" />
        </>
      )}
    </SitePage>
  );
}

const CATEGORY_ROWS: { name: string; what: string; examples: string; rate: number | null }[] = [
  { name: 'Marketing', what: 'Promotions and anything that isn’t a reply or an update the customer expects.', examples: 'Offers, sales, new products, cart reminders, newsletters', rate: META_RATES.marketing },
  { name: 'Utility', what: 'Updates about something the customer did or asked for.', examples: 'Order and shipping updates, receipts, booking confirmations, reminders', rate: META_RATES.utility },
  { name: 'Authentication', what: 'One-time codes to sign in or verify.', examples: 'Login codes, account verification, payment confirmation codes', rate: META_RATES.authentication },
  { name: 'Service', what: 'Your free-form replies while the 24-hour window is open.', examples: 'Answering questions in the inbox', rate: META_RATES.service },
];

const GUIDE_FAQS = [
  { q: 'Who do I pay for messages?', a: 'Meta. It bills your own WhatsApp Business account, through the payment method you add in Meta Business Suite (billing). Your Kapso plan doesn’t include message charges and we add nothing on top.' },
  { q: 'What is the 24-hour window?', a: 'When a customer messages you, you can reply with any message for 24 hours. Outside it, you can only start a conversation with an approved template.' },
  { q: 'Do I need a payment method on Meta?', a: 'Yes. Since 1 October 2026 Meta charges service messages beyond the free 1,000, and it stops delivering them for accounts with no payment method.' },
  { q: 'Do rates change?', a: 'Meta updates its rate card a few times a year. Its official pricing page always has the current rates.' },
];

export function PricingGuidePage() {
  const r = META_RATES;
  return (
    <SitePage meta={PAGE_META.get('/resources/whatsapp-pricing')}>
      {(openDemo) => (
        <>
          <PageHero
            eyebrow="Resources"
            title={<>WhatsApp Business API pricing, <em>explained</em></>}
            sub="Meta charges per message it delivers. The rate depends on the message’s category and the country of the person receiving it. Here’s how it works for numbers in India."
          />
          <Section title="The four kinds of message" sub={`Meta’s rates for India as of ${r.asOf}, per delivered message, before ${Math.round(r.gst * 100)}% GST.`}>
            <div className="sx-table-wrap">
              <table className="sx-table" data-testid="meta-rates">
                <thead>
                  <tr><th scope="col">Category</th><th scope="col">What it is</th><th scope="col">Examples</th><th scope="col" className="c">Rate (India)</th></tr>
                </thead>
                <tbody>
                  {CATEGORY_ROWS.map((c) => (
                    <tr key={c.name}>
                      <th scope="row">{c.name}</th>
                      <td>{c.what}</td>
                      <td>{c.examples}</td>
                      <td className="c">
                        {c.rate !== null ? inrRate(c.rate) : '—'}
                        {c.name === 'Service' && <div className="sx-note">after {r.freeService.toLocaleString('en-IN')} free a month</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="sx-note">
              Source: <a href={r.source} target="_blank" rel="noopener noreferrer">Meta’s WhatsApp Business Platform pricing</a>. Messages to other countries use that country’s rate.
              Utility and authentication rates get lower at high monthly volumes (Meta’s volume tiers).
            </p>
          </Section>

          <Section title="When messages are free" tint>
            <FeatureGrid
              items={[
                { icon: 'redeem', title: `${r.freeService.toLocaleString('en-IN')} free service messages`, text: 'Every WhatsApp number gets 1,000 free service messages (replies inside the 24-hour window) each month. They reset on the 1st.' },
                { icon: 'ads_click', title: 'After a Click-to-WhatsApp ad', text: 'When someone messages you from an ad and you reply within 24 hours, every message for the next 72 hours is free, templates included.' },
                { icon: 'error_outline', title: 'Undelivered messages', text: 'Meta charges only for delivered messages. A message that fails isn’t charged.' },
              ]}
            />
          </Section>

          <Section title="Ways to spend less">
            <FeatureGrid
              items={[
                { icon: 'category', title: 'Use the right category', text: 'Updates the customer expects are utility messages, which cost a fraction of marketing ones.' },
                { icon: 'forum', title: 'Reply while the window is open', text: 'Answer in the inbox within 24 hours instead of sending a template later.' },
                { icon: 'group', title: 'Send to the right people', text: 'Smaller, relevant lists get more replies and fewer blocks, and every reply opens a new 24-hour window.' },
                { icon: 'calculate', title: 'Estimate first', text: 'Use our cost calculator to see a month’s messages and plan together.' },
              ]}
            />
            <div className="sx-cta-row sx-center-row">
              <SiteLink className="sx-btn primary" href="/tools/whatsapp-pricing-calculator">Open the cost calculator →</SiteLink>
              <SiteLink className="sx-btn secondary" href="/pricing">See Kapso plans</SiteLink>
            </div>
          </Section>

          <Section title="Questions" center tint>
            <FaqList items={GUIDE_FAQS} />
          </Section>
          <CtaBand onDemo={openDemo} />
        </>
      )}
    </SitePage>
  );
}
