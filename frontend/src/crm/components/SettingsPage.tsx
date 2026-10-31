// Settings: what a business sets itself after connecting WhatsApp.
// Embedded Signup brings the number, WABA and token, but not the Meta catalog
// or the WhatsApp Pay payment configuration — those are entered here.
import { useEffect, useMemo, useState } from 'react';
import type { CrmApi } from '../api';
import type { BusinessProfile, BusinessSettings, PaymentSettings } from '../types';
import type { CrmView } from './NavRail';
import { Dropdown } from './Dropdown';
import { ConnectWhatsAppButton } from './ConnectWhatsApp';
import { useNotify } from './Dialogs';
import { WhatsAppProfileEditor } from './WhatsAppProfileEditor';
import './Settings.css';

interface Props {
  api: CrmApi;
  demo?: boolean;
  business?: BusinessProfile;
  /** Called after WhatsApp is (re)connected from this page. */
  onConnected: (b: BusinessProfile) => void;
  onNavigate?: (view: CrmView) => void;
}

const GATEWAYS = [
  { value: 'razorpay', label: 'Razorpay' },
  { value: 'payu', label: 'PayU' },
  { value: 'upi_vpa', label: 'UPI (VPA)' },
];

const BLANK_PAY: PaymentSettings = {
  enabled: false,
  configName: '',
  gatewayType: 'razorpay',
  merchantName: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  zoneCode: '',
  postalCode: '',
  countryCode: 'IN',
  countryOfOrigin: 'India',
};

function Text({
  label, value, onChange, placeholder, hint, mono, inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
  mono?: boolean;
  inputMode?: 'numeric' | 'text';
}) {
  const id = `st-${label.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <div className="k-field">
      <label className="k-label" htmlFor={id}>{label}</label>
      <input
        id={id}
        className={`k-input${mono ? ' st-mono' : ''}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        aria-describedby={hint ? `${id}-hint` : undefined}
      />
      {hint && <small id={`${id}-hint`} className="st-hint">{hint}</small>}
    </div>
  );
}

export function SettingsPage({ api, demo = false, business, onConnected, onNavigate }: Props) {
  const notify = useNotify();
  const [saved, setSaved] = useState<BusinessSettings | null>(null);
  const [catalogId, setCatalogId] = useState('');
  const [pay, setPay] = useState<PaymentSettings>(BLANK_PAY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function apply(s: BusinessSettings) {
    setSaved(s);
    setCatalogId(s.catalogId || '');
    setPay({ ...BLANK_PAY, ...s.payment });
  }

  useEffect(() => {
    api
      .getSettings()
      .then((r) => apply(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load settings.'));
  }, [api]);

  const dirty = useMemo(() => {
    if (!saved) return false;
    return catalogId.trim() !== (saved.catalogId || '')
      || JSON.stringify({ ...BLANK_PAY, ...saved.payment }) !== JSON.stringify(pay);
  }, [saved, catalogId, pay]);

  const setP = (patch: Partial<PaymentSettings>) => setPay((p) => ({ ...p, ...patch }));
  const payGap = pay.enabled && !String(pay.configName || '').trim()
    ? 'Enter the payment configuration name to turn payments on.'
    : '';

  async function save() {
    if (payGap) {
      notify('error', 'Payment configuration name needed', payGap);
      return;
    }
    setSaving(true);
    try {
      const r = await api.saveSettings({ catalogId: catalogId.trim(), payment: pay });
      apply(r.data);
      notify('success', 'Settings saved', r.data.catalogName ? `Catalog “${r.data.catalogName}” is linked.` : undefined);
    } catch (e) {
      notify('error', 'Could not save settings', e instanceof Error ? e.message : undefined);
    } finally {
      setSaving(false);
    }
  }

  const connected = business?.whatsappConnected ?? saved?.whatsappConnected ?? false;
  const verifiedName = business?.meta?.verifiedName || business?.name || 'Verified WhatsApp Business';
  const displayPhone = business?.meta?.displayPhoneNumber || business?.phone || '';

  return (
    <div className="page st-page">
      <header className="page-head st-head">
        <div className="st-head-left">
          <h2>Settings</h2>
          <span className="st-head-sub">
            Configure your WhatsApp connection, Meta product catalog, and in-chat payments
          </span>
        </div>
        <div className="st-head-actions">
          {dirty && (
            <span className="st-dirty-indicator">
              <span className="st-dirty-dot" />
              Unsaved changes
            </span>
          )}
          <button className="k-btn st-save" onClick={save} disabled={!dirty || saving || !saved}>
            <span className="material-icons">save</span>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </header>

      <div className="page-body st-body">
        {error && <p className="err">{error}</p>}
        {!saved && !error && <div className="page-note">Loading settings…</div>}

        {saved && (
          <div className="st-container">
            {/* Main Settings Column */}
            <div className="st-main-col">
              {/* ---- WhatsApp connection ---- */}
              <section className="st-card">
                <div className="st-card-header">
                  <div className="st-card-title-group">
                    <span className="st-card-icon-wrap wa">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                        <path d="M12 2C6.48 2 2 6.48 2 12C2 13.85 2.5 15.58 3.38 17.07L2 22L7.07 20.66C8.52 21.51 10.21 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2Z" fill="#25D366" />
                        <path d="M17.5 14.5C17.2 14.4 15.8 13.7 15.5 13.6C15.3 13.5 15.1 13.5 14.9 13.7C14.7 13.9 14.2 14.5 14.1 14.7C13.9 14.8 13.8 14.8 13.5 14.7C13.2 14.5 12.3 14.2 11.2 13.2C10.4 12.5 9.8 11.6 9.7 11.3C9.5 11 9.7 10.9 9.8 10.8C9.9 10.7 10.1 10.5 10.2 10.3C10.3 10.2 10.3 10.1 10.4 9.9C10.5 9.7 10.4 9.6 10.3 9.4C10.2 9.3 9.7 8 9.5 7.5C9.3 7 9.1 7.1 8.9 7.1C8.8 7.1 8.6 7.1 8.4 7.1C8.2 7.1 7.9 7.2 7.7 7.4C7.4 7.7 6.8 8.3 6.8 9.5C6.8 10.7 7.7 11.8 7.8 12C7.9 12.1 9.5 14.6 12 15.6C12.6 15.9 13.1 16 13.5 16.2C14.1 16.4 14.7 16.4 15.2 16.3C15.7 16.2 16.8 15.6 17 15C17.3 14.4 17.3 13.9 17.2 13.8C17.1 13.7 16.9 13.6 16.6 13.5L17.5 14.5Z" fill="white" />
                      </svg>
                    </span>
                    <div>
                      <h3 className="st-card-title">WhatsApp Business Account</h3>
                      <p className="st-card-subtitle">Official Meta Cloud API integration for messaging customers</p>
                    </div>
                  </div>
                  {connected ? (
                    <span className="st-pill ok">
                      <span className="st-pill-dot" /> Connected
                    </span>
                  ) : (
                    <span className="st-pill warn">
                      <span className="st-pill-dot" /> Not connected
                    </span>
                  )}
                </div>

                <div className="st-account-box">
                  {connected ? (
                    <div className="st-account-details">
                      <div className="st-acc-grid">
                        <div className="st-acc-item">
                          <span className="st-acc-label">Verified Name</span>
                          <span className="st-acc-val bold">{verifiedName}</span>
                        </div>
                        {displayPhone && (
                          <div className="st-acc-item">
                            <span className="st-acc-label">Phone Number</span>
                            <span className="st-acc-val phone">{displayPhone}</span>
                          </div>
                        )}
                        {business?.meta?.wabaName && (
                          <div className="st-acc-item">
                            <span className="st-acc-label">WABA Name</span>
                            <span className="st-acc-val">{business.meta.wabaName}</span>
                          </div>
                        )}
                      </div>

                      <div className="st-account-actions">
                        {!demo && (
                          <ConnectWhatsAppButton
                            api={api}
                            onConnected={onConnected}
                            business={business}
                            label="Reconnect WhatsApp"
                            variant="ghost"
                          />
                        )}
                        {onNavigate && (
                          <button
                            type="button"
                            className="st-btn-outline"
                            onClick={() => onNavigate('channel-status')}
                          >
                            <span className="material-icons">speed</span>
                            <span>View Channel Status & Tiers</span>
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="st-unconnected-box">
                      <p className="st-unconnected-text">
                        Connect your number with Meta’s signup to start sending campaigns and chatting with customers.
                      </p>
                      {!demo && <ConnectWhatsAppButton api={api} onConnected={onConnected} business={business} />}
                    </div>
                  )}
                </div>
              </section>

              {/* ---- WhatsApp business profile (saved straight to Meta) ---- */}
              <section className="st-card" id="st-wa-profile">
                <div className="st-card-header">
                  <div className="st-card-title-group">
                    <span className="st-card-icon-wrap wa">
                      <span className="material-icons" aria-hidden="true">storefront</span>
                    </span>
                    <div>
                      <h3 className="st-card-title">WhatsApp business profile</h3>
                      <p className="st-card-subtitle">What customers see when they open your business profile in WhatsApp</p>
                    </div>
                  </div>
                </div>
                <div className="st-card-body">
                  <WhatsAppProfileEditor api={api} onNavigate={onNavigate} businessName={business?.name} showPhonePreview={false} />
                </div>
              </section>

              {/* ---- Catalog ---- */}
              <section className="st-card">
                <div className="st-card-header">
                  <div className="st-card-title-group">
                    <span className="st-card-icon-wrap cat">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                        <path d="M4 6H20V18C20 19.1046 19.1046 20 18 20H6C4.89543 20 4 19.1046 4 18V6Z" stroke="#0284c7" strokeWidth="2" strokeLinejoin="round" />
                        <path d="M8 8V4C8 2.89543 8.89543 2 10 2H14C15.1046 2 16 2.89543 16 4V8" stroke="#0284c7" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    </span>
                    <div>
                      <h3 className="st-card-title">Product Catalog</h3>
                      <p className="st-card-subtitle">Connect your Meta Commerce Manager catalog for interactive storefront & products</p>
                    </div>
                  </div>
                  {saved.catalogName && catalogId === saved.catalogId ? (
                    <span className="st-pill ok">Linked</span>
                  ) : (
                    <span className="st-pill neutral">Optional</span>
                  )}
                </div>

                <div className="st-card-body">
                  <Text
                    label="Catalog ID"
                    value={catalogId}
                    onChange={(v) => setCatalogId(v.replace(/[^\d]/g, ''))}
                    placeholder="e.g. 1234567890123456"
                    inputMode="numeric"
                    mono
                    hint="Commerce Manager → your catalog → Settings. The catalog must be connected to your WhatsApp Business Account. Leave empty if you don’t sell from a catalog."
                  />
                  {saved.catalogName && catalogId === saved.catalogId && (
                    <div className="st-linked-banner">
                      <span className="material-icons">check_circle</span>
                      <div>
                        <strong>Catalog Linked Successfully</strong>
                        <span>Connected to Meta catalog: “{saved.catalogName}”</span>
                      </div>
                    </div>
                  )}
                </div>
              </section>

              {/* ---- WhatsApp Pay ---- */}
              <section className="st-card">
                <div className="st-card-header">
                  <div className="st-card-title-group">
                    <span className="st-card-icon-wrap pay">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                        <rect x="2" y="5" width="20" height="14" rx="3" stroke="#8b5cf6" strokeWidth="2" />
                        <line x1="2" y1="10" x2="22" y2="10" stroke="#8b5cf6" strokeWidth="2" />
                        <circle cx="7" cy="15" r="1.5" fill="#8b5cf6" />
                      </svg>
                    </span>
                    <div>
                      <h3 className="st-card-title">WhatsApp Pay</h3>
                      <p className="st-card-subtitle">Accept native in-chat payments from customers through your gateway</p>
                    </div>
                  </div>
                  <span className={`st-pill ${pay.enabled ? 'ok' : 'neutral'}`}>
                    {pay.enabled ? 'Active' : 'Disabled'}
                  </span>
                </div>

                <div className="st-card-body">
                  <div className="st-switch-banner">
                    <label className="st-switch-label" htmlFor="st-pay-toggle">
                      <input
                        id="st-pay-toggle"
                        type="checkbox"
                        className="st-switch"
                        checked={!!pay.enabled}
                        onChange={(e) => setP({ enabled: e.target.checked })}
                      />
                      <div className="st-switch-desc">
                        <strong>Take payments in WhatsApp</strong>
                        <span>Customers get an interactive “Review and pay” card in chat and pay through your integrated gateway.</span>
                      </div>
                    </label>
                  </div>

                  <div className={`st-pay-config ${pay.enabled ? 'active' : 'inactive'}`}>
                    <div className="st-two">
                      <Text
                        label="Payment configuration name"
                        value={pay.configName || ''}
                        onChange={(v) => setP({ configName: v })}
                        placeholder="e.g. my_store_razorpay"
                        mono
                        hint="Exactly as shown in WhatsApp Manager → Payments → Payment configurations."
                      />
                      <div className="k-field">
                        <span className="k-label">Payment Gateway</span>
                        <Dropdown
                          options={GATEWAYS}
                          value={pay.gatewayType || 'razorpay'}
                          onChange={(v) => setP({ gatewayType: v })}
                        />
                        <small className="st-hint">Select the payment provider linked to your Meta account.</small>
                      </div>
                    </div>
                    {payGap && <p className="err st-err-box">{payGap}</p>}

                    <details className="st-more-details" open={!catalogId && !!pay.enabled}>
                      <summary className="st-summary">
                        <span>Seller & Merchant details {catalogId ? '(Optional)' : '(Needed without a catalog)'}</span>
                        <span className="material-icons st-summary-icon">expand_more</span>
                      </summary>
                      <p className="st-hint-p">
                        Meta asks for the seller’s registered name and address on each order item when the order isn’t
                        backed by a catalog.
                      </p>
                      <div className="st-two">
                        <Text label="Merchant name" value={pay.merchantName || ''} onChange={(v) => setP({ merchantName: v })} placeholder={business?.name} />
                        <Text label="Address line 1" value={pay.addressLine1 || ''} onChange={(v) => setP({ addressLine1: v })} placeholder="Building, Street name" />
                        <Text label="Address line 2" value={pay.addressLine2 || ''} onChange={(v) => setP({ addressLine2: v })} placeholder="Area, Landmark" />
                        <Text label="City" value={pay.city || ''} onChange={(v) => setP({ city: v })} placeholder="City / Town" />
                        <Text label="State code" value={pay.zoneCode || ''} onChange={(v) => setP({ zoneCode: v.toUpperCase().slice(0, 3) })} placeholder="e.g. MH, KA, TG" />
                        <Text label="Postal code" value={pay.postalCode || ''} onChange={(v) => setP({ postalCode: v })} inputMode="numeric" placeholder="e.g. 500081" />
                      </div>
                    </details>
                  </div>
                </div>
              </section>
            </div>

            {/* Sidebar Guidance & Status Column */}
            <aside className="st-sidebar-col">
              {/* Widget 1: Integration Status */}
              <div className="st-side-card">
                <h4 className="st-side-title">Integration Status</h4>
                <div className="st-status-list">
                  <div className="st-status-item">
                    <span className={`st-status-dot ${connected ? 'green' : 'amber'}`} />
                    <div className="st-status-info">
                      <div className="st-status-name">WhatsApp Account</div>
                      <div className="st-status-sub">
                        {connected ? (displayPhone || 'Connected') : 'Not connected'}
                      </div>
                    </div>
                    <span className={`st-status-tag ${connected ? 'ok' : 'warn'}`}>
                      {connected ? 'Active' : 'Action needed'}
                    </span>
                  </div>

                  <div className="st-status-item">
                    <span className={`st-status-dot ${saved.catalogId ? 'green' : 'neutral'}`} />
                    <div className="st-status-info">
                      <div className="st-status-name">Product Catalog</div>
                      <div className="st-status-sub">
                        {saved.catalogName ? `“${saved.catalogName}”` : (catalogId ? 'Configured' : 'Not configured')}
                      </div>
                    </div>
                    <span className={`st-status-tag ${saved.catalogId ? 'ok' : 'neutral'}`}>
                      {saved.catalogId ? 'Linked' : 'Optional'}
                    </span>
                  </div>

                  <div className="st-status-item">
                    <span className={`st-status-dot ${pay.enabled ? 'green' : 'neutral'}`} />
                    <div className="st-status-info">
                      <div className="st-status-name">WhatsApp Pay</div>
                      <div className="st-status-sub">
                        {pay.enabled ? (pay.gatewayType?.toUpperCase() || 'Enabled') : 'Disabled'}
                      </div>
                    </div>
                    <span className={`st-status-tag ${pay.enabled ? 'ok' : 'neutral'}`}>
                      {pay.enabled ? 'Enabled' : 'Off'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Widget 2: Configuration Guide */}
              <div className="st-side-card">
                <h4 className="st-side-title">Configuration Guide</h4>
                <div className="st-guide-list">
                  <div className="st-guide-item">
                    <span className="st-guide-num">1</span>
                    <div>
                      <strong>Where to find Catalog ID</strong>
                      <p>Open Meta Commerce Manager → Catalogs → Settings → Catalog info. Copy the 15-16 digit Catalog ID.</p>
                    </div>
                  </div>
                  <div className="st-guide-item">
                    <span className="st-guide-num">2</span>
                    <div>
                      <strong>WhatsApp Pay Gateway</strong>
                      <p>Go to WhatsApp Manager → Payments. Link Razorpay or PayU, then enter the exact configuration name here.</p>
                    </div>
                  </div>
                  <div className="st-guide-item">
                    <span className="st-guide-num">3</span>
                    <div>
                      <strong>Save to Apply</strong>
                      <p>Click "Save changes" at top-right to activate the catalog and payment gateway across all chats.</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Widget 3: Quick Navigation */}
              {onNavigate && (
                <div className="st-side-card">
                  <h4 className="st-side-title">Quick Links</h4>
                  <div className="st-links-list">
                    <button
                      type="button"
                      className="st-quick-link"
                      onClick={() => onNavigate('channel-status')}
                    >
                      <span className="material-icons">speed</span>
                      <span>Channel Status & Limits</span>
                      <span className="material-icons arr">chevron_right</span>
                    </button>
                    <button
                      type="button"
                      className="st-quick-link"
                      onClick={() => onNavigate('profile')}
                    >
                      <span className="material-icons">badge</span>
                      <span>Business Profile & IDs</span>
                      <span className="material-icons arr">chevron_right</span>
                    </button>
                  </div>
                </div>
              )}
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
