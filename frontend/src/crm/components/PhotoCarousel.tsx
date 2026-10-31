// Product photos the way WhatsApp shows them: one at a time, advancing every
// few seconds, with ‹ › arrows to step through manually.
//
// Shared by the catalog grid and the product editor preview so a product looks
// the same in both places.
import { useEffect, useState } from 'react';

interface Props {
  photos: string[];
  /** Milliseconds between automatic advances. */
  intervalMs?: number;
  /** Arrows + dots. Off for small cards where they'd crowd the image. */
  controls?: boolean;
  /** Stop auto-advancing while the pointer is over the image. */
  pauseOnHover?: boolean;
}

export function PhotoCarousel({
  photos,
  intervalMs = 3000,
  controls = true,
  pauseOnHover = true,
}: Props) {
  const [at, setAt] = useState(0);
  const [paused, setPaused] = useState(false);

  // Keep the index in range as photos are added or removed.
  useEffect(() => {
    setAt((n) => (photos.length ? Math.min(n, photos.length - 1) : 0));
  }, [photos.length]);

  useEffect(() => {
    if (paused || photos.length < 2) return;
    const id = setInterval(() => setAt((n) => (n + 1) % photos.length), intervalMs);
    return () => clearInterval(id);
  }, [paused, photos.length, intervalMs]);

  if (!photos.length) return <span className="material-icons">image</span>;

  const step = (d: number) => setAt((n) => (n + d + photos.length) % photos.length);
  const many = photos.length > 1;

  return (
    <div
      className="pc-wrap"
      onMouseEnter={pauseOnHover ? () => setPaused(true) : undefined}
      onMouseLeave={pauseOnHover ? () => setPaused(false) : undefined}
    >
      {/* All photos sit side by side and the track slides, so moving between
          them reads as a swipe rather than the image cutting to the next. */}
      <div className="pc-track" style={{ transform: `translate3d(-${at * 100}%, 0, 0)` }}>
        {photos.map((src, i) => (
          <img className="pc-img" src={src} alt="" key={src + i} loading={i === 0 ? undefined : 'lazy'} />
        ))}
      </div>
      {many && controls && (
        <>
          <button type="button" className="pc-arrow left" onClick={() => step(-1)} aria-label="Previous photo">
            <span className="material-icons">chevron_left</span>
          </button>
          <button type="button" className="pc-arrow right" onClick={() => step(1)} aria-label="Next photo">
            <span className="material-icons">chevron_right</span>
          </button>
        </>
      )}
      {many && (
        <div className="pc-dots">
          {photos.map((p, i) => (
            <button
              type="button"
              key={p + i}
              className={`pc-dot${i === at ? ' on' : ''}`}
              onClick={() => setAt(i)}
              aria-label={`Photo ${i + 1}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
