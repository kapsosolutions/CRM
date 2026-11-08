// Thin client for the multi-tenant platform backend (admin + auth + businesses).
import { defaultConfig } from '../crm/config';
import type { PlanState } from '../crm/types';
import type { EventTheme } from '../event/liveEvent';

const API = import.meta.env.VITE_API_BASE ?? defaultConfig.apiBase;

export const ADMIN_TOKEN_KEY = 'crm_admin_jwt';
export const BUSINESS_TOKEN_KEY = 'crm_business_jwt';

export interface PaymentConfig {
  enabled: boolean;
  configName: string;
  gatewayType: 'razorpay' | 'payu' | 'upi_vpa' | '';
  /**
   * Seller details. Meta requires country_of_origin / importer_name /
   * importer_address on every order line when the business has no Meta
   * catalog, so these are mandatory for a catalog-less tenant with payments on.
   */
  merchantName?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  zoneCode?: string;
  postalCode?: string;
  countryCode?: string;
  countryOfOrigin?: string;
}

export interface BusinessLabels {
  memberLabel?: string;
  memberSingular?: string;
  categoryLabel?: string;
  categoryPlural?: string;
  customerLabel?: string;
  customerPlural?: string;
}

export interface Business {
  _id: string;
  name: string;
  category?: string; // business vertical key (see crm/verticals.ts)
  /** Per-business wording overrides; blank fields fall back to category defaults. */
  labels?: BusinessLabels;
  phoneNumberId: string;
  wabaId: string;
  appId?: string;
  catalogId?: string;
  graphVersion?: string;
  payment?: PaymentConfig;
  meta?: {
    verifiedName?: string;
    displayPhoneNumber?: string;
    qualityRating?: string;
    wabaName?: string;
    catalogName?: string;
    lastVerifiedAt?: string;
  };
  username?: string;
  verifyToken?: string;
  callbackUrl?: string;
  active?: boolean;
  /** Secrets are never sent to the client, only whether one is stored. */
  hasAccessToken?: boolean;
  hasAppSecret?: boolean;
  /** Legacy 6-digit passcode still set (businesses from before sign-up). */
  hasPasscode?: boolean;
  /** A number + token are stored, so it can send. */
  whatsappConnected?: boolean;
  /** List only: the number's real Meta status (CONNECTED / PENDING / FLAGGED / …); '' = unknown or not connected. */
  numberStatus?: string;
  /** List only: `numberStatus` was just read from Meta (false = the stored snapshot). */
  numberStatusLive?: boolean;
  waConnection?: { method?: string; connectedAt?: string };
  /** Owner login (registered businesses). */
  email?: string;
  ownerFirstName?: string;
  ownerLastName?: string;
  ownerPhone?: string;
  authProvider?: string;
  createdAt?: string;
  /** 'free' = trial with a message-credit cap; 'paid' = unmetered. */
  plan?: 'free' | 'paid';
  /** The paid plan's name when recorded ('Basic' | 'Pro' | 'Premium'). */
  planName?: string;
  planChangedAt?: string;
  trial?: TrialInfo;
  /** The SaaS plan in force (Plan column; status 'trial' = the "New" label). */
  planState?: PlanState;
}

export interface TrialInfo {
  limit: number;
  used: number;
  resets?: number;
  lastResetAt?: string;
}

/** Plan + remaining allowance, as returned by /api/auth/login and /api/auth/me. */
export interface PlanSummary {
  plan: 'free' | 'paid';
  planName?: string;
  limit: number;
  used: number;
  remaining: number | null; // null when unmetered
  exhausted: boolean;
}

export interface VerifyResult {
  success: boolean;
  ok?: boolean;
  details?: Record<string, unknown>;
  errors?: string[];
  message?: string;
}

export interface CreatedCredentials {
  username: string;
  passcode: string;
  verifyToken: string;
  callbackUrl: string;
}

export interface PlatformStats {
  businesses: { total: number; active: number; inactive: number };
  messages: { total: number; last24h: number; inbound: number; outbound: number };
  totals: { conversations: number; flows: number; journeys: number; members: number; products: number; orders: number };
  byCategory: { key: string; label: string; archetype: string; count: number }[];
  daily: { date: string; count: number }[];
  recent: { _id: string; name: string; category?: string; active?: boolean; createdAt?: string }[];
}

/** A plan purchase on the dashboard's "Recent payments". */
export interface DashboardPayment {
  _id: string;
  /** '' when the business was deleted since. */
  businessId: string;
  businessName: string;
  tier: string;
  name: string;
  cycle: string;
  kind: string;
  amountPaise: number;
  paidAt: string | null;
  paymentId: string;
  method: string;
}

/** 'starter' = a bought Starter plan (tier key 'free'); 'free' = nothing bought. */
export type PlanSliceKey = 'premium' | 'pro' | 'basic' | 'starter' | 'trial' | 'free';

/** GET /api/businesses/stats/dashboard. Days and months are India time. */
export interface DashboardStats {
  generatedAt: string;
  timezone: string;
  currency: string;
  revenue: {
    totalPaise: number;
    payments: number;
    /** The last 60 days, oldest first, today last. */
    daily: { date: string; paise: number; count: number }[];
    /** The last 12 months, oldest first. */
    monthly: { month: string; paise: number; count: number }[];
    byTier: { tier: string; name: string; paise: number; count: number }[];
    recent: DashboardPayment[];
  };
  messages: {
    total: number;
    last24h: number;
    daily: { date: string; sent: number; received: number }[];
    monthly: { month: string; sent: number; received: number }[];
  };
  businesses: {
    total: number;
    active: number;
    signupsDaily: { date: string; count: number }[];
    recent: {
      _id: string;
      name: string;
      category: string;
      active: boolean;
      whatsappConnected: boolean;
      createdAt: string | null;
      plan: { slice: PlanSliceKey; name: string; status: string; daysLeft: number | null };
    }[];
  };
  plans: { key: PlanSliceKey; label: string; count: number }[];
  paying: { now: number; daily: { date: string; count: number }[] };
  activeClients: { current: number; previous: number; daily: { date: string; count: number }[] };
}

export type DemoStatus = 'scheduled' | 'completed' | 'not_answered' | 'not_interested' | 'cancelled';
export type DemoView = 'today' | 'upcoming' | 'missed' | DemoStatus | 'all';

export type SiteEventStatus = 'live' | 'scheduled' | 'ended' | 'off';
export interface SiteEventInput {
  name: string;
  startsAt: string | null;
  endsAt: string | null;
  theme: EventTheme;
}
export interface SiteEventRow extends SiteEventInput {
  _id: string;
  active: boolean;
  status: SiteEventStatus;
  createdAt?: string;
  updatedAt?: string;
}

export type ContactStatus = 'new' | 'replied' | 'closed';
export interface ContactMessage {
  _id: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  topic: 'sales' | 'support' | 'partnership' | 'api' | 'other';
  message: string;
  status: ContactStatus;
  notes: string;
  page: string;
  createdAt?: string;
}

export interface DemoRequest {
  _id: string;
  name: string;
  businessName: string;
  email: string;
  phone: string;
  category: string;
  date: string; // YYYY-MM-DD (IST)
  slot: string; // HH:MM
  timezone: string;
  scheduledAt: string;
  status: DemoStatus;
  notes?: string;
  statusChangedAt?: string;
  createdAt?: string;
}

export interface DemoCounts {
  today: number;
  upcoming: number;
  completed: number;
  not_answered: number;
  not_interested: number;
  cancelled: number;
  all: number;
}

/** GET /api/businesses/stats/tech-partner (backend services/techPartner.js). */
export type QualityRating = 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN';
export interface TechPartnerCheck {
  key: 'messages' | 'activeClients' | 'quality';
  label: string;
  /** null: nothing to measure yet (no rated number). */
  value: number | null;
  target: number;
  met: boolean;
}
export interface TechPartnerNumber {
  businessId: string;
  name: string;
  active: boolean;
  displayPhoneNumber: string;
  qualityRating: QualityRating;
  /** Read from Meta just now (false: the stored snapshot). */
  qualityLive: boolean;
  status: string;
  limit: string;
  error: string;
  messages7d: number;
  activeClient: boolean;
  /** Other Meta apps still attached to this WhatsApp account. */
  otherApps?: { id: string; name: string }[];
}
export interface TechPartnerDay {
  date: string;
  sent: number;
  received: number;
  total: number;
}
export interface TechPartnerStats {
  generatedAt: string;
  timezone: string;
  targets: { messagesPerDay: number; activeClients: number; qualityPct: number };
  eligible: boolean;
  metCount: number;
  checks: TechPartnerCheck[];
  messages: { daily: TechPartnerDay[]; today: TechPartnerDay; total7: number; avgPerDay: number; shortBy7: number };
  activeClients: { count: number; list: { businessId: string; name: string; sent30: number; lastSentAt: string | null }[] };
  quality: { pct: number | null; rated: number; counts: Record<QualityRating, number>; numbers: TechPartnerNumber[] };
}

export interface BusinessStats {
  messages: { total: number; last24h: number; inbound: number; outbound: number };
  contacts: number;
  journeys: number;
  lastMessageAt: string | null;
}

async function req<T>(path: string, opts: RequestInit = {}, token?: string): Promise<T> {
  const headers: Record<string, string> = { ...(opts.headers as Record<string, string>) };
  if (opts.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Per-field messages ({ field: message }) when the server sent them.
    throw Object.assign(new Error((data && (data.message || data.error)) || `HTTP ${res.status}`), { fields: (data && data.errors) || {} });
  }
  return data as T;
}

const adminToken = () => localStorage.getItem(ADMIN_TOKEN_KEY) || '';
const businessToken = () => localStorage.getItem(BUSINESS_TOKEN_KEY) || '';

export const platformApi = {
  apiBase: API,

  // ---- Super admin ----
  adminLogin(username: string, password: string) {
    return req<{ success: boolean; token: string }>('/api/auth/admin/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
  },
  adminLoggedIn: () => !!adminToken(),
  adminLogout: () => localStorage.removeItem(ADMIN_TOKEN_KEY),
  setAdminToken: (t: string) => localStorage.setItem(ADMIN_TOKEN_KEY, t),

  verifyBusiness(body: Record<string, unknown>) {
    return req<VerifyResult>('/api/businesses/verify', { method: 'POST', body: JSON.stringify(body) }, adminToken());
  },
  listBusinesses() {
    return req<{ success: boolean; data: Business[] }>('/api/businesses', {}, adminToken());
  },
  getBusiness(id: string) {
    return req<{ success: boolean; data: Business }>(`/api/businesses/${id}`, {}, adminToken());
  },
  /** Rename / re-categorise / re-word without re-verifying the Meta credentials. */
  updateBusinessProfile(id: string, body: { name?: string; category?: string; labels?: BusinessLabels }) {
    return req<{ success: boolean; data: Business }>(
      `/api/businesses/${id}`,
      { method: 'PATCH', body: JSON.stringify(body) },
      adminToken(),
    );
  },
  /**
   * Check an edit before saving. Falls back to the tenant's stored access
   * token when the form leaves that field blank, so an admin doesn't have to
   * paste it again to re-check a number they haven't touched.
   */
  verifyBusinessEdit(id: string, body: object) {
    return req<VerifyResult>(
      `/api/businesses/${id}/verify`,
      { method: 'POST', body: JSON.stringify(body) },
      adminToken(),
    );
  },
  /**
   * Save credentials + payment settings. Re-verifies with Meta only when a
   * field Meta owns changed, so switching payments on later needs no token.
   */
  updateBusiness(id: string, body: object) {
    return req<{ success: boolean; data: Business; verified?: boolean; webhook?: string | null }>(
      `/api/businesses/${id}`,
      { method: 'PUT', body: JSON.stringify(body) },
      adminToken(),
    );
  },
  /** Re-point this tenant's Meta app at our current callback URL. */
  syncWebhook(id: string) {
    return req<{ success: boolean; changed?: boolean; message?: string; callbackUrl?: string }>(
      `/api/businesses/${id}/sync-webhook`,
      { method: 'POST' },
      adminToken(),
    );
  },
  platformStats() {
    return req<{ success: boolean; data: PlatformStats }>('/api/businesses/stats/overview', {}, adminToken());
  },
  /** Revenue, messages, sign-ups and plans for the admin Dashboard. */
  dashboardStats() {
    return req<{ success: boolean; data: DashboardStats }>('/api/businesses/stats/dashboard', {}, adminToken());
  },
  /** `refresh`: ask Meta again for each number's quality rating. */
  techPartnerStats(refresh = false) {
    return req<{ success: boolean; data: TechPartnerStats }>(
      `/api/businesses/stats/tech-partner${refresh ? '?refresh=1' : ''}`,
      {},
      adminToken(),
    );
  },
  businessStats(id: string) {
    return req<{ success: boolean; data: BusinessStats }>(`/api/businesses/${id}/stats`, {}, adminToken());
  },
  /** Give a business an email + password login (or reset the owner's password). */
  setBusinessLogin(id: string, email: string, password: string) {
    return req<{ success: boolean; data: Business }>(
      `/api/businesses/${id}/login`,
      { method: 'POST', body: JSON.stringify({ email, password }) },
      adminToken(),
    );
  },
  regeneratePasscode(id: string) {
    return req<{ success: boolean; credentials: { username: string; passcode: string } }>(
      `/api/businesses/${id}/regenerate`,
      { method: 'POST' },
      adminToken(),
    );
  },

  // ---- Free tier (trial tenants) ----
  /** Verify the Meta credentials and create a tenant on the free plan. */
  createTrial(body: Record<string, unknown>) {
    return req<{ success: boolean; data: Business; credentials: CreatedCredentials }>(
      '/api/businesses/trial',
      { method: 'POST', body: JSON.stringify(body) },
      adminToken(),
    );
  },
  /** New passcode + a fresh 7-day free trial. Signs out the old session. */
  resetTrial(id: string, trialDays?: number) {
    return req<{ success: boolean; data: Business; credentials: { username: string; passcode: string } }>(
      `/api/businesses/${id}/trial/reset`,
      { method: 'POST', body: JSON.stringify(trialDays ? { trialDays } : {}) },
      adminToken(),
    );
  },
  /**
   * Give a business a plan without payment ({ tier, until }), or restart its
   * free trial ({ trialDays }). The business is notified.
   */
  setPlan(id: string, body: { tier: string; until: string } | { trialDays: number }) {
    return req<{ success: boolean; data: Business }>(
      `/api/businesses/${id}/plan`,
      { method: 'POST', body: JSON.stringify(body) },
      adminToken(),
    );
  },
  setBusinessActive(id: string, active: boolean) {
    return req<{ success: boolean; data: Business }>(
      `/api/businesses/${id}/active`,
      { method: 'POST', body: JSON.stringify({ active }) },
      adminToken(),
    );
  },
  /** Deletes the business and every record, file and Meta flow it owns. */
  deleteBusiness(id: string) {
    return req<{
      success: boolean;
      name?: string;
      deleted?: Record<string, number | string>;
      media?: string;
      metaFlows?: { deprecated: number; deleted: number; failed: number };
    }>(`/api/businesses/${id}`, { method: 'DELETE' }, adminToken());
  },

  // ---- Demo requests (Book a demo on the landing page) ----
  listDemos(view: DemoView, q = '') {
    return req<{ success: boolean; data: DemoRequest[]; counts: DemoCounts; today: string }>(
      `/api/admin/demos?view=${encodeURIComponent(view)}&q=${encodeURIComponent(q)}`,
      {},
      adminToken(),
    );
  },
  updateDemo(id: string, body: Partial<Pick<DemoRequest, 'status' | 'notes' | 'date' | 'slot'>>) {
    return req<{ success: boolean; data: DemoRequest; counts: DemoCounts }>(
      `/api/admin/demos/${id}`,
      { method: 'PATCH', body: JSON.stringify(body) },
      adminToken(),
    );
  },
  deleteDemo(id: string) {
    return req<{ success: boolean; counts: DemoCounts }>(`/api/admin/demos/${id}`, { method: 'DELETE' }, adminToken());
  },

  // ---- Events: themes for the website and the CRM (backend routes/events.js) ----
  listEvents() {
    return req<{ success: boolean; data: SiteEventRow[] }>('/api/admin/events', {}, adminToken());
  },
  createEvent(body: SiteEventInput) {
    return req<{ success: boolean; data: SiteEventRow }>('/api/admin/events', { method: 'POST', body: JSON.stringify(body) }, adminToken());
  },
  saveEvent(id: string, body: SiteEventInput) {
    return req<{ success: boolean; data: SiteEventRow }>(`/api/admin/events/${id}`, { method: 'PUT', body: JSON.stringify(body) }, adminToken());
  },
  activateEvent(id: string) {
    return req<{ success: boolean }>(`/api/admin/events/${id}/activate`, { method: 'POST' }, adminToken());
  },
  deactivateEvent(id: string) {
    return req<{ success: boolean }>(`/api/admin/events/${id}/deactivate`, { method: 'POST' }, adminToken());
  },
  /** Uploads the editor didn't keep (replaced again before saving, or never saved): deleted from storage. */
  discardEventImages(urls: string[], { keepalive = false } = {}) {
    return req<{ success: boolean; deleted: number }>(
      '/api/admin/events/discard',
      { method: 'POST', body: JSON.stringify({ urls }), ...(keepalive ? { keepalive: true } : {}) },
      adminToken(),
    );
  },
  deleteEvent(id: string) {
    return req<{ success: boolean }>(`/api/admin/events/${id}`, { method: 'DELETE' }, adminToken());
  },
  /** One image or GIF for an event → its public URL. */
  async uploadEventImage(file: File): Promise<string> {
    const fd = new FormData();
    fd.append('file', file);
    // Not req(): the browser sets the multipart Content-Type itself.
    const res = await fetch(`${API}/api/admin/events/upload`, { method: 'POST', body: fd, headers: { Authorization: `Bearer ${adminToken()}` } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.url) throw new Error(data.message || `Upload failed (${res.status})`);
    return data.url as string;
  },

  // ---- Contact page messages (kapsosolutions.com/contact) ----
  listContacts(status: ContactStatus | 'all' = 'all') {
    return req<{ success: boolean; data: ContactMessage[]; counts: { new: number; all: number } }>(
      `/api/admin/demos/contacts${status === 'all' ? '' : `?status=${status}`}`,
      {},
      adminToken(),
    );
  },
  updateContact(id: string, body: Partial<Pick<ContactMessage, 'status' | 'notes'>>) {
    return req<{ success: boolean }>(`/api/admin/demos/contacts/${id}`, { method: 'PATCH', body: JSON.stringify(body) }, adminToken());
  },

  // ---- Business session (sign-in itself lives in site/siteApi.ts) ----
  businessLoggedIn: () => !!businessToken(),
  businessLogout: () => localStorage.removeItem(BUSINESS_TOKEN_KEY),
  setBusinessToken: (t: string) => localStorage.setItem(BUSINESS_TOKEN_KEY, t),
};
