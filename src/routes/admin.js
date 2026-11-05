// Founder/Admin dashboard API. ALL routes server-side role-gated — the client
// can never grant itself admin; every sensitive action is audited.
const express = require('express');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const { requireRole, audit } = require('../middleware/roles');
const { publicUser } = require('../utils/helpers');
const { notify } = require('../utils/notify');
const { serializePost } = require('../utils/serialize');

const router = express.Router();
router.use(authRequired, requireRole('admin', 'founder'));
const PAGE = 25;
const pageOf = (req) => Math.max(1, parseInt(req.query.page) || 1);

// ---------- STATS ----------
router.get('/stats', async (req, res) => {
  const q = async (sql, ...a) => (await db.get(sql, ...a));
  res.json({
    users_total: (await q('SELECT COUNT(*)::int c FROM users')).c,
    users_24h: (await q("SELECT COUNT(*)::int c FROM users WHERE created_at > NOW() - INTERVAL '1 day'")).c,
    active_today: (await q("SELECT COUNT(DISTINCT user_id)::int c FROM (SELECT user_id FROM posts WHERE created_at > NOW() - INTERVAL '1 day' UNION SELECT sender_id FROM messages WHERE created_at > NOW() - INTERVAL '1 day')")).c,
    posts_total: (await q("SELECT COUNT(*)::int c FROM posts WHERE deleted_at IS NULL")).c,
    posts_24h: (await q("SELECT COUNT(*)::int c FROM posts WHERE created_at > NOW() - INTERVAL '1 day' AND deleted_at IS NULL")).c,
    messages_24h: (await q("SELECT COUNT(*)::int c FROM messages WHERE created_at > NOW() - INTERVAL '1 day'")).c,
    reports_open: (await q("SELECT COUNT(*)::int c FROM reports WHERE status = 'open'")).c,
    verifications_pending: (await q("SELECT COUNT(*)::int c FROM verification_apps WHERE status = 'pending'")).c,
    suspended: (await q("SELECT COUNT(*)::int c FROM users WHERE status = 'suspended'")).c,
  });
});

// ---------- USERS ----------
router.get('/users', async (req, res) => {
  const page = pageOf(req);
  const q = String(req.query.q || '').trim();
  const filter = req.query.filter || 'all';
  let where = '1=1', params = [];
  if (q) { where += ' AND (username ILIKE $1 OR display_name ILIKE $2 OR email ILIKE $3)'; params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (filter === 'suspended') where += " AND status = 'suspended'";
  if (filter === 'verified') where += " AND verification != 'none'";
  if (filter === 'admins') where += " AND role IN ('admin','founder')";
  const lim = params.length + 1, off = params.length + 2;
  const rows = await db.all(`SELECT * FROM users WHERE ${where} ORDER BY id DESC LIMIT $${lim} OFFSET $${off}`, ...params, PAGE, (page - 1) * PAGE);
  res.json({
    items: rows.map(u => ({ ...publicUser(u), email: u.email, phone: u.phone, status: u.status, suspended_reason: u.suspended_reason })),
    page, has_more: rows.length === PAGE,
  });
});

router.post('/users/:id/suspend', async (req, res) => {
  const target = await db.get('SELECT * FROM users WHERE id = $1', req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found.' });
  if (target.role === 'founder') return res.status(403).json({ error: 'The founder account cannot be suspended.' });
  if (target.id === req.user.id) return res.status(400).json({ error: "You can't suspend yourself." });
  const reason = String(req.body?.reason || 'Violation of community guidelines').slice(0, 300);
  await db.run("UPDATE users SET status = 'suspended', suspended_reason = $1 WHERE id = $2", reason, target.id);
  await audit(req.user.id, 'user.suspend', 'user', target.id, { reason });
  res.json({ ok: true });
});

router.post('/users/:id/restore', async (req, res) => {
  await db.run("UPDATE users SET status = 'active', suspended_reason = NULL WHERE id = $1", req.params.id);
  await audit(req.user.id, 'user.restore', 'user', req.params.id, {});
  res.json({ ok: true });
});

router.post('/users/:id/revoke-verification', async (req, res) => {
  const target = await db.get('SELECT * FROM users WHERE id = $1', req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found.' });
  if (target.is_founder) return res.status(403).json({ error: 'Founder badge cannot be revoked.' });
  const reason = String(req.body?.reason || '').slice(0, 300);
  await db.run("UPDATE users SET verification = 'none' WHERE id = $1", target.id);
  await db.run("INSERT INTO verification_history (user_id, action, note, actor_id) VALUES ($1, 'revoked', $2, $3) RETURNING id",
    target.id, reason, req.user.id);
  await audit(req.user.id, 'verification.revoke', 'user', target.id, { reason });
  notify(target.id, 'verification', { text: 'Your verification badge was revoked.' + (reason ? ' Reason: ' + reason : '') }).catch(() => {});
  res.json({ ok: true });
});

// ★ founder-only: grant/revoke admin
router.post('/users/:id/role', requireRole('founder'), async (req, res) => {
  const target = await db.get('SELECT * FROM users WHERE id = $1', req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found.' });
  const role = req.body?.role === 'admin' ? 'admin' : 'user';
  if (target.is_founder) return res.status(403).json({ error: 'Founder role is permanent.' });
  await db.run('UPDATE users SET role = $1 WHERE id = $2', role, target.id);
  await audit(req.user.id, 'user.role', 'user', target.id, { role });
  res.json({ ok: true, role });
});

// ---------- VERIFICATION QUEUE ----------
router.get('/verifications', async (req, res) => {
  const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : 'pending';
  const page = pageOf(req);
  const rows = await db.all(`SELECT va.*, u.username, u.display_name, u.avatar_url, u.verification AS current_badge
    FROM verification_apps va JOIN users u ON u.id = va.user_id
    WHERE va.status = $1 ORDER BY va.id DESC LIMIT $2 OFFSET $3`, status, PAGE, (page - 1) * PAGE);
  res.json({
    items: rows.map(a => ({
      id: a.id, status: a.status, category: a.category, statement: a.statement,
      links: JSON.parse(a.links || '[]'), org_name: a.org_name, note: a.note,
      created_at: a.created_at, decided_at: a.decided_at,
      applicant: { id: a.user_id, username: a.username, display_name: a.display_name, avatar_url: a.avatar_url, current_badge: a.current_badge },
    })),
    page, has_more: rows.length === PAGE,
  });
});

async function decide(req, res, approve) {
  const app = await db.get('SELECT * FROM verification_apps WHERE id = $1', req.params.id);
  if (!app || app.status !== 'pending') return res.status(404).json({ error: 'Application not found or already decided.' });
  const note = String(req.body?.note || '').slice(0, 500);
  const category = approve ? (req.body?.category === 'gold' ? 'gold' : 'blue') : app.category;
  await db.transaction(async (tx) => {
    await tx.run("UPDATE verification_apps SET status = $1, note = $2, decided_at = NOW(), decided_by = $3 WHERE id = $4",
      approve ? 'approved' : 'rejected', note || null, req.user.id, app.id);
    if (approve) await tx.run('UPDATE users SET verification = $1 WHERE id = $2', category, app.user_id);
    await tx.run('INSERT INTO verification_history (user_id, action, category, note, actor_id) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      app.user_id, approve ? 'approved' : 'rejected', category, note || null, req.user.id);
  });
  await audit(req.user.id, approve ? 'verification.approve' : 'verification.reject', 'verification_app', app.id, { category, note });
  notify(app.user_id, 'verification', {
    text: approve
      ? `Congratulations! Your account is now ${category === 'gold' ? 'Gold' : 'Blue'} Verified on Naija Wave.`
      : 'Your verification application was not approved.' + (note ? ' Note: ' + note : ''),
  }).catch(() => {});
  res.json({ ok: true });
}
router.post('/verifications/:id/approve', (req, res) => decide(req, res, true));
router.post('/verifications/:id/reject', (req, res) => decide(req, res, false));

// ---------- REPORTS / MODERATION ----------
router.get('/reports', async (req, res) => {
  const status = req.query.status === 'resolved' ? 'resolved' : 'open';
  const page = pageOf(req);
  const rows = await db.all(`SELECT r.*, u.username AS reporter_name FROM reports r
    JOIN users u ON u.id = r.reporter_id WHERE r.status = $1 ORDER BY r.id DESC LIMIT $2 OFFSET $3`,
    status, PAGE, (page - 1) * PAGE);
  const items = [];
  for (const r of rows) {
    let target = null;
    if (r.type === 'post') {
      const p = await db.get('SELECT * FROM posts WHERE id = $1', r.target_id);
      target = p ? await serializePost(db, p, null) : { deleted: true, id: r.target_id };
    } else if (r.type === 'user') {
      const u = await db.get('SELECT * FROM users WHERE id = $1', r.target_id);
      target = u ? publicUser(u) : { deleted: true };
    }
    items.push({ id: r.id, type: r.type, reason: r.reason, details: r.details, status: r.status,
             resolution: r.resolution, created_at: r.created_at, reporter: r.reporter_name, target });
  }
  res.json({ items, page, has_more: rows.length === PAGE });
});

router.post('/reports/:id/resolve', async (req, res) => {
  const rep = await db.get('SELECT * FROM reports WHERE id = $1', req.params.id);
  if (!rep || rep.status !== 'open') return res.status(404).json({ error: 'Report not found or already resolved.' });
  const action = req.body?.action; // dismiss | remove_content | suspend_user | warn
  const note = String(req.body?.note || '').slice(0, 500);
  if (!['dismiss', 'remove_content', 'suspend_user', 'warn'].includes(action))
    return res.status(400).json({ error: 'Invalid action.' });
  await db.transaction(async (tx) => {
    if (action === 'remove_content' && rep.type === 'post')
      await tx.run("UPDATE posts SET deleted_at = NOW() WHERE id = $1", rep.target_id);
    if (action === 'suspend_user') {
      const row = rep.type === 'user' ? { user_id: rep.target_id }
        : await tx.get('SELECT user_id FROM posts WHERE id = $1', rep.target_id);
      const uid = row && row.user_id;
      const t = uid && await tx.get('SELECT role FROM users WHERE id = $1', uid);
      if (t && t.role !== 'founder')
        await tx.run("UPDATE users SET status = 'suspended', suspended_reason = $1 WHERE id = $2", 'Moderation action: ' + rep.reason, uid);
    }
    await tx.run("UPDATE reports SET status = 'resolved', resolution = $1, resolved_by = $2, resolved_at = NOW() WHERE id = $3",
      action + (note ? ' — ' + note : ''), req.user.id, rep.id);
  });
  await audit(req.user.id, 'report.resolve', 'report', rep.id, { action, note });
  res.json({ ok: true });
});

// ---------- ACTIVITY / AUDIT LOG ----------
router.get('/activity', async (req, res) => {
  const page = pageOf(req);
  const rows = await db.all(`SELECT a.*, u.username AS actor_name FROM audit_log a
    LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.id DESC LIMIT $1 OFFSET $2`, PAGE, (page - 1) * PAGE);
  res.json({ items: rows, page, has_more: rows.length === PAGE });
});

// ---------- ANNOUNCEMENTS ----------
router.post('/announcements', async (req, res) => {
  const text = String(req.body?.text || '').slice(0, 500).trim();
  if (!text) return res.status(400).json({ error: 'Announcement can’t be empty.' });
  const info = await db.run('INSERT INTO announcements (author_id, text) VALUES ($1,$2) RETURNING id', req.user.id, text);
  await audit(req.user.id, 'announcement.create', 'announcement', info.lastInsertRowid, {});
  // notify all active users (respecting their announcement pref)
  const users = await db.all("SELECT id FROM users WHERE status = 'active'");
  const { notify: send } = require('../utils/notify');
  for (const u of users) {
    if (u.id !== req.user.id) send(u.id, 'announcement', { text: '📢 Naija Wave: ' + text.slice(0, 120) }).catch(() => {});
  }
  res.status(201).json({ ok: true });
});

// ---------- SPONSORED POSTS ----------
router.post('/posts/:id/sponsor', async (req, res) => {
  const label = String(req.body?.label || 'Sponsored').slice(0, 60);
  await db.run('UPDATE posts SET is_sponsored = 1, sponsor_label = $1 WHERE id = $2', label, req.params.id);
  await audit(req.user.id, 'post.sponsor', 'post', req.params.id, { label });
  res.json({ ok: true });
});
router.delete('/posts/:id/sponsor', async (req, res) => {
  await db.run('UPDATE posts SET is_sponsored = 0, sponsor_label = NULL WHERE id = $1', req.params.id);
  await audit(req.user.id, 'post.unsponsor', 'post', req.params.id, {});
  res.json({ ok: true });
});

module.exports = router;
