// ---------------------------------------------------------------------------
// Free-trial message credits
//
// A tenant on the 'free' plan gets a fixed allowance of outbound WhatsApp
// messages (10 by default). One credit is spent per message we successfully
// hand to Meta — whatever sent it: an agent in the chat, a journey, a flow
// block, a campaign. 'paid' tenants are never metered.
//
// The reserve is a single conditional update, so two concurrent sends can't
// both squeeze through on the last credit. If the send then fails, the credit
// is handed back.
// ---------------------------------------------------------------------------
import Business from '../models/Business.js';
import { query } from '../db/pool.js';
import logger from './logger.js';

/** Thrown when a trial tenant is out of credits. Carries an HTTP status. */
export class CreditLimitError extends Error {
  constructor(limit) {
    super(
      `Free trial limit reached — all ${limit} message credits have been used. ` +
        'Ask your provider to reset the trial or upgrade the plan.',
    );
    this.name = 'CreditLimitError';
    this.code = 'CREDIT_LIMIT';
    this.status = 402; // Payment Required
  }
}

/**
 * Spend one credit, if this tenant is metered and has any left.
 * @param {string} businessId
 * @returns {Promise<{metered: boolean, spent: boolean, limit: number, used: number, remaining: number}>}
 * @throws {CreditLimitError} when a free tenant has nothing left
 */
export async function reserveCredit(businessId) {
  if (!businessId) return { metered: false, spent: false, limit: 0, used: 0, remaining: Infinity };

  // Atomic: one conditional UPDATE that only increments while used < limit.
  // Postgres re-checks the WHERE clause against the locked row, so two
  // concurrent sends can't both take the last credit.
  const { rows } = await query(
    `UPDATE ${Business.table}
        SET trial = jsonb_set(
              CASE WHEN json_typeof(trial) = 'object' THEN trial::jsonb ELSE '{}'::jsonb END,
              '{used}',
              to_jsonb(coalesce((trial ->> 'used')::double precision, 0) + 1),
              true)::json,
            updated_at = now()
      WHERE id = $1
        AND plan = 'free'
        AND coalesce((trial ->> 'used')::double precision, 0) < coalesce((trial ->> 'limit')::double precision, 0)
      RETURNING trial`,
    [String(businessId)],
  );
  if (rows[0]) {
    const limit = rows[0].trial?.limit ?? 0;
    const used = rows[0].trial?.used ?? 0;
    return { metered: true, spent: true, limit, used, remaining: Math.max(0, limit - used) };
  }

  // Nothing was incremented: either the tenant isn't metered, or it's tapped out.
  const biz = await Business.findById(businessId).select('plan trial').lean();
  if (!biz || biz.plan !== 'free') {
    return { metered: false, spent: false, limit: 0, used: 0, remaining: Infinity };
  }
  throw new CreditLimitError(biz.trial?.limit ?? 0);
}

/** Hand a reserved credit back after a failed send. */
export async function refundCredit(businessId) {
  if (!businessId) return;
  try {
    await Business.updateOne(
      { _id: businessId, plan: 'free', 'trial.used': { $gt: 0 } },
      { $inc: { 'trial.used': -1 } },
    );
  } catch (err) {
    logger.warn('credit refund failed', { businessId, error: err.message });
  }
}

/** Plan + allowance for the logged-in tenant, safe to expose to the client. */
export function planSummary(business) {
  const plan = business?.plan === 'free' ? 'free' : 'paid';
  const limit = business?.trial?.limit ?? 0;
  const used = business?.trial?.used ?? 0;
  return {
    plan,
    // The paid plan's name ('Basic' | 'Pro' | 'Premium') when recorded; '' otherwise.
    planName: plan === 'paid' ? business?.planName || '' : '',
    limit,
    used,
    remaining: plan === 'free' ? Math.max(0, limit - used) : null,
    exhausted: plan === 'free' && used >= limit,
  };
}

export default { reserveCredit, refundCredit, planSummary, CreditLimitError };
