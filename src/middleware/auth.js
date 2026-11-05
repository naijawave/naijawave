// Auth middleware: verifies JWT, attaches req.user (fresh from DB)
const jwt = require('jsonwebtoken');
const db = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
if (!process.env.JWT_SECRET) console.warn('[naijawave] WARNING: JWT_SECRET not set — using dev default. Set it in production!');

function signToken(user) {
  return jwt.sign({ uid: user.id }, JWT_SECRET, { expiresIn: '30d' });
}

async function authRequired(req, res, next) {
  const hdr = req.headers.authorization || '';
  const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Login required.', code: 'NO_TOKEN' });
  let payload;
  try { payload = jwt.verify(token, JWT_SECRET); }
  catch { return res.status(401).json({ error: 'Session expired. Please log in again.', code: 'BAD_TOKEN' }); }
  const user = await db.get('SELECT * FROM users WHERE id = $1', payload.uid);
  if (!user) return res.status(401).json({ error: 'Account not found.', code: 'NO_USER' });
  if (user.status === 'suspended') return res.status(403).json({ error: 'This account has been suspended.', code: 'SUSPENDED' });
  req.user = user;
  next();
}

// Optional auth: attaches user if token present & valid, never rejects
async function authOptional(req, res, next) {
  const hdr = req.headers.authorization || '';
  const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : null;
  if (token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      const user = await db.get('SELECT * FROM users WHERE id = $1', payload.uid);
      if (user && user.status !== 'suspended') req.user = user;
    } catch { /* ignore */ }
  }
  next();
}

module.exports = { signToken, authRequired, authOptional, JWT_SECRET };
