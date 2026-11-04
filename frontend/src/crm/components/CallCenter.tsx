// =============================================================================
// WhatsApp voice calls in the CRM (backend services/calling.js).
//
// Lives in the shell, so a call rings and keeps going whatever page is open.
//   - A customer calls: every open tab rings; the first to Accept takes it and
//     the others stop ("Answered in another tab").
//   - The agent calls from a chat: the customer must have allowed calls; if
//     not, the agent can send them "Allow calls?" from here.
//   - One call at a time per tab: a mute button, the timer, hang up.
// Video and screen sharing aren't in Meta's Calling API yet: shown as Soon.
//
//   <CallProvider api socket demo enabled onOpenChat>…</CallProvider>
//   const calls = useCalls();  calls?.startCall(phone, name)
// =============================================================================
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { CrmApi } from '../api';
import type { CrmSocket } from '../socket';
import type { CallEvent, CallPermission, LiveCall } from '../types';
import {
  answerOffer, applyAnswer, makeOffer, playEndTone, playTone, tabId, clock, CallMediaError, type CallMedia,
} from '../callEngine';
import { useNotify } from './Dialogs';
import { useBackHandler } from '../useBackHandler';
import { SoonPill } from './ComingSoon';
import { notify as desktopNotify } from '../utils';
import './CallCenter.css';

type Phase = 'preparing' | 'connecting' | 'calling' | 'ringing' | 'active' | 'ended';

interface ActiveCall {
  id: string;
  phone: string;
  name: string;
  direction: 'in' | 'out';
  phase: Phase;
  /** When talking started (ms), for the timer. */
  since: number | null;
  muted: boolean;
  /** Why it ended, shown briefly. */
  note?: string;
}

interface PermissionAsk {
  phone: string;
  name: string;
  permission: CallPermission | null;
  loading: boolean;
  sending: boolean;
  sent: boolean;
  error: string;
  text: string;
}

export interface CallsApi {
  /** Calling is possible from this business (its own number). */
  available: boolean;
  /** A call is on in this tab. */
  busy: boolean;
  /** The phone of the call on in this tab, if any. */
  activePhone: string | null;
  startCall: (phone: string, name?: string) => void;
}

const CallCtx = createContext<CallsApi | null>(null);
/** The calls of this tab, or null outside a CallProvider (e.g. the demo's bare chat). */
export const useCalls = () => useContext(CallCtx);

const DEFAULT_ASK = 'We’d like to call you on WhatsApp about your request. Is that OK?';

interface Props {
  api: CrmApi;
  socket: CrmSocket | null;
  /** The business has its own WhatsApp number (the shared test number can't call). */
  enabled: boolean;
  demo?: boolean;
  onOpenChat?: (phone: string) => void;
  /** Channel Status → Calling (turn calling on). */
  onOpenSettings?: () => void;
  children: ReactNode;
}

export function CallProvider({ api, socket, enabled, demo = false, onOpenChat, onOpenSettings, children }: Props) {
  const notify = useNotify();
  const me = tabId();
  const [ringing, setRinging] = useState<LiveCall[]>([]);
  const [active, setActive] = useState<ActiveCall | null>(null);
  const activeRef = useRef<ActiveCall | null>(null);
  activeRef.current = active;
  const mediaRef = useRef<CallMedia | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [remote, setRemote] = useState<MediaStream | null>(null);
  const [ask, setAsk] = useState<PermissionAsk | null>(null);
  const [now, setNow] = useState(Date.now());
  const iceRef = useRef<RTCIceServer[] | null>(null);
  // Meta's answer can arrive before /calls returns our call id.
  const earlyAnswer = useRef<{ phone: string; sdp: string; id: string } | null>(null);
  const [needsOn, setNeedsOn] = useState(false);

  const ice = useCallback(async () => {
    if (iceRef.current) return iceRef.current;
    try {
      const r = await api.getCallConfig();
      iceRef.current = r.iceServers || [];
    } catch {
      iceRef.current = [{ urls: ['stun:stun.l.google.com:19302'] }];
    }
    return iceRef.current;
  }, [api]);

  // The remote voice plays through a hidden <audio>.
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.srcObject = remote;
    if (remote) void el.play().catch(() => {});
  }, [remote]);

  // The talk timer.
  useEffect(() => {
    if (!active?.since) return undefined;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [active?.since]);

  // Ringtone while a call rings here (and nothing is on), ringback while
  // the customer's phone rings.
  const ringingHere = ringing.length > 0;
  useEffect(() => {
    if (!ringingHere || activeRef.current) return undefined;
    return playTone('ring');
  }, [ringingHere, active?.id]);
  const ringback = active?.direction === 'out' && (active.phase === 'calling' || active.phase === 'ringing');
  useEffect(() => (ringback ? playTone('ringback') : undefined), [ringback]);

  const closeMedia = useCallback(() => {
    mediaRef.current?.close();
    mediaRef.current = null;
    setRemote(null);
  }, []);

  /** The call here is over: say why for a moment, then clear it. */
  const finish = useCallback((note: string) => {
    closeMedia();
    if (!activeRef.current) return;
    playEndTone();
    setActive((a) => (a ? { ...a, phase: 'ended', note, since: a.since } : a));
    const id = activeRef.current.id;
    setTimeout(() => setActive((a) => (a && a.id === id && a.phase === 'ended' ? null : a)), 2200);
  }, [closeMedia]);

  const dropRinging = (id: string) => setRinging((list) => list.filter((c) => c.id !== id));

  // ---- server events ----
  useEffect(() => {
    if (!socket || !enabled) return undefined;
    const off = socket.onCall((e: CallEvent) => {
      if (e.kind === 'permission') {
        // The customer answered "Allow calls?": an open dialog for them turns
        // into "Call now" (or says they declined).
        const yes = e.permission.response === 'accept';
        setAsk((a) => {
          if (!a || a.phone !== e.phone) return a;
          const base: CallPermission = a.permission || {
            status: 'no_permission', expiresAt: null, canCall: false, canAsk: false, askAgainAt: null, callAgainAt: null,
          };
          return {
            ...a,
            sent: false,
            error: yes ? '' : 'They chose not to allow calls.',
            permission: {
              ...base,
              canCall: yes,
              canAsk: false,
              status: yes ? (e.permission.permanent ? 'permanent' : 'temporary') : 'no_permission',
              expiresAt: e.permission.expiresAt,
            },
          };
        });
        return;
      }
      const call = e.call;
      const a = activeRef.current;
      switch (e.kind) {
        case 'incoming': {
          setRinging((list) => (list.some((c) => c.id === call.id) ? list : [...list, call]));
          if (document.hidden) desktopNotify(`${call.name || `+${call.phone}`} is calling`, 'WhatsApp voice call. Open the CRM to answer.');
          break;
        }
        case 'answered': {
          // Taken (here or in another tab): no tab rings for it any more.
          dropRinging(call.id);
          break;
        }
        case 'answer': {
          // Meta's answer to an offer. Only for the tab that placed the call.
          if (call.answeredBy && call.answeredBy !== me) break;
          const m = mediaRef.current;
          if (a && a.direction === 'out' && a.id === call.id && m) {
            void applyAnswer(m, e.sdp).catch(() => finish('The call couldn’t connect'));
            setActive((x) => (x ? { ...x, phase: x.phase === 'active' ? 'active' : 'ringing' } : x));
          } else {
            // Before /calls has returned the id: applied once it has.
            earlyAnswer.current = { phone: call.phone, sdp: e.sdp, id: call.id };
          }
          break;
        }
        case 'status': {
          if (e.status === 'rejected') {
            dropRinging(call.id);
            if (a && a.id === call.id) finish(a.direction === 'out' ? 'Call declined' : 'Call declined');
          } else if (e.status === 'accepted' && a && a.id === call.id) {
            setActive((x) => (x ? { ...x, phase: 'active', since: Date.now() } : x));
          } else if (e.status === 'ringing' && a && a.id === call.id && a.phase === 'calling') {
            setActive((x) => (x ? { ...x, phase: 'ringing' } : x));
          }
          break;
        }
        case 'hangup':
        case 'ended': {
          dropRinging(call.id);
          if (a && a.id === call.id) {
            const st = call.state;
            finish(
              st === 'no_answer' ? 'No answer'
                : st === 'declined' ? 'Call declined'
                  : st === 'failed' ? 'The call didn’t connect'
                    : st === 'missed' ? 'Missed call'
                      : 'Call ended',
            );
          }
          break;
        }
        default:
          break;
      }
    });
    return off;
  }, [socket, enabled, me, finish]);

  // A tab that opens while a call rings still rings for it; and on reconnect.
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    const load = () => {
      api.getRingingCalls().then((r) => {
        if (!live) return;
        setRinging((list) => {
          const known = new Set(list.map((c) => c.id));
          return [...list.filter((c) => (r.calls || []).some((x) => x.id === c.id)), ...(r.calls || []).filter((c) => !known.has(c.id))];
        });
      }).catch(() => {});
    };
    load();
    const off = socket?.onConnect(load);
    return () => {
      live = false;
      off?.();
    };
  }, [api, socket, enabled]);

  // A ring the server forgot (Meta gave up, a missed terminate): drop it after 90 s.
  useEffect(() => {
    if (!ringing.length) return undefined;
    const t = setInterval(() => {
      setRinging((list) => list.filter((c) => Date.now() - new Date(c.at).getTime() < 90 * 1000));
    }, 5000);
    return () => clearInterval(t);
  }, [ringing.length]);

  // ---- actions ----
  const accept = useCallback(async (call: LiveCall) => {
    if (activeRef.current) {
      notify('error', 'You’re already on a call', 'Hang up first to answer this one.');
      return;
    }
    if (!call.offerSdp) {
      notify('error', 'This call can’t be answered here', 'Reload the page and try again.');
      return;
    }
    setActive({ id: call.id, phone: call.phone, name: call.name, direction: 'in', phase: 'preparing', since: null, muted: false });
    dropRinging(call.id);
    try {
      const servers = await ice();
      const { media, sdp } = await answerOffer(call.offerSdp, servers, setRemote);
      mediaRef.current = media;
      setActive((a) => (a ? { ...a, phase: 'connecting' } : a));
      await api.acceptCall(call.id, sdp, me);
      setActive((a) => (a && a.id === call.id ? { ...a, phase: 'active', since: Date.now() } : a));
    } catch (err) {
      closeMedia();
      setActive(null);
      const msg = err instanceof Error ? err.message : 'The call couldn’t be answered.';
      notify('error', 'Couldn’t answer the call', msg);
    }
  }, [api, ice, me, notify, closeMedia]);

  const decline = useCallback((call: LiveCall) => {
    dropRinging(call.id);
    api.rejectCall(call.id).catch(() => {});
  }, [api]);

  const hangUp = useCallback(() => {
    const a = activeRef.current;
    if (!a) return;
    if (a.id) api.endCall(a.id).catch(() => {});
    finish(a.since ? 'Call ended' : 'Cancelled');
  }, [api, finish]);

  const toggleMute = useCallback(() => {
    setActive((a) => {
      if (!a) return a;
      mediaRef.current?.setMuted(!a.muted);
      return { ...a, muted: !a.muted };
    });
  }, []);

  /** Place the call (permission already checked). */
  const dial = useCallback(async (phone: string, name: string) => {
    setActive({ id: '', phone, name, direction: 'out', phase: 'preparing', since: null, muted: false });
    earlyAnswer.current = null;
    try {
      const servers = await ice();
      const { media, sdp } = await makeOffer(servers, setRemote);
      mediaRef.current = media;
      setActive((a) => (a ? { ...a, phase: 'calling' } : a));
      const r = await api.startCall(phone, sdp, me, name);
      if (!activeRef.current || activeRef.current.phone !== phone) {
        // Hung up while it was being placed.
        api.endCall(r.call.id).catch(() => {});
        media.close();
        return;
      }
      setActive((a) => (a ? { ...a, id: r.call.id } : a));
      activeRef.current = activeRef.current ? { ...activeRef.current, id: r.call.id } : activeRef.current;
      // Set by the socket while /calls was in flight (TS can't see that).
      const early = earlyAnswer.current as { phone: string; sdp: string; id: string } | null;
      if (early && early.id === r.call.id) {
        earlyAnswer.current = null;
        await applyAnswer(media, early.sdp).catch(() => {});
        setActive((a) => (a ? { ...a, phase: a.phase === 'active' ? 'active' : 'ringing' } : a));
      }
    } catch (err) {
      closeMedia();
      setActive(null);
      const e = err as Error & { data?: { code?: number } };
      if (e?.data?.code === 138006) {
        // No permission after all (it expired): offer to ask.
        openAsk(phone, name);
        return;
      }
      notify('error', 'Couldn’t start the call', e instanceof CallMediaError || e?.message ? e.message : 'Try again.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, ice, me, notify, closeMedia]);

  function openAsk(phone: string, name: string) {
    setAsk({ phone, name, permission: null, loading: true, sending: false, sent: false, error: '', text: DEFAULT_ASK });
    api.getCallPermission(phone)
      .then((p) => setAsk((a) => (a && a.phone === phone ? { ...a, permission: p, loading: false } : a)))
      .catch((err: Error) => setAsk((a) => (a && a.phone === phone ? { ...a, loading: false, error: err.message } : a)));
  }

  const startCall = useCallback(async (phone: string, name = '') => {
    if (!enabled) return;
    if (activeRef.current) {
      notify('error', 'You’re already on a call', 'Hang up first.');
      return;
    }
    // Calling switched on for the number?
    try {
      const s = await api.getCallSettings();
      if (s.connected && s.settings && !s.settings.enabled) {
        setNeedsOn(true);
        return;
      }
    } catch {
      /* Meta unreachable: try the call, it says why if it fails */
    }
    try {
      const p = await api.getCallPermission(phone);
      if (p.canCall) {
        void dial(phone, name);
        return;
      }
      setAsk({ phone, name, permission: p, loading: false, sending: false, sent: false, error: '', text: DEFAULT_ASK });
    } catch (err) {
      notify('error', 'Couldn’t check call permission', (err as Error).message);
    }
  }, [api, dial, enabled, notify]);

  const sendAsk = useCallback(async () => {
    const a = ask;
    if (!a || a.sending) return;
    setAsk({ ...a, sending: true, error: '' });
    try {
      await api.requestCallPermission(a.phone, a.text.trim());
      setAsk((x) => (x ? { ...x, sending: false, sent: true } : x));
    } catch (err) {
      setAsk((x) => (x ? { ...x, sending: false, error: (err as Error).message } : x));
    }
  }, [api, ask]);

  // Leaving the page mid-call hangs up at Meta too.
  useEffect(() => {
    const onLeave = () => {
      const a = activeRef.current;
      if (a?.id && a.phase !== 'ended') api.endCall(a.id).catch(() => {});
    };
    window.addEventListener('pagehide', onLeave);
    return () => window.removeEventListener('pagehide', onLeave);
  }, [api]);

  const value = useMemo<CallsApi>(() => ({
    available: enabled,
    busy: !!active && active.phase !== 'ended',
    activePhone: active && active.phase !== 'ended' ? active.phone : null,
    startCall: (phone, name) => void startCall(phone, name),
  }), [enabled, active, startCall]);

  return (
    <CallCtx.Provider value={value}>
      {children}
      <audio ref={audioRef} autoPlay playsInline data-testid="call-remote-audio" style={{ display: 'none' }} />
      {createPortal(
        <div className="cc-layer" data-demo={demo ? '1' : undefined}>
          {ringing.map((call) => (
            <IncomingCard
              key={call.id}
              call={call}
              busy={!!active}
              onAccept={() => void accept(call)}
              onDecline={() => decline(call)}
            />
          ))}
          {active && (
            <ActiveCard
              call={active}
              seconds={active.since ? (now - active.since) / 1000 : 0}
              onMute={toggleMute}
              onHangUp={hangUp}
              onOpenChat={onOpenChat ? () => onOpenChat(active.phone) : undefined}
            />
          )}
        </div>,
        document.body,
      )}
      {ask && (
        <AskDialog
          ask={ask}
          onText={(text) => setAsk((x) => (x ? { ...x, text } : x))}
          onSend={() => void sendAsk()}
          onCall={() => {
            const a = ask;
            setAsk(null);
            void dial(a.phone, a.name);
          }}
          onClose={() => setAsk(null)}
        />
      )}
      {needsOn && (
        <NeedsOnDialog
          onClose={() => setNeedsOn(false)}
          onOpenSettings={onOpenSettings ? () => { setNeedsOn(false); onOpenSettings(); } : undefined}
        />
      )}
    </CallCtx.Provider>
  );
}

const who = (c: { name: string; phone: string }) => c.name || `+${c.phone}`;
const initial = (c: { name: string; phone: string }) => (c.name || '#').trim().charAt(0).toUpperCase() || '#';

function PhoneSvg({ size = 20, down = false }: { size?: number; down?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={down ? { transform: 'rotate(135deg)' } : undefined}>
      <path d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.02-.24 11.4 11.4 0 0 0 3.57.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1.02l-2.2 2.2z" />
    </svg>
  );
}

function IncomingCard({ call, busy, onAccept, onDecline }: { call: LiveCall; busy: boolean; onAccept: () => void; onDecline: () => void }) {
  return (
    <div className="cc-card cc-incoming" role="alertdialog" aria-label={`${who(call)} is calling`} data-testid="call-incoming">
      <div className="cc-head">
        <span className="cc-avatar ringing" aria-hidden="true">{initial(call)}</span>
        <div className="cc-who">
          <strong>{who(call)}</strong>
          <span>{call.name ? `+${call.phone} · ` : ''}WhatsApp voice call</span>
        </div>
      </div>
      {busy && <div className="cc-note">You’re on another call. Hang up to answer this one.</div>}
      <div className="cc-actions">
        <button type="button" className="cc-btn decline" onClick={onDecline} data-testid="call-decline">
          <PhoneSvg down />
          Decline
        </button>
        <button type="button" className="cc-btn accept" onClick={onAccept} disabled={busy} data-testid="call-accept">
          <PhoneSvg />
          Accept
        </button>
      </div>
      <div className="cc-soon-row">
        <span className="material-icons" aria-hidden="true">videocam</span>
        Video calls <SoonPill />
      </div>
    </div>
  );
}

const PHASE_TEXT: Record<Phase, string> = {
  preparing: 'Starting microphone…',
  connecting: 'Connecting…',
  calling: 'Calling…',
  ringing: 'Ringing…',
  active: '',
  ended: '',
};

function ActiveCard({ call, seconds, onMute, onHangUp, onOpenChat }: {
  call: ActiveCall;
  seconds: number;
  onMute: () => void;
  onHangUp: () => void;
  onOpenChat?: () => void;
}) {
  const ended = call.phase === 'ended';
  const status = ended ? call.note || 'Call ended' : call.phase === 'active' ? clock(seconds) : PHASE_TEXT[call.phase];
  return (
    <div className={`cc-card cc-active${ended ? ' ended' : ''}`} role="region" aria-label={`Call with ${who(call)}`} data-testid="call-active">
      <div className="cc-head">
        <span className={`cc-avatar${call.phase === 'active' ? ' live' : ''}`} aria-hidden="true">{initial(call)}</span>
        <div className="cc-who">
          <strong>{who(call)}</strong>
          <span data-testid="call-status" className={call.phase === 'active' ? 'cc-timer' : ''}>{status}</span>
        </div>
        {onOpenChat && !ended && (
          <button type="button" className="cc-icon" onClick={onOpenChat} title="Open chat" aria-label="Open chat">
            <span className="material-icons">chat</span>
          </button>
        )}
      </div>
      {!ended && (
        <div className="cc-controls">
          <button
            type="button"
            className={`cc-ctl${call.muted ? ' on' : ''}`}
            onClick={onMute}
            aria-pressed={call.muted}
            data-testid="call-mute"
            disabled={call.phase === 'preparing'}
          >
            <span className="material-icons">{call.muted ? 'mic_off' : 'mic'}</span>
            <span>{call.muted ? 'Unmute' : 'Mute'}</span>
          </button>
          <button type="button" className="cc-ctl soon" disabled title="Video calls aren’t in WhatsApp’s Calling API yet">
            <span className="material-icons">videocam</span>
            <span>Video <SoonPill /></span>
          </button>
          <button type="button" className="cc-ctl soon" disabled title="Screen sharing isn’t in WhatsApp’s Calling API yet">
            <span className="material-icons">screen_share</span>
            <span>Share <SoonPill /></span>
          </button>
          <button type="button" className="cc-ctl hang" onClick={onHangUp} data-testid="call-hangup" aria-label="Hang up">
            <PhoneSvg down />
            <span>End</span>
          </button>
        </div>
      )}
    </div>
  );
}

function AskDialog({ ask, onText, onSend, onCall, onClose }: {
  ask: PermissionAsk;
  onText: (t: string) => void;
  onSend: () => void;
  onCall: () => void;
  onClose: () => void;
}) {
  useBackHandler(true, onClose);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  const p = ask.permission;
  const name = who(ask);
  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '');
  return (
    <div className="cc-overlay" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="cc-dialog" role="dialog" aria-modal="true" aria-labelledby="cc-ask-title" data-testid="call-ask">
        <div className="cc-dialog-head">
          <h3 id="cc-ask-title">{p?.canCall ? `Call ${name}` : `Ask ${name} to allow calls`}</h3>
          <button type="button" className="cc-x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {ask.loading ? (
          <p className="cc-p">Checking with WhatsApp…</p>
        ) : p?.canCall ? (
          <>
            <p className="cc-p">
              {p.status === 'permanent' ? `${name} allowed you to call them anytime.` : `${name} allowed calls${p.expiresAt ? ` until ${fmt(p.expiresAt)}` : ''}.`}
            </p>
            <div className="cc-dialog-actions">
              <button type="button" className="cc-dbtn ghost" onClick={onClose}>Cancel</button>
              <button type="button" className="cc-dbtn primary" onClick={onCall}>Call now</button>
            </div>
          </>
        ) : ask.sent ? (
          <>
            <p className="cc-p" data-testid="call-ask-sent">
              Sent. {name} sees “Allow calls?” in WhatsApp. When they allow it, the call button works; you’ll see their answer in the chat.
            </p>
            <div className="cc-dialog-actions">
              <button type="button" className="cc-dbtn primary" onClick={onClose}>Done</button>
            </div>
          </>
        ) : (
          <>
            <p className="cc-p">
              WhatsApp only lets you call customers who allowed it. {name} gets this message with <strong>Allow</strong> and <strong>Don’t allow</strong> buttons, and can allow calls for 7 days or always.
            </p>
            {p && !p.canAsk ? (
              <div className="cc-warn" role="status">
                You’ve asked {name} recently. WhatsApp allows one request a day and two a week{p.askAgainAt ? `; you can ask again after ${fmt(p.askAgainAt)}` : ''}.
              </div>
            ) : (
              <>
                <label className="cc-label" htmlFor="cc-ask-text">Message</label>
                <textarea
                  id="cc-ask-text"
                  className="cc-textarea"
                  value={ask.text}
                  maxLength={1024}
                  rows={3}
                  onChange={(e) => onText(e.target.value)}
                />
                <small className="cc-hint">Sent as a WhatsApp message, so the 24-hour window must be open.</small>
              </>
            )}
            {ask.error && <div className="cc-error" role="alert">{ask.error}</div>}
            <div className="cc-dialog-actions">
              <button type="button" className="cc-dbtn ghost" onClick={onClose}>Cancel</button>
              <button
                type="button"
                className="cc-dbtn primary"
                onClick={onSend}
                disabled={ask.sending || (p ? !p.canAsk : false) || !ask.text.trim()}
                data-testid="call-ask-send"
              >
                {ask.sending ? 'Sending…' : 'Ask to allow calls'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function NeedsOnDialog({ onClose, onOpenSettings }: { onClose: () => void; onOpenSettings?: () => void }) {
  useBackHandler(true, onClose);
  return (
    <div className="cc-overlay" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="cc-dialog" role="dialog" aria-modal="true" aria-labelledby="cc-on-title" data-testid="call-needs-on">
        <div className="cc-dialog-head">
          <h3 id="cc-on-title">Turn on WhatsApp calling first</h3>
          <button type="button" className="cc-x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <p className="cc-p">Calling is off for your WhatsApp number. Turn it on in Channel Status → Calling; it needs a messaging limit of 2,000 or more.</p>
        <div className="cc-dialog-actions">
          <button type="button" className="cc-dbtn ghost" onClick={onClose}>Not now</button>
          {onOpenSettings && <button type="button" className="cc-dbtn primary" onClick={onOpenSettings}>Open Calling settings</button>}
        </div>
      </div>
    </div>
  );
}
