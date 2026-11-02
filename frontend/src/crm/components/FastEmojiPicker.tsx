// The chat composer's emoji picker. Replaces emoji-mart, whose web component
// draws the grid row by row as you scroll (blank rows, then emoji) and
// re-renders on every prop push. Here every emoji is a plain button, laid out
// once while the browser is idle (Composer builds the picker hidden), so
// scrolling only moves pixels: no layout, and no JavaScript beyond
// highlighting the current category. Tab clicks glide to the category.
// Data: src/crm/emojiData.ts (build/make-emoji-data.mjs).
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EMOJI_BY_ID, EMOJI_CATEGORIES } from '../emojiData';
import { onSprites, requestSprites, sheetReady, spriteFor } from '../emojiSprites';
import { uiScale } from '../uiScale';
import './FastEmojiPicker.css';

interface Emoji {
  /** The emoji without a skin tone. */
  n: string;
  v: number;
  /** Lower-case search words, space-separated, with a leading space. */
  s: string;
  /** Skin-tone variants 1-5, when it has them. */
  k: string[] | null;
}
interface Category {
  id: string;
  name: string;
  icon: string;
  emojis: Emoji[];
}

const ICONS: Record<string, string> = {
  recent: 'schedule',
  people: 'sentiment_satisfied',
  nature: 'pets',
  foods: 'restaurant',
  activity: 'sports_basketball',
  places: 'directions_car',
  objects: 'lightbulb',
  symbols: 'emoji_symbols',
  flags: 'flag',
};
const RECENT_KEY = 'crm_emoji_recent';
const SKIN_KEY = 'crm_emoji_skin';
const RECENT_MAX = 27; // three rows
const SEARCH_MAX = 120;
const SKIN_COLORS = ['#ffc93a', '#ffdab7', '#e7b98f', '#c88c61', '#a46134', '#5d4437'];
// The old picker's starting "frequently used".
const DEFAULT_RECENT = ['+1', 'grinning', 'kissing_heart', 'heart_eyes', 'laughing', 'stuck_out_tongue_winking_eye', 'sweat_smile', 'joy', 'scream', 'disappointed', 'unamused', 'weary', 'sob', 'sunglasses', 'heart'];

// ---- What this device can draw (checked once, ~10 tiny canvas draws) ----
// Emoji newer than the system's emoji font show as boxes, and Windows has no
// country flags (they show as two letters), so those are left out.
const VERSION_MARKERS: [number, string][] = [
  [15, '\u{1FAE8}'], [14, '\u{1FAE0}'], [13.1, '\u{1F636}\u200D\u{1F32B}\uFE0F'], [13, '\u{1F978}'],
  [12.1, '\u{1F9D1}\u200D\u{1F9B0}'], [12, '\u{1F971}'], [11, '\u{1F970}'], [5, '\u{1F929}'],
  [4, '\u{1F471}\u200D\u2640\uFE0F'], [3, '\u{1F923}'], [2, '\u{1F44B}\u{1F3FB}'], [1, '\u{1F643}'],
];
function supportChecker(): (e: string) => boolean {
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  } catch {
    /* no canvas */
  }
  if (!ctx) return () => true;
  const W = 20;
  const H = 25;
  ctx.canvas.width = W * 2;
  ctx.canvas.height = H;
  ctx.font = '12px Arial, sans-serif';
  ctx.textBaseline = 'top';
  const c = ctx;
  return (e) => {
    c.clearRect(0, 0, W * 2, H);
    c.fillStyle = '#FF0000';
    c.fillText(e, 0, 22);
    c.fillStyle = '#0000FF';
    c.fillText(e, W, 22);
    const a = c.getImageData(0, 0, W, H).data;
    let i = 0;
    for (; i < a.length && !a[i + 3]; i += 4);
    if (i >= a.length) return false;
    // A colour emoji ignores fillStyle: both copies have the same colour.
    const b = c.getImageData(W + ((i / 4) % W), Math.floor(i / 4 / W), 1, 1).data;
    if (a[i] !== b[0] || a[i + 2] !== b[2]) return false;
    // Not drawn as one glyph (e.g. a sequence the font doesn't join).
    return c.measureText(e).width < W;
  };
}

const isCountryFlag = (e: string) => /[\u{1F1E6}-\u{1F1FF}\u{E0061}-\u{E007F}]/u.test(e);

let parsed: { categories: Category[]; byNative: Map<string, Emoji> } | null = null;
function emojiData() {
  if (parsed) return parsed;
  const supported = supportChecker();
  const maxVersion = VERSION_MARKERS.find(([, e]) => supported(e))?.[0] ?? 15;
  const flags = supported('\u{1F1E8}\u{1F1E6}');
  const byNative = new Map<string, Emoji>();
  const categories: Category[] = [];
  for (const c of EMOJI_CATEGORIES) {
    const emojis: Emoji[] = [];
    for (const line of c.list.split('\n')) {
      const [n, v, s, k] = line.split('\t');
      if (Number(v) > maxVersion) continue;
      if (!flags && c.id === 'flags' && isCountryFlag(n)) continue;
      const e: Emoji = { n, v: Number(v), s: ` ${s}`, k: k ? k.split(' ') : null };
      emojis.push(e);
      byNative.set(n, e);
    }
    if (emojis.length) categories.push({ id: c.id, name: c.name, icon: ICONS[c.id] || 'mood', emojis });
  }
  parsed = { categories, byNative };
  return parsed;
}

const readJson = <T,>(key: string): T | null => {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
};
const writeJson = (key: string, v: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* private mode / full */
  }
};

/** Recently used emoji (base form), newest first. Carries over emoji-mart's list once. */
function loadRecent(byNative: Map<string, Emoji>): string[] {
  const own = readJson<string[]>(RECENT_KEY);
  if (Array.isArray(own)) return own.filter((n) => byNative.has(n)).slice(0, RECENT_MAX);
  const old = readJson<Record<string, number>>('emoji-mart.frequently');
  const ids = old ? Object.entries(old).sort((a, b) => b[1] - a[1]).map(([id]) => id) : DEFAULT_RECENT;
  return ids.map((id) => EMOJI_BY_ID[id]).filter((n): n is string => !!n && byNative.has(n)).slice(0, RECENT_MAX);
}
function loadSkin(): number {
  const own = readJson<number>(SKIN_KEY);
  if (typeof own === 'number' && own >= 0 && own <= 5) return own;
  const old = readJson<number>('emoji-mart.skin'); // 1-6
  return typeof old === 'number' && old >= 1 && old <= 6 ? old - 1 : 0;
}

const show = (e: Emoji, skin: number) => (skin > 0 && e.k ? e.k[skin - 1] || e.n : e.n);

interface LenisLike {
  scrollTo: (to: number, o?: object) => void;
  resize: () => void;
}
/** The Lenis instance on this box, if the CRM's smooth scrolling attached one (useAppSmoothScroll). */
const lenisOf = (el: HTMLElement): LenisLike | undefined =>
  (window as unknown as { __crmLenis?: Map<HTMLElement, LenisLike> }).__crmLenis?.get(el);

/** An emoji as an image tile from its sheet (emojiSprites.ts), or as text until the sheet is ready. */
function EmojiFace({ ch }: { ch: string }) {
  const s = spriteFor(ch);
  if (!s) return <>{ch}</>;
  return (
    <span
      className="fep-img"
      style={{
        backgroundImage: `url(${s.url})`,
        backgroundSize: `${s.w / s.scale}px ${s.h / s.scale}px`,
        backgroundPosition: `-${s.x / s.scale}px -${s.y / s.scale}px`,
      }}
    />
  );
}

/** One category's grid. Memoised: re-renders when the skin tone or its sheet changes. */
const Grid = memo(function Grid({ emojis, skin }: { emojis: Emoji[]; skin: number; ver: number }) {
  return (
    <div className="fep-grid">
      {emojis.map((e) => {
        const ch = show(e, skin);
        return (
          <button key={e.n} type="button" className="fep-e" data-e={ch} data-base={e.n} aria-label={ch}>
            <EmojiFace ch={ch} />
          </button>
        );
      })}
    </div>
  );
});

function Picker({ pick }: { pick: { current: (e: string) => void } }) {
  const { categories, byNative } = emojiData();
  const [skin, setSkin] = useState(loadSkin);
  const [skinOpen, setSkinOpen] = useState(false);
  const [recent, setRecent] = useState(() => loadRecent(byNative));
  const [query, setQuery] = useState('');
  const [active, setActive] = useState('recent');
  const scrollRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Image sheets: one per category, plus the chosen skin tone's variants.
  // Each sheet that arrives redraws only its own category.
  const [sheetVer, setSheetVer] = useState(0);
  useEffect(() => onSprites(() => setSheetVer((v) => v + 1)), []);
  useEffect(() => {
    const sheets = categories.map((c) => ({ key: c.id, list: c.emojis.map((e) => e.n) }));
    if (skin > 0) {
      const list = categories.flatMap((c) => c.emojis.filter((e) => e.k).map((e) => e.k![skin - 1])).filter(Boolean);
      sheets.unshift({ key: `skin-${skin}`, list });
    }
    requestSprites(sheets, uiScale());
  }, [categories, skin]);
  // A category redraws only when its own sheet (or, for emoji with skin
  // tones, the skin sheet) arrives, not on every sheet.
  const gridVer = (c: Category) =>
    (sheetReady(c.id) ? 1 : 0) + (skin > 0 && c.emojis.some((e) => e.k) && sheetReady(`skin-${skin}`) ? 2 : 0);

  // "Recently used" keeps the order it had when the picker was built; a pick
  // goes to the front the next time (so the grid doesn't jump under the cursor).
  const [shownRecent, setShownRecent] = useState(recent);
  const recentEmojis = useMemo(() => shownRecent.map((n) => byNative.get(n)).filter((e): e is Emoji => !!e), [shownRecent, byNative]);
  const all = useMemo(
    () => (recentEmojis.length ? [{ id: 'recent', name: 'Frequently used', icon: ICONS.recent, emojis: recentEmojis }, ...categories] : categories),
    [recentEmojis, categories],
  );

  const results = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return null;
    const out: Emoji[] = [];
    for (const c of categories) {
      for (const e of c.emojis) {
        if (terms.every((t) => e.s.includes(` ${t}`) || e.n === t)) {
          out.push(e);
          if (out.length >= SEARCH_MAX) return out;
        }
      }
    }
    return out;
  }, [query, categories]);

  const onPick = useCallback(
    (ev: React.MouseEvent) => {
      const b = (ev.target as HTMLElement).closest<HTMLButtonElement>('button[data-e]');
      if (!b) return;
      pick.current(b.dataset.e || '');
      const base = b.dataset.base || '';
      setRecent((r) => {
        const next = [base, ...r.filter((x) => x !== base)].slice(0, RECENT_MAX);
        writeJson(RECENT_KEY, next);
        return next;
      });
    },
    [pick],
  );
  // The new order shows once the picker is out of sight (next open).
  useEffect(() => {
    const el = scrollRef.current?.closest('.emoji-pop');
    if (!el) return undefined;
    const obs = new MutationObserver(() => {
      if (el.classList.contains('is-hidden')) {
        setShownRecent(recent);
        setQuery('');
        setSkinOpen(false);
      }
    });
    obs.observe(el, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, [recent]);

  // Category tops, read once per layout (not on every scroll frame).
  const tops = useRef<{ id: string; top: number }[]>([]);
  const readTops = useCallback(() => {
    const s = scrollRef.current;
    tops.current = s ? [...s.querySelectorAll<HTMLElement>('section[data-cat]')].map((sec) => ({ id: sec.dataset.cat || '', top: sec.offsetTop })) : [];
    // Lenis (the CRM's smooth wheel scrolling) measures the scroll height only
    // when the box resizes; this box keeps its size while its list changes.
    if (s) lenisOf(s)?.resize();
  }, []);
  useEffect(() => {
    readTops();
  }, [all, results, readTops]);

  // A tab click scrolls there smoothly; until it arrives, that tab stays lit
  // (instead of flicking through every category on the way).
  const jumping = useRef<{ id: string; until: number } | null>(null);
  const glide = useRef(0);
  const jumped = useRef('');
  // Highlight the category in view (one read per frame while scrolling).
  const onScroll = useCallback(() => {
    const s = scrollRef.current;
    if (!s || s.dataset.ticking) return;
    s.dataset.ticking = '1';
    requestAnimationFrame(() => {
      delete s.dataset.ticking;
      if (jumping.current && performance.now() < jumping.current.until) return;
      jumping.current = null;
      const list = tops.current;
      const atBottom = s.scrollTop + s.clientHeight >= s.scrollHeight - 2;
      let cur = '';
      if (atBottom && list.length) {
        // The last categories can't reach the top: keep the clicked one lit.
        const j = list.find((t) => t.id === jumped.current && t.top >= s.scrollTop - 8);
        cur = (j || list[list.length - 1]).id;
      } else {
        jumped.current = '';
        const top = s.scrollTop + 8;
        for (const t of list) {
          if (t.top <= top) cur = t.id;
          else break;
        }
      }
      if (cur) setActive((a) => (a === cur ? a : cur));
    });
  }, []);

  const jump = (id: string) => {
    const go = () => {
      const s = scrollRef.current;
      if (!s) return;
      readTops();
      const t = tops.current.find((x) => x.id === id);
      if (!t) return;
      const target = Math.min(t.top, s.scrollHeight - s.clientHeight);
      const dist = Math.abs(target - s.scrollTop);
      // 0.25 s for a short hop, up to 0.55 s across the whole list.
      const duration = Math.min(0.55, 0.25 + dist / 12000);
      jumped.current = id;
      jumping.current = { id, until: performance.now() + duration * 1000 + 120 };
      setActive(id);
      // The CRM's smooth wheel scrolling (Lenis) drives this box once it has
      // been hovered; go through it so the two don't fight.
      const ease = (x: number) => 1 - Math.pow(1 - x, 3);
      const lenis = lenisOf(s);
      if (lenis) {
        lenis.scrollTo(target, { duration, easing: ease });
        return;
      }
      // Same glide without Lenis (touch screens, reduced motion is handled below).
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
        s.scrollTop = target;
        return;
      }
      const from = s.scrollTop;
      const t0 = performance.now();
      const run = ++glide.current;
      const frame = (now: number) => {
        if (run !== glide.current) return; // another tab click, or the wheel
        const p = Math.min(1, (now - t0) / (duration * 1000));
        s.scrollTop = from + (target - from) * ease(p);
        if (p < 1) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    };
    if (query) {
      setQuery('');
      requestAnimationFrame(() => requestAnimationFrame(go));
    } else go();
  };
  const activeIndex = results ? -1 : all.findIndex((c) => c.id === active);

  const pickSkin = (i: number) => {
    setSkin(i);
    writeJson(SKIN_KEY, i);
    setSkinOpen(false);
  };

  return (
    <div className="fep" data-testid="fast-emoji-picker">
      <nav className="fep-nav" aria-label="Emoji categories">
        {all.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`fep-tab${!results && active === c.id ? ' active' : ''}`}
            title={c.name}
            aria-label={c.name}
            onClick={() => jump(c.id)}
          >
            <span className="material-icons" aria-hidden="true">
              {c.icon}
            </span>
          </button>
        ))}
        <span
          className="fep-ink"
          aria-hidden="true"
          style={{
            width: `calc((100% - 20px) / ${all.length})`,
            transform: `translateX(${Math.max(0, activeIndex) * 100}%)`,
            opacity: activeIndex < 0 ? 0 : 1,
          }}
        />
      </nav>
      <div className="fep-search-row">
        <label className="fep-search">
          <span className="material-icons" aria-hidden="true">
            search
          </span>
          <input
            ref={searchRef}
            type="search"
            placeholder="Search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search emoji"
            data-testid="fep-search"
          />
        </label>
        <div className="fep-skin">
          <button
            type="button"
            className="fep-skin-dot"
            style={{ background: SKIN_COLORS[skin] }}
            title="Skin tone"
            aria-label="Skin tone"
            aria-expanded={skinOpen}
            onClick={() => setSkinOpen((v) => !v)}
          />
          {skinOpen && (
            <div className="fep-skin-menu" role="menu">
              {SKIN_COLORS.map((c, i) => (
                <button
                  key={c}
                  type="button"
                  role="menuitemradio"
                  aria-checked={skin === i}
                  className={`fep-skin-dot${skin === i ? ' on' : ''}`}
                  style={{ background: c }}
                  onClick={() => pickSkin(i)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
      <div
        className="fep-scroll"
        ref={scrollRef}
        onScroll={onScroll}
        onClick={onPick}
        // The user scrolls during a tab glide: theirs wins.
        onWheel={() => {
          glide.current += 1;
          jumping.current = null;
        }}
        data-testid="fep-scroll"
      >
        {results ? (
          results.length ? (
            <section className="fep-sec fep-results">
              <div className="fep-title">Search results</div>
              <Grid emojis={results} skin={skin} ver={sheetVer} />
            </section>
          ) : (
            <div className="fep-empty">No emoji found</div>
          )
        ) : (
          all.map((c) => (
            <section key={c.id} className="fep-sec" data-cat={c.id}>
              <div className="fep-title">{c.name}</div>
              <Grid emojis={c.emojis} skin={skin} ver={c.id === 'recent' ? sheetVer : gridVer(c)} />
            </section>
          ))
        )}
      </div>
    </div>
  );
}

const MemoPicker = memo(Picker);

export default function FastEmojiPicker({ onSelect }: { onSelect: (emoji: string) => void }) {
  const pick = useRef(onSelect);
  pick.current = onSelect;
  return <MemoPicker pick={pick} />;
}
