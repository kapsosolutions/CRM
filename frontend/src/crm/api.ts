// -----------------------------------------------------------------------------
// CRM API client (fetch-based). Mirrors the backend /api/crm/* routes.
//
// Reusable: construct with a CrmConfig. The bearer token is read from (and
// written to) localStorage under config.tokenKey.
// -----------------------------------------------------------------------------
import type { CrmConfig } from './config';
import type { ApiKeyType, ApiKeyInfo, MessagingLimitUsage, MetaChannel, MetaChannelsInfo, MetaPageOption, ServiceQuota } from './types';
import type { CallPermission, CallSettings, CallSettingsUpdate, LiveCall, PollInput, EventInput, MuteFor } from './types';
import type {
  CommentActivity, CommentRule, CommentRuleInput, CommentRuleWrite, SocialMedia, SocialOverview, SocialPost, SocialPostInput, SocialRecentPost, SocialTarget,
} from './types';
import type {
  LibraryTemplate, MetaAudienceCounts, QuickMessage, QuickMessageInput, UtilityTemplate, UtilityTemplateInput, UtilityVariable,
  QuickStarter, WaLibraryResponse, WaLibraryUseInput, WaLibraryUseResult,
} from './types';
import type {
  AdCampaignsReport, AdSetsReport, AdsRange, AdsReport, AdsSummaryReport, AdsTimeSeries, LeadFormsReport, LeadsReport,
  MetaAdsConnection, MetaAdsLogin, MetaAdsStatus, MetaCatalogLogin,
} from './types';
// Ads Manager
import type {
  AdDraftItem, AdsCampaignSpec, AdsCreateOptions, AdsCreateResult, AdsDetailedItem, AdsEstimate, AdsGeoItem, AdsLocaleItem,
  AdsPageDetails, AdsPreviewFormat, AdsReviewState, AdsExistingPost,
  AdCampaignRow, AdRow, AdSetRow, AdsBulkAction, AdsBulkJob, AdsCopyResult, AdsLevel, AdsManageDetails, AdsManageDetailsResponse, AdsReviewReport, AdsVideoUpload,
  AdsAccountHealth, AdsReportQuery, AdsReportResponse, AdsActivityCategory, AdsActivityResponse,
  AdsAudienceItem, AdsAudienceJob, AdsAudienceSpec, AdsAudiencesList, AdsAudienceWrite, AdsContactFilter, AdsContactsPreview, AdsSavedAudience, AdsSavedAudiences,
  AdsCompareResult, AdsPixelDetails, AdsPixelsList, AdsRuleHistory, AdsRulePreview, AdsRuleSpec, AdsRulesList, AdsRuleWrite, AdsSplitTest, AdsTestDetails,
  AdsTestInput, AdsTestMetric, AdsTestsList,
} from './types';
import type { AdLeadsReport, BusinessSettings, PaymentSettings, BusinessProfile, SandboxInfo, ChannelStatus, ActivationResult, TwoStepPinResult, SignupActivation, WhatsAppProfile, WhatsAppProfileResponse, WhatsAppProfileUpdate, Campaign, CampaignDetail, CampaignInput, CampaignOverviewData, AppNotificationPage, Chat, ChatMessage, TemplateItem, ApiList, Product, Category, Member, Offer, WaFlowDef, FlowTemplate, Order, OrderStatus, Journey, Registration, RegistrationStatus, PlanSummary, BillingSummary, PlanState, PlanQuote, PlanCheckout, PlanPaymentLink, CatalogSync, CatalogSyncResult, TemplateSource, TemplateVariable, TriggerEvent, Slot } from './types';

/** An offer write: the saved offer plus how the catalog push went. */
export interface OfferWrite {
  success: boolean;
  data: Offer;
  sync?: CatalogSyncResult;
}

export class CrmApi {
  constructor(private config: CrmConfig) {}

  // ---------- token helpers ----------
  getToken(): string | null {
    try {
      return localStorage.getItem(this.config.tokenKey);
    } catch {
      return null;
    }
  }

  setToken(token: string | null): void {
    try {
      if (token) localStorage.setItem(this.config.tokenKey, token);
      else localStorage.removeItem(this.config.tokenKey);
    } catch {
      /* ignore */
    }
  }

  isAuthenticated(): boolean {
    return !!this.getToken();
  }

  private authHeaders(extra: Record<string, string> = {}): Record<string, string> {
    return { Authorization: `Bearer ${this.getToken() ?? ''}`, ...extra };
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.config.apiBase}${path}`, init);
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      /* no body */
    }
    if (!res.ok) {
      const message =
        (json as { message?: string } | null)?.message || `Request failed (${res.status})`;
      // The session is no longer valid — the passcode was reset, the token
      // expired, or the tenant was deactivated. Drop it and bounce back to the
      // login screen, otherwise the CRM keeps rendering against a dead session
      // and every action just fails with an unexplained error.
      if (res.status === 401 || res.status === 403) this.endSession(message);
      // The status and body ride along for callers that show field errors.
      throw Object.assign(new Error(message), { status: res.status, data: json });
    }
    return json as T;
  }

  /**
   * A multipart POST like request(), via XMLHttpRequest because fetch can't
   * report upload progress: onProgress gets 0–100 as the browser sends the file.
   */
  private upload<T>(path: string, body: FormData, onProgress?: (percent: number) => void): Promise<T> {
    if (!onProgress || typeof XMLHttpRequest === 'undefined') return this.request<T>(path, { method: 'POST', headers: this.authHeaders(), body });
    return new Promise<T>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${this.config.apiBase}${path}`);
      for (const [k, v] of Object.entries(this.authHeaders())) xhr.setRequestHeader(k, v);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && e.total > 0) onProgress(Math.min(100, Math.floor((e.loaded * 100) / e.total)));
      };
      xhr.onload = () => {
        let json: unknown = null;
        try {
          json = xhr.responseText ? JSON.parse(xhr.responseText) : null;
        } catch {
          /* no body */
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          onProgress(100);
          resolve(json as T);
          return;
        }
        const message = (json as { message?: string } | null)?.message || `Request failed (${xhr.status})`;
        if (xhr.status === 401 || xhr.status === 403) this.endSession(message);
        reject(Object.assign(new Error(message), { status: xhr.status, data: json }));
      };
      xhr.onerror = () => reject(Object.assign(new Error('The upload stopped. Check your connection and try again.'), { status: 0, data: null }));
      xhr.onabort = () => reject(Object.assign(new Error('The upload was cancelled.'), { status: 0, data: null }));
      xhr.send(body);
    });
  }

  /**
   * Clear the stored token and return to the login screen. Guarded on a token
   * actually being present so a 401 on an already-signed-out tab can't loop.
   */
  private endSession(reason: string): void {
    if (!this.getToken()) return;
    this.setToken(null);
    try {
      sessionStorage.setItem('crm_signed_out_reason', reason);
    } catch {
      /* ignore */
    }
    // Same as the admin panel: the login drawn before the reload leaves the message alone.
    (window as unknown as { __crmSigningOut?: boolean }).__crmSigningOut = true;
    window.location.reload();
  }

  // ---------- Auth ----------
  login(username: string, password: string): Promise<{ success: boolean; token: string }> {
    return this.request('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
  }

  /**
   * The logged-in tenant (or admin). Resolves the business vertical, and on a
   * free trial also the remaining message credits.
   */
  getMe(): Promise<{
    success: boolean;
    role: string; // 'admin' (platform owner) | 'business' (tenant)
    /** Session opened with the platform master passcode — owner-level access. */
    master?: boolean;
    business?: BusinessProfile;
    plan?: PlanSummary;
    /** The SaaS plan in force: open pages, limits, trial / renewal dates. */
    planState?: PlanState;
    /** Early access: the "coming soon" features are open for this business (crm/features.ts). */
    earlyAccess?: boolean;
    /** This tenant's webhook callback URL (what Meta posts messages to). */
    webhookUrl?: string;
  }> {
    return this.request('/api/auth/me', { headers: this.authHeaders() });
  }

  // ---------- Settings + WhatsApp connection ----------
  /** Public config: the Meta app + Embedded Signup configuration ids. */
  getAuthConfig(): Promise<{
    success: boolean;
    publicUrl?: string;
    meta: {
      appId: string;
      configId: string;
      graphVersion: string;
      /** Facebook Login for Business configuration (Instagram + Messenger); '' = not created yet. */
      businessLoginConfigId?: string;
      /** The configuration the Ads page's connect uses (falls back to businessLoginConfigId on the server). */
      adsLoginConfigId?: string;
      /** The configuration Catalog → Get started uses (falls back to businessLoginConfigId on the server). */
      catalogLoginConfigId?: string;
      /** The configuration the Messenger connect uses (falls back to businessLoginConfigId on the server). */
      messengerLoginConfigId?: string;
      /** Business Login for Instagram ("Log in with Instagram") is set up on the server. */
      instagramLoginConfigured?: boolean;
      instagramAppId?: string;
    };
  }> {
    return this.request('/api/auth/config');
  }

  // ---------- Instagram: Log in with Instagram (Business Login for Instagram) ----------
  /** The authorize URL (with a signed, short-lived state) the login popup opens. */
  getInstagramLoginUrl(): Promise<{ success: boolean; url: string; state: string; expiresAt: string; redirectUri: string }> {
    return this.request('/api/channels/instagram/login-url', { headers: this.authHeaders() });
  }

  /** { code, state } from instagram-callback.html → the business's connections (no tokens). */
  connectInstagramLogin(body: { code: string; state: string }): Promise<{ success: boolean; connections: MetaChannelsInfo['connections'] }> {
    return this.request('/api/channels/instagram/connect', {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
  }

  // ---------- Messenger / Instagram (Channel Status) ----------
  /** Whether Login for Business is configured, and this business's connections. */
  getMetaChannels(): Promise<MetaChannelsInfo> {
    return this.request('/api/channels/meta', { headers: this.authHeaders() });
  }

  /** The code from FB.login → the Pages the business granted (no tokens). */
  startMetaLogin(code: string): Promise<{ success: boolean; sessionId: string; tokenSource: string; pages: MetaPageOption[] }> {
    return this.request('/api/channels/meta/login', {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ code }),
    });
  }

  /** Connect the chosen Page for Messenger and/or its linked Instagram account. */
  connectMetaChannel(body: { sessionId: string; pageId: string; channels: MetaChannel[] }): Promise<{
    success: boolean;
    connections: MetaChannelsInfo['connections'];
  }> {
    return this.request('/api/channels/meta/connect', {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
  }

  disconnectMetaChannel(channel: MetaChannel): Promise<{ success: boolean; connections: MetaChannelsInfo['connections'] }> {
    return this.request(`/api/channels/meta/${channel}`, { method: 'DELETE', headers: this.authHeaders() });
  }

  getSettings(): Promise<{ success: boolean; data: BusinessSettings }> {
    return this.request('/api/settings', { headers: this.authHeaders() });
  }

  /** The shared test number and this business's join code (Chats page). */
  getSandbox(): Promise<SandboxInfo> {
    return this.request('/api/sandbox', { headers: this.authHeaders() });
  }

  /** Settings → Billing: plan, usage, messaging tier, contact, payments. */
  getBilling(): Promise<{ success: boolean; data: BillingSummary }> {
    return this.request('/api/billing', { headers: this.authHeaders() });
  }

  /** What a plan + cycle costs this business now (upgrade credit, the period it buys). */
  getPlanQuote(tier: string, cycle: string): Promise<{ success: boolean; data: PlanQuote }> {
    return this.request(`/api/billing/quote?tier=${encodeURIComponent(tier)}&cycle=${encodeURIComponent(cycle)}`, { headers: this.authHeaders() });
  }

  /** A Razorpay Payment Link for a plan: the browser goes to `url` (Razorpay's own page) and comes back to Billing. */
  startPlanPaymentLink(body: { tier: string; cycle: string }): Promise<{ success: boolean; data: PlanPaymentLink }> {
    return this.request('/api/billing/link', {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
  }

  /** Create the Razorpay order for a plan (opened in Razorpay Checkout). */
  startPlanCheckout(body: { tier: string; cycle: string }): Promise<{ success: boolean; data: PlanCheckout }> {
    return this.request('/api/billing/checkout', {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
  }

  /** The Checkout's success callback: the server verifies it with Razorpay and activates the plan. */
  confirmPlanPayment(body: { orderId: string; paymentId: string; signature: string }): Promise<{ success: boolean; activated: boolean; plan: PlanState }> {
    return this.request('/api/billing/confirm', {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
  }

  /** Live messaging limit, quality and status of the business's own number. */
  /** Disconnect the business's WhatsApp number (chats and contacts stay). */
  disconnectWhatsApp(): Promise<{ success: boolean; business: BusinessProfile }> {
    return this.request('/api/onboarding/disconnect', { method: 'POST', headers: this.authHeaders() });
  }

  /** Hide the "another app is answering your chats" notice on Channel Status. */
  dismissThreadControl(): Promise<{ success: boolean }> {
    return this.request('/api/channel/thread-control/dismiss', { method: 'POST', headers: this.authHeaders() });
  }

  getChannelStatus(refresh = false): Promise<ChannelStatus> {
    return this.request(`/api/channel/status${refresh ? '?refresh=1' : ''}`, { headers: this.authHeaders() });
  }

  /** Send a poll into a chat (buttons / a list; answers come back on its card). */
  sendPoll(phone: string, poll: PollInput): Promise<{ success: boolean; id: string }> {
    return this.request('/api/crm/send-poll', {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ phone, ...poll }),
    });
  }

  /** Send an event into a chat (details + "Add to calendar"). */
  sendEvent(phone: string, ev: EventInput): Promise<{ success: boolean }> {
    return this.request('/api/crm/send-event', {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ phone, ...ev }),
    });
  }

  // ---------- WhatsApp voice calls (backend routes/calls.js) ----------
  getCallSettings(refresh = false): Promise<{ success: boolean; connected: boolean; settings?: CallSettings }> {
    return this.request(`/api/calls/settings${refresh ? '?refresh=1' : ''}`, { headers: this.authHeaders() });
  }

  saveCallSettings(body: CallSettingsUpdate): Promise<{ success: boolean; connected: boolean; settings: CallSettings }> {
    return this.request('/api/calls/settings', {
      method: 'PUT',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
  }

  /** ICE servers for the browser's call connection. */
  getCallConfig(): Promise<{ success: boolean; iceServers: RTCIceServer[]; connected: boolean }> {
    return this.request('/api/calls/config', { headers: this.authHeaders() });
  }

  /** Calls ringing right now (a tab opened after the ring began). */
  getRingingCalls(): Promise<{ success: boolean; calls: LiveCall[] }> {
    return this.request('/api/calls/ringing', { headers: this.authHeaders() });
  }

  acceptCall(id: string, sdp: string, tabId: string): Promise<{ success: boolean; call: LiveCall }> {
    return this.request(`/api/calls/${encodeURIComponent(id)}/accept`, {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ sdp, tabId }),
    });
  }

  rejectCall(id: string): Promise<{ success: boolean }> {
    return this.request(`/api/calls/${encodeURIComponent(id)}/reject`, { method: 'POST', headers: this.authHeaders() });
  }

  endCall(id: string): Promise<{ success: boolean }> {
    return this.request(`/api/calls/${encodeURIComponent(id)}/end`, { method: 'POST', headers: this.authHeaders(), keepalive: true });
  }

  /** Hang up a call still being placed (no id yet): the server ends it once Meta returns one. */
  cancelCall(phone: string, tabId: string): Promise<{ success: boolean }> {
    return this.request('/api/calls/cancel', {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ phone, tabId }),
      keepalive: true,
    });
  }

  startCall(phone: string, sdp: string, tabId: string, name = ''): Promise<{ success: boolean; call: LiveCall }> {
    return this.request('/api/calls', {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ phone, sdp, tabId, name }),
    });
  }

  getCallPermission(phone: string): Promise<CallPermission> {
    return this.request(`/api/calls/permission?phone=${encodeURIComponent(phone)}`, { headers: this.authHeaders() });
  }

  requestCallPermission(phone: string, body = ''): Promise<{ success: boolean; id: string }> {
    return this.request('/api/calls/permission', {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ phone, body }),
    });
  }

  /** Where the public API lives, for the code samples (same origin in production). */
  apiOrigin(): string {
    const base = String(this.config.apiBase || '').replace(/\/+$/, '');
    return base || (typeof window !== 'undefined' ? window.location.origin : '');
  }

  /** The business's live API keys (never the secret). */
  listApiKeys(): Promise<{ success: boolean; data: ApiKeyInfo[] }> {
    return this.request('/api/developer/keys', { headers: this.authHeaders() });
  }

  /** A new key: `data.key` is the key itself, shown this once. */
  createApiKey(opts: string | { name: string; type?: ApiKeyType; allowedOrigins?: string[] }): Promise<{ success: boolean; data: ApiKeyInfo }> {
    const body = typeof opts === 'string' ? { name: opts } : opts;
    return this.request('/api/developer/keys', {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
  }

  /** Rename a key, or change a website key's websites. */
  updateApiKey(id: string, patch: { name?: string; allowedOrigins?: string[] }): Promise<{ success: boolean; data: ApiKeyInfo }> {
    return this.request(`/api/developer/keys/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(patch),
    });
  }

  revokeApiKey(id: string): Promise<{ success: boolean }> {
    return this.request(`/api/developer/keys/${encodeURIComponent(id)}`, { method: 'DELETE', headers: this.authHeaders() });
  }

  /** Meta's daily messaging limit and the last 24 hours' use of it. */
  getMessagingLimit(refresh = false): Promise<MessagingLimitUsage> {
    return this.request(`/api/channel/messaging-limit${refresh ? '?refresh=1' : ''}`, { headers: this.authHeaders() });
  }

  /** Meta's free service messages this month (1,000 per number), from Meta's pricing analytics. */
  getServiceQuota(refresh = false): Promise<ServiceQuota> {
    return this.request(`/api/channel/service-quota${refresh ? '?refresh=1' : ''}`, { headers: this.authHeaders() });
  }

  /**
   * Register the number with Cloud API ("Activate number"), with a 6-digit
   * PIN or the one saved on the server. A refusal throws with the server's
   * readable message; `data` carries `code` and Meta's own `metaMessage`.
   */
  activateNumber(body: { pin?: string; useSavedPin?: boolean }): Promise<ActivationResult> {
    return this.request('/api/channel/activate', {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
  }

  /**
   * Set or change the number's two-step verification PIN. A refusal throws
   * with the server's readable message; `data` carries `code` and Meta's `metaMessage`.
   */
  setTwoStepPin(pin: string): Promise<TwoStepPinResult> {
    return this.request('/api/channel/two-step-pin', {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ pin }),
    });
  }

  /** When each sidebar page (orders, form:<id>) was last opened; _since = the baseline. */
  getPagesSeen(): Promise<{ success: boolean; data: Record<string, string> }> {
    return this.request('/api/settings/pages-seen', { headers: this.authHeaders() });
  }

  /** The page is open now: its count starts again from here. */
  markPageSeen(page: string): Promise<{ success: boolean; data: Record<string, string> }> {
    return this.request('/api/settings/pages-seen', {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ page }),
    });
  }

  saveSettings(body: { catalogId?: string; payment?: PaymentSettings }): Promise<{ success: boolean; data: BusinessSettings }> {
    return this.request('/api/settings', {
      method: 'PUT',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
  }

  /** The WhatsApp business profile of the business's own number, read from Meta. */
  getWhatsAppProfile(refresh = false): Promise<WhatsAppProfileResponse> {
    return this.request(`/api/settings/whatsapp-profile${refresh ? '?refresh=1' : ''}`, { headers: this.authHeaders() });
  }

  /**
   * Update the profile on Meta. A 400 carries `errors` (field → message) on
   * the thrown error's `data`; a 502 carries Meta's message.
   */
  saveWhatsAppProfile(body: WhatsAppProfileUpdate): Promise<{ success: boolean; data: WhatsAppProfile | null }> {
    return this.request('/api/settings/whatsapp-profile', {
      method: 'PUT',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
  }

  /** Set the WhatsApp profile photo (JPEG/PNG, ≤5 MB) on Meta. */
  uploadWhatsAppProfilePicture(file: File): Promise<{ success: boolean; profilePictureUrl: string; data: WhatsAppProfile | null }> {
    const fd = new FormData();
    fd.append('file', file);
    return this.request('/api/settings/whatsapp-profile/picture', {
      method: 'POST',
      headers: this.authHeaders(),
      body: fd,
    });
  }

  /** Finish Embedded Signup with the code (and ids) Meta's popup returned. */
  completeEmbeddedSignup(body: {
    code: string;
    wabaId?: string;
    phoneNumberId?: string;
    metaBusinessId?: string;
  }): Promise<{
    success: boolean;
    business: BusinessProfile;
    warnings: string[];
    activation?: SignupActivation;
    /** Other Meta apps still attached to the WhatsApp account that was just connected. */
    otherApps?: { id: string; name: string }[];
  }> {
    return this.request('/api/onboarding/embedded-signup', {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
  }

  // ---------- Ads (Click-to-WhatsApp leads) ----------
  getAdLeads(days = 30): Promise<AdLeadsReport> {
    return this.request(`/api/ads/leads?days=${days}`, { headers: this.authHeaders() });
  }

  // ---------- Meta ad account (Ads page) ----------
  // Errors carry `data.code` (NOT_CONNECTED, ADS_REVOKED, RATE_LIMITED,
  // READ_ONLY, …); none of them is a 401/403, so they never sign the user out.
  private adsQuery(range: AdsRange, refresh = false): string {
    const p = new URLSearchParams({ preset: range.preset });
    if (range.preset === 'custom') {
      p.set('since', range.since || '');
      p.set('until', range.until || '');
    }
    if (refresh) p.set('refresh', '1');
    return p.toString();
  }

  getMetaAds(): Promise<MetaAdsStatus> {
    return this.request('/api/ads/meta', { headers: this.authHeaders() });
  }

  /** The code from FB.login → the ad accounts and Pages the business granted (no tokens). */
  startMetaAdsLogin(code: string): Promise<MetaAdsLogin> {
    return this.request('/api/ads/meta/login', {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ code }),
    });
  }

  connectMetaAds(body: { sessionId: string; adAccountId: string; pageId?: string }): Promise<{ success: boolean; connection: MetaAdsConnection }> {
    return this.request('/api/ads/meta/connect', {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
  }

  /** Catalog → Get started: the code from FB.login → the catalogs the business granted (no tokens). */
  startMetaCatalogLogin(code: string): Promise<MetaCatalogLogin> {
    return this.request('/api/catalog/meta/login', {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ code }),
    });
  }

  /** The same login's list again, after linking a catalog in WhatsApp Manager. */
  refreshMetaCatalog(sessionId: string): Promise<MetaCatalogLogin> {
    return this.request('/api/catalog/meta/refresh', {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ sessionId }),
    });
  }

  /** Connect the chosen catalog to the WhatsApp Business Account and the CRM. */
  connectMetaCatalog(body: { sessionId: string; catalogId: string }): Promise<{
    success: boolean;
    catalogId: string;
    catalogName: string;
    productCount: number | null;
  }> {
    return this.request('/api/catalog/meta/connect', {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
  }

  disconnectMetaAds(): Promise<{ success: boolean }> {
    return this.request('/api/ads/meta', { method: 'DELETE', headers: this.authHeaders() });
  }

  getAdsSummary(range: AdsRange, refresh = false): Promise<AdsSummaryReport> {
    return this.request(`/api/ads/meta/summary?${this.adsQuery(range, refresh)}`, { headers: this.authHeaders() });
  }

  getAdsTimeSeries(range: AdsRange, refresh = false): Promise<AdsTimeSeries> {
    return this.request(`/api/ads/meta/timeseries?${this.adsQuery(range, refresh)}`, { headers: this.authHeaders() });
  }

  getAdCampaigns(range: AdsRange, refresh = false): Promise<AdCampaignsReport> {
    return this.request(`/api/ads/meta/campaigns?${this.adsQuery(range, refresh)}`, { headers: this.authHeaders() });
  }

  getAdSets(campaignId: string, range: AdsRange, refresh = false): Promise<AdSetsReport> {
    return this.request(`/api/ads/meta/campaigns/${encodeURIComponent(campaignId)}/adsets?${this.adsQuery(range, refresh)}`, {
      headers: this.authHeaders(),
    });
  }

  getAds(adsetId: string, range: AdsRange, refresh = false): Promise<AdsReport> {
    return this.request(`/api/ads/meta/adsets/${encodeURIComponent(adsetId)}/ads?${this.adsQuery(range, refresh)}`, {
      headers: this.authHeaders(),
    });
  }

  setAdStatus(body: { level: 'campaign' | 'adset' | 'ad'; id: string; status: 'ACTIVE' | 'PAUSED' }): Promise<{ success: boolean; status: string }> {
    return this.request('/api/ads/meta/status', {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
  }

  getLeadForms(refresh = false): Promise<LeadFormsReport> {
    return this.request(`/api/ads/meta/leadforms${refresh ? '?refresh=1' : ''}`, { headers: this.authHeaders() });
  }

  getLeads(formId: string, refresh = false): Promise<LeadsReport> {
    return this.request(`/api/ads/meta/leadforms/${encodeURIComponent(formId)}/leads${refresh ? '?refresh=1' : ''}`, {
      headers: this.authHeaders(),
    });
  }

  /** The form's leads as a CSV file (the server builds it). */
  async downloadLeadsCsv(formId: string): Promise<{ blob: Blob; filename: string }> {
    const res = await fetch(`${this.config.apiBase}/api/ads/meta/leadforms/${encodeURIComponent(formId)}/leads.csv`, {
      headers: this.authHeaders(),
    });
    if (!res.ok) {
      let json: { message?: string; code?: string } | null = null;
      try {
        json = await res.json();
      } catch {
        /* no body */
      }
      if (res.status === 401 || res.status === 403) this.endSession(json?.message || 'Unauthorized');
      throw Object.assign(new Error(json?.message || `Request failed (${res.status})`), { status: res.status, data: json });
    }
    const m = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '');
    return { blob: await res.blob(), filename: m?.[1] || 'leads.csv' };
  }

  // ---------- Ads Manager (S1: create campaign wizard) ----------
  // Same error shape as the other ads calls (data.code: READ_ONLY,
  // INVALID_INPUT + data.field, NOT_IN_ACCOUNT, RATE_LIMITED, ADS_REVOKED…).
  private adsJson(path: string, method: string, body: unknown) {
    return this.request(path, {
      method,
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
  }

  getAdsCreateOptions(refresh = false): Promise<AdsCreateOptions> {
    return this.request(`/api/ads/meta/create/options${refresh ? '?refresh=1' : ''}`, { headers: this.authHeaders() });
  }

  getAdsPageDetails(pageId: string): Promise<AdsPageDetails> {
    return this.request(`/api/ads/meta/create/pages/${encodeURIComponent(pageId)}`, { headers: this.authHeaders() });
  }

  /** The Page's (or its Instagram account's) recent posts, with Meta's "can be promoted" flag. */
  getAdsPagePosts(pageId: string, source: 'facebook' | 'instagram', instagramId = '', refresh = false): Promise<{ success: boolean; source: string; posts: AdsExistingPost[] }> {
    const p = new URLSearchParams({ source });
    if (instagramId) p.set('instagramId', instagramId);
    if (refresh) p.set('refresh', '1');
    return this.request(`/api/ads/meta/create/pages/${encodeURIComponent(pageId)}/posts?${p}`, { headers: this.authHeaders() });
  }

  searchAdsTargeting(type: 'geo', q: string): Promise<{ success: boolean; results: AdsGeoItem[] }>;
  searchAdsTargeting(type: 'interest', q: string): Promise<{ success: boolean; results: AdsDetailedItem[] }>;
  searchAdsTargeting(type: 'locale', q: string): Promise<{ success: boolean; results: AdsLocaleItem[] }>;
  searchAdsTargeting(type: 'geo' | 'interest' | 'locale', q: string): Promise<{ success: boolean; results: unknown[] }> {
    const p = new URLSearchParams({ type, q });
    return this.request(`/api/ads/meta/create/search?${p.toString()}`, { headers: this.authHeaders() });
  }

  browseAdsTargeting(cls: 'interests' | 'behaviors' | 'demographics'): Promise<{ success: boolean; items: AdsDetailedItem[] }> {
    return this.request(`/api/ads/meta/create/browse?class=${cls}`, { headers: this.authHeaders() });
  }

  estimateAdsAudience(body: Partial<AdsCampaignSpec>): Promise<AdsEstimate> {
    return this.adsJson('/api/ads/meta/create/estimate', 'POST', body) as Promise<AdsEstimate>;
  }

  /** Meta's preview iframe src for one placement (the browser renders its own sandboxed iframe). */
  previewAdsCreative(spec: AdsCampaignSpec, format: AdsPreviewFormat): Promise<{ success: boolean; format: AdsPreviewFormat; src: string }> {
    return this.adsJson('/api/ads/meta/create/preview', 'POST', { spec, format }) as Promise<{ success: boolean; format: AdsPreviewFormat; src: string }>;
  }

  /** onProgress: 0–100 as the browser sends the file to the CRM server. */
  uploadAdImage(file: File, onProgress?: (percent: number) => void): Promise<{ success: boolean; image: { hash: string; url: string; name: string; width: number | null; height: number | null } }> {
    const fd = new FormData();
    fd.append('file', file);
    return this.upload('/api/ads/meta/create/images', fd, onProgress);
  }

  /**
   * Lands the file on the CRM server and answers at once (202); poll getAdVideoUpload until Meta's video id is there.
   * onProgress: 0–100 as the browser sends the file to the CRM server.
   */
  uploadAdVideo(file: File, onProgress?: (percent: number) => void): Promise<{ success: boolean; upload: AdsVideoUpload }> {
    const fd = new FormData();
    fd.append('file', file);
    return this.upload('/api/ads/meta/create/videos', fd, onProgress);
  }

  getAdVideoUpload(uploadId: string): Promise<{ success: boolean; upload: AdsVideoUpload }> {
    return this.request(`/api/ads/meta/create/videos/uploads/${encodeURIComponent(uploadId)}`, { headers: this.authHeaders() });
  }

  getAdVideoStatus(id: string): Promise<{ success: boolean; video: { id: string; status: string; ready: boolean; progress: number | null; thumbnailUrl: string } }> {
    return this.request(`/api/ads/meta/create/videos/${encodeURIComponent(id)}`, { headers: this.authHeaders() });
  }

  getAdsMediaLibrary(type: 'image' | 'video'): Promise<{
    success: boolean;
    type: 'image' | 'video';
    items: { hash?: string; id?: string; url?: string; thumbUrl: string; name?: string; title?: string }[];
  }> {
    return this.request(`/api/ads/meta/create/library?type=${type}`, { headers: this.authHeaders() });
  }

  createAdsLeadForm(body: {
    name: string;
    intro?: string;
    questions: { type: string; label?: string }[];
    privacyUrl: string;
    privacyText?: string;
    thankYou?: { title?: string; body?: string; websiteUrl?: string; buttonText?: string };
  }): Promise<{ success: boolean; form: { id: string; name: string } }> {
    return this.adsJson('/api/ads/meta/create/leadforms', 'POST', body) as Promise<{ success: boolean; form: { id: string; name: string } }>;
  }

  /** Campaign → ad set → creative → ad, all PAUSED at Meta. `requestId`: one per Create click (a retry with it returns the first answer). */
  createAdsCampaign(spec: AdsCampaignSpec, draftId?: string, requestId?: string): Promise<AdsCreateResult> {
    return this.adsJson('/api/ads/meta/create', 'POST', { spec, draftId: draftId || undefined, requestId: requestId || undefined }) as Promise<AdsCreateResult>;
  }

  /** Sets exactly the created ad and ad set, then the campaign, ACTIVE. Only after the user confirmed. */
  publishAdsCampaign(campaignId: string, ids: { adsetId: string; adId: string; requestId?: string }): Promise<AdsReviewState> {
    return this.adsJson(`/api/ads/meta/campaigns/${encodeURIComponent(campaignId)}/publish`, 'POST', {
      confirm: true, adsetId: ids.adsetId, adId: ids.adId, requestId: ids.requestId || undefined,
    }) as Promise<AdsReviewState>;
  }

  getAdsCampaignReview(campaignId: string): Promise<AdsReviewState> {
    return this.request(`/api/ads/meta/campaigns/${encodeURIComponent(campaignId)}/review`, { headers: this.authHeaders() });
  }

  listAdDrafts(): Promise<{ success: boolean; drafts: AdDraftItem[] }> {
    return this.request('/api/ads/meta/drafts', { headers: this.authHeaders() });
  }

  getAdDraft(id: string): Promise<{ success: boolean; draft: AdDraftItem }> {
    return this.request(`/api/ads/meta/drafts/${encodeURIComponent(id)}`, { headers: this.authHeaders() });
  }

  saveAdDraft(id: string | null, step: number, spec: AdsCampaignSpec): Promise<{ success: boolean; draft: AdDraftItem }> {
    return (id
      ? this.adsJson(`/api/ads/meta/drafts/${encodeURIComponent(id)}`, 'PUT', { step, spec })
      : this.adsJson('/api/ads/meta/drafts', 'POST', { step, spec })) as Promise<{ success: boolean; draft: AdDraftItem }>;
  }

  deleteAdDraft(id: string): Promise<{ success: boolean }> {
    return this.request(`/api/ads/meta/drafts/${encodeURIComponent(id)}`, { method: 'DELETE', headers: this.authHeaders() });
  }

  // ---------- Ads Manager (S2: manage existing campaigns, ad sets, ads) ----------
  // Edits never change the status; duplicates are created PAUSED; archive,
  // delete, bulk resume and bulk archive send { confirm: true } only after the
  // user confirmed in the CRM.
  getAdsManageDetails<T extends AdsManageDetails = AdsManageDetails>(level: AdsLevel, id: string): Promise<AdsManageDetailsResponse<T>> {
    return this.request(`/api/ads/meta/manage/${level}/${encodeURIComponent(id)}`, { headers: this.authHeaders() });
  }

  editAdsObject<T extends AdsManageDetails = AdsManageDetails>(level: AdsLevel, id: string, patch: Record<string, unknown>): Promise<AdsManageDetailsResponse<T>> {
    return this.adsJson(`/api/ads/meta/manage/${level}/${encodeURIComponent(id)}`, 'PATCH', patch) as Promise<AdsManageDetailsResponse<T>>;
  }

  duplicateAdsObject(level: AdsLevel, id: string): Promise<{ success: boolean; copy: AdsCopyResult }> {
    return this.adsJson(`/api/ads/meta/manage/${level}/${encodeURIComponent(id)}/duplicate`, 'POST', {}) as Promise<{ success: boolean; copy: AdsCopyResult }>;
  }

  /** Archive or delete at Meta. Only after the user confirmed. */
  removeAdsObject(level: AdsLevel, id: string, action: 'archive' | 'delete'): Promise<{ success: boolean; id: string; status: string }> {
    return this.adsJson(`/api/ads/meta/manage/${level}/${encodeURIComponent(id)}/${action}`, 'POST', { confirm: true }) as Promise<{ success: boolean; id: string; status: string }>;
  }

  /**
   * Bulk pause / resume / duplicate / archive as a server job (202 { job });
   * poll getAdsBulkJob. `confirmed` only after the confirm dialog; `key` is one
   * per click, so a retried request returns the same job instead of a new run.
   */
  bulkAdsAction(action: AdsBulkAction, level: AdsLevel, ids: string[], confirmed: boolean, key: string): Promise<{ success: boolean; job: AdsBulkJob; replayed?: boolean }> {
    return this.adsJson('/api/ads/meta/manage/bulk', 'POST', { action, level, ids, key, ...(confirmed ? { confirm: true } : {}) }) as Promise<{ success: boolean; job: AdsBulkJob; replayed?: boolean }>;
  }

  getAdsBulkJob(id: string): Promise<{ success: boolean; job: AdsBulkJob }> {
    return this.request(`/api/ads/meta/manage/bulk/${encodeURIComponent(id)}`, { headers: this.authHeaders() });
  }

  getAdsReview(level: AdsLevel, parentId = '', refresh = false): Promise<AdsReviewReport> {
    const p = new URLSearchParams({ level, ...(parentId ? { parentId } : {}), ...(refresh ? { refresh: '1' } : {}) });
    return this.request(`/api/ads/meta/manage/review?${p.toString()}`, { headers: this.authHeaders() });
  }

  getAdsArchived(level: AdsLevel, parentId = '', refresh = false): Promise<{ success: boolean; level: AdsLevel; rows: (AdCampaignRow | AdSetRow | AdRow)[] }> {
    const p = new URLSearchParams({ level, ...(parentId ? { parentId } : {}), ...(refresh ? { refresh: '1' } : {}) });
    return this.request(`/api/ads/meta/manage/archived?${p.toString()}`, { headers: this.authHeaders() });
  }

  /** Meta's preview of an existing ad: an iframe src only (render it in a sandboxed iframe). */
  getAdPreview(adId: string, format: AdsPreviewFormat): Promise<{ success: boolean; format: AdsPreviewFormat; src: string }> {
    return this.request(`/api/ads/meta/manage/ad/${encodeURIComponent(adId)}/preview?format=${format}`, { headers: this.authHeaders() });
  }

  // ---------- Ads Manager (S3: reports) ----------
  // Large reports answer { mode: 'async', run }: poll getAdsReportRun(run.id)
  // until it carries the report (REPORT_FAILED / REPORT_TIMEOUT otherwise).
  private adsReportQuery(q: AdsReportQuery, range: AdsRange, refresh = false): string {
    const p = new URLSearchParams(this.adsQuery(range, refresh));
    p.set('level', q.level);
    p.set('breakdown', q.breakdown);
    p.set('columns', q.columns.join(','));
    if (q.parentId) p.set('parentId', q.parentId);
    if (q.compare) p.set('compare', '1');
    if (q.mode && q.mode !== 'auto') p.set('mode', q.mode);
    return p.toString();
  }

  getAdsReport(q: AdsReportQuery, range: AdsRange, refresh = false): Promise<AdsReportResponse> {
    return this.request(`/api/ads/meta/reports/insights?${this.adsReportQuery(q, range, refresh)}`, { headers: this.authHeaders() });
  }

  getAdsReportRun(runId: string): Promise<AdsReportResponse> {
    return this.request(`/api/ads/meta/reports/runs/${encodeURIComponent(runId)}`, { headers: this.authHeaders() });
  }

  /** The report as a CSV file (the server builds it, formula-safe). */
  async downloadAdsReportCsv(q: AdsReportQuery, range: AdsRange): Promise<{ blob: Blob; filename: string }> {
    const res = await fetch(`${this.config.apiBase}/api/ads/meta/reports/insights.csv?${this.adsReportQuery(q, range)}`, {
      headers: this.authHeaders(),
    });
    if (!res.ok) {
      let json: { message?: string; code?: string } | null = null;
      try {
        json = await res.json();
      } catch {
        /* no body */
      }
      if (res.status === 401 || res.status === 403) this.endSession(json?.message || 'Unauthorized');
      throw Object.assign(new Error(json?.message || `Request failed (${res.status})`), { status: res.status, data: json });
    }
    const m = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '');
    return { blob: await res.blob(), filename: m?.[1] || 'ads-report.csv' };
  }

  /** The ad account's activity log in the range (the Performance overview's history markers). */
  getAdsActivity(range: AdsRange, category: AdsActivityCategory | 'all' = 'all', refresh = false): Promise<AdsActivityResponse> {
    const p = new URLSearchParams(this.adsQuery(range, refresh));
    p.set('category', category);
    return this.request(`/api/ads/meta/reports/activity?${p}`, { headers: this.authHeaders() });
  }

  getAdsHealth(refresh = false): Promise<{ success: boolean; health: AdsAccountHealth }> {
    return this.request(`/api/ads/meta/reports/health${refresh ? '?refresh=1' : ''}`, { headers: this.authHeaders() });
  }

  // ---------- Ads Manager (S4: audiences) ----------
  // The server picks the contacts, hashes the numbers and uploads them in the
  // background: create / refresh answer with a job to poll. Errors add
  // TERMS_NOT_ACCEPTED (+ data.termsUrl), NO_CONTACTS, JOB_RUNNING, AUDIENCE_BUSY.
  getAdsAudiences(refresh = false): Promise<AdsAudiencesList> {
    return this.request(`/api/ads/meta/audiences${refresh ? '?refresh=1' : ''}`, { headers: this.authHeaders() });
  }

  getAdsAudience(id: string): Promise<{ success: boolean; audience: AdsAudienceItem }> {
    return this.request(`/api/ads/meta/audiences/${encodeURIComponent(id)}`, { headers: this.authHeaders() });
  }

  /** How many WhatsApp contacts an upload would send (counts only). */
  getAdsAudienceContacts(filter: AdsContactFilter, days: number): Promise<AdsContactsPreview> {
    const p = new URLSearchParams({ filter, ...(filter === 'all' ? {} : { days: String(days) }) });
    return this.request(`/api/ads/meta/audiences/contacts?${p.toString()}`, { headers: this.authHeaders() });
  }

  createAdsAudience(body: { name: string; description?: string; filter: AdsContactFilter; days?: number }): Promise<AdsAudienceWrite> {
    return this.adsJson('/api/ads/meta/audiences', 'POST', body) as Promise<AdsAudienceWrite>;
  }

  /** Replace the audience's people with the current contacts (same filter unless one is given). */
  refreshAdsAudience(id: string, body: { filter?: AdsContactFilter; days?: number } = {}): Promise<AdsAudienceWrite> {
    return this.adsJson(`/api/ads/meta/audiences/${encodeURIComponent(id)}/refresh`, 'POST', body) as Promise<AdsAudienceWrite>;
  }

  getAdsAudienceJob(id: string): Promise<{ success: boolean; job: AdsAudienceJob }> {
    return this.request(`/api/ads/meta/audiences/jobs/${encodeURIComponent(id)}`, { headers: this.authHeaders() });
  }

  createAdsLookalike(body: { name: string; originId: string; countries: string[]; ratio: number }): Promise<AdsAudienceWrite> {
    return this.adsJson('/api/ads/meta/audiences/lookalike', 'POST', body) as Promise<AdsAudienceWrite>;
  }

  /** Delete at Meta. Only after the user confirmed. */
  deleteAdsAudience(id: string): Promise<{ success: boolean; id: string; deleted: boolean }> {
    return this.adsJson(`/api/ads/meta/audiences/${encodeURIComponent(id)}/delete`, 'POST', { confirm: true }) as Promise<{ success: boolean; id: string; deleted: boolean }>;
  }

  getAdsSavedAudiences(refresh = false): Promise<AdsSavedAudiences> {
    return this.request(`/api/ads/meta/audiences/saved${refresh ? '?refresh=1' : ''}`, { headers: this.authHeaders() });
  }

  createAdsSavedAudience(body: { name: string; description?: string; audience: AdsAudienceSpec }): Promise<{ success: boolean; saved: AdsSavedAudience }> {
    return this.adsJson('/api/ads/meta/audiences/saved', 'POST', body) as Promise<{ success: boolean; saved: AdsSavedAudience }>;
  }

  deleteAdsSavedAudience(id: string): Promise<{ success: boolean; id: string; deleted: boolean }> {
    return this.request(`/api/ads/meta/audiences/saved/${encodeURIComponent(id)}`, { method: 'DELETE', headers: this.authHeaders() });
  }

  // ---------- Ads Manager (S5: automation, A/B tests, pixels) ----------
  // Rules are created off unless { enabled: true, confirm: true }; turning one
  // on, editing an enabled one, deleting and creating a test send
  // { confirm: true } only after the user confirmed (400 CONFIRM_REQUIRED +
  // data.summary otherwise). A confirmed create / edit / turn-on also sends the
  // summaryHash of the summary the user saw; when it no longer matches what is
  // sent, the answer is 409 SUMMARY_STALE with data.summary + data.summaryHash
  // to confirm instead. Other codes: NOT_EDITABLE, NO_BUSINESS.
  /** `refresh` re-reads Meta; `mirror: false` (after a write) doesn't force the history mirror. */
  getAdsRules(refresh = false, { mirror = true }: { mirror?: boolean } = {}): Promise<AdsRulesList> {
    const q = refresh ? `?refresh=1${mirror ? '' : '&mirror=0'}` : '';
    return this.request(`/api/ads/meta/automation/rules${q}`, { headers: this.authHeaders() });
  }

  /** What the rule will do, in words, and its summaryHash (nothing is written). */
  previewAdsRule(spec: AdsRuleSpec): Promise<AdsRulePreview> {
    return this.adsJson('/api/ads/meta/automation/rules/preview', 'POST', { spec }) as Promise<AdsRulePreview>;
  }

  createAdsRule(spec: AdsRuleSpec, enabled = false, confirm = false, summaryHash = ''): Promise<AdsRuleWrite> {
    return this.adsJson('/api/ads/meta/automation/rules', 'POST', { spec, enabled, ...(confirm ? { confirm: true, summaryHash } : {}) }) as Promise<AdsRuleWrite>;
  }

  updateAdsRule(id: string, spec: AdsRuleSpec, confirm = false, summaryHash = ''): Promise<AdsRuleWrite> {
    return this.adsJson(`/api/ads/meta/automation/rules/${encodeURIComponent(id)}`, 'PUT', { spec, ...(confirm ? { confirm: true, summaryHash } : {}) }) as Promise<AdsRuleWrite>;
  }

  setAdsRuleStatus(id: string, status: 'ENABLED' | 'DISABLED', confirm = false, summaryHash = ''): Promise<AdsRuleWrite> {
    return this.adsJson(`/api/ads/meta/automation/rules/${encodeURIComponent(id)}/status`, 'POST', { status, ...(confirm ? { confirm: true, summaryHash } : {}) }) as Promise<AdsRuleWrite>;
  }

  /** Delete at Meta. Only after the user confirmed. */
  deleteAdsRule(id: string): Promise<{ success: boolean; id: string; deleted: boolean }> {
    return this.adsJson(`/api/ads/meta/automation/rules/${encodeURIComponent(id)}/delete`, 'POST', { confirm: true }) as Promise<{ success: boolean; id: string; deleted: boolean }>;
  }

  getAdsRuleHistory(id: string): Promise<AdsRuleHistory> {
    return this.request(`/api/ads/meta/automation/rules/${encodeURIComponent(id)}/history`, { headers: this.authHeaders() });
  }

  getAdsTests(refresh = false): Promise<AdsTestsList> {
    return this.request(`/api/ads/meta/automation/tests${refresh ? '?refresh=1' : ''}`, { headers: this.authHeaders() });
  }

  getAdsTest(id: string): Promise<AdsTestDetails> {
    return this.request(`/api/ads/meta/automation/tests/${encodeURIComponent(id)}`, { headers: this.authHeaders() });
  }

  createAdsTest(body: AdsTestInput): Promise<{ success: boolean; test: AdsSplitTest }> {
    return this.adsJson('/api/ads/meta/automation/tests', 'POST', body) as Promise<{ success: boolean; test: AdsSplitTest }>;
  }

  /** The CRM comparison of 2–5 campaigns or ad sets (S3 report engine + a significance check). */
  getAdsCompare(q: { level: 'campaign' | 'adset'; ids: string[]; metric: AdsTestMetric; confidence: number }, range: AdsRange, refresh = false): Promise<AdsCompareResult> {
    const p = new URLSearchParams(this.adsQuery(range, refresh));
    p.set('level', q.level);
    p.set('ids', q.ids.join(','));
    p.set('metric', q.metric);
    p.set('confidence', String(q.confidence));
    return this.request(`/api/ads/meta/automation/compare?${p.toString()}`, { headers: this.authHeaders() });
  }

  getAdsPixels(refresh = false): Promise<AdsPixelsList> {
    return this.request(`/api/ads/meta/automation/pixels${refresh ? '?refresh=1' : ''}`, { headers: this.authHeaders() });
  }

  getAdsPixel(id: string, range: '24h' | '7d' = '24h', refresh = false): Promise<AdsPixelDetails> {
    return this.request(`/api/ads/meta/automation/pixels/${encodeURIComponent(id)}?range=${range}${refresh ? '&refresh=1' : ''}`, { headers: this.authHeaders() });
  }

  // ---------- CRM ----------
  /** `contactLimit`: the plan's contact limit (Free), null when it has none. */
  getChats(): Promise<ApiList<Chat> & { contactLimit?: { limit: number; used: number; full: boolean } | null }> {
    return this.request('/api/crm/chats', { headers: this.authHeaders() });
  }

  createChat(phone: string, name?: string, channel?: string): Promise<{ success: boolean; data: Chat }> {
    return this.request('/api/crm/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.authHeaders() },
      body: JSON.stringify({ phone, name, channel }),
    });
  }

  /**
   * A page of a chat, oldest first: the newest `limit` messages, or the
   * `limit` before `before` (the oldest one already shown). `hasMore` = older
   * ones exist; `lastInboundAt` (first page) times the 24-hour window.
   */
  getMessages(
    phone: string,
    page: { limit?: number; before?: ChatMessage } = {},
  ): Promise<ApiList<ChatMessage> & { hasMore?: boolean; lastInboundAt?: string | null }> {
    const q = new URLSearchParams();
    if (page.limit) q.set('limit', String(page.limit));
    if (page.before?.createdAt) {
      q.set('before', page.before.createdAt);
      if (page.before._id) q.set('beforeId', page.before._id);
    }
    const qs = q.toString();
    return this.request(`/api/crm/messages/${phone}${qs ? `?${qs}` : ''}`, { headers: this.authHeaders() });
  }

  /** Clear chat: its messages and files go, the contact stays. */
  deleteChat(phone: string): Promise<{ success: boolean }> {
    return this.request(`/api/crm/chats/${phone}`, {
      method: 'DELETE',
      headers: this.authHeaders(),
    });
  }

  /** Delete chat: the messages and the contact. */
  deleteContact(phone: string): Promise<{ success: boolean; keptBlocked?: boolean }> {
    return this.request(`/api/crm/contacts/${phone}`, {
      method: 'DELETE',
      headers: this.authHeaders(),
    });
  }

  /** Mute for 8 hours, a week or always; `null` unmutes. */
  muteChat(phone: string, until: MuteFor | null): Promise<{ success: boolean; mutedUntil: string | null }> {
    return this.request('/api/crm/mute', {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ phone, until }),
    });
  }

  setFavourite(phone: string, favourite: boolean): Promise<{ success: boolean; favourite: boolean }> {
    return this.request('/api/crm/favourite', {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ phone, favourite }),
    });
  }

  /** `atMeta`: blocked on WhatsApp itself too; `note`: why it wasn't. */
  setBlocked(phone: string, blocked: boolean): Promise<{ success: boolean; blocked: boolean; atMeta: boolean; note?: string }> {
    return this.request('/api/crm/block', {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ phone, blocked }),
    });
  }

  markRead(phone: string): Promise<{ success: boolean }> {
    return this.request('/api/crm/read', {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ phone }),
    });
  }

  setPause(phone: string, paused: boolean): Promise<{ success: boolean; botPaused: boolean }> {
    return this.request('/api/crm/pause', {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ phone, paused }),
    });
  }

  sendMessage(
    phone: string,
    text: string,
    replyTo?: { author: string; preview: string },
  ): Promise<{ success: boolean }> {
    return this.request('/api/crm/send', {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ phone, text, replyTo }),
    });
  }

  reactToMessage(phone: string, messageId: string, emoji: string): Promise<{ success: boolean }> {
    return this.request('/api/crm/react', {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ phone, messageId, emoji }),
    });
  }

  sendMedia(
    phone: string,
    file: File,
    caption?: string,
    voice?: boolean,
  ): Promise<{ success: boolean }> {
    const fd = new FormData();
    fd.append('phone', phone);
    fd.append('file', file);
    if (caption) fd.append('caption', caption);
    if (voice) fd.append('voice', '1');
    return this.request('/api/crm/send-media', {
      method: 'POST',
      headers: this.authHeaders(), // let the browser set multipart boundary
      body: fd,
    });
  }

  sendTemplateMessage(
    phone: string,
    templateName: string,
    languageCode: string,
    /** Limited-time offers: override the stored code / end time for this send. */
    /** Authentication templates: `otpCode` is the one-time code to send. */
    extra?: { ltoCode?: string; ltoExpiresAt?: string; bodyParams?: string[]; otpCode?: string },
  ): Promise<{ success: boolean; otpCode?: string }> {
    return this.request('/api/crm/send-template', {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ phone, templateName, languageCode, ...(extra || {}) }),
    });
  }

  // ---------- Campaigns (sent by the server) ----------
  getCampaigns(): Promise<ApiList<Campaign>> {
    return this.request('/api/campaigns', { headers: this.authHeaders() });
  }

  /** KPI cards: daily limit and its use, quality, sending streak (tz = minutes east of UTC). */
  getCampaignOverview(tz: number): Promise<CampaignOverviewData> {
    return this.request(`/api/campaigns/overview?tz=${encodeURIComponent(String(tz))}`, { headers: this.authHeaders() });
  }

  getCampaign(id: string): Promise<{ success: boolean; data: CampaignDetail }> {
    return this.request(`/api/campaigns/${encodeURIComponent(id)}`, { headers: this.authHeaders() });
  }

  createCampaign(body: CampaignInput): Promise<{ success: boolean; data: Campaign }> {
    return this.request('/api/campaigns', {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
  }

  /** Edit a draft or scheduled campaign (mode 'now' sends it). */
  updateCampaign(id: string, body: CampaignInput): Promise<{ success: boolean; data: Campaign }> {
    return this.request(`/api/campaigns/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
  }

  cancelCampaign(id: string): Promise<{ success: boolean }> {
    return this.request(`/api/campaigns/${encodeURIComponent(id)}/cancel`, {
      method: 'POST',
      headers: this.authHeaders(),
    });
  }

  deleteCampaign(id: string): Promise<{ success: boolean }> {
    return this.request(`/api/campaigns/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: this.authHeaders(),
    });
  }

  /** Messenger / Instagram campaign audience: how many chats, how many inside the 24-hour window now. */
  getCampaignAudience(channel: MetaChannel, activeDays = 0): Promise<MetaAudienceCounts> {
    const q = new URLSearchParams({ channel, activeDays: String(activeDays || 0) });
    return this.request(`/api/campaigns/audience?${q.toString()}`, { headers: this.authHeaders() });
  }

  // ---------- Messenger utility templates / Messenger + Instagram quick messages ----------
  // Errors carry data.code (CHANNEL_NOT_CONNECTED, INVALID_INPUT + data.problems,
  // CHANNEL_WINDOW_CLOSED, META_ERROR + data.metaCode…).
  private mmJson<T>(path: string, method: string, body?: unknown): Promise<T> {
    return this.request(`/api/meta-messaging${path}`, {
      method,
      headers: this.authHeaders(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  }

  getUtilityTemplates(): Promise<{ success: boolean; pageId: string; data: UtilityTemplate[] }> {
    return this.mmJson('/utility-templates', 'GET');
  }

  createUtilityTemplate(body: UtilityTemplateInput): Promise<{ success: boolean; data: UtilityTemplate }> {
    return this.mmJson('/utility-templates', 'POST', body);
  }

  searchTemplateLibrary(q: string, language = ''): Promise<{ success: boolean; data: LibraryTemplate[] }> {
    const p = new URLSearchParams({ q, ...(language ? { language } : {}) });
    return this.mmJson(`/utility-templates/library?${p.toString()}`, 'GET');
  }

  cloneLibraryTemplate(body: {
    libraryTemplateName: string;
    name: string;
    language: string;
    libraryBody: string;
    libraryBodyParams: string[];
    libraryButtons: { type: string; text: string }[];
    buttonInputs: { url?: string; phone?: string }[];
    variables: UtilityVariable[];
  }): Promise<{ success: boolean; data: UtilityTemplate }> {
    return this.mmJson('/utility-templates/clone', 'POST', body);
  }

  refreshUtilityTemplates(): Promise<{ success: boolean; remote: number; updated: number; added: number; pageId: string; data: UtilityTemplate[] }> {
    return this.mmJson('/utility-templates/refresh', 'POST');
  }

  updateUtilityVariables(id: string, variables: UtilityVariable[]): Promise<{ success: boolean; data: UtilityTemplate }> {
    return this.mmJson(`/utility-templates/${encodeURIComponent(id)}/variables`, 'PATCH', { variables });
  }

  deleteUtilityTemplate(id: string): Promise<{ success: boolean; deleted: number }> {
    return this.mmJson(`/utility-templates/${encodeURIComponent(id)}`, 'DELETE');
  }

  getQuickMessages(channel?: MetaChannel): Promise<{ success: boolean; data: QuickMessage[] }> {
    return this.mmJson(`/quick-messages${channel ? `?channel=${channel}` : ''}`, 'GET');
  }

  createQuickMessage(body: QuickMessageInput): Promise<{ success: boolean; data: QuickMessage }> {
    return this.mmJson('/quick-messages', 'POST', body);
  }

  updateQuickMessage(id: string, body: QuickMessageInput): Promise<{ success: boolean; data: QuickMessage }> {
    return this.mmJson(`/quick-messages/${encodeURIComponent(id)}`, 'PUT', body);
  }

  duplicateQuickMessage(id: string): Promise<{ success: boolean; data: QuickMessage }> {
    return this.mmJson(`/quick-messages/${encodeURIComponent(id)}/duplicate`, 'POST');
  }

  deleteQuickMessage(id: string): Promise<{ success: boolean }> {
    return this.mmJson(`/quick-messages/${encodeURIComponent(id)}`, 'DELETE');
  }

  // ---------- Template Library ----------
  /** The CRM's starter quick messages (not Meta templates). */
  getQuickStarters(channel?: MetaChannel): Promise<{ success: boolean; categories: { key: string; label: string }[]; data: QuickStarter[] }> {
    return this.mmJson(`/starters${channel ? `?channel=${channel}` : ''}`, 'GET');
  }

  /** Save a starter as one of the business's quick messages on that channel. */
  useQuickStarter(key: string, channel: MetaChannel, name?: string): Promise<{ success: boolean; starterKey: string; data: QuickMessage }> {
    return this.mmJson('/starters/use', 'POST', { key, channel, ...(name ? { name } : {}) });
  }

  /**
   * Meta's WhatsApp template library. Errors: 409 WA_NOT_CONNECTED (nothing to
   * read it with), WA_TOKEN_INVALID; 400 INVALID_INPUT.
   */
  getWhatsAppLibrary(f: { q?: string; language?: string; topic?: string; usecase?: string; industry?: string } = {}): Promise<WaLibraryResponse> {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
    const qs = p.toString();
    return this.request(`/api/crm/templates/library${qs ? `?${qs}` : ''}`, { headers: this.authHeaders() });
  }

  /** Create a template in the business's WABA from a library template. */
  useWhatsAppLibraryTemplate(body: WaLibraryUseInput): Promise<{ success: boolean; data: WaLibraryUseResult }> {
    return this.request('/api/crm/templates/library/use', {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
  }

  /** Composer: send a quick message in a Messenger / Instagram chat (inside the 24-hour window). */
  sendQuickMessage(phone: string, quickMessageId: string): Promise<{ success: boolean; messageId: string }> {
    return this.mmJson('/send-quick', 'POST', { phone, quickMessageId });
  }

  /** Composer: send an approved utility template in a Messenger chat (allowed outside the window). */
  sendUtilityTemplate(phone: string, templateId: string, params: { body: string[]; buttons: string[] }): Promise<{ success: boolean; messageId: string }> {
    return this.mmJson('/send-utility', 'POST', { phone, templateId, params });
  }

  // ---------- Notifications (header bell + drawer) ----------
  /** Newest first; pass the previous page's `nextBefore` for older ones. */
  getNotifications(before?: string | null, limit = 20): Promise<AppNotificationPage> {
    const q = new URLSearchParams({ limit: String(limit) });
    if (before) q.set('before', before);
    return this.request(`/api/notifications?${q.toString()}`, { headers: this.authHeaders() });
  }

  getUnreadNotificationCount(): Promise<{ success: boolean; count: number }> {
    return this.request('/api/notifications/unread-count', { headers: this.authHeaders() });
  }

  markNotificationRead(id: string): Promise<{ success: boolean; unread: number }> {
    return this.request(`/api/notifications/${encodeURIComponent(id)}/read`, {
      method: 'POST',
      headers: this.authHeaders(),
    });
  }

  markAllNotificationsRead(): Promise<{ success: boolean; updated: number; unread: number }> {
    return this.request('/api/notifications/read-all', {
      method: 'POST',
      headers: this.authHeaders(),
    });
  }

  /** "Clear all": removes every notification (read or not). Chats, orders etc. stay. */
  clearNotifications(): Promise<{ success: boolean; deleted: number; unread: number }> {
    return this.request('/api/notifications', {
      method: 'DELETE',
      headers: this.authHeaders(),
    });
  }

  // ---------- Desktop notifications (Web Push) ----------
  /** The key browsers subscribe with; enabled: false when the server has none set. */
  getPushKey(): Promise<{ success: boolean; enabled: boolean; publicKey: string }> {
    return this.request('/api/push/key', { headers: this.authHeaders() });
  }

  pushSubscribe(subscription: PushSubscriptionJSON, prefs: unknown): Promise<{ success: boolean }> {
    return this.request('/api/push/subscribe', {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ subscription, prefs }),
    });
  }

  pushPrefs(endpoint: string, prefs: unknown): Promise<{ success: boolean; found: boolean }> {
    return this.request('/api/push/prefs', {
      method: 'PUT',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ endpoint, prefs }),
    });
  }

  pushUnsubscribe(endpoint: string): Promise<{ success: boolean }> {
    return this.request('/api/push/unsubscribe', {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ endpoint }),
    });
  }

  /** Sign-out: stop this browser's pushes. Sent with keepalive so it survives the reload that follows. */
  pushUnsubscribeOnLeave(endpoint: string): void {
    try {
      void fetch(`${this.config.apiBase}/api/push/unsubscribe`, {
        method: 'POST',
        keepalive: true,
        headers: this.authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ endpoint }),
      }).catch(() => {});
    } catch {
      /* ignore */
    }
  }

  pushTest(): Promise<{ success: boolean; sent: number }> {
    return this.request('/api/push/test', { method: 'POST', headers: this.authHeaders() });
  }

  /** Push a published Flow into the chat as an interactive form message. */
  sendFlow(phone: string, flowId: string): Promise<{ success: boolean }> {
    return this.request('/api/crm/send-flow', {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ phone, flowId }),
    });
  }

  // ---------- Create: Facebook / Instagram publishing + Comment auto-DM ----------
  /** The connected Page / Instagram account, what each may do, Meta's limits. */
  getSocial(): Promise<SocialOverview> {
    return this.request('/api/social', { headers: this.authHeaders() });
  }

  /** A photo (re-encoded to JPEG) or video for a post; onProgress 0–100 while the browser sends it. */
  uploadSocialMedia(file: File, onProgress?: (percent: number) => void): Promise<{ success: boolean; media: SocialMedia }> {
    const fd = new FormData();
    fd.append('file', file);
    return this.upload('/api/social/upload', fd, onProgress);
  }

  getSocialPosts(): Promise<{ success: boolean; data: SocialPost[] }> {
    return this.request('/api/social/posts', { headers: this.authHeaders() });
  }

  createSocialPost(body: SocialPostInput): Promise<{ success: boolean; post: SocialPost }> {
    return this.request('/api/social/posts', {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
  }

  retrySocialPost(id: string): Promise<{ success: boolean; post: SocialPost }> {
    return this.request(`/api/social/posts/${encodeURIComponent(id)}/retry`, { method: 'POST', headers: this.authHeaders() });
  }

  /** Cancel a scheduled post, or remove a finished one from the list (it stays on Facebook / Instagram). */
  deleteSocialPost(id: string): Promise<{ success: boolean; cancelled: boolean }> {
    return this.request(`/api/social/posts/${encodeURIComponent(id)}`, { method: 'DELETE', headers: this.authHeaders() });
  }

  getSocialRecent(target: SocialTarget): Promise<{ success: boolean; data: SocialRecentPost[] }> {
    return this.request(`/api/social/recent?target=${encodeURIComponent(target)}`, { headers: this.authHeaders() });
  }

  getCommentRules(): Promise<{ success: boolean; data: CommentRule[]; activity: CommentActivity[] }> {
    return this.request('/api/social/comment-rules', { headers: this.authHeaders() });
  }

  createCommentRule(body: CommentRuleInput): Promise<CommentRuleWrite> {
    return this.request('/api/social/comment-rules', {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
  }

  /** Fields not sent keep their value: { active } alone turns a rule on / off. */
  updateCommentRule(id: string, body: CommentRuleInput): Promise<CommentRuleWrite> {
    return this.request(`/api/social/comment-rules/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
  }

  deleteCommentRule(id: string): Promise<{ success: boolean }> {
    return this.request(`/api/social/comment-rules/${encodeURIComponent(id)}`, { method: 'DELETE', headers: this.authHeaders() });
  }

  // ---------- Media (builder uploads → Bunny) ----------
  /** Upload a file and get back a public CDN URL to embed in a journey/flow. */
  async uploadMedia(file: File, folder = 'crm/builder'): Promise<string> {
    const fd = new FormData();
    fd.append('file', file);
    const res = await this.request<{ success: boolean; url: string }>(
      `/api/media/upload?folder=${encodeURIComponent(folder)}`,
      { method: 'POST', headers: this.authHeaders(), body: fd },
    );
    return res.url;
  }

  // ---------- Templates ----------
  /** `includeShared`: also the shared test number's sample templates (chat panel, not connected yet). */
  getTemplates(opts?: { includeShared?: boolean }): Promise<ApiList<TemplateItem>> {
    const q = opts?.includeShared ? '?include=shared' : '';
    return this.request(`/api/crm/templates${q}`, { headers: this.authHeaders() });
  }

  createTemplate(form: FormData): Promise<{ success: boolean }> {
    return this.request('/api/crm/templates', {
      method: 'POST',
      headers: this.authHeaders(),
      body: form,
    });
  }

  deleteTemplate(name: string): Promise<{ success: boolean }> {
    return this.request(`/api/crm/templates/${name}`, {
      method: 'DELETE',
      headers: this.authHeaders(),
    });
  }

  // ---------- Categories ----------
  getCategories(): Promise<ApiList<Category>> {
    return this.request('/api/catalog/categories', { headers: this.authHeaders() });
  }
  createCategory(form: FormData): Promise<{ success: boolean; data: Category }> {
    return this.request('/api/catalog/categories', {
      method: 'POST',
      headers: this.authHeaders(),
      body: form,
    });
  }
  updateCategory(id: string, form: FormData): Promise<{ success: boolean; data: Category }> {
    return this.request(`/api/catalog/categories/${id}`, {
      method: 'PUT',
      headers: this.authHeaders(),
      body: form,
    });
  }
  deleteCategory(id: string): Promise<{ success: boolean }> {
    return this.request(`/api/catalog/categories/${id}`, {
      method: 'DELETE',
      headers: this.authHeaders(),
    });
  }

  // ---------- Members (doctors / agents / staff …) ----------
  getMembers(): Promise<ApiList<Member>> {
    return this.request('/api/members', { headers: this.authHeaders() });
  }
  /** Free slots for a member on one date — the same list a patient would see. */
  getMemberSlots(id: string, date: string): Promise<ApiList<Slot> & { capacity: number }> {
    return this.request(`/api/members/${id}/slots?date=${encodeURIComponent(date)}`, {
      headers: this.authHeaders(),
    });
  }
  createMember(form: FormData): Promise<{ success: boolean; data: Member }> {
    return this.request('/api/members', {
      method: 'POST',
      headers: this.authHeaders(),
      body: form,
    });
  }
  /**
   * Save a member. `notices` reports what happened for any unavailable date
   * added by this save: how many appointments it hit and how many patients
   * were actually messaged.
   */
  updateMember(
    id: string,
    form: FormData,
  ): Promise<{
    success: boolean;
    data: Member;
    notices?: { date: string; affected: number; sent?: number; skipped?: number; reason?: string }[];
  }> {
    return this.request(`/api/members/${id}`, {
      method: 'PUT',
      headers: this.authHeaders(),
      body: form,
    });
  }
  deleteMember(id: string): Promise<{ success: boolean }> {
    return this.request(`/api/members/${id}`, {
      method: 'DELETE',
      headers: this.authHeaders(),
    });
  }

  // ---------- Registrations (flow form submissions) ----------
  getRegistrations(): Promise<ApiList<Registration>> {
    return this.request('/api/registrations', { headers: this.authHeaders() });
  }
  setRegistrationStatus(id: string, status: RegistrationStatus): Promise<{ success: boolean; data: Registration }> {
    return this.request(`/api/registrations/${id}/status`, {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ status }),
    });
  }
  deleteRegistration(id: string): Promise<{ success: boolean }> {
    return this.request(`/api/registrations/${id}`, {
      method: 'DELETE',
      headers: this.authHeaders(),
    });
  }

  /** Remove a stored file (only works for media this business owns). */
  deleteMedia(url: string): Promise<{ success: boolean }> {
    return this.request(`/api/media?url=${encodeURIComponent(url)}`, {
      method: 'DELETE',
      headers: this.authHeaders(),
    });
  }

  // ---------- Products (catalog) ----------
  getProducts(): Promise<ApiList<Product>> {
    return this.request('/api/catalog/products', { headers: this.authHeaders() });
  }
  createProduct(form: FormData): Promise<{ success: boolean; data: Product; sync?: CatalogSync }> {
    return this.request('/api/catalog/products', {
      method: 'POST',
      headers: this.authHeaders(),
      body: form,
    });
  }
  updateProduct(id: string, form: FormData): Promise<{ success: boolean; data: Product; sync?: CatalogSync }> {
    return this.request(`/api/catalog/products/${id}`, {
      method: 'PUT',
      headers: this.authHeaders(),
      body: form,
    });
  }
  deleteProduct(id: string): Promise<{ success: boolean }> {
    return this.request(`/api/catalog/products/${id}`, {
      method: 'DELETE',
      headers: this.authHeaders(),
    });
  }
  setProductPaused(id: string, paused: boolean): Promise<{ success: boolean; data: Product }> {
    return this.request(`/api/catalog/products/${id}/availability`, {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ paused }),
    });
  }
  /** Push the whole catalog to the Meta Commerce catalog. */
  syncCatalog(): Promise<{ success: boolean; pushed: number }> {
    return this.request('/api/catalog/sync', { method: 'POST', headers: this.authHeaders() });
  }

  // ---------- Offers ----------
  getOffers(): Promise<ApiList<Offer>> {
    return this.request('/api/offers', { headers: this.authHeaders() });
  }
  // Every write republishes the affected products to the Meta catalog (an offer
  // only exists for the customer once it's there as a sale price), so each
  // returns how that push went.
  createOffer(body: Partial<Offer>): Promise<OfferWrite> {
    return this.request('/api/offers', {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
  }
  updateOffer(id: string, body: Partial<Offer>): Promise<OfferWrite> {
    return this.request(`/api/offers/${id}`, {
      method: 'PUT',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
  }
  deleteOffer(id: string): Promise<{ success: boolean; sync?: CatalogSyncResult }> {
    return this.request(`/api/offers/${id}`, {
      method: 'DELETE',
      headers: this.authHeaders(),
    });
  }
  setOfferActive(id: string, active: boolean): Promise<OfferWrite> {
    return this.request(`/api/offers/${id}/active`, {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ active }),
    });
  }

  /** Named values a placeholder can map to, order statuses, and trigger events. */
  getTemplateSources(): Promise<{
    success: boolean;
    data: TemplateSource[];
    statuses: string[];
    /** The business's word for each status ("Completed" for a clinic). */
    statusLabels?: Record<string, string>;
    /** What one record is called: "order", "appointment", "enquiry"… */
    recordWord?: string;
    events?: TriggerEvent[];
  }> {
    return this.request('/api/crm/template-sources', { headers: this.authHeaders() });
  }
  /** Keywords / statuses / events that auto-send a template, and its {{n}} mapping. */
  setTemplateAutomation(
    name: string,
    body: {
      enabled: boolean;
      keywords: string[];
      statuses: string[];
      events?: string[];
      variables?: TemplateVariable[];
    },
  ): Promise<{ success: boolean; data: TemplateItem }> {
    return this.request(`/api/crm/templates/${encodeURIComponent(name)}/automation`, {
      method: 'PATCH',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
  }

  // ---------- Orders & bookings ----------
  getOrders(): Promise<ApiList<Order>> {
    return this.request('/api/orders', { headers: this.authHeaders() });
  }
  setOrderStatus(id: string, status: OrderStatus): Promise<{ success: boolean; data: Order }> {
    return this.request(`/api/orders/${id}/status`, {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ status }),
    });
  }
  /**
   * The order's confirmation PDF as a blob object-URL (for inline preview and
   * download). Fetched with the auth header, so the caller must revoke the URL
   * when done. Throws with the server's message when there's no document.
   */
  async getOrderPdfUrl(id: string): Promise<string> {
    const res = await fetch(`${this.config.apiBase}/api/orders/${id}/pdf`, {
      headers: this.authHeaders(),
    });
    if (!res.ok) {
      let msg = `Request failed (${res.status})`;
      try {
        const j = await res.json();
        msg = (j as { message?: string } | null)?.message || msg;
      } catch {
        /* no body */
      }
      throw new Error(msg);
    }
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  }

  // ---------- Flows (native WhatsApp Flow definitions) ----------
  /** Returns the flows plus whether Flows are switched on to drive chats. */
  listFlows(): Promise<ApiList<WaFlowDef> & { flowsActive?: boolean }> {
    return this.request('/api/flows', { headers: this.authHeaders() });
  }
  createFlowDef(body: Partial<WaFlowDef>): Promise<{ success: boolean; data: WaFlowDef }> {
    return this.request('/api/flows', {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
  }
  updateFlowDef(id: string, body: Partial<WaFlowDef>): Promise<{ success: boolean; data: WaFlowDef }> {
    return this.request(`/api/flows/${id}`, {
      method: 'PUT',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
  }
  /**
   * Update only the chat message that opens a flow (header / body / footer /
   * CTA). Kept separate from updateFlowDef because these fields aren't part of
   * the Flow JSON, so changing them must not drop a published flow to draft.
   */
  updateFlowMessage(id: string, body: Partial<WaFlowDef>): Promise<{ success: boolean; data: WaFlowDef }> {
    return this.request(`/api/flows/${id}/message`, {
      method: 'PATCH',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
  }

  deleteFlowDef(id: string): Promise<{ success: boolean }> {
    return this.request(`/api/flows/${id}`, {
      method: 'DELETE',
      headers: this.authHeaders(),
    });
  }
  /**
   * Switch native Flows on/off as the conversation driver for this tenant.
   * On → flows drive inbound chats; off (default) → journeys do. Separate from
   * updateFlowDef so it never drops a published flow back to draft.
   */
  setFlowsActive(active: boolean): Promise<{ success: boolean; flowsActive: boolean }> {
    return this.request('/api/flows/active', {
      method: 'PATCH',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ active }),
    });
  }

  // ---------- Flow templates (shared library, filtered by business type) ----------
  /** Templates usable by this tenant — its own business-type pool. */
  listFlowTemplates(): Promise<ApiList<FlowTemplate>> {
    return this.request('/api/flows/templates', { headers: this.authHeaders() });
  }
  /** Save one of this tenant's flows as a shared template. */
  saveFlowTemplate(body: { flowId: string; name: string; description?: string }): Promise<{ success: boolean; data: FlowTemplate }> {
    return this.request('/api/flows/templates', {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
  }
  /** Start a new flow in this tenant from a template. */
  useFlowTemplate(id: string, name?: string): Promise<{ success: boolean; data: WaFlowDef }> {
    return this.request(`/api/flows/templates/${id}/use`, {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(name ? { name } : {}),
    });
  }
  /** Delete a template this tenant saved. */
  deleteFlowTemplate(id: string): Promise<{ success: boolean }> {
    return this.request(`/api/flows/templates/${id}`, {
      method: 'DELETE',
      headers: this.authHeaders(),
    });
  }
  /** Create (if needed), upload JSON and publish the flow to Meta using the
   *  tenant's WhatsApp credentials. Re-running republishes the updated JSON. */
  publishFlowDef(id: string): Promise<{
    success: boolean;
    data: WaFlowDef;
    /** False when Meta rejected the publish — the flow stays a draft. */
    published?: boolean;
    publishError?: string;
    /** Readable issue lines (Meta's validation messages + endpoint setup notes). */
    warnings?: string[];
    validationErrors?: { message?: string; error_type?: string }[];
  }> {
    return this.request(`/api/flows/${id}/publish`, {
      method: 'POST',
      headers: this.authHeaders(),
    });
  }

  // ---------- Journeys (chatbot node graphs) ----------
  listJourneys(): Promise<ApiList<Journey>> {
    return this.request('/api/journeys', { headers: this.authHeaders() });
  }
  createJourney(body: Partial<Journey>): Promise<{ success: boolean; data: Journey }> {
    return this.request('/api/journeys', {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
  }
  updateJourney(id: string, body: Partial<Journey>): Promise<{ success: boolean; data: Journey }> {
    return this.request(`/api/journeys/${id}`, {
      method: 'PUT',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
  }
  deleteJourney(id: string): Promise<{ success: boolean }> {
    return this.request(`/api/journeys/${id}`, {
      method: 'DELETE',
      headers: this.authHeaders(),
    });
  }

  /** Cloudinary download URL (fl_attachment forces download with the filename). */
  downloadUrl(url: string, filename?: string): string {
    if (url.includes('/upload/')) {
      const base = (filename || '').replace(/\.[^.]+$/, '');
      const flag = base ? `fl_attachment:${encodeURIComponent(base)}` : 'fl_attachment';
      return url.replace('/upload/', `/upload/${flag}/`);
    }
    return url;
  }
}
