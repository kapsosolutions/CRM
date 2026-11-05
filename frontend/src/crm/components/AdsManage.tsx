// Ads Manager S2: the tools around the Campaigns tab's tables (Ads →
// Campaigns): status filters, search, sortable columns, row selection with
// bulk pause / resume / duplicate / archive, per-row actions (edit, duplicate,
// preview, archive, delete) and Meta's review state on every row.
//
// The server (services/metaAdsManage.js) checks every id against the
// connected ad account, never sends a status with an edit, and creates every
// duplicate PAUSED. Resume and archive (bulk), archive and delete (one row)
// are asked here first; the server refuses them without { confirm: true }.
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppIcon } from './AppIcons';
import type { CrmApi } from '../api';
import type { AdCampaignRow, AdRow, AdSetRow, AdsBulkAction, AdsBulkJob, AdsLevel, AdsProblemAd, AdsReviewInfo, AdsReviewReport } from '../types';
import { useConfirm, useNotify } from './Dialogs';
import { newRequestId } from './MetaAdsDashboard';
import './AdsManager.css';

const BULK_POLL_MS = 1500;
/** A failed poll is retried with backoff (3 s, 6 s, 12 s, 15 s, 15 s, 15 s) before the CRM gives up following the job. */
const BULK_POLL_RETRIES = 6;
const BULK_BACKOFF_MAX_MS = 15000;
const BULK_LOST_TITLE = 'Still running at Meta (or finished)';
const BULK_LOST_TEXT = 'Still running at Meta (or finished); refresh to see the result.';
type HttpErr = Error & { status?: number; data?: { code?: string } | null };
const httpStatus = (e: unknown) => Number((e as HttpErr)?.status || 0);
const httpCode = (e: unknown) => String((e as HttpErr)?.data?.code || '');
/** Network errors, timeouts, rate limits and 5xx: worth polling again. */
const transientPollError = (e: unknown) => {
  const s = httpStatus(e);
  return !s || s === 408 || s === 429 || s >= 500;
};
/** The CRM lost track of a bulk job that the server had accepted. */
class BulkLostError extends Error {
  reason: unknown;

  constructor(reason: unknown) {
    super(BULK_LOST_TEXT);
    this.reason = reason;
  }
}

export type ManageRow = AdCampaignRow | AdSetRow | AdRow;
export type ManageFilter = 'all' | 'active' | 'paused' | 'archived' | 'issues';
export type SortKey = 'name' | 'status' | 'spend' | 'impressions' | 'clicks' | 'ctr' | 'results' | 'costPerResult';
export interface SortState {
  key: SortKey;
  dir: 'asc' | 'desc';
}

export const FILTERS: [ManageFilter, string][] = [
  ['all', 'All'],
  ['active', 'Active'],
  ['paused', 'Paused'],
  ['archived', 'Archived'],
  ['issues', 'Needs attention'],
];
const PROBLEM = /DISAPPROVED|WITH_ISSUES|PENDING_BILLING_INFO/;
export const READ_ONLY_TIP = 'Read-only: reconnect and allow managing ads (ads_management) to change this.';
const levelWord = (l: AdsLevel, plural = false) => (l === 'adset' ? `ad set${plural ? 's' : ''}` : `${l}${plural ? 's' : ''}`);

const statusOf = (r: ManageRow) => String(r.status || '').toUpperCase();
const effOf = (r: ManageRow) => String(r.effectiveStatus || r.status || '').toUpperCase();

export function matchesFilter(r: ManageRow, f: ManageFilter, review: Map<string, AdsReviewInfo>): boolean {
  const st = statusOf(r);
  const eff = effOf(r);
  if (f === 'archived') return st === 'ARCHIVED' || eff === 'ARCHIVED';
  if (st === 'ARCHIVED' || st === 'DELETED') return false;
  if (f === 'active') return st === 'ACTIVE' && !/PAUSED/.test(eff);
  if (f === 'paused') return st === 'PAUSED' || /PAUSED/.test(eff);
  if (f === 'issues') return !!review.get(r.id)?.needsAttention || PROBLEM.test(eff);
  return true;
}

export const matchesSearch = (r: ManageRow, q: string) => {
  const s = q.trim().toLowerCase();
  return !s || String(r.name || '').toLowerCase().includes(s) || r.id.includes(s);
};

function sortValue(r: ManageRow, k: SortKey): string | number {
  if (k === 'name') return String(r.name || r.id).toLowerCase();
  if (k === 'status') return effOf(r);
  if (k === 'costPerResult') return r.metrics.costPerResult ?? Number.POSITIVE_INFINITY;
  return Number(r.metrics[k]) || 0;
}

export function sortRows<T extends ManageRow>(rows: T[], s: SortState): T[] {
  const dir = s.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = sortValue(a, s.key);
    const vb = sortValue(b, s.key);
    const c = typeof va === 'string' && typeof vb === 'string' ? va.localeCompare(vb) : Number(va) - Number(vb);
    return c * dir || a.id.localeCompare(b.id);
  });
}

/** A sortable column header. */
export function SortTh({ k, label, sort, onSort, num }: { k: SortKey; label: string; sort: SortState; onSort: (s: SortState) => void; num?: boolean }) {
  const on = sort.key === k;
  return (
    <th className={num ? 'num' : undefined} aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        className={`ads-mg-sort${on ? ' on' : ''}`}
        onClick={() => onSort({ key: k, dir: on ? (sort.dir === 'asc' ? 'desc' : 'asc') : k === 'name' || k === 'status' ? 'asc' : 'desc' })}
        data-testid={`ads-sort-${k}`}
        title={`Sort by ${label.toLowerCase()}`}
      >
        {label}
        <span className="material-icons" aria-hidden="true">{on ? (sort.dir === 'asc' ? 'arrow_upward' : 'arrow_downward') : 'unfold_more'}</span>
      </button>
    </th>
  );
}

/** Review state for the rows of one table (GET /meta/manage/review); loading it also notifies new rejections. */
export function useManageReview(api: CrmApi, level: AdsLevel, parentId: string, loadKey: string, refreshNonce: number) {
  const [report, setReport] = useState<AdsReviewReport | null>(null);
  const [n, setN] = useState(0);
  const refreshNext = useRef(false);
  const lastNonce = useRef(refreshNonce);
  useEffect(() => {
    if (level !== 'campaign' && !parentId) return undefined;
    let live = true;
    const refresh = refreshNext.current || lastNonce.current !== refreshNonce;
    refreshNext.current = false;
    lastNonce.current = refreshNonce;
    api
      .getAdsReview(level, parentId, refresh)
      .then((r) => live && setReport(r))
      .catch(() => live && setReport(null)); // the table works without it
    return () => {
      live = false;
    };
  }, [api, level, parentId, loadKey, refreshNonce, n]);
  const current = report && report.level === level && report.parentId === (level === 'campaign' ? '' : parentId) ? report : null;
  const map = useMemo(() => new Map((current?.items || []).map((i) => [i.id, i])), [current]);
  return {
    report: current,
    map,
    reload: (refresh = true) => {
      refreshNext.current = refresh;
      setN((x) => x + 1);
    },
  };
}

/** Archived rows (Meta's default lists leave them out), loaded when the Archived filter is on. */
export function useArchivedRows(api: CrmApi, level: AdsLevel, parentId: string, enabled: boolean, n: number) {
  const [rows, setRows] = useState<{ key: string; rows: ManageRow[] } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const key = `${level}|${parentId}`;
  useEffect(() => {
    if (!enabled || (level !== 'campaign' && !parentId)) return undefined;
    let live = true;
    setError(null);
    api
      .getAdsArchived(level, parentId, n > 0)
      .then((r) => live && setRows({ key, rows: r.rows }))
      .catch((e) => live && setError(e));
    return () => {
      live = false;
    };
  }, [api, level, parentId, enabled, n, key]);
  return { rows: rows && rows.key === key ? rows.rows : null, error };
}

/** Meta's review state under the status pill: issues, rejection reasons, children that need attention. */
export function ReviewNote({ info, level }: { info: AdsReviewInfo | undefined; level: AdsLevel }) {
  if (!info || (!info.needsAttention && !info.reviewFeedback.length)) return null;
  const lines: string[] = [];
  if (info.effectiveStatus === 'DISAPPROVED') lines.push('Rejected by Meta');
  if (info.effectiveStatus === 'PENDING_BILLING_INFO') lines.push('Waiting for a payment method');
  for (const r of info.reviewFeedback) lines.push(r);
  for (const i of info.issues) lines.push(i.summary || i.message);
  if (level !== 'ad' && info.adProblems) {
    lines.push(info.rejectedAds ? `${info.rejectedAds} ad${info.rejectedAds === 1 ? '' : 's'} rejected` : `${info.adProblems} ad${info.adProblems === 1 ? '' : 's'} need${info.adProblems === 1 ? 's' : ''} attention`);
  }
  if (!lines.length) return null;
  return (
    <div className="ads-mg-review" title={lines.join('\n')} data-testid={`ads-review-${info.id}`}>
      <span className="material-icons" aria-hidden="true">report</span>
      <span>
        {lines.slice(0, 2).map((l, i) => (
          <span key={i} className="line">{l}</span>
        ))}
        {lines.length > 2 && <span className="line more">+{lines.length - 2} more</span>}
      </span>
    </div>
  );
}

/** Filters, search, and the count shown. */
export function ManageToolbar({
  filter, setFilter, search, setSearch, shown, total, issues,
}: {
  filter: ManageFilter;
  setFilter: (f: ManageFilter) => void;
  search: string;
  setSearch: (s: string) => void;
  shown: number;
  total: number;
  issues: number;
}) {
  return (
    <div className="ads-mg-toolbar" data-testid="ads-mg-toolbar">
      <div className="ads-range small ads-mg-filters" role="tablist" aria-label="Filter by status">
        {FILTERS.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={filter === k} className={`ads-range-btn${filter === k ? ' on' : ''}`} onClick={() => setFilter(k)} data-testid={`ads-filter-${k}`}>
            {label}
            {k === 'issues' && issues > 0 && <span className="ads-mg-count" data-testid="ads-filter-issues-count">{issues}</span>}
          </button>
        ))}
      </div>
      <label className="ads-mg-search">
        <span className="material-icons" aria-hidden="true">search</span>
        <input type="search" value={search} placeholder="Search by name or id" onChange={(e) => setSearch(e.target.value)} aria-label="Search by name or id" data-testid="ads-search" />
      </label>
      <span className="ads-mg-shown" data-testid="ads-mg-shown">
        {shown === total ? `${total} shown` : `${shown} of ${total} shown`}
      </span>
    </div>
  );
}

/** The bar above the table while rows are selected. */
export function BulkBar({
  level, count, canManage, busy, progress, onAction, onClear, locked = '', onRefresh,
}: {
  level: AdsLevel;
  count: number;
  canManage: boolean;
  busy: string;
  progress?: { processed: number; total: number } | null;
  onAction: (a: AdsBulkAction) => void;
  onClear: () => void;
  /** Set after the CRM lost track of an accepted bulk job: the buttons stay off until onRefresh. */
  locked?: string;
  onRefresh?: () => void;
}) {
  if (!count && !locked) return null;
  const tip = !canManage ? READ_ONLY_TIP : locked || undefined;
  const btn = (a: AdsBulkAction, label: string, icon: string, tone = '') => (
    <button type="button" className={`ads-btn sm ${tone}`} disabled={!canManage || !!busy || !!locked} title={tip} onClick={() => onAction(a)} data-testid={`ads-bulk-${a}`}>
      <AppIcon name={icon} />
      {busy === a ? '…' : label}
    </button>
  );
  return (
    <div className="ads-mg-bulk" role="toolbar" aria-label="Selected rows" data-testid="ads-bulk-bar">
      <strong data-testid="ads-bulk-count">
        {count} {levelWord(level, count !== 1)} selected
      </strong>
      {btn('pause', 'Pause', 'pause')}
      {btn('resume', 'Resume', 'play_arrow')}
      {btn('duplicate', 'Duplicate', 'content_copy')}
      {btn('archive', 'Archive', 'inventory_2', 'danger')}
      {busy && progress && (
        <span className="ads-mg-shown" role="status" data-testid="ads-bulk-progress">
          {progress.processed} of {progress.total} done
        </span>
      )}
      {locked && (
        <span className="ads-mg-shown" role="status" data-testid="ads-bulk-locked">
          {locked}
          {onRefresh && (
            <button type="button" className="ads-btn sm primary" onClick={onRefresh} data-testid="ads-bulk-refresh">
              <span className="material-icons" aria-hidden="true">refresh</span> Refresh
            </button>
          )}
        </span>
      )}
      <button type="button" className="ads-btn sm" onClick={onClear} data-testid="ads-bulk-clear">
        Clear
      </button>
    </div>
  );
}

/** Edit, duplicate, preview (ads), archive, delete for one row. */
export function RowActions({
  level, row, canManage, busy, onEdit, onDuplicate, onPreview, onArchive, onDelete,
}: {
  level: AdsLevel;
  row: ManageRow;
  canManage: boolean;
  busy: string;
  onEdit: () => void;
  onDuplicate: () => void;
  onPreview: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const archived = statusOf(row) === 'ARCHIVED';
  const tip = (t: string) => (canManage ? t : READ_ONLY_TIP);
  const what = levelWord(level);
  const b = (key: string, icon: string, label: string, fn: () => void, opts: { disabled?: boolean; title?: string; tone?: string } = {}) => (
    <button
      type="button"
      className={`ads-mg-icon${opts.tone ? ` ${opts.tone}` : ''}`}
      onClick={fn}
      disabled={opts.disabled || !!busy}
      title={opts.title || label}
      aria-label={`${label}: ${row.name || row.id}`}
      data-testid={`ads-act-${key}-${row.id}`}
    >
      <AppIcon name={busy === `${key}:${row.id}` ? 'hourglass_top' : icon} />
    </button>
  );
  return (
    <span className="ads-mg-actions">
      {b('edit', 'edit', archived ? `Rename this ${what}` : `Edit this ${what}`, onEdit, { disabled: !canManage, title: tip(archived ? `Rename this ${what} (archived items can only be renamed)` : `Edit this ${what}`) })}
      {b('dup', 'content_copy', `Duplicate this ${what} (created paused)`, onDuplicate, { disabled: !canManage, title: tip(`Duplicate this ${what} (created paused)`) })}
      {level === 'ad' && b('preview', 'visibility', 'Preview this ad', onPreview)}
      {b('archive', 'inventory_2', `Archive this ${what}`, onArchive, { disabled: !canManage || archived, title: archived ? 'Already archived' : tip(`Archive this ${what}`) })}
      {b('delete', 'delete', `Delete this ${what}`, onDelete, { disabled: !canManage, title: tip(`Delete this ${what}`), tone: 'danger' })}
    </span>
  );
}

/** The ads that need attention (campaign level): rejection reasons and issues, with edit / preview. */
export function IssuesPanel({ ads, canManage, onEdit, onPreview }: { ads: AdsProblemAd[]; canManage: boolean; onEdit: (a: AdsProblemAd) => void; onPreview: (a: AdsProblemAd) => void }) {
  if (!ads.length) return null;
  return (
    <section className="ads-mg-issues" data-testid="ads-issues-panel" aria-label="Ads that need attention">
      <h5>
        <span className="material-icons" aria-hidden="true">gpp_maybe</span>
        {ads.length} ad{ads.length === 1 ? '' : 's'} need{ads.length === 1 ? 's' : ''} attention
      </h5>
      <ul>
        {ads.map((a) => (
          <li key={a.id} data-testid={`ads-issue-${a.id}`}>
            <div className="grow">
              <strong>{a.name || a.id}</strong>{' '}
              <span className={`ads-pill ${a.effectiveStatus === 'DISAPPROVED' || a.effectiveStatus === 'WITH_ISSUES' ? 'red' : 'amber'}`}>
                {a.effectiveStatus === 'DISAPPROVED' ? 'rejected' : a.effectiveStatus.replace(/_/g, ' ').toLowerCase()}
              </span>
              {[...a.reviewFeedback, ...a.issues.map((i) => i.summary || i.message)].map((t, i) => (
                <p key={i}>{t}</p>
              ))}
            </div>
            <button type="button" className="ads-btn sm" onClick={() => onPreview(a)} data-testid={`ads-issue-preview-${a.id}`}>
              Preview
            </button>
            <button type="button" className="ads-btn sm primary" onClick={() => onEdit(a)} disabled={!canManage} title={canManage ? 'Change the creative or text, then Meta reviews it again' : READ_ONLY_TIP} data-testid={`ads-issue-edit-${a.id}`}>
              Edit ad
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

type ErrorHandler = (e: unknown, title: string) => void;

/** Duplicate / archive / delete / bulk, each with its confirm and toast. */
export function useManageActions({
  api, level, describe, onChanged, onError, refreshNonce,
}: {
  api: CrmApi;
  level: AdsLevel;
  /** One line per row for the resume confirm: name, budget, dates. */
  describe: (r: ManageRow) => string;
  onChanged: () => void;
  onError: ErrorHandler;
  /** The page's Refresh: also unlocks bulk actions after a lost job. */
  refreshNonce?: number;
}) {
  const confirm = useConfirm();
  const notify = useNotify();
  const [busy, setBusy] = useState('');
  const [progress, setProgress] = useState<{ processed: number; total: number } | null>(null);
  const [lost, setLost] = useState<{ key: string; jobId: string; action: AdsBulkAction } | null>(null);
  const firstNonce = useRef(refreshNonce);
  useEffect(() => {
    if (refreshNonce !== firstNonce.current) setLost(null);
  }, [refreshNonce]);
  const what = levelWord(level);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true; // StrictMode mounts twice: set it again after the simulated unmount
    return () => {
      alive.current = false;
    };
  }, []);

  /** A copy Meta made that the CRM couldn't confirm paused, pause or delete: shown until dismissed. */
  const copyAlert = (lines: string[], message: string) => confirm({
    title: 'Check this copy at Meta now',
    message,
    points: lines,
    confirmLabel: 'I’ll check it',
    cancelLabel: 'Close',
    tone: 'danger',
  });

  /**
   * Poll a bulk job until it ends (the server runs it; a 504 from the proxy
   * can't lose it). Transient poll errors are retried with backoff; a lasting
   * failure or BULK_NOT_FOUND (e.g. after a server restart) throws
   * BulkLostError: the job was accepted, so something may have changed.
   */
  async function follow(job: AdsBulkJob): Promise<AdsBulkJob> {
    let j = job;
    let errors = 0;
    for (let i = 0; j.status === 'running' && i < 900 && alive.current; i += 1) {
      const wait = errors ? Math.min(BULK_POLL_MS * 2 ** errors, BULK_BACKOFF_MAX_MS) : BULK_POLL_MS;
      // eslint-disable-next-line no-await-in-loop
      await new Promise((res) => setTimeout(res, wait));
      if (!alive.current) break;
      try {
        // eslint-disable-next-line no-await-in-loop
        j = (await api.getAdsBulkJob(j.id)).job;
        errors = 0;
      } catch (e) {
        if (httpCode(e) === 'BULK_NOT_FOUND' || !transientPollError(e) || errors >= BULK_POLL_RETRIES) throw new BulkLostError(e);
        errors += 1;
        continue;
      }
      if (alive.current) setProgress({ processed: j.processed, total: j.total });
    }
    return j;
  }

  async function run<T>(key: string, fn: () => Promise<T>, ok: (r: T) => void, title: string) {
    setBusy(key);
    try {
      ok(await fn());
      onChanged();
    } catch (e) {
      onError(e, title);
    } finally {
      setBusy('');
    }
  }

  return {
    busy,
    duplicate: (r: ManageRow) =>
      run(`dup:${r.id}`, () => api.duplicateAdsObject(level, r.id), (res) => {
        if (res.copy.warning) void copyAlert([`${r.name || r.id} → copy ${res.copy.id}`], res.copy.warning.message);
        else notify('success', 'Duplicated (paused)', `“${res.copy.name || r.name}” was created paused. It doesn’t spend until you turn it on.`);
      }, 'Not duplicated'),
    archive: async (r: ManageRow) => {
      const ok = await confirm({
        title: `Archive this ${what}?`,
        message: `“${r.name || r.id}” stops delivering and moves to Archived at Meta. Archived items can’t be turned on again; you can still rename, duplicate or delete them.`,
        confirmLabel: 'Archive',
        tone: 'danger',
      });
      if (!ok) return;
      await run(`archive:${r.id}`, () => api.removeAdsObject(level, r.id, 'archive'), () => notify('success', 'Archived', `“${r.name}” is archived at Meta.`), 'Not archived');
    },
    remove: async (r: ManageRow) => {
      const ok = await confirm({
        title: `Delete this ${what}?`,
        message: `“${r.name || r.id}” is deleted at Meta${level === 'ad' ? '' : ', with everything in it'}. This can’t be undone. Its past results stay in Meta’s reports.`,
        confirmLabel: 'Delete',
        tone: 'danger',
      });
      if (!ok) return;
      await run(`delete:${r.id}`, () => api.removeAdsObject(level, r.id, 'delete'), () => notify('success', 'Deleted', `“${r.name}” was deleted at Meta.`), 'Not deleted');
    },
    bulk: async (action: AdsBulkAction, rows: ManageRow[], after: () => void) => {
      const n = rows.length;
      const plural = levelWord(level, n !== 1);
      let confirmed = false;
      if (action === 'resume') {
        const ok = await confirm({
          title: `Resume ${n} ${plural}?`,
          message: 'They start delivering again at Meta and spend from their budgets until you pause them or they end.',
          points: [...rows.slice(0, 8).map(describe), ...(n > 8 ? [`…and ${n - 8} more`] : [])],
          confirmLabel: `Resume ${n}`,
          tone: 'primary',
        });
        if (!ok) return;
        confirmed = true;
      }
      if (action === 'archive') {
        const ok = await confirm({
          title: `Archive ${n} ${plural}?`,
          message: 'They stop delivering and move to Archived at Meta. Archived items can’t be turned on again.',
          points: [...rows.slice(0, 8).map((r) => r.name || r.id), ...(n > 8 ? [`…and ${n - 8} more`] : [])],
          confirmLabel: `Archive ${n}`,
          tone: 'danger',
        });
        if (!ok) return;
        confirmed = true;
      }
      if (lost) {
        notify('error', BULK_LOST_TITLE, 'Refresh to see the result of the last bulk action before running another one.');
        return;
      }
      setBusy(action);
      setProgress({ processed: 0, total: n });
      // One key per click: if the request is retried, the server returns the same job.
      const key = newRequestId();
      let accepted = false;
      try {
        const started = await api.bulkAdsAction(action, level, rows.map((x) => x.id), confirmed, key);
        accepted = true;
        let r: AdsBulkJob;
        try {
          r = await follow(started.job);
        } catch (e) {
          if (!(e instanceof BulkLostError)) throw e;
          // The server accepted the job, so rows may have changed: never "Nothing changed".
          // The bulk buttons stay locked until the user refreshes, so a second click
          // (a new key) can't run it again, e.g. make a second set of copies.
          if (!alive.current) return;
          setLost({ key, jobId: started.job.id, action });
          notify('error', BULK_LOST_TITLE, 'Refresh to see the result. Bulk actions stay off until you refresh, so nothing runs twice.');
          if (['READ_ONLY', 'ADS_REVOKED'].includes(httpCode(e.reason))) onError(e.reason, '');
          return;
        }
        if (!alive.current) return;
        const verb = { pause: 'paused', resume: 'resumed', duplicate: 'duplicated (paused)', archive: 'archived' }[action];
        const firstFail = r.results.find((x) => !x.ok && x.code !== 'SKIPPED');
        if (r.status === 'running') {
          setLost({ key, jobId: started.job.id, action });
          notify('error', 'Still running at Meta', `${r.processed} of ${r.total} done so far. Refresh in a minute to see the rest.`);
        } else if (r.status === 'failed') {
          notify('error', `${r.done} of ${n} ${verb}`, [r.error?.message || 'The run stopped.', r.processed < r.total ? `${r.total - r.processed} weren’t tried.` : ''].filter(Boolean).join(' '));
        } else if (!r.failed) notify('success', `${r.done} ${levelWord(level, r.done !== 1)} ${verb}`, action === 'duplicate' ? 'The copies don’t spend until you turn them on.' : '');
        else {
          notify(
            'error',
            r.stopped === 'RATE_LIMITED' ? 'Meta is busy' : `${r.done} of ${n} ${verb}`,
            [r.stopped === 'RATE_LIMITED' ? `Meta stopped the run after ${r.done}. Try the rest again in a few minutes.` : '', firstFail?.message || ''].filter(Boolean).join(' '),
          );
        }
        const warned = r.results.filter((x) => x.warning);
        if (warned.length) {
          const name = (id: string) => rows.find((x) => x.id === id)?.name || id;
          void copyAlert(warned.map((x) => `${name(x.id)} → copy ${x.copyId}`), warned[0].warning?.message || '');
        }
        after();
        onChanged();
      } catch (e) {
        // Only an error before the server accepted the job means nothing ran.
        onError(e, accepted ? 'Bulk action' : 'Nothing changed');
      } finally {
        if (alive.current) {
          setBusy('');
          setProgress(null);
        }
      }
    },
    /** While a bulk job runs: how far it got. */
    progress,
    /** A bulk job the CRM lost track of: the bulk buttons stay off until the user refreshes. */
    bulkLocked: lost ? BULK_LOST_TEXT : '',
    /** The user refreshed: show the result and allow bulk actions again. */
    refreshAfterLost: () => {
      setLost(null);
      onChanged();
    },
  };
}
