// ---------------------------------------------------------------------------
// Reverse geocoding: a shared pin → a readable delivery address.
//
// WhatsApp only sends a street address when the customer picks a saved place;
// a dropped pin arrives as bare coordinates. This turns those into an address
// using OpenStreetMap's Nominatim (free, no key).
//
// Nominatim's usage policy allows at most ONE request per second, requires an
// identifying User-Agent, and asks that results be cached. So:
//   • results are cached in Redis (fast, 30-day TTL) backed by Mongo
//     (GeoCache, durable) — a pin is looked up once, ever;
//   • lookups go through a BullMQ queue whose worker is rate-limited to one job
//     per ~1.1 s. Ten customers sharing a location in the same second become
//     ten jobs drained in order, never a burst against the provider;
//   • identical pins share one job (deduplicated by jobId);
//   • a caller waits only briefly for its result. If the queue is backed up,
//     the conversation carries on with coordinates and the address is filled
//     in on the order as soon as the job finishes.
//
// If Redis isn't reachable, the same one-per-second spacing is enforced
// in-process instead, so the feature degrades rather than breaks.
//
// Data note: each lookup sends the pin's coordinates to OpenStreetMap. Results
// are © OpenStreetMap contributors (ODbL).
// ---------------------------------------------------------------------------
import axios from 'axios';
import Redis from 'ioredis';
import { Queue, Worker, QueueEvents } from 'bullmq';
import GeoCache from '../models/GeoCache.js';
import Order from '../models/Order.js';
import storage from './storage.js';
import logger from './logger.js';

const QUEUE = 'geocode';
const MIN_GAP_MS = 1100; // just over Nominatim's 1 req/s ceiling
const ENDPOINT = 'https://nominatim.openstreetmap.org/reverse';

const redisUrl = () => process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const contact = () => process.env.GEOCODE_CONTACT_EMAIL || '';
const userAgent = () =>
  `WhatsAppCRM/1.0 (${contact() || process.env.PUBLIC_BASE_URL || 'self-hosted'})`;

/** The cache / dedupe key for a pin: rounded to ~1 m. */
export function geoKey(lat, lng) {
  return `${Number(lat).toFixed(5)}_${Number(lng).toFixed(5)}`;
}

const COORDS_RE = /^\s*-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?\s*$/;
/** Is this "address" really just "lat, lng"? */
export const isCoordsText = (s) => COORDS_RE.test(String(s || ''));

const validPin = (lat, lng) =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

/**
 * A delivery-friendly address from Nominatim's structured result: house and
 * street, then the locality, city, state and PIN code — without the country
 * and administrative noise of the full display name.
 */
function formatAddress(data) {
  const a = data?.address || {};
  const street = [a.house_number, a.road || a.pedestrian || a.footway].filter(Boolean).join(' ');
  const locality = a.neighbourhood || a.suburb || a.quarter || a.hamlet || a.residential || '';
  const city = a.city || a.town || a.village || a.municipality || a.county || a.state_district || '';
  const parts = [a.building || a.amenity || a.shop || '', street, locality, city, a.state, a.postcode]
    .map((s) => String(s || '').trim())
    .filter(Boolean);
  const unique = parts.filter((p, i) => parts.indexOf(p) === i);
  return unique.join(', ') || String(data?.display_name || '').trim();
}

// ---------------------------------------------------------------------------
// Providers: Ola Maps first (India-specific, keyed, 1 lakh free/month per API),
// OpenStreetMap Nominatim as the automatic fallback.
// ---------------------------------------------------------------------------
const OLA_BASE = 'https://api.olamaps.io';
const olaKey = () => String(process.env.OLA_MAPS_API_KEY || '').trim();
const olaRps = () => Math.max(1, Math.min(50, Number(process.env.OLA_MAPS_RPS) || 5));

// When Ola rejects the key (401/403) or the quota is used up (429), stop
// asking it for a while instead of spending a failed call on every pin.
let olaPausedUntil = 0;
const olaUsable = () => !!olaKey() && Date.now() >= olaPausedUntil;
function pauseOla(ms, why) {
  olaPausedUntil = Date.now() + ms;
  logger.warn('Ola Maps paused — using OpenStreetMap', { why, minutes: Math.round(ms / 60000) });
}

/** A delivery-friendly address from Ola's (Google-style) result. */
function formatOla(r) {
  const comps = Array.isArray(r?.address_components) ? r.address_components : [];
  const pick = (...types) => comps.find((c) => types.some((t) => (c.types || []).includes(t)))?.long_name || '';
  const parts = [
    pick('premise', 'establishment', 'point_of_interest'),
    [pick('street_number'), pick('route')].filter(Boolean).join(' '),
    pick('sublocality_level_1', 'sublocality', 'neighborhood'),
    pick('locality', 'administrative_area_level_3'),
    pick('administrative_area_level_1'),
    pick('postal_code'),
  ].map((s) => String(s || '').trim()).filter(Boolean);
  const unique = parts.filter((p, i) => parts.indexOf(p) === i);
  // Ola's own formatted string is usually the best; fall back to ours. The
  // trailing ", India" is noise on an Indian delivery slip.
  const formatted = String(r?.formatted_address || '').trim().replace(/,\s*India$/i, '');
  return formatted || unique.join(', ');
}

/**
 * One call to Ola's reverse geocoder. Returns null when Ola can't be used
 * right now (bad key, quota, outage) so the caller falls back to OSM.
 */
async function lookupOla(lat, lng) {
  if (!olaUsable()) return null;
  try {
    const { data } = await axios.get(`${OLA_BASE}/places/v1/reverse-geocode`, {
      params: { latlng: `${lat},${lng}`, api_key: olaKey() },
      headers: { 'X-Request-Id': `crm-${geoKey(lat, lng)}-${Date.now()}` },
      timeout: 8000,
    });
    const top = (data?.results || [])[0];
    if (!top) return { address: '', displayName: '', provider: 'ola' };
    return { address: formatOla(top), displayName: String(top.formatted_address || ''), provider: 'ola' };
  } catch (err) {
    const st = err.response?.status;
    if (st === 401 || st === 403) pauseOla(30 * 60000, `key rejected (${st})`);
    else if (st === 429) pauseOla(10 * 60000, 'rate/monthly limit reached (429)');
    else logger.warn('Ola reverse-geocode failed', { status: st, error: err.message });
    return null;
  }
}

// Nominatim allows ONE request a second. Ola's queue runs faster, so the OSM
// fallback keeps its own spacing no matter how fast the queue drains.
let lastNominatim = 0;
async function nominatimGap() {
  const wait = lastNominatim + MIN_GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastNominatim = Date.now();
}

/** Ola first, then OpenStreetMap. */
async function lookupAddress(lat, lng) {
  const ola = await lookupOla(lat, lng);
  if (ola && ola.address) return ola;
  await nominatimGap();
  return { ...(await lookupNominatim(lat, lng)), provider: 'nominatim' };
}

/** One call to Nominatim. Throws on HTTP failure so the job can retry. */
async function lookupNominatim(lat, lng) {
  const { data } = await axios.get(ENDPOINT, {
    params: {
      format: 'jsonv2',
      lat,
      lon: lng,
      zoom: 18,
      addressdetails: 1,
      ...(contact() ? { email: contact() } : {}),
    },
    headers: { 'User-Agent': userAgent(), 'Accept-Language': 'en' },
    timeout: 8000,
  });
  if (data?.error) return { address: '', displayName: '' }; // e.g. a pin in the ocean
  return { address: formatAddress(data), displayName: String(data?.display_name || '') };
}

// ---------------------------------------------------------------------------
// Two-level cache: Redis first (sub-millisecond, 30-day TTL), Mongo behind it
// (durable — survives a Redis flush or restart, and refills Redis on a hit).
// ---------------------------------------------------------------------------
const REDIS_TTL_S = 30 * 24 * 3600;
const rkey = (lat, lng) => `geo:addr:${geoKey(lat, lng)}`;
let redis = null; // set once the queue's Redis is confirmed reachable

async function redisGet(lat, lng) {
  if (!redis) return null;
  try {
    const raw = await redis.get(rkey(lat, lng));
    if (raw === null) return null;
    return String(JSON.parse(raw).a || '');
  } catch {
    return null; // a Redis hiccup just means "ask Mongo"
  }
}
async function redisSet(lat, lng, address) {
  if (!redis) return;
  try {
    await redis.set(rkey(lat, lng), JSON.stringify({ a: address || '' }), 'EX', REDIS_TTL_S);
  } catch {
    /* cache only — never fatal */
  }
}

/** Make sure a known result is in both caches (Mongo only if missing). */
async function remember(lat, lng, address) {
  await GeoCache.updateOne(
    { key: geoKey(lat, lng) },
    { $setOnInsert: { lat, lng, address, provider: 'cache' } },
    { upsert: true },
  ).catch(() => {});
  await redisSet(lat, lng, address);
}

/** Cache read: Redis, then Mongo (warming Redis on a Mongo hit). */
async function cached(lat, lng) {
  const fast = await redisGet(lat, lng);
  if (fast !== null) return fast;
  const hit = await GeoCache.findOne({ key: geoKey(lat, lng) }).select('address').lean().catch(() => null);
  if (!hit) return null; // never looked up
  await redisSet(lat, lng, hit.address || '');
  return hit.address || ''; // '' = looked up, nothing found
}

/**
 * Look a pin up, cache it, and backfill any order still showing raw
 * coordinates for it. Runs inside the rate-limited worker (or the fallback).
 */
async function resolveAndStore(lat, lng) {
  const hit = await cached(lat, lng);
  if (hit !== null) return hit;

  const { address, displayName, provider } = await lookupAddress(lat, lng);
  await GeoCache.updateOne(
    { key: geoKey(lat, lng) },
    { $set: { lat, lng, address, displayName, provider } },
    { upsert: true },
  ).catch(() => {});
  await redisSet(lat, lng, address);

  if (address) {
    // An order placed while this job was still waiting kept the coordinates —
    // swap in the address now so the CRM and any later slip read properly.
    const res = await Order.updateMany(
      { locationLat: lat, locationLng: lng, deliveryAddress: { $regex: COORDS_RE.source } },
      { $set: { deliveryAddress: address } },
    ).catch(() => null);
    logger.info('geocoded pin', { key: geoKey(lat, lng), address, ordersUpdated: res?.modifiedCount || 0 });
  } else {
    logger.info('geocode: no address for this pin', { key: geoKey(lat, lng) });
  }
  return address;
}

// ---------------------------------------------------------------------------
// Queue (BullMQ on Redis), with an in-process fallback
// ---------------------------------------------------------------------------
let queue = null;
let events = null;
let worker = null;
let ready = false;

/**
 * Start the queue, its event stream and the rate-limited worker. Called once at
 * boot. Never throws: if Redis isn't there the in-process fallback is used.
 */
export async function startGeocodeQueue() {
  // Workers need maxRetriesPerRequest: null (BullMQ requirement for blocking
  // commands); enableOfflineQueue: false makes a dead Redis fail fast instead
  // of silently buffering every lookup forever.
  const connection = { url: redisUrl(), maxRetriesPerRequest: null, enableOfflineQueue: false };
  // The worker keeps ioredis' offline queue (BullMQ advises against disabling
  // it for workers): it should ride out a Redis blip, not crash its loop.
  const workerConnection = { url: redisUrl(), maxRetriesPerRequest: null };
  try {
    queue = new Queue(QUEUE, {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { age: 3600, count: 1000 },
        // Kept briefly for debugging, but not long: a failed pin's jobId would
        // otherwise block a fresh attempt for that spot (ids are deduplicated).
        removeOnFail: { age: 600 },
      },
    });
    queue.on('error', (err) => logger.warn('geocode queue error', { error: err.message }));

    await Promise.race([
      queue.waitUntilReady(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('Redis not reachable in 3 s')), 3000)),
    ]);

    events = new QueueEvents(QUEUE, { connection });
    events.on('error', (err) => logger.warn('geocode events error', { error: err.message }));

    worker = new Worker(
      QUEUE,
      async (job) => ({ address: await resolveAndStore(job.data.lat, job.data.lng) }),
      {
        connection: workerConnection,
        concurrency: 1,
        // Never more than OLA_MAPS_RPS lookups a second, however many
        // locations arrive at once (Ola enforces per-minute limits). Without
        // an Ola key it drops to OSM's one-per-second.
        limiter: olaKey() ? { max: olaRps(), duration: 1000 } : { max: 1, duration: MIN_GAP_MS },
      },
    );
    worker.on('error', (err) => logger.warn('geocode worker error', { error: err.message }));
    worker.on('failed', (job, err) => logger.warn('geocode job failed', { key: job?.id, attempts: job?.attemptsMade, error: err.message }));

    await events.waitUntilReady();

    // Plain client for the address cache. Fail-fast settings: a cache must
    // never make a lookup wait on a Redis that's gone away.
    // lazyConnect + an explicit connect(): with the offline queue off, a command
    // sent before the socket is up would fail, so wait for it to be ready.
    redis = new Redis(redisUrl(), { maxRetriesPerRequest: 1, enableOfflineQueue: false, lazyConnect: true });
    redis.on('error', (err) => logger.warn('geocode cache (redis) error', { error: err.message }));
    await redis.connect();
    await redis.ping();

    ready = true;
    logger.info('geocode queue ready (BullMQ)', {
      redis: redisUrl().replace(/\/\/[^@]*@/, '//***@'),
      provider: olaKey() ? `Ola Maps (≤${olaRps()}/s) → OSM fallback` : 'OpenStreetMap (1/s)',
    });
  } catch (err) {
    ready = false;
    logger.warn('geocode queue unavailable — using the in-process rate limiter', { error: err.message });
    await Promise.allSettled([worker?.close(), events?.close(), queue?.close(), redis?.quit()]);
    queue = null; events = null; worker = null; redis = null;
  }
}

export async function stopGeocodeQueue() {
  await Promise.allSettled([worker?.close(), events?.close(), queue?.close(), redis?.quit()]);
  redis = null;
}

// In-process fallback: one chain, so calls are strictly spaced MIN_GAP_MS apart.
let chain = Promise.resolve();
let lastCall = 0;
function viaFallback(lat, lng) {
  const run = chain.then(async () => {
    const hit = await cached(lat, lng);
    if (hit !== null) return hit;
    const gap = olaUsable() ? Math.ceil(1000 / olaRps()) : MIN_GAP_MS;
    const wait = lastCall + gap - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    return resolveAndStore(lat, lng);
  });
  chain = run.catch(() => {}); // a failed lookup mustn't jam the chain
  return run;
}

/**
 * A readable address for a pin, or '' if none is available in time.
 *
 * Cached pins return immediately. Otherwise the lookup is queued and this waits
 * up to `waitMs` for it; past that it returns '' and the job finishes on its
 * own (backfilling the order). Never throws.
 *
 * @param {number} lat
 * @param {number} lng
 * @param {{ waitMs?: number }} [opts]
 */
export async function addressFor(lat, lng, { waitMs = 4000 } = {}) {
  const la = Number(lat);
  const ln = Number(lng);
  if (!validPin(la, ln)) return '';
  try {
    const hit = await cached(la, ln);
    if (hit !== null) return hit;

    const fallback = () => Promise.race([
      viaFallback(la, ln).catch(() => ''),
      new Promise((r) => setTimeout(() => r(''), waitMs)),
    ]);
    if (!ready || !queue || !events) return await fallback();

    // Same pin from two customers at once → one job, both wait on it.
    let job;
    try {
      job = await queue.add('reverse', { lat: la, lng: ln }, { jobId: geoKey(la, ln) });
    } catch (err) {
      // Redis went away after boot: keep serving, at the same 1/s spacing.
      logger.warn('geocode queue add failed — using the in-process rate limiter', { error: err.message });
      return await fallback();
    }
    const out = await job.waitUntilFinished(events, waitMs).catch(() => null);
    if (out && typeof out.address === 'string') {
      // A deduplicated job can hand back a result from an earlier run; make
      // sure it's in both caches so the next ask doesn't touch the queue.
      await remember(la, ln, out.address);
      return out.address;
    }
    // Finished earlier (a deduplicated job) or still queued: the cache decides.
    return (await cached(la, ln)) || '';
  } catch (err) {
    logger.warn('geocode lookup skipped', { error: err.message });
    return '';
  }
}

// ---------------------------------------------------------------------------
// Map picture for a pin (Ola Static Maps), fetched ONCE and hosted on our CDN.
// The browser loads our copy, so the Ola key never leaves the server and each
// spot costs one Static Maps call in total. Calls are spaced like lookups.
// ---------------------------------------------------------------------------
let lastMapCall = 0;
let mapChain = Promise.resolve();
const mapInflight = new Map(); // geoKey → Promise<string>

async function fetchOlaMap(lat, lng) {
  const wait = lastMapCall + Math.ceil(1000 / olaRps()) - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastMapCall = Date.now();
  const res = await axios.get(
    `${OLA_BASE}/tiles/v1/styles/default-light-standard/static/${lng},${lat},16/560x300.png`,
    {
      params: { marker: `${lng},${lat}|red|scale:0.9`, api_key: olaKey() },
      responseType: 'arraybuffer',
      timeout: 10000,
    },
  );
  if (!String(res.headers['content-type'] || '').startsWith('image/')) throw new Error('not an image');
  return Buffer.from(res.data);
}

/**
 * A hosted map image URL for a pin, or '' if none can be made (no Ola key,
 * Ola paused/limited, upload failed) — the CRM then draws its own tile map.
 * Never throws.
 */
export async function mapImageFor(lat, lng) {
  const la = Number(lat);
  const ln = Number(lng);
  if (!validPin(la, ln)) return '';
  const key = geoKey(la, ln);
  try {
    const row = await GeoCache.findOne({ key }).select('mapUrl').lean();
    if (row?.mapUrl) return row.mapUrl;
    if (!olaUsable()) return '';
    if (mapInflight.has(key)) return await mapInflight.get(key); // same pin at once → one call

    const job = (async () => {
      // One at a time, spaced — a burst of pins can't spike Ola's limits.
      const run = mapChain.then(() => fetchOlaMap(la, ln));
      mapChain = run.catch(() => {});
      const png = await run;
      const url = await storage.uploadBuffer(png, 'shared/maps', 'image');
      await GeoCache.updateOne({ key }, { $set: { mapUrl: url }, $setOnInsert: { lat: la, lng: ln } }, { upsert: true });
      return url;
    })();
    mapInflight.set(key, job);
    try {
      return await job;
    } finally {
      mapInflight.delete(key);
    }
  } catch (err) {
    const st = err.response?.status;
    if (st === 401 || st === 403) pauseOla(30 * 60000, `key rejected (${st})`);
    else if (st === 429) pauseOla(10 * 60000, 'rate/monthly limit reached (429)');
    else logger.warn('map image skipped', { key, status: st, error: err.message });
    return '';
  }
}

/**
 * Upgrade a token set whose `delivery_address` is still raw coordinates.
 * Returns the same object when there's nothing to do.
 */
export async function withGeocodedAddress(tokens = {}, opts) {
  if (!isCoordsText(tokens.delivery_address)) return tokens;
  const lat = Number(tokens.location_lat);
  const lng = Number(tokens.location_lng);
  if (!validPin(lat, lng)) return tokens;
  const address = await addressFor(lat, lng, opts);
  return address ? { ...tokens, delivery_address: address } : tokens;
}

export default { startGeocodeQueue, stopGeocodeQueue, addressFor, mapImageFor, withGeocodedAddress, geoKey, isCoordsText };
