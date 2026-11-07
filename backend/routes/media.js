// Generic media upload/delete — stores files on Bunny under the caller's own
// business folder and returns the public URL. Used by the journey/flow builders
// so picked images/videos/pdfs persist as real CDN URLs (not blob/data URLs).
//
// DELETE is how a builder drops a file it just uploaded (e.g. the user replaced
// the image again before saving). It only ever deletes inside the caller's own
// folder, so one tenant can never remove another's media.
import express from 'express';
import { requireAuth, bizId } from '../middleware/auth.js';
import { uploadMedia } from '../middleware/upload.js';
import storage, { mediaFolder } from '../services/storage.js';
import logger from '../services/logger.js';

const router = express.Router();
router.use(requireAuth);

// Builder folders map to a bucket name under the tenant's folder. The legacy
// `folder=crm/flows` style query is accepted and reduced to its last segment.
const bucketOf = (q) => {
  const raw = String(q || 'builder').replace(/[^a-z0-9/_-]/gi, '');
  const last = raw.split('/').filter(Boolean).pop() || 'builder';
  return last;
};

router.post('/upload', uploadMedia.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file' });
    const mime = req.file.mimetype || '';
    const resourceType = mime.startsWith('image/')
      ? 'image'
      : mime.startsWith('video/') || mime.startsWith('audio/')
        ? 'video'
        : 'raw';
    const folder = mediaFolder(bizId(req), bucketOf(req.query.folder));
    const url = await storage.uploadBuffer(req.file.buffer, folder, resourceType);
    res.json({ success: true, url });
  } catch (err) {
    logger.error('media upload failed', { error: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
});

// Remove a file the caller owns. Accepts ?url= or { url } in the body.
router.delete('/', async (req, res) => {
  try {
    const url = String(req.query.url || req.body?.url || '');
    if (!url) return res.status(400).json({ success: false, message: 'url required' });

    const key = storage.keyFromUrl(url);
    if (!key) return res.status(400).json({ success: false, message: 'Not a storage URL' });

    // Scope guard: a tenant may only delete files under its own folder.
    const id = bizId(req);
    if (id && !key.startsWith(`biz/${id}/`)) {
      logger.warn('media delete denied (outside tenant folder)', { key, businessId: id });
      return res.status(403).json({ success: false, message: 'Not your media' });
    }

    const ok = await storage.deleteByUrl(url, id);
    res.json({ success: ok });
  } catch (err) {
    logger.error('media delete failed', { error: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
