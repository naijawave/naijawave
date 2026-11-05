// Push subscription endpoints (call alerts).
const express = require('express');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const { getVapidPublicKey } = require('../utils/push');

const router = express.Router();

// Public key the browser needs to subscribe. Safe to expose — it is public by design.
router.get('/vapid-public-key', async (req, res) => {
  try {
    const publicKey = await getVapidPublicKey();
    res.json({ publicKey });
  } catch {
    res.status(500).json({ error: 'Push is not ready yet.' });
  }
});

// Whether this user has call alerts enabled on any device.
router.get('/status', authRequired, async (req, res) => {
  const row = await db.get('SELECT COUNT(*)::int AS n FROM push_subscriptions WHERE user_id = $1', req.user.id);
  res.json({ enabled: (row?.n || 0) > 0, devices: row?.n || 0 });
});

// Save a browser push subscription for this user.
router.post('/subscribe', authRequired, async (req, res) => {
  const sub = req.body?.subscription || req.body;
  const endpoint = sub?.endpoint;
  const p256dh = sub?.keys?.p256dh;
  const authKey = sub?.keys?.auth;
  if (!endpoint || !p256dh || !authKey) return res.status(400).json({ error: 'Invalid subscription.' });
  if (String(endpoint).length > 1000 || String(p256dh).length > 300 || String(authKey).length > 300) {
    return res.status(400).json({ error: 'Invalid subscription.' });
  }
  await db.run(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES ($1,$2,$3,$4)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
    req.user.id, endpoint, p256dh, authKey);
  res.json({ ok: true });
});

// Remove one subscription (turn alerts off for a device).
router.post('/unsubscribe', authRequired, async (req, res) => {
  const endpoint = req.body?.endpoint;
  if (endpoint) {
    await db.run('DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2', req.user.id, endpoint);
  } else {
    await db.run('DELETE FROM push_subscriptions WHERE user_id = $1', req.user.id);
  }
  res.json({ ok: true });
});

module.exports = router;
