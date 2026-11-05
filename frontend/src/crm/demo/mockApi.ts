// -----------------------------------------------------------------------------
// Demo mode: in-memory implementations of CrmApi + CrmSocket so the CRM is fully
// explorable with no backend. Sending a message, reacting, pausing, deleting,
// and creating templates all work against the in-memory store and echo back
// through a shared bus (so outbound messages appear live, like the real socket).
// -----------------------------------------------------------------------------
import { CrmApi } from '../api';
import { CrmSocket, type StatusUpdate, type ReactionUpdate, type TypingUpdate } from '../socket';
import type { CrmConfig } from '../config';
import type { AppNotification, AppNotificationPage, Chat, ChatMessage, TemplateItem, ApiList, Product, Category, Member, Offer, WaFlowDef, Order, OrderStatus, Journey, Registration, RegistrationStatus, BusinessSettings, PaymentSettings, SandboxInfo, ChannelStatus, WhatsAppProfile, WhatsAppProfileResponse, WhatsAppProfileUpdate, WhatsAppVertical, Campaign, CampaignDetail, CampaignInput, CampaignOverviewData, CampaignStats, CampaignRecipientResult, BillingSummary } from '../types';
import type { ApiKeyInfo, MessagingLimitUsage, MetaChannelsInfo, MuteFor, QuickMessage, ServiceQuota, UtilityTemplate } from '../types';
import type { CallEvent, CallPermission, CallSettings, CallSettingsUpdate, CallState, LiveCall, EventInput, PollInput } from '../types';
import type { CommentActivity, CommentRule, SocialOverview, SocialPost } from '../types';
import type { QuickStarter, WaLibraryResponse, WaLibraryTemplate, WaLibraryUseResult } from '../types';
import { demoChats, demoMessages, demoTemplates, DEMO_FORM, DEMO_COURIER_FORMS } from './mockData';
import { demoCategories, demoProducts, demoOffers } from './catalogData';
import { demoFlows, demoJourneys } from './flowData';
import { demoOrders } from './orderData';

// Shared bus connecting the mock API (producer) and mock socket (consumer).
class DemoBus {
  private msgCbs = new Set<(m: ChatMessage) => void>();
  private statusCbs = new Set<(u: StatusUpdate) => void>();
  private reactionCbs = new Set<(u: ReactionUpdate) => void>();
  private typingCbs = new Set<(u: TypingUpdate) => void>();

  onMessage(cb: (m: ChatMessage) => void) {
    this.msgCbs.add(cb);
    return () => this.msgCbs.delete(cb);
  }
  onStatus(cb: (u: StatusUpdate) => void) {
    this.statusCbs.add(cb);
    return () => this.statusCbs.delete(cb);
  }
  onReaction(cb: (u: ReactionUpdate) => void) {
    this.reactionCbs.add(cb);
    return () => this.reactionCbs.delete(cb);
  }
  emitMessage(m: ChatMessage) {
    this.msgCbs.forEach((cb) => cb(m));
  }
  emitStatus(u: StatusUpdate) {
    this.statusCbs.forEach((cb) => cb(u));
  }
  emitReaction(u: ReactionUpdate) {
    this.reactionCbs.forEach((cb) => cb(u));
  }
  onTyping(cb: (u: TypingUpdate) => void) {
    this.typingCbs.add(cb);
    return () => this.typingCbs.delete(cb);
  }
  emitTyping(u: TypingUpdate) {
    this.typingCbs.forEach((cb) => cb(u));
  }
  private quotaCbs = new Set<(q: ServiceQuota) => void>();
  onServiceQuota(cb: (q: ServiceQuota) => void) {
    this.quotaCbs.add(cb);
    return () => this.quotaCbs.delete(cb);
  }
  emitServiceQuota(q: ServiceQuota) {
    this.quotaCbs.forEach((cb) => cb(q));
  }
  private limitCbs = new Set<(q: MessagingLimitUsage) => void>();
  onMessagingLimit(cb: (q: MessagingLimitUsage) => void) {
    this.limitCbs.add(cb);
    return () => this.limitCbs.delete(cb);
  }
  emitMessagingLimit(q: MessagingLimitUsage) {
    this.limitCbs.forEach((cb) => cb(q));
  }
  private callCbs = new Set<(e: CallEvent) => void>();
  onCall(cb: (e: CallEvent) => void) {
    this.callCbs.add(cb);
    return () => this.callCbs.delete(cb);
  }
  emitCall(e: CallEvent) {
    this.callCbs.forEach((cb) => cb(e));
  }
}

const bus = new DemoBus();

// Demo: this month's free service messages. Every demo reply that's
// "delivered" adds one and pushes the new count, like the real socket.
type DemoQuotaWindow = {
  __demoServiceUsed?: number;
  __demoServicePush?: (used?: number) => void;
};
let demoServiceUsed = 412;
function demoServiceCount(): number {
  return import.meta.env.DEV ? (window as unknown as DemoQuotaWindow).__demoServiceUsed ?? demoServiceUsed : demoServiceUsed;
}
function demoServiceQuota(): ServiceQuota {
  const ist = new Date(Date.now() + 5.5 * 3600e3);
  const next = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() + 1, 1) - 5.5 * 3600e3);
  const start = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1) - 5.5 * 3600e3);
  const used = demoServiceCount();
  return {
    success: true, connected: true, limit: 1000, used,
    free: Math.min(used, 1000), charged: Math.max(0, used - 1000), remaining: Math.max(0, 1000 - used),
    monthStart: start.toISOString(), resetsAt: next.toISOString(), updatedAt: new Date().toISOString(),
  };
}
function bumpDemoService(by = 1): void {
  const w = window as unknown as DemoQuotaWindow;
  if (import.meta.env.DEV && w.__demoServiceUsed !== undefined) w.__demoServiceUsed += by;
  else demoServiceUsed += by;
  bus.emitServiceQuota(demoServiceQuota());
}
if (import.meta.env.DEV && typeof window !== 'undefined') {
  // Dev-only test hook: push a count as if a receipt had just arrived.
  (window as unknown as DemoQuotaWindow).__demoServicePush = (used?: number) => {
    if (used === undefined) {
      bumpDemoService();
      return;
    }
    (window as unknown as DemoQuotaWindow).__demoServiceUsed = used;
    bus.emitServiceQuota(demoServiceQuota());
  };
}

// Demo: Meta's daily messaging limit (TIER_250 so the bar moves visibly).
// A template to a customer outside their 24 hours uses a slot, like the server.
type DemoLimitWindow = { __demoLimitUsed?: number; __demoLimitPush?: (used?: number) => void };
const demoLimitPhones = new Set<string>(Array.from({ length: 42 }, (_, i) => `demo-${i}`));
function demoLimitUsed(): number {
  const w = window as unknown as DemoLimitWindow;
  return import.meta.env.DEV && w.__demoLimitUsed !== undefined ? w.__demoLimitUsed : demoLimitPhones.size;
}
function demoMessagingLimit(): MessagingLimitUsage {
  const used = demoLimitUsed();
  return {
    success: true, connected: true,
    limit: { tier: 'TIER_250', limit: 250, label: '250', unlimited: false },
    used24h: used, messages24h: used + 15,
    nextFreeAt: new Date(Date.now() + 5 * 3600e3).toISOString(),
    metaError: '', stale: false, fetchedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
}
function noteDemoTemplate(phone: string, windowOpen: boolean): void {
  if (windowOpen || demoLimitPhones.has(phone)) return;
  demoLimitPhones.add(phone);
  const w = window as unknown as DemoLimitWindow;
  if (import.meta.env.DEV && w.__demoLimitUsed !== undefined) w.__demoLimitUsed += 1;
  setTimeout(() => bus.emitMessagingLimit(demoMessagingLimit()), 300);
}
if (import.meta.env.DEV && typeof window !== 'undefined') {
  // Dev-only test hook: push a figure as if a template had just gone out.
  (window as unknown as DemoLimitWindow).__demoLimitPush = (used?: number) => {
    if (used !== undefined) (window as unknown as DemoLimitWindow).__demoLimitUsed = used;
    bus.emitMessagingLimit(demoMessagingLimit());
  };
}

// ---- Demo: WhatsApp voice calls ----
// The "customer" is a real RTCPeerConnection in this page playing a tone, so
// the CRM's own call code (offer/answer, ICE, audio) runs exactly as it does
// against Meta. Dev hooks: __demoIncomingCall(phone?, name?),
// __demoCallPermission(phone, 'no_permission'|'temporary'|'permanent'),
// __demoCallNoAnswer = true, __demoCallPeers() (connection states).
type DemoCallWindow = {
  __demoIncomingCall?: (phone?: string, name?: string) => Promise<string>;
  __demoCallPermission?: (phone: string, status: CallPermission['status']) => void;
  __demoCallNoAnswer?: boolean;
  __demoCallsOff?: boolean;
  __demoCallPeers?: () => { id: string; state: string; ice: string }[];
};
interface DemoCall {
  call: LiveCall;
  pc: RTCPeerConnection;
  tone: { stop(): void } | null;
  answeredAt: number | null;
  rowId: string;
}
const demoCalls = new Map<string, DemoCall>();
// Phones whose call was hung up while being placed (cancelCall).
const demoCancelled = new Set<string>();
// Phones with a startCall in flight (the demo's "Meta" is still placing it).
const demoPlacing = new Set<string>();
const demoPermissions = new Map<string, CallPermission['status']>();
let demoCallSettings: CallSettings = {
  enabled: true, configured: true, showCallButton: true, callbackPermission: true,
  callHours: { enabled: false, timezone: 'Asia/Kolkata', weekly: [], holidays: [] },
  restrictions: [], sip: false,
};

/** A tone as the customer's voice. */
function demoVoice(): { stream: MediaStream; stop(): void } | null {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ac = new Ctx();
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    gain.gain.value = 0.03;
    osc.frequency.value = 330;
    const dest = ac.createMediaStreamDestination();
    osc.connect(gain).connect(dest);
    osc.start();
    return { stream: dest.stream, stop: () => { try { osc.stop(); void ac.close(); } catch { /* closed */ } } };
  } catch {
    return null;
  }
}

async function demoIceDone(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return;
  await new Promise<void>((resolve) => {
    const t = setTimeout(resolve, 3000);
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') {
        clearTimeout(t);
        resolve();
      }
    });
  });
}

function demoCallLabel(direction: 'in' | 'out', state: CallState, secs = 0): string {
  const mm = `${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, '0')}`;
  if (state === 'ringing') return direction === 'in' ? 'Incoming voice call' : 'Calling…';
  if (state === 'answered') return 'Voice call in progress';
  if (state === 'ended') return `${direction === 'in' ? 'Incoming' : 'Outgoing'} voice call · ${mm}`;
  if (state === 'missed') return 'Missed voice call';
  if (state === 'declined') return direction === 'in' ? 'Declined voice call' : 'Call declined';
  if (state === 'no_answer') return 'Outgoing voice call · No answer';
  return 'Voice call';
}

/** Write (or update) the call's chat row and push it, like the server does. */
function demoCallRow(dc: DemoCall, state: CallState, secs?: number) {
  const { call } = dc;
  const list = (messages[call.phone] ||= []);
  let row = list.find((m) => m._id === dc.rowId);
  const body = demoCallLabel(call.direction, state, secs);
  const raw = { call: { id: call.id, direction: call.direction, state, ...(secs !== undefined ? { duration: secs } : {}) } };
  if (!row) {
    row = { _id: dc.rowId, phone: call.phone, direction: call.direction, type: 'call', body, status: call.direction === 'in' ? 'received' : 'sent', metaMessageId: call.id, createdAt: new Date().toISOString(), raw };
    list.push(row);
  } else {
    Object.assign(row, { body, raw });
  }
  bumpChat(call.phone, `📞 ${body}`, call.direction === 'in' && state === 'missed');
  bus.emitMessage({ ...row });
}

function demoEndCall(id: string, state?: CallState) {
  const dc = demoCalls.get(id);
  if (!dc) return;
  const secs = dc.answeredAt ? Math.round((Date.now() - dc.answeredAt) / 1000) : 0;
  const final: CallState = state || (dc.answeredAt ? 'ended' : dc.call.direction === 'in' ? 'missed' : 'no_answer');
  dc.call = { ...dc.call, state: final };
  dc.tone?.stop();
  try { dc.pc.close(); } catch { /* closed */ }
  demoCalls.delete(id);
  demoCallRow(dc, final, secs);
  bus.emitCall({ kind: 'ended', call: dc.call, duration: secs });
}

async function demoIncoming(phone?: string, name?: string): Promise<string> {
  const chat = chats.find((c) => !phone || c.phone === phone) || chats[0];
  const p = phone || chat?.phone || '919800000001';
  const pc = new RTCPeerConnection({ iceServers: [] });
  const voice = demoVoice();
  if (voice) for (const t of voice.stream.getTracks()) pc.addTrack(t, voice.stream);
  else pc.addTransceiver('audio', { direction: 'sendrecv' });
  await pc.setLocalDescription(await pc.createOffer());
  await demoIceDone(pc);
  const id = `wacid.demo${nextId()}`;
  const call: LiveCall = {
    id, phone: p, name: name || chat?.name || '', direction: 'in', state: 'ringing', at: new Date().toISOString(),
    answeredAt: null, answeredBy: null, messageId: null, offerSdp: pc.localDescription?.sdp || '',
  };
  const dc: DemoCall = { call, pc, tone: voice, answeredAt: null, rowId: nextId() };
  demoCalls.set(id, dc);
  callOpensWindow(p);
  bus.emitCall({ kind: 'incoming', call });
  demoCallRow(dc, 'ringing');
  // Meta gives up after about a minute.
  setTimeout(() => { if (demoCalls.get(id) && !demoCalls.get(id)!.answeredAt) demoEndCall(id, 'missed'); }, 60000);
  return id;
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  const w = window as unknown as DemoCallWindow;
  w.__demoIncomingCall = demoIncoming;
  w.__demoCallPermission = (phone, status) => demoPermissions.set(phone, status);
  w.__demoCallPeers = () => [...demoCalls.values()].map((d) => ({ id: d.call.id, state: d.pc.connectionState, ice: d.pc.iceConnectionState }));
}

// Mutable copies of the seed data.
const chats: Chat[] = demoChats.map((c) => ({ ...c }));
const messages: Record<string, ChatMessage[]> = Object.fromEntries(
  Object.entries(demoMessages).map(([k, v]) => [k, v.map((m) => ({ ...m }))]),
);
const templates: TemplateItem[] = demoTemplates.map((t) => ({ ...t }));
const categories: Category[] = demoCategories.map((c) => ({ ...c }));
// Demo flow-form submissions so the Registrations list is explorable.
const registrations: Registration[] = [
  {
    _id: 'reg_1', phone: '919876543210', name: 'Ravi Kumar', businessName: 'Kumar Traders',
    email: 'ravi@example.com', date: '2026-10-12', status: 'new', flowName: 'My Flow',
    category: 'Cardiology', memberName: 'Dr. Asha Rao · Cardiologist',
    fields: { name: 'Ravi Kumar', business_name: 'Kumar Traders', whatsapp_number: '+91 98765 43210', email: 'ravi@example.com', preferred_date: '2026-10-12', how_did_you_hear: 'Instagram' },
    createdAt: new Date(Date.now() - 36e5).toISOString(),
  },
  {
    _id: 'reg_2', phone: '919812345678', name: 'Priya Sharma', businessName: '',
    email: 'priya@example.com', date: '2026-10-14', status: 'contacted', flowName: 'My Flow',
    category: 'Dermatology', memberName: 'Dr. Meera Nair · Dermatologist',
    fields: { name: 'Priya Sharma', whatsapp_number: '+91 98123 45678', email: 'priya@example.com', preferred_date: '2026-10-14' },
    createdAt: new Date(Date.now() - 9e6).toISOString(),
  },
  // A ready-made form with photos, a document, ticked options and a rating.
  {
    _id: 'reg_3', phone: '447911123456', name: 'Oliver Smith', businessName: '',
    email: '', date: '2026-10-18', status: 'new', flowName: DEMO_FORM.flowName,
    category: '', memberName: '', fields: {}, rows: DEMO_FORM.rows,
    createdAt: new Date(Date.now() - 29 * 36e5).toISOString(),
  },
  // A courier's ready-made forms, for the Forms pages (Pickup requests / Delivery issues).
  ...DEMO_COURIER_FORMS,
];
// Demo members (a hospital-style directory) so the Members page is explorable.
const members: Member[] = [
  { _id: 'mem_1', name: 'Dr. Asha Rao', category: 'Cardiology', title: 'Cardiologist', phone: '+91 98765 43210', description: '12 years experience', order: 1 },
  { _id: 'mem_2', name: 'Dr. Vikram Shah', category: 'Cardiology', title: 'Interventional Cardiologist', phone: '+91 98765 43211', description: '9 years experience', order: 2 },
  { _id: 'mem_3', name: 'Dr. Meera Nair', category: 'Dermatology', title: 'Dermatologist', phone: '+91 98765 43212', description: '7 years experience', order: 3 },
];
const products: Product[] = demoProducts.map((p) => ({ ...p }));
const offers: Offer[] = demoOffers.map((o) => ({ ...o, items: o.items.map((v) => ({ ...v })) }));
const flows: WaFlowDef[] = demoFlows.map((f) => JSON.parse(JSON.stringify(f)) as WaFlowDef);
const orders: Order[] = demoOrders.map((o) => ({ ...o, items: o.items?.map((i) => ({ ...i })) }));

// Development only (stripped from production builds): fill the demo with many
// rows to try pagination. In the browser console: __demoBulk(60), then reopen the page.
let bulkCampaigns = 0;
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __demoBulk: (n: number) => void }).__demoBulk = (n = 60) => {
    const many = <T extends { _id: string }>(list: T[], make: (base: T, i: number) => T) => {
      const seed = list.slice();
      if (!seed.length) return;
      for (let i = 0; i < n; i += 1) list.push(make(seed[i % seed.length], i));
    };
    many(templates as (TemplateItem & { _id: string })[], (t, i) => ({ ...t, _id: `bulk-t${i}`, name: `${t.name}_${i + 1}` }));
    many(products, (p, i) => ({ ...p, _id: `bulk-p${i}`, name: `${p.name} ${i + 1}` }));
    many(orders, (o, i) => ({ ...o, _id: `bulk-o${i}`, reference: `${o.reference || 'ORD'}-${i + 1}` }));
    many(members, (m, i) => ({ ...m, _id: `bulk-m${i}`, name: `${m.name} ${i + 1}` }));
    many(categories, (c, i) => ({ ...c, _id: `bulk-c${i}`, name: `${c.name} ${i + 1}` }));
    bulkCampaigns = n;
  };
  // A long chat to try paging: n older messages before the chat's own, a
  // minute apart, alternating sides; every 25th quotes the one 60 earlier.
  (window as unknown as { __demoLongChat: (phone: string, n?: number) => number }).__demoLongChat = (phone, n = 300) => {
    const own = messages[phone] || [];
    const first = own.length ? new Date(own[0].createdAt || Date.now()).getTime() : Date.now();
    const older: ChatMessage[] = [];
    for (let i = 0; i < n; i += 1) {
      const at = new Date(first - (n - i) * 60_000).toISOString();
      const m: ChatMessage = {
        _id: `long-${phone}-${i}`, metaMessageId: `wamid.long.${i}`, phone, direction: i % 2 ? 'out' : 'in',
        type: 'text', body: `Older message #${i + 1}`, status: 'read', createdAt: at,
      };
      // Quotes one 60 back: on an older page than the quote itself.
      if (i % 25 === 24 && i >= 60) m.raw = { replyTo: { id: `long-${phone}-${i - 60}`, author: 'Customer', preview: `Older message #${i - 59}` } };
      older.push(m);
    }
    messages[phone] = [...older, ...own];
    return messages[phone].length;
  };
}
const journeys: Journey[] = demoJourneys.map((j) => JSON.parse(JSON.stringify(j)) as Journey);

// Build a Product from the editor's FormData (image file → object URL).
function productFromForm(form: FormData, existing?: Product): Product {
  const str = (k: string) => String(form.get(k) ?? '');
  const num = (k: string) => Number(form.get(k) ?? 0) || 0;
  const json = <T,>(k: string, fallback: T): T => {
    try {
      const v = form.get(k);
      return v ? (JSON.parse(String(v)) as T) : fallback;
    } catch {
      return fallback;
    }
  };
  // Image now comes from the first variant (sent as an imageUrl string).
  const imageUrl = str('imageUrl') || existing?.imageUrl || '';
  const name = str('name');
  return {
    _id: existing?._id || nextId(),
    retailerId: existing?.retailerId || name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''),
    name,
    description: str('description'),
    categories: json<string[]>('categories', existing?.categories || []),
    price: num('price'),
    mrp: num('mrp') || undefined,
    freeDelivery: str('freeDelivery') === 'true',
    deliveryCharge: num('deliveryCharge') || undefined,
    unit: str('unit') || 'unit',
    quantity: num('quantity') || undefined,
    imageUrl,
    variants: json('variants', existing?.variants || []),
    inStock: true,
    active: true,
    isPaused: existing?.isPaused ?? false,
    soldOutSchedule: json('soldOutSchedule', existing?.soldOutSchedule),
    catalogSynced: false,
    createdAt: existing?.createdAt || new Date().toISOString(),
  };
}

let seq = 1000;
const nextId = () => `demo-${seq++}`;
const delay = <T>(value: T, ms = 220): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

// Demo campaigns: a "sent" demo campaign reports every message delivered and
// half of them read, so the overview has something to show.
function demoCampaignFrom(id: string, body: CampaignInput): CampaignDetail {
  const now = new Date().toISOString();
  const sending = body.mode !== 'draft';
  const done = body.mode === 'now';
  const n = body.recipients.length;
  const read = Math.floor(n / 2);
  const stats: CampaignStats = {
    total: n, accepted: done ? n : 0, delivered: done ? n : 0, read: done ? read : 0, failed: 0,
    pending: done ? 0 : n, sentOnly: 0, replied: 0, cancelled: 0,
  };
  const recipients: CampaignRecipientResult[] = body.recipients.map((r, i) => ({
    phone: r.phone, name: r.name || '', status: done ? (i < read ? 'read' : 'delivered') : 'pending',
    error: null, sentAt: done ? now : null, replied: false,
  }));
  return {
    _id: id, name: body.name, templateName: body.templateName || '', language: body.language || 'en_US',
    type: body.type || 'single',
    status: done ? 'completed' : sending ? 'scheduled' : 'draft',
    scheduledAt: body.mode === 'schedule' ? body.scheduledAt || null : done ? now : null,
    startedAt: done ? now : null, finishedAt: done ? now : null, createdAt: now, updatedAt: now,
    total: n, error: '', ltoCode: body.ltoCode || '', ltoExpiresAt: body.ltoExpiresAt || null, stats,
    recipients,
    ...(done ? {} : { audience: body.recipients.map((r) => ({ phone: r.phone, name: r.name || '', bodyParams: r.bodyParams || [] })) }),
  };
}

function seedDemoCampaigns(): CampaignDetail[] {
  const ago = (h: number) => new Date(Date.now() - h * 3600000).toISOString();
  const people = [
    ['919876500001', 'Riya'], ['919876500002', 'Arjun'], ['919876500003', 'Meera'], ['919876500004', 'Kabir'],
  ];
  const recips = (states: CampaignRecipientResult['status'][]): CampaignRecipientResult[] =>
    states.map((s, i) => ({
      phone: people[i][0], name: people[i][1], status: s, sentAt: ago(20), replied: s === 'read' && i === 0,
      error: s === 'failed'
        ? { code: 131026, title: 'Message undeliverable', message: 'Message undeliverable', details: 'The number is not on WhatsApp.' }
        : null,
    }));
  return [
    {
      _id: 'demo-camp-1', name: 'Weekend offer', templateName: 'seasonal_promotion', language: 'en_US', type: 'single',
      status: 'completed', scheduledAt: ago(20), startedAt: ago(20), finishedAt: ago(20), createdAt: ago(21), updatedAt: ago(20),
      total: 4, error: '', ltoCode: '', ltoExpiresAt: null,
      stats: { total: 4, accepted: 4, delivered: 3, read: 2, failed: 1, pending: 0, sentOnly: 0, replied: 1, cancelled: 0 },
      recipients: recips(['read', 'read', 'delivered', 'failed']),
    },
  ];
}

const activityOf = (c: Chat) => new Date(c.lastMessageAt || c.lastInboundAt).getTime();

function sortChats() {
  chats.sort((a, b) => activityOf(b) - activityOf(a));
}

function bumpChat(phone: string, body: string, inbound: boolean) {
  const c = chats.find((x) => x.phone === phone);
  if (!c) return;
  const now = new Date().toISOString();
  c.lastMessageBody = body;
  c.lastMessageAt = now; // any activity (sent or received) bumps the chat
  if (inbound) {
    c.lastInboundAt = now;
    c.windowMsLeft = 24 * 60 * 60 * 1000;
    c.windowOpen = true;
  }
  // Move most-recent to the top.
  sortChats();
}

/** Like the server's touchChat(opensWindow): a customer's call, or them
 *  picking up ours, opens (or refreshes) the 24-hour window. */
function callOpensWindow(phone: string) {
  const c = chats.find((x) => x.phone === phone);
  if (!c) return;
  c.lastInboundAt = new Date().toISOString();
  c.windowMsLeft = 24 * 60 * 60 * 1000;
  c.windowOpen = true;
}

/** A few notifications for the demo drawer, newest first. */
function seedDemoNotifications(): AppNotification[] {
  const ago = (min: number) => new Date(Date.now() - min * 60000).toISOString();
  const n = (
    _id: string,
    type: string,
    title: string,
    body: string,
    target: Partial<AppNotification['target']>,
    minAgo: number,
    read = false,
  ): AppNotification => ({
    _id, type, title, body,
    target: { view: '', id: '', phone: '', ...target },
    count: 1,
    createdAt: ago(minAgo),
    lastAt: ago(minAgo),
    readAt: read ? ago(minAgo) : null,
    read,
  });
  const chat = demoChats[0];
  return [
    n('demo-n1', 'message', `New message from ${chat?.name || 'a customer'}`, 'Is the order ready?', { view: 'chats', phone: chat?.phone || '' }, 4),
    n('demo-n2', 'order_new', 'New order DEM-1042', '₹1,250 · 3 items from Priya', { view: 'orders' }, 52),
    n('demo-n3', 'template_approved', 'Template approved', '“diwali_offer” is approved and ready to send.', { view: 'templates', id: 'diwali_offer' }, 60 * 26, true),
    n('demo-n4', 'campaign_finished', 'Campaign “Festive sale” finished', 'Sent 120 · Delivered 112 · Failed 3', { view: 'campaigns' }, 60 * 50, true),
    n('demo-n5', 'payment_received', 'Payment received ₹799 for DEM-1038', 'Paid by Arjun', { view: 'orders' }, 60 * 72, true),
  ];
}

export class MockCrmApi extends CrmApi {
  constructor(config: CrmConfig) {
    super(config);
  }

  override isAuthenticated(): boolean {
    return true;
  }

  // Settings live in memory for the demo.
  private demoSettings: BusinessSettings = {
    catalogId: '',
    catalogName: '',
    payment: { enabled: true, configName: 'demo_payments', gatewayType: 'razorpay' },
    whatsappConnected: true,
  };

  override getSettings(): Promise<{ success: boolean; data: BusinessSettings }> {
    // Development: __demoBulk() also connects the demo catalog, so its products show.
    if (import.meta.env.DEV && bulkCampaigns && !this.demoSettings.catalogId) {
      this.demoSettings = { ...this.demoSettings, catalogId: 'demo_catalog', catalogName: 'Meta Product Catalog' };
    }
    return delay({ success: true, data: { ...this.demoSettings } });
  }

  override getSandbox(): Promise<SandboxInfo> {
    const code = '#DEMO23';
    const n = '17119649237';
    const t = encodeURIComponent(code);
    return delay({
      success: true,
      enabled: true,
      displayPhone: '+1 711-964-9237',
      waNumber: n,
      code,
      links: {
        waMe: `https://wa.me/${n}?text=${t}`,
        web: `https://web.whatsapp.com/send?phone=${n}&text=${t}`,
        desktop: `whatsapp://send?phone=${n}&text=${t}`,
      },
    });
  }

  // Notifications live in memory for the demo (no socket events).
  private demoNotifications: AppNotification[] = seedDemoNotifications();

  override getNotifications(): Promise<AppNotificationPage> {
    const data = this.demoNotifications.map((n) => ({ ...n }));
    return delay({ success: true, data, nextBefore: null, unread: data.filter((n) => !n.read).length });
  }

  override getUnreadNotificationCount(): Promise<{ success: boolean; count: number }> {
    return delay({ success: true, count: this.demoNotifications.filter((n) => !n.read).length });
  }

  override markNotificationRead(id: string): Promise<{ success: boolean; unread: number }> {
    const at = new Date().toISOString();
    this.demoNotifications = this.demoNotifications.map((n) => (n._id === id && !n.read ? { ...n, read: true, readAt: at } : n));
    return delay({ success: true, unread: this.demoNotifications.filter((n) => !n.read).length });
  }

  override markAllNotificationsRead(): Promise<{ success: boolean; updated: number; unread: number }> {
    const at = new Date().toISOString();
    const updated = this.demoNotifications.filter((n) => !n.read).length;
    this.demoNotifications = this.demoNotifications.map((n) => (n.read ? n : { ...n, read: true, readAt: at }));
    return delay({ success: true, updated, unread: 0 });
  }

  override clearNotifications(): Promise<{ success: boolean; deleted: number; unread: number }> {
    const deleted = this.demoNotifications.length;
    this.demoNotifications = [];
    return delay({ success: true, deleted, unread: 0 });
  }

  // Billing (the demo is on the free trial with every feature; no payment is possible).
  override getBilling(): Promise<{ success: boolean; data: BillingSummary }> {
    return delay({
      success: true,
      data: {
        plan: {
          tier: 'premium',
          name: 'Premium',
          status: 'trial',
          endsAt: new Date(Date.now() + 6 * 86400000).toISOString(),
          daysLeft: 6,
          endingSoon: false,
          limits: {
            features: ['chats', 'templates', 'campaigns', 'flows', 'catalog', 'categories', 'members', 'offers', 'orders', 'payment-config', 'ads', 'create', 'instagram', 'messenger'],
            contacts: null, templates: null, campaignsPerMonth: null, carousel: true, authTemplates: true,
          },
          customerSince: new Date(Date.now() - 1 * 86400000).toISOString(),
        },
        usage: {
          contacts: { used: null, limit: null },
          templates: { used: 4, limit: null },
          campaigns: { used: 2, limit: null },
        },
        messaging: {
          connected: true, displayPhoneNumber: '+91 98765 43210', status: 'CONNECTED', qualityRating: 'GREEN',
          throughputLevel: 'STANDARD', limit: { tier: 'TIER_10K', limit: 10000, label: '10,000', unlimited: false },
          fetchedAt: new Date().toISOString(), stale: false, error: '',
        },
        contact: { name: 'Kapso Demo Store', email: 'hello@kapsodemo.store', phone: '919876543210', address: '12 MG Road, Bengaluru 560001' },
        payments: [],
        paymentsEnabled: false,
      },
    });
  }

  override getPlanQuote(): Promise<never> {
    return Promise.reject(new Error('Payments are switched off in the demo. Sign up to choose a plan.'));
  }

  override startPlanCheckout(): Promise<never> {
    return Promise.reject(new Error('Payments are switched off in the demo. Sign up to choose a plan.'));
  }

  // ---------- Polls and events (demo) ----------
  // Dev hooks: __demoPollVote(index) answers the latest poll in the open chat
  // (the demo also answers a moment after it's sent); __demoExtraFail = 'message'.
  override sendPoll(phone: string, poll: PollInput): Promise<{ success: boolean; id: string }> {
    const fail = import.meta.env.DEV ? (window as unknown as { __demoExtraFail?: string }).__demoExtraFail : '';
    if (fail) return Promise.reject(new Error(fail));
    const id = Math.random().toString(16).slice(2, 14).padEnd(12, '0');
    const msg: ChatMessage = {
      _id: nextId(), phone, direction: 'out', type: 'interactive', body: `📊 *${poll.question}*`,
      status: 'sent', metaMessageId: nextId(), createdAt: new Date().toISOString(),
      raw: { poll: { id, ...poll, style: poll.options.length <= 3 ? 'buttons' : 'list', votes: [], answeredAt: null } },
    };
    (messages[phone] ||= []).push(msg);
    bumpChat(phone, `📊 ${poll.question}`, false);
    setTimeout(() => bus.emitMessage({ ...msg }), 100);
    setTimeout(() => bus.emitStatus({ metaMessageId: msg.metaMessageId!, status: 'read' }), 700);
    if (import.meta.env.DEV) {
      (window as unknown as { __demoPollVote?: (i: number) => void }).__demoPollVote = (i: number) => {
        const p = msg.raw!.poll!;
        const votes = p.multiple ? [...new Set([...p.votes, i])].sort((a, b) => a - b) : [i];
        msg.raw = { ...msg.raw, poll: { ...p, votes, answeredAt: new Date().toISOString() } };
        const reply: ChatMessage = {
          _id: nextId(), phone, direction: 'in', type: 'button', body: p.options[i], status: 'received', createdAt: new Date().toISOString(),
          raw: { replyTo: { author: 'You', preview: `📊 ${p.question}`, id: msg._id } },
        };
        (messages[phone] ||= []).push(reply);
        bus.emitMessage(reply);
        bus.emitMessage({ ...msg });
      };
    }
    return delay({ success: true, id }, 250);
  }

  override sendEvent(phone: string, ev: EventInput): Promise<{ success: boolean }> {
    const fail = import.meta.env.DEV ? (window as unknown as { __demoExtraFail?: string }).__demoExtraFail : '';
    if (fail) return Promise.reject(new Error(fail));
    const s = new Date(ev.start);
    const e = ev.end ? new Date(ev.end) : new Date(s.getTime() + 3600e3);
    const g = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const callUrl = ev.callLink ? 'https://wa.me/call/919876543210' : '';
    const calendarUrl = `https://calendar.google.com/calendar/render?${new URLSearchParams({ action: 'TEMPLATE', text: ev.name, dates: `${g(s)}/${g(e)}`, ...(ev.location ? { location: ev.location } : {}) })}`;
    const msg: ChatMessage = {
      _id: nextId(), phone, direction: 'out', type: 'interactive', body: `📅 *${ev.name}*`,
      status: 'sent', metaMessageId: nextId(), createdAt: new Date().toISOString(),
      raw: { event: { ...ev, callUrl, calendarUrl } },
    };
    (messages[phone] ||= []).push(msg);
    bumpChat(phone, `📅 ${ev.name}`, false);
    setTimeout(() => bus.emitMessage({ ...msg }), 100);
    return delay({ success: true }, 250);
  }

  // ---------- WhatsApp voice calls (demo; see demoIncoming above) ----------
  override getCallSettings(): Promise<{ success: boolean; connected: boolean; settings?: CallSettings }> {
    const off = import.meta.env.DEV && (window as unknown as DemoCallWindow).__demoCallsOff;
    return delay({ success: true, connected: true, settings: { ...demoCallSettings, ...(off ? { enabled: false } : {}) } });
  }

  override saveCallSettings(body: CallSettingsUpdate): Promise<{ success: boolean; connected: boolean; settings: CallSettings }> {
    if (body.callHours?.enabled && !body.callHours.weekly.length) {
      return Promise.reject(Object.assign(new Error('Add at least one day with call hours, or turn call hours off.'), { status: 400 }));
    }
    demoCallSettings = { ...demoCallSettings, ...body, callHours: body.callHours || demoCallSettings.callHours, configured: true };
    if (import.meta.env.DEV && body.enabled !== undefined) (window as unknown as DemoCallWindow).__demoCallsOff = !body.enabled;
    return delay({ success: true, connected: true, settings: { ...demoCallSettings } }, 400);
  }

  override getCallConfig(): Promise<{ success: boolean; iceServers: RTCIceServer[]; connected: boolean }> {
    // Both ends are in this page: no STUN needed.
    return delay({ success: true, iceServers: [], connected: true }, 50);
  }

  override getRingingCalls(): Promise<{ success: boolean; calls: LiveCall[] }> {
    return delay({ success: true, calls: [...demoCalls.values()].filter((d) => d.call.direction === 'in' && !d.answeredAt).map((d) => d.call) }, 50);
  }

  override async acceptCall(id: string, sdp: string, tabId: string): Promise<{ success: boolean; call: LiveCall }> {
    const dc = demoCalls.get(id);
    if (!dc) throw Object.assign(new Error('This call has ended.'), { status: 404 });
    await dc.pc.setRemoteDescription({ type: 'answer', sdp });
    dc.answeredAt = Date.now();
    dc.call = { ...dc.call, state: 'answered', answeredAt: new Date().toISOString(), answeredBy: tabId, offerSdp: undefined };
    bus.emitCall({ kind: 'answered', call: dc.call });
    demoCallRow(dc, 'answered');
    return delay({ success: true, call: dc.call }, 150);
  }

  override rejectCall(id: string): Promise<{ success: boolean }> {
    const dc = demoCalls.get(id);
    if (dc) {
      bus.emitCall({ kind: 'status', status: 'rejected', call: { ...dc.call, state: 'declined' } });
      demoEndCall(id, 'declined');
    }
    return delay({ success: true }, 80);
  }

  override endCall(id: string): Promise<{ success: boolean }> {
    setTimeout(() => demoEndCall(id), 200);
    return delay({ success: true }, 80);
  }

  override cancelCall(phone: string): Promise<{ success: boolean }> {
    // Like the server: a call still being placed is ended once it has an id.
    if (demoPlacing.has(phone)) demoCancelled.add(phone);
    for (const d of demoCalls.values()) if (d.call.direction === 'out' && d.call.phone === phone) setTimeout(() => demoEndCall(d.call.id), 50);
    return delay({ success: true }, 40);
  }

  override async startCall(phone: string, sdp: string, tabId: string, name = ''): Promise<{ success: boolean; call: LiveCall }> {
    if ((demoPermissions.get(phone) || 'temporary') === 'no_permission') {
      throw Object.assign(new Error('This customer hasn’t allowed calls from you yet. Ask for permission first.'), { status: 409, data: { code: 138006 } });
    }
    demoPlacing.add(phone);
    const pc = new RTCPeerConnection({ iceServers: [] });
    const voice = demoVoice();
    if (voice) for (const t of voice.stream.getTracks()) pc.addTrack(t, voice.stream);
    await pc.setRemoteDescription({ type: 'offer', sdp });
    await pc.setLocalDescription(await pc.createAnswer());
    await demoIceDone(pc);
    // Dev hook: how long "Meta" takes to place the call (a slow network).
    const slow = import.meta.env.DEV ? Number((window as unknown as { __demoCallPlaceMs?: number }).__demoCallPlaceMs) || 0 : 0;
    if (slow) await new Promise((r) => setTimeout(r, slow));
    demoPlacing.delete(phone);
    const id = `wacid.demo${nextId()}`;
    const chat = chats.find((c) => c.phone === phone);
    const call: LiveCall = {
      id, phone, name: name || chat?.name || '', direction: 'out', state: 'ringing', at: new Date().toISOString(),
      answeredAt: null, answeredBy: tabId, messageId: null,
    };
    const dc: DemoCall = { call, pc, tone: voice, answeredAt: null, rowId: nextId() };
    demoCalls.set(id, dc);
    demoCallRow(dc, 'ringing');
    if (demoCancelled.delete(phone)) setTimeout(() => demoEndCall(id), 50);
    // Like Meta: the answer, then ringing, then the customer picks up.
    const answer = pc.localDescription?.sdp || '';
    setTimeout(() => bus.emitCall({ kind: 'answer', call, sdp: answer }), 150);
    setTimeout(() => demoCalls.has(id) && bus.emitCall({ kind: 'status', status: 'ringing', call }), 500);
    const noAnswer = import.meta.env.DEV && (window as unknown as DemoCallWindow).__demoCallNoAnswer;
    setTimeout(() => {
      const d = demoCalls.get(id);
      if (!d) return;
      if (noAnswer) {
        demoEndCall(id, 'no_answer');
        return;
      }
      d.answeredAt = Date.now();
      d.call = { ...d.call, state: 'answered', answeredAt: new Date().toISOString() };
      callOpensWindow(d.call.phone);
      bus.emitCall({ kind: 'status', status: 'accepted', call: d.call });
      demoCallRow(d, 'answered');
    }, noAnswer ? 2500 : 1600);
    return delay({ success: true, call }, 60);
  }

  override getCallPermission(phone: string): Promise<CallPermission> {
    const status = demoPermissions.get(phone) || 'temporary';
    return delay({
      success: true, status, expiresAt: status === 'temporary' ? new Date(Date.now() + 5 * 864e5).toISOString() : null,
      canCall: status !== 'no_permission', canAsk: true, askAgainAt: null, callAgainAt: null,
    }, 120);
  }

  override requestCallPermission(phone: string, body = ''): Promise<{ success: boolean; id: string }> {
    const msg: ChatMessage = {
      _id: nextId(), phone, direction: 'out', type: 'interactive', body: body || 'Can we call you on WhatsApp?',
      status: 'sent', metaMessageId: nextId(), createdAt: new Date().toISOString(),
      raw: { outbound: { type: 'interactive', body: body || 'Can we call you on WhatsApp?', buttons: [{ text: 'Allow calls', kind: 'call_permission' }] } },
    };
    (messages[phone] ||= []).push(msg);
    bumpChat(phone, msg.body, false);
    bus.emitMessage(msg);
    // The customer allows it a moment later.
    setTimeout(() => {
      demoPermissions.set(phone, 'temporary');
      const reply: ChatMessage = {
        _id: nextId(), phone, direction: 'in', type: 'call_permission', body: 'Allowed you to call them for 7 days',
        status: 'received', createdAt: new Date().toISOString(),
        raw: { callPermission: { response: 'accept', permanent: false, expiresAt: new Date(Date.now() + 7 * 864e5).toISOString(), source: 'user_action' } },
      };
      (messages[phone] ||= []).push(reply);
      bus.emitMessage(reply);
      bus.emitCall({ kind: 'permission', phone, permission: reply.raw!.callPermission! });
    }, 1500);
    return delay({ success: true, id: msg.metaMessageId! }, 200);
  }

  override getChannelStatus(): Promise<ChannelStatus> {
    return delay({
      success: true,
      connected: true,
      fetchedAt: new Date().toISOString(),
      cached: false,
      stale: false,
      error: '',
      number: {
        phoneNumberId: '100000000000001',
        displayPhoneNumber: '+91 98765 43210',
        verifiedName: 'Kapso Demo Store',
        status: 'CONNECTED',
        qualityRating: 'GREEN',
        nameStatus: 'APPROVED',
        newNameStatus: 'NONE',
        codeVerificationStatus: 'VERIFIED',
        accountMode: 'LIVE',
        platformType: 'CLOUD_API',
        isOfficialBusinessAccount: false,
        throughputLevel: 'STANDARD',
        health: { canSendMessage: 'AVAILABLE', errors: [] },
      },
      limit: { tier: 'TIER_10K', limit: 10000, label: '10,000', unlimited: false },
      waba: { id: '100000000000002', name: 'Kapso Demo', accountReviewStatus: 'APPROVED', businessVerificationStatus: 'verified' },
    });
  }

  // ---------- WhatsApp business profile (in memory for the demo) ----------
  private demoProfile: WhatsAppProfile = {
    about: 'Fresh groceries delivered in 30 minutes',
    address: '12 MG Road, Bengaluru 560001',
    description: 'Your neighbourhood store, now on WhatsApp. Order, pay and track deliveries in chat.',
    email: 'hello@kapsodemo.store',
    websites: ['https://kapsodemo.store', ''],
    vertical: 'GROCERY',
    verticalLabel: 'Food and Grocery',
    profilePictureUrl: '',
    displayPhoneNumber: '+91 98765 43210',
    verifiedName: 'Kapso Demo Store',
  };

  private static readonly DEMO_VERTICALS: WhatsAppVertical[] = [
    { value: 'APPAREL', label: 'Clothing and Apparel' },
    { value: 'GROCERY', label: 'Food and Grocery' },
    { value: 'OTHER', label: 'Other' },
    { value: 'RESTAURANT', label: 'Restaurant' },
    { value: 'RETAIL', label: 'Shopping and Retail' },
  ];

  // Demo: a business part-way through this month's 1,000 free service messages.
  // Dev-only test hook: try other counts (e.g. __demoServiceUsed = 1040).
  // Demo: API keys live in memory for the session.
  private demoKeys: ApiKeyInfo[] = [];
  override listApiKeys(): Promise<{ success: boolean; data: ApiKeyInfo[] }> {
    return delay({ success: true, data: this.demoKeys.map(({ key: _k, ...k }) => k) });
  }
  override createApiKey(name: string): Promise<{ success: boolean; data: ApiKeyInfo }> {
    if (this.demoKeys.length >= 10) return Promise.reject(new Error('You can have up to 10 API keys. Revoke one you no longer use first.'));
    const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    const rnd = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => chars[b % 62]).join('');
    const key = `kp_live_${rnd}`;
    const row: ApiKeyInfo = { id: nextId(), name: name.trim() || 'API key', prefix: key.slice(0, 12), lastFour: key.slice(-4), createdAt: new Date().toISOString(), lastUsedAt: null, requests: 0, key };
    this.demoKeys.unshift(row);
    return delay({ success: true, data: { ...row } });
  }
  override revokeApiKey(id: string): Promise<{ success: boolean }> {
    this.demoKeys = this.demoKeys.filter((k) => k.id !== id);
    return delay({ success: true });
  }

  override getMessagingLimit(): Promise<MessagingLimitUsage> {
    return delay(demoMessagingLimit());
  }

  override getServiceQuota(): Promise<ServiceQuota> {
    return delay(demoServiceQuota());
  }

  override getWhatsAppProfile(): Promise<WhatsAppProfileResponse> {
    return delay({ success: true, connected: true, data: { ...this.demoProfile }, verticals: MockCrmApi.DEMO_VERTICALS });
  }

  override saveWhatsAppProfile(body: WhatsAppProfileUpdate): Promise<{ success: boolean; data: WhatsAppProfile | null }> {
    const next = { ...this.demoProfile, ...body };
    if (body.websites) next.websites = [body.websites[0] || '', body.websites[1] || ''];
    if (body.vertical !== undefined) {
      next.verticalLabel = MockCrmApi.DEMO_VERTICALS.find((v) => v.value === body.vertical)?.label || 'Not set';
    }
    this.demoProfile = next;
    return delay({ success: true, data: { ...next } });
  }

  override uploadWhatsAppProfilePicture(file: File): Promise<{ success: boolean; profilePictureUrl: string; data: WhatsAppProfile | null }> {
    this.demoProfile = { ...this.demoProfile, profilePictureUrl: URL.createObjectURL(file) };
    return delay({ success: true, profilePictureUrl: this.demoProfile.profilePictureUrl, data: { ...this.demoProfile } });
  }

  // ---------- Messenger / Instagram (not connected in the demo) ----------
  override getMetaChannels(): Promise<MetaChannelsInfo> {
    return delay({ success: true, configured: false, instagramLoginConfigured: false, connections: { messenger: null, instagram: null } });
  }

  // ---------- Create (no Facebook Page / Instagram in the demo) ----------
  override getSocial(): Promise<SocialOverview> {
    return delay({
      success: true,
      accounts: { facebook: null, instagram: null },
      limits: {
        instagramCaption: 2200, instagramHashtags: 30, facebookCaption: 63206, carouselMin: 2, carouselMax: 10,
        minLeadMs: 120000, maxAheadMs: 75 * 86400000, waiting: 50,
      },
    });
  }

  override getSocialPosts(): Promise<{ success: boolean; data: SocialPost[] }> {
    return delay({ success: true, data: [] });
  }

  override getCommentRules(): Promise<{ success: boolean; data: CommentRule[]; activity: CommentActivity[] }> {
    return delay({ success: true, data: [], activity: [] });
  }

  override getQuickMessages(): Promise<{ success: boolean; data: QuickMessage[] }> {
    return delay({ success: true, data: [] });
  }

  override getUtilityTemplates(): Promise<{ success: boolean; pageId: string; data: UtilityTemplate[] }> {
    return delay({ success: true, pageId: '', data: [] });
  }

  // ---------- Template Library (read-only samples in the demo) ----------
  override getWhatsAppLibrary(): Promise<WaLibraryResponse> {
    const data: WaLibraryTemplate[] = [
      {
        id: 'demo-1', name: 'delivery_update_1', language: 'en_US', category: 'UTILITY', topic: 'ORDER_MANAGEMENT', usecase: 'DELIVERY_UPDATE', industry: ['E_COMMERCE'],
        header: '', body: 'Good news! Your order {{1}} is on its way and should arrive by {{2}}.', footer: '', bodyParams: ['#12345', 'Friday'], bodyParamTypes: ['TEXT', 'DATE'],
        buttons: [{ type: 'URL', text: 'Track order', url: 'https://www.example.com/', phone: '', input: 'url' }],
      },
      {
        id: 'demo-2', name: 'payment_due_reminder_1', language: 'en_US', category: 'UTILITY', topic: 'PAYMENTS', usecase: 'PAYMENT_DUE_REMINDER', industry: ['FINANCIAL_SERVICES'],
        header: 'Payment reminder', body: 'Hi {{1}}, your payment of {{2}} is due on {{3}}.', footer: '', bodyParams: ['Jim', '$75.00', '12 May'], bodyParamTypes: ['TEXT', 'AMOUNT', 'DATE'],
        buttons: [{ type: 'PHONE_NUMBER', text: 'Call us', url: '', phone: '+18005551234', input: 'phone' }],
      },
    ];
    return delay({
      success: true, mode: 'sandbox', canUse: false, language: 'en_US', total: data.length, data,
      facets: { categories: [{ value: 'UTILITY', count: 2 }], topics: [], usecases: [], industries: [] },
      filters: { topic: [], usecase: [], industry: [] }, languages: ['en_US'],
    });
  }

  override getQuickStarters(): Promise<{ success: boolean; categories: { key: string; label: string }[]; data: QuickStarter[] }> {
    const s = (key: string, name: string, category: string, categoryLabel: string, text: string): QuickStarter => ({
      key, name, category, categoryLabel, language: 'en', source: 'crm_starter', channels: ['messenger', 'instagram'], kind: 'text',
      text, imageUrl: '', buttons: [], cards: [], quickReplies: [],
    });
    return delay({
      success: true,
      categories: [{ key: 'greeting', label: 'Greeting / Welcome' }, { key: 'faq', label: 'FAQ' }],
      data: [
        s('welcome_hello', 'Welcome message', 'greeting', 'Greeting / Welcome', 'Hi there! 👋 Thanks for messaging us. How can we help you today?'),
        s('faq_hours', 'Opening hours', 'faq', 'FAQ', 'We’re open Monday to Saturday, 10 am to 8 pm.'),
      ],
    });
  }

  override useQuickStarter(): Promise<{ success: boolean; starterKey: string; data: QuickMessage }> {
    return Promise.reject(new Error('The demo can’t save quick messages.'));
  }

  override useWhatsAppLibraryTemplate(): Promise<{ success: boolean; data: WaLibraryUseResult }> {
    return Promise.reject(new Error('The demo can’t create templates.'));
  }

  // ---------- Campaigns (in memory for the demo) ----------
  private demoCampaigns: CampaignDetail[] = seedDemoCampaigns();
  private bulked = 0;
  /** Development: __demoBulk(n) adds n campaigns too (copies of the seeds). */
  private campaignsNow(): CampaignDetail[] {
    if (import.meta.env.DEV && bulkCampaigns > this.bulked) {
      const seed = seedDemoCampaigns();
      for (let i = this.bulked; i < bulkCampaigns; i += 1) {
        const c = seed[i % seed.length];
        // The first copy gets a long recipient list (its results table pages).
        const rs = c.recipients || [];
        const recipients = i === 0 && rs.length
          ? Array.from({ length: Math.max(60, rs.length) }, (_, k) => ({ ...rs[k % rs.length], phone: `9198${String(10000000 + k)}` }))
          : rs;
        this.demoCampaigns.push({ ...c, _id: `bulk-c${i}`, name: `${c.name} ${i + 1}`, recipients });
      }
      this.bulked = bulkCampaigns;
    }
    return this.demoCampaigns;
  }

  override getCampaigns(): Promise<ApiList<Campaign>> {
    return delay({
      success: true,
      data: this.campaignsNow().map(({ recipients: _r, audience: _a, ...c }) => ({ ...c })),
    });
  }

  override getCampaignOverview(): Promise<CampaignOverviewData> {
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(Date.now() - (6 - i) * 86400000);
      const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      return { date, active: i >= 3 };
    });
    const lim = demoMessagingLimit();
    const usage = { used24h: lim.used24h, messages24h: lim.messages24h };
    return delay({
      success: true,
      connected: true,
      limit: { ...lim.limit!, ...usage },
      usage,
      quality: 'GREEN',
      metaError: '',
      stale: false,
      fetchedAt: new Date().toISOString(),
      streak: { current: 4, days },
    });
  }

  override getCampaign(id: string): Promise<{ success: boolean; data: CampaignDetail }> {
    const c = this.demoCampaigns.find((x) => x._id === id);
    if (!c) return Promise.reject(new Error('Campaign not found'));
    return delay({ success: true, data: { ...c } });
  }

  override createCampaign(body: CampaignInput): Promise<{ success: boolean; data: Campaign }> {
    const c = demoCampaignFrom(nextId(), body);
    this.demoCampaigns = [c, ...this.demoCampaigns];
    return delay({ success: true, data: c });
  }

  override updateCampaign(id: string, body: CampaignInput): Promise<{ success: boolean; data: Campaign }> {
    const c = demoCampaignFrom(id, body);
    this.demoCampaigns = this.demoCampaigns.map((x) => (x._id === id ? c : x));
    return delay({ success: true, data: c });
  }

  override cancelCampaign(id: string): Promise<{ success: boolean }> {
    this.demoCampaigns = this.demoCampaigns.map((x) =>
      x._id === id ? { ...x, status: 'cancelled' as const, finishedAt: new Date().toISOString() } : x,
    );
    return delay({ success: true });
  }

  override deleteCampaign(id: string): Promise<{ success: boolean }> {
    this.demoCampaigns = this.demoCampaigns.filter((x) => x._id !== id);
    return delay({ success: true });
  }

  override saveSettings(body: { catalogId?: string; payment?: PaymentSettings }): Promise<{ success: boolean; data: BusinessSettings }> {
    this.demoSettings = {
      ...this.demoSettings,
      ...(body.catalogId !== undefined
        ? {
            catalogId: body.catalogId,
            catalogName: body.catalogId ? 'Meta Product Catalog' : '',
          }
        : {}),
      ...(body.payment ? { payment: body.payment } : {}),
    };
    return delay({ success: true, data: { ...this.demoSettings } });
  }

  override getChats(): Promise<ApiList<Chat>> {
    sortChats();
    return delay({ success: true, data: chats.map((c) => ({ ...c })) });
  }

  override getMessages(
    phone: string,
    page: { limit?: number; before?: ChatMessage } = {},
  ): Promise<ApiList<ChatMessage> & { hasMore?: boolean; lastInboundAt?: string | null }> {
    // Dev-only test hook: __demoLongChat(phone, n) gives a chat n older messages.
    let list = messages[phone] || [];
    const c = chats.find((x) => x.phone === phone);
    if (!page.before && c) c.unread = 0;
    // Same paging as the server: the `limit` newest before the cursor.
    if (page.before) {
      const i = list.findIndex((m) => m._id === page.before!._id);
      list = i >= 0 ? list.slice(0, i) : [];
    }
    const limit = page.limit || list.length;
    const hasMore = list.length > limit;
    const out = list.slice(Math.max(0, list.length - limit));
    // Like the server: the chat record's time (calls move it too), else the
    // customer's last message.
    const lastIn = [...(messages[phone] || [])].reverse().find((m) => m.direction === 'in');
    return delay({
      success: true,
      data: out.map((m) => ({ ...m })),
      ...(page.limit ? { hasMore } : {}),
      ...(page.before ? {} : { lastInboundAt: c?.lastInboundAt || lastIn?.createdAt || null }),
    }, import.meta.env.DEV ? (window as unknown as { __demoPageDelay?: number }).__demoPageDelay : undefined);
  }

  override markRead(): Promise<{ success: boolean }> {
    return delay({ success: true });
  }

  override sendMessage(
    phone: string,
    text: string,
    replyTo?: { author: string; preview: string },
  ): Promise<{ success: boolean }> {
    const msg: ChatMessage = {
      _id: nextId(), phone, direction: 'out', type: 'text', body: text,
      status: 'sent', metaMessageId: nextId(), createdAt: new Date().toISOString(),
      ...(replyTo ? { raw: { replyTo } } : {}),
    };
    (messages[phone] ||= []).push(msg);
    bumpChat(phone, text, false);
    bus.emitMessage(msg);
    // Simulate delivery → read receipts rolling in.
    setTimeout(() => {
      bus.emitStatus({ metaMessageId: msg.metaMessageId!, status: 'delivered' });
      // A reply reaching the phone uses one free service message.
      bumpDemoService();
    }, 700);
    setTimeout(() => bus.emitStatus({ metaMessageId: msg.metaMessageId!, status: 'read' }), 1800);
    // Demo flavor: the contact "starts typing" shortly after you message them.
    setTimeout(() => bus.emitTyping({ phone, typing: true }), 2200);
    setTimeout(() => bus.emitTyping({ phone, typing: false }), 5200);
    return delay({ success: true }, 120);
  }

  override sendMedia(
    phone: string,
    file: File,
    caption?: string,
    voice?: boolean,
  ): Promise<{ success: boolean }> {
    // Like a real upload, the file takes a moment before it's saved and
    // echoed. Dev hooks: __demoUploadDelay = ms, __demoUploadFail = 'message'.
    const hooks = import.meta.env.DEV
      ? (window as unknown as { __demoUploadDelay?: number; __demoUploadFail?: string })
      : {};
    const wait = typeof hooks.__demoUploadDelay === 'number' ? hooks.__demoUploadDelay : 700;
    const fail = hooks.__demoUploadFail || '';
    return new Promise((r) => setTimeout(r, wait)).then(() => {
      if (fail) throw new Error(fail);
      return this.saveDemoMedia(phone, file, caption, voice);
    });
  }

  private saveDemoMedia(phone: string, file: File, caption?: string, voice?: boolean): Promise<{ success: boolean }> {
    const url = URL.createObjectURL(file);
    const mime = file.type || 'application/octet-stream';
    const mediaType = mime.startsWith('image/')
      ? 'image'
      : mime.startsWith('video/')
        ? 'video'
        : mime.startsWith('audio/')
          ? 'audio'
          : 'document';
    const msg: ChatMessage = {
      _id: nextId(), phone, direction: 'out', type: mediaType, body: caption || '',
      status: 'sent', metaMessageId: nextId(), createdAt: new Date().toISOString(),
      raw: {
        outbound: {
          type: mediaType, body: caption || '', mediaType, mediaUrl: url,
          filename: file.name, voice: !!voice,
        },
      },
    };
    (messages[phone] ||= []).push(msg);
    const preview = voice ? '🎤 Voice message' : `[${mediaType}] ${caption || file.name}`;
    bumpChat(phone, preview, false);
    bus.emitMessage(msg);
    return delay({ success: true }, 300);
  }

  override setPause(phone: string, paused: boolean): Promise<{ success: boolean; botPaused: boolean }> {
    const c = chats.find((x) => x.phone === phone);
    if (c) c.botPaused = paused;
    return delay({ success: true, botPaused: paused });
  }

  override deleteChat(phone: string): Promise<{ success: boolean }> {
    const c = chats.find((x) => x.phone === phone);
    if (c) {
      c.lastMessageBody = '';
      c.lastMessageAt = undefined;
      c.lastInboundAt = '';
      c.unread = 0;
      c.windowOpen = false;
      c.windowMsLeft = 0;
    }
    messages[phone] = [];
    return delay({ success: true });
  }

  override deleteContact(phone: string): Promise<{ success: boolean; keptBlocked?: boolean }> {
    const i = chats.findIndex((x) => x.phone === phone);
    const keptBlocked = i >= 0 && !!chats[i].blocked;
    if (i >= 0) chats.splice(i, 1);
    delete messages[phone];
    return delay({ success: true, keptBlocked });
  }

  override muteChat(phone: string, until: MuteFor | null): Promise<{ success: boolean; mutedUntil: string | null }> {
    const c = chats.find((x) => x.phone === phone);
    const ms = { '8h': 8 * 3600e3, '1w': 7 * 24 * 3600e3 } as const;
    const mutedUntil = until === null ? null : until === 'always' ? '9999-12-31T00:00:00.000Z' : new Date(Date.now() + ms[until]).toISOString();
    if (c) c.mutedUntil = mutedUntil;
    return delay({ success: true, mutedUntil });
  }

  override setFavourite(phone: string, favourite: boolean): Promise<{ success: boolean; favourite: boolean }> {
    const c = chats.find((x) => x.phone === phone);
    if (c) c.favourite = favourite;
    return delay({ success: true, favourite });
  }

  /** Like the server: WhatsApp blocks at Meta only within 24h of their last message. */
  override setBlocked(phone: string, blocked: boolean): Promise<{ success: boolean; blocked: boolean; atMeta: boolean; note?: string }> {
    const c = chats.find((x) => x.phone === phone);
    if (!c) return Promise.reject(Object.assign(new Error('Chat not found'), { status: 404 }));
    const wa = !c.channel || c.channel === 'whatsapp';
    if (!blocked) {
      const atMeta = !!c.blockedAtMeta;
      c.blocked = false;
      c.blockedAtMeta = false;
      return delay({ success: true, blocked: false, atMeta });
    }
    const recent = !!c.lastInboundAt && Date.now() - new Date(c.lastInboundAt).getTime() < 24 * 3600e3;
    const atMeta = wa && recent;
    c.blocked = true;
    c.blockedAtMeta = atMeta;
    return delay({
      success: true,
      blocked: true,
      atMeta,
      ...(wa && !recent ? { note: 'WhatsApp only lets you block someone who messaged you in the last 24 hours.' } : {}),
    });
  }

  override reactToMessage(_phone: string, messageId: string, emoji: string): Promise<{ success: boolean }> {
    for (const list of Object.values(messages)) {
      const m = list.find((x) => x.metaMessageId === messageId);
      if (m) {
        m.reactionOut = emoji;
        m.reaction = emoji || m.reactionIn || '';
      }
    }
    return delay({ success: true });
  }

  override sendTemplateMessage(
    phone: string,
    templateName: string,
    _languageCode?: string,
    extra?: { ltoCode?: string; ltoExpiresAt?: string; bodyParams?: string[]; otpCode?: string },
  ): Promise<{ success: boolean; otpCode?: string }> {
    const t = templates.find((x) => x.name === templateName);
    const comps = t?.components || [];
    const header = comps.find((c) => c.type === 'HEADER');
    let body = comps.find((c) => c.type === 'BODY')?.text || `Template: ${templateName}`;
    if (extra?.bodyParams && extra.bodyParams.length > 0) {
      extra.bodyParams.forEach((val, idx) => {
        body = body.replace(new RegExp(`\\{\\{\\s*${idx + 1}\\s*\\}\\}`, 'g'), val || '');
      });
    }
    const footer = comps.find((c) => c.type === 'FOOTER')?.text || '';
    const tButtons = comps.find((c) => c.type === 'BUTTONS')?.buttons || [];

    const buttons = tButtons.map((b) => {
      if (b.type === 'URL') return { text: b.text, kind: 'cta', url: b.url || 'https://www.whatsapp.com' };
      if (b.type === 'PHONE_NUMBER') return { text: b.text, kind: 'call', url: b.phone || b.text };
      return { text: b.text, kind: 'reply' };
    });

    const headerImageUrl = header?.format === 'IMAGE' ? t?.headerMediaUrl || '' : '';
    const headerText = header?.format === 'TEXT' ? header.text || '' : '';

    const msg: ChatMessage = {
      _id: nextId(), phone, direction: 'out', type: 'interactive', body,
      status: 'sent', metaMessageId: nextId(), createdAt: new Date().toISOString(),
      raw: {
        outbound: {
          type: 'interactive', body, headerImageUrl, headerText, footer, buttons, cta: null,
        },
      },
    };
    (messages[phone] ||= []).push(msg);
    const chat = chats.find((x) => x.phone === phone);
    const open = !!chat?.lastInboundAt && Date.now() - new Date(chat.lastInboundAt).getTime() < 24 * 3600e3;
    bumpChat(phone, body, false);
    bus.emitMessage(msg);
    noteDemoTemplate(phone, open);
    setTimeout(() => bus.emitStatus({ metaMessageId: msg.metaMessageId!, status: 'delivered' }), 700);
    return delay({ success: true }, 150);
  }

  override sendFlow(phone: string, flowId: string): Promise<{ success: boolean }> {
    const f = flows.find((x) => x._id === flowId);
    const body = f?.msgBody || f?.name || 'Open the form';
    const cta = f?.cta || 'Open';
    const msg: ChatMessage = {
      _id: nextId(), phone, direction: 'out', type: 'interactive', body,
      status: 'sent', metaMessageId: nextId(), createdAt: new Date().toISOString(),
      raw: {
        outbound: {
          type: 'interactive',
          body,
          headerImageUrl: f?.msgHeader === 'image' ? f?.msgHeaderMediaUrl || '' : '',
          headerText: '',
          footer: f?.msgFooter || '',
          buttons: [{ text: cta, kind: 'flow' }],
          cta: null,
          flowCta: cta,
        },
      },
    };
    (messages[phone] ||= []).push(msg);
    bumpChat(phone, body, false);
    bus.emitMessage(msg);
    setTimeout(() => bus.emitStatus({ metaMessageId: msg.metaMessageId!, status: 'delivered' }), 700);
    return delay({ success: true }, 150);
  }

  override getTemplates(): Promise<ApiList<TemplateItem>> {
    return delay({ success: true, data: templates.map((t) => ({ ...t })) });
  }

  override createTemplate(form: FormData): Promise<{ success: boolean }> {
    const name = String(form.get('name') || 'new_template');
    const isDraft = String(form.get('isDraft') || form.get('status') || '').toUpperCase() === 'DRAFT' || form.get('isDraft') === 'true';
    const status = isDraft ? 'DRAFT' : 'PENDING';
    const bodyText = String(form.get('bodyText') || '');
    const footerText = String(form.get('footerText') || '');
    const headerText = String(form.get('headerText') || '');
    const headerType = String(form.get('headerType') || 'none');
    const components: TemplateItem['components'] = [];
    if (headerType === 'text' && headerText) components!.push({ type: 'HEADER', format: 'TEXT', text: headerText });
    else if (headerType === 'image') components!.push({ type: 'HEADER', format: 'IMAGE' });
    else if (headerType === 'video') components!.push({ type: 'HEADER', format: 'VIDEO' });
    components!.push({ type: 'BODY', text: bodyText });
    if (footerText) components!.push({ type: 'FOOTER', text: footerText });
    const existingIndex = templates.findIndex((t) => t.name === name);
    const item: TemplateItem = {
      name,
      status,
      language: String(form.get('language') || 'en_US'),
      category: String(form.get('category') || 'MARKETING'),
      components,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (existingIndex >= 0) {
      templates[existingIndex] = { ...templates[existingIndex], ...item };
    } else {
      templates.unshift(item);
    }
    return delay({ success: true }, 400);
  }

  override deleteTemplate(name: string): Promise<{ success: boolean }> {
    const i = templates.findIndex((t) => t.name === name);
    if (i >= 0) templates.splice(i, 1);
    return delay({ success: true });
  }

  // ---------- Categories ----------
  override getCategories(): Promise<ApiList<Category>> {
    return delay({ success: true, data: categories.map((c) => ({ ...c })) });
  }
  override createCategory(form: FormData): Promise<{ success: boolean; data: Category }> {
    const name = String(form.get('name') || '').trim();
    const file = form.get('image');
    const imageUrl = file instanceof File && file.size > 0 ? URL.createObjectURL(file) : '';
    const cat: Category = { _id: nextId(), name, imageUrl, order: categories.length + 1 };
    categories.push(cat);
    return delay({ success: true, data: cat });
  }
  override updateCategory(id: string, form: FormData): Promise<{ success: boolean; data: Category }> {
    const i = categories.findIndex((c) => c._id === id);
    const name = String(form.get('name') || '').trim();
    const file = form.get('image');
    if (i >= 0) {
      categories[i] = {
        ...categories[i],
        name: name || categories[i].name,
        imageUrl: file instanceof File && file.size > 0 ? URL.createObjectURL(file) : categories[i].imageUrl,
      };
    }
    return delay({ success: true, data: { ...(categories[i] || ({} as Category)) } });
  }
  override deleteCategory(id: string): Promise<{ success: boolean }> {
    const i = categories.findIndex((c) => c._id === id);
    if (i >= 0) categories.splice(i, 1);
    return delay({ success: true });
  }

  // ---------- Members ----------
  override getMembers(): Promise<ApiList<Member>> {
    return delay({ success: true, data: members.map((m) => ({ ...m })) });
  }
  override createMember(form: FormData): Promise<{ success: boolean; data: Member }> {
    const file = form.get('image');
    const m: Member = {
      _id: nextId(),
      name: String(form.get('name') || '').trim(),
      category: String(form.get('category') || ''),
      title: String(form.get('title') || ''),
      phone: String(form.get('phone') || ''),
      description: String(form.get('description') || ''),
      imageUrl: file instanceof File && file.size > 0 ? URL.createObjectURL(file) : '',
      order: members.length + 1,
    };
    members.push(m);
    return delay({ success: true, data: m });
  }
  override updateMember(id: string, form: FormData): Promise<{ success: boolean; data: Member }> {
    const i = members.findIndex((m) => m._id === id);
    const file = form.get('image');
    if (i >= 0) {
      members[i] = {
        ...members[i],
        name: String(form.get('name') || '').trim() || members[i].name,
        category: String(form.get('category') ?? members[i].category ?? ''),
        title: String(form.get('title') ?? members[i].title ?? ''),
        phone: String(form.get('phone') ?? members[i].phone ?? ''),
        description: String(form.get('description') ?? members[i].description ?? ''),
        imageUrl: file instanceof File && file.size > 0 ? URL.createObjectURL(file) : members[i].imageUrl,
      };
    }
    return delay({ success: true, data: { ...(members[i] || ({} as Member)) } });
  }
  override deleteMember(id: string): Promise<{ success: boolean }> {
    const i = members.findIndex((m) => m._id === id);
    if (i >= 0) members.splice(i, 1);
    return delay({ success: true });
  }

  // ---------- Registrations ----------
  override getRegistrations(): Promise<ApiList<Registration>> {
    return delay({ success: true, data: registrations.map((r) => ({ ...r })) });
  }
  override setRegistrationStatus(id: string, status: RegistrationStatus): Promise<{ success: boolean; data: Registration }> {
    const r = registrations.find((x) => x._id === id);
    if (r) r.status = status;
    return delay({ success: true, data: r ? { ...r } : ({} as Registration) });
  }
  override deleteRegistration(id: string): Promise<{ success: boolean }> {
    const i = registrations.findIndex((r) => r._id === id);
    if (i >= 0) registrations.splice(i, 1);
    return delay({ success: true });
  }

  // Demo media are object URLs — release them instead of calling the backend.
  override deleteMedia(url: string): Promise<{ success: boolean }> {
    // Dev-only test hook: which files the editors delete.
    if (import.meta.env.DEV) {
      const w = window as unknown as { __demoDeleted?: string[] };
      (w.__demoDeleted ||= []).push(url);
    }
    if (url.startsWith('blob:')) URL.revokeObjectURL(url);
    return delay({ success: true });
  }

  // ---------- Products ----------
  override getProducts(): Promise<ApiList<Product>> {
    return delay({ success: true, data: products.map((p) => ({ ...p })) });
  }
  override createProduct(form: FormData): Promise<{ success: boolean; data: Product }> {
    const p = productFromForm(form);
    products.unshift(p);
    // Simulate the Meta catalog sync completing shortly after.
    setTimeout(() => {
      p.catalogSynced = true;
    }, 800);
    return delay({ success: true, data: p }, 500);
  }
  override updateProduct(id: string, form: FormData): Promise<{ success: boolean; data: Product }> {
    const i = products.findIndex((p) => p._id === id);
    const updated = productFromForm(form, i >= 0 ? products[i] : undefined);
    if (i >= 0) products[i] = updated;
    setTimeout(() => {
      updated.catalogSynced = true;
    }, 800);
    return delay({ success: true, data: updated }, 500);
  }
  override deleteProduct(id: string): Promise<{ success: boolean }> {
    const i = products.findIndex((p) => p._id === id);
    if (i >= 0) products.splice(i, 1);
    return delay({ success: true });
  }
  override setProductPaused(id: string, paused: boolean): Promise<{ success: boolean; data: Product }> {
    const p = products.find((x) => x._id === id);
    if (p) p.isPaused = paused;
    return delay({ success: true, data: p ? { ...p } : ({} as Product) });
  }
  override syncCatalog(): Promise<{ success: boolean; pushed: number }> {
    products.forEach((p) => {
      p.catalogSynced = true;
    });
    return delay({ success: true, pushed: products.length }, 700);
  }

  // ---------- Offers ----------
  override getOffers(): Promise<ApiList<Offer>> {
    return delay({ success: true, data: offers.map((o) => ({ ...o, items: o.items.map((v) => ({ ...v })) })) });
  }
  override createOffer(body: Partial<Offer>): Promise<{ success: boolean; data: Offer }> {
    const o: Offer = {
      _id: nextId(),
      title: body.title || 'Untitled offer',
      active: body.active ?? true,
      items: (body.items || []).map((v) => ({ ...v })),
      createdAt: new Date().toISOString(),
    };
    offers.unshift(o);
    return delay({ success: true, data: { ...o } }, 400);
  }
  override updateOffer(id: string, body: Partial<Offer>): Promise<{ success: boolean; data: Offer }> {
    const i = offers.findIndex((o) => o._id === id);
    if (i >= 0) {
      offers[i] = {
        ...offers[i],
        ...body,
        items: (body.items || offers[i].items).map((v) => ({ ...v })),
      };
    }
    return delay({ success: true, data: { ...(offers[i] || ({} as Offer)) } }, 400);
  }
  override deleteOffer(id: string): Promise<{ success: boolean }> {
    const i = offers.findIndex((o) => o._id === id);
    if (i >= 0) offers.splice(i, 1);
    return delay({ success: true });
  }
  override setOfferActive(id: string, active: boolean): Promise<{ success: boolean; data: Offer }> {
    const o = offers.find((x) => x._id === id);
    if (o) o.active = active;
    return delay({ success: true, data: o ? { ...o } : ({} as Offer) });
  }

  // ---------- Flows (native WhatsApp Flow definitions) ----------
  private cloneFlow(f: WaFlowDef): WaFlowDef {
    return JSON.parse(JSON.stringify(f)) as WaFlowDef;
  }
  override listFlows(): Promise<ApiList<WaFlowDef>> {
    return delay({ success: true, data: flows.map((f) => this.cloneFlow(f)) });
  }
  override createFlowDef(body: Partial<WaFlowDef>): Promise<{ success: boolean; data: WaFlowDef }> {
    const now = new Date().toISOString();
    // Everything the server would keep (a ready-made flow brings its Start
    // wiring, map layout and chat message), then the server's own fields.
    const f: WaFlowDef = {
      ...JSON.parse(JSON.stringify(body)),
      _id: nextId(),
      name: body.name || 'Untitled flow',
      categories: body.categories || ['OTHER'],
      cta: body.cta || 'Open',
      screens: body.screens || [],
      blocks: body.blocks || [],
      flowLinks: body.flowLinks || [],
      status: 'DRAFT',
      createdAt: now,
      updatedAt: now,
    };
    flows.unshift(f);
    return delay({ success: true, data: this.cloneFlow(f) }, 350);
  }
  override updateFlowDef(id: string, body: Partial<WaFlowDef>): Promise<{ success: boolean; data: WaFlowDef }> {
    const i = flows.findIndex((f) => f._id === id);
    if (i >= 0) {
      flows[i] = { ...flows[i], ...body, _id: id, updatedAt: new Date().toISOString() };
      // Editing a published flow drops it back to a draft until republished.
      if (flows[i].status === 'PUBLISHED') flows[i].status = 'DRAFT';
    }
    return delay({ success: true, data: this.cloneFlow(flows[i] || ({} as WaFlowDef)) }, 350);
  }
  override updateFlowMessage(id: string, body: Partial<WaFlowDef>): Promise<{ success: boolean; data: WaFlowDef }> {
    const i = flows.findIndex((f) => f._id === id);
    if (i >= 0) flows[i] = { ...flows[i], ...body };
    return delay({ success: true, data: { ...(flows[i] || ({} as WaFlowDef)) } });
  }
  override deleteFlowDef(id: string): Promise<{ success: boolean }> {
    const i = flows.findIndex((f) => f._id === id);
    if (i >= 0) flows.splice(i, 1);
    return delay({ success: true });
  }
  override publishFlowDef(id: string) {
    const f = flows.find((x) => x._id === id);
    if (f) {
      f.status = 'PUBLISHED';
      if (!f.metaFlowId) f.metaFlowId = String(Math.floor(1e15 + Math.random() * 9e15));
      f.updatedAt = new Date().toISOString();
    }
    return delay(
      {
        success: true,
        data: f ? this.cloneFlow(f) : ({} as WaFlowDef),
        published: true,
        publishError: '',
        warnings: [] as string[],
        validationErrors: [] as { message?: string; error_type?: string }[],
      },
      900,
    );
  }

  // ---------- Media (demo: no backend, keep a local object URL) ----------
  override async uploadMedia(file: File): Promise<string> {
    // Dev-only test hooks: slow uploads (to exercise several at once) and failed ones.
    if (import.meta.env.DEV) {
      const w = window as unknown as { __demoUploadDelay?: number; __demoUploadFail?: boolean };
      if (w.__demoUploadDelay) await new Promise((r) => setTimeout(r, w.__demoUploadDelay));
      if (w.__demoUploadFail) throw new Error('Upload failed (test)');
      // A different address from the preview's, like a real upload.
      if (w.__demoUploadDelay) return `${URL.createObjectURL(file)}#up`;
    }
    return URL.createObjectURL(file);
  }

  // ---------- Orders & bookings ----------
  override getOrders(): Promise<ApiList<Order>> {
    return delay({ success: true, data: orders.map((o) => ({ ...o, items: o.items?.map((i) => ({ ...i })) })) });
  }
  override setOrderStatus(id: string, status: OrderStatus): Promise<{ success: boolean; data: Order }> {
    const o = orders.find((x) => x._id === id);
    if (o) o.status = status;
    return delay({ success: true, data: o ? { ...o } : ({} as Order) });
  }

  // ---------- Journeys ----------
  private cloneJourney(j: Journey): Journey {
    return JSON.parse(JSON.stringify(j)) as Journey;
  }
  override listJourneys(): Promise<ApiList<Journey>> {
    return delay({ success: true, data: journeys.map((j) => this.cloneJourney(j)) });
  }
  override createJourney(body: Partial<Journey>): Promise<{ success: boolean; data: Journey }> {
    const now = new Date().toISOString();
    const j: Journey = {
      _id: nextId(),
      name: body.name || 'Untitled journey',
      nodes: body.nodes || [],
      edges: body.edges || [],
      channel: body.channel || 'whatsapp',
      draft: body.draft ? { ...body.draft, savedAt: now } : null,
      createdAt: now,
      updatedAt: now,
    };
    journeys.unshift(j);
    return delay({ success: true, data: this.cloneJourney(j) }, 300);
  }
  override updateJourney(id: string, body: Partial<Journey>): Promise<{ success: boolean; data: Journey }> {
    const i = journeys.findIndex((j) => j._id === id);
    const now = new Date().toISOString();
    const patch = 'draft' in body ? { ...body, draft: body.draft ? { ...body.draft, savedAt: now } : null } : body;
    if (i >= 0) journeys[i] = { ...journeys[i], ...patch, _id: id, updatedAt: now };
    return delay({ success: true, data: this.cloneJourney(journeys[i] || ({} as Journey)) }, 300);
  }
  override deleteJourney(id: string): Promise<{ success: boolean }> {
    const i = journeys.findIndex((j) => j._id === id);
    if (i >= 0) journeys.splice(i, 1);
    return delay({ success: true });
  }
}

export class MockCrmSocket extends CrmSocket {
  constructor(apiBase: string) {
    super(apiBase);
  }
  override onMessage(cb: (m: ChatMessage) => void): () => void {
    return bus.onMessage(cb);
  }
  override onStatus(cb: (u: StatusUpdate) => void): () => void {
    return bus.onStatus(cb);
  }
  override onReaction(cb: (u: ReactionUpdate) => void): () => void {
    return bus.onReaction(cb);
  }
  override onTyping(cb: (u: TypingUpdate) => void): () => void {
    return bus.onTyping(cb);
  }
  override onServiceQuota(cb: (q: ServiceQuota) => void): () => void {
    return bus.onServiceQuota(cb);
  }
  override onMessagingLimit(cb: (q: MessagingLimitUsage) => void): () => void {
    return bus.onMessagingLimit(cb);
  }
  override onCall(cb: (e: CallEvent) => void): () => void {
    return bus.onCall(cb);
  }
  override onConnect(): () => void {
    return () => {};
  }
  override disconnect(): void {
    /* no-op in demo */
  }
}
