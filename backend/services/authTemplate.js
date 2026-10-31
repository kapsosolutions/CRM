// ---------------------------------------------------------------------------
// Authentication (one-time code) templates.
//
// Meta treats these differently from Marketing / Utility templates:
//   • there is no free-text body. Meta writes it ("{{1}} is your verification
//     code.", plus an optional security line and an optional expiry footer),
//     so the create request only says which of those to include;
//   • the only button is an OTP button: copy code, one-tap autofill or
//     zero-tap. One-tap and zero-tap name the Android apps allowed to receive
//     the code (`supported_apps`, the form required from Graph v21.0);
//   • every send carries one value, the code, twice: as the body parameter and
//     as the parameter of button 0 (sub_type "url"; Meta turns the OTP button
//     into a URL button when it creates the template).
//
// Docs: developers.facebook.com/docs/whatsapp/business-management-api/
//   authentication-templates/ (copy-code, autofill-button, zero-tap pages).
// ---------------------------------------------------------------------------
import crypto from 'crypto';

export const OTP_TYPES = ['COPY_CODE', 'ONE_TAP', 'ZERO_TAP'];
export const OTP_MAX_LENGTH = 15; // Meta: the code is at most 15 characters
export const MAX_APPS = 5;
export const TTL_MIN = 30; // seconds; authentication templates allow 30 s – 15 min
export const TTL_MAX = 900;

// Meta's rules for supported_apps (autofill / zero-tap pages).
const PACKAGE_RE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;
const HASH_RE = /^[A-Za-z0-9+/=]{11}$/;
const EMOJI_RE = /\p{Extended_Pictographic}/u;

/** Is this stored (or Meta) template an authentication template? */
export const isAuthTemplate = (t) => String(t?.category || '').toUpperCase() === 'AUTHENTICATION';

const invalid = (message) => Object.assign(new Error(message), { status: 400 });

const intOrNull = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};

/**
 * Normalise and check the authentication settings sent by the composer.
 *
 * A draft only has its values tidied (anything can still be missing); a
 * submit must satisfy every rule Meta documents, so the operator gets a
 * readable reason here instead of Meta's "Invalid parameter".
 *
 * @returns {{ otpType, addSecurityRecommendation, codeExpirationMinutes, buttonText,
 *   autofillText, supportedApps, zeroTapTermsAccepted, messageSendTtlSeconds }}
 */
export function parseAuthSettings(raw = {}, { draft = false } = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const otpType = String(r.otpType || '').toUpperCase();
  const out = {
    otpType: OTP_TYPES.includes(otpType) ? otpType : '',
    addSecurityRecommendation: r.addSecurityRecommendation === true || r.addSecurityRecommendation === 'true',
    codeExpirationMinutes: intOrNull(r.codeExpirationMinutes),
    buttonText: String(r.buttonText || '').trim(),
    autofillText: String(r.autofillText || '').trim(),
    supportedApps: (Array.isArray(r.supportedApps) ? r.supportedApps : [])
      .map((a) => ({ packageName: String(a?.packageName || '').trim(), signatureHash: String(a?.signatureHash || '').trim() }))
      .filter((a) => a.packageName || a.signatureHash),
    zeroTapTermsAccepted: r.zeroTapTermsAccepted === true || r.zeroTapTermsAccepted === 'true',
    messageSendTtlSeconds: intOrNull(r.messageSendTtlSeconds),
  };
  // Copy code has no app and no autofill button.
  if (out.otpType === 'COPY_CODE') {
    out.autofillText = '';
    out.supportedApps = [];
  }
  if (out.otpType !== 'ZERO_TAP') out.zeroTapTermsAccepted = false;

  if (draft) {
    // Keep a draft storable: drop values that aren't numbers at all and cap lengths.
    if (Number.isNaN(out.codeExpirationMinutes)) out.codeExpirationMinutes = null;
    if (Number.isNaN(out.messageSendTtlSeconds)) out.messageSendTtlSeconds = null;
    out.buttonText = out.buttonText.slice(0, 25);
    out.autofillText = out.autofillText.slice(0, 25);
    out.supportedApps = out.supportedApps.slice(0, MAX_APPS)
      .map((a) => ({ packageName: a.packageName.slice(0, 224), signatureHash: a.signatureHash.slice(0, 11) }));
    return out;
  }

  if (!out.otpType) throw invalid('Choose how the code is delivered: Copy code, One-tap autofill or Zero-tap.');
  const exp = out.codeExpirationMinutes;
  if (exp !== null && (!Number.isInteger(exp) || exp < 1 || exp > 90)) {
    throw invalid('Code expiry must be a whole number of minutes from 1 to 90.');
  }
  if (out.buttonText.length > 25) throw invalid('The “Copy code” button text can be at most 25 characters.');
  if (EMOJI_RE.test(out.buttonText)) throw invalid('Button text can’t contain emojis in an authentication template.');
  if (out.otpType !== 'COPY_CODE') {
    if (out.autofillText.length > 25) throw invalid('The autofill button text can be at most 25 characters.');
    if (EMOJI_RE.test(out.autofillText)) throw invalid('Button text can’t contain emojis in an authentication template.');
    const label = out.otpType === 'ONE_TAP' ? 'One-tap autofill' : 'Zero-tap';
    if (!out.supportedApps.length) {
      throw invalid(`${label} needs your Android app’s package name and app signing key hash.`);
    }
    if (out.supportedApps.length > MAX_APPS) throw invalid(`You can add at most ${MAX_APPS} apps.`);
    const seen = new Set();
    for (const [i, a] of out.supportedApps.entries()) {
      const n = out.supportedApps.length > 1 ? `App ${i + 1}: ` : '';
      if (!a.packageName) throw invalid(`${n}add the Android package name (for example com.example.app).`);
      if (a.packageName.length > 224 || !PACKAGE_RE.test(a.packageName)) {
        throw invalid(`${n}the package name must look like com.example.app: at least two parts separated by dots, each starting with a letter, using only letters, numbers and underscores (at most 224 characters).`);
      }
      if (!HASH_RE.test(a.signatureHash)) {
        throw invalid(`${n}the app signing key hash must be exactly 11 characters (letters, numbers, +, / or =).`);
      }
      const key = `${a.packageName}|${a.signatureHash}`;
      if (seen.has(key)) throw invalid(`${n}this app is listed twice.`);
      seen.add(key);
    }
  }
  if (out.otpType === 'ZERO_TAP' && !out.zeroTapTermsAccepted) {
    throw invalid('Zero-tap needs you to accept WhatsApp’s zero-tap terms.');
  }
  const ttl = out.messageSendTtlSeconds;
  if (ttl !== null && (!Number.isInteger(ttl) || ttl < TTL_MIN || ttl > TTL_MAX)) {
    throw invalid(`Message validity must be a whole number of seconds from ${TTL_MIN} to ${TTL_MAX} (15 minutes).`);
  }
  return out;
}

/** The `components` Meta's create endpoint expects for these settings. */
export function authComponents(a) {
  const button = { type: 'OTP', otp_type: a.otpType };
  if (a.buttonText) button.text = a.buttonText;
  if (a.otpType !== 'COPY_CODE') {
    if (a.autofillText) button.autofill_text = a.autofillText;
    if (a.otpType === 'ZERO_TAP') button.zero_tap_terms_accepted = true;
    button.supported_apps = a.supportedApps.map((x) => ({ package_name: x.packageName, signature_hash: x.signatureHash }));
  }
  return [
    { type: 'BODY', add_security_recommendation: !!a.addSecurityRecommendation },
    ...(a.codeExpirationMinutes ? [{ type: 'FOOTER', code_expiration_minutes: a.codeExpirationMinutes }] : []),
    { type: 'BUTTONS', buttons: [button] },
  ];
}

/** The full create request: POST /{waba-id}/message_templates. */
export function authTemplatePayload({ name, language, auth }) {
  return {
    name,
    language,
    category: 'AUTHENTICATION',
    ...(auth.messageSendTtlSeconds ? { message_send_ttl_seconds: auth.messageSendTtlSeconds } : {}),
    components: authComponents(auth),
  };
}

/** Meta's fixed English body, with the code placeholder as Meta writes it. */
export function authBodyText(a) {
  return `*{{1}}* is your verification code.${a?.addSecurityRecommendation ? ' For your security, do not share this code.' : ''}`;
}

/** Meta's fixed English expiry footer ('' when there's no expiry). */
export function authFooterText(a) {
  const n = a?.codeExpirationMinutes;
  return n ? `This code expires in ${n} minute${n === 1 ? '' : 's'}.` : '';
}

/**
 * Settings read back off a template's components: ours (the create shape) or
 * Meta's (the OTP button comes back as a URL button whose link names the type).
 */
export function authFromComponents(components = []) {
  const find = (t) => (components || []).find((c) => String(c?.type).toUpperCase() === t);
  const body = find('BODY');
  const footer = find('FOOTER');
  const btn = (find('BUTTONS')?.buttons || [])[0] || {};
  let otpType = String(btn.otp_type || '').toUpperCase();
  if (!otpType && btn.url) {
    const m = /otp_type=([A-Za-z_]+)/.exec(String(btn.url));
    otpType = m ? m[1].toUpperCase() : '';
  }
  const apps = Array.isArray(btn.supported_apps) ? btn.supported_apps : [];
  return {
    otpType: OTP_TYPES.includes(otpType) ? otpType : 'COPY_CODE',
    addSecurityRecommendation: body?.add_security_recommendation === true
      || /do not share this code/i.test(String(body?.text || '')),
    codeExpirationMinutes: Number(footer?.code_expiration_minutes) || null,
    buttonText: String(btn.text || ''),
    autofillText: String(btn.autofill_text || ''),
    supportedApps: apps.map((x) => ({ packageName: String(x.package_name || ''), signatureHash: String(x.signature_hash || '') })),
    zeroTapTermsAccepted: otpType === 'ZERO_TAP',
    messageSendTtlSeconds: null,
  };
}

/** A random numeric one-time code. */
export function generateOtp(length = 6) {
  const n = Math.max(4, Math.min(8, Number(length) || 6));
  return String(crypto.randomInt(0, 10 ** n)).padStart(n, '0');
}

/** Check a code an agent typed or a campaign supplied. Returns it trimmed. */
export function checkOtpCode(raw) {
  const code = String(raw ?? '').trim();
  if (!code) throw invalid('Enter the code to send.');
  if (code.length > OTP_MAX_LENGTH || /\s/.test(code)) {
    throw invalid(`The code can be at most ${OTP_MAX_LENGTH} characters, with no spaces.`);
  }
  return code;
}

/** Is this a code Meta would accept? */
export function isValidOtpCode(raw) {
  const code = String(raw ?? '').trim();
  return !!code && code.length <= OTP_MAX_LENGTH && !/\s/.test(code);
}

/**
 * The send options for an authentication template: the code (given, or a
 * fresh one) as the single body value and as the OTP button's value.
 */
export function authSendOptions(template, overrides = {}) {
  const given = overrides.otpCode ?? (Array.isArray(overrides.bodyParams) ? overrides.bodyParams[0] : '');
  const code = String(given ?? '').trim() ? checkOtpCode(given) : generateOtp();
  return { languageCode: template?.language || 'en_US', bodyParams: [code], otpCode: code };
}

export default {
  OTP_TYPES, isAuthTemplate, parseAuthSettings, authComponents, authTemplatePayload, authBodyText,
  authFooterText, authFromComponents, generateOtp, checkOtpCode, isValidOtpCode, authSendOptions,
};
