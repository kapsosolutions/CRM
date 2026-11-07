// /tools/<slug>: free WhatsApp tools. Everything runs in the visitor's
// browser; nothing they type is sent to us.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import QRCode from 'qrcode';
import { CtaBand, SiteLink, SitePage } from '../SiteChrome';
import { PAGE_META, TOOL_DESC, TOOL_SLUGS, TOOL_TITLE, type ToolSlug } from '../siteMeta';
import { META_RATES, inrRate } from '../content/metaRates';
import { PRICES, TIER_NAMES, TIER_ORDER, BILLING_CYCLES, type BillingCycle } from '../../crm/plans';
import type { PlanTierKey } from '../../crm/types';
import { CodeBlock, Crumbs, Steps } from './parts';
import { NotFoundPage } from './NotFoundPage';

// ------------------------------------------------------------- helpers

/** Digits of a WhatsApp number; a 10-digit Indian mobile gets +91. */
function waDigits(raw: string): string {
  let d = raw.replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 10 && /^[6-9]/.test(d)) d = `91${d}`;
  return d;
}
const validWa = (d: string) => /^\d{8,15}$/.test(d);
function waLink(digits: string, message: string): string {
  const text = message.trim();
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}
const escHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const HEX = /^#[0-9a-f]{6}$/i;

// simple-icons "whatsapp" (CC0).
const WA_PATH = 'M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z';

function useCopy(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  return [copied, (text: string) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  }];
}

function PhoneInput({ value, onChange, digits }: { value: string; onChange: (v: string) => void; digits: string }) {
  const bad = value.trim() !== '' && !validWa(digits);
  return (
    <div className="sx-field">
      <label htmlFor="tool-phone">Your WhatsApp number</label>
      <input id="tool-phone" type="tel" inputMode="tel" placeholder="+91 98765 43210" value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={bad} data-testid="tool-phone" />
      {bad ? <div className="sx-field-err">Enter the number with its country code, e.g. +91 98765 43210.</div> : <div className="sx-note">With country code. A 10-digit Indian mobile number gets +91 added.</div>}
    </div>
  );
}

function MessageInput({ value, onChange, label = 'Ready message (optional)' }: { value: string; onChange: (v: string) => void; label?: string }) {
  return (
    <div className="sx-field">
      <label htmlFor="tool-msg">{label}</label>
      <textarea id="tool-msg" value={value} onChange={(e) => onChange(e.target.value)} maxLength={1000} placeholder="Hi! I’d like to know more about…" data-testid="tool-msg" />
    </div>
  );
}

function ToolLayout({ slug, intro, steps, children }: { slug: ToolSlug; intro: string; steps: { title: string; text: string }[]; children: ReactNode }) {
  const others = TOOL_SLUGS.filter((s) => s !== slug);
  return (
    <SitePage meta={PAGE_META.get(`/tools/${slug}`)}>
      {(openDemo) => (
        <>
          <section className="sx-hero left sx-tool-hero">
            <div className="sx-wrap">
              <Crumbs items={[{ href: '/', label: 'Home' }, { label: 'Free tools' }, { label: TOOL_TITLE(slug).replace(/^Free /, '') }]} />
              <div className="sx-eyebrow">Free tool · no sign-up</div>
              <h1 className="sx-h1">{TOOL_TITLE(slug)}</h1>
              <p className="sx-lead">{intro}</p>
            </div>
          </section>
          <section className="sx-section sx-tool-section">
            <div className="sx-wrap">{children}</div>
          </section>
          <section className="sx-section tint">
            <div className="sx-wrap">
              <h2 className="sx-h2">How to use it</h2>
              <Steps items={steps} />
            </div>
          </section>
          <section className="sx-section">
            <div className="sx-wrap">
              <h2 className="sx-h2">More free tools</h2>
              <div className="sx-grid">
                {others.map((o) => (
                  <SiteLink key={o} href={`/tools/${o}`} className="sx-card">
                    <h3>{TOOL_TITLE(o)}</h3>
                    <p>{TOOL_DESC(o)}</p>
                    <span className="sx-card-more">Open →</span>
                  </SiteLink>
                ))}
              </div>
            </div>
          </section>
          <CtaBand onDemo={openDemo} title="Ready for more than a link?" sub="Answer every chat from a team inbox, automate replies and send campaigns. Free for 7 days." />
        </>
      )}
    </SitePage>
  );
}

// ------------------------------------------------------------- the tools

function LinkGenerator() {
  const [phone, setPhone] = useState('');
  const [msg, setMsg] = useState('');
  const [copied, copy] = useCopy();
  const digits = waDigits(phone);
  const ok = validWa(digits);
  const link = ok ? waLink(digits, msg) : '';
  return (
    <ToolLayout
      slug="whatsapp-link-generator"
      intro="Make a link that opens a WhatsApp chat with you, with your message already typed. Put it on your website, Instagram bio, emails or ads."
      steps={[
        { title: 'Enter your number', text: 'The WhatsApp number customers should reach, with its country code.' },
        { title: 'Add a message', text: 'Optional: the text that appears ready to send, like “Hi, I saw your ad”.' },
        { title: 'Copy and share', text: 'Paste the link anywhere. Anyone who taps it lands in a chat with you.' },
      ]}
    >
      <div className="sx-tool">
        <div className="sx-panel-box sx-form">
          <PhoneInput value={phone} onChange={setPhone} digits={digits} />
          <MessageInput value={msg} onChange={setMsg} />
        </div>
        <div className="sx-result" aria-live="polite">
          <strong>Your link</strong>
          {link ? (
            <>
              <code className="sx-result-link" data-testid="tool-link">{link}</code>
              <div className="sx-cta-row">
                <button type="button" className="sx-btn primary" onClick={() => copy(link)}>{copied ? 'Copied' : 'Copy link'}</button>
                <a className="sx-btn secondary" href={link} target="_blank" rel="noopener noreferrer">Test it</a>
              </div>
            </>
          ) : (
            <p className="sx-note">Enter your number to make the link.</p>
          )}
        </div>
      </div>
    </ToolLayout>
  );
}

function QrTool() {
  const [phone, setPhone] = useState('');
  const [msg, setMsg] = useState('');
  const [png, setPng] = useState('');
  const digits = waDigits(phone);
  const ok = validWa(digits);
  const link = ok ? waLink(digits, msg) : '';
  useEffect(() => {
    let live = true;
    if (!link) {
      setPng('');
      return undefined;
    }
    QRCode.toDataURL(link, { width: 640, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#0f172a', light: '#ffffff' } })
      .then((url) => { if (live) setPng(url); })
      .catch(() => { if (live) setPng(''); });
    return () => { live = false; };
  }, [link]);
  return (
    <ToolLayout
      slug="whatsapp-qr-code"
      intro="Make a QR code that opens a WhatsApp chat with your business. Print it on your counter, menu, packaging or visiting card."
      steps={[
        { title: 'Enter your number', text: 'With its country code, and a ready message if you like.' },
        { title: 'Download the QR code', text: 'Save it as a PNG image, big enough to print sharply.' },
        { title: 'Print it', text: 'Customers scan it with their phone camera and a chat with you opens.' },
      ]}
    >
      <div className="sx-tool">
        <div className="sx-panel-box sx-form">
          <PhoneInput value={phone} onChange={setPhone} digits={digits} />
          <MessageInput value={msg} onChange={setMsg} />
        </div>
        <div className="sx-result" aria-live="polite">
          <strong>Your QR code</strong>
          {png ? (
            <>
              <img src={png} alt={`QR code that opens a WhatsApp chat with +${digits}`} data-testid="tool-qr" />
              <div className="sx-cta-row">
                <a className="sx-btn primary" href={png} download={`whatsapp-qr-${digits}.png`}>Download PNG</a>
              </div>
              <p className="sx-note">Opens: {link}</p>
            </>
          ) : (
            <p className="sx-note">Enter your number to make the QR code.</p>
          )}
        </div>
      </div>
    </ToolLayout>
  );
}

function ChatButtonTool() {
  const [phone, setPhone] = useState('');
  const [msg, setMsg] = useState('Hi! I have a question.');
  const [label, setLabel] = useState('Chat with us');
  const [color, setColor] = useState('#25D366');
  const [side, setSide] = useState<'right' | 'left'>('right');
  const [copied, copy] = useCopy();
  const digits = waDigits(phone);
  const ok = validWa(digits);
  const safeColor = HEX.test(color) ? color : '#25D366';
  const text = label.trim().slice(0, 40);
  const link = ok ? waLink(digits, msg) : '';
  const code = useMemo(() => {
    if (!link) return '';
    const style = [
      'position:fixed', 'bottom:20px', `${side}:20px`, 'z-index:9999', 'display:flex', 'align-items:center', 'gap:8px',
      `padding:${text ? '12px 18px' : '14px'}`, 'border-radius:999px', `background:${safeColor}`, 'color:#fff',
      'font:600 15px/1 system-ui,-apple-system,Segoe UI,Roboto,sans-serif', 'text-decoration:none', 'box-shadow:0 6px 18px rgba(0,0,0,.18)',
    ].join(';');
    return [
      '<!-- WhatsApp chat button (kapsosolutions.com/tools/whatsapp-chat-button) -->',
      `<a href="${escHtml(link)}" target="_blank" rel="noopener" aria-label="Chat with us on WhatsApp" style="${style}">`,
      `  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${WA_PATH}"/></svg>`,
      ...(text ? [`  ${escHtml(text)}`] : []),
      '</a>',
    ].join('\n');
  }, [link, side, text, safeColor]);
  return (
    <ToolLayout
      slug="whatsapp-chat-button"
      intro="Add a floating WhatsApp button to your website so visitors can chat with you in one tap. Choose the text and colour, then copy one piece of HTML."
      steps={[
        { title: 'Set it up', text: 'Your number, a ready message, the button text, colour and side of the page.' },
        { title: 'Copy the code', text: 'One small piece of HTML, with no scripts and nothing loaded from other sites.' },
        { title: 'Paste it in your site', text: 'Just before </body>, or in a “custom HTML” block in WordPress, Wix, Shopify and others.' },
      ]}
    >
      <div className="sx-tool">
        <div className="sx-panel-box sx-form">
          <PhoneInput value={phone} onChange={setPhone} digits={digits} />
          <MessageInput value={msg} onChange={setMsg} />
          <div className="sx-form-row">
            <div className="sx-field">
              <label htmlFor="tool-label">Button text</label>
              <input id="tool-label" value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} placeholder="Leave empty for an icon only" />
            </div>
            <div className="sx-field">
              <label htmlFor="tool-color">Colour</label>
              <input id="tool-color" type="color" value={safeColor} onChange={(e) => setColor(e.target.value)} />
            </div>
          </div>
          <div className="sx-field">
            <span className="sx-label">Side of the page</span>
            <div className="sx-tabs" role="radiogroup" aria-label="Side of the page">
              {(['right', 'left'] as const).map((s) => (
                <button key={s} type="button" role="radio" aria-checked={side === s} className={`sx-tab${side === s ? ' on' : ''}`} onClick={() => setSide(s)}>
                  {s === 'right' ? 'Bottom right' : 'Bottom left'}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="sx-result" aria-live="polite">
          <strong>Preview</strong>
          <div className="sx-browser" aria-hidden="true">
            <div className="sx-browser-bar"><span /><span /><span /></div>
            <div className="sx-browser-page">
              <span className={`sx-wa-preview ${side}${text ? '' : ' icon-only'}`} style={{ background: safeColor }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d={WA_PATH} /></svg>
                {text}
              </span>
            </div>
          </div>
          {code ? (
            <>
              <CodeBlock code={code} label="Chat button HTML" />
              <button type="button" className="sx-btn primary" onClick={() => copy(code)} data-testid="tool-copy-code">{copied ? 'Copied' : 'Copy code'}</button>
            </>
          ) : (
            <p className="sx-note">Enter your number to get the code.</p>
          )}
        </div>
      </div>
    </ToolLayout>
  );
}

function CostCalculator() {
  const [n, setN] = useState({ marketing: 2000, utility: 1000, authentication: 0, service: 1500 });
  const [tier, setTier] = useState<PlanTierKey>('basic');
  const [cycle, setCycle] = useState<BillingCycle>('monthly');
  const r = META_RATES;
  const num = (v: number) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
  const paidService = Math.max(0, num(n.service) - r.freeService);
  const meta = num(n.marketing) * r.marketing + num(n.utility) * r.utility + num(n.authentication) * r.authentication + paidService * r.service;
  const gst = meta * r.gst;
  const plan = PRICES[tier][cycle];
  const total = meta + gst + plan;
  const money = (v: number) => `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
  const row = (k: keyof typeof n, label: string, rate: number, hint?: string) => (
    <div className="sx-field">
      <label htmlFor={`calc-${k}`}>{label} <span className="sx-note">({inrRate(rate)} each{hint ? `, ${hint}` : ''})</span></label>
      <input
        id={`calc-${k}`}
        type="number"
        min={0}
        step={100}
        inputMode="numeric"
        value={n[k]}
        onChange={(e) => setN((x) => ({ ...x, [k]: Number(e.target.value) }))}
        data-testid={`calc-${k}`}
      />
    </div>
  );
  return (
    <ToolLayout
      slug="whatsapp-pricing-calculator"
      intro="Estimate a month on the WhatsApp Business API: Meta’s message charges for India plus your Kapso plan."
      steps={[
        { title: 'Enter your messages', text: 'Roughly how many of each kind you send in a month.' },
        { title: 'Pick a plan', text: 'And how you’d pay for it: monthly, quarterly or yearly.' },
        { title: 'See the total', text: 'Meta’s charges with GST, your plan, and the sum.' },
      ]}
    >
      <div className="sx-tool">
        <div className="sx-panel-box sx-form">
          {row('marketing', 'Marketing messages a month', r.marketing)}
          {row('utility', 'Utility messages a month', r.utility)}
          {row('authentication', 'Authentication (OTP) messages a month', r.authentication)}
          {row('service', 'Service replies a month', r.service, `first ${r.freeService.toLocaleString('en-IN')} free`)}
          <div className="sx-form-row">
            <div className="sx-field">
              <label htmlFor="calc-plan">Kapso plan</label>
              <select id="calc-plan" value={tier} onChange={(e) => setTier(e.target.value as PlanTierKey)}>
                {TIER_ORDER.map((t) => <option key={t} value={t}>{TIER_NAMES[t]}</option>)}
              </select>
            </div>
            <div className="sx-field">
              <label htmlFor="calc-cycle">Billing</label>
              <select id="calc-cycle" value={cycle} onChange={(e) => setCycle(e.target.value as BillingCycle)}>
                {BILLING_CYCLES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </div>
          </div>
        </div>
        <div className="sx-result" aria-live="polite">
          <strong>Estimated cost a month</strong>
          <div className="sx-big-number" data-testid="calc-total">{money(total)}</div>
          <table className="sx-table sx-calc-table">
            <tbody>
              <tr><td>Meta message charges</td><td className="c">{money(meta)}</td></tr>
              <tr><td>GST on Meta charges ({Math.round(r.gst * 100)}%)</td><td className="c">{money(gst)}</td></tr>
              <tr><td>{TIER_NAMES[tier]} plan ({BILLING_CYCLES.find((c) => c.key === cycle)?.label.toLowerCase()}, per month)</td><td className="c">{money(plan)}</td></tr>
            </tbody>
          </table>
          <p className="sx-note">
            An estimate with Meta’s India rates as of {r.asOf}, before any volume discounts. Meta bills its charges to your WhatsApp account; the plan is paid to us.
            Rates: <a href={r.source} target="_blank" rel="noopener noreferrer">Meta’s pricing page</a>. <SiteLink href="/resources/whatsapp-pricing">How pricing works</SiteLink>.
          </p>
        </div>
      </div>
    </ToolLayout>
  );
}

export function ToolPage({ slug }: { slug: string }) {
  if (slug === 'whatsapp-link-generator') return <LinkGenerator />;
  if (slug === 'whatsapp-qr-code') return <QrTool />;
  if (slug === 'whatsapp-chat-button') return <ChatButtonTool />;
  if (slug === 'whatsapp-pricing-calculator') return <CostCalculator />;
  return <NotFoundPage />;
}
