// The Ads page once a Meta ad account is connected (/api/ads/meta/*):
// account summary and spend/results over time, campaigns → ad sets → ads with
// pause / resume (only when ads_management was granted), the connected Page's
// lead forms with their leads and CSV export, and the Click-to-WhatsApp leads.
// Every number comes from the server, which holds the ad token; the browser
// never sees it.
import { DownloadIcon } from './AppIcons';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CrmApi } from '../api';
import type {
  AdCampaignRow, AdLeadsReport, AdMetrics, AdRow, AdSetRow, AdsDayPoint, AdsRange, AdsRangePreset, LeadFormsReport,
  LeadsReport, MetaAdsConnection,
} from '../types';
import type { AdDraftItem } from '../types';
import { listTime } from '../utils';
import { useConfirm, useNotify } from './Dialogs';
import { BladeSpinner } from './BladeSpinner';
import { AdsCreateWizard, objectiveLabel } from './AdsCreateWizard';
// Ads Manager S2: managing existing campaigns, ad sets and ads.
import {
  BulkBar, IssuesPanel, ManageToolbar, ReviewNote, RowActions, SortTh, matchesFilter, matchesSearch, sortRows, useArchivedRows,
  useManageActions, useManageReview, type ManageFilter, type SortState,
} from './AdsManage';
import { AdPreviewDialog, EditDialog } from './AdsManageDialogs';
// Ads Manager S3: reports, column presets, comparison, account health, charts.
import {
  AdsReports, ColSortTh, ColumnPicker, DeltaChip, HealthCard, fmtCol, sortByColumn, useAdsReport, useColumnPrefs, type ColSort,
} from './AdsReports';
import { TrendChart } from './AdsCharts';
// Meta-style performance overview (cards, chart by day / week / month, activity history, live).
import { PerformanceOverview } from './AdsPerformance';
import { AdsProfileCard } from './AdsProfileCard';
// Ads Manager S4: audiences.
import { AdsAudiences } from './AdsAudiences';
// Ads Manager S5: automated rules, A/B tests, pixels.
import { AdsAutomation } from './AdsAutomation';
import type { AdsDelta, AdsReportQuery } from '../types';

type ApiErr = Error & { status?: number; data?: { code?: string; message?: string } | null };
export const errCode = (e: unknown) => (e as ApiErr)?.data?.code || '';
export const errText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong. Please try again.');
/** A client request id / idempotency key (one per click; a retry of the same click reuses it). */
export function newRequestId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
/** The server refuses ads writes while it runs a Marketing API version below v24 (reads still work). */
export const VERSION_OLD_TITLE = 'Ads changes are switched off on this server';
/** A toast title for an ads error: Meta busy, the server's Graph version, or the caller's own. */
export const errTitle = (e: unknown, fallback: string) => {
  const c = errCode(e);
  if (c === 'RATE_LIMITED') return 'Meta is busy';
  if (c === 'GRAPH_VERSION_TOO_OLD') return VERSION_OLD_TITLE;
  return fallback;
};

const PRESETS: { key: AdsRangePreset; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'last_7d', label: '7 days' },
  { key: 'last_30d', label: '30 days' },
  { key: 'last_90d', label: '90 days' },
  { key: 'custom', label: 'Custom' },
];

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** Days the Click-to-WhatsApp report should cover for a dashboard range. */
export function rangeDays(r: AdsRange): number {
  if (r.preset === 'today') return 1;
  if (r.preset === 'last_7d') return 7;
  if (r.preset === 'last_30d') return 30;
  if (r.preset === 'last_90d') return 90;
  const since = r.since ? Date.parse(`${r.since}T00:00:00Z`) : NaN;
  if (Number.isNaN(since)) return 30;
  return Math.min(365, Math.max(1, Math.ceil((Date.now() - since) / 86400000)));
}

function money(v: number | null | undefined, currency: string) {
  if (v === null || v === undefined) return '—';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 2 }).format(v);
  } catch {
    return `${v.toFixed(2)} ${currency}`;
  }
}
const int = (v: number) => Math.round(v || 0).toLocaleString();
const pct = (v: number) => `${(v || 0).toFixed(2)}%`;
const dec = (v: number) => (v || 0).toFixed(2);

const RESULT_LABEL: Record<string, string> = {
  messaging_conversations: 'Messaging conversations',
  leads: 'Leads',
  conversations_and_leads: 'Conversations + leads',
  link_clicks: 'Link clicks',
};

const STATUS_TONE: Record<string, string> = { ACTIVE: 'green', PAUSED: 'gray', CAMPAIGN_PAUSED: 'gray', ADSET_PAUSED: 'gray' };
function StatusPill({ status }: { status: string }) {
  const s = String(status || 'UNKNOWN').toUpperCase();
  const tone = STATUS_TONE[s] || (/DISAPPROVED|WITH_ISSUES|DELETED/.test(s) ? 'red' : 'amber');
  return <span className={`ads-pill ${tone}`}>{s.replace(/_/g, ' ').toLowerCase()}</span>;
}

/** Load something for the dashboard; `reload(true)` skips the server's cache. */
function useAdsData<T>(load: (refresh: boolean) => Promise<T>, key: string, onRevoked: () => void, refreshNonce = 0) {
  // Data is tagged with the key it was loaded for, so a drill-down never
  // renders the previous level's rows while the next level loads.
  const [loaded, setLoaded] = useState<{ key: string; value: T } | null>(null);
  const data = loaded && loaded.key === key ? loaded.value : null;
  const setData = (value: T | null) => setLoaded(value === null ? null : { key, value });
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const refreshNext = useRef(false);
  const lastRefresh = useRef(refreshNonce);
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    // The header's refresh button (refreshNonce) or reload(true): skip the server cache.
    const refresh = refreshNext.current || lastRefresh.current !== refreshNonce;
    lastRefresh.current = refreshNonce;
    refreshNext.current = false;
    loadRef
      .current(refresh)
      .then((d) => live && setData(d))
      .catch((e) => {
        if (!live) return;
        setData(null);
        setError(e);
        if (errCode(e) === 'ADS_REVOKED') onRevoked();
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce, refreshNonce]);
  return {
    data,
    error,
    loading,
    reload: (refresh = false) => {
      refreshNext.current = refresh;
      setNonce((n) => n + 1);
    },
  };
}

/** Readable error / rate-limit state with a retry button. */
export function AdsErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const code = errCode(error);
  const limited = code === 'RATE_LIMITED';
  const oldVersion = code === 'GRAPH_VERSION_TOO_OLD';
  return (
    <div className={`ads-state ${limited || oldVersion ? 'amber' : 'red'}`} role="alert" data-testid={limited ? 'ads-rate-limited' : oldVersion ? 'ads-version-old' : 'ads-error'}>
      <span className="material-icons" aria-hidden="true">{limited ? 'hourglass_top' : oldVersion ? 'update' : 'error_outline'}</span>
      <div>
        <strong>{limited ? 'Meta is busy, try again shortly' : oldVersion ? VERSION_OLD_TITLE : code === 'PERMISSION_MISSING' ? 'Meta didn’t allow this' : 'Couldn’t load this'}</strong>
        <p>{limited ? 'Meta is limiting requests for this ad account right now. Wait a minute or two, then try again.' : errText(error)}</p>
      </div>
      {onRetry && (
        <button type="button" className="ads-btn" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="ads-empty-box">{children}</div>;
}

// ------------------------------------------------------------- chart --

type ChartMetric = 'spend' | 'results' | 'clicks' | 'impressions';
const CHART_LABEL: Record<ChartMetric, string> = { spend: 'Spend', results: 'Results', clicks: 'Clicks', impressions: 'Impressions' };

/**
 * Bars per day for one metric, optionally a second metric as a line on the
 * right axis; hover a day for its values (plain SVG, AdsCharts TrendChart).
 * Keeps data-testid="ads-chart" and the ads-bar classes.
 */
function DayChart({ days, metric, metric2, currency }: { days: AdsDayPoint[]; metric: ChartMetric; metric2: ChartMetric | ''; currency: string }) {
  const fmt = (m: ChartMetric) => (m === 'spend' ? 'money' : 'int') as 'money' | 'int';
  return (
    <TrendChart
      testid="ads-chart"
      svgClassName="ads-chart"
      bars
      barClass={metric}
      height={210}
      ariaLabel={`${CHART_LABEL[metric]} per day`}
      points={days.map((d) => ({ label: d.date, a: Number(d[metric]) || 0, b: metric2 ? Number(d[metric2]) || 0 : undefined }))}
      a={{ label: CHART_LABEL[metric], format: fmt(metric) }}
      b={metric2 ? { label: CHART_LABEL[metric2], format: fmt(metric2) } : null}
      currency={currency}
    />
  );
}

// ---------------------------------------------------------- overview --

function Overview({ api, range, currency, onRevoked, refreshNonce, storeKey, pageId = '' }: { api: CrmApi; range: AdsRange; currency: string; onRevoked: () => void; refreshNonce: number; storeKey: string; pageId?: string }) {
  const key = JSON.stringify(range);
  const summary = useAdsData((r) => api.getAdsSummary(range, r), key, onRevoked, refreshNonce);
  const series = useAdsData((r) => api.getAdsTimeSeries(range, r), key, onRevoked, refreshNonce);
  const [metric, setMetric] = useState<ChartMetric>('spend');
  const [metric2, setMetric2] = useState<ChartMetric | ''>('');
  const m: AdMetrics | null = summary.data?.metrics || null;
  const cur = summary.data?.account.currency || currency;
  // Ads Manager S3: the same totals for the previous period of the same length.
  const cmp = useAdsReport(api, OVERVIEW_COMPARE, range, onRevoked, refreshNonce);
  const d = (id: string): AdsDelta | undefined => cmp.report?.totals.delta?.[id];

  return (
    <div className="ads-overview" data-testid="ads-overview">
      {/* Order: the Page / Instagram profile → account health → account stats → performance graphs. */}
      <AdsProfileCard api={api} pageId={pageId} refreshNonce={refreshNonce} />
      <HealthCard api={api} onRevoked={onRevoked} refreshNonce={refreshNonce} />
      {summary.loading && !summary.data && <BladeSpinner center={true} containerHeight={140} />}
      {summary.error ? <AdsErrorState error={summary.error} onRetry={() => summary.reload()} /> : null}
      {m && (
        <>
          {summary.data?.empty && (
            <Empty>No ad delivery in {summary.data.range.label.toLowerCase()}. Spend and results show here once your ads run.</Empty>
          )}
          {cmp.report?.compare && (
            <p className="ads-rp-range" data-testid="ads-compare-note">
              Changes compare with {cmp.report.compare.since} – {cmp.report.compare.until} (the previous {cmp.report.range.since === cmp.report.range.until ? 'day' : 'period of the same length'}).
            </p>
          )}
          <div className="ads-stats ads-stats-wide" data-testid="ads-summary">
            <Stat label="Amount spent" value={money(m.spend, cur)} id="spend" delta={d('spend')} better="neutral" />
            <Stat label="Impressions" value={int(m.impressions)} id="impressions" delta={d('impressions')} better="up" />
            <Stat label="Reach" value={int(m.reach)} id="reach" delta={d('reach')} better="up" />
            <Stat label="Clicks" value={int(m.clicks)} id="clicks" delta={d('clicks')} better="up" />
            <Stat label="CTR" value={pct(m.ctr)} id="ctr" delta={d('ctr')} better="up" />
            <Stat label="CPC" value={money(m.cpc, cur)} id="cpc" delta={d('cpc')} better="down" />
            <Stat label="CPM" value={money(m.cpm, cur)} id="cpm" delta={d('cpm')} better="down" />
            <Stat label="Frequency" value={dec(m.frequency)} id="frequency" delta={d('frequency')} better="neutral" />
            <Stat label="Messaging conversations" value={int(m.messagingConversations)} tone="green" id="messaging_conversations" delta={d('messaging_conversations')} better="up" />
            <Stat label="Leads" value={int(m.leads)} tone="green" id="leads" delta={d('leads')} better="up" />
            <Stat label={`Results${m.resultType ? ` (${RESULT_LABEL[m.resultType] || m.resultType})` : ''}`} value={int(m.results)} id="results" delta={d('results')} better="up" />
            <Stat label="Cost per result" value={money(m.costPerResult, cur)} id="cost_per_result" delta={d('cost_per_result')} better="down" />
          </div>
          {m.actions.length > 0 && (
            <section className="ads-card">
              <h4>Actions</h4>
              <ul className="ads-actions">
                {m.actions.map((a) => (
                  <li key={a.type}>
                    <span>{a.label}</span>
                    <strong>{int(a.value)}</strong>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
      <PerformanceOverview api={api} range={range} currency={currency} onRevoked={onRevoked} refreshNonce={refreshNonce} storeKey={storeKey} />
      <section className="ads-card">
        <div className="ads-card-head">
          <h4>Over time</h4>
          <div className="ads-range small" role="tablist" aria-label="Chart metric">
            {(Object.keys(CHART_LABEL) as ChartMetric[]).map((k) => (
              <button key={k} type="button" role="tab" aria-selected={metric === k} className={`ads-range-btn${metric === k ? ' on' : ''}`} onClick={() => setMetric(k)}>
                {CHART_LABEL[k]}
              </button>
            ))}
          </div>
          <label className="ads-rp-metric">
            <span>and</span>
            <select value={metric2 === metric ? '' : metric2} onChange={(e) => setMetric2(e.target.value as ChartMetric | '')} data-testid="ads-chart-metric2" aria-label="Second metric (right axis)">
              <option value="">No second metric</option>
              {(Object.keys(CHART_LABEL) as ChartMetric[]).filter((k) => k !== metric).map((k) => (
                <option key={k} value={k}>{CHART_LABEL[k]} (right axis)</option>
              ))}
            </select>
          </label>
        </div>
        {series.loading && !series.data && <BladeSpinner center={true} containerHeight={120} />}
        {series.error ? <AdsErrorState error={series.error} onRetry={() => series.reload()} /> : null}
        {series.data && (series.data.days.length ? <DayChart days={series.data.days} metric={metric} metric2={metric2 === metric ? '' : metric2} currency={cur} /> : <Empty>No daily results in this range.</Empty>)}
      </section>
    </div>
  );
}

function Stat({ label, value, tone, id, delta, better = 'up' }: { label: string; value: string; tone?: 'green'; id?: string; delta?: AdsDelta; better?: 'up' | 'down' | 'neutral' }) {
  return (
    <div className={`ads-stat${tone ? ` ${tone}` : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {delta && <DeltaChip delta={delta} better={better} testid={`ads-delta-${id}`} />}
    </div>
  );
}

/** Ads Manager S3: the Overview tiles' totals, compared with the previous period. */
const OVERVIEW_COMPARE: AdsReportQuery = {
  level: 'account',
  breakdown: 'none',
  columns: ['spend', 'impressions', 'reach', 'clicks', 'ctr', 'cpc', 'cpm', 'frequency', 'messaging_conversations', 'leads', 'results', 'cost_per_result'],
  compare: true,
};

// --------------------------------------------------------- campaigns --

type Level = 'campaign' | 'adset' | 'ad';
type Crumb = { id: string; name: string };

function Campaigns({
  api, conn, range, currency, canManageDefault, ctwaByAd, onRevoked, onReadOnly, onReconnect, refreshNonce, focusFilter, storeKey,
}: {
  api: CrmApi;
  conn: MetaAdsConnection;
  range: AdsRange;
  currency: string;
  canManageDefault: boolean;
  ctwaByAd: Map<string, number>;
  onRevoked: () => void;
  onReadOnly: () => void;
  onReconnect: () => void;
  refreshNonce: number;
  /** Ads Manager S2: e.g. an ad_rejected notification opens "Needs attention". */
  focusFilter?: { filter: ManageFilter; n: number } | null;
  /** Ads Manager S3: where the business's column choice is kept. */
  storeKey: string;
}) {
  const notify = useNotify();
  const confirm = useConfirm();
  // Ads Manager S1: the create wizard and CRM-side drafts.
  const [wizard, setWizard] = useState<{ draft: AdDraftItem | null; n: number } | null>(null);
  const [drafts, setDrafts] = useState<AdDraftItem[]>([]);
  const [draftBusy, setDraftBusy] = useState('');
  const loadDrafts = useCallback(() => {
    api
      .listAdDrafts()
      .then((r) => setDrafts(r.drafts))
      .catch(() => setDrafts([]));
  }, [api]);
  useEffect(() => loadDrafts(), [loadDrafts]);
  async function resumeDraft(d: AdDraftItem) {
    setDraftBusy(d.id);
    try {
      const r = await api.getAdDraft(d.id);
      setWizard({ draft: r.draft, n: Date.now() });
    } catch (e) {
      notify('error', 'Draft not opened', errText(e));
      loadDrafts();
    } finally {
      setDraftBusy('');
    }
  }
  async function removeDraft(d: AdDraftItem) {
    const ok = await confirm({ title: 'Delete this draft?', message: `“${d.name || 'Untitled campaign'}” is only saved in the CRM; nothing at Meta changes.`, confirmLabel: 'Delete', tone: 'danger' });
    if (!ok) return;
    try {
      await api.deleteAdDraft(d.id);
      setDrafts((list) => list.filter((x) => x.id !== d.id));
    } catch (e) {
      notify('error', 'Draft not deleted', errText(e));
    }
  }
  const [campaign, setCampaign] = useState<Crumb | null>(null);
  const [adset, setAdset] = useState<Crumb | null>(null);
  const [busyId, setBusyId] = useState('');
  const key = JSON.stringify(range);
  const level: Level = adset ? 'ad' : campaign ? 'adset' : 'campaign';
  const data = useAdsData<{ rows: (AdCampaignRow | AdSetRow | AdRow)[]; canManage?: boolean }>(
    async (r) => {
      if (adset) return { rows: (await api.getAds(adset.id, range, r)).ads };
      if (campaign) return { rows: (await api.getAdSets(campaign.id, range, r)).adsets };
      const c = await api.getAdCampaigns(range, r);
      return { rows: c.campaigns, canManage: c.canManage };
    },
    `${key}|${campaign?.id || ''}|${adset?.id || ''}`,
    onRevoked,
    refreshNonce,
  );
  const [canManage, setCanManage] = useState(canManageDefault);
  useEffect(() => {
    if (typeof data.data?.canManage === 'boolean') setCanManage(data.data.canManage);
  }, [data.data?.canManage]);
  useEffect(() => setCanManage(canManageDefault), [canManageDefault]);

  async function toggle(row: AdObject, lvl: Level) {
    const pause = row.status === 'ACTIVE';
    const what = lvl === 'adset' ? 'ad set' : lvl;
    const ok = await confirm({
      title: `${pause ? 'Pause' : 'Resume'} this ${what}?`,
      message: pause
        ? `“${row.name}” stops delivering at Meta right away. You can resume it here or in Ads Manager.`
        : `“${row.name}” starts delivering again at Meta and spends from its budget.`,
      // Ads Manager S2: turning something on shows its budget and dates.
      points: pause ? undefined : [describe(row)],
      confirmLabel: pause ? 'Pause' : 'Resume',
      tone: pause ? 'danger' : 'primary',
    });
    if (!ok) return;
    setBusyId(row.id);
    try {
      await api.setAdStatus({ level: lvl, id: row.id, status: pause ? 'PAUSED' : 'ACTIVE' });
      notify('success', pause ? 'Paused' : 'Resumed', `“${row.name}” is ${pause ? 'paused' : 'active'} at Meta.`);
      data.reload(true);
    } catch (e) {
      if (errCode(e) === 'READ_ONLY') {
        setCanManage(false);
        onReadOnly();
      }
      if (errCode(e) === 'ADS_REVOKED') onRevoked();
      notify('error', errTitle(e, 'Not changed'), errText(e));
    } finally {
      setBusyId('');
    }
  }

  const rows = data.data?.rows || [];

  // ---- Ads Manager S2: filters, search, sort, selection, row and bulk actions ----
  const parentId = adset?.id || campaign?.id || '';
  const [filter, setFilter] = useState<ManageFilter>('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortState>({ key: 'spend', dir: 'desc' });
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [editing, setEditing] = useState<{ level: Level; id: string; name: string } | null>(null);
  const [previewAd, setPreviewAd] = useState<{ id: string; name: string } | null>(null);
  const [archivedN, setArchivedN] = useState(0);
  const review = useManageReview(api, level, parentId, '', refreshNonce);
  const archived = useArchivedRows(api, level, parentId, filter === 'archived', archivedN);
  useEffect(() => setSelected(new Set()), [level, parentId, filter]);
  useEffect(() => {
    if (!focusFilter) return;
    setCampaign(null);
    setAdset(null);
    setFilter(focusFilter.filter);
  }, [focusFilter?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  const pool: AdObject[] = filter === 'archived' ? [...rows, ...(archived.rows || []).filter((a) => !rows.some((x) => x.id === a.id))] : rows;
  const visible = sortRows(pool.filter((r) => matchesFilter(r, filter, review.map) && matchesSearch(r, search)), sort);
  const issueCount = rows.filter((r) => matchesFilter(r, 'issues', review.map)).length;
  const selectedRows = visible.filter((r) => selected.has(r.id));
  const allChecked = visible.length > 0 && selectedRows.length === visible.length;
  const toggleSel = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const afterChange = () => {
    data.reload(true);
    review.reload(true);
    setArchivedN((x) => x + 1);
  };
  const onManageError = (e: unknown, title: string) => {
    if (errCode(e) === 'READ_ONLY') {
      setCanManage(false);
      onReadOnly();
    }
    if (errCode(e) === 'ADS_REVOKED') onRevoked();
    if (title) notify('error', errTitle(e, title), errText(e));
  };
  /** One line for the resume confirms: name, budget, dates. */
  function describe(r: AdObject) {
    const fmt = (s: string) => {
      try {
        return new Intl.DateTimeFormat(undefined, { timeZone: conn.timezone || undefined, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(s));
      } catch {
        return s;
      }
    };
    if (level === 'ad') return `${r.name || r.id}: spends from its ad set’s budget, on its ad set’s schedule`;
    const b = budgetText(r as AdCampaignRow | AdSetRow, currency);
    const money = b === '—' ? (level === 'campaign' ? 'budget on its ad sets' : 'campaign budget') : `budget ${b}`;
    const c = r as AdCampaignRow;
    const dates = level === 'campaign'
      ? `${c.startTime ? `from ${fmt(c.startTime)}` : 'starts now'} · ${c.stopTime ? `until ${fmt(c.stopTime)}` : 'no end date'}`
      : 'dates as set at Meta';
    return `${r.name || r.id}: ${money} · ${dates}`;
  }
  const manage = useManageActions({ api, level, describe, onChanged: afterChange, onError: onManageError, refreshNonce });
  const problemAds = review.report?.problemAds || [];

  // ---- Ads Manager S3: column presets (Performance = the classic columns from the list itself) ----
  const cols = useColumnPrefs(storeKey);
  const classic = cols.prefs.preset === 'performance';
  const colQuery = useMemo<AdsReportQuery | null>(
    () => (classic ? null : { level, breakdown: 'none', columns: cols.columns, parentId: parentId || undefined }),
    [classic, level, cols.columns, parentId],
  );
  const colData = useAdsReport(api, colQuery, range, onRevoked, refreshNonce);
  const colValues = useMemo(() => new Map((colData.report?.rows || []).map((r) => [r.object?.id || '', r.values])), [colData.report]);
  const [colSort, setColSort] = useState<ColSort | null>(null);
  useEffect(() => setColSort(null), [level, parentId, cols.prefs.preset]);
  const shown = !classic && colSort ? sortByColumn(visible, colSort, colValues) : visible;

  return (
    <section className="ads-card" data-testid="ads-campaigns">
      <div className="ads-card-head">
        <nav className="ads-crumbs" aria-label="Drill-down">
          <button type="button" className={!campaign ? 'on' : ''} onClick={() => { setCampaign(null); setAdset(null); }}>
            All campaigns
          </button>
          {campaign && (
            <>
              <span aria-hidden="true">›</span>
              <button type="button" className={!adset ? 'on' : ''} onClick={() => setAdset(null)} data-testid="ads-crumb-campaign">
                {campaign.name || campaign.id}
              </button>
            </>
          )}
          {adset && (
            <>
              <span aria-hidden="true">›</span>
              <button type="button" className="on">{adset.name || adset.id}</button>
            </>
          )}
        </nav>
        <div className="ads-campaigns-actions">
          <ColumnPicker prefs={cols.prefs} onSave={cols.save} testid="ads-cols" />
          <span className={`ads-chip ${canManage ? 'green' : ''}`} data-testid="ads-manage-chip">
            {canManage ? 'You can pause and resume here' : 'Read-only'}
          </span>
          {level === 'campaign' && (
            <button
              type="button"
              className="ads-btn primary"
              onClick={() => setWizard({ draft: null, n: Date.now() })}
              disabled={!canManage}
              title={canManage ? 'Create a campaign at Meta (created paused)' : 'Read-only: reconnect and allow managing ads (ads_management) to create campaigns.'}
              data-testid="ads-create-campaign"
            >
              <span className="material-icons" aria-hidden="true">add</span>
              Create campaign
            </button>
          )}
        </div>
      </div>
      {level === 'campaign' && drafts.length > 0 && (
        <div className="ads-drafts" data-testid="ads-drafts">
          <h5>Drafts saved in the CRM (not at Meta yet)</h5>
          <ul>
            {drafts.map((d) => (
              <li key={d.id} data-testid={`ads-draft-${d.id}`}>
                <span className="material-icons" aria-hidden="true" style={{ color: '#94a3b8', fontSize: 18 }}>edit_note</span>
                <span className="grow">
                  <strong>{d.name || 'Untitled campaign'}</strong> <small>· {objectiveLabel(d.objective)} · step {d.step + 1} of 7{d.updatedAt ? ` · saved ${listTime(d.updatedAt)}` : ''}</small>
                </span>
                <button type="button" className="ads-btn sm primary" onClick={() => resumeDraft(d)} disabled={draftBusy === d.id} data-testid={`ads-draft-resume-${d.id}`}>
                  {draftBusy === d.id ? 'Opening…' : 'Resume'}
                </button>
                <button type="button" className="ads-btn sm danger" onClick={() => removeDraft(d)} data-testid={`ads-draft-delete-${d.id}`}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {data.loading && !data.data && <BladeSpinner center={true} containerHeight={140} />}
      {data.error ? <AdsErrorState error={data.error} onRetry={() => data.reload()} /> : null}
      {data.data && !rows.length && (
        <Empty>
          {level === 'campaign' ? 'This ad account has no campaigns yet.' : level === 'adset' ? 'This campaign has no ad sets.' : 'This ad set has no ads.'}
          {level === 'campaign' && (
            <button
              type="button"
              className="ads-btn primary"
              onClick={() => setWizard({ draft: null, n: Date.now() })}
              disabled={!canManage}
              title={canManage ? undefined : 'Read-only: reconnect and allow managing ads (ads_management) to create campaigns.'}
              data-testid="ads-create-campaign-empty"
            >
              Create your first campaign
            </button>
          )}
        </Empty>
      )}
      {wizard && (
        <AdsCreateWizard
          key={wizard.n}
          api={api}
          conn={{ ...conn, canManage }}
          draft={wizard.draft}
          onClose={() => {
            setWizard(null);
            loadDrafts();
          }}
          onCreated={() => {
            data.reload(true);
            loadDrafts();
          }}
          onReconnect={onReconnect}
        />
      )}
      {data.data && (rows.length > 0 || filter !== 'all') && (
        <>
          <ManageToolbar filter={filter} setFilter={setFilter} search={search} setSearch={setSearch} shown={visible.length} total={pool.filter((r) => matchesFilter(r, filter === 'archived' ? 'archived' : 'all', review.map)).length} issues={issueCount} />
          {problemAds.length > 0 && filter !== 'issues' && (
            <button type="button" className="ads-mg-attention" onClick={() => setFilter('issues')} data-testid="ads-attention-banner">
              <span className="material-icons" aria-hidden="true">gpp_maybe</span>
              {problemAds.length} ad{problemAds.length === 1 ? '' : 's'} {level === 'campaign' ? 'in this account ' : ''}need{problemAds.length === 1 ? 's' : ''} attention (rejected or with issues). Show
            </button>
          )}
          {filter === 'issues' && (
            <IssuesPanel
              ads={problemAds}
              canManage={canManage}
              onEdit={(a) => setEditing({ level: 'ad', id: a.id, name: a.name })}
              onPreview={(a) => setPreviewAd({ id: a.id, name: a.name })}
            />
          )}
          <BulkBar
            level={level}
            count={selectedRows.length}
            canManage={canManage}
            busy={['pause', 'resume', 'duplicate', 'archive'].includes(manage.busy) ? manage.busy : ''}
            progress={manage.progress}
            onAction={(a) => void manage.bulk(a, selectedRows, () => setSelected(new Set()))}
            onClear={() => setSelected(new Set())}
            locked={manage.bulkLocked}
            onRefresh={manage.refreshAfterLost}
          />
        </>
      )}
      {filter === 'archived' && archived.error ? <AdsErrorState error={archived.error} onRetry={() => setArchivedN((x) => x + 1)} /> : null}
      {data.data && pool.length > 0 && !visible.length && (
        <Empty>
          <span data-testid="ads-mg-no-match">
            {filter === 'archived' && !archived.rows ? 'Loading archived items…' : `No ${level === 'adset' ? 'ad sets' : `${level}s`} match ${search ? 'this search' : 'this filter'}.`}
          </span>
        </Empty>
      )}
      {data.data && filter === 'archived' && !pool.length && archived.rows && (
        <Empty>
          <span data-testid="ads-mg-no-match">Nothing is archived here.</span>
        </Empty>
      )}
      {editing && (
        <EditDialog
          key={`${editing.level}:${editing.id}`}
          api={api}
          level={editing.level}
          id={editing.id}
          name={editing.name}
          conn={{ ...conn, canManage }}
          onClose={() => setEditing(null)}
          onSaved={afterChange}
          onError={(e) => onManageError(e, '')}
          onReconnect={onReconnect}
        />
      )}
      {previewAd && <AdPreviewDialog api={api} id={previewAd.id} name={previewAd.name || previewAd.id} onClose={() => setPreviewAd(null)} />}
      {!classic && colData.run && !colData.report && (
        <p className="ads-rp-muted" data-testid="ads-cols-async">Meta is preparing these columns… {colData.run.percent}%</p>
      )}
      {!classic && colData.error ? <AdsErrorState error={colData.error} onRetry={() => colData.reload(true)} /> : null}
      {!classic && colData.report && colData.report.dropped.length > 0 && (
        <p className="ads-rp-muted">Not available here: {colData.report.dropped.map((x) => x.label).join(', ')}.</p>
      )}
      {visible.length > 0 && (
        <div className="ads-table-wrap">
          <table className="ads-table" data-testid={`ads-table-${level}`}>
            <thead>
              <tr>
                {canManage && (
                  <th className="ads-mg-check">
                    <input
                      type="checkbox"
                      aria-label="Select all rows shown"
                      checked={allChecked}
                      ref={(el) => {
                        if (el) el.indeterminate = selectedRows.length > 0 && !allChecked;
                      }}
                      onChange={() => setSelected(allChecked ? new Set() : new Set(visible.map((r) => r.id)))}
                      data-testid="ads-select-all"
                    />
                  </th>
                )}
                <SortTh k="name" label={level === 'campaign' ? 'Campaign' : level === 'adset' ? 'Ad set' : 'Ad'} sort={sort} onSort={setSort} />
                <SortTh k="status" label="Status" sort={sort} onSort={setSort} />
                <th>{level === 'campaign' ? 'Objective' : level === 'adset' ? 'Optimisation' : 'WhatsApp chats'}</th>
                {level !== 'ad' && <th>Budget</th>}
                {classic ? (
                  <>
                    <SortTh k="spend" label="Spent" sort={sort} onSort={setSort} num />
                    <SortTh k="impressions" label="Impr." sort={sort} onSort={setSort} num />
                    <SortTh k="clicks" label="Clicks" sort={sort} onSort={setSort} num />
                    <SortTh k="ctr" label="CTR" sort={sort} onSort={setSort} num />
                    <SortTh k="results" label="Results" sort={sort} onSort={setSort} num />
                    <SortTh k="costPerResult" label="Cost / result" sort={sort} onSort={setSort} num />
                  </>
                ) : (
                  cols.columns.map((id) => <ColSortTh key={id} id={id} sort={colSort} onSort={setColSort} />)
                )}
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => {
                const r = row as AdObject;
                const drill = level !== 'ad';
                return (
                  <tr
                    key={r.id}
                    className={`${drill ? 'drill' : ''}${selected.has(r.id) ? ' selected' : ''}`}
                    onClick={drill ? () => (level === 'campaign' ? setCampaign({ id: r.id, name: r.name }) : setAdset({ id: r.id, name: r.name })) : undefined}
                    data-testid={`ads-row-${r.id}`}
                  >
                    {canManage && (
                      <td className="ads-mg-check" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" aria-label={`Select ${r.name || r.id}`} checked={selected.has(r.id)} onChange={() => toggleSel(r.id)} data-testid={`ads-select-${r.id}`} />
                      </td>
                    )}
                    <td className="name">
                      {level === 'ad' ? <Creative row={r as AdRow} /> : <strong>{r.name || r.id}</strong>}
                    </td>
                    <td>
                      <StatusPill status={r.effectiveStatus || r.status} />
                      <ReviewNote info={review.map.get(r.id)} level={level} />
                    </td>
                    <td>
                      {level === 'campaign'
                        ? humanize((r as AdCampaignRow).objective)
                        : level === 'adset'
                          ? humanize((r as AdSetRow).optimizationGoal)
                          : ctwaByAd.get(r.id) ? `${ctwaByAd.get(r.id)} chat${ctwaByAd.get(r.id) === 1 ? '' : 's'}` : '—'}
                    </td>
                    {level !== 'ad' && <td>{budgetText(r as AdCampaignRow | AdSetRow, currency)}</td>}
                    {classic ? (
                      <>
                        <td className="num">{money(r.metrics.spend, currency)}</td>
                        <td className="num">{int(r.metrics.impressions)}</td>
                        <td className="num">{int(r.metrics.clicks)}</td>
                        <td className="num">{pct(r.metrics.ctr)}</td>
                        <td className="num">{int(r.metrics.results)}</td>
                        <td className="num">{money(r.metrics.costPerResult, currency)}</td>
                      </>
                    ) : (
                      cols.columns.map((id) => (
                        <td key={id} className="num" data-testid={`ads-cell-${r.id}-${id}`}>
                          {colData.report ? fmtCol(id, colValues.get(r.id)?.[id] ?? null, currency) : '…'}
                        </td>
                      ))
                    )}
                    <td onClick={(e) => e.stopPropagation()} className="ads-mg-rowtools">
                      {canManage && (r.status === 'ACTIVE' || r.status === 'PAUSED') && (
                        <button
                          type="button"
                          className={`ads-btn sm ${r.status === 'ACTIVE' ? 'danger' : ''}`}
                          disabled={busyId === r.id}
                          onClick={() => toggle(r, level)}
                          data-testid={`ads-toggle-${r.id}`}
                        >
                          {busyId === r.id ? '…' : r.status === 'ACTIVE' ? 'Pause' : 'Resume'}
                        </button>
                      )}
                      <RowActions
                        level={level}
                        row={r}
                        canManage={canManage}
                        busy={manage.busy}
                        onEdit={() => setEditing({ level, id: r.id, name: r.name })}
                        onDuplicate={() => void manage.duplicate(r)}
                        onPreview={() => setPreviewAd({ id: r.id, name: r.name })}
                        onArchive={() => void manage.archive(r)}
                        onDelete={() => void manage.remove(r)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

type AdObject = AdCampaignRow | AdSetRow | AdRow;

const humanize = (s: string) => (s ? s.replace(/^OUTCOME_/, '').replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase()) : '—');
function budgetText(r: AdCampaignRow | AdSetRow, currency: string) {
  if (r.dailyBudget) return `${money(r.dailyBudget, currency)} / day`;
  if (r.lifetimeBudget) return `${money(r.lifetimeBudget, currency)} lifetime`;
  return '—';
}

function Creative({ row }: { row: AdRow }) {
  const c = row.creative || { id: '', title: '', body: '', thumbnailUrl: '' };
  return (
    <span className="ads-creative" data-testid="ads-creative">
      {c.thumbnailUrl ? <img src={c.thumbnailUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="ads-ad-ph material-icons">image</span>}
      <span className="ads-creative-text">
        <strong>{row.name || row.id}</strong>
        {c.title && <small className="title">{c.title}</small>}
        {c.body && <small>{c.body}</small>}
      </span>
    </span>
  );
}

// -------------------------------------------------------- lead forms --

function LeadForms({
  api, conn, focusFormId, onRevoked, onOpenChat, onReconnect, refreshNonce,
}: {
  api: CrmApi;
  conn: MetaAdsConnection;
  focusFormId: string;
  onRevoked: () => void;
  onOpenChat: (phone: string) => void;
  onReconnect: () => void;
  refreshNonce: number;
}) {
  const notify = useNotify();
  const forms = useAdsData<LeadFormsReport>((r) => api.getLeadForms(r), conn.pageId || 'none', onRevoked, refreshNonce);
  const [formId, setFormId] = useState(focusFormId);
  useEffect(() => {
    if (focusFormId) setFormId(focusFormId);
  }, [focusFormId]);
  useEffect(() => {
    if (!formId && forms.data?.forms.length) setFormId(forms.data.forms[0].id);
  }, [forms.data, formId]);
  const leads = useAdsData<LeadsReport | null>((r) => (formId ? api.getLeads(formId, r) : Promise.resolve(null)), formId, onRevoked, refreshNonce);
  const [downloading, setDownloading] = useState(false);

  async function csv() {
    if (!formId) return;
    setDownloading(true);
    try {
      const { blob, filename } = await api.downloadLeadsCsv(formId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) {
      notify('error', 'CSV not downloaded', errText(e));
    } finally {
      setDownloading(false);
    }
  }

  if (!conn.pageId) {
    return (
      <section className="ads-card" data-testid="ads-leadforms">
        <Empty>
          No Facebook Page is connected for lead forms. Reconnect and pick the Page that runs your lead ads.
          <button type="button" className="ads-btn" onClick={onReconnect}>
            Reconnect
          </button>
        </Empty>
      </section>
    );
  }
  const page = forms.data?.page;
  return (
    <section className="ads-card" data-testid="ads-leadforms">
      <div className="ads-card-head">
        <h4>Lead forms · {conn.pageName || conn.pageId}</h4>
        {page && (
          <span className={`ads-chip ${page.leadgenSubscribed ? 'green' : ''}`} title={page.leadgenError || ''}>
            {page.leadgenSubscribed ? 'New leads notify you' : 'New-lead alerts off'}
          </span>
        )}
      </div>
      {page && !page.leadgenSubscribed && page.leadgenError && (
        <p className="ads-note">Meta didn’t turn on new-lead alerts for this Page: {page.leadgenError}</p>
      )}
      {forms.loading && !forms.data && <BladeSpinner center={true} containerHeight={120} />}
      {forms.error ? <AdsErrorState error={forms.error} onRetry={() => forms.reload()} /> : null}
      {forms.data && !forms.data.forms.length && <Empty>This Page has no lead forms yet.</Empty>}
      {forms.data && forms.data.forms.length > 0 && (
        <div className="ads-leads-layout">
          <ul className="ads-forms" role="listbox" aria-label="Lead forms">
            {forms.data.forms.map((f) => (
              <li key={f.id}>
                <button type="button" className={f.id === formId ? 'on' : ''} onClick={() => setFormId(f.id)} data-testid={`ads-form-${f.id}`}>
                  <strong>{f.name || f.id}</strong>
                  <small>
                    {humanize(f.status)} · {int(f.leadsCount)} lead{f.leadsCount === 1 ? '' : 's'}
                  </small>
                </button>
              </li>
            ))}
          </ul>
          <div className="ads-leads-pane">
            <div className="ads-card-head">
              <h4>{leads.data?.form.name || 'Leads'}</h4>
              <button type="button" className="ads-btn" onClick={csv} disabled={!formId || downloading || !leads.data?.leads.length} data-testid="ads-csv">
                <DownloadIcon />
                {downloading ? 'Preparing…' : 'Download CSV'}
              </button>
            </div>
            {leads.loading && !leads.data && <BladeSpinner center={true} containerHeight={100} />}
            {leads.error ? <AdsErrorState error={leads.error} onRetry={() => leads.reload()} /> : null}
            {leads.data && !leads.data.leads.length && <Empty>No leads on this form yet.</Empty>}
            {leads.data && leads.data.leads.length > 0 && (
              <div className="ads-table-wrap">
                <table className="ads-table" data-testid="ads-leads-table">
                  <thead>
                    <tr>
                      <th>Received</th>
                      <th>Name</th>
                      <th>Phone</th>
                      <th>Email</th>
                      <th>Ad / campaign</th>
                      <th aria-label="WhatsApp" />
                    </tr>
                  </thead>
                  <tbody>
                    {leads.data.leads.map((l) => (
                      <tr key={l.id}>
                        <td>{l.createdTime ? listTime(l.createdTime) : '—'}</td>
                        <td>{l.name || '—'}</td>
                        <td>{l.phone ? `+${l.phone}` : '—'}</td>
                        <td>{l.email || '—'}</td>
                        <td>
                          {l.adName || (l.isOrganic ? 'Organic' : '—')}
                          {l.campaignName && <small className="ads-sub">{l.campaignName}</small>}
                        </td>
                        <td>
                          {l.phone && (
                            <button type="button" className="ads-btn sm wa" onClick={() => onOpenChat(l.phone)} data-testid={`ads-lead-chat-${l.id}`}>
                              Open chat on WhatsApp
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------- the page --

type Tab = 'overview' | 'campaigns' | 'reports' | 'audiences' | 'automation' | 'leads' | 'whatsapp';

export function MetaAdsDashboard({
  api, conn, ctwa, onRangeChange, onReconnect, onDisconnect, onRevoked, onReadOnly, onOpenChat, focus, businessId = '',
}: {
  api: CrmApi;
  conn: MetaAdsConnection;
  /** The Click-to-WhatsApp leads section (rendered on the WhatsApp leads tab). */
  ctwa: { node: ReactNode; report: AdLeadsReport | null };
  onRangeChange: (r: AdsRange) => void;
  onReconnect: () => void;
  onDisconnect: () => void;
  onRevoked: () => void;
  onReadOnly: () => void;
  onOpenChat: (phone: string) => void;
  focus?: { id: string; n: number } | null;
  /** Ads Manager S3: the column choice is kept per business in this browser. */
  businessId?: string;
}) {
  const [range, setRange] = useState<AdsRange>({ preset: 'last_7d' });
  const storeKey = businessId || conn.adAccountId;
  const [custom, setCustom] = useState({ since: ymd(new Date(Date.now() - 13 * 86400000)), until: ymd(new Date()) });
  const [showCustom, setShowCustom] = useState(false);
  const [tab, setTab] = useState<Tab>('overview');
  const [focusFormId, setFocusFormId] = useState('');
  const [campaignFocus, setCampaignFocus] = useState<{ filter: ManageFilter; n: number } | null>(null);
  const [audienceFocus, setAudienceFocus] = useState('');
  const [automationFocus, setAutomationFocus] = useState('');
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!focus) return;
    if (focus.id.startsWith('leadform:')) {
      setTab('leads');
      setFocusFormId(focus.id.slice('leadform:'.length));
    } else if (focus.id === 'leadforms') setTab('leads');
    // Ads Manager: ad_campaign_created opens the Campaigns tab.
    else if (focus.id.startsWith('campaign:')) setTab('campaigns');
    // Ads Manager S2: ad_rejected opens Campaigns → Needs attention.
    else if (focus.id.startsWith('ad:')) {
      setTab('campaigns');
      setCampaignFocus({ filter: 'issues', n: focus.n });
    }
    // Ads Manager S4: ad_audience_ready opens Audiences on that audience.
    else if (focus.id.startsWith('audience:')) {
      setTab('audiences');
      setAudienceFocus(focus.id.slice('audience:'.length));
    }
    // Ads Manager S5: ad_rule_triggered / ad_test_winner open Automation on that rule / test.
    else if (focus.id.startsWith('rule:') || focus.id.startsWith('test:')) {
      setTab('automation');
      setAutomationFocus(`${focus.id}#${focus.n}`);
    }
  }, [focus?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => onRangeChange(range), [range]); // eslint-disable-line react-hooks/exhaustive-deps

  const ctwaByAd = useMemo(() => new Map((ctwa.report?.ads || []).map((a) => [a.id, a.leads])), [ctwa.report]);
  const customBad = !custom.since || !custom.until || custom.since > custom.until || custom.until > ymd(new Date(Date.now() + 86400000));

  return (
    <div className="page" data-testid="ads-dashboard">
      <header className="page-head ads-head">
        <div className="crm-ads-header-left">
          <div className="crm-ads-status-badge" title={`Connected: ${conn.adAccountId}`}>
            <span className="crm-ads-status-dot" />
            <span className="crm-ads-status-text" data-testid="ads-account">
              Linked: <strong>{conn.adAccountName}</strong> ({conn.adAccountId}
              {conn.currency ? ` · ${conn.currency}` : ''})
            </span>
            <button type="button" className="crm-ads-status-btn" onClick={onReconnect} title="Connect a different ad account">
              Change
            </button>
            <button type="button" className="crm-ads-status-btn disconnect" onClick={onDisconnect} title="Disconnect the ad account" data-testid="ads-disconnect">
              Disconnect
            </button>
          </div>
          {conn.accountStatus && conn.accountStatus !== 1 && conn.accountStatusLabel ? (
            <span className="ads-chip amber">Account: {conn.accountStatusLabel}</span>
          ) : null}
        </div>
        <div className="ads-head-right">
          <div className="ads-range" role="tablist" aria-label="Date range" data-testid="ads-range">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                role="tab"
                aria-selected={p.key === 'custom' ? showCustom || range.preset === 'custom' : range.preset === p.key && !showCustom}
                className={`ads-range-btn${(p.key === 'custom' ? showCustom || range.preset === 'custom' : range.preset === p.key && !showCustom) ? ' on' : ''}`}
                onClick={() => {
                  if (p.key === 'custom') setShowCustom(true);
                  else {
                    setShowCustom(false);
                    setRange({ preset: p.key });
                  }
                }}
                data-testid={`ads-range-${p.key}`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <button type="button" className="icon-btn" title="Refresh from Meta" aria-label="Refresh from Meta" onClick={() => setNonce((n) => n + 1)}>
            <span className="material-icons">refresh</span>
          </button>
        </div>
      </header>
      {showCustom && (
        <div className="ads-custom" data-testid="ads-custom">
          <label>
            From <input type="date" value={custom.since} max={custom.until} onChange={(e) => setCustom((c) => ({ ...c, since: e.target.value }))} />
          </label>
          <label>
            To <input type="date" value={custom.until} min={custom.since} max={ymd(new Date())} onChange={(e) => setCustom((c) => ({ ...c, until: e.target.value }))} />
          </label>
          <button type="button" className="ads-btn primary" disabled={customBad} onClick={() => { setRange({ preset: 'custom', ...custom }); setShowCustom(false); }} data-testid="ads-custom-apply">
            Apply
          </button>
          <button type="button" className="ads-btn" onClick={() => setShowCustom(false)}>
            Cancel
          </button>
        </div>
      )}
      <nav className="ads-tabs" role="tablist" aria-label="Ads sections">
        {([
          ['overview', 'Overview'],
          ['campaigns', 'Campaigns'],
          ['reports', 'Reports'],
          ['audiences', 'Audiences'],
          ['automation', 'Automation'],
          ['leads', 'Lead forms'],
          ['whatsapp', 'WhatsApp leads'],
        ] as [Tab, string][]).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)} data-testid={`ads-tab-${k}`}>
            {label}
          </button>
        ))}
        {range.preset === 'custom' && <span className="ads-range-label">{range.since} – {range.until}</span>}
      </nav>
      <div className="page-body ads-body">
        {tab === 'overview' && <Overview api={api} range={range} currency={conn.currency} onRevoked={onRevoked} refreshNonce={nonce} storeKey={storeKey} pageId={conn.pageId} />}
        {tab === 'campaigns' && (
          <Campaigns
            api={api}
            conn={conn}
            range={range}
            currency={conn.currency}
            canManageDefault={conn.canManage}
            ctwaByAd={ctwaByAd}
            onRevoked={onRevoked}
            onReadOnly={onReadOnly}
            onReconnect={onReconnect}
            refreshNonce={nonce}
            focusFilter={campaignFocus}
            storeKey={storeKey}
          />
        )}
        {tab === 'reports' && <AdsReports api={api} range={range} currency={conn.currency} storeKey={storeKey} onRevoked={onRevoked} refreshNonce={nonce} />}
        {tab === 'audiences' && (
          <AdsAudiences api={api} canManageDefault={conn.canManage} onRevoked={onRevoked} onReadOnly={onReadOnly} refreshNonce={nonce} focusId={audienceFocus} />
        )}
        {tab === 'automation' && (
          <AdsAutomation
            key={automationFocus}
            api={api}
            range={range}
            canManageDefault={conn.canManage}
            onRevoked={onRevoked}
            onReadOnly={onReadOnly}
            refreshNonce={nonce}
            focus={automationFocus.split('#')[0]}
          />
        )}
        {tab === 'leads' && (
          <LeadForms
            api={api}
            conn={conn}
            focusFormId={focusFormId}
            onRevoked={onRevoked}
            onOpenChat={onOpenChat}
            onReconnect={onReconnect}
            refreshNonce={nonce}
          />
        )}
        {tab === 'whatsapp' && ctwa.node}
      </div>
    </div>
  );
}
