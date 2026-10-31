// The shared "try it" number panel on the Chats page (services/sandbox.js).
import express from 'express';
import { requireBusiness } from '../middleware/auth.js';
import { sandboxConfig, isWhatsAppConnected, ensureJoinCode, sandboxContacts } from '../services/sandbox.js';

const router = express.Router();
router.use(requireBusiness);

// The number to message and this business's join code, with ready-made links,
// plus how many of its contact slots are used (the Chats page counter).
// A connected business doesn't use the shared number, so it gets nothing.
router.get('/', async (req, res) => {
  const cfg = sandboxConfig();
  if (!cfg.configured || isWhatsAppConnected(req.business)) return res.json({ success: true, enabled: false });
  const code = await ensureJoinCode(req.business);
  if (!code) return res.json({ success: true, enabled: false });
  const text = encodeURIComponent(code);
  return res.json({
    success: true,
    enabled: true,
    displayPhone: cfg.displayPhone,
    waNumber: cfg.waNumber,
    code,
    // Different contacts linked to this business, against SANDBOX_CONTACT_LIMIT.
    contacts: await sandboxContacts(req.business._id),
    links: {
      waMe: `https://wa.me/${cfg.waNumber}?text=${text}`,
      web: `https://web.whatsapp.com/send?phone=${cfg.waNumber}&text=${text}`,
      desktop: `whatsapp://send?phone=${cfg.waNumber}&text=${text}`,
    },
  });
});

export default router;
