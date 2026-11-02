// -----------------------------------------------------------------------------
// Shared CRM domain types (mirror the backend payloads).
// -----------------------------------------------------------------------------

export interface Chat {
  phone: string;
  name: string;
  lastMessageBody: string;
  lastInboundAt: string;
  /** Timestamp of the last activity (inbound or outbound) — drives list order + time. */
  lastMessageAt?: string;
  unread: number;
  windowOpen: boolean;
  windowMsLeft: number;
  /** The plan doesn't let the business reply here (Free: after its first 10 contacts). */
  locked?: boolean;
  botPaused?: boolean;
  /**
   * Where the customer messaged from. For Messenger / Instagram, `phone` is
   * the sender's Page-scoped / Instagram-scoped id, not a phone number.
   */
  channel?: 'whatsapp' | 'instagram' | 'messenger' | 'facebook' | '';
  /** Messenger / Instagram profile photo, when Meta shares it. */
  avatarUrl?: string;
  /** Instagram handle of the sender, when Meta shares it. */
  handle?: string;
}

/** Messenger / Instagram (Channel Status → Connect). */
export type MetaChannel = 'messenger' | 'instagram';

/** One connected Page / Instagram account (GET /api/channels/meta). No tokens. */
export interface MetaChannelConnection {
  channel: MetaChannel;
  pageId: string;
  pageName: string;
  igUserId: string;
  igUsername: string;
  pictureUrl: string;
  /** 'disconnected' = Meta removed the CRM's access (error 190): reconnect. */
  status: 'connected' | 'disconnected';
  statusReason: string;
  connectedAt: string | null;
  disconnectedAt: string | null;
  tokenSource: string;
  /** Instagram only: 'instagram' (Log in with Instagram, no Page) or 'facebook' (the Page's linked account). */
  loginMethod?: 'instagram' | 'facebook' | '';
  /** Log in with Instagram: when the (auto-refreshed) access token expires. */
  tokenExpiresAt?: string | null;
}

export interface MetaChannelsInfo {
  success: boolean;
  /** Facebook Login for Business is configured on the server. */
  configured: boolean;
  /** Business Login for Instagram (Log in with Instagram) is configured on the server. */
  instagramLoginConfigured?: boolean;
  connections: Record<MetaChannel, MetaChannelConnection | null>;
}

/** A Facebook Page the business granted during Login for Business. */
export interface MetaPageOption {
  id: string;
  name: string;
  picture: string;
  instagram: { id: string; username: string; name: string; picture: string } | null;
  canMessage: boolean;
}

export interface OutboundButton {
  text: string;
  kind: string; // reply | flow | list | cta | call | location | pay
  url?: string; // for cta/url buttons; tel number for call buttons
}

export interface OutboundDescriptor {
  type: string;
  body: string;
  headerImageUrl?: string;
  headerText?: string;
  // Document header (e.g. an attached PDF shown above the body).
  headerDocName?: string;
  headerDocUrl?: string;
  headerDocSize?: string; // e.g. "141 kB"
  footer?: string;
  buttons?: OutboundButton[];
  cta?: { text: string; url: string } | null;
  flowCta?: string;
  mediaUrl?: string;
  mediaType?: string;
  filename?: string;
  voice?: boolean;
  /** Set on a sent template; the card renders like any rich message. */
  templateName?: string;
  headerVideoUrl?: string;
}

export interface MediaInfo {
  url: string;
  type: string; // image | video | audio | document
  mime?: string;
  filename?: string;
  caption?: string;
  voice?: boolean; // true for a recorded voice note (PTT), false for an audio file
}

// A single line item in a WhatsApp catalog order (resolved to name/image).
export interface OrderItem {
  name: string;
  variantLabel?: string;
  image?: string;
  qty: number;
  price: number;
  currency: string;
  lineTotal: number;
}

// A WhatsApp catalog cart submission ("order" message).
export interface OrderInfo {
  items: OrderItem[];
  total: number;
  currency: string;
  note?: string;
  catalogId?: string;
}

// A line item inside a WhatsApp Pay order_details payment message.
export interface PaymentItem {
  name: string;
  qty: number;
  image?: string;
}

// WhatsApp Pay "order_details" message (review items + pay securely via UPI).
export interface PaymentInfo {
  orderId: string;
  items: PaymentItem[];
  total: number;
  currency: string;
  body: string; // e.g. "Review your items and pay securely via UPI."
  footer?: string; // e.g. "Powered by WhatsApp Pay"
  status?: 'pending' | 'paid' | 'failed';
}

// A shared WhatsApp location message.
export interface LocationInfo {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
  /** Looked up by the backend for a dropped pin (which has no name/address). */
  resolvedAddress?: string;
  /** Hosted Ola map picture of the spot (fetched once by the backend). */
  mapUrl?: string;
}

// Plan + remaining allowance for the logged-in tenant. A 'free' tenant is on a
// trial: every outbound WhatsApp message spends one credit. 'paid' is unmetered,
// in which case `remaining` is null.
/** The signed-in tenant, as /api/auth/me returns it (secrets never included). */
export interface BusinessProfile {
  _id: string;
  name: string;
  category?: string;
  flowsEnabled?: boolean;
  /** Per-business wording overrides (members / categories / customer term). */
  labels?: Record<string, string | undefined>;
  username?: string;
  phoneNumberId?: string;
  wabaId?: string;
  appId?: string;
  catalogId?: string;
  graphVersion?: string;
  verifyToken?: string;
  active?: boolean;
  plan?: 'free' | 'paid';
  /** The paid plan's name when the admin recorded one ('Basic' | 'Pro' | 'Premium'). */
  planName?: string;
  planChangedAt?: string;
  hasAccessToken?: boolean;
  hasAppSecret?: boolean;
  /** A number + token are stored, so the CRM can send. */
  whatsappConnected?: boolean;
  instagramConnected?: boolean;
  instagramUsername?: string;
  messengerConnected?: boolean;
  messengerPageName?: string;
  /** How WhatsApp was connected ('embedded_signup' | 'manual'). */
  waConnection?: { method?: string; connectedAt?: string };
  /** The owner's login (self-registered businesses). */
  email?: string;
  ownerFirstName?: string;
  ownerLastName?: string;
  ownerPhone?: string;
  phone?: string;
  whatsappNumber?: string;
  authProvider?: string;
  createdAt?: string;
  payment?: PaymentSettings;
  profilePicture?: string;
  avatarUrl?: string;
  about?: string;
  description?: string;
  address?: string;
  website1?: string;
  website2?: string;
  meta?: {
    verifiedName?: string;
    displayPhoneNumber?: string;
    qualityRating?: string;
    wabaName?: string;
    catalogName?: string;
    profilePictureUrl?: string;
    lastVerifiedAt?: string;
    /** The number's Cloud API status as last stored (CONNECTED, PENDING, …); '' = never stored. */
    numberStatus?: string;
    numberStatusAt?: string;
  };
}

/** WhatsApp Pay settings (payment configuration made in WhatsApp Manager). */
export interface PaymentSettings {
  enabled?: boolean;
  configName?: string;
  gatewayType?: string;
  merchantName?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  zoneCode?: string;
  postalCode?: string;
  countryCode?: string;
  countryOfOrigin?: string;
}

/** Leads that came in through Click-to-WhatsApp ads (from message referrals). */
export interface AdSummary {
  id: string;
  sourceType: string; // 'ad' | 'post'
  headline: string;
  body: string;
  url: string;
  image: string;
  mediaType: string;
  leads: number;
  messages: number;
  lastAt: string;
}
export interface AdLead {
  phone: string;
  name: string;
  firstMessage: string;
  at: string;
  adId: string;
  adHeadline: string;
  sourceType: string;
  /** Replies are free until 72 hours after the ad message. */
  freeWindowEndsAt: string;
}
export interface AdLeadsReport {
  success: boolean;
  days: number;
  summary: { leads: number; ads: number; inFreeWindow: number };
  ads: AdSummary[];
  leads: AdLead[];
  /** Ad id → its ad / ad set / campaign in the connected ad account (empty when none is connected). */
  links?: Record<string, MetaAdLink>;
}

// ---------- Meta ad account (Ads page, /api/ads/meta) ----------
export interface MetaAdLink {
  adId: string;
  adName: string;
  campaignId: string;
  campaignName: string;
  adsetId: string;
  adsetName: string;
}

/** The connected ad account. Never carries a token. */
export interface MetaAdsConnection {
  /** 'disconnected' = Meta removed the CRM's access (error 190): reconnect. */
  status: 'connected' | 'disconnected';
  statusReason: string;
  adAccountId: string;
  adAccountName: string;
  currency: string;
  timezone: string;
  accountStatus: number;
  accountStatusLabel: string;
  /** The Page whose lead forms are shown ('' = none picked). */
  pageId: string;
  pageName: string;
  leadgenSubscribed: boolean;
  leadgenError: string;
  /** ads_management granted for this account: pause / resume allowed. */
  canManage: boolean;
  scopes: string[];
  tokenSource: string;
  connectedAt: string | null;
  disconnectedAt: string | null;
}

export interface MetaAdsStatus {
  success: boolean;
  configured: boolean;
  connection: MetaAdsConnection | null;
}

export interface MetaAdAccountOption {
  id: string;
  accountId: string;
  name: string;
  status: number;
  statusLabel: string;
  currency: string;
  timezone: string;
  businessName: string;
}

export interface MetaAdsLogin {
  success: boolean;
  sessionId: string;
  tokenSource: string;
  accounts: MetaAdAccountOption[];
  pages: { id: string; name: string; picture: string }[];
  scopes: string[];
  canManage: boolean;
  leadsAllowed: boolean;
}

/** A Meta product catalog offered after Catalog → Get started. */
export interface MetaCatalogOption {
  id: string;
  name: string;
  /** null when Meta didn't say. */
  productCount: number | null;
  vertical: string;
  businessName: string;
  /** Connected to the business's WhatsApp Business Account right now. */
  onWhatsApp: boolean;
}

export interface MetaCatalogLogin {
  success: boolean;
  sessionId: string;
  tokenSource: string;
  /** The catalog the CRM uses now ('' = none). */
  currentId: string;
  catalogs: MetaCatalogOption[];
  scopes: string[];
  canManage: boolean;
  /** WhatsApp Manager → Catalogue for this WhatsApp Business Account ('' when unknown). */
  whatsappManagerUrl?: string;
}

export type AdsRangePreset = 'today' | 'last_7d' | 'last_30d' | 'last_90d' | 'custom';
export interface AdsRange {
  preset: AdsRangePreset;
  since?: string;
  until?: string;
}

export interface AdMetrics {
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  ctr: number;
  cpc: number;
  cpm: number;
  frequency: number;
  messagingConversations: number;
  leads: number;
  linkClicks: number;
  results: number;
  resultType: string;
  costPerResult: number | null;
  actions: { type: string; label: string; value: number }[];
}

export interface AdsAccountInfo {
  id: string;
  name: string;
  currency: string;
  timezone: string;
}

export interface AdsSummaryReport {
  success: boolean;
  account: AdsAccountInfo;
  range: { preset: string; label: string; since?: string; until?: string };
  empty: boolean;
  metrics: AdMetrics;
}

export interface AdsDayPoint {
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  reach: number;
  results: number;
  messagingConversations: number;
  leads: number;
}

export interface AdsTimeSeries {
  success: boolean;
  account: AdsAccountInfo;
  range: { preset: string; label: string };
  days: AdsDayPoint[];
}

export interface AdObjectBase {
  id: string;
  name: string;
  status: string;
  effectiveStatus: string;
  metrics: AdMetrics;
}

export interface AdCampaignRow extends AdObjectBase {
  objective: string;
  dailyBudget: number | null;
  lifetimeBudget: number | null;
  startTime: string | null;
  stopTime: string | null;
}

export interface AdSetRow extends AdObjectBase {
  dailyBudget: number | null;
  lifetimeBudget: number | null;
  optimizationGoal: string;
  billingEvent: string;
  destinationType: string;
}

export interface AdRow extends AdObjectBase {
  creative: { id: string; title: string; body: string; thumbnailUrl: string };
}

export interface AdCampaignsReport {
  success: boolean;
  account: AdsAccountInfo;
  canManage: boolean;
  range: { preset: string; label: string };
  campaigns: AdCampaignRow[];
}

export interface AdSetsReport {
  success: boolean;
  campaign: { id: string; name: string };
  adsets: AdSetRow[];
}

export interface AdsReport {
  success: boolean;
  adset: { id: string; name: string };
  ads: AdRow[];
}

export interface LeadFormItem {
  id: string;
  name: string;
  status: string;
  leadsCount: number;
  createdTime: string | null;
}

export interface LeadFormsReport {
  success: boolean;
  page: { id: string; name: string; leadgenSubscribed: boolean; leadgenError: string } | null;
  forms: LeadFormItem[];
}

export interface LeadItem {
  id: string;
  createdTime: string | null;
  adId: string;
  adName: string;
  adsetName: string;
  campaignId: string;
  campaignName: string;
  formId: string;
  isOrganic: boolean;
  platform: string;
  name: string;
  email: string;
  /** Digits only; '' when the lead left no usable phone number. */
  phone: string;
  fields: { name: string; values: string[] }[];
}

export interface LeadsReport {
  success: boolean;
  form: LeadFormItem;
  leads: LeadItem[];
}

// ---------- Ads Manager (/api/ads/meta/create*, /meta/drafts, publish) ----------
// S1: the "Create campaign" wizard. The browser sends AdsCampaignSpec; the
// server validates every field and builds Meta's payloads itself.
export type AdsObjectiveKey = 'whatsapp' | 'traffic' | 'leads' | 'awareness' | 'sales';
/** Placements Meta can preview (the server maps each to a generatepreviews ad_format). */
export type AdsPreviewFormat =
  | 'facebook_feed' | 'facebook_desktop_feed' | 'facebook_profile_feed' | 'facebook_story' | 'facebook_reels' | 'facebook_marketplace'
  | 'facebook_video_feeds' | 'facebook_instream' | 'facebook_right_column'
  | 'instagram_feed' | 'instagram_profile_feed' | 'instagram_story' | 'reels' | 'instagram_explore' | 'instagram_explore_home' | 'instagram_search'
  | 'messenger_inbox' | 'messenger_story' | 'whatsapp_status'
  | 'an_native' | 'an_interstitial' | 'an_rewarded_video';

export interface AdsGeoItem {
  key: string;
  kind: 'country' | 'region' | 'city';
  name: string;
  label?: string;
  countryCode: string;
  /** Cities only, km (17–80). */
  radius?: number | null;
  supportsRadius?: boolean;
}

export interface AdsDetailedItem {
  id: string;
  /** flexible_spec key: interests, behaviors, life_events, … */
  kind: string;
  name: string;
  path?: string[];
  sizeLower?: number | null;
  sizeUpper?: number | null;
}

export interface AdsLocaleItem {
  key: number;
  name: string;
}

export interface AdsAudienceSpec {
  locations: AdsGeoItem[];
  excludedLocations: AdsGeoItem[];
  ageMin: number;
  ageMax: number;
  genders: 'all' | 'male' | 'female';
  detailed: AdsDetailedItem[];
  locales: AdsLocaleItem[];
  advantageAudience: boolean;
  /** Ads Manager S4: custom / lookalike audiences to include and exclude (optional: older drafts and editors have none). */
  customAudiences?: AdsAudienceRef[];
  excludedCustomAudiences?: AdsAudienceRef[];
}

export interface AdsPlacementSpec {
  mode: 'automatic' | 'manual';
  platforms: string[];
  positions: Record<string, string[]>;
  devices: string[];
  os: 'all' | 'ios' | 'android';
}

export interface AdsCreativeCard {
  imageHash: string;
  /** Display only (the server never uses it). */
  imageUrl?: string;
  headline: string;
  description: string;
  link: string;
}

/** A Facebook Page post or Instagram post that can be used as the ad (GET /meta/create/pages/:id/posts). */
export interface AdsExistingPost {
  id: string;
  source: 'facebook' | 'instagram';
  text: string;
  picture: string;
  permalink: string;
  createdAt: string | null;
  mediaType: string;
  productType?: string;
  /** Meta's own flag: true / false, or null when Meta didn't say. */
  eligible: boolean | null;
  reason: string;
  /** Instagram reel blocked for its copyrighted music (only Ads Manager can swap it). */
  audioBlocked?: boolean;
  instagramEligible?: boolean | null;
}

export interface AdsCreativeSpec {
  /** 'post' = use an existing Facebook / Instagram post (its own text and media). */
  format: 'image' | 'video' | 'carousel' | 'post';
  /** format 'post': the chosen post (the server only reads source and id). */
  post?: AdsExistingPost | null;
  imageHash: string;
  imageUrl?: string;
  videoId: string;
  videoThumbUrl?: string;
  cards: AdsCreativeCard[];
  primaryText: string;
  headline: string;
  description: string;
  link: string;
  displayLink: string;
  cta: string;
  whatsapp: { greeting: string; prefill: string; iceBreakers: string[] };
  leadFormId: string;
}

export interface AdsCampaignSpec {
  objective: AdsObjectiveKey;
  name: string;
  specialAdCategories: string[];
  optimizationGoal: string;
  pixelId: string;
  conversionEvent: string;
  /** Ads Manager S5: optimise for a custom conversion of the pixel instead of the standard event. */
  customConversionId?: string;
  budget: {
    level: 'campaign' | 'adset';
    type: 'daily' | 'lifetime';
    amount: number | '';
    bidStrategy: 'LOWEST_COST_WITHOUT_CAP' | 'COST_CAP' | 'LOWEST_COST_WITH_BID_CAP';
    bidAmount: number | '';
  };
  /** 'YYYY-MM-DDTHH:mm' in the ad account's time zone ('' start = when published). */
  schedule: { start: string; end: string };
  audience: AdsAudienceSpec;
  placements: AdsPlacementSpec;
  identity: { pageId: string; instagramId: string };
  creative: AdsCreativeSpec;
}

export interface AdsCreatePage {
  id: string;
  name: string;
  picture: string;
  /** The Page connected for lead forms (its Page token is stored). */
  leadForms: boolean;
}

export interface AdsCreateOptions {
  success: boolean;
  account: {
    id: string;
    name: string;
    currency: string;
    timezone: string;
    accountStatus: number;
    minDailyBudget: number;
    minDailyBudgetMinor: number;
    minDailyBudgetSource: 'meta' | 'fallback';
    /** null = Meta didn't say. */
    hasPaymentMethod: boolean | null;
  };
  canManage: boolean;
  graphVersion: string;
  pages: AdsCreatePage[];
  leadFormsPage: { id: string; name: string; hasToken: boolean } | null;
  pixels: { id: string; name: string; lastFiredTime: string | null; unavailable: boolean }[];
}

export interface AdsPageDetails {
  success: boolean;
  page: AdsCreatePage;
  whatsapp: { checked: boolean; linked: boolean | null; number: string; business: boolean };
  instagram: { id: string; username: string; picture: string; source: string }[];
  /** Why the list is empty: the ads login has no Instagram permission, or no account is linked. */
  instagramIssue?: '' | 'NO_PERMISSION' | 'NOT_LINKED';
}

export interface AdsEstimate {
  success: boolean;
  ready: boolean;
  lower: number | null;
  upper: number | null;
  dau: number | null;
  dailyReach: number | null;
}

export interface AdsObjectState {
  id: string;
  name: string;
  status: string;
  effectiveStatus: string;
}

export interface AdsCreateResult {
  success: boolean;
  campaign: AdsObjectState;
  adset: AdsObjectState;
  ad: AdsObjectState;
  creativeId: string;
  summary: {
    objective: AdsObjectiveKey;
    currency: string;
    budget: { level: string; type: 'daily' | 'lifetime'; amount: number };
    start: string | null;
    end: string | null;
    timezone: string;
  };
  /** The same requestId was sent again: this is the first create's answer. */
  replayed?: boolean;
}

/** A video on its way to Meta (POST /meta/create/videos answers with this; poll it). */
export interface AdsVideoUpload {
  id: string;
  status: 'uploading' | 'done' | 'failed';
  /** Meta's video id once status is 'done'. */
  videoId: string;
  error: { code: string; message: string } | null;
  bytes: number;
  name: string;
  startedAt: string | null;
  finishedAt: string | null;
  /** 0–100: how much of the file the CRM server has sent to Meta. */
  sentPercent?: number;
}

/** 400 CONFIRM_REQUIRED on an edit that can raise spend: the old → new values to confirm. */
export interface AdsIncreaseSummary {
  text: string;
  changes: { field: string; label: string; from: string; to: string }[];
}

export interface AdsReviewState {
  success: boolean;
  campaign: AdsObjectState;
  adsets: AdsObjectState[];
  ads: (AdsObjectState & { reviewFeedback: string[] })[];
}

export interface AdDraftItem {
  id: string;
  name: string;
  objective: AdsObjectiveKey | '';
  step: number;
  updatedAt: string | null;
  spec?: Partial<AdsCampaignSpec>;
}

// S2: managing existing campaigns, ad sets and ads (/api/ads/meta/manage/*).
export type AdsLevel = 'campaign' | 'adset' | 'ad';

export interface AdsIssue {
  code: string;
  summary: string;
  message: string;
  level: string;
  type: string;
}

/** Review state of one table row (GET /meta/manage/review). */
export interface AdsReviewInfo {
  id: string;
  effectiveStatus: string;
  issues: AdsIssue[];
  /** Rejection reasons (ads only). */
  reviewFeedback: string[];
  /** Ads under this campaign / ad set that are rejected or have issues. */
  adProblems: number;
  rejectedAds: number;
  needsAttention: boolean;
}

export interface AdsProblemAd {
  id: string;
  name: string;
  campaignId: string;
  adsetId: string;
  effectiveStatus: string;
  issues: AdsIssue[];
  reviewFeedback: string[];
}

export interface AdsReviewReport {
  success: boolean;
  level: AdsLevel;
  parentId: string;
  items: AdsReviewInfo[];
  problemAds: AdsProblemAd[];
  notified: number;
}

export interface AdsManageBase {
  level: AdsLevel;
  id: string;
  name: string;
  status: string;
  effectiveStatus: string;
  archived: boolean;
  /** 'ADVANTAGE_PLUS': Meta doesn't let other apps change it (v25). */
  locked: '' | 'ADVANTAGE_PLUS';
  issues: AdsIssue[];
  account: { currency: string; timezone: string; minDailyBudget: number; minSpendCap: number };
}

export interface AdsManageCampaign extends AdsManageBase {
  level: 'campaign';
  objective: string;
  objectiveKey: AdsObjectiveKey | '';
  specialAdCategories: string[];
  budget: { level: 'campaign' | 'adset'; type: 'daily' | 'lifetime' | null; amount: number | null };
  bidStrategy: string;
  bidAmount: number | null;
  spendCap: number | null;
  canUseSpendCap: boolean;
  /** 'YYYY-MM-DDTHH:mm' in the account time zone ('' = no end). */
  endTime: string;
  adsets: { id: string; name: string; status: string; endTime: string; lifetime: boolean }[];
}

export interface AdsManageAdSet extends AdsManageBase {
  level: 'adset';
  campaign: { id: string; name: string; objective: string; objectiveKey: AdsObjectiveKey | ''; cbo: boolean; bidStrategy: string; specialAdCategories: string[]; restricted: boolean };
  budget: { own: boolean; type: 'daily' | 'lifetime'; amount: number | null };
  bidStrategy: string;
  bidAmount: number | null;
  optimizationGoal: string;
  goals: string[];
  destinationType: string;
  schedule: { start: string; end: string; started: boolean };
  audience: AdsAudienceSpec;
  placements: AdsPlacementSpec;
  targetingNotes: string[];
}

export interface AdsManageAd extends AdsManageBase {
  level: 'ad';
  adsetId: string;
  campaignId: string;
  objectiveKey: AdsObjectiveKey | '';
  specialAdCategories: string[];
  identity: { pageId: string; instagramId: string };
  creative: AdsCreativeSpec;
  creativeId: string;
  thumbnailUrl: string;
  creativeEditable: boolean;
  creativeNote: string;
  reviewFeedback: string[];
}

export type AdsManageDetails = AdsManageCampaign | AdsManageAdSet | AdsManageAd;

export interface AdsManageDetailsResponse<T extends AdsManageDetails = AdsManageDetails> {
  success: boolean;
  canManage: boolean;
  /** null when the save worked but reading it back failed (`stale`). */
  details: T | null;
  /** What was written at Meta, per object. */
  updated?: { level: AdsLevel; id: string; name?: string; fields: string[] }[];
  /** What wasn't (a later write failed after earlier ones were saved). */
  failed?: { level: AdsLevel; id: string; name?: string; fields: string[]; code: string; message: string }[];
  partial?: boolean;
  /** Saved, but the fresh values couldn't be read back. */
  stale?: boolean;
  creativeId?: string;
}

export interface AdsCopyWarning {
  code: 'COPY_NOT_PAUSED';
  message: string;
}

export interface AdsCopyResult {
  level: AdsLevel;
  sourceId: string;
  id: string;
  name: string;
  status: string;
  effectiveStatus: string;
  deepCopy: boolean;
  forcedPause: boolean;
  statusVerified?: boolean;
  /** The copy couldn't be confirmed paused, paused or deleted: the user must act at Meta. */
  warning?: AdsCopyWarning | null;
}

export type AdsBulkAction = 'pause' | 'resume' | 'duplicate' | 'archive';

export interface AdsBulkResultRow {
  id: string;
  ok: boolean;
  code?: string;
  message?: string;
  status?: string;
  copyId?: string;
  unchanged?: boolean;
  warning?: AdsCopyWarning;
}

export interface AdsBulkResult {
  success: boolean;
  action: AdsBulkAction;
  level: AdsLevel;
  results: AdsBulkResultRow[];
  done: number;
  failed: number;
  /** 'RATE_LIMITED' when Meta stopped the run part-way. */
  stopped: string;
}

/** A bulk action running on the server (POST /meta/manage/bulk → 202; poll GET /meta/manage/bulk/:id). */
export interface AdsBulkJob {
  id: string;
  action: AdsBulkAction;
  level: AdsLevel;
  status: 'running' | 'done' | 'failed';
  total: number;
  processed: number;
  results: AdsBulkResultRow[];
  done: number;
  failed: number;
  stopped: string;
  error: { code: string; message: string } | null;
  startedAt: string | null;
  finishedAt: string | null;
}

// S3: reports like Ads Manager (/api/ads/meta/reports/*).
export type AdsReportLevel = 'account' | 'campaign' | 'adset' | 'ad';
export type AdsReportBreakdown =
  | 'none' | 'age' | 'gender' | 'age_gender' | 'country' | 'region' | 'placement' | 'device' | 'hourly' | 'day' | 'week' | 'month';
export type AdsColumnFormat = 'money' | 'int' | 'pct' | 'dec' | 'secs';
export type AdsColumnPreset = 'performance' | 'delivery' | 'engagement' | 'video' | 'messaging' | 'leads' | 'cost_per_result';

export interface AdsReportColumn {
  id: string;
  label: string;
  group: string;
  format: AdsColumnFormat;
  /** Which way a change is good (comparison colours). */
  better: 'up' | 'down' | 'neutral';
}

export interface AdsDelta {
  abs: number | null;
  /** null when it can't be said (e.g. from 0). */
  pct: number | null;
}

export type AdsValues = Record<string, number | null>;

export interface AdsReportRow {
  key: string;
  label: string;
  object: { id: string; name: string } | null;
  dims: { key: string; value: string; label: string }[];
  date: { start: string; stop: string; label: string } | null;
  values: AdsValues;
  previous?: AdsValues;
  previousDate?: { start: string; stop: string; label: string } | null;
  delta?: Record<string, AdsDelta>;
}

export interface AdsReport {
  level: AdsReportLevel;
  parentId: string;
  breakdown: AdsReportBreakdown;
  breakdownLabel: string;
  kind: 'none' | 'dim' | 'time';
  headers: { key: string; label: string }[];
  columns: AdsReportColumn[];
  /** Columns Meta can't return with this breakdown. */
  dropped: { id: string; label: string; reason: string }[];
  notes: string[];
  currency: string;
  timezone: string;
  range: { preset: string; label: string; since: string; until: string };
  compare: { since: string; until: string; label: string } | null;
  rows: AdsReportRow[];
  totals: { values: AdsValues; previous?: AdsValues; delta?: Record<string, AdsDelta> };
  deliveredImpressions: number;
  rowCount: number;
  truncated: boolean;
  source: 'sync' | 'async';
  generatedAt: string;
}

export interface AdsReportRun {
  id: string;
  status: 'running' | 'done' | 'failed' | 'timeout';
  percent: number;
  /** Why it runs at Meta asynchronously: large | requested | too_much_data | device_async_only. */
  reason: string;
  startedAt: string;
  estimatedRows: number;
  jobs: number;
}

export interface AdsReportResponse {
  success: boolean;
  mode: 'sync' | 'async';
  cached?: boolean;
  report?: AdsReport;
  run?: AdsReportRun;
}

export interface AdsReportQuery {
  level: AdsReportLevel;
  breakdown: AdsReportBreakdown;
  columns: string[];
  parentId?: string;
  compare?: boolean;
  mode?: 'auto' | 'sync' | 'async';
}

/** Activity history (GET /meta/reports/activity): the ad account's edits, for the chart markers. */
export type AdsActivityCategory = 'budget' | 'status' | 'targeting' | 'schedule' | 'creative' | 'created' | 'billing' | 'other';
export interface AdsActivityEvent {
  time: string;
  /** YYYY-MM-DD in the ad account's time zone. */
  date: string;
  type: string;
  category: AdsActivityCategory;
  label: string;
  objectName: string;
  objectType: string;
}
export interface AdsActivityResponse {
  success: boolean;
  range: { preset: string; since: string; until: string };
  category: AdsActivityCategory | 'all';
  events: AdsActivityEvent[];
}

export interface AdsAccountHealth {
  account: AdsAccountInfo;
  accountStatus: number;
  accountStatusLabel: string;
  disableReason: number;
  disableReasonLabel: string;
  amountSpent: number;
  spendCap: number | null;
  spendCapUsedPct: number | null;
  spendCapRemaining: number | null;
  balance: number | null;
  dailySpendLimit: number | null;
  paymentMethod: { known: boolean; hasPaymentMethod: boolean | null; display: string; type: string };
  billingUrl: string;
  warnings: { code: string; tone: 'red' | 'amber' | 'gray'; text: string }[];
  checkedAt: string;
}

// S4: audiences (/api/ads/meta/audiences*). Phone numbers never reach the
// browser: the server picks the contacts, hashes them and uploads them.
/** A custom / lookalike audience in targeting (include or exclude). */
export interface AdsAudienceRef {
  id: string;
  name: string;
}

export type AdsContactFilter = 'all' | 'contacted' | 'inbound';
export type AdsAudienceType = 'customer_list' | 'custom' | 'lookalike' | 'website' | 'engagement' | 'app' | 'offline' | 'other';

export interface AdsAudienceJob {
  id: string;
  audienceId: string;
  audienceName: string;
  kind: 'create' | 'refresh';
  mode: 'add' | 'replace';
  /** Why a refresh added instead of replacing ('' when it replaced). */
  fallback: string;
  filter: AdsContactFilter;
  days: number;
  status: 'queued' | 'running' | 'waiting' | 'done' | 'failed' | 'interrupted';
  done: boolean;
  total: number;
  sent: number;
  percent: number;
  batches: number;
  batchesDone: number;
  received: number;
  invalid: number;
  /** Counted when the job reads the contacts (0 while queued). */
  skipped: { otherChannel: number; invalid: number; noCountryCode?: number; duplicate: number };
  /** Capped at ADS_AUDIENCE_MAX_CONTACTS (known once the contacts were read). */
  truncated?: boolean;
  error: { code: string; message: string; metaCode?: number } | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface AdsAudienceItem {
  id: string;
  name: string;
  description: string;
  subtype: string;
  type: AdsAudienceType;
  /** Meta's approximate_count_lower/upper_bound; null when Meta doesn't report it (yet). */
  size: { lower: number; upper: number | null } | null;
  operationStatus: { code: number; description: string } | null;
  deliveryStatus: { code: number; description: string } | null;
  ready: boolean | null;
  /** operation_status 471: Meta won't run ads with it. */
  flagged: boolean;
  lookalike: { ratio: number | null; type: string; countries: string[]; originId: string; originName: string } | null;
  createdAt: string | null;
  updatedAt: string | null;
  /** Made from CRM contacts: the filter and the last upload. */
  crm: { filter: AdsContactFilter; days: number; lastJob: AdsAudienceJob | null } | null;
  canRefresh: boolean;
}

export interface AdsAudiencesList {
  success: boolean;
  canManage: boolean;
  /** accepted null = Meta didn't say. */
  terms: { accepted: boolean | null; url: string };
  audiences: AdsAudienceItem[];
  jobs: AdsAudienceJob[];
  limits: { batchSize: number; maxContacts: number };
}

export interface AdsContactsPreview {
  success: boolean;
  filter: AdsContactFilter;
  days: number;
  count: number;
  scanned: number;
  /** noCountryCode: numbers saved without a valid country calling code (left out; no country is guessed). */
  skipped: { otherChannel: number; invalid: number; noCountryCode?: number; duplicate: number };
  truncated: boolean;
  max: number;
  batches: number;
  batchSize: number;
}

export interface AdsAudienceWrite {
  success: boolean;
  audience: AdsAudienceItem;
  job?: AdsAudienceJob;
  /** null: known once the job has read the contacts (job.truncated). */
  truncated?: boolean | null;
}

/** Saved targeting: Meta's (read only) or the CRM's. */
export interface AdsSavedAudience {
  id: string;
  source: 'meta' | 'crm';
  name: string;
  description: string;
  audience: AdsAudienceSpec;
  sizeLower: number | null;
  sizeUpper: number | null;
  notes: string[];
  updatedAt: string | null;
}

export interface AdsSavedAudiences {
  success: boolean;
  meta: AdsSavedAudience[];
  crm: AdsSavedAudience[];
  metaError: string;
  createAtMeta: boolean;
}

// S5: automation, A/B tests, pixels (/api/ads/meta/automation/*). Rules are
// built on the server from these fields; nothing here can turn an ad on.
export type AdsRuleLevel = 'CAMPAIGN' | 'ADSET' | 'AD';
export type AdsRuleMetric = 'spent' | 'results' | 'cost_per' | 'impressions' | 'reach' | 'clicks' | 'ctr' | 'cpc' | 'cpm' | 'frequency';
export type AdsRuleOperator = 'GREATER_THAN' | 'LESS_THAN' | 'EQUAL';
export type AdsRuleTemplateKey = 'pause_high_cpr' | 'pause_spend_no_results' | 'increase_budget_low_cpr' | 'notify_only';
export interface AdsRuleSpec {
  name: string;
  level: AdsRuleLevel;
  scope: { type: 'all_active' | 'campaigns' | 'adsets'; ids: string[] };
  timePreset: string;
  /** Money values in major units (the server converts to Meta's minor units). */
  conditions: { metric: AdsRuleMetric; operator: AdsRuleOperator; value: number | string | null }[];
  action: { type: 'PAUSE' | 'CHANGE_BUDGET' | 'NOTIFICATION'; percent?: number | string; cap?: number | string | null; everyHours?: number | string; maxTimes?: number | string };
  schedule: { type: 'SEMI_HOURLY' | 'HOURLY' | 'DAILY' | 'CUSTOM'; days?: number[]; startMinute?: number; endMinute?: number };
}
export interface AdsRuleSummary {
  text: string;
  schedule?: string;
  scope?: string;
  conditions?: string[];
  action?: string;
  /** Budget rules: the formatted cap ("₹2,000.00"), which applies per ad set. */
  cap?: string | null;
  capPerAdSet?: boolean;
  /** Budget rules: the cap line for confirms ("… per ad set. 3 ad sets, so at most ₹6,000.00 a day in total."). */
  capText?: string | null;
  /** Ad sets the cap applies to: the picked ones, or those with a daily budget now (null when unknown). */
  adSetCount?: number | null;
  /** adSetCount × cap, formatted. */
  worstCase?: string | null;
  /** PAUSE | CHANGE_BUDGET | NOTIFICATION, or Meta's raw execution_type for rules made outside the CRM (e.g. UNPAUSE). */
  actionType?: string;
  /** A rule made outside the CRM. */
  outside?: boolean;
  changesDelivery: boolean;
}
export interface AdsRule {
  id: string;
  name: string;
  status: 'ENABLED' | 'DISABLED' | 'HAS_ISSUES' | string;
  enabled: boolean;
  hasIssues: boolean;
  disableErrorCode: number | null;
  createdTime: string | null;
  updatedTime: string | null;
  /** False for rules made outside the CRM: on / off and delete only. */
  editable: boolean;
  /** False for outside rules whose action isn't PAUSE or NOTIFICATION: they can only be turned off or deleted here. */
  canEnable: boolean;
  template: AdsRuleTemplateKey | 'custom';
  spec: AdsRuleSpec | null;
  summary: AdsRuleSummary;
  /** Send with { status: 'ENABLED', confirm: true }. */
  summaryHash: string;
}
export interface AdsRulesList {
  success: boolean;
  canManage: boolean;
  account: { currency: string; timezone: string; minDailyBudget: number };
  rules: AdsRule[];
  templates: Record<AdsRuleTemplateKey, { label: string; spec: Omit<AdsRuleSpec, 'name'> }>;
  options: {
    levels: Record<AdsRuleLevel, string>;
    timePresets: Record<string, string>;
    metrics: Record<AdsRuleMetric, { label: string; kind: 'money' | 'int' | 'pct' | 'dec' }>;
    operators: Record<AdsRuleOperator, string>;
    actions: Record<string, string>;
    schedules: Record<string, string>;
  };
  mirror: { checked: number; notified: number; skipped?: string };
}
export interface AdsRulePreview {
  success: boolean;
  template: AdsRuleTemplateKey | 'custom';
  summary: AdsRuleSummary;
  /** The hash of the spec this summary describes; a confirmed write sends it back. */
  summaryHash: string;
}
export interface AdsRuleWrite {
  success: boolean;
  rule: AdsRule;
  summary?: AdsRuleSummary;
  summaryHash?: string;
  unchanged?: boolean;
}
export interface AdsRuleHistoryEntry {
  at: string | null;
  manual: boolean;
  error: string;
  changed: number;
  results: {
    objectId: string;
    objectType: string;
    objectName: string;
    actions: { action: string; label: string; field: string; oldValue: string | number | null; newValue: string | number | null; money: boolean; error: string }[];
  }[];
}
export interface AdsRuleHistory {
  success: boolean;
  rule: { id: string; name: string; status: string };
  currency: string;
  entries: AdsRuleHistoryEntry[];
}
export type AdsTestMetric = 'cost_per_result' | 'results' | 'ctr' | 'cpc';
export interface AdsSplitTest {
  id: string;
  name: string;
  type: string;
  status: 'SCHEDULED' | 'RUNNING' | 'COMPLETED' | 'CANCELED';
  variable: 'creative' | 'audience' | 'placement' | '';
  metric: AdsTestMetric | '';
  confidence: number | null;
  description: string;
  /** 'YYYY-MM-DDTHH:mm' in the ad account's time zone. */
  start: string;
  end: string;
  cells: { id: string; name: string; percent: number }[];
}
export interface AdsTestsList {
  success: boolean;
  canManage: boolean;
  business: { id: string; name: string } | null;
  /** False: Meta A/B tests can't be read or created here (use the CRM comparison). */
  metaAvailable: boolean;
  note: string;
  tests: AdsSplitTest[];
  timezone: string;
  options: { variables: Record<string, string>; metrics: Record<AdsTestMetric, string>; confidence: number[]; minDays: number; maxDays: number };
}
export interface AdsTestDetails {
  success: boolean;
  test: AdsSplitTest;
  cells: { id: string; name: string; percent: number; objects: { level: 'adset' | 'campaign'; id: string; name: string }[] }[];
  results: { available: boolean; winnerId: string; confidence: number | null; byObject: Record<string, number>; objective?: string; winnerCell: { id: string; name: string } | null };
}
export interface AdsTestInput {
  name: string;
  description?: string;
  level: 'adset' | 'campaign';
  ids: string[];
  variable: 'creative' | 'audience' | 'placement';
  metric: AdsTestMetric;
  confidence: number;
  start: string;
  end: string;
  confirm?: boolean;
}
export interface AdsCompareItem {
  id: string;
  name: string;
  status: string;
  values: Record<'spend' | 'impressions' | 'reach' | 'clicks' | 'ctr' | 'cpc' | 'cpm' | 'results' | 'cost_per_result', number | null>;
}
export interface AdsCompareResult {
  success: boolean;
  level: 'campaign' | 'adset';
  metric: AdsTestMetric;
  metricLabel: string;
  better: 'up' | 'down';
  confidence: number;
  currency: string;
  range: { label?: string; since?: string; until?: string } | null;
  items: AdsCompareItem[];
  winner: { id: string; name: string } | null;
  leader?: { id: string; name: string };
  ranking: string[];
  significance: { level: 'significant' | 'not_yet' | 'not_enough_data'; confidence: number | null; z: number | null; pValue: number | null; basis: string; threshold?: number };
  notes: string[];
}
export interface AdsPixel {
  id: string;
  name: string;
  lastFiredTime: string | null;
  createdTime: string | null;
  unavailable: boolean;
  state: 'active' | 'recent' | 'inactive' | 'never' | 'unavailable';
}
export interface AdsCustomConversion {
  id: string;
  name: string;
  eventType: string;
  pixelId: string;
  archived: boolean;
  unavailable: boolean;
}
export interface AdsPixelsList {
  success: boolean;
  pixels: AdsPixel[];
  customConversions: AdsCustomConversion[];
  customConversionsAvailable: boolean;
  events: { key: string; fbq: string }[];
}
export interface AdsPixelDetails {
  success: boolean;
  pixel: AdsPixel;
  stats: { range: '24h' | '7d'; since: string; until: string; total: number; events: { event: string; count: number; lastSeenAt: string | null }[] } | null;
  note: string;
  snippet: string;
  eventSnippets: { key: string; fbq: string; code: string }[];
  customConversions: AdsCustomConversion[];
  eventsManagerUrl: string;
}

/** What a business sets itself under Settings. */
export interface BusinessSettings {
  catalogId: string;
  catalogName: string;
  /** 'meta_login' (Get started) | 'manual' (typed id) | '' */
  catalogMethod?: string;
  payment: PaymentSettings;
  whatsappConnected: boolean;
}

/**
 * The shared "try it" WhatsApp number (GET /api/sandbox). Only `enabled` for a
 * business that hasn't connected its own number yet.
 */
export interface SandboxInfo {
  success: boolean;
  enabled: boolean;
  /** "+1 711-964-9237" */
  displayPhone?: string;
  /** Digits only, as wa.me wants it. */
  waNumber?: string;
  /** This business's join code, e.g. "#K7MQ2X". */
  code?: string;
  /** Different contacts linked to this business on the shared number. */
  contacts?: SandboxContacts;
  links?: { waMe: string; web: string; desktop: string };
}

/** The test-inbox counter on the Chats page (SANDBOX_CONTACT_LIMIT, default 10). */
export interface SandboxContacts {
  linked: number;
  limit: number;
  /** linked >= limit: new senders can't join. */
  full: boolean;
}

/** A messaging-limit tier as numbers (backend services/messagingTier.js). */
export interface MessagingLimit {
  /** Meta's code, e.g. "TIER_2K". */
  tier: string;
  /** 2000; null when unlimited or unknown. */
  limit: number | null;
  /** "2,000", "Unlimited", or the raw code when unrecognised. */
  label: string;
  unlimited: boolean;
}

/**
 * Live state of the business's own WhatsApp number (GET /api/channel/status).
 * `connected:false` for a business without its own number (Meta not asked).
 */
/** Another Meta app holds chats on the business's number (backend services/otherApps.js). */
export interface ThreadControlNotice {
  at: string;
  lastAt?: string;
  phone?: string;
  count?: number;
  via?: 'send' | 'standby';
}

export interface ChannelStatus {
  success: boolean;
  connected: boolean;
  /** Other Meta apps still attached to the WhatsApp account (they can hold chats). */
  otherApps?: { id: string; name: string }[];
  /** Another app was seen holding chats on this number (refused sends, standby messages). */
  threadControl?: ThreadControlNotice | null;
  /** When Meta was last read (ISO); null if it never answered. */
  fetchedAt?: string | null;
  cached?: boolean;
  /** Meta failed; these are the last values it gave. */
  stale?: boolean;
  /** Meta's error message, when the last read failed. */
  error?: string;
  number?: {
    phoneNumberId: string;
    displayPhoneNumber: string;
    verifiedName: string;
    /** CONNECTED | PENDING | FLAGGED | RESTRICTED | … */
    status: string;
    /** GREEN | YELLOW | RED | UNKNOWN */
    qualityRating: string;
    nameStatus: string;
    newNameStatus: string;
    codeVerificationStatus: string;
    accountMode: string;
    platformType: string;
    isOfficialBusinessAccount: boolean;
    throughputLevel: string;
    health: {
      /** AVAILABLE | LIMITED | BLOCKED */
      canSendMessage: string;
      errors: { entity: string; code: number | null; description: string; solution: string }[];
    } | null;
  } | null;
  limit?: MessagingLimit | null;
  waba?: {
    id: string;
    name: string;
    accountReviewStatus: string;
    businessVerificationStatus: string;
  } | null;
  /** Present with `number`: whether it needs "Activate number", and whether a PIN is stored (never the PIN). */
  activation?: { needed: boolean; hasSavedPin: boolean };
}

/** Why an activation (or Embedded Signup's register attempt) failed. */
export interface ActivationFailure {
  /** WRONG_PIN | PIN_REQUIRED | INVALID_PIN | NUMBER_IN_USE | RATE_LIMITED | NEEDS_VERIFICATION | … */
  code: string;
  /** The readable explanation. */
  message: string;
  metaCode?: number | null;
  /** Meta's own text, shown as well. */
  metaMessage?: string;
}

/** POST /api/channel/activate. */
export interface ActivationResult {
  success: boolean;
  /** Meta's status after the bounded poll. */
  status: string;
  connected: boolean;
  alreadyConnected: boolean;
  polls: number;
  webhook: { ok: boolean; reason?: string } | null;
  message: string;
  /** Channel Status right after, so the page doesn't need another call. */
  channel?: ChannelStatus;
}

/** What Embedded Signup reports about the number's activation. */
export interface SignupActivation {
  needed: boolean;
  status: string;
  hasSavedPin: boolean;
  error: ActivationFailure | null;
}

/** One of Meta's business-profile industries (`vertical`), e.g. { value:'RETAIL', label:'Shopping and Retail' }. */
export interface WhatsAppVertical {
  value: string;
  label: string;
}

/** The WhatsApp business profile of the business's own number, as Meta has it. */
export interface WhatsAppProfile {
  about: string;
  address: string;
  description: string;
  /** The profile's contact email (not the login email). */
  email: string;
  /** Always two entries; '' when not set. */
  websites: string[];
  /** Meta's vertical code; '' when not set. Old profiles may say UNDEFINED or NOT_A_BIZ. */
  vertical: string;
  verticalLabel: string;
  /** Meta's photo URL. It expires, so don't store it. */
  profilePictureUrl: string;
  displayPhoneNumber: string;
  verifiedName: string;
}

/** GET /api/settings/whatsapp-profile. `connected:false` = no own number, Meta not asked. */
export interface WhatsAppProfileResponse {
  success: boolean;
  connected: boolean;
  message?: string;
  data?: WhatsAppProfile;
  verticals: WhatsAppVertical[];
}

/** The fields a profile save may send; only changed ones are included. */
export interface WhatsAppProfileUpdate {
  about?: string;
  address?: string;
  description?: string;
  email?: string;
  vertical?: string;
  websites?: string[];
}

export interface PlanSummary {
  plan: 'free' | 'paid';
  /** The paid plan's name ('Basic' | 'Pro' | 'Premium') when recorded; '' otherwise. */
  planName?: string;
  limit: number;
  used: number;
  remaining: number | null;
  exhausted: boolean;
}

// ---------- SaaS plans (backend services/plans.js, frontend crm/plans.ts) ----------
export type PlanTierKey = 'free' | 'basic' | 'pro' | 'premium';
export type PlanFeature =
  | 'chats' | 'templates' | 'campaigns' | 'flows' | 'catalog' | 'categories' | 'members' | 'offers' | 'orders'
  | 'payment-config' | 'ads' | 'create' | 'instagram' | 'messenger';

export interface PlanLimits {
  features: PlanFeature[];
  /** Distinct WhatsApp contacts it can chat with; null = unlimited. */
  contacts: number | null;
  /** Templates in its account; null = unlimited. */
  templates: number | null;
  /** Campaigns launched per calendar month; null = unlimited. */
  campaignsPerMonth: number | null;
  carousel: boolean;
  authTemplates: boolean;
}

/** The plan in force (GET /api/auth/me → planState, /api/billing → plan). */
export interface PlanState {
  tier: PlanTierKey;
  name: string;
  /** active = paid or granted · legacy = from before plans (Premium) · trial = the 7-day trial · free */
  status: 'active' | 'legacy' | 'trial' | 'free';
  /** End of the trial / the paid period; null when it has none. */
  endsAt: string | null;
  daysLeft: number | null;
  /** Within 5 days of the end: the top bar reminds. */
  endingSoon: boolean;
  limits: PlanLimits;
  cycle?: string;
  startsAt?: string | null;
  source?: string;
  /** On Free: what ended (the trial, or a paid plan). */
  ended?: { kind: 'trial' | 'plan'; tier?: PlanTierKey; name?: string; at: string | null } | null;
}

/** What buying a plan costs right now (GET /api/billing/quote). */
export interface PlanQuote {
  tier: PlanTierKey;
  name: string;
  cycle: string;
  months: number;
  kind: 'new' | 'renew' | 'upgrade';
  listPaise: number;
  creditPaise: number;
  amountPaise: number;
  startsAt: string | null;
  endsAt: string | null;
}

/** POST /api/billing/checkout: what Razorpay Checkout opens with. */
export interface PlanCheckout {
  keyId: string;
  orderId: string;
  amount: number;
  currency: string;
  quote: PlanQuote;
  prefill: { name: string; email: string; contact: string };
  description: string;
}

/** A plan payment (Settings → Billing → Payments). */
export interface PlanPayment {
  _id: string;
  orderId: string;
  paymentId: string;
  tier: PlanTierKey;
  name: string;
  cycle: string;
  kind: string;
  listPaise: number;
  creditPaise: number;
  amountPaise: number;
  currency: string;
  status: string;
  method: string;
  paidAt: string | null;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string | null;
}

export interface PlanUsage {
  contacts: { used: number | null; limit: number | null };
  templates: { used: number; limit: number | null };
  campaigns: { used: number; limit: number | null };
}

/** GET /api/billing: what Settings → Billing shows. */
export interface BillingSummary {
  plan: PlanState & {
    /** When the business signed up. */
    customerSince: string | null;
  };
  usage: PlanUsage;
  messaging:
    | { connected: false; sandbox: SandboxContacts | null }
    | {
      connected: true;
      displayPhoneNumber: string;
      status: string;
      qualityRating: string;
      throughputLevel: string;
      limit: MessagingLimit | null;
      fetchedAt: string | null;
      stale: boolean;
      error: string;
    };
  contact: { name: string; email: string; phone: string; address: string };
  /** Plan payments made through Razorpay, newest first. */
  payments: PlanPayment[];
  /** Razorpay is set up on the server (keys present). */
  paymentsEnabled: boolean;
}

// One answer from a submitted WhatsApp Flow, already resolved to the question
// text and the chosen wording (see backend/services/flowSubmission.js).
export interface FormRow {
  key: string;
  label: string;
  value: string;
}
export interface FormSubmission {
  flowName?: string;
  rows: FormRow[];
}

/** Meta's reason a message wasn't delivered (failed receipt or refused send). */
export interface MessageError {
  code: number | string | null;
  title: string;
  message: string;
  details: string;
}

export type CampaignStatus = 'draft' | 'scheduled' | 'sending' | 'completed' | 'failed' | 'cancelled';

/**
 * Delivery counts for one campaign, from the statuses Meta reported
 * (backend services/campaignStats.js). Cumulative: `delivered` includes read.
 */
export interface CampaignStats {
  total: number;
  /** Meta accepted the send. */
  accepted: number;
  delivered: number;
  read: number;
  /** Refused at send time or a failed receipt later. */
  failed: number;
  /** Not sent yet. */
  pending: number;
  /** Accepted, no delivered/read/failed receipt yet. */
  sentOnly: number;
  replied: number;
  /** Never sent because the campaign was cancelled. */
  cancelled: number;
  /** Messenger / Instagram: outside the 24-hour window when their turn came. */
  skipped?: number;
}

/** 'whatsapp' | 'messenger' | 'instagram' — where a campaign is sent. */
export type CampaignChannel = 'whatsapp' | 'messenger' | 'instagram';

/** What a Messenger / Instagram campaign sends (backend services/metaCampaigns.js). */
export interface MetaCampaignContent {
  /** quick | utility | both (Messenger) · quick | text (Instagram) */
  mode: 'quick' | 'utility' | 'both' | 'text';
  quickMessageId?: string;
  quickMessageName?: string;
  utilityTemplateId?: string;
  utilityTemplateName?: string;
  utilityParams?: { body: string[]; buttons: string[] };
  text?: string;
  imageUrl?: string;
  confirmedNonPromotional?: boolean;
}

export interface Campaign {
  _id: string;
  name: string;
  templateName: string;
  language: string;
  type: 'single' | 'drip';
  status: CampaignStatus;
  scheduledAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  total: number;
  /** Why the whole campaign stopped, if it did. */
  error: string;
  ltoCode: string;
  ltoExpiresAt: string | null;
  stats: CampaignStats | null;
  /** Older servers don't send it: read as WhatsApp. */
  channel?: CampaignChannel;
  /** Messenger / Instagram only. */
  content?: MetaCampaignContent | null;
  audienceFilter?: { activeDays: number } | null;
  /** Drip campaigns: the follow-ups sent after the main template. */
  drip?: CampaignDrip | null;
  /** Drip waiting for its next follow-up: when it is due. */
  dripNextAt?: string | null;
}

/** A drip campaign's follow-ups as stored (backend routes/campaigns.js). */
export interface CampaignDrip {
  id?: string;
  name: string;
  stopOnReply: boolean;
  steps: { templateName: string; language: string; delayMs: number }[];
}

/** How each follow-up of a drip is doing (backend campaignStats.dripProgress). */
export interface CampaignDripProgress {
  stopOnReply: boolean;
  nextAt: string | null;
  steps: {
    step: number;
    templateName: string;
    delayMs: number;
    sent: number;
    failed: number;
    delivered: number;
    read: number;
    waiting: number;
    stopped: number;
  }[];
}

/** A drip as the page sends it: the steps as edited (enabled ones are kept). */
export interface CampaignDripInput {
  id?: string;
  name: string;
  stopOnReply: boolean;
  steps: { templateName: string; delay: number; delayUnit: 'Minutes' | 'Hours' | 'Days'; enabled: boolean }[];
}

export interface CampaignRecipientResult {
  /** WhatsApp: the number. Messenger / Instagram: the PSID / IGSID. */
  phone: string;
  name: string;
  status: 'pending' | 'cancelled' | 'sent' | 'delivered' | 'read' | 'failed' | 'skipped';
  error: MessageError | null;
  sentAt: string | null;
  replied: boolean;
  /** Messenger: what went out, the quick message or the utility template. */
  via?: 'quick' | 'utility';
}

export interface CampaignDetail extends Campaign {
  recipients: CampaignRecipientResult[];
  dripProgress?: CampaignDripProgress;
  /** Drafts and scheduled campaigns: the list to resume editing with. */
  audience?: { phone: string; name: string; bodyParams: string[] }[];
}

export interface CampaignInput {
  name: string;
  templateName?: string;
  language?: string;
  type?: 'single' | 'drip';
  recipients: { phone: string; name?: string; bodyParams?: string[] }[];
  ltoCode?: string;
  ltoExpiresAt?: string;
  mode: 'draft' | 'schedule' | 'now';
  scheduledAt?: string;
  /** Drip campaigns: the sequence picked for it. */
  drip?: CampaignDripInput;
  /** One id per Send / Schedule click: sent twice, the server makes one campaign. */
  requestId?: string;
  /** Omitted = WhatsApp. Messenger / Instagram take `content` and `audience` instead of a template. */
  channel?: CampaignChannel;
  content?: MetaCampaignContent;
  audience?: { activeDays: number };
}

/** GET /api/campaigns/audience: a Messenger / Instagram audience, counted now. */
export interface MetaAudienceCounts {
  success: boolean;
  channel: MetaChannel;
  activeDays: number;
  total: number;
  inWindow: number;
  outsideWindow: number;
  capped: boolean;
}

// ---------- Messenger / Instagram quick messages and utility templates ----------
export type QuickMessageKind = 'text' | 'image' | 'cards' | 'quick_replies';

export interface QuickButton {
  type: 'url' | 'postback';
  title: string;
  url: string;
  payload: string;
}

export interface QuickCard {
  imageUrl: string;
  title: string;
  subtitle: string;
  buttons: QuickButton[];
}

export interface QuickMessage {
  _id: string;
  name: string;
  channels: MetaChannel[];
  kind: QuickMessageKind;
  text: string;
  imageUrl: string;
  buttons: QuickButton[];
  cards: QuickCard[];
  quickReplies: { title: string; payload: string }[];
  createdAt?: string | null;
  updatedAt?: string | null;
}

export type QuickMessageInput = Omit<QuickMessage, '_id' | 'createdAt' | 'updatedAt'>;

export interface UtilityButton {
  type: 'URL' | 'PHONE_NUMBER';
  text: string;
  url: string;
  urlExample: string;
  phone: string;
}

export interface UtilityVariable {
  index: number;
  /** contact_name: filled with the chat's name; text: typed per send / campaign. */
  source: 'contact_name' | 'text';
  fallback: string;
}

/** A Messenger utility template (backend models/MetaTemplate.js). */
export interface UtilityTemplate {
  _id: string;
  channel: 'messenger';
  pageId: string;
  /** Lives on the Page connected now (only those can be sent). */
  onCurrentPage: boolean;
  name: string;
  language: string;
  category: string;
  status: string;
  rejectedReason: string;
  bodyText: string;
  bodyExamples: string[];
  buttons: UtilityButton[];
  variables: UtilityVariable[];
  paramCount: number;
  urlParamCount: number;
  libraryTemplateName: string;
  origin: 'create' | 'clone' | 'meta';
  createdAt: string | null;
  updatedAt: string | null;
  statusCheckedAt: string | null;
}

export interface UtilityTemplateInput {
  name: string;
  language: string;
  bodyText: string;
  bodyExamples: string[];
  buttons: UtilityButton[];
  variables: UtilityVariable[];
}

/** One of Meta's utility templates (GET /message_template_library). */
export interface LibraryTemplate {
  id: string;
  name: string;
  language: string;
  category: string;
  topic: string;
  usecase: string;
  industry: string[];
  body: string;
  bodyParams: string[];
  bodyParamTypes: string[];
  buttons: { type: string; text: string; url: string; phone: string }[];
}

// ---------- Template Library (Meta's WhatsApp library + CRM starters) ----------
/** One of Meta's WhatsApp library templates (GET /api/crm/templates/library). */
export interface WaLibraryTemplate {
  id: string;
  name: string;
  language: string;
  /** UTILITY | AUTHENTICATION */
  category: string;
  topic: string;
  usecase: string;
  industry: string[];
  header: string;
  body: string;
  footer: string;
  bodyParams: string[];
  bodyParamTypes: string[];
  /** input: what the business fills in when creating from it ('url' | 'phone' | ''). */
  buttons: { type: string; text: string; url: string; phone: string; input: 'url' | 'phone' | '' }[];
}

export interface LibraryFacet {
  value: string;
  count: number;
}

export interface WaLibraryResponse {
  success: boolean;
  /** connected: the business's own WABA · sandbox: read-only on the shared test number */
  mode: 'connected' | 'sandbox';
  /** Can create templates from it (its own WABA). */
  canUse: boolean;
  language: string;
  total: number;
  data: WaLibraryTemplate[];
  facets: { categories: LibraryFacet[]; topics: LibraryFacet[]; usecases: LibraryFacet[]; industries: LibraryFacet[] };
  filters: { topic: string[]; usecase: string[]; industry: string[] };
  languages: string[];
}

export interface WaLibraryUseInput {
  libraryTemplateName: string;
  name: string;
  language: string;
  /** One per library button, by index. */
  buttonInputs: { url?: string; urlSuffixExample?: string; phone?: string }[];
  /** Authentication templates. */
  bodyInputs?: { addSecurityRecommendation?: boolean; codeExpirationMinutes?: number | null };
}

export interface WaLibraryUseResult {
  name: string;
  language: string;
  category: string;
  status: string;
  metaId: string;
  libraryTemplateName: string;
}

/** A CRM starter quick message (backend services/quickStarters.js). Not a Meta template. */
export interface QuickStarter extends QuickMessageInput {
  key: string;
  category: string;
  categoryLabel: string;
  language: string;
  source: 'crm_starter';
}

/** Preselect what a new Messenger / Instagram campaign sends. */
export interface MetaCampaignInitialContent {
  quickMessageId?: string;
  utilityTemplateId?: string;
}

/** "Start a campaign" from another page (CrmShell → CampaignsPage). `n` changes per request. */
export interface CampaignStartRequest {
  channel: CampaignChannel;
  /** WhatsApp: the template to start with. */
  templateName?: string;
  quickMessageId?: string;
  utilityTemplateId?: string;
  n: number;
}

/** A failed write's field problems ({ field, message }), on the thrown error's data. */
export interface FieldProblem {
  field: string;
  message: string;
}

/** GET /api/campaigns/overview: the three KPI cards. */
export interface CampaignOverviewData {
  success: boolean;
  /** The business has its own number (limit and quality need it). */
  connected: boolean;
  /** The tier from Meta plus its use in the last 24 h; null when unknown. */
  limit: (MessagingLimit & { used24h: number; messages24h: number }) | null;
  usage: { used24h: number; messages24h: number };
  /** GREEN | YELLOW | RED | UNKNOWN, or null when not connected. */
  quality: string | null;
  /** Meta's message when the live read failed. */
  metaError: string;
  stale: boolean;
  fetchedAt: string | null;
  streak: { current: number; days: { date: string; active: boolean }[] };
}

export interface ChatMessage {
  _id: string;
  phone: string;
  direction: 'in' | 'out';
  type: string;
  body: string;
  status: string;
  /** Why it wasn't delivered (status 'failed'). */
  error?: MessageError | null;
  metaMessageId?: string;
  createdAt: string;
  /** The latest reaction (older rows only have this one). */
  reaction?: string;
  /** The customer's reaction and the business's, like WhatsApp keeps one each. */
  reactionIn?: string;
  reactionOut?: string;
  /** Owning tenant. Present on live socket events, used to verify scoping. */
  businessId?: string;
  /** 'messenger' | 'instagram' for those channels; empty = WhatsApp. */
  channel?: string;
  /** Sender's name (inbound), as stored with the message. */
  name?: string;
  raw?: {
    outbound?: OutboundDescriptor;
    media?: MediaInfo;
    order?: OrderInfo;
    payment?: PaymentInfo;
    location?: LocationInfo;
    replyTo?: ReplyPreview;
    form?: FormSubmission;
    /** A sent template, rebuilt as the customer saw it (cards / offer extras). */
    template?: RenderedTemplate;
    // Raw Meta payload, kept for messages logged before `form` existed.
    interactive?: { nfm_reply?: { response_json?: string } };
    /** Meta's reply context on an inbound message (which message it answers). */
    context?: { id?: string; from?: string };
    /** Meta's raw message, when the media was re-hosted (`raw.meta.context`). */
    meta?: { context?: { id?: string; from?: string } };
  };
}

/** A template message as sent: header, filled-in body, buttons, extras. */
export interface RenderedTemplate {
  name: string;
  header?: { format: 'text' | 'image' | 'video' | 'document'; text?: string; url?: string; fileName?: string } | null;
  body: string;
  footer?: string;
  buttons: OutboundButton[];
  cards?: { mediaUrl: string; mediaFormat: 'image' | 'video'; body?: string; buttons: OutboundButton[] }[];
  lto?: { text: string; code?: string; expiresAtMs?: number | null };
  /** CRM-only, on the chat's own pending bubble: the one-time code being sent (for Retry). */
  otpCode?: string;
}

// A quoted message shown above a reply.
export interface ReplyPreview {
  author: string;
  preview: string;
  id?: string; // _id of the quoted message, for scroll-to-original
}

export interface TemplateComponent {
  type: string;
  text?: string;
  format?: string;
  /** Meta calls a call button's number `phone_number`; our own copy uses `phone`. */
  buttons?: { type: string; text: string; url?: string; phone?: string; phone_number?: string; example?: unknown }[];
  /** Meta's sample values (the body's {{n}} examples are in `body_text[0]`). */
  example?: { body_text?: string[][]; header_text?: string[] };
}

/** One swipeable card of a carousel template (our stored copy). */
export interface TemplateCard {
  mediaUrl: string;
  mediaFormat: 'image' | 'video';
  body?: string;
  buttons: { type: string; text: string; url?: string; phone?: string }[];
}

/** Limited-time offer settings stored with an offer template. */
export interface TemplateLto {
  text: string; // the offer label, e.g. "Expiring offer!"
  hasExpiration: boolean;
  hasCopyCode: boolean;
  code?: string;
  endsAt?: string | null;
}

/** How an authentication template's code reaches the customer. */
export type OtpType = 'COPY_CODE' | 'ONE_TAP' | 'ZERO_TAP';

/** An Android app allowed to receive one-tap / zero-tap codes. */
export interface AuthApp {
  packageName: string;
  signatureHash: string;
}

/** Authentication (one-time code) template settings. */
export interface TemplateAuth {
  otpType: OtpType | '';
  addSecurityRecommendation: boolean;
  /** 1–90, or null for no expiry line. */
  codeExpirationMinutes: number | null;
  /** Copy-code button label ('' = Meta's default, "Copy code"). */
  buttonText: string;
  /** One-tap / zero-tap autofill button label ('' = "Autofill"). */
  autofillText: string;
  supportedApps: AuthApp[];
  zeroTapTermsAccepted: boolean;
  /** 30–900 seconds, or null for Meta's default (10 minutes). */
  messageSendTtlSeconds: number | null;
}

export interface TemplateItem {
  name: string;
  status?: string;
  language?: string;
  category?: string;
  /** standard | carousel | lto (limited-time offer). */
  kind?: 'standard' | 'carousel' | 'lto';
  /** Meta's code when it rejects or pauses a template, e.g. INCORRECT_CATEGORY. */
  rejectedReason?: string;
  cards?: TemplateCard[];
  lto?: TemplateLto | null;
  /** Authentication templates: the settings asked of Meta (Meta writes the text). */
  auth?: TemplateAuth | null;
  footerText?: string;
  headerFileName?: string;
  headerMediaUrl?: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  components?: TemplateComponent[];
  /** The body as we stored it, so the composer can find its {{n}} placeholders. */
  bodyText?: string;
  variables?: TemplateVariable[];
  trigger?: TemplateTrigger;
  /**
   * A sample template of the shared test number (GET /templates?include=shared,
   * business not connected yet): can be sent in a test chat, not edited.
   */
  shared?: boolean;
}

/**
 * What one {{n}} placeholder means.
 *
 * Meta only allows positional placeholders, so a template can't describe its
 * own values — the mapping lives here and the server fills it in at send time.
 */
export interface TemplateVariable {
  index: number; // the n in {{n}}
  source: string; // a key from the template-sources endpoint, or 'other'
  name?: string; // custom name when source is 'other' or user-defined column name
  fallback?: string; // used when the live value is blank
}

/** When a template sends itself. */
export interface TemplateTrigger {
  enabled: boolean;
  /** Inbound messages that fire it (whole-message, case-insensitive). */
  keywords: string[];
  /** Order statuses that fire it when an order moves to one of them. */
  statuses: string[];
  /** Named events that fire it, e.g. 'member_unavailable'. */
  events?: string[];
}

/** A named event a template can subscribe to. */
export interface TriggerEvent {
  key: string;
  label: string;
  hint?: string;
}

/** A named value a placeholder can be mapped to. */
export interface TemplateSource {
  key: string;
  label: string;
  hint?: string;
}

export interface ApiList<T> {
  success: boolean;
  data: T[];
}

// -----------------------------------------------------------------------------
// Catalog (products + categories) — syncs to the Meta Commerce catalog.
// -----------------------------------------------------------------------------
/** Outcome of pushing a product to the tenant's Meta Commerce catalog. */
export interface CatalogSync {
  synced: boolean;
  items?: number;
  reason?: string;
}

/** Meta variant field a sub-variant is published as (Meta owns the heading). */
export type SubVariantField = 'color' | 'pattern' | 'material';

export interface ProductVariant {
  label: string; // e.g. "500 g" (derived from quantity + unit)
  quantity?: number;
  unit?: string;
  price: number;
  deliveryCharge?: number;
  imageUrl?: string; // primary image (mirrors images[0])
  /** Up to 10 photos — the ‹ › carousel on the WhatsApp detail screen. */
  images?: string[];
  /**
   * Second-axis options for this size, e.g. ['Spicy', 'Hot']. Each pairs with
   * the size to make one selectable item in the catalog.
   */
  subVariants?: string[];
  /** Legacy single value, read when `subVariants` is absent. */
  subVariant?: string;
}

export interface SoldOutDay {
  day: 'Sun' | 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat';
  enabled: boolean;
  startTime?: string; // HH:mm
  endTime?: string;
}

export interface SoldOutSchedule {
  enabled: boolean;
  type: 'daily' | 'custom';
  dailyStartTime?: string; // HH:mm  (available window start)
  dailyEndTime?: string;
  days?: SoldOutDay[];
}

export interface Product {
  _id: string;
  retailerId?: string;
  name: string;
  description?: string;
  categories: string[]; // multi-select category names
  price: number;
  mrp?: number;
  freeDelivery?: boolean;
  deliveryCharge?: number;
  unit?: string;
  quantity?: number; // pack size
  imageUrl?: string;
  gallery?: string[];
  variants?: ProductVariant[];
  inStock?: boolean;
  active?: boolean;
  isPaused?: boolean; // manual availability toggle
  soldOutSchedule?: SoldOutSchedule;
  /** What the business calls the second axis, e.g. "Spice level". */
  subVariantLabel?: string;
  /** Which Meta field the sub-variant is published under. */
  subVariantField?: SubVariantField;
  catalogSynced?: boolean;
  /** Why the last push to the Meta catalog failed, if it did. */
  catalogError?: string;
  catalogSyncedAt?: string;
  createdAt?: string;
}

export interface Category {
  _id: string;
  name: string;
  imageUrl?: string;
  order?: number;
}

// -----------------------------------------------------------------------------
// Members — a generic "people / entities" directory a business lists in flows:
// a hospital's doctors, an agency's agents, a salon's stylists. Grouped by a
// category name so a flow can show "members of the chosen category".
// -----------------------------------------------------------------------------

/** One working window, 24h 'HH:MM'. */
export interface TimeWindow {
  from: string;
  to: string;
}

/** A working day and the windows worked on it. */
export interface DaySchedule {
  day: string; // 'mon' … 'sun'
  windows: TimeWindow[];
}

/** A dated absence. `wholeDay` false means only from–to is blocked. */
export interface Unavailability {
  date: string; // 'YYYY-MM-DD'
  wholeDay: boolean;
  from?: string;
  to?: string;
  reason?: string;
  notifiedAt?: string;
}

/** A bookable slot as the backend computes it. */
export interface Slot {
  start: string; // 'HH:MM' 24h
  end: string;
  label: string; // '2:30 pm'
  left: number; // places remaining
}

export interface Member {
  _id: string;
  name: string;
  category?: string; // Category name this member belongs to
  title?: string; // role / designation (e.g. Cardiologist)
  phone?: string;
  email?: string;
  description?: string;
  imageUrl?: string;
  // One generic fee whose label comes from the business vertical:
  // "Consultation fee" (hospital), "Price per night" (hotel), "Course fee"…
  fee?: number;
  currency?: string;
  // Bookable (person archetype)
  duration?: number; // slot length in minutes
  /**
   * Per-day working windows. Each day carries its own list, because consulting
   * hours differ by day: Monday morning + afternoon, Tuesday also evening.
   * The gap between two windows on a day is the break.
   */
  schedule?: DaySchedule[];
  /** Patients per slot. 1 unless the clinic deliberately double-books. */
  slotCapacity?: number;
  /** Dated absences, whole-day or a time range. */
  unavailability?: Unavailability[];
  // Legacy single window, superseded by `schedule` (migrated on read).
  availableDays?: string[]; // ['mon','tue',…]
  availableFrom?: string; // 'HH:MM'
  availableTo?: string; // 'HH:MM'
  // Optional, shown per vertical
  experience?: number; // years
  qualifications?: string;
  languages?: string[];
  location?: string;
  capacity?: number;
  amenities?: string[];
  extras?: Record<string, unknown>;
  order?: number;
  active?: boolean;
}

// -----------------------------------------------------------------------------
// Offers — a promotion that can target multiple products. Each selected variant
// (size) carries its own discount; a "whole product" selection simply includes
// all of that product's variants. Every item shows the original price (struck
// through) next to its computed offer price.
// -----------------------------------------------------------------------------
export interface OfferItem {
  productId: string;
  productName: string; // snapshot so cards render without re-joining
  productImageUrl?: string;
  variantIndex: number; // index into the product's variants[]
  /**
   * Which sub-variant of that size the discount targets (the second axis:
   * flavour / spice level / colour). -1 means the whole size, every
   * sub-variant of it — which is also what offers saved before this field
   * existed mean.
   */
  subIndex: number;
  subLabel?: string; // snapshot, e.g. "spicy"
  label: string; // snapshot of the variant label (e.g. "500 g")
  originalPrice: number; // the variant's normal price (struck through)
  discountType: 'percent' | 'flat';
  discountValue: number; // percent (0-100) or flat ₹ off
  offerPrice: number; // computed final price after discount
}

export interface Offer {
  _id: string;
  title: string;
  active: boolean;
  items: OfferItem[];
  startsAt?: string;
  endsAt?: string;
  createdAt?: string;
}

// -----------------------------------------------------------------------------
// Orders & bookings — fulfilment records that can also feed a flow's "Orders"
// list so a customer can pick a past order (e.g. to track or reorder).
// -----------------------------------------------------------------------------
export type OrderStatus =
  | 'pending'
  | 'confirmed'
  | 'preparing'
  | 'out_for_delivery'
  | 'delivered'
  | 'cancelled';

export interface OrderLine {
  name: string;
  qty: number;
  price: number;
}

export interface Order {
  _id: string;
  reference: string; // e.g. ORD-1042 / BKG-220
  kind: 'order' | 'booking';
  customerName: string;
  phone: string;
  items?: OrderLine[];
  total: number;
  status: OrderStatus;
  scheduledAt?: string; // booking date/time
  createdAt?: string;
  // Captured on the way through the flow that confirmed the order.
  paymentMethod?: string; // the button the customer tapped, e.g. "COD"
  deliveryFee?: number;
  deliveryAddress?: string;
  locationUrl?: string; // maps deep link for the shared pin
  locationLat?: number;
  locationLng?: number;
  category?: string;
  paid?: boolean;
  cancelledAt?: string;
}

// -----------------------------------------------------------------------------
// Native WhatsApp Flows — a no-code builder for the structured Flow JSON that
// renders as multi-screen forms (banner 8:1, headings, radio lists, inputs, a
// footer button). Saved as a definition, then published/republished to Meta.
// -----------------------------------------------------------------------------
export type FlowComponentType =
  | 'Image' // 8:1 banner
  | 'TextHeading'
  | 'TextSubheading'
  | 'TextBody'
  | 'TextCaption'
  | 'RadioButtonsGroup'
  | 'Dropdown'
  | 'CheckboxGroup'
  | 'TextInput'
  | 'TextArea'
  | 'DatePicker'
  | 'PhotoPicker' // camera / gallery image upload
  | 'DocumentPicker' // document upload
  | 'Footer';

// input-type for TextInput (maps to Flow JSON "input-type").
export type FlowInputType = 'text' | 'number' | 'email' | 'phone' | 'password' | 'passcode';

export interface FlowOption {
  id: string;
  title: string;
  description?: string;
  image?: string; // optional 1:1 image (data URL in builder, base64 on publish)
  nextScreen?: string; // branch: go to this screen when this option is chosen
  blockId?: string; // when NOT branching to a screen, send this message block
  nextFlowId?: string; // hand off to a flow-link node (its id) when chosen
}

// A flow-reference node placed on the map — hands off to another flow (which
// can be an existing one or a newly created one).
export interface FlowLink {
  id: string;
  flowId: string; // the linked flow definition _id ('' until chosen)
}

// A saved chatbot "journey" — the node/edge graph from the Journeys builder.
// Flows can hand off to a journey (per selected option) once they complete.
export interface Journey {
  _id: string;
  name: string;
  nodes: unknown[];
  edges: unknown[];
  /** The chats it answers (older journeys: WhatsApp). Set when it is created. */
  channel?: 'whatsapp' | 'instagram' | 'messenger';
  /** Bot on (default) / off for that channel. */
  active?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface FlowComponent {
  cid: string; // local-only id for the editor
  type: FlowComponentType;
  // Image banner (stored as a data URL in the builder; embedded as base64 on publish)
  src?: string;
  // text components
  text?: string;
  // form fields
  name?: string;
  label?: string;
  required?: boolean;
  inputType?: FlowInputType;
  helperText?: string;
  // DatePicker only: furthest a date may be picked, in days from today. Blocks
  // "too far" bookings; 0/unset uses the default horizon.
  maxDaysAhead?: number;
  description?: string; // picker description
  // PhotoPicker: where photos come from
  photoSource?: 'camera' | 'gallery' | 'camera_gallery';
  maxFiles?: number; // max uploaded photos/documents
  // selection components
  options?: FlowOption[];
  // Where a selection list gets its rows: 'static' (the options above),
  // 'categories' (catalog categories with 1:1 images) or 'orders' (the
  // customer's recent orders) — the dynamic ones are served by the flow endpoint.
  // 'active_orders' lists only orders the customer can still act on (not
  // delivered or already cancelled) — used by the Cancel order flow.
  // 'slots' lists the chosen member's free appointment times for the date
  // chosen on an earlier screen — derived from their per-day working windows,
  // minus bookings already taken and minus any absence on that date.
  // 'appointments' lists the customer's own upcoming bookings, for a
  // reschedule picker. Choosing one also tells a later slots list which member
  // to show times for.
  source?: 'static' | 'categories' | 'members' | 'orders' | 'active_orders' | 'slots' | 'appointments';
  // Prefill this input from runtime data. 'phone' fills the sender's WhatsApp
  // number. With `locked` the customer can see it but can't edit it.
  prefill?: 'phone';
  locked?: boolean;
  // Footer button
  buttonLabel?: string;
  action?: 'complete' | 'navigate';
  nextScreen?: string; // target screen id when action === 'navigate'
  nextFlowId?: string; // hand off to another flow on completion (chatbot-driven)
  blockId?: string; // send this message block on completion (chatbot-driven)
}

export interface FlowScreen {
  id: string; // UPPER_SNAKE screen id (e.g. CHOOSE_SERVICE)
  title: string;
  components: FlowComponent[];
  // Configuration for the chat message that OPENS this flow (the interactive
  // "flow" message with the CTA button). Shown/edited on the map's screen node.
  msgBody?: string; // text above the Open button
  msgHeader?: FlowBlockHeader; // none | image | video | pdf
  msgHeaderMediaUrl?: string;
  msgHeaderFileName?: string;
  /**
   * Marks this as the flow's "nothing found" screen.
   *
   * A WhatsApp Flow picker must have at least one option, so a dynamic list
   * that resolves to nothing — no orders to track, no open orders to cancel —
   * makes the client fail with "Something went wrong". The runtime swaps in
   * this screen instead. One per flow; it serves every list.
   */
  emptyState?: boolean;
}

// A message "block" (journey-style) a flow can hand off to. When an option (or
// a screen's footer) is wired to a block on the map, choosing it completes the
// flow and the backend sends this block as a WhatsApp message. Mirrors the
// Journeys block set: message / media header / reply buttons / CTA / call /
// location / list / template.
export type FlowBlockKind =
  | 'message' | 'reply' | 'cta' | 'call' | 'location' | 'list' | 'template'
  | 'payment' | 'catalog'
  // 'orderconfirm' = the order confirmation message. One body summarising
  // whatever the conversation captured — chosen category, cart lines, charges,
  // payment method, delivery address — where any line whose live value is
  // empty is dropped, so the same block suits a business that asks for a
  // delivery address and one that doesn't.
  | 'orderconfirm'
  // 'orderdetails' reports on an order the customer picked earlier (a "my
  // orders" / "track order" screen): its reference, status, date, items and
  // total. Reads an existing order — it never creates one — and like the
  // confirmation it drops any line whose value isn't there.
  | 'orderdetails'
  // 'paymethod' asks how the customer wants to pay. It behaves exactly like a
  // reply-button block (media header + body + up to 3 buttons, each with its
  // own continuation) but ships pre-filled with Online / COD, so the common
  // case is one drag instead of building it by hand. The button labels stay
  // editable — rename them to "UPI", "Cash", whatever the business says.
  | 'paymethod'
  // 'restart' sends the conversation back to the flow's entry node — wire any
  // ending to it and the customer starts over, as if they'd typed "hi".
  | 'restart'
  // 'pdfdoc' = a generated A4 document (receipt / cancellation slip) delivered
  // as one WhatsApp message: PDF attachment + body text + reply buttons.
  | 'pdfdoc';

// -----------------------------------------------------------------------------
// PDF designer — an A4 page of absolutely-positioned elements, laid out in the
// flow builder. Coordinates are CSS pixels at 96dpi (A4 = 794 × 1123), which is
// what the designer canvas works in; the backend scales them to PDF points.
// Any text may contain {{tokens}}, filled with live order/member/category data
// at send time — that's what makes one template serve every business and flow.
// -----------------------------------------------------------------------------
export type PdfElementType = 'text' | 'image' | 'box' | 'line';

export interface PdfElement {
  id: string;
  type: PdfElementType;
  x: number;
  y: number;
  w?: number;
  h?: number;
  // text
  text?: string;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  color?: string;
  align?: 'left' | 'center' | 'right';
  lineGap?: number;
  // image (logo, signature, stamp…)
  src?: string;
  // box / line
  fill?: string;
  stroke?: string;
  thickness?: number;
  radius?: number;
}

export interface PdfTemplate {
  width: number;
  height: number;
  background?: string;
  elements: PdfElement[];
}


export interface FlowPayItem {
  name: string;
  qty: number;
  price: number;
}
export type FlowBlockHeader = 'none' | 'image' | 'video' | 'pdf';
export interface FlowBlock {
  id: string;
  kind: FlowBlockKind;
  text?: string;
  header?: FlowBlockHeader; // media header for message/reply/cta/call
  headerMediaUrl?: string;
  headerFileName?: string;
  buttons?: string[]; // reply buttons
  ctaLabel?: string; // cta
  ctaUrl?: string;
  callLabel?: string; // call
  callPhone?: string;
  listTitle?: string; // list menu
  options?: string[];
  templateName?: string; // approved template
  // Outgoing wiring (target node ids: screen_<id> / block_<id> / flink_<id>).
  // `nextTarget` is the single continuation for message/cta/call/template blocks.
  // `buttonTargets[i]` is the continuation for reply-button i.
  nextTarget?: string;
  buttonTargets?: string[];
  // Location block branches — a target node id (screen_/block_/flow_) to go to
  // when the shared location is valid / not valid.
  validTarget?: string;
  invalidTarget?: string;
  // Payment (WhatsApp Pay order details via UPI).
  reference?: string; // order reference / id
  items?: FlowPayItem[]; // order line items
  currency?: string; // default INR
  // Payment type block ('paymethod') — the delivery fee added to the cart
  // subtotal (0 prints as FREE), plus the generated Items / Delivery / Total
  // payable summary shown above the block's own prompt text.
  deliveryFee?: number;
  showSummary?: boolean;
  summaryTitle?: string;
  // PDF document block ('pdfdoc') — the A4 design and the attachment filename
  // shown in WhatsApp (both may contain {{tokens}}).
  pdfTemplate?: PdfTemplate | null;
  pdfFileName?: string;
}

// -----------------------------------------------------------------------------
// Registrations — form submissions captured from a native WhatsApp Flow (the
// "Register" block). The tenant chooses the fields, so `fields` holds whatever
// was submitted while the well-known ones are lifted into columns.
// -----------------------------------------------------------------------------
export type RegistrationStatus = 'new' | 'contacted' | 'confirmed' | 'done' | 'cancelled';

export interface Registration {
  _id: string;
  phone?: string;
  name?: string;
  businessName?: string;
  email?: string;
  date?: string;
  // What the customer picked on the way to the form (category → member).
  category?: string;
  memberId?: string;
  memberName?: string;
  fields?: Record<string, string | number | boolean>;
  flowId?: string;
  flowName?: string;
  status: RegistrationStatus;
  createdAt?: string;
  /**
   * The answers resolved against the flow definition — the real question text
   * and the chosen option's wording. Computed by the API on read, because only
   * the flow knows that "field_11" was "Choose one" and "opt_1" was
   * "Order Food"; `fields` keeps the raw submission.
   */
  rows?: FormRow[];
}

/**
 * Outcome of republishing products to the Meta catalog after a change.
 * Returned alongside offer and product writes so a failed push is visible
 * rather than leaving the CRM showing a price WhatsApp doesn't have.
 */
export interface CatalogSyncResult {
  pushed: number;
  failed: number;
  total: number;
  error?: string;
  errors?: string[];
}

export interface WaFlowDef {
  _id: string;
  name: string;
  categories?: string[]; // Meta flow categories (e.g. ['OTHER'])
  // The chat message that opens this flow: optional media header, body text, a
  // footer line and the CTA button label. Assembled at send time, so editing it
  // never requires republishing.
  cta?: string; // the message button text that opens the flow
  msgHeader?: FlowBlockHeader; // none | image | video | pdf
  msgHeaderMediaUrl?: string;
  msgHeaderFileName?: string;
  msgBody?: string;
  msgFooter?: string;
  screens: FlowScreen[];
  blocks?: FlowBlock[]; // message blocks options/footers can hand off to
  flowLinks?: FlowLink[]; // flow-reference nodes placed on the map
  entryTarget?: string; // Start node target: the entry node id (screen_/block_)
  positions?: Record<string, { x: number; y: number }>; // saved map node layout
  metaFlowId?: string; // id returned by Meta once created
  status?: 'DRAFT' | 'PUBLISHED';
  updatedAt?: string;
  createdAt?: string;
}

/** A reusable flow blueprint shared across tenants of the same business type. */
export interface FlowTemplate {
  _id: string;
  name: string;
  description?: string;
  archetype?: string;
  categoryLabel?: string; // the author's business-type label, for display
  createdByName?: string;
  createdByBusiness?: string;
  usedCount?: number;
  screens: FlowScreen[];
  updatedAt?: string;
  createdAt?: string;
}

// ---------- Notifications (header bell + drawer) ----------
export type AppNotificationType =
  | 'template_approved' | 'template_rejected' | 'template_paused'
  | 'message' | 'campaign_finished' | 'order_new'
  | 'booking_new' | 'booking_cancelled' | 'booking_rescheduled'
  | 'payment_received' | 'payment_failed'
  | 'whatsapp_connected' | 'sandbox_linked' | 'sandbox_full'
  | 'plan_changed' | 'plan_ending' | 'plan_ended' | 'channel_connected' | 'channel_disconnected'
  | 'ads_connected' | 'ads_disconnected' | 'ad_lead'
  | 'catalog_connected'
  // Ads Manager
  | 'ad_campaign_created' | 'ad_rejected' | 'ad_audience_ready' | 'ad_rule_triggered' | 'ad_test_winner';

export interface AppNotification {
  _id: string;
  type: AppNotificationType | string;
  title: string;
  body: string;
  /** What a click opens: a CRM view plus the record id (template name, campaign/order id) or chat phone. */
  target: { view: string; id: string; phone: string };
  /** Messages merged into this row (chat notifications are grouped per conversation). */
  count: number;
  createdAt: string | null;
  lastAt: string | null;
  readAt: string | null;
  read: boolean;
}

export interface AppNotificationPage {
  success: boolean;
  data: AppNotification[];
  /** Cursor for the next (older) page, or null at the end. */
  nextBefore: string | null;
  unread: number;
}

// ---------- Create: Facebook / Instagram publishing + Comment auto-DM ----------
export type SocialTarget = 'facebook' | 'instagram';
export type SocialKind = 'post' | 'carousel' | 'video' | 'reel' | 'story';

/** ok null = Meta's permissions aren't known yet. */
export interface SocialCapability {
  ok: boolean | null;
  missing: string[];
}

export interface SocialAccount {
  target: SocialTarget;
  status: 'connected' | 'disconnected';
  name: string;
  username: string;
  pageId: string;
  igUserId: string;
  pictureUrl: string;
  loginMethod: '' | 'facebook' | 'instagram';
  publish: SocialCapability;
  comments: SocialCapability;
  /** The Page's 'feed' / the Instagram login's 'comments' webhook is on (null: covered by the app). */
  commentsWebhook: boolean | null;
}

export interface SocialLimits {
  instagramCaption: number;
  instagramHashtags: number;
  facebookCaption: number;
  carouselMin: number;
  carouselMax: number;
  minLeadMs: number;
  maxAheadMs: number;
  waiting: number;
}

export interface SocialOverview {
  success: boolean;
  accounts: Record<SocialTarget, SocialAccount | null>;
  limits: SocialLimits;
}

export interface SocialMedia {
  url: string;
  type: 'image' | 'video';
  width: number | null;
  height: number | null;
  size?: number;
}

export interface SocialTargetResult {
  state: 'pending' | 'children' | 'processing' | 'published' | 'failed';
  id: string;
  permalink: string;
  error: { code: string; message: string } | null;
  publishedAt: string | null;
}

export interface SocialPost {
  id: string;
  kind: SocialKind;
  targets: SocialTarget[];
  caption: string;
  media: SocialMedia[];
  scheduledAt: string | null;
  status: 'scheduled' | 'publishing' | 'published' | 'partial' | 'failed';
  results: Partial<Record<SocialTarget, SocialTargetResult>>;
  publishedAt: string | null;
  createdAt: string | null;
}

export interface SocialPostInput {
  kind: SocialKind;
  targets: SocialTarget[];
  caption: string;
  media: SocialMedia[];
  /** ISO time; omit to publish now. */
  scheduledAt?: string;
}

/** A recent post / reel on the account (rule post picker). */
export interface SocialRecentPost {
  id: string;
  text: string;
  thumb: string;
  permalink: string;
  at: string | null;
  type: 'post' | 'reel' | 'story';
}

export interface CommentRule {
  id: string;
  channel: SocialTarget;
  name: string;
  active: boolean;
  postId: string;
  postLabel: string;
  postThumb: string;
  matchMode: 'any' | 'keywords';
  keywords: string[];
  dmText: string;
  publicReplies: string[];
  oncePerUser: boolean;
  sentCount: number;
  lastSentAt: string | null;
  createdAt: string | null;
}

export type CommentRuleInput = Partial<Omit<CommentRule, 'id' | 'sentCount' | 'lastSentAt' | 'createdAt'>>;

export interface CommentActivity {
  id: string;
  ruleId: string;
  channel: SocialTarget;
  postId: string;
  fromName: string;
  text: string;
  psid: string;
  status: 'sent' | 'skipped' | 'failed';
  reason: string;
  error: string;
  publicReplyError: string;
  createdAt: string | null;
}

export interface CommentRuleWrite {
  success: boolean;
  rule: CommentRule;
  /** Whether Meta's comment notifications are on for the account (message when not). */
  webhook: { ok: boolean; message: string };
}
