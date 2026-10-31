// Authentication (one-time code) template settings, shown in the template
// composer in place of header / body / footer / buttons. Meta writes the
// message text itself; the business only picks the optional lines and how the
// code reaches the customer.
import type { OtpType, TemplateAuth } from '../types';
import { MAX_APPS, OTP_TYPE_LABEL, TTL_MAX, TTL_MIN } from '../authTemplate';
import './AuthTemplate.css';

interface Props {
  value: TemplateAuth;
  onChange: (next: TemplateAuth) => void;
  readOnly?: boolean;
}

const OTP_CHOICES: { value: OtpType; icon: string; hint: string }[] = [
  { value: 'COPY_CODE', icon: 'content_copy', hint: 'A button copies the code to paste in your app' },
  { value: 'ONE_TAP', icon: 'touch_app', hint: 'Android: one tap fills the code in your app' },
  { value: 'ZERO_TAP', icon: 'bolt', hint: 'Android: the code reaches your app with no tap' },
];

/** A number input's text → a whole number, or null when empty. */
const numOrNull = (s: string): number | null => (s.trim() === '' ? null : Number(s));

export function AuthTemplateFields({ value, onChange, readOnly }: Props) {
  const set = (patch: Partial<TemplateAuth>) => onChange({ ...value, ...patch });
  const appBased = value.otpType === 'ONE_TAP' || value.otpType === 'ZERO_TAP';
  const apps = value.supportedApps.length ? value.supportedApps : [{ packageName: '', signatureHash: '' }];
  const setApp = (i: number, patch: Partial<TemplateAuth['supportedApps'][number]>) =>
    set({ supportedApps: apps.map((a, j) => (j === i ? { ...a, ...patch } : a)) });

  return (
    <div className="at-fields">
      <div className="at-note" role="note">
        <span className="material-icons">lock</span>
        <span>
          WhatsApp writes the message for authentication templates: <strong>“&lt;code&gt; is your verification code.”</strong>{' '}
          You can’t add your own text, media, links or emojis. Choose the optional lines and how the code is delivered.
        </span>
      </div>

      {/* ---- Code delivery ---- */}
      <div className="k-field">
        <label className="k-label">Code delivery</label>
        <div className="tc-opts" role="radiogroup" aria-label="Code delivery">
          {OTP_CHOICES.map((o) => {
            const on = value.otpType === o.value;
            return (
              <button
                type="button"
                role="radio"
                aria-checked={on}
                key={o.value}
                className={`tc-opt has-hint${on ? ' on' : ''}`}
                title={o.hint}
                onClick={() => set({ otpType: o.value })}
              >
                <span className="material-icons">{o.icon}</span>
                <span className="tc-opt-text">
                  <span className="tc-opt-label">{OTP_TYPE_LABEL[o.value]}</span>
                  <span className="tc-opt-hint">{o.hint}</span>
                </span>
              </button>
            );
          })}
        </div>
        {appBased && (
          <p className="k-hint">
            On iPhone, or when your app can’t take the code, WhatsApp shows a “Copy code” button instead.
          </p>
        )}
      </div>

      {/* ---- Optional lines ---- */}
      <div className="k-field tc-section">
        <label className="k-label">Message content</label>
        <label className="tc-check">
          <input
            type="checkbox"
            checked={value.addSecurityRecommendation}
            onChange={(e) => set({ addSecurityRecommendation: e.target.checked })}
            aria-label="Add security recommendation"
          />
          <span>Add security recommendation <span className="at-soft">(“For your security, do not share this code.”)</span></span>
        </label>
        <label className="tc-check">
          <input
            type="checkbox"
            checked={value.codeExpirationMinutes !== null}
            onChange={(e) => set({ codeExpirationMinutes: e.target.checked ? 10 : null })}
            aria-label="Add code expiry"
          />
          <span>Add code expiry</span>
        </label>
        {value.codeExpirationMinutes !== null && (
          <div className="at-inline">
            <span>Code expires in</span>
            <input
              className="k-input at-num"
              type="number"
              min={1}
              max={90}
              step={1}
              value={Number.isNaN(value.codeExpirationMinutes) ? '' : String(value.codeExpirationMinutes)}
              onChange={(e) => set({ codeExpirationMinutes: numOrNull(e.target.value) ?? Number.NaN })}
              aria-label="Code expiry in minutes"
            />
            <span>minutes (1–90)</span>
          </div>
        )}
      </div>

      {/* ---- Buttons ---- */}
      <div className="k-field tc-section">
        <label className="k-label">Button text <span className="k-label-soft">(optional)</span></label>
        <div className={appBased ? 'two' : ''}>
          <div>
            <label className="k-label sm" htmlFor="at-copy-text">
              {appBased ? '“Copy code” fallback' : '“Copy code” button'}
            </label>
            <input
              id="at-copy-text"
              className="k-input"
              maxLength={25}
              value={value.buttonText}
              placeholder="Copy code"
              onChange={(e) => set({ buttonText: e.target.value })}
            />
          </div>
          {appBased && (
            <div>
              <label className="k-label sm" htmlFor="at-autofill-text">Autofill button</label>
              <input
                id="at-autofill-text"
                className="k-input"
                maxLength={25}
                value={value.autofillText}
                placeholder="Autofill"
                onChange={(e) => set({ autofillText: e.target.value })}
              />
            </div>
          )}
        </div>
        <p className="k-hint">Up to 25 characters. Leave blank for WhatsApp’s default, translated to the template language.</p>
      </div>

      {/* ---- Android apps (one-tap / zero-tap) ---- */}
      {appBased && (
        <div className="k-field tc-section">
          <label className="k-label">Android app</label>
          <p className="k-hint">
            The app that receives the code: its package name and its 11-character app signing key hash. Add up to{' '}
            {MAX_APPS} builds.
          </p>
          {apps.map((a, i) => (
            <div className="at-app" key={i}>
              <input
                className="k-input"
                value={a.packageName}
                maxLength={224}
                placeholder="com.example.app"
                onChange={(e) => setApp(i, { packageName: e.target.value.trim() })}
                aria-label={`App ${i + 1} package name`}
              />
              <input
                className="k-input at-hash"
                value={a.signatureHash}
                maxLength={11}
                placeholder="K8a/AINcGX7"
                onChange={(e) => setApp(i, { signatureHash: e.target.value.trim() })}
                aria-label={`App ${i + 1} signature hash`}
              />
              {apps.length > 1 && !readOnly && (
                <button
                  type="button"
                  className="ic-del"
                  onClick={() => set({ supportedApps: apps.filter((_, j) => j !== i) })}
                  aria-label={`Remove app ${i + 1}`}
                >
                  <span className="material-icons">close</span>
                </button>
              )}
            </div>
          ))}
          {apps.length < MAX_APPS && !readOnly && (
            <button
              type="button"
              className="k-btn ghost sm"
              onClick={() => set({ supportedApps: [...apps, { packageName: '', signatureHash: '' }] })}
            >
              <span className="material-icons">add</span> Add another app
            </button>
          )}
        </div>
      )}

      {value.otpType === 'ZERO_TAP' && (
        <label className="tc-check at-terms">
          <input
            type="checkbox"
            checked={value.zeroTapTermsAccepted}
            onChange={(e) => set({ zeroTapTermsAccepted: e.target.checked })}
            aria-label="Accept zero-tap terms"
          />
          <span>
            I understand that zero-tap is subject to the WhatsApp Business Terms of Service, and that my customers must
            expect the code to be filled in automatically when they choose WhatsApp.
          </span>
        </label>
      )}

      {/* ---- Delivery window ---- */}
      <div className="k-field tc-section">
        <label className="tc-check">
          <input
            type="checkbox"
            checked={value.messageSendTtlSeconds !== null}
            onChange={(e) => set({ messageSendTtlSeconds: e.target.checked ? 600 : null })}
            aria-label="Set message validity"
          />
          <span>Set message validity</span>
        </label>
        {value.messageSendTtlSeconds !== null && (
          <div className="at-inline">
            <span>Stop trying to deliver after</span>
            <input
              className="k-input at-num"
              type="number"
              min={TTL_MIN}
              max={TTL_MAX}
              step={1}
              value={Number.isNaN(value.messageSendTtlSeconds) ? '' : String(value.messageSendTtlSeconds)}
              onChange={(e) => set({ messageSendTtlSeconds: numOrNull(e.target.value) ?? Number.NaN })}
              aria-label="Message validity in seconds"
            />
            <span>seconds ({TTL_MIN}–{TTL_MAX})</span>
          </div>
        )}
        <p className="k-hint">
          If the phone is offline, WhatsApp keeps trying for this long (10 minutes when not set), so a late code isn’t
          delivered after it has expired.
        </p>
      </div>
    </div>
  );
}
