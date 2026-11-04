// Auth: register (email/phone + OTP + password), login, password recovery.
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { signToken, authRequired } = require('../middleware/auth');
const { authLimiter, otpVerifyLimiter, resendLimiter } = require('../middleware/rateLimit');
const { USERNAME_RE, normalizeContact, validContact, ageFromDob, publicUser, maskContact, newOtpCode } = require('../utils/helpers');

const router = express.Router();
const OTP_MODE = process.env.OTP_MODE || 'dev'; // 'dev' | 'live'
const OTP_TTL_MIN = 10;

function issueOtp(contact, purpose) {
  db.prepare('DELETE FROM otps WHERE contact = ? AND purpose = ?').run(contact, purpose);
  const code = newOtpCode();
  const expires = new Date(Date.now() + OTP_TTL_MIN * 60000).toISOString();
  db.prepare('INSERT INTO otps (contact, code, purpose, expires_at) VALUES (?,?,?,?)')
    .run(contact, code, purpose, expires);
  if (OTP_MODE === 'dev') {
    console.log(`[naijawave][OTP:${purpose}] code for ${contact}: ${code} (dev mode — shown because no SMS/email provider is configured)`);
    return code;
  }
  // LIVE mode: plug in your provider here (Termii for Nigerian SMS, or SMTP for email).
  console.log(`[naijawave][OTP:${purpose}] LIVE mode: provider not configured — cannot deliver to ${contact}. Set up Termii/SMTP (see docs/DEPLOYMENT.md).`);
  return null;
}

function checkOtp(contact, purpose, code) {
  const row = db.prepare(
    `SELECT * FROM otps WHERE contact = ? AND purpose = ? ORDER BY id DESC LIMIT 1`).get(contact, purpose);
  if (!row) return { ok: false, reason: 'NO_CODE' };
  if (new Date(row.expires_at) < new Date()) return { ok: false, reason: 'EXPIRED' };
  if (row.attempts >= 5) return { ok: false, reason: 'LOCKED' };
  if (row.code !== String(code).trim()) {
    db.prepare('UPDATE otps SET attempts = attempts + 1 WHERE id = ?').run(row.id);
    return { ok: false, reason: 'WRONG' };
  }
  db.prepare('DELETE FROM otps WHERE contact = ? AND purpose = ?').run(contact, purpose);
  return { ok: true };
}

function findByContact(contact) {
  const c = String(contact).trim().toLowerCase();
  return db.prepare('SELECT * FROM users WHERE lower(email) = ? OR phone = ?').get(c, contact);
}

// ---------- REGISTER ----------
router.post('/register', authLimiter, (req, res) => {
  const { contact, contact_type, password, username, display_name, dob } = req.body || {};
  const type = contact_type === 'phone' ? 'phone' : 'email';
  const norm = normalizeContact(contact, type);

  if (!validContact(norm, type)) return res.status(400).json({ error: type === 'email' ? 'Enter a valid email address.' : 'Enter a valid phone number (e.g. +2348012345678).', code: 'INVALID_CONTACT' });
  if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.', code: 'WEAK_PASSWORD' });
  const uname = String(username || '').trim().toLowerCase();
  if (!USERNAME_RE.test(uname)) return res.status(400).json({ error: 'Username: 3–20 chars, letters/numbers/_/. only.', code: 'INVALID_USERNAME' });
  const dname = String(display_name || '').trim().slice(0, 40);
  if (!dname) return res.status(400).json({ error: 'Display name is required.', code: 'INVALID_NAME' });
  const age = ageFromDob(dob);
  if (age === null) return res.status(400).json({ error: 'Enter a valid date of birth.', code: 'INVALID_DOB' });
  if (age < 13) return res.status(400).json({ error: 'You must be at least 13 to join Naija Wave.', code: 'UNDERAGE' });

  const takenContact = type === 'email'
    ? db.prepare('SELECT id FROM users WHERE lower(email) = ?').get(norm)
    : db.prepare('SELECT id FROM users WHERE phone = ?').get(norm);
  if (takenContact) return res.status(409).json({ error: 'This ' + type + ' is already registered. Try logging in.', code: 'CONTACT_TAKEN' });
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(uname))
    return res.status(409).json({ error: 'That username is taken — try another.', code: 'USERNAME_TAKEN' });

  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare(`INSERT INTO users
    (username, display_name, email, phone, contact_type, dob, password_hash)
    VALUES (?,?,?,?,?,?,?)`).run(
    uname, dname,
    type === 'email' ? norm : null,
    type === 'phone' ? norm : null,
    type, dob, hash);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  const devOtp = issueOtp(norm, 'register');

  res.status(201).json({
    user: publicUser(user),
    otp_sent_to: maskContact(norm, type),
    contact: norm,
    ...(devOtp ? { dev_otp: devOtp, dev_note: 'DEV MODE: no SMS/email provider configured — this code is shown for testing. See docs/DEPLOYMENT.md.' } : {}),
  });
});

// ---------- VERIFY OTP ----------
router.post('/verify-otp', otpVerifyLimiter, (req, res) => {
  const { contact, code } = req.body || {};
  if (!contact || !code) return res.status(400).json({ error: 'Contact and code are required.' });
  const norm = String(contact).trim();
  const check = checkOtp(norm, 'register', code);
  if (!check.ok) {
    const msg = { NO_CODE: 'No code was sent to this contact — request a new one.', EXPIRED: 'That code expired — request a new one.', LOCKED: 'Too many wrong attempts — request a new code.', WRONG: 'Wrong code — try again.' }[check.reason];
    return res.status(400).json({ error: msg, code: check.reason });
  }
  const user = findByContact(norm);
  if (!user) return res.status(404).json({ error: 'Account not found.' });
  db.prepare('UPDATE users SET contact_verified = 1 WHERE id = ?').run(user.id);
  const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  res.json({ token: signToken(fresh), user: publicUser(fresh) });
});

router.post('/resend-otp', resendLimiter, (req, res) => {
  const { contact } = req.body || {};
  if (!contact) return res.status(400).json({ error: 'Contact is required.' });
  const norm = String(contact).trim();
  const recent = db.prepare(
    `SELECT COUNT(*) c FROM otps WHERE contact = ? AND created_at > datetime('now','-1 hour')`).get(norm).c;
  if (recent >= 3) return res.status(429).json({ error: 'Too many codes sent — try again later.', code: 'RESEND_LIMIT' });
  const devOtp = issueOtp(norm, 'register');
  res.json({ otp_sent_to: maskContact(norm, norm.includes('@') ? 'email' : 'phone'), ...(devOtp ? { dev_otp: devOtp } : {}) });
});

// ---------- LOGIN ----------
router.post('/login', authLimiter, (req, res) => {
  const { contact, password } = req.body || {};
  if (!contact || !password) return res.status(400).json({ error: 'Contact and password are required.' });
  let norm = String(contact).trim();
  if (!norm.includes('@')) norm = normalizeContact(norm, 'phone');
  const user = findByContact(norm);
  if (!user || !bcrypt.compareSync(password, user.password_hash))
    return res.status(401).json({ error: 'Wrong contact or password.', code: 'INVALID_CREDENTIALS' });
  if (!user.contact_verified)
    return res.status(403).json({ error: 'Please verify your OTP code first.', code: 'NOT_VERIFIED', contact: norm });
  if (user.status === 'suspended')
    return res.status(403).json({ error: 'This account has been suspended.', code: 'SUSPENDED' });
  res.json({ token: signToken(user), user: publicUser(user) });
});

// ---------- PASSWORD RECOVERY ----------
router.post('/forgot-password', resendLimiter, (req, res) => {
  const { contact } = req.body || {};
  if (!contact) return res.status(400).json({ error: 'Contact is required.' });
  let norm = String(contact).trim();
  if (!norm.includes('@')) norm = normalizeContact(norm, 'phone');
  const user = findByContact(norm);
  // Always respond OK (don't leak which contacts exist), but only send if user exists.
  if (user) issueOtp(norm, 'reset');
  res.json({ ok: true, note: 'If an account exists for this contact, a reset code was sent.' ,
    ...(OTP_MODE === 'dev' && user ? { dev_hint: 'Dev mode: check the server console for the code.' } : {}) });
});

router.post('/reset-password', otpVerifyLimiter, (req, res) => {
  const { contact, code, password } = req.body || {};
  if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.', code: 'WEAK_PASSWORD' });
  let norm = String(contact || '').trim();
  if (!norm.includes('@')) norm = normalizeContact(norm, 'phone');
  const check = checkOtp(norm, 'reset', code);
  if (!check.ok) return res.status(400).json({ error: 'Invalid or expired reset code.', code: check.reason });
  const user = findByContact(norm);
  if (!user) return res.status(404).json({ error: 'Account not found.' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(password, 10), user.id);
  res.json({ ok: true });
});

// ---------- ME / LOGOUT ----------
router.get('/me', authRequired, (req, res) => {
  const u = req.user;
  const app = db.prepare(`SELECT id, category, status, note, created_at FROM verification_apps
                          WHERE user_id = ? ORDER BY id DESC LIMIT 1`).get(u.id);
  res.json({
    user: {
      ...publicUser(u),
      contact: maskContact(u.email || u.phone, u.contact_type),
      contact_type: u.contact_type, dob: u.dob,
      prefs: (() => { try { return JSON.parse(u.prefs); } catch { return {}; } })(),
      verification_app: app || null,
    },
  });
});

router.post('/logout', authRequired, (req, res) => res.json({ ok: true }));

module.exports = router;
