// Draws one emoji sprite sheet off the page's main thread (emojiSprites.ts).
import { drawCell, setupFont, sheetSize } from './emojiSpriteDraw';

interface Job {
  key: string;
  list: string[];
  d: number;
  fontPx: number;
}

self.onmessage = async (e: MessageEvent<Job>) => {
  const { key, list, d, fontPx } = e.data;
  try {
    const { w, h } = sheetSize(list.length, d);
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    setupFont(ctx, fontPx);
    list.forEach((emoji, i) => drawCell(ctx, emoji, i, d, fontPx));
    const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.95 });
    (self as unknown as Worker).postMessage({ key, blob, w, h });
  } catch (err) {
    (self as unknown as Worker).postMessage({ key, error: err instanceof Error ? err.message : String(err) });
  }
};
