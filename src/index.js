// Naija Wave — server entry. Serves the API + the frontend SPA + uploads.
console.log('[boot] starting naija-wave...');
require('dotenv').config();
console.log('[boot] dotenv ok');
const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
console.log('[boot] web stack ok');

const db = require('./db');
console.log('[boot] db ok');
const { authOptional } = require('./middleware/auth');
const { generalApi } = require('./middleware/rateLimit');
const { publicUser } = require('./utils/helpers');

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use('/api', generalApi);

// ---- public config (no secrets): ICE servers for WebRTC ----
app.get('/api/config', (req, res) => {
  const ice = [{ urls: process.env.STUN_URL || 'stun:stun.l.google.com:19302' }];
  if (process.env.TURN_URL) ice.push({
    urls: process.env.TURN_URL,
    username: process.env.TURN_USER || '',
    credential: process.env.TURN_PASS || '',
  });
  res.json({ ice_servers: ice, otp_mode: process.env.OTP_MODE || 'dev', app: 'Naija Wave' });
});

// ---- routes ----
app.use('/api/auth', require('./routes/auth'));
app.use('/api/setup', require('./routes/setup'));
app.use('/api/users', require('./routes/users'));
const postsRouter = require('./routes/posts');
app.use('/api/posts', postsRouter);
app.use('/api', postsRouter.feedRouter);      // /api/feed/foryou, /api/feed/following, /api/explore
app.use('/api/comments', postsRouter.commentsRouter); // /api/comments/:id
app.get('/api/search', authOptional, postsRouter.searchAll);
app.get('/api/hashtags/trending', postsRouter.trendingTags);
app.get('/api/hashtags/:tag', authOptional, postsRouter.hashtagFeed);
app.use('/api/uploads', require('./routes/uploads'));
app.use('/api/conversations', require('./routes/conversations'));
const naija = require('./routes/naija');
app.use('/api/pulse', naija.pulse);
app.use('/api/court', naija.court);
app.use('/api/versus', naija.versus);
app.use('/api/buzz', naija.buzz);
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/verification', require('./routes/verification'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/calls', require('./routes/calls'));

// public announcements feed
app.get('/api/announcements', authOptional, async (req, res) => {
  const rows = await db.all(`SELECT a.*, u.username, u.display_name, u.avatar_url, u.verification
    FROM announcements a JOIN users u ON u.id = a.author_id ORDER BY a.id DESC LIMIT 20`);
  res.json({ items: rows.map(a => ({ id: a.id, text: a.text, created_at: a.created_at, author: publicUser(a) })) });
});

// ---- uploads static ----
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '30d' }));

// ---- frontend SPA ----
const PUBLIC = path.join(__dirname, '..', 'public');
app.use(express.static(PUBLIC, { maxAge: '1h' }));
app.use((req, res, next) => {
  if (req.path.startsWith('/uploads/')) return next();
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found.' });
  const index = path.join(PUBLIC, 'index.html');
  if (fs.existsSync(index)) return res.sendFile(index);
  res.status(503).send('Naija Wave frontend is being built — the API is live at /api.');
});

// ---- error handler ----
app.use((err, req, res, next) => {
  console.error('[naijawave]', err.message);
  res.status(500).json({ error: 'Something went wrong on our side. Try again.' });
});

const server = http.createServer(app);
require('./socket/index').initSocket(server);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`
  🌊 Naija Wave is live at http://localhost:${PORT}
     API: http://localhost:${PORT}/api   |   OTP mode: ${process.env.OTP_MODE || 'dev'}
     ${process.env.SETUP_KEY ? 'SETUP_KEY is set — founder setup is available.' : '⚠️  Set SETUP_KEY env var to enable founder setup.'}
  `);
});
