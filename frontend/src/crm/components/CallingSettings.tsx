// Channel Status → WhatsApp → Calling: the number's calling settings at Meta
// (backend routes/calls.js), and what calling can and can't do yet.
//
// Edits stay on the page until "Save to WhatsApp", like the business profile.
// Meta needs a messaging limit of 2,000 before it lets a number take calls.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CrmApi } from '../api';
import type { CallHoursRange, CallSettings, CallSettingsUpdate } from '../types';
import { useNotify } from './Dialogs';
import { SoonPill } from './ComingSoon';
import './CallingSettings.css';

const DAYS: { key: CallHoursRange['day']; label: string }[] = [
  { key: 'MONDAY', label: 'Monday' },
  { key: 'TUESDAY', label: 'Tuesday' },
  { key: 'WEDNESDAY', label: 'Wednesday' },
  { key: 'THURSDAY', label: 'Thursday' },
  { key: 'FRIDAY', label: 'Friday' },
  { key: 'SATURDAY', label: 'Saturday' },
  { key: 'SUNDAY', label: 'Sunday' },
];

const COMMON_ZONES = ['Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'America/New_York', 'UTC'];

function zones(current: string): string[] {
  let all: string[] = [];
  try {
    all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') || [];
  } catch {
    all = [];
  }
  const list = [...new Set([current, ...COMMON_ZONES, ...all].filter(Boolean))];
  return list;
}

/** A plain on/off switch. */
function Switch({ on, onChange, disabled, label, testId }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string; testId?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`cl-switch${on ? ' on' : ''}`}
      onClick={() => !disabled && onChange(!on)}
      disabled={disabled}
      data-testid={testId}
    >
      <span className="cl-knob" />
    </button>
  );
}

const EMPTY_HOURS: CallSettings['callHours'] = {
  enabled: false,
  timezone: 'Asia/Kolkata',
  weekly: DAYS.slice(0, 6).map((d) => ({ day: d.key, open: '09:00', close: '18:00' })),
  holidays: [],
};

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

interface Props {
  api: CrmApi;
  /** The number's messaging limit (Channel Status), null while unknown. */
  limit: { limit: number | null; unlimited: boolean; label: string } | null;
}

export function CallingSettings({ api, limit }: Props) {
  const notify = useNotify();
  const [saved, setSaved] = useState<CallSettings | null>(null);
  const [form, setForm] = useState<CallSettings | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'unconnected'>('loading');
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const adopt = (s: CallSettings) => {
    // Hours never set up: start from Mon–Sat 9–6, so turning them on has something to edit.
    const withHours = s.callHours.weekly.length ? s : { ...s, callHours: { ...EMPTY_HOURS, ...s.callHours, weekly: EMPTY_HOURS.weekly } };
    setSaved(withHours);
    setForm(withHours);
  };

  const load = useCallback((refresh = false) => {
    setState((s) => (s === 'ready' ? s : 'loading'));
    api.getCallSettings(refresh)
      .then((r) => {
        if (!r.connected || !r.settings) {
          setState('unconnected');
          return;
        }
        adopt(r.settings);
        setState('ready');
      })
      .catch((e: Error) => {
        setLoadError(e.message || 'Couldn’t read the calling settings from Meta.');
        setState('error');
      });
  }, [api]);
  useEffect(() => load(), [load]);

  const tooLow = !!limit && !limit.unlimited && limit.limit != null && limit.limit < 2000;
  const dirty = !!saved && !!form && !same(saved, form);
  const tzList = useMemo(() => zones(form?.callHours.timezone || 'Asia/Kolkata'), [form?.callHours.timezone]);

  const set = (patch: Partial<CallSettings>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const setHours = (patch: Partial<CallSettings['callHours']>) => setForm((f) => (f ? { ...f, callHours: { ...f.callHours, ...patch } } : f));
  const rangesOf = (day: CallHoursRange['day']) => (form?.callHours.weekly || []).filter((w) => w.day === day);
  const setDay = (day: CallHoursRange['day'], ranges: Omit<CallHoursRange, 'day'>[]) => {
    if (!form) return;
    const rest = form.callHours.weekly.filter((w) => w.day !== day);
    const next = [...rest, ...ranges.map((r) => ({ day, ...r }))];
    next.sort((a, b) => DAYS.findIndex((d) => d.key === a.day) - DAYS.findIndex((d) => d.key === b.day) || a.open.localeCompare(b.open));
    setHours({ weekly: next });
  };

  async function save() {
    if (!form || !saved || saving) return;
    const body: CallSettingsUpdate = {};
    if (form.enabled !== saved.enabled) body.enabled = form.enabled;
    if (form.showCallButton !== saved.showCallButton) body.showCallButton = form.showCallButton;
    if (form.callbackPermission !== saved.callbackPermission) body.callbackPermission = form.callbackPermission;
    if (!same(form.callHours, saved.callHours)) body.callHours = form.callHours;
    setSaving(true);
    setSaveError('');
    try {
      const r = await api.saveCallSettings(body);
      adopt(r.settings);
      notify('success', 'Calling settings saved', 'WhatsApp may take a while to show the change to customers.');
    } catch (e) {
      setSaveError((e as Error).message || 'Meta didn’t accept the change.');
    } finally {
      setSaving(false);
    }
  }

  if (state === 'loading') return <div className="cl-loading" data-testid="calling-loading">Reading calling settings from Meta…</div>;
  if (state === 'unconnected') {
    return <div className="cl-alert">Connect your own WhatsApp number to use calling. The shared test number can’t make or take calls.</div>;
  }
  if (state === 'error' || !form) {
    return (
      <div className="cl-alert" role="alert">
        <span>Couldn’t read the calling settings: {loadError}</span>
        <button type="button" className="cl-btn ghost" onClick={() => load(true)}>Try again</button>
      </div>
    );
  }

  const restrictions = form.restrictions || [];
  return (
    <div className="cs-two-col-layout" data-testid="calling-settings">
      <div className="cs-left-content cl-left">
        {tooLow && (
          <div className="cl-warn" role="status" data-testid="calling-limit-warn">
            WhatsApp calling needs a messaging limit of at least 2,000 customers a day. This number’s limit is {limit?.label}, so Meta
            won’t switch calling on yet. The limit goes up as you message more customers with good quality.
          </div>
        )}
        {restrictions.map((r) => (
          <div key={r.type} className="cl-alert" role="alert">
            <strong>{r.type.includes('BUSINESS') ? 'Calling customers is paused' : 'Customers can’t call you right now'}</strong>
            <span>
              {r.reason}
              {r.expiresAt ? ` Until ${new Date(r.expiresAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}.` : ''}
            </span>
          </div>
        ))}

        <div className="cs-white-panel cl-panel">
          <div className="cl-row main">
            <div className="cl-row-text">
              <strong>WhatsApp calling</strong>
              <span>Customers can call your WhatsApp number, and you can call customers who allowed it. Calls ring here in the CRM.</span>
            </div>
            <span className={`cl-state${saved?.enabled ? ' on' : ''}`} data-testid="calling-state" title="What WhatsApp has now">
              {saved?.enabled ? 'On' : 'Off'}{form.enabled !== saved?.enabled ? ' · not saved' : ''}
            </span>
            <Switch on={form.enabled} onChange={(v) => set({ enabled: v })} disabled={tooLow && !saved?.enabled} label="WhatsApp calling" testId="calling-toggle" />
          </div>

          <div className={`cl-sub${form.enabled ? '' : ' off'}`} aria-disabled={!form.enabled}>
            <div className="cl-row">
              <div className="cl-row-text">
                <strong>Show the call button</strong>
                <span>The phone icon in your chat and business profile. Turned off, customers can’t call you at all.</span>
              </div>
              <Switch on={form.showCallButton} onChange={(v) => set({ showCallButton: v })} disabled={!form.enabled} label="Show the call button" testId="calling-button-toggle" />
            </div>
            <div className="cl-row">
              <div className="cl-row-text">
                <strong>Ask callers if you can call back</strong>
                <span>After a customer calls you, WhatsApp asks them to allow calls from you, so you can call back a missed call.</span>
              </div>
              <Switch on={form.callbackPermission} onChange={(v) => set({ callbackPermission: v })} disabled={!form.enabled} label="Ask callers if you can call back" testId="calling-callback-toggle" />
            </div>

            <div className="cl-row">
              <div className="cl-row-text">
                <strong>Call hours</strong>
                <span>Outside these hours customers see that you’re closed and can message you{form.callbackPermission ? ' or ask for a call back' : ''}. Off means open 24/7.</span>
              </div>
              <Switch on={form.callHours.enabled} onChange={(v) => setHours({ enabled: v })} disabled={!form.enabled} label="Call hours" testId="calling-hours-toggle" />
            </div>

            {form.callHours.enabled && (
              <div className="cl-hours" data-testid="calling-hours">
                <label className="cl-field">
                  <span>Time zone</span>
                  <select value={form.callHours.timezone} onChange={(e) => setHours({ timezone: e.target.value })} disabled={!form.enabled}>
                    {tzList.map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
                  </select>
                </label>
                <div className="cl-days">
                  {DAYS.map((d) => {
                    const ranges = rangesOf(d.key);
                    const open = ranges.length > 0;
                    return (
                      <div className="cl-day" key={d.key} data-testid={`calling-day-${d.key}`}>
                        <label className="cl-day-name">
                          <input
                            type="checkbox"
                            checked={open}
                            disabled={!form.enabled}
                            onChange={(e) => setDay(d.key, e.target.checked ? [{ open: '09:00', close: '18:00' }] : [])}
                          />
                          {d.label}
                        </label>
                        {open ? (
                          <div className="cl-ranges">
                            {ranges.map((r, i) => (
                              <div className="cl-range" key={i}>
                                <input
                                  type="time"
                                  value={r.open}
                                  aria-label={`${d.label} opens`}
                                  disabled={!form.enabled}
                                  onChange={(e) => setDay(d.key, ranges.map((x, j) => (j === i ? { open: e.target.value, close: x.close } : { open: x.open, close: x.close })))}
                                />
                                <span>to</span>
                                <input
                                  type="time"
                                  value={r.close}
                                  aria-label={`${d.label} closes`}
                                  disabled={!form.enabled}
                                  onChange={(e) => setDay(d.key, ranges.map((x, j) => (j === i ? { open: x.open, close: e.target.value } : { open: x.open, close: x.close })))}
                                />
                                {ranges.length > 1 && (
                                  <button type="button" className="cl-x" aria-label="Remove these hours" disabled={!form.enabled}
                                    onClick={() => setDay(d.key, ranges.filter((_, j) => j !== i).map((x) => ({ open: x.open, close: x.close })))}>✕</button>
                                )}
                              </div>
                            ))}
                            {ranges.length < 2 && (
                              <button type="button" className="cl-link" disabled={!form.enabled}
                                onClick={() => setDay(d.key, [...ranges.map((x) => ({ open: x.open, close: x.close })), { open: ranges[0]?.close && ranges[0].close < '20:00' ? '20:00' : '19:00', close: '21:00' }])}>
                                + Add hours
                              </button>
                            )}
                          </div>
                        ) : (
                          <span className="cl-closed">Closed</span>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="cl-holidays">
                  <div className="cl-holidays-head">
                    <strong>Closed days</strong>
                    <span>Holidays when calls aren’t taken (up to 20).</span>
                  </div>
                  {form.callHours.holidays.map((h, i) => (
                    <div className="cl-range" key={i}>
                      <input
                        type="date"
                        value={h.date}
                        min={new Date().toISOString().slice(0, 10)}
                        aria-label="Closed day"
                        disabled={!form.enabled}
                        onChange={(e) => setHours({ holidays: form.callHours.holidays.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)) })}
                      />
                      <button type="button" className="cl-x" aria-label="Remove this day" disabled={!form.enabled}
                        onClick={() => setHours({ holidays: form.callHours.holidays.filter((_, j) => j !== i) })}>✕</button>
                    </div>
                  ))}
                  {form.callHours.holidays.length < 20 && (
                    <button type="button" className="cl-link" disabled={!form.enabled}
                      onClick={() => setHours({ holidays: [...form.callHours.holidays, { date: new Date(Date.now() + 86400000).toISOString().slice(0, 10), start: '00:00', end: '23:59' }] })}>
                      + Add a closed day
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {saveError && <div className="cl-error" role="alert" data-testid="calling-save-error">{saveError}</div>}
          <div className="cl-actions">
            <button type="button" className="cl-btn primary" onClick={() => void save()} disabled={!dirty || saving} data-testid="calling-save">
              {saving ? 'Saving…' : 'Save to WhatsApp'}
            </button>
            {dirty && !saving && (
              <button type="button" className="cl-btn ghost" onClick={() => { setForm(saved); setSaveError(''); }}>Discard</button>
            )}
            <span className="cl-hint">Changes can take a while to show in customers’ WhatsApp. Opening your chat info in WhatsApp refreshes it.</span>
          </div>
        </div>
      </div>

      <aside className="cs-tools-panel cl-features" data-testid="calling-features">
        <div className="cs-tools-header">
          <span>What calling can do</span>
        </div>
        <ul className="cl-feature-list">
          <li><span className="material-icons ok">call_received</span><div><strong>Answer customers’ calls</strong><span>They tap the call button in your WhatsApp chat; it rings in every open CRM tab. Free for both of you.</span></div></li>
          <li><span className="material-icons ok">call_made</span><div><strong>Call customers</strong><span>From the phone icon in a chat, once they’ve allowed calls (for 7 days or always). Meta charges calls you make per minute.</span></div></li>
          <li><span className="material-icons ok">verified_user</span><div><strong>Ask to allow calls</strong><span>Send “Allow calls?” in the chat. WhatsApp allows one request a day and two a week.</span></div></li>
          <li><span className="material-icons ok">schedule</span><div><strong>Call hours and closed days</strong><span>Outside them customers are told you’re closed.</span></div></li>
          <li><span className="material-icons ok">phone_missed</span><div><strong>Missed-call alerts and call history</strong><span>Every call is a line in the chat, with its length; a missed call notifies you.</span></div></li>
          <li><span className="material-icons ok">voicemail</span><div><strong>Voicemails</strong><span>A voicemail left on a missed call plays in the chat.</span></div></li>
          <li className="soon"><span className="material-icons">videocam</span><div><strong>Video calls <SoonPill /></strong><span>Not in WhatsApp’s Calling API yet; Meta lists it as planned.</span></div></li>
          <li className="soon"><span className="material-icons">screen_share</span><div><strong>Screen sharing <SoonPill /></strong><span>Not in WhatsApp’s Calling API yet; Meta lists it as planned.</span></div></li>
        </ul>
        <p className="cs-tools-p cl-small">
          Calls use your computer’s microphone. Allow it when the browser asks. A headset gives the best sound.
        </p>
      </aside>
    </div>
  );
}

export default CallingSettings;
