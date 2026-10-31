// Small presentation helpers shared across CRM components.
import type {
  Chat,
  ChatMessage,
  OutboundDescriptor,
  MediaInfo,
  FormSubmission,
  FormRow,
  OrderInfo,
  OrderItem,
} from './types';

/** HH:mm formatting for message/chat timestamps. */
export function timeHHmm(value?: string | number | Date): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
/** Whole calendar days between `value` and today (0 = today, 1 = yesterday). */
function daysAgo(value: string | number | Date): number | null {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return Math.round((startOfDay(new Date()) - startOfDay(d)) / 86400000);
}
const dmy = (d: Date) => `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;

/**
 * The day separator WhatsApp shows between messages: "Today", "Yesterday",
 * a weekday for the last week ("Tuesday"), then the date ("20/9/2026").
 */
export function dayLabel(value?: string | number | Date): string {
  if (!value) return '';
  const n = daysAgo(value);
  if (n === null) return '';
  if (n === 0) return 'Today';
  if (n === 1) return 'Yesterday';
  const d = new Date(value);
  if (n > 1 && n < 7) return d.toLocaleDateString('en-GB', { weekday: 'long' });
  return dmy(d);
}

/** Calendar-day key, to tell when a separator is needed between two messages. */
export function dayKey(value?: string | number | Date): string {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** Chat-list time: "14:05" today, then "Yesterday", a weekday, or the date. */
export function listTime(value?: string | number | Date): string {
  if (!value) return '';
  const n = daysAgo(value);
  if (n === null) return '';
  if (n <= 0) return timeHHmm(value);
  if (n === 1) return 'Yesterday';
  const d = new Date(value);
  if (n < 7) return d.toLocaleDateString('en-GB', { weekday: 'long' });
  return dmy(d);
}

/**
 * How long ago, for notifications: "just now", "5m ago", "3h ago", "2d ago",
 * then the date ("20/9/2026") after a week.
 */
export function relativeTime(value?: string | number | Date | null, now = Date.now()): string {
  if (!value) return '';
  const t = new Date(value).getTime();
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, Math.floor((now - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return dmy(new Date(t));
}

/** Two-letter avatar initials from a name or phone. */
export function initials(s: string): string {
  const clean = (s || '').replace('+', '').trim();
  return clean.slice(0, 2).toUpperCase();
}

const STATUS_RANK: Record<string, number> = { pending: 0, sent: 1, delivered: 2, read: 3 };

/**
 * The further-along of two delivery statuses. Receipts can arrive out of order
 * (a late "sent" after "read"), so ticks must only ever move forward. A failure
 * only wins if the message never reached the phone.
 */
export function laterStatus(current: string | undefined, next: string | undefined): string {
  const cur = current || 'sent';
  if (!next || next === cur) return cur;
  const rc = STATUS_RANK[cur] ?? 0;
  const rn = STATUS_RANK[next] ?? 0;
  if (next === 'failed') return rc < STATUS_RANK.delivered ? 'failed' : cur;
  if (cur === 'failed') return rn >= STATUS_RANK.delivered ? next : cur;
  return rn > rc ? next : cur;
}

/** Delivery/read tick glyph. */
export function tick(status: string): string {
  if (status === 'read' || status === 'delivered') return '✓✓';
  if (status === 'failed') return '✕';
  return '✓';
}

/** Is this chat on Messenger / Instagram (its `phone` is a PSID / IGSID, not a number)? */
export function isMetaChannelChat(c?: Pick<Chat, 'channel'> | null): boolean {
  return c?.channel === 'messenger' || c?.channel === 'instagram';
}

/** The name a chat shows: its contact name, else "+number" (WhatsApp) or "Messenger user" / "@handle". */
export function chatDisplayName(c: Pick<Chat, 'name' | 'phone' | 'channel' | 'handle'>): string {
  if (c.name) return c.name;
  if (c.channel === 'instagram') return c.handle ? `@${c.handle}` : 'Instagram user';
  if (c.channel === 'messenger') return 'Messenger user';
  return `+${c.phone}`;
}

/** Rich outbound descriptor for an outbound message, if present. */
export function outboundOf(m: ChatMessage): OutboundDescriptor | null {
  return m.direction === 'out' && m.raw?.outbound ? m.raw.outbound : null;
}

/** Media attached to a message (inbound file, or outbound file we sent). */
export function mediaOf(m: ChatMessage): MediaInfo | null {
  if (m.type === 'text') return null;
  const o = outboundOf(m);
  if (o?.mediaUrl)
    return { url: o.mediaUrl, type: o.mediaType || 'document', filename: o.filename, voice: o.voice };
  if (m.raw?.media?.url) return m.raw.media;
  return null;
}

/** Real caption for a media message (hide the auto placeholder labels). */
export function mediaCaption(m: ChatMessage): string {
  const b = (m.body || '').trim();
  const labels = ['📷 Photo', '🎥 Video', '🎵 Audio', '📄 Document', 'Photo', 'Sticker'];
  return labels.includes(b) ? '' : m.body || '';
}

/** Material icon name for an outbound button kind. */
export function btnIcon(kind: string): string {
  switch (kind) {
    case 'flow': return 'dynamic_form';
    case 'cta': return 'open_in_new';
    case 'call': return 'call';
    case 'list': return 'list';
    case 'location': return 'location_on';
    case 'pay': return 'payment';
    // WhatsApp shows a catalog's "View items" with a storefront icon, not the
    // reply arrow.
    case 'catalog': return 'storefront';
    case 'copy': return 'content_copy';
    default: return 'reply';
  }
}

export function hasActions(d: OutboundDescriptor): boolean {
  return !!(d.buttons && d.buttons.length) || !!d.cta;
}

/** Short notification beep via the Web Audio API (no asset needed). */
export function playBeep(): void {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(660, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
    osc.onended = () => ctx.close();
  } catch {
    /* audio not available */
  }
}

/** Desktop notification (no-op if permission not granted). */
export function notify(title: string, body: string): void {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    const n = new Notification(title, { body, icon: '/favicon.svg', tag: 'crm' });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    /* notifications not available */
  }
}

/** Force a direct file download (fetch → blob → anchor), not a new tab. */
export async function downloadFile(url: string, filename?: string): Promise<void> {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = filename || url.split('/').pop()?.split('?')[0] || 'download';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 4000);
  } catch {
    // Cross-origin without CORS: fall back to opening the file.
    window.open(url, '_blank');
  }
}

// ---------------------------------------------------------------------------
// Flow form submissions
//
// The backend resolves a submission into labelled rows and stores them on
// `raw.form`. Messages logged before that existed only carry Meta's raw
// payload, so fall back to parsing it here — otherwise old submissions would
// keep showing "field_51: opt_1".
// ---------------------------------------------------------------------------
const FORM_IGNORED = new Set(['flow_token', 'flow_name', '__version__']);

const prettyKey = (key: string) =>
  key.replace(/_/g, ' ').replace(/\s+/g, ' ').trim().replace(/^./, (c) => c.toUpperCase());

export function formOf(m: ChatMessage): FormSubmission | null {
  const stored = m.raw?.form;
  if (stored?.rows?.length) return stored;
  if (m.type !== 'flow_reply') return null;

  const json = m.raw?.interactive?.nfm_reply?.response_json;
  if (!json) return null;
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
  const rows: FormRow[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (FORM_IGNORED.has(key) || key.endsWith('_label')) continue;
    if (value === '' || value === null || value === undefined) continue;
    const label = data[`${key}_label`];
    const text = Array.isArray(value) ? value.join(', ') : String(value);
    rows.push({ key, label: prettyKey(key), value: label ? String(label) : text });
  }
  return rows.length ? { rows } : null;
}

// The raw shape Meta posts for a cart, before the backend resolves it.
interface RawMetaCart {
  catalog_id?: string;
  text?: string;
  product_items?: {
    product_retailer_id?: string;
    quantity?: number | string;
    item_price?: number | string;
    currency?: string;
  }[];
}

/**
 * The cart bubble's data.
 *
 * `raw.order` normally holds a resolved cart written by the backend, with real
 * product names and line totals. For a message logged before that resolution
 * existed it holds Meta's own payload instead — `product_items` keyed by
 * retailer id, with no `items` array — which used to crash the whole chat on
 * `order.items.length`. Those fall back to rendering the retailer ids: not
 * pretty, but the conversation opens.
 */
export function orderOf(m: ChatMessage): OrderInfo | null {
  const raw = m.raw?.order as (OrderInfo & RawMetaCart) | undefined;
  if (!raw) return null;

  if (Array.isArray(raw.items)) {
    if (!raw.items.length) return null;
    return {
      items: raw.items,
      total: Number(raw.total) || 0,
      currency: raw.currency || 'INR',
      note: raw.note,
      catalogId: raw.catalogId,
    };
  }

  const lines = raw.product_items;
  if (!Array.isArray(lines) || !lines.length) return null;
  const items: OrderItem[] = lines.map((it) => {
    const qty = Number(it.quantity) || 1;
    const price = Number(it.item_price) || 0;
    return {
      name: String(it.product_retailer_id || 'Item'),
      qty,
      price,
      currency: it.currency || 'INR',
      lineTotal: price * qty,
    };
  });
  return {
    items,
    total: items.reduce((n, i) => n + i.lineTotal, 0),
    currency: items[0].currency,
    note: raw.text || '',
    catalogId: raw.catalog_id,
  };
}

/** One-line preview of a message (used for reply quotes + chat list). */
export function previewOf(m: ChatMessage): string {
  if (m.raw?.order) return '🧾 Order';
  if (m.raw?.payment) return '🧾 Payment';
  if (m.raw?.location) return '📍 Location';
  if (m.type === 'flow_reply') {
    const form = formOf(m);
    const n = form?.rows.length || 0;
    return `📝 Form submitted${n ? ` · ${n} answer${n === 1 ? '' : 's'}` : ''}`;
  }
  const md = mediaOf(m);
  if (md) {
    return md.type === 'image'
      ? '📷 Photo'
      : md.type === 'video'
        ? '🎥 Video'
        : md.type === 'audio'
          ? '🎵 Audio'
          : '📄 Document';
  }
  const d = outboundOf(m);
  const body = (m.body || d?.body || d?.headerText || '').trim();
  return body || 'Message';
}

/** Static map thumbnail (keyless, via the OpenStreetMap static-map service). */
export function mapImageUrl(lat: number, lon: number): string {
  return `https://staticmap.openstreetmap.de/staticmap.php?center=${lat},${lon}&zoom=15&size=600x320&markers=${lat},${lon},red-pushpin`;
}

/** Deep link that opens the pin in Google Maps. */
export function mapsLink(lat: number, lon: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
}

/** Format a money amount with a currency symbol. */
export function money(n: number, currency = 'INR'): string {
  const sym = currency === 'INR' ? '₹' : currency === 'USD' ? '$' : currency === 'EUR' ? '€' : `${currency} `;
  const locale = currency === 'INR' ? 'en-IN' : 'en-US';
  return `${sym}${Number(n || 0).toLocaleString(locale)}`;
}

/** 24h session window label: "12h 03m 45s". */
export function windowLabel(msLeft: number): string {
  const ms = Math.max(0, msLeft);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}h ${pad(m)}m ${pad(s)}s`;
}
