// Super-admin Dashboard, laid out like the "Rocker" dark admin template:
//   row 1  Revenue Overview (area lines: this period vs the one before)
//          Message Volume (gradient bars)
//   row 2  Plans (donut + list) · six stat cards with 30-day sparklines
//   row 3  Recent payments · New businesses
// Revenue is what businesses paid for plans through Razorpay. Days and months
// are India time. While the numbers load, a skeleton of the same layout shows.
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { platformApi, type DashboardStats, type PlanSliceKey } from './platformApi';
import { AreaChart, BarChart, DonutChart, Skel, Sparkline, TipRow } from './charts';
import { CardIcon, CartIcon, ChatIcon, DotsIcon, MegaphoneIcon, RefreshIcon, RupeeIcon, UsersIcon } from './AdminIcons';

type Range = '7d' | '6m';

// ---- formatting ----------------------------------------------------------
const TZ = 'Asia/Kolkata';
const whole = new Intl.NumberFormat('en-IN');
const compact = new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 });
const rupees = (paise: number) =>
  `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: paise % 100 ? 2 : 0 })}`;
const rupeesShort = (paise: number) => (paise < 100000 ? rupees(paise) : `₹${compact.format(paise / 100)}`);
const countShort = (n: number) => (n < 10000 ? whole.format(n) : compact.format(n));
const axisRupees = (r: number) => (r < 1000 ? `₹${whole.format(r)}` : `₹${compact.format(r)}`);
const axisCount = (n: number) => (n < 1000 ? whole.format(n) : compact.format(n));

const noon = (date: string) => new Date(`${date}T12:00:00+05:30`);
const dayShort = (date: string) => noon(date).toLocaleDateString('en-IN', { weekday: 'short', timeZone: TZ }).slice(0, 2);
const dayLong = (date: string) => noon(date).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ });
const monthShort = (m: string) => noon(`${m}-01`).toLocaleDateString('en-IN', { month: 'short', timeZone: TZ });
const monthLong = (m: string) => noon(`${m}-01`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: TZ });
const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: TZ })
    : '—';
const joined = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ }) : '';

const sum = <T,>(list: T[], f: (x: T) => number) => list.reduce((a, x) => a + f(x), 0);

/** "+25%", "-10%", "New" (nothing before) or "0%". */
function change(cur: number, prev: number): { text: string; tone: 'up' | 'down' | 'flat' } {
  if (prev === 0) return cur === 0 ? { text: '0%', tone: 'flat' } : { text: 'New', tone: 'up' };
  const p = Math.round(((cur - prev) / prev) * 100);
  return { text: `${p > 0 ? '+' : ''}${p}%`, tone: p > 0 ? 'up' : p < 0 ? 'down' : 'flat' };
}

const PLAN_COLORS: Record<PlanSliceKey, string> = {
  premium: '#8932ff',
  pro: '#15ca20',
  basic: '#008cff',
  starter: '#14b8a6',
  trial: '#ffc107',
  free: '#6c757d',
};
const CYCLE: Record<string, string> = { monthly: 'Monthly', quarterly: 'Quarterly', annual: 'Annual' };
const KIND: Record<string, string> = { new: 'New', renew: 'Renewal', upgrade: 'Upgrade' };

// ---- the "⋯" menu on a chart card ----------------------------------------
function CardMenu({ label, value, onChange, onRefresh }: {
  label: string;
  value: Range;
  onChange: (r: Range) => void;
  onRefresh: () => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const pick = (r: Range) => {
    onChange(r);
    setOpen(false);
  };
  return (
    <div className="pd-menu" ref={box}>
      <button
        type="button"
        className="pd-menu-btn"
        aria-label={`${label}: options`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <DotsIcon />
      </button>
      {open && (
        <div className="pd-menu-list" role="menu">
          {([['7d', 'Last 7 days'], ['6m', 'Last 6 months']] as const).map(([r, text]) => (
            <button key={r} type="button" role="menuitemradio" aria-checked={value === r} className={value === r ? 'on' : ''} onClick={() => pick(r)}>
              {text}
            </button>
          ))}
          <span className="pd-menu-sep" role="separator" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onRefresh();
            }}
          >
            Refresh
          </button>
        </div>
      )}
    </div>
  );
}

function Box({ title, menu, className = '', children }: { title: string; menu?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={`pd-box ${className}`}>
      <header className="pd-box-head">
        <h2>{title}</h2>
        {menu}
      </header>
      <div className="pd-box-body">{children}</div>
    </section>
  );
}

// ---- a stat card ------------------------------------------------------------
function Kpi({ title, value, tip, icon, color, spark, delta }: {
  title: string;
  value: string;
  tip: string;
  icon: ReactNode;
  color: string;
  spark: number[];
  delta: { text: string; tone: 'up' | 'down' | 'flat' };
}) {
  return (
    <div className="pd-kpi" title={tip} style={{ '--kpi': color } as CSSProperties}>
      <div className="pd-kpi-top">
        <div>
          <p className="pd-kpi-title">{title}</p>
          <p className="pd-kpi-value">{value}</p>
        </div>
        <span className="pd-kpi-icon" aria-hidden="true">{icon}</span>
      </div>
      <div className="pd-kpi-bottom">
        <Sparkline values={spark} color={color} />
        <span className={`pd-change ${delta.tone}`}>{delta.text}</span>
      </div>
    </div>
  );
}

// ---- loading skeleton (same layout) ------------------------------------------
function DashboardSkeleton() {
  return (
    <div className="pd-dash" aria-busy="true" aria-label="Loading the dashboard">
      <div className="pd-row two-one">
        {[0, 1].map((i) => (
          <section className="pd-box" key={i}>
            <header className="pd-box-head"><Skel w={140} h={14} /><Skel w={20} h={14} /></header>
            <div className="pd-box-body">
              <div className="pd-skel-chart">
                {i === 0 ? <Skel h="100%" r={8} /> : (
                  <div className="pd-skel-bars">
                    {[55, 40, 82, 60, 72, 48, 64].map((h, j) => <Skel key={j} w={14} h={`${h}%`} r={7} />)}
                  </div>
                )}
              </div>
            </div>
          </section>
        ))}
      </div>
      <div className="pd-row one-two">
        <section className="pd-box">
          <div className="pd-box-body pd-donut-wrap">
            <span className="pd-skel pd-skel-ring" aria-hidden="true" />
            {[0, 1, 2].map((i) => <Skel key={i} h={14} />)}
          </div>
        </section>
        <section className="pd-box">
          <div className="pd-box-body pd-kpis">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div className="pd-kpi" key={i}>
                <Skel w={90} h={12} />
                <Skel w={70} h={20} />
                <Skel h={26} />
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

// ---- the page -----------------------------------------------------------------
export function DashboardPage({ onOpenBusiness }: { onOpenBusiness: (id: string) => void }) {
  const [data, setData] = useState<DashboardStats | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [revRange, setRevRange] = useState<Range>('7d');
  const [msgRange, setMsgRange] = useState<Range>('7d');
  const [activePlan, setActivePlan] = useState<string | null>(null);

  const load = useCallback(() => {
    setRefreshing(true);
    setError('');
    platformApi
      .dashboardStats()
      .then((r) => setData(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load the dashboard.'))
      .finally(() => setRefreshing(false));
  }, []);
  useEffect(load, [load]);

  const head = (
    <header className="pa-page-head">
      <div>
        <h1>Dashboard</h1>
        <p className="pa-page-sub">
          Revenue, messages and businesses across the platform · India time
          {data && <> · updated {when(data.generatedAt)}</>}
        </p>
      </div>
      <div className="pa-head-actions">
        <button type="button" className="pa-btn ghost sm" onClick={load} disabled={refreshing} data-testid="pd-refresh">
          <RefreshIcon />
          {refreshing ? 'Refreshing…' : 'Refresh'}
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
            <strong>Couldn’t load the dashboard</strong>
            <span>{error}</span>
            <button type="button" className="pa-btn sm" onClick={load}>Try again</button>
          </div>
        ) : (
          <DashboardSkeleton />
        )}
      </div>
    );
  }

  // ---- Revenue Overview: this period vs the one before ----
  const rev = revRange === '7d'
    ? {
      labels: data.revenue.daily.slice(-7).map((d) => dayShort(d.date)),
      titles: data.revenue.daily.slice(-7).map((d) => dayLong(d.date)),
      cur: data.revenue.daily.slice(-7).map((d) => d.paise / 100),
      prev: data.revenue.daily.slice(-14, -7).map((d) => d.paise / 100),
      curLabel: 'This week',
      prevLabel: 'Last week',
    }
    : {
      labels: data.revenue.monthly.slice(-6).map((m) => monthShort(m.month)),
      titles: data.revenue.monthly.slice(-6).map((m) => monthLong(m.month)),
      cur: data.revenue.monthly.slice(-6).map((m) => m.paise / 100),
      prev: data.revenue.monthly.slice(-12, -6).map((m) => m.paise / 100),
      curLabel: 'Last 6 months',
      prevLabel: 'The 6 months before',
    };

  // ---- Message Volume ----
  const msgRows = msgRange === '7d'
    ? data.messages.daily.slice(-7).map((d) => ({ label: dayShort(d.date), title: dayLong(d.date), sent: d.sent, received: d.received }))
    : data.messages.monthly.slice(-6).map((m) => ({ label: monthShort(m.month), title: monthLong(m.month), sent: m.sent, received: m.received }));

  // ---- the stat cards: last 30 days vs the 30 before ----
  const last = <T,>(list: T[]) => list.slice(-30);
  const before = <T,>(list: T[]) => list.slice(-60, -30);
  const revenue30 = sum(last(data.revenue.daily), (d) => d.paise);
  const sales30 = sum(last(data.revenue.daily), (d) => d.count);
  const signups30 = sum(last(data.businesses.signupsDaily), (d) => d.count);
  const messages30 = sum(last(data.messages.daily), (d) => d.sent + d.received);
  const payingDaily = data.paying.daily;

  const plansTotal = sum(data.plans, (p) => p.count);

  return (
    <div className="pa-page">
      {head}
      {error && <div className="pa-error" role="alert">{error}</div>}
      <div className={`pd-dash${refreshing ? ' refreshing' : ''}`}>
        <div className="pd-row two-one">
          <Box
            title="Revenue Overview"
            menu={<CardMenu label="Revenue Overview" value={revRange} onChange={setRevRange} onRefresh={load} />}
          >
            <AreaChart
              ariaLabel={`Revenue from plan purchases, ${rev.curLabel.toLowerCase()} compared with ${rev.prevLabel.toLowerCase()}`}
              labels={rev.labels}
              titles={rev.titles}
              series={[
                { key: 'prev', label: rev.prevLabel, color: '#ffc107', stroke: ['#ff9a1f', '#f6365d'], values: rev.prev },
                { key: 'cur', label: rev.curLabel, color: '#008cff', values: rev.cur },
              ]}
              axisFormat={axisRupees}
              format={(v) => rupees(Math.round(v * 100))}
            />
          </Box>
          <Box
            title="Message Volume"
            menu={<CardMenu label="Message Volume" value={msgRange} onChange={setMsgRange} onRefresh={load} />}
          >
            <BarChart
              ariaLabel={`Messages sent and received, ${msgRange === '7d' ? 'last 7 days' : 'last 6 months'}`}
              labels={msgRows.map((r) => r.label)}
              titles={msgRows.map((r) => r.title)}
              values={msgRows.map((r) => r.sent + r.received)}
              axisFormat={axisCount}
              tooltip={(i) => (
                <>
                  <TipRow color="#ff6a00" label="Total" value={whole.format(msgRows[i].sent + msgRows[i].received)} />
                  <TipRow color="#008cff" label="Sent" value={whole.format(msgRows[i].sent)} />
                  <TipRow color="#15ca20" label="Received" value={whole.format(msgRows[i].received)} />
                </>
              )}
            />
          </Box>
        </div>

        <div className="pd-row one-two">
          <section className="pd-box">
            <div className="pd-box-body pd-donut-wrap">
              <DonutChart
                ariaLabel={`Businesses by plan: ${data.plans.map((p) => `${p.label} ${p.count}`).join(', ')}`}
                slices={data.plans.map((p) => ({ key: p.key, label: p.label, value: p.count, color: PLAN_COLORS[p.key] }))}
                centerValue={whole.format(plansTotal)}
                centerLabel={plansTotal === 1 ? 'Business' : 'Businesses'}
                active={activePlan}
                onActive={setActivePlan}
              />
            </div>
            <ul className="pd-plan-list" aria-label="Businesses by plan">
              {data.plans.map((p) => (
                <li
                  key={p.key}
                  className={activePlan === p.key ? 'on' : ''}
                  onPointerEnter={() => setActivePlan(p.key)}
                  onPointerLeave={() => setActivePlan(null)}
                >
                  <span className="pd-plan-dot" style={{ background: PLAN_COLORS[p.key] }} />
                  <span className="pd-plan-name">{p.label}</span>
                  <span className={`pd-plan-count${p.count ? '' : ' zero'}`} style={p.count ? { background: PLAN_COLORS[p.key] } : undefined}>
                    {p.count}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="pd-box">
            <div className="pd-box-body pd-kpis">
              <Kpi
                title="Total Revenue"
                value={rupeesShort(data.revenue.totalPaise)}
                tip={`All plan purchases: ${rupees(data.revenue.totalPaise)}. Last 30 days: ${rupees(revenue30)}. The change compares the last 30 days with the 30 before.`}
                icon={<RupeeIcon />}
                color="#fd3550"
                spark={last(data.revenue.daily).map((d) => d.paise)}
                delta={change(revenue30, sum(before(data.revenue.daily), (d) => d.paise))}
              />
              <Kpi
                title="Subscriptions Sold"
                value={countShort(data.revenue.payments)}
                tip={`Plan purchases paid through Razorpay. Last 30 days: ${sales30}.`}
                icon={<CartIcon />}
                color="#008cff"
                spark={last(data.revenue.daily).map((d) => d.count)}
                delta={change(sales30, sum(before(data.revenue.daily), (d) => d.count))}
              />
              <Kpi
                title="Paying Businesses"
                value={countShort(data.paying.now)}
                tip="Businesses with a paid plan running now. The change compares today with 30 days ago."
                icon={<CardIcon />}
                color="#ff9700"
                spark={last(payingDaily).map((d) => d.count)}
                delta={change(payingDaily[payingDaily.length - 1]?.count || 0, payingDaily[payingDaily.length - 31]?.count || 0)}
              />
              <Kpi
                title="New Businesses"
                value={countShort(signups30)}
                tip={`Sign-ups in the last 30 days. ${data.businesses.total} businesses in total, ${data.businesses.active} active.`}
                icon={<UsersIcon />}
                color="#15ca20"
                spark={last(data.businesses.signupsDaily).map((d) => d.count)}
                delta={change(signups30, sum(before(data.businesses.signupsDaily), (d) => d.count))}
              />
              <Kpi
                title="Messages"
                value={countShort(messages30)}
                tip={`Sent and received in the last 30 days. ${whole.format(data.messages.last24h)} in the last 24 hours, ${whole.format(data.messages.total)} in total.`}
                icon={<ChatIcon />}
                color="#ffc107"
                spark={last(data.messages.daily).map((d) => d.sent + d.received)}
                delta={change(messages30, sum(before(data.messages.daily), (d) => d.sent + d.received))}
              />
              <Kpi
                title="Active Clients"
                value={countShort(data.activeClients.current)}
                tip="Businesses that sent at least one message in the last 30 days. Meta's Tech Partner programme asks for 10 or more."
                icon={<MegaphoneIcon />}
                color="#0dcaf0"
                spark={last(data.activeClients.daily).map((d) => d.count)}
                delta={change(data.activeClients.current, data.activeClients.previous)}
              />
            </div>
          </section>
        </div>

        <div className="pd-row two-one">
          <Box title="Recent Payments" className="pd-payments">
            {data.revenue.recent.length === 0 ? (
              <p className="pd-empty">No plan purchases yet. They appear here as soon as a business pays through Razorpay.</p>
            ) : (
              <div className="pd-table-wrap">
                <table className="pd-table">
                  <thead>
                    <tr>
                      <th>Business</th>
                      <th>Plan</th>
                      <th>Billing</th>
                      <th>Type</th>
                      <th className="num">Amount</th>
                      <th>Paid</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.revenue.recent.map((p) => (
                      <tr
                        key={p._id}
                        className={p.businessId ? 'link' : ''}
                        onClick={p.businessId ? () => onOpenBusiness(p.businessId) : undefined}
                        title={p.paymentId ? `Razorpay payment ${p.paymentId}${p.method ? ` · ${p.method}` : ''}` : undefined}
                      >
                        <td>
                          <div className="pa-cell-main">
                            <span className="pa-avatar">{(p.businessName || '?').slice(0, 1).toUpperCase()}</span>
                            <strong className={p.businessName ? '' : 'pd-muted'}>{p.businessName || 'Deleted business'}</strong>
                          </div>
                        </td>
                        <td><span className={`pa-badge plan-${p.tier}`}>{p.name}</span></td>
                        <td>{CYCLE[p.cycle] || p.cycle}</td>
                        <td>{KIND[p.kind] || p.kind}</td>
                        <td className="num"><strong>{rupees(p.amountPaise)}</strong></td>
                        <td className="pd-muted">{when(p.paidAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Box>

          <Box title="New Businesses">
            {data.businesses.recent.length === 0 ? (
              <p className="pd-empty">No businesses yet. They appear here when someone signs up.</p>
            ) : (
              <ul className="pd-list">
                {data.businesses.recent.map((b) => (
                  <li key={b._id}>
                    <button type="button" onClick={() => onOpenBusiness(b._id)}>
                      <span className="pa-avatar">{(b.name || '?').slice(0, 1).toUpperCase()}</span>
                      <span className="pd-list-text">
                        <strong>{b.name || 'Unnamed business'}</strong>
                        <small>{b.category} · {joined(b.createdAt)}</small>
                      </span>
                      <span
                        className={`pa-badge ${b.plan.slice === 'trial' ? 'plan-new' : `plan-${b.plan.slice}`}`}
                        title={b.plan.slice === 'trial' && b.plan.daysLeft != null ? `Free trial · ${b.plan.daysLeft} days left` : undefined}
                      >
                        {b.plan.slice === 'trial' ? 'Trial' : b.plan.name}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Box>
        </div>
      </div>
    </div>
  );
}
