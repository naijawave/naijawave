// Serialize a post row into the full API post object.
const { publicUser } = require('./helpers');

function mediaFor(db, postId) {
  return db.prepare('SELECT id, url, kind, mime, size, duration FROM media WHERE post_id = ? ORDER BY id').all(postId);
}

function pollFor(db, postId, viewerId) {
  const poll = db.prepare('SELECT * FROM polls WHERE post_id = ?').get(postId);
  if (!poll) return null;
  const options = db.prepare('SELECT id, text, votes FROM poll_options WHERE poll_id = ? ORDER BY id').all(poll.id);
  const total = options.reduce((s, o) => s + o.votes, 0);
  let myVote = null;
  if (viewerId) {
    const v = db.prepare('SELECT option_id FROM poll_votes WHERE poll_id = ? AND user_id = ?').get(poll.id, viewerId);
    if (v) myVote = v.option_id;
  }
  return { id: poll.id, question: poll.question, options, total_votes: total, my_vote: myVote };
}

function countsFor(db, postId) {
  const likes = db.prepare('SELECT COUNT(*) c FROM post_likes WHERE post_id = ?').get(postId).c;
  const comments = db.prepare('SELECT COUNT(*) c FROM comments WHERE post_id = ? AND deleted_at IS NULL').get(postId).c;
  const reposts = db.prepare('SELECT COUNT(*) c FROM posts WHERE repost_of = ? AND deleted_at IS NULL').get(postId).c;
  const quotes = db.prepare('SELECT COUNT(*) c FROM posts WHERE quote_of = ? AND deleted_at IS NULL').get(postId).c;
  return { likes, comments, reposts, quotes };
}

function tagsFor(db, postId) {
  return db.prepare(`SELECT h.tag FROM post_hashtags ph JOIN hashtags h ON h.id = ph.hashtag_id WHERE ph.post_id = ?`).all(postId).map(r => r.tag);
}

function serializePost(db, row, viewerId, depth = 0) {
  if (!row) return null;
  const author = publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id));
  const counts = countsFor(db, row.id);
  let liked = false, reposted = false, bookmarked = false;
  if (viewerId) {
    liked = !!db.prepare('SELECT 1 FROM post_likes WHERE post_id = ? AND user_id = ?').get(row.id, viewerId);
    reposted = !!db.prepare('SELECT 1 FROM posts WHERE repost_of = ? AND user_id = ? AND deleted_at IS NULL').get(row.id, viewerId);
    bookmarked = !!db.prepare('SELECT 1 FROM bookmarks WHERE post_id = ? AND user_id = ?').get(row.id, viewerId);
  }
  let quoteOf = null, repostOf = null;
  if (depth < 1) {
    if (row.quote_of) {
      const q = db.prepare("SELECT * FROM posts WHERE id = ? AND deleted_at IS NULL").get(row.quote_of);
      quoteOf = q ? serializePost(db, q, viewerId, depth + 1) : { deleted: true };
    }
    if (row.repost_of) {
      const r = db.prepare("SELECT * FROM posts WHERE id = ? AND deleted_at IS NULL").get(row.repost_of);
      repostOf = r ? serializePost(db, r, viewerId, depth + 1) : { deleted: true };
    }
  }
  return {
    id: row.id, author, text: row.text, created_at: row.created_at,
    media: mediaFor(db, row.id), poll: pollFor(db, row.id, viewerId),
    counts, liked, reposted, bookmarked, hashtags: tagsFor(db, row.id),
    section: row.section, location: row.location || null,
    visibility: row.visibility, is_sponsored: !!row.is_sponsored,
    sponsor_label: row.sponsor_label || null,
    quote_of: quoteOf, repost_of: repostOf,
    unverified: row.section === 'buzz' && author.verification === 'none',
  };
}

// SQL fragment: posts visible to viewer (blocks + followers-only visibility)
function visibilityWhere(viewerId) {
  // returns { where, params } to AND with other conditions; alias p for posts
  if (!viewerId) return { where: "p.visibility = 'public'", params: [] };
  return {
    where: `(p.visibility = 'public' OR p.user_id = ? OR EXISTS (SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = p.user_id))
      AND NOT EXISTS (SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = p.user_id) OR (blocker_id = p.user_id AND blocked_id = ?))`,
    params: [viewerId, viewerId, viewerId, viewerId],
  };
}

module.exports = { serializePost, visibilityWhere, mediaFor, pollFor };
