// WhatsApp Flows data endpoint (endpoint-mode flows). Meta posts an encrypted
// envelope here on ping / INIT / data_exchange; we decrypt, decide the next
// screen + data (dynamic categories, per-option branching) and respond with a
// base64 ciphertext. Requires the tenant's flow keys to be configured.
import express from 'express';
import { decryptRequest, encryptResponse } from '../services/flowCrypto.js';
import { handleInit, handleDataExchange } from '../services/flowRuntime.js';
import logger from '../services/logger.js';

const router = express.Router();

function sendEncrypted(res, obj, aesKeyBuffer, initialVectorBuffer) {
  res.type('text/plain').send(encryptResponse(obj, aesKeyBuffer, initialVectorBuffer));
}

router.post('/', async (req, res) => {
  let aesKeyBuffer;
  let initialVectorBuffer;
  let decrypted;
  try {
    ({ decrypted, aesKeyBuffer, initialVectorBuffer } = decryptRequest(req.body));
  } catch (err) {
    logger.error('Flow endpoint decrypt failed', { error: err.message });
    return res.status(421).send(); // 421 → Meta refreshes the public key
  }

  try {
    const { action, screen, data = {}, flow_token } = decrypted;
    const token = flow_token || data.flow_token || '';

    if (action === 'ping') {
      return sendEncrypted(res, { data: { status: 'active' } }, aesKeyBuffer, initialVectorBuffer);
    }
    if (action === 'INIT') {
      return sendEncrypted(res, await handleInit(token), aesKeyBuffer, initialVectorBuffer);
    }
    if (action === 'data_exchange') {
      return sendEncrypted(res, await handleDataExchange(token, screen, data), aesKeyBuffer, initialVectorBuffer);
    }
    return sendEncrypted(res, { data: {} }, aesKeyBuffer, initialVectorBuffer);
  } catch (err) {
    logger.error('Flow endpoint processing error', { error: err.message });
    return sendEncrypted(res, { data: { error_message: 'Something went wrong. Please try again.' } }, aesKeyBuffer, initialVectorBuffer);
  }
});

export default router;
