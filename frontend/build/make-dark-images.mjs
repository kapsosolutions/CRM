// One-off generator for the dark-theme twins of the CRM's light background
// images (see DARK_IMAGES in build/crmDarkTheme.ts). The light images have a
// solid white / beige backdrop baked in; the twins keep only the pattern on a
// transparent backdrop, so the dark background colour shows through.
//
//   node frontend/build/make-dark-images.mjs
//
// Needs `sharp`, which the backend already installs. Outputs go to
// frontend/public and are committed.
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, '..', 'public');
const require = createRequire(join(HERE, '..', '..', 'backend', 'package.json'));
const sharp = require('sharp');

/** Most common colour (the backdrop of a pattern image). */
function modeColor(data) {
  const counts = new Map();
  for (let o = 0; o < data.length; o += 4) {
    const key = (data[o] << 16) | (data[o + 1] << 8) | data[o + 2];
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  let best = 0, n = -1;
  for (const [k, v] of counts) if (v > n) [best, n] = [k, v];
  return [best >> 16, (best >> 8) & 255, best & 255];
}

/**
 * Undo "pattern composited over `bg`": each pixel becomes the colour that,
 * laid over bg with some alpha, gives the original. Greys turn into white
 * marks (light-on-dark, like the original's dark-on-light); colours keep their
 * hue. `strength` scales the result's opacity.
 */
async function unblend(src, out, { bg, strength, greyAs = [255, 255, 255], resize, floor = 0.02, darkOnly = false }) {
  let img = sharp(src, { density: 72 }).ensureAlpha();
  if (resize) img = img.resize(resize);
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  if (bg === 'mode') bg = modeColor(data);
  const px = Buffer.alloc(info.width * info.height * 4);
  for (let i = 0; i < info.width * info.height; i++) {
    const o = i * 4;
    const c = [data[o], data[o + 1], data[o + 2]];
    // Smallest alpha that explains the pixel against bg.
    let a = 0;
    for (let k = 0; k < 3; k++) {
      const d = darkOnly ? Math.min(0, c[k] - bg[k]) : c[k] - bg[k];
      const room = d < 0 ? bg[k] : 255 - bg[k];
      if (room > 0) a = Math.max(a, Math.abs(d) / room);
    }
    if (a < floor) {
      px[o + 3] = 0;
      continue;
    }
    const fg = c.map((v, k) => Math.max(0, Math.min(255, Math.round(bg[k] + (v - bg[k]) / a))));
    const sat = Math.max(...fg) - Math.min(...fg);
    const col = sat < 48 ? greyAs : fg;
    px[o] = col[0];
    px[o + 1] = col[1];
    px[o + 2] = col[2];
    px[o + 3] = Math.round(Math.min(1, a * (sat < 48 ? strength.grey : strength.color)) * 255);
  }
  await sharp(px, { raw: { width: info.width, height: info.height, channels: 4 } })
    .webp({ quality: 82, alphaQuality: 80, effort: 6 })
    .toFile(join(PUBLIC, out));
  console.log(`${out}: ${info.width}x${info.height}`);
}

// Dotted page backdrop (white): grey dots -> faint white dots, green dots stay green.
await unblend(join(PUBLIC, 'bg.svg'), 'bg-dark.webp', { bg: [255, 255, 255], strength: { grey: 0.55, color: 1 } });
// Chat wallpaper (beige doodles): doodles -> faint light lines.
await unblend(join(PUBLIC, 'crm_bg.png'), 'crm_bg-dark.webp', { bg: 'mode', strength: { grey: 0.45, color: 0.45 }, floor: 0.04, darkOnly: true });
