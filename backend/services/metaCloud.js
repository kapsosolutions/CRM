// Meta WhatsApp Cloud API client — multi-tenant.
// `createMetaClient(creds)` builds a client bound to one tenant's credentials.
// The default export delegates to the first active business (a bridge so legacy
// code paths keep working); routes/webhook that know the tenant should use
// `getClientForBusiness` / `getClientForPhoneId` instead.
import axios from 'axios';
import https from 'https';
import FormData from 'form-data';
import logger from './logger.js';
import storage from './storage.js';
import Message from '../models/Message.js';
import Business from '../models/Business.js';
import { emitMessage } from './eventBus.js';
import { takeParked, isStatusUpgrade, statusesBelow } from './messageStatus.js';
import Template from '../models/Template.js';
import { renderTemplate } from './templateRender.js';
import { recordOutboundPreview, recordLastStatus } from './conversationState.js';
import { reserveCredit, refundCredit } from './credits.js';
import { planOf, assertContact } from './planGate.js';
import { decryptToken } from './tokenCrypto.js';
import { noteLimitActivity } from './messagingLimit.js';
import crypto from 'crypto';

const agent = new https.Agent({ keepAlive: true, maxSockets: 25, timeout: 60000 });
const api = axios.create({ httpsAgent: agent, timeout: 20000, headers: { 'Content-Type': 'application/json' } });

// A business that registered but hasn't connected WhatsApp yet has no token.
// Stop those calls here with a message the CRM can show, instead of sending
// "Bearer " to Meta and surfacing its cryptic OAuth error.
export const NOT_CONNECTED = 'WhatsApp is not connected yet. Use “Connect WhatsApp Business Account” at the top of the CRM.';
api.interceptors.request.use((config) => {
  const auth = String(config.headers?.Authorization || config.headers?.authorization || '');
  if (/^Bearer\s*$/.test(auth) || /\/(undefined|null)?\/(messages|message_templates|media|flows|products)\b/.test(String(config.url || ''))) {
    const err = new Error(NOT_CONNECTED);
    err.code = 'WA_NOT_CONNECTED';
    err.status = 409;
    return Promise.reject(err);
  }
  return config;
});

const clean = (phone) => String(phone || '').replace('@c.us', '').replace(/\D/g, '');
const originalUrl = (url) => storage.getOptimizedUrl(url, 'original');

// Build the `header` object for an interactive message.
// header: { type:'image'|'video'|'document', link, filename? } | { type:'text', text }
// Document headers should carry a filename — it's what the customer sees on the
// attachment in WhatsApp (e.g. "Cancellation-DVN-B2C-1AA1F8.pdf").
function headerJson(header) {
  if (!header) return undefined;
  if (header.type === 'text') return { type: 'text', text: header.text };
  const media = { link: header.link };
  if (header.type === 'document' && header.filename) media.filename = header.filename;
  return { type: header.type, [header.type]: media };
}

// Describe an outbound payload so the CRM renders it richly.
export function describeOutbound(payload) {
  const type = payload.type;
  const d = {
    type, body: '', headerImageUrl: '', headerText: '', headerDocName: '', headerDocUrl: '', footer: '',
    buttons: [], cta: null, flowCta: '', mediaUrl: '', mediaType: '', filename: '',
  };
  if (type === 'text') {
    d.body = payload.text?.body || '';
  } else if (type === 'image') {
    d.mediaType = 'image';
    d.mediaUrl = payload.image?.link || '';
    d.headerImageUrl = payload.image?.link || '';
    d.body = payload.image?.caption || '';
  } else if (type === 'video') {
    d.mediaType = 'video';
    d.mediaUrl = payload.video?.link || '';
    d.body = payload.video?.caption || '';
  } else if (type === 'audio') {
    d.mediaType = 'audio';
    d.mediaUrl = payload.audio?.link || '';
    d.body = '';
  } else if (type === 'document') {
    d.mediaType = 'document';
    d.mediaUrl = payload.document?.link || '';
    d.filename = payload.document?.filename || 'Document';
    d.body = payload.document?.caption || '';
  } else if (type === 'template') {
    d.body = `Template: ${payload.template?.name || ''}`;
  } else if (type === 'interactive') {
    const it = payload.interactive || {};
    d.body = it.body?.text || '';
    d.footer = it.footer?.text || '';
    if (it.header?.type === 'image') d.headerImageUrl = it.header.image?.link || '';
    if (it.header?.type === 'text') d.headerText = it.header.text || '';
    if (it.header?.type === 'video') d.mediaUrl = it.header.video?.link || '';
    if (it.header?.type === 'document') {
      d.headerDocName = it.header.document?.filename || 'Document';
      d.headerDocUrl = it.header.document?.link || '';
    }
    if (it.type === 'button') {
      d.buttons = (it.action?.buttons || []).map((b) => ({ text: b.reply?.title || '', kind: 'reply' })).filter((b) => b.text);
    } else if (it.type === 'cta_url') {
      d.cta = { text: it.action?.parameters?.display_text || 'Open', url: it.action?.parameters?.url || '' };
    } else if (it.type === 'product_list' || it.type === 'product') {
      // Render the catalog card in the CRM as the customer sees it.
      const count = (it.action?.sections || []).reduce((n, s) => n + (s.product_items?.length || 0), 0);
      d.headerText = it.header?.text || '';
      d.buttons = [{ text: count ? `View items (${count})` : 'View item', kind: 'catalog' }];
    } else if (it.type === 'location_request_message') {
      // WhatsApp shows this with a "Send location" button under the text.
      d.buttons = [{ text: 'Send location', kind: 'location' }];
    } else if (it.type === 'order_details') {
      // The "Review and pay" card. The CRM renders it from `raw.payment`
      // (attached in sendOrderDetails, which knows the item photos); this is
      // the plain fallback text.
      d.headerText = '';
      d.buttons = [{ text: 'Review and pay', kind: 'pay' }];
    } else if (it.type === 'flow') {
      // Render a sent Flow as the card the customer sees: body plus the CTA
      // button that opens the form.
      d.flowCta = it.action?.parameters?.flow_cta || 'Open';
      d.buttons = [{ text: d.flowCta, kind: 'flow' }];
    } else if (it.type === 'call_permission_request') {
      // "Allow calls?" (services/calling.js). WhatsApp draws the buttons; the
      // CRM shows the request as the card the customer got.
      d.buttons = [{ text: 'Allow calls', kind: 'call_permission' }];
    }
  } else {
    return null;
  }
  if (!d.body) {
    const mediaLabel = { image: '📷 Photo', video: '🎥 Video', audio: '🎵 Audio', document: '📄 Document' }[d.mediaType];
    d.body = d.cta?.text || d.buttons[0]?.text || d.headerText || mediaLabel || '';
  }
  return d;
}

/**
 * One line for the chat list, in the same shape the list already parses
 * ("📷 Photo", "[document] invoice.pdf", or the text itself).
 */
export function outboundPreview(d) {
  const text = String(d.body || d.headerText || '').replace(/\s+/g, ' ').trim();
  if (d.mediaType === 'image') return `📷 ${text && text !== '📷 Photo' ? text : 'Photo'}`;
  if (d.mediaType === 'video') return `🎥 ${text && text !== '🎥 Video' ? text : 'Video'}`;
  if (d.mediaType === 'audio') return d.voice ? '🎤 Voice message' : '🎵 Audio';
  if (d.mediaType === 'document') return `📄 ${d.filename || 'Document'}`;
  return text || (d.buttons?.[0]?.text ? d.buttons[0].text : 'Message');
}

/** Copy a rendered template onto the chat card descriptor the CRM draws. */
function applyRenderedTemplate(d, t) {
  d.templateName = t.name || '';
  d.body = t.body || d.body;
  d.headerText = t.header?.format === 'text' ? t.header.text || '' : '';
  d.headerImageUrl = t.header?.format === 'image' ? t.header.url || '' : '';
  d.headerVideoUrl = t.header?.format === 'video' ? t.header.url || '' : '';
  if (t.header?.format === 'document') {
    d.headerDocName = t.header.fileName || 'Document.pdf';
    d.headerDocUrl = t.header.url || '';
  }
  d.footer = t.footer || '';
  d.buttons = Array.isArray(t.buttons) ? t.buttons : [];
}

// `extra` is CRM-only rendering data that isn't in Meta's payload (e.g. the
// payment card's item photos) — stored alongside, never sent.
async function logOutbound(payload, resData, businessId = '', extra = null) {
  try {
    const d = describeOutbound(payload);
    if (!d) return;
    const phone = String(payload.to || '').replace(/\D/g, '');
    if (!phone) return;
    // A template: show what the customer actually got (header, filled-in
    // body, buttons) rather than "Template: <name>". `extra.template` is the
    // rendered message, built in sendTemplate.
    if (payload.type === 'template' && extra?.template) applyRenderedTemplate(d, extra.template);
    const metaMessageId = resData?.messages?.[0]?.id;
    // A campaign send is tagged with its campaign, so the campaign's counts
    // come from the statuses Meta reports for these rows.
    const { campaignId, ...rest } = extra || {};
    // The chat list's last message (text, id, a single tick), written before
    // the message row: any receipt that finds the message then also finds the
    // chat to move its ticks. A first message to a new number (a campaign)
    // starts that chat here.
    await recordOutboundPreview(phone, outboundPreview(d), businessId || null, {
      messageId: metaMessageId, status: 'sent', upsert: !!businessId,
    }).catch(() => {});
    const doc = await Message.create({
      phone, direction: 'out', type: d.type, body: d.body,
      raw: { outbound: d, ...rest }, metaMessageId,
      // Tag the owning tenant, same as logInbound, so per-business message
      // counts and future tenant scoping see outbound traffic too.
      ...(businessId ? { businessId } : {}),
      ...(campaignId ? { campaignId: String(campaignId) } : {}),
    });
    // The chat list's last message: this message's own text, written before
    // the CRM hears about it (bot replies used to show the customer's "hi"
    // until a refresh, because the list was only updated afterwards).
    // A "delivered"/"read" receipt can arrive while the create above is still
    // in flight; it was parked by handleStatus, so apply it now.
    const early = takeParked(metaMessageId);
    if (early && isStatusUpgrade(doc.status, early.status)) {
      const set = { status: early.status, ...(early.status === 'failed' && early.error ? { error: early.error } : {}) };
      Object.assign(doc, set);
      await Message.updateOne({ _id: doc._id, status: { $in: statusesBelow(early.status) } }, { $set: set });
      // That receipt never reached the chat list either.
      await recordLastStatus(metaMessageId, early.status, statusesBelow(early.status), businessId || null).catch(() => {});
    }
    emitMessage(doc);
    // A template can use up Meta's daily limit: the sidebar bar follows.
    if (d.type === 'template' && businessId && !rest.sandbox) noteLimitActivity(businessId);
  } catch (err) {
    logger.warn('logOutbound failed', { error: err.message });
  }
}

// Build a client bound to one tenant's credentials.
export function createMetaClient(creds = {}) {
  const C = {
    token: creds.token || '',
    phoneNumberId: creds.phoneNumberId || '',
    wabaId: creds.wabaId || '',
    catalogId: creds.catalogId || '',
    catalogToken: creds.catalogToken || '',
    appId: creds.appId || process.env.WA_APP_ID || '',
    appSecret: creds.appSecret || process.env.WA_APP_SECRET || '',
    graphVersion: creds.graphVersion || process.env.WA_GRAPH_VERSION || 'v22.0',
    // Owning tenant, so free-trial credits can be metered. Every outbound
    // message funnels through post() below, whoever triggered it.
    businessId: creds.businessId || '',
    // Native WhatsApp Pay. `configName` is a payment configuration created in
    // WhatsApp Manager and belongs to this tenant's own WABA, which is why it
    // travels with the credentials rather than sitting in an env var.
    payment: creds.payment || { enabled: false, configName: '', gatewayType: 'razorpay' },
    businessName: creds.businessName || '',
    // The shared "try it" number (services/sandbox.js). It isn't the tenant's
    // own WABA, so anything that belongs to a WABA (templates, Flows, catalog,
    // payments) is refused below instead of being attempted on the sandbox.
    sandbox: !!creds.sandbox,
    // Send without writing a Message row: a sandbox reply to a sender who isn't
    // linked to any business has no tenant to file it under.
    skipLog: !!creds.skipLog,
  };
  const GRAPH = () => `https://graph.facebook.com/${C.graphVersion}`;
  const cfg = () => C;
  const authHeaders = () => ({ Authorization: `Bearer ${C.token}` });
  // Catalog item calls: the token from Catalog → Get started when there is one
  // (services/metaCatalog.js, issued to META_APP_ID, so it carries
  // appsecret_proof), else the WhatsApp token.
  const catalogAuth = (params) => {
    if (!C.catalogToken) return { headers: authHeaders(), ...(params ? { params } : {}) };
    const proof = crypto.createHmac('sha256', String(process.env.META_APP_SECRET || '')).update(C.catalogToken).digest('hex');
    return { headers: { Authorization: `Bearer ${C.catalogToken}` }, params: { ...(params || {}), appsecret_proof: proof } };
  };
  const catalogHeaders = () => ({ Authorization: `Bearer ${C.catalogToken || C.token}` });
  const base = () => `${GRAPH()}/${C.phoneNumberId}`;

  async function post(payload, logExtra = null) {
    // A plan with a contact limit (Free) can only message its first N
    // contacts, whoever sends: an agent, a journey, a campaign. The shared
    // test number keeps its own contact limit (services/sandbox.js).
    if (C.businessId && !C.sandbox && payload?.to) {
      const p = await planOf(C.businessId);
      if (p?.state?.limits?.contacts) await assertContact(C.businessId, payload.to, p.state);
    }
    // Spend the credit first so concurrent sends can't both take the last one;
    // hand it back if Meta rejects the message.
    const credit = await reserveCredit(C.businessId);
    let res;
    try {
      res = await api.post(`${base()}/messages`, payload, { headers: authHeaders() });
    } catch (err) {
      if (credit.spent) await refundCredit(C.businessId);
      // 131070: another Meta app on this number holds the chat. Remembered on
      // the business (Channel Status explains it; one notification).
      if (err.response?.data?.error?.code === 131070 && C.businessId && !C.sandbox) {
        import('./otherApps.js')
          .then((m) => m.recordThreadControl(C.businessId, { phone: payload?.to, via: 'send' }))
          .catch(() => {});
      }
      throw err;
    }
    if (credit.spent && credit.remaining <= 2) {
      logger.warn('free trial credits running low', {
        businessId: C.businessId,
        used: credit.used,
        limit: credit.limit,
        remaining: credit.remaining,
      });
    }
    // Sandbox sends are marked, so the shared number's receipts can only ever
    // update messages it sent itself.
    if (!C.skipLog) {
      const logged = logOutbound(payload, res?.data, C.businessId, C.sandbox ? { ...(logExtra || {}), sandbox: true } : logExtra);
      // A campaign send waits for its Message row: the campaign's counts and
      // its "already sent?" check on a resumed run both read it.
      if (logExtra?.campaignId) await logged;
    }
    return res;
  }

  const client = {
    creds: C,

    /**
     * `reply` (optional): { contextId, replyTo } — send as a reply to the
     * message with Meta id `contextId` (WhatsApp shows the quote), and keep
     * `replyTo` with the logged message for the CRM's quote.
     */
    async sendText(phone, body, reply = null) {
      try {
        const payload = { messaging_product: 'whatsapp', to: clean(phone), type: 'text', text: { body } };
        if (reply?.contextId) payload.context = { message_id: reply.contextId };
        const { data } = await post(payload, reply?.replyTo ? { replyTo: reply.replyTo } : null);
        return data;
      } catch (err) {
        logger.error('sendText error', { error: err.response?.data?.error?.message || err.message });
        throw err;
      }
    },

    async sendImage(phone, imageUrl, caption = '') {
      try {
        const { data } = await post({ messaging_product: 'whatsapp', to: clean(phone), type: 'image', image: { link: originalUrl(imageUrl), caption } });
        return data;
      } catch (err) {
        logger.error('sendImage error', { error: err.response?.data?.error?.message || err.message });
        return this.sendText(phone, caption);
      }
    },

    async sendVideo(phone, videoUrl, caption = '') {
      const { data } = await post({ messaging_product: 'whatsapp', to: clean(phone), type: 'video', video: { link: videoUrl, caption } });
      return data;
    },

    async sendAudio(phone, audioUrl) {
      const { data } = await post({ messaging_product: 'whatsapp', to: clean(phone), type: 'audio', audio: { link: audioUrl } });
      return data;
    },

    async sendDocument(phone, documentUrl, filename, caption = '') {
      const { data } = await post({ messaging_product: 'whatsapp', to: clean(phone), type: 'document', document: { link: documentUrl, filename, ...(caption ? { caption } : {}) } });
      return data;
    },

    async sendReaction(phone, messageId, emoji) {
      const { data } = await post({ messaging_product: 'whatsapp', to: clean(phone), type: 'reaction', reaction: { message_id: messageId, emoji: emoji || '' } });
      return data;
    },

    // ---------- Interactive messages (used by the journey runtime) ----------
    // header: { type:'image'|'video'|'document', link } | { type:'text', text } | null
    // `logExtra`: CRM-only data kept with the logged message (a poll, an event).
    async sendButtons(phone, { body, header = null, footer = '', buttons = [] }, logExtra = null) {
      // WhatsApp refuses buttons with the same title (#131009 "Duplicate
      // button title"), so the whole message would go nowhere: a repeated
      // title gets a number ("click", "click 2").
      const seen = new Map();
      const titled = buttons.slice(0, 3).map((b) => {
        let title = String(b.title || '').trim().slice(0, 20) || 'Button';
        const key = title.toLowerCase();
        const n = (seen.get(key) || 0) + 1;
        seen.set(key, n);
        if (n > 1) {
          const suffix = ` ${n}`;
          title = `${title.slice(0, 20 - suffix.length).trimEnd()}${suffix}`;
          seen.set(title.toLowerCase(), 1);
        }
        return { type: 'reply', reply: { id: b.id, title } };
      });
      const interactive = {
        type: 'button',
        body: { text: body || ' ' },
        action: { buttons: titled },
      };
      if (header) interactive.header = headerJson(header);
      if (footer) interactive.footer = { text: footer.slice(0, 60) };
      const { data } = await post({ messaging_product: 'whatsapp', to: clean(phone), type: 'interactive', interactive }, logExtra);
      return data;
    },

    async sendCtaUrl(phone, { body, displayText, url, header = null, footer = '' }, logExtra = null) {
      const interactive = {
        type: 'cta_url',
        body: { text: body || ' ' },
        action: { name: 'cta_url', parameters: { display_text: (displayText || 'Open').slice(0, 20), url } },
      };
      if (header) interactive.header = headerJson(header);
      if (footer) interactive.footer = { text: footer.slice(0, 60) };
      const { data } = await post({ messaging_product: 'whatsapp', to: clean(phone), type: 'interactive', interactive }, logExtra);
      return data;
    },

    async sendList(phone, { body, buttonText = 'Menu', header = '', footer = '', rows = [] }, logExtra = null) {
      const interactive = {
        type: 'list',
        body: { text: body || ' ' },
        action: {
          button: (buttonText || 'Menu').slice(0, 20),
          sections: [{ title: (header || 'Options').slice(0, 24), rows: rows.slice(0, 10).map((r) => ({ id: r.id, title: (r.title || 'Item').slice(0, 24), ...(r.description ? { description: r.description.slice(0, 72) } : {}) })) }],
        },
      };
      if (footer) interactive.footer = { text: footer.slice(0, 60) };
      const { data } = await post({ messaging_product: 'whatsapp', to: clean(phone), type: 'interactive', interactive }, logExtra);
      return data;
    },

    /**
     * Meta's interactive media carousel (no template, inside the 24-hour
     * window): the body text, then 2 to 10 cards side by side. Each card has
     * an image or video, optional text (160 characters), and either one link
     * button ({ url, urlText }) or the same number of quick replies
     * ([{ id, title }]) as every other card.
     */
    async sendCarousel(phone, { body, cards = [] }, logExtra = null) {
      const interactive = {
        type: 'carousel',
        body: { text: String(body || ' ').slice(0, 1024) },
        action: {
          cards: cards.slice(0, 10).map((c, i) => {
            const kind = c.mediaType === 'video' ? 'video' : 'image';
            return {
              card_index: i,
              // Meta's examples use "cta_url" for both kinds of card.
              type: 'cta_url',
              header: { type: kind, [kind]: { link: kind === 'image' ? originalUrl(c.mediaUrl) : c.mediaUrl } },
              ...(c.body ? { body: { text: String(c.body).slice(0, 160) } } : {}),
              action: c.url
                ? { name: 'cta_url', parameters: { display_text: String(c.urlText || 'Open').slice(0, 20), url: c.url } }
                : { buttons: (c.buttons || []).map((b) => ({ type: 'quick_reply', quick_reply: { id: b.id, title: String(b.title || 'Choose').slice(0, 20) } })) },
            };
          }),
        },
      };
      const { data } = await post({ messaging_product: 'whatsapp', to: clean(phone), type: 'interactive', interactive }, logExtra);
      return data;
    },

    async sendLocationRequest(phone, body) {
      const { data } = await post({
        messaging_product: 'whatsapp',
        to: clean(phone),
        type: 'interactive',
        interactive: { type: 'location_request_message', body: { text: body || 'Please share your location.' }, action: { name: 'send_location' } },
      });
      return data;
    },

    // Native WhatsApp Flow message (opens the flow sheet).
    async sendFlowMessage(phone, { flowId, flowCta, screen, flowToken = 'unused', body = ' ', header = null, footer = '', mode = 'published', flowAction = 'navigate', data: screenData = {} }) {
      const params = { flow_message_version: '3', flow_token: flowToken, flow_id: flowId, flow_cta: flowCta || 'Open', mode, flow_action: flowAction };
      if (flowAction === 'navigate') {
        // Meta rejects an empty `data` ("must be of type dynamic_object"), so
        // only include it when the target screen actually needs data.
        const payload = { screen: screen || 'WELCOME' };
        if (screenData && Object.keys(screenData).length > 0) payload.data = screenData;
        params.flow_action_payload = payload;
      }
      const interactive = { type: 'flow', body: { text: body || ' ' }, action: { name: 'flow', parameters: params } };
      if (header) interactive.header = headerJson(header);
      if (footer) interactive.footer = { text: footer.slice(0, 60) };
      const { data } = await post({ messaging_product: 'whatsapp', to: clean(phone), type: 'interactive', interactive });
      return data;
    },

    // ---------- Native catalog messages ----------
    // Browsable multi-product card. `sections` is
    // [{ title, productRetailerIds: [...] }] — the retailer ids must already
    // exist in the catalog, which is what services/catalog.js syncs.
    async sendProductList(phone, { catalogId, header, body = ' ', footer = '', sections = [] } = {}) {
      const cid = catalogId || C.catalogId;
      if (!cid) throw new Error('Catalog ID not configured for this business');
      const interactive = {
        type: 'product_list',
        header: { type: 'text', text: String(header || 'Products').slice(0, 60) },
        body: { text: String(body || ' ').slice(0, 1024) },
        ...(footer ? { footer: { text: String(footer).slice(0, 60) } } : {}),
        action: {
          catalog_id: cid,
          sections: sections.map((s) => ({
            title: String(s.title || 'Products').slice(0, 24),
            product_items: (s.productRetailerIds || []).slice(0, 30).map((id) => ({ product_retailer_id: id })),
          })),
        },
      };
      const { data } = await post({ messaging_product: 'whatsapp', to: clean(phone), type: 'interactive', interactive });
      return data;
    },

    /** Single product card. */
    async sendProduct(phone, { catalogId, retailerId, body = '', footer = '' } = {}) {
      const cid = catalogId || C.catalogId;
      if (!cid) throw new Error('Catalog ID not configured for this business');
      const interactive = {
        type: 'product',
        ...(body ? { body: { text: String(body).slice(0, 1024) } } : {}),
        ...(footer ? { footer: { text: String(footer).slice(0, 60) } } : {}),
        action: { catalog_id: cid, product_retailer_id: retailerId },
      };
      const { data } = await post({ messaging_product: 'whatsapp', to: clean(phone), type: 'interactive', interactive });
      return data;
    },

    // ---------- Native WhatsApp Pay ----------
    /** Is native payment usable for this tenant? */
    paymentReady() {
      return !!(C.payment?.enabled && C.payment?.configName);
    },

    /**
     * The "Review and pay" card — Meta's `order_details` interactive message.
     *
     * This is a real payment request, not a mock: the customer reviews the
     * items and pays by UPI inside WhatsApp, and Meta reports the outcome on
     * the status webhook as a `payment` object keyed by `reference_id`.
     *
     * Two details that are easy to get wrong and fail silently:
     *   • money is in the smallest unit with an explicit offset, so ₹189.50 is
     *     { value: 18950, offset: 100 } — sending rupees shows ₹1.89;
     *   • a Razorpay configuration additionally requires the nested
     *     `razorpay: { receipt, notes }` block. Our reference id goes into the
     *     notes so the gateway's own webhook can identify the order too.
     *
     * Items carry `retailer_id` when they came from the catalog. For anything
     * not in a catalog (an appointment, a service) Meta requires the importer
     * and origin fields instead, so those are supplied rather than omitted.
     */
    async sendOrderDetails(phone, referenceId, items = [], totalAmount = 0, opts = {}) {
      const { tax = 0, shipping = 0, discount = 0, headerImageUrl = null, body, footer } = opts;
      if (!C.payment?.configName) throw new Error('No WhatsApp payment configuration is set for this business');

      const toMinor = (r) => Math.round(Number(r || 0) * 100);
      const money = (r) => ({ value: toMinor(r), offset: 100 });

      // Catalog-backed orders point each line at a catalog entry and declare
      // physical goods. Anything else we charge for here is a service — a
      // consultation, a booking — and goes out as digital goods.
      //
      // The docs say the importer / country-of-origin fields are required
      // whenever catalog_id is absent. In practice that holds for physical
      // goods only: a working appointment-fee integration against this same
      // kind of Razorpay configuration sends a bare digital-goods line with no
      // catalog and no customs fields at all, and settles payments fine.
      // Customs data on a doctor's consultation is meaningless anyway.
      const P = C.payment || {};
      const catalogBacked = !!C.catalogId && items.length > 0 && items.every((i) => i.retailerId);
      const goodsType = catalogBacked ? 'physical-goods' : 'digital-goods';

      // Customs disclosure, for physical goods sold without a catalog. Only
      // built when the data is actually there — a service never needs it, so
      // a missing address must not block a consultation fee.
      const haveSeller = !!(P.addressLine1 && P.city && P.zoneCode && P.postalCode);
      const seller = haveSeller
        ? {
          country_of_origin: P.countryOfOrigin || 'India',
          importer_name: String(P.merchantName || C.businessName || 'Business').slice(0, 200),
          importer_address: {
            address_line1: String(P.addressLine1).slice(0, 100),
            ...(P.addressLine2 ? { address_line2: String(P.addressLine2).slice(0, 100) } : {}),
            city: String(P.city),
            zone_code: String(P.zoneCode).toUpperCase().slice(0, 3),
            postal_code: String(P.postalCode),
            country_code: String(P.countryCode || 'IN').toUpperCase().slice(0, 2),
          },
        }
        : null;

      // Every line carries a retailer_id. For a catalog item that's the real
      // content id; for a service it's a stable id derived from the name,
      // which is what the working appointment-fee integrations do.
      const slug = (s) => String(s || 'item').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'item';

      const orderItems = items.map((i, idx) => {
        const line = {
          retailer_id: String(i.retailerId || `svc-${slug(i.name)}-${idx + 1}`),
          name: String(i.name || 'Item').slice(0, 60),
          amount: money(i.price),
          quantity: Math.max(1, Number(i.quantity) || 1),
        };
        if (!catalogBacked && goodsType === 'physical-goods' && seller) Object.assign(line, seller);
        return line;
      });

      const subtotal = items.reduce((s, i) => s + Number(i.price || 0) * (Number(i.quantity) || 1), 0);
      const order = {
        status: 'pending',
        items: orderItems,
        subtotal: money(subtotal),
        // Every money object Meta documents takes a *positive* integer value.
        // A zero tax / shipping / discount block therefore isn't "₹0", it's
        // out of spec — and the two integrations that settle payments against
        // this kind of configuration omit all three. They're also just noise
        // on the customer's receipt.
        ...(Number(tax) > 0 ? { tax: { ...money(tax), description: 'Tax' } } : {}),
        ...(Number(shipping) > 0 ? { shipping: { ...money(shipping), description: 'Delivery' } } : {}),
        ...(Number(discount) > 0 ? { discount: { ...money(discount), description: 'Discount' } } : {}),
      };
      if (catalogBacked) order.catalog_id = C.catalogId;
      // Expiry is optional and off unless asked for. Meta's minimum is 300s.
      if (Number(opts.expiresInMinutes) > 0) {
        const mins = Math.max(5, Number(opts.expiresInMinutes));
        order.expiration = {
          timestamp: String(Math.floor(Date.now() / 1000) + mins * 60),
          description: `This payment request expires in ${mins} minutes`,
        };
      }

      const gatewayType = C.payment.gatewayType || 'razorpay';
      const paymentGateway = { type: gatewayType, configuration_name: C.payment.configName };
      if (gatewayType === 'razorpay') {
        paymentGateway.razorpay = {
          // Razorpay caps the receipt at 40 characters.
          receipt: String(referenceId).slice(-40),
          notes: { reference_id: String(referenceId) },
        };
      }

      // A header is always sent. Meta's documented fallback when one is absent
      // is "an image of the first available product" — with no catalog there is
      // no product to fall back to, so a text header carrying the business
      // name is given instead. The working reference does the same.
      const header = headerImageUrl
        ? { type: 'image', image: { link: originalUrl(headerImageUrl) } }
        : { type: 'text', text: String(C.businessName || 'Payment').slice(0, 60) };

      const interactive = {
        type: 'order_details',
        header,
        body: { text: body || `🧾 *Order ${referenceId}*\nReview your items and pay securely.` },
        footer: { text: footer || 'Powered by WhatsApp Pay' },
        action: {
          name: 'review_and_pay',
          parameters: {
            reference_id: String(referenceId),
            type: goodsType,
            payment_settings: [{ type: 'payment_gateway', payment_gateway: paymentGateway }],
            currency: 'INR',
            total_amount: money(totalAmount),
            order,
          },
        },
      };
      // What the CRM draws: the same two-part card the customer sees (order
      // summary with photos + the WhatsApp Pay block). Photos aren't part of
      // Meta's payload, so they ride along here from the order's own lines.
      const crmPayment = {
        payment: {
          orderId: String(referenceId),
          items: items.map((i) => ({
            name: String(i.name || 'Item'),
            qty: Math.max(1, Number(i.quantity) || 1),
            price: Number(i.price) || 0,
            image: i.image || '',
          })),
          total: Number(totalAmount) || 0,
          currency: 'INR',
          body: body || 'Review your items and pay securely via UPI.',
          footer: footer || 'Powered by WhatsApp Pay',
          status: 'pending',
        },
      };
      const { data } = await post({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: clean(phone),
        type: 'interactive',
        interactive,
      }, crmPayment);
      return data;
    },

    /**
     * Tell the customer (and Meta) how the payment ended.
     *
     * Meta keeps its own order state per reference_id and shows it on the
     * original card, so this is what turns "Review and pay" into "Paid".
     * Status is one of pending / processing / partially_shipped / shipped /
     * completed / canceled.
     */
    async sendOrderStatusUpdate(phone, referenceId, status = 'completed', description = '') {
      const interactive = {
        type: 'order_status',
        body: { text: description || (status === 'completed' ? '✅ Payment received.' : `Order ${status}`) },
        action: {
          name: 'review_order',
          parameters: {
            reference_id: String(referenceId),
            order: { status, description: description || `Order ${status}` },
          },
        },
      };
      const { data } = await post({
        messaging_product: 'whatsapp', to: clean(phone), type: 'interactive', interactive,
      });
      return data;
    },

    async markRead(messageId) {
      try {
        await api.post(`${base()}/messages`, { messaging_product: 'whatsapp', status: 'read', message_id: messageId }, { headers: authHeaders() });
      } catch (err) {
        logger.debug('markRead failed', { error: err.message });
      }
    },

    async downloadMedia(mediaId) {
      const meta = await axios.get(`${GRAPH()}/${mediaId}`, { headers: authHeaders() });
      const mediaUrl = meta.data?.url;
      const mime = meta.data?.mime_type || 'application/octet-stream';
      const file = await axios.get(mediaUrl, { headers: authHeaders(), responseType: 'arraybuffer' });
      return { buffer: Buffer.from(file.data), mime };
    },

    // ---------- Templates (WABA-level) ----------
    async listTemplates() {
      const { data } = await api.get(`${GRAPH()}/${cfg().wabaId}/message_templates`, {
        headers: authHeaders(),
        // rejected_reason isn't in the default field set; without it a
        // rejection reaches the CRM with no explanation.
        params: { limit: 200, fields: 'id,name,status,category,language,components,parameter_format,rejected_reason,quality_score' },
      });
      return data?.data || [];
    },
    async createTemplate(payload) {
      const { data } = await api.post(`${GRAPH()}/${cfg().wabaId}/message_templates`, payload, { headers: authHeaders() });
      return data;
    },
    async deleteTemplate(name) {
      const { data } = await api.delete(`${GRAPH()}/${cfg().wabaId}/message_templates`, { headers: authHeaders(), params: { name } });
      return data;
    },

    /**
     * Meta's Resumable Upload API: open an upload session on the app (app
     * access token = appId|appSecret), send the bytes with the business token,
     * and get back the file handle (`h`) that template headers and the
     * profile photo refer to. `timeout` (ms) applies to each of the two calls;
     * `what` names the file in the no-handle error.
     */
    async resumableUpload(buffer, mime, fileName = 'file', { timeout, what = 'file' } = {}) {
      const appId = C.appId;
      const appSecret = C.appSecret;
      if (!appId || !appSecret) throw new Error('App ID / App Secret not configured for upload');
      const appAccessToken = `${appId}|${appSecret}`;
      const createResp = await axios.post(`${GRAPH()}/${appId}/uploads`, null, {
        params: { file_name: fileName, file_length: buffer.length, file_type: mime, access_token: appAccessToken },
        ...(timeout ? { timeout } : {}),
      });
      const sessionId = createResp.data.id;
      const uploadResp = await axios.post(`${GRAPH()}/${sessionId}`, buffer, {
        headers: { Authorization: `OAuth ${C.token}`, file_offset: '0', 'Content-Type': mime },
        maxBodyLength: Infinity, maxContentLength: Infinity,
        ...(timeout ? { timeout } : {}),
      });
      const handle = uploadResp.data?.h;
      if (!handle) throw new Error(`No ${what} handle returned from Meta upload`);
      return handle;
    },

    async uploadHeaderSample({ fileUrl, fileName = 'header', fileType = 'image/jpeg' }) {
      if (!C.appId || !C.appSecret) throw new Error('App ID / App Secret not configured for header upload');
      const fileResp = await axios.get(fileUrl, { responseType: 'arraybuffer' });
      const buffer = Buffer.from(fileResp.data);
      const mime = (fileResp.headers['content-type'] || fileType).split(';')[0].trim().toLowerCase();
      return client.resumableUpload(buffer, mime, fileName, { what: 'header' });
    },

    // ---------- WhatsApp business profile (phone-number level) ----------
    /** The number's profile as Meta has it: about, address, description, email, websites, vertical, photo URL. */
    async getBusinessProfile() {
      const { data } = await api.get(`${base()}/whatsapp_business_profile`, {
        headers: authHeaders(),
        params: { fields: 'about,address,description,email,profile_picture_url,websites,vertical' },
        timeout: 15000,
      });
      return data?.data?.[0] || {};
    },

    /** Update profile fields. Only the keys given are sent. */
    async updateBusinessProfile(fields = {}) {
      const { data } = await api.post(`${base()}/whatsapp_business_profile`, { messaging_product: 'whatsapp', ...fields }, {
        headers: authHeaders(),
        timeout: 20000,
      });
      return data;
    },

    /** Set the profile photo from a Resumable Upload handle. */
    async setProfilePicture(handle) {
      return client.updateBusinessProfile({ profile_picture_handle: handle });
    },

    // ---------- Calling (services/calling.js) ----------
    /** The number's calling settings as Meta has them (the `calling` object). */
    async getCallSettings() {
      const { data } = await api.get(`${base()}/settings`, { headers: authHeaders(), timeout: 15000 });
      return data?.calling || {};
    },

    /** Change calling settings. Only the keys given are changed (call_hours as a whole). */
    async updateCallSettings(calling = {}) {
      const { data } = await api.post(`${base()}/settings`, { calling }, { headers: authHeaders(), timeout: 20000 });
      return data;
    },

    /** One call action (connect, pre_accept, accept, reject, terminate). Not a message: no credit, no log. */
    async callAction(body = {}) {
      const { data } = await api.post(`${base()}/calls`, { messaging_product: 'whatsapp', ...body }, { headers: authHeaders(), timeout: 20000 });
      return data;
    },

    /**
     * Block Users API: they can't message or call the number, and it can't
     * message them. Only for users who wrote in the last 24 hours. Not a
     * message: no credit, no log. Throws on any failed user.
     */
    async blockUsers(phones = []) {
      const { data } = await api.post(`${base()}/block_users`, {
        messaging_product: 'whatsapp',
        block_users: phones.map((p) => ({ user: `+${clean(p)}` })),
      }, { headers: authHeaders(), timeout: 20000 });
      if (data?.block_users?.failed_users?.length) throw Object.assign(new Error('Failed to block'), { response: { data } });
      return data;
    },

    async unblockUsers(phones = []) {
      const { data } = await api.delete(`${base()}/block_users`, {
        headers: authHeaders(),
        timeout: 20000,
        data: { messaging_product: 'whatsapp', block_users: phones.map((p) => ({ user: `+${clean(p)}` })) },
      });
      if (data?.block_users?.failed_users?.length) throw Object.assign(new Error('Failed to unblock'), { response: { data } });
      return data;
    },

    /** Whether this customer has let the business call them, and what can be done now. */
    async getCallPermission(phone) {
      const { data } = await api.get(`${base()}/call_permissions`, {
        headers: authHeaders(),
        params: { user_wa_id: clean(phone) },
        timeout: 15000,
      });
      return data || {};
    },

    /** Ask the customer for permission to call them (inside the 24-hour window). */
    async sendCallPermissionRequest(phone, body = '') {
      const interactive = { type: 'call_permission_request', action: { name: 'call_permission_request' } };
      const text = String(body || '').trim();
      if (text) interactive.body = { text: text.slice(0, 1024) };
      const { data } = await post({
        messaging_product: 'whatsapp', recipient_type: 'individual', to: clean(phone), type: 'interactive', interactive,
      });
      return data;
    },

    /**
     * Send an approved template.
     *
     * @param {object} opts
     * @param {string}   [opts.headerImageUrl] header media to send (any format, despite the name)
     * @param {string}   [opts.headerFormat]   'image' | 'video' | 'document' (default image)
     * @param {string}   [opts.headerFileName] filename shown on a document header
     * @param {string[]} [opts.bodyParams]     values for the body's {{n}}, in order
     * @param {object[]} [opts.cards]          carousel cards: [{ mediaUrl, mediaFormat }]
     * @param {object}   [opts.lto]            limited-time offer: { expiresAtMs, code }
     * @param {string}   [opts.campaignId]     campaign this send belongs to (stored on the Message, never sent)
     * @param {string}   [opts.otpCode]        authentication templates: the code, sent again as button 0's value
     */
    async sendTemplate(phone, templateName, {
      languageCode = 'en_US', headerImageUrl = null, headerFormat = 'image', headerFileName = '',
      bodyParams = [], cards = null, lto = null, campaignId = null, otpCode = null,
      // How the chat shows it, when the caller already knows (a shared test
      // number template has no row of the tenant's own to render from).
      rendered: preRendered = null,
      // Drip campaigns: which follow-up this is (1, 2, …), kept on the Message
      // so the main send's counts and each follow-up's are told apart.
      dripStep = null,
      // What a quick-reply button sends back when tapped: [{ index, payload }]
      // (index = the button's position in the template). A journey uses it
      // to know which block and button the tap belongs to.
      quickReplies = null,
      // A template's flow button: { index, token, data? }. The token ties the
      // answers back to this customer and flow; data prefills the first screen.
      flowButton = null,
    } = {}) {
      const components = [];
      if (headerImageUrl) {
        const fmt = ['image', 'video', 'document'].includes(String(headerFormat).toLowerCase())
          ? String(headerFormat).toLowerCase()
          : 'image';
        const media = { link: originalUrl(headerImageUrl) };
        if (fmt === 'document' && headerFileName) media.filename = headerFileName;
        components.push({ type: 'header', parameters: [{ type: fmt, [fmt]: media }] });
      }
      if (bodyParams.length) components.push({ type: 'body', parameters: bodyParams.map((t) => ({ type: 'text', text: String(t) })) });
      // Authentication template: Meta wants the code twice, in the body (above)
      // and on the OTP button, which it created as URL button 0.
      if (otpCode) {
        components.push({
          type: 'button', sub_type: 'url', index: '0',
          parameters: [{ type: 'text', text: String(otpCode) }],
        });
      }
      // Limited-time offer: the countdown's end and the code to copy are
      // supplied per send, not stored on the template at Meta.
      if (lto?.expiresAtMs) {
        components.push({
          type: 'limited_time_offer',
          parameters: [{ type: 'limited_time_offer', limited_time_offer: { expiration_time_ms: Number(lto.expiresAtMs) } }],
        });
      }
      if (lto?.code) {
        components.push({
          type: 'button', sub_type: 'copy_code', index: 0,
          parameters: [{ type: 'coupon_code', coupon_code: String(lto.code).slice(0, 15) }],
        });
      }
      if (Array.isArray(quickReplies)) {
        for (const q of quickReplies) {
          const payload = String(q?.payload || '').slice(0, 256);
          if (!payload || !Number.isInteger(Number(q?.index))) continue;
          components.push({
            type: 'button', sub_type: 'quick_reply', index: String(Number(q.index)),
            parameters: [{ type: 'payload', payload }],
          });
        }
      }
      if (flowButton?.token && Number.isInteger(Number(flowButton.index))) {
        const action = { flow_token: String(flowButton.token) };
        if (flowButton.data && Object.keys(flowButton.data).length) action.flow_action_data = flowButton.data;
        components.push({
          type: 'button', sub_type: 'flow', index: String(Number(flowButton.index)),
          parameters: [{ type: 'action', action }],
        });
      }
      // Carousel: every card's header media has to be sent again, in order.
      if (Array.isArray(cards) && cards.length) {
        components.push({
          type: 'carousel',
          cards: cards.map((c, i) => {
            const fmt = c.mediaFormat === 'video' ? 'video' : 'image';
            return {
              card_index: i,
              components: [{ type: 'header', parameters: [{ type: fmt, [fmt]: { link: originalUrl(c.mediaUrl) } }] }],
            };
          }),
        });
      }
      // How the message looks, for the CRM chat. Built from our stored copy of
      // the template plus the values going out now; never sent to Meta.
      let rendered = preRendered;
      if (!rendered) {
        try {
          const stored = await Template.findOne({
            ...(C.businessId ? { businessId: C.businessId } : {}), name: templateName,
          }).lean();
          rendered = stored ? renderTemplate(stored, { bodyParams, lto }) : null;
          if (rendered?.header && headerImageUrl) rendered.header.url = headerImageUrl;
        } catch (err) {
          logger.debug('template render for chat failed', { error: err.message });
        }
      }
      const { data } = await post(
        {
          messaging_product: 'whatsapp', to: clean(phone), type: 'template',
          template: { name: templateName, language: { code: languageCode }, ...(components.length ? { components } : {}) },
        },
        rendered || campaignId
          ? {
            ...(rendered ? { template: rendered } : {}),
            ...(campaignId ? { campaignId: String(campaignId) } : {}),
            ...(campaignId && dripStep ? { dripStep: Number(dripStep) } : {}),
          }
          : null,
      );
      return data;
    },

    // ---------- Commerce catalog ----------
    // Upsert catalog items via items_batch. This uses Meta's product-feed field
    // schema (title / image_link / "amount CURRENCY" price), not the older
    // /products edge naming — with the wrong names the call succeeds but the
    // items are created empty or rejected.
    //
    // `link` and `brand` are required for an item to pass review, so both get a
    // sensible fallback rather than being omitted.
    async batchUpsertCatalogProducts(catalogId, items) {
      const cid = catalogId || C.catalogId;
      if (!cid) throw new Error('Catalog ID not configured for this business');
      const money = (n, currency) => `${Number(n || 0).toFixed(2)} ${currency}`;

      const requests = items.map((it) => {
        const currency = it.currency || 'INR';
        const data = {
          id: it.retailerId,
          title: it.name,
          description: it.description || it.name,
          availability: it.availability || 'in stock',
          condition: 'new',
          price: money(it.price, currency),
          link: it.url || `https://wa.me/${C.phoneNumberId}`,
          brand: it.brand || 'Store',
          // Variants of one product share this, so Meta folds them into a
          // single product entry.
          item_group_id: it.groupId || it.retailerId,
          // Blank clears any previous strikethrough price.
          sale_price: it.salePrice && it.salePrice < it.price ? money(it.salePrice, currency) : '',
        };
        // The attribute Meta labels the variant picker with (e.g. "500 g").
        if (it.size) data.size = String(it.size);
        // The second axis — the business's own sub-variant wording ("flavour",
        // "spice level"…). It always travels in `color`, and the other two
        // variant fields are explicitly blanked.
        //
        // Picking between color/material/pattern based on the wording bought
        // nothing (Meta labels and localises the picker itself) while
        // guaranteeing a broken picker: an item upserted under one field keeps
        // the attribute from the other, so the product group ends up
        // advertising two axes and WhatsApp greys out sizes it can't resolve.
        data.color = it.subValue ? String(it.subValue) : '';
        data.material = '';
        data.pattern = '';
        if (it.category) data.google_product_category = String(it.category);
        if (it.imageUrl) data.image_link = it.imageUrl;
        if (it.additionalImages?.length) {
          data.additional_image_link = it.additionalImages.slice(0, 10).join(',');
        }
        return { method: 'CREATE', data };
      });

      const { data } = await api.post(
        `${GRAPH()}/${cid}/items_batch`,
        { item_type: 'PRODUCT_ITEM', requests },
        catalogAuth(),
      );
      return data;
    },

    /** Read items back from the catalog — used to confirm a push landed. */
    async getCatalogProducts(catalogId, limit = 50) {
      const cid = catalogId || C.catalogId;
      if (!cid) throw new Error('Catalog ID not configured for this business');
      const { data } = await api.get(`${GRAPH()}/${cid}/products`, catalogAuth({
        fields: 'id,retailer_id,name,price,availability,image_url,item_group_id,visibility,review_status,url,brand',
        limit,
      }));
      return data?.data || [];
    },

    /**
     * Every retailer_id on the catalog.
     *
     * Needed because a product's items can't be tracked by memory alone: an
     * id minted under an older naming scheme is no longer in `catalogItemIds`,
     * so it becomes an orphan nobody can clean up — and an orphan still
     * carrying an old variant attribute keeps that axis alive on the product
     * group, which breaks the size/colour picker in WhatsApp. Reading the
     * catalog back makes cleanup self-healing.
     */
    async listCatalogRetailerIds(catalogId, { maxPages = 20 } = {}) {
      const cid = catalogId || C.catalogId;
      if (!cid) throw new Error('Catalog ID not configured for this business');
      const ids = [];
      let url = `${GRAPH()}/${cid}/products`;
      let params = { fields: 'retailer_id', limit: 500 };
      for (let page = 0; page < maxPages && url; page += 1) {
        // eslint-disable-next-line no-await-in-loop
        // The `next` link already carries the query (and appsecret_proof).
        const { data } = await api.get(url, params ? catalogAuth(params) : { headers: catalogHeaders() });
        for (const row of data?.data || []) if (row.retailer_id) ids.push(row.retailer_id);
        url = data?.paging?.next || null;
        params = undefined; // the `next` link already carries them
      }
      return ids;
    },

    /**
     * Remove items from the catalog.
     *
     * The retailer id goes in `data.id`, the same feed schema the CREATE path
     * uses. A top-level `retailer_id` (the older /batch naming) is accepted,
     * returns a handle, and deletes nothing — so every "cleanup" silently
     * succeeded while the items stayed, which is how orphaned variants built up
     * and broke the size picker.
     */
    async deleteCatalogProducts(catalogId, retailerIds) {
      const cid = catalogId || C.catalogId;
      if (!cid || !retailerIds?.length) return null;
      const requests = retailerIds.map((rid) => ({ method: 'DELETE', data: { id: String(rid) } }));
      const { data } = await api.post(`${GRAPH()}/${cid}/items_batch`, { item_type: 'PRODUCT_ITEM', requests }, catalogAuth());
      return data;
    },

    // ---------- Flow management (WABA-level) ----------
    async createFlow(name, categories = ['OTHER'], { endpointUri = null } = {}) {
      const body = { name, categories };
      if (endpointUri) body.endpoint_uri = endpointUri;
      const { data } = await api.post(`${GRAPH()}/${cfg().wabaId}/flows`, body, { headers: authHeaders() });
      return data;
    },
    async updateFlowJSON(flowId, flowJsonObj) {
      const form = new FormData();
      form.append('file', Buffer.from(JSON.stringify(flowJsonObj)), { filename: 'flow.json', contentType: 'application/json' });
      form.append('name', 'flow.json');
      form.append('asset_type', 'FLOW_JSON');
      const { data } = await api.post(`${GRAPH()}/${flowId}/assets`, form, {
        headers: { ...authHeaders(), ...form.getHeaders() },
        maxContentLength: 20 * 1024 * 1024,
        maxBodyLength: 20 * 1024 * 1024,
      });
      return data;
    },
    async publishFlow(flowId) {
      const { data } = await api.post(`${GRAPH()}/${flowId}/publish`, {}, { headers: authHeaders() });
      return data;
    },
    async getFlows() {
      const { data } = await api.get(`${GRAPH()}/${cfg().wabaId}/flows?fields=id,name,status,categories&limit=100`, { headers: authHeaders() });
      return data?.data || [];
    },
    async updateFlowEndpoint(flowId, endpointUri) {
      const { data } = await api.post(`${GRAPH()}/${flowId}`, { endpoint_uri: endpointUri }, { headers: authHeaders() });
      return data;
    },
    // ---------- Flows data-endpoint encryption ----------
    // Meta encrypts every request to a flow's data endpoint with this public
    // key. Without it registered, publishing an endpoint-mode flow fails: Meta
    // health-checks the endpoint and we can't decrypt the probe.
    async setBusinessEncryptionKey(publicKeyPem) {
      const form = new URLSearchParams({ business_public_key: publicKeyPem });
      const { data } = await api.post(`${base()}/whatsapp_business_encryption`, form.toString(), {
        headers: { ...authHeaders(), 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      return data;
    },

    async getBusinessEncryptionKey() {
      const { data } = await api.get(`${base()}/whatsapp_business_encryption`, { headers: authHeaders() });
      return data?.data?.[0] || data || null;
    },

    async deprecateFlow(flowId) {
      const { data } = await api.post(`${GRAPH()}/${flowId}/deprecate`, {}, { headers: authHeaders() });
      return data;
    },
    async deleteFlow(flowId) {
      const { data } = await api.delete(`${GRAPH()}/${flowId}`, { headers: authHeaders() });
      return data;
    },
  };

  if (C.sandbox) {
    // The shared number's own sample templates (made by the platform in its
    // WABA) can be listed and sent, but only through this explicit handle, so
    // journeys, flows and auto-sends that call sendTemplate stay refused.
    client.shared = { listTemplates: client.listTemplates, sendTemplate: client.sendTemplate };
    for (const name of SANDBOX_BLOCKED) {
      client[name] = async () => {
        throw Object.assign(new Error(SANDBOX_UNSUPPORTED), { code: 'SANDBOX_UNSUPPORTED', status: 409 });
      };
    }
    client.paymentReady = () => false;
  }
  return client;
}

/** Why a WABA-level feature can't be used on the shared test number. */
export const SANDBOX_UNSUPPORTED = 'Templates, WhatsApp Flows, catalog and payments need your own WhatsApp number. '
  + 'On the shared test number you can only reply to customers within 24 hours of their last message.';
// Everything that belongs to a WABA (or needs one) rather than to a chat.
const SANDBOX_BLOCKED = [
  'sendTemplate', 'listTemplates', 'createTemplate', 'deleteTemplate', 'uploadHeaderSample', 'resumableUpload',
  // The shared number's WhatsApp profile is the platform's, never a tenant's to change.
  'updateBusinessProfile', 'setProfilePicture',
  'sendFlowMessage', 'createFlow', 'updateFlowJSON', 'publishFlow', 'getFlows', 'updateFlowEndpoint',
  'setBusinessEncryptionKey', 'getBusinessEncryptionKey', 'deprecateFlow', 'deleteFlow',
  'sendProductList', 'sendProduct', 'batchUpsertCatalogProducts', 'getCatalogProducts',
  'listCatalogRetailerIds', 'deleteCatalogProducts', 'sendOrderDetails', 'sendOrderStatusUpdate',
  // Calls belong to the business's own number.
  'getCallSettings', 'updateCallSettings', 'callAction', 'getCallPermission', 'sendCallPermissionRequest',
  // A block on the shared number would block that customer for every tenant.
  'blockUsers', 'unblockUsers',
];

const credsFromBusiness = (b) => ({
  token: b.accessToken,
  phoneNumberId: b.phoneNumberId,
  wabaId: b.wabaId,
  catalogId: b.catalogId,
  catalogToken: b.catalogId && b.catalogConnection?.token ? decryptToken(b.catalogConnection.token) : '',
  appId: b.appId,
  appSecret: b.appSecret,
  graphVersion: b.graphVersion,
  businessId: b._id ? String(b._id) : '',
  // Native payment config, set per tenant in the admin panel.
  payment: b.payment
    ? {
      enabled: !!b.payment.enabled,
      configName: b.payment.configName || '',
      gatewayType: b.payment.gatewayType || 'razorpay',
      merchantName: b.payment.merchantName || '',
      addressLine1: b.payment.addressLine1 || '',
      addressLine2: b.payment.addressLine2 || '',
      city: b.payment.city || '',
      zoneCode: b.payment.zoneCode || '',
      postalCode: b.payment.postalCode || '',
      countryCode: b.payment.countryCode || 'IN',
      countryOfOrigin: b.payment.countryOfOrigin || 'India',
    }
    : { enabled: false, configName: '', gatewayType: 'razorpay' },
  businessName: b.name || '',
});

export function getClientForBusiness(business) {
  return createMetaClient(credsFromBusiness(business));
}

export async function getClientForPhoneId(phoneNumberId) {
  const b = await Business.findOne({ phoneNumberId: String(phoneNumberId || '') });
  if (!b) return null;
  return createMetaClient(credsFromBusiness(b));
}

// Bridge default: resolve the first active business (cached briefly) so legacy
// callers keep working. Prefer getClientForBusiness(req.business) in new code.
let _cache = null;
let _cacheAt = 0;
async function defaultClient() {
  if (_cache && Date.now() - _cacheAt < 30000) return _cache;
  let creds = null;
  try {
    const b = await Business.findOne({ active: true }).sort({ createdAt: 1 });
    if (b) creds = credsFromBusiness(b);
  } catch {
    /* db not ready */
  }
  _cache = createMetaClient(creds || {});
  _cacheAt = Date.now();
  return _cache;
}

// Proxy that forwards every method call to the resolved default client.
const metaCloud = new Proxy(
  {},
  {
    get(_t, prop) {
      return (...args) => defaultClient().then((c) => {
        const fn = c[prop];
        if (typeof fn !== 'function') throw new Error(`metaCloud.${String(prop)} is not available`);
        return fn.apply(c, args);
      });
    },
  },
);

export default metaCloud;
