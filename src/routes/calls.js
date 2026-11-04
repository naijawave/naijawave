// Call history (REST). Live signalling is Socket.IO — see src/socket/index.js.
const express = require('express');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const { publicUser } = require('../utils/helpers');

const router = express.Router();

router.post('/log', authRequired, (req, res) => {
  const { other_user_id, kind, duration_sec = 0, status } = req.body || {};
  const other = Number(other_user_id);
  if (!other || !['voice', 'video'].includes(kind) || !['completed', 'missed', 'rejected', 'failed'].includes(status))
    return res.status(400).json({ error: 'Invalid call log.' });
  db.prepare(`INSERT INTO calls (caller_id, callee_id, kind, status, duration_sec, ended_at)
    VALUES (?,?,?,?,?,datetime('now'))`).run(req.user.id, other, kind, status, Math.max(0, Number(duration_sec) || 0));
  res.json({ ok: true });
});

router.get('/history', authRequired, (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const me = req.user.id;
  const rows = db.prepare(`SELECT * FROM calls WHERE caller_id = ? OR callee_id = ?
    ORDER BY id DESC LIMIT 30 OFFSET ?`).all(me, me, (page - 1) * 30);
  const items = rows.map(c => {
    const otherId = c.caller_id === me ? c.callee_id : c.caller_id;
    const direction = c.caller_id === me ? 'outgoing' : 'incoming';
    return {
      id: c.id, kind: c.kind, status: c.status, duration_sec: c.duration_sec,
      direction, other_user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(otherId)),
      started_at: c.started_at,
    };
  });
  res.json({ items, page, has_more: rows.length === 30 });
});

module.exports = router;
