// ---------------------------------------------------------------------------
// WhatsApp messaging-limit tiers
//
// Meta reports a number's limit as a tier code. Since 2025 the field is
// `whatsapp_business_manager_messaging_limit` (e.g. "TIER_2K"); the older
// `messaging_limit_tier` is deprecated and Graph v21–v23 no longer return it,
// but it is still read as a fallback. The limit is the number of unique
// customers a business can start conversations with in a rolling 24 hours.
// Current path: 250 → 2,000 → 10,000 → 100,000 → Unlimited. TIER_50 and
// TIER_1K are legacy values that may still show up on old numbers.
// ---------------------------------------------------------------------------

const LIMITS = {
  TIER_50: 50,
  TIER_250: 250,
  TIER_1K: 1000,
  TIER_2K: 2000,
  TIER_10K: 10000,
  TIER_100K: 100000,
};

/** The tiers drawn on the Channel Status track, lowest first. */
export const TIER_TRACK = ['TIER_250', 'TIER_2K', 'TIER_10K', 'TIER_100K', 'TIER_UNLIMITED'];

/**
 * A tier code as numbers: { tier, limit, label, unlimited }.
 * "TIER_2K" → { limit: 2000, label: '2,000' }; "TIER_UNLIMITED" → limit null,
 * unlimited true. Anything unrecognised keeps its raw text as the label.
 */
export function tierInfo(raw) {
  const tier = String(raw || '').trim().toUpperCase();
  if (tier === 'TIER_UNLIMITED') return { tier, limit: null, label: 'Unlimited', unlimited: true };
  if (Object.prototype.hasOwnProperty.call(LIMITS, tier)) {
    const limit = LIMITS[tier];
    return { tier, limit, label: limit.toLocaleString('en-US'), unlimited: false };
  }
  const text = String(raw || '').trim();
  return { tier: text, limit: null, label: text || 'Unknown', unlimited: false };
}

/** The tier code from a Graph phone-number object, preferring the current field. */
export function pickTier(phoneFields = {}) {
  return phoneFields?.whatsapp_business_manager_messaging_limit || phoneFields?.messaging_limit_tier || '';
}

export default { tierInfo, pickTier, TIER_TRACK };
