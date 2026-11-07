// Database bootstrap: connect to Supabase Postgres and make sure every model's
// table, columns and indexes exist. Like Mongoose creating collections on
// first use, but explicit and done once at boot: adding a field to a model
// adds its column on the next start, with no migration step to remember.
import { connect, query, dbState, ping, close } from './pool.js';
import { registry } from './model.js';
import logger from '../services/logger.js';

// Import every model so each one registers itself before the tables are built.
import '../models/AdAudienceJob.js';
import '../models/ApiKey.js';
import '../models/ContactMessage.js';
import '../models/SiteEvent.js';
import '../models/OtpCode.js';
import '../models/AdDraft.js';
import '../models/AdSavedAudience.js';
import '../models/Business.js';
import '../models/Campaign.js';
import '../models/CampaignSend.js';
import '../models/Category.js';
import '../models/ChannelConnection.js';
import '../models/CommentReply.js';
import '../models/CommentRule.js';
import '../models/Conversation.js';
import '../models/DemoRequest.js';
import '../models/Flow.js';
import '../models/FlowTemplate.js';
import '../models/GeoCache.js';
import '../models/Journey.js';
import '../models/Member.js';
import '../models/Message.js';
import '../models/MetaTemplate.js';
import '../models/Notification.js';
import '../models/Offer.js';
import '../models/Order.js';
import '../models/PlanRequest.js';
import '../models/Product.js';
import '../models/PushSubscription.js';
import '../models/QuickMessage.js';
import '../models/Registration.js';
import '../models/SandboxLink.js';
import '../models/SocialPost.js';
import '../models/SubscriptionPayment.js';
import '../models/Template.js';

export async function ensureSchema() {
  for (const Model of registry) {
    try {
      await Model.ensureTable();
    } catch (err) {
      logger.error('could not create/upgrade table', { table: Model.table, error: err.message });
      throw err;
    }
  }
}

export async function init() {
  await connect();
  await ensureSchema();
  logger.info('Connected to Supabase Postgres', { tables: registry.map((m) => m.table) });
}

export { query, dbState, ping, close, registry };
export default { init, ensureSchema, query, dbState, ping, close, registry };
