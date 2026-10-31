// Import a MongoDB export (canonical Extended JSON, one array per collection)
// into the Supabase Postgres tables, keeping every document's _id, createdAt
// and updatedAt, then verify each row against its source document.
//
//   node scripts/import-mongo-export.js <export-dir>            # import into empty tables
//   node scripts/import-mongo-export.js <export-dir> --replace  # wipe the tables first
//   node scripts/import-mongo-export.js <export-dir> --verify   # compare only, no writes
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import db from '../db/index.js';
import Business from '../models/Business.js';
import Category from '../models/Category.js';
import Conversation from '../models/Conversation.js';
import Flow from '../models/Flow.js';
import FlowTemplate from '../models/FlowTemplate.js';
import GeoCache from '../models/GeoCache.js';
import Journey from '../models/Journey.js';
import Member from '../models/Member.js';
import Message from '../models/Message.js';
import Offer from '../models/Offer.js';
import Order from '../models/Order.js';
import Product from '../models/Product.js';
import Registration from '../models/Registration.js';
import Template from '../models/Template.js';

const COLLECTIONS = {
  businesses: Business, categories: Category, conversations: Conversation, flows: Flow,
  flowtemplates: FlowTemplate, geocaches: GeoCache, journeys: Journey, members: Member,
  messages: Message, offers: Offer, orders: Order, products: Product,
  registrations: Registration, templates: Template,
};

const dir = process.argv[2];
const REPLACE = process.argv.includes('--replace');
const VERIFY_ONLY = process.argv.includes('--verify');
if (!dir || !fs.existsSync(dir)) {
  console.error('usage: node scripts/import-mongo-export.js <export-dir> [--replace|--verify]');
  process.exit(1);
}

/** Canonical EJSON → plain JS (ObjectId → 24-hex string, $date → Date). */
function fromEjson(v) {
  if (Array.isArray(v)) return v.map(fromEjson);
  if (v === null || typeof v !== 'object') return v;
  const keys = Object.keys(v);
  if (keys.length === 1) {
    const [k] = keys;
    const x = v[k];
    if (k === '$oid') return String(x);
    if (k === '$date') {
      if (typeof x === 'object' && x.$numberLong) return new Date(Number(x.$numberLong));
      return new Date(x);
    }
    if (k === '$numberInt' || k === '$numberLong' || k === '$numberDouble' || k === '$numberDecimal') {
      return Number(x);
    }
  }
  if (keys.includes('$binary')) return Buffer.from(v.$binary.base64 || '', 'base64').toString('base64');
  if (keys.includes('$regularExpression')) return v.$regularExpression.pattern;
  const out = {};
  for (const k of keys) out[k] = fromEjson(v[k]);
  return out;
}

const iso = (v) => JSON.parse(JSON.stringify(v));

/** Every value in `src` must appear, equal, in `dst` (dst may carry extra defaults). */
function diffSubset(src, dst, p, out) {
  // A stored null may now read back as absent or as its default — both fine.
  if (src === null || src === undefined) return;
  if (Array.isArray(src)) {
    if (!Array.isArray(dst) || dst.length !== src.length) { out.push(`${p}: array length ${src.length} → ${Array.isArray(dst) ? dst.length : typeof dst}`); return; }
    src.forEach((el, i) => diffSubset(el, dst[i], `${p}[${i}]`, out));
    return;
  }
  if (typeof src === 'object') {
    if (!dst || typeof dst !== 'object') {
      if (!Object.keys(src).length) return; // {} → absent is equivalent
      out.push(`${p}: object → ${JSON.stringify(dst)}`);
      return;
    }
    for (const k of Object.keys(src)) diffSubset(src[k], dst[k], p ? `${p}.${k}` : k, out);
    return;
  }
  if (src !== dst) out.push(`${p}: ${JSON.stringify(src)} → ${JSON.stringify(dst)}`);
}

await db.init();
let totalProblems = 0;
const summary = [];

for (const [coll, Model] of Object.entries(COLLECTIONS)) {
  const file = path.join(dir, `${coll}.json`);
  if (!fs.existsSync(file)) { summary.push({ coll, note: 'no export file' }); continue; }
  const docs = fromEjson(JSON.parse(fs.readFileSync(file, 'utf8')));
  const known = new Set(Model.meta.fields.keys());

  // Fields the schema doesn't declare are dropped (Mongoose strict mode would
  // never have returned them either) — list them so nothing goes silently.
  const dropped = {};
  for (const d of docs) for (const k of Object.keys(d)) if (!known.has(k) && k !== '__v') dropped[k] = (dropped[k] || 0) + 1;

  const existing = await Model.countDocuments();
  if (!VERIFY_ONLY) {
    if (existing && !REPLACE) {
      console.error(`${Model.table}: already has ${existing} rows — rerun with --replace to overwrite, or --verify to compare.`);
      process.exitCode = 1;
      continue;
    }
    if (REPLACE) await db.query(`DELETE FROM "${Model.table}"`);
    // Raw insert: keep ids + timestamps, skip validation so legacy rows that a
    // newer schema would reject still come across intact.
    const prepared = docs.map((d) => Model.meta.prepareInsert(d, { validate: false }));
    for (let i = 0; i < prepared.length; i += 100) {
      const batch = prepared.slice(i, i + 100);
      const params = { values: [], add(v, cast) { this.values.push(v); return `$${this.values.length}${cast ? `::${cast}` : ''}`; } };
      await db.query(Model.meta.insertSql(batch, params), params.values);
    }
  }

  // Verify: same count, and every stored value round-trips.
  const rows = await Model.find({}).lean();
  const byId = new Map(rows.map((r) => [String(r._id), r]));
  const problems = [];
  for (const d of docs) {
    const got = byId.get(String(d._id));
    if (!got) { problems.push(`${d._id}: missing`); continue; }
    const src = {};
    for (const k of Object.keys(d)) if (known.has(k)) src[k] = d[k];
    const out = [];
    diffSubset(iso(src), iso(got), '', out);
    if (out.length) problems.push(`${d._id}: ${out.slice(0, 5).join('; ')}${out.length > 5 ? ` (+${out.length - 5} more)` : ''}`);
  }
  totalProblems += problems.length;
  summary.push({ coll, table: Model.table, exported: docs.length, rows: rows.length, mismatches: problems.length, dropped: Object.keys(dropped).length ? dropped : undefined });
  for (const p of problems.slice(0, 10)) console.log(`  ${Model.table} ${p}`);
}

console.table(summary.map((s) => ({ ...s, dropped: s.dropped ? JSON.stringify(s.dropped) : '' })));
console.log(totalProblems ? `${totalProblems} document(s) differ` : 'All documents verified.');
await db.close();
if (totalProblems) process.exitCode = 1;
