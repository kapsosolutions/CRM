// Connect a business's WhatsApp through Embedded Signup.
import express from 'express';
import Business from '../models/Business.js';
import { requireBusiness } from '../middleware/auth.js';
import { completeSignup, SignupError } from '../services/embeddedSignup.js';
import { webhookCallbackUrl } from '../services/webhookSetup.js';
import { onWhatsAppConnected } from '../services/sandbox.js';
import { clearNumberStatus, needsActivation } from '../services/metaAccount.js';
import logger from '../services/logger.js';

const router = express.Router();
router.use(requireBusiness);

/**
 * Finish Embedded Signup: the browser posts the `code` from FB.login and the
 * WABA / phone number ids from Meta's session-info message (when it got one).
 */
router.post('/embedded-signup', async (req, res) => {
  const b = req.body || {};
  const biz = req.business;
  // Reconnecting the same number keeps its two-step PIN.
  const existingPin = String(b.phoneNumberId || '') === String(biz.phoneNumberId || '') ? String(biz.waConnection?.pin || '') : '';
  try {
    const r = await completeSignup({
      code: String(b.code || ''),
      wabaId: b.wabaId,
      phoneNumberId: b.phoneNumberId,
      existingPin,
      // This business's own callback, set as the WABA's webhook override.
      callbackUrl: webhookCallbackUrl(biz._id),
      verifyToken: biz.verifyToken,
    });

    // One number belongs to one business.
    const other = await Business.findOne({ phoneNumberId: r.phoneNumberId, _id: { $ne: biz._id } }).select('name').lean();
    if (other) {
      return res.status(409).json({
        success: false,
        message: 'This WhatsApp number is already connected to another business on the platform.',
      });
    }

    // The registered owner's name was only a placeholder for the business name.
    const placeholder = `${biz.ownerFirstName || ''} ${biz.ownerLastName || ''}`.trim();
    if (r.details.verifiedName && (!biz.name || biz.name === placeholder)) biz.name = r.details.verifiedName;

    biz.accessToken = r.accessToken;
    biz.wabaId = r.wabaId;
    biz.phoneNumberId = r.phoneNumberId;
    // Messages arrive through our Tech Provider app and are signed with its
    // secret, which is what the webhook checks.
    biz.appId = process.env.META_APP_ID || '';
    biz.appSecret = process.env.META_APP_SECRET || '';
    biz.graphVersion = process.env.WA_GRAPH_VERSION || biz.graphVersion || 'v22.0';
    // The number's status as Meta reports it after the register attempt.
    const numberStatus = String(r.details.connectionStatus || (r.registerError ? 'PENDING' : '')).toUpperCase();
    const pending = !!r.registerError
      || needsActivation({ status: numberStatus, platformType: r.details.platformType });
    biz.waConnection = {
      method: 'embedded_signup',
      connectedAt: new Date(),
      metaBusinessId: String(b.metaBusinessId || biz.waConnection?.metaBusinessId || ''),
      // Only a PIN Meta accepted is worth keeping: the generated one when this
      // signup registered the number, else the one this number already had.
      pin: r.registered ? r.pin : existingPin,
    };
    biz.meta = {
      ...(biz.meta || {}),
      verifiedName: r.details.verifiedName || '',
      displayPhoneNumber: r.details.displayPhoneNumber || '',
      qualityRating: r.details.qualityRating || '',
      wabaName: r.details.wabaName || '',
      numberStatus,
      numberStatusAt: new Date(),
      lastVerifiedAt: new Date(),
    };
    await biz.save();
    // A reconnect may bring a new token or number: drop the cached status.
    clearNumberStatus(biz._id);
    // Its own number now: customers who reached it through the shared test
    // number are unlinked (the chats stay).
    await onWhatsAppConnected(biz, { pending }).catch((e) => logger.warn('sandbox cleanup after connect failed', { error: e.message }));
    logger.info('WhatsApp connected via Embedded Signup', {
      business: biz.name, phoneNumberId: r.phoneNumberId, wabaId: r.wabaId, numberStatus, warnings: r.warnings.length,
    });
    return res.json({
      success: true,
      business: biz.toSafeJSON(),
      warnings: r.warnings,
      webhookUrl: webhookCallbackUrl(biz._id),
      // Not CONNECTED yet: the CRM shows "Pending — activate this number".
      activation: {
        needed: pending,
        status: numberStatus,
        hasSavedPin: !!biz.waConnection.pin,
        error: r.registerError,
      },
    });
  } catch (err) {
    if (err instanceof SignupError) return res.status(err.status).json({ success: false, message: err.message });
    if (err?.code === 11000) {
      return res.status(409).json({ success: false, message: 'This WhatsApp number is already connected to another business.' });
    }
    logger.error('embedded signup failed', { business: biz.name, error: err.message });
    return res.status(500).json({ success: false, message: 'Connecting WhatsApp failed. Please try again.' });
  }
});

export default router;
