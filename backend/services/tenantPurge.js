// ---------------------------------------------------------------------------
// Complete removal of a tenant
//
// Deleting a business used to drop only the Business row (and fire a
// best-effort media delete), leaving its chats, catalog, flows and submissions
// behind. Because none of that was tagged with an owner, the leftovers then
// surfaced under whichever business was created next.
//
// This removes everything the tenant owns, in one place:
//   • Mongo   — every collection carrying its businessId
//   • Bunny   — its whole biz/<id> media folder
//   • Meta    — the flows it created on its WABA (published ones are
//               deprecated, drafts deleted), so they stop being reachable
// ---------------------------------------------------------------------------
import Message from '../models/Message.js';
import Conversation from '../models/Conversation.js';
import Flow from '../models/Flow.js';
import Journey from '../models/Journey.js';
import Member from '../models/Member.js';
import Product from '../models/Product.js';
import Category from '../models/Category.js';
import Offer from '../models/Offer.js';
import Order from '../models/Order.js';
import Registration from '../models/Registration.js';
import Template from '../models/Template.js';
import SandboxLink from '../models/SandboxLink.js';
import Campaign from '../models/Campaign.js';
import Notification from '../models/Notification.js';
import PlanRequest from '../models/PlanRequest.js';
import ChannelConnection from '../models/ChannelConnection.js';
import MetaTemplate from '../models/MetaTemplate.js';
import QuickMessage from '../models/QuickMessage.js';
import CampaignSend from '../models/CampaignSend.js';
import CommentRule from '../models/CommentRule.js';
import CommentReply from '../models/CommentReply.js';
import SocialPost from '../models/SocialPost.js';
import AdDraft from '../models/AdDraft.js';
import AdSavedAudience from '../models/AdSavedAudience.js';
import AdAudienceJob from '../models/AdAudienceJob.js';
import Business from '../models/Business.js';
import storage from './storage.js';
import { getClientForBusiness } from './metaCloud.js';
import logger from './logger.js';

// Everything that belongs to a tenant, labelled for the summary we report back.
const OWNED = [
  ['messages', Message],
  ['conversations', Conversation],
  ['flows', Flow],
  ['journeys', Journey],
  ['members', Member],
  ['products', Product],
  ['categories', Category],
  ['offers', Offer],
  ['orders', Order],
  ['registrations', Registration],
  ['templates', Template],
  ['sandboxLinks', SandboxLink],
  ['campaigns', Campaign],
  ['notifications', Notification],
  ['planRequests', PlanRequest],
  // Messenger / Instagram connections, with their encrypted Page tokens.
  ['channelConnections', ChannelConnection],
  // Messenger utility templates (local copies) and Messenger / Instagram quick messages.
  ['metaTemplates', MetaTemplate],
  ['quickMessages', QuickMessage],
  // Per-number campaign send ledger (holds customers' phone numbers).
  ['campaignSends', CampaignSend],
  // Comment auto-DM rules and the comments they answered.
  ['commentRules', CommentRule],
  ['commentReplies', CommentReply],
  // Facebook / Instagram posts made from the Create page.
  ['socialPosts', SocialPost],
  // Ads drafts, saved audiences and customer-list upload jobs.
  ['adDrafts', AdDraft],
  ['adSavedAudiences', AdSavedAudience],
  ['adAudienceJobs', AdAudienceJob],
  // SubscriptionPayment rows are deliberately kept: they are billing records
  // that tax and accounting law requires us to retain (see the Privacy Policy).
];

/** Take the tenant's flows out of service at Meta before we forget their ids. */
async function removeMetaFlows(business, flows) {
  const results = { deprecated: 0, deleted: 0, failed: 0 };
  if (!flows.length) return results;
  let meta;
  try {
    meta = getClientForBusiness(business);
  } catch {
    results.failed = flows.length;
    return results;
  }
  for (const f of flows) {
    if (!f.metaFlowId) continue;
    try {
      // A published flow can't be deleted, only deprecated.
      if (f.status === 'PUBLISHED') {
        await meta.deprecateFlow(f.metaFlowId);
        results.deprecated += 1;
      } else {
        await meta.deleteFlow(f.metaFlowId);
        results.deleted += 1;
      }
    } catch (err) {
      results.failed += 1;
      logger.warn('meta flow cleanup failed during purge', {
        metaFlowId: f.metaFlowId,
        error: err.response?.data?.error?.message || err.message,
      });
    }
  }
  return results;
}

/**
 * Delete a business and everything it owns.
 * @param {object} business a Business document (needed for its Meta creds)
 * @returns {Promise<object>} per-collection counts plus media/meta outcomes
 */
export async function purgeBusiness(business) {
  const id = String(business._id);
  const summary = { businessId: id, name: business.name, deleted: {}, media: null, metaFlows: null };

  // Meta first — it needs the flow ids and the access token, both of which are
  // gone once the rows are deleted.
  const flows = await Flow.find({ businessId: id }).select('metaFlowId status').lean();
  summary.metaFlows = await removeMetaFlows(business, flows);

  for (const [label, Model] of OWNED) {
    try {
      const { deletedCount } = await Model.deleteMany({ businessId: id });
      summary.deleted[label] = deletedCount || 0;
    } catch (err) {
      summary.deleted[label] = `error: ${err.message}`;
      logger.error('purge collection failed', { businessId: id, collection: label, error: err.message });
    }
  }

  // Awaited, unlike before — otherwise a failure here was invisible and the
  // tenant's images stayed on the CDN.
  try {
    await storage.deleteFolder(`biz/${id}`);
    summary.media = 'removed';
  } catch (err) {
    summary.media = `failed: ${err.message}`;
    logger.error('purge media folder failed', { businessId: id, error: err.message });
  }

  await Business.deleteOne({ _id: id });
  logger.info('business purged', summary);
  return summary;
}

export default { purgeBusiness };
