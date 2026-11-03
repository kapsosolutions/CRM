// Shared by the two node canvases (Journeys in FlowsPage.tsx, the Flows map in
// FlowBuilderPage.tsx): the "Organize" layout, which side a connection enters
// a block from, and the full-screen mode.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ControlButton } from 'reactflow';

export interface LayoutNode {
  id: string;
  width: number;
  height: number;
}
/** One output of a block, in the order the block shows them. */
export interface LayoutPort {
  id: string;
  side: 'right' | 'bottom';
  /** Not connected yet, so it shows a "+" (which takes room under the block). */
  free?: boolean;
}
export interface LayoutEdge {
  source: string;
  sourceHandle?: string | null;
  target: string;
}

const GAP_X = 160; // room for a side label and the "+" between columns
const GAP_Y = 40; // between two branches
const BRANCH_DROP = 24; // a bottom output's first branch starts this far under its labels

/**
 * "Organize": the flow reads left to right, one column per step, in the order
 * it runs.
 *
 * - Several outputs on the right (or one): what they lead to is centred on the
 *   block, so a single next step is level with it and the line is straight,
 *   and several fan out above and below it.
 * - Outputs along the bottom (buttons, options): what they lead to steps down
 *   from just under the block, first output at the top, so no line has to
 *   climb back over the block.
 * - A step reached from two places goes in the column after the later one.
 *   Each branch keeps its own band of rows, so nothing overlaps; connections
 *   that loop back (Start over) don't move anything.
 * - Blocks nothing leads to are laid out the same way underneath.
 */
export function organizeLayout(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  portsOf: (id: string) => LayoutPort[],
  rootId?: string,
): Map<string, { x: number; y: number }> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const ports = new Map(nodes.map((n) => [n.id, portsOf(n.id)]));
  const portIndex = (e: LayoutEdge) => {
    const i = (ports.get(e.source) || []).findIndex((p) => p.id === (e.sourceHandle || ''));
    return i < 0 ? 99 : i;
  };
  const portSide = (e: LayoutEdge) =>
    (ports.get(e.source) || []).find((p) => p.id === (e.sourceHandle || ''))?.side || 'right';
  const out = new Map<string, LayoutEdge[]>();
  for (const e of edges) {
    if (!byId.has(e.source) || !byId.has(e.target) || e.source === e.target) continue;
    out.set(e.source, [...(out.get(e.source) || []), e]);
  }
  for (const list of out.values()) list.sort((a, b) => portIndex(a) - portIndex(b));

  // 1. Depth-first from Start, then from anything still unvisited, to find the
  //    connections that loop back. Those are left out of the layout.
  const order: string[] = []; // first-visit order
  const state = new Map<string, 1 | 2>(); // 1 = on the path, 2 = done
  const back = new Set<LayoutEdge>();
  const visit = (root: string) => {
    const stack: { id: string; i: number }[] = [{ id: root, i: 0 }];
    state.set(root, 1);
    order.push(root);
    while (stack.length) {
      const top = stack[stack.length - 1];
      const list = out.get(top.id) || [];
      if (top.i >= list.length) {
        state.set(top.id, 2);
        stack.pop();
        continue;
      }
      const e = list[top.i++];
      const s = state.get(e.target);
      if (s === 1) back.add(e);
      else if (!s) {
        state.set(e.target, 1);
        order.push(e.target);
        stack.push({ id: e.target, i: 0 });
      }
    }
  };
  const hasIncoming = new Set(edges.map((e) => e.target));
  const roots: string[] = [];
  if (rootId && byId.has(rootId)) {
    roots.push(rootId);
    visit(rootId);
  }
  // Blocks nothing leads to first, then anything left (a loop with no way in).
  for (const pass of [true, false]) {
    for (const n of nodes) {
      if (state.has(n.id) || (pass && hasIncoming.has(n.id))) continue;
      roots.push(n.id);
      visit(n.id);
    }
  }

  // 2. Column = the longest way in from a root (so a shared step sits after
  //    every block that leads to it).
  const fwd = (id: string) => (out.get(id) || []).filter((e) => !back.has(e));
  const indeg = new Map<string, number>();
  for (const id of order) for (const e of fwd(id)) indeg.set(e.target, (indeg.get(e.target) || 0) + 1);
  const rank = new Map<string, number>();
  for (const r of roots) rank.set(r, r === rootId ? 0 : 1);
  const queue = order.filter((id) => !indeg.get(id));
  while (queue.length) {
    const id = queue.shift()!;
    if (!rank.has(id)) rank.set(id, 1);
    for (const e of fwd(id)) {
      rank.set(e.target, Math.max(rank.get(e.target) || 0, rank.get(id)! + 1));
      indeg.set(e.target, indeg.get(e.target)! - 1);
      if (!indeg.get(e.target)) queue.push(e.target);
    }
  }

  // 3. Each block hangs under one block in the column before it: the first
  //    one, in the order the flow was walked, that leads to it.
  const seen = new Map(order.map((id, i) => [id, i]));
  const kids = new Map<string, { id: string; side: 'right' | 'bottom' }[]>();
  const placed = new Set<string>(roots);
  for (const id of order) {
    for (const e of fwd(id)) {
      if (placed.has(e.target) || rank.get(e.target) !== rank.get(id)! + 1) continue;
      // Leave it for an earlier-walked block in the same column, if one leads to it.
      placed.add(e.target);
      kids.set(id, [...(kids.get(id) || []), { id: e.target, side: portSide(e) }]);
    }
  }
  // Anything not hung yet (its column-before block was walked later): under that block.
  for (const id of [...order].sort((a, b) => seen.get(a)! - seen.get(b)!)) {
    for (const e of fwd(id)) {
      if (placed.has(e.target)) continue;
      placed.add(e.target);
      kids.set(id, [...(kids.get(id) || []), { id: e.target, side: portSide(e) }]);
    }
  }

  // 4. Rows: each block's branches stacked in their own bands.
  const h = (id: string) => byId.get(id)!.height || 60;
  const below = (id: string) => {
    const bottom = (ports.get(id) || []).filter((p) => p.side === 'bottom');
    if (!bottom.length) return 0;
    return bottom.some((p) => p.free) ? 64 : 30;
  };
  const rel = new Map<string, number>(); // a block's top, relative to the block it hangs under
  const band = (id: string): { top: number; bottom: number } => {
    const ks = [...(kids.get(id) || [])].sort((a, b) => (a.side === b.side ? 0 : a.side === 'right' ? -1 : 1));
    const own = h(id) + below(id);
    if (!ks.length) return { top: 0, bottom: own };
    // Kids stacked from 0 down, each in its own band.
    let cursor = 0;
    const at = new Map<string, number>();
    for (const k of ks) {
      const b = band(k.id);
      at.set(k.id, cursor - b.top);
      cursor += b.bottom - b.top + GAP_Y;
    }
    const kidsBottom = cursor - GAP_Y;
    const right = ks.filter((k) => k.side === 'right');
    let self: number;
    if (right.length) {
      const first = at.get(right[0].id)! + h(right[0].id) / 2;
      const last = at.get(right[right.length - 1].id)! + h(right[right.length - 1].id) / 2;
      self = (first + last) / 2 - h(id) / 2;
    } else {
      self = at.get(ks[0].id)! - own - BRANCH_DROP;
    }
    for (const k of ks) rel.set(k.id, at.get(k.id)! - self);
    return { top: Math.min(0, self) - self, bottom: Math.max(kidsBottom, self + own) - self };
  };

  // 5. Columns: each clear of the widest block before it.
  const maxRank = Math.max(0, ...rank.values());
  const colW: number[] = Array.from({ length: maxRank + 1 }, () => 0);
  for (const n of nodes) colW[rank.get(n.id) || 0] = Math.max(colW[rank.get(n.id) || 0], n.width || 220);
  const colX: number[] = [];
  let x = 80;
  for (let r = 0; r <= maxRank; r += 1) {
    colX[r] = x;
    x += (colW[r] || 190) + GAP_X;
  }

  const pos = new Map<string, { x: number; y: number }>();
  let y = 80;
  for (const r of roots) {
    const b = band(r);
    const place = (id: string, top: number) => {
      pos.set(id, { x: colX[rank.get(id) || 0], y: Math.round(top) });
      for (const k of kids.get(id) || []) place(k.id, top + rel.get(k.id)!);
    };
    place(r, y - b.top);
    y += b.bottom - b.top + GAP_Y * 2.5;
  }
  return pos;
}

export type InSide = 'left' | 'top' | 'bottom';
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
/** React Flow handle id of each input side (left is the default, unnamed one). */
export const IN_HANDLE: Record<InSide, string | null> = { left: null, top: 'in-top', bottom: 'in-bottom' };

/**
 * Where a connection enters a block, from where the two blocks are: from the
 * left normally; from the top when the block sits under the one it comes from,
 * from the bottom when it sits above it. A block with outputs along its
 * bottom isn't entered from there.
 */
export function inSideFor(src: Rect | null, tgt: Rect | null, tgtHasBottomOuts: boolean): InSide {
  if (!src || !tgt || !src.w || !tgt.w) return 'left';
  const underOrOver = tgt.x < src.x + src.w && tgt.x + tgt.w > src.x - 60;
  if (!underOrOver) return 'left';
  if (tgt.y - (src.y + src.h) > 20) return 'top';
  if (src.y - (tgt.y + tgt.h) > 20 && !tgtHasBottomOuts) return 'bottom';
  return 'left';
}

/**
 * The canvas filling the screen. Uses the browser's full screen when it's
 * allowed, and covers the window either way; Esc (or the button) leaves it.
 */
export function useCanvasFullscreen(onToggle?: () => void) {
  const [full, setFull] = useState(false);
  const toggle = useCallback(() => setFull((f) => !f), []);
  const first = useRef(true);
  const cb = useRef(onToggle);
  cb.current = onToggle;
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    cb.current?.();
  }, [full]);
  useEffect(() => {
    if (!full) return undefined;
    // Still within the click's user activation, so the browser allows it.
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
    const onFs = () => {
      if (!document.fullscreenElement) setFull(false);
    };
    const onKey = (e: KeyboardEvent) => {
      // Esc closes an open pop-up first.
      if (e.key === 'Escape' && !document.querySelector('.jn-modal-backdrop, .pdfd-overlay, .app-dialog, .disc-backdrop')) setFull(false);
    };
    document.addEventListener('fullscreenchange', onFs);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('fullscreenchange', onFs);
      window.removeEventListener('keydown', onKey);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, [full]);
  return { full, toggle };
}

/** The maximise / minimise button, with the zoom controls. */
export function FullscreenButton({ full, onClick }: { full: boolean; onClick: () => void }) {
  const label = full ? 'Exit full screen (Esc)' : 'Full screen';
  return (
    <ControlButton onClick={onClick} title={label} aria-label={label} className="canvas-full-btn" data-testid="canvas-fullscreen">
      <span className="material-icons" aria-hidden="true">{full ? 'close_fullscreen' : 'open_in_full'}</span>
    </ControlButton>
  );
}
