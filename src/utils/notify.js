// Create a notification row + push realtime event if user is online.
const db = require('../db');
const realtime = require('../realtime');
const { publicUser } = require('./helpers');

function getPrefs(userId) {
  let row = db.prepare('SELECT prefs FROM notification_prefs WHERE user_id = ?').get(userId);
  if (!row) {
    db.prepare('INSERT INTO notification_prefs (user_id, prefs) VALUES (?, ?)').run(userId, '{}');
    return {};
  }
  try { return JSON.parse(row.prefs); } catch { return {}; }
}

function notify(userId, type, { actorId = null, postId = null, conversationId = null, text = '', data = {} } = {}) {
  if (!userId) return null;
  const prefs = getPrefs(userId);
  if (prefs[type] === false) return null; // user muted this type
  const row = db.prepare(
    `INSERT INTO notifications (user_id, type, actor_id, post_id, conversation_id, text, data)
     VALUES (?,?,?,?,?,?,?)`).run(
    userId, type, actorId, postId, conversationId, text, JSON.stringify(data));
  const actor = actorId ? publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(actorId)) : null;
  realtime.emitToUser(userId, 'notification', {
    id: row.lastInsertRowid, type, actor, post_id: postId,
    conversation_id: conversationId, text, data, read: 0,
    created_at: new Date().toISOString(),
  });
  return row.lastInsertRowid;
}

module.exports = { notify, getPrefs };
