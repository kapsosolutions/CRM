// Meta's WhatsApp Template Library (Templates → Template Library, Campaigns →
// Template Messages → Template Library).
//
// Meta endpoints (WhatsApp Business Management API, graph.facebook.com):
//   GET  /message_template_library?search=&topic=&usecase=&industry=&language=&name=
//        browse Meta's ready-made UTILITY and AUTHENTICATION templates
//   POST /<WABA_ID>/message_templates
//        { name, category, language, library_template_name,
//          library_template_button_inputs, library_template_body_inputs }
//        create a template in the business's WABA from one of them
// https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-message-templates/template-library
//
// Credentials, always server-side:
//   - a business with its own WhatsApp number browses and creates with its
//     own WABA token (the token Embedded Signup stored on the Business row);
//   - a business without one (on the shared test number, services/sandbox.js)
//     can browse read-only with the platform's sandbox token, because the
//     library is Meta's public content and not any tenant's data. It can't
//     create: there is no WABA of its own to create in;
//   - without either, the routes answer 409 WA_NOT_CONNECTED and the CRM
//     shows "Connect WhatsApp to use the library".
// No token ever appears in a response or a log line.
import axios from 'axios';
import Template from '../models/Template.js';
import { isWhatsAppConnected, sandboxConfig } from './sandbox.js';
import { authBodyText, authFooterText } from './authTemplate.js';
import logger from './logger.js';
import { assertTemplateAllowed } from './planGate.js';
import { PlanLimitError } from './plans.js';

const http = axios.create({ timeout: 20000 });
const bearer = (token) => ({ headers: { Authorization: `Bearer ${token}` } });
const graph = (version) => `https://graph.facebook.com/${version}`;

// The languages the library picker offers (Meta's locale codes).
export const LIBRARY_LANGUAGES = ['en_US', 'en', 'en_GB', 'hi', 'te', 'ta', 'es', 'pt_BR', 'id', 'ar'];
export const DEFAULT_LIBRARY_LANGUAGE = 'en_US';
// The filters Meta documents for the library (Template Library → Template Filters).
// Other values in Meta's answers are passed through; the query only has to look like an enum.
export const LIBRARY_FILTERS = {
  industry: ['E_COMMERCE', 'FINANCIAL_SERVICES'],
  topic: ['ACCOUNT_UPDATE', 'CUSTOMER_FEEDBACK', 'ORDER_MANAGEMENT', 'PAYMENTS'],
  usecase: [
    'ACCOUNT_CREATION_CONFIRMATION', 'AUTO_PAY_REMINDER', 'DELIVERY_CONFIRMATION', 'DELIVERY_FAILED', 'DELIVERY_UPDATE',
    'FEEDBACK_SURVEY', 'FRAUD_ALERT', 'LOW_BALANCE_WARNING', 'ORDER_ACTION_NEEDED', 'ORDER_CONFIRMATION', 'ORDER_DELAY',
    'ORDER_OR_TRANSACTION_CANCEL', 'ORDER_PICK_UP', 'PAYMENT_ACTION_REQUIRED', 'PAYMENT_CONFIRMATION', 'PAYMENT_DUE_REMINDER',
    'PAYMENT_OVERDUE', 'PAYMENT_REJECT_FAIL', 'PAYMENT_SCHEDULED', 'RECEIPT_ATTACHMENT', 'RETURN_CONFIRMATION',
    'SHIPMENT_CONFIRMATION', 'STATEMENT_ATTACHMENT', 'STATEMENT_AVAILABLE', 'TRANSACTION_ALERT',
  ],
};
const PAGE_LIMIT = 100;
const MAX_PAGES = 5; // up to 500 templates per search
const CACHE_MS = 10 * 60 * 1000;
const CACHE_MAX = 100;

export class LibraryError extends Error {
  constructor(message, { status = 400, code = 'LIBRARY_ERROR', problems = null, meta = null } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.problems = problems;
    this.meta = meta;
  }

  toJSON() {
    return { success: false, code: this.code, message: this.message, ...(this.problems ? { problems: this.problems } : {}) };
  }
}
const invalid = (problems) => new LibraryError(problems[0].message, { status: 400, code: 'INVALID_INPUT', problems });

const str = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max).trim();
const isHttpUrl = (u) => {
  try {
    const x = new URL(String(u || ''));
    return x.protocol === 'https:' || x.protocol === 'http:';
  } catch {
    return false;
  }
};
const LANG_RE = /^[a-z]{2,3}(_[A-Z]{2})?$/;
const ENUM_RE = /^[A-Z][A-Z_]{1,59}$/;
const NAME_RE = /^[a-z0-9_]{1,512}$/;
const LIB_NAME_RE = /^[a-z0-9_]{1,200}$/;
const metaErr = (err) => err?.response?.data?.error || null;

/**
 * Which token the library is read with for this business, and whether it can
 * create templates from it.
 *   connected: its own WABA token (can create when it also has a WABA id)
 *   sandbox:   the platform's shared test number token, read-only
 *   none:      nothing to read with
 */
export function libraryAccess(business) {
  if (isWhatsAppConnected(business)) {
    return {
      mode: 'connected',
      token: String(business.accessToken),
      version: business.graphVersion || process.env.WA_GRAPH_VERSION || 'v22.0',
      wabaId: String(business.wabaId || ''),
      canUse: !!business.wabaId,
    };
  }
  if (sandboxConfig().configured) {
    return {
      mode: 'sandbox',
      token: String(process.env.SANDBOX_ACCESS_TOKEN || ''),
      version: process.env.SANDBOX_GRAPH_VERSION || process.env.WA_GRAPH_VERSION || 'v22.0',
      wabaId: '',
      canUse: false,
    };
  }
  return { mode: 'none', token: '', version: '', wabaId: '', canUse: false };
}

const NOT_CONNECTED = 'Connect your own WhatsApp number to use Meta’s template library.';
const notConnected = () => new LibraryError(NOT_CONNECTED, { status: 409, code: 'WA_NOT_CONNECTED' });

/** One library template, in the CRM's shape (unknown fields dropped). */
export function normaliseLibraryTemplate(t = {}) {
  const header = typeof t.header === 'string' ? t.header : (typeof t.header?.text === 'string' ? t.header.text : '');
  const category = String(t.category || 'UTILITY').toUpperCase();
  return {
    id: String(t.id || ''),
    name: String(t.name || ''),
    language: String(t.language || ''),
    category,
    topic: String(t.topic || ''),
    usecase: String(t.usecase || ''),
    industry: Array.isArray(t.industry) ? t.industry.map(String) : [],
    header,
    body: String(t.body || ''),
    footer: typeof t.footer === 'string' ? t.footer : '',
    bodyParams: Array.isArray(t.body_params) ? t.body_params.map(String) : [],
    bodyParamTypes: Array.isArray(t.body_param_types) ? t.body_param_types.map(String) : [],
    buttons: (Array.isArray(t.buttons) ? t.buttons : []).map((b) => {
      const type = String(b?.type || '').toUpperCase();
      return {
        type,
        text: String(b?.text || ''),
        url: String(b?.url || ''),
        phone: String(b?.phone_number || ''),
        // What the business has to fill in when creating from it.
        input: type === 'URL' ? 'url' : type === 'PHONE_NUMBER' ? 'phone' : '',
      };
    }),
  };
}

/** Clean the browse filters; throws INVALID_INPUT for values that can't be Meta's. */
export function libraryQuery(raw = {}) {
  const problems = [];
  const language = str(raw.language, 10) || DEFAULT_LIBRARY_LANGUAGE;
  if (!LANG_RE.test(language)) problems.push({ field: 'language', message: 'Choose a language from the list.' });
  const out = { language };
  const search = str(raw.q ?? raw.search, 100);
  if (search) out.search = search;
  for (const k of ['topic', 'usecase', 'industry']) {
    const v = str(raw[k], 60).toUpperCase();
    if (!v) continue;
    if (!ENUM_RE.test(v)) problems.push({ field: k, message: `That ${k} isn’t one of Meta’s.` });
    else out[k] = v;
  }
  const name = str(raw.name, 200);
  if (name) {
    if (!LIB_NAME_RE.test(name)) problems.push({ field: 'name', message: 'A library template name uses lowercase letters, numbers and underscores.' });
    else out.name = name;
  }
  if (problems.length) throw invalid(problems);
  return out;
}

const cache = new Map();
export const clearLibraryCache = () => cache.clear();

/** Every page of one library search (up to MAX_PAGES × PAGE_LIMIT), normalised. */
async function fetchLibrary(access, query) {
  const key = JSON.stringify([access.version, query]);
  const hit = cache.get(key);
  if (hit && hit.at > Date.now() - CACHE_MS) return hit.rows;
  const rows = [];
  let after = '';
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const params = { ...query, limit: PAGE_LIMIT, ...(after ? { after } : {}) };
    // eslint-disable-next-line no-await-in-loop
    const { data } = await http.get(`${graph(access.version)}/message_template_library`, { params, ...bearer(access.token) });
    for (const t of data?.data || []) rows.push(normaliseLibraryTemplate(t));
    after = data?.paging?.next ? String(data?.paging?.cursors?.after || '') : '';
    if (!after) break;
  }
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, { at: Date.now(), rows });
  return rows;
}

/** A Graph failure → the LibraryError the route answers with. */
function graphFailure(err, access, what) {
  if (err instanceof LibraryError) return err;
  const e = metaErr(err);
  if (e) {
    if (access.mode === 'sandbox') {
      // The shared token isn't allowed to read it: behave as "not connected".
      logger.warn('template library: the sandbox token was refused', { code: e.code, error: e.message });
      return notConnected();
    }
    if (Number(e.code) === 190) {
      return new LibraryError('Meta no longer accepts this business’s WhatsApp connection. Reconnect WhatsApp on Channel Status.', { status: 409, code: 'WA_TOKEN_INVALID', meta: { code: e.code } });
    }
    return new LibraryError(`Meta refused to ${what}: ${e.error_user_msg || e.message || 'unknown error'}`, {
      status: 502, code: 'META_ERROR', meta: { code: e.code, subcode: e.error_subcode },
    });
  }
  return new LibraryError(`Could not reach Meta to ${what}. Please try again.`, { status: 503, code: 'META_UNREACHABLE' });
}

function facets(rows) {
  const count = (list) => {
    const m = new Map();
    for (const v of list) if (v) m.set(v, (m.get(v) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([value, n]) => ({ value, count: n }));
  };
  return {
    categories: count(rows.map((r) => r.category)),
    topics: count(rows.map((r) => r.topic)),
    usecases: count(rows.map((r) => r.usecase)),
    industries: count(rows.flatMap((r) => r.industry)),
  };
}

/** GET /api/crm/templates/library: browse Meta's WhatsApp library. */
export async function browseLibrary(business, raw = {}) {
  const query = libraryQuery(raw);
  const access = libraryAccess(business);
  if (access.mode === 'none' || !access.token) throw notConnected();
  let rows;
  try {
    rows = await fetchLibrary(access, query);
  } catch (err) {
    throw graphFailure(err, access, 'search the template library');
  }
  return {
    mode: access.mode,
    canUse: access.canUse,
    language: query.language,
    total: rows.length,
    data: rows,
    facets: facets(rows),
    filters: LIBRARY_FILTERS,
    languages: LIBRARY_LANGUAGES,
  };
}

/** The `components` our local copy keeps (previews, the chat copy of each send). */
function localComponents(t, buttonInputs, auth) {
  if (auth) {
    return [
      { type: 'BODY', add_security_recommendation: !!auth.addSecurityRecommendation },
      ...(auth.codeExpirationMinutes ? [{ type: 'FOOTER', code_expiration_minutes: auth.codeExpirationMinutes }] : []),
      { type: 'BUTTONS', buttons: [{ type: 'OTP', otp_type: 'COPY_CODE' }] },
    ];
  }
  const out = [];
  if (t.header) out.push({ type: 'HEADER', format: 'TEXT', text: t.header });
  out.push({ type: 'BODY', text: t.body, ...(t.bodyParams.length ? { example: { body_text: [t.bodyParams] } } : {}) });
  if (t.footer) out.push({ type: 'FOOTER', text: t.footer });
  const buttons = t.buttons.map((b, i) => {
    const input = buttonInputs.find((x) => x.index === i);
    if (b.type === 'URL') {
      return { type: 'URL', text: b.text, url: input?.url?.base_url || b.url, ...(input?.url?.url_suffix_example ? { example: [input.url.url_suffix_example] } : {}) };
    }
    if (b.type === 'PHONE_NUMBER') return { type: 'PHONE_NUMBER', text: b.text, phone_number: input?.phone_number || b.phone };
    return { type: b.type, text: b.text };
  });
  if (buttons.length) out.push({ type: 'BUTTONS', buttons });
  return out;
}

/**
 * POST /api/crm/templates/library/use: create a template in the business's
 * WABA from a library template.
 *   input: { libraryTemplateName, name, language,
 *            buttonInputs: [{ url, urlSuffixExample } | { phone }]   (one per library button, by index),
 *            bodyInputs: { addSecurityRecommendation, codeExpirationMinutes }   (authentication) }
 * The library template is read again from Meta by name, so its category and
 * buttons come from Meta, never from the browser.
 */
export async function useLibraryTemplate(business, input = {}) {
  const problems = [];
  const libraryName = str(input.libraryTemplateName, 200);
  const name = str(input.name, 512).toLowerCase();
  const language = str(input.language, 10);
  if (!LIB_NAME_RE.test(libraryName)) problems.push({ field: 'libraryTemplateName', message: 'Pick a template from the library.' });
  if (!name) problems.push({ field: 'name', message: 'Give your template a name.' });
  else if (!NAME_RE.test(name)) problems.push({ field: 'name', message: 'Use lowercase letters, numbers and underscores only in the name.' });
  if (!LANG_RE.test(language)) problems.push({ field: 'language', message: 'Choose a language.' });
  if (problems.length) throw invalid(problems);

  const access = libraryAccess(business);
  if (access.mode === 'sandbox') {
    throw new LibraryError('You’re on the shared test number. Connect your own WhatsApp number to create templates from the library.', { status: 409, code: 'SANDBOX_UNSUPPORTED' });
  }
  if (access.mode !== 'connected' || !access.canUse) throw notConnected();

  let lib;
  try {
    const rows = await fetchLibrary(access, { language, name: libraryName });
    lib = rows.find((r) => r.name === libraryName && (!r.language || r.language === language));
  } catch (err) {
    throw graphFailure(err, access, 'read the library template');
  }
  if (!lib) throw new LibraryError('That template isn’t in Meta’s library in this language.', { status: 404, code: 'LIBRARY_TEMPLATE_NOT_FOUND' });
  const isAuth = lib.category === 'AUTHENTICATION';
  // The plan: template count, and authentication templates (services/plans.js).
  try {
    await assertTemplateAllowed(business, { name, category: lib.category, kind: 'standard' });
  } catch (err) {
    if (err instanceof PlanLimitError) {
      throw new LibraryError(err.message, { status: 402, code: err.code });
    }
    throw err;
  }

  // ---- button inputs: the business's own link / phone number for each library button
  const given = Array.isArray(input.buttonInputs) ? input.buttonInputs.slice(0, 10) : [];
  const buttonInputs = [];
  lib.buttons.forEach((b, i) => {
    const v = given[i] && typeof given[i] === 'object' ? given[i] : {};
    const label = b.text || `Button ${i + 1}`;
    if (b.type === 'URL') {
      const url = str(v.url, 2000);
      const vars = url.match(/\{\{[^}]*\}\}/g) || [];
      if (!isHttpUrl(url.replace(/\{\{\s*1\s*\}\}$/, ''))) {
        problems.push({ field: `buttonInputs.${i}.url`, message: `“${label}” needs your web address (https://…).` });
      } else if (vars.length > 1 || (vars.length === 1 && !/\{\{\s*1\s*\}\}$/.test(url))) {
        problems.push({ field: `buttonInputs.${i}.url`, message: `“${label}”: a link can have one {{1}}, at the very end.` });
      }
      const suffix = str(v.urlSuffixExample, 2000);
      if (vars.length === 1 && !isHttpUrl(suffix)) {
        problems.push({ field: `buttonInputs.${i}.urlSuffixExample`, message: `“${label}”: add a full sample link for the {{1}} part.` });
      }
      buttonInputs.push({ index: i, type: 'URL', url: { base_url: url, ...(vars.length === 1 ? { url_suffix_example: suffix } : {}) } });
    } else if (b.type === 'PHONE_NUMBER') {
      const phone = str(v.phone, 30).replace(/[\s()-]/g, '');
      if (!/^\+\d{7,15}$/.test(phone)) problems.push({ field: `buttonInputs.${i}.phone`, message: `“${label}” needs your phone number with the country code, like +919876543210.` });
      buttonInputs.push({ index: i, type: 'PHONE_NUMBER', phone_number: phone });
    } else if (b.type === 'OTP') {
      buttonInputs.push({ index: i, type: 'OTP', otp_type: 'COPY_CODE' });
    }
  });
  // An authentication template always has its one-time-code button.
  if (isAuth && !buttonInputs.some((b) => b.type === 'OTP')) buttonInputs.push({ index: -1, type: 'OTP', otp_type: 'COPY_CODE' });

  // ---- body inputs (authentication: the security line and the code expiry)
  let auth = null;
  const bodyInputs = {};
  if (isAuth) {
    const bi = input.bodyInputs && typeof input.bodyInputs === 'object' ? input.bodyInputs : {};
    const rawExp = bi.codeExpirationMinutes;
    let exp = null;
    if (rawExp !== undefined && rawExp !== null && rawExp !== '') {
      exp = Number(rawExp);
      if (!Number.isInteger(exp) || exp < 1 || exp > 90) {
        problems.push({ field: 'bodyInputs.codeExpirationMinutes', message: 'Code expiry must be a whole number of minutes from 1 to 90.' });
      }
    }
    const sec = bi.addSecurityRecommendation === true;
    bodyInputs.add_security_recommendation = sec;
    if (exp) bodyInputs.code_expiration_minutes = exp;
    auth = {
      otpType: 'COPY_CODE', addSecurityRecommendation: sec, codeExpirationMinutes: exp || null, buttonText: '', autofillText: '',
      supportedApps: [], zeroTapTermsAccepted: false, messageSendTtlSeconds: null,
    };
  }
  if (problems.length) throw invalid(problems);

  if (await Template.exists({ businessId: business._id, name })) {
    throw invalid([{ field: 'name', message: `You already have a template named “${name}”. Pick another name.` }]);
  }

  const payload = {
    name,
    category: isAuth ? 'AUTHENTICATION' : 'UTILITY',
    language,
    library_template_name: libraryName,
    ...(buttonInputs.length ? { library_template_button_inputs: buttonInputs.map(({ index: _i, ...b }) => b) } : {}),
    ...(Object.keys(bodyInputs).length ? { library_template_body_inputs: bodyInputs } : {}),
  };
  let created;
  try {
    created = (await http.post(`${graph(access.version)}/${access.wabaId}/message_templates`, payload, bearer(access.token))).data || {};
  } catch (err) {
    const e = metaErr(err);
    if (e && Number(e.code) !== 190) {
      // Meta's own reason ("name already exists", "button input missing"…).
      throw new LibraryError(e.error_user_msg || e.message || 'Meta didn’t accept the template.', { status: 400, code: 'META_REJECTED', meta: { code: e.code, subcode: e.error_subcode } });
    }
    throw graphFailure(err, access, 'create the template');
  }
  const status = String(created.status || 'PENDING').toUpperCase();
  const category = String(created.category || payload.category).toUpperCase();
  await Template.findOneAndUpdate(
    { businessId: business._id, name },
    {
      $set: {
        name, metaId: String(created.id || ''), language, category, kind: 'standard', status, rejectedReason: '',
        bodyText: auth ? authBodyText(auth) : lib.body,
        headerText: auth ? '' : lib.header, headerMediaUrl: '', headerFormat: !auth && lib.header ? 'TEXT' : '', headerFileName: '',
        footerText: auth ? authFooterText(auth) : lib.footer,
        components: localComponents(lib, buttonInputs, auth),
        cards: [],
        ...(auth ? { auth } : {}),
        variables: [],
      },
    },
    { upsert: true },
  );
  logger.info('template created from Meta’s library', { business: business.name, name, library: libraryName, status });
  return { name, language, category, status, metaId: String(created.id || ''), libraryTemplateName: libraryName };
}
