// Shared by the public API routers (routes/publicApi.js, routes/publicData.js):
// the error a handler throws, and how any error becomes the API's answer.
//
//   { "error": { "code": "snake_case", "message": "What to do about it", ...extra } }
import { apiError } from '../middleware/apiKey.js';
import { PlanLimitError } from '../services/plans.js';
import logger from '../services/logger.js';

export class ApiFail extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

/** Any error → the API's JSON error. Unknown errors are logged and hidden. */
export function respondCommon(res, err, what) {
  if (err instanceof ApiFail) return apiError(res, err.status, err.code, err.message, err.extra);
  if (err instanceof PlanLimitError) return apiError(res, err.status || 402, 'plan_limit', err.message);
  if (err?.status && err.status < 500) {
    return apiError(res, err.status, err.code ? String(err.code).toLowerCase() : 'invalid_request', err.message);
  }
  logger.error(`api ${what} failed`, { error: err?.message });
  return apiError(res, 500, 'internal_error', 'Something went wrong on our side. Please retry.');
}

// ---------------------------------------------------------------- idempotency
// An Idempotency-Key header makes a POST safe to retry: the same key within
// 24 hours returns the first answer instead of doing it again.
const IDEM_TTL = 24 * 3600_000;
const idem = new Map(); // `${businessId}|${key}` -> { at, status, body } | { at, pending: true }
function idemKey(req) {
  const k = String(req.get('idempotency-key') || '').trim();
  if (!k) return null;
  if (k.length > 128) throw new ApiFail(400, 'invalid_idempotency_key', 'Idempotency-Key can be at most 128 characters.');
  return `${req.business._id}|${k}`;
}
export async function once(req, res, run) {
  const k = idemKey(req);
  if (!k) return run();
  const hit = idem.get(k);
  if (hit && Date.now() - hit.at < IDEM_TTL) {
    if (hit.pending) return apiError(res, 409, 'idempotency_in_progress', 'A request with this Idempotency-Key is still running.');
    res.set('Idempotent-Replayed', 'true');
    return res.status(hit.status).json(hit.body);
  }
  idem.set(k, { at: Date.now(), pending: true });
  if (idem.size > 20000) for (const [key, v] of idem) if (Date.now() - v.at > IDEM_TTL) idem.delete(key);
  const json = res.json.bind(res);
  res.json = (body) => {
    // Only a settled answer is replayed; a server error can be retried.
    if (res.statusCode < 500) idem.set(k, { at: Date.now(), status: res.statusCode, body });
    else idem.delete(k);
    return json(body);
  };
  return run();
}


/** The only key type that may change data. */
export function requireSecret(req) {
  if (req.apiKey?.type === 'publishable') {
    throw new ApiFail(403, 'publishable_key_read_only', 'This needs a secret key (kp_live_…), used from your server.');
  }
}

export default { ApiFail, respondCommon, requireSecret, once };
