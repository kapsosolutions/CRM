import express from 'express';

const router = express.Router();

// ---------------- Admin login ----------------
// Returns the ADMIN_TOKEN on valid credentials. The CRM frontend stores it and
// sends it as a bearer token on every /api/crm/* request.
router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  const expectedUser = process.env.ADMIN_USERNAME || 'admin';
  const expectedPass = process.env.ADMIN_PASSWORD;
  const token = process.env.ADMIN_TOKEN;

  if (!expectedPass || !token) {
    return res.status(500).json({ success: false, message: 'Server auth not configured' });
  }
  if (username === expectedUser && password === expectedPass) {
    return res.json({ success: true, token });
  }
  return res.status(401).json({ success: false, message: 'Invalid credentials' });
});

export default router;
