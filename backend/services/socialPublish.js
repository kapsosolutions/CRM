// ---------------------------------------------------------------------------
// Create: publishing posts, carousels, videos, reels and stories to the
// business's connected Facebook Page and Instagram professional account,
// now or at a scheduled time.
//
// Accounts: the Facebook target is the Messenger connection's Page (its Page
// token); the Instagram target is the Instagram connection, either through
// the Page (graph.facebook.com, Page token) or Business Login for Instagram
// (graph.instagram.com, Instagram user token). No new login: the business
// reconnects once the app has the publishing permissions.
//
// Meta's endpoints:
//   Facebook  POST /{page}/feed             text post, or photos attached_media
//             POST /{page}/photos           one photo (published=false: for an album / a story)
//             POST graph-video…/{page}/videos   video, Meta fetches file_url
//             POST /{page}/video_reels      start → rupload.facebook.com (file_url header) → finish
//             POST /{page}/photo_stories, /{page}/video_stories
//   Instagram POST /{ig}/media              a container (image_url JPEG / video_url, REELS,
//                                           STORIES, CAROUSEL with children)
//             GET  /{container}?fields=status_code   IN_PROGRESS → FINISHED
//             POST /{ig}/media_publish      creation_id → the media id
//
// Scheduling is the CRM's own (Instagram's API has none, and a Facebook
// scheduled post can't be a story): a post waits as 'scheduled' and the
// ticker below publishes it when its time comes. Each run holds a lease
// (lockedBy / lockedUntil), so two ticks never publish one post twice. A
// target that Meta is still processing (a video container, a reel) is looked
// at again on later ticks until it is done.
// ---------------------------------------------------------------------------
import axios from 'axios';
import crypto from 'crypto';
import sharp from 'sharp';
import SocialPost from '../models/SocialPost.js';
import ChannelConnection from '../models/ChannelConnection.js';
import storage, { isInFolder, mediaFolder } from './storage.js';
import { decryptToken } from './tokenCrypto.js';
import { withConnectionToken, ChannelError } from './metaChannels.js';
import { IG, isInstagramLogin } from './instagramGraph.js';
import {
  SOCIAL_IMAGE_MAX, SOCIAL_IMAGE_TYPES, SOCIAL_VIDEO_TYPES, isVideoBytes,
} from '../middleware/upload.js';
import { notify } from './notifications.js';
import logger from './logger.js';

export const KINDS = ['post', 'carousel', 'video', 'reel', 'story'];
export const TARGETS = ['facebook', 'instagram'];
export const TARGET_LABEL = { facebook: 'Facebook', instagram: 'Instagram' };
const KIND_LABEL = { post: 'Post', carousel: 'Carousel', video: 'Video', reel: 'Reel', story: 'Story' };
const TERMINAL = ['published', 'failed'];

export const LIMITS = {
  instagramCaption: 2200,
  instagramHashtags: 30,
  facebookCaption: 63206,
  carouselMin: 2,
  carouselMax: 10,
  minLeadMs: 2 * 60 * 1000, // a scheduled time at least 2 minutes ahead
  maxAheadMs: 75 * 24 * 60 * 60 * 1000,
  waiting: 50, // scheduled / publishing posts per business
};

// The permissions each part needs (Meta's names). A connection whose scopes
// are known and lack one of these gets a "reconnect" note on the Create page.
export const NEEDED_SCOPES = {
  facebook: {
    publish: ['pages_manage_posts'],
    comments: ['pages_read_engagement', 'pages_manage_metadata', 'pages_messaging'],
  },
  instagram: {
    publish: ['instagram_content_publish'],
    comments: ['instagram_manage_comments', 'instagram_manage_messages'],
  },
  instagramLogin: {
    publish: ['instagram_business_content_publish'],
    comments: ['instagram_business_manage_comments', 'instagram_business_manage_messages'],
  },
};

const TICK_MS = 10 * 1000;
const LEASE_MS = 3 * 60 * 1000;
const CHECK_MS = 10 * 1000; // a target still processing at Meta is looked at again after this
const PROCESS_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const SCOPES_TTL_MS = 6 * 60 * 60 * 1000;

const version = () => process.env.WA_GRAPH_VERSION || 'v22.0';
const G = () => `https://graph.facebook.com/${version()}`;
const GV = () => `https://graph-video.facebook.com/${version()}`;
const RUPLOAD = () => `https://rupload.facebook.com/video-upload/${version()}`;
const http = axios.create({ timeout: 60000 });
const bearer = (token) => ({ headers: { Authorization: `Bearer ${token}` } });
const appToken = () => `${process.env.META_APP_ID}|${process.env.META_APP_SECRET}`;
const metaErr = (err) => err?.response?.data?.error || null;
const metaText = (err) => {
  const e = metaErr(err);
  return e?.error_user_msg || e?.message || err?.message || 'Unknown error';
};

const invalid = (message, code = 'INVALID_POST', status = 400) => new ChannelError(message, { status, code });

// ---------------------------------------------------------------- accounts --

/** The connection each target publishes with: { facebook, instagram } (null when none). */
export async function targetRows(businessId) {
  const rows = await ChannelConnection.find({ businessId: String(businessId), channel: { $in: ['messenger', 'instagram'] } }).lean();
  return {
    facebook: rows.find((r) => r.channel === 'messenger') || null,
    instagram: rows.find((r) => r.channel === 'instagram') || null,
  };
}

const scopeSet = (target, row) => (target === 'facebook' ? NEEDED_SCOPES.facebook : isInstagramLogin(row) ? NEEDED_SCOPES.instagramLogin : NEEDED_SCOPES.instagram);

/**
 * The permissions Meta granted the connection. Page tokens: debug_token
 * (app token), cached on the row for 6 hours. Instagram login: what the login
 * returned. [] when unknown.
 */
export async function grantedScopes(row) {
  if (!row) return [];
  if (isInstagramLogin(row) || row.status !== 'connected') return row.grantedScopes || [];
  const checked = row.permissionsCheckedAt ? new Date(row.permissionsCheckedAt).getTime() : 0;
  if ((row.grantedScopes || []).length && Date.now() - checked < SCOPES_TTL_MS) return row.grantedScopes;
  if (!process.env.META_APP_ID || !process.env.META_APP_SECRET) return row.grantedScopes || [];
  const token = decryptToken(row.pageAccessToken);
  if (!token) return [];
  try {
    const { data } = await http.get(`${G()}/debug_token`, { params: { input_token: token, access_token: appToken() }, timeout: 15000 });
    const scopes = Array.isArray(data?.data?.scopes) ? data.data.scopes.map(String) : [];
    if (scopes.length) {
      await ChannelConnection.updateOne({ _id: row._id }, { $set: { grantedScopes: scopes, permissionsCheckedAt: new Date() } });
    }
    return scopes;
  } catch (err) {
    logger.info('could not read the connection’s permissions (debug_token)', { channel: row.channel, error: metaText(err) });
    return row.grantedScopes || [];
  }
}

/** { ok: true | false | null (unknown), missing } for 'publish' or 'comments'. */
export function capability(target, row, scopes, part) {
  const need = scopeSet(target, row)[part] || [];
  if (!scopes?.length) return { ok: null, missing: [] };
  const missing = need.filter((s) => !scopes.includes(s));
  return { ok: missing.length === 0, missing };
}

function presentAccount(target, row) {
  return {
    target,
    status: row.status || 'connected',
    name: target === 'facebook' ? row.pageName || 'Facebook Page' : `@${row.igUsername || row.igUserId}`,
    username: row.igUsername || '',
    pageId: row.pageId || '',
    igUserId: row.igUserId || '',
    pictureUrl: row.pictureUrl || '',
    loginMethod: target === 'instagram' ? (isInstagramLogin(row) ? 'instagram' : 'facebook') : '',
  };
}

/** GET /api/social: the accounts, what each can do, and Meta's limits. */
export async function socialOverview(business) {
  const rows = await targetRows(business._id);
  const accounts = {};
  for (const t of TARGETS) {
    const row = rows[t];
    if (!row) {
      accounts[t] = null;
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const scopes = await grantedScopes(row);
    accounts[t] = {
      ...presentAccount(t, row),
      publish: capability(t, row, scopes, 'publish'),
      comments: capability(t, row, scopes, 'comments'),
      commentsWebhook: t === 'facebook'
        ? (row.subscribedFields || []).includes('feed')
        : isInstagramLogin(row) ? (row.subscribedFields || []).includes('comments') : null,
    };
  }
  return { accounts, limits: LIMITS };
}

// ----------------------------------------------------------------- upload --

/**
 * A photo or video picked on the Create page → the business's storage
 * (Meta fetches it from there). Photos are turned upright, scaled to at most
 * 1440 px wide and re-encoded as JPEG, which is all Instagram accepts.
 */
export async function storeUpload(businessId, file) {
  if (!file?.buffer?.length) throw invalid('No file was received.', 'NO_FILE');
  const folder = mediaFolder(String(businessId), 'social');
  if (SOCIAL_IMAGE_TYPES.includes(file.mimetype)) {
    if (file.size > SOCIAL_IMAGE_MAX) throw invalid('Photos can be up to 15 MB.', 'FILE_TOO_LARGE', 413);
    let out;
    try {
      out = await sharp(file.buffer, { failOn: 'error' })
        .rotate()
        .resize({ width: 1440, withoutEnlargement: true })
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: 88, mozjpeg: true })
        .toBuffer({ resolveWithObject: true });
    } catch {
      throw invalid('That file isn’t a photo the CRM can read. Use a JPG, PNG or WebP.', 'BAD_FILE');
    }
    const url = await storage.uploadBuffer(out.data, folder, 'image');
    return { url, type: 'image', width: out.info.width, height: out.info.height, size: out.info.size };
  }
  if (SOCIAL_VIDEO_TYPES.includes(file.mimetype)) {
    if (!isVideoBytes(file.buffer)) throw invalid('That file isn’t an MP4 or MOV video.', 'BAD_FILE');
    const url = await storage.uploadBuffer(file.buffer, folder, 'video', { timeout: 5 * 60 * 1000 });
    return { url, type: 'video', width: null, height: null, size: file.size };
  }
  throw invalid('Use a JPG, PNG or WebP photo, or an MP4 or MOV video.', 'BAD_FILE_TYPE');
}

// ------------------------------------------------------------- validation --

const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : null);

/** The post as the browser sent it → what is stored, or a 400 with the reason. */
export function validatePost(input = {}, rows = {}, businessId = '', now = Date.now()) {
  const kind = String(input.kind || '');
  if (!KINDS.includes(kind)) throw invalid('Pick what to create: a post, carousel, video, reel or story.');
  const targets = [...new Set((Array.isArray(input.targets) ? input.targets : []).map(String))].filter((t) => TARGETS.includes(t));
  if (!targets.length) throw invalid('Choose where to publish: Facebook, Instagram or both.', 'TARGET_REQUIRED');
  for (const t of targets) {
    const row = rows[t];
    if (!row) {
      throw invalid(
        t === 'facebook'
          ? 'Your Facebook Page isn’t connected. Connect it (Messenger) on Channel Status first.'
          : 'Instagram isn’t connected. Connect it on Channel Status first.',
        'NOT_CONNECTED', 409,
      );
    }
    if (row.status !== 'connected') {
      throw invalid(`${TARGET_LABEL[t]} was disconnected at Meta. Reconnect it on Channel Status first.`, 'NOT_CONNECTED', 409);
    }
  }
  if (kind === 'video' && targets.includes('instagram')) {
    throw invalid('On Instagram, videos are posted as reels. Choose Reel to post this video on Instagram.');
  }

  // Stories carry no caption on either network.
  const caption = kind === 'story' ? '' : String(input.caption || '').replace(/\r\n/g, '\n').trim();
  if (caption.length > LIMITS.facebookCaption) throw invalid('The caption is too long.');
  if (targets.includes('instagram')) {
    if (caption.length > LIMITS.instagramCaption) {
      throw invalid(`Instagram captions can be at most ${LIMITS.instagramCaption.toLocaleString('en-US')} characters.`);
    }
    const tags = caption.match(/#[\p{L}\p{N}_]+/gu) || [];
    if (tags.length > LIMITS.instagramHashtags) throw invalid(`Instagram allows at most ${LIMITS.instagramHashtags} hashtags in a caption.`);
  }

  const media = (Array.isArray(input.media) ? input.media : []).slice(0, LIMITS.carouselMax + 1).map((m) => ({
    url: String(m?.url || ''),
    type: m?.type === 'video' ? 'video' : 'image',
    width: num(m?.width),
    height: num(m?.height),
  }));
  for (const m of media) {
    if (!/^https:\/\//.test(m.url) || !isInFolder(m.url, `biz/${businessId}/`)) {
      throw invalid('Upload the photos and videos here, so Meta can fetch them from the CRM.', 'MEDIA_NOT_UPLOADED');
    }
  }
  const images = media.filter((m) => m.type === 'image');
  const videos = media.filter((m) => m.type === 'video');
  switch (kind) {
    case 'post':
      if (videos.length) throw invalid('A post takes one photo. For a video, choose Video or Reel.');
      if (images.length > 1) throw invalid('A post takes one photo. For more, choose Carousel.');
      if (targets.includes('instagram') && !images.length) throw invalid('Instagram posts need a photo.');
      if (!images.length && !caption) throw invalid('Write something or add a photo.');
      break;
    case 'carousel':
      if (media.length < LIMITS.carouselMin || media.length > LIMITS.carouselMax) {
        throw invalid(`A carousel takes ${LIMITS.carouselMin} to ${LIMITS.carouselMax} photos or videos.`);
      }
      if (targets.includes('facebook') && videos.length) {
        throw invalid('Facebook albums take photos only. Remove the videos, or publish this carousel to Instagram only.');
      }
      break;
    case 'video':
    case 'reel':
      if (media.length !== 1 || !videos.length) throw invalid(`A ${kind} takes one video (MP4 or MOV).`);
      break;
    case 'story':
      if (media.length !== 1) throw invalid('A story takes one photo or one video.');
      break;
    default:
      break;
  }
  if (targets.includes('instagram')) {
    for (const m of images) {
      if (m.width && m.width < 320) throw invalid('Instagram needs photos at least 320 pixels wide.');
      // Feed photos: between 4:5 (portrait) and 1.91:1 (landscape). Stories are full screen.
      if (kind !== 'story' && m.width && m.height) {
        const r = m.width / m.height;
        if (r < 0.8 - 0.005 || r > 1.91 + 0.005) {
          throw invalid('Instagram feed photos must be between 4:5 (portrait) and 1.91:1 (landscape). Crop the photo and upload it again.', 'ASPECT_RATIO');
        }
      }
    }
  }

  let scheduledAt = null;
  if (input.scheduledAt) {
    const d = new Date(input.scheduledAt);
    if (Number.isNaN(d.getTime())) throw invalid('That date and time isn’t valid.');
    if (d.getTime() < now + LIMITS.minLeadMs) throw invalid('Pick a time at least a few minutes from now, or publish now.');
    if (d.getTime() > now + LIMITS.maxAheadMs) throw invalid('Posts can be scheduled up to 75 days ahead.');
    scheduledAt = d;
  }
  return { kind, targets, caption, media, scheduledAt };
}

// ------------------------------------------------------------ posts CRUD --

/** What the browser sees: never container ids or lease fields. */
export function presentPost(p) {
  if (!p) return null;
  const results = {};
  for (const t of p.targets || []) {
    const r = (p.results || {})[t] || {};
    results[t] = {
      state: r.state || 'pending',
      id: r.id || '',
      permalink: r.permalink || '',
      error: r.error || null,
      publishedAt: r.publishedAt || null,
    };
  }
  return {
    id: String(p._id),
    kind: p.kind,
    targets: p.targets || [],
    caption: p.caption || '',
    media: (p.media || []).map((m) => ({ url: m.url, type: m.type, width: m.width || null, height: m.height || null })),
    scheduledAt: p.scheduledAt || null,
    status: p.status,
    results,
    publishedAt: p.publishedAt || null,
    createdAt: p.createdAt || null,
  };
}

export async function listPosts(business, { limit = 50 } = {}) {
  const rows = await SocialPost.find({ businessId: business._id }).sort({ createdAt: -1 }).limit(Math.min(100, Math.max(1, Number(limit) || 50))).lean();
  return rows.map(presentPost);
}

/** Create a post: published at once (no scheduledAt) or at its time. */
export async function createPost(business, input) {
  const rows = await targetRows(business._id);
  const v = validatePost(input, rows, String(business._id));
  const waiting = await SocialPost.countDocuments({ businessId: business._id, status: { $in: ['scheduled', 'publishing'] } });
  if (waiting >= LIMITS.waiting) {
    throw invalid(`You already have ${LIMITS.waiting} posts waiting to go out. Wait for some to publish, or cancel a few.`, 'TOO_MANY_WAITING', 429);
  }
  const now = new Date();
  const doc = await SocialPost.create({
    businessId: business._id,
    kind: v.kind,
    targets: v.targets,
    caption: v.caption,
    media: v.media,
    scheduledAt: v.scheduledAt || now,
    status: 'scheduled',
    results: Object.fromEntries(v.targets.map((t) => [t, { state: 'pending', attempts: 0 }])),
  });
  logger.info('social post created', {
    business: business.name, kind: v.kind, targets: v.targets, scheduled: !!v.scheduledAt,
  });
  if (!v.scheduledAt) kick(doc._id);
  return presentPost(doc);
}

/** Cancel a post that hasn't started, or remove a finished one from the list (it stays on Facebook / Instagram). */
export async function deletePost(business, id) {
  const p = await SocialPost.findOne({ _id: String(id), businessId: business._id }).lean();
  if (!p) throw invalid('That post isn’t here any more.', 'NOT_FOUND', 404);
  if (p.status === 'publishing') throw invalid('This post is being published right now. Wait a moment and try again.', 'BUSY', 409);
  const r = await SocialPost.deleteOne({ _id: p._id, businessId: business._id, status: { $ne: 'publishing' } });
  if (!r.deletedCount) throw invalid('This post is being published right now. Wait a moment and try again.', 'BUSY', 409);
  return { cancelled: p.status === 'scheduled' };
}

/** Try the targets that failed again, now. */
export async function retryPost(business, id) {
  const p = await SocialPost.findOne({ _id: String(id), businessId: business._id }).lean();
  if (!p) throw invalid('That post isn’t here any more.', 'NOT_FOUND', 404);
  if (!['failed', 'partial'].includes(p.status)) throw invalid('Only a post that failed can be tried again.', 'NOT_FAILED', 409);
  const rows = await targetRows(business._id);
  const failed = (p.targets || []).filter((t) => (p.results || {})[t]?.state === 'failed');
  for (const t of failed) {
    if (!rows[t] || rows[t].status !== 'connected') {
      throw invalid(`${TARGET_LABEL[t]} isn’t connected. Reconnect it on Channel Status, then try again.`, 'NOT_CONNECTED', 409);
    }
  }
  const results = { ...(p.results || {}) };
  for (const t of failed) results[t] = { state: 'pending', attempts: 0 };
  const r = await SocialPost.updateOne(
    { _id: p._id, businessId: business._id, status: p.status },
    { $set: { results, status: 'scheduled', scheduledAt: new Date(), nextCheckAt: null, publishedAt: p.publishedAt || null } },
  );
  if (!r.matchedCount) throw invalid('This post changed meanwhile. Refresh and try again.', 'BUSY', 409);
  kick(p._id);
  return presentPost(await SocialPost.findById(p._id).lean());
}

// ------------------------------------------------------------- publishing --

const nowIso = () => new Date().toISOString();
function done(res, id, permalink = '') {
  Object.assign(res, { state: 'published', id: String(id || ''), permalink, publishedAt: nowIso(), error: null });
  delete res.retryAt;
}
function fail(res, code, message) {
  Object.assign(res, { state: 'failed', error: { code, message } });
  delete res.retryAt;
}
const fbLink = (postId) => (postId ? `https://www.facebook.com/${postId}` : '');

/** Facebook's resumable upload for reels / video stories: start, then Meta fetches the file. */
async function fbResumable(edge, token, fileUrl) {
  const { data: s } = await http.post(edge, { upload_phase: 'start' }, bearer(token));
  const videoId = String(s?.video_id || '');
  if (!videoId) throw new Error('Facebook did not start the video upload');
  const uploadUrl = s.upload_url || `${RUPLOAD()}/${videoId}`;
  const { data: u } = await http.post(uploadUrl, null, {
    headers: { Authorization: `OAuth ${token}`, file_url: fileUrl },
    timeout: 120000,
  });
  if (u && u.success === false) throw new Error('Facebook could not fetch the video');
  return videoId;
}

/** A reel after 'finish': processing → published, or Meta's error. */
async function fbCheckVideo(token, res) {
  const { data } = await http.get(`${G()}/${res.videoId}`, { params: { fields: 'status' }, ...bearer(token) });
  const st = data?.status || {};
  const pub = st.publishing_phase?.status || '';
  const failed = st.video_status === 'error' || pub === 'error' || st.processing_phase?.status === 'error' || st.uploading_phase?.status === 'error';
  if (failed) {
    const why = st.processing_phase?.errors?.[0]?.message || st.publishing_phase?.errors?.[0]?.message || st.uploading_phase?.errors?.[0]?.message || '';
    return fail(res, 'META_VIDEO_ERROR', `Facebook couldn’t process the video${why ? `: ${why}` : '. Use an MP4 (H.264), 3 to 90 seconds, 9:16.'}`);
  }
  if (pub === 'complete' || (!pub && st.video_status === 'ready')) {
    res.state = 'published';
    res.publishedAt = nowIso();
  }
  return undefined;
}

async function fbStep(row, token, post, res) {
  const page = row.pageId;
  const auth = bearer(token);
  const m = post.media || [];
  if (res.state === 'processing' && res.videoId) return fbCheckVideo(token, res);
  switch (post.kind) {
    case 'post': {
      if (!m.length) {
        const { data } = await http.post(`${G()}/${page}/feed`, { message: post.caption }, auth);
        return done(res, data.id, fbLink(data.id));
      }
      const { data } = await http.post(`${G()}/${page}/photos`, { url: m[0].url, caption: post.caption }, auth);
      const id = data.post_id || data.id;
      return done(res, id, fbLink(id));
    }
    case 'carousel': {
      const ids = [];
      for (const it of m) {
        // eslint-disable-next-line no-await-in-loop
        const { data } = await http.post(`${G()}/${page}/photos`, { url: it.url, published: false }, auth);
        ids.push(String(data.id));
      }
      const { data } = await http.post(`${G()}/${page}/feed`, {
        message: post.caption, attached_media: ids.map((id) => ({ media_fbid: id })),
      }, auth);
      return done(res, data.id, fbLink(data.id));
    }
    case 'video': {
      const { data } = await http.post(`${GV()}/${page}/videos`, { file_url: m[0].url, description: post.caption }, { ...auth, timeout: 120000 });
      return done(res, data.id, `https://www.facebook.com/${page}/videos/${data.id}`);
    }
    case 'reel': {
      const videoId = await fbResumable(`${G()}/${page}/video_reels`, token, m[0].url);
      await http.post(`${G()}/${page}/video_reels`, {
        upload_phase: 'finish', video_id: videoId, video_state: 'PUBLISHED', description: post.caption,
      }, auth);
      Object.assign(res, { state: 'processing', videoId, id: videoId, permalink: `https://www.facebook.com/reel/${videoId}` });
      return fbCheckVideo(token, res);
    }
    case 'story': {
      if (m[0].type === 'image') {
        const { data: ph } = await http.post(`${G()}/${page}/photos`, { url: m[0].url, published: false }, auth);
        const { data } = await http.post(`${G()}/${page}/photo_stories`, { photo_id: String(ph.id) }, auth);
        return done(res, data?.post_id || ph.id, `https://www.facebook.com/stories/${page}`);
      }
      const videoId = await fbResumable(`${G()}/${page}/video_stories`, token, m[0].url);
      const { data } = await http.post(`${G()}/${page}/video_stories`, { upload_phase: 'finish', video_id: videoId }, auth);
      return done(res, data?.post_id || videoId, `https://www.facebook.com/stories/${page}`);
    }
    default:
      return fail(res, 'UNSUPPORTED', 'Facebook can’t publish this kind of post.');
  }
}

function igContainerBody(post) {
  const m = (post.media || [])[0] || {};
  switch (post.kind) {
    case 'post':
      return { image_url: m.url, caption: post.caption };
    case 'reel':
      return { media_type: 'REELS', video_url: m.url, caption: post.caption, share_to_feed: true };
    case 'story':
      return m.type === 'video' ? { media_type: 'STORIES', video_url: m.url } : { media_type: 'STORIES', image_url: m.url };
    default:
      return null;
  }
}

async function igStatus(host, id, auth) {
  const { data } = await http.get(`${host}/${id}`, { params: { fields: 'status_code,status' }, ...auth });
  return { code: String(data?.status_code || ''), text: String(data?.status || '') };
}

const igStatusError = (s) => `Instagram couldn’t process the ${s.code === 'EXPIRED' ? 'media in time (it expired)' : 'media'}`
  + `${s.text && s.code !== 'EXPIRED' ? `: ${s.text}` : '. Check the photo is a JPG and videos are MP4 (H.264, AAC audio).'}`;

async function igStep(row, token, post, res) {
  const host = isInstagramLogin(row) ? IG() : G();
  const ig = row.igUserId;
  const auth = bearer(token);
  if (res.state === 'pending') {
    if (post.kind === 'carousel') {
      const childIds = [];
      for (const it of post.media || []) {
        const body = it.type === 'video'
          ? { media_type: 'VIDEO', video_url: it.url, is_carousel_item: true }
          : { image_url: it.url, is_carousel_item: true };
        // eslint-disable-next-line no-await-in-loop
        const { data } = await http.post(`${host}/${ig}/media`, body, auth);
        childIds.push(String(data.id));
      }
      Object.assign(res, { childIds, state: 'children' });
    } else {
      const body = igContainerBody(post);
      if (!body) return fail(res, 'UNSUPPORTED', 'Instagram can’t publish this kind of post.');
      const { data } = await http.post(`${host}/${ig}/media`, body, auth);
      Object.assign(res, { containerId: String(data.id), state: 'processing' });
    }
  }
  if (res.state === 'children') {
    for (const cid of res.childIds || []) {
      // eslint-disable-next-line no-await-in-loop
      const s = await igStatus(host, cid, auth);
      if (s.code === 'ERROR' || s.code === 'EXPIRED') return fail(res, 'IG_MEDIA_ERROR', igStatusError(s));
      if (s.code !== 'FINISHED') return undefined; // still processing: next tick
    }
    const { data } = await http.post(`${host}/${ig}/media`, {
      media_type: 'CAROUSEL', children: res.childIds.join(','), caption: post.caption,
    }, auth);
    Object.assign(res, { containerId: String(data.id), state: 'processing' });
  }
  if (res.state === 'processing') {
    const s = await igStatus(host, res.containerId, auth);
    if (s.code === 'ERROR' || s.code === 'EXPIRED') return fail(res, 'IG_MEDIA_ERROR', igStatusError(s));
    if (s.code === 'PUBLISHED') return done(res, res.id || '', res.permalink || '');
    if (s.code !== 'FINISHED') return undefined;
    const { data } = await http.post(`${host}/${ig}/media_publish`, { creation_id: res.containerId }, auth);
    const mediaId = String(data?.id || '');
    let permalink = '';
    try {
      const { data: p } = await http.get(`${host}/${mediaId}`, { params: { fields: 'permalink' }, ...auth });
      permalink = String(p?.permalink || '');
    } catch (err) {
      logger.info('instagram permalink unavailable', { error: metaText(err) });
    }
    return done(res, mediaId, permalink);
  }
  return undefined;
}

/** A failed Graph call → retry later, or a failure the business can read. */
export function stepError(err, target, res) {
  res.attempts = (res.attempts || 0) + 1;
  const later = (ms) => {
    res.retryAt = new Date(Date.now() + ms).toISOString();
    res.lastError = metaText(err);
  };
  if (err instanceof ChannelError) return fail(res, err.code, err.message);
  // A Facebook call that timed out may still have been published: trying it
  // again could post it twice, so it is left to the business. Instagram is
  // safe to retry (a container is only ever published once).
  const timedOut = err?.code === 'ECONNABORTED' || err?.code === 'ETIMEDOUT' || /timeout/i.test(String(err?.message || ''));
  const retrySafe = target === 'instagram' || res.state !== 'pending' || !timedOut;
  if (!err?.response) {
    if (retrySafe && res.attempts < 4) return later(60 * 1000 * res.attempts);
    return fail(res, 'META_UNREACHABLE', timedOut && !retrySafe
      ? 'Facebook didn’t answer in time. Check your Page before trying again: it may have been published.'
      : `Could not reach Meta: ${err?.message || 'no answer'}`);
  }
  const e = metaErr(err) || {};
  const code = Number(e.code);
  const sub = Number(e.error_subcode);
  // Instagram: the container isn't ready to publish yet.
  if (code === 9007 || sub === 2207027) {
    if (res.attempts < 40) return later(CHECK_MS);
  }
  // Rate limits (never processed) on both; Meta's "temporarily unavailable"
  // (may have been processed) on Instagram only.
  const transient = [4, 17, 32, 613, ...(target === 'instagram' ? [1, 2] : [])];
  if (transient.includes(code) && res.attempts < 4) return later(5 * 60 * 1000);
  if (code === 9 && sub === 2207042) {
    return fail(res, 'IG_PUBLISH_LIMIT', 'Instagram allows 100 posts through apps in 24 hours, and that limit is reached. Try again tomorrow.');
  }
  if (code === 10 || code === 3 || (code >= 200 && code < 300)) {
    return fail(res, 'PERMISSION', target === 'facebook'
      ? 'Meta didn’t let the CRM publish to your Facebook Page. Reconnect the Page on Channel Status and allow “Create content” (pages_manage_posts).'
      : 'Meta didn’t let the CRM publish to Instagram. Reconnect Instagram on Channel Status and allow content publishing.');
  }
  return fail(res, 'META_ERROR', `${TARGET_LABEL[target]} refused it: ${metaText(err)}`);
}

async function step(target, row, post, res) {
  if (!row || row.status !== 'connected') {
    return fail(res, 'NOT_CONNECTED', `${TARGET_LABEL[target]} isn’t connected any more. Reconnect it on Channel Status and try again.`);
  }
  if (!res.startedAt) res.startedAt = nowIso();
  if (Date.now() - new Date(res.startedAt).getTime() > PROCESS_TIMEOUT_MS) {
    return fail(res, 'META_TIMEOUT', `${TARGET_LABEL[target]} was still processing it after 2 hours. Check your ${target === 'facebook' ? 'Page' : 'account'}; if it isn’t there, try again.`);
  }
  delete res.retryAt;
  return withConnectionToken(row, (token) => (target === 'facebook' ? fbStep(row, token, post, res) : igStep(row, token, post, res)));
}

function overall(post, results) {
  const states = post.targets.map((t) => results[t]?.state || 'pending');
  if (!states.every((s) => TERMINAL.includes(s))) return null;
  const ok = states.filter((s) => s === 'published').length;
  return ok === states.length ? 'published' : ok === 0 ? 'failed' : 'partial';
}

async function tellBusiness(post, status, results) {
  const what = KIND_LABEL[post.kind] || 'Post';
  const where = post.targets.map((t) => TARGET_LABEL[t]).join(' and ');
  const failedOn = post.targets.filter((t) => results[t]?.state === 'failed');
  const firstError = failedOn.map((t) => results[t]?.error?.message).find(Boolean) || '';
  const n = status === 'published'
    ? { type: 'social_published', title: `${what} published`, body: `Your ${what.toLowerCase()} is live on ${where}.` }
    : {
      type: 'social_failed',
      title: status === 'partial' ? `${what} published with a problem` : `${what} not published`,
      body: `${failedOn.map((t) => TARGET_LABEL[t]).join(' and ')}: ${firstError}`.slice(0, 400),
    };
  await notify(post.businessId, { ...n, target: { view: 'create', id: String(post._id) } }).catch(() => {});
}

/**
 * Take the lease on one due post and move each target on as far as it goes
 * now. Returns the post's new status, or null when it wasn't due or another
 * run holds it.
 */
export async function runPost(id) {
  const now = new Date();
  const lease = { by: crypto.randomBytes(8).toString('hex'), until: new Date(Date.now() + LEASE_MS) };
  const claim = await SocialPost.updateOne(
    {
      _id: String(id),
      status: { $in: ['scheduled', 'publishing'] },
      scheduledAt: { $lte: now },
      $and: [
        { $or: [{ lockedUntil: null }, { lockedUntil: { $lt: now } }] },
        { $or: [{ nextCheckAt: null }, { nextCheckAt: { $lte: now } }] },
      ],
    },
    { $set: { status: 'publishing', lockedBy: lease.by, lockedUntil: lease.until } },
  );
  if (!claim.matchedCount) return null;
  const post = await SocialPost.findById(String(id)).lean();
  if (!post) return null;
  const rows = await targetRows(post.businessId);
  const results = { ...(post.results || {}) };
  for (const t of post.targets || []) {
    const res = { state: 'pending', attempts: 0, ...(results[t] || {}) };
    if (!TERMINAL.includes(res.state)) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await step(t, rows[t], post, res);
      } catch (err) {
        stepError(err, t, res);
        logger.warn('social publish step failed', {
          target: t, kind: post.kind, state: res.state, metaCode: metaErr(err)?.code ?? null, error: metaText(err),
        });
      }
    }
    results[t] = res;
  }
  const finished = overall(post, results);
  let nextCheckAt = null;
  if (!finished) {
    const waits = post.targets.map((t) => results[t]?.retryAt).filter(Boolean).map((d) => new Date(d).getTime());
    nextCheckAt = new Date(Math.max(Date.now() + CHECK_MS, waits.length ? Math.min(...waits) : 0));
  }
  const status = finished || 'publishing';
  await SocialPost.updateOne(
    { _id: post._id, lockedBy: lease.by },
    {
      $set: {
        results,
        status,
        nextCheckAt,
        lockedBy: '',
        lockedUntil: null,
        ...(finished && finished !== 'failed' ? { publishedAt: new Date() } : {}),
      },
    },
  );
  if (finished) {
    logger.info('social post finished', { kind: post.kind, status: finished, targets: post.targets });
    await tellBusiness(post, finished, results);
  }
  return status;
}

/** "Publish now": start at once instead of waiting for the next tick. */
function kick(id) {
  setImmediate(() => {
    runPost(id).catch((err) => logger.error('social publish run failed', { error: err.message }));
  });
}

let ticking = false;
/** Every due post (and every one still processing at Meta), oldest first. */
export async function runDuePosts() {
  if (ticking) return 0;
  ticking = true;
  try {
    const now = new Date();
    const due = await SocialPost.find({
      status: { $in: ['scheduled', 'publishing'] },
      scheduledAt: { $lte: now },
      $and: [
        { $or: [{ lockedUntil: null }, { lockedUntil: { $lt: now } }] },
        { $or: [{ nextCheckAt: null }, { nextCheckAt: { $lte: now } }] },
      ],
    }).select('_id').sort({ scheduledAt: 1 }).limit(10).lean();
    for (const d of due) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await runPost(d._id);
      } catch (err) {
        logger.error('social publish run failed', { error: err.message });
      }
    }
    return due.length;
  } catch (err) {
    logger.warn('social scheduler tick failed', { error: err.message });
    return 0;
  } finally {
    ticking = false;
  }
}

let timer = null;
/** Start the periodic tick. Safe to call once at boot. */
export function startPostScheduler() {
  if (timer) return;
  logger.info('social post scheduler started', { everySeconds: TICK_MS / 1000 });
  setTimeout(() => { runDuePosts().catch(() => {}); }, 15 * 1000).unref?.();
  timer = setInterval(() => { runDuePosts().catch(() => {}); }, TICK_MS);
  if (timer.unref) timer.unref();
}

// ------------------------------------------------- recent posts (pickers) --

/** The account's latest posts / reels, for picking which one a comment rule watches. */
export async function recentPosts(business, target) {
  if (!TARGETS.includes(target)) throw invalid('Unknown account.', 'UNKNOWN_TARGET');
  const rows = await targetRows(business._id);
  const row = rows[target];
  if (!row || row.status !== 'connected') {
    throw invalid(`${TARGET_LABEL[target]} isn’t connected. Connect it on Channel Status first.`, 'NOT_CONNECTED', 409);
  }
  try {
    if (target === 'facebook') {
      const data = await withConnectionToken(row, async (token) => (await http.get(`${G()}/${row.pageId}/posts`, {
        params: { fields: 'id,message,created_time,full_picture,permalink_url', limit: 25 },
        ...bearer(token),
      })).data);
      return (data?.data || []).map((p) => ({
        id: String(p.id), text: String(p.message || '').slice(0, 200), thumb: p.full_picture || '', permalink: p.permalink_url || '', at: p.created_time || null, type: 'post',
      }));
    }
    const host = isInstagramLogin(row) ? IG() : G();
    const data = await withConnectionToken(row, async (token) => (await http.get(`${host}/${row.igUserId}/media`, {
      params: { fields: 'id,caption,media_type,media_product_type,thumbnail_url,media_url,permalink,timestamp', limit: 25 },
      ...bearer(token),
    })).data);
    return (data?.data || []).map((p) => ({
      id: String(p.id),
      text: String(p.caption || '').slice(0, 200),
      thumb: p.thumbnail_url || (p.media_type === 'VIDEO' ? '' : p.media_url || ''),
      permalink: p.permalink || '',
      at: p.timestamp || null,
      type: p.media_product_type === 'REELS' ? 'reel' : p.media_product_type === 'STORY' ? 'story' : 'post',
    }));
  } catch (err) {
    if (err instanceof ChannelError) throw err;
    const code = Number(metaErr(err)?.code);
    if (code === 10 || (code >= 200 && code < 300)) {
      // 409, not 403: the browser treats 401 / 403 as a signed-out session.
      throw invalid(`Meta didn’t let the CRM read your ${target === 'facebook' ? 'Page' : 'Instagram'} posts. Reconnect it on Channel Status and allow reading posts and comments.`, 'PERMISSION', 409);
    }
    throw new ChannelError(`Could not load your ${TARGET_LABEL[target]} posts: ${metaText(err)}`, { status: 502, code: 'META_ERROR' });
  }
}

export default {
  KINDS, TARGETS, LIMITS, NEEDED_SCOPES, targetRows, grantedScopes, capability, socialOverview, storeUpload, validatePost,
  presentPost, listPosts, createPost, deletePost, retryPost, stepError, runPost, runDuePosts, startPostScheduler, recentPosts,
};
