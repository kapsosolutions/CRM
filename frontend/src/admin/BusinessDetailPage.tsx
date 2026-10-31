// Super-admin → Businesses → one tenant. Shows its usage stats, Meta details,
// webhook wiring and login, and lets the admin rename / re-categorise, edit the
// Meta credentials and payment settings, issue a new passcode,
// activate/deactivate, or delete the business.
import { useEffect, useState } from 'react';
import { platformApi, type Business, type BusinessStats, type VerifyResult, type BusinessLabels } from './platformApi';
import { VERTICAL_OPTIONS, verticalConfig } from '../crm/verticals';
import {
  BLANK_PAYMENT, PaymentFields, LabelOverridesFields, VerifyPanel, paymentReady, type PaymentForm,
} from './MetaCredentialsForm';
import { Copyable } from './Copyable';
import { AdminPlanPanel } from './AdminPlanPanel';
import { useConfirm, useNotify } from '../crm/components/Dialogs';

const num = (n: number) => n.toLocaleString('en-IN');
const fmtDateTime = (s?: string | null) =>
  s ? new Date(s).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

/**
 * The editable half of a tenant's Meta setup.
 *
 * Secrets start blank on purpose: the server never sends them back, so a blank
 * field means "keep the stored one". The form says so rather than looking like
 * the value was lost.
 */
interface MetaEdit {
  phoneNumberId: string;
  wabaId: string;
  appId: string;
  appSecret: string;
  accessToken: string;
  catalogId: string;
  graphVersion: string;
  payment: PaymentForm;
}

const editFrom = (b: Business): MetaEdit => ({
  phoneNumberId: b.phoneNumberId || '',
  wabaId: b.wabaId || '',
  appId: b.appId || '',
  appSecret: '',
  accessToken: '',
  catalogId: b.catalogId || '',
  graphVersion: b.graphVersion || 'v22.0',
  payment: {
    ...BLANK_PAYMENT,
    enabled: !!b.payment?.enabled,
    configName: b.payment?.configName || '',
    gatewayType: (b.payment?.gatewayType || 'razorpay') as PaymentForm['gatewayType'],
    merchantName: b.payment?.merchantName || '',
    addressLine1: b.payment?.addressLine1 || '',
    addressLine2: b.payment?.addressLine2 || '',
    city: b.payment?.city || '',
    zoneCode: b.payment?.zoneCode || '',
    postalCode: b.payment?.postalCode || '',
    countryCode: b.payment?.countryCode || 'IN',
    countryOfOrigin: b.payment?.countryOfOrigin || 'India',
  },
});

export function BusinessDetailPage({ id, onBack }: { id: string; onBack: () => void }) {
  const confirm = useConfirm();
  const notify = useNotify();
  const [biz, setBiz] = useState<Business | null>(null);
  const [stats, setStats] = useState<BusinessStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [newPass, setNewPass] = useState('');

  // Inline profile editing (name + category + wording) — no Meta re-verification.
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('other');
  const [labels, setLabels] = useState<BusinessLabels>({});
  const [savingProfile, setSavingProfile] = useState(false);

  // Meta credentials + payment editing.
  const [editMeta, setEditMeta] = useState(false);
  const [mf, setMf] = useState<MetaEdit | null>(null);
  const [metaVerify, setMetaVerify] = useState<VerifyResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [savingMeta, setSavingMeta] = useState(false);
  const [syncing, setSyncing] = useState(false);

  function load() {
    setLoading(true);
    Promise.all([platformApi.getBusiness(id), platformApi.businessStats(id).catch(() => null)])
      .then(([b, s]) => {
        setBiz(b.data);
        setName(b.data.name);
        setCategory(b.data.category || 'other');
        setLabels(b.data.labels || {});
        if (s) setStats(s.data);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function flash(m: string) {
    setMsg(m);
    setTimeout(() => setMsg(''), 3000);
  }

  async function saveProfile() {
    setSavingProfile(true);
    setError('');
    try {
      const r = await platformApi.updateBusinessProfile(id, { name: name.trim(), category, labels });
      setBiz(r.data);
      setEditing(false);
      flash('Profile updated.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setSavingProfile(false);
    }
  }

  function openMetaEdit() {
    if (!biz) return;
    setMf(editFrom(biz));
    setMetaVerify(null);
    setError('');
    setEditMeta(true);
  }

  function closeMetaEdit() {
    setEditMeta(false);
    setMf(null);
    setMetaVerify(null);
    setError('');
  }

  const setMeta = (patch: Partial<MetaEdit>) => setMf((f) => (f ? { ...f, ...patch } : f));
  const setPay = (patch: Partial<MetaEdit['payment']>) =>
    setMf((f) => (f ? { ...f, payment: { ...f.payment, ...patch } } : f));

  async function checkMeta() {
    if (!mf) return;
    setChecking(true);
    setError('');
    setMetaVerify(null);
    try {
      const r = await platformApi.verifyBusinessEdit(id, mf);
      setMetaVerify(r);
      if (!r.ok) setError(r.message || r.errors?.[0] || 'Verification failed');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Verification failed');
    } finally {
      setChecking(false);
    }
  }

  async function saveMeta() {
    if (!mf) return;
    setSavingMeta(true);
    setError('');
    try {
      const r = await platformApi.updateBusiness(id, mf);
      setBiz(r.data);
      closeMetaEdit();
      // Say which of the two slow things actually happened, so a save that
      // skipped Meta doesn't read as a save that failed to reach it.
      flash([
        'Saved.',
        r.verified ? 'Re-checked with Meta.' : '',
        r.webhook || '',
      ].filter(Boolean).join(' '));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSavingMeta(false);
    }
  }

  async function resync() {
    setSyncing(true);
    setError('');
    try {
      const r = await platformApi.syncWebhook(id);
      flash(r.message || 'Webhook synced.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Webhook sync failed');
    } finally {
      setSyncing(false);
    }
  }

  async function regenerate() {
    if (!biz) return;
    const ok = await confirm({
      title: 'Generate a new passcode?',
      message: `The old passcode for ${biz.name} stops working immediately, and anyone signed in with it is logged out.`,
      confirmLabel: 'Generate passcode',
    });
    if (!ok) return;
    try {
      const r = await platformApi.regeneratePasscode(id);
      setNewPass(r.credentials.passcode);
      notify('success', 'New passcode generated', `Share it with ${biz.name}. The old one no longer works.`);
    } catch (e) {
      notify('error', 'Could not generate a passcode', e instanceof Error ? e.message : undefined);
    }
  }

  async function toggle() {
    if (!biz) return;
    const r = await platformApi.setBusinessActive(id, !biz.active);
    setBiz({ ...biz, active: r.data.active });
    flash(r.data.active ? 'Business activated.' : 'Business deactivated.');
  }

  async function remove() {
    if (!biz) return;
    // Spell out the blast radius — this now wipes the tenant's whole dataset,
    // not just its login row.
    const ok = await confirm({
      title: `Permanently delete ${biz.name}?`,
      message: 'This removes everything belonging to this business and cannot be undone:',
      points: [
        'All chats and messages',
        'Catalog products, categories and offers',
        'Flows, journeys, members, orders and form submissions',
        'Every uploaded image and file (Bunny storage)',
        'Its flows at Meta are taken out of service',
      ],
      confirmLabel: 'Delete business',
    });
    if (!ok) return;
    try {
      const r = await platformApi.deleteBusiness(id);
      const counts = Object.entries(r.deleted || {})
        .filter(([, n]) => typeof n === 'number' && n > 0)
        .map(([k, n]) => `${n} ${k}`)
        .join(', ');
      const media = r.media === 'removed' ? 'media folder removed' : `media: ${r.media || 'unknown'}`;
      notify('success', `${biz.name} deleted`, `${counts || 'No records to remove'} · ${media}`);
      onBack();
    } catch (e) {
      notify('error', 'Delete failed', e instanceof Error ? e.message : undefined);
    }
  }

  if (loading) return <div className="pa-note">Loading business…</div>;
  if (!biz) return <div className="pa-error">{error || 'Business not found'}</div>;

  const v = verticalConfig(biz.category, biz.labels);
  // What's still missing before a payment card would actually be payable.
  const payGaps = mf ? paymentReady(mf.payment) : [];

  return (
    <div className="pa-page">
      <header className="pa-page-head detail">
        <button className="pa-back" onClick={onBack} aria-label="Back to businesses">
          <span className="material-icons">arrow_back</span>
        </button>
        <span className="pa-avatar lg">{biz.name.slice(0, 1).toUpperCase()}</span>
        <div className="pa-detail-title">
          <h1>{biz.name}</h1>
          <p className="pa-page-sub">
            <span className="pa-badge cat">{v.label}</span>
            <span className={`pa-badge ${biz.active ? 'on' : 'off'}`}>{biz.active ? 'Active' : 'Inactive'}</span>
            <span className="mono">@{biz.username}</span>
          </p>
        </div>
        <div className="pa-head-actions">
          <button className="pa-btn ghost" onClick={toggle}>{biz.active ? 'Deactivate' : 'Activate'}</button>
          <button className="pa-btn ghost danger" onClick={remove}>Delete</button>
        </div>
      </header>

      {error && <div className="pa-error">{error}</div>}
      {msg && <div className="pa-ok">{msg}</div>}

      {newPass && (
        <div className="pa-created">
          <div className="pa-created-head">✅ New passcode — shown only once.</div>
          <Copyable label="Username" value={biz.username || ''} />
          <Copyable label="Passcode" value={newPass} />
          <button className="pa-btn ghost sm" onClick={() => setNewPass('')}>Dismiss</button>
        </div>
      )}

      {/* ---------- Usage ---------- */}
      <div className="pa-stat-grid">
        <div className="pa-stat">
          <div className="pa-stat-top"><span className="material-icons">forum</span>Messages</div>
          <div className="pa-stat-val">{num(stats?.messages.total || 0)}</div>
          <div className="pa-stat-sub">{num(stats?.messages.last24h || 0)} in last 24h</div>
        </div>
        <div className="pa-stat">
          <div className="pa-stat-top"><span className="material-icons">groups</span>Contacts</div>
          <div className="pa-stat-val">{num(stats?.contacts || 0)}</div>
          <div className="pa-stat-sub">unique people reached</div>
        </div>
        <div className="pa-stat">
          <div className="pa-stat-top"><span className="material-icons">swap_vert</span>In / Out</div>
          <div className="pa-stat-val">{num(stats?.messages.inbound || 0)} / {num(stats?.messages.outbound || 0)}</div>
          <div className="pa-stat-sub">inbound / outbound</div>
        </div>
        <div className="pa-stat">
          <div className="pa-stat-top"><span className="material-icons">hub</span>Journeys</div>
          <div className="pa-stat-val">{num(stats?.journeys || 0)}</div>
          <div className="pa-stat-sub">last msg {fmtDateTime(stats?.lastMessageAt)}</div>
        </div>
      </div>

      <div className="pa-dash-cols">
        {/* ---------- Profile ---------- */}
        <section className="pa-panel">
          <div className="pa-panel-head">
            Profile
            {!editing && (
              <button className="pa-btn ghost sm" onClick={() => setEditing(true)}>Edit</button>
            )}
          </div>

          {editing ? (
            <>
              <label className="pa-field"><span>Business name</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
              <label className="pa-field">
                <span>Business category</span>
                <select value={category} onChange={(e) => setCategory(e.target.value)}>
                  {VERTICAL_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <small className="pa-hint">
                  {verticalConfig(category).archetypeLabel} · pages: {verticalConfig(category).pages.join(', ')}
                </small>
              </label>
              <div className="pa-labels-wrap">
                <div className="pa-labels-title">Wording (optional)</div>
                <LabelOverridesFields category={category} value={labels} onChange={(patch) => setLabels((l) => ({ ...l, ...patch }))} />
              </div>
              <div className="pa-form-actions">
                <button className="pa-btn ghost" onClick={() => { setEditing(false); setName(biz.name); setCategory(biz.category || 'other'); setLabels(biz.labels || {}); }}>Cancel</button>
                <button className="pa-btn" onClick={saveProfile} disabled={!name.trim() || savingProfile}>
                  {savingProfile ? 'Saving…' : 'Save'}
                </button>
              </div>
            </>
          ) : (
            <div className="pa-kv">
              <div><span>Name</span><strong>{biz.name}</strong></div>
              <div><span>Category</span><strong>{v.label}</strong></div>
              <div><span>Archetype</span><strong>{v.archetypeLabel}</strong></div>
              <div><span>CRM pages</span><strong className="pa-wrap">{v.pages.join(', ')}</strong></div>
              <div><span>Members called</span><strong>{v.memberLabel}</strong></div>
              <div><span>Customer called</span><strong>{v.customerLabel}</strong></div>
              <div><span>Fee label</span><strong>{v.feeLabel}</strong></div>
            </div>
          )}
        </section>

        {/* ---------- Meta / WhatsApp ---------- */}
        <section className="pa-panel">
          <div className="pa-panel-head">
            WhatsApp &amp; Meta
            {!editMeta && <button className="pa-btn ghost sm" onClick={openMetaEdit}>Edit</button>}
          </div>

          {editMeta && mf ? (
            <>
              <div className="pa-form-grid">
                <label className="pa-field">
                  <span>Phone number ID</span>
                  <input value={mf.phoneNumberId} onChange={(e) => setMeta({ phoneNumberId: e.target.value })} />
                </label>
                <label className="pa-field">
                  <span>WABA ID</span>
                  <input value={mf.wabaId} onChange={(e) => setMeta({ wabaId: e.target.value })} />
                </label>
                <label className="pa-field">
                  <span>App ID</span>
                  <input value={mf.appId} onChange={(e) => setMeta({ appId: e.target.value })} />
                </label>
                <label className="pa-field">
                  <span>App secret</span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={mf.appSecret}
                    onChange={(e) => setMeta({ appSecret: e.target.value })}
                    placeholder={biz.hasAppSecret ? 'Stored — leave blank to keep' : 'Not set'}
                  />
                  <small className="pa-hint">
                    {biz.hasAppSecret
                      ? 'Stored. Leave blank to keep it.'
                      : 'Needed to verify inbound webhooks and to sync the callback URL at Meta.'}
                  </small>
                </label>
                <label className="pa-field">
                  <span>Catalog ID (optional)</span>
                  <input value={mf.catalogId} onChange={(e) => setMeta({ catalogId: e.target.value })} />
                </label>
                <label className="pa-field">
                  <span>Graph version</span>
                  <input value={mf.graphVersion} onChange={(e) => setMeta({ graphVersion: e.target.value })} />
                </label>
                <label className="pa-field wide">
                  <span>Access token</span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={mf.accessToken}
                    onChange={(e) => setMeta({ accessToken: e.target.value })}
                    placeholder={biz.hasAccessToken ? 'Stored — leave blank to keep' : 'EAAG…'}
                  />
                  <small className="pa-hint">
                    {biz.hasAccessToken
                      ? 'Stored. Leave blank to keep it, or paste a new one to replace it.'
                      : 'No token stored — this tenant cannot send until one is saved.'}
                  </small>
                </label>
              </div>

              {/* Payments are deliberately editable on their own: a business
                  often signs up for WhatsApp Pay long after onboarding. */}
              <PaymentFields
                form={mf.payment}
                onChange={setPay}
                hasCatalog={!!mf.catalogId.trim()}
                businessName={biz.name}
              />

              <VerifyPanel verify={metaVerify} />

              <p className="pa-panel-note">
                Checking is optional — it only re-reads the number from Meta. Saving re-verifies by
                itself whenever you change the number, WABA, catalog, token or Graph version.
              </p>

              <div className="pa-form-actions">
                <button className="pa-btn ghost" onClick={closeMetaEdit}>Cancel</button>
                <button className="pa-btn ghost" onClick={checkMeta} disabled={checking || savingMeta}>
                  {checking ? 'Checking…' : 'Check credentials'}
                </button>
                <button
                  className="pa-btn"
                  onClick={saveMeta}
                  disabled={savingMeta || !mf.phoneNumberId.trim() || !mf.wabaId.trim()
                    || (!biz.hasAccessToken && !mf.accessToken.trim())
                    || payGaps.length > 0}
                  title={payGaps.length ? `Payments need: ${payGaps.join(', ')}` : ''}
                >
                  {savingMeta ? 'Saving…' : 'Save'}
                </button>
              </div>
            </>
          ) : (
            <div className="pa-kv">
              <div><span>Verified name</span><strong>{biz.meta?.verifiedName || '—'}</strong></div>
              <div><span>Display number</span><strong className="mono">{biz.meta?.displayPhoneNumber || '—'}</strong></div>
              <div><span>Quality rating</span><strong>{biz.meta?.qualityRating || '—'}</strong></div>
              <div><span>Phone number ID</span><strong className="mono">{biz.phoneNumberId}</strong></div>
              <div><span>WABA ID</span><strong className="mono">{biz.wabaId}</strong></div>
              <div><span>App ID</span><strong className="mono">{biz.appId || '—'}</strong></div>
              <div><span>App secret</span><strong>{biz.hasAppSecret ? 'Stored' : 'Not set'}</strong></div>
              <div><span>Access token</span><strong>{biz.hasAccessToken ? 'Stored' : 'Not set'}</strong></div>
              <div><span>Catalog</span><strong>{biz.meta?.catalogName || biz.catalogId || '—'}</strong></div>
              <div><span>Graph version</span><strong className="mono">{biz.graphVersion || '—'}</strong></div>
              <div>
                <span>Payments</span>
                <strong>
                  {biz.payment?.enabled
                    ? `On · ${biz.payment.gatewayType}${biz.payment.configName ? ` · ${biz.payment.configName}` : ''}`
                    : 'Off'}
                </strong>
              </div>
              <div><span>Last verified</span><strong>{fmtDateTime(biz.meta?.lastVerifiedAt)}</strong></div>
            </div>
          )}

          {/* The one gap that silently breaks inbound messages and payment
              outcomes, so it's called out instead of only reaching the log. */}
          {!editMeta && !biz.hasAppSecret && (
            <div className="pa-verify-warn">
              No app secret stored, so this tenant's callback URL can't be synced at Meta and
              inbound webhooks aren't signature-checked. Add it with Edit above.
            </div>
          )}

          {!editMeta && biz.payment?.enabled && !biz.payment.configName && (
            <div className="pa-verify-warn">
              Payments are on but no payment configuration name is set, so there's nothing for the
              order to be charged against. Add it with Edit above.
            </div>
          )}
        </section>
      </div>

      {/* ---------- Plan ---------- */}
      <AdminPlanPanel biz={biz} onChanged={(b) => setBiz({ ...biz, ...b })} />

      {/* ---------- Webhook + login ---------- */}
      <section className="pa-panel">
        <div className="pa-panel-head">Webhook &amp; access</div>
        <p className="pa-panel-note">
          Set these in Meta → WhatsApp → Configuration. The verify token is specific to this business.
        </p>
        {biz.callbackUrl && <Copyable label="Callback URL" value={biz.callbackUrl} />}
        {biz.verifyToken && <Copyable label="Verify token" value={biz.verifyToken} />}
        <div className="pa-form-actions left">
          {biz.hasPasscode && <button className="pa-btn ghost" onClick={regenerate}>Issue new passcode</button>}
          {/* Needed whenever the public URL changes — a new tunnel or deploy
              leaves Meta posting to the old address and the chat stays silent. */}
          <button className="pa-btn ghost" onClick={resync} disabled={syncing || !biz.hasAppSecret}
            title={biz.hasAppSecret ? '' : 'Needs an app ID and secret'}>
            {syncing ? 'Syncing…' : 'Re-sync webhook at Meta'}
          </button>
        </div>
      </section>

      <LoginPanel biz={biz} onSaved={(b) => { setBiz((cur) => (cur ? { ...cur, ...b } : b)); flash('Login saved.'); }} />
    </div>
  );
}

/** Random password with letters and digits, for handing to an owner. */
function randomPassword() {
  const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint32Array(12));
  const s = Array.from(bytes, (n) => chars[n % chars.length]).join('');
  // Guarantee at least one digit.
  return `${s.slice(0, 11)}${(bytes[11] % 8) + 2}`;
}

/**
 * The business's sign-in: an email + password (Supabase Auth). Businesses
 * onboarded before sign-up only had a username + passcode; this gives them
 * the new login. It also resets a registered owner's password.
 */
function LoginPanel({ biz, onSaved }: { biz: Business; onSaved: (b: Business) => void }) {
  const notify = useNotify();
  const [email, setEmail] = useState(biz.email || '');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [shared, setShared] = useState<{ email: string; password: string } | null>(null);

  async function save() {
    setSaving(true);
    try {
      const r = await platformApi.setBusinessLogin(biz._id, email.trim(), password);
      setShared({ email: email.trim().toLowerCase(), password });
      setPassword('');
      onSaved(r.data);
    } catch (e) {
      notify('error', 'Could not save the login', e instanceof Error ? e.message : undefined);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="pa-panel">
      <div className="pa-panel-head">Login</div>
      <p className="pa-panel-note">
        {biz.email
          ? `Signs in with ${biz.email}${biz.authProvider === 'google' ? ' (Google or password)' : ''}. Set a new password to reset it — current sessions are signed out.`
          : 'No login email yet — this business still signs in with its username and passcode. Give it an email and password to move it to the new login.'}
      </p>
      {shared && (
        <div className="pa-created">
          <div className="pa-created-head">✅ Login saved — share these with the business. The password is shown only once.</div>
          <Copyable label="Email" value={shared.email} />
          <Copyable label="Password" value={shared.password} />
          <button className="pa-btn ghost sm" onClick={() => setShared(null)}>Dismiss</button>
        </div>
      )}
      <div className="pa-form-grid">
        <label className="pa-field">
          <span>Login email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="owner@business.com" />
        </label>
        <label className="pa-field">
          <span>New password</span>
          <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters, letters + a number" />
        </label>
      </div>
      <div className="pa-form-actions left">
        <button className="pa-btn ghost" type="button" onClick={() => setPassword(randomPassword())}>Generate password</button>
        <button className="pa-btn" type="button" onClick={save} disabled={saving || !email.trim() || password.length < 8}>
          {saving ? 'Saving…' : biz.email ? 'Update login' : 'Create login'}
        </button>
      </div>
    </section>
  );
}
