// Notifications: list, read, unread count, preferences.
const express = require('express');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const { publicUser } = require('../utils/helpers');
const { getPrefs } = require('../utils/notify');

const router = express.Router();
const TYPES = ['follow', 'like', 'comment', 'reply', 'repost', 'mention', 'message', 'call_missed', 'verification', 'announcement'];

async function serialize(n) {
  const actor = n.actor_id ? publicUser(await db.get('SELECT * FROM users WHERE id=$1', n.actor_id)) : null;
  let data = {}; try { data = JSON.parse(n.data || '{}'); } catch {}
  return { id: n.id, type: n.type, actor, post_id: n.post_id, conversation_id: n.conversation_id,
           text: n.text, data, read: !!n.read, created_at: n.created_at };
}

router.get('/', authRequired, async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const rows = await db.all('SELECT * FROM notifications WHERE user_id = $1 ORDER BY id DESC LIMIT 30 OFFSET $2',
    req.user.id, (page - 1) * 30);
  res.json({ items: await Promise.all(rows.map(serialize)), page, has_more: rows.length === 30 });
});

router.get('/unread-count', authRequired, async (req, res) => {
  const c = (await db.get('SELECT COUNT(*)::int n FROM notifications WHERE user_id = $1 AND read = 0', req.user.id)).n;
  res.json({ count: c });
});

router.post('/:id/read', authRequired, async (req, res) => {
  await db.run('UPDATE notifications SET read = 1 WHERE id = $1 AND user_id = $2', req.params.id, req.user.id);
  res.json({ ok: true });
});

router.post('/read-all', authRequired, async (req, res) => {
  await db.run('UPDATE notifications SET read = 1 WHERE user_id = $1', req.user.id);
  res.json({ ok: true });
});

router.get('/prefs', authRequired, async (req, res) => {
  const prefs = await getPrefs(req.user.id);
  const out = {};
  TYPES.forEach(t => out[t] = prefs[t] !== false);
  out.show_online = prefs.show_online !== false;
  out.read_receipts = prefs.read_receipts !== false;
  out.who_can_message = prefs.who_can_message || 'everyone';
  res.json({ prefs: out });
});

router.patch('/prefs', authRequired, async (req, res) => {
  const body = req.body?.prefs || {};
  const cur = await getPrefs(req.user.id);
  const next = { ...cur };
  TYPES.forEach(t => { if (body[t] !== undefined) next[t] = !!body[t]; });
  if (body.show_online !== undefined) next.show_online = !!body.show_online;
  if (body.read_receipts !== undefined) next.read_receipts = !!body.read_receipts;
  if (['everyone', 'followed'].includes(body.who_can_message)) next.who_can_message = body.who_can_message;
  await db.run('INSERT INTO notification_prefs (user_id, prefs) VALUES ($1,$2) ON CONFLICT(user_id) DO UPDATE SET prefs = $3',
    req.user.id, JSON.stringify(next), JSON.stringify(next));
  res.json({ ok: true });
});

module.exports = router;
