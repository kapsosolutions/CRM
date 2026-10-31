import { useState, useEffect, useMemo } from 'react';
import type { CrmApi } from '../api';
import type { BusinessProfile } from '../types';
import type { CrmView } from './NavRail';
import { useConfirm, useNotify } from './Dialogs';
import { WhatsAppConnectRequired } from './WhatsAppConnectRequired';
import './PaymentConfigPage.css';

interface Props {
  api: CrmApi;
  demo?: boolean;
  business?: BusinessProfile;
  onBusinessUpdated?: (b: BusinessProfile) => void;
  onConnected?: (b: BusinessProfile) => void;
  onNavigate?: (v: CrmView) => void;
}

interface PaymentConfigData {
  configName: string;
  provider: 'upi' | 'razorpay' | 'payu' | 'cashfree';
  upiVpaId: string;
  merchantId?: string;
  connectedAt: string;
}

function RupeeIconSvg({ width = 18, height = 18 }: { width?: number; height?: number }) {
  return (
    <svg width={width} height={height} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path
        d="M10 2.25C5.72 2.25 2.25 5.55 2.25 9.65C2.25 11.1 2.7 12.45 3.5 13.55L2.75 17.25L6.55 16.3C7.6 16.85 8.8 17.1 10 17.1C14.28 17.1 17.75 13.8 17.75 9.65C17.75 5.55 14.28 2.25 10 2.25Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <text x="10" y="13" textAnchor="middle" fontFamily="Arial, sans-serif" fontSize="10.5" fontWeight="600" fill="currentColor">₹</text>
    </svg>
  );
}

function LinkStepIconSvg() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function MetaInfinityLogo({ width = 46, height = 31 }: { width?: number; height?: number }) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: 'block' }}
    >
      <defs>
        <linearGradient id="meta-grad-pay-official" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#0064E0" />
          <stop offset="50%" stopColor="#0072EC" />
          <stop offset="100%" stopColor="#0081FB" />
        </linearGradient>
      </defs>
      <path
        fill="url(#meta-grad-pay-official)"
        d="M6.915 4.03c-1.968 0-3.683 1.28-4.871 3.113C.704 9.208 0 11.883 0 14.449c0 .706.07 1.369.21 1.973a6.624 6.624 0 0 0 .265.86 5.297 5.297 0 0 0 .371.761c.696 1.159 1.818 1.927 3.593 1.927 1.497 0 2.633-.671 3.965-2.444.76-1.012 1.144-1.626 2.663-4.32l.756-1.339.186-.325c.061.1.121.196.183.3l2.152 3.595c.724 1.21 1.665 2.556 2.47 3.314 1.046.987 1.992 1.22 3.06 1.22 1.075 0 1.876-.355 2.455-.843a3.743 3.743 0 0 0 .81-.973c.542-.939.861-2.127.861-3.745 0-2.72-.681-5.357-2.084-7.45-1.282-1.912-2.957-2.93-4.716-2.93-1.047 0-2.088.467-3.053 1.308-.652.57-1.257 1.29-1.82 2.05-.69-.875-1.335-1.547-1.958-2.056-1.182-.966-2.315-1.303-3.454-1.303zm10.16 2.053c1.147 0 2.188.758 2.992 1.999 1.132 1.748 1.647 4.195 1.647 6.4 0 1.548-.368 2.9-1.839 2.9-.58 0-1.027-.23-1.664-1.004-.496-.601-1.343-1.878-2.832-4.358l-.617-1.028a44.908 44.908 0 0 0-1.255-1.98c.07-.109.141-.224.211-.327 1.12-1.667 2.118-2.602 3.358-2.602zm-10.201.553c1.265 0 2.058.791 2.675 1.446.307.327.737.871 1.234 1.579l-1.02 1.566c-.757 1.163-1.882 3.017-2.837 4.338-1.191 1.649-1.81 1.817-2.486 1.817-.524 0-1.038-.237-1.383-.794-.263-.426-.464-1.13-.464-2.046 0-2.221.63-4.535 1.66-6.088.454-.687.964-1.226 1.533-1.533a2.264 2.264 0 0 1 1.088-.285z"
      />
    </svg>
  );
}

function BenefitCheckIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="cs-benefit-icon" style={{ flexShrink: 0 }}>
      <circle cx="12" cy="12" r="9" stroke="#16a34a" strokeWidth="2" fill="none" />
      <path d="M8.5 12.2L10.8 14.5L15.5 9.8" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function PaymentConfigPage({ api, demo = false, business, onBusinessUpdated, onConnected, onNavigate: _onNavigate }: Props) {
  if (!demo && business && !business.whatsappConnected) {
    return <WhatsAppConnectRequired page="payment-config" api={api} business={business} onConnected={onConnected || onBusinessUpdated} />;
  }

  const notify = useNotify();
  const confirm = useConfirm();
  const bizId = business?._id || 'default_tenant';

  const storageKey = `crm_payment_config_${bizId}`;

  // Stored configuration
  const [config, setConfig] = useState<PaymentConfigData | null>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) return JSON.parse(saved);
    } catch {
      // ignore
    }
    return null;
  });

  // Modal states
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [modalMode, setModalMode] = useState<'info' | 'form'>('info');

  // Form states
  const [provider, setProvider] = useState<'upi' | 'razorpay' | 'payu' | 'cashfree'>('razorpay');
  const [paymentConfigName, setPaymentConfigName] = useState('');
  const [upiVpaId, setUpiVpaId] = useState('');
  const [connecting, setConnecting] = useState(false);

  // Validation: If valid then only create
  const isInputValid = useMemo(() => {
    if (provider === 'upi') {
      const trimmed = upiVpaId.trim();
      return (
        trimmed.length >= 5 &&
        trimmed.includes('@') &&
        trimmed.indexOf('@') > 0 &&
        trimmed.indexOf('@') < trimmed.length - 1
      );
    }
    const trimmed = paymentConfigName.trim();
    return trimmed.length >= 2 && /^[a-zA-Z0-9_\-\s]+$/.test(trimmed);
  }, [provider, upiVpaId, paymentConfigName]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) setConfig(JSON.parse(saved));
    } catch {
      // ignore
    }
  }, [storageKey]);

  const handleOpenModal = () => {
    setModalMode('info');
    setShowConnectModal(true);
  };

  const handleCloseModal = () => {
    setShowConnectModal(false);
    setModalMode('info');
  };

  const handleSaveConfig = () => {
    if (!isInputValid) {
      if (provider === 'upi') {
        notify('error', 'Valid UPI ID Required', 'Please provide a valid UPI VPA ID (e.g. business@okhdfcbank).');
      } else {
        notify('error', 'Valid Configuration Name Required', 'Please provide a valid payment configuration name (e.g. devine).');
      }
      return;
    }

    setConnecting(true);
    setTimeout(() => {
      const finalName = provider === 'upi' ? `UPI (${upiVpaId.trim()})` : paymentConfigName.trim();
      const newConfig: PaymentConfigData = {
        configName: finalName,
        provider,
        upiVpaId: provider === 'upi' ? upiVpaId.trim() : '',
        merchantId: provider !== 'upi' ? paymentConfigName.trim() : '',
        connectedAt: new Date().toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        }),
      };

      try {
        localStorage.setItem(storageKey, JSON.stringify(newConfig));
      } catch {
        // ignore
      }

      setConfig(newConfig);
      setConnecting(false);
      setShowConnectModal(false);
      setModalMode('info');
      notify('success', 'Payment Configuration Connected', 'Your WhatsApp account is now configured to accept payments.');
    }, 450);
  };

  const handleDisconnect = () => {
    confirm({
      title: 'Disconnect Payment Configuration?',
      message: 'Customers will no longer be able to complete direct payments inside WhatsApp conversations.',
      confirmLabel: 'Disconnect',
      cancelLabel: 'Keep Connected',
    }).then((proceed) => {
      if (!proceed) return;
      try {
        localStorage.removeItem(storageKey);
      } catch {
        // ignore
      }
      setConfig(null);
      notify('success', 'Configuration Disconnected', 'Payment configuration removed from this business account.');
    });
  };

  return (
    <div className={`crm-pay-onboarding${!config ? ' is-unconnected' : ''}`}>
      <div className="crm-pay-onboarding-inner">
        {/* If Connected: Show Active Header & Status Card */}
        {config && (
          <>
            <div className="crm-pay-header-bar">
              <div className="crm-pay-header-left">
                <h2 className="crm-pay-header-title">Payment Configuration</h2>
                <div className="crm-pay-status-pill">
                  <span className="crm-pay-status-dot" />
                  <span>Active &amp; Ready</span>
                </div>
              </div>

              <div className="crm-pay-header-actions">
                <button
                  type="button"
                  className="crm-pay-action-btn primary"
                  onClick={handleOpenModal}
                >
                  <RupeeIconSvg width={16} height={16} />
                  <span>Edit Configuration</span>
                </button>
                <button
                  type="button"
                  className="crm-pay-action-btn danger"
                  onClick={handleDisconnect}
                >
                  Disconnect
                </button>
              </div>
            </div>

            <div className="crm-pay-connected-grid">
              <div className="crm-pay-main-card">
                <div className="crm-pay-main-card-header">
                  <div>
                    <h3 style={{ margin: '0 0 6px 0', fontSize: '18px', fontWeight: 800, color: '#0f172a' }}>
                      {config.configName}
                    </h3>
                    <span style={{ fontSize: '13px', color: '#64748b' }}>
                      Linked to WhatsApp Cloud API Account
                    </span>
                  </div>
                  <span className="crm-pay-card-badge">
                    ✓ Verified Meta Gateway
                  </span>
                </div>

                <div className="crm-pay-details-list">
                  <div className="crm-pay-detail-item">
                    <span className="crm-pay-detail-label">Payment Method / Provider</span>
                    <span className="crm-pay-detail-value">
                      {config.provider === 'upi'
                        ? 'Direct UPI (VPA Bank Settlement)'
                        : config.provider.toUpperCase()}
                    </span>
                  </div>

                  <div className="crm-pay-detail-item">
                    <span className="crm-pay-detail-label">
                      {config.provider === 'upi' ? 'Linked UPI VPA / Handle' : 'Payment Configuration Name'}
                    </span>
                    <span className="crm-pay-detail-value">
                      <code>{config.merchantId || config.upiVpaId || 'devine'}</code>
                    </span>
                  </div>

                  <div className="crm-pay-detail-item">
                    <span className="crm-pay-detail-label">Connected On</span>
                    <span className="crm-pay-detail-value">{config.connectedAt}</span>
                  </div>

                  <div className="crm-pay-detail-item">
                    <span className="crm-pay-detail-label">Supported Currencies</span>
                    <span className="crm-pay-detail-value">INR (₹)</span>
                  </div>
                </div>

                <div style={{ marginTop: '24px', paddingTop: '18px', borderTop: '1px solid #f1f5f9', display: 'flex', gap: '12px' }}>
                  <button
                    type="button"
                    className="crm-pay-action-btn outline"
                    onClick={() => {
                      notify('success', 'WhatsApp Pay Test Sent', `A simulated ₹1 test payment prompt was sent to your connected WhatsApp phone.`);
                    }}
                  >
                    Test Payment Message
                  </button>
                </div>
              </div>

              <div className="crm-pay-side-card">
                <h4 className="crm-pay-side-title">Payment Settlement Info</h4>
                <div className="crm-pay-tip-item">
                  <span className="crm-pay-tip-bullet">●</span>
                  <span>Instant T+0 settlement directly into your linked bank account via NPCI UPI rail.</span>
                </div>
                <div className="crm-pay-tip-item">
                  <span className="crm-pay-tip-bullet">●</span>
                  <span>Zero commission on standard UPI transactions initiated via WhatsApp Business Platform.</span>
                </div>
                <div className="crm-pay-tip-item">
                  <span className="crm-pay-tip-bullet">●</span>
                  <span>Automated WhatsApp payment confirmation receipts generated instantly for customers.</span>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Unconnected Hero Box (Matching Meta Channels layout) */}
        {!config && (
          <div className="cs-unconnected-hero-box">
            <div className="cs-unconnected-logos-row">
              <img src="/channel-payment.svg" alt="Payment" className="cs-unconnected-logo-img" />
              <span className="cs-unconnected-arrow">⇄</span>
              <MetaInfinityLogo width={46} height={31} />
            </div>

            <h2 className="cs-unconnected-headline">
              To accept payments, connect your Payment Configuration
            </h2>
            <p className="cs-unconnected-subline">
              Once connected, you can start receiving direct payments from customers on WhatsApp
            </p>

            <div className="cs-unconnected-benefits-box">
              <h3 className="cs-unconnected-benefits-title">
                Benefits of connecting payment configuration
              </h3>
              <ul className="cs-unconnected-benefits-list">
                <li className="cs-unconnected-benefit-item">
                  <BenefitCheckIcon />
                  <span>In-chat native checkout with direct UPI &amp; card options</span>
                </li>
                <li className="cs-unconnected-benefit-item">
                  <BenefitCheckIcon />
                  <span>Instant bank settlement straight to your linked account</span>
                </li>
                <li className="cs-unconnected-benefit-item">
                  <BenefitCheckIcon />
                  <span>Automated payment confirmation receipts &amp; order updates</span>
                </li>
              </ul>

              <div className="cs-unconnected-cta-row">
                <button
                  type="button"
                  className="cs-connect-channel-btn"
                  onClick={handleOpenModal}
                >
                  Connect Payment Configuration
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Connect Payment Configuration Modal (Matching Image 2 Exactly) */}
      {showConnectModal && (
        <div
          className="crm-pay-modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) handleCloseModal();
          }}
        >
          <div className="crm-pay-modal" role="dialog" aria-modal="true">
            {/* Top Banner Image with Close Button */}
            <div className="crm-pay-modal-banner-wrap">
              <img
                src="/payment_config_banner.webp"
                alt="Payment Configuration"
                className="crm-pay-modal-banner"
              />
              <button
                type="button"
                className="crm-pay-modal-close-btn"
                onClick={handleCloseModal}
                title="Close"
                aria-label="Close modal"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div className="crm-pay-modal-body">
              <h3 className="crm-pay-modal-title">
                Set up your account to accept payments on WhatsApp.
              </h3>
              <p className="crm-pay-modal-sub">
                Add a payment configuration to your WhatsApp Business account so that your customers can pay on WhatsApp
                directly to your payment gateway or bank.
              </p>

              {/* Steps List: ONLY Step 2 (Connect) is shown, as requested */}
              {modalMode === 'info' ? (
                <div className="crm-pay-steps-list">
                  <div className="crm-pay-step-item">
                    <div className="crm-pay-step-icon">
                      <LinkStepIconSvg />
                    </div>
                    <div className="crm-pay-step-content">
                      <h4 className="crm-pay-step-title">Connect</h4>
                      <p className="crm-pay-step-desc">
                        Link the configuration to your payment gateway or your bank with UPI VPA ID.
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                /* Interactive Form when user clicks Get Started */
                <div className="crm-pay-form-card">
                  <div className="crm-pay-form-row">
                    <label className="crm-pay-form-label">Select Payment Gateway / Method</label>
                    <div className="crm-pay-provider-radios" role="radiogroup" aria-label="Select Payment Gateway">
                      {/* Razorpay */}
                      <label
                        className={`crm-pay-radio-item ${provider === 'razorpay' ? 'active' : ''}`}
                        onClick={() => setProvider('razorpay')}
                        onKeyDown={(e) => {
                          if (e.key === ' ' || e.key === 'Enter') {
                            e.preventDefault();
                            setProvider('razorpay');
                          }
                        }}
                        role="radio"
                        aria-checked={provider === 'razorpay'}
                        tabIndex={0}
                      >
                        <span className={`crm-pay-radio-custom ${provider === 'razorpay' ? 'checked' : ''}`}>
                          {provider === 'razorpay' && <span className="crm-pay-radio-dot" />}
                        </span>
                        <div className="crm-pay-radio-icon-box">
                          <img src="/razorpay.svg" alt="Razorpay" className="crm-pay-radio-logo razorpay" />
                        </div>
                      </label>

                      {/* PayU */}
                      <label
                        className={`crm-pay-radio-item ${provider === 'payu' ? 'active' : ''}`}
                        onClick={() => setProvider('payu')}
                        onKeyDown={(e) => {
                          if (e.key === ' ' || e.key === 'Enter') {
                            e.preventDefault();
                            setProvider('payu');
                          }
                        }}
                        role="radio"
                        aria-checked={provider === 'payu'}
                        tabIndex={0}
                      >
                        <span className={`crm-pay-radio-custom ${provider === 'payu' ? 'checked' : ''}`}>
                          {provider === 'payu' && <span className="crm-pay-radio-dot" />}
                        </span>
                        <div className="crm-pay-radio-icon-box">
                          <img src="/PAYU.svg" alt="PayU" className="crm-pay-radio-logo payu" />
                        </div>
                      </label>

                      {/* UPI */}
                      <label
                        className={`crm-pay-radio-item ${provider === 'upi' ? 'active' : ''}`}
                        onClick={() => setProvider('upi')}
                        onKeyDown={(e) => {
                          if (e.key === ' ' || e.key === 'Enter') {
                            e.preventDefault();
                            setProvider('upi');
                          }
                        }}
                        role="radio"
                        aria-checked={provider === 'upi'}
                        tabIndex={0}
                      >
                        <span className={`crm-pay-radio-custom ${provider === 'upi' ? 'checked' : ''}`}>
                          {provider === 'upi' && <span className="crm-pay-radio-dot" />}
                        </span>
                        <div className="crm-pay-radio-icon-box">
                          <img src="/upi.svg" alt="UPI" className="crm-pay-radio-logo upi" />
                        </div>
                      </label>
                    </div>
                  </div>

                  <div className="crm-pay-form-row">
                    <label className="crm-pay-form-label">
                      {provider === 'upi' ? 'UPI VPA ID (Virtual Payment Address)' : 'Payment configuration name'}
                    </label>
                    <input
                      type="text"
                      className="crm-pay-form-input"
                      value={provider === 'upi' ? upiVpaId : paymentConfigName}
                      onChange={(e) => (provider === 'upi' ? setUpiVpaId(e.target.value) : setPaymentConfigName(e.target.value))}
                      placeholder={provider === 'upi' ? 'e.g. yourbusiness@okhdfcbank' : 'e.g. devine'}
                    />
                    {!isInputValid && (
                      <span style={{ fontSize: '12px', color: '#dc2626', marginTop: '2px' }}>
                        {provider === 'upi'
                          ? 'Please enter a valid UPI address (e.g. name@bank)'
                          : 'Please enter a valid payment configuration name (at least 2 characters)'}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer (Matching Image 2) */}
            <div className="crm-pay-modal-footer">
              <p className="crm-pay-disclaimer">
                By continuing, you accept{' '}
                <a
                  href="https://www.whatsapp.com/legal/business-platform-terms/"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Meta Terms for WhatsApp Business Platform
                </a>{' '}
                and{' '}
                <a
                  href="https://www.whatsapp.com/legal/payments/addendum/"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Payments Addendum to the WhatsApp Business Terms of Service
                </a>
                .
              </p>

              {modalMode === 'info' ? (
                <button
                  type="button"
                  className="crm-pay-get-started-btn"
                  onClick={() => setModalMode('form')}
                >
                  Get started
                </button>
              ) : (
                <button
                  type="button"
                  className="crm-pay-get-started-btn"
                  disabled={!isInputValid || connecting}
                  onClick={handleSaveConfig}
                  style={{
                    opacity: isInputValid && !connecting ? 1 : 0.5,
                    cursor: isInputValid && !connecting ? 'pointer' : 'not-allowed',
                  }}
                >
                  {connecting ? 'Connecting...' : 'Connect Configuration'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
