// Validate a tenant's Meta WhatsApp credentials against the Graph API and
// return the live business details (used by the admin "Check" button before a
// business is saved). Each lookup is best-effort: the phone number id + token
// are required and must succeed; WABA + catalog are reported if resolvable.
import axios from 'axios';

const graph = (v) => `https://graph.facebook.com/${v || 'v22.0'}`;

// `status` is the field that actually says whether the number can send on Cloud
// API (CONNECTED = live). `code_verification_status` only reports the one-time
// ownership code and routinely reads EXPIRED on a working number, so it must
// never be the signal anyone reads. Fetched as a superset of CORE_FIELDS with a
// retry, because asking for a field a graph version doesn't support fails the
// whole request — and this request gates business creation.
const CORE_FIELDS = [
  'verified_name',
  'display_phone_number',
  'quality_rating',
  'code_verification_status',
  'platform_type',
];
const EXTRA_FIELDS = ['status', 'name_status', 'messaging_limit_tier'];

async function getJson(url, token) {
  const { data } = await axios.get(url, {
    headers: { Authorization: `Bearer ${token}` },
    timeout: 15000,
  });
  return data;
}

/** Phone number lookup, degrading to the core fields if the extras aren't supported. */
async function getPhoneNumber(G, phoneNumberId, token) {
  const ask = (fields) =>
    getJson(`${G}/${phoneNumberId}?fields=${fields.join(',')}`, token);
  try {
    return await ask([...CORE_FIELDS, ...EXTRA_FIELDS]);
  } catch (err) {
    // Only an unsupported-field complaint is worth a second attempt; a bad token
    // or a wrong id would fail identically twice.
    if (err.response?.status !== 400) throw err;
    return ask(CORE_FIELDS);
  }
}

/**
 * @param {{ accessToken, phoneNumberId, wabaId, catalogId, graphVersion }} creds
 * @returns {{ ok, details, errors }}
 */
export async function verifyCredentials(creds = {}) {
  const { accessToken, phoneNumberId, wabaId, catalogId, graphVersion } = creds;
  const G = graph(graphVersion);
  const errors = [];
  const details = {};

  if (!accessToken) return { ok: false, details, errors: ['Access token is required'] };
  if (!phoneNumberId) return { ok: false, details, errors: ['Phone number ID is required'] };

  // 1) Phone number — the core check. Must succeed.
  try {
    const p = await getPhoneNumber(G, phoneNumberId, accessToken);
    details.verifiedName = p.verified_name || '';
    details.displayPhoneNumber = p.display_phone_number || '';
    details.connectionStatus = p.status || '';
    details.qualityRating = p.quality_rating || '';
    details.nameStatus = p.name_status || '';
    details.messagingLimit = p.messaging_limit_tier || '';
    details.codeVerificationStatus = p.code_verification_status || '';
    details.platformType = p.platform_type || '';
  } catch (err) {
    const m = err.response?.data?.error?.message || err.message;
    return { ok: false, details, errors: [`Phone number / token invalid: ${m}`] };
  }

  // 2) WABA (optional but recommended).
  if (wabaId) {
    try {
      const w = await getJson(`${G}/${wabaId}?fields=name,timezone_id,currency`, accessToken);
      details.wabaName = w.name || '';
      details.timezone = w.timezone_id || '';
      details.currency = w.currency || '';
    } catch (err) {
      errors.push(`WABA lookup failed: ${err.response?.data?.error?.message || err.message}`);
    }
  }

  // 3) Catalog (optional).
  if (catalogId) {
    try {
      const c = await getJson(`${G}/${catalogId}?fields=name,product_count`, accessToken);
      details.catalogName = c.name || '';
      details.productCount = c.product_count ?? null;
    } catch (err) {
      errors.push(`Catalog lookup failed: ${err.response?.data?.error?.message || err.message}`);
    }
  }

  return { ok: true, details, errors };
}

export default { verifyCredentials };
