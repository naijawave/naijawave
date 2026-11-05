// Serialize a post row into the full API post object.
const { publicUser } = require('./helpers');

async function mediaFor(db, postId) {
  return db.all('SELECT id, url, kind, mime, size, duration FROM media WHERE post_id = $1 ORDER BY id', postId);
}

async function pollFor(db, postId, viewerId) {
  const poll = await db.get('SELECT * FROM polls WHERE post_id = $1', postId);
  if (!poll) return null;
  const options = await db.all('SELECT id, text, votes FROM poll_options WHERE poll_id = $1 ORDER BY id', poll.id);
  const total = options.reduce((s, o) => s + o.votes, 0);
  let myVote = null;
  if (viewerId) {
    const v = await db.get('SELECT option_id FROM poll_votes WHERE poll_id = $1 AND user_id = $2', poll.id, viewerId);
    if (v) myVote = v.option_id;
  }
  return { id: poll.id, question: poll.question, options, total_votes: total, my_vote: myVote };
}

async function countsFor(db, postId) {
  const likes = (await db.get('SELECT COUNT(*)::int c FROM post_likes WHERE post_id = $1', postId)).c;
  const comments = (await db.get('SELECT COUNT(*)::int c FROM comments WHERE post_id = $1 AND deleted_at IS NULL', postId)).c;
  const reposts = (await db.get('SELECT COUNT(*)::int c FROM posts WHERE repost_of = $1 AND deleted_at IS NULL', postId)).c;
  const quotes = (await db.get('SELECT COUNT(*)::int c FROM posts WHERE quote_of = $1 AND deleted_at IS NULL', postId)).c;
  return { likes, comments, reposts, quotes };
}

async function tagsFor(db, postId) {
  const rows = await db.all(`SELECT h.tag FROM post_hashtags ph JOIN hashtags h ON h.id = ph.hashtag_id WHERE ph.post_id = $1`, postId);
  return rows.map(r => r.tag);
}

async function serializePost(db, row, viewerId, depth = 0) {
  if (!row) return null;
  const author = publicUser(await db.get('SELECT * FROM users WHERE id = $1', row.user_id));
  const counts = await countsFor(db, row.id);
  let liked = false, reposted = false, bookmarked = false;
  if (viewerId) {
    liked = !!(await db.get('SELECT 1 FROM post_likes WHERE post_id = $1 AND user_id = $2', row.id, viewerId));
    reposted = !!(await db.get('SELECT 1 FROM posts WHERE repost_of = $1 AND user_id = $2 AND deleted_at IS NULL', row.id, viewerId));
    bookmarked = !!(await db.get('SELECT 1 FROM bookmarks WHERE post_id = $1 AND user_id = $2', row.id, viewerId));
  }
  let quoteOf = null, repostOf = null;
  if (depth < 1) {
    if (row.quote_of) {
      const q = await db.get("SELECT * FROM posts WHERE id = $1 AND deleted_at IS NULL", row.quote_of);
      quoteOf = q ? await serializePost(db, q, viewerId, depth + 1) : { deleted: true };
    }
    if (row.repost_of) {
      const r = await db.get("SELECT * FROM posts WHERE id = $1 AND deleted_at IS NULL", row.repost_of);
      repostOf = r ? await serializePost(db, r, viewerId, depth + 1) : { deleted: true };
    }
  }
  return {
    id: row.id, author, text: row.text, created_at: row.created_at,
    media: await mediaFor(db, row.id), poll: await pollFor(db, row.id, viewerId),
    counts, liked, reposted, bookmarked, hashtags: await tagsFor(db, row.id),
    section: row.section, location: row.location || null,
    visibility: row.visibility, is_sponsored: !!row.is_sponsored,
    sponsor_label: row.sponsor_label || null,
    quote_of: quoteOf, repost_of: repostOf,
    unverified: row.section === 'buzz' && author.verification === 'none',
  };
}

// SQL fragment: posts visible to viewer (blocks + followers-only visibility).
// Placeholders are plain `?` (same as the old better-sqlite3 convention).
// Callers splice v.where into a larger query and MUST renumber its `?` to $n
// using spliceWhere() below, e.g.:
//
//   const v = visibilityWhere(viewerId);
//   const vis = spliceWhere(v.where, params.length); // params bound BEFORE the fragment
//   const sql = `SELECT p.* FROM posts p WHERE p.section = 'feed' AND ${vis} AND p.user_id = $1`;
//   const rows = await db.all(sql, ...params, ...v.params, viewerId);
//
function visibilityWhere(viewerId) {
  // returns { where, params } to AND with other conditions; alias p for posts
  if (!viewerId) return { where: "p.visibility = 'public'", params: [] };
  return {
    where: `(p.visibility = 'public' OR p.user_id = ? OR EXISTS (SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = p.user_id))
      AND NOT EXISTS (SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = p.user_id) OR (blocker_id = p.user_id AND blocked_id = ?))`,
    params: [viewerId, viewerId, viewerId, viewerId],
  };
}

// Renumber a `?`-style fragment to pg $n placeholders.
// `offset` = number of params already bound before the fragment in the final query.
// Example: fragment's 4 `?` with offset 2 → $3,$4,$5,$6.
function spliceWhere(fragment, offset) {
  let n = offset;
  return String(fragment).replace(/\?/g, () => '$' + (++n));
}

module.exports = { serializePost, visibilityWhere, spliceWhere, mediaFor, pollFor };
