// Create: publish posts, carousels, videos, reels and stories to the connected
// Facebook Page / Instagram account (services/socialPublish.js), and the
// Comment auto-DM rules (services/commentAutoDm.js). Every route is scoped to
// req.business; no token ever appears in a response.
import express from 'express';
import { requireBusiness } from '../middleware/auth.js';
import { uploadSocialMedia, SOCIAL_VIDEO_MAX } from '../middleware/upload.js';
import { ChannelError } from '../services/metaChannels.js';
import {
  socialOverview, storeUpload, listPosts, createPost, deletePost, retryPost, recentPosts,
} from '../services/socialPublish.js';
import {
  listRules, listReplies, createRule, updateRule, deleteRule,
} from '../services/commentAutoDm.js';
import logger from '../services/logger.js';

const router = express.Router();
router.use(requireBusiness);

function fail(res, err, what) {
  if (err instanceof ChannelError) {
    if (err.status >= 500) logger.warn(`${what} refused`, { code: err.code, error: err.message });
    return res.status(err.status).json(err.toJSON());
  }
  logger.error(`${what} failed`, { error: err.message });
  return res.status(500).json({ success: false, code: 'SOCIAL_FAILED', message: 'Something went wrong. Please try again.' });
}

const handle = (what, fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    fail(res, err, what);
  }
};

// Uploads are held in memory (up to 95 MB): one at a time per business and a
// few per server.
const uploading = new Set();
const MAX_UPLOADS = 4;
const uploadGate = (req, res, next) => {
  const id = String(req.business._id);
  if (uploading.has(id) || uploading.size >= MAX_UPLOADS) {
    req.resume();
    return res.status(429).json({ success: false, code: 'UPLOAD_BUSY', message: 'Another upload is still going. Wait for it to finish, then try again.' });
  }
  uploading.add(id);
  res.on('close', () => uploading.delete(id));
  return next();
};
const withUpload = (req, res, next) => uploadSocialMedia.single('file')(req, res, (err) => {
  if (!err) return next();
  const tooBig = err.code === 'LIMIT_FILE_SIZE';
  return fail(res, new ChannelError(
    tooBig ? `That file is larger than ${Math.round(SOCIAL_VIDEO_MAX / (1024 * 1024))} MB.` : err.message || 'That file can’t be used.',
    { status: tooBig ? 413 : 400, code: tooBig ? 'FILE_TOO_LARGE' : 'BAD_FILE' },
  ), 'social upload');
});

// The connected accounts, what each can do, Meta's limits.
router.get('/', handle('social overview', async (req, res) => {
  res.json({ success: true, ...(await socialOverview(req.business)) });
}));

// multipart 'file' → { media: { url, type, width, height, size } }
router.post('/upload', uploadGate, withUpload, handle('social upload', async (req, res) => {
  res.json({ success: true, media: await storeUpload(req.business._id, req.file) });
}));

router.get('/posts', handle('social posts', async (req, res) => {
  res.json({ success: true, data: await listPosts(req.business, { limit: req.query.limit }) });
}));

router.post('/posts', handle('social post create', async (req, res) => {
  res.status(201).json({ success: true, post: await createPost(req.business, req.body || {}) });
}));

router.post('/posts/:id/retry', handle('social post retry', async (req, res) => {
  res.json({ success: true, post: await retryPost(req.business, req.params.id) });
}));

router.delete('/posts/:id', handle('social post delete', async (req, res) => {
  res.json({ success: true, ...(await deletePost(req.business, req.params.id)) });
}));

// ?target=facebook|instagram → the latest posts / reels (rule post picker)
router.get('/recent', handle('social recent posts', async (req, res) => {
  res.json({ success: true, data: await recentPosts(req.business, String(req.query.target || '')) });
}));

router.get('/comment-rules', handle('comment rules', async (req, res) => {
  const [rules, activity] = await Promise.all([listRules(req.business), listReplies(req.business, { limit: req.query.limit })]);
  res.json({ success: true, data: rules, activity });
}));

router.post('/comment-rules', handle('comment rule create', async (req, res) => {
  res.status(201).json({ success: true, ...(await createRule(req.business, req.body || {})) });
}));

router.put('/comment-rules/:id', handle('comment rule update', async (req, res) => {
  res.json({ success: true, ...(await updateRule(req.business, req.params.id, req.body || {})) });
}));

router.delete('/comment-rules/:id', handle('comment rule delete', async (req, res) => {
  await deleteRule(req.business, req.params.id);
  res.json({ success: true });
}));

export default router;
