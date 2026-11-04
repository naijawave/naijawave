// User profiles, follows, blocks, mutes, reports, search, suggestions.
const express = require('express');
const db = require('../db');
const { authRequired, authOptional } = require('../middleware/auth');
const { followLimiter } = require('../middleware/rateLimit');
const { publicUser, escLike } = require('../utils/helpers');
const { serializePost } = require('../utils/serialize');
const { notify } = require('../utils/notify');
const realtime = require('../realtime');

const router = express.Router();

function counts(userId) {
  const followers = db.prepare('SELECT COUNT(*) c FROM follows WHERE followee_id = ?').get(userId).c;
  const following = db.prepare('SELECT COUNT(*) c FROM follows WHERE follower_id = ?').get(userId).c;
  const posts = db.prepare("SELECT COUNT(*) c FROM posts WHERE user_id = ? AND deleted_at IS NULL").get(userId).c;
  return { followers_count: followers, following_count: following, posts_count: posts };
}

function viewerState(viewerId, targetId) {
  if (!viewerId) return { following: false, followed_by: false, blocked: false, blocked_by: false, muted: false };
  const q = (sql) => db.prepare(sql).get(viewerId, targetId);
  return {
    following: !!q('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?'),
    followed_by: !!db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?').get(targetId, viewerId),
    blocked: !!q('SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?'),
    blocked_by: !!db.prepare('SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?').get(targetId, viewerId),
    muted: !!q('SELECT 1 FROM mutes WHERE muter_id = ? AND muted_id = ?'),
  };
}

// GET /api/users/search?q=
router.get('/search', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ users: [] });
  const like = '%' + escLike(q) + '%';
  const rows = db.prepare(`SELECT * FROM users
    WHERE status = 'active' AND (username LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\')
    ORDER BY verification != 'none' DESC, id DESC LIMIT 20`).all(like, like);
  res.json({ users: rows.map(u => ({ ...publicUser(u), ...counts(u.id) })) });
});

// GET /api/users/suggested
router.get('/suggested', authRequired, (req, res) => {
  const me = req.user.id;
  // People followed by people I follow, plus verified accounts — real signals only.
  const rows = db.prepare(`
    SELECT u.*, COUNT(*) AS score FROM follows f1
    JOIN follows f2 ON f2.follower_id = f1.followee_id
    JOIN users u ON u.id = f2.followee_id
    WHERE f1.follower_id = ? AND f2.followee_id != ?
      AND f2.followee_id NOT IN (SELECT followee_id FROM follows WHERE follower_id = ?)
      AND u.status = 'active'
    GROUP BY u.id ORDER BY score DESC LIMIT 10`).all(me, me, me);
  let list = rows;
  if (list.length < 8) {
    const extra = db.prepare(`
      SELECT * FROM users WHERE id != ? AND status = 'active'
        AND verification IN ('blue','gold','founder')
        AND id NOT IN (SELECT followee_id FROM follows WHERE follower_id = ?)
      LIMIT ?`).all(me, me, 8 - list.length);
    list = list.concat(extra);
  }
  res.json({ users: list.map(u => ({ ...publicUser(u), ...counts(u.id) })) });
});

// GET /api/users/me/blocked  &  /api/users/me/muted
for (const kind of ['blocked', 'muted']) {
  router.get('/me/' + kind, authRequired, (req, res) => {
    const table = kind === 'blocked' ? 'blocks' : 'mutes';
    const a = kind === 'blocked' ? 'blocker_id' : 'muter_id';
    const b = kind === 'blocked' ? 'blocked_id' : 'muted_id';
    const rows = db.prepare(`SELECT u.* FROM ${table} t JOIN users u ON u.id = t.${b}
      WHERE t.${a} = ? ORDER BY t.id DESC`).all(req.user.id);
    res.json({ items: rows.map(u => publicUser(u)) });
  });
}

// GET /api/users/me/bookmarks
router.get('/me/bookmarks', authRequired, (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1), limit = 20;
  const rows = db.prepare(`SELECT p.* FROM bookmarks b JOIN posts p ON p.id = b.post_id
    WHERE b.user_id = ? AND p.deleted_at IS NULL ORDER BY b.id DESC LIMIT ? OFFSET ?`)
    .all(req.user.id, limit, (page - 1) * limit);
  res.json({ items: rows.map(r => serializePost(db, r, req.user.id)), page, has_more: rows.length === limit });
});

// GET /api/users/:username
router.get('/:username', authOptional, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(String(req.params.username).toLowerCase());
  if (!u || u.status === 'suspended') return res.status(404).json({ error: 'User not found.' });
  const viewerId = req.user?.id || null;
  // authOptional not applied globally; try to read token manually is overkill — use optional via middleware stack below
  res.json({
    user: { ...publicUser(u), bio: u.bio, location: u.location, website: u.website, ...counts(u.id) },
    viewer: viewerState(viewerId, u.id),
  });
});

// PATCH /api/users/me
router.patch('/me', authRequired, (req, res) => {
  const { display_name, bio, location, website, avatar_url, cover_url, prefs } = req.body || {};
  const fields = {}, params = [];
  if (display_name !== undefined) { fields.display_name = String(display_name).slice(0, 40) || req.user.display_name; }
  if (bio !== undefined) fields.bio = String(bio).slice(0, 160);
  if (location !== undefined) fields.location = String(location).slice(0, 60);
  if (website !== undefined) fields.website = String(website).slice(0, 120);
  if (avatar_url !== undefined) fields.avatar_url = String(avatar_url).slice(0, 500);
  if (cover_url !== undefined) fields.cover_url = String(cover_url).slice(0, 500);
  if (prefs !== undefined && typeof prefs === 'object') {
    const cur = (() => { try { return JSON.parse(req.user.prefs || '{}'); } catch { return {}; } })();
    fields.prefs = JSON.stringify({ ...cur, ...prefs });
  }
  const keys = Object.keys(fields);
  if (!keys.length) return res.status(400).json({ error: 'Nothing to update.' });
  db.prepare(`UPDATE users SET ${keys.map(k => k + ' = ?').join(', ')} WHERE id = ?`)
    .run(...keys.map(k => fields[k]), req.user.id);
  const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: { ...publicUser(fresh), ...counts(fresh.id) } });
});

// followers / following lists
function listRelation(req, res, dir) {
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(String(req.params.username).toLowerCase());
  if (!u) return res.status(404).json({ error: 'User not found.' });
  const col = dir === 'followers' ? 'follower_id' : 'followee_id';
  const other = dir === 'followers' ? 'followee_id' : 'follower_id';
  const page = Math.max(1, parseInt(req.query.page) || 1), limit = 20;
  const rows = db.prepare(`SELECT u.* FROM follows f JOIN users u ON u.id = f.${col}
    WHERE f.${other} = ? AND u.status='active' ORDER BY f.id DESC LIMIT ? OFFSET ?`)
    .all(u.id, limit, (page - 1) * limit);
  res.json({ items: rows.map(x => publicUser(x)), page, has_more: rows.length === limit });
}
router.get('/:username/followers', (req, res) => listRelation(req, res, 'followers'));
router.get('/:username/following', (req, res) => listRelation(req, res, 'following'));

// follow / unfollow
router.post('/:username/follow', authRequired, followLimiter, (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE username = ?').get(String(req.params.username).toLowerCase());
  if (!target || target.status !== 'active') return res.status(404).json({ error: 'User not found.' });
  if (target.id === req.user.id) return res.status(400).json({ error: "You can't follow yourself." });
  if (db.prepare('SELECT 1 FROM blocks WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)')
      .get(req.user.id, target.id, target.id, req.user.id))
    return res.status(403).json({ error: 'You can’t follow this account.', code: 'BLOCKED' });
  db.prepare('INSERT OR IGNORE INTO follows (follower_id, followee_id) VALUES (?,?)').run(req.user.id, target.id);
  notify(target.id, 'follow', { actorId: req.user.id, text: `@${req.user.username} started following you.` });
  res.json({ following: true, followers_count: counts(target.id).followers_count });
});
router.delete('/:username/follow', authRequired, (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE username = ?').get(String(req.params.username).toLowerCase());
  if (!target) return res.status(404).json({ error: 'User not found.' });
  db.prepare('DELETE FROM follows WHERE follower_id = ? AND followee_id = ?').run(req.user.id, target.id);
  res.json({ following: false, followers_count: counts(target.id).followers_count });
});

// block / mute
for (const kind of ['block', 'mute']) {
  const table = kind + 's';
  const a = kind === 'block' ? 'blocker_id' : 'muter_id';
  const b = kind === 'block' ? 'blocked_id' : 'muted_id';
  router.post(`/:username/${kind}`, authRequired, (req, res) => {
    const target = db.prepare('SELECT * FROM users WHERE username = ?').get(String(req.params.username).toLowerCase());
    if (!target) return res.status(404).json({ error: 'User not found.' });
    if (target.id === req.user.id) return res.status(400).json({ error: "You can't " + kind + ' yourself.' });
    db.prepare(`INSERT OR IGNORE INTO ${table} (${a}, ${b}) VALUES (?,?)`).run(req.user.id, target.id);
    if (kind === 'block') {
      db.prepare('DELETE FROM follows WHERE (follower_id=? AND followee_id=?) OR (follower_id=? AND followee_id=?)')
        .run(req.user.id, target.id, target.id, req.user.id);
    }
    res.json({ ok: true });
  });
  router.delete(`/:username/${kind}`, authRequired, (req, res) => {
    const target = db.prepare('SELECT * FROM users WHERE username = ?').get(String(req.params.username).toLowerCase());
    if (!target) return res.status(404).json({ error: 'User not found.' });
    db.prepare(`DELETE FROM ${table} WHERE ${a} = ? AND ${b} = ?`).run(req.user.id, target.id);
    res.json({ ok: true });
  });
}

// report user
router.post('/:username/report', authRequired, (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE username = ?').get(String(req.params.username).toLowerCase());
  if (!target) return res.status(404).json({ error: 'User not found.' });
  const { reason, details } = req.body || {};
  if (!reason) return res.status(400).json({ error: 'Tell us the reason for the report.' });
  db.prepare(`INSERT INTO reports (reporter_id, type, target_id, reason, details) VALUES (?,?,?,?,?)`)
    .run(req.user.id, 'user', target.id, String(reason).slice(0, 100), String(details || '').slice(0, 1000));
  res.json({ ok: true, note: 'Thanks — our team will review this report.' });
});

// presence (respects privacy pref show_online)
router.get('/:username/presence', authRequired, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(String(req.params.username).toLowerCase());
  if (!u) return res.status(404).json({ error: 'User not found.' });
  let prefs = {}; try { prefs = JSON.parse(u.prefs || '{}'); } catch {}
  if (prefs.show_online === false) return res.json({ online: false, hidden: true });
  const online = realtime.getIo()?.sockets.adapter.rooms.has('user:' + u.id) || false;
  res.json({ online });
});

module.exports = router;
