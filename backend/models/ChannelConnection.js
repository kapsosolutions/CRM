import { Schema, defineModel } from '../db/model.js';

// A business's connection to a Meta messaging channel other than WhatsApp:
// a Facebook Page for Messenger, or an Instagram professional account —
// either the one linked to that Page (Facebook Login for Business,
// services/metaChannels.js) or one logged in directly (Business Login for
// Instagram, services/instagramLogin.js). One row per business per channel.
//
// The access token (Page token, or Instagram user token) is stored encrypted
// (services/tokenCrypto.js, AES-256-GCM) and never leaves the server.
const ChannelConnectionSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', index: true, required: true },
    // 'messenger' | 'instagram' | 'ads' (Feature F: the business's Meta ad
    // account, services/metaAds.js; its Page fields are the lead-forms Page)
    channel: { type: String, enum: ['messenger', 'instagram', 'ads'], required: true },
    pageId: { type: String, default: '', index: true },
    pageName: { type: String, default: '' },
    // Instagram only: the professional account's id (the webhook entry id) and handle.
    igUserId: { type: String, default: '', index: true },
    igUsername: { type: String, default: '' },
    pictureUrl: { type: String, default: '' },
    // "v1:<base64>" ciphertext of the Page access token.
    pageAccessToken: { type: String, default: '' },
    // How Meta issued the token the Page token came from: 'system_user'
    // (Login for Business, never expires) or 'user'.
    tokenSource: { type: String, default: '' },
    connectedAt: { type: Date },
    // 'connected' | 'disconnected' (Meta answered error 190: access removed)
    status: { type: String, enum: ['connected', 'disconnected'], default: 'connected', index: true },
    statusReason: { type: String, default: '' },
    disconnectedAt: { type: Date },
    // Page webhook subscription (POST /{page-id}/subscribed_apps) at connect time.
    subscribedFields: { type: [String], default: [] },

    // ---- channel 'instagram' only ----
    // How the account was connected: 'facebook' (Login for Business, the Page
    // linked to the account; Page token, graph.facebook.com) or 'instagram'
    // (Business Login for Instagram, services/instagramLogin.js; no Page, a
    // long-lived Instagram user token in pageAccessToken, graph.instagram.com).
    // Rows from before this field existed have none and mean 'facebook'.
    loginMethod: { type: String, enum: ['facebook', 'instagram'], default: 'facebook' },
    // 'instagram' method: when the long-lived token expires (60 days after it
    // was issued or last refreshed) and when that was.
    tokenExpiresAt: { type: Date },
    tokenRefreshedAt: { type: Date },

    // ---- channel 'ads' only ----
    // The ad account ('act_<id>') the dashboard reads, and its display details.
    adAccountId: { type: String, default: '', index: true },
    adAccountName: { type: String, default: '' },
    adAccountCurrency: { type: String, default: '' },
    adAccountTimezone: { type: String, default: '' },
    adAccountStatus: { type: Number, default: 0 },
    // "v1:<base64>" ciphertext of the login token (system user, never expires)
    // the Marketing API calls use. Never leaves the server.
    adAccessToken: { type: String, default: '' },
    // Permission names Meta granted (debug_token / me/permissions), and whether
    // ads_management covers this account (pause / resume allowed).
    grantedScopes: { type: [String], default: [] },
    canManageAds: { type: Boolean, default: false },
    permissionsCheckedAt: { type: Date },
    // The lead-forms Page (pageId / pageName / pageAccessToken above) was
    // subscribed to 'leadgen' webhooks; why not, when it failed.
    leadgenSubscribed: { type: Boolean, default: false },
    leadgenError: { type: String, default: '' },
  },
  { timestamps: true },
);

ChannelConnectionSchema.index({ businessId: 1, channel: 1 }, { unique: true });
ChannelConnectionSchema.index({ channel: 1, pageId: 1 });
ChannelConnectionSchema.index({ channel: 1, igUserId: 1 });

export default defineModel('ChannelConnection', ChannelConnectionSchema, 'channel_connections');
