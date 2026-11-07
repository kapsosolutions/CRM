// Super-admin → Events: festive or seasonal themes for the website and the
// CRM. An event holds images / GIFs and words for:
//   the landing page hero (background, side art, badge, title, description, colour)
//   every other website page's hero (background)
//   the floating WhatsApp button (its own image) and the website logo
//   the CRM sidebar logo (light and dark theme) and a CRM announcement bar
// One event is live at a time (optionally only between two dates). Preview
// shows a saved event on the site / the demo CRM in this browser only.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type DragEvent, type ReactNode } from 'react';
import { platformApi, type SiteEventRow, type SiteEventStatus } from './platformApi';
import { useImageRatio, type EventTheme, type LiveEvent } from '../event/liveEvent';
import { EventAnnouncement } from '../crm/components/EventAnnouncement';
import { useConfirm, useNotify } from '../crm/components/Dialogs';
import { CloseIcon, ImageIcon } from './AdminIcons';
import '../event/event.css';
import './EventsPage.css';

type AnnItem = { text: string; linkLabel: string; linkUrl: string; bg: string; color: string; image: string };
type Theme = {
  logos: { site: string; crmLight: string; crmDark: string };
  landing: { heroBg: string; heroBgTablet: string; heroBgMobile: string; heroArt: string; badge: string; titleAccent: string; titleMain: string; desc: string; accent: string; tone: 'dark' | 'light'; overlay: number };
  pages: { heroBg: string; heroBgTablet: string; heroBgMobile: string; tone: 'dark' | 'light'; overlay: number };
  whatsapp: { image: string; tooltip: string };
  /** Shown one after another in the CRM, `seconds` each. */
  announcement: { enabled: boolean; seconds: number; items: AnnItem[] };
};

/** CRM announcements an event may have (the server's MAX_ANNOUNCEMENTS). */
const MAX_ANNOUNCEMENTS = 5;
const blankItem = (): AnnItem => ({ text: '', linkLabel: '', linkUrl: '', bg: '#16a34a', color: '#ffffff', image: '' });

const blankTheme = (): Theme => ({
  logos: { site: '', crmLight: '', crmDark: '' },
  landing: { heroBg: '', heroBgTablet: '', heroBgMobile: '', heroArt: '', badge: '', titleAccent: '', titleMain: '', desc: '', accent: '', tone: 'dark', overlay: 0 },
  pages: { heroBg: '', heroBgTablet: '', heroBgMobile: '', tone: 'dark', overlay: 0 },
  whatsapp: { image: '', tooltip: '' },
  announcement: { enabled: false, seconds: 6, items: [blankItem()] },
});

/** A saved theme over the blank one, so every field has a value. */
function fullTheme(t: EventTheme = {}): Theme {
  const b = blankTheme();
  const a = t.announcement || {};
  // An event saved before the list: its single announcement is the first item.
  const saved = Array.isArray(a.items) && a.items.length ? a.items : [a];
  const items: AnnItem[] = saved.map((x) => ({
    text: x.text || '', linkLabel: x.linkLabel || '', linkUrl: x.linkUrl || '', bg: x.bg || '#16a34a', color: x.color || '#ffffff', image: x.image || '',
  }));
  return {
    logos: { ...b.logos, ...t.logos },
    landing: { ...b.landing, ...t.landing } as Theme['landing'],
    pages: { ...b.pages, ...t.pages } as Theme['pages'],
    whatsapp: { ...b.whatsapp, ...t.whatsapp },
    announcement: { enabled: !!a.enabled, seconds: Number(a.seconds) || 6, items: items.length ? items : [blankItem()] },
  };
}

interface Draft {
  id?: string;
  name: string;
  startsAt: string; // datetime-local
  endsAt: string;
  theme: Theme;
}

const STATUS: Record<SiteEventStatus, { label: string; tone: string; hint: string }> = {
  live: { label: 'Live', tone: 'on', hint: 'Showing on the website and in the CRM now' },
  scheduled: { label: 'Scheduled', tone: 'num-amber', hint: 'Switched on; starts at its start date' },
  ended: { label: 'Ended', tone: 'num-red', hint: 'Switched on, but its end date has passed' },
  off: { label: 'Off', tone: 'off', hint: 'Not shown' },
};

const pad = (n: number) => String(n).padStart(2, '0');
/** ISO → the value of an <input type="datetime-local"> in this computer's time. */
function toLocalInput(iso?: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);
const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

const previewUrls = (id: string) => ({
  landing: `/?eventPreview=${id}`,
  pages: `/pricing?eventPreview=${id}`,
  crm: `/?eventPreview=${id}#/demo`,
});

// ------------------------------------------------------------------ image field

const ACCEPT = 'image/png,image/jpeg,image/gif,image/webp';
const MAX_BYTES = 10 * 1024 * 1024;

function ImageField({ label, hint, value, onChange, dark = false, round = false, testId }: {
  label: string; hint?: string; value: string; onChange: (url: string) => void; dark?: boolean; round?: boolean; testId: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function take(file?: File | null) {
    if (!file) return;
    setError('');
    if (!ACCEPT.split(',').includes(file.type)) return setError('Use a JPG, PNG, GIF or WebP image.');
    if (file.size > MAX_BYTES) return setError('The image can be at most 10 MB.');
    setBusy(true);
    try {
      onChange(await platformApi.uploadEventImage(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }
  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    take(e.dataTransfer.files?.[0]);
  };

  return (
    <div className="pa-field evp-image" data-testid={testId}>
      <span>{label}</span>
      <div
        className={`evp-drop${over ? ' over' : ''}${dark ? ' dark' : ''}${value ? ' has' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
      >
        {value ? (
          <img src={value} alt="" className={round ? 'round' : ''} />
        ) : (
          <div className="evp-drop-empty">
            <ImageIcon />
            <small>Drop an image or GIF here</small>
          </div>
        )}
        {busy && <div className="evp-drop-busy">Uploading…</div>}
      </div>
      <div className="evp-image-actions">
        <button type="button" className="pa-btn ghost sm" onClick={() => input.current?.click()} disabled={busy}>
          {value ? 'Replace' : 'Upload'}
        </button>
        {value && (
          <button type="button" className="pa-btn ghost sm" onClick={() => onChange('')} disabled={busy}>
            Remove
          </button>
        )}
        <input ref={input} type="file" accept={ACCEPT} hidden onChange={(e) => take(e.target.files?.[0])} data-testid={`${testId}-input`} />
      </div>
      {error ? <small className="evp-error">{error}</small> : hint ? <small className="pa-hint">{hint}</small> : null}
    </div>
  );
}

function Section({ title, sub, children, aside }: { title: string; sub: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="pa-form evp-section">
      <div className="evp-section-head">
        <h2>{title}</h2>
        <p>{sub}</p>
      </div>
      <div className={aside ? 'evp-section-split' : undefined}>
        <div className="pa-form-grid">{children}</div>
        {aside && <div className="evp-aside">{aside}</div>}
      </div>
    </section>
  );
}

function ToneField({ value, onChange, testId }: { value: 'dark' | 'light'; onChange: (v: 'dark' | 'light') => void; testId: string }) {
  return (
    <label className="pa-field">
      <span>Hero text colour</span>
      <select value={value} onChange={(e) => onChange(e.target.value as 'dark' | 'light')} data-testid={testId}>
        <option value="dark">Dark text (for light backgrounds)</option>
        <option value="light">White text (for dark backgrounds)</option>
      </select>
    </label>
  );
}

function OverlayField({ value, onChange, tone, testId }: { value: number; onChange: (n: number) => void; tone: 'dark' | 'light'; testId: string }) {
  return (
    <label className="pa-field">
      <span>Readability wash: {value}%</span>
      <input type="range" min={0} max={90} step={5} value={value} onChange={(e) => onChange(Number(e.target.value))} data-testid={testId} />
      <small className="pa-hint">A {tone === 'light' ? 'dark' : 'white'} layer over the background so the text stays easy to read.</small>
    </label>
  );
}

function ColorField({ label, value, onChange, fallback, testId }: { label: string; value: string; onChange: (v: string) => void; fallback: string; testId: string }) {
  return (
    <label className="pa-field">
      <span>{label}</span>
      <div className="evp-color">
        <input type="color" value={value || fallback} onChange={(e) => onChange(e.target.value)} data-testid={testId} />
        <code>{value || 'Normal'}</code>
        {value && <button type="button" className="pa-btn ghost sm" onClick={() => onChange('')}>Reset</button>}
      </div>
    </label>
  );
}

// ------------------------------------------------------------------ previews

type Device = 'desktop' | 'tablet' | 'mobile';
/** The width each preview is drawn at (then scaled down to fit). */
const DEVICE_W: Record<Device, number> = { desktop: 1280, tablet: 820, mobile: 390 };
const DEVICE_LABEL: Record<Device, string> = { desktop: 'Desktop', tablet: 'Tablet', mobile: 'Mobile' };

/** The background a screen of this size uses: its own, else the next larger one (as on the site). */
const bgFor = (t: Theme['landing'], d: Device) =>
  d === 'mobile' ? t.heroBgMobile || t.heroBgTablet || t.heroBg : d === 'tablet' ? t.heroBgTablet || t.heroBg : t.heroBg;

/**
 * The website's sizes at a given screen width (site.css / site-pages.css:
 * the same clamp()s), so the preview is the real layout, only smaller.
 */
function siteMetrics(w: number) {
  const vw = w / 100;
  const c = (min: number, v: number, max: number) => Math.min(max, Math.max(min, v));
  const phone = w <= 640;
  const narrow = w <= 820; // the menu and the trust line hide (lp-desktop-only)
  return {
    headerPad: `13px ${c(16, 4.5 * vw, 64)}px`,
    logoH: c(48, 4 * vw, 56),
    nav: !narrow,
    heroPad: phone ? '36px 16px 40px' : `${c(48, 6 * vw, 76)}px ${c(20, 4 * vw, 56)}px ${c(32, 4.5 * vw, 48)}px`,
    title: phone ? 32 : c(38, 5.2 * vw, 68),
    desc: c(16, 1.3 * vw, 19),
    art: w <= 768
      ? { width: 210, left: -20, top: '35%', opacity: 0.22 }
      : { width: c(260, 28 * vw, 440), left: c(20, 4 * vw, 90), top: '50%', opacity: 0.9 },
    stack: phone,
    trust: !narrow,
  };
}

/**
 * The landing page as the event will look: the black top bar, the header on
 * the picture, the hero. Drawn at a real screen width and scaled to fit, so
 * the picture is cropped exactly as on the site. Desktop / Tablet / Mobile.
 */
function HeroPreview({ t, logo }: { t: Theme['landing']; logo: string }) {
  const [device, setDevice] = useState<Device>('desktop');
  const W = DEVICE_W[device];
  const m = siteMetrics(W);
  const bg = bgFor(t, device);
  const ratio = useImageRatio(bg);
  const box = useRef<HTMLDivElement>(null);
  const page = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.3);
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const measure = () => {
      if (box.current) setScale(box.current.clientWidth / W);
      if (page.current) setHeight(page.current.offsetHeight);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    if (box.current) ro.observe(box.current);
    if (page.current) ro.observe(page.current);
    return () => ro.disconnect();
  }, [W]);
  const light = t.tone === 'light' && !!bg;
  const stage = {
    ...(bg ? { backgroundImage: `url("${bg}")` } : {}),
    ...(bg && ratio ? { minHeight: Math.round(W * ratio) } : {}),
    '--evp-wash': t.tone === 'light' ? `rgba(2,6,23,${t.overlay / 100})` : `rgba(255,255,255,${t.overlay / 100})`,
  } as CSSProperties;
  return (
    <div className="evp-pv">
      <div className="evp-pv-tabs" role="tablist" aria-label="Screen size">
        {(Object.keys(DEVICE_W) as Device[]).map((d) => (
          <button
            key={d}
            type="button"
            role="tab"
            aria-selected={device === d}
            className={`evp-pv-tab${device === d ? ' on' : ''}`}
            onClick={() => setDevice(d)}
            data-testid={`evp-device-${d}`}
          >
            {DEVICE_LABEL[d]}
            {d !== 'desktop' && (d === 'tablet' ? t.heroBgTablet : t.heroBgMobile) ? <i className="evp-pv-own" title="Has its own background" /> : null}
          </button>
        ))}
      </div>
      <div className={`evp-pv-box ${device}`} ref={box} style={{ height: height * scale || undefined }}>
        <div className="evp-pv-page" ref={page} style={{ width: W, transform: `scale(${scale})` }} data-device={device}>
          <div className="evp-pv-topbar"><span>Help</span><span>Contact</span><b>Log in</b></div>
          <div className={`evp-pv-stage${light ? ' light' : ''}`} style={stage} data-testid="evp-hero-preview" data-ratio={ratio ? ratio.toFixed(3) : ''}>
            <div className="evp-pv-header" style={{ padding: m.headerPad }}>
              <img src={logo || '/logo.png'} alt="" style={{ height: m.logoH }} />
              {m.nav && (
                <div className="evp-pv-nav">
                  {['Solutions', 'Product', 'Resources', 'API'].map((x) => <span key={x}>{x} ▾</span>)}
                  <span>Pricing</span>
                </div>
              )}
              {m.nav ? (
                <div className="evp-pv-actions"><span className="ghost">Book a demo</span><span className="dark">Try for free</span></div>
              ) : (
                <div className="evp-pv-burger"><i /><i /><i /></div>
              )}
            </div>
            <div className="evp-pv-hero" style={{ padding: m.heroPad }}>
              <img
                src={t.heroArt || '/design1.png'}
                alt=""
                className="evp-pv-art"
                style={{ width: m.art.width, left: m.art.left, top: m.art.top, opacity: m.art.opacity }}
              />
              <div className="evp-pv-body">
                <div className="evp-hero-badge">{t.badge || '✨ — AI-Powered WhatsApp Marketing Platform'}</div>
                <div className="evp-hero-title" style={{ fontSize: m.title }}>
                  <span style={{ color: t.accent || '#00d084' }}>{t.titleAccent || '5X Your Revenue'}</span>
                  <span className="main">{t.titleMain || 'with the Power of WhatsApp'}</span>
                </div>
                <p style={{ fontSize: m.desc }}>{t.desc || 'Broadcast, Automate, Engage, Sell - do everything with the AI-powered WhatsApp Marketing & Engagement Platform. Powered by Official WhatsApp APIs ⚡'}</p>
                <div className={`evp-pv-btns${m.stack ? ' stack' : ''}`}>
                  <span className="primary">Start 7-Day FREE Trial →</span>
                  <span className="secondary">Join Live Demo →</span>
                </div>
                {m.trust && (
                  <div className="evp-pv-trust">
                    <span>✓ Official Meta Cloud API</span><span>✓ No credit card required</span><span>✓ 2-minute instant setup</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
      <small className="pa-hint">
        {DEVICE_LABEL[device]} · {W} px wide.{' '}
        {!bg
          ? 'No background for this size: the normal white hero.'
          : device !== 'desktop' && bg === t.heroBg
            ? 'Uses the desktop background (no own one uploaded).'
            : device === 'mobile' && bg === t.heroBgTablet
              ? 'Uses the tablet background (no mobile one uploaded).'
              : 'The whole picture shows; a taller hero only trims its sides.'}
      </small>
    </div>
  );
}

/** The CRM's own announcement bar with these announcements, taking turns as in the CRM. */
function AnnouncementPreview({ a }: { a: Theme['announcement'] }) {
  const items = a.items.map((x) => ({ ...x, text: x.text || 'Your announcement appears here' }));
  const event: LiveEvent = {
    id: 'admin-preview',
    name: 'Preview',
    preview: true,
    theme: { announcement: { enabled: true, seconds: a.seconds, items } },
  };
  return (
    <div className="evp-ann-preview">
      <EventAnnouncement event={event} />
      <small className="pa-hint">
        {!a.enabled
          ? 'Switched off: not shown.'
          : items.length > 1
            ? `Across the top of the CRM: ${items.length} announcements, one after another, ${a.seconds} seconds each, then round again. Businesses can close the bar.`
            : 'Shown across the top of the CRM. Businesses can close it.'}
      </small>
    </div>
  );
}

// ------------------------------------------------------------------ editor

function EventEditor({ draft: start, onClose, onSaved }: { draft: Draft; onClose: () => void; onSaved: (row: SiteEventRow) => void }) {
  const notify = useNotify();
  const confirm = useConfirm();
  const [d, setD] = useState<Draft>(start);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const dirty = JSON.stringify(d) !== JSON.stringify(start);

  function set<S extends keyof Theme, K extends keyof Theme[S]>(section: S, key: K, value: Theme[S][K]) {
    setD((x) => ({ ...x, theme: { ...x.theme, [section]: { ...x.theme[section], [key]: value } } }));
  }
  const err = (k: string) => (fields[k] ? <small className="evp-error">{fields[k]}</small> : null);
  // Announcements: a list (the server's error names: announcement.text for the first, announcement.items.N.text after).
  const annKey = (i: number, k: string) => (i === 0 ? `announcement.${k}` : `announcement.items.${i}.${k}`);
  const annId = (base: string, i: number) => (i === 0 ? base : `${base}-${i}`);
  const setAnn = (patch: Partial<Theme['announcement']>) =>
    setD((x) => ({ ...x, theme: { ...x.theme, announcement: { ...x.theme.announcement, ...patch } } }));
  const setItem = (i: number, patch: Partial<AnnItem>) =>
    setD((x) => ({
      ...x,
      theme: { ...x.theme, announcement: { ...x.theme.announcement, items: x.theme.announcement.items.map((it, n) => (n === i ? { ...it, ...patch } : it)) } },
    }));
  const addItem = () => {
    const items = d.theme.announcement.items;
    if (items.length >= MAX_ANNOUNCEMENTS) return;
    // A new one starts with the last one's colours.
    const last = items[items.length - 1] || blankItem();
    setAnn({ items: [...items, { ...blankItem(), bg: last.bg, color: last.color }] });
  };
  const removeItem = (i: number) => setAnn({ items: d.theme.announcement.items.filter((_, n) => n !== i) });
  const moveItem = (i: number, by: -1 | 1) => {
    const items = [...d.theme.announcement.items];
    const j = i + by;
    if (j < 0 || j >= items.length) return;
    [items[i], items[j]] = [items[j], items[i]];
    setAnn({ items });
  };

  async function save(): Promise<SiteEventRow | null> {
    setSaving(true);
    setError('');
    setFields({});
    try {
      const body = { name: d.name.trim(), startsAt: fromLocalInput(d.startsAt), endsAt: fromLocalInput(d.endsAt), theme: d.theme };
      const r = d.id ? await platformApi.saveEvent(d.id, body) : await platformApi.createEvent(body);
      notify('success', 'Event saved', r.data.name);
      onSaved(r.data);
      return r.data;
    } catch (e) {
      const f = (e as { fields?: Record<string, string> }).fields || {};
      setFields(f);
      setError(e instanceof Error ? e.message : 'Could not save the event');
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function saveAndPreview(where: 'landing' | 'pages' | 'crm') {
    // Opened now (a click), pointed at the page once saved: no popup blocker.
    const w = window.open('about:blank', '_blank');
    const row = await save();
    if (!row) {
      w?.close();
      return;
    }
    const url = previewUrls(row._id)[where];
    if (w) w.location.href = url;
    else window.open(url, '_blank');
  }

  async function cancel() {
    if (dirty && !(await confirm({ title: 'Discard your changes?', message: 'What you changed in this event isn’t saved.', confirmLabel: 'Discard', cancelLabel: 'Keep editing' }))) return;
    onClose();
  }

  const L = d.theme.landing;
  const P = d.theme.pages;
  const A = d.theme.announcement;
  return (
    <div className="pa-page evp-editor" data-testid="event-editor">
      <header className="pa-page-head">
        <div>
          <h1>{d.id ? `Edit “${start.name}”` : 'New event'}</h1>
          <p className="pa-page-sub">Leave anything empty to keep the normal design for it.</p>
        </div>
        <div className="pa-head-actions">
          <button type="button" className="pa-btn ghost" onClick={cancel}>Cancel</button>
          <button type="button" className="pa-btn" onClick={() => save().then((r) => r && onClose())} disabled={saving} data-testid="event-save">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </header>
      {error && <div className="pa-error" role="alert">{error}</div>}

      <Section title="Event" sub="Its name, and when it may show. Without dates it shows from when you switch it on until you switch it off.">
        <label className="pa-field wide">
          <span>Name</span>
          <input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="Diwali 2026" maxLength={80} data-testid="event-name" />
          {err('name')}
        </label>
        <label className="pa-field">
          <span>Starts (optional)</span>
          <input type="datetime-local" value={d.startsAt} onChange={(e) => setD({ ...d, startsAt: e.target.value })} data-testid="event-starts" />
          {err('startsAt')}
        </label>
        <label className="pa-field">
          <span>Ends (optional)</span>
          <input type="datetime-local" value={d.endsAt} onChange={(e) => setD({ ...d, endsAt: e.target.value })} data-testid="event-ends" />
          {err('endsAt')}
        </label>
      </Section>

      <Section title="Landing page hero" sub="The first thing visitors see at kapsosolutions.com." aside={<HeroPreview t={L} logo={d.theme.logos.site} />}>
        <ImageField label="Background (image or GIF)" hint="Runs behind the header and the hero, and always shows whole. Wide: about 1920 × 900. GIFs play." value={L.heroBg} onChange={(v) => set('landing', 'heroBg', v)} testId="landing-bg" />
        <ImageField label="Tablet background (optional)" hint="Screens up to 1024 px wide, about 1024 × 900. Empty: the background above." value={L.heroBgTablet} onChange={(v) => set('landing', 'heroBgTablet', v)} testId="landing-bg-tablet" />
        <ImageField label="Mobile background (optional)" hint="Phones, up to 640 px wide. A tall picture, about 1080 × 1700. Empty: the tablet one, else the one above." value={L.heroBgMobile} onChange={(v) => set('landing', 'heroBgMobile', v)} testId="landing-bg-mobile" />
        <ImageField label="Side artwork" hint="Replaces the green shape on the left. A transparent PNG or GIF." value={L.heroArt} onChange={(v) => set('landing', 'heroArt', v)} testId="landing-art" />
        <label className="pa-field wide">
          <span>Badge</span>
          <input value={L.badge} onChange={(e) => set('landing', 'badge', e.target.value)} placeholder="🪔 Happy Diwali from Kapso" maxLength={80} data-testid="landing-badge" />
        </label>
        <label className="pa-field">
          <span>Title, highlighted part</span>
          <input value={L.titleAccent} onChange={(e) => set('landing', 'titleAccent', e.target.value)} placeholder="5X Your Revenue" maxLength={60} data-testid="landing-accent-text" />
        </label>
        <label className="pa-field">
          <span>Title, second line</span>
          <input value={L.titleMain} onChange={(e) => set('landing', 'titleMain', e.target.value)} placeholder="with the Power of WhatsApp" maxLength={80} />
        </label>
        <label className="pa-field wide">
          <span>Description</span>
          <textarea rows={2} value={L.desc} onChange={(e) => set('landing', 'desc', e.target.value)} placeholder="Broadcast, Automate, Engage, Sell…" maxLength={300} />
        </label>
        <ColorField label="Highlight colour" value={L.accent} onChange={(v) => set('landing', 'accent', v)} fallback="#00d084" testId="landing-accent" />
        <ToneField value={L.tone} onChange={(v) => set('landing', 'tone', v)} testId="landing-tone" />
        <OverlayField value={L.overlay} onChange={(n) => set('landing', 'overlay', n)} tone={L.tone} testId="landing-overlay" />
        {err('landing.heroBg')}{err('landing.heroBgTablet')}{err('landing.heroBgMobile')}{err('landing.heroArt')}{err('landing.accent')}
      </Section>

      <Section title="Other website pages" sub="The top section of Pricing, Product, Solutions, API docs, Contact and every other page.">
        <ImageField label="Hero background (image or GIF)" hint="Shown behind each page’s title." value={P.heroBg} onChange={(v) => set('pages', 'heroBg', v)} testId="pages-bg" />
        <ImageField label="Tablet background (optional)" hint="Screens up to 1024 px wide. Empty: the background above." value={P.heroBgTablet} onChange={(v) => set('pages', 'heroBgTablet', v)} testId="pages-bg-tablet" />
        <ImageField label="Mobile background (optional)" hint="Phones, up to 640 px wide. Empty: the tablet one, else the one above." value={P.heroBgMobile} onChange={(v) => set('pages', 'heroBgMobile', v)} testId="pages-bg-mobile" />
        {err('pages.heroBg')}{err('pages.heroBgTablet')}{err('pages.heroBgMobile')}
        <div className="evp-stack">
          <ToneField value={P.tone} onChange={(v) => set('pages', 'tone', v)} testId="pages-tone" />
          <OverlayField value={P.overlay} onChange={(n) => set('pages', 'overlay', n)} tone={P.tone} testId="pages-overlay" />
        </div>
      </Section>

      <Section title="Logos & WhatsApp button" sub="A festive logo for the website and the CRM, and the floating chat button on every website page.">
        <ImageField label="Website logo" hint="Header and footer. Transparent PNG, about 560 × 140." value={d.theme.logos.site} onChange={(v) => set('logos', 'site', v)} testId="logo-site" />
        <ImageField label="WhatsApp button image" hint="Square, transparent PNG or GIF, about 200 × 200." value={d.theme.whatsapp.image} onChange={(v) => set('whatsapp', 'image', v)} round testId="wa-image" />
        <ImageField label="CRM logo, light theme" hint="Sidebar logo on a white background." value={d.theme.logos.crmLight} onChange={(v) => set('logos', 'crmLight', v)} testId="logo-crm-light" />
        <ImageField label="CRM logo, dark theme" hint="Sidebar logo on a dark background." value={d.theme.logos.crmDark} onChange={(v) => set('logos', 'crmDark', v)} dark testId="logo-crm-dark" />
        <label className="pa-field wide">
          <span>WhatsApp button tooltip</span>
          <input value={d.theme.whatsapp.tooltip} onChange={(e) => set('whatsapp', 'tooltip', e.target.value)} placeholder="Chat with us 👋" maxLength={40} />
        </label>
      </Section>

      <Section
        title="CRM announcements"
        sub="A bar across the top of every business’s CRM. With several, they take turns: the first, then the next, and round again."
        aside={<AnnouncementPreview a={A} />}
      >
        <label className="pa-check wide evp-wide">
          <input type="checkbox" checked={A.enabled} onChange={(e) => setAnn({ enabled: e.target.checked })} data-testid="ann-enabled" />
          Show the announcements
        </label>
        {A.items.length > 1 && (
          <label className="pa-field wide">
            <span>Each one shows for: {A.seconds} seconds</span>
            <input type="range" min={3} max={30} step={1} value={A.seconds} onChange={(e) => setAnn({ seconds: Number(e.target.value) })} data-testid="ann-seconds" />
          </label>
        )}
        {A.items.map((it, i) => (
          <div className="evp-ann-item evp-wide" key={i} data-testid="ann-item">
            <div className="evp-ann-item-head">
              <strong>{i === 0 ? 'Announcement 1 (the event’s)' : `Announcement ${i + 1}`}</strong>
              {A.items.length > 1 && (
                <div className="evp-ann-item-actions">
                  <button type="button" className="pa-btn ghost sm" onClick={() => moveItem(i, -1)} disabled={i === 0} title="Show earlier" aria-label="Move up">↑</button>
                  <button type="button" className="pa-btn ghost sm" onClick={() => moveItem(i, 1)} disabled={i === A.items.length - 1} title="Show later" aria-label="Move down">↓</button>
                  <button type="button" className="pa-btn ghost sm" onClick={() => removeItem(i)} data-testid={annId('ann-remove', i)}>Remove</button>
                </div>
              )}
            </div>
            <div className="pa-form-grid">
              <label className="pa-field wide">
                <span>Text</span>
                <input value={it.text} onChange={(e) => setItem(i, { text: e.target.value })} placeholder={i === 0 ? '🪔 Diwali offer: 25% off every annual plan till 5 Nov' : '✨ New: book appointments straight from Journeys'} maxLength={200} data-testid={annId('ann-text', i)} />
                {err(annKey(i, 'text'))}
              </label>
              <label className="pa-field">
                <span>Button text</span>
                <input value={it.linkLabel} onChange={(e) => setItem(i, { linkLabel: e.target.value })} placeholder="See plans" maxLength={30} />
              </label>
              <label className="pa-field">
                <span>Button link</span>
                <input value={it.linkUrl} onChange={(e) => setItem(i, { linkUrl: e.target.value })} placeholder="/pricing or https://…" maxLength={500} data-testid={annId('ann-link', i)} />
                {err(annKey(i, 'linkUrl'))}
              </label>
              <ColorField label="Bar colour" value={it.bg} onChange={(v) => setItem(i, { bg: v })} fallback="#16a34a" testId={annId('ann-bg', i)} />
              <ColorField label="Text colour" value={it.color} onChange={(v) => setItem(i, { color: v })} fallback="#ffffff" testId={annId('ann-color', i)} />
              <ImageField label="Small image or GIF (optional)" hint="Shown before the text, 26 px tall." value={it.image} onChange={(v) => setItem(i, { image: v })} testId={annId('ann-image', i)} />
            </div>
          </div>
        ))}
        {A.items.length < MAX_ANNOUNCEMENTS && (
          <button type="button" className="pa-btn ghost evp-wide evp-ann-add" onClick={addItem} data-testid="ann-add">
            + Add another announcement ({A.items.length}/{MAX_ANNOUNCEMENTS})
          </button>
        )}
      </Section>

      <div className="evp-footer">
        <span className="evp-footer-note">{dirty ? 'Unsaved changes' : 'All changes saved'}</span>
        <button type="button" className="pa-btn ghost" onClick={() => saveAndPreview('landing')} disabled={saving} data-testid="event-preview">Save &amp; preview website</button>
        <button type="button" className="pa-btn ghost" onClick={() => saveAndPreview('crm')} disabled={saving}>Save &amp; preview CRM</button>
        <button type="button" className="pa-btn" onClick={() => save().then((r) => r && onClose())} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ list

export function EventsPage() {
  const notify = useNotify();
  const confirm = useConfirm();
  const [rows, setRows] = useState<SiteEventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Draft | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    platformApi
      .listEvents()
      .then((r) => {
        setRows(r.data || []);
        setError('');
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load the events'))
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  const edit = (r?: SiteEventRow) => setEditing(r
    ? { id: r._id, name: r.name, startsAt: toLocalInput(r.startsAt), endsAt: toLocalInput(r.endsAt), theme: fullTheme(r.theme) }
    : { name: '', startsAt: '', endsAt: '', theme: blankTheme() });

  async function switchOn(r: SiteEventRow) {
    const other = rows.find((x) => x.active && x._id !== r._id);
    if (other && !(await confirm({ title: `Switch on “${r.name}”?`, message: `“${other.name}” will be switched off: only one event shows at a time.`, confirmLabel: 'Switch on', tone: 'primary' }))) return;
    try {
      await platformApi.activateEvent(r._id);
      notify('success', 'Event switched on', r.startsAt && new Date(r.startsAt) > new Date() ? `Starts ${when(r.startsAt)}` : 'Visitors see it within a minute.');
      load();
    } catch (e) {
      notify('error', 'Could not switch it on', e instanceof Error ? e.message : undefined);
    }
  }
  async function switchOff(r: SiteEventRow) {
    try {
      await platformApi.deactivateEvent(r._id);
      notify('success', 'Event switched off', 'The normal design is back within a minute.');
      load();
    } catch (e) {
      notify('error', 'Could not switch it off', e instanceof Error ? e.message : undefined);
    }
  }
  async function remove(r: SiteEventRow) {
    if (!(await confirm({ title: `Delete “${r.name}”?`, message: 'The event and its uploaded images are deleted. This can’t be undone.', confirmLabel: 'Delete' }))) return;
    try {
      await platformApi.deleteEvent(r._id);
      load();
    } catch (e) {
      notify('error', 'Could not delete', e instanceof Error ? e.message : undefined);
    }
  }

  if (editing) {
    return (
      <EventEditor
        key={editing.id || 'new'}
        draft={editing}
        onClose={() => {
          setEditing(null);
          load();
        }}
        onSaved={(row) => setEditing((d) => (d && !d.id ? { ...d, id: row._id } : d))}
      />
    );
  }

  return (
    <div className="pa-page" data-testid="events-page">
      <header className="pa-page-head">
        <div>
          <h1>Events</h1>
          <p className="pa-page-sub">Decorate the website and the CRM for a festival or a sale: hero backgrounds and GIFs, logos, the WhatsApp button and a CRM announcement. One event shows at a time.</p>
        </div>
        <div className="pa-head-actions">
          <button type="button" className="pa-btn" onClick={() => edit()} data-testid="event-new">+ New event</button>
        </div>
      </header>
      {error && <div className="pa-error">{error}</div>}
      {loading && rows.length === 0 && <div className="pa-note">Loading…</div>}
      {!loading && rows.length === 0 && !error && (
        <div className="pa-note">No events yet. Create one for the next festival, and switch it on when it starts (or give it dates).</div>
      )}
      <div className="evp-list">
        {rows.map((r) => {
          const s = STATUS[r.status] || STATUS.off;
          const t = fullTheme(r.theme);
          const urls = previewUrls(r._id);
          const parts = [
            t.landing.heroBg && 'landing hero',
            t.pages.heroBg && 'page heroes',
            (t.logos.site || t.logos.crmLight || t.logos.crmDark) && 'logos',
            t.whatsapp.image && 'WhatsApp button',
            t.announcement.enabled && 'CRM announcement',
          ].filter(Boolean);
          return (
            <article key={r._id} className={`pa-card evp-card${r.status === 'live' ? ' live' : ''}`} data-testid="event-row">
              <div className="evp-thumb" style={t.landing.heroBg ? { backgroundImage: `url("${t.landing.heroBg}")` } : undefined}>
                {!t.landing.heroBg && <ImageIcon />}
              </div>
              <div className="evp-card-body">
                <div className="evp-card-top">
                  <strong>{r.name}</strong>
                  <span className={`pa-badge ${s.tone}`} title={s.hint} data-testid="event-status">{s.label}</span>
                </div>
                <div className="pa-card-sub">
                  {r.startsAt || r.endsAt
                    ? `${r.startsAt ? when(r.startsAt) : 'Now'} → ${r.endsAt ? when(r.endsAt) : 'until switched off'}`
                    : 'No dates: shows while switched on'}
                </div>
                <div className="pa-card-sub">{parts.length ? `Changes: ${parts.join(', ')}` : 'Nothing set yet'}</div>
                <div className="pa-card-actions">
                  <button type="button" className="pa-btn sm" onClick={() => edit(r)} data-testid="event-edit">Edit</button>
                  {r.active ? (
                    <button type="button" className="pa-btn ghost sm" onClick={() => switchOff(r)} data-testid="event-off">Switch off</button>
                  ) : (
                    <button type="button" className="pa-btn ghost sm" onClick={() => switchOn(r)} data-testid="event-on">Switch on</button>
                  )}
                  <a className="pa-btn ghost sm" href={urls.landing} target="_blank" rel="noopener noreferrer">Preview website</a>
                  <a className="pa-btn ghost sm" href={urls.crm} target="_blank" rel="noopener noreferrer">Preview CRM</a>
                  <button type="button" className="pa-btn ghost sm evp-del" onClick={() => remove(r)} aria-label={`Delete ${r.name}`} title="Delete">
                    <CloseIcon />
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
