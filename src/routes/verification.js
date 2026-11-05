// Verification: public badge info, application, status. Approval lives in admin routes.
const express = require('express');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const { publicUser } = require('../utils/helpers');
const { audit } = require('../middleware/roles');

const router = express.Router();

const BADGES = {
  blue: {
    name: 'Blue Verified', color: 'blue',
    meaning: 'This is an authentic account of a real individual, reviewed and approved by the Naija Wave team.',
    who: 'Individuals with a notable public presence — creators, journalists, athletes, artists and community voices.',
  },
  gold: {
    name: 'Gold Verified', color: 'gold',
    meaning: 'This is an official account of a recognised public figure, business, brand or organisation.',
    who: 'Public figures, companies, media houses, government bodies, NGOs and official brand accounts.',
  },
  founder: {
    name: 'Founder', color: 'gold',
    meaning: 'The official account of the founder of Naija Wave.',
    who: 'Reserved for the platform founder.',
  },
};

router.get('/badges', (req, res) => res.json({ badges: BADGES }));

// Apply for verification
router.post('/apply', authRequired, async (req, res) => {
  const { category, statement, links = [], org_name } = req.body || {};
  if (!['blue', 'gold'].includes(category)) return res.status(400).json({ error: 'Choose Blue (individual) or Gold (public figure / organisation).' });
  if (req.user.verification !== 'none') return res.status(400).json({ error: 'This account is already verified.' });
  if (!req.user.contact_verified) return res.status(403).json({ error: 'Verify your email/phone first.' });
  const pending = await db.get("SELECT id FROM verification_apps WHERE user_id = $1 AND status = 'pending'", req.user.id);
  if (pending) return res.status(409).json({ error: 'You already have an application under review.', code: 'ALREADY_PENDING' });
  const cleanStatement = String(statement || '').slice(0, 1000).trim();
  if (cleanStatement.length < 30) return res.status(400).json({ error: 'Tell us a bit more about yourself (at least 30 characters).' });
  const cleanLinks = (Array.isArray(links) ? links : []).map(l => String(l).slice(0, 300)).filter(l => /^https?:\/\//.test(l)).slice(0, 5);
  if (!cleanLinks.length) return res.status(400).json({ error: 'Add at least one public link as evidence (website or social profile).' });

  const info = await db.run(`INSERT INTO verification_apps (user_id, category, statement, links, org_name)
    VALUES ($1,$2,$3,$4,$5) RETURNING id`, req.user.id, category, cleanStatement, JSON.stringify(cleanLinks),
    category === 'gold' ? String(org_name || '').slice(0, 120) : null);
  await db.run(`INSERT INTO verification_history (user_id, action, category, note) VALUES ($1,$2,$3,$4) RETURNING id`,
    req.user.id, 'applied', category, 'Application submitted');
  await audit(req.user.id, 'verification.apply', 'verification_app', info.lastInsertRowid, { category });
  res.status(201).json({ application: { id: info.lastInsertRowid, category, status: 'pending' } });
});

// My application + history
router.get('/mine', authRequired, async (req, res) => {
  const app = await db.get('SELECT * FROM verification_apps WHERE user_id = $1 ORDER BY id DESC LIMIT 1', req.user.id);
  const history = await db.all('SELECT * FROM verification_history WHERE user_id = $1 ORDER BY id DESC LIMIT 20', req.user.id);
  const clean = (a) => a && ({
    id: a.id, category: a.category, status: a.status, note: a.note,
    statement: a.statement, links: JSON.parse(a.links || '[]'), org_name: a.org_name,
    created_at: a.created_at, decided_at: a.decided_at,
  });
  res.json({
    verification: req.user.verification,
    application: clean(app),
    history: history.map(h => ({ action: h.action, category: h.category, note: h.note, created_at: h.created_at })),
  });
});

module.exports = router;
