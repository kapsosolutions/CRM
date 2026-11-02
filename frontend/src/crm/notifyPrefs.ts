// -----------------------------------------------------------------------------
// Settings → Manage Notifications: this browser's choices, and the sounds.
//
// One row per kind of event (a category, set by the backend on every
// notification: backend/services/notificationCategories.js), each with a
// "Desktop nudge" and a "Sound" box, under two master switches. Kept per
// browser in localStorage, and copied to this browser's push subscription so
// desktop notifications sent while the CRM is closed follow them too.
// -----------------------------------------------------------------------------
import { COMING_SOON } from './features';

export type SoundType = 'default' | 'ding' | 'ping' | 'buzz';
export interface EventPref {
  desktop: boolean;
  sound: boolean;
}
export interface NotifyPrefs {
  allowDesktop: boolean;
  allowSound: boolean;
  soundType: SoundType;
  events: Record<string, EventPref>;
}

export interface PrefRow {
  key: string;
  label: string;
}
export interface PrefSection {
  title: string;
  rows: PrefRow[];
}

/** The page's sections, in order. Keys match the backend categories. */
export const PREF_SECTIONS: PrefSection[] = [
  {
    title: 'Chats',
    rows: [
      { key: 'message', label: 'When a new message is received' },
      { key: 'chatNew', label: 'When a new customer starts a chat' },
    ],
  },
  {
    title: 'Orders & Payments',
    rows: [
      { key: 'order', label: 'When a new order is placed' },
      { key: 'payment', label: 'When a payment is received or fails' },
      { key: 'booking', label: 'When a booking is made, cancelled or rescheduled' },
    ],
  },
  {
    title: 'Templates',
    rows: [
      { key: 'templateApproved', label: 'When a template is approved' },
      { key: 'templateRejected', label: 'When a template is rejected or paused by Meta' },
    ],
  },
  {
    title: 'Campaigns',
    rows: [
      { key: 'campaignCreated', label: 'When a campaign is created or scheduled' },
      { key: 'campaignStarted', label: 'When a scheduled campaign starts sending' },
      { key: 'campaignCompleted', label: 'When a campaign is completed' },
      { key: 'campaignFailed', label: 'When a campaign fails' },
      { key: 'campaignCancelled', label: 'When a campaign is cancelled' },
    ],
  },
  {
    title: 'Account',
    rows: [
      { key: 'plan', label: 'Plan and billing updates (renewal, trial ending)' },
      { key: 'account', label: 'WhatsApp and channel connection alerts' },
      ...(COMING_SOON.ads ? [] : [{ key: 'ads', label: 'Ads: new leads and ad updates' }]),
    ],
  },
];

const ALL_KEYS = ['message', 'chatNew', 'order', 'payment', 'booking', 'templateApproved', 'templateRejected',
  'campaignCreated', 'campaignStarted', 'campaignCompleted', 'campaignFailed', 'campaignCancelled', 'plan', 'account', 'ads'];

export const SOUNDS: { id: SoundType; label: string }[] = [
  { id: 'default', label: 'Default' },
  { id: 'ding', label: 'Ding Ding' },
  { id: 'ping', label: 'Ping' },
  { id: 'buzz', label: 'Buzz' },
];

const KEY = 'crm_notification_preferences';
export const PREFS_EVENT = 'crm_notify_prefs';

export function defaultPrefs(): NotifyPrefs {
  const events: Record<string, EventPref> = {};
  for (const k of ALL_KEYS) events[k] = { desktop: true, sound: true };
  return { allowDesktop: true, allowSound: true, soundType: 'default', events };
}

const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);

/** This browser's choices, with defaults for anything missing (and the old page's keys carried over). */
export function loadPrefs(): NotifyPrefs {
  const p = defaultPrefs();
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(localStorage.getItem(KEY) || '{}') || {};
  } catch {
    raw = {};
  }
  p.allowDesktop = bool(raw.allowDesktop, true);
  p.allowSound = bool(raw.allowSound, true);
  if (SOUNDS.some((s) => s.id === raw.soundType)) p.soundType = raw.soundType as SoundType;
  // The earlier page stored flat keys: keep what was chosen there.
  const old: Record<string, [string, string]> = { message: ['newMessageDesktop', 'newMessageSound'], chatNew: ['newChatDesktop', 'newChatSound'] };
  for (const [k, [d, s]] of Object.entries(old)) p.events[k] = { desktop: bool(raw[d], true), sound: bool(raw[s], true) };
  const ev = raw.events && typeof raw.events === 'object' ? (raw.events as Record<string, Partial<EventPref>>) : {};
  for (const k of ALL_KEYS) {
    if (ev[k]) p.events[k] = { desktop: bool(ev[k].desktop, true), sound: bool(ev[k].sound, true) };
  }
  return p;
}

export function savePrefs(p: NotifyPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new CustomEvent(PREFS_EVENT, { detail: p }));
  } catch {
    /* ignore */
  }
}

/** Whether a category should nudge the desktop / play the sound in this browser. */
export function wants(p: NotifyPrefs, category: string | undefined, kind: 'desktop' | 'sound'): boolean {
  if (kind === 'desktop' ? !p.allowDesktop : !p.allowSound) return false;
  const row = p.events[category || 'account'];
  return row ? row[kind] : true;
}

/** Play one of the notification sounds (Web Audio, no file needed). */
export function playSound(type: SoundType = 'default'): void {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    const now = ctx.currentTime;
    let end = 0.35;
    if (type === 'ding') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(1046.5, now);
      gain.gain.setValueAtTime(0.2, now);
      end = 0.4;
    } else if (type === 'ping') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1318.5, now);
      gain.gain.setValueAtTime(0.22, now);
      end = 0.25;
    } else if (type === 'buzz') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(220, now);
      gain.gain.setValueAtTime(0.15, now);
      end = 0.2;
    } else {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, now);
      osc.frequency.setValueAtTime(880, now + 0.1);
      gain.gain.setValueAtTime(0.18, now);
    }
    gain.gain.exponentialRampToValueAtTime(0.001, now + end);
    osc.start(now);
    osc.stop(now + end);
    osc.onended = () => ctx.close();
  } catch {
    /* audio not available */
  }
}
