// Authentication (one-time code) templates: Meta writes the message text, so
// the CRM only chooses the optional lines and the OTP button. The same rules
// are checked on the server (backend/services/authTemplate.js).
import type { OtpType, TemplateAuth, TemplateComponent, TemplateItem } from './types';

export const OTP_MAX_LENGTH = 15;
export const MAX_APPS = 5;
export const TTL_MIN = 30;
export const TTL_MAX = 900;

const PACKAGE_RE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;
const HASH_RE = /^[A-Za-z0-9+/=]{11}$/;
const EMOJI_RE = /\p{Extended_Pictographic}/u;

export const OTP_TYPE_LABEL: Record<OtpType, string> = {
  COPY_CODE: 'Copy code',
  ONE_TAP: 'One-tap autofill',
  ZERO_TAP: 'Zero-tap',
};

export const EMPTY_AUTH: TemplateAuth = {
  otpType: 'COPY_CODE',
  addSecurityRecommendation: true,
  codeExpirationMinutes: 10,
  buttonText: '',
  autofillText: '',
  supportedApps: [],
  zeroTapTermsAccepted: false,
  messageSendTtlSeconds: null,
};

export const isAuthTemplate = (t?: { category?: string } | null) =>
  String(t?.category || '').toUpperCase() === 'AUTHENTICATION';

/** Meta's fixed English body, with the code placeholder as Meta writes it. */
export function authBodyText(a: Pick<TemplateAuth, 'addSecurityRecommendation'>): string {
  return `*{{1}}* is your verification code.${a.addSecurityRecommendation ? ' For your security, do not share this code.' : ''}`;
}

/** Meta's fixed English expiry footer ('' when there's no expiry). */
export function authFooterText(a: Pick<TemplateAuth, 'codeExpirationMinutes'>): string {
  const n = a.codeExpirationMinutes;
  return n ? `This code expires in ${n} minute${n === 1 ? '' : 's'}.` : '';
}

/** The button the customer sees (one-tap / zero-tap fall back to copy code off Android). */
export function authPreviewButtons(a: TemplateAuth): { type: string; text: string }[] {
  if (a.otpType === 'ONE_TAP' || a.otpType === 'ZERO_TAP') {
    return [{ type: 'COPY_CODE', text: a.autofillText || 'Autofill' }];
  }
  return [{ type: 'COPY_CODE', text: a.buttonText || 'Copy code' }];
}

/** Settings off a template: our stored copy, or read back off Meta's components. */
export function authFromTemplate(t?: TemplateItem | null): TemplateAuth {
  if (t?.auth?.otpType) return { ...EMPTY_AUTH, ...t.auth, supportedApps: [...(t.auth.supportedApps || [])] };
  const comps: (TemplateComponent & Record<string, unknown>)[] = (t?.components || []) as never;
  const find = (type: string) => comps.find((c) => String(c.type).toUpperCase() === type);
  const body = find('BODY');
  const footer = find('FOOTER');
  const btn = ((find('BUTTONS')?.buttons || [])[0] || {}) as Record<string, unknown>;
  let otp = String(btn.otp_type || '').toUpperCase();
  if (!otp && btn.url) otp = (/otp_type=([A-Za-z_]+)/.exec(String(btn.url))?.[1] || '').toUpperCase();
  const otpType: OtpType = otp === 'ONE_TAP' || otp === 'ZERO_TAP' ? otp : 'COPY_CODE';
  const apps = Array.isArray(btn.supported_apps) ? (btn.supported_apps as Record<string, unknown>[]) : [];
  return {
    otpType,
    addSecurityRecommendation:
      body?.add_security_recommendation === true || /do not share this code/i.test(String(body?.text || '')),
    codeExpirationMinutes: Number(footer?.code_expiration_minutes) || null,
    buttonText: String(btn.text || ''),
    autofillText: String(btn.autofill_text || ''),
    supportedApps: apps.map((x) => ({ packageName: String(x.package_name || ''), signatureHash: String(x.signature_hash || '') })),
    zeroTapTermsAccepted: otpType === 'ZERO_TAP',
    messageSendTtlSeconds: null,
  };
}

/** Why these settings can't be submitted ('' when they can). */
export function authProblem(a: TemplateAuth): string {
  if (!a.otpType) return 'Choose how the code is delivered: Copy code, One-tap autofill or Zero-tap.';
  const exp = a.codeExpirationMinutes;
  if (exp !== null && (!Number.isInteger(exp) || exp < 1 || exp > 90)) {
    return 'Code expiry must be a whole number of minutes from 1 to 90.';
  }
  if (a.buttonText.trim().length > 25) return 'The “Copy code” button text can be at most 25 characters.';
  if (EMOJI_RE.test(a.buttonText) || EMOJI_RE.test(a.autofillText)) {
    return 'Button text can’t contain emojis in an authentication template.';
  }
  if (a.otpType !== 'COPY_CODE') {
    if (a.autofillText.trim().length > 25) return 'The autofill button text can be at most 25 characters.';
    const apps = a.supportedApps.filter((x) => x.packageName.trim() || x.signatureHash.trim());
    if (!apps.length) {
      return `${OTP_TYPE_LABEL[a.otpType]} needs your Android app’s package name and app signing key hash.`;
    }
    if (apps.length > MAX_APPS) return `You can add at most ${MAX_APPS} apps.`;
    for (const [i, x] of apps.entries()) {
      const n = apps.length > 1 ? `App ${i + 1}: ` : '';
      const pkg = x.packageName.trim();
      if (!pkg) return `${n}add the Android package name (for example com.example.app).`;
      if (pkg.length > 224 || !PACKAGE_RE.test(pkg)) {
        return `${n}the package name must look like com.example.app: at least two parts separated by dots, each starting with a letter, using only letters, numbers and underscores.`;
      }
      if (!HASH_RE.test(x.signatureHash.trim())) {
        return `${n}the app signing key hash must be exactly 11 characters (letters, numbers, +, / or =).`;
      }
    }
  }
  if (a.otpType === 'ZERO_TAP' && !a.zeroTapTermsAccepted) return 'Zero-tap needs you to accept WhatsApp’s zero-tap terms.';
  const ttl = a.messageSendTtlSeconds;
  if (ttl !== null && (!Number.isInteger(ttl) || ttl < TTL_MIN || ttl > TTL_MAX)) {
    return `Message validity must be a whole number of seconds from ${TTL_MIN} to ${TTL_MAX} (15 minutes).`;
  }
  return '';
}

/** The settings as the server expects them (blank app rows dropped). */
export function authForSubmit(a: TemplateAuth): TemplateAuth {
  return {
    ...a,
    buttonText: a.buttonText.trim(),
    autofillText: a.otpType === 'COPY_CODE' ? '' : a.autofillText.trim(),
    supportedApps:
      a.otpType === 'COPY_CODE'
        ? []
        : a.supportedApps
            .map((x) => ({ packageName: x.packageName.trim(), signatureHash: x.signatureHash.trim() }))
            .filter((x) => x.packageName || x.signatureHash),
    zeroTapTermsAccepted: a.otpType === 'ZERO_TAP' && a.zeroTapTermsAccepted,
  };
}

/** A random 6-digit code. */
export function generateOtp(length = 6): string {
  const n = Math.max(4, Math.min(8, length));
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(buf[0] % 10 ** n).padStart(n, '0');
}

/** Why this code can't be sent ('' when it can). */
export function otpProblem(code: string): string {
  const c = code.trim();
  if (!c) return 'Enter the code, or tap Generate.';
  if (c.length > OTP_MAX_LENGTH || /\s/.test(c)) return `The code can be at most ${OTP_MAX_LENGTH} characters, with no spaces.`;
  return '';
}

/** The body as the customer reads it, with the code filled in. */
export function authBodyWithCode(t: TemplateItem, code: string): string {
  const body =
    t.components?.find((c) => c.type === 'BODY')?.text || t.bodyText || authBodyText(authFromTemplate(t));
  return body.replace(/\{\{\s*1\s*\}\}/g, code);
}
