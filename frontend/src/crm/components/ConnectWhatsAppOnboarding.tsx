import { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import type { CrmApi } from '../api';
import type { SandboxInfo, SandboxContacts } from '../types';
import { useNotify } from './Dialogs';
import './ConnectWhatsAppOnboarding.css';

interface Props {
  api: CrmApi;
  onConnectClick?: () => void;
  contacts?: SandboxContacts | null;
  isFull?: boolean;
}

/** QR rendering options. */
const SANDBOX_QR_OPTIONS = {
  width: 140,
  margin: 1,
  color: { dark: '#000000', light: '#ffffff' },
};

export function ConnectWhatsAppOnboarding({ api, onConnectClick, contacts, isFull: isFullProp }: Props) {
  const notify = useNotify();
  // null = loading; the shared number + this business's join code otherwise.
  const [sandbox, setSandbox] = useState<SandboxInfo | null>(null);
  const [loadError, setLoadError] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [qrFailed, setQrFailed] = useState(false);

  const activeContacts = contacts || sandbox?.contacts;
  const isFull = Boolean(
    isFullProp ||
    activeContacts?.full ||
    (activeContacts?.linked !== undefined &&
      activeContacts?.limit !== undefined &&
      activeContacts.linked >= activeContacts.limit)
  );

  useEffect(() => {
    let live = true;
    api
      .getSandbox()
      .then((r) => live && setSandbox(r))
      .catch((e) => {
        if (!live) return;
        setLoadError(e instanceof Error ? e.message : 'Could not load the test number.');
        setSandbox({ success: false, enabled: false });
      });
    return () => {
      live = false;
    };
  }, [api]);

  const waMe = sandbox?.enabled ? sandbox.links?.waMe || '' : '';
  useEffect(() => {
    if (!waMe) return;
    let live = true;
    // Drawn in the browser: the join code never goes to a third-party QR service.
    QRCode.toDataURL(waMe, SANDBOX_QR_OPTIONS)
      .then((url) => live && setQrDataUrl(url))
      .catch(() => live && setQrFailed(true));
    return () => {
      live = false;
    };
  }, [waMe]);

  const copyCode = async () => {
    const code = sandbox?.code || '';
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      notify('success', 'Join code copied', `Send ${code} to ${sandbox?.displayPhone || 'the test number'} on WhatsApp.`);
    } catch {
      notify('error', 'Could not copy', `Select the code and copy it: ${code}`);
    }
  };

  // Only when the shared number is on for this business (it isn't once it connects its own).
  const sb = sandbox?.enabled && sandbox.code && sandbox.links
    ? { displayPhone: sandbox.displayPhone || '', code: sandbox.code, links: sandbox.links }
    : null;

  return (
    <div className="crm-onboarding-container">
      {/* Top Hero Section */}
      <div className="crm-onboarding-hero">
        <div className="crm-onboarding-hero-left">
          <h1 className="crm-onboarding-title">Connect WhatsApp to unlock 2B+ users</h1>
          <p className="crm-onboarding-sub">
            WhatsApp is the most used messaging app globally.<br />
            Connect your account to start messaging.
          </p>
          <button
            type="button"
            className="crm-onboarding-connect-btn"
            onClick={onConnectClick}
          >
            Connect number
          </button>
        </div>

        <div className="crm-onboarding-hero-right">
          <img
            src="/connect.avif"
            alt="Connect WhatsApp across Meta channels"
            className="crm-onboarding-hero-img"
          />
        </div>
      </div>

      {sandbox === null && (
        <div className="crm-onboarding-test-section">
          <p className="crm-onboarding-instructions">Loading the test number…</p>
        </div>
      )}
      {loadError && (
        <div className="crm-onboarding-test-section">
          <p className="crm-onboarding-instructions">The shared test number isn't available right now: {loadError}</p>
        </div>
      )}

      {/* Bottom Test Message Section */}
      {sb && (
      <div className="crm-onboarding-test-section">
        <h3 className="crm-onboarding-test-title">
          Or, try sending a test message via our shared number
        </h3>

        <div className="crm-onboarding-test-cols">
          {/* Send a message column */}
          <div className="crm-onboarding-col-send">
            <h4 className="crm-onboarding-col-heading">Send a message</h4>
            <div className="crm-onboarding-instructions">
              <p>- Use the buttons below to send a pre-filled WhatsApp message.</p>
              <p>
                - You can also save <strong className="crm-onboarding-number">{sb.displayPhone}</strong> to your
                contacts and send a message starting with <strong>{sb.code}</strong>.
              </p>
              <p>- Chats from that number then appear here in your inbox. You can reply within 24 hours of their last message.</p>
            </div>

            <div className="crm-onboarding-code-row">
              <span className="crm-onboarding-code-label">Your join code</span>
              <span className="crm-onboarding-code" data-testid="sandbox-code">{sb.code}</span>
              <button
                type="button"
                className="crm-onboarding-copy-btn"
                onClick={copyCode}
                title="Copy join code"
                aria-label="Copy join code"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                <span>Copy</span>
              </button>
            </div>

            <div className="crm-onboarding-buttons-group">
              <a
                className="crm-onboarding-outlined-btn"
                href={sb.links.web}
                target="_blank"
                rel="noopener noreferrer"
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="crm-onboarding-btn-icon">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="2" y1="12" x2="22" y2="12" />
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>
                <span>WhatsApp Web</span>
              </a>

              {/* A custom-scheme link opens the installed app in place, without a blank tab. */}
              <a className="crm-onboarding-outlined-btn" href={sb.links.desktop}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="crm-onboarding-btn-icon">
                  <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                  <line x1="8" y1="21" x2="16" y2="21" />
                  <line x1="12" y1="17" x2="12" y2="21" />
                </svg>
                <span>WhatsApp desktop app</span>
              </a>
            </div>
          </div>

          {/* "or" divider */}
          <div className="crm-onboarding-or-divider">
            <span>or</span>
          </div>

          {/* Scan QR code column */}
          <div className="crm-onboarding-col-qr">
            <h4 className="crm-onboarding-col-heading">Scan QR code</h4>
            <p className="crm-onboarding-qr-desc">
              {isFull ? (
                <span className="crm-onboarding-qr-desc-locked">
                  Test limit reached (10/10 contacts). Connect WhatsApp to unlock.
                </span>
              ) : (
                <>Scan and hit <strong>'Send'</strong> to see the message appear in the Team Inbox.</>
              )}
            </p>

            <div
              className={`crm-onboarding-qr-box${isFull ? ' is-locked' : ''}`}
              onClick={isFull ? onConnectClick : undefined}
              title={isFull ? 'Test limit reached (10/10 contacts). Connect WhatsApp to unlock.' : undefined}
              style={isFull ? { cursor: 'pointer' } : undefined}
            >
              {qrDataUrl ? (
                <img src={qrDataUrl} alt="WhatsApp Test Message QR Code" className="crm-onboarding-qr-img" />
              ) : qrFailed ? (
                <a className="crm-onboarding-qr-fallback" href={waMe} target="_blank" rel="noopener noreferrer">
                  {waMe}
                </a>
              ) : (
                <div className="crm-onboarding-qr-placeholder">Generating QR...</div>
              )}

              {isFull && (
                <div className="crm-onboarding-qr-lock-overlay">
                  <div className="crm-onboarding-qr-lock-badge">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                  </div>
                  <span className="crm-onboarding-qr-lock-text">Limit Reached</span>
                </div>
              )}
            </div>

            {isFull && (
              <button
                type="button"
                className="crm-onboarding-qr-unlock-btn"
                onClick={onConnectClick}
              >
                Connect WhatsApp to unlock
              </button>
            )}
          </div>
        </div>
      </div>
      )}

      {/* Floating green chat widget icon matching Image 2 */}
      <div className="crm-onboarding-floating-chat" title="Need help? Chat with us">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </div>
    </div>
  );
}

const SANDBOX_NOTES: Record<'templates' | 'flows', string> = {
  templates: 'Templates and campaigns belong to your own WhatsApp Business Account. '
    + 'Connect your number to use them; the shared test number can only reply to customers within 24 hours.',
  flows: 'On the shared test number, journeys run without template and WhatsApp Flow steps.',
};

/**
 * The note shown on pages the shared test number can't serve (templates,
 * campaigns, automation steps), for a business that hasn't connected its own.
 */
export function SandboxNote({ kind }: { kind: 'templates' | 'flows' }) {
  const children = SANDBOX_NOTES[kind];
  return (
    <div className="crm-sandbox-note" role="note">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="16" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12.01" y2="8" />
      </svg>
      <span>{children}</span>
    </div>
  );
}
