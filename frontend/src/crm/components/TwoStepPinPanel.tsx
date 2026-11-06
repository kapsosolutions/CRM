// Channel Status → Two-step verification: set or change the 6-digit PIN of
// the business's own number (POST /api/channel/two-step-pin → Meta).
//
// Meta asks for this PIN whenever the number is registered with the Cloud API
// again (another provider, a re-activation), so it protects the number from
// being moved. Setting it replaces the old PIN; Meta doesn't need the old one.
// The new PIN is typed twice, sent to the server once and never shown again.
import { useId, useState } from 'react';
import type { CrmApi } from '../api';
import type { ActivationFailure, TwoStepPinResult } from '../types';
import { useConfirm, useNotify } from './Dialogs';

interface Props {
  api: CrmApi;
  /** e.g. "+91 98765 43210" */
  displayPhone: string;
  /** A PIN is stored on the server for this number (never the PIN itself). */
  hasSavedPin: boolean;
  /** When the PIN was last set from here (ISO). */
  pinSetAt?: string | null;
  /** Still reading the status from Meta. */
  loading?: boolean;
  onSaved: (r: TwoStepPinResult) => void;
}

const failureFrom = (e: unknown): ActivationFailure => {
  const data = (e as { data?: Partial<ActivationFailure> })?.data || {};
  return {
    code: data.code || 'PIN_CHANGE_FAILED',
    message: data.message || (e instanceof Error ? e.message : 'Setting the PIN failed.'),
    metaCode: data.metaCode ?? null,
    metaMessage: data.metaMessage || '',
  };
};

const when = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(+d) ? '' : d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
};

export function TwoStepPinPanel({ api, displayPhone, hasSavedPin, pinSetAt, loading, onSaved }: Props) {
  const notify = useNotify();
  const confirm = useConfirm();
  const pinId = useId();
  const [pin, setPin] = useState('');
  const [again, setAgain] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ActivationFailure | null>(null);
  const [done, setDone] = useState('');

  const pinOk = /^\d{6}$/.test(pin);
  const matches = pinOk && again === pin;
  const canSubmit = !busy && matches;
  const setText = when(pinSetAt);
  const number = displayPhone || 'this number';

  async function save() {
    if (!canSubmit) return;
    if (hasSavedPin) {
      const ok = await confirm({
        title: 'Change the two-step verification PIN?',
        message: `The new PIN replaces the current one on ${number}. The old PIN stops working, including anywhere you wrote it down.`,
        confirmLabel: 'Change PIN',
        tone: 'primary',
      });
      if (!ok) return;
    }
    setBusy(true);
    setFailure(null);
    setDone('');
    try {
      const r = await api.setTwoStepPin(pin);
      setPin('');
      setAgain('');
      setShow(false);
      setDone(r.message);
      notify('success', hasSavedPin ? 'PIN changed' : 'PIN set', `${number} now uses the new two-step verification PIN.`);
      onSaved(r);
    } catch (e) {
      const f = failureFrom(e);
      setFailure(f);
      notify('error', 'Could not set the PIN', f.message);
    } finally {
      setBusy(false);
    }
  }

  const digitsOnly = (v: string) => v.replace(/\D/g, '').slice(0, 6);

  return (
    <div className="cs-two-col-layout">
      <div className="cs-left-content">
        <div className="cs-white-panel" data-testid="cs-two-step">
          <div className="cs-qr-head-row">
            <span className="cs-qr-label">Two-step verification PIN :</span>
            <span className={`cs-quality-pill ${loading ? 'grey' : hasSavedPin ? 'green' : 'amber'}`} data-testid="cs-two-step-state">
              {loading ? 'Checking…' : hasSavedPin ? 'PIN saved' : 'No PIN saved'}
            </span>
          </div>

          <p className="cs-qr-intro">
            Meta asks for this 6-digit PIN whenever <strong>{number}</strong> is registered with WhatsApp again, for example
            when it moves to another provider. Without the PIN, nobody can move your number.
          </p>
          <p className="cs-qr-intro" data-testid="cs-two-step-saved">
            {hasSavedPin
              ? `A PIN is saved in Kapso for this number${setText ? ` (set on ${setText})` : ''}. For your security it is never shown.`
              : 'Kapso has no PIN saved for this number. Set one here so the number can be re-activated later without asking you.'}
          </p>

          <div className="cs-activate-pin">
            <div className="cs-activate-pin-title">{hasSavedPin ? 'Change the PIN' : 'Set a PIN'}</div>
            <div className="cs-activate-input-row">
              <label htmlFor={`${pinId}-new`} className="cs-activate-label cs-two-step-label">New PIN</label>
              <input
                id={`${pinId}-new`}
                className="cs-activate-input"
                type={show ? 'text' : 'password'}
                inputMode="numeric"
                autoComplete="new-password"
                maxLength={6}
                placeholder="••••••"
                value={pin}
                disabled={busy}
                onChange={(e) => setPin(digitsOnly(e.target.value))}
                data-testid="cs-two-step-pin"
              />
              <button type="button" className="cs-refresh-link" onClick={() => setShow((v) => !v)}>
                {show ? 'Hide' : 'Show'}
              </button>
            </div>
            <div className="cs-activate-input-row">
              <label htmlFor={`${pinId}-again`} className="cs-activate-label cs-two-step-label">Confirm PIN</label>
              <input
                id={`${pinId}-again`}
                className="cs-activate-input"
                type={show ? 'text' : 'password'}
                inputMode="numeric"
                autoComplete="new-password"
                maxLength={6}
                placeholder="••••••"
                value={again}
                disabled={busy}
                onChange={(e) => setAgain(digitsOnly(e.target.value))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void save();
                }}
                data-testid="cs-two-step-again"
              />
              {pin.length > 0 && !pinOk && <span className="cs-activate-hint">Enter all 6 digits.</span>}
              {pinOk && again.length === 6 && !matches && <span className="cs-activate-hint" data-testid="cs-two-step-mismatch">The PINs don&apos;t match.</span>}
            </div>
          </div>

          {failure && (
            <div className="cs-activate-error" role="alert" data-code={failure.code} data-testid="cs-two-step-error">
              <strong>The PIN wasn&apos;t set</strong>
              <p>{failure.message}</p>
              {failure.metaMessage && (
                <p className="cs-activate-meta">
                  Meta said: “{failure.metaMessage}”{failure.metaCode ? ` (code ${failure.metaCode})` : ''}
                </p>
              )}
            </div>
          )}
          {done && <p className="cs-activate-ok" role="status" data-testid="cs-two-step-done">{done}</p>}

          <div className="cs-activate-actions">
            <button type="button" className="cs-activate-btn" disabled={!canSubmit} onClick={() => void save()} data-testid="cs-two-step-save">
              {busy ? 'Saving with Meta…' : hasSavedPin ? 'Change PIN' : 'Set PIN'}
            </button>
            <span className="cs-activate-limit">Write the PIN down somewhere safe. Kapso never shows it again.</span>
          </div>
        </div>
      </div>

      <aside className="cs-tools-panel">
        <div className="cs-tools-header">
          <span>Tools & Tips</span>
        </div>
        <ul className="cs-tools-bullets" style={{ marginTop: 14 }}>
          <li>
            <span className="cs-bullet-green">•</span>
            <span>Pick a PIN that is hard to guess: not 123456, 000000 or a date of birth.</span>
          </li>
          <li>
            <span className="cs-bullet-green">•</span>
            <span>You don&apos;t need the old PIN to change it here. Changing it replaces the old PIN straight away.</span>
          </li>
          <li>
            <span className="cs-bullet-green">•</span>
            <span>Meta has no way to turn the PIN off, only to change it.</span>
          </li>
          <li>
            <span className="cs-bullet-green">•</span>
            <span>
              Meta is retiring the PIN for some numbers. If WhatsApp Manager no longer shows Two-step verification for your
              number, it doesn&apos;t need one and Meta may refuse the change.
            </span>
          </li>
        </ul>
      </aside>
    </div>
  );
}
