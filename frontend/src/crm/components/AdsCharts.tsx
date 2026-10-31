// Ads Manager S3: plain SVG charts for the Ads page (no chart library).
//   • TrendChart: one or two metrics over time on two y-axes (left / right),
//     the first as a line or bars, the second as a line, optionally the
//     previous period as a dashed line; a hover guide with a tooltip.
//   • BarChart: one value per category (horizontal, or vertical columns for
//     hours of the day), with the previous period as a thin grey bar.
//   • StackedBarChart: categories split into parts (age × gender).
// Every chart has a data-testid; its tooltip is `${testid}-tip`, and the
// hover targets are `${testid}-hit-<i>`.
import { useState, type ReactNode } from 'react';
import type { AdsColumnFormat } from '../types';
import './AdsManager.css';

export const CHART_COLORS = ['#1877f2', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#64748b'];

/** A metric value for display: money in the account currency, counts, percents, seconds. */
export function fmtValue(format: AdsColumnFormat, v: number | null | undefined, currency: string): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  if (format === 'money') {
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 2 }).format(v);
    } catch {
      return `${v.toFixed(2)} ${currency}`;
    }
  }
  if (format === 'pct') return `${v.toFixed(2)}%`;
  if (format === 'dec') return v.toFixed(2);
  if (format === 'secs') return `${v.toFixed(1)} s`;
  return Math.round(v).toLocaleString();
}

/** Axis labels: short (1.2k, 3.4M). */
function fmtShort(format: AdsColumnFormat, v: number, currency: string): string {
  const abs = Math.abs(v);
  const short = abs >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : abs >= 1e4 ? `${(v / 1e3).toFixed(0)}k` : abs >= 1e3 ? `${(v / 1e3).toFixed(1)}k` : format === 'int' ? String(Math.round(v)) : v.toFixed(abs < 10 ? 2 : 0);
  if (format === 'pct') return `${short}%`;
  if (format === 'money') {
    try {
      const sym = new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'USD', currencyDisplay: 'narrowSymbol' }).formatToParts(0).find((p) => p.type === 'currency')?.value || '';
      return `${sym}${short}`;
    } catch {
      return short;
    }
  }
  return short;
}

/** A "nice" axis maximum (1, 2, 2.5, 5 × 10^n) and its 4 ticks. */
function niceMax(v: number) {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}
const ticksOf = (max: number) => [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);

export interface ChartMetric {
  label: string;
  format: AdsColumnFormat;
}

/** The tooltip box, placed over the SVG in % of the viewBox. */
function Tip({ testid, x, y, w, h, children }: { testid: string; x: number; y: number; w: number; h: number; children: ReactNode }) {
  const left = (x / w) * 100;
  return (
    <div
      className={`ads-rp-tip${left > 60 ? ' left' : ''}`}
      style={{ left: `${left}%`, top: `${Math.max(0, (y / h) * 100)}%` }}
      role="tooltip"
      data-testid={`${testid}-tip`}
    >
      {children}
    </div>
  );
}

function Legend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <div className="ads-rp-legend">
      {items.map((it) => (
        <span key={it.label}>
          <i style={{ background: it.dashed ? 'transparent' : it.color, borderColor: it.color }} className={it.dashed ? 'dashed' : ''} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

const pathOf = (pts: ([number, number] | null)[]) => {
  let d = '';
  let pen = false;
  for (const p of pts) {
    if (!p) {
      pen = false;
      continue;
    }
    d += `${pen ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)} `;
    pen = true;
  }
  return d.trim();
};

export interface TrendPoint {
  label: string;
  a: number | null;
  b?: number | null;
  prevA?: number | null;
  prevLabel?: string;
}

/** A history marker under one point (e.g. "Ad set budget updated" on that day). */
export interface TrendMarker {
  index: number;
  lines: string[];
}

/**
 * Over time: metric A (left axis; a line, or bars) and optionally metric B
 * (right axis, a line) and A in the previous period (dashed). Hover a day for
 * the tooltip.
 */
export function TrendChart({
  points, a, b, currency, testid, bars = false, barClass = '', ariaLabel, height = 220, svgClassName = 'ads-rp-chart', markers = [], dots = false,
}: {
  points: TrendPoint[];
  a: ChartMetric;
  b?: ChartMetric | null;
  currency: string;
  testid: string;
  bars?: boolean;
  barClass?: string;
  ariaLabel?: string;
  height?: number;
  svgClassName?: string;
  /** History markers drawn on the x axis (hover one for what changed). */
  markers?: TrendMarker[];
  /** Draw a dot on each point of line A (a single day is otherwise invisible). */
  dots?: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [mark, setMark] = useState<number | null>(null);
  const W = 720;
  const H = height;
  const pad = { l: 56, r: b ? 56 : 12, t: 14, b: 28 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const n = Math.max(1, points.length);
  const step = iw / n;
  const xAt = (i: number) => pad.l + step * i + step / 2;
  const hasPrev = points.some((p) => p.prevA !== undefined && p.prevA !== null);
  const maxA = niceMax(Math.max(0, ...points.map((p) => p.a ?? 0), ...(hasPrev ? points.map((p) => p.prevA ?? 0) : [])));
  const maxB = niceMax(Math.max(0, ...points.map((p) => p.b ?? 0)));
  const yA = (v: number) => pad.t + ih - (v / maxA) * ih;
  const yB = (v: number) => pad.t + ih - (v / maxB) * ih;
  const tickIdx = n <= 1 ? [0] : [...new Set([0, Math.round((n - 1) / 4), Math.round((n - 1) / 2), Math.round(((n - 1) * 3) / 4), n - 1])];
  const shortLabel = (s: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? s.slice(5) : s.length > 12 ? `${s.slice(0, 11)}…` : s);
  const h = hover !== null ? points[hover] : null;
  const legend = [{ label: a.label, color: CHART_COLORS[0] }];
  if (b) legend.push({ label: `${b.label} (right axis)`, color: CHART_COLORS[1] });
  if (hasPrev) legend.push({ label: `${a.label}, previous period`, color: '#94a3b8', dashed: true } as { label: string; color: string; dashed: boolean });
  return (
    <div className="ads-rp-chartbox" data-testid={`${testid}-box`}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className={svgClassName}
        role="img"
        aria-label={ariaLabel || `${a.label}${b ? ` and ${b.label}` : ''} over time`}
        data-testid={testid}
        onMouseLeave={() => setHover(null)}
      >
        {ticksOf(maxA).map((t) => (
          <g key={`a${t}`}>
            <line x1={pad.l} x2={W - pad.r} y1={yA(t)} y2={yA(t)} stroke="#eef2f7" />
            <text x={pad.l - 6} y={yA(t) + 4} textAnchor="end" className="ads-chart-tick">
              {fmtShort(a.format, t, currency)}
            </text>
          </g>
        ))}
        {b && ticksOf(maxB).map((t) => (
          <text key={`b${t}`} x={W - pad.r + 6} y={yB(t) + 4} textAnchor="start" className="ads-chart-tick ads-rp-tick-b">
            {fmtShort(b.format, t, currency)}
          </text>
        ))}
        <line x1={pad.l} x2={W - pad.r} y1={pad.t + ih} y2={pad.t + ih} stroke="#e2e8f0" />
        {bars
          ? points.map((p, i) => {
            const v = p.a ?? 0;
            const bh = (v / maxA) * ih;
            const bw = Math.max(1, step - Math.min(6, step * 0.3));
            return (
              <rect key={`${p.label}${i}`} x={xAt(i) - bw / 2} width={bw} y={pad.t + ih - bh} height={bh} rx={2} className={`ads-bar ${barClass}`}>
                <title>{`${p.label}: ${fmtValue(a.format, p.a, currency)}`}</title>
              </rect>
            );
          })
          : <path d={pathOf(points.map((p, i) => (p.a === null ? null : [xAt(i), yA(p.a)])))} fill="none" stroke={CHART_COLORS[0]} strokeWidth={2.2} data-testid={`${testid}-line-a`} />}
        {hasPrev && (
          <path d={pathOf(points.map((p, i) => (p.prevA === null || p.prevA === undefined ? null : [xAt(i), yA(p.prevA)])))} fill="none" stroke="#94a3b8" strokeWidth={1.6} strokeDasharray="5 4" data-testid={`${testid}-line-prev`} />
        )}
        {b && (
          <path d={pathOf(points.map((p, i) => (p.b === null || p.b === undefined ? null : [xAt(i), yB(p.b)])))} fill="none" stroke={CHART_COLORS[1]} strokeWidth={2.2} data-testid={`${testid}-line-b`} />
        )}
        {tickIdx.map((i) => (points[i] ? (
          <text key={`x${i}`} x={xAt(i)} y={H - 8} textAnchor="middle" className="ads-chart-tick">
            {shortLabel(points[i].label)}
          </text>
        ) : null))}
        {h && hover !== null && (
          <g pointerEvents="none">
            <line x1={xAt(hover)} x2={xAt(hover)} y1={pad.t} y2={pad.t + ih} stroke="#94a3b8" strokeDasharray="3 3" />
            {h.a !== null && !bars && <circle cx={xAt(hover)} cy={yA(h.a)} r={4} fill={CHART_COLORS[0]} />}
            {b && h.b !== null && h.b !== undefined && <circle cx={xAt(hover)} cy={yB(h.b)} r={4} fill={CHART_COLORS[1]} />}
          </g>
        )}
        {dots && !bars && points.map((p, i) => (p.a === null ? null : (
          <circle key={`dot${i}`} cx={xAt(i)} cy={yA(p.a)} r={n > 40 ? 1.8 : 3} fill={CHART_COLORS[0]} pointerEvents="none" data-testid={`${testid}-dot-${i}`} />
        )))}
        {points.map((_, i) => (
          <rect
            key={`hit${i}`}
            x={pad.l + step * i}
            y={pad.t}
            width={step}
            height={ih}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
            onMouseMove={() => setHover(i)}
            data-testid={`${testid}-hit-${i}`}
          />
        ))}
        {markers.filter((m) => points[m.index]).map((m) => (
          <g
            key={`mk${m.index}`}
            className="ads-chart-marker"
            transform={`translate(${xAt(m.index)},${pad.t + ih})`}
            onMouseEnter={() => { setHover(null); setMark(m.index); }}
            onMouseLeave={() => setMark(null)}
            data-testid={`${testid}-marker-${m.index}`}
          >
            <circle r={7} fill="#fff" stroke="#1c2b33" strokeWidth={1.4} />
            <path d="M-3.2,-1.2 A3.4,3.4 0 1 1 -1.6,2.8 M-3.2,-1.2 L-3.6,-3.8 M-3.2,-1.2 L-0.8,-1.8 M0,-1.6 L0,0.4 L1.4,1.3" fill="none" stroke="#1c2b33" strokeWidth={1.1} strokeLinecap="round" />
            <title>{`${points[m.index].label}: ${m.lines.join('; ')}`}</title>
          </g>
        ))}
      </svg>
      {mark !== null && points[mark] && (
        <Tip testid={`${testid}-mark`} x={xAt(mark)} y={pad.t + ih * 0.45} w={W} h={H}>
          <strong>{points[mark].label} · edits</strong>
          {(markers.find((m) => m.index === mark)?.lines || []).slice(0, 8).map((l, i) => (
            <span key={i}>{l}</span>
          ))}
          {(markers.find((m) => m.index === mark)?.lines.length || 0) > 8 && <span>…and {(markers.find((m) => m.index === mark)?.lines.length || 0) - 8} more</span>}
        </Tip>
      )}
      {h && hover !== null && (
        <Tip testid={testid} x={xAt(hover)} y={pad.t} w={W} h={H}>
          <strong>{h.label}</strong>
          <span>
            <i style={{ background: CHART_COLORS[0] }} />
            {a.label}: {fmtValue(a.format, h.a, currency)}
          </span>
          {hasPrev && (
            <span>
              <i style={{ background: '#94a3b8' }} />
              Previous{h.prevLabel ? ` (${h.prevLabel})` : ''}: {fmtValue(a.format, h.prevA ?? null, currency)}
            </span>
          )}
          {b && (
            <span>
              <i style={{ background: CHART_COLORS[1] }} />
              {b.label}: {fmtValue(b.format, h.b ?? null, currency)}
            </span>
          )}
        </Tip>
      )}
      {(b || hasPrev) && <Legend items={legend} />}
    </div>
  );
}

export interface BarRow {
  label: string;
  value: number | null;
  prev?: number | null;
}

/** One bar per category; `vertical` draws columns (hours of the day). */
export function BarChart({
  rows, metric, currency, testid, vertical = false, compare = false,
}: {
  rows: BarRow[];
  metric: ChartMetric;
  currency: string;
  testid: string;
  vertical?: boolean;
  compare?: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(0, ...rows.map((r) => r.value ?? 0), ...(compare ? rows.map((r) => r.prev ?? 0) : [])));
  const W = 720;
  const h = hover !== null ? rows[hover] : null;
  const change = (r: BarRow) => {
    if (r.value === null || r.prev === null || r.prev === undefined) return '';
    if (!r.prev) return r.value ? ' (new)' : '';
    const p = ((r.value - r.prev) / Math.abs(r.prev)) * 100;
    return ` (${p >= 0 ? '+' : ''}${p.toFixed(1)}%)`;
  };
  let svg: ReactNode;
  let H: number;
  let tipAt: [number, number] = [0, 0];
  if (vertical) {
    H = 220;
    const pad = { l: 56, r: 12, t: 12, b: 28 };
    const ih = H - pad.t - pad.b;
    const step = (W - pad.l - pad.r) / Math.max(1, rows.length);
    const y = (v: number) => pad.t + ih - (v / max) * ih;
    if (hover !== null) tipAt = [pad.l + step * hover + step / 2, pad.t];
    svg = (
      <svg viewBox={`0 0 ${W} ${H}`} className="ads-rp-chart" role="img" aria-label={`${metric.label} by category`} data-testid={testid} onMouseLeave={() => setHover(null)}>
        {ticksOf(max).map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="#eef2f7" />
            <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" className="ads-chart-tick">{fmtShort(metric.format, t, currency)}</text>
          </g>
        ))}
        {rows.map((r, i) => {
          const bw = Math.max(2, step * (compare ? 0.38 : 0.7));
          const x0 = pad.l + step * i + (step - bw * (compare ? 2 : 1)) / 2;
          return (
            <g key={`${r.label}${i}`}>
              <rect x={x0} width={bw} y={y(r.value ?? 0)} height={pad.t + ih - y(r.value ?? 0)} rx={2} fill={hover === i ? '#0f5bd8' : CHART_COLORS[0]} />
              {compare && <rect x={x0 + bw} width={bw} y={y(r.prev ?? 0)} height={pad.t + ih - y(r.prev ?? 0)} rx={2} fill="#cbd5e1" />}
              {(rows.length <= 12 || i % Math.ceil(rows.length / 12) === 0) && (
                <text x={pad.l + step * i + step / 2} y={H - 8} textAnchor="middle" className="ads-chart-tick">{r.label.slice(0, 5)}</text>
              )}
              <rect x={pad.l + step * i} y={pad.t} width={step} height={ih} fill="transparent" onMouseEnter={() => setHover(i)} onMouseMove={() => setHover(i)} data-testid={`${testid}-hit-${i}`} />
            </g>
          );
        })}
      </svg>
    );
  } else {
    const rowH = compare ? 30 : 24;
    H = Math.max(60, rows.length * rowH + 16);
    const lx = 170;
    const rx = W - 90;
    const x = (v: number) => lx + (v / max) * (rx - lx);
    if (hover !== null) tipAt = [x(Math.max(rows[hover].value ?? 0, rows[hover].prev ?? 0)), 8 + hover * rowH];
    svg = (
      <svg viewBox={`0 0 ${W} ${H}`} className="ads-rp-chart" role="img" aria-label={`${metric.label} by category`} data-testid={testid} onMouseLeave={() => setHover(null)}>
        {rows.map((r, i) => {
          const y0 = 8 + i * rowH;
          const bh = compare ? 14 : 16;
          return (
            <g key={`${r.label}${i}`}>
              <text x={lx - 8} y={y0 + 12} textAnchor="end" className="ads-rp-barlabel">{r.label.length > 26 ? `${r.label.slice(0, 25)}…` : r.label}</text>
              <rect x={lx} y={y0} width={Math.max(0, x(r.value ?? 0) - lx)} height={bh} rx={3} fill={hover === i ? '#0f5bd8' : CHART_COLORS[0]} />
              {compare && <rect x={lx} y={y0 + bh + 1} width={Math.max(0, x(r.prev ?? 0) - lx)} height={6} rx={2} fill="#cbd5e1" />}
              <text x={x(r.value ?? 0) + 6} y={y0 + 12} className="ads-chart-tick">{fmtValue(metric.format, r.value, currency)}</text>
              <rect x={0} y={y0 - 3} width={W} height={rowH} fill="transparent" onMouseEnter={() => setHover(i)} onMouseMove={() => setHover(i)} data-testid={`${testid}-hit-${i}`} />
            </g>
          );
        })}
      </svg>
    );
  }
  return (
    <div className="ads-rp-chartbox" data-testid={`${testid}-box`}>
      {svg}
      {h && (
        <Tip testid={testid} x={tipAt[0]} y={tipAt[1]} w={W} h={H}>
          <strong>{h.label}</strong>
          <span>
            <i style={{ background: CHART_COLORS[0] }} />
            {metric.label}: {fmtValue(metric.format, h.value, currency)}
            {compare ? change(h) : ''}
          </span>
          {compare && (
            <span>
              <i style={{ background: '#cbd5e1' }} />
              Previous period: {fmtValue(metric.format, h.prev ?? null, currency)}
            </span>
          )}
        </Tip>
      )}
      {compare && <Legend items={[{ label: 'This period', color: CHART_COLORS[0] }, { label: 'Previous period', color: '#cbd5e1' }]} />}
    </div>
  );
}

export interface StackGroup {
  label: string;
  parts: { key: string; value: number | null }[];
}

/** Columns split into stacked parts, e.g. age groups split by gender. */
export function StackedBarChart({
  groups, series, metric, currency, testid,
}: {
  groups: StackGroup[];
  series: { key: string; label: string }[];
  metric: ChartMetric;
  currency: string;
  testid: string;
}) {
  const [hover, setHover] = useState<{ g: number; s: number } | null>(null);
  const W = 720;
  const H = 240;
  const pad = { l: 56, r: 12, t: 12, b: 28 };
  const ih = H - pad.t - pad.b;
  const totals = groups.map((g) => g.parts.reduce((t, p) => t + (p.value ?? 0), 0));
  const max = niceMax(Math.max(0, ...totals));
  const step = (W - pad.l - pad.r) / Math.max(1, groups.length);
  const bw = Math.max(4, step * 0.6);
  const y = (v: number) => pad.t + ih - (v / max) * ih;
  const color = (k: string) => CHART_COLORS[Math.max(0, series.findIndex((s) => s.key === k)) % CHART_COLORS.length];
  const hg = hover ? groups[hover.g] : null;
  const hp = hover && hg ? hg.parts.find((p) => p.key === series[hover.s]?.key) : null;
  return (
    <div className="ads-rp-chartbox" data-testid={`${testid}-box`}>
      <svg viewBox={`0 0 ${W} ${H}`} className="ads-rp-chart" role="img" aria-label={`${metric.label}, stacked`} data-testid={testid} onMouseLeave={() => setHover(null)}>
        {ticksOf(max).map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="#eef2f7" />
            <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" className="ads-chart-tick">{fmtShort(metric.format, t, currency)}</text>
          </g>
        ))}
        {groups.map((g, gi) => {
          let acc = 0;
          const x0 = pad.l + step * gi + (step - bw) / 2;
          return (
            <g key={g.label}>
              {series.map((s, si) => {
                const v = g.parts.find((p) => p.key === s.key)?.value ?? 0;
                const top = y(acc + v);
                const hgt = y(acc) - top;
                acc += v;
                return (
                  <rect
                    key={s.key}
                    x={x0}
                    width={bw}
                    y={top}
                    height={Math.max(0, hgt)}
                    fill={color(s.key)}
                    opacity={hover && (hover.g !== gi || hover.s !== si) ? 0.55 : 1}
                    onMouseEnter={() => setHover({ g: gi, s: si })}
                    data-testid={`${testid}-hit-${gi}-${si}`}
                  />
                );
              })}
              <text x={x0 + bw / 2} y={H - 8} textAnchor="middle" className="ads-chart-tick">{g.label}</text>
            </g>
          );
        })}
      </svg>
      {hover && hg && (
        <Tip testid={testid} x={pad.l + step * hover.g + step / 2} y={pad.t} w={W} h={H}>
          <strong>
            {hg.label} · {series[hover.s]?.label}
          </strong>
          <span>
            <i style={{ background: color(series[hover.s]?.key || '') }} />
            {metric.label}: {fmtValue(metric.format, hp?.value ?? null, currency)}
          </span>
          <span>Group total: {fmtValue(metric.format, totals[hover.g], currency)}</span>
        </Tip>
      )}
      <Legend items={series.map((s) => ({ label: s.label, color: color(s.key) }))} />
    </div>
  );
}
