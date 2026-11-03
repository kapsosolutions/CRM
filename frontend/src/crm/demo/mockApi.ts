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
import type { MetaChannelsInfo, QuickMessage, UtilityTemplate } from '../types';
import type { CommentActivity, CommentRule, SocialOverview, SocialPost } from '../types';
import type { QuickStarter, WaLibraryResponse, WaLibraryTemplate, WaLibraryUseResult } from '../types';
import { demoChats, demoMessages, demoTemplates } from './mockData';
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
}

const bus = new DemoBus();

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
    const usage = { used24h: 42, messages24h: 57 };
    return delay({
      success: true,
      connected: true,
      limit: { tier: 'TIER_10K', limit: 10000, label: '10,000', unlimited: false, ...usage },
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

  override getMessages(phone: string): Promise<ApiList<ChatMessage>> {
    const list = messages[phone] || [];
    const c = chats.find((x) => x.phone === phone);
    if (c) c.unread = 0;
    return delay({ success: true, data: list.map((m) => ({ ...m })) });
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
    setTimeout(() => bus.emitStatus({ metaMessageId: msg.metaMessageId!, status: 'delivered' }), 700);
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
    bumpChat(phone, body, false);
    bus.emitMessage(msg);
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
    const f: WaFlowDef = {
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
  override disconnect(): void {
    /* no-op in demo */
  }
}
