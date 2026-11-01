// SVG charts for the admin dashboard, drawn like the "Rocker" dark admin
// template: smooth lines over gradient areas, rounded gradient bars with a
// white outline, a donut with white separators, and mini-bar sparklines.
// No chart library. Each chart sizes itself to its box (ResizeObserver),
// shows a tooltip on hover / touch, and is described for screen readers.
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/** The element's width in px, kept up to date. */
export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const set = () => setWidth(Math.floor(el.getBoundingClientRect().width));
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** A round axis 0..max in `ticks` steps of 1, 2, 2.5 or 5 × 10ⁿ. */
export function niceScale(max: number, ticks = 5, integer = false) {
  if (!(max > 0)) return { max: ticks, step: 1 };
  const raw = max / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  let step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  if (integer) step = Math.max(1, Math.ceil(step));
  return { max: step * Math.ceil(max / step - 1e-9), step };
}

/** Smooth curve through the points that never overshoots (monotone cubic). */
export function monotonePath(pts: [number, number][]): string {
  const n = pts.length;
  if (!n) return '';
  if (n === 1) return `M${pts[0][0]},${pts[0][1]}`;
  const dx: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    dx[i] = pts[i + 1][0] - pts[i][0];
    m[i] = dx[i] ? (pts[i + 1][1] - pts[i][1]) / dx[i] : 0;
  }
  const t: number[] = new Array(n);
  t[0] = m[0];
  t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i += 1) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  for (let i = 0; i < n - 1; i += 1) {
    if (m[i] === 0) {
      t[i] = 0;
      t[i + 1] = 0;
    } else {
      const a = t[i] / m[i];
      const b = t[i + 1] / m[i];
      const s = a * a + b * b;
      if (s > 9) {
        const k = 3 / Math.sqrt(s);
        t[i] = k * a * m[i];
        t[i + 1] = k * b * m[i];
      }
    }
  }
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < n - 1; i += 1) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const h = dx[i] / 3;
    d += ` C${x0 + h},${y0 + t[i] * h} ${x1 - h},${y1 - t[i + 1] * h} ${x1},${y1}`;
  }
  return d;
}

const cleanId = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '');

interface TipProps {
  x: number;
  top: number;
  width: number;
  title: string;
  children: ReactNode;
}
/** The dark tooltip box, kept inside the chart. */
function Tip({ x, top, width, title, children }: TipProps) {
  const right = x > width * 0.62;
  return (
    <div
      className={`pd-tip${right ? ' left' : ''}`}
      style={right ? { right: Math.max(4, width - x + 12), top } : { left: Math.min(x + 12, width - 4), top }}
      role="status"
    >
      <div className="pd-tip-title">{title}</div>
      {children}
    </div>
  );
}

export function TipRow({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="pd-tip-row">
      <span className="pd-tip-dot" style={{ background: color }} />
      <span className="pd-tip-label">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

// ------------------------------------------------------------- area chart --
export interface AreaSeries {
  key: string;
  label: string;
  /** Line + legend colour. */
  color: string;
  /** A left → right gradient for the line (the template's orange-to-red line). */
  stroke?: [string, string];
  values: number[];
}

export function AreaChart({
  labels,
  titles,
  series,
  height = 300,
  integer = false,
  axisFormat = (v) => String(v),
  format = (v) => String(v),
  ariaLabel,
}: {
  labels: string[];
  /** Tooltip heading per point (full date). */
  titles?: string[];
  series: AreaSeries[];
  height?: number;
  integer?: boolean;
  axisFormat?: (v: number) => string;
  format?: (v: number) => string;
  ariaLabel: string;
}) {
  const uid = cleanId(useId());
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const [hover, setHover] = useState<number | null>(null);
  const shown = series.filter((s) => !hidden[s.key]);
  const { max: yMax, step } = niceScale(Math.max(0, ...shown.flatMap((s) => s.values)), 5, integer);
  const ticks = Array.from({ length: Math.round(yMax / step) + 1 }, (_, i) => i * step);
  const longest = Math.max(...ticks.map((v) => axisFormat(v).length));
  const svgH = height - 34;
  const pad = { top: 12, right: 14, bottom: 28, left: Math.max(30, longest * 6.6 + 14) };
  const innerW = Math.max(1, width - pad.left - pad.right);
  const innerH = Math.max(1, svgH - pad.top - pad.bottom);
  const n = labels.length;
  const x = (i: number) => pad.left + (n <= 1 ? innerW / 2 : (i * innerW) / (n - 1));
  const y = (v: number) => pad.top + innerH - (Math.max(0, v) / yMax) * innerH;
  const base = pad.top + innerH;
  // A handful of points per line: cheap enough to work out on every render.
  const paths = series.map((s) => {
    const pts = s.values.map((v, i) => [x(i), y(v)] as [number, number]);
    const line = monotonePath(pts);
    return { key: s.key, line, area: pts.length ? `${line} L${x(n - 1)},${base} L${x(0)},${base} Z` : '' };
  });

  const onMove = (clientX: number, svg: SVGSVGElement | null) => {
    if (n < 1 || !svg) return;
    const left = svg.getBoundingClientRect().left;
    const i = n <= 1 ? 0 : Math.round(((clientX - left - pad.left) / innerW) * (n - 1));
    setHover(Math.min(n - 1, Math.max(0, i)));
  };

  return (
    <div className="pd-chart" ref={ref} style={{ height }}>
      <div className="pd-legend" role="group" aria-label="Show or hide a line">
        {series.map((s) => (
          <button
            key={s.key}
            type="button"
            className={`pd-legend-item${hidden[s.key] ? ' off' : ''}`}
            aria-pressed={!hidden[s.key]}
            onClick={() => setHidden((h) => ({ ...h, [s.key]: !h[s.key] }))}
          >
            <span className="pd-legend-swatch" style={{ borderColor: s.color }} />
            {s.label}
          </button>
        ))}
      </div>
      {width > 0 && (
        <svg width={width} height={svgH} role="img" aria-label={ariaLabel} className="pd-svg">
          <defs>
            {series.map((s) => (
              <linearGradient key={s.key} id={`${uid}-a-${s.key}`} gradientUnits="userSpaceOnUse" x1="0" y1={pad.top} x2="0" y2={base}>
                <stop offset="0%" stopColor={s.color} stopOpacity="0.42" />
                <stop offset="100%" stopColor={s.color} stopOpacity="0.02" />
              </linearGradient>
            ))}
            {series.filter((s) => s.stroke).map((s) => (
              <linearGradient key={s.key} id={`${uid}-l-${s.key}`} gradientUnits="userSpaceOnUse" x1={pad.left} y1="0" x2={pad.left + innerW} y2="0">
                <stop offset="0%" stopColor={s.stroke![0]} />
                <stop offset="100%" stopColor={s.stroke![1]} />
              </linearGradient>
            ))}
          </defs>
          {ticks.map((v) => (
            <g key={v}>
              <line className="pd-grid" x1={pad.left} x2={pad.left + innerW} y1={y(v)} y2={y(v)} />
              <text className="pd-axis" x={pad.left - 10} y={y(v)} textAnchor="end" dominantBaseline="middle">{axisFormat(v)}</text>
            </g>
          ))}
          {labels.map((l, i) => (
            <text key={`${l}-${i}`} className="pd-axis" x={x(i)} y={base + 18} textAnchor="middle">{l}</text>
          ))}
          {series.map((s, si) => !hidden[s.key] && (
            <g key={`${s.key}-${labels.join()}`} className="pd-area-group">
              <path className="pd-area" d={paths[si].area} fill={`url(#${uid}-a-${s.key})`} />
              <path
                className="pd-line"
                d={paths[si].line}
                pathLength={1}
                stroke={s.stroke ? `url(#${uid}-l-${s.key})` : s.color}
              />
            </g>
          ))}
          {hover !== null && (
            <g className="pd-hover" aria-hidden="true">
              <line x1={x(hover)} x2={x(hover)} y1={pad.top} y2={base} />
              {shown.map((s) => (
                <circle key={s.key} cx={x(hover)} cy={y(s.values[hover] || 0)} r="4.5" fill={s.color} />
              ))}
            </g>
          )}
          <rect
            className="pd-hit"
            x={pad.left - 8}
            y={pad.top}
            width={innerW + 16}
            height={innerH}
            onPointerMove={(e) => onMove(e.clientX, e.currentTarget.ownerSVGElement)}
            onPointerDown={(e) => onMove(e.clientX, e.currentTarget.ownerSVGElement)}
            onPointerLeave={() => setHover(null)}
          />
        </svg>
      )}
      {hover !== null && width > 0 && (
        <Tip x={x(hover)} top={pad.top + 30} width={width} title={titles?.[hover] || labels[hover]}>
          {shown.map((s) => (
            <TipRow key={s.key} color={s.color} label={s.label} value={format(s.values[hover] || 0)} />
          ))}
        </Tip>
      )}
    </div>
  );
}

// -------------------------------------------------------------- bar chart --
export function BarChart({
  labels,
  titles,
  values,
  height = 300,
  integer = true,
  gradient = ['#ee0979', '#ff6a00'],
  axisFormat = (v) => String(v),
  tooltip,
  ariaLabel,
}: {
  labels: string[];
  titles?: string[];
  values: number[];
  height?: number;
  integer?: boolean;
  /** Top → bottom colours of every bar. */
  gradient?: [string, string];
  axisFormat?: (v: number) => string;
  /** Tooltip rows for bar i. */
  tooltip: (i: number) => ReactNode;
  ariaLabel: string;
}) {
  const uid = cleanId(useId());
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const { max: yMax, step } = niceScale(Math.max(0, ...values), 7, integer);
  const ticks = Array.from({ length: Math.round(yMax / step) + 1 }, (_, i) => i * step);
  const longest = Math.max(...ticks.map((v) => axisFormat(v).length));
  const pad = { top: 16, right: 10, bottom: 28, left: Math.max(26, longest * 6.6 + 12) };
  const innerW = Math.max(1, width - pad.left - pad.right);
  const innerH = Math.max(1, height - pad.top - pad.bottom);
  const n = values.length;
  const slot = innerW / Math.max(1, n);
  const barW = Math.max(8, Math.min(22, slot * 0.34));
  const y = (v: number) => pad.top + innerH - (Math.max(0, v) / yMax) * innerH;
  const base = pad.top + innerH;

  const bar = (i: number) => {
    const v = values[i] || 0;
    if (v <= 0) return null;
    const x0 = pad.left + slot * i + (slot - barW) / 2;
    const top = y(v);
    const h = base - top;
    const r = Math.min(barW / 2, h);
    return `M${x0},${base} L${x0},${top + r} A${r},${r} 0 0 1 ${x0 + barW},${top + r} L${x0 + barW},${base} Z`;
  };

  return (
    <div className="pd-chart" ref={ref} style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={ariaLabel} className="pd-svg">
          <defs>
            <linearGradient id={`${uid}-bar`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={gradient[0]} />
              <stop offset="100%" stopColor={gradient[1]} />
            </linearGradient>
          </defs>
          {ticks.map((v) => (
            <g key={v}>
              <line className="pd-grid" x1={pad.left} x2={pad.left + innerW} y1={y(v)} y2={y(v)} />
              <text className="pd-axis" x={pad.left - 10} y={y(v)} textAnchor="end" dominantBaseline="middle">{axisFormat(v)}</text>
            </g>
          ))}
          {labels.map((l, i) => (
            <text key={`${l}-${i}`} className="pd-axis" x={pad.left + slot * i + slot / 2} y={base + 18} textAnchor="middle">{l}</text>
          ))}
          <g key={labels.join()} className="pd-bars">
            {values.map((_, i) => {
              const d = bar(i);
              return d ? (
                <path
                  key={i}
                  d={d}
                  className={`pd-bar${hover === i ? ' on' : ''}`}
                  fill={`url(#${uid}-bar)`}
                  style={{ animationDelay: `${i * 45}ms` }}
                />
              ) : null;
            })}
          </g>
          {values.map((_, i) => (
            <rect
              key={i}
              className="pd-hit"
              x={pad.left + slot * i}
              y={pad.top}
              width={slot}
              height={innerH}
              onPointerEnter={() => setHover(i)}
              onPointerDown={() => setHover(i)}
              onPointerLeave={() => setHover((h) => (h === i ? null : h))}
            />
          ))}
        </svg>
      )}
      {hover !== null && width > 0 && (
        <Tip x={pad.left + slot * hover + slot / 2} top={Math.max(8, y(values[hover] || 0) - 10)} width={width} title={titles?.[hover] || labels[hover]}>
          {tooltip(hover)}
        </Tip>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ donut --
export interface DonutSlice {
  key: string;
  label: string;
  value: number;
  color: string;
}

export function DonutChart({
  slices,
  size = 230,
  thickness = 34,
  centerValue,
  centerLabel,
  ariaLabel,
  active,
  onActive,
}: {
  slices: DonutSlice[];
  size?: number;
  thickness?: number;
  centerValue: string;
  centerLabel: string;
  ariaLabel: string;
  /** Highlighted slice (hover here or in the list). */
  active: string | null;
  onActive: (key: string | null) => void;
}) {
  const total = slices.reduce((a, s) => a + s.value, 0);
  const R = size / 2 - 4;
  const r = R - thickness;
  const c = size / 2;
  const pt = (rad: number, a: number) => `${c + rad * Math.cos(a)},${c + rad * Math.sin(a)}`;
  let a0 = -Math.PI / 2;
  const arcs = slices
    .filter((s) => s.value > 0)
    .map((s) => {
      const sweep = Math.min((s.value / total) * Math.PI * 2, Math.PI * 2 - 1e-4);
      const a1 = a0 + sweep;
      const large = sweep > Math.PI ? 1 : 0;
      const d = `M${pt(R, a0)} A${R},${R} 0 ${large} 1 ${pt(R, a1)} L${pt(r, a1)} A${r},${r} 0 ${large} 0 ${pt(r, a0)} Z`;
      a0 = a1;
      return { ...s, d };
    });
  const hot = slices.find((s) => s.key === active) || null;
  return (
    <div className="pd-donut" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={ariaLabel}>
        {total === 0 ? (
          <circle cx={c} cy={c} r={R - thickness / 2} className="pd-donut-empty" strokeWidth={thickness} fill="none" />
        ) : (
          arcs.map((s) => (
            <path
              key={s.key}
              d={s.d}
              fill={s.color}
              className={`pd-donut-seg${active && active !== s.key ? ' dim' : ''}`}
              onPointerEnter={() => onActive(s.key)}
              onPointerLeave={() => onActive(null)}
            >
              <title>{`${s.label}: ${s.value}`}</title>
            </path>
          ))
        )}
      </svg>
      <div className="pd-donut-center" aria-hidden="true">
        <strong>{hot ? hot.value : centerValue}</strong>
        <span>{hot ? hot.label : centerLabel}</span>
      </div>
    </div>
  );
}

// -------------------------------------------------------------- sparkline --
/** Thin bars, one per day (the template's mini charts on each stat card). */
export function Sparkline({ values, color, height = 28 }: { values: number[]; color: string; height?: number }) {
  const max = Math.max(0, ...values);
  const w = values.length * 5;
  return (
    <svg className="pd-spark" viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" height={height} aria-hidden="true">
      {values.map((v, i) => {
        const h = max > 0 && v > 0 ? Math.max(2.5, (v / max) * (height - 1)) : 1.5;
        return <rect key={i} x={i * 5 + 0.6} y={height - h} width={3} height={h} rx={0.8} fill={color} opacity={v > 0 ? 1 : 0.3} />;
      })}
    </svg>
  );
}

/** A shimmering placeholder block while data loads. */
export function Skel({ w, h, r = 6, className = '' }: { w?: number | string; h: number | string; r?: number; className?: string }) {
  return <span className={`pd-skel ${className}`} style={{ width: w ?? '100%', height: h, borderRadius: r }} aria-hidden="true" />;
}
