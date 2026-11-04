// -----------------------------------------------------------------------------
// The browser side of a WhatsApp voice call: the microphone, one
// RTCPeerConnection with Meta, and the ringtones.
//
// Meta takes one complete SDP per call action and has no way to add ICE
// candidates later, so every SDP sent from here waits for ICE gathering to
// finish (with a time limit: the customer only waits about a minute).
// Audio only: video and screen sharing aren't in the Calling API yet.
// -----------------------------------------------------------------------------

export interface CallMedia {
  pc: RTCPeerConnection;
  mic: MediaStream;
  /** Mute or unmute the agent's microphone. */
  setMuted(muted: boolean): void;
  /** Stop the microphone and close the connection. Safe to call twice. */
  close(): void;
}

/** A failure the agent can act on ("Allow the microphone…"). */
export class CallMediaError extends Error {}

const ICE_WAIT_MS = 4000;

/** Wait until ICE gathering is complete, or the time limit, whichever is first. */
export function waitForIce(pc: RTCPeerConnection, ms = ICE_WAIT_MS): Promise<'complete' | 'timeout'> {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') {
      resolve('complete');
      return;
    }
    const done = (how: 'complete' | 'timeout') => {
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', onChange);
      resolve(how);
    };
    const onChange = () => {
      if (pc.iceGatheringState === 'complete') done('complete');
    };
    const timer = setTimeout(() => done('timeout'), ms);
    pc.addEventListener('icegatheringstatechange', onChange);
  });
}

async function microphone(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new CallMediaError('This browser can’t use a microphone here. Open the CRM over https in Chrome, Edge, Firefox or Safari.');
  }
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
  } catch (err) {
    const name = (err as { name?: string })?.name || '';
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      throw new CallMediaError('Allow the microphone for this site (the icon in the address bar), then try again.');
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      throw new CallMediaError('No microphone found. Plug one in or pick one in your system settings.');
    }
    if (name === 'NotReadableError') {
      throw new CallMediaError('Another app is using the microphone. Close it and try again.');
    }
    throw new CallMediaError('The microphone couldn’t be started.');
  }
}

function setup(iceServers: RTCIceServer[], mic: MediaStream, onRemote: (s: MediaStream) => void): CallMedia {
  const pc = new RTCPeerConnection({ iceServers, bundlePolicy: 'max-bundle' });
  for (const track of mic.getTracks()) pc.addTrack(track, mic);
  pc.addEventListener('track', (e) => {
    // A new stream each time, so the <audio> element re-binds (one-way audio otherwise).
    onRemote(new MediaStream([e.track]));
  });
  let closed = false;
  return {
    pc,
    mic,
    setMuted(muted) {
      for (const t of mic.getAudioTracks()) t.enabled = !muted;
    },
    close() {
      if (closed) return;
      closed = true;
      for (const t of mic.getTracks()) t.stop();
      try {
        pc.close();
      } catch {
        /* already closed */
      }
    },
  };
}

/** Answer a customer's call: their offer in, our complete answer out. */
export async function answerOffer(
  offerSdp: string,
  iceServers: RTCIceServer[],
  onRemote: (s: MediaStream) => void,
): Promise<{ media: CallMedia; sdp: string }> {
  const mic = await microphone();
  const media = setup(iceServers, mic, onRemote);
  try {
    await media.pc.setRemoteDescription({ type: 'offer', sdp: offerSdp });
    await media.pc.setLocalDescription(await media.pc.createAnswer());
    await waitForIce(media.pc);
    const sdp = media.pc.localDescription?.sdp || '';
    if (!sdp) throw new CallMediaError('The call answer couldn’t be prepared.');
    return { media, sdp };
  } catch (err) {
    media.close();
    if (err instanceof CallMediaError) throw err;
    throw new CallMediaError('This call couldn’t be answered in this browser.');
  }
}

/** Start a call to a customer: our complete offer out (Meta's answer comes later). */
export async function makeOffer(
  iceServers: RTCIceServer[],
  onRemote: (s: MediaStream) => void,
): Promise<{ media: CallMedia; sdp: string }> {
  const mic = await microphone();
  const media = setup(iceServers, mic, onRemote);
  try {
    await media.pc.setLocalDescription(await media.pc.createOffer({ offerToReceiveAudio: true }));
    await waitForIce(media.pc);
    const sdp = media.pc.localDescription?.sdp || '';
    if (!sdp) throw new CallMediaError('The call couldn’t be prepared.');
    return { media, sdp };
  } catch (err) {
    media.close();
    if (err instanceof CallMediaError) throw err;
    throw new CallMediaError('This browser couldn’t start the call.');
  }
}

/** Meta's answer to our offer. */
export async function applyAnswer(media: CallMedia, sdp: string): Promise<void> {
  if (media.pc.signalingState !== 'have-local-offer') return;
  await media.pc.setRemoteDescription({ type: 'answer', sdp });
}

// ---- tones (Web Audio, no files) ----

let ctx: AudioContext | null = null;
function audio(): AudioContext | null {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    if (!ctx) ctx = new Ctx();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function burst(c: AudioContext, at: number, freqs: number[], len: number, gain: number) {
  const g = c.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(gain, at + 0.02);
  g.gain.setValueAtTime(gain, at + len - 0.05);
  g.gain.linearRampToValueAtTime(0, at + len);
  g.connect(c.destination);
  for (const f of freqs) {
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    o.connect(g);
    o.start(at);
    o.stop(at + len + 0.02);
  }
}

/**
 * A repeating tone until stopped: 'ring' for an incoming call, 'ringback'
 * (quieter) while the customer's phone rings.
 * @returns stop()
 */
export function playTone(kind: 'ring' | 'ringback'): () => void {
  const c = audio();
  if (!c) return () => {};
  const play = () => {
    const t = c.currentTime + 0.05;
    if (kind === 'ring') {
      burst(c, t, [880, 1320], 0.35, 0.12);
      burst(c, t + 0.5, [880, 1320], 0.35, 0.12);
    } else {
      burst(c, t, [440, 480], 1.2, 0.05);
    }
  };
  play();
  const timer = setInterval(play, kind === 'ring' ? 2500 : 3500);
  return () => clearInterval(timer);
}

/** A short two-note "call ended" tone. */
export function playEndTone(): void {
  const c = audio();
  if (!c) return;
  const t = c.currentTime + 0.02;
  burst(c, t, [620], 0.16, 0.08);
  burst(c, t + 0.2, [460], 0.22, 0.08);
}

// Per page load (not sessionStorage: a duplicated tab copies that).
const TAB_ID = `t${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;

/** This browser tab's id, so the server can tell the tab that answered. */
export function tabId(): string {
  return TAB_ID;
}

/** "2:14" / "1:02:05" */
export function clock(seconds: number): string {
  const n = Math.max(0, Math.floor(seconds));
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const s = n % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
