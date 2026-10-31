// Ads Manager S4: the Audiences tab (Ads → Audiences): custom audiences from
// CRM contacts, lookalikes, saved audiences, refresh and delete. The pickers
// for the wizard / ad set editor are in AdsAudiencePickers.tsx.
//
// The browser never sees a phone number: it chooses which contacts (all
// WhatsApp contacts, contacted or inbound in the last N days) and gets counts
// back. The server normalises and hashes the numbers and uploads them to Meta
// in the background; this page polls the upload's progress.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { CrmApi } from '../api';
import type {
  AdsAudienceItem, AdsAudienceJob, AdsAudiencesList, AdsCampaignSpec, AdsContactFilter, AdsContactsPreview, AdsGeoItem, AdsSavedAudience, AdsSavedAudiences,
} from '../types';
import { useConfirm, useNotify } from './Dialogs';
import { BladeSpinner } from './BladeSpinner';
import { AdsErrorState, errCode, errText, errTitle } from './MetaAdsDashboard';
import { ManageDialog } from './AdsManageDialogs';
import { SearchBox, StepAudience, defaultSpec } from './AdsCreateWizard';
import { TYPE_LABEL, compact, savedSummary, sizeText } from './AdsAudiencePickers';
import './AdsManager.css';

type ApiErr = Error & { data?: { code?: string; field?: string; termsUrl?: string } | null };
const errField = (e: unknown) => (e as ApiErr)?.data?.field || '';
const errTerms = (e: unknown) => (e as ApiErr)?.data?.termsUrl || '';
type SetSpec = (fn: (s: AdsCampaignSpec) => AdsCampaignSpec) => void;

const FILTERS: [AdsContactFilter, string, string][] = [
  ['all', 'All WhatsApp contacts', 'Everyone who has a WhatsApp chat with you.'],
  ['contacted', 'Contacted in the last days', 'Anyone you messaged, or who messaged you, in the period.'],
  ['inbound', 'Messaged you in the last days', 'Only people who wrote to you in the period.'],
];
const filterText = (f: AdsContactFilter, days: number) => (f === 'all' ? 'all WhatsApp contacts' : f === 'contacted' ? `contacted in the last ${days} days` : `messaged you in the last ${days} days`);
const int = (n: number) => Math.round(n || 0).toLocaleString();
const PRIVACY = 'Phone numbers stay on the CRM server. They are normalised and hashed (SHA-256) there, and only the hashes go to Meta. Messenger and Instagram chats are left out.';
const POLL_MS = 2000;

function statusPill(s: { code: number; description: string } | null, kind: 'op' | 'delivery') {
  if (!s) return <span className="ads-pill">—</span>;
  const c = s.code;
  const tone = c === 200 ? 'green' : c === 471 || c >= 500 || (kind === 'delivery' && c >= 400) ? 'red' : 'amber';
  const label = kind === 'delivery'
    ? c === 200 ? 'Ready' : c === 300 ? 'Too small' : 'Not usable'
    : c === 200 ? 'Normal' : c === 471 ? 'Flagged' : c === 414 ? 'Replacing' : c === 441 ? 'Populating' : c === 410 ? 'No upload yet' : c === 450 ? 'Inactive' : c === 411 ? 'Low match rate' : 'Check';
  return <span className={`ads-pill ${tone}`} title={s.description || undefined}>{label}</span>;
}
function jobLine(j: AdsAudienceJob): string {
  const what = j.mode === 'replace' ? 'Replacing' : 'Uploading';
  if (j.status === 'queued') return 'Queued: other audience uploads are running on the server. This one starts by itself when a slot is free.';
  if (j.status === 'running' && !j.total) return 'Reading your contacts…';
  if (j.status === 'waiting') return `Meta is limiting requests, waiting to retry… ${int(j.sent)} of ${int(j.total)} sent`;
  if (!j.done) return `${what} ${int(j.sent)} of ${int(j.total)} contacts (batch ${Math.min(j.batches, j.batchesDone + 1)} of ${j.batches})`;
  if (j.status === 'done') {
    return `${int(j.sent)} contacts ${j.mode === 'replace' ? 'replaced the audience' : 'uploaded'}${j.fallback ? ` (added: ${j.fallback})` : ''}.${j.truncated ? ' Capped at the server’s contact limit.' : ''} Meta matches them over the next hours.`;
  }
  return j.error?.message || 'The upload stopped.';
}

function Progress({ job, testid }: { job: AdsAudienceJob; testid: string }) {
  const tone = job.status === 'failed' || job.status === 'interrupted' ? 'red' : job.status === 'done' ? 'green' : job.status === 'waiting' || job.status === 'queued' ? 'amber' : 'blue';
  return (
    <div className={`ads-au-progress ${tone}`} data-testid={testid} data-status={job.status}>
      <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={job.percent}>
        <span style={{ width: `${job.done && job.status === 'done' ? 100 : job.percent}%` }} />
      </div>
      <small data-testid={`${testid}-text`}>{jobLine(job)}</small>
    </div>
  );
}

function TermsBox({ url, onRecheck, testid = 'ads-au-terms' }: { url: string; onRecheck?: () => void; testid?: string }) {
  return (
    <div className="ads-state amber" role="alert" data-testid={testid}>
      <span className="material-icons" aria-hidden="true">gavel</span>
      <div>
        <strong>Accept Meta’s Custom Audience terms first</strong>
        <p>
          Meta needs someone from your business to accept the Custom Audience terms for this ad account before contacts can be uploaded. It takes a minute in
          Meta Business, then come back here.
        </p>
        <div className="ads-au-actions">
          <a className="ads-btn primary sm" href={url} target="_blank" rel="noopener noreferrer" data-testid={`${testid}-link`}>
            <span className="material-icons" aria-hidden="true">open_in_new</span> Accept the terms at Meta
          </a>
          {onRecheck && (
            <button type="button" className="ads-btn sm" onClick={onRecheck} data-testid={`${testid}-recheck`}>
              I’ve accepted them, check again
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function FieldRow({ label, hint, err, children }: { label: string; hint?: ReactNode; err?: string; children: ReactNode }) {
  return (
    <label className="ads-wz-field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
      {err && <small className="ads-mg-err" role="alert">{err}</small>}
    </label>
  );
}

// ----------------------------------------------------- create from contacts --

function ContactsDialog({ api, terms, jobs, onClose, onCreated, onError }: {
  api: CrmApi;
  terms: { accepted: boolean | null; url: string };
  /** The tab's polled uploads: the dialog shows its own job's progress from here. */
  jobs: Record<string, AdsAudienceJob>;
  onClose: () => void;
  onCreated: (job: AdsAudienceJob) => void;
  onError: (e: unknown) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [filter, setFilter] = useState<AdsContactFilter>('all');
  const [days, setDays] = useState('30');
  const [preview, setPreview] = useState<AdsContactsPreview | null>(null);
  const [previewErr, setPreviewErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [job, setJob] = useState<AdsAudienceJob | null>(null);
  const [termsUrl, setTermsUrl] = useState(terms.accepted === false ? terms.url : '');
  const dayN = Number(days);
  const daysOk = filter === 'all' || (Number.isInteger(dayN) && dayN >= 1 && dayN <= 365);
  useEffect(() => {
    if (!daysOk) {
      setPreview(null);
      return undefined;
    }
    let live = true;
    setPreviewErr('');
    const t = setTimeout(() => {
      api
        .getAdsAudienceContacts(filter, dayN)
        .then((r) => live && setPreview(r))
        .catch((e) => live && setPreviewErr(errText(e)));
    }, 350);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [api, filter, dayN, daysOk]);
  const live = job ? jobs[job.audienceId] || job : null;
  const field = errField(err);
  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.createAdsAudience({ name: name.trim(), description: description.trim() || undefined, filter, ...(filter === 'all' ? {} : { days: dayN }) });
      if (r.job) {
        setJob(r.job);
        onCreated(r.job);
      }
    } catch (e) {
      if (errCode(e) === 'TERMS_NOT_ACCEPTED') setTermsUrl(errTerms(e) || terms.url);
      else setErr(e);
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  const why = !name.trim() ? 'Name the audience.' : !daysOk ? 'Enter 1 to 365 days.' : !preview ? 'Counting your contacts…' : !preview.count ? 'No contacts match this choice.' : '';
  return (
    <ManageDialog
      title="New audience from your CRM contacts"
      testid="ads-au-contacts-dialog"
      dirty={!job && (!!name.trim() || !!description.trim())}
      onClose={onClose}
      footer={job ? (
        <div className="ads-mg-foot">
          <small className="ads-wz-hint">{live && !live.done ? 'You can close this. The upload carries on on the server.' : ''}</small>
          <button type="button" className="ads-btn primary" onClick={onClose} data-testid="ads-au-contacts-close">
            {live && !live.done ? 'Close (keeps uploading)' : 'Done'}
          </button>
        </div>
      ) : (
        <div className="ads-mg-foot">
          {why && <small className="ads-wz-hint" data-testid="ads-au-why">{why}</small>}
          <button type="button" className="ads-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="ads-btn primary" disabled={!!why || busy || !!termsUrl} onClick={() => void submit()} data-testid="ads-au-upload">
            {busy ? 'Creating…' : preview?.count ? `Create and upload ${int(preview.count)} contacts` : 'Create and upload'}
          </button>
        </div>
      )}
    >
      {termsUrl && <TermsBox url={termsUrl} testid="ads-au-terms-error" />}
      {job && live ? (
        <div data-testid="ads-au-job">
          <p>
            <strong>{name.trim()}</strong> was created at Meta. The contacts upload in the background in batches of up to 10,000.
          </p>
          <Progress job={live} testid="ads-au-job-progress" />
        </div>
      ) : (
        <>
          <FieldRow label="Audience name" err={field === 'name' ? errText(err) : ''}>
            <input type="text" value={name} maxLength={400} onChange={(e) => setName(e.target.value)} data-testid="ads-au-name" data-autofocus />
          </FieldRow>
          <FieldRow label="Description (optional)" err={field === 'description' ? errText(err) : ''}>
            <input type="text" value={description} maxLength={400} onChange={(e) => setDescription(e.target.value)} data-testid="ads-au-desc" />
          </FieldRow>
          <section className="ads-wz-section">
            <h4>Which contacts</h4>
            <div className="ads-au-filters">
              {FILTERS.map(([k, label, text]) => (
                <label key={k} className={`ads-au-filter${filter === k ? ' on' : ''}`}>
                  <input type="radio" name="ads-au-filter" checked={filter === k} onChange={() => setFilter(k)} data-testid={`ads-au-filter-${k}`} />
                  <span>
                    <strong>{label}</strong>
                    <small>{text}</small>
                  </span>
                </label>
              ))}
            </div>
            {filter !== 'all' && (
              <FieldRow label="Days" hint="1 to 365" err={field === 'days' ? errText(err) : !daysOk ? 'Enter a whole number from 1 to 365.' : ''}>
                <input type="number" min={1} max={365} step={1} value={days} onChange={(e) => setDays(e.target.value)} data-testid="ads-au-days" />
              </FieldRow>
            )}
            <div className="ads-au-count" data-testid="ads-au-count" aria-live="polite">
              {previewErr ? (
                <span role="alert">{previewErr}</span>
              ) : !daysOk ? null : !preview ? (
                <span>Counting…</span>
              ) : (
                <>
                  <strong data-testid="ads-au-count-n">{int(preview.count)}</strong> contacts will be uploaded
                  {preview.batches > 1 ? ` in ${preview.batches} batches` : ''}.
                  <small>
                    Left out: {int(preview.skipped.otherChannel)} Messenger / Instagram chats, {int(preview.skipped.invalid)} without a valid phone number,{' '}
                    <span data-testid="ads-au-count-nocc">{int(preview.skipped.noCountryCode || 0)} with no country code</span>, {int(preview.skipped.duplicate)} duplicates.
                    {preview.truncated ? ` Capped at ${int(preview.max)} contacts.` : ''}
                    {(preview.skipped.noCountryCode || 0) > 0 && ' Numbers saved without their country code (for example 98765 43210 instead of +91 98765 43210) can’t be matched, so they are skipped; add the code in the chat’s contact details to include them.'}
                  </small>
                </>
              )}
            </div>
          </section>
          <p className="ads-wz-hint" data-testid="ads-au-privacy">
            <span className="material-icons" aria-hidden="true" style={{ fontSize: 15, verticalAlign: '-3px' }}>lock</span> {PRIVACY}
          </p>
          {!!err && !field && <AdsErrorState error={err} />}
        </>
      )}
    </ManageDialog>
  );
}

// -------------------------------------------------------------- lookalike --

function LookalikeDialog({ api, audiences, seedId, onClose, onCreated, onError }: {
  api: CrmApi;
  audiences: AdsAudienceItem[];
  seedId: string;
  onClose: () => void;
  onCreated: (a: AdsAudienceItem) => void;
  onError: (e: unknown) => void;
}) {
  const seeds = audiences.filter((a) => a.type !== 'lookalike' && !a.flagged);
  const [origin, setOrigin] = useState(seedId || seeds[0]?.id || '');
  const [countries, setCountries] = useState<{ code: string; name: string }[]>([]);
  const [ratio, setRatio] = useState(1);
  const seed = seeds.find((s) => s.id === origin);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const autoName = `${seed?.name || 'Audience'} – lookalike ${countries.map((c) => c.code).join(', ') || '…'} ${ratio}%`.slice(0, 400);
  const field = errField(err);
  const why = !origin ? 'Pick the source audience.' : !countries.length ? 'Pick at least one country.' : '';
  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.createAdsLookalike({ name: (name.trim() || autoName).slice(0, 400), originId: origin, countries: countries.map((c) => c.code), ratio });
      onCreated(r.audience);
    } catch (e) {
      setErr(e);
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <ManageDialog
      title="New lookalike audience"
      testid="ads-au-lal-dialog"
      dirty={countries.length > 0 || !!name.trim()}
      onClose={onClose}
      footer={(
        <div className="ads-mg-foot">
          {why && <small className="ads-wz-hint">{why}</small>}
          <button type="button" className="ads-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="ads-btn primary" disabled={!!why || busy} onClick={() => void submit()} data-testid="ads-au-lal-create">
            {busy ? 'Creating…' : 'Create lookalike'}
          </button>
        </div>
      )}
    >
      <p className="ads-wz-hint">
        Meta finds people similar to an audience you already have. The source needs at least 100 people Meta can match. A new lookalike takes 1–6 hours to
        fill, and you can use it in ad sets meanwhile. Lookalikes can’t be used for housing, employment or financial products ads.
      </p>
      <FieldRow label="Source audience" err={field === 'originId' ? errText(err) : ''}>
        <select value={origin} onChange={(e) => setOrigin(e.target.value)} data-testid="ads-au-lal-seed">
          {!seeds.length && <option value="">No custom audience yet</option>}
          {seeds.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({TYPE_LABEL[s.type] || s.type}, {sizeText(s)})
            </option>
          ))}
        </select>
      </FieldRow>
      <FieldRow label="Countries" err={field === 'countries' ? errText(err) : ''}>
        <SearchBox<AdsGeoItem>
          placeholder="Search countries"
          search={async (q) => (await api.searchAdsTargeting('geo', q)).results.filter((g) => g.kind === 'country')}
          keyOf={(g) => g.key}
          render={(g) => <span>{g.label || g.name}</span>}
          onPick={(g) => !countries.some((c) => c.code === g.key) && countries.length < 25 && setCountries([...countries, { code: g.key, name: g.label || g.name }])}
          testid="ads-au-lal-country"
        />
      </FieldRow>
      <div className="ads-wz-chips" data-testid="ads-au-lal-countries">
        {countries.map((c) => (
          <span key={c.code} className="ads-wz-chip">
            {c.name}
            <button type="button" aria-label={`Remove ${c.name}`} onClick={() => setCountries(countries.filter((x) => x.code !== c.code))}>×</button>
          </span>
        ))}
        {!countries.length && <small className="ads-wz-hint">No countries yet.</small>}
      </div>
      <FieldRow label="Audience size" hint="1% is the closest match to your source; 10% reaches more people who are less similar." err={field === 'ratio' ? errText(err) : ''}>
        <select value={ratio} onChange={(e) => setRatio(Number(e.target.value))} data-testid="ads-au-lal-ratio">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>{n}% of each country</option>
          ))}
        </select>
      </FieldRow>
      <FieldRow label="Name (optional)" hint={`Default: ${autoName}`} err={field === 'name' ? errText(err) : ''}>
        <input type="text" value={name} maxLength={400} onChange={(e) => setName(e.target.value)} data-testid="ads-au-lal-name" />
      </FieldRow>
      {!!err && !field && <AdsErrorState error={err} />}
    </ManageDialog>
  );
}

// ---------------------------------------------------------- saved audience --

function SavedDialog({ api, onClose, onSaved, onError }: { api: CrmApi; onClose: () => void; onSaved: (s: AdsSavedAudience) => void; onError: (e: unknown) => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [spec, setSpecRaw] = useState<AdsCampaignSpec>(() => ({ ...defaultSpec('awareness'), optimizationGoal: 'REACH' }));
  const setSpec = useCallback<SetSpec>((fn) => setSpecRaw((s) => fn(s)), []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const field = errField(err);
  const why = !name.trim() ? 'Name the saved audience.' : !spec.audience.locations.length ? 'Add at least one location.' : '';
  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.createAdsSavedAudience({ name: name.trim(), description: description.trim() || undefined, audience: spec.audience });
      onSaved(r.saved);
    } catch (e) {
      setErr(e);
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <ManageDialog
      title="Save an audience"
      testid="ads-au-saved-dialog"
      wide
      dirty={!!name.trim() || spec.audience.locations.length > 0}
      onClose={onClose}
      footer={(
        <div className="ads-mg-foot">
          {why && <small className="ads-wz-hint">{why}</small>}
          <button type="button" className="ads-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="ads-btn primary" disabled={!!why || busy} onClick={() => void submit()} data-testid="ads-au-saved-create">
            {busy ? 'Saving…' : 'Save audience'}
          </button>
        </div>
      )}
    >
      <p className="ads-wz-hint" data-testid="ads-au-saved-note">
        Saved in the CRM: Meta’s Marketing API can read saved audiences but can’t create them. Use it as the starting point of a campaign’s audience or an ad
        set’s audience.
      </p>
      <FieldRow label="Name" err={field === 'name' ? errText(err) : ''}>
        <input type="text" value={name} maxLength={400} onChange={(e) => setName(e.target.value)} data-testid="ads-au-saved-name" data-autofocus />
      </FieldRow>
      <FieldRow label="Description (optional)">
        <input type="text" value={description} maxLength={400} onChange={(e) => setDescription(e.target.value)} data-testid="ads-au-saved-desc" />
      </FieldRow>
      <StepAudience api={api} spec={spec} setSpec={setSpec} hideSavedStart />
      {field.startsWith('audience') && <small className="ads-mg-err" role="alert" data-testid="ads-au-saved-err">{errText(err)}</small>}
      {!!err && !field && <AdsErrorState error={err} />}
    </ManageDialog>
  );
}

// ------------------------------------------------------------------ tab --

export function AdsAudiences({ api, canManageDefault, onRevoked, onReadOnly, refreshNonce, focusId = '' }: {
  api: CrmApi;
  canManageDefault: boolean;
  onRevoked: () => void;
  onReadOnly: () => void;
  refreshNonce: number;
  /** From an ad_audience_ready notification: highlights that audience. */
  focusId?: string;
}) {
  const notify = useNotify();
  const confirm = useConfirm();
  const [data, setData] = useState<AdsAudiencesList | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [n, setN] = useState(0);
  const refreshNext = useRef(false);
  const lastNonce = useRef(refreshNonce);
  const [saved, setSaved] = useState<AdsSavedAudiences | null>(null);
  const [savedN, setSavedN] = useState(0);
  const [dialog, setDialog] = useState<'' | 'contacts' | 'lookalike' | 'saved'>('');
  const [seedId, setSeedId] = useState('');
  const [busyId, setBusyId] = useState('');
  const [jobs, setJobs] = useState<Record<string, AdsAudienceJob>>({});
  const reload = (refresh = false) => {
    refreshNext.current = refresh;
    setN((x) => x + 1);
  };
  useEffect(() => {
    let live = true;
    const refresh = refreshNext.current || lastNonce.current !== refreshNonce;
    lastNonce.current = refreshNonce;
    refreshNext.current = false;
    setError(null);
    api
      .getAdsAudiences(refresh)
      .then((r) => {
        if (!live) return;
        setData(r);
        setJobs((cur) => {
          const next = { ...cur };
          for (const j of r.jobs) next[j.audienceId] = j;
          return next;
        });
      })
      .catch((e) => {
        if (!live) return;
        setError(e);
        if (errCode(e) === 'ADS_REVOKED') onRevoked();
      });
    return () => {
      live = false;
    };
  }, [api, n, refreshNonce]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let live = true;
    api
      .getAdsSavedAudiences(savedN > 0)
      .then((r) => live && setSaved(r))
      .catch(() => live && setSaved({ success: false, meta: [], crm: [], metaError: 'Saved audiences couldn’t be loaded.', createAtMeta: false }));
    return () => {
      live = false;
    };
  }, [api, savedN, refreshNonce]);
  // Poll the running uploads (one poller for the tab and the create dialog).
  // `tick` re-arms the timer even when a poll brings no change (e.g. Meta rate-limiting).
  const [tick, setTick] = useState(0);
  const active = Object.values(jobs).filter((j) => !j.done);
  const activeKey = active.map((j) => j.id).join('|');
  useEffect(() => {
    if (!active.length) return undefined;
    let live = true;
    const t = setTimeout(async () => {
      const updates = await Promise.all(active.map((j) => api.getAdsAudienceJob(j.id).then((r) => r.job).catch(() => j)));
      if (!live) return;
      setJobs((cur) => {
        const next = { ...cur };
        for (const u of updates) next[u.audienceId] = u;
        return next;
      });
      setTick((x) => x + 1);
      const finished = updates.filter((u) => u.done);
      for (const f of finished) {
        if (f.status === 'done') notify('success', 'Audience uploaded', `${f.audienceName}: ${int(f.sent)} contacts. Meta shows the matched size within a few hours.`);
        else notify('error', 'Upload stopped', `${f.audienceName}: ${f.error?.message || 'try again'}`);
      }
      if (finished.length) reload(true);
    }, POLL_MS);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [activeKey, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  // An ad_audience_ready notification: bring that audience into view.
  useEffect(() => {
    if (!focusId || !data) return;
    document.querySelector(`[data-testid="ads-au-row-${CSS.escape(focusId)}"]`)?.scrollIntoView?.({ block: 'center' });
  }, [focusId, data]);

  const canManage = data ? data.canManage : canManageDefault;
  const terms = data?.terms || { accepted: null, url: '' };
  const roWhy = 'The CRM can only read this ad account. Reconnect and allow managing ads (ads_management) to change audiences.';
  const onWriteError = (e: unknown, title = '') => {
    if (errCode(e) === 'READ_ONLY') {
      onReadOnly();
      reload();
    }
    if (errCode(e) === 'ADS_REVOKED') onRevoked();
    if (errCode(e) === 'TERMS_NOT_ACCEPTED') reload(true);
    if (title) notify('error', errTitle(e, title), errText(e));
  };

  async function refreshOne(a: AdsAudienceItem) {
    const f = a.crm?.filter || 'all';
    const d = a.crm?.days || 30;
    let count: number | null = null;
    try {
      count = (await api.getAdsAudienceContacts(f, d)).count;
    } catch {
      count = null;
    }
    const ok = await confirm({
      title: `Refresh “${a.name}”?`,
      message: 'Meta replaces the people in this audience with your current contacts. Ad sets using it keep running and don’t restart learning.',
      points: [`${count === null ? 'Your' : int(count)} contacts: ${filterText(f, d)}`, PRIVACY],
      confirmLabel: 'Replace with current contacts',
      tone: 'primary',
    });
    if (!ok) return;
    setBusyId(a.id);
    try {
      const r = await api.refreshAdsAudience(a.id);
      if (r.job) setJobs((cur) => ({ ...cur, [a.id]: r.job as AdsAudienceJob }));
      notify('success', 'Refresh started', `${a.name}: uploading ${int(r.job?.total || 0)} contacts.`);
    } catch (e) {
      onWriteError(e, 'Audience not refreshed');
    } finally {
      setBusyId('');
    }
  }
  async function deleteOne(a: AdsAudienceItem) {
    const ok = await confirm({
      title: `Delete “${a.name}”?`,
      message: 'The audience is deleted at Meta. Ad sets that use it lose it from their targeting. This can’t be undone.',
      points: [`${TYPE_LABEL[a.type] || a.type} · ${sizeText(a)}`],
      confirmLabel: 'Delete audience',
      tone: 'danger',
    });
    if (!ok) return;
    setBusyId(a.id);
    try {
      await api.deleteAdsAudience(a.id);
      notify('success', 'Audience deleted', a.name);
      reload(true);
    } catch (e) {
      onWriteError(e, 'Audience not deleted');
    } finally {
      setBusyId('');
    }
  }
  async function deleteSaved(s: AdsSavedAudience) {
    const ok = await confirm({ title: `Delete “${s.name}”?`, message: 'This saved audience is removed from the CRM. Campaigns that started from it don’t change.', confirmLabel: 'Delete', tone: 'danger' });
    if (!ok) return;
    try {
      await api.deleteAdsSavedAudience(s.id);
      setSavedN((x) => x + 1);
    } catch (e) {
      onWriteError(e, 'Saved audience not deleted');
    }
  }

  if (error && !data) return <AdsErrorState error={error} onRetry={() => reload(true)} />;
  if (!data) return <BladeSpinner center={true} containerHeight={220} />;
  const list = data.audiences;
  const termsBlocked = terms.accepted === false;
  return (
    <div className="ads-au" data-testid="ads-audiences">
      {termsBlocked && <TermsBox url={terms.url} onRecheck={() => reload(true)} />}
      <section className="ads-card">
        <div className="ads-card-head">
          <h4>Custom and lookalike audiences</h4>
          <div className="ads-au-actions">
            <button
              type="button"
              className="ads-btn primary sm"
              disabled={!canManage || termsBlocked}
              title={!canManage ? roWhy : termsBlocked ? 'Accept Meta’s Custom Audience terms first.' : undefined}
              onClick={() => setDialog('contacts')}
              data-testid="ads-au-new-contacts"
            >
              <span className="material-icons" aria-hidden="true">group_add</span> From CRM contacts
            </button>
            <button
              type="button"
              className="ads-btn sm"
              disabled={!canManage || !list.some((a) => a.type !== 'lookalike' && !a.flagged)}
              title={!canManage ? roWhy : !list.some((a) => a.type !== 'lookalike') ? 'Create a custom audience first: a lookalike needs a source.' : undefined}
              onClick={() => {
                setSeedId('');
                setDialog('lookalike');
              }}
              data-testid="ads-au-new-lookalike"
            >
              <span className="material-icons" aria-hidden="true">diversity_3</span> Lookalike
            </button>
            <button type="button" className="icon-btn" title="Reload from Meta" aria-label="Reload from Meta" onClick={() => reload(true)} data-testid="ads-au-reload">
              <span className="material-icons">refresh</span>
            </button>
          </div>
        </div>
        {!canManage && <p className="ads-wz-hint" data-testid="ads-au-readonly">{roWhy}</p>}
        <p className="ads-wz-hint">{PRIVACY}</p>
        {!list.length ? (
          <div className="ads-empty" data-testid="ads-au-empty">
            <span className="material-icons" aria-hidden="true">groups</span>
            <p>No audiences yet. Upload your WhatsApp contacts to show ads to your customers, or to leave them out.</p>
          </div>
        ) : (
          <div className="ads-table-wrap">
            <table className="ads-table ads-au-table" data-testid="ads-au-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th className="num">Size</th>
                  <th>Status</th>
                  <th>Delivery</th>
                  <th>Updated</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {list.map((a) => {
                  const j = jobs[a.id] && (!jobs[a.id].done || jobs[a.id].finishedAt) ? jobs[a.id] : a.crm?.lastJob || null;
                  const running = !!j && !j.done;
                  return (
                    <tr key={a.id} data-testid={`ads-au-row-${a.id}`} className={focusId === a.id ? 'focus' : undefined}>
                      <td className="name">
                        <strong>{a.name}</strong>
                        {a.description && <small className="ads-au-sub">{a.description}</small>}
                        {a.lookalike && (
                          <small className="ads-au-sub">
                            {a.lookalike.ratio ?? '?'}% of {a.lookalike.countries.join(', ') || '—'}{a.lookalike.originName ? ` · from ${a.lookalike.originName}` : ''}
                          </small>
                        )}
                        {a.crm && (
                          <small className="ads-au-sub" data-testid={`ads-au-source-${a.id}`}>
                            From CRM: {filterText(a.crm.filter, a.crm.days)}
                          </small>
                        )}
                        {j && <Progress job={j} testid={`ads-au-job-${a.id}`} />}
                        {a.flagged && <small className="ads-mg-err">Meta flagged this audience; it can’t run ads. {a.operationStatus?.description}</small>}
                      </td>
                      <td data-testid={`ads-au-type-${a.id}`}>{TYPE_LABEL[a.type] || a.type}</td>
                      <td className="num" data-testid={`ads-au-size-${a.id}`}>{sizeText(a)}</td>
                      <td data-testid={`ads-au-status-${a.id}`}>{statusPill(a.operationStatus, 'op')}</td>
                      <td data-testid={`ads-au-delivery-${a.id}`}>{statusPill(a.deliveryStatus, 'delivery')}</td>
                      <td>{a.updatedAt ? new Date(a.updatedAt).toLocaleDateString() : '—'}</td>
                      <td className="ads-au-row-actions">
                        {a.canRefresh && (
                          <button
                            type="button"
                            className="ads-btn sm"
                            disabled={!canManage || running || busyId === a.id || termsBlocked}
                            title={!canManage ? roWhy : running ? 'Uploading…' : 'Replace with your current contacts'}
                            onClick={() => void refreshOne(a)}
                            data-testid={`ads-au-refresh-${a.id}`}
                          >
                            <span className="material-icons" aria-hidden="true">sync</span> Refresh
                          </button>
                        )}
                        {a.type !== 'lookalike' && !a.flagged && (
                          <button
                            type="button"
                            className="ads-btn sm"
                            disabled={!canManage}
                            title={!canManage ? roWhy : 'Create a lookalike of this audience'}
                            onClick={() => {
                              setSeedId(a.id);
                              setDialog('lookalike');
                            }}
                            data-testid={`ads-au-lal-${a.id}`}
                          >
                            Lookalike
                          </button>
                        )}
                        <button
                          type="button"
                          className="ads-btn sm danger"
                          disabled={!canManage || running || busyId === a.id}
                          title={!canManage ? roWhy : running ? 'Wait for the upload to finish.' : 'Delete at Meta'}
                          onClick={() => void deleteOne(a)}
                          data-testid={`ads-au-delete-${a.id}`}
                          aria-label={`Delete ${a.name}`}
                        >
                          <span className="material-icons" aria-hidden="true">delete</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="ads-card" data-testid="ads-au-saved">
        <div className="ads-card-head">
          <h4>Saved audiences</h4>
          <button type="button" className="ads-btn sm" disabled={!canManage} title={!canManage ? roWhy : undefined} onClick={() => setDialog('saved')} data-testid="ads-au-new-saved">
            <span className="material-icons" aria-hidden="true">bookmark_add</span> Save an audience
          </button>
        </div>
        <p className="ads-wz-hint">
          Locations, ages, interests and custom audiences to start a campaign or an ad set from. Meta’s saved audiences are listed read-only (Meta doesn’t let
          other apps create them); the ones you save here are kept in the CRM.
        </p>
        {!saved ? (
          <BladeSpinner center={true} containerHeight={60} />
        ) : (
          <>
            {saved.metaError && <p className="ads-wz-hint">{saved.metaError}</p>}
            {!saved.meta.length && !saved.crm.length ? (
              <p className="ads-wz-hint" data-testid="ads-au-saved-empty">No saved audiences yet.</p>
            ) : (
              <ul className="ads-au-saved-list">
                {[...saved.crm, ...saved.meta].map((s) => (
                  <li key={`${s.source}:${s.id}`} data-testid={`ads-au-saved-${s.source}-${s.id}`}>
                    <div>
                      <strong>{s.name}</strong> <span className={`ads-chip${s.source === 'meta' ? '' : ' green'}`}>{s.source === 'meta' ? 'From Meta' : 'In the CRM'}</span>
                      <small className="ads-au-sub">{savedSummary(s.audience)}{s.sizeLower ? ` · ${compact(s.sizeLower)}–${compact(s.sizeUpper || s.sizeLower)} people` : ''}</small>
                    </div>
                    {s.source === 'crm' && (
                      <button type="button" className="ads-btn sm danger" disabled={!canManage} onClick={() => void deleteSaved(s)} data-testid={`ads-au-saved-delete-${s.id}`} aria-label={`Delete ${s.name}`}>
                        <span className="material-icons" aria-hidden="true">delete</span>
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>
      {dialog === 'contacts' && (
        <ContactsDialog
          api={api}
          terms={terms}
          jobs={jobs}
          onClose={() => {
            setDialog('');
            reload(true);
          }}
          onCreated={(job) => setJobs((cur) => ({ ...cur, [job.audienceId]: job }))}
          onError={(e) => onWriteError(e)}
        />
      )}
      {dialog === 'lookalike' && (
        <LookalikeDialog
          api={api}
          audiences={list}
          seedId={seedId}
          onClose={() => setDialog('')}
          onCreated={(a) => {
            setDialog('');
            notify('success', 'Lookalike created', `${a.name}. Meta fills it within 1–6 hours.`);
            reload(true);
          }}
          onError={(e) => onWriteError(e)}
        />
      )}
      {dialog === 'saved' && (
        <SavedDialog
          api={api}
          onClose={() => setDialog('')}
          onSaved={(s) => {
            setDialog('');
            notify('success', 'Audience saved', s.name);
            setSavedN((x) => x + 1);
          }}
          onError={(e) => onWriteError(e)}
        />
      )}
    </div>
  );
}
