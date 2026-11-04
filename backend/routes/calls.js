// WhatsApp voice calls from the CRM (services/calling.js).
//
//   GET  /api/calls/settings            calling settings of the number (Meta)
//   PUT  /api/calls/settings            change them
//   GET  /api/calls/config              ICE servers for the browser
//   GET  /api/calls/ringing             calls ringing now (a tab opened late)
//   POST /api/calls                     call a customer { phone, sdp, tabId }
//   POST /api/calls/:id/accept          answer { sdp, tabId }
//   POST /api/calls/:id/reject          decline a ringing call
//   POST /api/calls/:id/end             hang up
//   GET  /api/calls/permission?phone=   may the business call them now?
//   POST /api/calls/permission          ask { phone, body? }
//
// Every route is the signed-in business's own number; the shared test number
// can't make or take calls.
import express from 'express';
import { requireBusiness } from '../middleware/auth.js';
import {
  getCallSettings, updateCallSettings, ringingCalls, acceptCall, rejectCall, endCall, startCall,
  callPermission, requestCallPermission, iceServers, callError, CallError,
} from '../services/calling.js';
import { isWhatsAppConnected } from '../services/sandbox.js';
import logger from '../services/logger.js';

const router = express.Router();
router.use(requireBusiness);

/** Our own refusals keep their status; whatever Meta said is a bad gateway. */
function fail(res, req, what, err) {
  if (err instanceof CallError) {
    return res.status(err.status).json({ success: false, message: err.message, code: err.code });
  }
  const { message, code } = callError(err);
  logger.warn(`calls: ${what} failed`, { business: req.business?.name, error: message, code });
  const status = err?.status && !err.response ? err.status : 502;
  return res.status(status).json({ success: false, message, code });
}

router.get('/settings', async (req, res) => {
  if (!isWhatsAppConnected(req.business)) return res.json({ success: true, connected: false });
  try {
    const data = await getCallSettings(req.business, { refresh: req.query.refresh === '1' });
    return res.json({ success: true, connected: true, settings: data });
  } catch (err) {
    return fail(res, req, 'settings read', err);
  }
});

router.put('/settings', async (req, res) => {
  try {
    const data = await updateCallSettings(req.business, req.body || {});
    return res.json({ success: true, connected: true, settings: data });
  } catch (err) {
    return fail(res, req, 'settings update', err);
  }
});

router.get('/config', (req, res) => {
  res.json({ success: true, iceServers: iceServers(), connected: isWhatsAppConnected(req.business) });
});

router.get('/ringing', (req, res) => {
  if (!isWhatsAppConnected(req.business)) return res.json({ success: true, calls: [] });
  return res.json({ success: true, calls: ringingCalls(req.business) });
});

router.get('/permission', async (req, res) => {
  try {
    const data = await callPermission(req.business, req.query.phone);
    return res.json({ success: true, ...data });
  } catch (err) {
    return fail(res, req, 'permission read', err);
  }
});

router.post('/permission', async (req, res) => {
  const b = req.body || {};
  try {
    const data = await requestCallPermission(req.business, b.phone, typeof b.body === 'string' ? b.body : '');
    return res.json({ success: true, ...data });
  } catch (err) {
    return fail(res, req, 'permission request', err);
  }
});

router.post('/', async (req, res) => {
  const b = req.body || {};
  try {
    const call = await startCall(req.business, { phone: b.phone, sdp: b.sdp, tabId: b.tabId, name: b.name });
    return res.json({ success: true, call });
  } catch (err) {
    return fail(res, req, 'start', err);
  }
});

router.post('/:id/accept', async (req, res) => {
  const b = req.body || {};
  try {
    const call = await acceptCall(req.business, req.params.id, { sdp: b.sdp, tabId: b.tabId });
    return res.json({ success: true, call });
  } catch (err) {
    return fail(res, req, 'accept', err);
  }
});

router.post('/:id/reject', async (req, res) => {
  try {
    return res.json({ success: true, ...(await rejectCall(req.business, req.params.id)) });
  } catch (err) {
    return fail(res, req, 'reject', err);
  }
});

router.post('/:id/end', async (req, res) => {
  try {
    return res.json({ success: true, ...(await endCall(req.business, req.params.id)) });
  } catch (err) {
    return fail(res, req, 'end', err);
  }
});

export default router;
