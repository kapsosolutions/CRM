// The composer's + menu (WhatsApp style): Document, Photos & videos, Camera,
// Audio, Poll, Event, and the dialogs behind Camera, Poll and Event.
//
// WhatsApp's Cloud API has no native poll or event message, so the backend
// (services/chatExtras.js) sends a poll as tap-to-answer buttons or a list,
// and an event as its details with an "Add to calendar" button.
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { EventInput, PollInput } from '../types';
import { useBackHandler } from '../useBackHandler';
import { uiScale } from '../uiScale';
import './ComposerExtras.css';

const EmojiPicker = lazy(() => import('./FastEmojiPicker'));

// ---- icons (WhatsApp's) ----
const ICONS = {
  document: 'M9 18h6c.28 0 .52-.1.71-.29.2-.19.29-.43.29-.71 0-.28-.1-.52-.29-.71A.97.97 0 0 0 15 16H9c-.28 0-.52.1-.71.29A.94.94 0 0 0 8 17c0 .28.1.52.29.71.19.2.43.29.71.29Zm0-4h6c.28 0 .52-.1.71-.29.2-.19.29-.43.29-.71 0-.28-.1-.52-.29-.71A.97.97 0 0 0 15 12H9c-.28 0-.52.1-.71.29A.94.94 0 0 0 8 13c0 .28.1.52.29.71.19.2.43.29.71.29Zm-3 8c-.55 0-1.02-.2-1.41-.59-.4-.39-.59-.86-.59-1.41V4c0-.55.2-1.02.59-1.41C4.98 2.19 5.45 2 6 2h7.18a1.97 1.97 0 0 1 1.4.58l4.85 4.84a1.94 1.94 0 0 1 .57 1.4V20c0 .55-.2 1.02-.59 1.41-.39.4-.86.59-1.41.59H6Zm7-14c0 .28.1.52.29.71.19.2.43.29.71.29h4l-5-5v4Z',
  media: 'M13.25 12.5 12.1 11a.48.48 0 0 0-.4-.2c-.17 0-.3.07-.4.2l-1.68 2.2a.47.47 0 0 0-.06.53c.1.18.25.27.46.27h7.96c.21 0 .37-.1.46-.28.09-.18.07-.35-.07-.52l-2.42-3.17a.48.48 0 0 0-.4-.2c-.17 0-.3.06-.4.2l-1.9 2.47ZM8 18c-.55 0-1.02-.2-1.41-.59-.4-.39-.59-.86-.59-1.41V4c0-.55.2-1.02.59-1.41C6.98 2.19 7.45 2 8 2h12c.55 0 1.02.2 1.41.59.4.39.59.86.59 1.41v12c0 .55-.2 1.02-.59 1.41-.39.4-.86.59-1.41.59H8Zm-4 4c-.55 0-1.02-.2-1.41-.59-.4-.39-.59-.86-.59-1.41V7c0-.28.1-.52.29-.71.19-.2.43-.29.71-.29.28 0 .52.1.71.29.2.19.29.43.29.71v13h13c.28 0 .52.1.71.29.2.19.29.43.29.71 0 .28-.1.52-.29.71A.94.94 0 0 1 17 22H4Z',
  camera: 'M12 17.5c1.25 0 2.31-.44 3.19-1.31A4.34 4.34 0 0 0 16.5 13c0-1.25-.44-2.31-1.31-3.19A4.34 4.34 0 0 0 12 8.5c-1.25 0-2.31.44-3.19 1.31A4.34 4.34 0 0 0 7.5 13c0 1.25.44 2.31 1.31 3.19A4.34 4.34 0 0 0 12 17.5Zm0-2c-.7 0-1.3-.24-1.78-.72A2.41 2.41 0 0 1 9.5 13c0-.7.24-1.3.72-1.78A2.41 2.41 0 0 1 12 10.5a2.44 2.44 0 0 1 2.5 2.5 2.44 2.44 0 0 1-2.5 2.5ZM4 21c-.55 0-1.02-.2-1.41-.59-.4-.39-.59-.86-.59-1.41V7c0-.55.2-1.02.59-1.41C2.98 5.19 3.45 5 4 5h3.15L8.4 3.65A2 2 0 0 1 9.87 3h4.26a2 2 0 0 1 1.47.65L16.85 5H20c.55 0 1.02.2 1.41.59.4.39.59.86.59 1.41v12c0 .55-.2 1.02-.59 1.41-.39.4-.86.59-1.41.59H4Z',
  audio: 'M7 21H5c-.55 0-1.02-.2-1.41-.59-.4-.39-.59-.86-.59-1.41v-7c0-1.25.24-2.42.71-3.51A9.15 9.15 0 0 1 8.5 3.7 8.7 8.7 0 0 1 12 3a8.7 8.7 0 0 1 3.51.71A9.15 9.15 0 0 1 20.3 8.5 8.7 8.7 0 0 1 21 12v7c0 .55-.2 1.02-.59 1.41-.39.4-.86.59-1.41.59h-2c-.55 0-1.02-.2-1.41-.59-.4-.39-.59-.86-.59-1.41v-4c0-.55.2-1.02.59-1.41.39-.4.86-.59 1.41-.59h2v-1c0-1.95-.68-3.6-2.04-4.96A6.75 6.75 0 0 0 12 5c-1.95 0-3.6.68-4.96 2.04A6.75 6.75 0 0 0 5 12v1h2c.55 0 1.02.2 1.41.59.4.39.59.86.59 1.41v4c0 .55-.2 1.02-.59 1.41-.39.4-.86.59-1.41.59Z',
  poll: 'M4 18c0-.55.2-1.02.59-1.41.39-.4.86-.59 1.41-.59h3c.55 0 1.02.2 1.41.59.4.39.59.86.59 1.41 0 .55-.2 1.02-.59 1.41-.39.4-.86.59-1.41.59H6c-.55 0-1.02-.2-1.41-.59-.4-.39-.59-.86-.59-1.41Zm0-6c0-.55.2-1.02.59-1.41.39-.4.86-.59 1.41-.59h12c.55 0 1.02.2 1.41.59.4.39.59.86.59 1.41 0 .55-.2 1.02-.59 1.41-.39.4-.86.59-1.41.59H6c-.55 0-1.02-.2-1.41-.59-.4-.39-.59-.86-.59-1.41Zm0-6c0-.55.2-1.02.59-1.41C4.98 4.19 5.45 4 6 4h7c.55 0 1.02.2 1.41.59.4.39.59.86.59 1.41 0 .55-.2 1.02-.59 1.41-.39.4-.86.59-1.41.59H6c-.55 0-1.02-.2-1.41-.59C4.19 7.02 4 6.55 4 6Z',
  event: 'M5 22c-.55 0-1.02-.2-1.41-.59-.4-.39-.59-.86-.59-1.41V6c0-.55.2-1.02.59-1.41C3.98 4.19 4.45 4 5 4h1V3c0-.28.1-.52.29-.71.19-.2.43-.29.71-.29.28 0 .52.1.71.29.2.19.29.43.29.71v1h8V3c0-.28.1-.52.29-.71.19-.2.43-.29.71-.29.28 0 .52.1.71.29.2.19.29.43.29.71v1h1c.55 0 1.02.2 1.41.59.4.39.59.86.59 1.41v14c0 .55-.2 1.02-.59 1.41-.39.4-.86.59-1.41.59H5Zm0-2h14V10H5v10Zm7-6a.97.97 0 0 1-.71-.29A.97.97 0 0 1 11 13c0-.28.1-.52.29-.71.19-.2.43-.29.71-.29.28 0 .52.1.71.29.2.19.29.43.29.71 0 .28-.1.52-.29.71A.94.94 0 0 1 12 14Zm-4 0a.97.97 0 0 1-.71-.29A.97.97 0 0 1 7 13c0-.28.1-.52.29-.71.19-.2.43-.29.71-.29.28 0 .52.1.71.29.2.19.29.43.29.71 0 .28-.1.52-.29.71A.94.94 0 0 1 8 14Zm8 0a.97.97 0 0 1-.71-.29A.97.97 0 0 1 15 13c0-.28.1-.52.29-.71.19-.2.43-.29.71-.29.28 0 .52.1.71.29.2.19.29.43.29.71 0 .28-.1.52-.29.71A.94.94 0 0 1 16 14Zm-4 4a.97.97 0 0 1-.71-.29A.97.97 0 0 1 11 17c0-.28.1-.52.29-.71.19-.2.43-.29.71-.29.28 0 .52.1.71.29.2.19.29.43.29.71 0 .28-.1.52-.29.71A.94.94 0 0 1 12 18Zm-4 0a.97.97 0 0 1-.71-.29A.97.97 0 0 1 7 17c0-.28.1-.52.29-.71.19-.2.43-.29.71-.29.28 0 .52.1.71.29.2.19.29.43.29.71 0 .28-.1.52-.29.71A.94.94 0 0 1 8 18Zm8 0a.97.97 0 0 1-.71-.29A.97.97 0 0 1 15 17c0-.28.1-.52.29-.71.19-.2.43-.29.71-.29.28 0 .52.1.71.29.2.19.29.43.29.71 0 .28-.1.52-.29.71A.94.94 0 0 1 16 18Z',
  mic: 'M12 14a3 3 0 0 1-2.13-.87A3 3 0 0 1 9 11V5q0-1.25.87-2.12A3 3 0 0 1 12 2q1.25 0 2.12.88Q15 3.75 15 5v6q0 1.25-.88 2.13A3 3 0 0 1 12 14m-1 6v-2.07a6.8 6.8 0 0 1-3.94-1.95 7 7 0 0 1-1.99-3.95A.9.9 0 0 1 6 11q.42 0 .71.29.3.29.39.71a4.8 4.8 0 0 0 1.74 2.88A5 5 0 0 0 12 16q1.8 0 3.17-1.14A5 5 0 0 0 16.9 12q.1-.42.39-.71.29-.3.7-.29a.9.9 0 0 1 .93 1.03 7 7 0 0 1-5.92 5.9V20q0 .42-.29.71-.29.3-.71.29a1 1 0 0 1-.71-.29 1 1 0 0 1-.3-.71m1-8q.42 0 .71-.29.3-.29.29-.71V5q0-.42-.29-.71A1 1 0 0 0 12 4q-.42 0-.71.29-.3.29-.3.71v6q0 .42.3.71.29.3.7.29',
} as const;

export type ExtraIcon = keyof typeof ICONS;

export function ExtraSvg({ name, size = 18 }: { name: ExtraIcon; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true" preserveAspectRatio="xMidYMid meet">
      <path fill="currentColor" d={ICONS[name]} />
    </svg>
  );
}

export type AttachKind = 'document' | 'media' | 'camera' | 'audio' | 'poll' | 'event';

const ITEMS: { kind: AttachKind; label: string; icon: ExtraIcon }[] = [
  { kind: 'document', label: 'Document', icon: 'document' },
  { kind: 'media', label: 'Photos & videos', icon: 'media' },
  { kind: 'camera', label: 'Camera', icon: 'camera' },
  { kind: 'audio', label: 'Audio', icon: 'audio' },
  { kind: 'poll', label: 'Poll', icon: 'poll' },
  { kind: 'event', label: 'Event', icon: 'event' },
];

/** The + menu above the composer. `kinds` limits it (Messenger / Instagram have no polls). */
export function AttachMenu({ kinds, onPick, onClose }: { kinds: AttachKind[]; onPick: (k: AttachKind) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current && !ref.current.contains(t) && !(t as HTMLElement).closest?.('[data-attach-toggle]')) onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [onClose]);
  return (
    <div className="ax-menu" role="menu" ref={ref} data-testid="attach-menu">
      {ITEMS.filter((i) => kinds.includes(i.kind)).map((i) => (
        <button
          key={i.kind}
          type="button"
          role="menuitem"
          className={`ax-item ax-${i.kind}`}
          onClick={() => onPick(i.kind)}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
            e.preventDefault();
            const all = [...(ref.current?.querySelectorAll<HTMLButtonElement>('.ax-item') || [])];
            const at = all.indexOf(e.currentTarget);
            all[(at + (e.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length]?.focus();
          }}
          data-testid={`attach-${i.kind}`}
        >
          <span className="ax-ico"><ExtraSvg name={i.icon} /></span>
          {i.label}
        </button>
      ))}
    </div>
  );
}

// ---- shared dialog shell ----

function Sheet({ title, onClose, children, footer, testId }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; testId: string }) {
  useBackHandler(true, onClose);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !(e.target as HTMLElement)?.closest?.('.ax-emoji-pop')) onClose();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return createPortal(
    <div className="ax-overlay" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ax-sheet" role="dialog" aria-modal="true" aria-label={title} data-testid={testId}>
        <div className="ax-sheet-head">
          <button type="button" className="ax-x" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" /></svg>
          </button>
          <h3>{title}</h3>
        </div>
        <div className="ax-sheet-body">{children}</div>
        {footer && <div className="ax-sheet-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

function SendFab({ disabled, busy, onClick, label }: { disabled: boolean; busy: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" className="ax-fab" disabled={disabled || busy} onClick={onClick} aria-label={label} title={label} data-testid="ax-send">
      {busy ? <span className="ax-spin" aria-hidden="true" /> : (
        <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true"><path d="M3.4 20.4 20.85 12.92a1 1 0 0 0 0-1.84L3.4 3.6a.99.99 0 0 0-1.39.91L2 9.12c0 .5.37.93.87.99L17 12 2.87 13.88c-.5.07-.87.5-.87 1l.01 4.61c0 .71.73 1.2 1.39.91Z" /></svg>
      )}
    </button>
  );
}

/** A smiley button that inserts an emoji into a field (at the caret). */
function EmojiButton({ target, onInsert }: { target: () => HTMLInputElement | HTMLTextAreaElement | null; onInsert: (next: string, caret: number) => void }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null);
  useEffect(() => {
    if (!open) return undefined;
    const r = btn.current?.getBoundingClientRect();
    // Rects are screen px; fixed positions are the page's own px (CRM zoom).
    const s = uiScale();
    const vw = window.innerWidth / s;
    // Above the button, its right edge at the button's (the picker is ~352 px wide).
    if (r) setPos({ left: Math.max(8, Math.min(vw - 360, r.right / s - 352)), bottom: Math.max(8, window.innerHeight / s - r.top / s + 6) });
    const off = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest('.ax-emoji-pop') && t !== btn.current && !btn.current?.contains(t)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', off);
    window.addEventListener('keydown', esc, true);
    return () => {
      window.removeEventListener('pointerdown', off);
      window.removeEventListener('keydown', esc, true);
    };
  }, [open]);
  return (
    <>
      <button ref={btn} type="button" className="ax-emoji-btn" onClick={() => setOpen((v) => !v)} aria-label="Emoji" tabIndex={-1}>
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <circle cx="12" cy="12" r="9" /><circle cx="9" cy="10" r="1" fill="currentColor" /><circle cx="15" cy="10" r="1" fill="currentColor" />
          <path d="M8 14c.9 1.6 2.3 2.5 4 2.5s3.1-.9 4-2.5" strokeLinecap="round" />
        </svg>
      </button>
      {open && pos && createPortal(
        <div className="ax-emoji-pop" style={{ left: pos.left, bottom: pos.bottom }} data-testid="ax-emoji-pop">
          <Suspense fallback={<div className="ax-emoji-loading" />}>
            <EmojiPicker
              onSelect={(emoji: string) => {
                const el = target();
                const v = el?.value || '';
                const s = el?.selectionStart ?? v.length;
                const e = el?.selectionEnd ?? v.length;
                onInsert(v.slice(0, s) + emoji + v.slice(e), s + emoji.length);
              }}
            />
          </Suspense>
        </div>,
        document.body,
      )}
    </>
  );
}

function Toggle({ on, onChange, label, testId }: { on: boolean; onChange: (v: boolean) => void; label: string; testId?: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className={`ax-toggle${on ? ' on' : ''}`} onClick={() => onChange(!on)} data-testid={testId}>
      <span />
    </button>
  );
}

const focusAt = (el: HTMLInputElement | HTMLTextAreaElement | null, caret: number) => setTimeout(() => {
  el?.focus();
  el?.setSelectionRange(caret, caret);
}, 0);

// ---- Poll ----

export const POLL_MAX_OPTIONS = 10;
export const POLL_OPTION_MAX = 24;
const POLL_QUESTION_MAX = 255;

export function PollDialog({ onClose, onSend }: { onClose: () => void; onSend: (p: PollInput) => Promise<void> }) {
  const [question, setQuestion] = useState('');
  // Always one empty row at the end, like WhatsApp (until the limit).
  const [options, setOptions] = useState<string[]>(['', '']);
  const [multiple, setMultiple] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const qRef = useRef<HTMLInputElement>(null);
  const optRefs = useRef<(HTMLInputElement | null)[]>([]);
  const dragFrom = useRef<number | null>(null);
  useEffect(() => qRef.current?.focus(), []);

  const filled = options.map((o) => o.trim()).filter(Boolean);
  const dupe = filled.find((o, i) => filled.findIndex((x) => x.toLowerCase() === o.toLowerCase()) !== i);
  const ready = !!question.trim() && filled.length >= 2 && !dupe;

  const setOption = (i: number, v: string) => {
    setOptions((list) => {
      const next = list.map((x, j) => (j === i ? v : x));
      // Grow: a new empty row once the last one has text.
      if (next[next.length - 1].trim() && next.length < POLL_MAX_OPTIONS) next.push('');
      // Shrink: no more than one empty row at the end (keep two rows at least).
      while (next.length > 2 && !next[next.length - 1].trim() && !next[next.length - 2].trim()) next.pop();
      return next;
    });
  };

  async function send() {
    if (!ready || busy) return;
    setBusy(true);
    setError('');
    try {
      await onSend({ question: question.trim(), options: filled, multiple });
      onClose();
    } catch (e) {
      setError((e as Error).message || 'The poll wasn’t sent.');
      setBusy(false);
    }
  }

  return (
    <Sheet
      title="Create poll"
      onClose={onClose}
      testId="poll-dialog"
      footer={<SendFab disabled={!ready} busy={busy} onClick={() => void send()} label="Send poll" />}
    >
      <h4 className="ax-h">Question</h4>
      <div className="ax-line">
        <input
          ref={qRef}
          className="ax-input"
          placeholder="Ask question"
          value={question}
          maxLength={POLL_QUESTION_MAX}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && optRefs.current[0]?.focus()}
          data-testid="poll-question"
        />
        <EmojiButton target={() => qRef.current} onInsert={(v, c) => { setQuestion(v.slice(0, POLL_QUESTION_MAX)); focusAt(qRef.current, c); }} />
      </div>

      <h4 className="ax-h">Options</h4>
      {options.map((o, i) => (
        <div
          key={i}
          className="ax-line ax-option"
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => {
            const from = dragFrom.current;
            dragFrom.current = null;
            if (from === null || from === i) return;
            setOptions((list) => {
              const next = [...list];
              const [moved] = next.splice(from, 1);
              next.splice(i, 0, moved);
              // Keep the empty row last.
              const words = next.filter((x) => x.trim());
              const out = [...words];
              while (out.length < Math.max(2, Math.min(POLL_MAX_OPTIONS, words.length + 1))) out.push('');
              return out;
            });
          }}
          data-testid="poll-option-row"
        >
          <input
            ref={(el) => { optRefs.current[i] = el; }}
            className="ax-input"
            placeholder="Add text"
            value={o}
            maxLength={POLL_OPTION_MAX}
            onChange={(e) => setOption(i, e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && optRefs.current[i + 1]?.focus()}
            aria-label={`Option ${i + 1}`}
            data-testid="poll-option"
          />
          {o.length >= POLL_OPTION_MAX - 6 && <span className="ax-count">{POLL_OPTION_MAX - o.length}</span>}
          <EmojiButton target={() => optRefs.current[i]} onInsert={(v, c) => { setOption(i, v.slice(0, POLL_OPTION_MAX)); focusAt(optRefs.current[i], c); }} />
          <span
            className="ax-drag"
            draggable={!!o.trim()}
            onDragStart={() => { dragFrom.current = i; }}
            title="Drag to reorder"
            aria-hidden="true"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M4 9h16v2H4zm0 4h16v2H4z" /></svg>
          </span>
        </div>
      ))}
      {dupe && <div className="ax-error" role="alert">“{dupe}” is in the poll twice.</div>}

      <div className="ax-row-toggle">
        <span>Allow multiple answers</span>
        <Toggle on={multiple} onChange={setMultiple} label="Allow multiple answers" testId="poll-multiple" />
      </div>
      <p className="ax-note">
        WhatsApp shows the options as buttons the customer taps{filled.length > 3 ? ' (a list, with more than three)' : ''}. Their answer appears on the poll here. Up to {POLL_MAX_OPTIONS} options of {POLL_OPTION_MAX} characters.
      </p>
      {error && <div className="ax-error" role="alert" data-testid="ax-error">{error}</div>}
    </Sheet>
  );
}

// ---- Event ----

const pad = (n: number) => String(n).padStart(2, '0');
const dateValue = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeValue = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
/** The next half hour from now. */
function nextSlot(): Date {
  const d = new Date(Date.now() + 30 * 60 * 1000);
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0);
  return d;
}
const local = (date: string, time: string) => {
  const d = new Date(`${date}T${time || '00:00'}`);
  return Number.isNaN(d.getTime()) ? null : d;
};

export function EventDialog({ onClose, onSend, canCallLink }: { onClose: () => void; onSend: (e: EventInput) => Promise<void>; canCallLink: boolean }) {
  const first = useMemo(nextSlot, []);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState(dateValue(first));
  const [startTime, setStartTime] = useState(timeValue(first));
  const [hasEnd, setHasEnd] = useState(false);
  const [endDate, setEndDate] = useState(dateValue(first));
  const [endTime, setEndTime] = useState(timeValue(new Date(first.getTime() + 60 * 60 * 1000)));
  const [location, setLocation] = useState('');
  const [callLink, setCallLink] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => nameRef.current?.focus(), []);

  const start = local(startDate, startTime);
  const end = hasEnd ? local(endDate, endTime) : null;
  const endBad = hasEnd && (!end || !start || end <= start);
  const ready = !!name.trim() && !!start && !endBad;

  async function send() {
    if (!ready || busy || !start) return;
    setBusy(true);
    setError('');
    try {
      await onSend({
        name: name.trim(),
        description: description.trim(),
        start: start.toISOString(),
        end: end ? end.toISOString() : null,
        location: location.trim(),
        callLink,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata',
      });
      onClose();
    } catch (e) {
      setError((e as Error).message || 'The event wasn’t sent.');
      setBusy(false);
    }
  }

  return (
    <Sheet
      title="Create event"
      onClose={onClose}
      testId="event-dialog"
      footer={<SendFab disabled={!ready} busy={busy} onClick={() => void send()} label="Send event" />}
    >
      <div className="ax-line">
        <input ref={nameRef} className="ax-input" placeholder="Event name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} data-testid="event-name" />
        <EmojiButton target={() => nameRef.current} onInsert={(v, c) => { setName(v.slice(0, 100)); focusAt(nameRef.current, c); }} />
      </div>
      <div className="ax-area">
        <textarea ref={descRef} className="ax-textarea" placeholder="Description (optional)" value={description} maxLength={600} rows={3} onChange={(e) => setDescription(e.target.value)} data-testid="event-description" />
        <EmojiButton target={() => descRef.current} onInsert={(v, c) => { setDescription(v.slice(0, 600)); focusAt(descRef.current, c); }} />
      </div>

      <div className="ax-label">Start date and time</div>
      <div className="ax-pair">
        <input type="date" className="ax-input ax-date" value={startDate} min={dateValue(new Date())} onChange={(e) => setStartDate(e.target.value)} aria-label="Start date" data-testid="event-start-date" />
        <input type="time" className="ax-input ax-time" value={startTime} onChange={(e) => setStartTime(e.target.value)} aria-label="Start time" data-testid="event-start-time" />
      </div>
      {hasEnd ? (
        <>
          <div className="ax-label ax-label-row">
            End date and time
            <button type="button" className="ax-link" onClick={() => setHasEnd(false)}>Remove</button>
          </div>
          <div className="ax-pair">
            <input type="date" className="ax-input ax-date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} aria-label="End date" data-testid="event-end-date" />
            <input type="time" className="ax-input ax-time" value={endTime} onChange={(e) => setEndTime(e.target.value)} aria-label="End time" data-testid="event-end-time" />
          </div>
          {endBad && <div className="ax-error" role="alert">The event must end after it starts.</div>}
        </>
      ) : (
        <button type="button" className="ax-add" onClick={() => { setHasEnd(true); setEndDate(startDate); }} data-testid="event-add-end">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M11 19v-6H5v-2h6V5h2v6h6v2h-6v6z" /></svg>
          Add end time
        </button>
      )}

      <div className="ax-line">
        <input className="ax-input" placeholder="Location (optional)" value={location} maxLength={200} onChange={(e) => setLocation(e.target.value)} data-testid="event-location" />
        <span className="ax-pin" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" /><circle cx="12" cy="10" r="2.3" /></svg>
        </span>
      </div>

      <div className="ax-row-toggle">
        <span>
          WhatsApp call link
          <small>{canCallLink ? 'Adds a link that calls your WhatsApp number.' : 'Needs your own WhatsApp number.'}</small>
        </span>
        <Toggle on={callLink && canCallLink} onChange={(v) => canCallLink && setCallLink(v)} label="WhatsApp call link" testId="event-call-link" />
      </div>
      <p className="ax-note">The customer gets the event with an “Add to calendar” button.</p>
      {error && <div className="ax-error" role="alert" data-testid="ax-error">{error}</div>}
    </Sheet>
  );
}

// ---- Camera ----

export function CameraDialog({ onClose, onShot, onFallback }: { onClose: () => void; onShot: (f: File) => void; onFallback?: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('x'), { name: 'NotSupported' });
        const s = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
        if (!alive) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream.current = s;
        if (video.current) {
          video.current.srcObject = s;
          await video.current.play().catch(() => {});
        }
        setReady(true);
      } catch (e) {
        const n = (e as { name?: string }).name || '';
        setError(n === 'NotAllowedError' || n === 'SecurityError'
          ? 'The camera is blocked for this site. Click the camera icon in the address bar, choose Allow, then try again.'
          : n === 'NotFoundError' ? 'No camera found on this device.'
            : n === 'NotReadableError' ? 'Another app is using the camera.'
              : 'The camera couldn’t be started in this browser.');
      }
    })();
    return () => {
      alive = false;
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  function shoot() {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d')?.drawImage(v, 0, 0);
    c.toBlob((b) => {
      if (!b) return;
      stream.current?.getTracks().forEach((t) => t.stop());
      onShot(new File([b], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' }));
    }, 'image/jpeg', 0.92);
  }

  return (
    <Sheet title="Take photo" onClose={onClose} testId="camera-dialog">
      <div className="ax-cam">
        {error ? (
          <div className="ax-cam-error" role="alert" data-testid="camera-error">
            <span>{error}</span>
            {onFallback && (
              <button type="button" className="ax-cam-fallback" onClick={onFallback} data-testid="camera-fallback">
                Choose a photo instead
              </button>
            )}
          </div>
        ) : (
          <>
            <video ref={video} playsInline muted className="ax-cam-video" data-testid="camera-video" />
            {!ready && <div className="ax-cam-wait">Starting camera…</div>}
          </>
        )}
      </div>
      {!error && (
        <div className="ax-cam-actions">
          <button type="button" className="ax-shutter" onClick={shoot} disabled={!ready} aria-label="Take photo" data-testid="camera-shoot">
            <ExtraSvg name="camera" size={26} />
          </button>
        </div>
      )}
    </Sheet>
  );
}
