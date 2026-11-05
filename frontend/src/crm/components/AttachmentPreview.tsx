// WhatsApp-style attachment preview (shown inside the conversation panel).
// Supports MULTIPLE files with a vertical thumbnail strip + "+" to add more.
// Images get a small editor: crop (8 handles + move) and rotate, freehand
// drawing, text, blurred / pixelated boxes, undo / redo, copy and download.
// Edits are kept per file as a list of operations (../mediaEdit.ts) and burned
// into the file on Send. Per-file caption. Light CRM theme.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useBackHandler } from '../useBackHandler';
import { uiScale } from '../uiScale';
import {
  applyOps,
  canvasToFile,
  flatten,
  opId,
  paintOps,
  TEXT_FONT,
  type BlurOp,
  type BlurStyle,
  type EditOp,
  type StrokeOp,
  type TextOp,
} from '../mediaEdit';
import {
  BlurIcon,
  CopyIcon,
  CropRotateIcon,
  DownloadIcon,
  EditIcon,
  PixelateIcon,
  RedoIcon,
  UndoIcon,
} from './AppIcons';

interface Snap {
  file: File;
  ops: EditOp[];
}
interface Item extends Snap {
  original: File;
  caption: string;
  past: Snap[];
  future: Snap[];
}

interface Props {
  files: File[];
  sending: boolean;
  onCancel: () => void;
  onSend: (items: { file: File; caption: string }[]) => void;
}

type Kind = 'image' | 'video' | 'audio' | 'pdf' | 'doc';
type Mode = 'none' | 'crop' | 'draw' | 'text' | 'blur';
type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
type CropStep = { kind: 'box'; box: Box } | { kind: 'file' };

const MIN = 24;
const HISTORY = 60;
const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const COLORS = ['#3b3b3b', '#9ca3af', '#ffffff', '#22d3ee', '#65d630', '#c084fc', '#fb923c', '#ef4444'];
// Brush sizes and the text size, in on-screen (CSS) px; stored in image px.
const BRUSHES = [3, 6, 11, 18];
const TEXT_PX = 30;
const PREVIEW_MAX = 1600; // the live canvas never needs more pixels than this
const RAIL = 84; // room kept on each side for the thumbnail strip / rotate buttons
const MEDIA_MAX_W = 760;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));
const newItem = (f: File): Item => ({ file: f, original: f, caption: '', ops: [], past: [], future: [] });

function kindOf(file: File): Kind {
  const t = file.type;
  if (t.startsWith('image/')) return 'image';
  if (t.startsWith('video/')) return 'video';
  if (t.startsWith('audio/')) return 'audio';
  if (t === 'application/pdf' || /\.pdf$/i.test(file.name)) return 'pdf';
  return 'doc';
}

function prettySize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** The box dragged out from (x0,y0) to (x1,y1), whichever way the drag went. */
function spanBox(x0: number, y0: number, x1: number, y1: number) {
  return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
}

/** Resize / move a box by (dx, dy) for the given handle, inside W×H. */
function dragBox(b: Box, mode: Handle | 'move', dx: number, dy: number, W: number, H: number, min: number): Box {
  if (mode === 'move') {
    return { x: clamp(b.x + dx, 0, W - b.w), y: clamp(b.y + dy, 0, H - b.h), w: b.w, h: b.h };
  }
  let l = b.x;
  let t = b.y;
  let r = b.x + b.w;
  let bot = b.y + b.h;
  if (mode.includes('w')) l = clamp(b.x + dx, 0, r - min);
  if (mode.includes('e')) r = clamp(b.x + b.w + dx, l + min, W);
  if (mode.includes('n')) t = clamp(b.y + dy, 0, bot - min);
  if (mode.includes('s')) bot = clamp(b.y + b.h + dy, t + min, H);
  return { x: l, y: t, w: r - l, h: bot - t };
}

// Small self-contained thumbnail that manages its own object URL.
function Thumb({ file }: { file: File }) {
  const [u, setU] = useState('');
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setU(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  if (file.type.startsWith('image/')) return <img src={u} alt="" />;
  if (file.type.startsWith('video/')) return <span className="material-icons">movie</span>;
  if (file.type.startsWith('audio/')) return <span className="material-icons">audiotrack</span>;
  return <span className="material-icons">description</span>;
}

/** The 8 preset colours plus a rainbow swatch that opens the system colour picker. */
function Swatches({
  value,
  onPick,
  onCustom,
  onCustomOpen,
  keepFocus,
}: {
  value: string;
  onPick: (c: string) => void;
  onCustom: (c: string) => void;
  onCustomOpen?: () => void;
  keepFocus?: boolean; // don't take focus from the text being typed
}) {
  const custom = !COLORS.includes(value.toLowerCase());
  return (
    <div className="att-swatches">
      {COLORS.map((c) => (
        <button
          key={c}
          type="button"
          className={`att-swatch${value === c ? ' on' : ''}`}
          style={{ background: c }}
          onMouseDown={keepFocus ? (e) => e.preventDefault() : undefined}
          onClick={() => onPick(c)}
          aria-label={`Colour ${c}`}
          data-testid="att-color"
        />
      ))}
      <label className={`att-swatch att-swatch-custom${custom ? ' on' : ''}`} title="Pick any colour">
        {custom && <span className="att-swatch-dot" style={{ background: value }} />}
        <input
          type="color"
          value={/^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : '#000000'}
          onClick={onCustomOpen}
          onChange={(e) => onCustom(e.target.value)}
          aria-label="Pick any colour"
          data-testid="att-color-custom"
        />
      </label>
    </div>
  );
}

/** "Aa" — the text tool. */
function TextToolIcon() {
  return (
    <span className="att-aa" aria-hidden="true">
      Aa
    </span>
  );
}

export function AttachmentPreview({ files, sending, onCancel, onSend }: Props) {
  const [items, setItems] = useState<Item[]>(() => files.map(newItem));
  const [active, setActive] = useState(0);
  const [url, setUrl] = useState('');
  const [showDiscard, setShowDiscard] = useState(false);
  const [mode, setMode] = useState<Mode>('none');
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState('');

  // tool settings
  const [drawColor, setDrawColor] = useState('#65d630');
  const [brush, setBrush] = useState(1);
  const [textColor, setTextColor] = useState('#ffffff');
  const [blurStyle, setBlurStyle] = useState<BlurStyle>('pixelate');
  const [blurAmount, setBlurAmount] = useState(50);
  const [styleMenu, setStyleMenu] = useState(false);

  // selection
  const [selBlur, setSelBlur] = useState<string | null>(null);
  const [selText, setSelText] = useState<string | null>(null);
  const [editText, setEditTextState] = useState<string | null>(null);
  // Mirrors editText synchronously, so finishing an edit twice in one event
  // (Enter, then the input's blur) only finishes it once.
  const editRef = useRef<string | null>(null);
  const setEditText = (id: string | null) => {
    editRef.current = id;
    setEditTextState(id);
  };
  const newTextRef = useRef<string | null>(null); // the text being typed was just added
  const editMarked = useRef(false); // a history step exists for this text edit
  const sliderMarked = useRef(false);

  const current = items[active];
  const kind = current ? kindOf(current.file) : 'doc';
  const cropping = mode === 'crop';
  const ops = current?.ops ?? [];

  const imgRef = useRef<HTMLImageElement>(null);
  const inkRef = useRef<HTMLCanvasElement>(null);
  const addRef = useRef<HTMLInputElement>(null);
  // natural size + displayed (CSS px) width of the active image
  const [dims, setDims] = useState({ nw: 0, nh: 0, cw: 0 });
  const [loaded, setLoaded] = useState(0); // bumped on every image load (repaint)
  const k = dims.nw ? dims.cw / dims.nw : 1; // CSS px per image px

  const [box, setBox] = useState<Box | null>(null);
  const boxRef = useRef<Box | null>(null);
  useEffect(() => {
    boxRef.current = box;
  }, [box]);
  const drag = useRef<{ mode: Handle | 'move'; startX: number; startY: number; box: Box } | null>(null);
  // Undo / redo while cropping: moves of the crop box, plus rotations and
  // Reset (those are file changes, undone through the main history).
  const [cropPast, setCropPast] = useState<CropStep[]>([]);
  const [cropFuture, setCropFuture] = useState<CropStep[]>([]);
  const pickerMarked = useRef(false); // one undo step per custom-colour pick

  // The stage's inner size: the photo is fitted inside it (CSS px).
  const stageRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = stageRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const read = () => {
      const cs = getComputedStyle(el);
      const w = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const h = el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      setFit((f) => (f && f.w === w && f.h === h ? f : { w, h }));
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ---------- history ----------
  const updateActive = useCallback(
    (fn: (it: Item) => Item) => setItems((prev) => prev.map((it, i) => (i === active ? fn(it) : it))),
    [active],
  );
  const snapOf = (it: Item): Snap => ({ file: it.file, ops: it.ops });
  /** Record the current state as an undo step, then apply `patch`. */
  const commit = useCallback(
    (patch: Partial<Snap> = {}) =>
      updateActive((it) => ({ ...it, past: [...it.past, snapOf(it)].slice(-HISTORY), future: [], ...patch })),
    [updateActive],
  );
  const commitOps = (fn: (o: EditOp[]) => EditOp[]) =>
    updateActive((it) => ({ ...it, past: [...it.past, snapOf(it)].slice(-HISTORY), future: [], ops: fn(it.ops) }));
  /** Change the edits without a new undo step (mid-drag, typing). */
  const liveOps = useCallback(
    (fn: (o: EditOp[]) => EditOp[]) => updateActive((it) => ({ ...it, ops: fn(it.ops) })),
    [updateActive],
  );
  const patchOp = (id: string, patch: Partial<EditOp>) =>
    liveOps((o) => o.map((x) => (x.id === id ? ({ ...x, ...patch } as EditOp) : x)));

  const clearSelection = () => {
    setSelBlur(null);
    setSelText(null);
    setEditText(null);
    newTextRef.current = null;
    setStyleMenu(false);
  };

  function undo() {
    clearSelection();
    updateActive((it) => {
      const prev = it.past[it.past.length - 1];
      if (!prev) return it;
      return { ...it, ...prev, past: it.past.slice(0, -1), future: [snapOf(it), ...it.future] };
    });
  }
  function redo() {
    clearSelection();
    updateActive((it) => {
      const next = it.future[0];
      if (!next) return it;
      return { ...it, ...next, past: [...it.past, snapOf(it)].slice(-HISTORY), future: it.future.slice(1) };
    });
  }

  // ---------- text editing ----------
  function finishText() {
    const id = editRef.current;
    if (!id) return;
    const wasNew = newTextRef.current === id;
    setEditText(null);
    newTextRef.current = null;
    // Left empty: remove it. A text that was just added goes as if it never
    // happened (its undo step too).
    updateActive((it) => {
      const op = it.ops.find((o) => o.id === id);
      if (!op || op.kind !== 'text' || op.text.trim()) return it;
      return { ...it, ops: it.ops.filter((o) => o.id !== id), past: wasNew ? it.past.slice(0, -1) : it.past };
    });
  }

  function addText(x?: number, y?: number) {
    if (!dims.nw) return;
    const id = opId();
    const t: TextOp = {
      kind: 'text',
      id,
      text: '',
      color: textColor,
      x: x ?? dims.nw / 2,
      y: y ?? dims.nh / 2,
      size: TEXT_PX / k,
    };
    commitOps((o) => [...o, t]);
    newTextRef.current = id;
    editMarked.current = true;
    setSelText(id);
    setEditText(id);
  }

  function typeText(id: string, text: string) {
    if (!editMarked.current) {
      commit();
      editMarked.current = true;
    }
    patchOp(id, { text });
  }

  function startEdit(id: string) {
    editMarked.current = false;
    newTextRef.current = null;
    setSelText(id);
    setEditText(id);
  }

  function deleteSelected() {
    const id = mode === 'blur' ? selBlur : editText || selText;
    if (!id || !ops.some((o) => o.id === id)) return;
    if (id === newTextRef.current) {
      updateActive((it) => ({ ...it, ops: it.ops.filter((o) => o.id !== id), past: it.past.slice(0, -1) }));
    } else {
      commitOps((o) => o.filter((x) => x.id !== id));
    }
    clearSelection();
  }

  // ---------- modes ----------
  function switchMode(next: Mode) {
    finishText();
    setStyleMenu(false);
    setSelBlur(null);
    setSelText(null);
    const m = mode === next ? 'none' : next;
    setMode(m);
    if (m === 'crop') {
      setBox(fullBox());
      setCropPast([]);
      setCropFuture([]);
    }
    if (m === 'text' && !ops.some((o) => o.kind === 'text')) addText();
    if (m === 'blur') {
      const blurs = ops.filter((o) => o.kind === 'blur');
      if (blurs.length) setSelBlur(blurs[blurs.length - 1].id);
      else if (dims.nw) {
        // Start with a box in the middle so the tool shows what it does.
        const b: BlurOp = {
          kind: 'blur',
          id: opId(),
          x: dims.nw * 0.3,
          y: dims.nh * 0.3,
          w: dims.nw * 0.4,
          h: dims.nh * 0.4,
          style: blurStyle,
          amount: blurAmount,
        };
        commitOps((o) => [...o, b]);
        setSelBlur(b.id);
      }
    }
  }
  const leaveMode = () => {
    finishText();
    clearSelection();
    setMode('none');
  };

  // Back behaves like Esc: leave the current tool, else ask before discarding
  // (and a second Back with that prompt up keeps the selection).
  useBackHandler(true, () => {
    if (mode !== 'none') leaveMode();
    else setShowDiscard((open) => !open);
  });

  // Object URL for the active file (effect-based so StrictMode stays valid).
  useEffect(() => {
    if (!current) return;
    const u = URL.createObjectURL(current.file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [current?.file]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (e.key === 'Escape') {
        if (editText) finishText();
        else if (mode !== 'none') leaveMode();
        else setShowDiscard(true);
        return;
      }
      if (typing || kind !== 'image' || !(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        doUndo();
      } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
        e.preventDefault();
        doRedo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Keep the image's sizes in state (they drive overlay positions).
  const measure = useCallback(() => {
    const img = imgRef.current;
    if (!img || !img.naturalWidth) return;
    setDims((d) =>
      d.nw === img.naturalWidth && d.nh === img.naturalHeight && d.cw === img.clientWidth
        ? d
        : { nw: img.naturalWidth, nh: img.naturalHeight, cw: img.clientWidth },
    );
  }, []);
  useEffect(() => {
    const img = imgRef.current;
    if (!img || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(img);
    return () => ro.disconnect();
  }, [measure, kind, url]);

  // Paint strokes and blurs over the photo.
  useLayoutEffect(() => {
    const img = imgRef.current;
    const c = inkRef.current;
    if (!c) return;
    if (!img || !dims.nw || !img.complete || img.naturalWidth !== dims.nw) {
      // New photo still loading: don't leave the old one's edits on screen.
      c.getContext('2d')?.clearRect(0, 0, c.width, c.height);
      return;
    }
    const ps = Math.min(1, PREVIEW_MAX / Math.max(dims.nw, dims.nh));
    const w = Math.round(dims.nw * ps);
    const h = Math.round(dims.nh * ps);
    if (c.width !== w) c.width = w;
    if (c.height !== h) c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.setTransform(ps, 0, 0, ps, 0, 0);
    paintOps(ctx, img, dims.nw, dims.nh, ops, false);
  }, [ops, dims, url, loaded]);

  const patchActive = (file: File) => commit({ file, ops: [] });

  function switchTo(i: number) {
    leaveMode();
    setActive(i);
  }

  function addMore(e: React.ChangeEvent<HTMLInputElement>) {
    const more = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    if (!more.length) return;
    setItems((prev) => [...prev, ...more.map(newItem)]);
  }

  function removeActive() {
    leaveMode();
    setItems((prev) => prev.filter((_, i) => i !== active));
    setActive((a) => Math.max(0, a - (a > 0 ? 1 : 0)));
  }

  // ---------- pointer helpers for draw / text / blur (image px) ----------
  function track(
    e: React.PointerEvent,
    onMove: (dx: number, dy: number, x: number, y: number) => void,
    onEnd?: (moved: boolean) => void,
  ) {
    e.preventDefault();
    e.stopPropagation();
    const img = imgRef.current;
    if (!img) return;
    // Mouse positions and the rect are both screen px, so their ratio is safe
    // under the CRM's CSS zoom.
    const r = img.getBoundingClientRect();
    const fx = img.naturalWidth / r.width;
    const fy = img.naturalHeight / r.height;
    const sx = e.clientX;
    const sy = e.clientY;
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < 4) return;
      moved = true;
      onMove(
        (ev.clientX - sx) * fx,
        (ev.clientY - sy) * fy,
        clamp((ev.clientX - r.left) * fx, 0, img.naturalWidth),
        clamp((ev.clientY - r.top) * fy, 0, img.naturalHeight),
      );
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      onEnd?.(moved);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  function pointAt(e: React.PointerEvent) {
    const img = imgRef.current!;
    const r = img.getBoundingClientRect();
    return {
      x: clamp(((e.clientX - r.left) / r.width) * img.naturalWidth, 0, img.naturalWidth),
      y: clamp(((e.clientY - r.top) / r.height) * img.naturalHeight, 0, img.naturalHeight),
    };
  }

  // Pointer down on the photo itself (not on a text or a blur box).
  function onLayerDown(e: React.PointerEvent) {
    if (e.button !== 0 || !imgRef.current) return;
    const p = pointAt(e);
    if (mode === 'draw') {
      const id = opId();
      const s: StrokeOp = { kind: 'stroke', id, color: drawColor, size: BRUSHES[brush] / k, pts: [p.x, p.y] };
      commitOps((o) => [...o, s]);
      track(e, (_dx, _dy, x, y) =>
        liveOps((o) => o.map((op) => (op.id === id && op.kind === 'stroke' ? { ...op, pts: [...op.pts, x, y] } : op))),
      );
      return;
    }
    if (mode === 'text') {
      e.preventDefault();
      if (editText) finishText();
      else addText(p.x, p.y);
      return;
    }
    if (mode === 'blur') {
      setStyleMenu(false);
      const id = opId();
      let made = false;
      track(
        e,
        (_dx, _dy, x, y) => {
          const b = spanBox(p.x, p.y, x, y);
          if (!made) {
            made = true;
            commitOps((o) => [...o, { kind: 'blur', id, style: blurStyle, amount: blurAmount, ...b }]);
            setSelBlur(id);
          } else patchOp(id, b);
        },
        (moved) => {
          if (!moved) setSelBlur(null);
          else
            // A box too small to see once let go is dropped.
            updateActive((it) => {
              const b = it.ops.find((o) => o.id === id) as BlurOp | undefined;
              if (!b || (b.w * k >= 12 && b.h * k >= 12)) return it;
              return { ...it, ops: it.ops.filter((o) => o.id !== id), past: it.past.slice(0, -1) };
            });
        },
      );
    }
  }

  function onBlurDown(e: React.PointerEvent, b: BlurOp, h: Handle | 'move') {
    if (e.button !== 0) return;
    setSelBlur(b.id);
    setStyleMenu(false);
    setBlurStyle(b.style);
    setBlurAmount(b.amount);
    let marked = false;
    track(e, (dx, dy) => {
      if (!marked) {
        commit();
        marked = true;
      }
      patchOp(b.id, dragBox(b, h, dx, dy, dims.nw, dims.nh, 16 / k));
    });
  }

  function onTextDown(e: React.PointerEvent, t: TextOp) {
    if (e.button !== 0 || editText === t.id) return;
    if (editText) finishText();
    setSelText(t.id);
    setTextColor(t.color);
    let marked = false;
    track(
      e,
      (dx, dy) => {
        if (!marked) {
          commit();
          marked = true;
        }
        patchOp(t.id, { x: clamp(t.x + dx, 0, dims.nw), y: clamp(t.y + dy, 0, dims.nh) });
      },
      (moved) => {
        if (!moved) startEdit(t.id);
      },
    );
  }

  // ---------- tool settings that also change the selected item ----------
  function pickTextColor(c: string) {
    setTextColor(c);
    const id = editText || selText;
    if (!id) return;
    if (id === newTextRef.current) patchOp(id, { color: c });
    else commitOps((o) => o.map((x) => (x.id === id ? { ...x, color: c } : x)));
  }
  /** The colour picker sends a stream of colours while you drag: one undo step for the lot. */
  function customTextColor(c: string) {
    setTextColor(c);
    const id = editText || selText;
    if (!id || !ops.some((o) => o.id === id)) return;
    if (id !== newTextRef.current && !pickerMarked.current) {
      commit();
      pickerMarked.current = true;
    }
    patchOp(id, { color: c });
  }
  function pickBlurStyle(s: BlurStyle) {
    setBlurStyle(s);
    setStyleMenu(false);
    if (selBlur) commitOps((o) => o.map((x) => (x.id === selBlur ? { ...x, style: s } : x)));
  }
  function slideBlur(v: number) {
    setBlurAmount(v);
    if (!selBlur) return;
    // One undo step per slider drag.
    if (!sliderMarked.current) {
      commit();
      sliderMarked.current = true;
    }
    patchOp(selBlur, { amount: v });
  }

  // ---------- crop box ----------
  const fullBox = useCallback((): Box | null => {
    const img = imgRef.current;
    if (!img || !img.clientWidth) return null;
    return { x: 0, y: 0, w: img.clientWidth, h: img.clientHeight };
  }, []);

  function onImgLoad() {
    measure();
    setLoaded((n) => n + 1);
    if (cropping) setBox(fullBox());
  }
  function startDrag(e: React.PointerEvent, h: Handle | 'move') {
    e.preventDefault();
    e.stopPropagation();
    if (!box) return;
    drag.current = { mode: h, startX: e.clientX, startY: e.clientY, box };
  }
  const onMove = useCallback((e: PointerEvent) => {
    const img = imgRef.current;
    const d = drag.current;
    if (!d || !img) return;
    // Mouse moves are screen px; the crop box is in the image's CSS px.
    const s = uiScale();
    const next = dragBox(d.box, d.mode, (e.clientX - d.startX) / s, (e.clientY - d.startY) / s, img.clientWidth, img.clientHeight, MIN);
    boxRef.current = next;
    setBox(next);
  }, []);
  const onUp = useCallback(() => {
    const d = drag.current;
    drag.current = null;
    const now = boxRef.current;
    if (!d || !now) return;
    const b = d.box;
    if (now.x === b.x && now.y === b.y && now.w === b.w && now.h === b.h) return;
    setCropPast((p) => [...p, { kind: 'box', box: b }]);
    setCropFuture([]);
  }, []);

  /** A rotation or Reset while cropping: earlier box moves no longer fit the new photo. */
  const cropFileStep = () => {
    setCropPast((p) => [...p.filter((s) => s.kind === 'file'), { kind: 'file' }]);
    setCropFuture([]);
  };
  function cropUndo() {
    const last = cropPast[cropPast.length - 1];
    if (!last) return;
    setCropPast((p) => p.slice(0, -1));
    if (last.kind === 'box') {
      if (box) setCropFuture((f) => [{ kind: 'box', box }, ...f]);
      setBox(last.box);
    } else {
      setCropFuture((f) => [{ kind: 'file' }, ...f]);
      undo();
    }
  }
  function cropRedo() {
    const next = cropFuture[0];
    if (!next) return;
    setCropFuture((f) => f.slice(1));
    if (next.kind === 'box') {
      if (box) setCropPast((p) => [...p, { kind: 'box', box }]);
      setBox(next.box);
    } else {
      setCropPast((p) => [...p, { kind: 'file' }]);
      redo();
    }
  }
  const doUndo = () => (cropping ? cropUndo() : undo());
  const doRedo = () => (cropping ? cropRedo() : redo());
  useEffect(() => {
    if (!cropping) return;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [cropping, onMove, onUp]);

  // Crop and rotate work on the photo with the other edits burned in.
  async function rotate(dir: 1 | -1) {
    const img = imgRef.current;
    if (!img || !current) return;
    const src = flatten(img, current.ops);
    const canvas = document.createElement('canvas');
    canvas.width = src.height;
    canvas.height = src.width;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((dir * Math.PI) / 2);
    ctx.drawImage(src, -src.width / 2, -src.height / 2);
    patchActive(await canvasToFile(canvas, current.file));
    cropFileStep();
  }

  function resetEdits() {
    if (!current || (current.file === current.original && !current.ops.length)) return;
    clearSelection();
    commit({ file: current.original, ops: [] });
    if (cropping) cropFileStep();
    setBox(cropping ? fullBox() : null);
  }

  async function applyCrop() {
    const img = imgRef.current;
    if (!img || !box || !current || box.w < 6 || box.h < 6) {
      setMode('none');
      return;
    }
    const src = flatten(img, current.ops);
    const scaleX = img.naturalWidth / img.clientWidth;
    const scaleY = img.naturalHeight / img.clientHeight;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(box.w * scaleX);
    canvas.height = Math.round(box.h * scaleY);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(src, box.x * scaleX, box.y * scaleY, box.w * scaleX, box.h * scaleY, 0, 0, canvas.width, canvas.height);
    patchActive(await canvasToFile(canvas, current.file));
    setMode('none');
  }

  // ---------- copy / download / send ----------
  const say = (msg: string) => {
    setFlash(msg);
    window.setTimeout(() => setFlash((m) => (m === msg ? '' : m)), 1800);
  };

  async function copyImage() {
    const img = imgRef.current;
    if (!img || !current) return;
    try {
      if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) throw new Error('unsupported');
      const blob = await new Promise<Blob>((res, rej) =>
        flatten(img, current.ops).toBlob((b) => (b ? res(b) : rej(new Error('blob'))), 'image/png'),
      );
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      say('Copied');
    } catch {
      say("Couldn't copy here");
    }
  }

  async function downloadImage() {
    const img = imgRef.current;
    if (!img || !current) return;
    const file = current.ops.length ? await canvasToFile(flatten(img, current.ops), current.file) : current.file;
    const href = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = href;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  }

  async function send() {
    if (sending || busy) return;
    finishText();
    setBusy(true);
    try {
      const out = await Promise.all(
        items.map(async (it) => ({
          file: kindOf(it.file) === 'image' ? await applyOps(it.file, it.ops) : it.file,
          caption: it.caption,
        })),
      );
      onSend(out);
    } catch {
      say("Couldn't prepare the image");
    } finally {
      setBusy(false);
    }
  }

  if (!current) return null;
  const ext = (current.file.name.match(/\.([a-z0-9]+)$/i)?.[1] || 'file').toUpperCase();
  const isImage = kind === 'image';
  const editing = mode === 'draw' || mode === 'text' || mode === 'blur';
  const selectedBlur = ops.find((o) => o.id === selBlur) as BlurOp | undefined;
  // Fit the photo inside the stage whatever its shape (tall photos used to
  // spill over the toolbar and caption), leaving room for the side strip.
  const mediaFit: React.CSSProperties | undefined = fit
    ? { maxWidth: Math.max(120, Math.min(fit.w - 2 * RAIL, MEDIA_MAX_W)), maxHeight: Math.max(120, fit.h) }
    : undefined;
  const tool = (m: Mode, label: string, icon: React.ReactNode) => (
    <button
      type="button"
      className={`att-icon-btn${mode === m ? ' on' : ''}`}
      onClick={() => switchMode(m)}
      title={label}
      aria-label={label}
      aria-pressed={mode === m}
      data-testid={`att-tool-${m}`}
    >
      {icon}
    </button>
  );

  return (
    <div className="att-overlay">
      <header className="att-head">
        <button className="att-close" onClick={() => setShowDiscard(true)} aria-label="Close">
          <span className="material-icons">close</span>
        </button>
        {isImage && (
          <div className="att-tools">
            <button
              type="button"
              className="att-icon-btn"
              onClick={doUndo}
              disabled={cropping ? !cropPast.length : !current.past.length}
              title="Undo (Ctrl+Z)"
              aria-label="Undo"
              data-testid="att-undo"
            >
              <UndoIcon />
            </button>
            <button
              type="button"
              className="att-icon-btn"
              onClick={doRedo}
              disabled={cropping ? !cropFuture.length : !current.future.length}
              title="Redo (Ctrl+Y)"
              aria-label="Redo"
              data-testid="att-redo"
            >
              <RedoIcon />
            </button>
          </div>
        )}
        <div className="att-filename">{current.file.name}</div>
        {flash && (
          <span className="att-flash" role="status" data-testid="att-flash">
            {flash}
          </span>
        )}
        {items.length > 1 && !cropping && (
          <button className="att-icon-btn" onClick={removeActive} title="Remove this file" aria-label="Remove this file">
            <span className="material-icons">delete</span>
          </button>
        )}
        {isImage &&
          (cropping ? (
            <div className="att-crop-actions">
              <button className="att-tool" onClick={() => setMode('none')}>
                Cancel
              </button>
              <button className="att-tool apply" onClick={() => void applyCrop()} data-testid="att-crop-apply">
                <span className="material-icons">check</span> Apply
              </button>
            </div>
          ) : (
            <div className="att-tools">
              {tool('crop', 'Crop & rotate', <CropRotateIcon />)}
              {tool('draw', 'Draw', <EditIcon />)}
              {tool('text', 'Add text', <TextToolIcon />)}
              {tool('blur', 'Blur', <BlurIcon />)}
              <span className="att-tools-sep" />
              <button
                type="button"
                className="att-icon-btn"
                onClick={() => void copyImage()}
                title="Copy image"
                aria-label="Copy image"
                data-testid="att-copy"
              >
                <CopyIcon />
              </button>
              <button
                type="button"
                className="att-icon-btn"
                onClick={() => void downloadImage()}
                title="Download"
                aria-label="Download"
                data-testid="att-download"
              >
                <DownloadIcon />
              </button>
            </div>
          ))}
      </header>

      <div className="att-stage" ref={stageRef}>
        {isImage && (
          <div className={`att-crop-wrap mode-${mode}`}>
            <img ref={imgRef} className="att-media" src={url} alt="" onLoad={onImgLoad} draggable={false} style={mediaFit} />
            <canvas ref={inkRef} className="att-ink" data-testid="att-ink" />
            {editing && <div className="att-layer" onPointerDown={onLayerDown} data-testid="att-layer" />}
            {ops.map((o) =>
              o.kind === 'text' ? (
                <div
                  key={o.id}
                  className={`att-text${o.id === selText ? ' sel' : ''}${o.id === editText ? ' editing' : ''}`}
                  style={{
                    left: o.x * k,
                    top: o.y * k,
                    fontSize: o.size * k,
                    color: o.color,
                    fontFamily: TEXT_FONT,
                    pointerEvents: mode === 'text' ? 'auto' : 'none',
                  }}
                  onPointerDown={(e) => onTextDown(e, o)}
                  data-testid="att-text"
                >
                  {o.id === editText ? (
                    <input
                      autoFocus
                      value={o.text}
                      placeholder="Type…"
                      style={{ width: `${Math.max(3, o.text.length + 1)}ch`, color: o.color }}
                      onChange={(e) => typeText(o.id, e.target.value)}
                      onBlur={finishText}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') finishText();
                      }}
                      data-testid="att-text-input"
                    />
                  ) : (
                    o.text
                  )}
                </div>
              ) : null,
            )}
            {mode === 'blur' &&
              ops.map((o) =>
                o.kind === 'blur' ? (
                  <div
                    key={o.id}
                    className={`att-blur-box${o.id === selBlur ? ' sel' : ''}`}
                    style={{ left: o.x * k, top: o.y * k, width: o.w * k, height: o.h * k }}
                    onPointerDown={(e) => onBlurDown(e, o, 'move')}
                    data-testid="att-blur-box"
                  >
                    {o.id === selBlur &&
                      HANDLES.map((h) => (
                        <span key={h} className={`ch ${h}`} onPointerDown={(e) => onBlurDown(e, o, h)} />
                      ))}
                  </div>
                ) : null,
              )}
            {cropping && box && (
              <div
                className="att-crop-sel"
                style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
                onPointerDown={(e) => startDrag(e, 'move')}
              >
                <span className="cg v1" />
                <span className="cg v2" />
                <span className="cg h1" />
                <span className="cg h2" />
                {HANDLES.map((h) => (
                  <span key={h} className={`ch ${h}`} onPointerDown={(e) => startDrag(e, h)} />
                ))}
              </div>
            )}
          </div>
        )}
        {kind === 'video' && <video className="att-media" src={url} controls style={mediaFit} />}
        {kind === 'audio' && (
          <div className="att-filecard">
            <span className="material-icons att-filecard-icon">audiotrack</span>
            <div className="att-filecard-name">{current.file.name}</div>
            <audio src={url} controls />
          </div>
        )}
        {kind === 'pdf' && <iframe className="att-pdf" src={url} title={current.file.name} />}
        {kind === 'doc' && (
          <div className="att-filecard">
            <span className={`att-doc-icon ${ext === 'PDF' ? 'pdf' : ''}`}>{ext.slice(0, 4)}</span>
            <div className="att-filecard-name">{current.file.name}</div>
            <div className="att-filecard-sub">
              {ext} • {prettySize(current.file.size)}
            </div>
          </div>
        )}

        {/* Right rail: crop tools while cropping, else the file strip + add. */}
        {cropping ? (
          <div className="att-crop-bar">
            <button className="att-rotate" onClick={() => void rotate(-1)} title="Rotate left">
              <span className="material-icons">rotate_left</span>
            </button>
            <button className="att-rotate" onClick={() => void rotate(1)} title="Rotate right">
              <span className="material-icons">rotate_right</span>
            </button>
            <button className="att-reset" onClick={resetEdits}>
              Reset
            </button>
          </div>
        ) : (
          <div className="att-strip">
            {items.map((it, i) => (
              <button
                key={i}
                className={`att-thumb${i === active ? ' active' : ''}`}
                onClick={() => switchTo(i)}
                title={it.file.name}
              >
                <Thumb file={it.file} />
                {it.ops.length > 0 && <EditIcon className="att-thumb-edited" />}
              </button>
            ))}
            <button className="att-add" onClick={() => addRef.current?.click()} title="Add files">
              <span className="material-icons">add</span>
            </button>
            <input
              ref={addRef}
              type="file"
              multiple
              hidden
              onChange={addMore}
              accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.txt"
            />
          </div>
        )}
      </div>

      {/* Tool options, WhatsApp-style, between the photo and the caption. */}
      {isImage && mode === 'draw' && (
        <div className="att-opts" data-testid="att-opts-draw">
          <Swatches value={drawColor} onPick={setDrawColor} onCustom={setDrawColor} />
          <span className="att-opts-sep" />
          <div className="att-brushes">
            {BRUSHES.map((b, i) => (
              <button
                key={b}
                type="button"
                className={`att-brush${brush === i ? ' on' : ''}`}
                onClick={() => setBrush(i)}
                aria-label={`Brush size ${i + 1}`}
                data-testid="att-brush"
              >
                <span style={{ width: b + 2, height: b + 2 }} />
              </button>
            ))}
          </div>
        </div>
      )}
      {isImage && mode === 'text' && (
        <div className="att-opts" data-testid="att-opts-text">
          <Swatches
            // the selected text's own colour (follows undo), else the colour for new text
            value={(ops.find((o) => o.id === (editText || selText) && o.kind === 'text') as TextOp | undefined)?.color ?? textColor}
            onPick={pickTextColor}
            onCustom={customTextColor}
            onCustomOpen={() => {
              pickerMarked.current = false;
            }}
            keepFocus
          />
          <span className="att-opts-sep" />
          <button type="button" className="att-icon-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => addText()} title="Add another text" aria-label="Add another text" data-testid="att-text-add">
            <span className="material-icons">add</span>
          </button>
          <button
            type="button"
            className="att-icon-btn"
            onMouseDown={(e) => e.preventDefault()}
            onClick={deleteSelected}
            disabled={!(editText || selText)}
            title="Delete text"
            aria-label="Delete text"
            data-testid="att-text-delete"
          >
            <span className="material-icons">delete_outline</span>
          </button>
        </div>
      )}
      {isImage && mode === 'blur' && (
        <div className="att-opts" data-testid="att-opts-blur">
          <div className="att-style">
            <button
              type="button"
              className="att-style-btn"
              onClick={() => setStyleMenu((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={styleMenu}
              title="Blur style"
              data-testid="att-blur-style"
            >
              {(selectedBlur?.style ?? blurStyle) === 'pixelate' ? <PixelateIcon /> : <BlurIcon />}
              <span className="material-icons att-chev">expand_more</span>
            </button>
            {styleMenu && (
              <div className="att-style-menu" role="menu">
                {(['pixelate', 'blur'] as BlurStyle[]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="menuitemradio"
                    aria-checked={(selectedBlur?.style ?? blurStyle) === s}
                    onClick={() => pickBlurStyle(s)}
                    data-testid={`att-blur-${s}`}
                  >
                    {s === 'pixelate' ? <PixelateIcon /> : <BlurIcon />}
                    <span>{s === 'pixelate' ? 'Pixelate' : 'Blur'}</span>
                    {(selectedBlur?.style ?? blurStyle) === s && <span className="material-icons att-check">check</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
          <input
            type="range"
            className="att-slider"
            min={0}
            max={100}
            value={selectedBlur?.amount ?? blurAmount}
            onChange={(e) => slideBlur(Number(e.target.value))}
            onPointerDown={() => {
              sliderMarked.current = false;
            }}
            onKeyDown={() => {
              sliderMarked.current = false;
            }}
            aria-label="Blur intensity"
            data-testid="att-blur-amount"
          />
          <span className="att-slider-val">{selectedBlur?.amount ?? blurAmount}</span>
          <button
            type="button"
            className="att-icon-btn"
            onClick={deleteSelected}
            disabled={!selBlur}
            title="Remove blur"
            aria-label="Remove blur"
            data-testid="att-blur-delete"
          >
            <span className="material-icons">delete_outline</span>
          </button>
        </div>
      )}

      <div className="att-footer">
        <input
          className="att-caption"
          type="text"
          placeholder="Add a caption…"
          value={current.caption}
          autoFocus
          onChange={(e) =>
            setItems((prev) => prev.map((it, i) => (i === active ? { ...it, caption: e.target.value } : it)))
          }
          onKeyDown={(e) => {
            if (e.key === 'Enter') void send();
          }}
        />
        <button className="att-send" onClick={() => void send()} disabled={sending || busy} aria-label="Send">
          <span className="material-icons">send</span>
          {items.length > 1 && <span className="att-send-count">{items.length}</span>}
        </button>
      </div>

      {showDiscard && (
        <div className="disc-backdrop" onClick={() => setShowDiscard(false)}>
          <div className="disc-box" onClick={(e) => e.stopPropagation()}>
            <div className="disc-title">Discard selection?</div>
            <div className="disc-actions">
              <button className="disc-cancel" onClick={() => setShowDiscard(false)}>
                Cancel
              </button>
              <button className="disc-discard" onClick={onCancel}>
                Discard
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
