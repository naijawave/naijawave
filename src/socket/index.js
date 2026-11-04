// Realtime layer: presence, messaging, typing, delivery/read receipts, call signalling.
const jwt = require('jsonwebtoken');
const db = require('../db');
const { JWT_SECRET } = require('../middleware/auth');
const realtime = require('../realtime');
const { notify } = require('../utils/notify');
const { serializeMessage } = require('../routes/conversations');

// simple per-socket rate guard: { socketId: { event: [timestamps] } }
const buckets = new Map();
// active call participants, so signalling relays survive a missing to_user_id
const activeCalls = new Map(); // call_id -> { caller, callee, timer }
function guarded(socket, event, maxPerMin) {
  const now = Date.now();
  let b = buckets.get(socket.id);
  if (!b) { b = {}; buckets.set(socket.id, b); }
  b[event] = (b[event] || []).filter(t => now - t < 60000);
  if (b[event].length >= maxPerMin) return false;
  b[event].push(now);
  return true;
}

function initSocket(server) {
  const { Server } = require('socket.io');
  const io = new Server(server, {
    cors: { origin: true, credentials: true },
    maxHttpBufferSize: 1e6,
  });
  realtime.setIo(io);

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('NO_TOKEN'));
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      const user = db.prepare("SELECT * FROM users WHERE id = ? AND status = 'active'").get(payload.uid);
      if (!user) return next(new Error('NO_USER'));
      socket.user = user;
      next();
    } catch { next(new Error('BAD_TOKEN')); }
  });

  const roomOf = (uid) => 'user:' + uid;

  function peersOf(uid) {
    // people who should hear about my presence: conversation partners + mutual follows
    const conv = db.prepare(`SELECT DISTINCT cm2.user_id AS id FROM conversation_members cm1
      JOIN conversation_members cm2 ON cm2.conversation_id = cm1.conversation_id
      WHERE cm1.user_id = ? AND cm2.user_id != ?`).all(uid, uid).map(r => r.id);
    const mutual = db.prepare(`SELECT f1.followee_id AS id FROM follows f1
      JOIN follows f2 ON f2.follower_id = f1.followee_id AND f2.followee_id = f1.follower_id
      WHERE f1.follower_id = ?`).all(uid).map(r => r.id);
    return [...new Set([...conv, ...mutual])];
  }

  io.on('connection', (socket) => {
    const me = socket.user.id;
    socket.join(roomOf(me));
    peersOf(me).forEach(pid => io.to(roomOf(pid)).emit('presence', { user_id: me, online: true }));

    socket.on('disconnect', () => {
      buckets.delete(socket.id);
      // small grace: only mark offline if no other socket for this user remains
      setTimeout(() => {
        if (!io.sockets.adapter.rooms.has(roomOf(me))) {
          peersOf(me).forEach(pid => io.to(roomOf(pid)).emit('presence', { user_id: me, online: false }));
        }
      }, 5000);
    });

    // ---------- MESSAGING ----------
    socket.on('message:send', (payload, ack) => {
      if (!guarded(socket, 'message:send', 60)) return ack?.({ error: 'RATE_LIMITED' });
      const { conversation_id, kind = 'text', text = '', media_id = null } = payload || {};
      const convId = Number(conversation_id);
      const member = db.prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(convId, me);
      if (!member) return ack?.({ error: 'NOT_MEMBER' });
      const other = db.prepare('SELECT user_id FROM conversation_members WHERE conversation_id = ? AND user_id != ?').get(convId, me);
      const otherId = other?.user_id;
      if (otherId) {
        const blocked = db.prepare('SELECT 1 FROM blocks WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)')
          .get(me, otherId, otherId, me);
        if (blocked) return ack?.({ error: 'BLOCKED' });
      }
      if (!['text', 'image', 'video', 'voice', 'file'].includes(kind)) return ack?.({ error: 'BAD_KIND' });
      const clean = String(text).slice(0, 2000);
      if (kind === 'text' && !clean.trim()) return ack?.({ error: 'EMPTY' });
      let mediaRow = null;
      if (media_id) {
        mediaRow = db.prepare('SELECT * FROM media WHERE id = ?').get(media_id);
        if (!mediaRow || mediaRow.user_id !== me) return ack?.({ error: 'BAD_MEDIA' });
        const kindMap = { image: 'image', video: 'video', voice: 'voice', file: 'file' };
        if (mediaRow.kind !== kindMap[kind]) return ack?.({ error: 'MEDIA_MISMATCH' });
      }
      const recipientOnline = otherId ? io.sockets.adapter.rooms.has(roomOf(otherId)) : false;
      const info = db.prepare(`INSERT INTO messages (conversation_id, sender_id, kind, text, media_id, status)
        VALUES (?,?,?,?,?,?)`).run(convId, me, kind, clean, media_id || null, recipientOnline ? 'delivered' : 'sent');
      if (mediaRow) db.prepare('UPDATE media SET message_id = ? WHERE id = ?').run(info.lastInsertRowid, mediaRow.id);
      db.prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?").run(convId);
      db.prepare('UPDATE conversation_members SET hidden_at = NULL WHERE conversation_id = ?').run(convId);
      const msg = serializeMessage(db, db.prepare('SELECT * FROM messages WHERE id = ?').get(info.lastInsertRowid));
      ack?.({ message: msg });
      if (otherId) {
        io.to(roomOf(otherId)).emit('message:new', { message: msg });
        const preview = kind === 'text' ? clean.slice(0, 80) : (kind === 'voice' ? '🎙️ Voice wave' : kind === 'image' ? '📷 Photo' : kind === 'video' ? '🎬 Video' : '📎 File');
        notify(otherId, 'message', { actorId: me, conversationId: convId, text: preview });
      }
    });

    socket.on('message:delivered', ({ message_id }) => {
      const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(message_id);
      if (!m || m.sender_id === me) return;
      const member = db.prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(m.conversation_id, me);
      if (!member) return;
      if (m.status === 'sent') {
        db.prepare("UPDATE messages SET status = 'delivered' WHERE id = ?").run(m.id);
        io.to(roomOf(m.sender_id)).emit('message:status', { message_id: m.id, status: 'delivered' });
      }
    });

    socket.on('message:read', ({ conversation_id }) => {
      const convId = Number(conversation_id);
      const member = db.prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(convId, me);
      if (!member) return;
      db.prepare("UPDATE messages SET status = 'read' WHERE conversation_id = ? AND sender_id != ? AND status != 'read'").run(convId, me);
      const other = db.prepare('SELECT user_id FROM conversation_members WHERE conversation_id = ? AND user_id != ?').get(convId, me);
      if (other) io.to(roomOf(other.user_id)).emit('conversation:read', { conversation_id: convId, by: me });
    });

    socket.on('typing', ({ conversation_id, is_typing }) => {
      if (!guarded(socket, 'typing', 30)) return;
      const convId = Number(conversation_id);
      const other = db.prepare('SELECT user_id FROM conversation_members WHERE conversation_id = ? AND user_id != ?').get(convId, me);
      if (other) io.to(roomOf(other.user_id)).emit('typing', { conversation_id: convId, user_id: me, is_typing: !!is_typing });
    });

    socket.on('message:delete', ({ message_id }, ack) => {
      const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(message_id);
      if (!m || m.sender_id !== me) return ack?.({ error: 'NOT_ALLOWED' });
      db.prepare('UPDATE messages SET deleted = 1, text = \'\' WHERE id = ?').run(m.id);
      const other = db.prepare('SELECT user_id FROM conversation_members WHERE conversation_id = ? AND user_id != ?').get(m.conversation_id, me);
      if (other) io.to(roomOf(other.user_id)).emit('message:deleted', { message_id: m.id, conversation_id: m.conversation_id });
      ack?.({ ok: true });
    });

    // ---------- CALL SIGNALLING (WebRTC) ----------
    // The server only relays SDP/ICE — audio/video flows peer-to-peer.
    socket.on('call:invite', (payload, ack) => {
      if (!guarded(socket, 'call:invite', 10)) return ack?.({ error: 'RATE_LIMITED' });
      const { to_user_id, kind, sdp_offer, call_id } = payload || {};
      const toId = Number(to_user_id);
      const target = db.prepare("SELECT * FROM users WHERE id = ? AND status = 'active'").get(toId);
      if (!target || toId === me) return ack?.({ error: 'INVALID_USER' });
      const blocked = db.prepare('SELECT 1 FROM blocks WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)')
        .get(me, toId, toId, me);
      if (blocked) return ack?.({ error: 'BLOCKED' });
      if (!['voice', 'video'].includes(kind)) return ack?.({ error: 'BAD_KIND' });
      const online = io.sockets.adapter.rooms.has(roomOf(toId));
      if (!online) {
        db.prepare(`INSERT INTO calls (caller_id, callee_id, kind, status, ended_at) VALUES (?,?,?,'missed',datetime('now'))`)
          .run(me, toId, kind);
        notify(toId, 'call_missed', { actorId: me, text: `Missed ${kind} call from @${socket.user.username}.` });
        return ack?.({ error: 'OFFLINE' });
      }
      io.to(roomOf(toId)).emit('call:incoming', {
        call_id, kind, sdp_offer,
        from_user: { id: me, username: socket.user.username, display_name: socket.user.display_name, avatar_url: socket.user.avatar_url, verification: socket.user.verification },
      });
      activeCalls.set(call_id, {
        caller: me, callee: toId, kind,
        timer: setTimeout(() => activeCalls.delete(call_id), 10 * 60 * 1000),
      });
      ack?.({ ok: true, ringing: true });
    });

    const relay = (event, outEvent) => socket.on(event, (payload) => {
      const { call_id, to_user_id } = payload || {};
      let toId = Number(to_user_id);
      if ((!toId || Number.isNaN(toId)) && call_id && activeCalls.has(call_id)) {
        const c = activeCalls.get(call_id);
        toId = c.caller === me ? c.callee : c.caller;
      }
      if (!toId || !call_id) return;
      if (event === 'call:end' && activeCalls.has(call_id)) {
        clearTimeout(activeCalls.get(call_id).timer);
        activeCalls.delete(call_id);
      }
      io.to(roomOf(toId)).emit(outEvent, { ...payload, to_user_id: toId, from_user_id: me });
    });
    relay('call:accept', 'call:accepted');
    relay('call:reject', 'call:rejected');
    relay('call:ice', 'call:ice');
    relay('call:end', 'call:ended');

    socket.on('call:missed', ({ call_id, to_user_id }) => {
      // callee didn't answer in time → log + notify the callee about the caller
      let toId = Number(to_user_id);
      let kind = 'voice';
      if (call_id && activeCalls.has(call_id)) {
        const c = activeCalls.get(call_id);
        if (!toId || Number.isNaN(toId)) toId = c.caller === me ? c.callee : c.caller;
        kind = c.kind || kind;
        clearTimeout(c.timer);
        activeCalls.delete(call_id);
      }
      if (!toId) return;
      const caller = db.prepare('SELECT username FROM users WHERE id = ?').get(toId);
      db.prepare(`INSERT INTO calls (caller_id, callee_id, kind, status, ended_at) VALUES (?,?,?,'missed',datetime('now'))`)
        .run(toId, me, kind);
      notify(me, 'call_missed', { actorId: toId, text: `You missed a ${kind} call from @${caller?.username || 'someone'}.` });
    });
  });

  return io;
}

module.exports = { initSocket };
