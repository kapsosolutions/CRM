// While the admin previews an event (Events → Preview), a small badge says
// so, with a way out. Visitors never see it.
import { useLiveEvent } from './liveEvent';
import './event.css';

export function EventPreviewBadge() {
  const ev = useLiveEvent();
  if (!ev?.preview) return null;
  const exit = () => {
    const u = new URL(window.location.href);
    u.searchParams.set('eventPreview', 'off');
    window.location.href = u.toString();
  };
  return (
    <div className="ev-preview-badge" role="status" data-testid="event-preview-badge">
      <span>Previewing “{ev.name}”</span>
      <button type="button" onClick={exit}>Exit preview</button>
    </div>
  );
}
