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

// Brevo transactional email (free tier). Env: BREVO_API_KEY, BREVO_SENDER_EMAIL
// (the sender address must be verified in Brevo: Settings → Senders).
async function sendBrevoEmail(to, code, purpose) {
  const key = process.env.BREVO_API_KEY;
  const senderEmail = process.env.BREVO_SENDER_EMAIL;
  if (!key || !senderEmail) return { ok: false, reason: 'NOT_CONFIGURED' };
  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': key, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        sender: { name: 'Naija Wave', email: senderEmail },
        to: [{ email: to }],
        subject: 'Your Naija Wave verification code',
        htmlContent: `<p>Your Naija Wave verification code is:</p><h2 style="letter-spacing:4px">${code}</h2><p>It expires in 10 minutes. If you didn't request this, ignore this email.</p>`,
        textContent: `Your Naija Wave verification code is: ${code}. It expires in 10 minutes.`,
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      console.log(`[naijawave][OTP:${purpose}] Brevo send failed (${res.status}): ${t.slice(0, 300)}`);
      return { ok: false, reason: 'PROVIDER_ERROR' };
    }
    return { ok: true };
  } catch (e) {
    console.log(`[naijawave][OTP:${purpose}] Brevo send error: ${e.message}`);
    return { ok: false, reason: 'PROVIDER_ERROR' };
  }
}

// Returns { devOtp } in dev mode, { delivered } / { error } in live mode.
async function issueOtp(contact, purpose) {
  await db.run('DELETE FROM otps WHERE contact = $1 AND purpose = $2', contact, purpose);
  const code = newOtpCode();
  const expires = new Date(Date.now() + OTP_TTL_MIN * 60000).toISOString();
  await db.run('INSERT INTO otps (contact, code, purpose, expires_at) VALUES ($1,$2,$3,$4) RETURNING id',
    contact, code, purpose, expires);
  if (OTP_MODE === 'dev') {
    console.log(`[naijawave][OTP:${purpose}] code for ${contact}: ${code} (dev mode — shown because no SMS/email provider is configured)`);
    return { devOtp: code };
  }
  if (contact.includes('@')) {
    const r = await sendBrevoEmail(contact, code, purpose);
    if (r.ok) return { delivered: true };
    return { error: r.reason };
  }
  // LIVE mode + phone: SMS provider (Termii) not configured yet.
  console.log(`[naijawave][OTP:${purpose}] LIVE mode: SMS provider not configured — cannot deliver to ${contact}.`);
  return { error: 'SMS_NOT_CONFIGURED' };
}

async function checkOtp(contact, purpose, code) {
  const row = await db.get(
    `SELECT * FROM otps WHERE contact = $1 AND purpose = $2 ORDER BY id DESC LIMIT 1`, contact, purpose);
  if (!row) return { ok: false, reason: 'NO_CODE' };
  if (new Date(row.expires_at) < new Date()) return { ok: false, reason: 'EXPIRED' };
  if (row.attempts >= 5) return { ok: false, reason: 'LOCKED' };
  if (row.code !== String(code).trim()) {
    await db.run('UPDATE otps SET attempts = attempts + 1 WHERE id = $1', row.id);
    return { ok: false, reason: 'WRONG' };
  }
  await db.run('DELETE FROM otps WHERE contact = $1 AND purpose = $2', contact, purpose);
  return { ok: true };
}

async function findByContact(contact) {
  const c = String(contact).trim().toLowerCase();
  return db.get('SELECT * FROM users WHERE lower(email) = $1 OR phone = $2', c, contact);
}

// ---------- REGISTER ----------
router.post('/register', authLimiter, async (req, res) => {
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
    ? await db.get('SELECT id FROM users WHERE lower(email) = $1', norm)
    : await db.get('SELECT id FROM users WHERE phone = $1', norm);
  if (takenContact) return res.status(409).json({ error: 'This ' + type + ' is already registered. Try logging in.', code: 'CONTACT_TAKEN' });
  if (await db.get('SELECT id FROM users WHERE username = $1', uname))
    return res.status(409).json({ error: 'That username is taken — try another.', code: 'USERNAME_TAKEN' });

  const hash = bcrypt.hashSync(password, 10);
  const info = await db.run(`INSERT INTO users
    (username, display_name, email, phone, contact_type, dob, password_hash)
    VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    uname, dname,
    type === 'email' ? norm : null,
    type === 'phone' ? norm : null,
    type, dob, hash);
  const user = await db.get('SELECT * FROM users WHERE id = $1', info.lastInsertRowid);
  const otp = await issueOtp(norm, 'register');

  res.status(201).json({
    user: publicUser(user),
    otp_sent_to: maskContact(norm, type),
    contact: norm,
    ...(otp.devOtp ? { dev_otp: otp.devOtp, dev_note: 'DEV MODE: no SMS/email provider configured — this code is shown for testing. See docs/DEPLOYMENT.md.' } : {}),
    ...(otp.error ? { otp_error: otp.error } : {}),
  });
});

// ---------- VERIFY OTP ----------
router.post('/verify-otp', otpVerifyLimiter, async (req, res) => {
  const { contact, code } = req.body || {};
  if (!contact || !code) return res.status(400).json({ error: 'Contact and code are required.' });
  const norm = String(contact).trim();
  const check = await checkOtp(norm, 'register', code);
  if (!check.ok) {
    const msg = { NO_CODE: 'No code was sent to this contact — request a new one.', EXPIRED: 'That code expired — request a new one.', LOCKED: 'Too many wrong attempts — request a new code.', WRONG: 'Wrong code — try again.' }[check.reason];
    return res.status(400).json({ error: msg, code: check.reason });
  }
  const user = await findByContact(norm);
  if (!user) return res.status(404).json({ error: 'Account not found.' });
  await db.run('UPDATE users SET contact_verified = 1 WHERE id = $1', user.id);
  const fresh = await db.get('SELECT * FROM users WHERE id = $1', user.id);
  res.json({ token: signToken(fresh), user: publicUser(fresh) });
});

router.post('/resend-otp', resendLimiter, async (req, res) => {
  const { contact } = req.body || {};
  if (!contact) return res.status(400).json({ error: 'Contact is required.' });
  const norm = String(contact).trim();
  const recent = await db.get(
    `SELECT COUNT(*)::int c FROM otps WHERE contact = $1 AND created_at > NOW() - INTERVAL '1 hour'`, norm);
  if (recent.c >= 3) return res.status(429).json({ error: 'Too many codes sent — try again later.', code: 'RESEND_LIMIT' });
  const otp = await issueOtp(norm, 'register');
  res.json({ otp_sent_to: maskContact(norm, norm.includes('@') ? 'email' : 'phone'), ...(otp.devOtp ? { dev_otp: otp.devOtp } : {}), ...(otp.error ? { otp_error: otp.error } : {}) });
});

// ---------- LOGIN ----------
router.post('/login', authLimiter, async (req, res) => {
  const { contact, password } = req.body || {};
  if (!contact || !password) return res.status(400).json({ error: 'Contact and password are required.' });
  let norm = String(contact).trim();
  if (!norm.includes('@')) norm = normalizeContact(norm, 'phone');
  const user = await findByContact(norm);
  if (!user || !bcrypt.compareSync(password, user.password_hash))
    return res.status(401).json({ error: 'Wrong contact or password.', code: 'INVALID_CREDENTIALS' });
  if (!user.contact_verified)
    return res.status(403).json({ error: 'Please verify your OTP code first.', code: 'NOT_VERIFIED', contact: norm });
  if (user.status === 'suspended')
    return res.status(403).json({ error: 'This account has been suspended.', code: 'SUSPENDED' });
  res.json({ token: signToken(user), user: publicUser(user) });
});

// ---------- PASSWORD RECOVERY ----------
router.post('/forgot-password', resendLimiter, async (req, res) => {
  const { contact } = req.body || {};
  if (!contact) return res.status(400).json({ error: 'Contact is required.' });
  let norm = String(contact).trim();
  if (!norm.includes('@')) norm = normalizeContact(norm, 'phone');
  const user = await findByContact(norm);
  // Always respond OK (don't leak which contacts exist), but only send if user exists.
  if (user) issueOtp(norm, 'reset').catch(() => {});
  res.json({ ok: true, note: 'If an account exists for this contact, a reset code was sent.' ,
    ...(OTP_MODE === 'dev' && user ? { dev_hint: 'Dev mode: check the server console for the code.' } : {}) });
});

router.post('/reset-password', otpVerifyLimiter, async (req, res) => {
  const { contact, code, password } = req.body || {};
  if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.', code: 'WEAK_PASSWORD' });
  let norm = String(contact || '').trim();
  if (!norm.includes('@')) norm = normalizeContact(norm, 'phone');
  const check = await checkOtp(norm, 'reset', code);
  if (!check.ok) return res.status(400).json({ error: 'Invalid or expired reset code.', code: check.reason });
  const user = await findByContact(norm);
  if (!user) return res.status(404).json({ error: 'Account not found.' });
  await db.run('UPDATE users SET password_hash = $1 WHERE id = $2', bcrypt.hashSync(password, 10), user.id);
  res.json({ ok: true });
});

// ---------- ME / LOGOUT ----------
router.get('/me', authRequired, async (req, res) => {
  const u = req.user;
  const app = await db.get(`SELECT id, category, status, note, created_at FROM verification_apps
                          WHERE user_id = $1 ORDER BY id DESC LIMIT 1`, u.id);
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
