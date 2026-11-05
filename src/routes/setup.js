// Founder bootstrap. Secure: only works when NO founder exists yet AND the
// caller knows SETUP_KEY (an env var set by the deployer — never in frontend code).
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { signToken } = require('../middleware/auth');
const { publicUser, USERNAME_RE } = require('../utils/helpers');
const { audit } = require('../middleware/roles');

const router = express.Router();

router.get('/status', async (req, res) => {
  const row = await db.get("SELECT COUNT(*)::int c FROM users WHERE role = 'founder'");
  res.json({ founder_exists: row.c > 0 });
});

router.post('/founder', async (req, res) => {
  const SETUP_KEY = process.env.SETUP_KEY;
  if (!SETUP_KEY) return res.status(500).json({ error: 'Server is not configured for setup (SETUP_KEY missing). Set it as an environment variable.' });
  const exists = (await db.get("SELECT COUNT(*)::int c FROM users WHERE role = 'founder'")).c;
  if (exists > 0) return res.status(403).json({ error: 'A founder account already exists. Setup is closed.', code: 'SETUP_CLOSED' });

  const { setup_key, email, password, username, display_name } = req.body || {};
  if (setup_key !== SETUP_KEY) return res.status(403).json({ error: 'Wrong setup key.', code: 'BAD_SETUP_KEY' });
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return res.status(400).json({ error: 'Valid email required.' });
  if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  const uname = String(username || '').trim().toLowerCase();
  if (!USERNAME_RE.test(uname)) return res.status(400).json({ error: 'Invalid username.' });
  if (await db.get('SELECT id FROM users WHERE username = $1 OR lower(email) = $2', uname, email.toLowerCase()))
    return res.status(409).json({ error: 'Username or email already taken.' });

  const info = await db.run(`INSERT INTO users
    (username, display_name, email, contact_type, contact_verified, password_hash,
     verification, is_founder, role, bio)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    uname, String(display_name || uname).slice(0, 40), email.toLowerCase(), 'email', 1,
    bcrypt.hashSync(password, 10), 'founder', 1, 'founder',
    'Founder of Naija Wave 🌊');
  const user = await db.get('SELECT * FROM users WHERE id = $1', info.lastInsertRowid);
  await audit(user.id, 'founder.setup', 'user', user.id, { username: uname });
  res.status(201).json({ token: signToken(user), user: publicUser(user) });
});

module.exports = router;
