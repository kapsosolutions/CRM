// Business profile: left Settings sidebar and the WhatsApp business profile
// of the connected number (photo, about, address, …), read from and saved to
// Meta through the shared WhatsAppProfileEditor. The Billing tab is
// BillingPage.tsx.
import { useEffect, useState } from 'react';
import type { CrmApi } from '../api';
import type { BusinessProfile } from '../types';
import type { CrmView } from './NavRail';
import { useNotify } from './Dialogs';
import { WhatsAppProfileEditor } from './WhatsAppProfileEditor';
import { BillingPage } from './BillingPage';
import { ManageNotifications } from './ManageNotifications';
import './ProfilePage.css';

interface Props {
  api: CrmApi;
  demo?: boolean;
  business?: BusinessProfile;
  onNavigate?: (view: CrmView) => void;
}

export function ProfilePage({ api, demo = false, business: propBusiness, onNavigate }: Props) {
  const notify = useNotify();

  const [biz, setBiz] = useState<BusinessProfile | undefined>(propBusiness);
  const [activeTab, setActiveTab] = useState<string>(() => {
    try {
      const stored = localStorage.getItem('crm_settings_active_tab');
      if (stored === 'notifications' || stored === 'billing') return stored;
      return 'profile';
    } catch {
      return 'profile';
    }
  });

  useEffect(() => {
    const handleSetTab = (e: any) => {
      if (e?.detail) setActiveTab(e.detail);
    };
    window.addEventListener('crm_set_profile_tab', handleSetTab);
    return () => window.removeEventListener('crm_set_profile_tab', handleSetTab);
  }, []);

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    try {
      localStorage.setItem('crm_settings_active_tab', tab);
    } catch {
      // ignore
    }
  };

  // Load business details if not passed via props
  useEffect(() => {
    if (propBusiness) {
      setBiz(propBusiness);
      return;
    }
    if (demo) return;
    api
      .getMe()
      .then((r) => {
        if (r.business) setBiz(r.business);
      })
      .catch(() => {});
  }, [api, demo, propBusiness]);

  const businessName = biz?.name || biz?.meta?.verifiedName || 'My Business';

  const rawWaNumber = (
    biz?.meta?.displayPhoneNumber ||
    biz?.whatsappNumber ||
    (biz as any)?.phoneNumberId ||
    biz?.ownerPhone ||
    biz?.phone ||
    '+15554071944'
  ).replace(/[^\d+]/g, '');
  const displayWaNumber = rawWaNumber ? (rawWaNumber.startsWith('+') ? rawWaNumber : `+${rawWaNumber}`) : '+15554071944';

  return (
    <div className="bp-layout">
      {/* Left Sidebar Navigation */}
      <aside className="bp-sidebar" aria-label="Settings Navigation">
        <h3 className="bp-sidebar-title">Settings</h3>
        <nav className="bp-sidebar-menu">
          <button
            type="button"
            className={`bp-menu-item ${activeTab === 'profile' ? 'active' : ''}`}
            onClick={() => handleTabChange('profile')}
          >
            <span className="bp-menu-icon">
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                <rect x="2.5" y="3.5" width="15" height="13" rx="2" />
                <circle cx="7" cy="8.5" r="2" />
                <path d="M4.5 14c0-1.5 1.5-2.5 3-2.5s3 1 3 2.5" />
                <path d="M12 7.5h3.5M12 10.5h3.5M12 13.5h2" strokeLinecap="round" />
              </svg>
            </span>
            <span>Business profile</span>
          </button>

          <button
            type="button"
            className={`bp-menu-item ${activeTab === 'notifications' ? 'active' : ''}`}
            onClick={() => handleTabChange('notifications')}
          >
            <span className="bp-menu-icon">
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                <path d="M15 13H5c.8-1 1-2 1-4V7a4 4 0 0 1 8 0v2c0 2 .2 3 1 4z" />
                <path d="M8.5 16a1.5 1.5 0 0 0 3 0" strokeLinecap="round" />
              </svg>
            </span>
            <span>Manage Notifications</span>
          </button>

          <button
            type="button"
            className={`bp-menu-item ${activeTab === 'billing' ? 'active' : ''}`}
            onClick={() => handleTabChange('billing')}
            data-testid="settings-billing-tab"
          >
            <span className="bp-menu-icon">
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                <rect x="2.5" y="4.5" width="15" height="11" rx="2" />
                <path d="M2.5 8h15" />
                <path d="M5.5 12.5h3" strokeLinecap="round" />
              </svg>
            </span>
            <span>Billing</span>
          </button>

          <button
            type="button"
            className={`bp-menu-item ${activeTab === 'numbers' ? 'active' : ''}`}
            onClick={() => {
              handleTabChange('numbers');
              try {
                localStorage.setItem('crm_channel_status_subitem', 'phone_number');
                window.dispatchEvent(new CustomEvent('crm_set_channel_subitem', { detail: 'phone_number' }));
              } catch {
                // ignore
              }
              if (onNavigate) onNavigate('channel-status');
            }}
            title={`WhatsApp: ${displayWaNumber} (Phone Number Status)`}
          >
            <span className="bp-menu-icon">
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                <path d="M10 2.5a7.5 7.5 0 0 0-6.5 11.2L2.5 17.5l4-1a7.5 7.5 0 1 0 3.5-14z" strokeLinejoin="round" />
                <path d="M7.8 7.5c.3-.5.6-.5.9 0l.7 1.4c.2.3.1.7-.2.9l-.3.2c.6 1.2 1.6 2.2 2.8 2.8l.2-.3c.2-.3.6-.4.9-.2l1.4.7c.5.3.5.6 0 .9-.6.5-1.3.8-1.9.8-3.5 0-6.4-2.9-6.4-6.4 0-.6.3-1.3.8-1.9z" fill="currentColor" stroke="none" />
              </svg>
            </span>
            <span>{displayWaNumber}</span>
          </button>
        </nav>
      </aside>

      {/* Main Content Area */}
      <main className="bp-content" role="region" aria-label="Settings Content">
        {activeTab === 'notifications' ? (
          <ManageNotifications api={api} demo={demo} />
        ) : activeTab === 'billing' ? (
          <BillingPage api={api} demo={demo} onNavigate={onNavigate} onEditProfile={() => handleTabChange('profile')} />
        ) : (
          <>
            <h2 className="bp-section-title">WhatsApp business profile</h2>
            <p className="bp-section-sub">What customers see when they open your business profile in WhatsApp. Read from and saved to Meta.</p>
            <WhatsAppProfileEditor
              api={api}
              onNavigate={onNavigate}
              businessName={businessName}
              business={biz}
              category={biz?.category}
            />
          </>
        )}
      </main>

      {/* Floating WhatsApp Support/Chat Bubble at Bottom Right */}
      <button
        type="button"
        className="bp-floating-chat"
        title="WhatsApp Support"
        onClick={() => {
          const wNum = rawWaNumber.replace(/\D/g, '');
          if (wNum) {
            window.open(`https://wa.me/${wNum}`, '_blank');
          } else {
            notify('success', 'Support Chat', 'Connecting to support...');
          }
        }}
        aria-label="WhatsApp Support Chat"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path
            d="M12 2C6.48 2 2 6.48 2 12c0 1.95.56 3.77 1.53 5.31L2 22l4.82-1.5A9.94 9.94 0 0 0 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2zm0 18.2c-1.62 0-3.13-.48-4.41-1.31l-.32-.21-3.26 1.01 1.04-3.17-.23-.35A8.15 8.15 0 0 1 3.8 12c0-4.52 3.68-8.2 8.2-8.2s8.2 3.68 8.2 8.2-3.68 8.2-8.2 8.2zm4.49-6.13c-.25-.13-1.46-.72-1.69-.8-.23-.08-.39-.13-.56.13-.17.25-.64.8-.78.96-.15.17-.29.19-.54.06-.25-.13-1.05-.39-2-1.23-.74-.66-1.24-1.47-1.38-1.72-.15-.25-.02-.39.11-.51.11-.11.25-.29.38-.44.13-.15.17-.25.25-.42.08-.17.04-.32-.02-.44-.06-.13-.56-1.35-.77-1.85-.2-.49-.41-.42-.56-.43h-.48c-.17 0-.44.06-.67.32-.23.25-.88.86-.88 2.1 0 1.24.9 2.44 1.03 2.61.13.17 1.78 2.72 4.31 3.81.6.26 1.07.41 1.44.53.61.19 1.16.17 1.6.1.49-.07 1.46-.6 1.67-1.17.21-.58.21-1.07.15-1.17-.06-.11-.23-.17-.48-.29z"
            fill="#ffffff"
          />
        </svg>
      </button>
    </div>
  );
}
