// Super-admin → Storage: how much space the platform uses.
//
//   Supabase  the Postgres database (its size and the largest tables) and
//             Supabase Storage buckets, read with SQL over DATABASE_URL.
//   Bunny     the storage zone that holds every uploaded file (used bytes and
//             file count), its pull zone's bandwidth this month and the
//             account balance, from bunny.net's account API (BUNNY_API_KEY).
//
// Each side is read on its own: one failing (no key, Bunny down) still shows
// the other, with the reason. Kept for 5 minutes; ?refresh=1 reads again.
import axios from 'axios';
import { query } from '../db/pool.js';
import logger from './logger.js';

const CACHE_MS = 5 * 60 * 1000;
const MB = 1024 * 1024;
let cache = null; // { at, data }

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
// The plan's limits, to draw the bars. Supabase Free: 500 MB database, 1 GB
// storage; set SUPABASE_DB_LIMIT_MB / SUPABASE_STORAGE_LIMIT_MB for another plan.
const limitMb = (name, dflt) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : dflt;
};

async function supabaseStats() {
  const out = {
    database: { bytes: 0, limitBytes: limitMb('SUPABASE_DB_LIMIT_MB', 500) * MB, tables: [] },
    storage: { available: false, bytes: 0, files: 0, limitBytes: limitMb('SUPABASE_STORAGE_LIMIT_MB', 1024) * MB, buckets: [] },
    error: '',
  };
  try {
    const size = await query('SELECT pg_database_size(current_database())::bigint AS bytes');
    out.database.bytes = num(size.rows[0]?.bytes);
    const tables = await query(
      `SELECT c.relname AS name, pg_total_relation_size(c.oid)::bigint AS bytes, c.reltuples::bigint AS rows
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'r' AND n.nspname = 'public'
        ORDER BY pg_total_relation_size(c.oid) DESC
        LIMIT 12`,
    );
    out.database.tables = tables.rows.map((r) => ({ name: r.name, bytes: num(r.bytes), rows: Math.max(0, num(r.rows)) }));
  } catch (err) {
    out.error = 'Couldn’t read the database size.';
    logger.warn('storage stats: database size failed', { error: err.message });
  }
  // Supabase Storage (files kept in Supabase rather than Bunny). The schema
  // exists on every Supabase project; elsewhere this is simply skipped.
  try {
    const b = await query(
      `SELECT bucket_id AS name, count(*)::bigint AS files,
              coalesce(sum((metadata->>'size')::bigint), 0)::bigint AS bytes
         FROM storage.objects GROUP BY bucket_id ORDER BY 3 DESC`,
    );
    out.storage.available = true;
    out.storage.buckets = b.rows.map((r) => ({ name: r.name, files: num(r.files), bytes: num(r.bytes) }));
    out.storage.bytes = out.storage.buckets.reduce((s, x) => s + x.bytes, 0);
    out.storage.files = out.storage.buckets.reduce((s, x) => s + x.files, 0);
  } catch (err) {
    logger.info('storage stats: Supabase Storage not readable', { error: err.message });
  }
  return out;
}

async function bunnyStats() {
  const zone = process.env.BUNNY_STORAGE_ZONE || '';
  const key = process.env.BUNNY_API_KEY || '';
  const out = {
    configured: !!zone,
    zone,
    bytes: 0,
    files: 0,
    region: '',
    bandwidthBytes: 0,
    pullZones: [],
    balance: null,
    monthCharges: null,
    error: '',
  };
  if (!zone) {
    out.error = 'Bunny storage isn’t set up (BUNNY_STORAGE_ZONE).';
    return out;
  }
  if (!key) {
    out.error = 'Add BUNNY_API_KEY (bunny.net → Account → API key) to see the space used.';
    return out;
  }
  const api = axios.create({ baseURL: 'https://api.bunny.net', headers: { AccessKey: key, Accept: 'application/json' }, timeout: 15000 });
  try {
    const { data } = await api.get('/storagezone', { params: { page: 1, perPage: 1000 } });
    const list = Array.isArray(data) ? data : data?.Items || [];
    // Only the fields below are kept: the list also carries each zone's password.
    const z = list.find((x) => x?.Name === zone && !x.Deleted);
    if (!z) {
      out.error = `The storage zone “${zone}” wasn’t found in this Bunny account.`;
    } else {
      out.bytes = num(z.StorageUsed);
      out.files = num(z.FilesStored);
      out.region = z.Region || '';
      // The pull zones serving this storage zone: their bandwidth this month.
      const linked = Array.isArray(z.PullZones) ? z.PullZones : [];
      out.pullZones = linked.map((p) => ({ name: p.Name || '', bandwidthBytes: num(p.MonthlyBandwidthUsed) }));
      out.bandwidthBytes = out.pullZones.reduce((s, p) => s + p.bandwidthBytes, 0);
    }
  } catch (err) {
    out.error = err.response?.status === 401 ? 'Bunny refused the API key (BUNNY_API_KEY).' : 'Couldn’t reach Bunny.';
    logger.warn('storage stats: bunny storage zone failed', { error: err.message, status: err.response?.status });
    return out;
  }
  try {
    const { data } = await api.get('/billing');
    if (data && typeof data === 'object') {
      out.balance = data.Balance ?? null;
      out.monthCharges = data.ThisMonthCharges ?? null;
    }
  } catch (err) {
    logger.info('storage stats: bunny billing not read', { error: err.message });
  }
  return out;
}

/** { generatedAt, supabase, bunny } for the admin Storage page. */
export async function storageStats({ refresh = false } = {}) {
  if (!refresh && cache && Date.now() - cache.at < CACHE_MS) return cache.data;
  const [supabase, bunny] = await Promise.all([supabaseStats(), bunnyStats()]);
  const data = { generatedAt: new Date().toISOString(), supabase, bunny };
  cache = { at: Date.now(), data };
  return data;
}

/** For tests. */
export function _resetStorageStats() {
  cache = null;
}
