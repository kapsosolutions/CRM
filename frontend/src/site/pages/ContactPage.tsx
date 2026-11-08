// /contact: a message form (POST /api/demo/contact, read in the admin panel)
// beside the phone, WhatsApp and email.
import { useState, type FormEvent } from 'react';
import { PageHero, SALES_PHONE, SALES_TEL, SitePage, WHATSAPP_HREF } from '../SiteChrome';
import { PAGE_META } from '../siteMeta';
import { FormError, siteApi, type ContactForm, type ContactTopic } from '../siteApi';
import { GrievanceBlock } from '../LegalPages';
import { pixelTrack } from '../metaPixel';

const TOPICS: { key: ContactTopic; label: string }[] = [
  { key: 'sales', label: 'Plans & pricing' },
  { key: 'support', label: 'Help with my account' },
  { key: 'api', label: 'API & integrations' },
  { key: 'partnership', label: 'Partnership' },
  { key: 'other', label: 'Something else' },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function initialTopic(): ContactTopic {
  const t = new URLSearchParams(window.location.search).get('topic') || '';
  return (TOPICS.some((x) => x.key === t) ? t : 'sales') as ContactTopic;
}

function validate(f: ContactForm): Record<string, string> {
  const e: Record<string, string> = {};
  if (!f.name.trim()) e.name = 'Enter your name';
  if (!EMAIL_RE.test(f.email.trim())) e.email = 'Enter a valid email';
  const digits = f.phone.replace(/\D/g, '');
  if (digits && (digits.length < 8 || digits.length > 15)) e.phone = 'Enter a valid phone number with country code';
  if (f.message.trim().length < 10) e.message = 'Tell us a little more (at least 10 characters)';
  return e;
}

export function ContactPage() {
  const [form, setForm] = useState<ContactForm>(() => ({
    name: '', email: '', phone: '', company: '', topic: initialTopic(), message: '', page: '/contact', website: '',
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [failure, setFailure] = useState('');
  const set = (k: keyof ContactForm) => (v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: '' }));
  };

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    const e = validate(form);
    setErrors(e);
    setFailure('');
    if (Object.values(e).some(Boolean)) return;
    setBusy(true);
    try {
      await siteApi.contact({ ...form, name: form.name.trim(), email: form.email.trim(), message: form.message.trim() });
      setSent(true);
      pixelTrack('Lead', { content_name: 'Contact form' });
    } catch (err) {
      if (err instanceof FormError && Object.keys(err.fields).length) setErrors(err.fields);
      setFailure(err instanceof Error ? err.message : 'Could not send your message. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const field = (k: 'name' | 'email' | 'phone' | 'company', label: string, type = 'text', auto = '', required = false) => (
    <div className="sx-field">
      <label htmlFor={`ct-${k}`}>{label}{required && <span aria-hidden="true"> *</span>}</label>
      <input
        id={`ct-${k}`}
        name={k}
        type={type}
        autoComplete={auto || undefined}
        value={form[k]}
        onChange={(e) => set(k)(e.target.value)}
        aria-invalid={!!errors[k]}
        aria-describedby={errors[k] ? `ct-${k}-err` : undefined}
        required={required}
        maxLength={k === 'email' ? 160 : 120}
      />
      {errors[k] && <div className="sx-field-err" id={`ct-${k}-err`}>{errors[k]}</div>}
    </div>
  );

  return (
    <SitePage meta={PAGE_META.get('/contact')}>
      {(openDemo) => (
        <>
          <PageHero eyebrow="Contact us" title={<>Talk to <em>our team</em></>} sub="Questions about plans, help with your account, or building on our API: send us a message and we’ll reply by email or WhatsApp." />
          <section className="sx-section sx-contact-section">
            <div className="sx-wrap sx-split sx-contact-split">
              <div className="sx-panel-box">
                {sent ? (
                  <div className="sx-alert ok" role="status" data-testid="contact-sent">
                    <strong>Thanks, {form.name.trim().split(' ')[0]}!</strong> Your message has reached us. We’ll reply to {form.email.trim()} soon.
                  </div>
                ) : (
                  <form className="sx-form" onSubmit={submit} noValidate data-testid="contact-form">
                    {failure && <div className="sx-alert err" role="alert">{failure}</div>}
                    <div className="sx-form-row">
                      {field('name', 'Your name', 'text', 'name', true)}
                      {field('email', 'Work email', 'email', 'email', true)}
                    </div>
                    <div className="sx-form-row">
                      {field('phone', 'Phone / WhatsApp', 'tel', 'tel')}
                      {field('company', 'Business name', 'text', 'organization')}
                    </div>
                    <div className="sx-field">
                      <label htmlFor="ct-topic">What is it about?</label>
                      <select id="ct-topic" name="topic" value={form.topic} onChange={(e) => set('topic')(e.target.value)}>
                        {TOPICS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                      </select>
                    </div>
                    <div className="sx-field">
                      <label htmlFor="ct-message">Message<span aria-hidden="true"> *</span></label>
                      <textarea
                        id="ct-message"
                        name="message"
                        value={form.message}
                        onChange={(e) => set('message')(e.target.value)}
                        aria-invalid={!!errors.message}
                        aria-describedby={errors.message ? 'ct-message-err' : undefined}
                        maxLength={4000}
                        required
                      />
                      {errors.message && <div className="sx-field-err" id="ct-message-err">{errors.message}</div>}
                    </div>
                    <div className="sx-hp" aria-hidden="true">
                      <label htmlFor="ct-website">Website</label>
                      <input id="ct-website" name="website" tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => set('website')(e.target.value)} />
                    </div>
                    <button type="submit" className="sx-btn primary" disabled={busy}>
                      {busy ? 'Sending…' : 'Send message'}
                    </button>
                    <p className="sx-note">We use your details only to answer you. See our <a href="/privacy">Privacy Policy</a>.</p>
                  </form>
                )}
              </div>
              <div>
                <ul className="sx-contact-list">
                  <li>
                    <span className="material-icons" aria-hidden="true">call</span>
                    <div><strong>Call sales</strong><a href={SALES_TEL}>{SALES_PHONE}</a></div>
                  </li>
                  <li>
                    <span className="material-icons" aria-hidden="true">chat</span>
                    <div><strong>WhatsApp</strong><a href={WHATSAPP_HREF} target="_blank" rel="noopener noreferrer">Chat with us on WhatsApp</a></div>
                  </li>
                  <li>
                    <span className="material-icons" aria-hidden="true">mail</span>
                    <div><strong>Support</strong><a href="mailto:support@kapsosolutions.com">support@kapsosolutions.com</a></div>
                  </li>
                  <li>
                    <span className="material-icons" aria-hidden="true">shield</span>
                    <div><strong>Privacy &amp; data</strong><a href="mailto:privacy@kapsosolutions.com">privacy@kapsosolutions.com</a></div>
                  </li>
                </ul>
                <div className="sx-panel-box sx-contact-demo">
                  <h2 className="sx-h3">See it live</h2>
                  <p>Book a free 30-minute demo and we’ll show you the CRM on your own use case.</p>
                  <button type="button" className="sx-btn secondary" onClick={openDemo}>Book a demo</button>
                </div>
                <div className="sx-contact-grievance">
                  <GrievanceBlock />
                </div>
              </div>
            </div>
          </section>
        </>
      )}
    </SitePage>
  );
}
