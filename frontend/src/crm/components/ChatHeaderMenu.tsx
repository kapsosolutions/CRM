// The ⋮ button at the right of the chat header and its menu: the chat's
// Manual / Bot switch and "Delete chat". Styled like the composer's + menu,
// but drops down from the top right.
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import './ChatHeaderMenu.css';

type Props = {
  /** Bot replies are off for this chat (Manual). */
  paused: boolean;
  /** The Manual / Bot change is on its way to the server. */
  pausing: boolean;
  onTogglePause: () => void;
  deleting: boolean;
  onDelete: () => void;
};

export default function ChatHeaderMenu({ paused, pausing, onTogglePause, deleting, onDelete }: Props) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const close = useCallback((refocus = false) => {
    setOpen(false);
    if (refocus) btnRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close(true);
      }
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      close();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    menuRef.current?.querySelector<HTMLElement>('.cm-item')?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [open, close]);

  // Manual / Bot labels pick that side; anywhere else on the row flips it.
  const setMode = (bot: boolean) => {
    if (pausing) return;
    if (bot === paused) onTogglePause();
  };
  const flip = () => {
    if (!pausing) onTogglePause();
  };

  // A real <button> already clicks on Enter / Space; the switch row (a div) doesn't.
  const onItemKey = (e: ReactKeyboardEvent<HTMLElement>, activate?: () => void) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const all = [...(menuRef.current?.querySelectorAll<HTMLElement>('.cm-item') || [])];
      const at = all.indexOf(e.currentTarget);
      all[(at + (e.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length]?.focus();
    } else if (activate && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      activate();
    } else if (e.key === 'Tab') {
      close();
    }
  };

  return (
    <div className="th-more-anchor">
      <button
        ref={btnRef}
        type="button"
        className={`th-more${open ? ' open' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Chat options"
        title="Chat options"
        data-testid="chat-menu-btn"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="12" cy="5" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="12" cy="19" r="2" />
        </svg>
      </button>

      {open && (
        <div className="cm-menu" role="menu" aria-label="Chat options" ref={menuRef} data-testid="chat-menu">
          <div
            role="menuitemcheckbox"
            aria-checked={!paused}
            aria-disabled={pausing || undefined}
            tabIndex={-1}
            className={`cm-item cm-auto${pausing ? ' busy' : ''}`}
            onClick={flip}
            onKeyDown={(e) => onItemKey(e, flip)}
            title={!paused ? 'Bot is replying — switch to Manual' : 'Manual mode — switch to Bot'}
            data-testid="bot-toggle"
          >
            <span className={`cm-ico ${paused ? 'manual' : 'bot'}`}>
              <span className="material-icons" aria-hidden="true">{paused ? 'support_agent' : 'smart_toy'}</span>
            </span>
            <span className="cm-auto-group bot-toggle-group">
              <span
                className={`bot-toggle-label manual${paused ? ' active' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setMode(false);
                }}
              >
                Manual
              </span>
              <span className="switch" aria-hidden="true">
                <input type="checkbox" checked={!paused} disabled={pausing} readOnly tabIndex={-1} />
                <span className="slider">
                  <span className="circle">
                    <svg className="cross" viewBox="0 0 365.696 365.696" height="6" width="6" xmlns="http://www.w3.org/2000/svg">
                      <path
                        fill="currentColor"
                        d="M243.188 182.86 356.32 69.726c12.5-12.5 12.5-32.766 0-45.247L341.238 9.398c-12.504-12.503-32.77-12.503-45.25 0L182.86 122.528 69.727 9.374c-12.5-12.5-32.766-12.5-45.247 0L9.375 24.457c-12.5 12.504-12.5 32.77 0 45.25l113.152 113.152L9.398 295.99c-12.503 12.503-12.503 32.769 0 45.25L24.48 356.32c12.5 12.5 32.766 12.5 45.247 0l113.132-113.132L295.99 356.32c12.503 12.5 32.769 12.5 45.25 0l15.081-15.082c12.5-12.504 12.5-32.77 0-45.25zm0 0"
                      />
                    </svg>
                    <svg className="checkmark" viewBox="0 0 24 24" height="10" width="10" xmlns="http://www.w3.org/2000/svg">
                      <path
                        fill="currentColor"
                        d="M9.707 19.121a.997.997 0 0 1-1.414 0l-5.646-5.647a1.5 1.5 0 0 1 0-2.121l.707-.707a1.5 1.5 0 0 1 2.121 0L9 14.171l9.525-9.525a1.5 1.5 0 0 1 2.121 0l.707.707a1.5 1.5 0 0 1 0 2.121z"
                      />
                    </svg>
                  </span>
                </span>
              </span>
              <span
                className={`bot-toggle-label bot${!paused ? ' active' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setMode(true);
                }}
              >
                Bot
              </span>
            </span>
          </div>

          <div className="cm-sep" role="separator" />

          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className="cm-item cm-delete"
            disabled={deleting}
            onClick={() => {
              close();
              onDelete();
            }}
            onKeyDown={(e) => onItemKey(e)}
            data-testid="chat-menu-delete"
          >
            <span className="cm-ico">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="M3.5 5.5H16.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <path d="M8 5.5V3.5H12V5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M5 5.5L5.8 16C5.86 16.84 6.56 17.5 7.4 17.5H12.6C13.44 17.5 14.14 16.84 14.2 16L15 5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M8 8.5V14.5M12 8.5V14.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </span>
            {deleting ? 'Deleting…' : 'Delete chat'}
          </button>
        </div>
      )}
    </div>
  );
}
