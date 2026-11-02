// Emoji reaction picker: a quick row first; "+" opens the full emoji picker
// (the composer's FastEmojiPicker: search, categories, skin tones).
//
// The full picker is rendered into document.body at a fixed position next to
// the message, above it when it fits, else below, always inside the window:
// inside the message list it was clipped by the list's top edge.
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { QUICK_EMOJIS } from '../emojis';
import { uiScale } from '../uiScale';

const FullPicker = lazy(() => import('./FastEmojiPicker'));

interface Props {
  direction: 'in' | 'out';
  hasReaction: boolean;
  onPick: (emoji: string) => void;
  onClose: () => void;
}

// FastEmojiPicker's size (FastEmojiPicker.css).
const W = 352;
const H = 435;
const GAP = 8;

export function ReactionPicker({ direction, hasReaction, onPick, onClose }: Props) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const side = direction === 'out' ? 'out' : 'in';

  return (
    <>
      <div className="react-backdrop" onClick={onClose} />
      {!anchor ? (
        <div className={`react-picker ${side}`}>
          {QUICK_EMOJIS.map((e) => (
            <button key={e} className="rp-emoji" onClick={() => onPick(e)}>
              {e}
            </button>
          ))}
          <button
            className="rp-emoji rp-more"
            // Anchored to the whole message, not the row that's about to go.
            onClick={(e) => setAnchor((e.currentTarget.closest('.msg-col') as HTMLElement) || e.currentTarget)}
            title="More"
            aria-label="More emoji"
            data-testid="rp-more"
          >
            <span className="material-icons">add</span>
          </button>
          {hasReaction && (
            <button className="rp-emoji rp-x" onClick={() => onPick('')} title="Remove reaction">
              <span className="material-icons">close</span>
            </button>
          )}
        </div>
      ) : (
        <FullReactionPicker anchor={anchor} side={side} onPick={onPick} onClose={onClose} />
      )}
    </>
  );
}

function FullReactionPicker({
  anchor,
  side,
  onPick,
  onClose,
}: {
  anchor: HTMLElement;
  side: 'in' | 'out';
  onPick: (emoji: string) => void;
  onClose: () => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Above the message when it fits, else below, else as high as the window allows.
  useLayoutEffect(() => {
    const s = uiScale();
    const a = anchor.getBoundingClientRect();
    const r = { left: a.left / s, right: a.right / s, top: a.top / s, bottom: a.bottom / s };
    const viewW = window.innerWidth / s;
    const viewH = window.innerHeight / s;
    const w = Math.min(W, viewW - 16);
    const h = Math.min(H, viewH - 16);
    let left = side === 'out' ? r.right - w : r.left;
    left = Math.max(8, Math.min(left, viewW - w - 8));
    let top: number;
    if (r.top - GAP - h >= 8) top = r.top - GAP - h;
    else if (r.bottom + GAP + h <= viewH - 8) top = r.bottom + GAP;
    else top = Math.max(8, viewH - h - 8);
    setPos({ left, top });
  }, [anchor, side]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    // The chat scrolling away from the message closes it (it would float off).
    const onScroll = (e: Event) => {
      if (boxRef.current && e.target instanceof Node && boxRef.current.contains(e.target)) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  return createPortal(
    <>
      <div className="rp-full-backdrop" onClick={onClose} />
      <div
        ref={boxRef}
        className="rp-full"
        role="dialog"
        aria-label="React with an emoji"
        data-testid="reaction-full-picker"
        style={{ left: pos?.left ?? -9999, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden' }}
      >
        <Suspense fallback={<div className="emoji-pop-loading" role="status" aria-label="Loading emoji" />}>
          <FullPicker onSelect={onPick} />
        </Suspense>
      </div>
    </>,
    document.body,
  );
}
