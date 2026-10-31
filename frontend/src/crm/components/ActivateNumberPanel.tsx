// "Pending — activate this number" (Channel Status → Connect Account).
//
// A number Meta lists as Pending is in the WhatsApp Business Account but not
// registered with the Cloud API, so it can't send or receive. Activating
// registers it (POST /api/channel/activate → Meta's /register) with the
// number's 6-digit two-step verification PIN: the one it already has, or a
// new one to set. The PIN goes to the server once and is never shown again.
import { useEffect, useId, useState } from 'react';
import type { CrmApi } from '../api';
import type { ActivationFailure, ActivationResult } from '../types';
import { useNotify } from './Dialogs';
import { numberStatusLabel } from '../numberStatus';

interface Props {
  api: CrmApi;
  /** e.g. "+91 98765 43210" */
  displayPhone: string;
  /** Meta's status (PENDING, DISCONNECTED, …). */
  status: string;
  codeVerificationStatus?: string;
  /** A PIN is stored on the server (from signup or an earlier activation). */
  hasSavedPin: boolean;
  /** Why Embedded Signup's automatic activation failed, if it did. */
  signupError?: ActivationFailure | null;
  demo?: boolean;
  onActivated: (r: ActivationResult) => void;
}

const failureFrom = (e: unknown): ActivationFailure => {
  const data = (e as { data?: Partial<ActivationFailure> })?.data || {};
  return {
    code: data.code || 'ACTIVATION_FAILED',
    message: data.message || (e instanceof Error ? e.message : 'Activating the number failed.'),
    metaCode: data.metaCode ?? null,
    metaMessage: data.metaMessage || '',
  };
};

function FailureBox({ f, heading }: { f: ActivationFailure; heading: string }) {
  return (
    <div className="cs-activate-error" role="alert" data-code={f.code}>
      <strong>{heading}</strong>
      <p>{f.message}</p>
      {f.metaMessage && (
        <p className="cs-activate-meta">
          Meta said: “{f.metaMessage}”{f.metaCode ? ` (code ${f.metaCode})` : ''}
        </p>
      )}
    </div>
  );
}

export function ActivateNumberPanel({
  api,
  displayPhone,
  status,
  codeVerificationStatus,
  hasSavedPin,
  signupError,
  demo,
  onActivated,
}: Props) {
  const notify = useNotify();
  const pinId = useId();
  const [mode, setMode] = useState<'saved' | 'enter'>(hasSavedPin ? 'saved' : 'enter');
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ActivationFailure | null>(null);
  const [accepted, setAccepted] = useState('');

  useEffect(() => {
    if (!hasSavedPin) setMode('enter');
  }, [hasSavedPin]);

  const useSaved = mode === 'saved' && hasSavedPin;
  const pinOk = /^\d{6}$/.test(pin);
  const canSubmit = !busy && !demo && (useSaved || pinOk);
  const unverified = String(status).toUpperCase() === 'UNVERIFIED'
    || ['NOT_VERIFIED'].includes(String(codeVerificationStatus || '').toUpperCase());

  async function activate() {
    if (!canSubmit) return;
    setBusy(true);
    setFailure(null);
    setAccepted('');
    try {
      const r = await api.activateNumber(useSaved ? { useSavedPin: true } : { pin });
      setPin('');
      if (r.connected) {
        notify('success', 'WhatsApp number connected', `${displayPhone || 'Your number'} can now send and receive messages.`);
      } else {
        setAccepted(r.message);
        notify('success', 'Activation accepted', r.message);
      }
      if (r.webhook && !r.webhook.ok) {
        notify('error', 'Messages may not arrive yet', `The webhook subscription could not be renewed: ${r.webhook.reason || 'unknown error'}`);
      }
      onActivated(r);
    } catch (e) {
      const f = failureFrom(e);
      setFailure(f);
      notify('error', 'Could not activate the number', f.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cs-activate-card" data-testid="cs-activate">
      <div className="cs-activate-head">
        <span className="cs-quality-pill amber">{numberStatusLabel(status) || 'Pending'}</span>
        <h2 className="cs-activate-title">Pending — activate this number</h2>
      </div>
      <p className="cs-activate-text">
        Meta lists <strong>{displayPhone || 'this number'}</strong> as {numberStatusLabel(status) || 'Pending'}. It is in your
        WhatsApp Business Account but isn&apos;t registered with the WhatsApp Cloud API yet, so it can&apos;t send or receive
        messages. Activating it registers the number; it then shows as Connected.
      </p>

      {signupError && !failure && !accepted && (
        <FailureBox f={signupError} heading="Automatic activation during WhatsApp signup didn't work" />
      )}

      {unverified && (
        <p className="cs-activate-note">
          Meta also reports this number as not verified. Verify it with the SMS or voice code in WhatsApp Manager first,
          otherwise activation is refused.
        </p>
      )}

      <div className="cs-activate-pin">
        <div className="cs-activate-pin-title">Two-step verification PIN (6 digits)</div>
        <p className="cs-activate-help">
          If this number already has a two-step verification PIN (set in WhatsApp Manager, the WhatsApp Business app or by
          a previous provider), enter that PIN. If it has none, choose a new 6-digit PIN: activating sets it as the
          number&apos;s PIN. The CRM keeps it on the server so the number can be re-activated later; it is never shown again.
        </p>

        {hasSavedPin && (
          <div className="cs-activate-choice" role="radiogroup" aria-label="Which PIN to use">
            <label>
              <input type="radio" name={`${pinId}-mode`} checked={mode === 'saved'} onChange={() => setMode('saved')} />
              <span>Use the PIN saved in the CRM for this number</span>
            </label>
            <label>
              <input type="radio" name={`${pinId}-mode`} checked={mode === 'enter'} onChange={() => setMode('enter')} />
              <span>Enter a PIN</span>
            </label>
          </div>
        )}

        {!useSaved && (
          <div className="cs-activate-input-row">
            <label htmlFor={pinId} className="cs-activate-label">PIN</label>
            <input
              id={pinId}
              className="cs-activate-input"
              type={showPin ? 'text' : 'password'}
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              placeholder="••••••"
              value={pin}
              disabled={busy}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void activate();
              }}
              data-testid="cs-activate-pin"
            />
            <button type="button" className="cs-refresh-link" onClick={() => setShowPin((v) => !v)}>
              {showPin ? 'Hide' : 'Show'}
            </button>
            {pin.length > 0 && !pinOk && <span className="cs-activate-hint">Enter all 6 digits.</span>}
          </div>
        )}
      </div>

      {failure && <FailureBox f={failure} heading="Activation failed" />}
      {accepted && <p className="cs-activate-ok" role="status">{accepted}</p>}

      <div className="cs-activate-actions">
        <button
          type="button"
          className="cs-activate-btn"
          disabled={!canSubmit}
          onClick={() => void activate()}
          data-testid="cs-activate-btn"
        >
          {busy ? 'Activating… checking with Meta' : 'Activate number'}
        </button>
        <span className="cs-activate-limit">Meta allows up to 10 activation attempts per number every 72 hours.</span>
      </div>
      {demo && <p className="cs-activate-note">Activation isn&apos;t available in the demo.</p>}
    </div>
  );
}

/** A non-connected number that activation can't fix (FLAGGED, RESTRICTED, …), or a status Meta didn't give. */
export function NumberStateCard({
  displayPhone,
  status,
  loading,
  error,
}: {
  displayPhone: string;
  status: string;
  loading: boolean;
  error?: string;
}) {
  const label = numberStatusLabel(status);
  return (
    <div className="cs-activate-card" data-testid="cs-number-state">
      <div className="cs-activate-head">
        {label && <span className={`cs-quality-pill ${['RESTRICTED', 'BANNED', 'DISCONNECTED', 'DELETED'].includes(status.toUpperCase()) ? 'red' : 'amber'}`}>{label}</span>}
        <h2 className="cs-activate-title">
          {loading ? 'Checking this number with Meta…' : label ? `This number is ${label}` : "This number's status is unavailable"}
        </h2>
      </div>
      <p className="cs-activate-text">
        {loading
          ? 'Reading the live status of your number from Meta.'
          : label
          ? `Meta reports ${displayPhone || 'this number'} as ${label}, so it may not be able to send messages. Open WhatsApp Manager in Meta Business Suite to see why and what to do.`
          : `Meta's status for ${displayPhone || 'this number'} couldn't be read${error ? ` (${error})` : ''}. Use Refresh to try again.`}
      </p>
    </div>
  );
}
