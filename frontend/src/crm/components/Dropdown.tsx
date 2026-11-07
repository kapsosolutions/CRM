// Themed dropdown that replaces the native <select> so the option list matches
// the WhatsApp design system. Controlled component.
//
// The panel is rendered into document.body rather than next to its trigger.
// Absolutely positioning it inside the trigger's own box looks simpler but
// breaks in two ways that both showed up in the flow builder, where the
// inspector is a scrolling column inside an `overflow: hidden` grid:
//
//   • an ancestor with `overflow: hidden` clips the panel, so options near the
//     bottom of a panel were cut off or invisible entirely;
//   • the click-outside layer was `position: fixed; inset: 0`, which sits over
//     the scroll container and swallows the wheel, so the list could not be
//     scrolled to reach the options it was hiding.
//
// A portal with viewport coordinates has no clipping ancestor, and closing on
// an outside mousedown instead of an overlay leaves scrolling untouched.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { uiScale } from '../uiScale';
import './Dropdown.css';

export interface KOption {
  value: string;
  label: string;
  icon?: ReactNode;
}

interface Props {
  options: KOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  size?: 'sm' | 'md';
  /** A search box on top of the list (long lists such as languages). */
  searchable?: boolean;
  searchPlaceholder?: string;
}

/** Keep the panel inside the viewport: flip above when below won't fit. */
const GAP = 6;
const MIN_PANEL = 140;
const MAX_PANEL = 280;

interface PanelBox {
  left: number;
  top?: number;
  bottom?: number;
  width: number;
  maxHeight: number;
}

export function Dropdown({
  options,
  value,
  onChange,
  placeholder = 'Select',
  disabled,
  className = '',
  size = 'md',
  searchable = false,
  searchPlaceholder = 'Search…',
}: Props) {
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState<PanelBox | null>(null);
  const [query, setQuery] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLUListElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const selected = options.find((o) => o.value === value);
  // Matches the label or the value (a language name or its code).
  const q = query.trim().toLowerCase();
  const shown = searchable && q
    ? options.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q))
    : options;

  // The panel appears once it has been placed (box): then focus the search
  // and bring the chosen option into view.
  const shownPanel = open && box !== null;
  useEffect(() => {
    if (!open) {
      setQuery('');
      return;
    }
    if (!shownPanel) return;
    if (searchable) searchRef.current?.focus({ preventScroll: true });
    panelRef.current?.querySelector('.dd-option.active')?.scrollIntoView({ block: 'nearest' });
  }, [open, shownPanel, searchable]);

  const place = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    // Rects are in screen px; the panel's styles are in CSS px (they differ in the 90% view).
    const s = uiScale();
    const b = el.getBoundingClientRect();
    const r = { left: b.left / s, top: b.top / s, bottom: b.bottom / s, width: b.width / s };
    const viewH = window.innerHeight / s;
    const below = viewH - r.bottom - GAP;
    const above = r.top - GAP;
    // Prefer below, but flip up when space below is cramped and more room exists above
    const flip = below < 240 && above > below;
    const space = Math.max(MIN_PANEL, flip ? above : below);
    const maxHeight = Math.min(MAX_PANEL, space);
    setBox({
      left: r.left,
      top: flip ? undefined : r.bottom + GAP,
      bottom: flip ? viewH - r.top + GAP : undefined,
      width: Math.max(r.width, size === 'sm' ? 140 : r.width),
      maxHeight,
    });
  }, [size]);

  // Measured before paint so the panel never appears in the wrong place first.
  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  // Isolate wheel scrolling so moving the mouse wheel over the options does not scroll the background page or Lenis
  useEffect(() => {
    const panel = panelRef.current;
    if (!open || !panel) return;

    const onWheel = (e: WheelEvent) => {
      e.stopPropagation();
      const { scrollTop, scrollHeight, clientHeight } = panel;
      const isDown = e.deltaY > 0;
      const isUp = e.deltaY < 0;
      if (
        (isDown && scrollTop + clientHeight >= scrollHeight) ||
        (isUp && scrollTop <= 0)
      ) {
        e.preventDefault();
      }
    };

    panel.addEventListener('wheel', onWheel, { passive: false });
    return () => panel.removeEventListener('wheel', onWheel);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    // Capture, so the panel follows its trigger when any ancestor scrolls —
    // scroll events from inner containers don't bubble.
    const onScroll = () => place();

    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open, place]);

  return (
    <div className={`dd ${size === 'sm' ? 'sm' : ''} ${className}`.trim()}>
      <button
        ref={triggerRef}
        type="button"
        className={`dd-trigger${size === 'sm' ? ' sm' : ''}${open ? ' open' : ''}`}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => !disabled && setOpen((v) => !v)}
      >
        <span className={`dd-value${selected ? '' : ' placeholder'}`}>
          {selected ? (
            selected.icon ? (
              <span className="dd-opt-with-icon">
                {selected.icon}
                <span>{selected.label}</span>
              </span>
            ) : (
              selected.label
            )
          ) : (
            placeholder
          )}
        </span>
        <span className="material-icons">expand_more</span>
      </button>
      {open && box
        && createPortal(
          <ul
            ref={panelRef}
            className={`dd-panel dd-panel-fixed${size === 'sm' ? ' dd-panel-sm' : ''}`}
            role="listbox"
            data-lenis-prevent
            data-lenis-prevent-wheel
            data-lenis-prevent-touch
            style={{
              left: box.left,
              top: box.top !== undefined ? box.top : 'auto',
              bottom: box.bottom !== undefined ? box.bottom : 'auto',
              width: box.width,
              maxHeight: box.maxHeight,
            }}
          >
            {searchable && (
              <li className="dd-search" role="presentation">
                <input
                  ref={searchRef}
                  type="search"
                  value={query}
                  placeholder={searchPlaceholder}
                  aria-label={searchPlaceholder}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && shown[0]) {
                      e.preventDefault();
                      onChange(shown[0].value);
                      setOpen(false);
                    }
                  }}
                  data-testid="dd-search"
                />
              </li>
            )}
            {shown.length === 0 && <li className="dd-option empty">{options.length ? 'No match' : 'Nothing to choose'}</li>}
            {shown.map((o) => (
              <li
                key={o.value}
                className={`dd-option${o.value === value ? ' active' : ''}`}
                role="option"
                aria-selected={o.value === value}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
              >
                {o.icon ? (
                  <span className="dd-opt-with-icon">
                    {o.icon}
                    <span>{o.label}</span>
                  </span>
                ) : (
                  o.label
                )}
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </div>
  );
}
