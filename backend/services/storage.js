// Bunny.net Storage upload/delete helper.
// Files are PUT to the storage zone; public URLs are served via the linked Pull
// Zone CDN host (BUNNY_CDN_URL).
//
// Layout — every tenant's media lives under its own folder so a business's
// assets are grouped and can be removed wholesale:
//   biz/<businessId>/<bucket>/<file>     e.g. biz/6ac4.../categories/abc.jpg
//   shared/<bucket>/<file>               when there's no tenant (super admin)
//
//   uploadBuffer(buffer, folder, resourceType) -> public URL
//   getOptimizedUrl(url, ratio)
//   deleteByUrl(url) / deleteMany(urls)
//   mediaFolder(businessId, bucket) -> storage folder for a tenant
//   keyFromUrl(url) -> storage key, or '' if the URL isn't ours
//   collectCdnUrls(obj) -> every storage URL referenced anywhere in an object
import axios from 'axios';
import logger from './logger.js';

const cfg = () => ({
  zone: process.env.BUNNY_STORAGE_ZONE || '',
  host: process.env.BUNNY_STORAGE_HOST || 'storage.bunnycdn.com',
  password: process.env.BUNNY_STORAGE_PASSWORD || '',
  cdn: (process.env.BUNNY_CDN_URL || '').replace(/\/$/, ''),
  // Account-level API key (bunny.net → Account Settings → API Key). Optional,
  // but without it a deleted file keeps being served from the Pull Zone edge
  // cache until its TTL expires, even though it's gone from storage.
  apiKey: process.env.BUNNY_API_KEY || '',
});

const BY_TYPE = {
  image: { ext: 'jpg', mime: 'image/jpeg' },
  video: { ext: 'mp4', mime: 'video/mp4' },
  raw: { ext: 'bin', mime: 'application/octet-stream' },
};

// Detect file type from magic bytes so Bunny serves the correct content-type.
function sniff(b) {
  if (!b || b.length < 12) return null;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { ext: 'png', mime: 'image/png' };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return { ext: 'gif', mime: 'image/gif' };
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return { ext: 'pdf', mime: 'application/pdf' };
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50)
    return { ext: 'webp', mime: 'image/webp' };
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return { ext: 'mp4', mime: 'video/mp4' };
  if (b[0] === 0x4f && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53) return { ext: 'ogg', mime: 'audio/ogg' };
  if ((b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return { ext: 'mp3', mime: 'audio/mpeg' };
  return null;
}

const rand = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const clean = (s) => String(s || '').replace(/[^a-z0-9/_-]/gi, '');

/** Storage folder for a tenant's bucket (inbound, categories, flows, …). */
export function mediaFolder(businessId, bucket = 'misc') {
  const b = clean(bucket) || 'misc';
  const id = clean(businessId);
  return id ? `biz/${id}/${b}` : `shared/${b}`;
}

// A key that could climb out of its folder once a server or proxy decodes /
// normalises it ("..", encoded dots or slashes, backslashes).
const UNSAFE_KEY = /(^|\/)\.\.?(\/|$)|%2e|%2f|%5c|\\|\/\//i;

/** The storage key for one of our URLs ('' when the URL isn't ours or isn't safe). */
export function keyFromUrl(url) {
  if (!url || typeof url !== 'string') return '';
  const { zone, host, cdn } = cfg();
  let key = '';
  if (cdn && url.startsWith(`${cdn}/`)) key = url.slice(cdn.length + 1);
  else if (zone && url.startsWith(`https://${host}/${zone}/`)) key = url.slice(`https://${host}/${zone}/`.length);
  key = key.split('?')[0].split('#')[0];
  if (!key || key.startsWith('/') || UNSAFE_KEY.test(key)) return '';
  return key;
}

/** May a request for `owner` (a business id; '' = super admin / system) delete this key? */
function ownsKey(key, owner) {
  if (!owner) return true;
  return key.startsWith(`biz/${clean(owner)}/`);
}

/** True when `url` is one of ours AND lives inside `folderPrefix`. */
export function isInFolder(url, folderPrefix) {
  const key = keyFromUrl(url);
  if (!key || !folderPrefix) return false;
  return key.startsWith(`${folderPrefix.replace(/\/$/, '')}/`);
}

/**
 * Every storage URL referenced anywhere inside `value` (deep scan).
 * Used to diff a flow/journey definition before vs after a save so media that
 * is no longer referenced can be removed.
 */
export function collectCdnUrls(value, out = new Set(), depth = 0) {
  if (depth > 12 || value == null) return out;
  if (typeof value === 'string') {
    if (keyFromUrl(value)) out.add(value.split('?')[0]);
    return out;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectCdnUrls(v, out, depth + 1);
    return out;
  }
  if (typeof value === 'object') {
    for (const v of Object.values(value)) collectCdnUrls(v, out, depth + 1);
  }
  return out;
}

const storage = {
  mediaFolder,
  keyFromUrl,
  isInFolder,
  collectCdnUrls,

  async uploadBuffer(buffer, folder = 'shared/misc', resourceType = 'image', { timeout = 30000 } = {}) {
    const { zone, host, password, cdn } = cfg();
    if (!zone || !password) throw new Error('Bunny storage not configured (BUNNY_STORAGE_ZONE / BUNNY_STORAGE_PASSWORD)');
    const kind = sniff(buffer) || BY_TYPE[resourceType] || BY_TYPE.raw;
    const key = `${folder}/${rand()}.${kind.ext}`.replace(/^\/+/, '');
    const putUrl = `https://${host}/${zone}/${key}`;
    await axios.put(putUrl, buffer, {
      headers: { AccessKey: password, 'Content-Type': kind.mime },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      timeout,
    });
    return cdn ? `${cdn}/${key}` : putUrl;
  },

  // Bunny Optimizer query params (no-op for 'original'; harmless if optimizer off).
  getOptimizedUrl(url, ratio = 'original') {
    if (!url) return url;
    if (ratio === '1:1') {
      const sep = url.includes('?') ? '&' : '?';
      return `${url}${sep}width=400&height=400&aspect_ratio=1:1`;
    }
    return url;
  },

  /**
   * Drop the CDN edge cache for a URL. Deleting from storage alone leaves the
   * Pull Zone serving a cached copy, so a "deleted" file stays publicly
   * reachable until its TTL expires. Needs BUNNY_API_KEY.
   */
  async purgeUrl(url) {
    const { apiKey } = cfg();
    if (!apiKey || !url) return false;
    try {
      await axios.post(`https://api.bunny.net/purge?url=${encodeURIComponent(url)}`, null, {
        headers: { AccessKey: apiKey },
        timeout: 20000,
      });
      return true;
    } catch (err) {
      logger.warn('bunny purge failed', { url, error: err.response?.data || err.message });
      return false;
    }
  },

  /**
   * Delete one of our files. `owner` is the business making the request:
   * then only files under biz/<owner>/ are deleted (a definition saved with
   * another tenant's URL can't make us delete that tenant's file).
   */
  async deleteByUrl(url, owner = '') {
    try {
      const { zone, host, password } = cfg();
      if (!password) return false;
      const key = keyFromUrl(url);
      if (!key) return false;
      if (!ownsKey(key, owner)) {
        logger.warn('storage delete refused: outside the business folder', { key, owner: String(owner) });
        return false;
      }
      await axios.delete(`https://${host}/${zone}/${key}`, {
        headers: { AccessKey: password },
        timeout: 20000,
      });
      logger.debug('bunny delete ok', { key });
      // Also evict the edge cache so the URL stops resolving publicly.
      this.purgeUrl(url).catch(() => {});
      return true;
    } catch (err) {
      // 404 means it's already gone — that's the desired end state.
      if (err.response?.status === 404) {
        this.purgeUrl(url).catch(() => {});
        return true;
      }
      logger.warn('bunny delete failed', { url, error: err.response?.data || err.message });
      return false;
    }
  },

  /**
   * The files directly inside `folder` (no sub-folders): { key, size, createdAt }.
   * An unknown folder is an empty list.
   */
  async listFolder(folder) {
    const { zone, host, password } = cfg();
    if (!zone || !password) return [];
    const dir = `${String(folder).replace(/^\/+|\/+$/g, '')}/`;
    try {
      const r = await axios.get(`https://${host}/${zone}/${dir}`, {
        headers: { AccessKey: password, Accept: 'application/json' },
        timeout: 30000,
      });
      return (Array.isArray(r.data) ? r.data : [])
        .filter((f) => !f.IsDirectory && f.ObjectName)
        .map((f) => ({
          key: `${dir}${f.ObjectName}`,
          size: f.Length || 0,
          // Bunny gives UTC without a zone mark.
          createdAt: new Date(/[zZ]|[+-]\d\d:\d\d$/.test(String(f.DateCreated)) ? f.DateCreated : `${f.DateCreated}Z`),
        }));
    } catch (err) {
      if (err.response?.status === 404) return [];
      throw err;
    }
  },

  /** The public URL of a storage key. */
  urlOf(key) {
    const { zone, host, cdn } = cfg();
    return cdn ? `${cdn}/${key}` : `https://${host}/${zone}/${key}`;
  },

  /** Best-effort delete of many URLs. Returns how many were removed. */
  async deleteMany(urls = [], owner = '') {
    let n = 0;
    for (const url of new Set([...urls].filter(Boolean))) {
      // eslint-disable-next-line no-await-in-loop
      if (await this.deleteByUrl(url, owner)) n += 1;
    }
    return n;
  },

  /** Delete a whole folder (e.g. every asset belonging to one business). */
  async deleteFolder(folder) {
    try {
      const { zone, host, password } = cfg();
      if (!password || !folder) return false;
      await axios.delete(`https://${host}/${zone}/${folder.replace(/\/$/, '')}/`, {
        headers: { AccessKey: password },
        timeout: 30000,
      });
      return true;
    } catch (err) {
      if (err.response?.status === 404) return true;
      logger.warn('bunny delete folder failed', { folder, error: err.response?.data || err.message });
      return false;
    }
  },
};

export default storage;
