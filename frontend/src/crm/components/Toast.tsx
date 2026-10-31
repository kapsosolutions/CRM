// Toast notifications for the chat page: a white card with a wave accent, a
// round icon, a title + sub-text and a close button. Stacks in the top-right
// corner, slides in from the right and dismisses itself after a few seconds.
import { useCallback, useEffect, useRef, useState } from 'react';

export type ToastKind = 'success' | 'error';

export interface ToastItem {
  id: number;
  kind: ToastKind;
  title: string;
  text?: string;
  leaving?: boolean;
}

const LIFETIME_MS = 4000;
const EXIT_MS = 260; // keep in sync with the .toast-card.leaving animation

/** Toast state for one page: push() to show, dismiss() to close early. */
export function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const remove = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
    timers.current.delete(id);
  }, []);

  const dismiss = useCallback(
    (id: number) => {
      const pending = timers.current.get(id);
      if (pending) clearTimeout(pending);
      // Play the exit animation first, then drop it.
      setToasts((list) => list.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
      timers.current.set(id, setTimeout(() => remove(id), EXIT_MS));
    },
    [remove],
  );

  const push = useCallback(
    (kind: ToastKind, title: string, text?: string) => {
      seq.current += 1;
      const id = seq.current;
      // Newest on top; cap the stack so a burst of failures can't fill the screen.
      setToasts((list) => [{ id, kind, title, text }, ...list].slice(0, 4));
      timers.current.set(id, setTimeout(() => dismiss(id), LIFETIME_MS));
    },
    [dismiss],
  );

  useEffect(() => {
    const map = timers.current;
    return () => map.forEach((t) => clearTimeout(t));
  }, []);

  return { toasts, push, dismiss };
}

interface Props {
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
}

export function ToastStack({ toasts, onDismiss }: Props) {
  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast-card ${t.kind}${t.leaving ? ' leaving' : ''}`}
          role={t.kind === 'error' ? 'alert' : 'status'}
        >
          <svg className="toast-wave" viewBox="0 0 1440 320" aria-hidden="true">
            <path d="M0,256L48,240C96,224,192,192,288,197.3C384,203,480,245,576,250.7C672,256,768,224,864,186.7C960,149,1056,107,1152,112C1248,117,1344,171,1392,197.3L1440,224L1440,320L0,320Z" />
          </svg>
          <div className="toast-icon">
            {t.kind === 'success' ? (
              <svg viewBox="0 0 512 512" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M256 48a208 208 0 1 1 0 416 208 208 0 1 1 0-416zm0 464A256 256 0 1 0 256 0a256 256 0 1 0 0 512zm113-303c9.4-9.4 9.4-24.6 0-33.9s-24.6-9.4-33.9 0l-111 111-47-47c-9.4-9.4-24.6-9.4-33.9 0s-9.4 24.6 0 33.9l64 64c9.4 9.4 24.6 9.4 33.9 0L369 209z"
                />
              </svg>
            ) : (
              <svg viewBox="0 0 512 512" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M256 48a208 208 0 1 1 0 416 208 208 0 1 1 0-416zm0 464A256 256 0 1 0 256 0a256 256 0 1 0 0 512zm-81-337c-9.4 9.4-9.4 24.6 0 33.9l47 47-47 47c-9.4 9.4-9.4 24.6 0 33.9s24.6 9.4 33.9 0l47-47 47 47c9.4 9.4 24.6 9.4 33.9 0s9.4-24.6 0-33.9l-47-47 47-47c9.4-9.4 9.4-24.6 0-33.9s-24.6-9.4-33.9 0l-47 47-47-47c-9.4-9.4-24.6-9.4-33.9 0z"
                />
              </svg>
            )}
          </div>
          <div className="toast-text">
            <p className="toast-title">{t.title}</p>
            {t.text && <p className="toast-sub">{t.text}</p>}
          </div>
          <button
            type="button"
            className="toast-close"
            onClick={() => onDismiss(t.id)}
            aria-label="Dismiss notification"
          >
            <svg viewBox="0 0 15 15" aria-hidden="true">
              <path
                fill="currentColor"
                fillRule="evenodd"
                clipRule="evenodd"
                d="M11.78 4.03a.75.75 0 0 0-1.06-1.06L7.5 6.19 4.28 2.97a.75.75 0 0 0-1.06 1.06L6.44 7.25 3.22 10.47a.75.75 0 1 0 1.06 1.06L7.5 8.31l3.22 3.22a.75.75 0 1 0 1.06-1.06L8.56 7.25l3.22-3.22z"
              />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
