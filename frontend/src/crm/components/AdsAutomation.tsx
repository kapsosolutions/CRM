// Ads Manager S5: the Automation tab (Ads → Automation) with three parts:
//   • Rules: Meta's automated rules (list, builder from 4 templates, on / off,
//     edit, delete, history). The server builds the rule from these fields and
//     answers with a plain-language summary; turning a rule on (or saving an
//     enabled one) asks first and shows that summary. Budget increases always
//     carry a cap, shown on the row and in every confirm.
//   • A/B tests: Meta split tests (list, results, create) and the CRM
//     comparison of 2–5 campaigns or ad sets with a significance check.
//   • Pixels: the ad account's pixels, their events, and the base code to copy.
// Nothing here turns a campaign, ad set or ad on.
import { CopyIcon } from './AppIcons';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CrmApi } from '../api';
import type {
  AdCampaignRow, AdSetRow, AdsCompareResult, AdsPixelDetails, AdsPixelsList, AdsRange, AdsRule, AdsRuleHistory, AdsRuleLevel, AdsRuleMetric,
  AdsRuleOperator, AdsRulePreview, AdsRuleSpec, AdsRuleSummary, AdsRulesList, AdsRuleTemplateKey, AdsTestDetails, AdsTestInput, AdsTestMetric, AdsTestsList,
} from '../types';
import { useConfirm, useNotify } from './Dialogs';
import { BladeSpinner } from './BladeSpinner';
import { AdsErrorState, errCode, errText, errTitle } from './MetaAdsDashboard';
import { ManageDialog } from './AdsManageDialogs';
import { PIXEL_STATE, ago } from './AdsPixelPicker';
import './AdsManager.css';

type ApiErr = Error & { data?: { code?: string; field?: string; summary?: AdsRuleSummary & { cells?: string[] }; summaryHash?: string } | null };
const errField = (e: unknown) => (e as ApiErr)?.data?.field || '';
const errSummary = (e: unknown) => (e as ApiErr)?.data?.summary || null;
const errHash = (e: unknown) => (e as ApiErr)?.data?.summaryHash || '';
/** Meta runs every rule that isn't DISABLED (HAS_ISSUES included), so the CRM treats those as on. */
const ruleOn = (r: Pick<AdsRule, 'status'>) => r.status !== 'DISABLED';
/** The confirm points for a rule summary: the per-ad-set cap and, for outside rules, Meta's action type. */
function summaryPoints(s: AdsRuleSummary): string[] {
  const out: string[] = [];
  if (s.capText) out.push(s.capText);
  else if (s.cap) out.push(`Budget cap: never above ${s.cap} a day per ad set.`);
  if (s.outside && s.actionType) out.push(`Action at Meta: ${s.actionType}.`);
  return out;
}
/** How many times a confirm is shown again after 409 SUMMARY_STALE before giving up. */
const STALE_RETRIES = 2;
const RO_WHY = 'The CRM can only read this ad account. Reconnect and allow managing ads (ads_management) to create or change rules and tests.';
const TEMPLATE_ICON: Record<AdsRuleTemplateKey, string> = {
  pause_high_cpr: 'pause_circle', pause_spend_no_results: 'money_off', increase_budget_low_cpr: 'trending_up', notify_only: 'notifications_active',
};
const TEMPLATE_TEXT: Record<AdsRuleTemplateKey, string> = {
  pause_high_cpr: 'Stop ad sets whose cost per result climbs above your limit.',
  pause_spend_no_results: 'Stop ad sets that spend without getting any results.',
  increase_budget_low_cpr: 'Give cheap, working ad sets more daily budget, up to a cap you set.',
  notify_only: 'Get a Facebook notification; nothing is changed.',
};
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const clock = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const HALF_HOURS = Array.from({ length: 48 }, (_, i) => i * 30);
function money(n: number | null | undefined, cur: string) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur || 'USD', maximumFractionDigits: 2 }).format(Number(n));
  } catch {
    return `${cur} ${Number(n).toFixed(2)}`;
  }
}
const int = (n: number | null | undefined) => (n === null || n === undefined ? '—' : Math.round(Number(n)).toLocaleString());
const pct = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${Number(n).toFixed(2)}%`);
/** Now (plus ms) as 'YYYY-MM-DDTHH:mm' in `tz`, rounded up to the next hour. */
function localIn(tz: string, plusMs: number) {
  const t = new Date(Math.ceil((Date.now() + plusMs) / 3600000) * 3600000);
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'UTC', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(t).map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
  } catch {
    return t.toISOString().slice(0, 16);
  }
}

function Field({ label, hint, err, children }: { label: string; hint?: ReactNode; err?: string; children: ReactNode }) {
  return (
    <label className="ads-wz-field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
      {err && <small className="ads-mg-err" role="alert">{err}</small>}
    </label>
  );
}

/** Shared by every write: read-only, revoked and Meta's errors. */
function useWriteErrors(onReadOnly: () => void, onRevoked: () => void, setCanManage: (v: boolean) => void) {
  const notify = useNotify();
  return (e: unknown, title: string) => {
    if (errCode(e) === 'READ_ONLY') {
      setCanManage(false);
      onReadOnly();
    }
    if (errCode(e) === 'ADS_REVOKED') onRevoked();
    if (title) notify('error', errTitle(e, title), errText(e));
  };
}

// ---------------------------------------------------- object picker --

/**
 * Pick campaigns (or ad sets, through their campaign) of this ad account.
 * `names` keeps the names of what was picked for the chips.
 */
function ObjectPicker({ api, range, level, ids, onChange, max, testid }: {
  api: CrmApi;
  range: AdsRange;
  level: 'campaign' | 'adset';
  ids: string[];
  onChange: (ids: string[], names: Record<string, string>) => void;
  max: number;
  testid: string;
}) {
  const [campaigns, setCampaigns] = useState<AdCampaignRow[] | null>(null);
  const [campaignId, setCampaignId] = useState('');
  const [adsets, setAdsets] = useState<AdSetRow[] | null>(null);
  const [err, setErr] = useState('');
  const names = useRef<Record<string, string>>({});
  useEffect(() => {
    let live = true;
    api.getAdCampaigns(range).then((r) => live && setCampaigns(r.campaigns)).catch((e) => live && setErr(errText(e)));
    return () => {
      live = false;
    };
  }, [api, range]);
  useEffect(() => {
    if (level !== 'adset' || !campaignId) return undefined;
    let live = true;
    setAdsets(null);
    api.getAdSets(campaignId, range).then((r) => live && setAdsets(r.adsets)).catch((e) => live && setErr(errText(e)));
    return () => {
      live = false;
    };
  }, [api, range, level, campaignId]);
  const list: { id: string; name: string; effectiveStatus: string }[] = level === 'campaign' ? campaigns || [] : adsets || [];
  const toggle = (o: { id: string; name: string }) => {
    names.current[o.id] = o.name;
    const next = ids.includes(o.id) ? ids.filter((x) => x !== o.id) : [...ids, o.id];
    onChange(next.slice(0, max), names.current);
  };
  if (err) return <p className="ads-mg-err">{err}</p>;
  if (!campaigns) return <BladeSpinner center={true} containerHeight={50} />;
  return (
    <div className="ads-auto-picker" data-testid={testid}>
      {level === 'adset' && (
        <Field label="Campaign" hint="Pick a campaign, then tick its ad sets. You can tick ad sets from several campaigns.">
          <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)} data-testid={`${testid}-campaign`}>
            <option value="">Choose a campaign…</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </Field>
      )}
      {level === 'adset' && campaignId && !adsets && <BladeSpinner center={true} containerHeight={40} />}
      {(level === 'campaign' || adsets) && (
        <ul className="ads-auto-picklist">
          {!list.length && <li className="ads-wz-hint">Nothing here yet.</li>}
          {list.map((o) => (
            <li key={o.id}>
              <label>
                <input
                  type="checkbox"
                  checked={ids.includes(o.id)}
                  disabled={!ids.includes(o.id) && ids.length >= max}
                  onChange={() => toggle(o)}
                  data-testid={`${testid}-pick-${o.id}`}
                />
                <span>{o.name}</span>
                <small className={`ads-pill ${o.effectiveStatus === 'ACTIVE' ? 'green' : ''}`}>{o.effectiveStatus.replace(/_/g, ' ').toLowerCase()}</small>
              </label>
            </li>
          ))}
        </ul>
      )}
      <small className="ads-wz-hint" data-testid={`${testid}-count`}>
        {ids.length} picked{max < 50 ? ` (at most ${max})` : ''}
      </small>
    </div>
  );
}

// ------------------------------------------------------ rule builder --

const emptyCondition = (): AdsRuleSpec['conditions'][number] => ({ metric: 'spent', operator: 'GREATER_THAN', value: '' });

function RuleDialog({ api, range, data, rule, onClose, onSaved, onError }: {
  api: CrmApi;
  range: AdsRange;
  data: AdsRulesList;
  /** Editing this rule; null = a new one. */
  rule: AdsRule | null;
  onClose: () => void;
  onSaved: (r: AdsRule, enabled: boolean) => void;
  onError: (e: unknown) => void;
}) {
  const confirm = useConfirm();
  const cur = data.account.currency;
  const [template, setTemplate] = useState<AdsRuleTemplateKey | ''>(rule ? (rule.template === 'custom' ? 'notify_only' : rule.template) : '');
  const [spec, setSpec] = useState<AdsRuleSpec | null>(rule?.spec ? JSON.parse(JSON.stringify(rule.spec)) : null);
  // The server's preview, tagged with the exact spec (as JSON) it describes.
  const [pv, setPv] = useState<{ key: string; data: AdsRulePreview } | null>(null);
  const [previewErr, setPreviewErr] = useState<unknown>(null);
  const [saveErr, setSaveErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const m = data.options.metrics;
  const specKey = useMemo(() => (spec ? JSON.stringify(spec) : ''), [spec]);
  // Only a preview of the current spec counts: anything older is "Checking…".
  const preview = pv && pv.key === specKey ? pv.data : null;
  function pick(k: AdsRuleTemplateKey) {
    const t = data.templates[k];
    setTemplate(k);
    setSpec({ name: t.label, ...JSON.parse(JSON.stringify(t.spec)) });
    setPv(null);
    setDirty(true);
  }
  const set = (fn: (s: AdsRuleSpec) => AdsRuleSpec) => {
    setSpec((s) => (s ? fn(s) : s));
    setPv(null);
    setDirty(true);
  };
  // The server's own summary of what the rule will do (debounced).
  useEffect(() => {
    if (!spec) return undefined;
    let live = true;
    const key = JSON.stringify(spec);
    const t = setTimeout(() => {
      api
        .previewAdsRule(JSON.parse(key) as AdsRuleSpec)
        .then((r) => {
          if (!live) return;
          setPv({ key, data: r });
          setPreviewErr(null);
        })
        .catch((e) => {
          if (!live) return;
          setPv(null);
          setPreviewErr(e);
        });
    }, 350);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [api, spec]);
  const field = errField(saveErr) || errField(previewErr);
  const fieldErr = (f: string) => (field === f ? errText(saveErr && errField(saveErr) ? saveErr : previewErr) : '');
  const isBudget = spec?.action.type === 'CHANGE_BUDGET';
  const editingOn = !!rule && ruleOn(rule);
  async function save(turnOn: boolean) {
    if (!spec) return;
    // Send exactly the spec the shown summary describes.
    const key = JSON.stringify(spec);
    const sending = JSON.parse(key) as AdsRuleSpec;
    const needsConfirm = turnOn || editingOn;
    let shown = pv && pv.key === key ? { summary: pv.data.summary, hash: pv.data.summaryHash } : null;
    if (needsConfirm && !shown) return; // the buttons wait for a preview of this spec
    setBusy(true);
    setSaveErr(null);
    try {
      for (let attempt = 0; ; attempt += 1) {
        if (needsConfirm && shown) {
          // eslint-disable-next-line no-await-in-loop
          const ok = await confirm({
            title: attempt ? 'The summary changed: check it again' : rule ? `Save changes to “${sending.name}”?` : `Create “${sending.name}” and turn it on?`,
            message: shown.summary.text,
            points: [
              ...summaryPoints(shown.summary),
              editingOn ? 'This rule is on: the change applies at Meta straight away.' : 'Meta runs the rule on its own schedule, even when the CRM is closed. You can turn it off here at any time.',
            ],
            confirmLabel: rule ? 'Save changes' : 'Create and turn on',
            tone: 'primary',
          });
          if (!ok) return;
        }
        try {
          // eslint-disable-next-line no-await-in-loop
          const r = rule
            ? await api.updateAdsRule(rule.id, sending, editingOn, shown?.hash || '')
            : await api.createAdsRule(sending, turnOn, turnOn, shown?.hash || '');
          onSaved(r.rule, turnOn || editingOn);
          return;
        } catch (e) {
          // The server summarised something other than what was confirmed: show its summary of this spec.
          const fresh = errSummary(e);
          if (needsConfirm && errCode(e) === 'SUMMARY_STALE' && fresh && errHash(e) && attempt < STALE_RETRIES) {
            shown = { summary: fresh, hash: errHash(e) };
            continue;
          }
          throw e;
        }
      }
    } catch (e) {
      setSaveErr(e);
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  const scopeLevel: 'campaign' | 'adset' = spec?.scope.type === 'adsets' ? 'adset' : 'campaign';
  return (
    <ManageDialog
      title={rule ? `Edit rule: ${rule.name}` : 'New automated rule'}
      testid="ads-rule-dialog"
      wide={true}
      dirty={dirty}
      onClose={onClose}
      footer={spec ? (
        <div className="ads-mg-foot">
          {editingOn && <small className="ads-wz-hint">This rule is on. Saving asks first.</small>}
          {!busy && !preview && !previewErr && <small className="ads-wz-hint" data-testid="ads-rule-wait">Waiting for the summary of these settings…</small>}
          <button type="button" className="ads-btn" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="ads-btn"
            disabled={busy || (!!rule && !preview)}
            title={rule && !preview ? 'Waiting for the summary of these settings.' : undefined}
            onClick={() => void save(false)}
            data-testid="ads-rule-save"
          >
            {busy ? 'Saving…' : rule ? 'Save changes' : 'Save (off)'}
          </button>
          {!rule && (
            <button
              type="button"
              className="ads-btn primary"
              disabled={busy || !preview}
              title={!preview ? 'Waiting for the summary of these settings.' : undefined}
              onClick={() => void save(true)}
              data-testid="ads-rule-save-on"
            >
              Save and turn on
            </button>
          )}
        </div>
      ) : undefined}
    >
      {!spec ? (
        <section className="ads-wz-section">
          <h4>Start from a template</h4>
          <div className="ads-auto-templates">
            {(Object.keys(data.templates) as AdsRuleTemplateKey[]).map((k) => (
              <button key={k} type="button" className={`ads-wz-goal${template === k ? ' on' : ''}`} onClick={() => pick(k)} data-testid={`ads-rule-tpl-${k}`}>
                <span className="material-icons" aria-hidden="true">{TEMPLATE_ICON[k]}</span>
                <span>
                  <strong>{data.templates[k].label}</strong>
                  <small>{TEMPLATE_TEXT[k]}</small>
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : (
        <>
          {saveErr && !errField(saveErr) ? <div className="ads-state amber" role="alert" data-testid="ads-rule-error"><div>{errText(saveErr)}</div></div> : null}
          <Field label="Rule name" err={fieldErr('name')}>
            <input type="text" value={spec.name} maxLength={400} onChange={(e) => set((s) => ({ ...s, name: e.target.value }))} data-testid="ads-rule-name" data-autofocus />
          </Field>
          <section className="ads-wz-section">
            <h4>Apply to</h4>
            <div className="ads-wz-row">
              <Field label="Level" err={fieldErr('level')}>
                <select
                  value={spec.level}
                  disabled={isBudget}
                  title={isBudget ? 'Budget increases work on ad sets with their own daily budget.' : undefined}
                  onChange={(e) => set((s) => ({ ...s, level: e.target.value as AdsRuleLevel, scope: e.target.value === 'CAMPAIGN' && s.scope.type === 'adsets' ? { type: 'all_active', ids: [] } : s.scope }))}
                  data-testid="ads-rule-level"
                >
                  <option value="CAMPAIGN">Campaigns</option>
                  <option value="ADSET">Ad sets</option>
                  <option value="AD">Ads</option>
                </select>
              </Field>
              <Field label="Which ones" err={fieldErr('scope.type') || fieldErr('scope.ids')}>
                <select value={spec.scope.type} onChange={(e) => set((s) => ({ ...s, scope: { type: e.target.value as AdsRuleSpec['scope']['type'], ids: [] } }))} data-testid="ads-rule-scope">
                  <option value="all_active">All active {spec.level === 'CAMPAIGN' ? 'campaigns' : spec.level === 'ADSET' ? 'ad sets' : 'ads'}</option>
                  <option value="campaigns">{spec.level === 'CAMPAIGN' ? 'Specific campaigns' : 'In specific campaigns'}</option>
                  {spec.level !== 'CAMPAIGN' && <option value="adsets">{spec.level === 'ADSET' ? 'Specific ad sets' : 'In specific ad sets'}</option>}
                </select>
              </Field>
            </div>
            {spec.scope.type !== 'all_active' && (
              <ObjectPicker api={api} range={range} level={scopeLevel} ids={spec.scope.ids} max={50} onChange={(ids) => set((s) => ({ ...s, scope: { ...s.scope, ids } }))} testid="ads-rule-pick" />
            )}
          </section>
          <section className="ads-wz-section">
            <h4>Conditions</h4>
            <Field label="Time range" hint="Meta adds up the numbers over this period. The “incl. today” ranges count today too." err={fieldErr('timePreset')}>
              <select value={spec.timePreset} onChange={(e) => set((s) => ({ ...s, timePreset: e.target.value }))} data-testid="ads-rule-time">
                {Object.entries(data.options.timePresets).map(([k, l]) => (
                  <option key={k} value={k}>{l}</option>
                ))}
              </select>
            </Field>
            {spec.conditions.map((c, i) => {
              const kind = m[c.metric]?.kind;
              return (
                // eslint-disable-next-line react/no-array-index-key
                <div className="ads-auto-cond" key={i} data-testid={`ads-rule-cond-${i}`}>
                  <select value={c.metric} onChange={(e) => set((s) => ({ ...s, conditions: s.conditions.map((x, j) => (j === i ? { ...x, metric: e.target.value as AdsRuleMetric, operator: m[e.target.value as AdsRuleMetric].kind !== 'int' && x.operator === 'EQUAL' ? 'GREATER_THAN' : x.operator } : x)) }))} aria-label="Metric" data-testid={`ads-rule-cond-${i}-metric`}>
                    {(Object.keys(m) as AdsRuleMetric[]).map((k) => (
                      <option key={k} value={k}>{m[k].label}</option>
                    ))}
                  </select>
                  <select value={c.operator} onChange={(e) => set((s) => ({ ...s, conditions: s.conditions.map((x, j) => (j === i ? { ...x, operator: e.target.value as AdsRuleOperator } : x)) }))} aria-label="Comparison" data-testid={`ads-rule-cond-${i}-operator`}>
                    {(Object.keys(data.options.operators) as AdsRuleOperator[]).filter((o) => o !== 'EQUAL' || kind === 'int').map((o) => (
                      <option key={o} value={o}>{data.options.operators[o]}</option>
                    ))}
                  </select>
                  <span className="ads-auto-val">
                    {kind === 'money' && <small>{cur}</small>}
                    <input type="number" min={0} step={kind === 'int' ? 1 : 0.01} value={c.value ?? ''} onChange={(e) => set((s) => ({ ...s, conditions: s.conditions.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) }))} aria-label="Value" data-testid={`ads-rule-cond-${i}-value`} />
                    {kind === 'pct' && <small>%</small>}
                  </span>
                  <button type="button" className="icon-btn" disabled={spec.conditions.length < 2} onClick={() => set((s) => ({ ...s, conditions: s.conditions.filter((_, j) => j !== i) }))} aria-label="Remove condition" data-testid={`ads-rule-cond-${i}-remove`}>
                    <span className="material-icons">close</span>
                  </button>
                  {(fieldErr(`conditions.${i}.value`) || fieldErr(`conditions.${i}.metric`) || fieldErr(`conditions.${i}.operator`)) && (
                    <small className="ads-mg-err" role="alert">{fieldErr(`conditions.${i}.value`) || fieldErr(`conditions.${i}.metric`) || fieldErr(`conditions.${i}.operator`)}</small>
                  )}
                </div>
              );
            })}
            {fieldErr('conditions') && <small className="ads-mg-err" role="alert">{fieldErr('conditions')}</small>}
            <button type="button" className="ads-btn sm" disabled={spec.conditions.length >= 5} onClick={() => set((s) => ({ ...s, conditions: [...s.conditions, emptyCondition()] }))} data-testid="ads-rule-cond-add">
              <span className="material-icons" aria-hidden="true">add</span> Add condition
            </button>
            <p className="ads-wz-hint">All conditions must be true. “Results” and “cost per result” are Meta’s, for each ad set’s optimisation goal.</p>
          </section>
          <section className="ads-wz-section">
            <h4>Action</h4>
            <Field label="Then" err={fieldErr('action.type')}>
              <select
                value={spec.action.type}
                onChange={(e) => {
                  const type = e.target.value as AdsRuleSpec['action']['type'];
                  set((s) => ({ ...s, level: type === 'CHANGE_BUDGET' ? 'ADSET' : s.level, action: type === 'CHANGE_BUDGET' ? { type, percent: 20, cap: '', everyHours: 24, maxTimes: 5 } : { type } }));
                }}
                data-testid="ads-rule-action"
              >
                <option value="PAUSE">Pause it</option>
                <option value="CHANGE_BUDGET">Increase its daily budget</option>
                <option value="NOTIFICATION">Notify me only</option>
              </select>
            </Field>
            {isBudget && (
              <>
                <div className="ads-wz-row">
                  <Field label="Increase by (%)" err={fieldErr('action.percent')}>
                    <input type="number" min={1} max={100} step={1} value={spec.action.percent ?? ''} onChange={(e) => set((s) => ({ ...s, action: { ...s.action, percent: e.target.value } }))} data-testid="ads-rule-percent" />
                  </Field>
                  <Field label={`Maximum daily budget (${cur})`} hint={`Required. At least ${money(data.account.minDailyBudget, cur)} (Meta’s minimum).`} err={fieldErr('action.cap')}>
                    <input type="number" min={0} step={0.01} value={spec.action.cap ?? ''} onChange={(e) => set((s) => ({ ...s, action: { ...s.action, cap: e.target.value } }))} data-testid="ads-rule-cap" />
                  </Field>
                </div>
                <div className="ads-wz-row">
                  <Field label="At most once every (hours)" err={fieldErr('action.everyHours')}>
                    <input type="number" min={1} max={168} step={1} value={spec.action.everyHours ?? ''} onChange={(e) => set((s) => ({ ...s, action: { ...s.action, everyHours: e.target.value } }))} data-testid="ads-rule-every" />
                  </Field>
                  <Field label="At most (times per ad set)" err={fieldErr('action.maxTimes')}>
                    <input type="number" min={1} max={50} step={1} value={spec.action.maxTimes ?? ''} onChange={(e) => set((s) => ({ ...s, action: { ...s.action, maxTimes: e.target.value } }))} data-testid="ads-rule-times" />
                  </Field>
                </div>
                <div className="ads-state amber ads-auto-capbox" data-testid="ads-rule-capbox">
                  <span className="material-icons" aria-hidden="true">savings</span>
                  <div>
                    <strong>{spec.action.cap ? `Each ad set’s daily budget never goes above ${money(Number(spec.action.cap), cur)}` : 'Set a cap: the highest daily budget the rule may reach, per ad set'}</strong>
                    <p>The cap is per ad set, not for the whole account. Only ad sets with their own daily budget and at least one result are raised. Meta stops once an ad set reaches the cap.</p>
                    {preview?.summary.capText && <p data-testid="ads-rule-captext">{preview.summary.capText}</p>}
                  </div>
                </div>
              </>
            )}
            {spec.action.type === 'NOTIFICATION' && <p className="ads-wz-hint">Meta sends a Facebook notification to the person who connected the ad account. The CRM also shows each run in your notifications.</p>}
          </section>
          <section className="ads-wz-section">
            <h4>Schedule</h4>
            <Field label="Check" err={fieldErr('schedule.type')}>
              <select value={spec.schedule.type} onChange={(e) => set((s) => ({ ...s, schedule: e.target.value === 'CUSTOM' ? { type: 'CUSTOM', days: [1, 2, 3, 4, 5], startMinute: 540 } : { type: e.target.value as AdsRuleSpec['schedule']['type'] } }))} data-testid="ads-rule-schedule">
                {Object.entries(data.options.schedules).map(([k, l]) => (
                  <option key={k} value={k}>{l}</option>
                ))}
              </select>
            </Field>
            {spec.schedule.type === 'CUSTOM' && (
              <>
                <div className="ads-wz-checks" data-testid="ads-rule-days">
                  {DAYS.map((d, i) => (
                    <label key={d}>
                      <input
                        type="checkbox"
                        checked={(spec.schedule.days || []).includes(i)}
                        onChange={(e) => set((s) => ({ ...s, schedule: { ...s.schedule, days: e.target.checked ? [...(s.schedule.days || []), i].sort() : (s.schedule.days || []).filter((x) => x !== i) } }))}
                        data-testid={`ads-rule-day-${i}`}
                      />
                      {d}
                    </label>
                  ))}
                </div>
                {fieldErr('schedule.days') && <small className="ads-mg-err" role="alert">{fieldErr('schedule.days')}</small>}
                <div className="ads-wz-row">
                  <Field label="From" err={fieldErr('schedule.startMinute')}>
                    <select value={spec.schedule.startMinute ?? 0} onChange={(e) => set((s) => ({ ...s, schedule: { ...s.schedule, startMinute: Number(e.target.value) } }))} data-testid="ads-rule-start">
                      {HALF_HOURS.map((x) => <option key={x} value={x}>{clock(x)}</option>)}
                    </select>
                  </Field>
                  <Field label="Until (optional)" hint="Without an end it runs once at the start time; with one, every 30 minutes in between." err={fieldErr('schedule.endMinute')}>
                    <select value={spec.schedule.endMinute ?? ''} onChange={(e) => set((s) => ({ ...s, schedule: { ...s.schedule, endMinute: e.target.value === '' ? undefined : Number(e.target.value) } }))} data-testid="ads-rule-end">
                      <option value="">Only at the start time</option>
                      {HALF_HOURS.filter((x) => x > 0).map((x) => <option key={x} value={x}>{clock(x)}</option>)}
                    </select>
                  </Field>
                </div>
              </>
            )}
            <p className="ads-wz-hint">Times are in the ad account’s time zone ({data.account.timezone}).</p>
          </section>
          <div className={`ads-auto-summary${preview ? '' : ' muted'}`} data-testid="ads-rule-summary" aria-live="polite">
            <span className="material-icons" aria-hidden="true">{preview?.summary.changesDelivery ? 'bolt' : 'notifications'}</span>
            <p>{preview ? preview.summary.text : previewErr ? errText(previewErr) : 'Checking…'}</p>
          </div>
        </>
      )}
    </ManageDialog>
  );
}

function HistoryDialog({ api, rule, onClose }: { api: CrmApi; rule: AdsRule; onClose: () => void }) {
  const [data, setData] = useState<AdsRuleHistory | null>(null);
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => {
    let live = true;
    api.getAdsRuleHistory(rule.id).then((r) => live && setData(r)).catch((e) => live && setErr(e));
    return () => {
      live = false;
    };
  }, [api, rule.id]);
  const val = (v: string | number | null, isMoney: boolean) => (v === null || v === '' ? '—' : isMoney ? money(Number(v), data?.currency || '') : String(v));
  return (
    <ManageDialog title={`History: ${rule.name}`} testid="ads-rule-history-dialog" onClose={onClose}>
      {err ? <AdsErrorState error={err} /> : !data ? <BladeSpinner center={true} containerHeight={80} /> : !data.entries.length ? (
        <p className="ads-wz-hint" data-testid="ads-rule-hist-empty">No runs that changed anything yet. Meta lists a run here once the rule acts on something.</p>
      ) : (
        <ol className="ads-auto-history">
          {data.entries.map((h, i) => (
            // eslint-disable-next-line react/no-array-index-key
            <li key={i} data-testid={`ads-rule-hist-${i}`}>
              <div className="ads-auto-hist-head">
                <strong>{h.at ? new Date(h.at).toLocaleString() : '—'}</strong>
                {h.manual && <span className="ads-chip">Run by hand</span>}
                {h.error && <span className="ads-pill red">{h.error}</span>}
              </div>
              <ul>
                {h.results.map((r) => r.actions.map((a, j) => (
                  // eslint-disable-next-line react/no-array-index-key
                  <li key={`${r.objectId}-${j}`}>
                    <span className={`ads-pill ${a.action === 'NOT_CHANGED' ? '' : a.action === 'ERROR' ? 'red' : 'green'}`}>{a.label}</span>{' '}
                    {r.objectName || `${r.objectType.toLowerCase()} ${r.objectId}`}
                    {a.oldValue !== null && a.newValue !== null && a.oldValue !== a.newValue ? ` · ${val(a.oldValue, a.money)} → ${val(a.newValue, a.money)}` : ''}
                    {a.error ? ` · ${a.error}` : ''}
                  </li>
                )))}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </ManageDialog>
  );
}

// --------------------------------------------------------- rules part --

function RulesPart({ api, range, canManage, setCanManage, onRevoked, onReadOnly, refreshNonce, focusRuleId }: {
  api: CrmApi;
  range: AdsRange;
  canManage: boolean;
  setCanManage: (v: boolean) => void;
  onRevoked: () => void;
  onReadOnly: () => void;
  refreshNonce: number;
  focusRuleId: string;
}) {
  const notify = useNotify();
  const confirm = useConfirm();
  const [data, setData] = useState<AdsRulesList | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [n, setN] = useState(0);
  const refreshNext = useRef(false);
  const mirrorNext = useRef(true);
  const lastNonce = useRef(refreshNonce);
  const [dialog, setDialog] = useState<{ kind: 'new' | 'edit' | 'history'; rule: AdsRule | null } | null>(null);
  const [busyId, setBusyId] = useState('');
  const onWriteError = useWriteErrors(onReadOnly, onRevoked, setCanManage);
  /** `mirror: false` after a write: re-read Meta without forcing the rule-history mirror. */
  const reload = (refresh = false, mirror = true) => {
    refreshNext.current = refresh;
    mirrorNext.current = mirror;
    setN((x) => x + 1);
  };
  useEffect(() => {
    let live = true;
    const nonce = lastNonce.current !== refreshNonce;
    const refresh = refreshNext.current || nonce;
    const mirror = mirrorNext.current || nonce;
    lastNonce.current = refreshNonce;
    refreshNext.current = false;
    mirrorNext.current = true;
    setError(null);
    api
      .getAdsRules(refresh, { mirror })
      .then((r) => {
        if (!live) return;
        setData(r);
        setCanManage(r.canManage);
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
  // An ad_rule_triggered notification: open that rule's history.
  useEffect(() => {
    if (!focusRuleId || !data) return;
    const r = data.rules.find((x) => x.id === focusRuleId);
    if (r) setDialog({ kind: 'history', rule: r });
  }, [focusRuleId, data]);

  async function toggle(r: AdsRule) {
    const on = ruleOn(r);
    setBusyId(r.id);
    try {
      if (on) {
        // Off is a brake: no confirm (HAS_ISSUES rules still run at Meta, so they turn off too).
        await api.setAdsRuleStatus(r.id, 'DISABLED');
      } else {
        // On: confirm the server's summary of the rule, and send its summaryHash.
        // If the rule changed at Meta since the list loaded, the server answers
        // SUMMARY_STALE with the fresh summary, which is confirmed instead.
        let shown = { summary: r.summary, hash: r.summaryHash };
        for (let attempt = 0; ; attempt += 1) {
          // eslint-disable-next-line no-await-in-loop
          const ok = await confirm({
            title: attempt ? `“${r.name}” changed at Meta: check it again` : `Turn on “${r.name}”?`,
            message: shown.summary.text,
            points: [...summaryPoints(shown.summary), 'Meta runs the rule on its own schedule, even when the CRM is closed.'],
            confirmLabel: 'Turn on',
            tone: 'primary',
          });
          if (!ok) return;
          try {
            // eslint-disable-next-line no-await-in-loop
            await api.setAdsRuleStatus(r.id, 'ENABLED', true, shown.hash);
            break;
          } catch (e) {
            const fresh = errSummary(e);
            if (errCode(e) === 'SUMMARY_STALE' && fresh && errHash(e) && attempt < STALE_RETRIES) {
              shown = { summary: fresh, hash: errHash(e) };
              continue;
            }
            throw e;
          }
        }
      }
      notify('success', on ? 'Rule turned off' : 'Rule turned on', r.name);
      reload(true, false);
    } catch (e) {
      onWriteError(e, on ? 'Rule not turned off' : 'Rule not turned on');
    } finally {
      setBusyId('');
    }
  }
  async function remove(r: AdsRule) {
    const ok = await confirm({ title: `Delete “${r.name}”?`, message: 'The rule is deleted at Meta and stops running. Its history goes with it. This can’t be undone.', confirmLabel: 'Delete', tone: 'danger' });
    if (!ok) return;
    setBusyId(r.id);
    try {
      await api.deleteAdsRule(r.id);
      notify('success', 'Rule deleted', r.name);
      reload(true, false);
    } catch (e) {
      onWriteError(e, 'Rule not deleted');
    } finally {
      setBusyId('');
    }
  }

  if (error && !data) return <AdsErrorState error={error} onRetry={() => reload(true)} />;
  if (!data) return <BladeSpinner center={true} containerHeight={120} />;
  return (
    <section className="ads-card" data-testid="ads-rules">
      <div className="ads-card-head">
        <h4>Automated rules</h4>
        <div className="ads-au-actions">
          <button type="button" className="ads-btn primary sm" disabled={!canManage} title={!canManage ? RO_WHY : undefined} onClick={() => setDialog({ kind: 'new', rule: null })} data-testid="ads-rule-new">
            <span className="material-icons" aria-hidden="true">add</span> New rule
          </button>
          <button type="button" className="icon-btn" title="Reload from Meta" aria-label="Reload from Meta" onClick={() => reload(true)} data-testid="ads-rules-reload">
            <span className="material-icons">refresh</span>
          </button>
        </div>
      </div>
      {!canManage && <p className="ads-wz-hint" data-testid="ads-rules-readonly">{RO_WHY}</p>}
      <p className="ads-wz-hint">Meta checks these rules on their schedule and acts on your ads, even when the CRM is closed. New rules start off until you turn them on.</p>
      {!data.rules.length ? (
        <div className="ads-empty" data-testid="ads-rules-empty">
          <span className="material-icons" aria-hidden="true">rule</span>
          <p>No rules yet. Start from a template: pause costly ad sets, stop spend without results, scale cheap ones, or just get notified.</p>
        </div>
      ) : (
        <div className="ads-table-wrap">
          <table className="ads-table ads-auto-table" data-testid="ads-rules-table">
            <thead>
              <tr>
                <th>Rule</th>
                <th>What it does</th>
                <th>Status</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {data.rules.map((r) => (
                <tr key={r.id} data-testid={`ads-rule-row-${r.id}`} className={focusRuleId === r.id ? 'focus' : undefined}>
                  <td className="name">
                    <strong>{r.name}</strong>
                    {!r.editable && <small className="ads-au-sub">Made outside the CRM{r.summary.actionType ? ` · ${r.summary.actionType}` : ''}</small>}
                    {!ruleOn(r) && r.canEnable === false && canManage && <small className="ads-au-sub" data-testid={`ads-rule-noenable-${r.id}`}>Turn it on in Ads Manager (the CRM only turns on outside rules that pause or notify).</small>}
                  </td>
                  <td>
                    <span data-testid={`ads-rule-summary-${r.id}`}>{r.summary.text}</span>
                    {r.summary.cap && (
                      <span className="ads-chip amber ads-auto-cap" data-testid={`ads-rule-cap-${r.id}`}>
                        <span className="material-icons" aria-hidden="true">savings</span> Capped at {r.summary.cap}/day per ad set
                        {r.summary.adSetCount !== null && r.summary.adSetCount !== undefined && r.summary.worstCase ? ` · ${r.summary.adSetCount} ad set${r.summary.adSetCount === 1 ? '' : 's'}, up to ${r.summary.worstCase}/day in total` : ''}
                      </span>
                    )}
                  </td>
                  <td>
                    <span className={`ads-pill ${r.hasIssues ? 'red' : ruleOn(r) ? 'green' : ''}`} data-testid={`ads-rule-status-${r.id}`}>{r.hasIssues ? 'Has issues' : ruleOn(r) ? 'On' : 'Off'}</span>
                  </td>
                  <td className="ads-au-row-actions">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={ruleOn(r)}
                      className={`ads-auto-switch${ruleOn(r) ? ' on' : ''}`}
                      disabled={!canManage || busyId === r.id || (!ruleOn(r) && r.canEnable === false)}
                      title={!canManage ? RO_WHY : ruleOn(r) ? (r.hasIssues ? 'Turn off (Meta still runs rules that have issues)' : 'Turn off') : r.canEnable === false ? `Made outside the CRM with the action ${r.summary.actionType || 'unknown'}: the CRM only turns on outside rules that pause or notify. Turn it on in Ads Manager.` : 'Turn on'}
                      onClick={() => void toggle(r)}
                      data-testid={`ads-rule-toggle-${r.id}`}
                      aria-label={`${ruleOn(r) ? 'Turn off' : 'Turn on'} ${r.name}`}
                    >
                      <span />
                    </button>
                    <button type="button" className="ads-btn sm" onClick={() => setDialog({ kind: 'history', rule: r })} data-testid={`ads-rule-history-${r.id}`}>
                      <span className="material-icons" aria-hidden="true">history</span> History
                    </button>
                    <button
                      type="button"
                      className="ads-btn sm"
                      disabled={!canManage || !r.editable}
                      title={!canManage ? RO_WHY : !r.editable ? 'Made outside the CRM: edit it in Ads Manager.' : 'Edit'}
                      onClick={() => setDialog({ kind: 'edit', rule: r })}
                      data-testid={`ads-rule-edit-${r.id}`}
                    >
                      Edit
                    </button>
                    <button type="button" className="ads-btn sm danger" disabled={!canManage || busyId === r.id} title={!canManage ? RO_WHY : 'Delete at Meta'} onClick={() => void remove(r)} data-testid={`ads-rule-delete-${r.id}`} aria-label={`Delete ${r.name}`}>
                      <span className="material-icons" aria-hidden="true">delete</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {dialog && dialog.kind !== 'history' && (
        <RuleDialog
          api={api}
          range={range}
          data={data}
          rule={dialog.rule}
          onClose={() => setDialog(null)}
          onSaved={(r, on) => {
            setDialog(null);
            notify('success', dialog.rule ? 'Rule saved' : on ? 'Rule created and on' : 'Rule created (off)', r.name);
            reload(true, false);
          }}
          onError={(e) => onWriteError(e, '')}
        />
      )}
      {dialog?.kind === 'history' && dialog.rule && <HistoryDialog api={api} rule={dialog.rule} onClose={() => setDialog(null)} />}
    </section>
  );
}

// ----------------------------------------------------------- A/B tests --

const TEST_STATUS: Record<string, { label: string; tone: string }> = {
  SCHEDULED: { label: 'Scheduled', tone: 'amber' }, RUNNING: { label: 'Running', tone: 'green' }, COMPLETED: { label: 'Completed', tone: '' }, CANCELED: { label: 'Cancelled', tone: 'red' },
};
const fmtLocal = (s: string) => (s ? s.replace('T', ' ') : '—');

function TestDialog({ api, testId, onClose }: { api: CrmApi; testId: string; onClose: () => void }) {
  const [data, setData] = useState<AdsTestDetails | null>(null);
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => {
    let live = true;
    api.getAdsTest(testId).then((r) => live && setData(r)).catch((e) => live && setErr(e));
    return () => {
      live = false;
    };
  }, [api, testId]);
  return (
    <ManageDialog title={data ? `A/B test: ${data.test.name}` : 'A/B test'} testid="ads-test-dialog" onClose={onClose}>
      {err ? <AdsErrorState error={err} /> : !data ? <BladeSpinner center={true} containerHeight={80} /> : (
        <>
          <p className="ads-wz-hint">
            <span className={`ads-pill ${TEST_STATUS[data.test.status]?.tone || ''}`}>{TEST_STATUS[data.test.status]?.label || data.test.status}</span>{' '}
            {fmtLocal(data.test.start)} → {fmtLocal(data.test.end)}
            {data.test.confidence ? ` · ${data.test.confidence}% confidence` : ''}
          </p>
          {data.results.winnerCell ? (
            <div className="ads-state ads-auto-winner" data-testid="ads-test-winner">
              <span className="material-icons" aria-hidden="true">emoji_events</span>
              <div>
                <strong>Winner: {data.results.winnerCell.name}</strong>
                <p>{data.results.confidence !== null ? `Meta is ${data.results.confidence}% confident this group performs best${data.results.objective ? ` on ${data.results.objective.toLowerCase()}` : ''}.` : 'Meta picked this group as the best performer.'}</p>
              </div>
            </div>
          ) : (
            <p className="ads-wz-hint" data-testid="ads-test-no-winner">{data.test.status === 'COMPLETED' ? 'Meta hasn’t reported a winner for this test.' : 'Meta reports a winner once the test has enough results.'}</p>
          )}
          <ul className="ads-auto-cells">
            {data.cells.map((c, i) => (
              <li key={c.id || i} data-testid={`ads-test-cell-${i}`} className={data.results.winnerCell?.id === c.id ? 'win' : undefined}>
                <strong>{c.name}</strong> <small>{c.percent}% of the audience</small>
                <small className="ads-au-sub">
                  {c.objects.map((o) => `${o.name || o.id}${data.results.byObject[o.id] !== undefined ? ` · ${Math.round(data.results.byObject[o.id] * 1000) / 10}%` : ''}`).join(', ') || '—'}
                </small>
              </li>
            ))}
          </ul>
        </>
      )}
    </ManageDialog>
  );
}

function CreateTestDialog({ api, range, list, onClose, onCreated, onError }: {
  api: CrmApi;
  range: AdsRange;
  list: AdsTestsList;
  onClose: () => void;
  onCreated: (name: string) => void;
  onError: (e: unknown) => void;
}) {
  const confirm = useConfirm();
  const tz = list.timezone;
  const [f, setF] = useState<AdsTestInput>({
    name: '', description: '', level: 'adset', ids: [], variable: 'audience', metric: 'cost_per_result', confidence: 90, start: localIn(tz, 3600000), end: localIn(tz, 8 * 86400000),
  });
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const field = errField(err);
  const set = (patch: Partial<AdsTestInput>) => setF((x) => ({ ...x, ...patch }));
  const why = !f.name.trim() ? 'Name the test.' : f.ids.length < 2 ? `Pick 2 to 5 ${f.level === 'campaign' ? 'campaigns' : 'ad sets'}.` : '';
  async function submit() {
    setBusy(true);
    setErr(null);
    const body = { ...f, name: f.name.trim(), description: (f.description || '').trim() };
    try {
      // The server answers CONFIRM_REQUIRED with its summary first; the user confirms that.
      await api.createAdsTest(body);
      onCreated(body.name);
    } catch (e) {
      if (errCode(e) !== 'CONFIRM_REQUIRED') {
        setErr(e);
        onError(e);
        setBusy(false);
        return;
      }
      const s = errSummary(e);
      const ok = await confirm({ title: `Create “${body.name}” at Meta?`, message: s?.text || '', points: s?.cells || [], confirmLabel: 'Create A/B test', tone: 'primary' });
      if (!ok) {
        setBusy(false);
        return;
      }
      try {
        await api.createAdsTest({ ...body, confirm: true });
        onCreated(body.name);
      } catch (e2) {
        setErr(e2);
        onError(e2);
      }
    }
    setBusy(false);
  }
  return (
    <ManageDialog
      title="New A/B test"
      testid="ads-test-create"
      dirty={!!f.name || f.ids.length > 0}
      onClose={onClose}
      footer={(
        <div className="ads-mg-foot">
          {why && <small className="ads-wz-hint">{why}</small>}
          <button type="button" className="ads-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="ads-btn primary" disabled={!!why || busy} onClick={() => void submit()} data-testid="ads-test-submit">
            {busy ? 'Creating…' : 'Create A/B test'}
          </button>
        </div>
      )}
    >
      {err && !field ? <div className="ads-state amber" role="alert" data-testid="ads-test-error"><div>{errText(err)}</div></div> : null}
      <Field label="Test name" err={field === 'name' ? errText(err) : ''}>
        <input type="text" value={f.name} maxLength={400} onChange={(e) => set({ name: e.target.value })} data-testid="ads-test-name" data-autofocus />
      </Field>
      <div className="ads-wz-row">
        <Field label="Compare" err={field === 'level' ? errText(err) : ''}>
          <select value={f.level} onChange={(e) => set({ level: e.target.value as AdsTestInput['level'], ids: [] })} data-testid="ads-test-level">
            <option value="adset">Ad sets</option>
            <option value="campaign">Campaigns</option>
          </select>
        </Field>
        <Field label="What differs (one variable)" err={field === 'variable' ? errText(err) : ''}>
          <select value={f.variable} onChange={(e) => set({ variable: e.target.value as AdsTestInput['variable'] })} data-testid="ads-test-variable">
            {Object.entries(list.options.variables).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
      </div>
      <ObjectPicker api={api} range={range} level={f.level} ids={f.ids} max={5} onChange={(ids) => set({ ids })} testid="ads-test" />
      {field === 'ids' && <small className="ads-mg-err" role="alert">{errText(err)}</small>}
      <p className="ads-wz-hint">Keep everything else the same, so the difference in results comes from the {list.options.variables[f.variable]?.toLowerCase()}.</p>
      <div className="ads-wz-row">
        <Field label="Winning metric" err={field === 'metric' ? errText(err) : ''}>
          <select value={f.metric} onChange={(e) => set({ metric: e.target.value as AdsTestMetric })} data-testid="ads-test-metric">
            {Object.entries(list.options.metrics).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <Field label="Confidence" err={field === 'confidence' ? errText(err) : ''}>
          <select value={f.confidence} onChange={(e) => set({ confidence: Number(e.target.value) })} data-testid="ads-test-confidence">
            {list.options.confidence.map((c) => <option key={c} value={c}>{c}%</option>)}
          </select>
        </Field>
      </div>
      <div className="ads-wz-row">
        <Field label={`Start (${tz})`} err={field === 'start' ? errText(err) : ''}>
          <input type="datetime-local" value={f.start} onChange={(e) => set({ start: e.target.value })} data-testid="ads-test-start" />
        </Field>
        <Field label="End" hint={`${list.options.minDays}–${list.options.maxDays} days`} err={field === 'end' ? errText(err) : ''}>
          <input type="datetime-local" value={f.end} onChange={(e) => set({ end: e.target.value })} data-testid="ads-test-end" />
        </Field>
      </div>
      <Field label="Notes (optional)" err={field === 'description' ? errText(err) : ''}>
        <input type="text" value={f.description} maxLength={300} onChange={(e) => set({ description: e.target.value })} data-testid="ads-test-desc" />
      </Field>
      <p className="ads-wz-hint">Meta splits the audience into groups that don’t overlap. The test only delivers while the {f.level === 'campaign' ? 'campaigns' : 'ad sets'} are on; the CRM doesn’t turn anything on.</p>
    </ManageDialog>
  );
}

const SIG: Record<AdsCompareResult['significance']['level'], { label: string; tone: string; icon: string }> = {
  significant: { label: 'Significant', tone: 'green', icon: 'verified' },
  not_yet: { label: 'Not significant yet', tone: 'amber', icon: 'hourglass_top' },
  not_enough_data: { label: 'Not enough data', tone: '', icon: 'data_exploration' },
};

function ComparePart({ api, range, onRevoked, refreshNonce }: { api: CrmApi; range: AdsRange; onRevoked: () => void; refreshNonce: number }) {
  const [level, setLevel] = useState<'campaign' | 'adset'>('adset');
  const [ids, setIds] = useState<string[]>([]);
  const [metric, setMetric] = useState<AdsTestMetric>('cost_per_result');
  const [confidence, setConfidence] = useState(90);
  const [res, setRes] = useState<AdsCompareResult | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [asked, setAsked] = useState(0);
  useEffect(() => {
    if (!asked) return undefined;
    let live = true;
    setBusy(true);
    setErr(null);
    api
      .getAdsCompare({ level, ids, metric, confidence }, range)
      .then((r) => live && setRes(r))
      .catch((e) => {
        if (!live) return;
        setErr(e);
        if (errCode(e) === 'ADS_REVOKED') onRevoked();
      })
      .finally(() => live && setBusy(false));
    return () => {
      live = false;
    };
  }, [asked, range, refreshNonce]); // eslint-disable-line react-hooks/exhaustive-deps
  const cur = res?.currency || '';
  const rows: [string, (v: AdsCompareResult['items'][number]['values']) => string][] = [
    ['Amount spent', (v) => money(v.spend, cur)], ['Impressions', (v) => int(v.impressions)], ['Reach', (v) => int(v.reach)], ['Clicks (all)', (v) => int(v.clicks)],
    ['CTR (all)', (v) => pct(v.ctr)], ['CPC (all)', (v) => money(v.cpc, cur)], ['CPM', (v) => money(v.cpm, cur)], ['Results', (v) => int(v.results)], ['Cost per result', (v) => money(v.cost_per_result, cur)],
  ];
  const metricRow: Record<AdsTestMetric, string> = { cost_per_result: 'Cost per result', results: 'Results', ctr: 'CTR (all)', cpc: 'CPC (all)' };
  const sig = res ? SIG[res.significance.level] : null;
  return (
    <section className="ads-card" data-testid="ads-cmp">
      <div className="ads-card-head">
        <h4>Compare in the CRM</h4>
      </div>
      <p className="ads-wz-hint">
        Put 2 to 5 campaigns or ad sets side by side for the dashboard’s date range ({range.preset === 'custom' ? `${range.since} – ${range.until}` : range.preset.replace('last_', 'last ').replace('d', ' days')}). Unlike a Meta A/B test the audiences can overlap, so treat the result as a guide.
      </p>
      <div className="ads-wz-row">
        <Field label="Compare">
          <select value={level} onChange={(e) => { setLevel(e.target.value as 'campaign' | 'adset'); setIds([]); }} data-testid="ads-cmp-level">
            <option value="adset">Ad sets</option>
            <option value="campaign">Campaigns</option>
          </select>
        </Field>
        <Field label="Metric">
          <select value={metric} onChange={(e) => setMetric(e.target.value as AdsTestMetric)} data-testid="ads-cmp-metric">
            {(Object.keys(metricRow) as AdsTestMetric[]).map((k) => <option key={k} value={k}>{metricRow[k]}</option>)}
          </select>
        </Field>
        <Field label="Confidence">
          <select value={confidence} onChange={(e) => setConfidence(Number(e.target.value))} data-testid="ads-cmp-confidence">
            {[80, 90, 95].map((c) => <option key={c} value={c}>{c}%</option>)}
          </select>
        </Field>
      </div>
      <ObjectPicker api={api} range={range} level={level} ids={ids} max={5} onChange={(x) => setIds(x)} testid="ads-cmp" />
      <button type="button" className="ads-btn primary sm" disabled={ids.length < 2 || busy} onClick={() => setAsked((x) => x + 1)} data-testid="ads-cmp-run">
        <span className="material-icons" aria-hidden="true">compare_arrows</span> {busy ? 'Comparing…' : 'Compare'}
      </button>
      {err ? <AdsErrorState error={err} onRetry={() => setAsked((x) => x + 1)} /> : null}
      {res && sig && (
        <>
          <div className={`ads-state ads-auto-verdict ${sig.tone}`} data-testid="ads-cmp-verdict" data-level={res.significance.level}>
            <span className="material-icons" aria-hidden="true">{sig.icon}</span>
            <div>
              <strong>
                {res.winner ? `${res.winner.name} wins on ${res.metricLabel.toLowerCase()}` : res.leader ? `${res.leader.name} leads on ${res.metricLabel.toLowerCase()}` : 'No leader yet'}
                {' · '}
                <span className={`ads-pill ${sig.tone}`}>{sig.label}</span>
              </strong>
              <p>
                {res.significance.confidence !== null ? `${res.significance.confidence}% confidence (two-proportion test on ${res.significance.basis}; you asked for ${res.confidence}%).` : `Based on ${res.significance.basis}.`}
                {res.notes.length ? ` ${res.notes.join(' ')}` : ''}
              </p>
            </div>
          </div>
          <div className="ads-table-wrap">
            <table className="ads-table ads-auto-cmp" data-testid="ads-cmp-table">
              <thead>
                <tr>
                  <th>Metric</th>
                  {res.items.map((it) => (
                    <th key={it.id} className={`num${res.winner?.id === it.id ? ' win' : ''}`} data-testid={`ads-cmp-col-${it.id}`}>
                      {res.winner?.id === it.id && <span className="material-icons" aria-hidden="true">emoji_events</span>} {it.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(([label, get]) => (
                  <tr key={label} className={label === metricRow[res.metric] ? 'metric' : undefined}>
                    <td>{label}</td>
                    {res.items.map((it) => <td key={it.id} className="num">{get(it.values)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function TestsPart({ api, range, canManage, setCanManage, onRevoked, onReadOnly, refreshNonce, focusTestId }: {
  api: CrmApi;
  range: AdsRange;
  canManage: boolean;
  setCanManage: (v: boolean) => void;
  onRevoked: () => void;
  onReadOnly: () => void;
  refreshNonce: number;
  focusTestId: string;
}) {
  const notify = useNotify();
  const [data, setData] = useState<AdsTestsList | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [n, setN] = useState(0);
  const refreshNext = useRef(false);
  const lastNonce = useRef(refreshNonce);
  const [open, setOpen] = useState('');
  const [creating, setCreating] = useState(false);
  const onWriteError = useWriteErrors(onReadOnly, onRevoked, setCanManage);
  useEffect(() => {
    let live = true;
    const refresh = refreshNext.current || lastNonce.current !== refreshNonce;
    lastNonce.current = refreshNonce;
    refreshNext.current = false;
    setError(null);
    api
      .getAdsTests(refresh)
      .then((r) => live && setData(r))
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
    if (focusTestId) setOpen(focusTestId);
  }, [focusTestId]);
  const why = !canManage ? RO_WHY : data && !data.metaAvailable ? data.note : '';
  return (
    <>
      <section className="ads-card" data-testid="ads-tests">
        <div className="ads-card-head">
          <h4>A/B tests at Meta</h4>
          <div className="ads-au-actions">
            <button type="button" className="ads-btn primary sm" disabled={!data || !!why} title={why || undefined} onClick={() => setCreating(true)} data-testid="ads-test-new">
              <span className="material-icons" aria-hidden="true">science</span> New A/B test
            </button>
            <button type="button" className="icon-btn" title="Reload from Meta" aria-label="Reload from Meta" onClick={() => { refreshNext.current = true; setN((x) => x + 1); }} data-testid="ads-tests-reload">
              <span className="material-icons">refresh</span>
            </button>
          </div>
        </div>
        {error && !data ? <AdsErrorState error={error} onRetry={() => setN((x) => x + 1)} /> : !data ? <BladeSpinner center={true} containerHeight={80} /> : (
          <>
            {data.note && <p className="ads-wz-hint" data-testid="ads-tests-note">{data.note}</p>}
            {!data.tests.length ? (
              <div className="ads-empty" data-testid="ads-tests-empty">
                <span className="material-icons" aria-hidden="true">science</span>
                <p>No A/B tests yet. A test splits the audience between 2 to 5 ad sets or campaigns that differ in one thing, and Meta reports which one wins.</p>
              </div>
            ) : (
              <div className="ads-table-wrap">
                <table className="ads-table" data-testid="ads-tests-table">
                  <thead>
                    <tr>
                      <th>Test</th>
                      <th>Status</th>
                      <th>Variable · metric</th>
                      <th>Dates</th>
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {data.tests.map((t) => (
                      <tr key={t.id} data-testid={`ads-test-row-${t.id}`}>
                        <td className="name">
                          <strong>{t.name}</strong>
                          <small className="ads-au-sub">{t.cells.map((c) => c.name).join(' vs ') || t.description}</small>
                        </td>
                        <td><span className={`ads-pill ${TEST_STATUS[t.status]?.tone || ''}`} data-testid={`ads-test-status-${t.id}`}>{TEST_STATUS[t.status]?.label || t.status}</span></td>
                        <td>{[data.options.variables[t.variable] || '', data.options.metrics[t.metric as AdsTestMetric] || '', t.confidence ? `${t.confidence}%` : ''].filter(Boolean).join(' · ') || '—'}</td>
                        <td>{fmtLocal(t.start)} → {fmtLocal(t.end)}</td>
                        <td>
                          <button type="button" className="ads-btn sm" onClick={() => setOpen(t.id)} data-testid={`ads-test-open-${t.id}`}>Results</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>
      <ComparePart api={api} range={range} onRevoked={onRevoked} refreshNonce={refreshNonce} />
      {open && <TestDialog api={api} testId={open} onClose={() => setOpen('')} />}
      {creating && data && (
        <CreateTestDialog
          api={api}
          range={range}
          list={data}
          onClose={() => setCreating(false)}
          onCreated={(name) => {
            setCreating(false);
            notify('success', 'A/B test created', `${name}. It runs while its ad sets or campaigns are on.`);
            refreshNext.current = true;
            setN((x) => x + 1);
          }}
          onError={(e) => onWriteError(e, '')}
        />
      )}
    </>
  );
}

// -------------------------------------------------------------- pixels --

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall back below */
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

function PixelDetail({ api, pixelId, refreshNonce }: { api: CrmApi; pixelId: string; refreshNonce: number }) {
  const notify = useNotify();
  const [range, setRange] = useState<'24h' | '7d'>('24h');
  const [data, setData] = useState<AdsPixelDetails | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [event, setEvent] = useState('PURCHASE');
  useEffect(() => {
    let live = true;
    setErr(null);
    api.getAdsPixel(pixelId, range).then((r) => live && setData(r)).catch((e) => live && setErr(e));
    return () => {
      live = false;
    };
  }, [api, pixelId, range, refreshNonce]);
  async function copy(text: string, what: string) {
    const ok = await copyText(text);
    notify(ok ? 'success' : 'error', ok ? 'Copied' : 'Couldn’t copy', ok ? what : 'Select the code and copy it by hand.');
  }
  if (err) return <AdsErrorState error={err} />;
  if (!data) return <BladeSpinner center={true} containerHeight={80} />;
  const ev = data.eventSnippets.find((x) => x.key === event) || data.eventSnippets[0];
  return (
    <div className="ads-auto-pxdetail" data-testid="ads-px-detail">
      <div className="ads-card-head">
        <h4>Events received</h4>
        <div className="ads-seg" role="group" aria-label="Period">
          {(['24h', '7d'] as const).map((k) => (
            <button key={k} type="button" className={range === k ? 'on' : ''} onClick={() => setRange(k)} data-testid={`ads-px-range-${k}`}>{k === '24h' ? 'Last 24 hours' : 'Last 7 days'}</button>
          ))}
        </div>
      </div>
      {data.note && <p className="ads-wz-hint">{data.note}</p>}
      {data.stats && (
        !data.stats.events.length ? (
          <p className="ads-wz-hint" data-testid="ads-px-no-events">No events in this period. Check that the base code is on every page of your website.</p>
        ) : (
          <table className="ads-table" data-testid="ads-px-events">
            <thead><tr><th>Event</th><th className="num">Count</th><th>Last seen</th></tr></thead>
            <tbody>
              {data.stats.events.map((e) => (
                <tr key={e.event}><td>{e.event}</td><td className="num">{int(e.count)}</td><td>{ago(e.lastSeenAt) || '—'}</td></tr>
              ))}
            </tbody>
          </table>
        )
      )}
      <h4>Install the pixel</h4>
      <p className="ads-wz-hint">Paste this base code into the &lt;head&gt; of every page of your website (or give it to whoever runs the site). It records page views.</p>
      <pre className="ads-auto-code" data-testid="ads-px-code">{data.snippet}</pre>
      <button type="button" className="ads-btn sm" onClick={() => void copy(data.snippet, 'Meta Pixel base code')} data-testid="ads-px-copy">
        <CopyIcon /> Copy base code
      </button>
      <h4>Track a conversion</h4>
      <div className="ads-wz-row">
        <Field label="Event" hint="Add this where the action happens, e.g. on the order confirmation page for a purchase.">
          <select value={event} onChange={(e) => setEvent(e.target.value)} data-testid="ads-px-event">
            {data.eventSnippets.map((x) => <option key={x.key} value={x.key}>{x.fbq}</option>)}
          </select>
        </Field>
      </div>
      {ev && (
        <>
          <pre className="ads-auto-code" data-testid="ads-px-event-code">{`<script>\n${ev.code}\n</script>`}</pre>
          <button type="button" className="ads-btn sm" onClick={() => void copy(`<script>\n${ev.code}\n</script>`, `${ev.fbq} event`)} data-testid="ads-px-event-copy">
            <CopyIcon /> Copy event code
          </button>
        </>
      )}
      {data.customConversions.length > 0 && (
        <>
          <h4>Custom conversions on this pixel</h4>
          <ul className="ads-au-saved-list" data-testid="ads-px-ccs">
            {data.customConversions.map((c) => (
              <li key={c.id}><div><strong>{c.name}</strong> <span className="ads-chip">{c.eventType.replace(/_/g, ' ').toLowerCase()}</span>{c.archived ? <span className="ads-chip amber">archived</span> : null}</div></li>
            ))}
          </ul>
        </>
      )}
      <p>
        <a className="ads-link" href={data.eventsManagerUrl} target="_blank" rel="noopener noreferrer" data-testid="ads-px-em">
          Open in Events Manager <span className="material-icons" aria-hidden="true">open_in_new</span>
        </a>
      </p>
    </div>
  );
}

function PixelsPart({ api, onRevoked, refreshNonce }: { api: CrmApi; onRevoked: () => void; refreshNonce: number }) {
  const [data, setData] = useState<AdsPixelsList | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [n, setN] = useState(0);
  const [open, setOpen] = useState('');
  useEffect(() => {
    let live = true;
    setError(null);
    api
      .getAdsPixels(n > 0)
      .then((r) => {
        if (!live) return;
        setData(r);
        setOpen((cur) => cur || (r.pixels.find((p) => !p.unavailable)?.id ?? ''));
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
  if (error && !data) return <AdsErrorState error={error} onRetry={() => setN((x) => x + 1)} />;
  if (!data) return <BladeSpinner center={true} containerHeight={100} />;
  return (
    <section className="ads-card" data-testid="ads-px">
      <div className="ads-card-head">
        <h4>Pixels</h4>
        <button type="button" className="icon-btn" title="Reload from Meta" aria-label="Reload from Meta" onClick={() => setN((x) => x + 1)} data-testid="ads-px-reload">
          <span className="material-icons">refresh</span>
        </button>
      </div>
      <p className="ads-wz-hint">A pixel on your website tells Meta who bought or signed up after seeing an ad. Sales campaigns need one.</p>
      {!data.pixels.length ? (
        <div className="ads-empty" data-testid="ads-px-empty">
          <span className="material-icons" aria-hidden="true">sensors_off</span>
          <p>This ad account has no pixel yet. Create one in Meta Events Manager (Data sources → Add → Web), then come back here for its code.</p>
        </div>
      ) : (
        <div className="ads-auto-pixels">
          <ul className="ads-auto-pxlist">
            {data.pixels.map((p) => (
              <li key={p.id} className={open === p.id ? 'on' : undefined} data-testid={`ads-px-row-${p.id}`}>
                <button type="button" onClick={() => setOpen(p.id)} disabled={p.unavailable} data-testid={`ads-px-open-${p.id}`}>
                  <strong>{p.name}</strong>
                  <small>ID {p.id}</small>
                  <span>
                    <span className={`ads-pill ${PIXEL_STATE[p.state].tone}`} data-testid={`ads-px-state-${p.id}`}>{PIXEL_STATE[p.state].label}</span>
                    <small>{p.lastFiredTime ? `Last event ${ago(p.lastFiredTime)}` : 'No events yet'}</small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {open && <PixelDetail api={api} pixelId={open} refreshNonce={refreshNonce} />}
        </div>
      )}
    </section>
  );
}

// ----------------------------------------------------------------- tab --

type Part = 'rules' | 'tests' | 'pixels';

export function AdsAutomation({ api, range, canManageDefault, onRevoked, onReadOnly, refreshNonce, focus }: {
  api: CrmApi;
  range: AdsRange;
  canManageDefault: boolean;
  onRevoked: () => void;
  onReadOnly: () => void;
  refreshNonce: number;
  /** From a notification: 'rule:<id>' opens its history, 'test:<id>' its results. */
  focus?: string;
}) {
  const [part, setPart] = useState<Part>(focus?.startsWith('test:') ? 'tests' : 'rules');
  const [canManage, setCanManage] = useState(canManageDefault);
  const focusRuleId = focus?.startsWith('rule:') ? focus.slice(5) : '';
  const focusTestId = focus?.startsWith('test:') ? focus.slice(5) : '';
  useEffect(() => {
    if (focusRuleId) setPart('rules');
    else if (focusTestId) setPart('tests');
  }, [focusRuleId, focusTestId]);
  const parts = useMemo<[Part, string, string][]>(() => [['rules', 'Rules', 'rule'], ['tests', 'A/B tests', 'science'], ['pixels', 'Pixels', 'sensors']], []);
  return (
    <div className="ads-auto" data-testid="ads-automation">
      <nav className="ads-auto-nav" role="tablist" aria-label="Automation sections">
        {parts.map(([k, label, icon]) => (
          <button key={k} type="button" role="tab" aria-selected={part === k} className={part === k ? 'on' : ''} onClick={() => setPart(k)} data-testid={`ads-auto-sec-${k}`}>
            <span className="material-icons" aria-hidden="true">{icon}</span> {label}
          </button>
        ))}
      </nav>
      {part === 'rules' && (
        <RulesPart api={api} range={range} canManage={canManage} setCanManage={setCanManage} onRevoked={onRevoked} onReadOnly={onReadOnly} refreshNonce={refreshNonce} focusRuleId={focusRuleId} />
      )}
      {part === 'tests' && (
        <TestsPart api={api} range={range} canManage={canManage} setCanManage={setCanManage} onRevoked={onRevoked} onReadOnly={onReadOnly} refreshNonce={refreshNonce} focusTestId={focusTestId} />
      )}
      {part === 'pixels' && <PixelsPart api={api} onRevoked={onRevoked} refreshNonce={refreshNonce} />}
    </div>
  );
}
