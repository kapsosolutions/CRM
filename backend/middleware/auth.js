// Auth middleware for the multi-tenant CRM.
// Tokens are signed by services/auth.js and carry { role: 'admin' | 'business',
// sub, username }. 'admin' = super admin (platform owner), 'business' = a tenant.
import { verifyToken, isCurrentAdmin } from '../services/auth.js';
import Business from '../models/Business.js';

function bearer(req) {
  return (req.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
}

// Tokens are stateless, so a passcode reset can't delete them. Instead the
// token carries the passcode generation it was minted under (`tv`); a reset
// bumps `tokenVersion` on the business, and every older token stops validating
// here on its very next request.
const STALE = { success: false, message: 'Session ended — the passcode was changed. Please sign in again.' };
const tokenIsStale = (payload, biz) => (payload.tv || 0) !== (biz.tokenVersion || 0);

// Any authenticated identity (admin or business). Attaches req.auth and, for a
// business token, loads req.business.
export async function requireAuth(req, res, next) {
  const payload = verifyToken(bearer(req));
  if (!payload) return res.status(401).json({ success: false, message: 'Unauthorized' });
  // An admin token minted before the admin password last changed is dead.
  if (payload.role === 'admin' && !isCurrentAdmin(payload)) return res.status(401).json({ success: false, message: 'Unauthorized' });
  req.auth = payload;
  if (payload.role === 'business' && payload.sub) {
    try {
      const biz = await Business.findById(payload.sub);
      if (!biz || !biz.active) return res.status(403).json({ success: false, message: 'Business inactive' });
      if (tokenIsStale(payload, biz)) return res.status(401).json(STALE);
      req.business = biz;
    } catch {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
  }
  return next();
}

// Platform owner only (manage businesses).
export async function requireSuperAdmin(req, res, next) {
  const payload = verifyToken(bearer(req));
  if (!isCurrentAdmin(payload)) {
    return res.status(401).json({ success: false, message: 'Admin only' });
  }
  req.auth = payload;
  return next();
}

/**
 * Resolve a tenant from a raw token string.
 *
 * The shared core of the HTTP guard below and the Socket.IO handshake, which
 * has no request object to hang middleware off. Same checks either way — a
 * deactivated tenant or a token minted before a passcode reset resolves to
 * null — so a live socket can't outlive the session that opened it.
 */
export async function businessFromToken(raw) {
  const payload = verifyToken(String(raw || '').replace(/^Bearer\s+/i, '').trim());
  if (!payload || payload.role !== 'business' || !payload.sub) return null;
  try {
    const biz = await Business.findById(payload.sub);
    if (!biz || !biz.active || tokenIsStale(payload, biz)) return null;
    return biz;
  } catch {
    return null;
  }
}

// A logged-in business only (tenant-scoped CRM operations).
export async function requireBusiness(req, res, next) {
  const payload = verifyToken(bearer(req));
  if (!payload || payload.role !== 'business' || !payload.sub) {
    return res.status(401).json({ success: false, message: 'Business login required' });
  }
  try {
    const biz = await Business.findById(payload.sub);
    if (!biz || !biz.active) return res.status(403).json({ success: false, message: 'Business inactive' });
    if (tokenIsStale(payload, biz)) return res.status(401).json(STALE);
    req.auth = payload;
    req.business = biz;
    return next();
  } catch {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
}

// Backwards-compatible alias used by existing CRM routes — now means
// "any authenticated user" (admin or business).
export const requireAdmin = requireAuth;

/** The logged-in tenant's id ('' for the super admin) — used to scope media. */
export const bizId = (req) => (req.business?._id ? String(req.business._id) : '');

export default {
  requireAuth, requireSuperAdmin, requireBusiness, requireAdmin, bizId, businessFromToken,
};
