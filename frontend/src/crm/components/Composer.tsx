// Message composer: templates, attach, emoji, text input, and voice recording.
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useNotify } from './Dialogs';

// Its own chunk, fetched and built while the browser is idle (see below).
const EmojiPicker = lazy(() => import('./EmojiPickerLazy'));

/** Run `fn` when the browser has a moment (or after `ms` at the latest). */
function whenIdle(fn: () => void, ms = 2500): () => void {
  const w = window as Window & {
    requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  if (w.requestIdleCallback) {
    const id = w.requestIdleCallback(fn, { timeout: ms });
    return () => w.cancelIdleCallback?.(id);
  }
  const t = window.setTimeout(fn, Math.min(ms, 1200));
  return () => window.clearTimeout(t);
}

interface ReplyTo {
  author: string;
  preview: string;
}

interface Props {
  draft: string;
  windowOpen: boolean;
  sending: boolean;
  uploading: boolean;
  replyTo: ReplyTo | null;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  onPickFiles: (files: File[]) => void;
  onSendVoice: (file: File) => void;
  onOpenTemplates: () => void;
  onOpenFlows?: () => void;
  onCancelReply: () => void;
  /**
   * The chat's channel. Messenger / Instagram chats have no templates (a
   * WhatsApp feature) and no voice notes; text and attachments only.
   */
  channel?: string;
  /**
   * Messenger / Instagram: open the Quick messages picker. On Instagram it
   * only works inside the 24-hour window; on Messenger outside the window it
   * offers the approved utility templates instead.
   */
  onOpenQuickMessages?: () => void;
}

export function Composer({
  draft,
  windowOpen,
  sending,
  uploading,
  replyTo,
  onDraftChange,
  onSend,
  onPickFiles,
  onSendVoice,
  onOpenTemplates,
  onOpenFlows: _onOpenFlows,
  onCancelReply,
  channel = 'whatsapp',
  onOpenQuickMessages,
}: Props) {
  const whatsapp = !channel || channel === 'whatsapp';
  const notify = useNotify();
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // ---- Voice recording ----
  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [levels, setLevels] = useState<number[]>([]);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const cancelRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const sampleRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const WAVE_BARS = 44;

  function startSampling() {
    if (sampleRef.current) clearInterval(sampleRef.current);
    sampleRef.current = setInterval(() => {
      const analyser = analyserRef.current;
      const data = dataRef.current;
      if (!analyser || !data) return;
      analyser.getByteFrequencyData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i];
      const level = Math.min(1, sum / data.length / 110);
      setLevels((prev) => [...prev, level].slice(-WAVE_BARS));
    }, 90);
  }

  function cleanupAudio() {
    if (sampleRef.current) clearInterval(sampleRef.current);
    sampleRef.current = null;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    analyserRef.current = null;
    dataRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  useEffect(() => {
    if (replyTo) inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replyTo?.author, replyTo?.preview]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [draft]);

  // Clean up any active recording on unmount.
  useEffect(() => cleanupAudio, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files ? Array.from(e.target.files) : [];
    if (files.length) onPickFiles(files);
    e.target.value = '';
  }

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const dt = e.clipboardData;
    const files: File[] = [];
    if (dt.files && dt.files.length) {
      files.push(...Array.from(dt.files));
    } else {
      for (const item of Array.from(dt.items || [])) {
        if (item.kind === 'file') {
          const f = item.getAsFile();
          if (f) files.push(f);
        }
      }
    }
    if (files.length) {
      e.preventDefault();
      onPickFiles(files);
    }
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      cancelRef.current = false;

      // Live waveform via the Web Audio analyser.
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      audioCtxRef.current = ctx;
      analyserRef.current = analyser;
      dataRef.current = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));

      const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      rec.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      rec.onstop = () => {
        const type = rec.mimeType || 'audio/webm';
        const chunks = chunksRef.current;
        const wasCancelled = cancelRef.current;
        cleanupAudio();
        setRecording(false);
        setPaused(false);
        setSeconds(0);
        setLevels([]);
        if (wasCancelled) return;
        const blob = new Blob(chunks, { type });
        if (blob.size === 0) return;
        const ext = type.includes('ogg') ? 'ogg' : 'webm';
        onSendVoice(new File([blob], `voice-note-${Date.now()}.${ext}`, { type }));
      };
      recorderRef.current = rec;
      rec.start();
      setRecording(true);
      setPaused(false);
      setSeconds(0);
      setLevels([]);
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
      startSampling();
    } catch {
      notify('error', 'Microphone blocked', 'Allow microphone access in your browser to record a voice message.');
    }
  }

  function togglePause() {
    const rec = recorderRef.current;
    if (!rec) return;
    if (paused) {
      rec.resume();
      setPaused(false);
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
      startSampling();
    } else {
      rec.pause();
      setPaused(true);
      if (timerRef.current) clearInterval(timerRef.current);
      if (sampleRef.current) clearInterval(sampleRef.current);
    }
  }

  function stopAndSend() {
    cancelRef.current = false;
    recorderRef.current?.stop();
  }

  function cancelRecording() {
    cancelRef.current = true;
    recorderRef.current?.stop();
  }

  const [showEmoji, setShowEmoji] = useState(false);
  // The picker is built once, hidden, while the browser is idle, and kept
  // after that: opening it is then instant instead of downloading the emoji
  // list and drawing ~1,800 emoji on every click.
  const [emojiBuilt, setEmojiBuilt] = useState(false);
  useEffect(() => {
    if (emojiBuilt || !windowOpen) return undefined;
    return whenIdle(() => setEmojiBuilt(true));
  }, [emojiBuilt, windowOpen]);

  function insertEmoji(emoji: string) {
    const el = inputRef.current;
    const start = el?.selectionStart ?? draft.length;
    const end = el?.selectionEnd ?? draft.length;
    const next = draft.slice(0, start) + emoji + draft.slice(end);
    onDraftChange(next);
    setTimeout(() => {
      el?.focus();
      const pos = start + emoji.length;
      el?.setSelectionRange(pos, pos);
    }, 0);
  }

  const mmss = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const hasText = !!draft.trim();
  // When the 24h window is closed, only templates are allowed.
  const locked = !windowOpen;

  return (
    <footer className="composer">
      {replyTo && (
        <div className="reply-bar">
          <div className="rb-content">
            <div className="rb-author">{replyTo.author}</div>
            <div className="rb-preview">{replyTo.preview}</div>
          </div>
          <button className="rb-close" onClick={onCancelReply} aria-label="Cancel reply">
            <span className="material-icons">close</span>
          </button>
        </div>
      )}

      {recording ? (
        <div className="composer-pill recording">
          <button className="icon-btn danger" onClick={cancelRecording} title="Cancel" aria-label="Cancel recording">
            <span className="material-icons">delete</span>
          </button>
          <span className={`rec-dot${paused ? ' paused' : ''}`} />
          <span className="rec-time">{mmss}</span>
          <div className="rec-wave">
            {levels.map((l, i) => (
              <span className="rec-bar" key={i} style={{ height: `${4 + l * 22}px` }} />
            ))}
          </div>
          <button className="icon-btn pausebtn" onClick={togglePause} title={paused ? 'Resume' : 'Pause'} aria-label={paused ? 'Resume' : 'Pause'}>
            <span className="material-icons">{paused ? 'play_arrow' : 'pause'}</span>
          </button>
          <button className="composer-action-btn send-btn" onClick={stopAndSend} title="Send voice message" aria-label="Send voice message">
            <span className="material-icons">send</span>
          </button>
        </div>
      ) : (
        <div className={`composer-pill${locked ? ' is-locked' : ''}`}>
          <div className="composer-left-actions">
            {whatsapp && (
            <button
              className="icon-btn"
              onClick={onOpenTemplates}
              title="Templates"
              aria-label="Templates"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="16" rx="2.5" />
                <line x1="3" y1="9" x2="21" y2="9" />
                <line x1="7" y1="13" x2="15" y2="13" />
                <line x1="7" y1="16.5" x2="12" y2="16.5" />
              </svg>
            </button>
            )}
            {!whatsapp && onOpenQuickMessages && (
              <button
                className="icon-btn"
                onClick={onOpenQuickMessages}
                // Instagram: nothing can be sent outside the window. Messenger:
                // the picker then offers approved utility templates.
                disabled={locked && channel === 'instagram'}
                title={
                  locked
                    ? channel === 'instagram'
                      ? 'Quick messages can only be sent within 24 hours of the customer’s last message'
                      : 'Window closed — send an approved utility template'
                    : 'Quick messages'
                }
                aria-label={locked && channel === 'messenger' ? 'Utility templates' : 'Quick messages'}
                data-testid="composer-quick"
              >
                <span className="material-icons" aria-hidden="true">{locked && channel === 'messenger' ? 'assignment' : 'bolt'}</span>
              </button>
            )}
            <button
              className="icon-btn"
              onClick={() => fileRef.current?.click()}
              title={locked ? 'Window closed' : 'Attach file'}
              aria-label="Attach file"
              disabled={uploading || locked}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.44 11.05l-9.19 9.19a5 5 0 0 1-7.07-7.07l9.19-9.19a3.5 3.5 0 0 1 4.95 4.95l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
            </button>
            <div className="emoji-anchor">
              <button
                className={`icon-btn${showEmoji ? ' active' : ''}`}
                onClick={() => {
                  setEmojiBuilt(true);
                  setShowEmoji((v) => !v);
                }}
                title="Emoji"
                aria-label="Emoji"
                disabled={locked}
              >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.5"/>
                  <circle cx="7.5" cy="8" r="0.9" fill="currentColor"/>
                  <circle cx="12.5" cy="8" r="0.9" fill="currentColor"/>
                  <path d="M6.5 11.5C7.3 13.2 8.5 14 10 14C11.5 14 12.7 13.2 13.5 11.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </button>
              {showEmoji && <div className="emoji-pop-backdrop" onClick={() => setShowEmoji(false)} />}
              {(emojiBuilt || showEmoji) && (
                <div className={`emoji-pop${showEmoji ? '' : ' is-hidden'}`} aria-hidden={!showEmoji} data-testid="emoji-pop">
                  <Suspense
                    fallback={showEmoji ? <div className="emoji-pop-loading" role="status" aria-label="Loading emoji" /> : null}
                  >
                    <EmojiPicker onSelect={insertEmoji} />
                  </Suspense>
                </div>
              )}
            </div>
          </div>

          <input
            ref={fileRef}
            type="file"
            multiple
            onChange={handleFile}
            hidden
            accept={
              channel === 'instagram'
                ? 'image/png,image/jpeg,video/*,audio/*,application/pdf'
                : 'image/*,video/*,audio/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.txt'
            }
          />

          <textarea
            ref={inputRef}
            className="composer-input"
            rows={1}
            placeholder={
              locked
                ? whatsapp
                  ? 'Window closed — send a template'
                  : channel === 'messenger' && onOpenQuickMessages
                  ? 'Reply window closed — send an approved utility template'
                  : 'Reply window closed — you can reply after the customer writes again'
                : uploading
                ? 'Uploading…'
                : 'Type a message'
            }
            value={draft}
            disabled={locked}
            onChange={(e) => onDraftChange(e.target.value)}
            onPaste={handlePaste}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (!locked) onSend();
              }
            }}
          />

          <div className="composer-right-actions">
            {hasText ? (
              <button
                className="composer-action-btn send-btn"
                onClick={onSend}
                disabled={sending || locked}
                title="Send message"
                aria-label="Send message"
              >
                <span className="material-icons">send</span>
              </button>
            ) : !locked && !whatsapp ? (
              // Messenger / Instagram: no voice notes, so an idle send button instead of the mic.
              <button
                className="composer-action-btn send-btn"
                disabled
                title="Type a message to send"
                aria-label="Send message"
              >
                <span className="material-icons">send</span>
              </button>
            ) : locked ? (
              <button
                className="composer-action-btn lock-btn"
                title={whatsapp ? 'Window closed — only templates allowed' : 'Reply window closed'}
                aria-label="Window closed"
                disabled
              >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <rect x="3.5" y="8" width="13" height="9.5" rx="2" stroke="currentColor" strokeWidth="1.5"/>
                  <path d="M6.5 8V5.5C6.5 3.567 8.067 2 10 2C11.933 2 13.5 3.567 13.5 5.5V8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  <circle cx="10" cy="12" r="1" fill="currentColor"/>
                  <path d="M10 13V14.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </button>
            ) : (
              <button
                className="composer-action-btn mic-btn"
                onClick={startRecording}
                title="Record voice message"
                aria-label="Record voice message"
              >
                <span className="material-icons">mic</span>
              </button>
            )}
          </div>
        </div>
      )}
    </footer>
  );
}
