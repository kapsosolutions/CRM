// Emoji drawn once into image sheets, for the chat's emoji picker.
//
// Windows 11's 3D emoji (Segoe UI Emoji, COLRv1) take ~5 ms each for Chrome to
// draw, every time they are painted (crbug.com/442112329). A picker showing
// ~100 of them cost ~0.5 s per scroll step or tab click and froze the whole
// CRM. Here each emoji is drawn once, in a Web Worker, into one sheet per
// category; the picker shows them as image tiles, which scroll for free. The
// sheets are kept in Cache Storage, so later visits don't draw again.
import { SHEET_COLS, drawCell, setupFont, sheetSize } from './emojiSpriteDraw';

export interface Sprite {
  url: string;
  /** Cell position and sheet size, in sheet pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Sheet pixels per CSS px. */
  scale: number;
}

const VERSION = 1;
/** Cell size in CSS px; the emoji is drawn at FONT_PX inside it. */
export const CELL_PX = 30;
const FONT_PX = 24;

const sprites = new Map<string, Sprite>();
const listeners = new Set<() => void>();
const done = new Set<string>();
const queued = new Set<string>();

export const spriteFor = (native: string): Sprite | undefined => sprites.get(native);
/** Whether the sheet asked for under `key` has arrived. */
export const sheetReady = (key: string): boolean => done.has(key);
export function onSprites(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
function publish(key: string, list: string[], url: string, d: number, w: number, h: number, scale: number) {
  list.forEach((n, i) => sprites.set(n, { url, x: (i % SHEET_COLS) * d, y: Math.floor(i / SHEET_COLS) * d, w, h, scale }));
  done.add(key);
  listeners.forEach((f) => f());
}

// ---- drawing: a few workers in parallel, else the page in idle slices ----
const POOL = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
let workers: Worker[] | null | undefined;
let nextWorker = 0;
function getWorker(): Worker | null {
  if (workers === undefined) {
    workers = null;
    try {
      if (typeof OffscreenCanvas !== 'undefined' && typeof Worker !== 'undefined') {
        workers = Array.from({ length: POOL }, () => new Worker(new URL('./emojiSprite.worker.ts', import.meta.url), { type: 'module' }));
      }
    } catch {
      workers = null;
    }
  }
  if (!workers) return null;
  nextWorker = (nextWorker + 1) % workers.length;
  return workers[nextWorker];
}
/** Drawing failed here (no canvas at all): the picker shows plain text instead. */
let broken = false;
export const spritesBroken = () => broken;

type IdleDeadline = { timeRemaining: () => number };
const idle = (fn: (d?: IdleDeadline) => void) => {
  const w = window as Window & { requestIdleCallback?: (cb: (d: IdleDeadline) => void, o?: { timeout: number }) => number };
  if (w.requestIdleCallback) w.requestIdleCallback(fn, { timeout: 1000 });
  else window.setTimeout(() => fn(), 16);
};

function drawOnPage(list: string[], d: number, fontPx: number): Promise<{ blob: Blob; w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const { w, h } = sheetSize(list.length, d);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return reject(new Error('no canvas'));
    setupFont(ctx, fontPx);
    let i = 0;
    const step = (deadline?: IdleDeadline) => {
      // A few emoji per idle slice, so the page never stalls.
      const until = performance.now() + Math.min(8, deadline ? deadline.timeRemaining() : 8);
      do {
        drawCell(ctx, list[i], i, d, fontPx);
        i += 1;
      } while (i < list.length && performance.now() < until);
      if (i < list.length) idle(step);
      else c.toBlob((b) => (b ? resolve({ blob: b, w, h }) : reject(new Error('toBlob failed'))), 'image/webp', 0.95);
    };
    idle(step);
  });
}

function drawJob(key: string, list: string[], d: number, fontPx: number): Promise<{ blob: Blob; w: number; h: number }> {
  const w = getWorker();
  if (!w) return drawOnPage(list, d, fontPx);
  return new Promise((resolve, reject) => {
    const onMsg = (e: MessageEvent) => {
      if (e.data?.key !== key) return;
      w.removeEventListener('message', onMsg);
      if (e.data.error || !e.data.blob) {
        // This browser's workers can't draw text: the page does it from now on.
        workers?.forEach((x) => x.terminate());
        workers = null;
        drawOnPage(list, d, fontPx).then(resolve, reject);
      } else resolve({ blob: e.data.blob, w: e.data.w, h: e.data.h });
    };
    w.addEventListener('message', onMsg);
    w.postMessage({ key, list, d, fontPx });
  });
}

// ---- Cache Storage ----
const CACHE = 'crm-emoji-sprites';
function cacheUrl(key: string, d: number, list: string[]): string {
  // The picture depends on this browser's emoji font: keyed by the user
  // agent (browser + OS version), the cell size and the exact emoji list.
  let h = 0;
  const s = `${navigator.userAgent}|${d}|${list.join('')}`;
  for (let i = 0; i < s.length; i += 1) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return `/__crm-emoji-sprites/v${VERSION}/${d}/${encodeURIComponent(key)}-${(h >>> 0).toString(36)}.webp`;
}
async function fromCache(url: string): Promise<Blob | null> {
  try {
    if (!('caches' in window)) return null;
    const r = await (await caches.open(CACHE)).match(url);
    return r ? await r.blob() : null;
  } catch {
    return null;
  }
}
async function toCache(url: string, blob: Blob) {
  try {
    if (!('caches' in window)) return;
    await (await caches.open(CACHE)).put(url, new Response(blob, { headers: { 'Content-Type': 'image/webp' } }));
  } catch {
    /* private mode / quota: draw again next time */
  }
}

// ---- the queue: in the order asked, POOL sheets at a time ----
const jobs: { key: string; list: string[] }[] = [];
let active = 0;
let scale = 0;

/**
 * Ask for these sheets. Sheets already drawn or queued are skipped.
 * `uiScale` is the CRM's CSS zoom (0.8 / 0.9 / 1), so sheets match the
 * screen's pixels and stay sharp.
 */
export function requestSprites(sheets: { key: string; list: string[] }[], uiScale: number) {
  if (!scale) scale = Math.max(1, Math.min(3, Math.round((window.devicePixelRatio || 1) * uiScale * 4) / 4));
  for (const sh of sheets) {
    if (!sh.list.length || done.has(sh.key) || queued.has(sh.key)) continue;
    queued.add(sh.key);
    jobs.push(sh);
  }
  void run();
}

function run() {
  // The page fallback draws one sheet at a time; workers draw POOL at once.
  const limit = workers === null ? 1 : POOL;
  while (active < limit && jobs.length) {
    const job = jobs.shift()!;
    active += 1;
    void runJob(job).finally(() => {
      active -= 1;
      run();
    });
  }
}

async function runJob(job: { key: string; list: string[] }) {
  const d = Math.round(CELL_PX * scale);
  const fontPx = Math.round(FONT_PX * scale);
  const { w, h } = sheetSize(job.list.length, d);
  const url = cacheUrl(job.key, d, job.list);
  let blob = await fromCache(url);
  if (!blob) {
    const out = await drawJob(job.key, job.list, d, fontPx).catch(() => null);
    if (!out) {
      broken = true;
      listeners.forEach((f) => f());
      return;
    }
    blob = out.blob;
    void toCache(url, blob);
  }
  // Decoded before it's shown, so the grid swaps in a ready picture.
  const objectUrl = URL.createObjectURL(blob);
  await new Promise<void>((resolve) => {
    const img = new Image();
    img.onload = img.onerror = () => resolve();
    img.src = objectUrl;
    img.decode?.().then(() => resolve(), () => resolve());
  });
  publish(job.key, job.list, objectUrl, d, w, h, scale);
}
