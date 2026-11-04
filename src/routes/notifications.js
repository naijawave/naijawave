// Notifications: list, read, unread count, preferences.
const express = require('express');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const { publicUser } = require('../utils/helpers');
const { getPrefs } = require('../utils/notify');

const router = express.Router();
const TYPES = ['follow', 'like', 'comment', 'reply', 'repost', 'mention', 'message', 'call_missed', 'verification', 'announcement'];

function serialize(n) {
  const actor = n.actor_id ? publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(n.actor_id)) : null;
  let data = {}; try { data = JSON.parse(n.data || '{}'); } catch {}
  return { id: n.id, type: n.type, actor, post_id: n.post_id, conversation_id: n.conversation_id,
           text: n.text, data, read: !!n.read, created_at: n.created_at };
}

router.get('/', authRequired, (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const rows = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 30 OFFSET ?')
    .all(req.user.id, (page - 1) * 30);
  res.json({ items: rows.map(serialize), page, has_more: rows.length === 30 });
});

router.get('/unread-count', authRequired, (req, res) => {
  const c = db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND read = 0').get(req.user.id).n;
  res.json({ count: c });
});

router.post('/:id/read', authRequired, (req, res) => {
  db.prepare('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

router.post('/read-all', authRequired, (req, res) => {
  db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(req.user.id);
  res.json({ ok: true });
});

router.get('/prefs', authRequired, (req, res) => {
  const prefs = getPrefs(req.user.id);
  const out = {};
  TYPES.forEach(t => out[t] = prefs[t] !== false);
  out.show_online = prefs.show_online !== false;
  out.read_receipts = prefs.read_receipts !== false;
  out.who_can_message = prefs.who_can_message || 'everyone';
  res.json({ prefs: out });
});

router.patch('/prefs', authRequired, (req, res) => {
  const body = req.body?.prefs || {};
  const cur = getPrefs(req.user.id);
  const next = { ...cur };
  TYPES.forEach(t => { if (body[t] !== undefined) next[t] = !!body[t]; });
  if (body.show_online !== undefined) next.show_online = !!body.show_online;
  if (body.read_receipts !== undefined) next.read_receipts = !!body.read_receipts;
  if (['everyone', 'followed'].includes(body.who_can_message)) next.who_can_message = body.who_can_message;
  db.prepare('INSERT INTO notification_prefs (user_id, prefs) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET prefs = ?')
    .run(req.user.id, JSON.stringify(next), JSON.stringify(next));
  res.json({ ok: true });
});

module.exports = router;
