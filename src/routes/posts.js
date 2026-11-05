// Posts: create, feeds, explore, likes, reposts, bookmarks, polls, comments, search, hashtags.
const express = require('express');
const db = require('../db');
const { authRequired, authOptional } = require('../middleware/auth');
const { postLimiter } = require('../middleware/rateLimit');
const { extractHashtags, extractMentions, escLike, publicUser } = require('../utils/helpers');
const { serializePost, visibilityWhere, spliceWhere } = require('../utils/serialize');
const { notify } = require('../utils/notify');

const router = express.Router();
const feedRouter = express.Router();   // mounted at /api  -> /api/feed/*, /api/explore
const commentsRouter = express.Router(); // mounted at /api -> /api/comments/*
const PAGE = 20;

function pageOf(req) { return Math.max(1, parseInt(req.query.page) || 1); }

// ---------- CREATE ----------
router.post('/', authRequired, postLimiter, async (req, res) => {
  const { text = '', media_ids = [], poll, location, section = 'feed', visibility = 'public' } = req.body || {};
  const clean = String(text).slice(0, 500).trim();
  const mediaIds = Array.isArray(media_ids) ? media_ids.slice(0, 4).map(Number).filter(Boolean) : [];
  if (!clean && !mediaIds.length && !poll) return res.status(400).json({ error: 'Write something or add media first.' });
  if (!['feed', 'buzz'].includes(section)) return res.status(400).json({ error: 'Invalid section.' });
  if (!['public', 'followers'].includes(visibility)) return res.status(400).json({ error: 'Invalid visibility.' });

  // validate media: owned by user, not already attached
  let media = [];
  if (mediaIds.length) {
    media = await db.all(`SELECT * FROM media WHERE id IN (${mediaIds.map((_, i) => '$' + (i + 1)).join(',')})`, ...mediaIds);
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

  const info = await db.run(`INSERT INTO posts (user_id, text, section, location, visibility)
    VALUES ($1,$2,$3,$4,$5) RETURNING id`, req.user.id, clean, section, location ? String(location).slice(0, 80) : null, visibility);
  const postId = info.lastInsertRowid;
  for (const m of media) {
    await db.run('UPDATE media SET post_id = $1 WHERE id = $2', postId, m.id);
  }
  if (pollData) {
    const p = await db.run('INSERT INTO polls (post_id, question) VALUES ($1,$2) RETURNING id', postId, pollData.question);
    for (const o of pollData.options) {
      await db.run('INSERT INTO poll_options (poll_id, text) VALUES ($1,$2) RETURNING id', p.lastInsertRowid, o);
    }
  }
  // hashtags
  for (const tag of extractHashtags(clean)) {
    await db.run('INSERT INTO hashtags (tag) VALUES ($1) ON CONFLICT (tag) DO NOTHING RETURNING id', tag);
    const h = await db.get('SELECT id FROM hashtags WHERE tag = $1', tag);
    await db.run('INSERT INTO post_hashtags (post_id, hashtag_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', postId, h.id);
  }
  // mentions → notifications
  for (const name of extractMentions(clean)) {
    const u = await db.get("SELECT id FROM users WHERE username = $1 AND status='active'", name);
    if (u && u.id !== req.user.id) notify(u.id, 'mention', { actorId: req.user.id, postId, text: `@${req.user.username} mentioned you in a wave.` }).catch(() => {});
  }

  const row = await db.get('SELECT * FROM posts WHERE id = $1', postId);
  res.status(201).json({ post: await serializePost(db, row, req.user.id) });
});

// ---------- FEEDS ----------
async function feedQuery(req, res, mode) {
  const viewerId = req.user.id;
  const page = pageOf(req);
  const v = visibilityWhere(viewerId);
  const conds = [spliceWhere(v.where, 0)];
  const params = [...v.params];
  if (mode === 'following') {
    conds.push(`p.user_id IN (SELECT followee_id FROM follows WHERE follower_id = $${params.length + 1})`);
    params.push(viewerId);
  }
  // For You ranking: engagement velocity — real numbers only
  const order = mode === 'foryou'
    ? `ORDER BY (COALESCE((SELECT COUNT(*) FROM post_likes WHERE post_id = p.id),0)*2
        + COALESCE((SELECT COUNT(*) FROM comments WHERE post_id = p.id AND deleted_at IS NULL),0)*3
        + COALESCE((SELECT COUNT(*) FROM posts r WHERE r.repost_of = p.id AND r.deleted_at IS NULL),0)*4)
        / POWER(EXTRACT(EPOCH FROM (NOW() - p.created_at))/3600 + 2, 1.3) DESC, p.id DESC`
    : 'ORDER BY p.id DESC';
  const lim = params.length + 1, off = params.length + 2;
  const rows = await db.all(`
    SELECT p.* FROM posts p
    WHERE p.deleted_at IS NULL AND p.section = 'feed' AND ${conds.join(' AND ')}
    ${order} LIMIT $${lim} OFFSET $${off}`, ...params, PAGE, (page - 1) * PAGE);
  res.json({ items: await Promise.all(rows.map(r => serializePost(db, r, viewerId))), page, has_more: rows.length === PAGE });
}
feedRouter.get('/feed/foryou', authRequired, (req, res, next) => feedQuery(req, res, 'foryou').catch(next));
feedRouter.get('/feed/following', authRequired, (req, res, next) => feedQuery(req, res, 'following').catch(next));

// explore: popular posts + trending tags + suggested users
feedRouter.get('/explore', authRequired, async (req, res) => {
  const viewerId = req.user.id;
  const v = visibilityWhere(viewerId);
  const vis = spliceWhere(v.where, 0);
  const posts = await db.all(`
    SELECT p.* FROM posts p WHERE p.deleted_at IS NULL AND p.section='feed' AND ${vis}
    AND p.created_at > NOW() - INTERVAL '7 days'
    ORDER BY (COALESCE((SELECT COUNT(*) FROM post_likes WHERE post_id=p.id),0)
      + COALESCE((SELECT COUNT(*) FROM comments WHERE post_id=p.id AND deleted_at IS NULL),0)*2) DESC
    LIMIT 20`, ...v.params);
  res.json({ posts: await Promise.all(posts.map(r => serializePost(db, r, viewerId))) });
});

// ---------- SINGLE / DELETE ----------
router.get('/:id', authOptional, async (req, res) => {
  const row = await db.get('SELECT * FROM posts WHERE id = $1 AND deleted_at IS NULL', req.params.id);
  if (!row) return res.status(404).json({ error: 'Wave not found.' });
  res.json({ post: await serializePost(db, row, req.user?.id || null) });
});
router.delete('/:id', authRequired, async (req, res) => {
  const row = await db.get('SELECT * FROM posts WHERE id = $1', req.params.id);
  if (!row) return res.status(404).json({ error: 'Wave not found.' });
  const isAdmin = ['admin', 'founder'].includes((await db.get('SELECT role FROM users WHERE id=$1', req.user.id)).role);
  if (row.user_id !== req.user.id && !isAdmin) return res.status(403).json({ error: 'Not allowed.' });
  await db.run('UPDATE posts SET deleted_at = NOW() WHERE id = $1', row.id);
  res.json({ ok: true });
});

// ---------- LIKES ----------
router.post('/:id/like', authRequired, async (req, res) => {
  const post = await db.get('SELECT * FROM posts WHERE id = $1 AND deleted_at IS NULL', req.params.id);
  if (!post) return res.status(404).json({ error: 'Wave not found.' });
  await db.run('INSERT INTO post_likes (post_id, user_id) VALUES ($1,$2) ON CONFLICT (post_id, user_id) DO NOTHING RETURNING id', post.id, req.user.id);
  if (post.user_id !== req.user.id)
    notify(post.user_id, 'like', { actorId: req.user.id, postId: post.id, text: `@${req.user.username} waved at your post.` }).catch(() => {});
  res.json({ liked: true, likes: (await db.get('SELECT COUNT(*)::int c FROM post_likes WHERE post_id=$1', post.id)).c });
});
router.delete('/:id/like', authRequired, async (req, res) => {
  await db.run('DELETE FROM post_likes WHERE post_id = $1 AND user_id = $2', req.params.id, req.user.id);
  res.json({ liked: false, likes: (await db.get('SELECT COUNT(*)::int c FROM post_likes WHERE post_id=$1', req.params.id)).c || 0 });
});

// ---------- REPOST / QUOTE ----------
router.post('/:id/repost', authRequired, postLimiter, async (req, res) => {
  const orig = await db.get('SELECT * FROM posts WHERE id = $1 AND deleted_at IS NULL', req.params.id);
  if (!orig) return res.status(404).json({ error: 'Wave not found.' });
  const quoteText = String(req.body?.quote_text || '').slice(0, 500).trim();
  const exists = await db.get('SELECT id FROM posts WHERE repost_of = $1 AND user_id = $2 AND deleted_at IS NULL', orig.id, req.user.id);
  if (exists && !quoteText) return res.status(409).json({ error: 'You already rewaved this.', code: 'ALREADY_REPOSTED' });
  const info = await db.run(`INSERT INTO posts (user_id, text, quote_of, repost_of) VALUES ($1,$2,$3,$4) RETURNING id`,
    req.user.id, quoteText, quoteText ? orig.id : null, quoteText ? null : orig.id);
  if (orig.user_id !== req.user.id)
    notify(orig.user_id, 'repost', { actorId: req.user.id, postId: orig.id, text: `@${req.user.username} ${quoteText ? 'quoted' : 'rewaved'} your post.` }).catch(() => {});
  res.status(201).json({ post: await serializePost(db, await db.get('SELECT * FROM posts WHERE id=$1', info.lastInsertRowid), req.user.id) });
});
router.delete('/:id/repost', authRequired, async (req, res) => {
  await db.run('UPDATE posts SET deleted_at = NOW() WHERE repost_of = $1 AND user_id = $2 AND deleted_at IS NULL',
    req.params.id, req.user.id);
  res.json({ ok: true });
});

// ---------- BOOKMARKS ----------
router.post('/:id/bookmark', authRequired, async (req, res) => {
  await db.run('INSERT INTO bookmarks (post_id, user_id) VALUES ($1,$2) ON CONFLICT (post_id, user_id) DO NOTHING RETURNING id', req.params.id, req.user.id);
  res.json({ bookmarked: true });
});
router.delete('/:id/bookmark', authRequired, async (req, res) => {
  await db.run('DELETE FROM bookmarks WHERE post_id = $1 AND user_id = $2', req.params.id, req.user.id);
  res.json({ bookmarked: false });
});

// ---------- POLL VOTE ----------
router.post('/:id/poll/vote', authRequired, async (req, res) => {
  const post = await db.get('SELECT * FROM posts WHERE id = $1 AND deleted_at IS NULL', req.params.id);
  if (!post) return res.status(404).json({ error: 'Wave not found.' });
  const poll = await db.get('SELECT * FROM polls WHERE post_id = $1', post.id);
  if (!poll) return res.status(404).json({ error: 'No poll on this wave.' });
  const opt = await db.get('SELECT * FROM poll_options WHERE id = $1 AND poll_id = $2', req.body?.option_id, poll.id);
  if (!opt) return res.status(400).json({ error: 'Invalid poll option.' });
  const prev = await db.get('SELECT * FROM poll_votes WHERE poll_id = $1 AND user_id = $2', poll.id, req.user.id);
  await db.transaction(async (tx) => {
    if (prev) await tx.run('UPDATE poll_options SET votes = votes - 1 WHERE id = $1', prev.option_id);
    else await tx.run('INSERT INTO poll_votes (poll_id, option_id, user_id) VALUES ($1,$2,$3) RETURNING id', poll.id, opt.id, req.user.id);
    if (prev) await tx.run('UPDATE poll_votes SET option_id = $1 WHERE id = $2', opt.id, prev.id);
    await tx.run('UPDATE poll_options SET votes = votes + 1 WHERE id = $1', opt.id);
  });
  const { pollFor } = require('../utils/serialize');
  res.json({ poll: await pollFor(db, post.id, req.user.id) });
});

// ---------- COMMENTS ----------
async function serializeComment(db, c, viewerId) {
  const author = publicUser(await db.get('SELECT * FROM users WHERE id=$1', c.user_id));
  const likes = (await db.get('SELECT COUNT(*)::int c FROM comment_likes WHERE comment_id=$1', c.id)).c;
  const liked = viewerId ? !!(await db.get('SELECT 1 FROM comment_likes WHERE comment_id=$1 AND user_id=$2', c.id, viewerId)) : false;
  const repliesCount = (await db.get('SELECT COUNT(*)::int c FROM comments WHERE parent_id=$1 AND deleted_at IS NULL', c.id)).c;
  return { id: c.id, author, text: c.text, created_at: c.created_at, likes, liked, replies_count: repliesCount, parent_id: c.parent_id };
}
router.get('/:id/comments', authOptional, async (req, res) => {
  const page = pageOf(req);
  const items = await db.all(`SELECT * FROM comments WHERE post_id = $1 AND parent_id IS NULL AND deleted_at IS NULL
    ORDER BY id ASC LIMIT $2 OFFSET $3`, req.params.id, PAGE, (page - 1) * PAGE);
  const viewerId = req.user?.id || null;
  const out = [];
  for (const c of items) {
    const s = await serializeComment(db, c, viewerId);
    const replies = await db.all('SELECT * FROM comments WHERE parent_id = $1 AND deleted_at IS NULL ORDER BY id ASC LIMIT 2', c.id);
    s.replies = await Promise.all(replies.map(r => serializeComment(db, r, viewerId)));
    out.push(s);
  }
  res.json({ items: out, page, has_more: items.length === PAGE });
});
router.post('/:id/comments', authRequired, postLimiter, async (req, res) => {
  const post = await db.get('SELECT * FROM posts WHERE id = $1 AND deleted_at IS NULL', req.params.id);
  if (!post) return res.status(404).json({ error: 'Wave not found.' });
  const text = String(req.body?.text || '').slice(0, 300).trim();
  if (!text) return res.status(400).json({ error: 'Comment can’t be empty.' });
  const parentId = req.body?.parent_id ? Number(req.body.parent_id) : null;
  if (parentId && !await db.get('SELECT 1 FROM comments WHERE id = $1 AND post_id = $2', parentId, post.id))
    return res.status(400).json({ error: 'Invalid reply target.' });
  const info = await db.run('INSERT INTO comments (post_id, user_id, parent_id, text) VALUES ($1,$2,$3,$4) RETURNING id',
    post.id, req.user.id, parentId, text);
  const c = await db.get('SELECT * FROM comments WHERE id = $1', info.lastInsertRowid);
  // notify post author + parent comment author
  if (post.user_id !== req.user.id)
    notify(post.user_id, parentId ? 'reply' : 'comment', { actorId: req.user.id, postId: post.id, text: `@${req.user.username} ${parentId ? 'replied to a comment on' : 'commented on'} your wave.` }).catch(() => {});
  if (parentId) {
    const pc = await db.get('SELECT user_id FROM comments WHERE id = $1', parentId);
    if (pc && pc.user_id !== req.user.id && pc.user_id !== post.user_id)
      notify(pc.user_id, 'reply', { actorId: req.user.id, postId: post.id, text: `@${req.user.username} replied to your comment.` }).catch(() => {});
  }
  for (const name of extractMentions(text)) {
    const u = await db.get("SELECT id FROM users WHERE username = $1 AND status='active'", name);
    if (u && u.id !== req.user.id) notify(u.id, 'mention', { actorId: req.user.id, postId: post.id, text: `@${req.user.username} mentioned you in a comment.` }).catch(() => {});
  }
  res.status(201).json({ comment: await serializeComment(db, c, req.user.id) });
});
commentsRouter.delete('/:id', authRequired, async (req, res) => {
  const c = await db.get('SELECT * FROM comments WHERE id = $1', req.params.id);
  if (!c) return res.status(404).json({ error: 'Comment not found.' });
  const isAdmin = ['admin', 'founder'].includes((await db.get('SELECT role FROM users WHERE id=$1', req.user.id)).role);
  if (c.user_id !== req.user.id && !isAdmin) return res.status(403).json({ error: 'Not allowed.' });
  await db.run('UPDATE comments SET deleted_at = NOW() WHERE id = $1', c.id);
  res.json({ ok: true });
});
commentsRouter.post('/:id/like', authRequired, async (req, res) => {
  await db.run('INSERT INTO comment_likes (comment_id, user_id) VALUES ($1,$2) ON CONFLICT (comment_id, user_id) DO NOTHING RETURNING id', req.params.id, req.user.id);
  res.json({ ok: true });
});

// ---------- REPORT POST ----------
router.post('/:id/report', authRequired, async (req, res) => {
  const { reason, details } = req.body || {};
  if (!reason) return res.status(400).json({ error: 'Tell us the reason.' });
  await db.run('INSERT INTO reports (reporter_id, type, target_id, reason, details) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    req.user.id, 'post', req.params.id, String(reason).slice(0, 100), String(details || '').slice(0, 1000));
  res.json({ ok: true, note: 'Thanks — our team will review this.' });
});

// ---------- SEARCH ----------
async function searchAll(req, res) {
  const q = String(req.query.q || '').trim();
  const type = req.query.type || 'all';
  const viewerId = req.user?.id || null;
  const out = {};
  if (q.length >= 2) {
    const like = '%' + escLike(q) + '%';
    if (type === 'all' || type === 'people') {
      out.users = (await db.all(`SELECT * FROM users WHERE status='active' AND (username ILIKE $1 ESCAPE '\\' OR display_name ILIKE $2 ESCAPE '\\') LIMIT 10`,
        like, like)).map(publicUser);
    }
    if (type === 'all' || type === 'posts') {
      const v = visibilityWhere(viewerId);
      const vis = spliceWhere(v.where, 1);
      const rows = await db.all(`SELECT p.* FROM posts p WHERE p.deleted_at IS NULL AND p.text ILIKE $1 ESCAPE '\\' AND ${vis} ORDER BY p.id DESC LIMIT 20`,
        like, ...v.params);
      out.posts = await Promise.all(rows.map(r => serializePost(db, r, viewerId)));
    }
    if (type === 'all' || type === 'hashtags') {
      const tag = q.replace(/^#/, '').toLowerCase();
      out.hashtags = await db.all(`SELECT h.tag, COUNT(*)::int c FROM hashtags h JOIN post_hashtags ph ON ph.hashtag_id = h.id
        WHERE h.tag ILIKE $1 ESCAPE '\\' GROUP BY h.id ORDER BY c DESC LIMIT 10`, '%' + escLike(tag) + '%');
    }
  }
  res.json(out);
}
router.get('/search/all', authOptional, searchAll);

// ---------- TRENDING HASHTAGS (real activity, last 48h) ----------
async function trendingTags(req, res) {
  const { categorize } = require('../utils/pulse');
  const rows = await db.all(`
    SELECT h.tag, COUNT(DISTINCT ph.post_id)::int AS posts_count
    FROM hashtags h
    JOIN post_hashtags ph ON ph.hashtag_id = h.id
    JOIN posts p ON p.id = ph.post_id
    WHERE p.deleted_at IS NULL AND p.created_at > NOW() - INTERVAL '2 days'
    GROUP BY h.id HAVING COUNT(DISTINCT ph.post_id) >= 1
    ORDER BY posts_count DESC LIMIT 30`);
  res.json({ topics: rows.map(r => ({ tag: r.tag, posts_count: r.posts_count, category: categorize(r.tag) })) });
}
router.get('/hashtags/trending', trendingTags);
async function hashtagFeed(req, res) {
  const tag = String(req.params.tag).replace(/^#/, '').toLowerCase();
  const page = pageOf(req);
  const viewerId = req.user?.id || null;
  const v = visibilityWhere(viewerId);
  const vis = spliceWhere(v.where, 1);
  const params = [tag, ...v.params];
  const lim = params.length + 1, off = params.length + 2;
  const rows = await db.all(`
    SELECT p.* FROM posts p
    JOIN post_hashtags ph ON ph.post_id = p.id
    JOIN hashtags h ON h.id = ph.hashtag_id
    WHERE h.tag = $1 AND p.deleted_at IS NULL AND ${vis}
    ORDER BY p.id DESC LIMIT $${lim} OFFSET $${off}`, ...params, PAGE, (page - 1) * PAGE);
  res.json({ tag, items: await Promise.all(rows.map(r => serializePost(db, r, viewerId))), page, has_more: rows.length === PAGE });
}
router.get('/hashtags/:tag', authOptional, hashtagFeed);

// ---------- MY BOOKMARKS ----------
router.get('/bookmarks/mine', authRequired, async (req, res) => {
  const page = pageOf(req);
  const rows = await db.all(`SELECT p.* FROM bookmarks b JOIN posts p ON p.id = b.post_id
    WHERE b.user_id = $1 AND p.deleted_at IS NULL ORDER BY b.id DESC LIMIT $2 OFFSET $3`,
    req.user.id, PAGE, (page - 1) * PAGE);
  res.json({ items: await Promise.all(rows.map(r => serializePost(db, r, req.user.id))), page, has_more: rows.length === PAGE });
});

module.exports = router;
module.exports.searchAll = searchAll;
module.exports.trendingTags = trendingTags;
module.exports.hashtagFeed = hashtagFeed;
module.exports.feedRouter = feedRouter;
module.exports.commentsRouter = commentsRouter;
