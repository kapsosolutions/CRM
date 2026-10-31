// ---------------------------------------------------------------------------
// WhatsApp Embedded Signup (Tech Provider onboarding)
//
// The browser runs Meta's Embedded Signup popup (FB.login with our config id)
// and hands us a short-lived `code` plus, usually, the WABA and phone number
// the customer picked. Here we:
//   1. swap the code for the business's access token (a business-integration
//      system user token, which doesn't expire);
//   2. work out the WABA / phone number from the token itself if the browser
//      didn't get them (the session-info message is best-effort);
//   3. subscribe our app to the WABA, so its messages reach our webhook;
//   4. register the number for Cloud API messaging if it isn't already;
//   5. read the number's live details for the business profile.
// ---------------------------------------------------------------------------
import axios from 'axios';
import crypto from 'crypto';
import { verifyCredentials } from './metaVerify.js';
import { mapRegisterError } from './numberActivation.js';
import logger from './logger.js';

const version = () => process.env.WA_GRAPH_VERSION || 'v22.0';
const G = () => `https://graph.facebook.com/${version()}`;
const http = axios.create({ timeout: 20000 });
const metaMessage = (err) => err.response?.data?.error?.error_user_msg || err.response?.data?.error?.message || err.message;

export class SignupError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'SignupError';
    this.status = status;
  }
}

function appCreds() {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) throw new SignupError('Embedded Signup is not configured on the server (META_APP_ID / META_APP_SECRET).', 500);
  return { appId, appSecret };
}

/** Step 1: the code from FB.login → the business's access token. */
export async function exchangeCode(code) {
  const { appId, appSecret } = appCreds();
  try {
    const { data } = await http.get(`${G()}/oauth/access_token`, {
      params: { client_id: appId, client_secret: appSecret, code },
    });
    if (!data?.access_token) throw new Error('No access token in the response');
    return data.access_token;
  } catch (err) {
    throw new SignupError(`Meta did not accept the signup code: ${metaMessage(err)}`);
  }
}

/** Step 2: which WABA(s) the token was granted, from its granular scopes. */
async function grantedWabas(token) {
  const { appId, appSecret } = appCreds();
  const { data } = await http.get(`${G()}/debug_token`, {
    params: { input_token: token, access_token: `${appId}|${appSecret}` },
  });
  const scopes = data?.data?.granular_scopes || [];
  const ids = scopes
    .filter((s) => s.scope === 'whatsapp_business_management' || s.scope === 'whatsapp_business_messaging')
    .flatMap((s) => s.target_ids || []);
  return [...new Set(ids.map(String))];
}

async function phoneNumbersOf(wabaId, token) {
  const { data } = await http.get(`${G()}/${wabaId}/phone_numbers`, {
    params: { fields: 'id,display_phone_number,verified_name,status' },
    headers: { Authorization: `Bearer ${token}` },
  });
  return data?.data || [];
}

/**
 * Steps 3 + 4: subscribe the app and make sure the number can send.
 *
 * Our Tech Provider app has a single app-level callback URL that is already
 * used elsewhere, so each WABA gets a per-WABA override pointing at this
 * business's own callback. Meta verifies it with a GET handshake against the
 * business's verify token (routes/webhook.js) before accepting it.
 */
export async function subscribeApp(wabaId, token, { callbackUrl, verifyToken } = {}) {
  const body = callbackUrl && verifyToken ? { override_callback_uri: callbackUrl, verify_token: verifyToken } : {};
  await http.post(`${G()}/${wabaId}/subscribed_apps`, body, { headers: { Authorization: `Bearer ${token}` } });
}

async function registerNumber(phoneNumberId, token, pin) {
  await http.post(
    `${G()}/${phoneNumberId}/register`,
    { messaging_product: 'whatsapp', pin },
    { headers: { Authorization: `Bearer ${token}` } },
  );
}

/**
 * Run the whole server side of Embedded Signup.
 * @returns {{ accessToken, wabaId, phoneNumberId, pin, registered, registerError, details, warnings }}
 *   `registered`: this signup's register call succeeded, so `pin` is the
 *   number's PIN now. `registerError`: why it failed ({ code, message,
 *   metaCode, metaMessage }); the number then stays Pending until the
 *   business activates it from Channel Status.
 */
export async function completeSignup({ code, wabaId, phoneNumberId, existingPin = '', callbackUrl, verifyToken }) {
  if (!code) throw new SignupError('Missing the signup code from Meta.');
  const warnings = [];
  const accessToken = await exchangeCode(code);

  // Prefer what the popup told us; otherwise read it off the token.
  let waba = String(wabaId || '').trim();
  if (!waba) {
    const wabas = await grantedWabas(accessToken).catch((e) => {
      logger.warn('debug_token lookup failed', { error: metaMessage(e) });
      return [];
    });
    if (!wabas.length) throw new SignupError('Meta did not share a WhatsApp Business Account. Please run the signup again and select one.');
    [waba] = wabas;
  }

  let phoneId = String(phoneNumberId || '').trim();
  let numbers = [];
  try {
    numbers = await phoneNumbersOf(waba, accessToken);
  } catch (e) {
    if (!phoneId) throw new SignupError(`Could not read the phone numbers of your WhatsApp account: ${metaMessage(e)}`);
  }
  if (!phoneId) {
    if (!numbers.length) throw new SignupError('Your WhatsApp Business Account has no phone number yet. Add one in the signup and try again.');
    phoneId = String(numbers[0].id);
  }
  const number = numbers.find((n) => String(n.id) === phoneId);

  try {
    await subscribeApp(waba, accessToken, { callbackUrl, verifyToken });
  } catch (e) {
    // Without the override the WABA is still subscribed, just delivered to the
    // app-level URL — better connected with a warning than not at all.
    try {
      await subscribeApp(waba, accessToken);
      warnings.push(`Messages may not reach this CRM yet — the webhook could not be pointed here: ${metaMessage(e)}`);
      logger.warn('WABA callback override failed', { wabaId: waba, error: metaMessage(e) });
    } catch (e2) {
      throw new SignupError(`Could not subscribe the app to your WhatsApp account: ${metaMessage(e2)}`);
    }
  }

  // A number has to be registered with Cloud API before it can send. A
  // number already in use on Cloud API reports CONNECTED and is left alone.
  // A failure here doesn't stop the signup: the business is connected with
  // the number left Pending, and Channel Status offers "Activate number".
  const pin = existingPin || String(crypto.randomInt(100000, 1000000));
  let registered = false;
  let registerError = null;
  if (String(number?.status || '').toUpperCase() !== 'CONNECTED') {
    try {
      await registerNumber(phoneId, accessToken, pin);
      registered = true;
    } catch (e) {
      registerError = mapRegisterError(e).toJSON();
      delete registerError.success;
      logger.warn('phone number register failed', { phoneNumberId: phoneId, code: registerError.code, error: metaMessage(e) });
    }
  }

  const check = await verifyCredentials({ accessToken, phoneNumberId: phoneId, wabaId: waba, graphVersion: version() });
  if (!check.ok) throw new SignupError(check.errors?.[0] || 'Meta did not confirm the connected number.');
  warnings.push(...(check.errors || []));

  return {
    accessToken, wabaId: waba, phoneNumberId: phoneId, pin, registered, registerError, details: check.details, warnings,
  };
}

export default { completeSignup, exchangeCode, SignupError };
