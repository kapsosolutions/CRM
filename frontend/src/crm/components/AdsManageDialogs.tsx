// Ads Manager S2: edit dialogs for an existing campaign, ad set or ad, and the
// preview of an existing ad (Ads → Campaigns → row actions).
//
// Each dialog loads the object fresh from the server (GET /meta/manage/…),
// sends only the fields that changed (PATCH), and never a status: saving an
// edit doesn't turn anything on. The ad set's audience and placements reuse
// the S1 wizard's editors, prefilled from Meta's current targeting; a new
// creative reuses the S1 creative editor and its preview. Meta's preview of an
// existing ad comes back as an iframe src only (checked on the server and
// here) and renders in our own sandboxed iframe.
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CrmApi } from '../api';
import type {
  AdsCampaignSpec, AdsIncreaseSummary, AdsLevel, AdsManageAd, AdsManageAdSet, AdsManageCampaign, AdsManageDetails, AdsManageDetailsResponse, AdsObjectiveKey,
  AdsPreviewFormat, MetaAdsConnection,
} from '../types';
import { useConfirm, useNotify } from './Dialogs';
import { useBackHandler } from '../useBackHandler';
import { AdsErrorState, errCode, errText } from './MetaAdsDashboard';
import { BladeSpinner } from './BladeSpinner';
import {
  BIDS, OBJECTIVES, PREVIEWS, PreviewPanel, StepAudience, StepCreative, StepPlacements, defaultSpec, nowLocal, safePreviewSrc, stepProblems,
} from './AdsCreateWizard';
import './AdsManager.css';

type ApiErr = Error & { data?: { code?: string; field?: string } | null };
const errField = (e: unknown) => (e as ApiErr)?.data?.field || '';
const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], iframe, [tabindex]:not([tabindex="-1"])';
const DAY = 86400000;
const wall = (s: string) => Date.parse(`${s}:00Z`);

function money(v: number | null | undefined, currency: string) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 2 }).format(v);
  } catch {
    return `${v} ${currency}`;
  }
}
const humanGoal = (k: string, key: AdsObjectiveKey | '') =>
  (key && OBJECTIVES[key]?.goals.find((g) => g.key === k)?.label) || k.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());

// ------------------------------------------------------------- shell --

/** A dialog like AdAccountPicker: focus trap, Esc, browser Back; asks before dropping unsaved changes. */
export function ManageDialog({
  title, testid, dirty, onClose, children, footer, wide,
}: {
  title: ReactNode;
  testid: string;
  dirty?: boolean;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const confirm = useConfirm();
  const titleId = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const live = useRef({ dirty, onClose });
  live.current = { dirty, onClose };
  const requestClose = useCallback(async () => {
    if (live.current.dirty) {
      const ok = await confirm({ title: 'Discard your changes?', message: 'Nothing was saved at Meta yet.', confirmLabel: 'Discard', tone: 'danger' });
      if (!ok) return;
    }
    live.current.onClose();
  }, [confirm]);
  useBackHandler(true, () => void requestClose());
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const box = boxRef.current;
    (box?.querySelector<HTMLElement>('[data-autofocus]') || box?.querySelector<HTMLElement>(FOCUSABLE))?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('.app-dialog')) return; // a confirm on top handles its own keys
      if (e.key === 'Escape') {
        e.preventDefault();
        void requestClose();
        return;
      }
      if (e.key !== 'Tab' || !boxRef.current) return;
      const els = Array.from(boxRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (!els.length) return;
      const first = els[0];
      const last = els[els.length - 1];
      const inside = boxRef.current.contains(document.activeElement);
      if (e.shiftKey && (document.activeElement === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (prev && document.contains(prev)) prev.focus?.();
    };
  }, [requestClose]);
  return (
    <div className="ads-dialog-backdrop" onClick={(e) => e.target === e.currentTarget && void requestClose()}>
      <div ref={boxRef} className={`ads-dialog ads-mg-dialog${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} data-testid={testid}>
        <div className="ads-dialog-head">
          <h3 className="ads-dialog-title" id={titleId}>{title}</h3>
          <button type="button" className="ads-dialog-close" onClick={() => void requestClose()} aria-label="Close" data-testid={`${testid}-close`}>
            ✕
          </button>
        </div>
        <div className="ads-dialog-body">{children}</div>
        {footer && <div className="ads-dialog-foot">{footer}</div>}
      </div>
    </div>
  );
}

function Field({ label, hint, err, field, children }: { label: string; hint?: ReactNode; err?: { field: string; message: string } | null; field?: string; children: ReactNode }) {
  return (
    <label className="ads-wz-field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
      {err && field && err.field === field && (
        <small className="ads-mg-err" role="alert" data-testid={`ads-mg-err-${field}`}>
          {err.message}
        </small>
      )}
    </label>
  );
}

/** Loads one object for its dialog. */
function useDetails<T extends AdsManageDetails>(api: CrmApi, level: AdsLevel, id: string) {
  const [d, setD] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    setError(null);
    api
      .getAdsManageDetails<T>(level, id)
      .then((r) => live && setD(r.details))
      .catch((e) => live && setError(e));
    return () => {
      live = false;
    };
  }, [api, level, id, n]);
  return { d, setD, error, retry: () => setN((x) => x + 1) };
}

const LEVEL_WORD: Record<AdsLevel, string> = { campaign: 'Campaign', adset: 'Ad set', ad: 'Ad' };
const FIELD_WORD: Record<string, string> = {
  name: 'name', daily_budget: 'daily budget', lifetime_budget: 'lifetime budget', bid_strategy: 'bid strategy', bid_amount: 'bid', adset_bid_amounts: 'bids',
  spend_cap: 'spend cap', end_time: 'end date', start_time: 'start', targeting: 'audience and placements', optimization_goal: 'optimisation', creative: 'creative',
};
/** "Ad set “Mumbai”: end date" for the saved / not saved lists. */
export const writeLine = (w: { level: AdsLevel; id: string; name?: string; fields: string[] }) =>
  `${LEVEL_WORD[w.level] || w.level} “${w.name || w.id}”: ${w.fields.map((f) => FIELD_WORD[f] || f.replace(/_/g, ' ')).join(', ')}`;

/** The old → new values the server wants confirmed (400 CONFIRM_REQUIRED + summary), or null. */
function increaseOf(e: unknown): AdsIncreaseSummary | null {
  const d = (e as { data?: { code?: string; summary?: AdsIncreaseSummary } } | null)?.data;
  return d?.code === 'CONFIRM_REQUIRED' && d.summary && Array.isArray(d.summary.changes) ? d.summary : null;
}

/**
 * The shared save: PATCH, field errors next to the field, the rest in a box.
 * A change that can raise the spend of something that is on comes back as
 * CONFIRM_REQUIRED with old → new values: they are shown in a confirm, and
 * only then sent again with { confirmIncrease: true }. A save that worked
 * only partly says what was saved and what wasn't.
 */
function useSave<T extends AdsManageDetails>(api: CrmApi, level: AdsLevel, id: string, onSaved: (d: T | null) => void, onError: (e: unknown) => void) {
  const notify = useNotify();
  const confirm = useConfirm();
  const [saving, setSaving] = useState(false);
  const [fieldErr, setFieldErr] = useState<{ field: string; message: string } | null>(null);
  const [error, setError] = useState<unknown>(null);
  async function save(patch: Record<string, unknown>, successText: string) {
    setSaving(true);
    setFieldErr(null);
    setError(null);
    try {
      let r: AdsManageDetailsResponse<T>;
      try {
        r = await api.editAdsObject<T>(level, id, patch);
      } catch (e) {
        const sum = increaseOf(e);
        if (!sum) throw e;
        const ok = await confirm({
          title: 'This can raise what it spends',
          message: `It is on, so Meta applies these at once. Check the new values before you save.`,
          points: sum.changes.map((c) => `${c.label}: ${c.from} → ${c.to}`),
          confirmLabel: 'Save the new values',
          tone: 'primary',
        });
        if (!ok) return false; // nothing was saved
        r = await api.editAdsObject<T>(level, id, { ...patch, confirmIncrease: true });
      }
      const failed = r.failed || [];
      if (r.partial && failed.length) {
        const saved = (r.updated || []).map(writeLine);
        await confirm({
          title: 'Saved only partly',
          message: `Meta stopped part-way: ${failed[0].message} What is listed as saved is live at Meta now; save again to apply the rest.`,
          points: [...saved.map((s) => `Saved · ${s}`), ...failed.map((f) => `Not saved · ${writeLine(f)}`)],
          confirmLabel: 'OK',
          cancelLabel: 'Close',
          tone: 'primary',
        });
      } else if (r.stale) {
        notify('success', 'Saved at Meta', `${successText} The CRM couldn’t load the new values yet; refresh to see them.`);
      } else {
        notify('success', 'Saved at Meta', successText);
      }
      onSaved(r.details);
      return true;
    } catch (e) {
      const f = errField(e);
      if (f) setFieldErr({ field: f, message: errText(e) });
      else setError(e);
      onError(e);
      return false;
    } finally {
      setSaving(false);
    }
  }
  return { saving, fieldErr, error, save };
}

function Footer({ saving, problems, onCancel, onSave, disabledWhy, label = 'Save' }: { saving: boolean; problems: string[]; onCancel: () => void; onSave: () => void; disabledWhy?: string; label?: string }) {
  const why = disabledWhy || problems[0] || '';
  return (
    <>
      {why && (
        <span className="ads-mg-why" data-testid="ads-mg-why">
          {why}
        </span>
      )}
      <button type="button" className="ads-dialog-btn cancel" onClick={onCancel} disabled={saving} data-testid="ads-mg-cancel">
        Cancel
      </button>
      <button type="button" className="ads-dialog-btn primary" onClick={onSave} disabled={saving || !!why} title={why || undefined} data-testid="ads-mg-save">
        {saving ? 'Saving…' : label}
      </button>
    </>
  );
}

const StateNote = ({ d }: { d: AdsManageDetails }) => (
  <>
    {d.locked === 'ADVANTAGE_PLUS' && (
      <div className="ads-wz-warn" role="note" data-testid="ads-mg-locked">
        <span className="material-icons" aria-hidden="true">lock</span>
        <span>This is an Advantage+ shopping or app campaign. Since Marketing API v25, Meta doesn’t let other apps change it. Edit it in Meta Ads Manager.</span>
      </div>
    )}
    {d.archived && (
      <div className="ads-wz-warn" role="note" data-testid="ads-mg-archived">
        <span className="material-icons" aria-hidden="true">inventory_2</span>
        <span>Archived. Meta only lets you rename it (or delete it).</span>
      </div>
    )}
    {d.issues.length > 0 && (
      <div className="ads-mg-review block" role="note" data-testid="ads-mg-issues">
        <span className="material-icons" aria-hidden="true">report</span>
        <span>
          {d.issues.map((i, k) => (
            <span key={k} className="line">
              {i.summary}
              {i.message && i.message !== i.summary ? `: ${i.message}` : ''}
            </span>
          ))}
        </span>
      </div>
    )}
  </>
);

const SAFE_NOTE = 'Changes apply at Meta when you save. Saving never turns anything on.';

// ---------------------------------------------------------- campaign --

export function EditCampaignDialog({ api, id, name, onClose, onSaved, onError }: { api: CrmApi; id: string; name: string; onClose: () => void; onSaved: () => void; onError: (e: unknown) => void }) {
  const { d, error, retry } = useDetails<AdsManageCampaign>(api, 'campaign', id);
  return d ? (
    <CampaignForm api={api} d={d} onClose={onClose} onSaved={onSaved} onError={onError} />
  ) : (
    <ManageDialog title={`Edit campaign · ${name}`} testid="ads-mg-campaign" onClose={onClose}>
      {error ? <AdsErrorState error={error} onRetry={retry} /> : <BladeSpinner center={true} containerHeight={160} />}
    </ManageDialog>
  );
}

function CampaignForm({ api, d, onClose, onSaved, onError }: { api: CrmApi; d: AdsManageCampaign; onClose: () => void; onSaved: () => void; onError: (e: unknown) => void }) {
  const cur = d.account.currency;
  const tz = d.account.timezone;
  const cbo = d.budget.level === 'campaign';
  const init = useMemo(
    () => ({
      name: d.name,
      budget: d.budget.amount === null ? '' : String(d.budget.amount),
      bidStrategy: d.bidStrategy || 'LOWEST_COST_WITHOUT_CAP',
      bidAmount: d.bidAmount === null ? '' : String(d.bidAmount),
      noCap: d.spendCap === null,
      spendCap: d.spendCap === null ? '' : String(d.spendCap),
      noEnd: !d.endTime,
      endTime: d.endTime,
    }),
    [d],
  );
  const [f, setF] = useState(init);
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }));
  const { saving, fieldErr, error, save } = useSave<AdsManageCampaign>(api, 'campaign', d.id, () => {
    onSaved();
    onClose();
  }, onError);
  const anyLifetime = d.budget.type === 'lifetime' || d.adsets.some((s) => s.lifetime);
  const patch: Record<string, unknown> = {};
  if (f.name.trim() !== d.name) patch.name = f.name.trim();
  if (cbo && f.budget !== init.budget) patch.budget = f.budget === '' ? '' : Number(f.budget);
  const capStrategy = f.bidStrategy !== 'LOWEST_COST_WITHOUT_CAP';
  if (cbo && (f.bidStrategy !== init.bidStrategy || (capStrategy && f.bidAmount !== init.bidAmount))) {
    patch.bidStrategy = f.bidStrategy;
    if (capStrategy) patch.bidAmount = f.bidAmount === '' ? '' : Number(f.bidAmount);
  }
  if (f.noCap !== init.noCap || (!f.noCap && f.spendCap !== init.spendCap)) patch.spendCap = f.noCap ? null : f.spendCap === '' ? '' : Number(f.spendCap);
  if (f.noEnd !== init.noEnd || (!f.noEnd && f.endTime !== init.endTime)) patch.endTime = f.noEnd ? '' : f.endTime;
  const dirty = Object.keys(patch).length > 0;
  const problems: string[] = [];
  if (!f.name.trim()) problems.push('Name the campaign.');
  if (f.name.length > 400) problems.push('The name can be at most 400 characters.');
  if ('budget' in patch && !(Number(f.budget) >= d.account.minDailyBudget)) problems.push(`The budget must be at least ${money(d.account.minDailyBudget, cur)}${d.budget.type === 'lifetime' ? ' a day' : ''}.`);
  if ('bidAmount' in patch && !(Number(f.bidAmount) > 0)) problems.push('Enter the bid amount.');
  if ('spendCap' in patch && !f.noCap && !(Number(f.spendCap) >= d.account.minSpendCap)) problems.push(`Meta’s minimum spend cap is about ${money(d.account.minSpendCap, cur)}.`);
  if ('endTime' in patch && !f.noEnd && (!f.endTime || wall(f.endTime) < wall(nowLocal(tz)) + 3600000)) problems.push('The end must be at least an hour from now.');
  const rename = d.archived || !!d.locked;
  return (
    <ManageDialog
      title={`Edit campaign · ${d.name}`}
      testid="ads-mg-campaign"
      dirty={dirty}
      onClose={onClose}
      footer={<Footer saving={saving} problems={problems} onCancel={onClose} onSave={() => void save(patch, `“${f.name.trim()}” was updated.`)} disabledWhy={d.locked ? 'Meta doesn’t let the CRM change this campaign.' : !dirty ? 'Nothing changed yet.' : ''} />}
    >
      <StateNote d={d} />
      <p className="ads-wz-hint">{SAFE_NOTE}</p>
      <Field label="Campaign name" err={fieldErr} field="name">
        <input type="text" value={f.name} maxLength={400} onChange={(e) => set({ name: e.target.value })} data-testid="ads-mg-name" data-autofocus />
      </Field>
      {!rename && (
        <>
          <section className="ads-wz-section">
            <h4>Budget</h4>
            {cbo ? (
              <Field
                label={`${d.budget.type === 'lifetime' ? 'Lifetime' : 'Daily'} budget (${cur}) · Advantage campaign budget`}
                hint={`Meta’s minimum: ${money(d.account.minDailyBudget, cur)} a day.`}
                err={fieldErr}
                field="budget"
              >
                <input type="number" min={0} step={0.01} value={f.budget} onChange={(e) => set({ budget: e.target.value })} data-testid="ads-mg-budget" />
              </Field>
            ) : (
              <p className="ads-wz-hint" data-testid="ads-mg-budget-note">This campaign’s budget is set on each ad set. Edit the ad sets to change it.</p>
            )}
          </section>
          {cbo && (
            <section className="ads-wz-section">
              <h4>Bid strategy</h4>
              <div className="ads-wz-choice" role="radiogroup" aria-label="Bid strategy">
                {BIDS.map(([k, l, t]) => (
                  <label key={k} className={f.bidStrategy === k ? 'on' : ''} title={t}>
                    <input type="radio" name="ads-mg-bid" checked={f.bidStrategy === k} onChange={() => set({ bidStrategy: k })} data-testid={`ads-mg-bid-${k}`} />
                    {l}
                  </label>
                ))}
              </div>
              {capStrategy && (
                <Field label={`${f.bidStrategy === 'COST_CAP' ? 'Cost per result goal' : 'Bid cap'} (${cur})`} hint="Applied to every ad set in this campaign." err={fieldErr} field="bidAmount">
                  <input type="number" min={0} step={0.01} value={f.bidAmount} onChange={(e) => set({ bidAmount: e.target.value })} data-testid="ads-mg-bid-amount" />
                </Field>
              )}
              {fieldErr?.field === 'bidStrategy' && <small className="ads-mg-err" role="alert" data-testid="ads-mg-err-bidStrategy">{fieldErr.message}</small>}
            </section>
          )}
          <section className="ads-wz-section">
            <h4>Spend cap</h4>
            {d.canUseSpendCap ? (
              <>
                <label className="ads-wz-switch">
                  <input type="checkbox" checked={f.noCap} onChange={(e) => set({ noCap: e.target.checked })} data-testid="ads-mg-nocap" />
                  <span>No spend cap</span>
                </label>
                {!f.noCap && (
                  <Field label={`Spend cap (${cur})`} hint={`The campaign stops once it has spent this much in total. Meta’s minimum is about ${money(d.account.minSpendCap, cur)}.`} err={fieldErr} field="spendCap">
                    <input type="number" min={0} step={0.01} value={f.spendCap} onChange={(e) => set({ spendCap: e.target.value })} data-testid="ads-mg-spendcap" />
                  </Field>
                )}
                {fieldErr?.field === 'spendCap' && f.noCap && <small className="ads-mg-err" role="alert">{fieldErr.message}</small>}
              </>
            ) : (
              <p className="ads-wz-hint">Meta doesn’t allow a spend cap on this campaign.</p>
            )}
          </section>
          <section className="ads-wz-section">
            <h4>End date</h4>
            <p className="hint">Set on all {d.adsets.length} ad set{d.adsets.length === 1 ? '' : 's'} of the campaign, in the ad account’s time zone ({tz}).</p>
            <label className="ads-wz-switch">
              <input type="checkbox" checked={f.noEnd} disabled={anyLifetime} title={anyLifetime ? 'A lifetime budget needs an end date.' : undefined} onChange={(e) => set({ noEnd: e.target.checked })} data-testid="ads-mg-noend" />
              <span>No end date (runs until you pause it){anyLifetime ? ' — not with a lifetime budget' : ''}</span>
            </label>
            {!f.noEnd && (
              <Field label="End" err={fieldErr} field="endTime">
                <input type="datetime-local" value={f.endTime} min={nowLocal(tz, 3600000)} onChange={(e) => set({ endTime: e.target.value })} data-testid="ads-mg-end" />
              </Field>
            )}
          </section>
        </>
      )}
      {error ? <AdsErrorState error={error} /> : null}
    </ManageDialog>
  );
}

// ------------------------------------------------------------ ad set --

export function EditAdSetDialog({ api, id, name, onClose, onSaved, onError }: { api: CrmApi; id: string; name: string; onClose: () => void; onSaved: () => void; onError: (e: unknown) => void }) {
  const { d, error, retry } = useDetails<AdsManageAdSet>(api, 'adset', id);
  return d ? (
    <AdSetForm api={api} d={d} onClose={onClose} onSaved={onSaved} onError={onError} />
  ) : (
    <ManageDialog title={`Edit ad set · ${name}`} testid="ads-mg-adset" onClose={onClose}>
      {error ? <AdsErrorState error={error} onRetry={retry} /> : <BladeSpinner center={true} containerHeight={160} />}
    </ManageDialog>
  );
}

type AdSetTab = 'basics' | 'audience' | 'placements';

function AdSetForm({ api, d, onClose, onSaved, onError }: { api: CrmApi; d: AdsManageAdSet; onClose: () => void; onSaved: () => void; onError: (e: unknown) => void }) {
  const cur = d.account.currency;
  const tz = d.account.timezone;
  const key = d.campaign.objectiveKey;
  const [tab, setTab] = useState<AdSetTab>('basics');
  const init = useMemo(
    () => ({
      name: d.name,
      budget: d.budget.amount === null ? '' : String(d.budget.amount),
      start: d.schedule.start,
      end: d.schedule.end,
      noEnd: !d.schedule.end,
      goal: d.optimizationGoal,
      bidStrategy: d.campaign.cbo ? d.campaign.bidStrategy || 'LOWEST_COST_WITHOUT_CAP' : d.bidStrategy || 'LOWEST_COST_WITHOUT_CAP',
      bidAmount: d.bidAmount === null ? '' : String(d.bidAmount),
    }),
    [d],
  );
  const [f, setF] = useState(init);
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }));
  // The S1 editors work on a whole wizard spec; only audience and placements are used here.
  const [spec, setSpecRaw] = useState<AdsCampaignSpec>(() => ({
    ...defaultSpec(key || 'awareness'),
    specialAdCategories: d.campaign.specialAdCategories,
    optimizationGoal: d.optimizationGoal,
    audience: d.audience,
    placements: d.placements,
  }));
  const setSpec = useCallback((fn: (s: AdsCampaignSpec) => AdsCampaignSpec) => setSpecRaw((s) => fn(s)), []);
  const { saving, fieldErr, error, save } = useSave<AdsManageAdSet>(api, 'adset', d.id, () => {
    onSaved();
    onClose();
  }, onError);
  useEffect(() => {
    const fld = fieldErr?.field || '';
    if (fld.startsWith('audience')) setTab('audience');
    else if (fld.startsWith('placements')) setTab('placements');
    else if (fld) setTab('basics');
  }, [fieldErr]);
  const lifetime = d.budget.type === 'lifetime';
  const capCampaign = d.campaign.cbo && f.bidStrategy !== 'LOWEST_COST_WITHOUT_CAP';
  const patch: Record<string, unknown> = {};
  if (f.name.trim() !== d.name) patch.name = f.name.trim();
  if (d.budget.own && f.budget !== init.budget) patch.budget = f.budget === '' ? '' : Number(f.budget);
  const schedule: { start?: string; end?: string } = {};
  if (!d.schedule.started && f.start !== init.start && f.start) schedule.start = f.start;
  if (f.noEnd !== init.noEnd || (!f.noEnd && f.end !== init.end)) schedule.end = f.noEnd ? '' : f.end;
  if (Object.keys(schedule).length) patch.schedule = schedule;
  if (f.goal !== init.goal) patch.optimizationGoal = f.goal;
  if (!d.campaign.cbo && (f.bidStrategy !== init.bidStrategy || (f.bidStrategy !== 'LOWEST_COST_WITHOUT_CAP' && f.bidAmount !== init.bidAmount))) {
    patch.bidStrategy = f.bidStrategy;
    if (f.bidStrategy !== 'LOWEST_COST_WITHOUT_CAP') patch.bidAmount = f.bidAmount === '' ? '' : Number(f.bidAmount);
  }
  if (capCampaign && f.bidAmount !== init.bidAmount) patch.bidAmount = f.bidAmount === '' ? '' : Number(f.bidAmount);
  const audienceChanged = JSON.stringify(spec.audience) !== JSON.stringify(d.audience);
  const placementsChanged = JSON.stringify(spec.placements) !== JSON.stringify(d.placements);
  if (audienceChanged) patch.audience = spec.audience;
  if (placementsChanged) patch.placements = spec.placements;
  const dirty = Object.keys(patch).length > 0;
  const problems: string[] = [];
  if (!f.name.trim()) problems.push('Name the ad set.');
  if ('budget' in patch && !lifetime && !(Number(f.budget) >= d.account.minDailyBudget)) problems.push(`The daily budget must be at least ${money(d.account.minDailyBudget, cur)}.`);
  if ('budget' in patch && lifetime && !(Number(f.budget) > 0)) problems.push('Enter a budget.');
  const startW = f.start ? wall(f.start) : wall(nowLocal(tz));
  if (schedule.start && wall(schedule.start) < wall(nowLocal(tz)) - 300000) problems.push('The start time is in the past.');
  if (schedule.end && wall(schedule.end) - startW < DAY) problems.push('The end must be at least 24 hours after the start.');
  if ('bidAmount' in patch && !(Number(f.bidAmount) > 0)) problems.push('Enter the bid amount.');
  problems.push(...stepProblems(2, spec, { options: null, page: null, conn: {} as MetaAdsConnection }));
  problems.push(...stepProblems(3, spec, { options: null, page: null, conn: {} as MetaAdsConnection }));
  const rename = d.archived || !!d.locked;
  const tabs: [AdSetTab, string, boolean][] = [['basics', 'Budget, schedule & bid', false], ['audience', 'Audience', audienceChanged], ['placements', 'Placements', placementsChanged]];
  return (
    <ManageDialog
      title={`Edit ad set · ${d.name}`}
      testid="ads-mg-adset"
      dirty={dirty}
      wide={tab !== 'basics'}
      onClose={onClose}
      footer={<Footer saving={saving} problems={problems} onCancel={onClose} onSave={() => void save(patch, `“${f.name.trim()}” was updated.`)} disabledWhy={d.locked ? 'Meta doesn’t let the CRM change this ad set.' : !dirty ? 'Nothing changed yet.' : ''} />}
    >
      <StateNote d={d} />
      <p className="ads-wz-hint">{SAFE_NOTE}</p>
      <Field label="Ad set name" err={fieldErr} field="name">
        <input type="text" value={f.name} maxLength={400} onChange={(e) => set({ name: e.target.value })} data-testid="ads-mg-name" data-autofocus />
      </Field>
      {!rename && (
        <>
          <nav className="ads-mg-tabs" role="tablist" aria-label="Ad set settings">
            {tabs.map(([k, l, changed]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)} data-testid={`ads-mg-tab-${k}`}>
                {l}
                {changed && <span className="dot" aria-label="changed" />}
              </button>
            ))}
          </nav>
          {tab === 'basics' && (
            <>
              <section className="ads-wz-section">
                <h4>Budget</h4>
                {d.budget.own ? (
                  <Field label={`${lifetime ? 'Lifetime' : 'Daily'} budget (${cur})`} hint={lifetime ? `At least ${money(d.account.minDailyBudget, cur)} × the days it runs.` : `Meta’s minimum: ${money(d.account.minDailyBudget, cur)} a day.`} err={fieldErr} field="budget">
                    <input type="number" min={0} step={0.01} value={f.budget} onChange={(e) => set({ budget: e.target.value })} data-testid="ads-mg-budget" />
                  </Field>
                ) : (
                  <p className="ads-wz-hint" data-testid="ads-mg-budget-note">This ad set uses the campaign’s budget (Advantage campaign budget). Edit the campaign to change it.</p>
                )}
              </section>
              <section className="ads-wz-section">
                <h4>Schedule</h4>
                <p className="hint">Times are in the ad account’s time zone ({tz}).</p>
                <div className="ads-wz-row">
                  <Field label="Start" hint={d.schedule.started ? 'Already started, so it can’t change.' : undefined} err={fieldErr} field="schedule.start">
                    <input type="datetime-local" value={f.start} disabled={d.schedule.started} title={d.schedule.started ? 'This ad set has already started.' : undefined} min={nowLocal(tz)} onChange={(e) => set({ start: e.target.value })} data-testid="ads-mg-start" />
                  </Field>
                  <Field label={lifetime ? 'End (required)' : 'End'} err={fieldErr} field="schedule.end">
                    <input type="datetime-local" value={f.end} disabled={f.noEnd} min={nowLocal(tz, 3600000)} onChange={(e) => set({ end: e.target.value })} data-testid="ads-mg-end" />
                  </Field>
                </div>
                <label className="ads-wz-switch">
                  <input type="checkbox" checked={f.noEnd} disabled={lifetime} title={lifetime ? 'A lifetime budget needs an end date.' : undefined} onChange={(e) => set({ noEnd: e.target.checked })} data-testid="ads-mg-noend" />
                  <span>No end date{lifetime ? ' (not with a lifetime budget)' : ''}</span>
                </label>
              </section>
              <section className="ads-wz-section">
                <h4>Optimisation and bid</h4>
                <Field label="Optimise for" hint={d.goals.length < 2 ? 'Meta offers no other goal for this campaign’s objective.' : undefined} err={fieldErr} field="optimizationGoal">
                  <select value={f.goal} disabled={d.goals.length < 2} onChange={(e) => set({ goal: e.target.value })} data-testid="ads-mg-goal">
                    {d.goals.map((g) => (
                      <option key={g} value={g}>
                        {humanGoal(g, key)}
                      </option>
                    ))}
                  </select>
                </Field>
                {d.campaign.cbo ? (
                  capCampaign ? (
                    <Field label={`${f.bidStrategy === 'COST_CAP' ? 'Cost per result goal' : 'Bid cap'} for this ad set (${cur})`} hint="The campaign sets the bid strategy." err={fieldErr} field="bidAmount">
                      <input type="number" min={0} step={0.01} value={f.bidAmount} onChange={(e) => set({ bidAmount: e.target.value })} data-testid="ads-mg-bid-amount" />
                    </Field>
                  ) : (
                    <p className="ads-wz-hint" data-testid="ads-mg-bid-note">The campaign’s bid strategy (highest volume) applies. Edit the campaign to change it.</p>
                  )
                ) : (
                  <>
                    <div className="ads-wz-choice" role="radiogroup" aria-label="Bid strategy">
                      {BIDS.map(([k, l, t]) => (
                        <label key={k} className={f.bidStrategy === k ? 'on' : ''} title={t}>
                          <input type="radio" name="ads-mg-adset-bid" checked={f.bidStrategy === k} onChange={() => set({ bidStrategy: k })} data-testid={`ads-mg-bid-${k}`} />
                          {l}
                        </label>
                      ))}
                    </div>
                    {f.bidStrategy !== 'LOWEST_COST_WITHOUT_CAP' && (
                      <Field label={`${f.bidStrategy === 'COST_CAP' ? 'Cost per result goal' : 'Bid cap'} (${cur})`} err={fieldErr} field="bidAmount">
                        <input type="number" min={0} step={0.01} value={f.bidAmount} onChange={(e) => set({ bidAmount: e.target.value })} data-testid="ads-mg-bid-amount" />
                      </Field>
                    )}
                  </>
                )}
              </section>
            </>
          )}
          {tab === 'audience' && (
            <div data-testid="ads-mg-audience">
              {d.targetingNotes.length > 0 && (
                <ul className="ads-mg-notes" data-testid="ads-mg-targeting-notes">
                  {d.targetingNotes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              )}
              <StepAudience api={api} spec={spec} setSpec={setSpec} />
              {fieldErr?.field.startsWith('audience') && <small className="ads-mg-err" role="alert" data-testid="ads-mg-err-audience">{fieldErr.message}</small>}
            </div>
          )}
          {tab === 'placements' && (
            <div data-testid="ads-mg-placements">
              <StepPlacements spec={spec} setSpec={setSpec} />
              {fieldErr?.field.startsWith('placements') && <small className="ads-mg-err" role="alert">{fieldErr.message}</small>}
            </div>
          )}
        </>
      )}
      {error ? <AdsErrorState error={error} /> : null}
    </ManageDialog>
  );
}

// ---------------------------------------------------------------- ad --

export function EditAdDialog({
  api, id, name, conn, onClose, onSaved, onError, onReconnect,
}: {
  api: CrmApi;
  id: string;
  name: string;
  conn: MetaAdsConnection;
  onClose: () => void;
  onSaved: () => void;
  onError: (e: unknown) => void;
  onReconnect: () => void;
}) {
  const { d, error, retry } = useDetails<AdsManageAd>(api, 'ad', id);
  return d ? (
    <AdForm api={api} d={d} conn={conn} onClose={onClose} onSaved={onSaved} onError={onError} onReconnect={onReconnect} />
  ) : (
    <ManageDialog title={`Edit ad · ${name}`} testid="ads-mg-ad" onClose={onClose}>
      {error ? <AdsErrorState error={error} onRetry={retry} /> : <BladeSpinner center={true} containerHeight={160} />}
    </ManageDialog>
  );
}

function AdForm({ api, d, conn, onClose, onSaved, onError, onReconnect }: { api: CrmApi; d: AdsManageAd; conn: MetaAdsConnection; onClose: () => void; onSaved: () => void; onError: (e: unknown) => void; onReconnect: () => void }) {
  const [name, setName] = useState(d.name);
  const [change, setChange] = useState(false);
  const key: AdsObjectiveKey = d.objectiveKey || 'awareness';
  const [spec, setSpecRaw] = useState<AdsCampaignSpec>(() => {
    const base = defaultSpec(key, d.identity.pageId);
    const ctas = OBJECTIVES[key].ctas;
    return {
      ...base,
      specialAdCategories: d.specialAdCategories,
      identity: { pageId: d.identity.pageId, instagramId: d.identity.instagramId },
      creative: { ...base.creative, ...d.creative, cta: ctas.includes(d.creative.cta) ? d.creative.cta : ctas[0], whatsapp: { ...base.creative.whatsapp, ...d.creative.whatsapp } },
    };
  });
  const [creativeDirty, setCreativeDirty] = useState(false);
  const setSpec = useCallback((fn: (s: AdsCampaignSpec) => AdsCampaignSpec) => {
    setSpecRaw((s) => fn(s));
    setCreativeDirty(true);
  }, []);
  const { saving, fieldErr, error, save } = useSave<AdsManageAd>(api, 'ad', d.id, () => {
    onSaved();
    onClose();
  }, onError);
  const patch: Record<string, unknown> = {};
  if (name.trim() !== d.name) patch.name = name.trim();
  if (change) {
    patch.creative = spec.creative;
    patch.identity = spec.identity;
  }
  const dirty = !!patch.name || (change && creativeDirty);
  const problems: string[] = [];
  if (!name.trim()) problems.push('Name the ad.');
  if (change) problems.push(...stepProblems(5, spec, { options: null, page: null, conn }));
  if (change && !spec.identity.pageId) problems.push('This ad has no Facebook Page the CRM can use. Change it in Meta Ads Manager.');
  const canManage = conn.canManage;
  return (
    <ManageDialog
      title={`Edit ad · ${d.name}`}
      testid="ads-mg-ad"
      dirty={dirty}
      wide={change}
      onClose={onClose}
      footer={
        <Footer
          saving={saving}
          problems={problems}
          onCancel={onClose}
          onSave={() => void save(patch, change ? 'A new creative was created and the ad now uses it. Meta reviews the ad again.' : `“${name.trim()}” was renamed.`)}
          disabledWhy={d.locked ? 'Meta doesn’t let the CRM change this ad.' : !Object.keys(patch).length || (change && !creativeDirty && !patch.name) ? 'Nothing changed yet.' : ''}
          label={change ? 'Save new creative' : 'Save'}
        />
      }
    >
      <StateNote d={d} />
      {d.reviewFeedback.length > 0 && (
        <div className="ads-mg-review block" role="note" data-testid="ads-mg-feedback">
          <span className="material-icons" aria-hidden="true">gpp_bad</span>
          <span>
            <span className="line"><strong>Meta rejected this ad:</strong></span>
            {d.reviewFeedback.map((r, i) => (
              <span key={i} className="line">{r}</span>
            ))}
          </span>
        </div>
      )}
      <p className="ads-wz-hint">{SAFE_NOTE}</p>
      <Field label="Ad name" err={fieldErr} field="name">
        <input type="text" value={name} maxLength={400} onChange={(e) => setName(e.target.value)} data-testid="ads-mg-name" data-autofocus />
      </Field>
      {!d.archived && !d.locked && (
        <section className="ads-wz-section">
          <h4>Creative</h4>
          {d.creativeEditable ? (
            <>
              <label className="ads-wz-switch">
                <input type="checkbox" checked={change} onChange={(e) => setChange(e.target.checked)} data-testid="ads-mg-change-creative" />
                <span>
                  <strong>Change the creative</strong>
                  <br />
                  Meta’s creatives can’t be edited, so the CRM creates a new one from what you enter and points the ad at it. Meta reviews the ad again; its status stays as it is.
                  {d.creativeNote ? ` ${d.creativeNote}` : ''}
                </span>
              </label>
            </>
          ) : (
            <p className="ads-wz-hint" data-testid="ads-mg-creative-note">{d.creativeNote || 'The creative of this ad can’t be changed here.'}</p>
          )}
        </section>
      )}
      {change && (
        <div className="ads-mg-creative" data-testid="ads-mg-creative">
          <div className="main">
            <StepCreative api={api} spec={spec} setSpec={setSpec} conn={conn} canManage={canManage} onReconnect={onReconnect} />
            {fieldErr?.field.startsWith('creative') && <small className="ads-mg-err" role="alert" data-testid="ads-mg-err-creative">{fieldErr.message}</small>}
          </div>
          <aside className="side" aria-label="Preview of the new creative">
            <PreviewPanel api={api} spec={spec} pageName="" ready={!!spec.identity.pageId && stepProblems(5, spec, { options: null, page: null, conn }).length === 0} />
          </aside>
        </div>
      )}
      {error ? <AdsErrorState error={error} /> : null}
    </ManageDialog>
  );
}

// ----------------------------------------------------------- preview --

/** Meta's preview of an existing ad, in our own sandboxed iframe. */
export function AdPreviewDialog({ api, id, name, onClose }: { api: CrmApi; id: string; name: string; onClose: () => void }) {
  const [format, setFormat] = useState<AdsPreviewFormat>('facebook_feed');
  const [shots, setShots] = useState<Partial<Record<AdsPreviewFormat, { src?: string; error?: unknown }>>>({});
  const [n, setN] = useState(0);
  useEffect(() => {
    if (shots[format]) return undefined;
    let live = true;
    api
      .getAdPreview(id, format)
      .then((r) => {
        if (!live) return;
        const src = safePreviewSrc(r.src);
        setShots((s) => ({ ...s, [format]: src ? { src } : { error: new Error('Meta returned a preview the CRM can’t show.') } }));
      })
      .catch((e) => live && setShots((s) => ({ ...s, [format]: { error: e } })));
    return () => {
      live = false;
    };
  }, [api, id, format, n]); // eslint-disable-line react-hooks/exhaustive-deps
  const shot = shots[format];
  return (
    <ManageDialog title={`Preview · ${name}`} testid="ads-mg-preview" onClose={onClose}>
      <div className="ads-wz-preview-tabs" role="tablist" aria-label="Placement">
        {PREVIEWS.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={format === k} className={format === k ? 'on' : ''} onClick={() => setFormat(k)} data-testid={`ads-mg-preview-${k}`} data-autofocus={k === 'facebook_feed' ? true : undefined}>
            {l}
          </button>
        ))}
      </div>
      {shot?.src ? (
        <iframe
          key={shot.src}
          className="ads-wz-iframe"
          src={shot.src}
          title={`Meta preview: ${PREVIEWS.find((x) => x[0] === format)?.[1]}`}
          sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
          loading="lazy"
          data-testid="ads-mg-preview-iframe"
        />
      ) : shot?.error ? (
        <AdsErrorState
          error={shot.error}
          onRetry={() => {
            setShots((s) => ({ ...s, [format]: undefined }));
            setN((x) => x + 1);
          }}
        />
      ) : (
        <BladeSpinner center={true} containerHeight={200} />
      )}
      <p className="ads-wz-hint" style={{ marginTop: 8 }}>
        {errCode(shot?.error) === 'RATE_LIMITED' ? 'Meta is busy; try again shortly.' : 'This is Meta’s own preview of the live ad.'}
      </p>
    </ManageDialog>
  );
}

/** The right edit dialog for a level. */
export function EditDialog(props: { api: CrmApi; level: AdsLevel; id: string; name: string; conn: MetaAdsConnection; onClose: () => void; onSaved: () => void; onError: (e: unknown) => void; onReconnect: () => void }) {
  const { level, ...rest } = props;
  if (level === 'campaign') return <EditCampaignDialog {...rest} />;
  if (level === 'adset') return <EditAdSetDialog {...rest} />;
  return <EditAdDialog {...rest} />;
}
