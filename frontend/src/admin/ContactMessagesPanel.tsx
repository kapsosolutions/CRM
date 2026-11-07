// Super-admin → Demo Requests → Messages: what visitors sent from the
// website's Contact page (/contact). Mark each one replied or closed.
import { useCallback, useEffect, useState } from 'react';
import { platformApi, type ContactMessage, type ContactStatus } from './platformApi';
import { MailIcon, WhatsAppIcon } from './AdminIcons';
import { useNotify } from '../crm/components/Dialogs';
import { Pager, usePaged } from '../crm/components/Pager';

const STATUS: Record<ContactStatus, { label: string; tone: string }> = {
  new: { label: 'New', tone: 'blue' },
  replied: { label: 'Replied', tone: 'green' },
  closed: { label: 'Closed', tone: 'grey' },
};
const TOPIC: Record<ContactMessage['topic'], string> = {
  sales: 'Plans & pricing', support: 'Account help', api: 'API', partnership: 'Partnership', other: 'Other',
};
const FILTERS: { key: ContactStatus | 'all'; label: string }[] = [
  { key: 'new', label: 'New' },
  { key: 'replied', label: 'Replied' },
  { key: 'closed', label: 'Closed' },
  { key: 'all', label: 'All' },
];

export function ContactMessagesPanel({ onCount }: { onCount?: (n: number) => void }) {
  const notify = useNotify();
  const [filter, setFilter] = useState<ContactStatus | 'all'>('new');
  const [rows, setRows] = useState<ContactMessage[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    platformApi
      .listContacts(filter)
      .then((r) => {
        setRows(r.data || []);
        onCount?.(r.counts?.new || 0);
      })
      .catch((e) => notify('error', 'Could not load messages', e instanceof Error ? e.message : undefined))
      .finally(() => setLoading(false));
  }, [filter, notify, onCount]);
  useEffect(load, [load]);
  const paged = usePaged(rows, filter, { key: 'admin-contacts', noun: ['message', 'messages'] });

  async function setStatus(m: ContactMessage, status: ContactStatus) {
    try {
      await platformApi.updateContact(m._id, { status });
      notify('success', `Marked ${STATUS[status].label.toLowerCase()}`, m.name);
      load();
    } catch (e) {
      notify('error', 'Could not update', e instanceof Error ? e.message : undefined);
    }
  }

  return (
    <>
      <div className="pa-toolbar">
        <div className="pa-segments" role="tablist" aria-label="Message status">
          {FILTERS.map((f) => (
            <button key={f.key} role="tab" aria-selected={filter === f.key} className={`pa-seg${filter === f.key ? ' on' : ''}`} onClick={() => setFilter(f.key)}>
              {f.label}
            </button>
          ))}
        </div>
      </div>
      {loading && rows.length === 0 && <div className="pa-note">Loading…</div>}
      {!loading && rows.length === 0 && <div className="pa-note">{filter === 'new' ? 'No new messages.' : 'Nothing here yet.'}</div>}
      {rows.length > 0 && (
        <div className="pa-table-wrap">
          <table className="pa-table dr-table" data-testid="contact-messages">
            <thead>
              <tr>
                <th>Received</th>
                <th>Person</th>
                <th>Contact</th>
                <th>Topic</th>
                <th>Message</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {paged.items.map((m) => (
                <tr key={m._id} className={m.status === 'closed' ? 'off' : ''}>
                  <td>
                    <div className="dr-when">
                      <strong>{m.createdAt ? new Date(m.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : ''}</strong>
                      <small>{m.createdAt ? new Date(m.createdAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : ''}</small>
                    </div>
                  </td>
                  <td>
                    <div className="pa-cell-main">
                      <span className="pa-avatar">{(m.name || '?').slice(0, 1).toUpperCase()}</span>
                      <div>
                        <strong>{m.name}</strong>
                        {m.company && <small>{m.company}</small>}
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="dr-contact">
                      <a href={`mailto:${m.email}`} title="Send an email"><span className="pa-ico"><MailIcon /></span>{m.email}</a>
                      {m.phone && (
                        <a href={`https://wa.me/${m.phone}`} target="_blank" rel="noreferrer" title="Open in WhatsApp">
                          <span className="pa-ico"><WhatsAppIcon /></span>+{m.phone}
                        </a>
                      )}
                    </div>
                  </td>
                  <td><span className="pa-badge cat">{TOPIC[m.topic] || m.topic}</span></td>
                  <td className="dr-notes cm-message">{m.message}</td>
                  <td>
                    <select
                      className={`dr-status ${STATUS[m.status]?.tone || 'grey'}`}
                      value={m.status}
                      onChange={(e) => setStatus(m, e.target.value as ContactStatus)}
                      aria-label={`Status for ${m.name}`}
                    >
                      {(Object.keys(STATUS) as ContactStatus[]).map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > 0 && <Pager {...paged.pager} />}
    </>
  );
}
