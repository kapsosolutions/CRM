// The ⋮ button at the right of the chat header and its menu, laid out like
// WhatsApp's: the chat's Manual / Bot switch; Mute notifications (8 hours,
// 1 week, Always), Add to favourites, Close chat; Block, Clear chat, Delete
// chat. Styled like the composer's + menu, dropping down from the top right.
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import type { MuteFor } from '../types';
import './ChatHeaderMenu.css';

/** Which action is on its way to the server (its row shows it). */
export type ChatMenuBusy = 'mute' | 'favourite' | 'block' | 'clear' | 'delete' | null;

type Props = {
  /** Bot replies are off for this chat (Manual). */
  paused: boolean;
  /** The Manual / Bot change is on its way to the server. */
  pausing: boolean;
  onTogglePause: () => void;
  mutedUntil?: string | null;
  onMute: (until: MuteFor | null) => void;
  favourite: boolean;
  onToggleFavourite: () => void;
  onCloseChat: () => void;
  blocked: boolean;
  onToggleBlock: () => void;
  /** Clear chat: messages go, the contact stays. */
  onClear: () => void;
  /** Delete chat: messages and the contact. */
  onDelete: () => void;
  busy?: ChatMenuBusy;
};

const MUTE_OPTIONS: { key: MuteFor; label: string }[] = [
  { key: '8h', label: '8 hours' },
  { key: '1w', label: '1 week' },
  { key: 'always', label: 'Always' },
];

/** "Muted always" / "Muted until 9:30 pm" / "Muted until Thu 12 Nov, 9:30 pm". */
export function mutedLabel(until: string | null | undefined, now = Date.now()): string {
  const t = until ? new Date(until).getTime() : 0;
  if (!(t > now)) return '';
  if (new Date(t).getUTCFullYear() >= 9999) return 'Muted always';
  const d = new Date(t);
  const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
  const sameDay = d.toDateString() === new Date(now).toDateString();
  if (sameDay) return `Muted until ${time}`;
  const day = d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  return `Muted until ${day}, ${time}`;
}

export const isMutedNow = (until: string | null | undefined, now = Date.now()) =>
  !!until && new Date(until).getTime() > now;

function Ico({ children, fill = 'none' }: { children: ReactNode; fill?: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill={fill} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}
const BELL = 'M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0';
const HEART = 'M12 20.3s-7.6-4.6-9.3-9.4C1.5 7.4 3.9 4.2 7.3 4.2c2 0 3.6 1.1 4.7 2.8 1.1-1.7 2.7-2.8 4.7-2.8 3.4 0 5.8 3.2 4.6 6.7-1.7 4.8-9.3 9.4-9.3 9.4z';
const IconBellOff = () => <Ico><path d={BELL} /><path d="M3 3l18 18" /></Ico>;
const IconBell = () => <Ico><path d={BELL} /></Ico>;
const IconHeart = ({ on }: { on: boolean }) => <Ico fill={on ? 'currentColor' : 'none'}><path d={HEART} /></Ico>;
const IconClose = () => <Ico><circle cx="12" cy="12" r="9" /><path d="M9 9l6 6M15 9l-6 6" /></Ico>;
const IconBlock = () => <Ico><circle cx="12" cy="12" r="9" /><path d="M5.6 5.6l12.8 12.8" /></Ico>;
const IconClear = () => <Ico><circle cx="12" cy="12" r="9" /><path d="M8 12h8" /></Ico>;
const IconTrash = () => (
  <Ico>
    <path d="M4 6.5h16M9.5 6.5V4.5h5v2M6 6.5l.9 12.1c.07.9.8 1.6 1.7 1.6h6.8c.9 0 1.63-.7 1.7-1.6L18 6.5M10 10.5v6M14 10.5v6" />
  </Ico>
);

export default function ChatHeaderMenu({
  paused, pausing, onTogglePause, mutedUntil, onMute, favourite, onToggleFavourite, onCloseChat,
  blocked, onToggleBlock, onClear, onDelete, busy = null,
}: Props) {
  const [open, setOpen] = useState(false);
  const [sub, setSub] = useState(false);
  const subRef = useRef(false);
  subRef.current = sub;
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const muteRowRef = useRef<HTMLButtonElement>(null);
  const subTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const muted = isMutedNow(mutedUntil);

  const close = useCallback((refocus = false) => {
    setOpen(false);
    setSub(false);
    if (refocus) btnRef.current?.focus();
  }, []);
  const closeSub = useCallback((refocus = false) => {
    setSub(false);
    if (refocus) muteRowRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      // The Mute submenu closes first, then the menu.
      if (subRef.current) closeSub(true);
      else close(true);
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      close();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    menuRef.current?.querySelector<HTMLElement>('[data-cm-main]')?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [open, close, closeSub]);
  useEffect(() => () => {
    if (subTimer.current) clearTimeout(subTimer.current);
  }, []);

  // Manual / Bot labels pick that side; anywhere else on the row flips it.
  const setMode = (bot: boolean) => {
    if (pausing) return;
    if (bot === paused) onTogglePause();
  };
  const flip = () => {
    if (!pausing) onTogglePause();
  };

  const openSub = (focusFirst: boolean) => {
    if (subTimer.current) clearTimeout(subTimer.current);
    setSub(true);
    if (focusFirst) setTimeout(() => menuRef.current?.querySelector<HTMLElement>('.cm-sub-item')?.focus(), 0);
  };
  // Hover opens it (with a little grace to cross the gap); a tap toggles it.
  const hoverSub = (on: boolean) => {
    if (muted || !window.matchMedia?.('(hover: hover) and (min-width: 561px)').matches) return;
    if (subTimer.current) clearTimeout(subTimer.current);
    if (on) setSub(true);
    else subTimer.current = setTimeout(() => setSub(false), 220);
  };

  const cycle = (e: ReactKeyboardEvent<HTMLElement>, selector: string) => {
    e.preventDefault();
    const all = [...(menuRef.current?.querySelectorAll<HTMLElement>(selector) || [])].filter((el) => !(el as HTMLButtonElement).disabled);
    const at = all.indexOf(e.currentTarget);
    all[(at + (e.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length]?.focus();
  };
  // A real <button> already clicks on Enter / Space; the switch row (a div) doesn't.
  const onItemKey = (e: ReactKeyboardEvent<HTMLElement>, activate?: () => void) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (sub) setSub(false);
      cycle(e, '[data-cm-main]');
    } else if (activate && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      activate();
    } else if (e.key === 'Tab') {
      close();
    }
  };
  const onMuteKey = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (!muted && (e.key === 'ArrowLeft' || e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      openSub(true);
      return;
    }
    onItemKey(e);
  };
  const onSubKey = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') cycle(e, '.cm-sub-item');
    else if (e.key === 'ArrowRight') {
      e.preventDefault();
      closeSub(true);
    } else if (e.key === 'Tab') close();
  };

  const act = (fn: () => void) => () => {
    close();
    fn();
  };
  const mutedText = mutedLabel(mutedUntil);

  return (
    <div className="th-more-anchor">
      <button
        ref={btnRef}
        type="button"
        className={`th-more${open ? ' open' : ''}`}
        onClick={() => (open ? close() : setOpen(true))}
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
            data-cm-main=""
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

          {/* Mute: a flyout with 8 hours / 1 week / Always; when muted, one tap unmutes. */}
          <div className="cm-has-sub" onMouseEnter={() => hoverSub(true)} onMouseLeave={() => hoverSub(false)}>
            <button
              ref={muteRowRef}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className={`cm-item${sub ? ' sub-open' : ''}${muted ? ' cm-muted' : ''}`}
              aria-haspopup={muted ? undefined : 'menu'}
              aria-expanded={muted ? undefined : sub}
              disabled={busy === 'mute'}
              onClick={() => {
                // A click only opens the options: with a mouse, hovering has
                // usually opened them already, and a toggle would shut them.
                if (muted) {
                  close();
                  onMute(null);
                } else openSub(false);
              }}
              onKeyDown={onMuteKey}
              data-testid="chat-menu-mute"
              data-cm-main=""
            >
              <span className="cm-ico">{muted ? <IconBell /> : <IconBellOff />}</span>
              <span className="cm-text">
                <span>{muted ? 'Unmute notifications' : 'Mute notifications'}</span>
                {muted && <span className="cm-caption" data-testid="chat-menu-muted-until">{mutedText}</span>}
              </span>
              {!muted && (
                <svg className="cm-caret" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                  <path d="M3.5 2l3 3-3 3" fill="currentColor" />
                </svg>
              )}
            </button>
            {sub && !muted && (
              <div className="cm-sub" role="menu" aria-label="Mute for" data-testid="chat-menu-mute-options">
                {MUTE_OPTIONS.map((o) => (
                  <button
                    key={o.key}
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    className="cm-sub-item"
                    onClick={act(() => onMute(o.key))}
                    onKeyDown={onSubKey}
                    data-testid={`chat-menu-mute-${o.key}`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className={`cm-item${favourite ? ' cm-fav-on' : ''}`}
            disabled={busy === 'favourite'}
            onClick={act(onToggleFavourite)}
            onKeyDown={(e) => onItemKey(e)}
            data-testid="chat-menu-favourite"
            data-cm-main=""
          >
            <span className="cm-ico cm-fav"><IconHeart on={favourite} /></span>
            {favourite ? 'Remove from favourites' : 'Add to favourites'}
          </button>

          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className="cm-item"
            onClick={act(onCloseChat)}
            onKeyDown={(e) => onItemKey(e)}
            data-testid="chat-menu-close"
            data-cm-main=""
          >
            <span className="cm-ico"><IconClose /></span>
            Close chat
          </button>

          <div className="cm-sep" role="separator" />

          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className={`cm-item ${blocked ? 'cm-unblock' : 'cm-danger'}`}
            disabled={busy === 'block'}
            onClick={act(onToggleBlock)}
            onKeyDown={(e) => onItemKey(e)}
            data-testid="chat-menu-block"
            data-cm-main=""
          >
            <span className="cm-ico"><IconBlock /></span>
            {busy === 'block' ? (blocked ? 'Unblocking…' : 'Blocking…') : blocked ? 'Unblock' : 'Block'}
          </button>

          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className="cm-item cm-danger"
            disabled={busy === 'clear'}
            onClick={act(onClear)}
            onKeyDown={(e) => onItemKey(e)}
            data-testid="chat-menu-clear"
            data-cm-main=""
          >
            <span className="cm-ico"><IconClear /></span>
            {busy === 'clear' ? 'Clearing…' : 'Clear chat'}
          </button>

          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className="cm-item cm-danger cm-delete"
            disabled={busy === 'delete'}
            onClick={act(onDelete)}
            onKeyDown={(e) => onItemKey(e)}
            data-testid="chat-menu-delete"
            data-cm-main=""
          >
            <span className="cm-ico"><IconTrash /></span>
            {busy === 'delete' ? 'Deleting…' : 'Delete chat'}
          </button>
        </div>
      )}
    </div>
  );
}
