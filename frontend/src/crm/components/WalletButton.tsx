// Wallet (top bar): coming soon. Today Meta bills WhatsApp message charges
// straight to the business's own Meta account, so the wallet (prepaid
// message credit through a solution partner) is locked, and this opens
// Meta's billing page instead, where the business adds a payment method
// or funds. Meta doesn't let other apps read that balance, so no amount
// is shown here.
import { useState } from 'react';
import type { BusinessProfile } from '../types';
import { META_PRICING_PDF } from '../plans';
import './PlanLocked.css';

const metaBillingUrl = (b?: BusinessProfile) =>
  b?.wabaId
    ? `https://business.facebook.com/billing_hub/payment_settings/?asset_id=${encodeURIComponent(b.wabaId)}`
    : 'https://business.facebook.com/billing_hub/payment_settings/';

export function WalletButton({ business }: { business?: BusinessProfile }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="wl-btn"
        onClick={() => setOpen(true)}
        title="Wallet (coming soon)"
        aria-label="Wallet, coming soon"
        data-testid="wallet-btn"
      >
        <span className="material-icons" aria-hidden="true">account_balance_wallet</span>
        <span className="wl-label">Wallet</span>
        <span className="wl-soon"><span className="material-icons" aria-hidden="true">lock</span>Soon</span>
      </button>
      {open && (
        <div className="disc-backdrop app-dialog" onClick={() => setOpen(false)}>
          <div className="disc-box wl-box" role="dialog" aria-modal="true" aria-labelledby="wl-title" onClick={(e) => e.stopPropagation()} data-testid="wallet-dialog">
            <div className="disc-title" id="wl-title">
              <span className="material-icons" aria-hidden="true">account_balance_wallet</span>
              Wallet is coming soon
            </div>
            <p className="disc-text">
              Soon you&apos;ll top up message credit here and see your balance. Until then, Meta bills WhatsApp message
              charges directly to your Meta business account: add a payment method or funds on Meta&apos;s billing page.
            </p>
            <ul className="disc-points">
              <li>Your balance and charges are shown on Meta&apos;s billing page.</li>
              <li>
                Per-message prices by country: <a href={META_PRICING_PDF} target="_blank" rel="noopener noreferrer">Meta rates (PDF)</a>
              </li>
            </ul>
            <div className="disc-actions">
              <button type="button" className="disc-cancel" onClick={() => setOpen(false)}>Close</button>
              <a
                className="disc-discard wl-meta-btn"
                href={metaBillingUrl(business)}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="wallet-meta-link"
              >
                Open Meta billing
                <span className="material-icons" aria-hidden="true" style={{ fontSize: 16 }}>open_in_new</span>
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
