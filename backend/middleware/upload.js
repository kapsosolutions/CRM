// Multer memory storage — buffers are streamed straight to Cloudinary.
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import multer from 'multer';

// Image / video / audio / document (used for CRM media + template headers).
export const uploadMedia = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 16 * 1024 * 1024 }, // 16 MB
  fileFilter: (_req, file, cb) => {
    if (/^(image|video|audio)\//.test(file.mimetype)) return cb(null, true);
    // Allow common document types too.
    if (/(pdf|msword|officedocument|excel|powerpoint|zip|text|octet-stream)/.test(file.mimetype)) {
      return cb(null, true);
    }
    cb(new Error('Unsupported file type'));
  },
});

// ---- Ads Manager: images and videos for ad creatives (routes/ads.js) ----
// Their own instances, separate from the 16 MB CRM media limit above.
export const AD_IMAGE_MAX = 8 * 1024 * 1024; // Meta takes up to 30 MB; 8 MB is plenty for an ad image
export const AD_VIDEO_MAX = 250 * 1024 * 1024; // non-resumable /advideos upload
export const AD_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif'];
export const AD_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/x-m4v'];

/** Ad images are small: kept in memory and sent to Meta as base64 `bytes`. */
export const uploadAdImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: AD_IMAGE_MAX, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (AD_IMAGE_TYPES.includes(file.mimetype)) return cb(null, true);
    cb(Object.assign(new Error('Use a JPG, PNG or GIF image.'), { code: 'BAD_FILE_TYPE' }));
  },
});

/**
 * Ad videos can be hundreds of MB, so they go to a temp file instead of
 * memory. routes/ads.js runs a gate before this (connection, ads_management,
 * Graph version, one upload per business, a server-wide cap), so nothing is
 * written for a request that would be refused. The service sends the file to
 * Meta in a background job and deletes it when the job ends.
 * nginx: this route needs `client_max_body_size 260m` (250 MB + multipart).
 */
export const AD_VIDEO_TMP_PREFIX = 'crm-advideo-';
export const uploadAdVideo = multer({
  storage: multer.diskStorage({
    destination: os.tmpdir(),
    filename: (_req, file, cb) => cb(null, `${AD_VIDEO_TMP_PREFIX}${crypto.randomBytes(8).toString('hex')}${path.extname(file.originalname || '').slice(0, 8).replace(/[^.\w]/g, '')}`),
  }),
  limits: { fileSize: AD_VIDEO_MAX, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (AD_VIDEO_TYPES.includes(file.mimetype)) return cb(null, true);
    cb(Object.assign(new Error('Use an MP4 or MOV video.'), { code: 'BAD_FILE_TYPE' }));
  },
});

// ---- Create: photos and videos for Facebook / Instagram posts (routes/social.js) ----
// nginx allows 100 MB per request; 95 MB leaves room for the multipart wrapper.
export const SOCIAL_IMAGE_MAX = 15 * 1024 * 1024; // re-encoded to JPEG (Instagram takes JPEG only, ≤ 8 MB)
export const SOCIAL_VIDEO_MAX = 95 * 1024 * 1024;
export const SOCIAL_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const SOCIAL_VIDEO_TYPES = ['video/mp4', 'video/quicktime'];
export const uploadSocialMedia = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: SOCIAL_VIDEO_MAX, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (SOCIAL_IMAGE_TYPES.includes(file.mimetype) || SOCIAL_VIDEO_TYPES.includes(file.mimetype)) return cb(null, true);
    cb(Object.assign(new Error('Use a JPG, PNG or WebP photo, or an MP4 or MOV video.'), { code: 'BAD_FILE_TYPE' }));
  },
});

// ---- Content checks (the declared mimetype comes from the browser) ----

/** 'jpeg' | 'png' | 'gif' from the first bytes, '' for anything else. */
export function imageKindOf(buf) {
  if (!buf || buf.length < 6) return '';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  const head = buf.subarray(0, 6).toString('latin1');
  if (head === 'GIF87a' || head === 'GIF89a') return 'gif';
  return '';
}

/** MP4 / MOV / M4V (ISO base media): an `ftyp` box at offset 4. */
export function isVideoBytes(buf) {
  return !!buf && buf.length >= 12 && buf.subarray(4, 8).toString('latin1') === 'ftyp';
}

/** The first 12 bytes of a file on disk pass isVideoBytes. */
export async function isVideoFile(filePath) {
  let fh;
  try {
    fh = await fs.promises.open(filePath, 'r');
    const buf = Buffer.alloc(12);
    const { bytesRead } = await fh.read(buf, 0, 12, 0);
    return isVideoBytes(buf.subarray(0, bytesRead));
  } catch {
    return false;
  } finally {
    await fh?.close().catch(() => {});
  }
}

export default uploadMedia;
