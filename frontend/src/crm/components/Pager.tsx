// Pagination for any list: "Showing 26–50 of 140", Previous / page numbers /
// Next, and rows per page. Lists are loaded in full and cut into pages here,
// so search, filters and sorting keep working on everything.
//
//   const paged = usePaged(rows, `${query}|${filter}`, { key: 'templates' });
//   paged.items.map(...)        // this page's rows
//   <Pager {...paged.pager} />  // below the list
//
// The page goes back to 1 when `resetKey` changes (new search, filter, tab)
// and is clamped when the list shrinks (a row deleted on the last page). The
// rows-per-page choice is remembered per list (`key`).
import { useEffect, useMemo, useRef, useState } from 'react';
import './Pager.css';

export const PAGE_SIZES = [10, 25, 50, 100];
/** Card grids: multiples of 2, 3 and 4 so rows come out full. */
export const CARD_PAGE_SIZES = [12, 24, 48, 96];

export interface PagerProps {
  page: number;
  pages: number;
  size: number;
  total: number;
  onPage: (p: number) => void;
  onSize: (n: number) => void;
  /** Singular / plural noun for the count, e.g. ['template', 'templates']. */
  noun?: [string, string];
  sizes?: number[];
  className?: string;
}

const storageKey = (key: string) => `crm_page_size:${key}`;
function storedSize(key: string | undefined, fallback: number, sizes: number[]): number {
  if (!key) return fallback;
  try {
    const n = Number(localStorage.getItem(storageKey(key)));
    return sizes.includes(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

export function usePaged<T>(
  items: T[],
  resetKey: unknown = '',
  opts: { key?: string; size?: number; sizes?: number[]; noun?: [string, string] } = {},
) {
  const sizes = opts.sizes || PAGE_SIZES;
  const [size, setSizeState] = useState(() => storedSize(opts.key, opts.size || sizes[1] || sizes[0], sizes));
  const [page, setPage] = useState(1);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setPage(1);
  }, [resetKey]);
  const total = items.length;
  const pages = size > 0 ? Math.max(1, Math.ceil(total / size)) : 1;
  const cur = Math.min(page, pages);
  const slice = useMemo(() => items.slice((cur - 1) * size, cur * size), [items, cur, size]);
  const setSize = (n: number) => {
    if (!sizes.includes(n)) return;
    // Keep the first row in view: the page that holds it at the new size.
    const firstRow = (cur - 1) * size;
    setSizeState(n);
    setPage(Math.floor(firstRow / n) + 1);
    if (opts.key) {
      try {
        localStorage.setItem(storageKey(opts.key), String(n));
      } catch {
        /* ignore */
      }
    }
  };
  return {
    items: slice,
    /** Index of this page's first row in the whole list. */
    offset: (cur - 1) * size,
    pager: { page: cur, pages, size, total, onPage: setPage, onSize: setSize, noun: opts.noun, sizes } as PagerProps,
  };
}

/** Page numbers with gaps: 1 … 4 5 6 … 12 */
function pageList(page: number, pages: number): (number | '…')[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const out: (number | '…')[] = [1];
  const from = Math.max(2, Math.min(page - 1, pages - 4));
  const to = Math.min(pages - 1, Math.max(page + 1, 5));
  if (from > 2) out.push('…');
  for (let i = from; i <= to; i += 1) out.push(i);
  if (to < pages - 1) out.push('…');
  out.push(pages);
  return out;
}

const fmt = new Intl.NumberFormat('en-IN');

export function Pager({ page, pages, size, total, onPage, onSize, noun = ['item', 'items'], sizes = PAGE_SIZES, className = '' }: PagerProps) {
  const ref = useRef<HTMLDivElement>(null);
  // Short lists don't need it.
  if (total <= sizes[0]) return null;
  const from = (page - 1) * size + 1;
  const to = Math.min(total, page * size);
  const go = (p: number) => {
    if (p < 1 || p > pages || p === page) return;
    onPage(p);
    // Back to the top of the list when it's scrolled out of view.
    const list = ref.current?.previousElementSibling as HTMLElement | null;
    if (list && list.getBoundingClientRect().top < 0) list.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };
  return (
    <div ref={ref} className={`k-pager ${className}`} data-testid="pager">
      <span className="k-pager-count" data-testid="pager-count">
        Showing <b>{fmt.format(from)}</b>–<b>{fmt.format(to)}</b> of <b>{fmt.format(total)}</b> {total === 1 ? noun[0] : noun[1]}
      </span>
      <nav className="k-pager-pages" aria-label="Pages">
        <button type="button" className="k-pager-btn" onClick={() => go(page - 1)} disabled={page <= 1} aria-label="Previous page" data-testid="pager-prev">
          <span className="material-icons" aria-hidden="true">chevron_left</span>
        </button>
        {pageList(page, pages).map((p, i) =>
          p === '…' ? (
            <span key={`gap${i}`} className="k-pager-gap" aria-hidden="true">…</span>
          ) : (
            <button
              key={p}
              type="button"
              className={`k-pager-btn num${p === page ? ' on' : ''}`}
              aria-current={p === page ? 'page' : undefined}
              aria-label={`Page ${p}`}
              onClick={() => go(p)}
            >
              {p}
            </button>
          ),
        )}
        <button type="button" className="k-pager-btn" onClick={() => go(page + 1)} disabled={page >= pages} aria-label="Next page" data-testid="pager-next">
          <span className="material-icons" aria-hidden="true">chevron_right</span>
        </button>
      </nav>
      <label className="k-pager-size">
        Rows per page
        <select value={size} onChange={(e) => onSize(Number(e.target.value))} data-testid="pager-size">
          {sizes.map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      </label>
    </div>
  );
}
