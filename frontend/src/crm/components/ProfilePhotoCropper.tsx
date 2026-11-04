// Crop a photo for the WhatsApp profile picture, before it goes to Meta.
//
// WhatsApp stores the profile photo as a square and shows it in a circle.
// Meta only takes a JPEG larger than 192×192, and 640×640 is its recommended
// size, so whatever is picked (JPEG, PNG, WebP; any shape) comes out of here
// as a 640×640 JPEG of the square chosen. Transparent areas turn white, as
// they would on WhatsApp anyway.
//
// The square always lies inside the photo: zoom starts at "fills the square"
// and moving stops at the photo's edges, so there's never an empty corner.
// Drag (mouse or finger) to move, wheel / pinch / slider to zoom, arrow keys
// to nudge, rotate in 90° steps.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { uiScale } from '../uiScale';
import { useBackHandler } from '../useBackHandler';
import './ProfilePhotoCropper.css';

/** WhatsApp's recommended profile photo size; Meta needs more than 192×192. */
export const PROFILE_PHOTO_SIZE = 640;
export const PROFILE_PHOTO_MIN = 192;
const STAGE = 320; // the square on screen, CSS px
const MAX_ZOOM = 5;
const JPEG_QUALITY = 0.92;

interface View {
  /** Rotation in quarter turns (0–3). */
  turns: number;
  /** 1 = the photo just fills the square. */
  zoom: number;
  /** Top-left of the (rotated, scaled) photo relative to the square, CSS px. */
  x: number;
  y: number;
}

interface Props {
  file: File;
  onCancel: () => void;
  /** The cropped 640×640 JPEG. */
  onDone: (file: File) => void;
}

/** The photo's size once rotated. */
const turned = (img: HTMLImageElement, turns: number) =>
  turns % 2 ? { w: img.naturalHeight, h: img.naturalWidth } : { w: img.naturalWidth, h: img.naturalHeight };

/** Screen px per photo px at a zoom. */
const scaleOf = (img: HTMLImageElement, v: Pick<View, 'turns' | 'zoom'>) => {
  const { w, h } = turned(img, v.turns);
  return (STAGE / Math.min(w, h)) * v.zoom;
};

/** Keep the square inside the photo. */
function clamp(img: HTMLImageElement, v: View): View {
  const { w, h } = turned(img, v.turns);
  const zoom = Math.min(MAX_ZOOM, Math.max(1, v.zoom));
  const s = (STAGE / Math.min(w, h)) * zoom;
  return {
    ...v,
    zoom,
    x: Math.min(0, Math.max(STAGE - w * s, v.x)),
    y: Math.min(0, Math.max(STAGE - h * s, v.y)),
  };
}

/** Centred, just filling the square. */
function fit(img: HTMLImageElement, turns: number): View {
  const { w, h } = turned(img, turns);
  const s = STAGE / Math.min(w, h);
  return { turns, zoom: 1, x: (STAGE - w * s) / 2, y: (STAGE - h * s) / 2 };
}

/** Zoom to `zoom`, keeping the photo point under (px, py) where it is. */
function zoomAt(img: HTMLImageElement, v: View, zoom: number, px = STAGE / 2, py = STAGE / 2): View {
  const s0 = scaleOf(img, v);
  const next = { ...v, zoom: Math.min(MAX_ZOOM, Math.max(1, zoom)) };
  const s1 = scaleOf(img, next);
  return clamp(img, { ...next, x: px - ((px - v.x) / s0) * s1, y: py - ((py - v.y) / s0) * s1 });
}

/** Draw the square as `size`×`size` (on screen or for the upload). */
function paint(ctx: CanvasRenderingContext2D, img: HTMLImageElement, v: View, size: number) {
  const { w, h } = turned(img, v.turns);
  const s = scaleOf(img, v);
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.scale(size / STAGE, size / STAGE);
  ctx.translate(v.x, v.y);
  ctx.scale(s, s);
  ctx.translate(w / 2, h / 2);
  ctx.rotate((v.turns * Math.PI) / 2);
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
  ctx.restore();
}

export function ProfilePhotoCropper({ file, onCancel, onDone }: Props) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<View | null>(null);
  const [busy, setBusy] = useState(false);
  const stageRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const applyRef = useRef<HTMLButtonElement>(null);

  useBackHandler(true, onCancel);

  // The square on screen: 320 px, or narrower on a small phone. The crop
  // itself is worked out in 320-unit coordinates either way.
  const [shown] = useState(() => {
    const room = typeof window === 'undefined' ? STAGE : window.innerWidth / uiScale() - 60;
    return Math.max(220, Math.min(STAGE, Math.floor(room)));
  });

  // Decode the picked file.
  useEffect(() => {
    let alive = true;
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => {
      if (!alive) return;
      if (!im.naturalWidth || !im.naturalHeight) {
        setFailed(true);
        return;
      }
      setFailed(false);
      setImg(im);
      setView(fit(im, 0));
    };
    // A cancelled load (the URL revoked below) isn't a broken file.
    im.onerror = () => {
      if (alive) setFailed(true);
    };
    im.src = url;
    return () => {
      alive = false;
      URL.revokeObjectURL(url);
    };
  }, [file]);

  // Redraw the square and the small preview whenever the view changes.
  useLayoutEffect(() => {
    if (!img || !view) return;
    const dpr = window.devicePixelRatio || 1;
    for (const [c, size] of [[stageRef.current, shown], [previewRef.current, 56]] as const) {
      if (!c) continue;
      const px = Math.round(size * dpr);
      if (c.width !== px) c.width = px;
      if (c.height !== px) c.height = px;
      const ctx = c.getContext('2d');
      if (ctx) paint(ctx, img, view, px);
    }
  }, [img, view, shown]);

  // Focus lands on "Use photo", so Enter applies.
  // Again a moment after the photo is in: the browser hands focus back to
  // the file input as its picker closes, which can land after this opens.
  useEffect(() => {
    applyRef.current?.focus();
    if (!img) return undefined;
    const t = setTimeout(() => {
      const active = document.activeElement as HTMLElement | null;
      if (!active || !active.closest('.ppc-dialog')) applyRef.current?.focus();
    }, 80);
    return () => clearTimeout(t);
  }, [img]);

  const update = useCallback((fn: (v: View, im: HTMLImageElement) => View) => {
    if (!img) return;
    setView((v) => (v ? fn(v, img) : v));
  }, [img]);

  // ---- drag / pinch ----
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  /** A pointer's position inside the square, in the square's own units (0–STAGE). */
  const local = (e: { clientX: number; clientY: number }) => {
    const r = boxRef.current!.getBoundingClientRect();
    // Measured, so the CRM's zoom and a narrower phone square both drop out.
    const k = STAGE / (r.width || STAGE);
    return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k };
  };

  function onPointerDown(e: React.PointerEvent) {
    if (!img) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, local(e));
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom: view?.zoom || 1 };
    }
    setDragging(true);
  }

  function onPointerMove(e: React.PointerEvent) {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const now = local(e);
    pointers.current.set(e.pointerId, now);
    if (pointers.current.size >= 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const zoom = pinch.current.zoom * (dist / pinch.current.dist);
      update((v, im) => zoomAt(im, v, zoom, (a.x + b.x) / 2, (a.y + b.y) / 2));
      return;
    }
    update((v, im) => clamp(im, { ...v, x: v.x + now.x - prev.x, y: v.y + now.y - prev.y }));
  }

  function onPointerUp(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (!pointers.current.size) setDragging(false);
  }

  // Wheel zoom. A native listener: React's wheel handler is passive and
  // can't stop the page from scrolling.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return undefined;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = local(e);
      const factor = Math.exp(-e.deltaY * 0.0015);
      update((v, im) => zoomAt(im, v, v.zoom * factor, p.x, p.y));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [update]);

  // Keyboard: arrows move, +/- zoom, Esc cancels.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
        return;
      }
      const t = e.target as HTMLElement | null;
      if (t && t.tagName === 'INPUT') return; // the zoom slider handles its own keys
      const step = e.shiftKey ? 40 : 8;
      const moves: Record<string, [number, number]> = {
        ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step],
      };
      if (moves[e.key]) {
        e.preventDefault();
        const [dx, dy] = moves[e.key];
        update((v, im) => clamp(im, { ...v, x: v.x + dx, y: v.y + dy }));
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        update((v, im) => zoomAt(im, v, v.zoom * 1.15));
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        update((v, im) => zoomAt(im, v, v.zoom / 1.15));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, update]);

  const rotate = () => update((v, im) => fit(im, (v.turns + 3) % 4));
  const reset = () => update((v, im) => fit(im, v.turns));

  // The square's side in the photo's own pixels: below 640 it's enlarged.
  const side = img && view ? Math.round(STAGE / scaleOf(img, view)) : 0;
  const lowRes = !!side && side < PROFILE_PHOTO_SIZE;
  const tooSmall = !!side && side <= PROFILE_PHOTO_MIN;

  function apply() {
    if (!img || !view || busy) return;
    setBusy(true);
    const canvas = document.createElement('canvas');
    canvas.width = PROFILE_PHOTO_SIZE;
    canvas.height = PROFILE_PHOTO_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setBusy(false);
      return;
    }
    paint(ctx, img, view, PROFILE_PHOTO_SIZE);
    canvas.toBlob((blob) => {
      setBusy(false);
      if (!blob) return;
      const base = file.name.replace(/\.[^.]+$/, '') || 'profile';
      onDone(new File([blob], `${base}.jpg`, { type: 'image/jpeg' }));
    }, 'image/jpeg', JPEG_QUALITY);
  }

  return createPortal(
    <div className="ppc-overlay" onPointerDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="ppc-dialog" role="dialog" aria-modal="true" aria-labelledby="ppc-title" data-testid="ppc">
        <div className="ppc-head">
          <div>
            <h3 id="ppc-title">Crop your WhatsApp photo</h3>
            <p>WhatsApp shows it in a circle. Drag to move it, zoom to fit.</p>
          </div>
          <button type="button" className="ppc-x" onClick={onCancel} aria-label="Cancel">✕</button>
        </div>

        {failed ? (
          <div className="ppc-failed" role="alert">This file couldn’t be opened as an image. Choose a JPEG, PNG or WebP photo.</div>
        ) : (
          <>
            <div
              ref={boxRef}
              className={`ppc-stage${dragging ? ' dragging' : ''}`}
              style={{ width: shown, height: shown }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              data-testid="ppc-stage"
            >
              <canvas ref={stageRef} style={{ width: shown, height: shown }} aria-label="Photo to crop" />
              <div className="ppc-ring" aria-hidden="true" />
              <div className="ppc-grid" aria-hidden="true" />
              {!img && <div className="ppc-wait">Opening photo…</div>}
            </div>

            <div className="ppc-tools">
              <button type="button" className="ppc-icon" onClick={() => update((v, im) => zoomAt(im, v, v.zoom / 1.2))} aria-label="Zoom out" disabled={!view || view.zoom <= 1}>
                <span className="material-icons">remove</span>
              </button>
              <input
                type="range"
                className="ppc-zoom"
                min={1}
                max={MAX_ZOOM}
                step={0.01}
                value={view?.zoom ?? 1}
                onChange={(e) => {
                  const z = Number(e.target.value);
                  update((v, im) => zoomAt(im, v, z));
                }}
                aria-label="Zoom"
                data-testid="ppc-zoom"
              />
              <button type="button" className="ppc-icon" onClick={() => update((v, im) => zoomAt(im, v, v.zoom * 1.2))} aria-label="Zoom in" disabled={!view || view.zoom >= MAX_ZOOM}>
                <span className="material-icons">add</span>
              </button>
              <span className="ppc-sep" />
              <button type="button" className="ppc-icon" onClick={rotate} aria-label="Rotate" title="Rotate" disabled={!view}>
                <span className="material-icons">rotate_left</span>
              </button>
              <button type="button" className="ppc-icon" onClick={reset} aria-label="Reset" title="Reset" disabled={!view}>
                <span className="material-icons">restart_alt</span>
              </button>
            </div>

            <div className="ppc-foot">
              <div className="ppc-preview">
                <canvas ref={previewRef} style={{ width: 56, height: 56 }} aria-hidden="true" />
                <div className="ppc-preview-text">
                  <strong>In chats</strong>
                  <span data-testid="ppc-size">
                    {tooSmall
                      ? `Only ${side}×${side} px here. It will look blurry: ${view && view.zoom > 1 ? 'zoom out or use' : 'use'} a larger photo.`
                      : lowRes
                        ? `${side}×${side} px here, enlarged to ${PROFILE_PHOTO_SIZE}×${PROFILE_PHOTO_SIZE}. It may look soft.`
                        : `Saved as ${PROFILE_PHOTO_SIZE}×${PROFILE_PHOTO_SIZE} JPEG, as WhatsApp recommends.`}
                  </span>
                </div>
              </div>
            </div>
          </>
        )}

        <div className="ppc-actions">
          <button type="button" className="ppc-cancel" onClick={onCancel}>Cancel</button>
          <button ref={applyRef} type="button" className="ppc-apply" onClick={apply} disabled={!view || busy || failed} data-testid="ppc-apply">
            {busy ? 'Preparing…' : 'Use photo'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
