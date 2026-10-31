// Emoji reaction picker. Shows a quick row first, then a full grid on "more".
import { useState } from 'react';
import { QUICK_EMOJIS, ALL_EMOJIS } from '../emojis';

interface Props {
  direction: 'in' | 'out';
  hasReaction: boolean;
  onPick: (emoji: string) => void;
  onClose: () => void;
}

export function ReactionPicker({ direction, hasReaction, onPick, onClose }: Props) {
  const [showAll, setShowAll] = useState(false);
  const side = direction === 'out' ? 'out' : 'in';

  return (
    <>
      <div className="react-backdrop" onClick={onClose} />
      {!showAll ? (
        <div className={`react-picker ${side}`}>
          {QUICK_EMOJIS.map((e) => (
            <button key={e} className="rp-emoji" onClick={() => onPick(e)}>
              {e}
            </button>
          ))}
          <button
            className="rp-emoji rp-more"
            onClick={() => setShowAll(true)}
            title="More"
          >
            <span className="material-icons">add</span>
          </button>
          {hasReaction && (
            <button className="rp-emoji rp-x" onClick={() => onPick('')}>
              <span className="material-icons">close</span>
            </button>
          )}
        </div>
      ) : (
        <div className={`emoji-grid ${side}`}>
          {ALL_EMOJIS.map((e) => (
            <button key={e} className="rp-emoji" onClick={() => onPick(e)}>
              {e}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
