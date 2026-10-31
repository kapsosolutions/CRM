// Ads → Overview → "Performance overview", like Meta Ads Manager's: three
// metric cards (choose them with Customise), a line chart of the selected
// card by day / week / month, and the ad account's activity history as
// markers on the chart ("Historical edits").
//
// Live: while the page is visible the numbers are read again from Meta every
// minute (refresh=1, so the server cache is skipped), the activity history
// every five minutes. Meta itself updates insights with a delay of up to
// about 15 minutes, which the "Live" note says. A rate limit from Meta pauses
// the live updates for five minutes.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CrmApi } from '../api';
import type { AdsActivityCategory, AdsActivityEvent, AdsRange, AdsReport, AdsReportQuery } from '../types';
import { BladeSpinner } from './BladeSpinner';
import { CHART_COLORS, TrendChart, type TrendMarker, type TrendPoint } from './AdsCharts';
import { REPORT_COLUMNS, colDef, fmtCol, useAdsReport } from './AdsReports';
import { ManageDialog } from './AdsManageDialogs';
import { AdsErrorState, errCode } from './MetaAdsDashboard';
import './AdsManager.css';

export type PerfGranularity = 'day' | 'week' | 'month';
const GRANULARITY: [PerfGranularity, string][] = [['day', 'Day'], ['week', 'Week'], ['month', 'Month']];
const ACTIVITY: [AdsActivityCategory | 'all' | 'off', string][] = [
  ['all', 'All'], ['budget', 'Budget and bids'], ['status', 'Status'], ['targeting', 'Targeting'], ['schedule', 'Schedule'],
  ['creative', 'Ads and creative'], ['created', 'Created'], ['billing', 'Billing'], ['off', 'Off'],
];
export const PERF_DEFAULT = ['messaging_conversations', 'cost_per_messaging_conversation', 'spend'];
const PERF_MAX = 3;
export const LIVE_MS = 60 * 1000;
const ACTIVITY_EVERY = 5; // live ticks
const RATE_PAUSE_MS = 5 * 60 * 1000;

/** Short explanations for the (i) on a card. */
const HINT: Record<string, string> = {
  messaging_conversations: 'The number of times people started a conversation with your business after seeing your ad (Meta counts within 7 days of the click).',
  cost_per_messaging_conversation: 'The amount spent divided by the messaging conversations started.',
  spend: 'The total amount spent on your ads in this period.',
  results: 'Messaging conversations plus leads, or link clicks when there are neither.',
  cost_per_result: 'The amount spent divided by the results.',
  leads: 'Leads from instant forms and the website pixel.',
  cost_per_lead: 'The amount spent divided by the leads.',
  impressions: 'How many times your ads were on screen.',
  reach: 'How many people saw your ads at least once.',
  link_clicks: 'Clicks on links in your ads that lead to a destination.',
};

const storeKeyOf = (k: string) => `crm_ads_perf:${k || 'default'}`;
function loadPrefs(k: string): { metrics: string[]; gran: PerfGranularity; activity: AdsActivityCategory | 'all' | 'off'; selected: number } {
  const known = new Set(REPORT_COLUMNS.map((c) => c.id));
  try {
    const p = JSON.parse(localStorage.getItem(storeKeyOf(k)) || '{}');
    const metrics = Array.isArray(p.metrics) ? p.metrics.filter((m: unknown) => typeof m === 'string' && known.has(m)).slice(0, PERF_MAX) : [];
    return {
      metrics: metrics.length ? metrics : PERF_DEFAULT,
      gran: GRANULARITY.some(([g]) => g === p.gran) ? p.gran : 'day',
      activity: ACTIVITY.some(([a]) => a === p.activity) ? p.activity : 'all',
      selected: Number.isInteger(p.selected) && p.selected >= 0 && p.selected < PERF_MAX ? p.selected : 0,
    };
  } catch {
    return { metrics: PERF_DEFAULT, gran: 'day', activity: 'all', selected: 0 };
  }
}

const DAY = 86400000;
const addDays = (s: string, n: number) => new Date(Date.parse(`${s}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const dayLabel = (s: string) => {
  try {
    return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${s}T00:00:00Z`));
  } catch {
    return s;
  }
};
const monthLabel = (s: string) => {
  try {
    return new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${s.slice(0, 7)}-01T00:00:00Z`));
  } catch {
    return s.slice(0, 7);
  }
};

/** A missing day is 0 for counts and amounts, and a gap for costs and rates. */
const zeroWhenMissing = (id: string) => colDef(id).format === 'int' || id === 'spend';

/** The chart's points (every day in the range for "Day"), and which point each date falls in. */
export function perfPoints(report: AdsReport, metric: string, gran: PerfGranularity): { points: TrendPoint[]; indexOf: (date: string) => number } {
  const rows = report.rows.filter((r) => r.date);
  if (gran === 'day' && report.range.since && report.range.until && report.range.since <= report.range.until) {
    const byDate = new Map(rows.map((r) => [r.date!.start, r]));
    const points: TrendPoint[] = [];
    const dates: string[] = [];
    for (let d = report.range.since, i = 0; d <= report.range.until && i < 400; d = addDays(d, 1), i += 1) {
      const r = byDate.get(d);
      const v = r ? r.values[metric] ?? null : zeroWhenMissing(metric) ? 0 : null;
      points.push({ label: dayLabel(d), a: v });
      dates.push(d);
    }
    return { points, indexOf: (date) => dates.indexOf(date) };
  }
  const sorted = [...rows].sort((a, b) => a.date!.start.localeCompare(b.date!.start));
  const points = sorted.map((r) => ({
    label: gran === 'month' ? monthLabel(r.date!.start) : `${dayLabel(r.date!.start)} – ${dayLabel(r.date!.stop)}`,
    a: r.values[metric] ?? null,
  }));
  return {
    points,
    indexOf: (date) => sorted.findIndex((r) => date >= r.date!.start && date <= r.date!.stop),
  };
}

/** Activity events → one marker per point, listing what changed. */
export function perfMarkers(events: AdsActivityEvent[], indexOf: (date: string) => number): TrendMarker[] {
  const by = new Map<number, string[]>();
  for (const e of events) {
    const i = indexOf(e.date);
    if (i < 0) continue;
    const line = `${e.label}${e.objectName ? ` · ${e.objectName}` : ''}`;
    by.set(i, [...(by.get(i) || []), line]);
  }
  return [...by.entries()].map(([index, lines]) => ({ index, lines }));
}

export function PerformanceOverview({
  api, range, currency, onRevoked, refreshNonce, storeKey,
}: {
  api: CrmApi;
  range: AdsRange;
  currency: string;
  onRevoked: () => void;
  refreshNonce: number;
  storeKey: string;
}) {
  const [prefs, setPrefs] = useState(() => loadPrefs(storeKey));
  useEffect(() => {
    try {
      localStorage.setItem(storeKeyOf(storeKey), JSON.stringify(prefs));
    } catch {
      /* private mode */
    }
  }, [prefs, storeKey]);
  const { metrics, gran, activity } = prefs;
  const selected = Math.min(prefs.selected, metrics.length - 1);
  const [customise, setCustomise] = useState(false);

  // ---- live updates
  const [tick, setTick] = useState(0);
  const pausedUntil = useRef(0);
  const lastTickAt = useRef(Date.now());
  useEffect(() => {
    // Browser tests shorten the interval (window.__crmAdsLiveMs); users get LIVE_MS.
    const every = Math.max(200, Number((window as unknown as { __crmAdsLiveMs?: number }).__crmAdsLiveMs) || LIVE_MS);
    const beat = () => {
      if (document.visibilityState !== 'visible' || Date.now() < pausedUntil.current) return;
      if (Date.now() - lastTickAt.current < every - 100) return;
      lastTickAt.current = Date.now();
      setTick((t) => t + 1);
    };
    const id = window.setInterval(beat, Math.min(every, 15000));
    const onVisible = () => beat();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const q: AdsReportQuery = useMemo(() => ({ level: 'account', breakdown: gran, columns: metrics }), [gran, metrics]);
  // A changed nonce makes the hook skip the server cache: the header's refresh button, or a live tick.
  const rep = useAdsReport(api, q, range, onRevoked, refreshNonce * 100000 + tick);
  useEffect(() => {
    if (errCode(rep.error) === 'RATE_LIMITED') pausedUntil.current = Date.now() + RATE_PAUSE_MS;
  }, [rep.error]);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  useEffect(() => {
    if (rep.report) setUpdatedAt(new Date());
  }, [rep.report]);

  // ---- activity history
  const activityTick = Math.floor(tick / ACTIVITY_EVERY);
  const [events, setEvents] = useState<{ key: string; list: AdsActivityEvent[]; error: string }>({ key: '', list: [], error: '' });
  const actKey = JSON.stringify([range, activity]);
  const lastAct = useRef({ nonce: refreshNonce, tick: activityTick });
  useEffect(() => {
    if (activity === 'off') return undefined;
    let live = true;
    const refresh = lastAct.current.nonce !== refreshNonce || lastAct.current.tick !== activityTick;
    lastAct.current = { nonce: refreshNonce, tick: activityTick };
    api
      .getAdsActivity(range, activity, refresh)
      .then((r) => live && setEvents({ key: actKey, list: r.events || [], error: '' }))
      .catch((e) => live && setEvents({ key: actKey, list: [], error: errCode(e) === 'RATE_LIMITED' ? 'Meta is busy; the activity history will load shortly.' : 'The activity history couldn’t be loaded.' }));
    return () => {
      live = false;
    };
  }, [api, actKey, refreshNonce, activityTick]); // eslint-disable-line react-hooks/exhaustive-deps

  const report = rep.report;
  const cur = report?.currency || currency;
  const metric = metrics[selected] || metrics[0];
  const series = useMemo(() => (report ? perfPoints(report, metric, gran) : null), [report, metric, gran]);
  const markers = useMemo(
    () => (series && activity !== 'off' && events.key === actKey ? perfMarkers(events.list, series.indexOf) : []),
    [series, events, activity, actKey],
  );
  const empty = !!report && report.rows.length === 0;

  return (
    <section className="ads-card ads-perf" data-testid="ads-perf">
      <div className="ads-perf-head">
        <h3>Performance overview</h3>
        <span className="ads-perf-live" data-testid="ads-perf-live" title="Read again from Meta every minute while this page is open. Meta’s own numbers can lag by up to about 15 minutes.">
          <i aria-hidden="true" className={rep.loading && report ? 'busy' : ''} />
          Live{updatedAt ? ` · updated ${updatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
        </span>
        <span className="grow" />
        <select className="ads-perf-select" value={gran} onChange={(e) => setPrefs((p) => ({ ...p, gran: e.target.value as PerfGranularity }))} aria-label="Group by" data-testid="ads-perf-gran">
          {GRANULARITY.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select className="ads-perf-select" value={activity} onChange={(e) => setPrefs((p) => ({ ...p, activity: e.target.value as typeof p.activity }))} aria-label="Activity history" data-testid="ads-perf-activity">
          {ACTIVITY.map(([k, l]) => <option key={k} value={k}>{`Activity history: ${l}`}</option>)}
        </select>
        <button type="button" className="ads-btn" onClick={() => setCustomise(true)} data-testid="ads-perf-customise">
          <span className="material-icons" aria-hidden="true">tune</span> Customise
        </button>
      </div>

      {rep.error && !report ? <AdsErrorState error={rep.error} onRetry={() => rep.reload(true)} /> : null}
      {!report && !rep.error && <BladeSpinner center={true} containerHeight={160} />}
      {report && (
        <>
          <div className="ads-perf-cards" role="tablist" aria-label="Metric shown in the chart" data-testid="ads-perf-cards">
            {metrics.map((id, i) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={i === selected}
                className={`ads-perf-card${i === selected ? ' on' : ''}`}
                onClick={() => setPrefs((p) => ({ ...p, selected: i }))}
                data-testid={`ads-perf-card-${id}`}
              >
                <span className="ads-perf-label">
                  {perfLabel(id)}
                  <span className="material-icons" aria-label={HINT[id] || colDef(id).label} title={HINT[id] || colDef(id).label}>info</span>
                </span>
                <strong data-testid={`ads-perf-value-${id}`}>{fmtCol(id, report.totals.values[id], cur)}</strong>
              </button>
            ))}
          </div>
          <h4 className="ads-perf-chart-title" data-testid="ads-perf-chart-title">{perfLabel(metric)}</h4>
          {empty ? (
            <p className="ads-wz-hint" data-testid="ads-perf-empty">No ad delivery in this period. The chart fills in once your ads run.</p>
          ) : null}
          {series && series.points.length > 0 && (
            <TrendChart
              testid="ads-perf-chart"
              points={series.points}
              a={{ label: perfLabel(metric), format: colDef(metric).format }}
              currency={cur}
              height={240}
              dots
              markers={markers}
              ariaLabel={`${perfLabel(metric)} by ${gran}`}
            />
          )}
          <div className="ads-perf-legend">
            <span><i style={{ background: CHART_COLORS[0] }} />{perfLabel(metric)}</span>
            {activity !== 'off' && (
              <span data-testid="ads-perf-history-legend">
                <span className="material-icons" aria-hidden="true">history</span>
                Historical edits{events.key === actKey && !events.error ? ` (${events.list.length})` : ''}
              </span>
            )}
            {events.error && activity !== 'off' ? <span className="muted">{events.error}</span> : null}
          </div>
        </>
      )}

      {customise && (
        <CustomiseDialog
          value={metrics}
          onClose={() => setCustomise(false)}
          onSave={(m) => {
            setPrefs((p) => ({ ...p, metrics: m, selected: 0 }));
            setCustomise(false);
          }}
        />
      )}
    </section>
  );
}

/** Meta's wording for the cards ("Per messaging conversation started" etc.). */
function perfLabel(id: string): string {
  if (id === 'cost_per_messaging_conversation') return 'Cost per messaging conversation started';
  return colDef(id).label;
}

function CustomiseDialog({ value, onSave, onClose }: { value: string[]; onSave: (m: string[]) => void; onClose: () => void }) {
  const [pick, setPick] = useState<string[]>(value);
  const groups = useMemo(() => {
    const g = new Map<string, typeof REPORT_COLUMNS>();
    for (const c of REPORT_COLUMNS) g.set(c.group, [...(g.get(c.group) || []), c]);
    return [...g.entries()];
  }, []);
  const full = pick.length >= PERF_MAX;
  return (
    <ManageDialog
      title="Customise performance overview"
      testid="ads-perf-customise-dialog"
      onClose={onClose}
      dirty={JSON.stringify(pick) !== JSON.stringify(value)}
      footer={(
        <>
          <button type="button" className="ads-btn" onClick={() => setPick(PERF_DEFAULT)}>Reset</button>
          <span className="grow" />
          <button type="button" className="ads-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="ads-btn primary" disabled={!pick.length} onClick={() => onSave(pick)} data-testid="ads-perf-customise-save">Apply</button>
        </>
      )}
    >
      <p className="ads-wz-hint">Choose up to {PERF_MAX} metrics for the cards. The first one is shown in the chart; click a card to chart another.</p>
      <p className="ads-perf-picked" data-testid="ads-perf-picked">{pick.length ? pick.map(perfLabel).join(' · ') : 'Nothing chosen yet.'}</p>
      <div className="ads-perf-groups">
        {groups.map(([group, cols]) => (
          <fieldset key={group}>
            <legend>{group}</legend>
            {cols.map((c) => {
              const on = pick.includes(c.id);
              return (
                <label key={c.id} className={!on && full ? 'off' : ''}>
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={!on && full}
                    onChange={(e) => setPick((p) => (e.target.checked ? [...p, c.id].slice(0, PERF_MAX) : p.filter((x) => x !== c.id)))}
                    data-testid={`ads-perf-pick-${c.id}`}
                  />
                  {perfLabel(c.id)}
                </label>
              );
            })}
          </fieldset>
        ))}
      </div>
    </ManageDialog>
  );
}
