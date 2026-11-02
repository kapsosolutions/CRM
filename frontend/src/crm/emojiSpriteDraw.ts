// Draws emoji into a sprite sheet: shared by the worker
// (emojiSprite.worker.ts) and the page fallback in emojiSprites.ts.

export const SHEET_COLS = 16;

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function setupFont(ctx: Ctx2D, fontPx: number) {
  ctx.font = `${fontPx}px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji","Twemoji Mozilla","Android Emoji",sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
}

/** Emoji number `i` of the sheet, centred in its `d` x `d` cell. */
export function drawCell(ctx: Ctx2D, emoji: string, i: number, d: number, fontPx: number) {
  const m = ctx.measureText(emoji);
  const asc = m.actualBoundingBoxAscent || fontPx * 0.8;
  const desc = m.actualBoundingBoxDescent || fontPx * 0.2;
  const cx = (i % SHEET_COLS) * d + d / 2;
  const cy = Math.floor(i / SHEET_COLS) * d + d / 2 + (asc - desc) / 2;
  ctx.fillText(emoji, cx, cy);
}

export const sheetSize = (count: number, d: number) => ({ w: SHEET_COLS * d, h: Math.max(1, Math.ceil(count / SHEET_COLS)) * d });
