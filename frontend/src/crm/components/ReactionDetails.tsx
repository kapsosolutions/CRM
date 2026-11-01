// "2 reactions": who reacted to a message with what, like WhatsApp Web's
// panel. Opened from a message's reaction chip. Tabs filter by emoji; the
// business's own row says "Click to remove" and removes it.
//
// Rendered into document.body at the chip's position (fixed), so the message
// list's scroll box never clips it; it closes on scroll, resize or Escape.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { uiScale } from '../uiScale';
import { DefaultAvatar } from './DefaultAvatar';

export interface ReactionPerson {
  name: string;
  /** Second line (a phone number, or the WhatsApp name). */
  sub?: string;
  avatarUrl?: string;
  channel?: string;
}

export interface ReactionRow {
  emoji: string;
  by: 'customer' | 'you' | '';
}

interface Props {
  anchor: HTMLElement;
  reactions: ReactionRow[];
  customer: ReactionPerson;
  you: ReactionPerson;
  /** Removes the business's reaction. */
  onRemove: () => void;
  onClose: () => void;
  side: 'in' | 'out';
}

const WIDTH = 340;
const GAP = 8;

export function ReactionDetails({ anchor, reactions, customer, you, onRemove, onClose, side }: Props) {
  const [tab, setTab] = useState<string>('all');
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // Emoji tabs with counts, in the order they were given.
  const counts: { emoji: string; n: number }[] = [];
  for (const r of reactions) {
    const c = counts.find((x) => x.emoji === r.emoji);
    if (c) c.n += 1;
    else counts.push({ emoji: r.emoji, n: 1 });
  }
  // "You" first, as WhatsApp lists it.
  const rows = [...reactions]
    .sort((a, b) => (a.by === 'you' ? -1 : b.by === 'you' ? 1 : 0))
    .filter((r) => tab === 'all' || r.emoji === tab);

  // Placed above the chip when it fits, else below; kept inside the window.
  useLayoutEffect(() => {
    const s = uiScale();
    const a = anchor.getBoundingClientRect();
    const r = { left: a.left / s, right: a.right / s, top: a.top / s, bottom: a.bottom / s };
    const viewW = window.innerWidth / s;
    const viewH = window.innerHeight / s;
    const h = boxRef.current?.offsetHeight || 220;
    const width = Math.min(WIDTH, viewW - 16);
    let left = side === 'out' ? r.right - width : r.left;
    left = Math.max(8, Math.min(left, viewW - width - 8));
    if (r.top - GAP - h >= 8) setPos({ left, bottom: viewH - r.top + GAP });
    else setPos({ left, top: Math.min(r.bottom + GAP, viewH - h - 8) });
  }, [anchor, side, reactions.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onMove = (e: Event) => {
      // Scrolling inside the panel itself is fine.
      if (boxRef.current && e.target instanceof Node && boxRef.current.contains(e.target)) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  const person = (r: ReactionRow): ReactionPerson =>
    r.by === 'you' ? you : r.by === 'customer' ? customer : { name: 'Reaction', sub: '' };

  return createPortal(
    <>
      <div className="rx-backdrop" onClick={onClose} />
      <div
        ref={boxRef}
        className="rx-panel"
        role="dialog"
        aria-label={`${reactions.length} reaction${reactions.length === 1 ? '' : 's'}`}
        data-testid="reaction-details"
        style={{
          left: pos?.left ?? -9999,
          top: pos?.top ?? 'auto',
          bottom: pos?.bottom ?? 'auto',
          width: WIDTH,
          visibility: pos ? 'visible' : 'hidden',
        }}
      >
        <div className="rx-title">
          {reactions.length} reaction{reactions.length === 1 ? '' : 's'}
        </div>
        <div className="rx-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'all'}
            className={`rx-tab rx-tab-all${tab === 'all' ? ' on' : ''}`}
            onClick={() => setTab('all')}
            title="All"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <circle cx="9" cy="10.5" r="6.75" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="6.8" cy="9" r="0.9" fill="currentColor" />
              <circle cx="11.2" cy="9" r="0.9" fill="currentColor" />
              <path d="M6 12.4c.7 1.3 1.7 2 3 2s2.3-.7 3-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <path d="M16 1.5v4M14 3.5h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
          {counts.map((c) => (
            <button
              type="button"
              role="tab"
              key={c.emoji}
              aria-selected={tab === c.emoji}
              className={`rx-tab${tab === c.emoji ? ' on' : ''}`}
              onClick={() => setTab(c.emoji)}
            >
              <span className="rx-tab-emoji">{c.emoji}</span>
              <span className="rx-tab-n">{c.n}</span>
            </button>
          ))}
        </div>
        <div className="rx-list">
          {rows.map((r) => {
            const p = person(r);
            const mine = r.by === 'you';
            const body = (
              <>
                <span className="rx-av">
                  {mine ? (
                    p.avatarUrl ? (
                      <img src={p.avatarUrl} alt="" />
                    ) : (
                      <span className="rx-av-initial">{(p.name || 'Y').trim().charAt(0).toUpperCase()}</span>
                    )
                  ) : (
                    <DefaultAvatar channel={p.channel || 'whatsapp'} photoUrl={p.avatarUrl} />
                  )}
                </span>
                <span className="rx-who">
                  <span className="rx-name">{mine ? 'You' : p.name}</span>
                  {mine ? <span className="rx-sub">Click to remove</span> : p.sub ? <span className="rx-sub">{p.sub}</span> : null}
                </span>
                <span className="rx-emoji">{r.emoji}</span>
              </>
            );
            return mine ? (
              <button
                type="button"
                key={`${r.by}-${r.emoji}`}
                className="rx-row mine"
                onClick={() => {
                  onRemove();
                  onClose();
                }}
                data-testid="reaction-remove"
              >
                {body}
              </button>
            ) : (
              <div className="rx-row" key={`${r.by}-${r.emoji}`}>
                {body}
              </div>
            );
          })}
        </div>
      </div>
    </>,
    document.body,
  );
}
