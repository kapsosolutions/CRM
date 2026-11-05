// Image edits for the attachment preview (AttachmentPreview.tsx): freehand
// strokes, text and blurred / pixelated boxes, kept as a list of operations in
// the image's own (natural) pixels and painted onto a canvas. The preview
// paints them over the photo; Send / Copy / Download / Crop flatten them into
// the image file.

export type BlurStyle = 'pixelate' | 'blur';

export interface StrokeOp {
  kind: 'stroke';
  id: string;
  color: string;
  size: number; // line width, natural px
  pts: number[]; // x0, y0, x1, y1… natural px
}
export interface TextOp {
  kind: 'text';
  id: string;
  text: string;
  color: string;
  x: number; // centre, natural px
  y: number;
  size: number; // font size, natural px
}
export interface BlurOp {
  kind: 'blur';
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  style: BlurStyle;
  amount: number; // 0–100
}
export type EditOp = StrokeOp | TextOp | BlurOp;

export const TEXT_FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif";

let seq = 0;
export const opId = () => `op${Date.now().toString(36)}${(seq++).toString(36)}`;

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/** A blur box cut to the image, or null when nothing of it is left. */
function clip(b: BlurOp, W: number, H: number) {
  const x = Math.max(0, b.x);
  const y = Math.max(0, b.y);
  const w = Math.min(W, b.x + b.w) - x;
  const h = Math.min(H, b.y + b.h) - y;
  return w >= 1 && h >= 1 ? { x, y, w, h } : null;
}

function paintBlur(ctx: CanvasRenderingContext2D, img: CanvasImageSource, W: number, H: number, b: BlurOp) {
  const r = clip(b, W, H);
  if (!r) return;
  const big = Math.max(W, H);
  const t = Math.max(0, Math.min(100, b.amount)) / 100;
  if (b.style === 'pixelate') {
    // Shrink the box to one pixel per block, then blow it up without smoothing.
    const block = Math.max(2, big * (0.006 + t * 0.045));
    const sw = Math.max(1, Math.round(r.w / block));
    const sh = Math.max(1, Math.round(r.h / block));
    const small = makeCanvas(sw, sh);
    small.getContext('2d')?.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, sw, sh);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(small, 0, 0, sw, sh, r.x, r.y, r.w, r.h);
    ctx.restore();
    return;
  }
  // Soft blur: shrink a padded area (so the edges blur in from outside the
  // box), soften it a little more, then scale it back up smoothly and clip.
  const f = Math.max(2, big * (0.003 + t * 0.03));
  const pad = f * 3;
  const ex = Math.max(0, r.x - pad);
  const ey = Math.max(0, r.y - pad);
  const ew = Math.min(W, r.x + r.w + pad) - ex;
  const eh = Math.min(H, r.y + r.h + pad) - ey;
  const sw = Math.max(1, Math.round(ew / f));
  const sh = Math.max(1, Math.round(eh / f));
  const small = makeCanvas(sw, sh);
  small.getContext('2d')?.drawImage(img, ex, ey, ew, eh, 0, 0, sw, sh);
  let src: HTMLCanvasElement = small;
  const soft = makeCanvas(sw, sh);
  const sctx = soft.getContext('2d');
  if (sctx && 'filter' in sctx) {
    sctx.filter = 'blur(1.5px)';
    sctx.drawImage(small, 0, 0);
    src = soft;
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, sw, sh, ex, ey, ew, eh);
  ctx.restore();
}

function paintStroke(ctx: CanvasRenderingContext2D, s: StrokeOp) {
  const p = s.pts;
  if (p.length < 2) return;
  ctx.save();
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  ctx.lineWidth = s.size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (p.length === 2) {
    ctx.beginPath();
    ctx.arc(p[0], p[1], s.size / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(p[0], p[1]);
    // Midpoint quadratic curves: smooth lines from a jittery mouse.
    for (let i = 2; i < p.length - 2; i += 2) {
      ctx.quadraticCurveTo(p[i], p[i + 1], (p[i] + p[i + 2]) / 2, (p[i + 1] + p[i + 3]) / 2);
    }
    ctx.lineTo(p[p.length - 2], p[p.length - 1]);
    ctx.stroke();
  }
  ctx.restore();
}

function paintText(ctx: CanvasRenderingContext2D, t: TextOp) {
  const text = t.text.trim();
  if (!text) return;
  ctx.save();
  ctx.font = `700 ${t.size}px ${TEXT_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = t.color;
  ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
  ctx.shadowBlur = t.size * 0.12;
  ctx.shadowOffsetY = t.size * 0.03;
  ctx.fillText(text, t.x, t.y);
  ctx.restore();
}

/**
 * Paint the edits for an image of natural size W×H. Blurs sample the original
 * photo, so they go first; strokes and then text sit on top. `withText` is off
 * for the live preview, where text is shown as editable page elements.
 */
export function paintOps(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  W: number,
  H: number,
  ops: EditOp[],
  withText: boolean,
) {
  for (const o of ops) if (o.kind === 'blur') paintBlur(ctx, img, W, H, o);
  for (const o of ops) if (o.kind === 'stroke') paintStroke(ctx, o);
  if (withText) for (const o of ops) if (o.kind === 'text') paintText(ctx, o);
}

/** The photo with every edit burned in, at full size. */
export function flatten(img: HTMLImageElement, ops: EditOp[]): HTMLCanvasElement {
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.drawImage(img, 0, 0);
    paintOps(ctx, img, W, H, ops, true);
  }
  return c;
}

export function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read the image'));
    };
    img.src = url;
  });
}

/** Canvas → File, keeping the original's name and (where a canvas can write it) type. */
export function canvasToFile(canvas: HTMLCanvasElement, like: File, type?: string): Promise<File> {
  const keep = /^image\/(jpeg|png|webp)$/.test(like.type);
  const out = type || (keep ? like.type : 'image/png');
  let name = like.name;
  if (out !== like.type || !keep) {
    const ext = out === 'image/jpeg' ? 'jpg' : out.split('/')[1];
    name = /\.[a-z0-9]+$/i.test(name) ? name.replace(/\.[a-z0-9]+$/i, `.${ext}`) : `${name}.${ext}`;
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(new File([blob], name, { type: blob.type || out })) : reject(new Error('Could not save the image'))),
      out,
      0.92,
    );
  });
}

/** The file with its edits burned in (the same file when there are none). */
export async function applyOps(file: File, ops: EditOp[]): Promise<File> {
  if (!ops.length) return file;
  const img = await loadImage(file);
  return canvasToFile(flatten(img, ops), file);
}
