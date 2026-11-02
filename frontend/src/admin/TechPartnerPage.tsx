// Meta Tech Partner: progress towards Meta's three upgrade requirements, from
// the CRM's own records (backend services/techPartner.js):
//   messages a day (7-day average) ≥ 2,500 · active clients ≥ 10 ·
//   phone number quality rating ≥ 90% High.
// Meta's App Dashboard (WhatsApp → Quickstart → Become a Partner) has the
// official figures; this page shows where the platform stands day to day.
import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { platformApi, type QualityRating, type TechPartnerCheck, type TechPartnerStats } from './platformApi';
import { BarChart, Skel, TipRow } from './charts';
import { RefreshIcon } from './AdminIcons';

const TZ = 'Asia/Kolkata';
const whole = new Intl.NumberFormat('en-IN');
const compact = new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 });
const axisCount = (n: number) => (n < 1000 ? whole.format(n) : compact.format(n));
const noon = (date: string) => new Date(`${date}T12:00:00+05:30`);
const dayShort = (date: string) => noon(date).toLocaleDateString('en-IN', { weekday: 'short', timeZone: TZ }).slice(0, 2);
const dayLong = (date: string) => noon(date).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ });
const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: TZ }) : '—';

const META_DOC = 'https://developers.facebook.com/docs/whatsapp/solution-providers/upgrade-to-tech-partner';

export const QUALITY_META: Record<QualityRating, { label: string; badge: string; color: string }> = {
  GREEN: { label: 'High', badge: 'num-green', color: '#15ca20' },
  YELLOW: { label: 'Medium', badge: 'num-amber', color: '#ffc107' },
  RED: { label: 'Low', badge: 'num-red', color: '#fd3550' },
  UNKNOWN: { label: 'Not rated yet', badge: 'num-grey', color: '#6c757d' },
};

function valueText(c: TechPartnerCheck): string {
  if (c.value === null) return '—';
  return c.key === 'quality' ? `${c.value}%` : whole.format(c.value);
}
function targetText(c: TechPartnerCheck): string {
  return c.key === 'quality' ? `${c.target}%` : whole.format(c.target);
}

/** One of Meta's three requirements, with a progress bar. */
function Requirement({ check, title, note, children }: { check: TechPartnerCheck; title: string; note: ReactNode; children?: ReactNode }) {
  const pct = check.value === null ? 0 : Math.max(0, Math.min(100, (check.value / check.target) * 100));
  return (
    <section className={`pd-box tp-req${check.met ? ' met' : ''}`} data-testid={`tp-${check.key}`}>
      <header className="pd-box-head">
        <h2>{title}</h2>
        <span className={`pa-badge ${check.met ? 'num-green' : 'num-amber'}`}>{check.met ? 'Met' : 'Not yet'}</span>
      </header>
      <div className="pd-box-body">
        <p className="tp-value">
          <strong data-testid={`tp-${check.key}-value`}>{valueText(check)}</strong>
          <span> / {targetText(check)}</span>
        </p>
        <div
          className="tp-bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pct)}
          aria-label={`${title}: ${Math.round(pct)}% of the requirement`}
        >
          <span style={{ width: `${pct}%` } as CSSProperties} />
        </div>
        <p className="tp-note">{note}</p>
        {children}
      </div>
    </section>
  );
}

function TechPartnerSkeleton() {
  return (
    <div className="pd-dash" aria-busy="true" aria-label="Loading the Tech Partner figures">
      <div className="tp-reqs">
        {[0, 1, 2].map((i) => (
          <section className="pd-box" key={i}>
            <header className="pd-box-head"><Skel w={160} h={14} /><Skel w={50} h={18} r={9} /></header>
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

export function TechPartnerPage({ onOpenBusiness }: { onOpenBusiness: (id: string) => void }) {
  const [data, setData] = useState<TechPartnerStats | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback((refresh = false) => {
    setBusy(true);
    setError('');
    platformApi
      .techPartnerStats(refresh)
      .then((r) => setData(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load the Tech Partner figures.'))
      .finally(() => setBusy(false));
  }, []);
  useEffect(() => load(false), [load]);

  const head = (
    <header className="pa-page-head">
      <div>
        <h1>Meta Tech Partner</h1>
        <p className="pa-page-sub">
          Progress towards Meta&apos;s Tech Partner requirements · India time
          {data && <> · updated {when(data.generatedAt)}</>}
        </p>
      </div>
      <div className="pa-head-actions">
        <button
          type="button"
          className="pa-btn ghost sm"
          onClick={() => load(true)}
          disabled={busy}
          title="Count again and ask Meta for each number's quality rating"
          data-testid="tp-refresh"
        >
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
            <strong>Couldn’t load the Tech Partner figures</strong>
            <span>{error}</span>
            <button type="button" className="pa-btn sm" onClick={() => load(false)}>Try again</button>
          </div>
        ) : (
          <TechPartnerSkeleton />
        )}
      </div>
    );
  }

  const [msgCheck, activeCheck, qualityCheck] = ['messages', 'activeClients', 'quality'].map(
    (k) => data.checks.find((c) => c.key === k)!,
  );
  const q = data.quality;
  const m = data.messages;

  return (
    <div className="pa-page">
      {head}
      {error && <div className="pa-error" role="alert">{error}</div>}
      <div className={`pd-dash${busy ? ' refreshing' : ''}`}>
        <div className={`tp-summary${data.eligible ? ' ok' : ''}`} role="status" data-testid="tp-summary">
          <strong>
            {data.eligible
              ? 'All three requirements are met: you can apply to become a Tech Partner.'
              : `${data.metCount} of 3 requirements met.`}
          </strong>
          <span>
            {data.eligible
              ? <>In the App Dashboard, open WhatsApp → Quickstart and choose <em>Become a Partner</em>.</>
              : <>Counted from the CRM&apos;s own records. Meta&apos;s App Dashboard has the official figures.</>}{' '}
            <a href={META_DOC} target="_blank" rel="noopener noreferrer">Meta&apos;s requirements</a>
          </span>
        </div>

        <div className="tp-reqs">
          <Requirement
            check={msgCheck}
            title="Messages a day"
            note={
              <>
                Sent + received on WhatsApp, averaged over the last 7 full days: {whole.format(m.total7)} in total
                {m.shortBy7 > 0 ? <> · {whole.format(m.shortBy7)} more needed over 7 days</> : null}. Today so far:{' '}
                {whole.format(m.today.total)} (counted in the average from tomorrow, as Meta does).
              </>
            }
          />
          <Requirement
            check={activeCheck}
            title="Active clients"
            note={
              <>
                Businesses that sent at least one message from their own number in the last 30 days
                {activeCheck.met ? '.' : <> · {data.targets.activeClients - data.activeClients.count} more needed.</>}
              </>
            }
          >
            {data.activeClients.list.length > 0 && (
              <ul className="tp-chips" aria-label="Active clients">
                {data.activeClients.list.map((a) => (
                  <li key={a.businessId}>
                    <button type="button" className="tp-chip" onClick={() => onOpenBusiness(a.businessId)} title={`${whole.format(a.sent30)} sent in 30 days · last ${when(a.lastSentAt)}`}>
                      {a.name || 'Business'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Requirement>
          <Requirement
            check={qualityCheck}
            title="Quality rating"
            note={
              q.rated
                ? <>Share of client numbers Meta rates High (green): {q.counts.GREEN} of {q.rated} rated. Numbers not rated yet aren&apos;t counted.</>
                : <>No client number has a quality rating yet. Meta rates a number once it has sent messages.</>
            }
          >
            <ul className="tp-quality" aria-label="Numbers by quality rating" data-testid="tp-quality-counts">
              {(['GREEN', 'YELLOW', 'RED', 'UNKNOWN'] as QualityRating[]).map((k) => (
                <li key={k}>
                  <span className="tp-dot" style={{ background: QUALITY_META[k].color }} />
                  {QUALITY_META[k].label}
                  <strong>{q.counts[k]}</strong>
                </li>
              ))}
            </ul>
          </Requirement>
        </div>

        <section className="pd-box">
          <header className="pd-box-head">
            <h2>Messages a day · last 7 days and today</h2>
            <span className="tp-legend">Target {whole.format(data.targets.messagesPerDay)} a day</span>
          </header>
          <div className="pd-box-body">
            {(() => {
              // The 7 full days the average uses, then today so far (counted from tomorrow).
              const bars = [...m.daily, m.today];
              const last = bars.length - 1;
              return (
                <BarChart
                  ariaLabel={`WhatsApp messages sent and received each day, last 7 days and today so far; target ${data.targets.messagesPerDay} a day`}
                  labels={bars.map((d, i) => (i === last ? 'Today' : dayShort(d.date)))}
                  titles={bars.map((d, i) => (i === last ? `Today so far (${dayLong(d.date)}): joins the average tomorrow` : dayLong(d.date)))}
                  values={bars.map((d) => d.total)}
                  axisFormat={axisCount}
                  tooltip={(i) => (
                    <>
                      <TipRow color="#ff6a00" label="Total" value={whole.format(bars[i].total)} />
                      <TipRow color="#008cff" label="Sent" value={whole.format(bars[i].sent)} />
                      <TipRow color="#15ca20" label="Received" value={whole.format(bars[i].received)} />
                      <TipRow color="#6c757d" label="Target" value={whole.format(data.targets.messagesPerDay)} />
                    </>
                  )}
                />
              );
            })()}
          </div>
        </section>

        <section className="pd-box">
          <header className="pd-box-head">
            <h2>Client numbers</h2>
            <span className="tp-legend">{q.numbers.length} connected</span>
          </header>
          <div className="pd-box-body">
            {q.numbers.length === 0 ? (
              <p className="pd-empty">No business has connected its own WhatsApp number yet.</p>
            ) : (
              <div className="pd-table-wrap">
                <table className="pd-table" data-testid="tp-numbers">
                  <thead>
                    <tr>
                      <th>Business</th>
                      <th>Number</th>
                      <th>Quality</th>
                      <th>Status</th>
                      <th>Limit</th>
                      <th className="num" title="WhatsApp messages sent and received in the last 7 days, today included">Messages (7 days)</th>
                      <th>Active client</th>
                      <th>Other apps</th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.numbers.map((n) => (
                      <tr key={n.businessId} className="link" onClick={() => onOpenBusiness(n.businessId)}>
                        <td>{n.name || 'Business'}</td>
                        <td>{n.displayPhoneNumber || '—'}</td>
                        <td>
                          <span
                            className={`pa-badge ${QUALITY_META[n.qualityRating].badge}`}
                            title={n.qualityLive ? 'Read from Meta just now' : n.error ? `Meta couldn't be read: ${n.error}. Last known rating.` : 'Last known rating'}
                          >
                            {QUALITY_META[n.qualityRating].label}
                          </span>
                          {!n.qualityLive && n.qualityRating !== 'UNKNOWN' && <span className="tp-stale">last known</span>}
                        </td>
                        <td>{n.status || '—'}</td>
                        <td>{n.limit || '—'}</td>
                        <td className="num">{whole.format(n.messages7d)}</td>
                        <td>{n.activeClient ? <span className="pa-badge num-green">Yes</span> : <span className="pa-badge num-grey">No</span>}</td>
                        <td>
                          {n.otherApps?.length ? (
                            <span
                              className="pa-badge num-red"
                              title={`Also attached: ${n.otherApps.map((a) => `${a.name || 'App'} (${a.id})`).join(', ')}. It can hold this number's chats away from the CRM.`}
                              data-testid="tp-other-apps"
                            >
                              {n.otherApps.map((a) => a.name || a.id).join(', ')}
                            </span>
                          ) : (
                            <span className="pa-badge num-grey">None</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
