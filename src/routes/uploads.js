// Media uploads: images, video, voice notes (WAVECAST), files. Stored locally;
// swap UPLOAD_DIR for S3/Cloudinary in production (see docs/DEPLOYMENT.md).
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const { uploadLimiter } = require('../middleware/rateLimit');

const router = express.Router();
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const MIME = {
  image: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  video: ['video/mp4', 'video/webm', 'video/quicktime'],
  voice: ['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/x-m4a'],
  file: ['application/pdf', 'application/zip', 'text/plain', 'application/msword',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
};
const LIMITS = { image: 8 * 1024 * 1024, video: 50 * 1024 * 1024, voice: 10 * 1024 * 1024, file: 20 * 1024 * 1024 };

function kindForMime(mime) {
  for (const [k, list] of Object.entries(MIME)) if (list.includes(mime)) return k;
  return null;
}

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().slice(0, 8) || '';
    cb(null, uuid() + ext);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 60 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    // Accept based on the actual mimetype, not client claims.
    const ok = kindForMime(file.mimetype);
    cb(ok ? null : new Error('FILE_TYPE'), !!ok);
  },
});

router.post('/', authRequired, uploadLimiter, (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      if (err.message === 'FILE_TYPE') return res.status(400).json({ error: 'That file type is not allowed.' });
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'File is too large.' });
      return res.status(400).json({ error: 'Upload failed. Try again.' });
    }
    if (!req.file) return res.status(400).json({ error: 'No file received.' });
    // Kind is detected from the real mimetype (client `kind` is only a hint).
    const hinted = ['image', 'video', 'voice', 'file'].includes(req.query.kind || req.body?.kind)
      ? (req.query.kind || req.body.kind) : null;
    const kind = kindForMime(req.file.mimetype) || hinted || 'file';
    if (req.file.size > LIMITS[kind]) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: `That ${kind} is too large (max ${LIMITS[kind] / 1024 / 1024}MB).` });
    }
    const url = '/uploads/' + req.file.filename;
    const duration = req.body?.duration ? Number(req.body.duration) : null;
    let info;
    try {
      info = await db.run(`INSERT INTO media (user_id, url, kind, mime, size, duration)
        VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, req.user.id, url, kind, req.file.mimetype, req.file.size, duration || null);
    } catch (e) {
      fs.unlinkSync(req.file.path);
      return res.status(500).json({ error: 'Upload failed. Try again.' });
    }
    res.status(201).json({
      id: info.lastInsertRowid, url, kind, mime: req.file.mimetype,
      size: req.file.size, duration: duration || null,
    });
  });
});

router.delete('/:id', authRequired, async (req, res) => {
  const m = await db.get('SELECT * FROM media WHERE id = $1', req.params.id);
  if (!m) return res.status(404).json({ error: 'File not found.' });
  if (m.user_id !== req.user.id) return res.status(403).json({ error: 'Not allowed.' });
  if (m.post_id || m.message_id) return res.status(400).json({ error: 'File is attached to a post/message.' });
  try { fs.unlinkSync(path.join(UPLOAD_DIR, path.basename(m.url))); } catch {}
  await db.run('DELETE FROM media WHERE id = $1', m.id);
  res.json({ ok: true });
});

module.exports = router;
