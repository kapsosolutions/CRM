// The phone mocks' iOS status bar: the time, the dynamic island, signal, 5G
// and battery. One design for every preview (business profile, templates,
// catalog, flows); the frame around it is PhoneFrame.css's .pf-frame look.
import { useMemo } from 'react';
import './PhoneFrame.css';

export function PhoneStatusBar() {
  // The time when the preview opened, as the phone shows it (12-hour, no am/pm).
  const time = useMemo(() => {
    const d = new Date();
    return `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')}`;
  }, []);
  return (
    <div className="pf-status" aria-hidden="true">
      <span className="pf-time">{time}</span>
      <div className="pf-island">
        <span className="pf-island-dot" />
      </div>
      <div className="pf-icons">
        {/* Cellular */}
        <svg width="14" height="10" viewBox="0 0 16 12" fill="currentColor">
          <rect x="0.5" y="8" width="2" height="4" rx="0.5" />
          <rect x="4" y="6" width="2" height="6" rx="0.5" />
          <rect x="7.5" y="3.5" width="2" height="8.5" rx="0.5" />
          <rect x="11" y="0.5" width="2" height="11.5" rx="0.5" />
        </svg>
        <span className="pf-5g">5G</span>
        {/* Battery */}
        <svg width="18" height="10" viewBox="0 0 22 12" fill="none" stroke="currentColor" strokeWidth="1.2">
          <rect x="0.6" y="0.6" width="18" height="10.8" rx="2.5" />
          <rect x="2.5" y="2.5" width="14" height="7" rx="1.5" fill="#16a34a" stroke="none" />
          <path d="M20 4.5v3" strokeLinecap="round" />
        </svg>
      </div>
    </div>
  );
}
