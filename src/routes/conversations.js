// Conversations & messages (REST). Realtime send/delivery/read/typing lives in socket/.
const express = require('express');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const { publicUser } = require('../utils/helpers');
const realtime = require('../realtime');

const router = express.Router();
const PAGE = 30;

async function serializeMessage(db, m) {
  let media = null;
  if (m.media_id) media = await db.get('SELECT id, url, kind, mime, size, duration FROM media WHERE id = $1', m.media_id);
  return {
    id: m.id, conversation_id: m.conversation_id, sender_id: m.sender_id,
    kind: m.kind, text: m.text || '', media,
    status: m.status, deleted: !!m.deleted, created_at: m.created_at,
  };
}

async function isMember(conversationId, userId) {
  return !!(await db.get('SELECT 1 FROM conversation_members WHERE conversation_id = $1 AND user_id = $2',
    conversationId, userId));
}

async function otherUser(conversationId, meId) {
  const row = await db.get(`SELECT u.* FROM conversation_members cm JOIN users u ON u.id = cm.user_id
    WHERE cm.conversation_id = $1 AND cm.user_id != $2 LIMIT 1`, conversationId, meId);
  return publicUser(row);
}

// GET /api/conversations
router.get('/', authRequired, async (req, res) => {
  const me = req.user.id;
  const convs = await db.all(`
    SELECT c.* FROM conversations c
    JOIN conversation_members cm ON cm.conversation_id = c.id
    WHERE cm.user_id = $1 AND cm.hidden_at IS NULL
    ORDER BY c.updated_at DESC LIMIT 50`, me);
  const items = await Promise.all(convs.map(async c => {
    const last = await db.get('SELECT * FROM messages WHERE conversation_id = $1 AND deleted = 0 ORDER BY id DESC LIMIT 1', c.id);
    const unread = (await db.get(`SELECT COUNT(*)::int n FROM messages WHERE conversation_id = $1 AND sender_id != $2 AND status != 'read' AND deleted = 0`, c.id, me)).n;
    return {
      id: c.id, other_user: await otherUser(c.id, me),
      last_message: last ? await serializeMessage(db, last) : null,
      unread_count: unread, updated_at: c.updated_at,
    };
  }));
  res.json({ items });
});

// POST /api/conversations { user_id } — idempotent
router.post('/', authRequired, async (req, res) => {
  const otherId = Number(req.body?.user_id);
  if (!otherId || otherId === req.user.id) return res.status(400).json({ error: 'Invalid user.' });
  const other = await db.get("SELECT * FROM users WHERE id = $1 AND status = 'active'", otherId);
  if (!other) return res.status(404).json({ error: 'User not found.' });
  const blocked = await db.get('SELECT 1 FROM blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$3 AND blocked_id=$4)',
    req.user.id, otherId, otherId, req.user.id);
  if (blocked) return res.status(403).json({ error: 'You can’t message this account.', code: 'BLOCKED' });
  // privacy: who can message me
  let prefs = {}; try { prefs = JSON.parse(other.prefs || '{}'); } catch {}
  if (prefs.who_can_message === 'followed') {
    const follows = await db.get('SELECT 1 FROM follows WHERE follower_id = $1 AND followee_id = $2', req.user.id, otherId);
    if (!follows) return res.status(403).json({ error: `@${other.username} only accepts messages from people they follow.`, code: 'DM_CLOSED' });
  }

  const existing = await db.get(`
    SELECT c.id FROM conversations c
    JOIN conversation_members m1 ON m1.conversation_id = c.id AND m1.user_id = $1
    JOIN conversation_members m2 ON m2.conversation_id = c.id AND m2.user_id = $2
    LIMIT 1`, req.user.id, otherId);
  let convId;
  if (existing) {
    convId = existing.id;
    await db.run('UPDATE conversation_members SET hidden_at = NULL WHERE conversation_id = $1 AND user_id = $2', convId, req.user.id);
  } else {
    const info = await db.run('INSERT INTO conversations DEFAULT VALUES RETURNING id');
    convId = info.lastInsertRowid;
    await db.run('INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1,$2),($3,$4) RETURNING id',
      convId, req.user.id, convId, otherId);
  }
  res.status(201).json({ conversation: { id: convId, other_user: publicUser(other) } });
});

// GET /api/conversations/:id/messages
router.get('/:id/messages', authRequired, async (req, res) => {
  const convId = Number(req.params.id);
  if (!(await isMember(convId, req.user.id))) return res.status(404).json({ error: 'Conversation not found.' });
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const rows = await db.all(`SELECT * FROM messages WHERE conversation_id = $1 ORDER BY id DESC LIMIT $2 OFFSET $3`,
    convId, PAGE, (page - 1) * PAGE);
  res.json({ items: await Promise.all(rows.reverse().map(m => serializeMessage(db, m))), page, has_more: rows.length === PAGE });
});

// POST /api/conversations/:id/read
router.post('/:id/read', authRequired, async (req, res) => {
  const convId = Number(req.params.id);
  if (!(await isMember(convId, req.user.id))) return res.status(404).json({ error: 'Conversation not found.' });
  await db.run(`UPDATE messages SET status = 'read' WHERE conversation_id = $1 AND sender_id != $2 AND status != 'read'`,
    convId, req.user.id);
  realtime.emitToUser(convId, 'message:status-bulk', { conversation_id: convId, status: 'read' });
  // notify the other member specifically
  const other = await db.get('SELECT user_id FROM conversation_members WHERE conversation_id = $1 AND user_id != $2', convId, req.user.id);
  if (other) realtime.emitToUser(other.user_id, 'conversation:read', { conversation_id: convId, by: req.user.id });
  res.json({ ok: true });
});

// DELETE /api/conversations/:id (hide for me)
router.delete('/:id', authRequired, async (req, res) => {
  const convId = Number(req.params.id);
  await db.run('UPDATE conversation_members SET hidden_at = NOW() WHERE conversation_id = $1 AND user_id = $2',
    convId, req.user.id);
  res.json({ ok: true });
});

module.exports = router;
module.exports.serializeMessage = serializeMessage;
module.exports.isMember = isMember;
