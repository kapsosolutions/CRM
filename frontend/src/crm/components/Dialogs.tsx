// App-wide confirm dialogs + toast notifications.
//
// Replaces the browser's own confirm()/alert() popups, which can't be styled,
// block the whole tab and look different in every browser. The dialog uses the
// same card as "Discard changes?"; results show as toasts in the top-right.
//
//   const confirm = useConfirm();
//   if (!(await confirm({ title: 'Delete template?', message: '…' }))) return;
//
//   const notify = useNotify();
//   notify('success', 'Template deleted');
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ToastStack, useToasts, type ToastKind } from './Toast';
import { useBackHandler } from '../useBackHandler';
import './Dialogs.css';

export interface ConfirmOptions {
  title: string;
  /** One short paragraph saying what's at stake. */
  message?: ReactNode;
  /** Optional bullet list (e.g. everything a delete removes). */
  points?: string[];
  confirmLabel?: string;
  cancelLabel?: string;
  /** 'danger' for deletes and other one-way actions (red button). */
  tone?: 'danger' | 'primary';
}

type Notify = (kind: ToastKind, title: string, text?: string) => void;
type Confirm = (opts: ConfirmOptions) => Promise<boolean>;

const DialogCtx = createContext<{ confirm: Confirm; notify: Notify } | null>(null);

// Outside a provider (shouldn't happen) fall back to the browser's own, so a
// missing wrapper degrades instead of silently skipping a delete prompt.
const fallback = {
  confirm: (o: ConfirmOptions) => Promise.resolve(window.confirm(o.title)),
  notify: () => {},
};

/** Ask the user to confirm; resolves true when they do. */
export function useConfirm(): Confirm {
  return (useContext(DialogCtx) || fallback).confirm;
}
/** Show a toast in the top-right corner. */
export function useNotify(): Notify {
  return (useContext(DialogCtx) || fallback).notify;
}

/**
 * Toast from one sentence-style message ("Offer saved. 3 products updated in
 * WhatsApp."): the first sentence becomes the title, the rest the detail line.
 */
export function useFlash(): (message: string, kind?: ToastKind) => void {
  const notify = useNotify();
  return useCallback(
    (message: string, kind: ToastKind = 'success') => {
      const m = String(message || '').trim();
      const cut = m.search(/[.!—](\s|$)/);
      const title = cut > 0 ? m.slice(0, cut + (m[cut] === '—' ? 0 : 1)).trim() : m;
      const rest = cut > 0 ? m.slice(cut + 1).replace(/^[\s—]+/, '').trim() : '';
      notify(kind, title, rest || undefined);
    },
    [notify],
  );
}

interface Pending extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

export function DialogProvider({ children }: { children: ReactNode }) {
  const { toasts, push, dismiss } = useToasts();
  const [pending, setPending] = useState<Pending | null>(null);

  const confirm = useCallback<Confirm>(
    (opts) =>
      new Promise<boolean>((resolve) => {
        setPending((cur) => {
          // A second prompt while one is open: the first counts as cancelled.
          cur?.resolve(false);
          return { ...opts, resolve };
        });
      }),
    [],
  );
  const notify = useCallback<Notify>((kind, title, text) => push(kind, title, text), [push]);

  const close = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };

  return (
    <DialogCtx.Provider value={{ confirm, notify }}>
      {children}
      {pending && <ConfirmDialog opts={pending} onClose={close} />}
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </DialogCtx.Provider>
  );
}

function ConfirmDialog({ opts, onClose }: { opts: ConfirmOptions; onClose: (ok: boolean) => void }) {
  const titleId = useId();
  const textId = useId();
  const okRef = useRef<HTMLButtonElement>(null);
  const danger = (opts.tone || 'danger') === 'danger';
  // Browser Back answers "Cancel", like Esc.
  useBackHandler(true, () => onClose(false));

  useEffect(() => {
    // Focus the action so Enter confirms; remember what had focus to restore it.
    const prev = document.activeElement as HTMLElement | null;
    okRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="disc-backdrop app-dialog" onClick={() => onClose(false)}>
      <div
        className="disc-box"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={opts.message || opts.points ? textId : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="disc-title" id={titleId}>{opts.title}</div>
        {(opts.message || opts.points?.length) && (
          <div id={textId}>
            {opts.message && <p className="disc-text">{opts.message}</p>}
            {opts.points && opts.points.length > 0 && (
              <ul className="disc-points">
                {opts.points.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className="disc-actions">
          <button type="button" className="disc-cancel" onClick={() => onClose(false)}>
            {opts.cancelLabel || 'Cancel'}
          </button>
          <button
            type="button"
            ref={okRef}
            className={`disc-discard${danger ? ' danger' : ''}`}
            onClick={() => onClose(true)}
          >
            {opts.confirmLabel || (danger ? 'Delete' : 'Confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
