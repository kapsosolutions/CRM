// Super-admin → Businesses: a searchable table of tenants. Row click opens the
// business detail page. Businesses aren't added here any more: owners register
// on the site and connect WhatsApp themselves through Embedded Signup.
import { useEffect, useMemo, useState } from 'react';
import { platformApi, type Business } from './platformApi';
import { verticalConfig } from '../crm/verticals';
import { numberStatusLabel, numberStatusTone } from '../crm/numberStatus';
import type { PlanState } from '../crm/types';

const shortDate = (s?: string | null) =>
  s ? new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

/**
 * The plan in force. "New" while the 7-day free trial runs (it goes when the
 * trial ends); the paid plan with its end date; "Free" after a trial or plan ended.
 */
export function PlanCell({ s }: { s?: PlanState }) {
  if (!s) return <span className="pa-muted">—</span>;
  if (s.status === 'trial') {
    return (
      <div className="pa-plan-cell">
        <span className="pa-badge plan-new" data-testid="pa-plan-new">New</span>
        <small>Trial · {s.daysLeft === 1 ? '1 day' : `${s.daysLeft} days`} left</small>
      </div>
    );
  }
  if (s.status === 'active') {
    return (
      <div className="pa-plan-cell">
        <span className={`pa-badge plan-${s.tier}`}>{s.name}</span>
        <small>until {shortDate(s.endsAt)}{s.source === 'admin' ? ' · given by admin' : ''}</small>
      </div>
    );
  }
  if (s.status === 'legacy') {
    return (
      <div className="pa-plan-cell">
        <span className={`pa-badge plan-${s.tier}`}>{s.name}</span>
        <small>joined before plans</small>
      </div>
    );
  }
  return (
    <div className="pa-plan-cell">
      <span className="pa-badge plan-free">Free</span>
      {s.ended?.at && <small>{s.ended.kind === 'trial' ? 'trial' : s.ended.name} ended {shortDate(s.ended.at)}</small>}
    </div>
  );
}

const fmtDate = (s?: string) =>
  s ? new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export function BusinessesPage({ onOpen }: { onOpen: (id: string) => void }) {
  const [list, setList] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'all' | 'active' | 'inactive'>('all');

  function load() {
    setLoading(true);
    platformApi
      .listBusinesses()
      .then((r) => setList(r.data || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    load();
  }, []);

  async function toggle(b: Business) {
    await platformApi.setBusinessActive(b._id, !b.active);
    load();
  }

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return list.filter((b) => {
      if (status === 'active' && !b.active) return false;
      if (status === 'inactive' && b.active) return false;
      if (!needle) return true;
      return [b.name, b.username, b.email, b.phoneNumberId, b.meta?.displayPhoneNumber, verticalConfig(b.category).label]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle));
    });
  }, [list, q, status]);

  // Connected = Meta says CONNECTED, not just "a token is stored".
  const connected = list.filter((b) => b.whatsappConnected && b.numberStatus === 'CONNECTED').length;
  const notLive = list.filter((b) => b.whatsappConnected && b.numberStatus !== 'CONNECTED').length;

  return (
    <div className="pa-page">
      <header className="pa-page-head">
        <div>
          <h1>Businesses</h1>
          <p className="pa-page-sub">
            {list.length} business{list.length === 1 ? '' : 'es'} · {list.filter((b) => b.active).length} active ·{' '}
            {connected} with WhatsApp connected
            {notLive > 0 && ` · ${notLive} linked but not connected (Pending or other status)`}
          </p>
        </div>
      </header>

      {error && <div className="pa-error">{error}</div>}

      {/* ---------- Filters ---------- */}
      <div className="pa-toolbar">
        <div className="pa-search">
          <span className="material-icons">search</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, number…" />
        </div>
        <div className="pa-segments">
          {(['all', 'active', 'inactive'] as const).map((s) => (
            <button key={s} className={`pa-seg${status === s ? ' on' : ''}`} onClick={() => setStatus(s)}>
              {s[0].toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* ---------- List ---------- */}
      {loading && <div className="pa-note">Loading…</div>}
      {!loading && list.length === 0 && (
        <div className="pa-note">No businesses yet. They appear here as soon as someone registers on the site.</div>
      )}
      {!loading && list.length > 0 && shown.length === 0 && (
        <div className="pa-note">No businesses match that search.</div>
      )}

      {shown.length > 0 && (
        <div className="pa-table-wrap">
          <table className="pa-table">
            <thead>
              <tr>
                <th>Business</th>
                <th>Category</th>
                <th>WhatsApp number</th>
                <th>Plan</th>
                <th>Login</th>
                <th>Added</th>
                <th>Status</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {shown.map((b) => (
                <tr key={b._id} className={b.active ? '' : 'off'} onClick={() => onOpen(b._id)}>
                  <td>
                    <div className="pa-cell-main">
                      <span className="pa-avatar">{b.name.slice(0, 1).toUpperCase()}</span>
                      <div>
                        <strong>{b.name}</strong>
                        {b.meta?.verifiedName && b.meta.verifiedName !== b.name && <small>{b.meta.verifiedName}</small>}
                      </div>
                    </div>
                  </td>
                  <td><span className="pa-badge cat">{verticalConfig(b.category).label}</span></td>
                  <td className="mono">
                    {b.whatsappConnected ? (
                      <div className="pa-num-cell">
                        <span>{b.meta?.displayPhoneNumber || b.phoneNumberId}</span>
                        <span
                          className={`pa-badge num-${numberStatusTone(b.numberStatus)}`}
                          title={b.numberStatus
                            ? `Meta reports this number as ${numberStatusLabel(b.numberStatus)}${b.numberStatusLive ? '' : ' (last stored status; Meta could not be read just now)'}`
                            : "Meta's status for this number couldn't be read"}
                          data-testid="pa-number-status"
                        >
                          {numberStatusLabel(b.numberStatus) || 'Unknown'}
                        </span>
                      </div>
                    ) : <span className="pa-badge off">Not connected</span>}
                  </td>
                  <td data-testid="pa-plan-cell"><PlanCell s={b.planState} /></td>
                  <td className="mono">{b.email || `@${b.username}`}</td>
                  <td>{fmtDate(b.createdAt)}</td>
                  <td>
                    <span className={`pa-badge ${b.active ? 'on' : 'off'}`}>{b.active ? 'Active' : 'Inactive'}</span>
                  </td>
                  <td className="pa-row-actions" onClick={(e) => e.stopPropagation()}>
                    <button className="pa-btn ghost sm" onClick={() => toggle(b)}>
                      {b.active ? 'Deactivate' : 'Activate'}
                    </button>
                    <button className="pa-btn ghost sm" onClick={() => onOpen(b._id)}>Open</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
