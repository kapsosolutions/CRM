// Ads Manager S3: reports like Ads Manager (Ads → Reports, plus the column
// presets of the Campaigns tables and the Overview's comparison and account
// health card).
//
// The server (services/metaAdsReports.js) builds every Insights query from
// allow-listed values: level, breakdown and columns. REPORT_COLUMNS and
// COLUMN_PRESETS below mirror its COLUMNS / PRESETS (the S3 harness checks
// they match). Large reports run at Meta as async report runs; useAdsReport
// polls /meta/reports/runs/:id until the report is ready. The column choice
// is kept per business in this browser (localStorage).
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CrmApi } from '../api';
import type {
  AdCampaignRow, AdsAccountHealth, AdsColumnFormat, AdsColumnPreset, AdsDelta, AdsRange, AdsReport, AdsReportBreakdown, AdsReportLevel,
  AdsReportQuery, AdsReportRow, AdsReportRun,
} from '../types';
import { useNotify } from './Dialogs';
import { BladeSpinner } from './BladeSpinner';
import { AdsErrorState, errCode, errText } from './MetaAdsDashboard';
import { ManageDialog } from './AdsManageDialogs';
import { BarChart, StackedBarChart, TrendChart, fmtValue } from './AdsCharts';
import './AdsManager.css';

// ------------------------------------------------------------- columns --

export interface ReportColumnDef {
  id: string;
  label: string;
  /** Header text in the tables. */
  short: string;
  group: string;
  format: AdsColumnFormat;
  better: 'up' | 'down' | 'neutral';
}

export const REPORT_COLUMNS: ReportColumnDef[] = [
  { id: 'spend', label: 'Amount spent', short: 'Spent', group: 'Delivery', format: 'money', better: 'neutral' },
  { id: 'impressions', label: 'Impressions', short: 'Impr.', group: 'Delivery', format: 'int', better: 'up' },
  { id: 'reach', label: 'Reach', short: 'Reach', group: 'Delivery', format: 'int', better: 'up' },
  { id: 'frequency', label: 'Frequency', short: 'Freq.', group: 'Delivery', format: 'dec', better: 'neutral' },
  { id: 'cpm', label: 'CPM (cost per 1,000 impressions)', short: 'CPM', group: 'Delivery', format: 'money', better: 'down' },
  { id: 'cpp', label: 'Cost per 1,000 people reached', short: 'Cost / 1k reached', group: 'Delivery', format: 'money', better: 'down' },
  { id: 'clicks', label: 'Clicks (all)', short: 'Clicks', group: 'Clicks', format: 'int', better: 'up' },
  { id: 'ctr', label: 'CTR (all)', short: 'CTR', group: 'Clicks', format: 'pct', better: 'up' },
  { id: 'cpc', label: 'CPC (all)', short: 'CPC', group: 'Clicks', format: 'money', better: 'down' },
  { id: 'link_clicks', label: 'Link clicks', short: 'Link clicks', group: 'Clicks', format: 'int', better: 'up' },
  { id: 'link_ctr', label: 'Link CTR', short: 'Link CTR', group: 'Clicks', format: 'pct', better: 'up' },
  { id: 'cost_per_link_click', label: 'Cost per link click', short: 'Cost / link click', group: 'Clicks', format: 'money', better: 'down' },
  { id: 'outbound_clicks', label: 'Outbound clicks', short: 'Outbound', group: 'Clicks', format: 'int', better: 'up' },
  { id: 'landing_page_views', label: 'Landing page views', short: 'Landing views', group: 'Clicks', format: 'int', better: 'up' },
  { id: 'results', label: 'Results', short: 'Results', group: 'Results', format: 'int', better: 'up' },
  { id: 'cost_per_result', label: 'Cost per result', short: 'Cost / result', group: 'Results', format: 'money', better: 'down' },
  { id: 'post_engagement', label: 'Post engagements', short: 'Post eng.', group: 'Engagement', format: 'int', better: 'up' },
  { id: 'cost_per_post_engagement', label: 'Cost per post engagement', short: 'Cost / eng.', group: 'Engagement', format: 'money', better: 'down' },
  { id: 'page_engagement', label: 'Page engagements', short: 'Page eng.', group: 'Engagement', format: 'int', better: 'up' },
  { id: 'post_reactions', label: 'Post reactions', short: 'Reactions', group: 'Engagement', format: 'int', better: 'up' },
  { id: 'post_comments', label: 'Post comments', short: 'Comments', group: 'Engagement', format: 'int', better: 'up' },
  { id: 'post_shares', label: 'Post shares', short: 'Shares', group: 'Engagement', format: 'int', better: 'up' },
  { id: 'post_saves', label: 'Post saves', short: 'Saves', group: 'Engagement', format: 'int', better: 'up' },
  { id: 'page_likes', label: 'Page likes', short: 'Page likes', group: 'Engagement', format: 'int', better: 'up' },
  { id: 'video_plays', label: 'Video plays', short: 'Plays', group: 'Video', format: 'int', better: 'up' },
  { id: 'video_3s', label: '3-second video plays', short: '3-s plays', group: 'Video', format: 'int', better: 'up' },
  { id: 'thruplays', label: 'ThruPlays', short: 'ThruPlays', group: 'Video', format: 'int', better: 'up' },
  { id: 'cost_per_thruplay', label: 'Cost per ThruPlay', short: 'Cost / ThruPlay', group: 'Video', format: 'money', better: 'down' },
  { id: 'video_p25', label: 'Video plays at 25%', short: '25%', group: 'Video', format: 'int', better: 'up' },
  { id: 'video_p50', label: 'Video plays at 50%', short: '50%', group: 'Video', format: 'int', better: 'up' },
  { id: 'video_p75', label: 'Video plays at 75%', short: '75%', group: 'Video', format: 'int', better: 'up' },
  { id: 'video_p95', label: 'Video plays at 95%', short: '95%', group: 'Video', format: 'int', better: 'up' },
  { id: 'video_p100', label: 'Video plays at 100%', short: '100%', group: 'Video', format: 'int', better: 'up' },
  { id: 'video_avg_time', label: 'Average video play time', short: 'Avg. play', group: 'Video', format: 'secs', better: 'up' },
  { id: 'messaging_conversations', label: 'Messaging conversations started', short: 'Conversations', group: 'Messaging', format: 'int', better: 'up' },
  { id: 'cost_per_messaging_conversation', label: 'Cost per messaging conversation', short: 'Cost / conv.', group: 'Messaging', format: 'money', better: 'down' },
  { id: 'messaging_first_reply', label: 'New messaging contacts', short: 'New contacts', group: 'Messaging', format: 'int', better: 'up' },
  { id: 'cost_per_new_messaging_contact', label: 'Cost per new messaging contact', short: 'Cost / new contact', group: 'Messaging', format: 'money', better: 'down' },
  { id: 'messaging_connections', label: 'Messaging contacts', short: 'Msg. contacts', group: 'Messaging', format: 'int', better: 'up' },
  { id: 'leads', label: 'Leads', short: 'Leads', group: 'Leads', format: 'int', better: 'up' },
  { id: 'cost_per_lead', label: 'Cost per lead', short: 'Cost / lead', group: 'Leads', format: 'money', better: 'down' },
  { id: 'onmeta_leads', label: 'On-Facebook leads', short: 'On-FB leads', group: 'Leads', format: 'int', better: 'up' },
  { id: 'website_leads', label: 'Website leads (pixel)', short: 'Web leads', group: 'Leads', format: 'int', better: 'up' },
];

export const COLUMN_PRESETS: Record<AdsColumnPreset, string[]> = {
  performance: ['spend', 'impressions', 'clicks', 'ctr', 'results', 'cost_per_result'],
  delivery: ['reach', 'frequency', 'impressions', 'cpm', 'cpp', 'spend'],
  engagement: ['post_engagement', 'cost_per_post_engagement', 'page_engagement', 'post_reactions', 'post_comments', 'post_shares', 'link_clicks', 'link_ctr'],
  video: ['spend', 'impressions', 'video_plays', 'video_3s', 'thruplays', 'cost_per_thruplay', 'video_p25', 'video_p50', 'video_p75', 'video_p100', 'video_avg_time'],
  messaging: ['spend', 'messaging_conversations', 'cost_per_messaging_conversation', 'messaging_first_reply', 'cost_per_new_messaging_contact', 'messaging_connections', 'link_clicks'],
  leads: ['spend', 'leads', 'cost_per_lead', 'onmeta_leads', 'website_leads', 'link_clicks', 'link_ctr'],
  cost_per_result: ['results', 'cost_per_result', 'cost_per_messaging_conversation', 'cost_per_lead', 'cost_per_link_click', 'cpc', 'cpm', 'cost_per_thruplay', 'cpp'],
};

export const PRESET_LABELS: Record<AdsColumnPreset | 'custom', string> = {
  performance: 'Performance',
  delivery: 'Delivery',
  engagement: 'Engagement',
  video: 'Video',
  messaging: 'Messaging',
  leads: 'Leads',
  cost_per_result: 'Cost per result',
  custom: 'Custom',
};

const BY_ID = new Map(REPORT_COLUMNS.map((c) => [c.id, c]));
export const colDef = (id: string): ReportColumnDef => BY_ID.get(id) || { id, label: id, short: id, group: '', format: 'int', better: 'neutral' };
export const fmtCol = (id: string, v: number | null | undefined, currency: string) => fmtValue(colDef(id).format, v, currency);
const MAX_COLUMNS = 40;

// ------------------------------------------------- saved column choice --

export interface ColumnPrefs {
  preset: AdsColumnPreset | 'custom';
  custom: string[];
}
const PREFS_EVENT = 'crm-ads-columns';
const prefsKey = (storeKey: string) => `crm_ads_columns:${storeKey || 'default'}`;
function loadPrefs(storeKey: string): ColumnPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(prefsKey(storeKey)) || 'null');
    const custom = Array.isArray(raw?.custom) ? raw.custom.filter((x: unknown) => typeof x === 'string' && BY_ID.has(x)).slice(0, MAX_COLUMNS) : [];
    const known = typeof raw?.preset === 'string' && Object.prototype.hasOwnProperty.call(COLUMN_PRESETS, raw.preset);
    const preset = raw?.preset === 'custom' ? (custom.length ? 'custom' : 'performance') : known ? raw.preset : 'performance';
    return { preset, custom };
  } catch {
    return { preset: 'performance', custom: [] };
  }
}

/** The business's column choice (shared by the Campaigns tables and Reports). */
export function useColumnPrefs(storeKey: string) {
  const [prefs, setPrefs] = useState<ColumnPrefs>(() => loadPrefs(storeKey));
  useEffect(() => {
    setPrefs(loadPrefs(storeKey));
    const onLocal = (e: Event) => {
      if ((e as CustomEvent<string>).detail === storeKey) setPrefs(loadPrefs(storeKey));
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === prefsKey(storeKey)) setPrefs(loadPrefs(storeKey));
    };
    window.addEventListener(PREFS_EVENT, onLocal);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(PREFS_EVENT, onLocal);
      window.removeEventListener('storage', onStorage);
    };
  }, [storeKey]);
  const save = (p: ColumnPrefs) => {
    try {
      localStorage.setItem(prefsKey(storeKey), JSON.stringify(p));
    } catch {
      /* private mode: kept for this page only */
    }
    setPrefs(p);
    window.dispatchEvent(new CustomEvent(PREFS_EVENT, { detail: storeKey }));
  };
  const columns = prefs.preset === 'custom' ? prefs.custom : COLUMN_PRESETS[prefs.preset];
  return { prefs, columns, save };
}

/** Preset menu + "Customise…" (the column dialog). */
export function ColumnPicker({ prefs, onSave, testid }: { prefs: ColumnPrefs; onSave: (p: ColumnPrefs) => void; testid: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="ads-rp-colpick">
      <label>
        <span className="material-icons" aria-hidden="true">view_column</span>
        <select
          value={prefs.preset}
          onChange={(e) => {
            const v = e.target.value as ColumnPrefs['preset'];
            if (v === 'custom' && !prefs.custom.length) setOpen(true);
            else onSave({ ...prefs, preset: v });
          }}
          aria-label="Columns"
          data-testid={`${testid}-preset`}
        >
          {(Object.keys(PRESET_LABELS) as ColumnPrefs['preset'][]).map((k) => (
            <option key={k} value={k}>
              {`Columns: ${PRESET_LABELS[k]}${k === 'custom' && !prefs.custom.length ? '…' : ''}`}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className="ads-btn sm" onClick={() => setOpen(true)} data-testid={`${testid}-customise`}>
        Customise…
      </button>
      {open && (
        <ColumnDialog
          initial={prefs.preset === 'custom' ? prefs.custom : COLUMN_PRESETS[prefs.preset]}
          onClose={() => setOpen(false)}
          onSave={(ids) => {
            onSave({ preset: 'custom', custom: ids });
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

function ColumnDialog({ initial, onClose, onSave }: { initial: string[]; onClose: () => void; onSave: (ids: string[]) => void }) {
  const [sel, setSel] = useState<string[]>(initial);
  const dirty = sel.join() !== initial.join();
  const groups = useMemo(() => [...new Set(REPORT_COLUMNS.map((c) => c.group))], []);
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= MAX_COLUMNS ? s : [...s, id]));
  const move = (id: string, by: number) =>
    setSel((s) => {
      const i = s.indexOf(id);
      const j = i + by;
      if (i < 0 || j < 0 || j >= s.length) return s;
      const n = [...s];
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
  return (
    <ManageDialog
      title="Customise columns"
      testid="ads-coldlg"
      dirty={dirty}
      onClose={onClose}
      wide
      footer={(
        <>
          <span className="ads-rp-muted">{sel.length} of {MAX_COLUMNS} columns · saved in this browser for this business</span>
          <button type="button" className="ads-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="ads-btn primary" disabled={!sel.length} onClick={() => onSave(sel)} data-testid="ads-coldlg-save">
            Apply columns
          </button>
        </>
      )}
    >
      <div className="ads-rp-coldlg">
        <div className="ads-rp-colgroups">
          <label className="ads-rp-from">
            Start from
            <select
              value=""
              onChange={(e) => {
                if (e.target.value) setSel([...COLUMN_PRESETS[e.target.value as AdsColumnPreset]]);
              }}
              data-testid="ads-coldlg-from"
            >
              <option value="">a preset…</option>
              {(Object.keys(COLUMN_PRESETS) as AdsColumnPreset[]).map((k) => (
                <option key={k} value={k}>{PRESET_LABELS[k]}</option>
              ))}
            </select>
          </label>
          {groups.map((g) => (
            <fieldset key={g}>
              <legend>{g}</legend>
              {REPORT_COLUMNS.filter((c) => c.group === g).map((c) => (
                <label key={c.id} className="ads-rp-check">
                  <input type="checkbox" checked={sel.includes(c.id)} onChange={() => toggle(c.id)} data-testid={`ads-coldlg-${c.id}`} />
                  {c.label}
                </label>
              ))}
            </fieldset>
          ))}
        </div>
        <div className="ads-rp-colorder">
          <h5>Shown, in this order</h5>
          {!sel.length && <p className="ads-rp-muted">Pick at least one column.</p>}
          <ol data-testid="ads-coldlg-order">
            {sel.map((id, i) => (
              <li key={id}>
                <span>{colDef(id).label}</span>
                <button type="button" className="icon-btn" disabled={i === 0} onClick={() => move(id, -1)} aria-label={`Move ${colDef(id).label} up`} data-testid={`ads-coldlg-up-${id}`}>
                  <span className="material-icons">arrow_upward</span>
                </button>
                <button type="button" className="icon-btn" disabled={i === sel.length - 1} onClick={() => move(id, 1)} aria-label={`Move ${colDef(id).label} down`}>
                  <span className="material-icons">arrow_downward</span>
                </button>
                <button type="button" className="icon-btn" onClick={() => toggle(id)} aria-label={`Remove ${colDef(id).label}`}>
                  <span className="material-icons">close</span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </ManageDialog>
  );
}

// -------------------------------------------------------- data loading --

/**
 * Loads a report; a large one comes back as an async run at Meta, which is
 * polled until it carries the report. `q = null` loads nothing.
 */
export function useAdsReport(api: CrmApi, q: AdsReportQuery | null, range: AdsRange, onRevoked: () => void, refreshNonce = 0) {
  const key = q ? JSON.stringify([q, range]) : '';
  const [state, setState] = useState<{ key: string; report: AdsReport | null; run: AdsReportRun | null; error: unknown; busyNote: string }>({
    key: '', report: null, run: null, error: null, busyNote: '',
  });
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [stopped, setStopped] = useState(false);
  const refreshNext = useRef(false);
  const lastRefresh = useRef(refreshNonce);
  const cancelRef = useRef<() => void>(() => {});
  const qRef = useRef(q);
  qRef.current = q;
  useEffect(() => {
    const query = qRef.current;
    if (!query) {
      setLoading(false);
      return undefined;
    }
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    cancelRef.current = () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
    const refresh = refreshNext.current || lastRefresh.current !== refreshNonce;
    lastRefresh.current = refreshNonce;
    refreshNext.current = false;
    setLoading(true);
    setStopped(false);
    setState((s) => ({ key, report: s.key === key ? s.report : null, run: null, error: null, busyNote: '' }));
    const fail = (e: unknown) => {
      if (!live) return;
      setState({ key, report: null, run: null, error: e, busyNote: '' });
      setLoading(false);
      if (errCode(e) === 'ADS_REVOKED') onRevoked();
    };
    const poll = (runId: string, delay: number) => {
      timer = setTimeout(async () => {
        if (!live) return;
        try {
          const r = await api.getAdsReportRun(runId);
          if (!live) return;
          if (r.report) {
            setState({ key, report: r.report, run: r.run || null, error: null, busyNote: '' });
            setLoading(false);
          } else {
            setState((s) => ({ ...s, run: r.run || s.run, busyNote: '' }));
            poll(runId, 2000);
          }
        } catch (e) {
          if (!live) return;
          // Meta is throttling: keep the run, ask again a bit later.
          if (errCode(e) === 'RATE_LIMITED') {
            setState((s) => ({ ...s, busyNote: 'Meta is busy; still waiting for the report…' }));
            poll(runId, 8000);
            return;
          }
          fail(e);
        }
      }, delay);
    };
    api
      .getAdsReport(query, range, refresh)
      .then((r) => {
        if (!live) return;
        if (r.report) {
          setState({ key, report: r.report, run: null, error: null, busyNote: '' });
          setLoading(false);
        } else if (r.run) {
          setState({ key, report: null, run: r.run, error: null, busyNote: '' });
          poll(r.run.id, 1200);
        } else fail(new Error('The report could not be read.'));
      })
      .catch(fail);
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce, refreshNonce]);
  const mine = state.key === key;
  return {
    report: mine ? state.report : null,
    run: mine && !stopped ? state.run : null,
    error: mine ? state.error : null,
    busyNote: mine ? state.busyNote : '',
    loading: mine ? loading && !stopped : !!q,
    stopped: mine && stopped,
    /** Stop polling (the run at Meta just expires); reload() asks again. */
    stop: () => {
      cancelRef.current();
      setStopped(true);
      setLoading(false);
    },
    reload: (refresh = false) => {
      refreshNext.current = refresh;
      setStopped(false);
      setNonce((n) => n + 1);
    },
  };
}

/** Change from the previous period as a coloured chip (green = better, red = worse). */
export function DeltaChip({ delta, better, testid }: { delta?: AdsDelta; better: 'up' | 'down' | 'neutral'; testid?: string }) {
  if (!delta) return null;
  if (delta.pct === null) {
    return (
      <span className="ads-rp-delta gray" data-testid={testid} title="No delivery in the previous period">
        {delta.abs ? 'new' : '—'}
      </span>
    );
  }
  const dir = delta.pct > 0 ? 'up' : delta.pct < 0 ? 'down' : 'flat';
  const tone = dir === 'flat' || better === 'neutral' ? 'gray' : dir === better ? 'green' : 'red';
  return (
    <span className={`ads-rp-delta ${tone}`} data-testid={testid} title="Change from the previous period">
      {dir === 'up' ? '▲' : dir === 'down' ? '▼' : '■'} {Math.abs(delta.pct).toFixed(1)}%
    </span>
  );
}

// ---------------------------------------------------------- reports tab --

const LEVEL_OPTIONS: [AdsReportLevel, string][] = [
  ['account', 'Total'],
  ['campaign', 'By campaign'],
  ['adset', 'By ad set'],
  ['ad', 'By ad'],
];
const BREAKDOWN_GROUPS: [string, [AdsReportBreakdown, string][]][] = [
  ['', [['none', 'No breakdown']]],
  ['By time', [['day', 'Day'], ['week', 'Week'], ['month', 'Month']]],
  ['By delivery', [['age', 'Age'], ['gender', 'Gender'], ['age_gender', 'Age and gender'], ['country', 'Country'], ['region', 'Region'], ['placement', 'Placement'], ['device', 'Impression device'], ['hourly', 'Hour of day']]],
];
const RUN_REASON: Record<string, string> = {
  large: 'This report is large, so Meta prepares it in the background.',
  requested: 'Meta prepares this report in the background.',
  too_much_data: 'Meta asked for this report to be prepared in the background (too much data for a quick answer).',
  device_async_only: 'Meta only gives results by device in a background report for this account.',
};
const TABLE_LIMIT = 200;

async function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Ads → Reports. */
export function AdsReports({
  api, range, currency, storeKey, onRevoked, refreshNonce,
}: {
  api: CrmApi;
  range: AdsRange;
  currency: string;
  /** Per business: where the column choice is kept. */
  storeKey: string;
  onRevoked: () => void;
  refreshNonce: number;
}) {
  const notify = useNotify();
  const cols = useColumnPrefs(storeKey);
  const [level, setLevel] = useState<AdsReportLevel>('account');
  const [breakdown, setBreakdown] = useState<AdsReportBreakdown>('day');
  const [compare, setCompare] = useState(false);
  const [parentId, setParentId] = useState('');
  const [campaigns, setCampaigns] = useState<AdCampaignRow[]>([]);
  const [m1, setM1] = useState('');
  const [m2, setM2] = useState('');
  const [sort, setSort] = useState<{ id: string; dir: 'asc' | 'desc' } | null>(null);
  const [downloading, setDownloading] = useState(false);
  useEffect(() => {
    let live = true;
    api
      .getAdCampaigns(range)
      .then((r) => live && setCampaigns(r.campaigns || []))
      .catch(() => live && setCampaigns([]));
    return () => {
      live = false;
    };
  }, [api, range]);
  const query: AdsReportQuery = useMemo(
    () => ({ level, breakdown, columns: cols.columns, parentId: parentId || undefined, compare }),
    [level, breakdown, cols.columns, parentId, compare],
  );
  const data = useAdsReport(api, query, range, onRevoked, refreshNonce);
  const report = data.report;
  const cur = report?.currency || currency;
  const colIds = report?.columns.map((c) => c.id) || [];
  const metric1 = colIds.includes(m1) ? m1 : colIds[0] || '';
  const metric2 = m2 && colIds.includes(m2) && m2 !== metric1 ? m2 : '';
  useEffect(() => setSort(null), [level, breakdown, parentId]);

  async function csv() {
    setDownloading(true);
    try {
      const { blob, filename } = await api.downloadAdsReportCsv(query, range);
      await saveBlob(blob, filename);
    } catch (e) {
      notify('error', errCode(e) === 'REPORT_PENDING' ? 'Still preparing' : 'CSV not downloaded', errText(e));
    } finally {
      setDownloading(false);
    }
  }

  const rows = useMemo(() => {
    const list = report?.rows || [];
    if (!sort) return list;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => ((a.values[sort.id] ?? -Infinity) - (b.values[sort.id] ?? -Infinity)) * dir || a.key.localeCompare(b.key));
  }, [report, sort]);

  return (
    <section className="ads-card ads-rp" data-testid="ads-reports">
      <div className="ads-rp-toolbar" data-testid="ads-rp-toolbar">
        <label>
          <span>Level</span>
          <select value={level} onChange={(e) => setLevel(e.target.value as AdsReportLevel)} data-testid="ads-rp-level">
            {LEVEL_OPTIONS.map(([k, l]) => (
              <option key={k} value={k}>{l}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Campaign</span>
          <select value={parentId} onChange={(e) => setParentId(e.target.value)} data-testid="ads-rp-scope">
            <option value="">All campaigns</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>{c.name || c.id}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Breakdown</span>
          <select value={breakdown} onChange={(e) => setBreakdown(e.target.value as AdsReportBreakdown)} data-testid="ads-rp-breakdown">
            {BREAKDOWN_GROUPS.map(([g, opts]) => (g ? (
              <optgroup key={g} label={g}>
                {opts.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </optgroup>
            ) : opts.map(([k, l]) => <option key={k} value={k}>{l}</option>)))}
          </select>
        </label>
        <label className="ads-rp-toggle">
          <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} data-testid="ads-rp-compare" />
          <span>Compare with the previous period</span>
        </label>
        <ColumnPicker prefs={cols.prefs} onSave={cols.save} testid="ads-rp-cols" />
        <button type="button" className="ads-btn" onClick={csv} disabled={downloading || !report} data-testid="ads-rp-csv" title="Download this report as a CSV file">
          <span className="material-icons" aria-hidden="true">download</span>
          {downloading ? 'Preparing…' : 'Export CSV'}
        </button>
      </div>

      {report && (
        <p className="ads-rp-range" data-testid="ads-rp-range">
          {report.range.since} – {report.range.until}
          {report.compare ? <> compared with <strong>{report.compare.since} – {report.compare.until}</strong></> : null}
          {' · '}
          {report.timezone || 'account time zone'}
          {report.source === 'async' && <span className="ads-chip" data-testid="ads-rp-source">Prepared at Meta</span>}
        </p>
      )}

      {data.run && !report && (
        <div className="ads-rp-async" role="status" data-testid="ads-rp-async">
          <span className="material-icons" aria-hidden="true">hourglass_top</span>
          <div className="grow">
            <strong>Preparing the report at Meta… {data.run.percent}%</strong>
            <small>{RUN_REASON[data.run.reason] || RUN_REASON.large} You can keep using the CRM; it appears here when it’s ready.</small>
            {data.busyNote && <small data-testid="ads-rp-async-busy">{data.busyNote}</small>}
            <span className="ads-rp-progress"><i style={{ width: `${Math.max(4, data.run.percent)}%` }} /></span>
          </div>
          <button type="button" className="ads-btn sm" onClick={data.stop} data-testid="ads-rp-async-stop">Stop waiting</button>
        </div>
      )}
      {data.stopped && !report && (
        <div className="ads-empty-box" data-testid="ads-rp-stopped">
          Stopped waiting for the report.
          <button type="button" className="ads-btn" onClick={() => data.reload()}>Try again</button>
        </div>
      )}
      {data.loading && !data.run && !report && <BladeSpinner center={true} containerHeight={140} />}
      {data.error ? <AdsErrorState error={data.error} onRetry={() => data.reload(true)} /> : null}

      {report && (
        <>
          {(report.dropped.length > 0 || report.notes.length > 0) && (
            <div className="ads-rp-notes" data-testid="ads-rp-notes">
              {report.dropped.length > 0 && (
                <p data-testid="ads-rp-dropped">
                  <span className="material-icons" aria-hidden="true">info</span>
                  Not available with {report.breakdownLabel.toLowerCase()}: {report.dropped.map((d) => d.label).join(', ')}. {[...new Set(report.dropped.map((d) => d.reason))].join(' ')}
                </p>
              )}
              {report.notes.map((n) => <p key={n}>{n}</p>)}
            </div>
          )}
          <ReportChart report={report} rows={report.rows} m1={metric1} m2={metric2} currency={cur} setM1={setM1} setM2={setM2} />
          {!report.rows.length ? (
            <div className="ads-empty-box" data-testid="ads-rp-empty">No results for this report in {report.range.since} – {report.range.until}.</div>
          ) : report.level === 'account' && report.kind === 'none' ? null : (
            <ReportTable report={report} rows={rows} currency={cur} sort={sort} setSort={setSort} />
          )}
        </>
      )}
    </section>
  );
}

function MetricSelect({ value, onChange, ids, testid, label, allowNone }: { value: string; onChange: (v: string) => void; ids: string[]; testid: string; label: string; allowNone?: boolean }) {
  return (
    <label className="ads-rp-metric">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} data-testid={testid}>
        {allowNone && <option value="">None</option>}
        {ids.map((id) => <option key={id} value={id}>{colDef(id).label}</option>)}
      </select>
    </label>
  );
}

function ReportChart({ report, rows, m1, m2, currency, setM1, setM2 }: {
  report: AdsReport;
  rows: AdsReportRow[];
  m1: string;
  m2: string;
  currency: string;
  setM1: (v: string) => void;
  setM2: (v: string) => void;
}) {
  const ids = report.columns.map((c) => c.id);
  if (!m1 || !rows.length) return null;
  const metric = { label: colDef(m1).label, format: colDef(m1).format };
  const compare = !!report.compare;
  let chart: ReactNode = null;
  let note = '';
  const total = report.level === 'account';
  if (report.kind === 'time') {
    if (total) {
      chart = (
        <TrendChart
          testid="ads-rp-trend"
          points={rows.map((r) => ({ label: r.date?.label || r.label, a: r.values[m1], b: m2 ? r.values[m2] : undefined, prevA: compare ? r.previous?.[m1] ?? null : undefined, prevLabel: r.previousDate?.label }))}
          a={metric}
          b={m2 ? { label: colDef(m2).label, format: colDef(m2).format } : null}
          currency={currency}
        />
      );
    } else note = 'The chart over time shows the total: pick “Total” as the level to chart it. The table lists each item.';
  } else if (report.kind === 'dim') {
    if (!total) note = 'Charts of a breakdown show the total: pick “Total” as the level to chart it. The table lists each item.';
    else if (report.breakdown === 'age_gender') {
      const ages = [...new Set(rows.map((r) => r.dims[0]?.label || ''))];
      const genders = [...new Set(rows.map((r) => r.dims[1]?.value || ''))];
      const label = (g: string) => rows.find((r) => r.dims[1]?.value === g)?.dims[1]?.label || g;
      chart = (
        <StackedBarChart
          testid="ads-rp-stack"
          groups={ages.map((a) => ({ label: a, parts: genders.map((g) => ({ key: g, value: rows.find((r) => r.dims[0]?.label === a && r.dims[1]?.value === g)?.values[m1] ?? null })) }))}
          series={genders.map((g) => ({ key: g, label: label(g) }))}
          metric={metric}
          currency={currency}
        />
      );
      if (compare) note = 'The stacked chart shows this period; the table has the comparison.';
    } else {
      const list = report.breakdown === 'hourly' ? rows : [...rows].sort((a, b) => (b.values[m1] ?? 0) - (a.values[m1] ?? 0)).slice(0, 15);
      chart = (
        <BarChart
          testid="ads-rp-bars"
          vertical={report.breakdown === 'hourly'}
          compare={compare}
          rows={list.map((r) => ({ label: r.label, value: r.values[m1], prev: r.previous?.[m1] ?? null }))}
          metric={metric}
          currency={currency}
        />
      );
    }
  } else if (!total) {
    const list = [...rows].sort((a, b) => (b.values[m1] ?? 0) - (a.values[m1] ?? 0)).slice(0, 15);
    chart = <BarChart testid="ads-rp-bars" compare={compare} rows={list.map((r) => ({ label: r.label, value: r.values[m1], prev: r.previous?.[m1] ?? null }))} metric={metric} currency={currency} />;
  } else {
    // The plain total: tiles with the change from the previous period.
    const r = rows[0];
    chart = (
      <div className="ads-stats ads-rp-tiles" data-testid="ads-rp-tiles">
        {report.columns.map((c) => (
          <div key={c.id} className="ads-stat">
            <span>{c.label}</span>
            <strong>{fmtValue(c.format, r.values[c.id], currency)}</strong>
            {compare && <DeltaChip delta={r.delta?.[c.id]} better={c.better} testid={`ads-rp-tile-delta-${c.id}`} />}
          </div>
        ))}
      </div>
    );
  }
  const showPickers = report.kind !== 'none' || !total;
  return (
    <div className="ads-rp-chartwrap">
      {showPickers && (
        <div className="ads-rp-chartbar">
          <MetricSelect value={m1} onChange={setM1} ids={ids} testid="ads-rp-m1" label="Chart" />
          {report.kind === 'time' && total && <MetricSelect value={m2} onChange={setM2} ids={ids.filter((x) => x !== m1)} testid="ads-rp-m2" label="and" allowNone />}
        </div>
      )}
      {chart}
      {note && <p className="ads-rp-muted" data-testid="ads-rp-chartnote">{note}</p>}
    </div>
  );
}

function ReportTable({ report, rows, currency, sort, setSort }: {
  report: AdsReport;
  rows: AdsReportRow[];
  currency: string;
  sort: { id: string; dir: 'asc' | 'desc' } | null;
  setSort: (s: { id: string; dir: 'asc' | 'desc' } | null) => void;
}) {
  const compare = !!report.compare;
  const shown = rows.slice(0, TABLE_LIMIT);
  const labelCols = report.headers;
  return (
    <div className="ads-table-wrap">
      <table className="ads-table ads-rp-table" data-testid="ads-rp-table">
        <thead>
          <tr>
            {labelCols.map((h) => <th key={h.key}>{h.label}</th>)}
            {report.columns.map((c) => {
              const on = sort?.id === c.id;
              return (
                <th key={c.id} className="num" aria-sort={on ? (sort?.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                  <button
                    type="button"
                    className={`ads-mg-sort${on ? ' on' : ''}`}
                    title={c.label}
                    onClick={() => setSort({ id: c.id, dir: on && sort?.dir === 'desc' ? 'asc' : 'desc' })}
                    data-testid={`ads-rp-sort-${c.id}`}
                  >
                    {colDef(c.id).short}
                    <span className="material-icons" aria-hidden="true">{on ? (sort?.dir === 'asc' ? 'arrow_upward' : 'arrow_downward') : 'unfold_more'}</span>
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {shown.map((r, i) => (
            <tr key={r.key} data-testid={`ads-rp-row-${i}`}>
              {labelCols.map((h) => {
                if (h.key === 'object') {
                  return (
                    <td key={h.key} className="name">
                      <strong>{r.object?.name || r.object?.id || '—'}</strong>
                      {r.object?.id && <small className="ads-sub">{r.object.id}</small>}
                    </td>
                  );
                }
                if (h.key === 'date') return <td key={h.key}>{r.date?.label || '—'}</td>;
                return <td key={h.key}>{r.dims.find((d) => d.key === h.key)?.label || '—'}</td>;
              })}
              {report.columns.map((c) => (
                <td key={c.id} className="num">
                  {fmtValue(c.format, r.values[c.id], currency)}
                  {compare && (
                    <small className="ads-rp-prev">
                      <DeltaChip delta={r.delta?.[c.id]} better={c.better} testid={`ads-rp-delta-${i}-${c.id}`} />
                    </small>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr data-testid="ads-rp-total">
            {labelCols.length > 0 && <th colSpan={labelCols.length}>Total</th>}
            {report.columns.map((c) => (
              <td key={c.id} className="num">
                <strong>{fmtValue(c.format, report.totals.values[c.id], currency)}</strong>
                {compare && (
                  <small className="ads-rp-prev">
                    {fmtValue(c.format, report.totals.previous?.[c.id] ?? null, currency)}{' '}
                    <DeltaChip delta={report.totals.delta?.[c.id]} better={c.better} testid={`ads-rp-total-delta-${c.id}`} />
                  </small>
                )}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
      {rows.length > TABLE_LIMIT && (
        <p className="ads-rp-muted" data-testid="ads-rp-limited">Showing {TABLE_LIMIT} of {rows.length} rows. Export the CSV for all of them.</p>
      )}
    </div>
  );
}

// ------------------------------------- Campaigns tables: column helpers --

export interface ColSort {
  id: string;
  dir: 'asc' | 'desc';
}

/** A sortable header for a report column in the Campaigns tables. */
export function ColSortTh({ id, sort, onSort }: { id: string; sort: ColSort | null; onSort: (s: ColSort) => void }) {
  const on = sort?.id === id;
  const c = colDef(id);
  return (
    <th className="num" aria-sort={on ? (sort?.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        className={`ads-mg-sort${on ? ' on' : ''}`}
        title={`Sort by ${c.label.toLowerCase()}`}
        onClick={() => onSort({ id, dir: on && sort?.dir === 'desc' ? 'asc' : 'desc' })}
        data-testid={`ads-colsort-${id}`}
      >
        {c.short}
        <span className="material-icons" aria-hidden="true">{on ? (sort?.dir === 'asc' ? 'arrow_upward' : 'arrow_downward') : 'unfold_more'}</span>
      </button>
    </th>
  );
}

/** Rows sorted by a report column (no value sorts last). */
export function sortByColumn<T extends { id: string }>(rows: T[], sort: ColSort, values: Map<string, Record<string, number | null>>): T[] {
  const dir = sort.dir === 'asc' ? 1 : -1;
  const v = (r: T) => values.get(r.id)?.[sort.id];
  return [...rows].sort((a, b) => {
    const va = v(a);
    const vb = v(b);
    if (va === null || va === undefined) return vb === null || vb === undefined ? a.id.localeCompare(b.id) : 1;
    if (vb === null || vb === undefined) return -1;
    return (va - vb) * dir || a.id.localeCompare(b.id);
  });
}

// ------------------------------------------------------ account health --

/** Overview: the ad account's billing and status (GET /meta/reports/health). */
export function HealthCard({ api, onRevoked, refreshNonce }: { api: CrmApi; onRevoked: () => void; refreshNonce: number }) {
  const [health, setHealth] = useState<AdsAccountHealth | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [n, setN] = useState(0);
  const lastRefresh = useRef(refreshNonce);
  useEffect(() => {
    let live = true;
    const refresh = lastRefresh.current !== refreshNonce || n > 0;
    lastRefresh.current = refreshNonce;
    setError(null);
    api
      .getAdsHealth(refresh)
      .then((r) => live && setHealth(r.health || null))
      .catch((e) => {
        if (!live) return;
        setError(e);
        if (errCode(e) === 'ADS_REVOKED') onRevoked();
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, refreshNonce, n]);
  if (error) {
    return (
      <section className="ads-card ads-health" data-testid="ads-health">
        <h4>Account health</h4>
        <AdsErrorState error={error} onRetry={() => setN((x) => x + 1)} />
      </section>
    );
  }
  if (!health) return null;
  const cur = health.account.currency;
  const money = (v: number | null) => fmtValue('money', v, cur);
  const tone = health.accountStatus === 1 ? 'green' : [2, 3, 8, 100, 101].includes(health.accountStatus) ? 'red' : 'amber';
  const used = health.spendCapUsedPct;
  return (
    <section className="ads-card ads-health" data-testid="ads-health">
      <div className="ads-card-head">
        <h4>Account health</h4>
        <div className="ads-health-head">
          <span className={`ads-pill ${tone}`} data-testid="ads-health-status">
            {health.accountStatusLabel}
            {health.disableReasonLabel ? ` · ${health.disableReasonLabel}` : ''}
          </span>
          <a className="ads-btn sm" href={health.billingUrl} target="_blank" rel="noreferrer noopener" data-testid="ads-health-billing">
            <span className="material-icons" aria-hidden="true">open_in_new</span>
            Meta billing
          </a>
        </div>
      </div>
      {health.warnings.length > 0 && (
        <ul className="ads-health-warns">
          {health.warnings.map((w) => (
            <li key={w.code} className={`ads-health-warn ${w.tone}`} data-testid={w.code === 'NO_PAYMENT_METHOD' ? 'ads-health-no-payment' : `ads-health-warn-${w.code}`} role={w.tone === 'red' ? 'alert' : undefined}>
              <span className="material-icons" aria-hidden="true">{w.code === 'NO_PAYMENT_METHOD' ? 'credit_card_off' : w.tone === 'gray' ? 'info' : 'warning'}</span>
              <span>
                {w.text}
                {['NO_PAYMENT_METHOD', 'PAYMENT_DUE', 'IN_GRACE_PERIOD', 'SPEND_CAP_REACHED', 'SPEND_CAP_NEAR', 'PAYMENT_METHOD_UNKNOWN'].includes(w.code) && (
                  <>
                    {' '}
                    <a href={health.billingUrl} target="_blank" rel="noreferrer noopener">Open Meta billing</a>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="ads-health-grid">
        <div data-testid="ads-health-spent">
          <span>Amount spent</span>
          <strong>{money(health.amountSpent)}</strong>
          <small>{health.spendCap !== null ? 'against the spending limit' : 'all time'}</small>
        </div>
        <div data-testid="ads-health-cap">
          <span>Account spending limit</span>
          <strong>{health.spendCap !== null ? money(health.spendCap) : 'No limit'}</strong>
          {used !== null && (
            <>
              <span className={`ads-health-bar${used >= 90 ? ' hot' : ''}`} aria-label={`${used}% used`}><i style={{ width: `${Math.min(100, used)}%` }} /></span>
              <small>{used}% used · {money(health.spendCapRemaining)} left</small>
            </>
          )}
        </div>
        <div data-testid="ads-health-balance">
          <span>Balance due</span>
          <strong>{money(health.balance)}</strong>
        </div>
        <div data-testid="ads-health-dsl">
          <span>Daily spending limit</span>
          <strong>{health.dailySpendLimit !== null ? money(health.dailySpendLimit) : 'Not reported'}</strong>
        </div>
        <div data-testid="ads-health-payment">
          <span>Payment method</span>
          <strong>
            {health.paymentMethod.hasPaymentMethod === null ? 'Not shared with the CRM' : health.paymentMethod.hasPaymentMethod ? health.paymentMethod.display || 'On file' : 'None'}
          </strong>
          {health.paymentMethod.type && <small>{health.paymentMethod.type}</small>}
        </div>
      </div>
    </section>
  );
}
