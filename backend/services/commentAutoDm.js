// ---------------------------------------------------------------------------
// Comment auto-DM: someone comments on the business's Facebook Page post or
// Instagram post / reel → they get a direct message (Meta's "private reply")
// and, if the rule says so, a public answer under their comment.
//
// Webhooks (routes/metaWebhook.js → metaChannelInbound.handleMetaWebhook):
//   page       changes[field='feed']     value { item: 'comment', verb: 'add', comment_id,
//                                                post_id, parent_id, from { id, name }, message }
//   instagram  changes[field='comments'] value { id, text, parent_id?, from { id, username },
//                                                media { id, media_product_type } }
// Only top-level comments by someone other than the business are answered
// (the business's own public replies come back as comments too).
//
// Private reply: POST /{page-id}/messages (Instagram through a Page too) or
// graph.instagram.com/{ig-id}/messages (Instagram login) with
// recipient { comment_id }. Meta allows one per comment, within 7 days of it;
// after that the business can only message the person once they reply.
// Public reply: POST /{comment-id}/comments (Facebook), /{comment-id}/replies
// (Instagram).
//
// Each comment is claimed with a unique CommentReply row first, so a webhook
// Meta delivers twice is answered once. The comment and the DM are filed in
// the person's Messenger / Instagram chat; the chat's 24-hour window is not
// opened by a comment.
//
// Needs, besides the messaging permissions: pages_read_engagement +
// pages_manage_metadata (Page 'feed' webhook), pages_manage_engagement
// (public replies); instagram_manage_comments or
// instagram_business_manage_comments. The Page's 'feed' / the Instagram
// login's 'comments' webhook field is turned on when a rule is saved.
// ---------------------------------------------------------------------------
import axios from 'axios';
import CommentRule from '../models/CommentRule.js';
import CommentReply from '../models/CommentReply.js';
import ChannelConnection from '../models/ChannelConnection.js';
import Conversation from '../models/Conversation.js';
import Message from '../models/Message.js';
import Business from '../models/Business.js';
import {
  ChannelError, PAGE_FIELDS, withConnectionToken, subscribePage, pageFieldsInUse, logOutbound,
} from './metaChannels.js';
import { IG, IG_FIELDS, isInstagramLogin, subscribeInstagram } from './instagramGraph.js';
import { targetRows } from './socialPublish.js';
import { emitMessage } from './eventBus.js';
import logger from './logger.js';

export const RULE_CHANNELS = ['facebook', 'instagram'];
const CHAT_CHANNEL = { facebook: 'messenger', instagram: 'instagram' };
export const RULE_LIMITS = {
  rules: 20,
  keywords: 20,
  keywordLength: 40,
  publicReplies: 5,
  publicReplyLength: 300,
  nameLength: 60,
  dmFacebook: 2000, // characters
  dmInstagram: 1000, // bytes
};

const version = () => process.env.WA_GRAPH_VERSION || 'v22.0';
const G = () => `https://graph.facebook.com/${version()}`;
const http = axios.create({ timeout: 20000 });
const bearer = (token) => ({ headers: { Authorization: `Bearer ${token}` } });
const digits = (s) => String(s || '').replace(/\D/g, '');
const metaErr = (err) => err?.response?.data?.error || null;
const metaText = (err) => {
  if (err instanceof ChannelError) return err.message;
  const e = metaErr(err);
  return e?.error_user_msg || e?.message || err?.message || 'Unknown error';
};
const invalid = (message, code = 'INVALID_RULE', status = 400) => new ChannelError(message, { status, code });

// -------------------------------------------------------------- matching --

const norm = (s) => String(s || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The keyword appears in the comment as a whole word (or anywhere, for one with symbols). */
export function keywordIn(text, keyword) {
  const t = norm(text);
  const k = norm(keyword);
  if (!k) return false;
  if (!/^[\p{L}\p{N}_ ]+$/u.test(k)) return t.includes(k);
  return new RegExp(`(^|[^\\p{L}\\p{N}_])${escapeRe(k)}($|[^\\p{L}\\p{N}_])`, 'u').test(t);
}

const matches = (rule, text) => rule.matchMode === 'any' || (rule.keywords || []).some((k) => keywordIn(text, k));
const byAge = (a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0);

/** A rule for this one post wins over an every-post rule; the oldest first within each. */
export function pickRule(rules, ev) {
  const live = (rules || []).filter((r) => r.active !== false && r.channel === ev.channel);
  const specific = live.filter((r) => r.postId && r.postId === ev.postId && matches(r, ev.text)).sort(byAge);
  const general = live.filter((r) => !r.postId && matches(r, ev.text)).sort(byAge);
  return specific[0] || general[0] || null;
}

/** {name} → the commenter's first name (Facebook) or username (Instagram). */
export function fillName(text, fromName) {
  const first = String(fromName || '').trim().split(/\s+/)[0] || '';
  return String(text || '').replace(/\{name\}/gi, first || 'there').trim();
}

// ----------------------------------------------------------------- rules --

const asList = (v) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []);

/** A rule as the browser sent it → what is stored, or a 400 with the reason. */
export function validateRule(input = {}) {
  const channel = String(input.channel || '');
  if (!RULE_CHANNELS.includes(channel)) throw invalid('Choose Facebook or Instagram.');
  const postId = String(input.postId || '').trim();
  if (postId && !/^[\w.:-]{1,100}$/.test(postId)) throw invalid('That post can’t be used. Pick it from the list again.');
  const matchMode = input.matchMode === 'any' ? 'any' : 'keywords';
  const keywords = [];
  for (const raw of asList(input.keywords)) {
    const k = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!k) continue;
    if (k.length > RULE_LIMITS.keywordLength) throw invalid(`Keywords can be at most ${RULE_LIMITS.keywordLength} characters.`);
    if (!keywords.some((x) => norm(x) === norm(k))) keywords.push(k);
  }
  if (keywords.length > RULE_LIMITS.keywords) throw invalid(`A rule can have at most ${RULE_LIMITS.keywords} keywords.`);
  if (matchMode === 'keywords' && !keywords.length) throw invalid('Add at least one keyword, or choose “Any comment”.');
  const dmText = String(input.dmText || '').replace(/\r\n/g, '\n').trim();
  if (!dmText) throw invalid('Write the message to send.');
  // Room for a name in place of {name}.
  const probe = fillName(dmText, 'Abcdefghijklmnopqrstuvwxyz');
  if (channel === 'instagram' ? Buffer.byteLength(probe, 'utf8') > RULE_LIMITS.dmInstagram : probe.length > RULE_LIMITS.dmFacebook) {
    throw invalid(channel === 'instagram'
      ? 'Instagram messages can be at most 1,000 bytes. Shorten the message.'
      : 'Messenger messages can be at most 2,000 characters. Shorten the message.');
  }
  const publicReplies = [];
  for (const raw of Array.isArray(input.publicReplies) ? input.publicReplies : []) {
    const r = String(raw || '').replace(/\r\n/g, '\n').trim();
    if (!r) continue;
    if (r.length > RULE_LIMITS.publicReplyLength) throw invalid(`Public replies can be at most ${RULE_LIMITS.publicReplyLength} characters.`);
    publicReplies.push(r);
  }
  if (publicReplies.length > RULE_LIMITS.publicReplies) throw invalid(`Add at most ${RULE_LIMITS.publicReplies} public replies.`);
  const name = String(input.name || '').trim().slice(0, RULE_LIMITS.nameLength)
    || (matchMode === 'any' ? 'Every comment' : `Comments with “${keywords[0]}”`).slice(0, RULE_LIMITS.nameLength);
  const thumb = String(input.postThumb || '').trim();
  return {
    channel,
    name,
    active: input.active !== false,
    postId,
    postLabel: postId ? String(input.postLabel || '').trim().slice(0, 120) : '',
    postThumb: postId && /^https:\/\//.test(thumb) ? thumb.slice(0, 1000) : '',
    matchMode,
    keywords,
    dmText,
    publicReplies,
    oncePerUser: input.oncePerUser !== false,
  };
}

export function presentRule(r) {
  if (!r) return null;
  return {
    id: String(r._id),
    channel: r.channel,
    name: r.name || '',
    active: r.active !== false,
    postId: r.postId || '',
    postLabel: r.postLabel || '',
    postThumb: r.postThumb || '',
    matchMode: r.matchMode || 'keywords',
    keywords: r.keywords || [],
    dmText: r.dmText || '',
    publicReplies: r.publicReplies || [],
    oncePerUser: r.oncePerUser !== false,
    sentCount: Number(r.sentCount) || 0,
    lastSentAt: r.lastSentAt || null,
    createdAt: r.createdAt || null,
  };
}

export function presentReply(r) {
  return {
    id: String(r._id),
    ruleId: r.ruleId || '',
    channel: r.channel,
    postId: r.postId || '',
    fromName: r.fromName || '',
    text: r.text || '',
    psid: r.psid || '',
    status: r.status,
    reason: r.reason || '',
    error: r.error || '',
    publicReplyError: r.publicReplyError || '',
    createdAt: r.createdAt || null,
  };
}

export async function listRules(business) {
  const rows = await CommentRule.find({ businessId: business._id }).sort({ createdAt: 1 }).lean();
  return rows.map(presentRule);
}

export async function listReplies(business, { limit = 50 } = {}) {
  const rows = await CommentReply.find({ businessId: business._id, status: { $ne: 'processing' } })
    .sort({ createdAt: -1 }).limit(Math.min(200, Math.max(1, Number(limit) || 50))).lean();
  return rows.map(presentReply);
}

/**
 * Make sure Meta tells the CRM about new comments for this channel:
 *   facebook  the Page's 'feed' webhook field (kept alongside the messaging ones)
 *   instagram (login with Instagram) the account's 'comments' field; through a
 *             Page, the app's Instagram 'comments' subscription covers it.
 * Never throws: { ok, message }.
 */
export async function ensureCommentWebhook(businessId, channel) {
  const rows = await targetRows(businessId);
  const row = rows[channel];
  if (!row || row.status !== 'connected') {
    return {
      ok: false,
      message: channel === 'facebook'
        ? 'Connect your Facebook Page (Messenger) on Channel Status: DMs from comments are sent from the Page.'
        : 'Connect Instagram on Channel Status: DMs from comments are sent from the account.',
    };
  }
  try {
    if (channel === 'facebook') {
      if ((row.subscribedFields || []).includes('feed')) return { ok: true, message: '' };
      const adsOnPage = await ChannelConnection.findOne({
        businessId: row.businessId, channel: 'ads', pageId: row.pageId, status: 'connected', leadgenSubscribed: true,
      }).select('_id').lean();
      const fields = [...(await pageFieldsInUse(row.pageId, ['feed'])), ...(adsOnPage ? ['leadgen'] : [])];
      await withConnectionToken(row, (token) => subscribePage(row.pageId, token, fields));
      const stored = [...new Set([...(row.subscribedFields?.length ? row.subscribedFields : PAGE_FIELDS), 'feed'])];
      await ChannelConnection.updateOne({ _id: row._id }, { $set: { subscribedFields: stored } });
      return { ok: true, message: '' };
    }
    if (!isInstagramLogin(row)) return { ok: true, message: '' };
    if ((row.subscribedFields || []).includes('comments')) return { ok: true, message: '' };
    const fields = [...new Set([...(row.subscribedFields?.length ? row.subscribedFields : IG_FIELDS), 'comments'])];
    await withConnectionToken(row, (token) => subscribeInstagram(token, fields));
    await ChannelConnection.updateOne({ _id: row._id }, { $set: { subscribedFields: fields } });
    return { ok: true, message: '' };
  } catch (err) {
    logger.warn('could not turn on comment webhooks', { channel, error: metaText(err) });
    return {
      ok: false,
      message: `Meta didn’t turn on comment notifications for ${channel === 'facebook' ? 'your Page' : 'Instagram'} (${metaText(err)}). `
        + 'Reconnect it on Channel Status and allow managing posts and comments.',
    };
  }
}

export async function createRule(business, input) {
  const v = validateRule(input);
  const count = await CommentRule.countDocuments({ businessId: business._id });
  if (count >= RULE_LIMITS.rules) throw invalid(`You can have up to ${RULE_LIMITS.rules} comment rules. Delete one first.`, 'TOO_MANY_RULES', 409);
  const doc = await CommentRule.create({ businessId: business._id, ...v });
  const webhook = v.active ? await ensureCommentWebhook(business._id, v.channel) : { ok: true, message: '' };
  logger.info('comment rule created', { business: business.name, channel: v.channel, mode: v.matchMode, onePost: !!v.postId });
  return { rule: presentRule(doc), webhook };
}

/** Change a rule; fields not sent keep their value (so { active } alone turns it on / off). */
export async function updateRule(business, id, input = {}) {
  const cur = await CommentRule.findOne({ _id: String(id), businessId: business._id }).lean();
  if (!cur) throw invalid('That rule isn’t here any more.', 'NOT_FOUND', 404);
  const merged = { ...presentRule(cur), ...input, channel: cur.channel };
  const v = validateRule(merged);
  await CommentRule.updateOne({ _id: cur._id, businessId: business._id }, { $set: v });
  const webhook = v.active ? await ensureCommentWebhook(business._id, v.channel) : { ok: true, message: '' };
  return { rule: presentRule(await CommentRule.findById(cur._id).lean()), webhook };
}

export async function deleteRule(business, id) {
  const r = await CommentRule.deleteOne({ _id: String(id), businessId: business._id });
  if (!r.deletedCount) throw invalid('That rule isn’t here any more.', 'NOT_FOUND', 404);
  return true;
}

// --------------------------------------------------------------- webhook --

/** The comment events in one webhook entry (other changes are ignored). */
export function commentEvents(object, entry = {}) {
  const out = [];
  for (const c of entry.changes || []) {
    const v = c?.value || {};
    if (object === 'page' && c?.field === 'feed' && v.item === 'comment' && v.verb === 'add') {
      out.push({
        channel: 'facebook',
        commentId: String(v.comment_id || ''),
        postId: String(v.post_id || ''),
        parentId: String(v.parent_id || ''),
        fromId: String(v.from?.id || ''),
        fromName: String(v.from?.name || ''),
        text: String(v.message || ''),
        productType: '',
      });
    } else if (object === 'instagram' && c?.field === 'comments') {
      out.push({
        channel: 'instagram',
        commentId: String(v.id || ''),
        postId: String(v.media?.id || ''),
        parentId: String(v.parent_id || ''),
        fromId: String(v.from?.id || ''),
        fromName: String(v.from?.username || ''),
        text: String(v.text || ''),
        productType: String(v.media?.media_product_type || ''),
      });
    }
  }
  return out.filter((e) => e.commentId);
}

/** The connection a comment entry is for (the Page's Messenger row, or the Instagram row). */
async function rowForEntry(object, entryId) {
  const id = String(entryId || '');
  if (!id) return null;
  const filter = object === 'page' ? { channel: 'messenger', pageId: id } : { channel: 'instagram', igUserId: id };
  const rows = await ChannelConnection.find(filter).sort({ updatedAt: -1 }).limit(5).lean();
  return rows.find((r) => r.status === 'connected') || null;
}

/** The comment and the DM, in the person's Messenger / Instagram chat. */
async function fileInChat(row, ev, psid, dmText, mid, extra) {
  const businessId = String(row.businessId);
  const channel = CHAT_CHANNEL[ev.channel];
  const where = ev.productType === 'REELS' ? 'reel' : 'post';
  const body = `💬 Commented on your ${where}: “${ev.text.slice(0, 500)}”`;
  const name = ev.channel === 'facebook' ? ev.fromName : '';
  const handle = ev.channel === 'instagram' ? ev.fromName : '';
  const now = new Date();
  try {
    // No lastInboundAt: a comment doesn't open the 24-hour messaging window.
    await Conversation.findOneAndUpdate(
      { businessId, phone: psid },
      {
        $set: {
          businessId, channel, lastMessageAt: now, lastMessageBody: body, ...(name ? { name } : {}), ...(handle ? { handle } : {}),
        },
        $inc: { unread: 1 },
      },
      { upsert: true, new: true },
    );
    const inDoc = await Message.create({
      phone: psid,
      name: name || (handle ? `@${handle}` : ''),
      businessId,
      direction: 'in',
      type: 'text',
      body,
      raw: { channel, comment: { id: ev.commentId, postId: ev.postId, text: ev.text } },
      status: 'received',
      channel,
    });
    emitMessage(inDoc);
  } catch (err) {
    logger.warn('could not file the comment in the chat', { error: err.message });
  }
  const d = {
    type: 'text', body: dmText, headerImageUrl: '', headerText: '', headerDocName: '', headerDocUrl: '', footer: '',
    buttons: [], cta: null, flowCta: '', mediaUrl: '', mediaType: '', filename: '',
  };
  await logOutbound({ businessId, channel, psid, d, mid, extra });
}

/** One comment → the DM (and public reply) of the rule it matches. Returns what happened. */
export async function handleComment(row, ev) {
  const businessId = String(row.businessId);
  const ownId = ev.channel === 'facebook' ? row.pageId : row.igUserId;
  if (!ev.fromId || ev.fromId === String(ownId)) return 'own';
  const isReply = ev.channel === 'facebook' ? !!ev.parentId && ev.parentId !== ev.postId : !!ev.parentId;
  if (isReply) return 'reply';
  const rules = await CommentRule.find({ businessId, channel: ev.channel, active: true }).lean();
  if (!rules.length) return 'no_rules';
  const rule = pickRule(rules, ev);
  if (!rule) return 'no_match';

  let rec;
  try {
    rec = await CommentReply.create({
      businessId,
      commentId: ev.commentId,
      ruleId: String(rule._id),
      channel: ev.channel,
      postId: ev.postId,
      fromId: ev.fromId,
      fromName: ev.fromName.slice(0, 120),
      text: ev.text.slice(0, 1000),
      status: 'processing',
    });
  } catch (err) {
    if (err?.code === 11000) return 'duplicate';
    throw err;
  }
  const finish = (set) => CommentReply.updateOne({ _id: rec._id }, { $set: set });

  if (rule.oncePerUser) {
    const before = await CommentReply.exists({
      businessId, channel: ev.channel, postId: ev.postId, fromId: ev.fromId, status: 'sent', _id: { $ne: rec._id },
    });
    if (before) {
      await finish({ status: 'skipped', reason: 'already_sent' });
      return 'already_sent';
    }
  }

  const dmText = fillName(rule.dmText, ev.fromName);
  const url = isInstagramLogin(row) ? `${IG()}/${row.igUserId}/messages` : `${G()}/${row.pageId}/messages`;
  const body = {
    recipient: { comment_id: ev.commentId },
    ...(ev.channel === 'facebook' ? { messaging_type: 'RESPONSE' } : {}),
    message: { text: dmText },
  };
  let sent;
  try {
    sent = await withConnectionToken(row, async (token) => (await http.post(url, body, bearer(token))).data);
  } catch (err) {
    const why = metaText(err);
    await finish({ status: 'failed', error: why.slice(0, 500) });
    logger.warn('comment auto-DM refused', { channel: ev.channel, metaCode: metaErr(err)?.code ?? null, error: why });
    return 'failed';
  }
  const psid = digits(sent?.recipient_id || ev.fromId);

  let publicReplyId = '';
  let publicReplyError = '';
  const replies = (rule.publicReplies || []).filter(Boolean);
  if (replies.length) {
    const text = fillName(replies[Math.floor(Math.random() * replies.length)], ev.fromName);
    const host = isInstagramLogin(row) ? IG() : G();
    const purl = ev.channel === 'facebook' ? `${G()}/${ev.commentId}/comments` : `${host}/${ev.commentId}/replies`;
    try {
      const d = await withConnectionToken(row, async (token) => (await http.post(purl, { message: text }, bearer(token))).data);
      publicReplyId = String(d?.id || '');
    } catch (err) {
      publicReplyError = metaText(err).slice(0, 300);
      logger.warn('comment public reply refused', { channel: ev.channel, error: publicReplyError });
    }
  }

  if (psid) await fileInChat(row, ev, psid, dmText, sent?.message_id || '', { commentReply: true, commentId: ev.commentId, ruleId: String(rule._id) });
  await finish({ status: 'sent', psid, dmMessageId: String(sent?.message_id || ''), publicReplyId, publicReplyError });
  await CommentRule.updateOne({ _id: rule._id }, { $inc: { sentCount: 1 }, $set: { lastSentAt: new Date() } });
  logger.info('comment auto-DM sent', { channel: ev.channel, publicReply: !!publicReplyId });
  return 'sent';
}

/** A 'page' / 'instagram' webhook entry: answer its new comments. Never throws. */
export async function handleCommentEntry(object, entry) {
  const events = commentEvents(object, entry);
  if (!events.length) return [];
  let row;
  try {
    row = await rowForEntry(object, entry.id);
  } catch (err) {
    logger.error('comment webhook lookup failed', { error: err.message });
    return [];
  }
  if (!row) {
    logger.info('comment webhook for a Page / Instagram account no business has connected, dropped', { object, entryId: String(entry.id || '') });
    return [];
  }
  const biz = await Business.findById(row.businessId).select('active name').lean().catch(() => null);
  if (!biz || !biz.active) return [];
  const out = [];
  for (const ev of events) {
    try {
      // eslint-disable-next-line no-await-in-loop
      out.push(await handleComment(row, ev));
    } catch (err) {
      logger.error('comment auto-DM failed', { channel: ev.channel, error: err.message });
      out.push('error');
    }
  }
  return out;
}

export default {
  RULE_CHANNELS, RULE_LIMITS, keywordIn, pickRule, fillName, validateRule, presentRule, listRules, listReplies,
  ensureCommentWebhook, createRule, updateRule, deleteRule, commentEvents, handleComment, handleCommentEntry,
};
