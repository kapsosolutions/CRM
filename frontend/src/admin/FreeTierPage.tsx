// Super-admin → Free tier: businesses on the 7-day free trial ("New") and the
// ones with no plan after it, and handing someone a trial of the CRM.
//
// Onboarding is identical to a normal business (same Meta credentials, same
// Graph verification): the tenant gets the free trial (every feature), then
// only the Starter features unless it buys a plan in
// Settings → Billing. The generated username + passcode are what you pass to
// the trial user.
//
// Restart trial issues a new passcode AND starts a fresh trial. It also signs
// out whoever is using the old passcode, so a trial can't be quietly shared.
import { useEffect, useMemo, useState } from 'react';
import { platformApi, type Business, type CreatedCredentials, type VerifyResult } from './platformApi';
import { verticalConfig } from '../crm/verticals';
import { Copyable } from './Copyable';
import { useConfirm } from '../crm/components/Dialogs';
import { BLANK_CREDS, MetaCredentialFields, VerifyPanel, canCheckCreds } from './MetaCredentialsForm';
import { PlanCell } from './BusinessesPage';
import { Pager, usePaged } from '../crm/components/Pager';

const DEFAULT_TRIAL_DAYS = 7;

const fmtDate = (s?: string) =>
  s ? new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

/** On the free tier: the free trial (New), or no plan bought after it. */
const onFreeTier = (b: Business) => b.planState?.status === 'trial' || b.planState?.status === 'free';

export function FreeTierPage({ onOpen }: { onOpen: (id: string) => void }) {
  const confirm = useConfirm();
  const [list, setList] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ ...BLANK_CREDS });
  const [days, setDays] = useState(DEFAULT_TRIAL_DAYS);
  const [verify, setVerify] = useState<VerifyResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<CreatedCredentials | null>(null);
  const [reset, setReset] = useState<{ name: string; username: string; passcode: string } | null>(null);
  const [busyId, setBusyId] = useState('');

  function load() {
    setLoading(true);
    platformApi
      .listBusinesses()
      .then((r) => setList((r.data || []).filter(onFreeTier)))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    load();
  }, []);

  const paged = usePaged(list, '', { key: 'admin-free-tier', noun: ['business', 'businesses'] });

  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  function cancel() {
    setAdding(false);
    setForm({ ...BLANK_CREDS });
    setDays(DEFAULT_TRIAL_DAYS);
    setVerify(null);
    setError('');
  }

  async function check() {
    setChecking(true);
    setError('');
    setVerify(null);
    try {
      const r = await platformApi.verifyBusiness(form);
      setVerify(r);
      if (!r.ok && !r.success) setError(r.message || r.errors?.[0] || 'Verification failed');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Verification failed');
    } finally {
      setChecking(false);
    }
  }

  async function save() {
    setSaving(true);
    setError('');
    try {
      const r = await platformApi.createTrial({ ...form, trialDays: days });
      setCreated(r.credentials);
      setReset(null);
      cancel();
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the trial');
    } finally {
      setSaving(false);
    }
  }

  async function restartTrial(b: Business) {
    const ok = await confirm({
      title: `Restart the trial for “${b.name}”?`,
      points: [
        `A new ${DEFAULT_TRIAL_DAYS}-day free trial with every feature starts now`,
        'A new passcode is issued',
        'Anyone signed in with the old passcode is logged out',
      ],
      confirmLabel: 'Restart trial',
    });
    if (!ok) return;
    setBusyId(b._id);
    setError('');
    try {
      const r = await platformApi.resetTrial(b._id);
      setReset({ name: b.name, ...r.credentials });
      setCreated(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Restart failed');
    } finally {
      setBusyId('');
    }
  }

  const totals = useMemo(
    () => ({
      trials: list.filter((b) => b.planState?.status === 'trial').length,
      free: list.filter((b) => b.planState?.status !== 'trial').length,
    }),
    [list],
  );

  const canCheck = canCheckCreds(form);
  const canSave = canCheck && verify?.ok;

  return (
    <div className="pa-page">
      <header className="pa-page-head">
        <div>
          <h1>Free tier</h1>
          <p className="pa-page-sub">
            {totals.trials} on the free trial (New) · {totals.free} with no plan
          </p>
        </div>
        <div className="pa-head-actions">
          {!adding && (
            <button className="pa-btn" onClick={() => { setAdding(true); setCreated(null); setReset(null); }}>
              + New free trial
            </button>
          )}
        </div>
      </header>

      {error && <div className="pa-error">{error}</div>}

      {created && (
        <div className="pa-created">
          <div className="pa-created-head">
            ✅ Trial ready — share these login details. The passcode is shown only once.
          </div>
          <Copyable label="Username" value={created.username} />
          <Copyable label="Passcode" value={created.passcode} />
          {created.callbackUrl && <Copyable label="Webhook callback URL" value={created.callbackUrl} />}
          {created.verifyToken && <Copyable label="Webhook verify token" value={created.verifyToken} />}
          <button className="pa-btn ghost sm" onClick={() => setCreated(null)}>Dismiss</button>
        </div>
      )}

      {reset && (
        <div className="pa-created">
          <div className="pa-created-head">
            🔄 {reset.name}: a new {DEFAULT_TRIAL_DAYS}-day trial started and a new passcode issued. The previous
            session has been signed out.
          </div>
          <Copyable label="Username" value={reset.username} />
          <Copyable label="New passcode" value={reset.passcode} />
          <button className="pa-btn ghost sm" onClick={() => setReset(null)}>Dismiss</button>
        </div>
      )}

      {adding && (
        <div className="pa-form">
          <MetaCredentialFields form={form} onChange={set} />
          <div className="pa-form-grid">
            <label className="pa-field">
              <span>Free trial (days)</span>
              <input
                type="number"
                min={1}
                max={90}
                value={days}
                onChange={(e) => setDays(Math.min(90, Math.max(1, Number(e.target.value) || 1)))}
              />
              <small className="pa-hint">
                Every feature during the trial; after it only the Starter features stay open unless they buy a
                plan in Settings → Billing.
              </small>
            </label>
          </div>

          <VerifyPanel verify={verify} />

          <div className="pa-form-actions">
            <button className="pa-btn ghost" onClick={cancel}>Cancel</button>
            <button className="pa-btn ghost" onClick={check} disabled={!canCheck || checking}>
              {checking ? 'Checking…' : 'Check credentials'}
            </button>
            <button className="pa-btn" onClick={save} disabled={!canSave || saving} title={canSave ? '' : 'Run Check first'}>
              {saving ? 'Creating…' : 'Create free trial'}
            </button>
          </div>
        </div>
      )}

      {loading && <div className="pa-note">Loading…</div>}
      {!loading && list.length === 0 && (
        <div className="pa-note">No businesses on the free trial or without a plan.</div>
      )}

      {list.length > 0 && (
        <div className="pa-table-wrap">
          <table className="pa-table">
            <thead>
              <tr>
                <th>Business</th>
                <th>Category</th>
                <th>WhatsApp number</th>
                <th>Login</th>
                <th>Plan</th>
                <th>Started</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {paged.items.map((b) => (
                <tr key={b._id} className={b.active ? '' : 'off'} onClick={() => onOpen(b._id)}>
                  <td>
                    <div className="pa-cell-main">
                      <span className="pa-avatar">{b.name.slice(0, 1).toUpperCase()}</span>
                      <div>
                        <strong>{b.name}</strong>
                        {b.meta?.verifiedName && <small>{b.meta.verifiedName}</small>}
                      </div>
                    </div>
                  </td>
                  <td><span className="pa-badge cat">{verticalConfig(b.category).label}</span></td>
                  <td className="mono">{b.meta?.displayPhoneNumber || b.phoneNumberId || '—'}</td>
                  <td className="mono">{b.email || `@${b.username}`}</td>
                  <td><PlanCell s={b.planState} /></td>
                  <td>{fmtDate(b.createdAt)}</td>
                  <td className="pa-row-actions" onClick={(e) => e.stopPropagation()}>
                    <button
                      className="pa-btn ghost sm"
                      disabled={busyId === b._id}
                      onClick={() => restartTrial(b)}
                      title="New passcode + a fresh free trial"
                    >
                      {busyId === b._id ? 'Working…' : 'Restart trial'}
                    </button>
                    <button className="pa-btn ghost sm" onClick={() => onOpen(b._id)}>Open</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {list.length > 0 && <Pager {...paged.pager} />}
    </div>
  );
}
