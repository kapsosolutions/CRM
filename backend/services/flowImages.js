// WhatsApp Flows block remote image URLs — the `src` of an Image component (and
// option thumbnails) must be RAW base64 embedded in the Flow JSON. This fetches
// each hosted image and re-encodes it, downscaled to keep the JSON small:
//   • banners  → 1920×240 (8:1), matching the welcome-flow banner spec
//   • option thumbnails → 180×180 (1:1)
import sharp from 'sharp';
import logger from './logger.js';
import { safeGetBuffer } from './safeFetch.js';

// Thumbnail box for selection-list rows (static options and the dynamic rows
// the flow endpoint serves). 1:1, small enough that a whole list stays well
// inside Meta's ~300 KB image payload budget per request.
export const THUMB = { width: 180, height: 180 };
// Banner box for an Image component: 8:1, matching the welcome-flow spec.
export const BANNER = { width: 1920, height: 240 };

export async function fetchResizedBase64(url, { width, height }) {
  if (!url) return '';
  if (url.startsWith('data:')) return url.replace(/^data:[^;]+;base64,/, '');
  // A cold CDN object can take a while on the first hit, and a miss here is
  // costly: the URL stays in the Flow JSON and Meta rejects remote images
  // outright. So allow longer and retry once before giving up.
  const attempts = [30000, 45000];
  let lastError = '';
  for (const timeout of attempts) {
    try {
      // A business-supplied URL: internal addresses are refused.
      const data = await safeGetBuffer(url, { timeout, maxBytes: 15 * 1024 * 1024 });
      const out = await sharp(data)
        .resize(width, height, { fit: 'cover' })
        .jpeg({ quality: 80 })
        .toBuffer();
      return out.toString('base64');
    } catch (err) {
      lastError = err.message;
    }
  }
  logger.warn('flow image embed failed', { url, error: lastError });
  return '';
}

// ---------------------------------------------------------------------------
// Cache
//
// Dynamic rows (categories / members) are re-encoded on every INIT and
// data_exchange. Re-downloading and resizing each image per call would be slow
// enough to risk Meta's endpoint timeout, so results are held briefly.
// ---------------------------------------------------------------------------
const cache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 200;

/** `fetchResizedBase64` with a short-lived in-memory cache. */
export async function resizedBase64Cached(url, box = THUMB) {
  if (!url) return '';
  const key = `${url}|${box.width}x${box.height}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.b64;
  const b64 = await fetchResizedBase64(url, box);
  if (b64) {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(key, { at: Date.now(), b64 });
  }
  return b64;
}

/**
 * Mutate a plain flow object in place: swap remote image URLs for embedded,
 * resized base64 so the published Flow JSON renders images correctly.
 *
 * Any image that can't be embedded is dropped rather than left as a URL —
 * Flows reject remote images, so leaving one in would fail the whole publish
 * with a confusing validation error instead of just losing a picture.
 * @returns {Promise<string[]>} descriptions of the images that were dropped
 */
export async function embedFlowImages(flow) {
  const failed = [];

  const embed = async (url, box, label) => {
    // The builder's instant preview of a picked file. It only ever existed in
    // that browser tab: the upload didn't finish before the flow was saved.
    if (url.startsWith('blob:')) {
      failed.push(`${label} (it was saved before it finished uploading: upload it again, then republish)`);
      return '';
    }
    const b64 = await fetchResizedBase64(url, box);
    if (b64) return `data:image/jpeg;base64,${b64}`;
    failed.push(label);
    return '';
  };

  for (const s of flow.screens || []) {
    for (const c of s.components || []) {
      if (c.type === 'Image' && c.src && !c.src.startsWith('data:')) {
        c.src = await embed(c.src, BANNER, `banner image on "${s.id}"`);
      }
      if (Array.isArray(c.options)) {
        for (const o of c.options) {
          if (o.image && !o.image.startsWith('data:')) {
            o.image = await embed(o.image, THUMB, `image for option "${o.title || o.id}" on "${s.id}"`);
          }
        }
      }
    }
  }
  return failed;
}

export default { embedFlowImages, fetchResizedBase64, resizedBase64Cached, THUMB, BANNER };
