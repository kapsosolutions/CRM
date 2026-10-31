// Platform dashboard: tenant counts, message volume, a 7-day trend, the spread
// of businesses across verticals, and the most recently onboarded tenants.
import { useEffect, useState } from 'react';
import { platformApi, type PlatformStats } from './platformApi';
import { verticalConfig } from '../crm/verticals';

const num = (n: number) => n.toLocaleString('en-IN');
const dayLabel = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short' });

export function DashboardPage({ onOpenBusiness }: { onOpenBusiness: (id: string) => void }) {
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    platformApi
      .platformStats()
      .then((r) => setStats(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load stats'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="pa-note">Loading dashboard…</div>;
  if (error) return <div className="pa-error">{error}</div>;
  if (!stats) return null;

  const peak = Math.max(1, ...stats.daily.map((d) => d.count));
  // Fill any missing days so the chart always shows a full week.
  const week: { date: string; count: number }[] = [];
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const iso = d.toISOString().slice(0, 10);
    week.push({ date: iso, count: stats.daily.find((x) => x.date === iso)?.count || 0 });
  }

  const cards = [
    { label: 'Businesses', value: stats.businesses.total, icon: 'apartment', sub: `${stats.businesses.active} active · ${stats.businesses.inactive} inactive` },
    { label: 'Messages', value: stats.messages.total, icon: 'forum', sub: `${num(stats.messages.last24h)} in last 24h` },
    { label: 'Conversations', value: stats.totals.conversations, icon: 'chat', sub: `${num(stats.messages.inbound)} in · ${num(stats.messages.outbound)} out` },
    { label: 'Flows', value: stats.totals.flows, icon: 'account_tree', sub: `${num(stats.totals.journeys)} journeys` },
  ];

  return (
    <div className="pa-page">
      <header className="pa-page-head">
        <div>
          <h1>Dashboard</h1>
          <p className="pa-page-sub">Platform-wide activity across all tenants.</p>
        </div>
      </header>

      <div className="pa-stat-grid">
        {cards.map((c) => (
          <div className="pa-stat" key={c.label}>
            <div className="pa-stat-top">
              <span className="material-icons">{c.icon}</span>
              {c.label}
            </div>
            <div className="pa-stat-val">{num(c.value)}</div>
            <div className="pa-stat-sub">{c.sub}</div>
          </div>
        ))}
      </div>

      <div className="pa-dash-cols">
        <section className="pa-panel">
          <div className="pa-panel-head">Message volume · last 7 days</div>
          {week.every((d) => d.count === 0) ? (
            <div className="pa-note sm">No messages yet.</div>
          ) : (
            <div className="pa-chart">
              {week.map((d) => (
                <div className="pa-bar-col" key={d.date} title={`${d.date}: ${num(d.count)}`}>
                  <div className="pa-bar-wrap">
                    <div className="pa-bar" style={{ height: `${Math.round((d.count / peak) * 100)}%` }} />
                  </div>
                  <span className="pa-bar-n">{d.count || ''}</span>
                  <span className="pa-bar-label">{dayLabel(d.date)}</span>
                </div>
              ))}
            </div>
          )}

          <div className="pa-panel-head" style={{ marginTop: 18 }}>Content totals</div>
          <div className="pa-mini-grid">
            {[
              { k: 'Members', v: stats.totals.members, i: 'groups' },
              { k: 'Products', v: stats.totals.products, i: 'storefront' },
              { k: 'Orders', v: stats.totals.orders, i: 'receipt_long' },
              { k: 'Journeys', v: stats.totals.journeys, i: 'hub' },
            ].map((m) => (
              <div className="pa-mini" key={m.k}>
                <span className="material-icons">{m.i}</span>
                <div>
                  <strong>{num(m.v)}</strong>
                  <small>{m.k}</small>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="pa-panel">
          <div className="pa-panel-head">Businesses by category</div>
          {stats.byCategory.length === 0 ? (
            <div className="pa-note sm">No businesses yet.</div>
          ) : (
            <div className="pa-catlist">
              {stats.byCategory.map((c) => (
                <div className="pa-catrow" key={c.key}>
                  <div className="pa-catrow-top">
                    <span>{c.label}</span>
                    <strong>{c.count}</strong>
                  </div>
                  <div className="pa-catbar">
                    <div
                      className="pa-catbar-fill"
                      style={{ width: `${Math.round((c.count / stats.businesses.total) * 100)}%` }}
                    />
                  </div>
                  <small className="pa-catrow-arch">{c.archetype}</small>
                </div>
              ))}
            </div>
          )}

          <div className="pa-panel-head" style={{ marginTop: 18 }}>Recently added</div>
          {stats.recent.length === 0 ? (
            <div className="pa-note sm">Nothing yet.</div>
          ) : (
            <div className="pa-recent">
              {stats.recent.map((b) => (
                <button className="pa-recent-row" key={b._id} onClick={() => onOpenBusiness(b._id)}>
                  <span className="pa-avatar">{b.name.slice(0, 1).toUpperCase()}</span>
                  <div className="pa-recent-text">
                    <strong>{b.name}</strong>
                    <small>{verticalConfig(b.category).label}</small>
                  </div>
                  <span className={`pa-dot ${b.active ? 'on' : 'off'}`} />
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
