// One-time backfill: attribute tenant-owned documents that predate the
// businessId field.
//
// Those rows were created when nothing recorded an owner, so they can't be
// purged with a business and instead reappear under whichever tenant is
// created next. Safe to re-run — it only touches documents with no owner, and
// it refuses to guess when more than one business exists.
//
//   node scripts/backfill-business-ids.js            # report only
//   node scripts/backfill-business-ids.js --apply    # write
//   node scripts/backfill-business-ids.js --apply --business <id>
import 'dotenv/config';
import db from '../db/index.js';
import Business from '../models/Business.js';
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

const MODELS = [
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
];

const apply = process.argv.includes('--apply');
const explicit = process.argv[process.argv.indexOf('--business') + 1];
const wanted = process.argv.includes('--business') ? explicit : null;

await db.init();

const businesses = await Business.find().select('name').lean();
let target = null;
if (wanted) {
  target = businesses.find((b) => String(b._id) === wanted);
  if (!target) {
    console.error(`No business with id ${wanted}. Known: ${businesses.map((b) => b._id).join(', ')}`);
    process.exitCode = 1;
  }
} else if (businesses.length === 1) {
  [target] = businesses;
} else if (businesses.length === 0) {
  console.error('No businesses exist — nothing to attribute orphaned data to.');
  process.exitCode = 1;
} else {
  console.error('More than one business exists, so the owner is ambiguous.');
  console.error('Re-run with --business <id>. Known businesses:');
  for (const b of businesses) console.error(`  ${b._id}  ${b.name}`);
  process.exitCode = 1;
}

if (target) {
  console.log(`${apply ? 'Assigning' : 'Would assign'} unowned documents to "${target.name}" (${target._id})\n`);
  let total = 0;
  for (const [label, Model] of MODELS) {
    const filter = { businessId: null };
    const count = await Model.countDocuments(filter);
    total += count;
    if (count && apply) await Model.updateMany(filter, { $set: { businessId: target._id } });
    console.log(`  ${label.padEnd(15)} ${String(count).padStart(5)}${count && apply ? '  updated' : ''}`);
  }
  console.log(`\n  ${String(total).padStart(21)} document(s) total`);
  if (!apply) console.log('\nDry run. Re-run with --apply to write these changes.');
}

await db.close();
