// Smoke test: proves better-sqlite3 can actually open a database in this
// environment. Runs during the Render build; if it segfaults here, the
// build fails loudly instead of the app dying silently at runtime.
const Database = require('better-sqlite3');
const fs = require('fs');
const p = '/tmp/smoke-naijawave.db';
try { fs.unlinkSync(p); } catch {}
const db = new Database(p);
db.exec('CREATE TABLE t (x INTEGER)');
db.prepare('INSERT INTO t VALUES (?)').run(42);
const row = db.prepare('SELECT x FROM t').get();
db.close();
if (!row || row.x !== 42) throw new Error('smoke test returned wrong data');
console.log('sqlite smoke ok');
