// Settings → Manage Notifications: which events give a desktop nudge and a
// sound in this browser, and the sound itself. The rows come from
// crm/notifyPrefs.ts (one per kind of CRM notification). Desktop nudges also
// arrive when the CRM is closed, through Web Push (crm/push.ts).
import { useEffect, useState } from 'react';
import type { CrmApi } from '../api';
import { PREF_SECTIONS, SOUNDS, loadPrefs, playSound, savePrefs, type NotifyPrefs, type SoundType } from '../notifyPrefs';
import { askPermission, pushSupported, syncPush, type PushState } from '../push';
import { useNotify } from './Dialogs';

const TICK = (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M3.5 8.5L6.5 11.5L12.5 4.5" stroke="#ffffff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

function Switch({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} title={label} className={`mn-switch ${on ? 'checked' : ''}`} onClick={onClick}>
      <span className="mn-switch-handle" />
    </button>
  );
}

function Check({ on, muted, onClick, label }: { on: boolean; muted: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      aria-label={label}
      title={muted ? `${label} (switched off above)` : label}
      className={`mn-checkbox ${on ? 'checked' : ''}${muted ? ' muted' : ''}`}
      onClick={onClick}
    >
      {on && TICK}
    </button>
  );
}

/** What the desktop line under the switches says, per state. */
const PUSH_TEXT: Record<PushState, string> = {
  on: 'Desktop notifications are on for this browser. They also arrive when the CRM is closed, as long as the browser is running.',
  off: 'Desktop nudges are switched off for this browser.',
  ask: 'Allow notifications in this browser to get desktop nudges, also when the CRM is closed.',
  blocked: 'This browser blocks notifications for this site. Allow them in the browser’s site settings (the lock icon next to the address), then reload.',
  unsupported: 'This browser can’t show notifications while the CRM is closed. You still get them while a CRM tab is open.',
  unavailable: 'Desktop nudges show while a CRM tab is open. Notifications with the CRM closed aren’t set up on the server yet.',
  error: 'Desktop notifications couldn’t be set up. Reload the page and try again.',
};

export function ManageNotifications({ api, demo = false }: { api: CrmApi; demo?: boolean }) {
  const toast = useNotify();
  const [prefs, setPrefs] = useState<NotifyPrefs>(() => loadPrefs());
  const [push, setPush] = useState<PushState | ''>('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (demo) {
      setPush('unavailable');
      return;
    }
    let alive = true;
    syncPush(api, prefs).then((s) => alive && setPush(s));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, demo]);

  const update = (next: NotifyPrefs) => {
    setPrefs(next);
    savePrefs(next); // the shell syncs this browser's push choices
  };
  const setEvent = (key: string, kind: 'desktop' | 'sound') =>
    update({ ...prefs, events: { ...prefs.events, [key]: { ...prefs.events[key], [kind]: !prefs.events[key]?.[kind] } } });

  async function toggleDesktop() {
    const next = { ...prefs, allowDesktop: !prefs.allowDesktop };
    update(next);
    if (demo) return;
    // Turning it on from a click is when the browser may ask for permission.
    if (next.allowDesktop && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      setBusy(true);
      setPush(await askPermission(api));
      setBusy(false);
      return;
    }
    // The shell updates the subscription; read the outcome for the line below.
    setTimeout(() => {
      syncPush(api, next).then(setPush);
    }, 300);
  }

  async function turnOn() {
    setBusy(true);
    const s = await askPermission(api);
    setPush(s);
    setBusy(false);
    if (s === 'on') toast('success', 'Desktop notifications are on', 'You’ll get them even when the CRM is closed.');
  }

  async function sendTest() {
    setBusy(true);
    try {
      const r = await api.pushTest();
      toast(r.sent ? 'success' : 'error', r.sent ? 'Test sent' : 'Nothing was sent', r.sent
        ? 'It shows on your desktop when no CRM tab is in front. Switch to another window to see it.'
        : 'No browser is subscribed yet. Turn on Desktop Nudge first.');
    } catch (e) {
      toast('error', 'Test not sent', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const pickSound = (id: SoundType) => {
    update({ ...prefs, soundType: id });
    playSound(id);
  };

  return (
    <div className="mn-container" data-testid="manage-notifications">
      <div className="mn-header-row">
        <h2 className="mn-title">Manage Notifications</h2>
        <div className="mn-col-headers">
          <span className="mn-col-header desktop">Desktop Nudge</span>
          <span className="mn-col-header sound">Sound</span>
        </div>
      </div>

      <div className="mn-card mn-allow-card">
        <span className="mn-row-label">Allow Notifications</span>
        <div className="mn-controls">
          <div className="mn-control-cell desktop">
            <Switch on={prefs.allowDesktop} onClick={toggleDesktop} label="Desktop Nudge" />
          </div>
          <div className="mn-control-cell sound">
            <Switch on={prefs.allowSound} onClick={() => update({ ...prefs, allowSound: !prefs.allowSound })} label="Sound" />
          </div>
        </div>
      </div>

      {push && (
        <div className={`mn-push-status ${push}`} data-testid="mn-push-status" data-state={push}>
          <span className="material-icons" aria-hidden="true">
            {push === 'on' ? 'notifications_active' : push === 'blocked' || push === 'error' ? 'notifications_off' : 'notifications'}
          </span>
          <span className="mn-push-text">{PUSH_TEXT[push]}</span>
          {push === 'ask' && pushSupported() && (
            <button type="button" className="k-btn sm" onClick={turnOn} disabled={busy} data-testid="mn-push-on">
              {busy ? 'Waiting…' : 'Allow'}
            </button>
          )}
          {push === 'on' && (
            <button type="button" className="k-btn ghost sm" onClick={sendTest} disabled={busy} data-testid="mn-push-test">
              {busy ? 'Sending…' : 'Send a test'}
            </button>
          )}
        </div>
      )}

      {PREF_SECTIONS.map((section) => (
        <div className="mn-section" key={section.title}>
          <h3 className="mn-section-heading">{section.title}</h3>
          <div className="mn-card mn-group-card">
            {section.rows.map((row) => {
              const ev = prefs.events[row.key] || { desktop: true, sound: true };
              return (
                <div className="mn-card-row" key={row.key} data-testid={`mn-row-${row.key}`}>
                  <span className="mn-row-label">{row.label}</span>
                  <div className="mn-controls">
                    <div className="mn-control-cell desktop">
                      <Check on={ev.desktop} muted={!prefs.allowDesktop} onClick={() => setEvent(row.key, 'desktop')} label={`Desktop Nudge: ${row.label}`} />
                    </div>
                    <div className="mn-control-cell sound">
                      <Check on={ev.sound} muted={!prefs.allowSound} onClick={() => setEvent(row.key, 'sound')} label={`Sound: ${row.label}`} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <div className="mn-section">
        <h3 className="mn-section-heading">Notification Sound</h3>
        <div className="mn-sound-list" role="radiogroup" aria-label="Notification sound">
          {SOUNDS.map((item) => {
            const isSelected = prefs.soundType === item.id;
            return (
              <div
                key={item.id}
                className="mn-radio-row"
                role="radio"
                aria-checked={isSelected}
                tabIndex={0}
                onClick={() => pickSound(item.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    pickSound(item.id);
                  }
                }}
              >
                <span className={`mn-radio-circle ${isSelected ? 'selected' : ''}`}>{isSelected && <span className="mn-radio-dot" />}</span>
                <span className="mn-radio-label">{item.label}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
