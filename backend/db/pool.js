// Postgres (Supabase) connection pool.
//
// The backend connects as the `postgres` role through Supabase's session
// pooler. That role owns every table, so Row Level Security (enabled on all of
// them, with nothing granted to `anon` / `authenticated`) never gets in the
// way here while keeping the tables closed to the public Data API.
import pg from 'pg';
import logger from '../services/logger.js';

const { Pool, types } = pg;

// count(*) comes back as int8, which pg returns as a string by default.
types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));

let pool = null;
let state = 'disconnected'; // disconnected | connecting | connected | error
let lastError = '';

export function getPool() {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: Number(process.env.DB_POOL_MAX || 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
  });
  pool.on('error', (err) => {
    // An idle client dropped by the pooler. pg replaces it on the next query.
    lastError = err.message;
    logger.warn('postgres idle client error', { error: err.message });
  });
  return pool;
}

/** Map Postgres errors onto the codes the routes already check for. */
function translate(err) {
  if (err && err.code === '23505') {
    // unique_violation → Mongo's duplicate-key code, which routes test for.
    err.pgCode = err.code;
    err.code = 11000;
  }
  return err;
}

export async function query(text, params = []) {
  try {
    return await getPool().query(text, params);
  } catch (err) {
    throw translate(err);
  }
}

/**
 * Run `fn(client)` inside a transaction. `client.query` has the same error
 * translation as `query`.
 */
export async function withTransaction(fn) {
  const client = await getPool().connect();
  const q = async (text, params = []) => {
    try {
      return await client.query(text, params);
    } catch (err) {
      throw translate(err);
    }
  };
  try {
    await client.query('BEGIN');
    const out = await fn({ query: q });
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function connect() {
  state = 'connecting';
  try {
    await query('select 1');
    state = 'connected';
    lastError = '';
  } catch (err) {
    state = 'error';
    lastError = err.message;
    throw err;
  }
}

/** Health probe: cheap round-trip, updates the reported state. */
export async function ping() {
  try {
    await query('select 1');
    state = 'connected';
    return true;
  } catch (err) {
    state = 'error';
    lastError = err.message;
    return false;
  }
}

export function dbState() {
  return { state, connected: state === 'connected', error: lastError || undefined };
}

export async function close() {
  if (pool) await pool.end().catch(() => {});
  pool = null;
  state = 'disconnected';
}

export default { getPool, query, withTransaction, connect, ping, dbState, close };
