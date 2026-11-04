// Naija-originals: Pulse (discovery), People's Court, Naija Versus, Street Buzz.
const express = require('express');
const db = require('../db');
const { authRequired, authOptional } = require('../middleware/auth');
const { postLimiter } = require('../middleware/rateLimit');
const { publicUser } = require('../utils/helpers');
const { serializePost, visibilityWhere } = require('../utils/serialize');
const { CATEGORIES, categorize } = require('../utils/pulse');

const PAGE = 20;
const pageOf = (req) => Math.max(1, parseInt(req.query.page) || 1);

// ---------------- PULSE ----------------
const pulse = express.Router();
pulse.get('/', authOptional, (req, res) => {
  const rows = db.prepare(`
    SELECT h.tag, COUNT(DISTINCT ph.post_id) AS posts_count, MAX(p.created_at) AS latest
    FROM hashtags h
    JOIN post_hashtags ph ON ph.hashtag_id = h.id
    JOIN posts p ON p.id = ph.post_id
    WHERE p.deleted_at IS NULL AND p.created_at > datetime('now','-3 days')
    GROUP BY h.id HAVING posts_count >= 1
    ORDER BY posts_count DESC LIMIT 60`).all();
  const byCat = {};
  CATEGORIES.forEach(c => byCat[c] = []);
  rows.forEach(r => byCat[categorize(r.tag)].push({ tag: r.tag, posts_count: r.posts_count }));
  const categories = CATEGORIES.map(name => ({ name, topics: byCat[name].slice(0, 8) }))
    .filter(c => c.topics.length);
  res.json({ categories });
});

// ---------------- PEOPLE'S COURT ----------------
const court = express.Router();
function serializeCase(db, c, viewerId) {
  const options = db.prepare('SELECT id, text, votes FROM court_options WHERE case_id = ? ORDER BY id').all(c.id);
  const total = options.reduce((s, o) => s + o.votes, 0);
  let myVote = null;
  if (viewerId) {
    const v = db.prepare('SELECT option_id FROM court_votes WHERE case_id = ? AND user_id = ?').get(c.id, viewerId);
    if (v) myVote = v.option_id;
  }
  const comments = db.prepare('SELECT COUNT(*) c FROM court_comments WHERE case_id = ?').get(c.id).c;
  return {
    id: c.id, author: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(c.user_id)),
    question: c.question, context: c.context || '',
    options: options.map(o => ({ ...o, pct: total ? Math.round(o.votes / total * 100) : 0 })),
    total_votes: total, my_vote: myVote, comments_count: comments,
    created_at: c.created_at, ends_at: c.ends_at,
    ended: new Date(c.ends_at) < new Date(),
  };
}
court.get('/', authOptional, (req, res) => {
  const page = pageOf(req);
  const rows = db.prepare('SELECT * FROM court_cases ORDER BY id DESC LIMIT ? OFFSET ?').all(PAGE, (page - 1) * PAGE);
  const viewerId = req.user?.id || null;
  res.json({ items: rows.map(c => serializeCase(db, c, viewerId)), page, has_more: rows.length === PAGE });
});
court.post('/', authRequired, postLimiter, (req, res) => {
  const question = String(req.body?.question || '').slice(0, 300).trim();
  const context = String(req.body?.context || '').slice(0, 1000).trim();
  const options = (req.body?.options || []).map(o => String(o).slice(0, 80).trim()).filter(Boolean).slice(0, 4);
  if (!question || options.length < 2) return res.status(400).json({ error: 'Give a dilemma and 2–4 answer options.' });
  const hours = Math.min(168, Math.max(1, Number(req.body?.duration_hours) || 24));
  const ends = new Date(Date.now() + hours * 3600000).toISOString();
  const info = db.prepare('INSERT INTO court_cases (user_id, question, context, ends_at) VALUES (?,?,?,?)')
    .run(req.user.id, question, context, ends);
  const ins = db.prepare('INSERT INTO court_options (case_id, text) VALUES (?,?)');
  options.forEach(o => ins.run(info.lastInsertRowid, o));
  res.status(201).json({ case: serializeCase(db, db.prepare('SELECT * FROM court_cases WHERE id=?').get(info.lastInsertRowid), req.user.id) });
});
court.post('/:id/vote', authRequired, (req, res) => {
  const c = db.prepare('SELECT * FROM court_cases WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Case not found.' });
  if (new Date(c.ends_at) < new Date()) return res.status(400).json({ error: 'Voting has ended on this case.' });
  const opt = db.prepare('SELECT * FROM court_options WHERE id = ? AND case_id = ?').get(req.body?.option_id, c.id);
  if (!opt) return res.status(400).json({ error: 'Invalid option.' });
  const prev = db.prepare('SELECT * FROM court_votes WHERE case_id = ? AND user_id = ?').get(c.id, req.user.id);
  db.transaction(() => {
    if (prev) db.prepare('UPDATE court_options SET votes = votes - 1 WHERE id = ?').run(prev.option_id);
    else db.prepare('INSERT INTO court_votes (case_id, option_id, user_id) VALUES (?,?,?)').run(c.id, opt.id, req.user.id);
    if (prev) db.prepare('UPDATE court_votes SET option_id = ? WHERE id = ?').run(opt.id, prev.id);
    db.prepare('UPDATE court_options SET votes = votes + 1 WHERE id = ?').run(opt.id);
  })();
  res.json({ case: serializeCase(db, c, req.user.id) });
});
function courtComments(req, res) {
  const c = db.prepare('SELECT * FROM court_cases WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Case not found.' });
  const rows = db.prepare(`SELECT cc.*, u.username, u.display_name, u.avatar_url, u.verification
    FROM court_comments cc JOIN users u ON u.id = cc.user_id WHERE cc.case_id = ? ORDER BY cc.id ASC LIMIT 100`).all(c.id);
  res.json({ items: rows.map(r => ({ id: r.id, author: publicUser(r), text: r.text, created_at: r.created_at })) });
}
court.get('/:id/comments', courtComments);
court.post('/:id/comments', authRequired, postLimiter, (req, res) => {
  const c = db.prepare('SELECT * FROM court_cases WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Case not found.' });
  const text = String(req.body?.text || '').slice(0, 500).trim();
  if (!text) return res.status(400).json({ error: 'Comment can’t be empty.' });
  db.prepare('INSERT INTO court_comments (case_id, user_id, text) VALUES (?,?,?)').run(c.id, req.user.id, text);
  courtComments(req, res);
});

// ---------------- NAIJA VERSUS ----------------
const versus = express.Router();
function serializeBattle(db, b, viewerId) {
  const total = b.side_a_votes + b.side_b_votes;
  let mySide = null;
  if (viewerId) {
    const v = db.prepare('SELECT side FROM versus_votes WHERE battle_id = ? AND user_id = ?').get(b.id, viewerId);
    if (v) mySide = v.side;
  }
  const comments = db.prepare('SELECT COUNT(*) c FROM versus_comments WHERE battle_id = ?').get(b.id).c;
  return {
    id: b.id, author: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(b.user_id)),
    title: b.title,
    side_a: { label: b.side_a_label, image: b.side_a_image, votes: b.side_a_votes, pct: total ? Math.round(b.side_a_votes / total * 100) : 50 },
    side_b: { label: b.side_b_label, image: b.side_b_image, votes: b.side_b_votes, pct: total ? Math.round(b.side_b_votes / total * 100) : 50 },
    total_votes: total, my_side: mySide, comments_count: comments, created_at: b.created_at,
  };
}
versus.get('/', authOptional, (req, res) => {
  const page = pageOf(req);
  const rows = db.prepare('SELECT * FROM versus_battles ORDER BY id DESC LIMIT ? OFFSET ?').all(PAGE, (page - 1) * PAGE);
  const viewerId = req.user?.id || null;
  res.json({ items: rows.map(b => serializeBattle(db, b, viewerId)), page, has_more: rows.length === PAGE });
});
versus.post('/', authRequired, postLimiter, (req, res) => {
  const title = String(req.body?.title || '').slice(0, 140).trim();
  const a = String(req.body?.side_a_label || '').slice(0, 60).trim();
  const b = String(req.body?.side_b_label || '').slice(0, 60).trim();
  if (!title || !a || !b) return res.status(400).json({ error: 'Title and both sides are required.' });
  const info = db.prepare(`INSERT INTO versus_battles
    (user_id, title, side_a_label, side_a_image, side_b_label, side_b_image) VALUES (?,?,?,?,?,?)`)
    .run(req.user.id, title, a, req.body?.side_a_image || null, b, req.body?.side_b_image || null);
  res.status(201).json({ battle: serializeBattle(db, db.prepare('SELECT * FROM versus_battles WHERE id=?').get(info.lastInsertRowid), req.user.id) });
});
versus.post('/:id/vote', authRequired, (req, res) => {
  const b = db.prepare('SELECT * FROM versus_battles WHERE id = ?').get(req.params.id);
  if (!b) return res.status(404).json({ error: 'Battle not found.' });
  const side = req.body?.side === 'b' ? 'b' : 'a';
  const prev = db.prepare('SELECT * FROM versus_votes WHERE battle_id = ? AND user_id = ?').get(b.id, req.user.id);
  db.transaction(() => {
    if (prev && prev.side !== side) {
      db.prepare(`UPDATE versus_battles SET side_${prev.side}_votes = side_${prev.side}_votes - 1 WHERE id = ?`).run(b.id);
      db.prepare('UPDATE versus_votes SET side = ? WHERE id = ?').run(side, prev.id);
      db.prepare(`UPDATE versus_battles SET side_${side}_votes = side_${side}_votes + 1 WHERE id = ?`).run(b.id);
    } else if (!prev) {
      db.prepare('INSERT INTO versus_votes (battle_id, user_id, side) VALUES (?,?,?)').run(b.id, req.user.id, side);
      db.prepare(`UPDATE versus_battles SET side_${side}_votes = side_${side}_votes + 1 WHERE id = ?`).run(b.id);
    }
  })();
  res.json({ battle: serializeBattle(db, db.prepare('SELECT * FROM versus_battles WHERE id=?').get(b.id), req.user.id) });
});
function versusComments(req, res) {
  const b = db.prepare('SELECT * FROM versus_battles WHERE id = ?').get(req.params.id);
  if (!b) return res.status(404).json({ error: 'Battle not found.' });
  const rows = db.prepare(`SELECT vc.*, u.username, u.display_name, u.avatar_url, u.verification
    FROM versus_comments vc JOIN users u ON u.id = vc.user_id WHERE vc.battle_id = ? ORDER BY vc.id ASC LIMIT 100`).all(b.id);
  res.json({ items: rows.map(r => ({ id: r.id, author: publicUser(r), text: r.text, created_at: r.created_at })) });
}
versus.get('/:id/comments', versusComments);
versus.post('/:id/comments', authRequired, postLimiter, (req, res) => {
  const b = db.prepare('SELECT * FROM versus_battles WHERE id = ?').get(req.params.id);
  if (!b) return res.status(404).json({ error: 'Battle not found.' });
  const text = String(req.body?.text || '').slice(0, 500).trim();
  if (!text) return res.status(400).json({ error: 'Comment can’t be empty.' });
  db.prepare('INSERT INTO versus_comments (battle_id, user_id, text) VALUES (?,?,?)').run(b.id, req.user.id, text);
  versusComments(req, res);
});

// ---------------- STREET BUZZ ----------------
const buzz = express.Router();
buzz.get('/', authOptional, (req, res) => {
  const page = pageOf(req);
  const viewerId = req.user?.id || null;
  const v = visibilityWhere(viewerId);
  const category = req.query.category; // events|traffic|announcements|gist
  const location = String(req.query.location || '').trim();
  let extra = '', params = [...v.params];
  if (category) { extra += ' AND p.location IS NOT NULL'; } // category via hashtag convention below
  if (location) { extra += ' AND p.location LIKE ?'; params.push('%' + location + '%'); }
  if (category) {
    // buzz categories are tracked with hashtags: #buzz-events etc.
    extra += ` AND EXISTS (SELECT 1 FROM post_hashtags ph JOIN hashtags h ON h.id=ph.hashtag_id
      WHERE ph.post_id = p.id AND h.tag = ?)`;
    params.push('buzz-' + category);
  }
  const rows = db.prepare(`SELECT p.* FROM posts p WHERE p.deleted_at IS NULL AND p.section='buzz'
    AND ${v.where} ${extra} ORDER BY p.id DESC LIMIT ? OFFSET ?`).all(...params, PAGE, (page - 1) * PAGE);
  res.json({ items: rows.map(r => serializePost(db, r, viewerId)), page, has_more: rows.length === PAGE });
});

module.exports = { pulse, court, versus, buzz };
