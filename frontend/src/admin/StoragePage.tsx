// Super-admin → Storage: the space the platform uses (backend services/storageStats.js).
//   Supabase  the database (size against the plan's limit, largest tables)
//             and Supabase Storage buckets, if any.
//   Bunny     the storage zone with every uploaded file (space, file count),
//             bandwidth this month and the account balance.
import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { platformApi, type StorageStats } from './platformApi';
import { Skel } from './charts';
import { RefreshIcon } from './AdminIcons';

const TZ = 'Asia/Kolkata';
const whole = new Intl.NumberFormat('en-IN');
const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: TZ });

/** 1536 → "1.5 KB", 5368709120 → "5 GB". */
export function bytes(n: number): string {
  if (!n || n < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / 1024 ** i;
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, '')} ${units[i]}`;
}
const usd = (v: number | null) => (v === null || v === undefined ? '—' : `$${Number(v).toFixed(2)}`);

/** A used / limit figure with a bar (no bar when there's no limit). */
function Usage({ title, used, limit, note, testId, children }: { title: string; used: number; limit?: number; note: ReactNode; testId: string; children?: ReactNode }) {
  const pct = limit ? Math.max(0, Math.min(100, (used / limit) * 100)) : 0;
  const tone = pct >= 90 ? ' danger' : pct >= 75 ? ' warn' : '';
  return (
    <section className="pd-box st-box" data-testid={testId}>
      <header className="pd-box-head">
        <h2>{title}</h2>
        {limit ? <span className={`pa-badge ${pct >= 90 ? 'num-red' : pct >= 75 ? 'num-amber' : 'num-green'}`}>{Math.round(pct)}% used</span> : null}
      </header>
      <div className="pd-box-body">
        <p className="tp-value">
          <strong data-testid={`${testId}-used`}>{bytes(used)}</strong>
          {limit ? <span> / {bytes(limit)}</span> : null}
        </p>
        {limit ? (
          <div className={`tp-bar st-bar${tone}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label={`${title}: ${Math.round(pct)}% used`}>
            <span style={{ width: `${pct}%` } as CSSProperties} />
          </div>
        ) : null}
        <p className="tp-note">{note}</p>
        {children}
      </div>
    </section>
  );
}

function StorageSkeleton() {
  return (
    <div className="pd-dash" aria-busy="true" aria-label="Loading the storage figures">
      <div className="tp-reqs">
        {[0, 1, 2].map((i) => (
          <section className="pd-box" key={i}>
            <header className="pd-box-head"><Skel w={160} h={14} /><Skel w={60} h={18} r={9} /></header>
            <div className="pd-box-body">
              <Skel w={120} h={28} />
              <Skel h={8} r={4} className="tp-skel-bar" />
              <Skel w="80%" h={12} />
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

export function StoragePage() {
  const [data, setData] = useState<StorageStats | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback((refresh = false) => {
    setBusy(true);
    setError('');
    platformApi
      .storageStats(refresh)
      .then((r) => setData(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load the storage figures.'))
      .finally(() => setBusy(false));
  }, []);
  useEffect(() => load(false), [load]);

  const head = (
    <header className="pa-page-head">
      <div>
        <h1>Storage</h1>
        <p className="pa-page-sub">
          Space used on Supabase and Bunny
          {data && <> · updated {when(data.generatedAt)}</>}
        </p>
      </div>
      <div className="pa-head-actions">
        <button type="button" className="pa-btn ghost sm" onClick={() => load(true)} disabled={busy} data-testid="st-refresh">
          <RefreshIcon />
          {busy ? 'Checking…' : 'Check again'}
        </button>
      </div>
    </header>
  );

  if (!data) {
    return (
      <div className="pa-page">
        {head}
        {error ? (
          <div className="pd-error" role="alert">
            <strong>Couldn’t load the storage figures</strong>
            <span>{error}</span>
            <button type="button" className="pa-btn sm" onClick={() => load(false)}>Try again</button>
          </div>
        ) : (
          <StorageSkeleton />
        )}
      </div>
    );
  }

  const s = data.supabase;
  const b = data.bunny;
  return (
    <div className="pa-page" data-testid="storage-page">
      {head}
      {error && <div className="pa-error" role="alert">{error}</div>}
      <div className="pd-dash">
        <div className="tp-reqs">
          <Usage
            title="Supabase database"
            used={s.database.bytes}
            limit={s.database.limitBytes}
            testId="st-db"
            note={s.error || 'Every business, chat, message, order and setting. The bar is against the plan’s database limit.'}
          />
          <Usage
            title="Supabase Storage"
            used={s.storage.bytes}
            limit={s.storage.available ? s.storage.limitBytes : undefined}
            testId="st-sbs"
            note={s.storage.available
              ? `${whole.format(s.storage.files)} file${s.storage.files === 1 ? '' : 's'} in ${s.storage.buckets.length} bucket${s.storage.buckets.length === 1 ? '' : 's'}. Uploaded media is kept on Bunny, not here.`
              : 'Supabase Storage isn’t used: uploaded media is kept on Bunny.'}
          />
          <Usage
            title="Bunny storage"
            used={b.bytes}
            testId="st-bunny"
            note={b.error || `${whole.format(b.files)} file${b.files === 1 ? '' : 's'} in the “${b.zone}” zone${b.region ? ` (${b.region})` : ''}. Bunny bills by the GB used, with no fixed limit.`}
          >
            {!b.error && (
              <div className="st-facts">
                <div><span>Bandwidth this month</span><strong data-testid="st-bunny-bw">{bytes(b.bandwidthBytes)}</strong></div>
                <div><span>Charges this month</span><strong>{usd(b.monthCharges)}</strong></div>
                <div><span>Account balance</span><strong data-testid="st-bunny-balance">{usd(b.balance)}</strong></div>
              </div>
            )}
          </Usage>
        </div>

        <div className="st-tables">
          <section className="pd-box">
            <header className="pd-box-head"><h2>Largest database tables</h2></header>
            <div className="pd-table-wrap">
              <table className="pd-table" data-testid="st-tables">
                <thead><tr><th>Table</th><th className="num">Rows (about)</th><th className="num">Size</th></tr></thead>
                <tbody>
                  {s.database.tables.length ? s.database.tables.map((t) => (
                    <tr key={t.name}><td><strong>{t.name}</strong></td><td className="num">{whole.format(t.rows)}</td><td className="num">{bytes(t.bytes)}</td></tr>
                  )) : <tr><td colSpan={3} className="pd-muted">No tables read.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
          <section className="pd-box">
            <header className="pd-box-head"><h2>Where files are kept</h2></header>
            <div className="pd-table-wrap">
              <table className="pd-table" data-testid="st-places">
                <thead><tr><th>Place</th><th className="num">Files</th><th className="num">Size</th></tr></thead>
                <tbody>
                  <tr><td><strong>Bunny · {b.zone || '—'}</strong></td><td className="num">{whole.format(b.files)}</td><td className="num">{bytes(b.bytes)}</td></tr>
                  {s.storage.buckets.map((x) => (
                    <tr key={x.name}><td><strong>Supabase · {x.name}</strong></td><td className="num">{whole.format(x.files)}</td><td className="num">{bytes(x.bytes)}</td></tr>
                  ))}
                  {b.pullZones.map((p) => (
                    <tr key={`pz-${p.name}`}><td>CDN · {p.name} <span className="pd-muted">(bandwidth this month)</span></td><td className="num">—</td><td className="num">{bytes(p.bandwidthBytes)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
