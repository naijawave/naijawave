// CLI: create the founder account from the terminal (alternative to the /api/setup/founder endpoint).
// Usage: SETUP_KEY=... node scripts/setup-founder.js <email> <username> <display-name>
// You will be prompted for a password (not echoed).
const readline = require('readline');
const bcrypt = require('bcryptjs');
require('dotenv').config();
const db = require('../src/db');
const { audit } = require('../src/middleware/roles');

const SETUP_KEY = process.env.SETUP_KEY;
if (!SETUP_KEY) { console.error('Set SETUP_KEY env var first.'); process.exit(1); }

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q, hidden) => new Promise((res) => {
  if (!hidden) return rl.question(q, res);
  const stdin = process.stdin;
  process.stdout.write(q);
  stdin.setRawMode(true); stdin.resume();
  let pw = '';
  stdin.on('data', (c) => {
    const s = c.toString();
    if (s === '\r' || s === '\n') { stdin.setRawMode(false); stdin.pause(); process.stdout.write('\n'); res(pw); }
    else if (s === '\u0003') process.exit(1);
    else if (s === '\u007f') { pw = pw.slice(0, -1); }
    else pw += s;
  });
});

(async () => {
  const exists = db.prepare("SELECT COUNT(*) c FROM users WHERE role='founder'").get().c;
  if (exists) { console.error('A founder already exists — setup is closed.'); process.exit(1); }
  const key = await ask('Setup key: ', true);
  if (key !== SETUP_KEY) { console.error('Wrong setup key.'); process.exit(1); }
  const [email, username, ...nameParts] = process.argv.slice(2);
  const displayName = nameParts.join(' ') || username;
  if (!email || !username) { console.error('Usage: node scripts/setup-founder.js <email> <username> [display name]'); process.exit(1); }
  const password = await ask('Password (min 8 chars): ', true);
  if (password.length < 8) { console.error('Password too short.'); process.exit(1); }
  rl.close();
  const info = db.prepare(`INSERT INTO users (username, display_name, email, contact_type, contact_verified,
    password_hash, verification, is_founder, role, bio)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    username.toLowerCase(), displayName, email.toLowerCase(), 'email', 1,
    bcrypt.hashSync(password, 10), 'founder', 1, 'founder', 'Founder of Naija Wave 🌊');
  audit(info.lastInsertRowid, 'founder.setup', 'user', info.lastInsertRowid, { via: 'cli' });
  console.log(`\n✅ Founder @${username} created. Log in with your email + password, then open #/admin.`);
})();
