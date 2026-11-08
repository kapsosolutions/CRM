// Log in, register and the CRM are made for a computer screen. On a phone
// (narrower than 768px) they show "open this on your laptop" instead, with a
// link copy, a way back to the website and "Continue anyway" (remembered for
// this tab). The website's pages (landing, pricing, docs …) work everywhere.
import { useEffect, useState, type ReactNode } from 'react';

const QUERY = '(max-width: 767px)';
const SKIP_KEY = 'kapso-mobile-continue';

function useNarrow() {
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(QUERY);
    if (!mq) return undefined;
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return narrow;
}

function LaptopArt() {
  return (
    <svg width="132" height="92" viewBox="0 0 132 92" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="18" y="6" width="96" height="62" rx="6" fill="#ecfdf5" stroke="#16a34a" strokeWidth="3" />
      <rect x="26" y="14" width="80" height="46" rx="3" fill="#ffffff" />
      <rect x="32" y="20" width="22" height="34" rx="2" fill="#dcfce7" />
      <rect x="58" y="22" width="40" height="6" rx="3" fill="#bbf7d0" />
      <rect x="58" y="32" width="30" height="6" rx="3" fill="#22c55e" />
      <rect x="58" y="42" width="36" height="6" rx="3" fill="#bbf7d0" />
      <path d="M6 72H126L120 82C119 84 117 85 115 85H17C15 85 13 84 12 82L6 72Z" fill="#16a34a" />
      <rect x="54" y="72" width="24" height="4" rx="2" fill="#bbf7d0" />
    </svg>
  );
}

export function DesktopOnly({ children, what = 'the CRM' }: { children: ReactNode; what?: string }) {
  const narrow = useNarrow();
  const [skip, setSkip] = useState(() => {
    try {
      return sessionStorage.getItem(SKIP_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [copied, setCopied] = useState(false);
  if (!narrow || skip) return <>{children}</>;

  const link = `${window.location.origin}/`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      /* no clipboard: the address is shown anyway */
    }
  };
  const goOn = () => {
    try {
      sessionStorage.setItem(SKIP_KEY, '1');
    } catch {
      /* private mode */
    }
    setSkip(true);
  };

  return (
    <div className="dk-only" data-testid="desktop-only">
      <a href="/" className="dk-only-logo" aria-label="Kapso Solutions home">
        <img src="/logo.png" alt="Kapso Solutions" />
      </a>
      <div className="dk-only-card">
        <LaptopArt />
        <h1>Open on your laptop or computer</h1>
        <p>
          {what === 'the CRM'
            ? 'The Kapso CRM is made for a bigger screen.'
            : `The ${what} and the Kapso CRM are made for a bigger screen.`}{' '}
          For the best experience, open <strong>{window.location.host}</strong> on your laptop or desktop.
        </p>
        <button type="button" className="dk-only-btn" onClick={copy} data-testid="desktop-only-copy">
          {copied ? 'Link copied' : 'Copy the link'}
        </button>
        <a href="/" className="dk-only-btn ghost">Back to the website</a>
        <button type="button" className="dk-only-skip" onClick={goOn} data-testid="desktop-only-continue">
          Continue on this phone anyway
        </button>
      </div>
    </div>
  );
}
