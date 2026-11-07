// Super-admin → Demo Requests: everyone who booked a demo from the landing
// page. Tabs for today / upcoming and each outcome; every row's status, notes
// and time can be changed in place.
import { BanIcon, CalendarIcon, CheckCircleIcon, ClockIcon, CloseIcon, ListIcon, MailIcon, PhoneMissedIcon, SearchIcon, TrashIcon, WhatsAppIcon } from './AdminIcons';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  platformApi, type DemoCounts, type DemoRequest, type DemoStatus, type DemoView,
} from './platformApi';
import { verticalConfig } from '../crm/verticals';
import { useConfirm, useNotify } from '../crm/components/Dialogs';
import { Pager, usePaged } from '../crm/components/Pager';
import { ContactMessagesPanel } from './ContactMessagesPanel';

const TABS: { key: DemoView; label: string; icon: ReactNode; count?: keyof DemoCounts }[] = [
  { key: 'today', label: 'Today', icon: <CalendarIcon />, count: 'today' },
  { key: 'upcoming', label: 'Upcoming', icon: <ClockIcon />, count: 'upcoming' },
  { key: 'completed', label: 'Completed', icon: <CheckCircleIcon />, count: 'completed' },
  { key: 'not_answered', label: 'Not answered', icon: <PhoneMissedIcon />, count: 'not_answered' },
  { key: 'not_interested', label: 'Not interested', icon: <BanIcon />, count: 'not_interested' },
  { key: 'missed', label: 'Needs update', icon: <ClockIcon /> },
  { key: 'all', label: 'All', icon: <ListIcon />, count: 'all' },
];

export const DEMO_STATUS: Record<DemoStatus, { label: string; tone: string }> = {
  scheduled: { label: 'Scheduled', tone: 'blue' },
  completed: { label: 'Completed', tone: 'green' },
  not_answered: { label: 'Not answered', tone: 'amber' },
  not_interested: { label: 'Not interested', tone: 'red' },
  cancelled: { label: 'Cancelled', tone: 'grey' },
};

const pad = (n: number) => String(n).padStart(2, '0');
function slotLabel(slot: string) {
  const [h, m] = slot.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`;
}
const dateLabel = (date: string, today: string) => {
  if (date === today) return 'Today';
  return new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
};
const waLink = (phone: string) => `https://wa.me/${String(phone).replace(/\D/g, '')}`;

export function DemoRequestsPage() {
  const notify = useNotify();
  const confirm = useConfirm();
  const [view, setView] = useState<DemoView>('today');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<DemoRequest[]>([]);
  const [counts, setCounts] = useState<DemoCounts | null>(null);
  const [today, setToday] = useState('');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<DemoRequest | null>(null);
  const [section, setSection] = useState<'demos' | 'messages'>('demos');
  const [newMessages, setNewMessages] = useState(0);

  // How many Contact page messages wait for a reply (shown on the tab).
  useEffect(() => {
    platformApi.listContacts('new').then((r) => setNewMessages(r.counts?.new || 0)).catch(() => {});
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    platformApi
      .listDemos(view, q.trim())
      .then((r) => {
        setRows(r.data || []);
        setCounts(r.counts);
        setToday(r.today);
      })
      .catch((e) => notify('error', 'Could not load demo requests', e instanceof Error ? e.message : undefined))
      .finally(() => setLoading(false));
  }, [view, q, notify]);

  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);
  const paged = usePaged(rows, `${view}|${q.trim()}`, { key: 'admin-demos', noun: ['demo request', 'demo requests'] });

  async function setStatus(r: DemoRequest, status: DemoStatus) {
    try {
      const res = await platformApi.updateDemo(r._id, { status });
      setCounts(res.counts);
      // It may no longer belong on this tab.
      load();
      notify('success', `Marked ${DEMO_STATUS[status].label.toLowerCase()}`, `${r.name} · ${r.businessName}`);
    } catch (e) {
      notify('error', 'Could not update', e instanceof Error ? e.message : undefined);
    }
  }

  async function remove(r: DemoRequest) {
    const ok = await confirm({
      title: 'Delete this demo request?',
      message: `${r.name} (${r.businessName}) will be removed from the list.`,
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    const res = await platformApi.deleteDemo(r._id);
    setCounts(res.counts);
    load();
  }

  const head = (
    <header className="pa-page-head">
      <div>
        <h1>Demo Requests</h1>
        <p className="pa-page-sub">
          {section === 'demos' ? 'Demos booked from the website. Times are India Standard Time.' : 'Messages sent from the website’s Contact page.'}
        </p>
      </div>
      <div className="pa-segments" role="tablist" aria-label="Section">
        <button role="tab" aria-selected={section === 'demos'} className={`pa-seg${section === 'demos' ? ' on' : ''}`} onClick={() => setSection('demos')}>
          Demos
        </button>
        <button role="tab" aria-selected={section === 'messages'} className={`pa-seg${section === 'messages' ? ' on' : ''}`} onClick={() => setSection('messages')} data-testid="admin-contact-tab">
          Messages
          {newMessages > 0 && <span className="dr-count">{newMessages}</span>}
        </button>
      </div>
    </header>
  );

  if (section === 'messages') {
    return (
      <div className="pa-page">
        {head}
        <ContactMessagesPanel onCount={setNewMessages} />
      </div>
    );
  }

  return (
    <div className="pa-page">
      {head}

      {/* ---------- Summary cards ---------- */}
      <div className="pa-stat-grid">
        {TABS.filter((t) => ['today', 'upcoming', 'completed', 'not_answered', 'not_interested'].includes(t.key)).map((t) => (
          <button
            type="button"
            key={t.key}
            className={`pa-stat dr-stat${view === t.key ? ' on' : ''}`}
            onClick={() => setView(t.key)}
          >
            <div className="pa-stat-top"><span className="pa-ico">{t.icon}</span>{t.label}</div>
            <div className="pa-stat-val">{counts && t.count ? counts[t.count] : '–'}</div>
          </button>
        ))}
      </div>

      {/* ---------- Filters ---------- */}
      <div className="pa-toolbar">
        <div className="pa-search">
          <span className="pa-ico"><SearchIcon /></span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, business, email, number…" />
        </div>
        <div className="pa-segments" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={view === t.key}
              className={`pa-seg${view === t.key ? ' on' : ''}`}
              onClick={() => setView(t.key)}
            >
              {t.label}
              {counts && t.count && counts[t.count] > 0 ? <span className="dr-count">{counts[t.count]}</span> : null}
            </button>
          ))}
        </div>
      </div>

      {/* ---------- List ---------- */}
      {loading && rows.length === 0 && <div className="pa-note">Loading…</div>}
      {!loading && rows.length === 0 && (
        <div className="pa-note">
          {view === 'today' ? 'No demos today.' : view === 'missed' ? 'Every past demo has an outcome.' : 'Nothing here yet.'}
        </div>
      )}

      {rows.length > 0 && (
        <div className="pa-table-wrap">
          <table className="pa-table dr-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Person</th>
                <th>Contact</th>
                <th>Category</th>
                <th>Status</th>
                <th>Notes</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {paged.items.map((r) => (
                <tr key={r._id} className={r.status === 'cancelled' ? 'off' : ''} onClick={() => setEditing(r)}>
                  <td>
                    <div className="dr-when">
                      <strong>{slotLabel(r.slot)}</strong>
                      <small className={r.date === today ? 'today' : ''}>{dateLabel(r.date, today)}</small>
                    </div>
                  </td>
                  <td>
                    <div className="pa-cell-main">
                      <span className="pa-avatar">{(r.name || '?').slice(0, 1).toUpperCase()}</span>
                      <div>
                        <strong>{r.name}</strong>
                        <small>{r.businessName}</small>
                      </div>
                    </div>
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div className="dr-contact">
                      <a href={waLink(r.phone)} target="_blank" rel="noreferrer" title="Open in WhatsApp">
                        <span className="pa-ico"><WhatsAppIcon /></span>+{r.phone}
                      </a>
                      <a href={`mailto:${r.email}`} title="Send an email">
                        <span className="pa-ico"><MailIcon /></span>{r.email}
                      </a>
                    </div>
                  </td>
                  <td><span className="pa-badge cat">{verticalConfig(r.category).label}</span></td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <select
                      className={`dr-status ${DEMO_STATUS[r.status].tone}`}
                      value={r.status}
                      onChange={(e) => setStatus(r, e.target.value as DemoStatus)}
                      aria-label={`Status for ${r.name}`}
                    >
                      {(Object.keys(DEMO_STATUS) as DemoStatus[]).map((s) => (
                        <option key={s} value={s}>{DEMO_STATUS[s].label}</option>
                      ))}
                    </select>
                  </td>
                  <td className="dr-notes">{r.notes || <span className="dr-muted">—</span>}</td>
                  <td className="pa-row-actions" onClick={(e) => e.stopPropagation()}>
                    <button className="pa-btn ghost sm" onClick={() => setEditing(r)}>Open</button>
                    <button className="pa-btn ghost sm" onClick={() => remove(r)} aria-label="Delete">
                      <TrashIcon />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > 0 && <Pager {...paged.pager} />}

      {editing && (
        <DemoEditor
          demo={editing}
          onClose={() => setEditing(null)}
          onSaved={(c) => {
            setCounts(c);
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

/** Notes, status and reschedule for one request. */
function DemoEditor({
  demo, onClose, onSaved,
}: {
  demo: DemoRequest;
  onClose: () => void;
  onSaved: (counts: DemoCounts) => void;
}) {
  const notify = useNotify();
  const [status, setStatus] = useState<DemoStatus>(demo.status);
  const [notes, setNotes] = useState(demo.notes || '');
  const [date, setDate] = useState(demo.date);
  const [slot, setSlot] = useState(demo.slot);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function save() {
    setSaving(true);
    try {
      const body: Parameters<typeof platformApi.updateDemo>[1] = { notes };
      const moved = date !== demo.date || slot !== demo.slot;
      if (moved) Object.assign(body, { date, slot });
      // Moving the time puts the demo back to Scheduled (the server does that
      // when no status is sent); a status picked here still wins.
      if (status !== demo.status) body.status = status;
      const r = await platformApi.updateDemo(demo._id, body);
      notify('success', 'Saved', moved ? `Moved to ${date} ${slot}` : undefined);
      onSaved(r.counts);
    } catch (e) {
      notify('error', 'Could not save', e instanceof Error ? e.message : undefined);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="dr-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dr-box" role="dialog" aria-modal="true" aria-label={`Demo with ${demo.name}`}>
        <div className="dr-box-head">
          <div>
            <h3>{demo.name}</h3>
            <small>{demo.businessName} · {verticalConfig(demo.category).label}</small>
          </div>
          <button className="dr-x" onClick={onClose} aria-label="Close"><CloseIcon /></button>
        </div>
        <div className="dr-box-body">
          <div className="dr-contact block">
            <a href={waLink(demo.phone)} target="_blank" rel="noreferrer"><span className="pa-ico"><WhatsAppIcon /></span>+{demo.phone}</a>
            <a href={`mailto:${demo.email}`}><span className="pa-ico"><MailIcon /></span>{demo.email}</a>
          </div>
          <div className="pa-form-grid">
            <label className="pa-field">
              <span>Status</span>
              <select value={status} onChange={(e) => setStatus(e.target.value as DemoStatus)}>
                {(Object.keys(DEMO_STATUS) as DemoStatus[]).map((s) => <option key={s} value={s}>{DEMO_STATUS[s].label}</option>)}
              </select>
            </label>
            <div className="pa-field">
              <span>Date &amp; time (IST)</span>
              <div className="dr-when-edit">
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
                <input type="time" value={slot} step={900} onChange={(e) => setSlot(e.target.value)} aria-label="Time" />
              </div>
            </div>
            <label className="pa-field wide">
              <span>Notes</span>
              <textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What was discussed, follow-up, plan they’re interested in…" />
            </label>
          </div>
          <p className="dr-muted sm">
            Booked {demo.createdAt ? new Date(demo.createdAt).toLocaleString('en-IN') : ''}
            {demo.statusChangedAt ? ` · status changed ${new Date(demo.statusChangedAt).toLocaleString('en-IN')}` : ''}
          </p>
        </div>
        <div className="dr-box-foot">
          <button className="pa-btn ghost" onClick={onClose}>Cancel</button>
          <button className="pa-btn" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}
