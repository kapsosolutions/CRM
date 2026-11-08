// The live event's announcements (admin panel → Events), a bar across the
// top of the CRM. With several, they take turns: the first, then the next…
// and round again, each for the event's `seconds` (paused while the pointer
// is on the bar; the dots jump to one). A business can close the bar for
// now: moving between CRM pages keeps it closed, but it shows again when the
// page is reloaded or the CRM is opened again (nothing is remembered), and
// when the admin changes the event.
import { useEffect, useState, type CSSProperties } from 'react';
import { announcementItems, type LiveEvent } from '../../event/liveEvent';
import '../../event/event.css';

// Older builds remembered a close here for good; forget it.
try {
  localStorage.removeItem('kapso-announcement-closed');
} catch {
  /* private mode */
}

export function EventAnnouncement({ event }: { event: LiveEvent | null }) {
  const a = event?.theme.announcement;
  const items = announcementItems(a);
  const seconds = Math.min(30, Math.max(3, Number(a?.seconds) || 6));
  const stamp = event ? `${event.id}:${event.updatedAt || ''}` : '';
  const [closed, setClosed] = useState('');
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const count = items.length;
  useEffect(() => {
    if (count < 2 || paused) return undefined;
    const t = window.setTimeout(() => setIndex((i) => (i + 1) % count), seconds * 1000);
    return () => window.clearTimeout(t);
  }, [count, paused, seconds, index]);

  if (!event || !a?.enabled || !count || (closed === stamp && !event.preview)) return null;

  const close = () => setClosed(stamp);
  const i = index % count;
  const it = items[i];
  // CRM pages (/#/app/…) open here; anything else (the website, another site) in a new tab.
  const link = it.linkUrl || '';
  const inApp = link.startsWith('/#/');
  const style = { ...(it.bg ? { '--ev-ann-bg': it.bg } : {}), ...(it.color ? { '--ev-ann-color': it.color } : {}) } as CSSProperties;

  return (
    <div
      className={`ev-announce${count > 1 ? ' many' : ''}`}
      style={style}
      role="region"
      aria-label="Announcement"
      aria-live="polite"
      data-testid="event-announcement"
      data-index={i}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {/* Keyed on the item, so each one slides in. */}
      <div className="ev-announce-item" key={i}>
        {it.image && <img className="ev-announce-img" src={it.image} alt="" aria-hidden="true" />}
        <span className="ev-announce-text">{it.text}</span>
        {link && (
          <a className="ev-announce-link" href={link} {...(inApp ? {} : { target: '_blank', rel: 'noopener noreferrer' })}>
            {it.linkLabel || 'Learn more'}
          </a>
        )}
      </div>
      {count > 1 && (
        <div className="ev-announce-dots" role="tablist" aria-label="Announcements">
          {items.map((_, n) => (
            <button
              key={n}
              type="button"
              role="tab"
              aria-selected={n === i}
              aria-label={`Announcement ${n + 1} of ${count}`}
              className={`ev-announce-dot${n === i ? ' on' : ''}`}
              onClick={() => setIndex(n)}
              data-testid="event-announcement-dot"
            />
          ))}
        </div>
      )}
      <button type="button" className="ev-announce-close" onClick={close} aria-label="Close the announcement" title="Close">✕</button>
    </div>
  );
}
