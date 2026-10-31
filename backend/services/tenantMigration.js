// One-time-per-boot tenant isolation check.
//
// Backfill `businessId` on rows created before tenant tagging existed. Only
// safe when there is exactly one business — with more than one there is no way
// to tell who owned an untagged row, so we leave them and warn rather than
// guessing and handing a tenant someone else's data.
//
// (This used to also reconcile MongoDB's unique indexes. On Postgres the
// per-tenant unique indexes are created with the tables at boot — see
// db/model.js ddl() — so there is nothing left to drop.)
import logger from './logger.js';
import { dbState } from '../db/pool.js';
import Business from '../models/Business.js';
import Conversation from '../models/Conversation.js';
import Message from '../models/Message.js';
import Template from '../models/Template.js';
import Category from '../models/Category.js';
import Product from '../models/Product.js';
import Flow from '../models/Flow.js';
import Offer from '../models/Offer.js';
import Order from '../models/Order.js';
import Member from '../models/Member.js';
import Registration from '../models/Registration.js';
import Journey from '../models/Journey.js';

// Every tenant-owned table.
const OWNED = [
  Conversation, Message, Template, Category, Product,
  Flow, Offer, Order, Member, Registration, Journey,
];

async function backfillOwners() {
  const businesses = await Business.find().select('_id name').lean();
  const counts = {};

  // Nothing to attribute to, or too many candidates to attribute safely.
  if (businesses.length !== 1) {
    for (const Model of OWNED) {
      const orphans = await Model.countDocuments({ businessId: null });
      if (orphans) counts[Model.modelName] = orphans;
    }
    if (Object.keys(counts).length) {
      logger.warn('untagged rows left as-is — cannot attribute with multiple businesses', {
        businesses: businesses.length,
        orphans: counts,
      });
    }
    return counts;
  }

  const owner = businesses[0]._id;
  for (const Model of OWNED) {
    const r = await Model.updateMany({ businessId: null }, { $set: { businessId: owner } });
    if (r.modifiedCount) counts[Model.modelName] = r.modifiedCount;
  }
  if (Object.keys(counts).length) {
    logger.info('backfilled tenant ownership', { business: businesses[0].name, tagged: counts });
  }
  return counts;
}

export async function runTenantMigration() {
  if (!dbState().connected) return null;
  const tagged = await backfillOwners();
  return { tagged };
}

export default { runTenantMigration };
