// ---------------------------------------------------------------------------
// WhatsApp business profile of a business's own number (Settings, Business
// profile page, profile sidebar)
//
// Meta is the source of truth: reads go to Graph every time, with a short
// per-business cache that is dropped after any save. The Business columns
// (about, address, description, website1/2) are only a mirror, written after
// Meta has accepted a change. The CRM category (biz.category) and the login
// email are separate things and are never touched here.
//
// A business without its own number (including one on the shared test
// number, whose credentials never touch Business) is never sent to Meta.
// ---------------------------------------------------------------------------
import { getClientForBusiness } from './metaCloud.js';
import { isWhatsAppConnected } from './sandbox.js';

/**
 * Meta's accepted `vertical` values and the labels the WhatsApp client shows
 * (developers.facebook.com/docs/whatsapp/cloud-api/reference/business-profiles,
 * updated Jun 16 2026, v26.0). An empty string is also accepted.
 */
export const VERTICALS = [
  { value: 'ALCOHOL', label: 'Alcoholic Beverages' },
  { value: 'APPAREL', label: 'Clothing and Apparel' },
  { value: 'AUTO', label: 'Automotive' },
  { value: 'BEAUTY', label: 'Beauty, Spa, and Salon' },
  { value: 'EDU', label: 'Education' },
  { value: 'ENTERTAIN', label: 'Entertainment' },
  { value: 'EVENT_PLAN', label: 'Event Planning and Service' },
  { value: 'FINANCE', label: 'Finance and Banking' },
  { value: 'GOVT', label: 'Public Service' },
  { value: 'GROCERY', label: 'Food and Grocery' },
  { value: 'HEALTH', label: 'Medical and Health' },
  { value: 'HOTEL', label: 'Hotel and Lodging' },
  { value: 'NONPROFIT', label: 'Non-profit' },
  { value: 'ONLINE_GAMBLING', label: 'Online Gambling and Gaming' },
  { value: 'OTC_DRUGS', label: 'Over-the-Counter Drugs' },
  { value: 'OTHER', label: 'Other' },
  { value: 'PHYSICAL_GAMBLING', label: 'Non-Online Gambling and Gaming' },
  { value: 'PROF_SERVICES', label: 'Professional Services' },
  { value: 'RESTAURANT', label: 'Restaurant' },
  { value: 'RETAIL', label: 'Shopping and Retail' },
  { value: 'TRAVEL', label: 'Travel and Transportation' },
];
// Values Meta can still return for older profiles but no longer accepts.
const READ_ONLY_VERTICALS = { UNDEFINED: 'Not set', NOT_A_BIZ: 'Not a business' };
const VERTICAL_SET = new Set(VERTICALS.map((v) => v.value));

export function verticalLabel(v) {
  if (!v) return 'Not set';
  return VERTICALS.find((x) => x.value === v)?.label || READ_ONLY_VERTICALS[v] || v;
}

export const LIMITS = { about: 139, address: 256, description: 512, email: 128, website: 256, websites: 2 };
export const PICTURE_MAX_BYTES = 5 * 1024 * 1024;

// Characters as a person counts them (an emoji is one, not two UTF-16 units).
const len = (s) => [...s].length;
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

function websiteProblem(url) {
  if (!/^https?:\/\//i.test(url)) return 'Start the website with http:// or https://';
  if (len(url) > LIMITS.website) return `A website can be at most ${LIMITS.website} characters`;
  try {
    const u = new URL(url);
    if (!u.hostname || !u.hostname.includes('.')) return 'Enter a full website address, e.g. https://example.com';
  } catch {
    return 'Enter a valid website address, e.g. https://example.com';
  }
  return '';
}

/**
 * Check a profile update. Only keys present in `body` are considered:
 * { about?, address?, description?, email?, vertical?, websites?: string[] }.
 * Returns { fields, errors }: `fields` is what to send to Meta (trimmed),
 * `errors` maps a field to its message (empty when valid).
 */
export function validateProfile(body = {}) {
  const b = body && typeof body === 'object' ? body : {};
  const fields = {};
  const errors = {};
  const text = (key) => {
    if (b[key] === undefined) return undefined;
    if (b[key] === null) return '';
    if (typeof b[key] !== 'string') {
      errors[key] = 'Must be text';
      return undefined;
    }
    return b[key].trim();
  };

  const about = text('about');
  if (about !== undefined) {
    if (!about) errors.about = 'About can’t be empty';
    else if (len(about) > LIMITS.about) errors.about = `About can be at most ${LIMITS.about} characters`;
    else fields.about = about;
  }

  const address = text('address');
  if (address !== undefined) {
    if (len(address) > LIMITS.address) errors.address = `Address can be at most ${LIMITS.address} characters`;
    else fields.address = address;
  }

  const description = text('description');
  if (description !== undefined) {
    if (len(description) > LIMITS.description) errors.description = `Description can be at most ${LIMITS.description} characters`;
    else fields.description = description;
  }

  const email = text('email');
  if (email !== undefined) {
    if (email && len(email) > LIMITS.email) errors.email = `Email can be at most ${LIMITS.email} characters`;
    else if (email && !EMAIL_RE.test(email)) errors.email = 'Enter a valid email address, e.g. hello@example.com';
    else fields.email = email;
  }

  const vertical = text('vertical');
  if (vertical !== undefined) {
    if (vertical && !VERTICAL_SET.has(vertical)) errors.vertical = 'Choose an industry from the list';
    else fields.vertical = vertical;
  }

  if (b.websites !== undefined) {
    const list = b.websites === null ? [] : b.websites;
    if (!Array.isArray(list) || list.some((w) => typeof w !== 'string')) {
      errors.websites = 'Websites must be a list of addresses';
    } else {
      const trimmed = list.map((w) => w.trim());
      const urls = trimmed.filter(Boolean);
      if (urls.length > LIMITS.websites || list.length > LIMITS.websites) {
        errors.websites = `At most ${LIMITS.websites} websites`;
      } else {
        // Errors are keyed by the box the user typed in (website1 / website2).
        let bad = false;
        trimmed.forEach((u, i) => {
          const p = u ? websiteProblem(u) : '';
          if (p) {
            errors[`website${i + 1}`] = p;
            bad = true;
          }
        });
        if (!bad) fields.websites = urls;
      }
    }
  }

  return { fields, errors };
}

/** Is this an image Meta takes as a profile photo? Sniffs the bytes, not the client's claim. */
export function pictureType(buffer) {
  if (!buffer || buffer.length < 8) return '';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (png.every((byte, i) => buffer[i] === byte)) return 'image/png';
  return '';
}

/** Meta's error as the user should see it, plus its code. */
export function metaError(err) {
  const e = err?.response?.data?.error;
  return {
    message: e?.error_user_msg || e?.message || err?.message || 'Meta request failed',
    code: e?.code ?? err?.code ?? null,
  };
}

/** Meta's raw profile → the CRM's shape. */
export function mapProfile(biz, raw = {}) {
  const websites = (Array.isArray(raw.websites) ? raw.websites : []).filter((w) => typeof w === 'string');
  return {
    about: raw.about || '',
    address: raw.address || '',
    description: raw.description || '',
    email: raw.email || '',
    websites: [websites[0] || '', websites[1] || ''],
    vertical: raw.vertical || '',
    verticalLabel: verticalLabel(raw.vertical || ''),
    profilePictureUrl: raw.profile_picture_url || '',
    displayPhoneNumber: biz.meta?.displayPhoneNumber || '',
    verifiedName: biz.meta?.verifiedName || '',
  };
}

// The photo URL Meta returns expires, so answers are only reused briefly.
const TTL_MS = 60 * 1000;
// businessId -> { phoneNumberId, at, data }
const cache = new Map();

/** The profile from Meta (cached 60 s). Throws Meta's error. Call only for a connected business. */
export async function getProfile(biz, { refresh = false } = {}) {
  const id = String(biz._id);
  const hit = cache.get(id);
  if (!refresh && hit && hit.phoneNumberId === String(biz.phoneNumberId) && Date.now() - hit.at < TTL_MS) return hit.data;
  const raw = await getClientForBusiness(biz).getBusinessProfile();
  const data = mapProfile(biz, raw);
  cache.set(id, { phoneNumberId: String(biz.phoneNumberId), at: Date.now(), data });
  return data;
}

export function clearProfileCache(bizId) {
  cache.delete(String(bizId || ''));
}

/** Copy what Meta accepted onto the Business row (never category or login email). */
export function mirrorProfile(biz, fields) {
  if (fields.about !== undefined) biz.about = fields.about;
  if (fields.address !== undefined) biz.address = fields.address;
  if (fields.description !== undefined) biz.description = fields.description;
  if (fields.websites !== undefined) {
    biz.website1 = fields.websites[0] || '';
    biz.website2 = fields.websites[1] || '';
  }
}

export { isWhatsAppConnected };

export default { VERTICALS, verticalLabel, validateProfile, pictureType, metaError, mapProfile, getProfile, clearProfileCache, mirrorProfile };
