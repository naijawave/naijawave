// Conversations & messages (REST). Realtime send/delivery/read/typing lives in socket/.
const express = require('express');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const { publicUser } = require('../utils/helpers');
const realtime = require('../realtime');

const router = express.Router();
const PAGE = 30;

function serializeMessage(db, m) {
  let media = null;
  if (m.media_id) media = db.prepare('SELECT id, url, kind, mime, size, duration FROM media WHERE id = ?').get(m.media_id);
  return {
    id: m.id, conversation_id: m.conversation_id, sender_id: m.sender_id,
    kind: m.kind, text: m.text || '', media,
    status: m.status, deleted: !!m.deleted, created_at: m.created_at,
  };
}

function isMember(conversationId, userId) {
  return !!db.prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
    .get(conversationId, userId);
}

function otherUser(conversationId, meId) {
  const row = db.prepare(`SELECT u.* FROM conversation_members cm JOIN users u ON u.id = cm.user_id
    WHERE cm.conversation_id = ? AND cm.user_id != ? LIMIT 1`).get(conversationId, meId);
  return publicUser(row);
}

// GET /api/conversations
router.get('/', authRequired, (req, res) => {
  const me = req.user.id;
  const convs = db.prepare(`
    SELECT c.* FROM conversations c
    JOIN conversation_members cm ON cm.conversation_id = c.id
    WHERE cm.user_id = ? AND cm.hidden_at IS NULL
    ORDER BY c.updated_at DESC LIMIT 50`).all(me);
  const items = convs.map(c => {
    const last = db.prepare('SELECT * FROM messages WHERE conversation_id = ? AND deleted = 0 ORDER BY id DESC LIMIT 1').get(c.id);
    const unread = db.prepare(`SELECT COUNT(*) n FROM messages WHERE conversation_id = ? AND sender_id != ? AND status != 'read' AND deleted = 0`).get(c.id, me).n;
    return {
      id: c.id, other_user: otherUser(c.id, me),
      last_message: last ? serializeMessage(db, last) : null,
      unread_count: unread, updated_at: c.updated_at,
    };
  });
  res.json({ items });
});

// POST /api/conversations { user_id } — idempotent
router.post('/', authRequired, (req, res) => {
  const otherId = Number(req.body?.user_id);
  if (!otherId || otherId === req.user.id) return res.status(400).json({ error: 'Invalid user.' });
  const other = db.prepare("SELECT * FROM users WHERE id = ? AND status = 'active'").get(otherId);
  if (!other) return res.status(404).json({ error: 'User not found.' });
  const blocked = db.prepare('SELECT 1 FROM blocks WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)')
    .get(req.user.id, otherId, otherId, req.user.id);
  if (blocked) return res.status(403).json({ error: 'You can’t message this account.', code: 'BLOCKED' });
  // privacy: who can message me
  let prefs = {}; try { prefs = JSON.parse(other.prefs || '{}'); } catch {}
  if (prefs.who_can_message === 'followed') {
    const follows = db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?').get(req.user.id, otherId);
    if (!follows) return res.status(403).json({ error: `@${other.username} only accepts messages from people they follow.`, code: 'DM_CLOSED' });
  }

  const existing = db.prepare(`
    SELECT c.id FROM conversations c
    JOIN conversation_members m1 ON m1.conversation_id = c.id AND m1.user_id = ?
    JOIN conversation_members m2 ON m2.conversation_id = c.id AND m2.user_id = ?
    LIMIT 1`).get(req.user.id, otherId);
  let convId;
  if (existing) {
    convId = existing.id;
    db.prepare('UPDATE conversation_members SET hidden_at = NULL WHERE conversation_id = ? AND user_id = ?').run(convId, req.user.id);
  } else {
    const info = db.prepare('INSERT INTO conversations DEFAULT VALUES').run();
    convId = info.lastInsertRowid;
    db.prepare('INSERT INTO conversation_members (conversation_id, user_id) VALUES (?,?),(?,?)')
      .run(convId, req.user.id, convId, otherId);
  }
  res.status(201).json({ conversation: { id: convId, other_user: publicUser(other) } });
});

// GET /api/conversations/:id/messages
router.get('/:id/messages', authRequired, (req, res) => {
  const convId = Number(req.params.id);
  if (!isMember(convId, req.user.id)) return res.status(404).json({ error: 'Conversation not found.' });
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const rows = db.prepare(`SELECT * FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(convId, PAGE, (page - 1) * PAGE);
  res.json({ items: rows.reverse().map(m => serializeMessage(db, m)), page, has_more: rows.length === PAGE });
});

// POST /api/conversations/:id/read
router.post('/:id/read', authRequired, (req, res) => {
  const convId = Number(req.params.id);
  if (!isMember(convId, req.user.id)) return res.status(404).json({ error: 'Conversation not found.' });
  db.prepare(`UPDATE messages SET status = 'read' WHERE conversation_id = ? AND sender_id != ? AND status != 'read'`)
    .run(convId, req.user.id);
  realtime.emitToUser(convId, 'message:status-bulk', { conversation_id: convId, status: 'read' });
  // notify the other member specifically
  const other = db.prepare('SELECT user_id FROM conversation_members WHERE conversation_id = ? AND user_id != ?').get(convId, req.user.id);
  if (other) realtime.emitToUser(other.user_id, 'conversation:read', { conversation_id: convId, by: req.user.id });
  res.json({ ok: true });
});

// DELETE /api/conversations/:id (hide for me)
router.delete('/:id', authRequired, (req, res) => {
  const convId = Number(req.params.id);
  db.prepare('UPDATE conversation_members SET hidden_at = datetime(\'now\') WHERE conversation_id = ? AND user_id = ?')
    .run(convId, req.user.id);
  res.json({ ok: true });
});

module.exports = router;
module.exports.serializeMessage = serializeMessage;
module.exports.isMember = isMember;
