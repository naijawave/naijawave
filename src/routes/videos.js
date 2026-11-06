// Videos: TikTok, Instagram and YouTube videos added by LINK only —
// embedded player, no upload, no cap on how many can be added.
// Mounted at /api/videos (canonical) and /api/tiktok (alias).
const express = require('express');
const db = require('../db');
const { authRequired, authOptional } = require('../middleware/auth');
const { publicUser } = require('../utils/helpers');
const { detectVideo, PLATFORM_LABEL } = require('../utils/videos');

const router = express.Router();
const PAGE = 20;

function serializeVideo(r) {
  return {
    id: r.id,
    platform: r.platform,
    video_id: r.video_id,
    url: r.url,
    title: r.title || '',
    created_at: r.created_at,
    // publicUser reads id/created_at — give it the user's own values,
    // not the video row's (the SELECT aliases them apart).
    user: publicUser({ ...r, id: r.user_id, created_at: r.user_created_at }),
  };
}

const VIDEO_SELECT = `SELECT t.id, t.platform, t.video_id, t.url, t.title, t.user_id, t.created_at,
  u.username, u.display_name, u.avatar_url, u.verification,
  u.bio, u.location, u.website, u.is_founder, u.role, u.status, u.created_at AS user_created_at
  FROM videos t JOIN users u ON u.id = t.user_id`;

// ---------- LIST (newest first) ----------
router.get('/', authOptional, async (req, res) => {
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || PAGE));
  const offset = Math.max(0, parseInt(req.query.offset) || 0);
  const platform = String(req.query.platform || '').toLowerCase();
  const where = ['t.deleted_at IS NULL'];
  const params = [limit, offset];
  if (['tiktok', 'instagram', 'youtube'].includes(platform)) {
    where.push('t.platform = $3');
    params.push(platform);
  }
  const rows = await db.all(`${VIDEO_SELECT}
    WHERE ${where.join(' AND ')} ORDER BY t.id DESC LIMIT $1 OFFSET $2`, ...params);
  res.json({ items: rows.map(serializeVideo), has_more: rows.length === limit });
});

// ---------- ADD BY LINK ----------
router.post('/', authRequired, async (req, res) => {
  const { url, title } = req.body || {};
  if (!url || typeof url !== 'string') return res.status(400).json({ error: 'Paste a TikTok, Instagram or YouTube video link.' });
  const found = await detectVideo(url);
  if (!found) return res.status(400).json({ error: "That doesn't look like a TikTok, Instagram or YouTube video link." });

  // Dedupe: same video already on the page → return the existing row, no duplicate.
  const existing = await db.get(`${VIDEO_SELECT}
    WHERE t.platform = $1 AND t.video_id = $2 AND t.deleted_at IS NULL ORDER BY t.id DESC LIMIT 1`, found.platform, found.video_id);
  if (existing) return res.json({ video: serializeVideo(existing), created: false });

  const info = await db.run(
    'INSERT INTO videos (platform, video_id, url, title, user_id) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    found.platform, found.video_id, found.canonical, String(title || '').slice(0, 120), req.user.id);
  const row = await db.get(`${VIDEO_SELECT} WHERE t.id = $1`, info.lastInsertRowid);
  res.status(201).json({ video: serializeVideo(row), created: true });
});

// ---------- REMOVE (owner or founder/admin) ----------
router.delete('/:id', authRequired, async (req, res) => {
  const row = await db.get('SELECT * FROM videos WHERE id = $1 AND deleted_at IS NULL', req.params.id);
  if (!row) return res.status(404).json({ error: 'Video not found.' });
  const isAdmin = ['admin', 'founder'].includes(req.user.role);
  if (row.user_id !== req.user.id && !isAdmin) return res.status(403).json({ error: 'Not allowed.' });
  await db.run('UPDATE videos SET deleted_at = NOW() WHERE id = $1', row.id);
  res.json({ ok: true });
});

module.exports = router;
module.exports.serializeVideo = serializeVideo;
module.exports.PLATFORM_LABEL = PLATFORM_LABEL;
