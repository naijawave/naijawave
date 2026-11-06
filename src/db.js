// Naija Wave — Postgres database layer.
// Production (Render): uses `pg` Pool against DATABASE_URL (Supabase).
// Local dev/test: uses PGlite (real Postgres, file-persisted, no server needed).
//
// Interface (all async):
//   db.get(sql, ...params) -> single row | undefined
//   db.all(sql, ...params) -> row[]
//   db.run(sql, ...params) -> { lastInsertRowid, changes }  (INSERTs need RETURNING id)
//   db.exec(sql)           -> DDL / multi-statement
//   db.transaction(fn)     -> await db.transaction(async (tx) => { ... })  (tx has get/all/run)
const path = require('path');
const fs = require('fs');

console.log('[boot] db.js: initializing Postgres layer...');

let driver; // { query(text, params) } — pg Pool or PGlite wrapper
let driverConnect; // () => Promise<{ query, release }> for transactions

async function initDriver() {
  if (process.env.DATABASE_URL) {
    console.log('[boot] db.js: using pg (DATABASE_URL)');
    const { Pool } = require('pg');
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 10,
    });
    pool.on('error', (e) => console.error('[db] pool error:', e.message));
    driver = pool;
    driverConnect = async () => {
      const client = await pool.connect();
      return { query: (t, p) => client.query(t, p), release: () => client.release() };
    };
  } else {
    console.log('[boot] db.js: using PGlite (local Postgres)');
    const { PGlite } = require('@electric-sql/pglite');
    const dir = path.join(__dirname, '..', 'data', 'pglite');
    fs.mkdirSync(dir, { recursive: true });
    const pglite = new PGlite(dir);
    driver = { query: (t, p) => pglite.query(t, p) };
    driverConnect = async () => ({ query: (t, p) => pglite.query(t, p), release: () => {} });
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  email TEXT UNIQUE,
  phone TEXT UNIQUE,
  contact_type TEXT NOT NULL DEFAULT 'email',
  contact_verified INTEGER NOT NULL DEFAULT 0,
  password_hash TEXT NOT NULL,
  dob TEXT,
  avatar_url TEXT,
  cover_url TEXT,
  bio TEXT DEFAULT '',
  location TEXT DEFAULT '',
  website TEXT DEFAULT '',
  verification TEXT NOT NULL DEFAULT 'none' CHECK (verification IN ('none','blue','gold','founder')),
  is_founder INTEGER NOT NULL DEFAULT 0,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin','founder')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  suspended_reason TEXT,
  prefs TEXT NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

CREATE TABLE IF NOT EXISTS otps (
  id SERIAL PRIMARY KEY,
  contact TEXT NOT NULL,
  code TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'register' CHECK (purpose IN ('register','reset')),
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_otps_contact ON otps(contact);

CREATE TABLE IF NOT EXISTS follows (
  id SERIAL PRIMARY KEY,
  follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(follower_id, followee_id)
);
CREATE TABLE IF NOT EXISTS blocks (
  id SERIAL PRIMARY KEY,
  blocker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(blocker_id, blocked_id)
);
CREATE TABLE IF NOT EXISTS mutes (
  id SERIAL PRIMARY KEY,
  muter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  muted_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(muter_id, muted_id)
);

CREATE TABLE IF NOT EXISTS posts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL DEFAULT '',
  section TEXT NOT NULL DEFAULT 'feed' CHECK (section IN ('feed','buzz')),
  location TEXT,
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','followers')),
  is_sponsored INTEGER NOT NULL DEFAULT 0,
  sponsor_label TEXT,
  quote_of INTEGER REFERENCES posts(id) ON DELETE SET NULL,
  repost_of INTEGER REFERENCES posts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_posts_user ON posts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_section ON posts(section, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at DESC);

CREATE TABLE IF NOT EXISTS media (
  id SERIAL PRIMARY KEY,
  post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
  message_id INTEGER,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('image','video','voice','file')),
  mime TEXT,
  size INTEGER,
  duration REAL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS post_likes (
  id SERIAL PRIMARY KEY,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(post_id, user_id)
);
CREATE TABLE IF NOT EXISTS bookmarks (
  id SERIAL PRIMARY KEY,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(post_id, user_id)
);
CREATE TABLE IF NOT EXISTS comments (
  id SERIAL PRIMARY KEY,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id INTEGER REFERENCES comments(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id, created_at);
CREATE TABLE IF NOT EXISTS comment_likes (
  id SERIAL PRIMARY KEY,
  comment_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(comment_id, user_id)
);

CREATE TABLE IF NOT EXISTS polls (
  id SERIAL PRIMARY KEY,
  post_id INTEGER NOT NULL UNIQUE REFERENCES posts(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS poll_options (
  id SERIAL PRIMARY KEY,
  poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  votes INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS poll_votes (
  id SERIAL PRIMARY KEY,
  poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  option_id INTEGER NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(poll_id, user_id)
);

CREATE TABLE IF NOT EXISTS hashtags (
  id SERIAL PRIMARY KEY,
  tag TEXT UNIQUE NOT NULL
);
CREATE TABLE IF NOT EXISTS post_hashtags (
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  hashtag_id INTEGER NOT NULL REFERENCES hashtags(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, hashtag_id)
);

CREATE TABLE IF NOT EXISTS court_cases (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  context TEXT DEFAULT '',
  ends_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS court_options (
  id SERIAL PRIMARY KEY,
  case_id INTEGER NOT NULL REFERENCES court_cases(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  votes INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS court_votes (
  id SERIAL PRIMARY KEY,
  case_id INTEGER NOT NULL REFERENCES court_cases(id) ON DELETE CASCADE,
  option_id INTEGER NOT NULL REFERENCES court_options(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(case_id, user_id)
);
CREATE TABLE IF NOT EXISTS court_comments (
  id SERIAL PRIMARY KEY,
  case_id INTEGER NOT NULL REFERENCES court_cases(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS versus_battles (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  side_a_label TEXT NOT NULL,
  side_a_image TEXT,
  side_b_label TEXT NOT NULL,
  side_b_image TEXT,
  side_a_votes INTEGER NOT NULL DEFAULT 0,
  side_b_votes INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS versus_votes (
  id SERIAL PRIMARY KEY,
  battle_id INTEGER NOT NULL REFERENCES versus_battles(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  side TEXT NOT NULL CHECK (side IN ('a','b')),
  UNIQUE(battle_id, user_id)
);
CREATE TABLE IF NOT EXISTS versus_comments (
  id SERIAL PRIMARY KEY,
  battle_id INTEGER NOT NULL REFERENCES versus_battles(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS conversations (
  id SERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS conversation_members (
  id SERIAL PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hidden_at TIMESTAMPTZ,
  UNIQUE(conversation_id, user_id)
);
CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('text','image','video','voice','file')),
  text TEXT DEFAULT '',
  media_id INTEGER REFERENCES media(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','delivered','read')),
  deleted INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, id DESC);
-- media.message_id FK added after messages exists (circular reference)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'media_message_id_fkey') THEN
    ALTER TABLE media ADD CONSTRAINT media_message_id_fkey
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS calls (
  id SERIAL PRIMARY KEY,
  caller_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  callee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('voice','video')),
  status TEXT NOT NULL CHECK (status IN ('completed','missed','rejected','failed')),
  duration_sec INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_calls_users ON calls(caller_id, callee_id);

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  post_id INTEGER REFERENCES posts(id) ON DELETE SET NULL,
  conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
  text TEXT NOT NULL,
  data TEXT DEFAULT '{}',
  read INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS notification_prefs (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  prefs TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS verification_apps (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('blue','gold')),
  statement TEXT NOT NULL,
  links TEXT NOT NULL DEFAULT '[]',
  org_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at TIMESTAMPTZ,
  decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS verification_history (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  category TEXT,
  note TEXT,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reports (
  id SERIAL PRIMARY KEY,
  reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('post','user','court','versus')),
  target_id INTEGER NOT NULL,
  reason TEXT NOT NULL,
  details TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  resolution TEXT,
  resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status, created_at DESC);

CREATE TABLE IF NOT EXISTS announcements (
  id SERIAL PRIMARY KEY,
  author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id INTEGER,
  details TEXT DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);

-- App settings (key/value): holds the Web Push VAPID keys, generated once
-- on first boot and kept here so no dashboard step is needed.
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- Web Push subscriptions: one row per device a user enables call alerts on.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);

-- TikTok Videos: videos added by LINK only (embedded player, no upload).
-- video_id is the numeric TikTok video ID and url is the canonical full URL.
CREATE TABLE IF NOT EXISTS tiktok_videos (
  id SERIAL PRIMARY KEY,
  video_id TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT DEFAULT '',
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_tiktok_videos_video ON tiktok_videos(video_id);
CREATE INDEX IF NOT EXISTS idx_tiktok_videos_created ON tiktok_videos(created_at DESC);

-- Videos (all platforms): videos added by LINK only (embedded player, no upload).
-- platform is 'tiktok' | 'instagram' | 'youtube' and video_id is the platform's
-- video ID (TikTok numeric ID, YouTube 11-char ID, Instagram shortcode).
CREATE TABLE IF NOT EXISTS videos (
  id SERIAL PRIMARY KEY,
  platform TEXT NOT NULL,
  video_id TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT DEFAULT '',
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_videos_platform_video ON videos(platform, video_id);
CREATE INDEX IF NOT EXISTS idx_videos_created ON videos(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_videos_platform ON videos(platform);

-- One-time migration: move rows from the old TikTok-only table into videos.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tiktok_videos') THEN
    INSERT INTO videos (platform, video_id, url, title, user_id, created_at, deleted_at)
    SELECT 'tiktok', video_id, url, title, user_id, created_at, deleted_at FROM tiktok_videos
    WHERE NOT EXISTS (SELECT 1 FROM videos v WHERE v.platform = 'tiktok' AND v.video_id = tiktok_videos.video_id);
  END IF;
END $$;
`;

// Split SQL into statements, respecting $$ dollar-quoted blocks (DO ... END).
function splitStatements(sql) {
  const stmts = [];
  let cur = '', i = 0, inDollar = false;
  while (i < sql.length) {
    if (sql.startsWith('$$', i)) { inDollar = !inDollar; cur += '$$'; i += 2; continue; }
    if (sql[i] === ';' && !inDollar) { if (cur.trim()) stmts.push(cur.trim()); cur = ''; i++; continue; }
    cur += sql[i]; i++;
  }
  if (cur.trim()) stmts.push(cur.trim());
  return stmts;
}

const ready = (async () => {
  await initDriver();
  for (const stmt of splitStatements(SCHEMA)) await driver.query(stmt);
  console.log('[boot] db.js: schema ready');
})().catch((e) => {
  console.error('[boot] db.js: FATAL — could not initialize database:', e.message);
  process.exit(1);
});

async function get(sql, ...params) {
  await ready;
  const r = await driver.query(sql, params);
  return r.rows[0];
}
async function all(sql, ...params) {
  await ready;
  const r = await driver.query(sql, params);
  return r.rows;
}
async function run(sql, ...params) {
  await ready;
  const r = await driver.query(sql, params);
  return { lastInsertRowid: r.rows[0]?.id ?? null, changes: r.rowCount ?? 0 };
}
async function exec(sql) {
  await ready;
  for (const stmt of splitStatements(sql)) await driver.query(stmt);
}
async function transaction(fn) {
  await ready;
  const conn = await driverConnect();
  const tx = {
    get: async (sql, ...p) => (await conn.query(sql, p)).rows[0],
    all: async (sql, ...p) => (await conn.query(sql, p)).rows,
    run: async (sql, ...p) => {
      const r = await conn.query(sql, p);
      return { lastInsertRowid: r.rows[0]?.id ?? null, changes: r.rowCount ?? 0 };
    },
  };
  try {
    await conn.query('BEGIN');
    const out = await fn(tx);
    await conn.query('COMMIT');
    return out;
  } catch (e) {
    await conn.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    conn.release();
  }
}

module.exports = { get, all, run, exec, transaction, ready };
