// Create a notification row + push realtime event if user is online.
const db = require('../db');
const realtime = require('../realtime');
const { publicUser } = require('./helpers');

async function getPrefs(userId) {
  let row = await db.get('SELECT prefs FROM notification_prefs WHERE user_id = $1', userId);
  if (!row) {
    await db.run('INSERT INTO notification_prefs (user_id, prefs) VALUES ($1, $2)', userId, '{}');
    return {};
  }
  try { return JSON.parse(row.prefs); } catch { return {}; }
}

async function notify(userId, type, { actorId = null, postId = null, conversationId = null, text = '', data = {} } = {}) {
  if (!userId) return null;
  const prefs = await getPrefs(userId);
  if (prefs[type] === false) return null; // user muted this type
  const row = await db.run(
    `INSERT INTO notifications (user_id, type, actor_id, post_id, conversation_id, text, data)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    userId, type, actorId, postId, conversationId, text, JSON.stringify(data));
  const actor = actorId ? publicUser(await db.get('SELECT * FROM users WHERE id = $1', actorId)) : null;
  realtime.emitToUser(userId, 'notification', {
    id: row.lastInsertRowid, type, actor, post_id: postId,
    conversation_id: conversationId, text, data, read: 0,
    created_at: new Date().toISOString(),
  });
  return row.lastInsertRowid;
}

module.exports = { notify, getPrefs };
