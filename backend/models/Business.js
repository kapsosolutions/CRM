import { Schema, defineModel } from '../db/model.js';

// A tenant: one WhatsApp business with its own Meta Cloud API credentials.
// Credentials are verified against the Graph API before a business is created.
// Each tenant gets an auto-generated login (username + 6-digit passcode) and its
// own webhook callback URL + verify token so inbound messages are isolated.
const BusinessSchema = new Schema(
  {
    name: { type: String, required: true },

    // ----- Vertical -----
    // Business type (see services/verticals.js). Drives which CRM pages this
    // tenant sees and how its "members" / fees are labelled.
    category: { type: String, default: 'other' },

    // Per-business wording overrides. The category supplies sensible defaults
    // (a clinic's members are "Doctors", its customer a "Patient"); the admin
    // can override any of these on a specific business. Blank = use the
    // category default.
    labels: {
      memberLabel: { type: String, default: '' },
      memberSingular: { type: String, default: '' },
      categoryLabel: { type: String, default: '' },
      categoryPlural: { type: String, default: '' },
      customerLabel: { type: String, default: '' },
      customerPlural: { type: String, default: '' },
    },

    // ----- Account owner (self-registered businesses) -----
    // The person who signed up. Their password lives in Supabase Auth
    // (authUserId); `email` is the login and is unique across businesses.
    // Businesses onboarded by the platform owner before sign-up existed have
    // none of these until the admin sets a login email for them.
    ownerFirstName: { type: String, default: '' },
    ownerLastName: { type: String, default: '' },
    ownerPhone: { type: String, default: '' },
    email: { type: String, unique: true, index: true }, // lower-cased; never ''
    authUserId: { type: String, unique: true, index: true }, // Supabase auth.users id
    authProvider: { type: String, default: '' }, // 'password' | 'google'

    // ----- Meta WhatsApp Cloud API credentials (per tenant) -----
    // Not required: a business registers first and connects WhatsApp after,
    // through Embedded Signup. Until then these are empty and nothing is sent.
    phoneNumberId: { type: String, unique: true, index: true },
    wabaId: { type: String, default: '' },
    appId: { type: String, default: '' },
    appSecret: { type: String, default: '' }, // optional, for webhook signature checks
    accessToken: { type: String, default: '' }, // long-lived / system-user token

    // How WhatsApp was connected. `pin` is the two-step verification PIN set
    // when the number was registered for Cloud API — kept so it can be
    // re-registered later; never sent to the browser.
    waConnection: {
      method: { type: String, default: '' }, // 'embedded_signup' | 'manual'
      connectedAt: { type: Date },
      metaBusinessId: { type: String, default: '' },
      pin: { type: String, default: '' },
    },
    catalogId: { type: String, default: '' },
    // How the catalog was connected. 'meta_login' = Catalog → Get started
    // (services/metaCatalog.js): `token` is that login's token, encrypted
    // (services/tokenCrypto.js), used for the product sync instead of the
    // WhatsApp token. Never sent to the browser. '' = typed id / admin panel.
    catalogConnection: {
      method: { type: String, default: '' },
      token: { type: String, default: '' },
      tokenSource: { type: String, default: '' },
      scopes: { type: [String], default: [] },
      metaBusinessId: { type: String, default: '' },
      metaBusinessName: { type: String, default: '' },
      connectedAt: { type: Date },
    },
    // v22.0 is the floor for native WhatsApp Pay. `payment_settings` — the
    // nested gateway block carrying the Razorpay receipt and notes — replaced
    // the older `payment_type` / `payment_configuration` pair, and on v21.0
    // the message is still accepted but the gateway handshake never happens:
    // the card arrives, the order screen renders, then Continue fails with
    // "Something went wrong" and Meta records no transaction at all.
    graphVersion: { type: String, default: 'v22.0' },

    // ----- Meta native payment (WhatsApp Pay via Razorpay/PayU gateway) -----
    payment: {
      enabled: { type: Boolean, default: false },
      configName: { type: String, default: '' }, // WhatsApp Manager > Payment configurations
      gatewayType: { type: String, enum: ['razorpay', 'payu', 'upi_vpa', ''], default: 'razorpay' },

      // ----- Seller details, required only when there is no Meta catalog -----
      //
      // Meta's order_details spec: "If you do not provide catalog_id, you must
      // provide the following fields inside the items object: country_of_origin,
      // importer_name, and importer_address." A catalog entry would describe
      // the goods, so without one the order has to carry the seller's own
      // details on every line instead. It is NOT about physical vs digital
      // goods, and it is not satisfied by the payment configuration at Meta —
      // leaving it out is what made "Review and pay" fail with "Something went
      // wrong" the moment the customer tapped Continue.
      merchantName: { type: String, default: '' }, // defaults to the business name
      addressLine1: { type: String, default: '' },
      addressLine2: { type: String, default: '' },
      city: { type: String, default: '' },
      zoneCode: { type: String, default: '' }, // 2-letter state code, e.g. TG
      postalCode: { type: String, default: '' },
      countryCode: { type: String, default: 'IN' },
      countryOfOrigin: { type: String, default: 'India' },
    },

    // ----- Snapshot of details fetched from Graph at verification time -----
    meta: {
      verifiedName: { type: String, default: '' },
      displayPhoneNumber: { type: String, default: '' },
      qualityRating: { type: String, default: '' },
      wabaName: { type: String, default: '' },
      catalogName: { type: String, default: '' },
      profilePictureUrl: { type: String, default: '' },
      lastVerifiedAt: { type: Date },
      // The number's Cloud API status as Meta last reported it (CONNECTED,
      // PENDING, FLAGGED, …), stored by Embedded Signup and "Activate number"
      // and kept in step by services/metaAccount.js. '' = never stored.
      numberStatus: { type: String, default: '' },
      numberStatusAt: { type: Date },
      // Another Meta app on this number holds chats (WhatsApp error 131070, or
      // messages arriving on `standby`): { at, lastAt, phone, count, via }.
      // null once our app answers chats again (services/otherApps.js).
      threadControl: { type: Schema.Types.Mixed, default: null },
    },

    // ----- WhatsApp Business Profile details -----
    profilePicture: { type: String, default: '' },
    about: { type: String, default: '' },
    description: { type: String, default: '' },
    address: { type: String, default: '' },
    website1: { type: String, default: '' },
    website2: { type: String, default: '' },

    // ----- Plan / free trial -----
    // 'paid' tenants are unmetered. A 'free' tenant is a trial: every outbound
    // WhatsApp message spends one credit, and sending stops at the limit until
    // the super admin resets it. Existing tenants default to 'paid' so adding
    // this field can't retroactively meter anyone.
    plan: { type: String, enum: ['free', 'paid'], default: 'paid', index: true },
    trial: {
      limit: { type: Number, default: 10 }, // credits granted per reset
      used: { type: Number, default: 0 }, // credits spent
      resets: { type: Number, default: 0 }, // how many times it's been topped up
      lastResetAt: { type: Date },
    },
    // Which paid plan (by its name in the plans list: 'Basic' | 'Pro' |
    // 'Premium'), when the admin moved the business to it from a plan
    // request. '' = not recorded. Always '' on the free plan.
    planName: { type: String, default: '' },
    // When the super admin last changed the plan (services/billing.js).
    // Not set for businesses whose plan was never changed.
    planChangedAt: { type: Date },

    // ----- SaaS plan (services/plans.js) -----
    // The plan in force is worked out from these dates on every read, so a
    // trial or a paid period ends on time without any job.
    // End of the 7-day free trial. Set at sign-up; when missing, the trial
    // runs 7 days from createdAt (businesses from before plans existed are
    // kept on Premium instead: plans.js isLegacy).
    trialEndsAt: { type: Date },
    // The current paid (or admin-granted) period:
    // { tier: 'basic'|'pro'|'premium', cycle: 'monthly'|'quarterly'|'annual',
    //   startsAt, endsAt, amountPaise, paymentId, orderId, source: 'razorpay'|'admin' }
    subscription: { type: Schema.Types.Mixed, default: null },
    // Which plan reminders were sent (services/planReminders.js), so each is sent once:
    // { endingFor: <endsAt ISO>, endedFor: <endsAt ISO> }
    planNotices: { type: Schema.Types.Mixed, default: null },

    // ----- Generated tenant login -----
    // A stable handle for every business (admin list, support logins with the
    // master password). The 6-digit passcode is the legacy login of businesses
    // created before sign-up; registered businesses sign in with email +
    // password and have no passcode.
    username: { type: String, required: true, unique: true, index: true },
    passcodeHash: { type: String, default: '' },
    passcodeSalt: { type: String, default: '' },
    // Bumped whenever the passcode changes. The value is baked into every
    // issued token, so a reset instantly invalidates sessions opened with the
    // old passcode instead of letting them run out the 7-day TTL.
    tokenVersion: { type: Number, default: 0 },

    // ----- Per-tenant webhook -----
    verifyToken: { type: String, required: true },

    // ----- Shared "try it" number (services/sandbox.js) -----
    // The join code ("#K7MQ2X") a customer sends to the shared test number to
    // reach this business's inbox before it has connected its own WhatsApp.
    // No default, so it stays NULL until set (the unique index allows many).
    sandboxCode: { type: String, unique: true, index: true },
    // When the business was told its test inbox is full (SANDBOX_CONTACT_LIMIT
    // contacts linked). Set once, cleared when a new contact is admitted, so
    // it hears about each time the inbox fills up, not about every refusal.
    sandboxFullNotifiedAt: { type: Date },

    // The native WhatsApp Flow builder is an advanced surface: its output is
    // reviewed by Meta, a bad publish breaks the live flow, and most tenants
    // only ever need Journeys. So it's hidden from a business unless the
    // platform owner switches it on. The super admin always sees it.
    flowsEnabled: { type: Boolean, default: false },

    // Whether this tenant's native Flows drive inbound conversations. Off by
    // default: a flow is built and published first, then switched on from the
    // Flows page to take over from the tenant's journeys. With it off, the
    // flow map is skipped and journeys handle every message.
    flowsActive: { type: Boolean, default: false },

    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

// Never leak secrets to API responses.
//
// The secrets themselves can't be shown, but *whether* they're stored has to
// be: an admin editing a tenant needs to tell "leave this blank to keep the
// existing token" apart from "no token was ever saved here". A missing app
// secret is the difference between webhooks being verified and silently never
// syncing, and there was no way to see that from the panel.
BusinessSchema.methods.toSafeJSON = function toSafeJSON() {
  const o = this.toObject();
  o.hasAccessToken = !!o.accessToken;
  o.hasAppSecret = !!o.appSecret;
  // Connected = it can actually send: a number and a token to send with.
  o.whatsappConnected = !!(o.accessToken && o.phoneNumberId);
  o.hasPasscode = !!o.passcodeHash;
  o.profilePicture = o.profilePicture || o.meta?.profilePictureUrl || '';
  o.avatarUrl = o.profilePicture || o.meta?.profilePictureUrl || '';
  o.about = o.about || '';
  o.description = o.description || '';
  o.address = o.address || o.payment?.addressLine1 || '';
  o.website1 = o.website1 || '';
  o.website2 = o.website2 || '';
  delete o.accessToken;
  delete o.appSecret;
  delete o.passcodeHash;
  delete o.passcodeSalt;
  delete o.authUserId;
  if (o.waConnection) delete o.waConnection.pin;
  if (o.catalogConnection) delete o.catalogConnection.token;
  return o;
};

export default defineModel('Business', BusinessSchema, 'businesses');
