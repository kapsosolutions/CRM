// Daily safety net for the journey / flow builders' uploads.
//
// The builders delete a file as soon as it's replaced or removed, and on
// leaving the editor they delete what was uploaded but never saved; saving
// deletes what the saved version stopped using (routes/flows.js, journeys.js).
// What can still slip through: a tab closed or crashed mid-edit, a lost
// connection at the wrong moment. This sweep removes those files.
//
// It only ever looks at each business's `flows/` and `journeys/` folders, and
// deletes a file only when it is older than MIN_AGE_H (so an editor still open
// keeps its unsaved uploads) and no Flow, Journey (published or draft) or flow
// template anywhere uses it. Templates are cross-tenant, so "uses" is checked
// against every row, not just the folder's business.
import Business from '../models/Business.js';
import Flow from '../models/Flow.js';
import Journey from '../models/Journey.js';
import FlowTemplate from '../models/FlowTemplate.js';
import storage, { collectCdnUrls, keyFromUrl } from './storage.js';
import logger from './logger.js';

const MIN_AGE_H = 48;
const BUCKETS = ['flows', 'journeys'];
// A bad day (say, rows failing to load as empty) must not empty the storage.
const MAX_DELETES_PER_RUN = 300;
const EVERY_MS = 24 * 60 * 60 * 1000;

/** Storage keys every builder definition uses. */
async function usedKeys() {
  const used = new Set();
  for (const M of [Flow, Journey, FlowTemplate]) {
    // eslint-disable-next-line no-await-in-loop
    const rows = await M.find({}).lean();
    for (const r of rows) for (const u of collectCdnUrls(r)) used.add(keyFromUrl(u));
  }
  return used;
}

/**
 * One pass. `dryRun` lists what would go without deleting.
 * @returns {{ checked: number, unused: number, deleted: number, bytes: number, keys: string[] }}
 */
export async function sweepUnusedBuilderMedia({ dryRun = false } = {}) {
  const used = await usedKeys();
  const businesses = await Business.find({}).select('_id').lean();
  const cutoff = Date.now() - MIN_AGE_H * 3600 * 1000;
  const doomed = [];
  let checked = 0;
  for (const b of businesses) {
    for (const bucket of BUCKETS) {
      // eslint-disable-next-line no-await-in-loop
      const files = await storage.listFolder(`biz/${b._id}/${bucket}`);
      checked += files.length;
      for (const f of files) {
        if (used.has(f.key)) continue;
        if (!(f.createdAt.getTime() < cutoff)) continue;
        doomed.push(f);
      }
    }
  }
  // Nothing in use anywhere while files exist looks like the rows didn't
  // load, not like every file is unused: skip this pass.
  if (!used.size && checked) {
    logger.warn('builder media sweep skipped: no flow or journey uses any file', { checked });
    return { checked, unused: doomed.length, deleted: 0, bytes: 0, keys: [] };
  }
  const batch = doomed.slice(0, MAX_DELETES_PER_RUN);
  let deleted = 0;
  if (!dryRun) {
    for (const f of batch) {
      // eslint-disable-next-line no-await-in-loop
      if (await storage.deleteByUrl(storage.urlOf(f.key))) deleted += 1;
    }
  }
  const bytes = batch.reduce((s, f) => s + f.size, 0);
  const summary = { checked, unused: doomed.length, deleted, bytes, keys: batch.map((f) => f.key) };
  if (doomed.length) {
    logger.info('builder media sweep', { checked, unused: doomed.length, deleted, mb: +(bytes / 1048576).toFixed(1), dryRun });
  }
  return summary;
}

let timer = null;

/** Start the daily sweep. Safe to call once at boot. */
export function startBuilderMediaSweep() {
  if (timer) return;
  const run = () => sweepUnusedBuilderMedia().catch((err) => logger.warn('builder media sweep failed', { error: err.message }));
  // First pass a few minutes after boot, then daily.
  const first = setTimeout(run, 5 * 60 * 1000);
  if (first.unref) first.unref();
  timer = setInterval(run, EVERY_MS);
  if (timer.unref) timer.unref();
  logger.info('builder media sweep started', { everyHours: 24, minAgeHours: MIN_AGE_H });
}

export default { startBuilderMediaSweep, sweepUnusedBuilderMedia };
