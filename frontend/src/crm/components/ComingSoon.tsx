// "Coming soon" for the features waiting for Meta's approval (features.ts).
// The screen looks like the other "Connect …" screens (logos ⇄ Meta, headline,
// benefits, a green button); its "Get started" opens a "Coming soon" popup
// instead of a connect flow. A small "Soon" pill marks tabs and rows.
import { useEffect, useState } from 'react';
import type { SoonFeature } from '../features';
import { BenefitCheckIcon, MetaInfinityLogo } from './WhatsAppConnectRequired';
import './WhatsAppConnectRequired.css';
import './ComingSoon.css';

const INFO: Record<SoonFeature, {
  name: string;
  icons: string[];
  title: string;
  subtitle: string;
  benefitsTitle: string;
  benefits: string[];
}> = {
  ads: {
    name: 'Ads',
    icons: ['/channel-ads.svg'],
    title: 'Connect your Meta ad account to run Ads',
    subtitle: 'Run Facebook and Instagram ads that open a WhatsApp chat with you.\nSee spend, reach and every lead right here in the CRM.',
    benefitsTitle: 'Benefits of connecting your ad account',
    benefits: [
      'Create Click-to-WhatsApp campaigns from the CRM',
      'Spend, reach and lead reports for every campaign',
      'Lead forms with every lead saved as a contact',
    ],
  },
  instagram: {
    name: 'Instagram',
    icons: ['/channel-instagram.svg'],
    title: 'To experience messaging, connect your Instagram account',
    subtitle: 'Once connected, you can start chatting with customers on Instagram Direct',
    benefitsTitle: 'Benefits of connecting your own account',
    benefits: [
      'Chat directly with Instagram Direct customers',
      'Unified inbox with WhatsApp and Facebook',
      'Reply with text and photos from the CRM',
    ],
  },
  messenger: {
    name: 'Messenger',
    icons: ['/channel-messenger.svg'],
    title: 'To experience messaging, connect your Facebook Page',
    subtitle: 'Once connected, you can start chatting with customers on Facebook Messenger',
    benefitsTitle: 'Benefits of connecting your own page',
    benefits: [
      'Chat directly with Facebook Page customers',
      'Unified inbox with WhatsApp and Instagram',
      'Reply with text and photos from the CRM',
    ],
  },
  create: {
    name: 'Create',
    icons: ['/channel-facebook.svg', '/channel-instagram.svg'],
    title: 'Publish to Facebook and Instagram from the CRM',
    subtitle: 'Create posts, reels and stories for your Facebook Page and Instagram.\nPublish them now or schedule them for later.',
    benefitsTitle: 'Benefits of connecting your accounts',
    benefits: [
      'Posts, carousels, reels and stories in one place',
      'Schedule them ahead and see how each one went',
      'Automatic DMs to everyone who comments',
    ],
  },
};

/** "Coming soon" popup: what "Get started" opens while the feature is locked. */
function SoonModal({ feature, onClose }: { feature: SoonFeature; onClose: () => void }) {
  const info = INFO[feature];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="soon-backdrop" onClick={onClose} role="presentation">
      <div
        className="soon-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="soon-modal-title"
        onClick={(e) => e.stopPropagation()}
        data-testid="soon-modal"
      >
        <div className="soon-modal-icons">
          {info.icons.map((src) => <img key={src} src={src} alt="" />)}
          <span className="material-icons soon-modal-lock" aria-hidden="true">lock</span>
        </div>
        <span className="soon-pill lg">Coming soon</span>
        <h3 id="soon-modal-title">{info.name} {feature === 'ads' ? 'are' : 'is'} coming soon</h3>
        <p>
          We’re waiting for Meta to approve {info.name} for every business. It will switch on here by itself,
          with nothing for you to set up now.
        </p>
        <p className="soon-modal-note">Meanwhile, WhatsApp chats, templates, campaigns, catalog and automation are ready to use.</p>
        <button type="button" className="soon-modal-ok" onClick={onClose} autoFocus data-testid="soon-modal-ok">
          OK, got it
        </button>
      </div>
    </div>
  );
}

/** The "Connect …" screen of a feature that isn't open yet. */
export function ComingSoonPanel({
  feature,
  compact = false,
}: {
  feature: SoonFeature;
  /** Inside another page (Channel Status, Automation) rather than a whole page. */
  compact?: boolean;
  /** Kept for callers; the screen no longer has a back button. */
  onBack?: () => void;
  backLabel?: string;
}) {
  const info = INFO[feature];
  const [open, setOpen] = useState(false);
  return (
    <div className={`wa-req-wrapper soon-screen${compact ? ' compact' : ''}`} data-testid={`soon-${feature}`}>
      <div className="wa-req-box">
        <div className="wa-req-logos-row">
          {info.icons.map((src) => <img key={src} src={src} alt="" className="wa-req-logo-img" />)}
          <span className="wa-req-arrow">⇄</span>
          <MetaInfinityLogo width={46} height={31} />
        </div>

        <h2 className="wa-req-headline">{info.title}</h2>
        <p className="wa-req-subline">
          {info.subtitle.split('\n').map((line, idx, arr) => (
            <span key={line}>
              {line}
              {idx < arr.length - 1 && <br />}
            </span>
          ))}
        </p>

        <div className="wa-req-benefits-box">
          <h3 className="wa-req-benefits-title">{info.benefitsTitle}</h3>
          <ul className="wa-req-benefits-list">
            {info.benefits.map((b) => (
              <li key={b} className="wa-req-benefit-item">
                <BenefitCheckIcon />
                <span>{b}</span>
              </li>
            ))}
          </ul>

          <div className="wa-req-cta-row">
            <button type="button" className="soon-start-btn" onClick={() => setOpen(true)} data-testid={`soon-${feature}-start`}>
              Get started
              <span className="material-icons" aria-hidden="true">arrow_forward</span>
            </button>
          </div>
        </div>
      </div>
      {open && <SoonModal feature={feature} onClose={() => setOpen(false)} />}
    </div>
  );
}

/** The small "Soon" badge for tabs, rail buttons and rows. */
export function SoonPill({ className = '' }: { className?: string }) {
  return <span className={`soon-pill${className ? ` ${className}` : ''}`}>Soon</span>;
}

/** The whole page for a rail item that isn't open yet (Ads, Create). */
export function ComingSoonPage({ feature }: { feature: SoonFeature; title?: string; onBack?: () => void }) {
  return (
    <div className="page soon-page" data-testid={`soon-page-${feature}`}>
      <ComingSoonPanel feature={feature} />
    </div>
  );
}

export default ComingSoonPanel;
