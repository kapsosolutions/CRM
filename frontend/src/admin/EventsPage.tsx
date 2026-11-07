// Super-admin → Events: festive or seasonal themes for the website and the
// CRM. An event holds images / GIFs and words for:
//   the landing page hero (background, side art, badge, title, description, colour)
//   every other website page's hero (background)
//   the floating WhatsApp button (its own image) and the website logo
//   the CRM sidebar logo (light and dark theme) and a CRM announcement bar
// One event is live at a time (optionally only between two dates). Preview
// shows a saved event on the site / the demo CRM in this browser only.
import { useCallback, useEffect, useRef, useState, type CSSProperties, type DragEvent, type ReactNode } from 'react';
import { platformApi, type SiteEventRow, type SiteEventStatus } from './platformApi';
import type { EventTheme } from '../event/liveEvent';
import { useConfirm, useNotify } from '../crm/components/Dialogs';
import { CloseIcon, ImageIcon } from './AdminIcons';
import '../event/event.css';
import './EventsPage.css';

type Theme = {
  logos: { site: string; crmLight: string; crmDark: string };
  landing: { heroBg: string; heroArt: string; badge: string; titleAccent: string; titleMain: string; desc: string; accent: string; tone: 'dark' | 'light'; overlay: number };
  pages: { heroBg: string; tone: 'dark' | 'light'; overlay: number };
  whatsapp: { image: string; tooltip: string };
  announcement: { enabled: boolean; text: string; linkLabel: string; linkUrl: string; bg: string; color: string; image: string };
};

const blankTheme = (): Theme => ({
  logos: { site: '', crmLight: '', crmDark: '' },
  landing: { heroBg: '', heroArt: '', badge: '', titleAccent: '', titleMain: '', desc: '', accent: '', tone: 'dark', overlay: 0 },
  pages: { heroBg: '', tone: 'dark', overlay: 0 },
  whatsapp: { image: '', tooltip: '' },
  announcement: { enabled: false, text: '', linkLabel: '', linkUrl: '', bg: '#16a34a', color: '#ffffff', image: '' },
});

/** A saved theme over the blank one, so every field has a value. */
function fullTheme(t: EventTheme = {}): Theme {
  const b = blankTheme();
  return {
    logos: { ...b.logos, ...t.logos },
    landing: { ...b.landing, ...t.landing } as Theme['landing'],
    pages: { ...b.pages, ...t.pages } as Theme['pages'],
    whatsapp: { ...b.whatsapp, ...t.whatsapp },
    announcement: { ...b.announcement, ...t.announcement, bg: t.announcement?.bg || b.announcement.bg, color: t.announcement?.color || b.announcement.color },
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

/** A small copy of the landing hero, as the event will look. */
function HeroPreview({ t }: { t: Theme['landing'] }) {
  const style = {
    ...(t.heroBg ? { backgroundImage: `url("${t.heroBg}")` } : {}),
    '--evp-wash': t.tone === 'light' ? `rgba(2,6,23,${t.overlay / 100})` : `rgba(255,255,255,${t.overlay / 100})`,
  } as CSSProperties;
  return (
    <div className={`evp-hero${t.tone === 'light' && t.heroBg ? ' light' : ''}`} style={style} data-testid="evp-hero-preview">
      <img src={t.heroArt || '/design1.png'} alt="" className="evp-hero-art" />
      <div className="evp-hero-body">
        <div className="evp-hero-badge">{t.badge || '✨ — AI-Powered WhatsApp Marketing Platform'}</div>
        <div className="evp-hero-title">
          <span style={{ color: t.accent || '#00d084' }}>{t.titleAccent || '5X Your Revenue'}</span>
          <span className="main">{t.titleMain || 'with the Power of WhatsApp'}</span>
        </div>
        <p>{t.desc || 'Broadcast, Automate, Engage, Sell - do everything with the AI-powered WhatsApp Marketing & Engagement Platform.'}</p>
      </div>
    </div>
  );
}

function AnnouncementPreview({ a }: { a: Theme['announcement'] }) {
  const style = { '--ev-ann-bg': a.bg || '#16a34a', '--ev-ann-color': a.color || '#ffffff' } as CSSProperties;
  return (
    <div className="evp-ann-preview">
      <div className="ev-announce" style={style}>
        {a.image && <img className="ev-announce-img" src={a.image} alt="" />}
        <span className="ev-announce-text">{a.text || 'Your announcement appears here'}</span>
        {a.linkUrl && <span className="ev-announce-link">{a.linkLabel || 'Learn more'}</span>}
        <span className="ev-announce-close" aria-hidden="true">✕</span>
      </div>
      <small className="pa-hint">{a.enabled ? 'Shown across the top of the CRM. Businesses can close it.' : 'Switched off: not shown.'}</small>
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

      <Section title="Landing page hero" sub="The first thing visitors see at kapsosolutions.com." aside={<HeroPreview t={L} />}>
        <ImageField label="Background (image or GIF)" hint="Wide images work best, at least 1600 × 700. GIFs play." value={L.heroBg} onChange={(v) => set('landing', 'heroBg', v)} testId="landing-bg" />
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
        {err('landing.heroBg')}{err('landing.heroArt')}{err('landing.accent')}
      </Section>

      <Section title="Other website pages" sub="The top section of Pricing, Product, Solutions, API docs, Contact and every other page.">
        <ImageField label="Hero background (image or GIF)" hint="Shown behind each page’s title." value={P.heroBg} onChange={(v) => set('pages', 'heroBg', v)} testId="pages-bg" />
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

      <Section title="CRM announcement" sub="A bar across the top of every business’s CRM." aside={<AnnouncementPreview a={A} />}>
        <label className="pa-check wide evp-wide">
          <input type="checkbox" checked={A.enabled} onChange={(e) => set('announcement', 'enabled', e.target.checked)} data-testid="ann-enabled" />
          Show the announcement
        </label>
        <label className="pa-field wide">
          <span>Text</span>
          <input value={A.text} onChange={(e) => set('announcement', 'text', e.target.value)} placeholder="🪔 Diwali offer: 25% off every annual plan till 5 Nov" maxLength={200} data-testid="ann-text" />
          {err('announcement.text')}
        </label>
        <label className="pa-field">
          <span>Button text</span>
          <input value={A.linkLabel} onChange={(e) => set('announcement', 'linkLabel', e.target.value)} placeholder="See plans" maxLength={30} />
        </label>
        <label className="pa-field">
          <span>Button link</span>
          <input value={A.linkUrl} onChange={(e) => set('announcement', 'linkUrl', e.target.value)} placeholder="/pricing or https://…" maxLength={500} data-testid="ann-link" />
          {err('announcement.linkUrl')}
        </label>
        <ColorField label="Bar colour" value={A.bg} onChange={(v) => set('announcement', 'bg', v)} fallback="#16a34a" testId="ann-bg" />
        <ColorField label="Text colour" value={A.color} onChange={(v) => set('announcement', 'color', v)} fallback="#ffffff" testId="ann-color" />
        <ImageField label="Small image or GIF (optional)" hint="Shown before the text, 26 px tall." value={A.image} onChange={(v) => set('announcement', 'image', v)} testId="ann-image" />
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
