// The live event's announcement (admin panel → Events), a bar across the top
// of the CRM. A business can close it; it comes back when the admin changes
// the announcement.
import { useState, type CSSProperties } from 'react';
import type { LiveEvent } from '../../event/liveEvent';
import '../../event/event.css';

const DISMISS_KEY = 'kapso-announcement-closed';

export function EventAnnouncement({ event }: { event: LiveEvent | null }) {
  const a = event?.theme.announcement;
  const stamp = event ? `${event.id}:${event.updatedAt || ''}` : '';
  const [closed, setClosed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) || '';
    } catch {
      return '';
    }
  });
  if (!event || !a?.enabled || !a.text || (closed === stamp && !event.preview)) return null;

  const close = () => {
    setClosed(stamp);
    try {
      localStorage.setItem(DISMISS_KEY, stamp);
    } catch {
      /* private mode */
    }
  };
  // CRM pages (/#/app/…) open here; anything else (the website, another site) in a new tab.
  const link = a.linkUrl || '';
  const inApp = link.startsWith('/#/');
  const style = { ...(a.bg ? { '--ev-ann-bg': a.bg } : {}), ...(a.color ? { '--ev-ann-color': a.color } : {}) } as CSSProperties;

  return (
    <div className="ev-announce" style={style} role="region" aria-label="Announcement" data-testid="event-announcement">
      {a.image && <img className="ev-announce-img" src={a.image} alt="" aria-hidden="true" />}
      <span className="ev-announce-text">{a.text}</span>
      {link && (
        <a className="ev-announce-link" href={link} {...(inApp ? {} : { target: '_blank', rel: 'noopener noreferrer' })}>
          {a.linkLabel || 'Learn more'}
        </a>
      )}
      <button type="button" className="ev-announce-close" onClick={close} aria-label="Close the announcement" title="Close">✕</button>
    </div>
  );
}
