// Right-side notification drawer, opened from the bell in the top bar.
// Newest first, grouped Today / Earlier. Clicking an item marks it read and
// opens what it is about (the chat, template, campaign or order); each item
// can also be marked read on its own, or all at once.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CrmApi } from '../api';
import type { CrmSocket } from '../socket';
import type { AppNotification } from '../types';
import { dayKey, relativeTime } from '../utils';
import { BladeSpinner } from './BladeSpinner';
import { useConfirm, useNotify } from './Dialogs';
import './NotificationDrawer.css';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  api: CrmApi;
  /** Live feed (absent in demo mode). */
  socket?: CrmSocket | null;
  /** The unread count changed because of something done here. */
  onUnreadChange: (unread: number) => void;
  /** Open what the notification is about. The drawer has already closed. */
  onOpen: (n: AppNotification) => void;
}

/** Material icon + colour per type. */
const LOOK: Record<string, { icon: string; tone: string; label: string }> = {
  message: { icon: 'chat', tone: 'blue', label: 'New message' },
  template_approved: { icon: 'task_alt', tone: 'green', label: 'Template approved' },
  template_rejected: { icon: 'cancel', tone: 'red', label: 'Template rejected' },
  template_paused: { icon: 'pause_circle', tone: 'amber', label: 'Template paused' },
  campaign_finished: { icon: 'campaign', tone: 'violet', label: 'Campaign' },
  order_new: { icon: 'shopping_bag', tone: 'green', label: 'New order' },
  booking_new: { icon: 'event', tone: 'blue', label: 'Booking' },
  booking_cancelled: { icon: 'event_busy', tone: 'red', label: 'Cancellation' },
  booking_rescheduled: { icon: 'update', tone: 'amber', label: 'Rescheduled' },
  payment_received: { icon: 'payments', tone: 'green', label: 'Payment received' },
  payment_failed: { icon: 'error', tone: 'red', label: 'Payment failed' },
  whatsapp_connected: { icon: 'link', tone: 'green', label: 'WhatsApp connected' },
  sandbox_linked: { icon: 'person_add', tone: 'blue', label: 'Test customer linked' },
  sandbox_full: { icon: 'person_add_disabled', tone: 'amber', label: 'Test inbox is full' },
  plan_changed: { icon: 'workspace_premium', tone: 'violet', label: 'Plan changed' },
  plan_ending: { icon: 'schedule', tone: 'amber', label: 'Plan ending soon' },
  plan_ended: { icon: 'event_busy', tone: 'red', label: 'Plan ended' },
  channel_connected: { icon: 'link', tone: 'green', label: 'Channel connected' },
  channel_disconnected: { icon: 'link_off', tone: 'red', label: 'Channel disconnected' },
  ads_connected: { icon: 'campaign', tone: 'green', label: 'Facebook ads connected' },
  ads_disconnected: { icon: 'link_off', tone: 'red', label: 'Facebook ads disconnected' },
  ad_lead: { icon: 'person_add', tone: 'violet', label: 'New lead' },
  ad_campaign_created: { icon: 'rocket_launch', tone: 'blue', label: 'Campaign created (paused)' },
  ad_rejected: { icon: 'gpp_bad', tone: 'red', label: 'Ad rejected' },
  ad_audience_ready: { icon: 'groups', tone: 'blue', label: 'Audience uploaded' },
  ad_rule_triggered: { icon: 'rule', tone: 'amber', label: 'Automated rule ran' },
  ad_test_winner: { icon: 'emoji_events', tone: 'green', label: 'A/B test result' },
  catalog_connected: { icon: 'storefront', tone: 'green', label: 'Catalog connected' },
};
const lookOf = (type: string) => LOOK[type] || { icon: 'notifications', tone: 'gray', label: 'Notification' };

/** Newest first; an updated row (grouped chat) replaces its old copy. */
function upsert(list: AppNotification[], n: AppNotification): AppNotification[] {
  const rest = list.filter((x) => x._id !== n._id);
  const at = (x: AppNotification) => new Date(x.lastAt || x.createdAt || 0).getTime();
  return [n, ...rest].sort((a, b) => at(b) - at(a));
}

export function NotificationDrawer({ isOpen, onClose, api, socket, onUnreadChange, onOpen }: Props) {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [busyAll, setBusyAll] = useState(false);
  const [busyClear, setBusyClear] = useState(false);
  const confirm = useConfirm();
  const notify = useNotify();
  // Re-render every minute so "5m ago" keeps moving while the drawer is open.
  const [now, setNow] = useState(() => Date.now());
  const reqId = useRef(0);

  const loadFirst = useCallback(
    (quiet = false) => {
      const id = ++reqId.current;
      if (!quiet) setLoading(true);
      api
        .getNotifications(null)
        .then((r) => {
          if (id !== reqId.current) return;
          setItems(r.data || []);
          setNextBefore(r.nextBefore || null);
          setError('');
          onUnreadChange(r.unread || 0);
        })
        .catch((e: Error) => {
          if (id !== reqId.current) return;
          if (!quiet) setError(e.message || 'Could not load notifications.');
        })
        .finally(() => {
          if (id === reqId.current) setLoading(false);
        });
    },
    [api, onUnreadChange],
  );

  useEffect(() => {
    if (!isOpen) return undefined;
    setNow(Date.now());
    loadFirst();
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, [isOpen, loadFirst]);

  // Live while open: new/updated rows slot in; a read elsewhere reloads.
  useEffect(() => {
    if (!isOpen || !socket) return undefined;
    const offNew = socket.onNotification((e) => {
      if (e?.notification) setItems((list) => upsert(list, e.notification));
      setNow(Date.now());
    });
    const offCount = socket.onNotificationCount(() => loadFirst(true));
    return () => {
      offNew();
      offCount();
    };
  }, [isOpen, socket, loadFirst]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const loadMore = () => {
    if (!nextBefore || loadingMore) return;
    setLoadingMore(true);
    api
      .getNotifications(nextBefore)
      .then((r) => {
        setItems((list) => {
          const seen = new Set(list.map((x) => x._id));
          return [...list, ...(r.data || []).filter((x) => !seen.has(x._id))];
        });
        setNextBefore(r.nextBefore || null);
      })
      .catch(() => {})
      .finally(() => setLoadingMore(false));
  };

  const markRead = (n: AppNotification) => {
    if (n.read) return;
    const at = new Date().toISOString();
    setItems((list) => list.map((x) => (x._id === n._id ? { ...x, read: true, readAt: at } : x)));
    api
      .markNotificationRead(n._id)
      .then((r) => onUnreadChange(r.unread))
      .catch(() => loadFirst(true));
  };

  const clearAll = async () => {
    if (busyClear || !items.length) return;
    const ok = await confirm({
      title: 'Clear all notifications?',
      message: 'Every notification is removed from this list, read or not. Your chats, orders, bookings and templates aren’t touched.',
      confirmLabel: 'Clear all',
      tone: 'danger',
    });
    if (!ok) return;
    setBusyClear(true);
    // The live feed must not put the old rows back while this is in flight.
    reqId.current += 1;
    api
      .clearNotifications()
      .then(() => {
        setItems([]);
        setNextBefore(null);
        setError('');
        onUnreadChange(0);
        notify('success', 'Notifications cleared');
      })
      .catch((e: Error) => {
        notify('error', 'Couldn’t clear notifications', e.message || 'Please try again.');
        loadFirst(true);
      })
      .finally(() => setBusyClear(false));
  };

  const markAll = () => {
    if (busyAll) return;
    setBusyAll(true);
    api
      .markAllNotificationsRead()
      .then((r) => {
        const at = new Date().toISOString();
        setItems((list) => list.map((x) => (x.read ? x : { ...x, read: true, readAt: at })));
        onUnreadChange(r.unread || 0);
      })
      .catch(() => loadFirst(true))
      .finally(() => setBusyAll(false));
  };

  const open = (n: AppNotification) => {
    markRead(n);
    onClose();
    onOpen(n);
  };

  const groups = useMemo(() => {
    const today = dayKey(now);
    const t: AppNotification[] = [];
    const e: AppNotification[] = [];
    for (const n of items) (dayKey(n.lastAt || n.createdAt || 0) === today ? t : e).push(n);
    return [
      { key: 'today', label: 'Today', list: t },
      { key: 'earlier', label: 'Earlier', list: e },
    ].filter((g) => g.list.length);
  }, [items, now]);

  if (!isOpen) return null;
  const hasUnread = items.some((n) => !n.read);

  return (
    <div className="nd-backdrop" onClick={onClose}>
      <aside
        className="nd-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Notifications"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="nd-head">
          <h3>Notifications</h3>
          <div className="nd-head-actions">
            <button
              type="button"
              className="nd-read-all"
              onClick={markAll}
              data-testid="nd-read-all"
              disabled={!hasUnread || busyAll}
              title={hasUnread ? 'Mark every notification as read' : 'Nothing unread'}
            >
              <span className="material-icons" aria-hidden="true">done_all</span>
              Mark all as read
            </button>
            <button
              type="button"
              className="nd-clear-all"
              onClick={() => void clearAll()}
              disabled={!items.length || busyClear}
              title={items.length ? 'Remove every notification' : 'No notifications to clear'}
              data-testid="nd-clear-all"
            >
              <span className="material-icons" aria-hidden="true">delete_sweep</span>
              {busyClear ? 'Clearing…' : 'Clear all'}
            </button>
            <button type="button" className="nd-close" onClick={onClose} aria-label="Close notifications">
              <span className="material-icons" aria-hidden="true">close</span>
            </button>
          </div>
        </header>

        <div className="nd-body">
          {loading && !items.length ? (
            <div className="nd-state">
              <BladeSpinner center={true} containerHeight={120} />
            </div>
          ) : error && !items.length ? (
            <div className="nd-state">
              <span className="material-icons nd-state-icon" aria-hidden="true">cloud_off</span>
              <p>Couldn’t load notifications.</p>
              <button type="button" className="nd-retry" onClick={() => loadFirst()}>Try again</button>
            </div>
          ) : !items.length ? (
            <div className="nd-state nd-empty" data-testid="nd-empty">
              <span className="material-icons nd-state-icon" aria-hidden="true">notifications_none</span>
              <h4>You’re all caught up</h4>
              <p>New messages, orders, bookings, payments, campaign results and template updates will show up here.</p>
            </div>
          ) : (
            <>
              {groups.map((g) => (
                <section key={g.key} className="nd-group" data-group={g.key}>
                  <h4 className="nd-group-title">{g.label}</h4>
                  <ul className="nd-list">
                    {g.list.map((n) => {
                      const look = lookOf(n.type);
                      const at = n.lastAt || n.createdAt;
                      return (
                        <li key={n._id}>
                          <div
                            className={`nd-item${n.read ? '' : ' unread'}`}
                            role="button"
                            tabIndex={0}
                            data-type={n.type}
                            data-id={n._id}
                            onClick={() => open(n)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                open(n);
                              }
                            }}
                          >
                            <span className={`nd-icon tone-${look.tone}`} title={look.label}>
                              <span className="material-icons" aria-hidden="true">{look.icon}</span>
                            </span>
                            <span className="nd-text">
                              <span className="nd-title">{n.title}</span>
                              {n.body && <span className="nd-body-text">{n.body}</span>}
                              <time
                                className="nd-time"
                                dateTime={at || undefined}
                                title={at ? new Date(at).toLocaleString() : undefined}
                              >
                                {relativeTime(at, now)}
                              </time>
                            </span>
                            {!n.read && (
                              <button
                                type="button"
                                className="nd-mark"
                                title="Mark as read"
                                aria-label={`Mark “${n.title}” as read`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  markRead(n);
                                }}
                              >
                                <span className="nd-dot" aria-hidden="true" />
                                <span className="material-icons" aria-hidden="true">check</span>
                              </button>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
              {nextBefore && (
                <button type="button" className="nd-more" onClick={loadMore} disabled={loadingMore}>
                  {loadingMore ? 'Loading…' : 'Load more'}
                </button>
              )}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
