// Posts: create, feeds, explore, likes, reposts, bookmarks, polls, comments, search, hashtags.
const express = require('express');
const db = require('../db');
const { authRequired, authOptional } = require('../middleware/auth');
const { postLimiter } = require('../middleware/rateLimit');
const { extractHashtags, extractMentions, escLike, publicUser } = require('../utils/helpers');
const { serializePost, visibilityWhere } = require('../utils/serialize');
const { notify } = require('../utils/notify');

const router = express.Router();
const feedRouter = express.Router();   // mounted at /api  -> /api/feed/*, /api/explore
const commentsRouter = express.Router(); // mounted at /api -> /api/comments/*
const PAGE = 20;

function pageOf(req) { return Math.max(1, parseInt(req.query.page) || 1); }

// ---------- CREATE ----------
router.post('/', authRequired, postLimiter, (req, res) => {
  const { text = '', media_ids = [], poll, location, section = 'feed', visibility = 'public' } = req.body || {};
  const clean = String(text).slice(0, 500).trim();
  const mediaIds = Array.isArray(media_ids) ? media_ids.slice(0, 4).map(Number).filter(Boolean) : [];
  if (!clean && !mediaIds.length && !poll) return res.status(400).json({ error: 'Write something or add media first.' });
  if (!['feed', 'buzz'].includes(section)) return res.status(400).json({ error: 'Invalid section.' });
  if (!['public', 'followers'].includes(visibility)) return res.status(400).json({ error: 'Invalid visibility.' });

  // validate media: owned by user, not already attached
  let media = [];
  if (mediaIds.length) {
    media = db.prepare(`SELECT * FROM media WHERE id IN (${mediaIds.map(() => '?').join(',')})`).all(...mediaIds);
    if (media.some(m => m.user_id !== req.user.id || m.post_id)) return res.status(400).json({ error: 'Invalid media attachment.' });
    const kinds = new Set(media.map(m => m.kind));
    if (kinds.has('video') && media.length > 1) return res.status(400).json({ error: 'A video post can only have one video.' });
  }
  let pollData = null;
  if (poll) {
    const q = String(poll.question || '').slice(0, 200).trim();
    const opts = (poll.options || []).map(o => String(o).slice(0, 60).trim()).filter(Boolean).slice(0, 4);
    if (!q || opts.length < 2) return res.status(400).json({ error: 'Polls need a question and 2–4 options.' });
    pollData = { question: q, options: opts };
  }

  const info = db.prepare(`INSERT INTO posts (user_id, text, section, location, visibility)
    VALUES (?,?,?,?,?)`).run(req.user.id, clean, section, location ? String(location).slice(0, 80) : null, visibility);
  const postId = info.lastInsertRowid;
  if (media.length) {
    const upd = db.prepare('UPDATE media SET post_id = ? WHERE id = ?');
    media.forEach(m => upd.run(postId, m.id));
  }
  if (pollData) {
    const p = db.prepare('INSERT INTO polls (post_id, question) VALUES (?,?)').run(postId, pollData.question);
    const ins = db.prepare('INSERT INTO poll_options (poll_id, text) VALUES (?,?)');
    pollData.options.forEach(o => ins.run(p.lastInsertRowid, o));
  }
  // hashtags
  for (const tag of extractHashtags(clean)) {
    db.prepare('INSERT OR IGNORE INTO hashtags (tag) VALUES (?)').run(tag);
    const h = db.prepare('SELECT id FROM hashtags WHERE tag = ?').get(tag);
    db.prepare('INSERT OR IGNORE INTO post_hashtags (post_id, hashtag_id) VALUES (?,?)').run(postId, h.id);
  }
  // mentions → notifications
  for (const name of extractMentions(clean)) {
    const u = db.prepare("SELECT id FROM users WHERE username = ? AND status='active'").get(name);
    if (u && u.id !== req.user.id) notify(u.id, 'mention', { actorId: req.user.id, postId, text: `@${req.user.username} mentioned you in a wave.` });
  }

  const row = db.prepare('SELECT * FROM posts WHERE id = ?').get(postId);
  res.status(201).json({ post: serializePost(db, row, req.user.id) });
});

// ---------- FEEDS ----------
function feedQuery(req, res, mode) {
  const viewerId = req.user.id;
  const page = pageOf(req);
  const v = visibilityWhere(viewerId);
  let extra = '', params = [...v.params];
  if (mode === 'following') {
    extra = 'AND p.user_id IN (SELECT followee_id FROM follows WHERE follower_id = ?)';
    params.push(viewerId);
  }
  // For You ranking: engagement velocity — real numbers only
  const order = mode === 'foryou'
    ? `ORDER BY (COALESCE((SELECT COUNT(*) FROM post_likes WHERE post_id = p.id),0)*2
        + COALESCE((SELECT COUNT(*) FROM comments WHERE post_id = p.id AND deleted_at IS NULL),0)*3
        + COALESCE((SELECT COUNT(*) FROM posts r WHERE r.repost_of = p.id AND r.deleted_at IS NULL),0)*4)
        / POWER((julianday('now') - julianday(p.created_at))*24 + 2, 1.3) DESC, p.id DESC`
    : 'ORDER BY p.id DESC';
  const rows = db.prepare(`
    SELECT p.* FROM posts p
    WHERE p.deleted_at IS NULL AND p.section = 'feed' AND ${v.where} ${extra}
    ${order} LIMIT ? OFFSET ?`).all(...params, PAGE, (page - 1) * PAGE);
  res.json({ items: rows.map(r => serializePost(db, r, viewerId)), page, has_more: rows.length === PAGE });
}
feedRouter.get('/feed/foryou', authRequired, (req, res) => feedQuery(req, res, 'foryou'));
feedRouter.get('/feed/following', authRequired, (req, res) => feedQuery(req, res, 'following'));

// explore: popular posts + trending tags + suggested users
feedRouter.get('/explore', authRequired, (req, res) => {
  const viewerId = req.user.id;
  const v = visibilityWhere(viewerId);
  const posts = db.prepare(`
    SELECT p.* FROM posts p WHERE p.deleted_at IS NULL AND p.section='feed' AND ${v.where}
    AND p.created_at > datetime('now','-7 days')
    ORDER BY (COALESCE((SELECT COUNT(*) FROM post_likes WHERE post_id=p.id),0)
      + COALESCE((SELECT COUNT(*) FROM comments WHERE post_id=p.id AND deleted_at IS NULL),0)*2) DESC
    LIMIT 20`).all(...v.params);
  res.json({ posts: posts.map(r => serializePost(db, r, viewerId)) });
});

// ---------- SINGLE / DELETE ----------
router.get('/:id', authOptional, (req, res) => {
  const row = db.prepare('SELECT * FROM posts WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Wave not found.' });
  res.json({ post: serializePost(db, row, req.user?.id || null) });
});
router.delete('/:id', authRequired, (req, res) => {
  const row = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Wave not found.' });
  const isAdmin = ['admin', 'founder'].includes(db.prepare('SELECT role FROM users WHERE id=?').get(req.user.id).role);
  if (row.user_id !== req.user.id && !isAdmin) return res.status(403).json({ error: 'Not allowed.' });
  db.prepare('UPDATE posts SET deleted_at = datetime(\'now\') WHERE id = ?').run(row.id);
  res.json({ ok: true });
});

// ---------- LIKES ----------
router.post('/:id/like', authRequired, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Wave not found.' });
  db.prepare('INSERT OR IGNORE INTO post_likes (post_id, user_id) VALUES (?,?)').run(post.id, req.user.id);
  if (post.user_id !== req.user.id)
    notify(post.user_id, 'like', { actorId: req.user.id, postId: post.id, text: `@${req.user.username} waved at your post.` });
  res.json({ liked: true, likes: db.prepare('SELECT COUNT(*) c FROM post_likes WHERE post_id=?').get(post.id).c });
});
router.delete('/:id/like', authRequired, (req, res) => {
  db.prepare('DELETE FROM post_likes WHERE post_id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ liked: false, likes: db.prepare('SELECT COUNT(*) c FROM post_likes WHERE post_id=?').get(req.params.id).c || 0 });
});

// ---------- REPOST / QUOTE ----------
router.post('/:id/repost', authRequired, postLimiter, (req, res) => {
  const orig = db.prepare('SELECT * FROM posts WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!orig) return res.status(404).json({ error: 'Wave not found.' });
  const quoteText = String(req.body?.quote_text || '').slice(0, 500).trim();
  const exists = db.prepare('SELECT id FROM posts WHERE repost_of = ? AND user_id = ? AND deleted_at IS NULL').get(orig.id, req.user.id);
  if (exists && !quoteText) return res.status(409).json({ error: 'You already rewaved this.', code: 'ALREADY_REPOSTED' });
  const info = db.prepare(`INSERT INTO posts (user_id, text, quote_of, repost_of) VALUES (?,?,?,?)`)
    .run(req.user.id, quoteText, quoteText ? orig.id : null, quoteText ? null : orig.id);
  if (orig.user_id !== req.user.id)
    notify(orig.user_id, 'repost', { actorId: req.user.id, postId: orig.id, text: `@${req.user.username} ${quoteText ? 'quoted' : 'rewaved'} your post.` });
  res.status(201).json({ post: serializePost(db, db.prepare('SELECT * FROM posts WHERE id=?').get(info.lastInsertRowid), req.user.id) });
});
router.delete('/:id/repost', authRequired, (req, res) => {
  db.prepare('UPDATE posts SET deleted_at = datetime(\'now\') WHERE repost_of = ? AND user_id = ? AND deleted_at IS NULL')
    .run(req.params.id, req.user.id);
  res.json({ ok: true });
});

// ---------- BOOKMARKS ----------
router.post('/:id/bookmark', authRequired, (req, res) => {
  db.prepare('INSERT OR IGNORE INTO bookmarks (post_id, user_id) VALUES (?,?)').run(req.params.id, req.user.id);
  res.json({ bookmarked: true });
});
router.delete('/:id/bookmark', authRequired, (req, res) => {
  db.prepare('DELETE FROM bookmarks WHERE post_id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ bookmarked: false });
});

// ---------- POLL VOTE ----------
router.post('/:id/poll/vote', authRequired, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Wave not found.' });
  const poll = db.prepare('SELECT * FROM polls WHERE post_id = ?').get(post.id);
  if (!poll) return res.status(404).json({ error: 'No poll on this wave.' });
  const opt = db.prepare('SELECT * FROM poll_options WHERE id = ? AND poll_id = ?').get(req.body?.option_id, poll.id);
  if (!opt) return res.status(400).json({ error: 'Invalid poll option.' });
  const prev = db.prepare('SELECT * FROM poll_votes WHERE poll_id = ? AND user_id = ?').get(poll.id, req.user.id);
  const tx = db.transaction(() => {
    if (prev) db.prepare('UPDATE poll_options SET votes = votes - 1 WHERE id = ?').run(prev.option_id);
    else db.prepare('INSERT INTO poll_votes (poll_id, option_id, user_id) VALUES (?,?,?)').run(poll.id, opt.id, req.user.id);
    if (prev) db.prepare('UPDATE poll_votes SET option_id = ? WHERE id = ?').run(opt.id, prev.id);
    db.prepare('UPDATE poll_options SET votes = votes + 1 WHERE id = ?').run(opt.id);
  });
  tx();
  const { pollFor } = require('../utils/serialize');
  res.json({ poll: pollFor(db, post.id, req.user.id) });
});

// ---------- COMMENTS ----------
function serializeComment(db, c, viewerId) {
  const author = publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(c.user_id));
  const likes = db.prepare('SELECT COUNT(*) c FROM comment_likes WHERE comment_id=?').get(c.id).c;
  const liked = viewerId ? !!db.prepare('SELECT 1 FROM comment_likes WHERE comment_id=? AND user_id=?').get(c.id, viewerId) : false;
  const repliesCount = db.prepare('SELECT COUNT(*) c FROM comments WHERE parent_id=? AND deleted_at IS NULL').get(c.id).c;
  return { id: c.id, author, text: c.text, created_at: c.created_at, likes, liked, replies_count: repliesCount, parent_id: c.parent_id };
}
router.get('/:id/comments', authOptional, (req, res) => {
  const page = pageOf(req);
  const items = db.prepare(`SELECT * FROM comments WHERE post_id = ? AND parent_id IS NULL AND deleted_at IS NULL
    ORDER BY id ASC LIMIT ? OFFSET ?`).all(req.params.id, PAGE, (page - 1) * PAGE);
  const viewerId = req.user?.id || null;
  const out = items.map(c => {
    const s = serializeComment(db, c, viewerId);
    s.replies = db.prepare('SELECT * FROM comments WHERE parent_id = ? AND deleted_at IS NULL ORDER BY id ASC LIMIT 2')
      .all(c.id).map(r => serializeComment(db, r, viewerId));
    return s;
  });
  res.json({ items: out, page, has_more: items.length === PAGE });
});
router.post('/:id/comments', authRequired, postLimiter, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Wave not found.' });
  const text = String(req.body?.text || '').slice(0, 300).trim();
  if (!text) return res.status(400).json({ error: 'Comment can’t be empty.' });
  const parentId = req.body?.parent_id ? Number(req.body.parent_id) : null;
  if (parentId && !db.prepare('SELECT 1 FROM comments WHERE id = ? AND post_id = ?').get(parentId, post.id))
    return res.status(400).json({ error: 'Invalid reply target.' });
  const info = db.prepare('INSERT INTO comments (post_id, user_id, parent_id, text) VALUES (?,?,?,?)')
    .run(post.id, req.user.id, parentId, text);
  const c = db.prepare('SELECT * FROM comments WHERE id = ?').get(info.lastInsertRowid);
  // notify post author + parent comment author
  if (post.user_id !== req.user.id)
    notify(post.user_id, parentId ? 'reply' : 'comment', { actorId: req.user.id, postId: post.id, text: `@${req.user.username} ${parentId ? 'replied to a comment on' : 'commented on'} your wave.` });
  if (parentId) {
    const pc = db.prepare('SELECT user_id FROM comments WHERE id = ?').get(parentId);
    if (pc && pc.user_id !== req.user.id && pc.user_id !== post.user_id)
      notify(pc.user_id, 'reply', { actorId: req.user.id, postId: post.id, text: `@${req.user.username} replied to your comment.` });
  }
  for (const name of extractMentions(text)) {
    const u = db.prepare("SELECT id FROM users WHERE username = ? AND status='active'").get(name);
    if (u && u.id !== req.user.id) notify(u.id, 'mention', { actorId: req.user.id, postId: post.id, text: `@${req.user.username} mentioned you in a comment.` });
  }
  res.status(201).json({ comment: serializeComment(db, c, req.user.id) });
});
commentsRouter.delete('/:id', authRequired, (req, res) => {
  const c = db.prepare('SELECT * FROM comments WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Comment not found.' });
  const isAdmin = ['admin', 'founder'].includes(db.prepare('SELECT role FROM users WHERE id=?').get(req.user.id).role);
  if (c.user_id !== req.user.id && !isAdmin) return res.status(403).json({ error: 'Not allowed.' });
  db.prepare('UPDATE comments SET deleted_at = datetime(\'now\') WHERE id = ?').run(c.id);
  res.json({ ok: true });
});
commentsRouter.post('/:id/like', authRequired, (req, res) => {
  db.prepare('INSERT OR IGNORE INTO comment_likes (comment_id, user_id) VALUES (?,?)').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

// ---------- REPORT POST ----------
router.post('/:id/report', authRequired, (req, res) => {
  const { reason, details } = req.body || {};
  if (!reason) return res.status(400).json({ error: 'Tell us the reason.' });
  db.prepare('INSERT INTO reports (reporter_id, type, target_id, reason, details) VALUES (?,?,?,?,?)')
    .run(req.user.id, 'post', req.params.id, String(reason).slice(0, 100), String(details || '').slice(0, 1000));
  res.json({ ok: true, note: 'Thanks — our team will review this.' });
});

// ---------- SEARCH ----------
function searchAll(req, res) {
  const q = String(req.query.q || '').trim();
  const type = req.query.type || 'all';
  const viewerId = req.user?.id || null;
  const out = {};
  if (q.length >= 2) {
    const like = '%' + escLike(q) + '%';
    if (type === 'all' || type === 'people') {
      out.users = db.prepare(`SELECT * FROM users WHERE status='active' AND (username LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\') LIMIT 10`)
        .all(like, like).map(publicUser);
    }
    if (type === 'all' || type === 'posts') {
      const v = visibilityWhere(viewerId);
      out.posts = db.prepare(`SELECT p.* FROM posts p WHERE p.deleted_at IS NULL AND p.text LIKE ? ESCAPE '\\' AND ${v.where} ORDER BY p.id DESC LIMIT 20`)
        .all(like, ...v.params).map(r => serializePost(db, r, viewerId));
    }
    if (type === 'all' || type === 'hashtags') {
      const tag = q.replace(/^#/, '').toLowerCase();
      out.hashtags = db.prepare(`SELECT h.tag, COUNT(*) c FROM hashtags h JOIN post_hashtags ph ON ph.hashtag_id = h.id
        WHERE h.tag LIKE ? ESCAPE '\\' GROUP BY h.id ORDER BY c DESC LIMIT 10`).all('%' + escLike(tag) + '%');
    }
  }
  res.json(out);
}
router.get('/search/all', authOptional, searchAll);

// ---------- TRENDING HASHTAGS (real activity, last 48h) ----------
function trendingTags(req, res) {
  const { categorize } = require('../utils/pulse');
  const rows = db.prepare(`
    SELECT h.tag, COUNT(DISTINCT ph.post_id) AS posts_count
    FROM hashtags h
    JOIN post_hashtags ph ON ph.hashtag_id = h.id
    JOIN posts p ON p.id = ph.post_id
    WHERE p.deleted_at IS NULL AND p.created_at > datetime('now','-2 days')
    GROUP BY h.id HAVING posts_count >= 1
    ORDER BY posts_count DESC LIMIT 30`).all();
  res.json({ topics: rows.map(r => ({ tag: r.tag, posts_count: r.posts_count, category: categorize(r.tag) })) });
}
router.get('/hashtags/trending', trendingTags);
function hashtagFeed(req, res) {
  const tag = String(req.params.tag).replace(/^#/, '').toLowerCase();
  const page = pageOf(req);
  const viewerId = req.user?.id || null;
  const v = visibilityWhere(viewerId);
  const rows = db.prepare(`
    SELECT p.* FROM posts p
    JOIN post_hashtags ph ON ph.post_id = p.id
    JOIN hashtags h ON h.id = ph.hashtag_id
    WHERE h.tag = ? AND p.deleted_at IS NULL AND ${v.where}
    ORDER BY p.id DESC LIMIT ? OFFSET ?`).all(tag, ...v.params, PAGE, (page - 1) * PAGE);
  res.json({ tag, items: rows.map(r => serializePost(db, r, viewerId)), page, has_more: rows.length === PAGE });
}
router.get('/hashtags/:tag', authOptional, hashtagFeed);

// ---------- MY BOOKMARKS ----------
router.get('/bookmarks/mine', authRequired, (req, res) => {
  const page = pageOf(req);
  const rows = db.prepare(`SELECT p.* FROM bookmarks b JOIN posts p ON p.id = b.post_id
    WHERE b.user_id = ? AND p.deleted_at IS NULL ORDER BY b.id DESC LIMIT ? OFFSET ?`)
    .all(req.user.id, PAGE, (page - 1) * PAGE);
  res.json({ items: rows.map(r => serializePost(db, r, req.user.id)), page, has_more: rows.length === PAGE });
});

module.exports = router;
module.exports.searchAll = searchAll;
module.exports.trendingTags = trendingTags;
module.exports.hashtagFeed = hashtagFeed;
module.exports.feedRouter = feedRouter;
module.exports.commentsRouter = commentsRouter;
