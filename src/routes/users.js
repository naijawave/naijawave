// User profiles, follows, blocks, mutes, reports, search, suggestions.
const express = require('express');
const db = require('../db');
const { authRequired, authOptional } = require('../middleware/auth');
const { followLimiter } = require('../middleware/rateLimit');
const { publicUser, escLike } = require('../utils/helpers');
const { serializePost, visibilityWhere, spliceWhere } = require('../utils/serialize');
const { notify } = require('../utils/notify');
const realtime = require('../realtime');

const router = express.Router();

async function counts(userId) {
  const followers = (await db.get('SELECT COUNT(*)::int c FROM follows WHERE followee_id = $1', userId)).c;
  const following = (await db.get('SELECT COUNT(*)::int c FROM follows WHERE follower_id = $1', userId)).c;
  const posts = (await db.get("SELECT COUNT(*)::int c FROM posts WHERE user_id = $1 AND deleted_at IS NULL", userId)).c;
  return { followers_count: followers, following_count: following, posts_count: posts };
}

async function viewerState(viewerId, targetId) {
  if (!viewerId) return { following: false, followed_by: false, blocked: false, blocked_by: false, muted: false };
  const q = (sql, a, b) => db.get(sql, a, b);
  return {
    following: !!(await q('SELECT 1 FROM follows WHERE follower_id = $1 AND followee_id = $2', viewerId, targetId)),
    followed_by: !!(await q('SELECT 1 FROM follows WHERE follower_id = $1 AND followee_id = $2', targetId, viewerId)),
    blocked: !!(await q('SELECT 1 FROM blocks WHERE blocker_id = $1 AND blocked_id = $2', viewerId, targetId)),
    blocked_by: !!(await q('SELECT 1 FROM blocks WHERE blocker_id = $1 AND blocked_id = $2', targetId, viewerId)),
    muted: !!(await q('SELECT 1 FROM mutes WHERE muter_id = $1 AND muted_id = $2', viewerId, targetId)),
  };
}

// GET /api/users/search?q=
router.get('/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ users: [] });
  const like = '%' + escLike(q) + '%';
  const rows = await db.all(`SELECT * FROM users
    WHERE status = 'active' AND (username ILIKE $1 ESCAPE '\\' OR display_name ILIKE $2 ESCAPE '\\')
    ORDER BY verification != 'none' DESC, id DESC LIMIT 20`, like, like);
  res.json({ users: await Promise.all(rows.map(async u => ({ ...publicUser(u), ...(await counts(u.id)) }))) });
});

// GET /api/users/suggested
router.get('/suggested', authRequired, async (req, res) => {
  const me = req.user.id;
  // People followed by people I follow, plus verified accounts — real signals only.
  const rows = await db.all(`
    SELECT u.*, COUNT(*) AS score FROM follows f1
    JOIN follows f2 ON f2.follower_id = f1.followee_id
    JOIN users u ON u.id = f2.followee_id
    WHERE f1.follower_id = $1 AND f2.followee_id != $2
      AND f2.followee_id NOT IN (SELECT followee_id FROM follows WHERE follower_id = $3)
      AND u.status = 'active'
    GROUP BY u.id ORDER BY score DESC LIMIT 10`, me, me, me);
  let list = rows;
  if (list.length < 8) {
    const extra = await db.all(`
      SELECT * FROM users WHERE id != $1 AND status = 'active'
        AND verification IN ('blue','gold','founder')
        AND id NOT IN (SELECT followee_id FROM follows WHERE follower_id = $2)
      LIMIT $3`, me, me, 8 - list.length);
    list = list.concat(extra);
  }
  res.json({ users: await Promise.all(list.map(async u => ({ ...publicUser(u), ...(await counts(u.id)) }))) });
});

// GET /api/users/me/blocked  &  /api/users/me/muted
for (const kind of ['blocked', 'muted']) {
  router.get('/me/' + kind, authRequired, async (req, res) => {
    const table = kind === 'blocked' ? 'blocks' : 'mutes';
    const a = kind === 'blocked' ? 'blocker_id' : 'muter_id';
    const b = kind === 'blocked' ? 'blocked_id' : 'muted_id';
    const rows = await db.all(`SELECT u.* FROM ${table} t JOIN users u ON u.id = t.${b}
      WHERE t.${a} = $1 ORDER BY t.id DESC`, req.user.id);
    res.json({ items: rows.map(u => publicUser(u)) });
  });
}

// GET /api/users/me/bookmarks
router.get('/me/bookmarks', authRequired, async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1), limit = 20;
  const rows = await db.all(`SELECT p.* FROM bookmarks b JOIN posts p ON p.id = b.post_id
    WHERE b.user_id = $1 AND p.deleted_at IS NULL ORDER BY b.id DESC LIMIT $2 OFFSET $3`,
    req.user.id, limit, (page - 1) * limit);
  res.json({ items: await Promise.all(rows.map(r => serializePost(db, r, req.user.id))), page, has_more: rows.length === limit });
});

// GET /api/users/:username/posts?type=posts|replies|media|likes
router.get('/:username/posts', authOptional, async (req, res) => {
  const u = await db.get('SELECT * FROM users WHERE username = $1', String(req.params.username).toLowerCase());
  if (!u || u.status === 'suspended') return res.status(404).json({ error: 'User not found.' });
  const type = ['posts', 'replies', 'media', 'likes'].includes(req.query.type) ? req.query.type : 'posts';
  const viewerId = req.user?.id || null;
  const page = Math.max(1, parseInt(req.query.page) || 1), limit = Math.min(40, parseInt(req.query.limit) || 20);
  const v = visibilityWhere(viewerId);
  let sql, params;
  const base = `FROM posts p WHERE p.deleted_at IS NULL AND ${spliceWhere(v.where, 0)}`;
  if (type === 'posts') {
    sql = `SELECT p.* ${base} AND p.user_id = $${v.params.length + 1} ORDER BY p.id DESC`; params = [...v.params, u.id];
  } else if (type === 'media') {
    sql = `SELECT p.* ${base} AND p.user_id = $${v.params.length + 1} AND EXISTS (SELECT 1 FROM media m WHERE m.post_id = p.id) ORDER BY p.id DESC`;
    params = [...v.params, u.id];
  } else if (type === 'likes') {
    // u.id ($1) binds before the visibility fragment → offset 1
    sql = `SELECT p.* FROM posts p JOIN post_likes l ON l.post_id = p.id AND l.user_id = $1 WHERE p.deleted_at IS NULL AND ${spliceWhere(v.where, 1)} ORDER BY l.id DESC`;
    params = [u.id, ...v.params];
  } else { // replies: posts this user has commented on, most recent reply first
    sql = `SELECT p.*, MAX(c.id) AS rc FROM posts p
           JOIN comments c ON c.post_id = p.id AND c.user_id = $1 AND c.deleted_at IS NULL
           WHERE p.deleted_at IS NULL AND ${spliceWhere(v.where, 1)} GROUP BY p.id ORDER BY rc DESC`;
    params = [u.id, ...v.params];
  }
  sql += ` LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  const rows = await db.all(sql, ...params, limit, (page - 1) * limit);
  res.json({ items: await Promise.all(rows.map(r => serializePost(db, r, viewerId))), page, has_more: rows.length === limit });
});

// GET /api/users/:username
router.get('/:username', authOptional, async (req, res) => {
  const u = await db.get('SELECT * FROM users WHERE username = $1', String(req.params.username).toLowerCase());
  if (!u || u.status === 'suspended') return res.status(404).json({ error: 'User not found.' });
  const viewerId = req.user?.id || null;
  // authOptional not applied globally; try to read token manually is overkill — use optional via middleware stack below
  res.json({
    user: { ...publicUser(u), bio: u.bio, location: u.location, website: u.website, ...(await counts(u.id)) },
    viewer: await viewerState(viewerId, u.id),
  });
});

// PATCH /api/users/me
router.patch('/me', authRequired, async (req, res) => {
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
  const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  await db.run(`UPDATE users SET ${setClause} WHERE id = $${keys.length + 1}`,
    ...keys.map(k => fields[k]), req.user.id);
  const fresh = await db.get('SELECT * FROM users WHERE id = $1', req.user.id);
  res.json({ user: { ...publicUser(fresh), ...(await counts(fresh.id)) } });
});

// followers / following lists
async function listRelation(req, res, dir) {
  const u = await db.get('SELECT * FROM users WHERE username = $1', String(req.params.username).toLowerCase());
  if (!u) return res.status(404).json({ error: 'User not found.' });
  const col = dir === 'followers' ? 'follower_id' : 'followee_id';
  const other = dir === 'followers' ? 'followee_id' : 'follower_id';
  const page = Math.max(1, parseInt(req.query.page) || 1), limit = 20;
  const rows = await db.all(`SELECT u.* FROM follows f JOIN users u ON u.id = f.${col}
    WHERE f.${other} = $1 AND u.status='active' ORDER BY f.id DESC LIMIT $2 OFFSET $3`,
    u.id, limit, (page - 1) * limit);
  res.json({ items: rows.map(x => publicUser(x)), page, has_more: rows.length === limit });
}
router.get('/:username/followers', async (req, res) => listRelation(req, res, 'followers'));
router.get('/:username/following', async (req, res) => listRelation(req, res, 'following'));

// follow / unfollow
router.post('/:username/follow', authRequired, followLimiter, async (req, res) => {
  const target = await db.get('SELECT * FROM users WHERE username = $1', String(req.params.username).toLowerCase());
  if (!target || target.status !== 'active') return res.status(404).json({ error: 'User not found.' });
  if (target.id === req.user.id) return res.status(400).json({ error: "You can't follow yourself." });
  if (await db.get('SELECT 1 FROM blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$3 AND blocked_id=$4)',
      req.user.id, target.id, target.id, req.user.id))
    return res.status(403).json({ error: 'You can’t follow this account.', code: 'BLOCKED' });
  await db.run('INSERT INTO follows (follower_id, followee_id) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING id', req.user.id, target.id);
  await notify(target.id, 'follow', { actorId: req.user.id, text: `@${req.user.username} started following you.` });
  res.json({ following: true, followers_count: (await counts(target.id)).followers_count });
});
router.delete('/:username/follow', authRequired, async (req, res) => {
  const target = await db.get('SELECT * FROM users WHERE username = $1', String(req.params.username).toLowerCase());
  if (!target) return res.status(404).json({ error: 'User not found.' });
  await db.run('DELETE FROM follows WHERE follower_id = $1 AND followee_id = $2', req.user.id, target.id);
  res.json({ following: false, followers_count: (await counts(target.id)).followers_count });
});

// block / mute
for (const kind of ['block', 'mute']) {
  const table = kind + 's';
  const a = kind === 'block' ? 'blocker_id' : 'muter_id';
  const b = kind === 'block' ? 'blocked_id' : 'muted_id';
  router.post(`/:username/${kind}`, authRequired, async (req, res) => {
    const target = await db.get('SELECT * FROM users WHERE username = $1', String(req.params.username).toLowerCase());
    if (!target) return res.status(404).json({ error: 'User not found.' });
    if (target.id === req.user.id) return res.status(400).json({ error: "You can't " + kind + ' yourself.' });
    await db.run(`INSERT INTO ${table} (${a}, ${b}) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING id`, req.user.id, target.id);
    if (kind === 'block') {
      await db.run('DELETE FROM follows WHERE (follower_id=$1 AND followee_id=$2) OR (follower_id=$3 AND followee_id=$4)',
        req.user.id, target.id, target.id, req.user.id);
    }
    res.json({ ok: true });
  });
  router.delete(`/:username/${kind}`, authRequired, async (req, res) => {
    const target = await db.get('SELECT * FROM users WHERE username = $1', String(req.params.username).toLowerCase());
    if (!target) return res.status(404).json({ error: 'User not found.' });
    await db.run(`DELETE FROM ${table} WHERE ${a} = $1 AND ${b} = $2`, req.user.id, target.id);
    res.json({ ok: true });
  });
}

// report user
router.post('/:username/report', authRequired, async (req, res) => {
  const target = await db.get('SELECT * FROM users WHERE username = $1', String(req.params.username).toLowerCase());
  if (!target) return res.status(404).json({ error: 'User not found.' });
  const { reason, details } = req.body || {};
  if (!reason) return res.status(400).json({ error: 'Tell us the reason for the report.' });
  await db.run(`INSERT INTO reports (reporter_id, type, target_id, reason, details) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    req.user.id, 'user', target.id, String(reason).slice(0, 100), String(details || '').slice(0, 1000));
  res.json({ ok: true, note: 'Thanks — our team will review this report.' });
});

// presence (respects privacy pref show_online)
router.get('/:username/presence', authRequired, async (req, res) => {
  const u = await db.get('SELECT * FROM users WHERE username = $1', String(req.params.username).toLowerCase());
  if (!u) return res.status(404).json({ error: 'User not found.' });
  let prefs = {}; try { prefs = JSON.parse(u.prefs || '{}'); } catch {}
  if (prefs.show_online === false) return res.json({ online: false, hidden: true });
  const online = realtime.getIo()?.sockets.adapter.rooms.has('user:' + u.id) || false;
  res.json({ online });
});

module.exports = router;
