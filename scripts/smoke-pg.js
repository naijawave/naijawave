// Build-time smoke test: verifies the Postgres layer boots, the schema applies,
// and basic CRUD works. Uses pg when DATABASE_URL is set, else PGlite.
const db = require('../src/db');

(async () => {
  await db.ready;
  const r = await db.run(
    "INSERT INTO users (username, display_name, password_hash) VALUES ($1,$2,$3) RETURNING id",
    'smoke_' + Date.now(), 'Smoke', 'x'
  );
  if (!r.lastInsertRowid) throw new Error('no lastInsertRowid');
  const u = await db.get('SELECT username FROM users WHERE id = $1', r.lastInsertRowid);
  if (!u) throw new Error('row not found');
  await db.run('DELETE FROM users WHERE id = $1', r.lastInsertRowid);
  console.log('pg smoke ok (driver: ' + (process.env.DATABASE_URL ? 'pg' : 'pglite') + ')');
  process.exit(0);
})().catch((e) => {
  console.error('pg smoke FAILED:', e.message);
  process.exit(1);
});
