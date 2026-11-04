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
router.get('/stats', (req, res) => {
  const q = (sql, ...a) => db.prepare(sql).get(...a);
  res.json({
    users_total: q('SELECT COUNT(*) c FROM users').c,
    users_24h: q("SELECT COUNT(*) c FROM users WHERE created_at > datetime('now','-1 day')").c,
    active_today: q("SELECT COUNT(DISTINCT user_id) c FROM (SELECT user_id FROM posts WHERE created_at > datetime('now','-1 day') UNION SELECT sender_id FROM messages WHERE created_at > datetime('now','-1 day'))").c,
    posts_total: q("SELECT COUNT(*) c FROM posts WHERE deleted_at IS NULL").c,
    posts_24h: q("SELECT COUNT(*) c FROM posts WHERE created_at > datetime('now','-1 day') AND deleted_at IS NULL").c,
    messages_24h: q("SELECT COUNT(*) c FROM messages WHERE created_at > datetime('now','-1 day')").c,
    reports_open: q("SELECT COUNT(*) c FROM reports WHERE status = 'open'").c,
    verifications_pending: q("SELECT COUNT(*) c FROM verification_apps WHERE status = 'pending'").c,
    suspended: q("SELECT COUNT(*) c FROM users WHERE status = 'suspended'").c,
  });
});

// ---------- USERS ----------
router.get('/users', (req, res) => {
  const page = pageOf(req);
  const q = String(req.query.q || '').trim();
  const filter = req.query.filter || 'all';
  let where = '1=1', params = [];
  if (q) { where += ' AND (username LIKE ? OR display_name LIKE ? OR email LIKE ?)'; params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (filter === 'suspended') where += " AND status = 'suspended'";
  if (filter === 'verified') where += " AND verification != 'none'";
  if (filter === 'admins') where += " AND role IN ('admin','founder')";
  const rows = db.prepare(`SELECT * FROM users WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params, PAGE, (page - 1) * PAGE);
  res.json({
    items: rows.map(u => ({ ...publicUser(u), email: u.email, phone: u.phone, status: u.status, suspended_reason: u.suspended_reason })),
    page, has_more: rows.length === PAGE,
  });
});

router.post('/users/:id/suspend', (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found.' });
  if (target.role === 'founder') return res.status(403).json({ error: 'The founder account cannot be suspended.' });
  if (target.id === req.user.id) return res.status(400).json({ error: "You can't suspend yourself." });
  const reason = String(req.body?.reason || 'Violation of community guidelines').slice(0, 300);
  db.prepare("UPDATE users SET status = 'suspended', suspended_reason = ? WHERE id = ?").run(reason, target.id);
  audit(req.user.id, 'user.suspend', 'user', target.id, { reason });
  res.json({ ok: true });
});

router.post('/users/:id/restore', (req, res) => {
  db.prepare("UPDATE users SET status = 'active', suspended_reason = NULL WHERE id = ?").run(req.params.id);
  audit(req.user.id, 'user.restore', 'user', req.params.id, {});
  res.json({ ok: true });
});

router.post('/users/:id/revoke-verification', (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found.' });
  if (target.is_founder) return res.status(403).json({ error: 'Founder badge cannot be revoked.' });
  const reason = String(req.body?.reason || '').slice(0, 300);
  db.prepare("UPDATE users SET verification = 'none' WHERE id = ?").run(target.id);
  db.prepare("INSERT INTO verification_history (user_id, action, note, actor_id) VALUES (?, 'revoked', ?, ?)")
    .run(target.id, reason, req.user.id);
  audit(req.user.id, 'verification.revoke', 'user', target.id, { reason });
  notify(target.id, 'verification', { text: 'Your verification badge was revoked.' + (reason ? ' Reason: ' + reason : '') });
  res.json({ ok: true });
});

// ★ founder-only: grant/revoke admin
router.post('/users/:id/role', requireRole('founder'), (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found.' });
  const role = req.body?.role === 'admin' ? 'admin' : 'user';
  if (target.is_founder) return res.status(403).json({ error: 'Founder role is permanent.' });
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, target.id);
  audit(req.user.id, 'user.role', 'user', target.id, { role });
  res.json({ ok: true, role });
});

// ---------- VERIFICATION QUEUE ----------
router.get('/verifications', (req, res) => {
  const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : 'pending';
  const page = pageOf(req);
  const rows = db.prepare(`SELECT va.*, u.username, u.display_name, u.avatar_url, u.verification AS current_badge
    FROM verification_apps va JOIN users u ON u.id = va.user_id
    WHERE va.status = ? ORDER BY va.id DESC LIMIT ? OFFSET ?`).all(status, PAGE, (page - 1) * PAGE);
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

function decide(req, res, approve) {
  const app = db.prepare('SELECT * FROM verification_apps WHERE id = ?').get(req.params.id);
  if (!app || app.status !== 'pending') return res.status(404).json({ error: 'Application not found or already decided.' });
  const note = String(req.body?.note || '').slice(0, 500);
  const category = approve ? (req.body?.category === 'gold' ? 'gold' : 'blue') : app.category;
  db.transaction(() => {
    db.prepare("UPDATE verification_apps SET status = ?, note = ?, decided_at = datetime('now'), decided_by = ? WHERE id = ?")
      .run(approve ? 'approved' : 'rejected', note || null, req.user.id, app.id);
    if (approve) db.prepare('UPDATE users SET verification = ? WHERE id = ?').run(category, app.user_id);
    db.prepare('INSERT INTO verification_history (user_id, action, category, note, actor_id) VALUES (?,?,?,?,?)')
      .run(app.user_id, approve ? 'approved' : 'rejected', category, note || null, req.user.id);
  })();
  audit(req.user.id, approve ? 'verification.approve' : 'verification.reject', 'verification_app', app.id, { category, note });
  notify(app.user_id, 'verification', {
    text: approve
      ? `Congratulations! Your account is now ${category === 'gold' ? 'Gold' : 'Blue'} Verified on Naija Wave.`
      : 'Your verification application was not approved.' + (note ? ' Note: ' + note : ''),
  });
  res.json({ ok: true });
}
router.post('/verifications/:id/approve', (req, res) => decide(req, res, true));
router.post('/verifications/:id/reject', (req, res) => decide(req, res, false));

// ---------- REPORTS / MODERATION ----------
router.get('/reports', (req, res) => {
  const status = req.query.status === 'resolved' ? 'resolved' : 'open';
  const page = pageOf(req);
  const rows = db.prepare(`SELECT r.*, u.username AS reporter_name FROM reports r
    JOIN users u ON u.id = r.reporter_id WHERE r.status = ? ORDER BY r.id DESC LIMIT ? OFFSET ?`)
    .all(status, PAGE, (page - 1) * PAGE);
  const items = rows.map(r => {
    let target = null;
    if (r.type === 'post') {
      const p = db.prepare('SELECT * FROM posts WHERE id = ?').get(r.target_id);
      target = p ? serializePost(db, p, null) : { deleted: true, id: r.target_id };
    } else if (r.type === 'user') {
      const u = db.prepare('SELECT * FROM users WHERE id = ?').get(r.target_id);
      target = u ? publicUser(u) : { deleted: true };
    }
    return { id: r.id, type: r.type, reason: r.reason, details: r.details, status: r.status,
             resolution: r.resolution, created_at: r.created_at, reporter: r.reporter_name, target };
  });
  res.json({ items, page, has_more: rows.length === PAGE });
});

router.post('/reports/:id/resolve', (req, res) => {
  const rep = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id);
  if (!rep || rep.status !== 'open') return res.status(404).json({ error: 'Report not found or already resolved.' });
  const action = req.body?.action; // dismiss | remove_content | suspend_user | warn
  const note = String(req.body?.note || '').slice(0, 500);
  if (!['dismiss', 'remove_content', 'suspend_user', 'warn'].includes(action))
    return res.status(400).json({ error: 'Invalid action.' });
  db.transaction(() => {
    if (action === 'remove_content' && rep.type === 'post')
      db.prepare("UPDATE posts SET deleted_at = datetime('now') WHERE id = ?").run(rep.target_id);
    if (action === 'suspend_user') {
      const uid = rep.type === 'user' ? rep.target_id
        : (db.prepare('SELECT user_id FROM posts WHERE id = ?').get(rep.target_id) || {}).user_id;
      const t = uid && db.prepare('SELECT role FROM users WHERE id = ?').get(uid);
      if (t && t.role !== 'founder')
        db.prepare("UPDATE users SET status = 'suspended', suspended_reason = ? WHERE id = ?").run('Moderation action: ' + rep.reason, uid);
    }
    db.prepare("UPDATE reports SET status = 'resolved', resolution = ?, resolved_by = ?, resolved_at = datetime('now') WHERE id = ?")
      .run(action + (note ? ' — ' + note : ''), req.user.id, rep.id);
  })();
  audit(req.user.id, 'report.resolve', 'report', rep.id, { action, note });
  res.json({ ok: true });
});

// ---------- ACTIVITY / AUDIT LOG ----------
router.get('/activity', (req, res) => {
  const page = pageOf(req);
  const rows = db.prepare(`SELECT a.*, u.username AS actor_name FROM audit_log a
    LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.id DESC LIMIT ? OFFSET ?`).all(PAGE, (page - 1) * PAGE);
  res.json({ items: rows, page, has_more: rows.length === PAGE });
});

// ---------- ANNOUNCEMENTS ----------
router.post('/announcements', (req, res) => {
  const text = String(req.body?.text || '').slice(0, 500).trim();
  if (!text) return res.status(400).json({ error: 'Announcement can’t be empty.' });
  const info = db.prepare('INSERT INTO announcements (author_id, text) VALUES (?,?)').run(req.user.id, text);
  audit(req.user.id, 'announcement.create', 'announcement', info.lastInsertRowid, {});
  // notify all active users (respecting their announcement pref)
  const users = db.prepare("SELECT id FROM users WHERE status = 'active'").all();
  const { notify: send } = require('../utils/notify');
  users.forEach(u => { if (u.id !== req.user.id) send(u.id, 'announcement', { text: '📢 Naija Wave: ' + text.slice(0, 120) }); });
  res.status(201).json({ ok: true });
});

// ---------- SPONSORED POSTS ----------
router.post('/posts/:id/sponsor', (req, res) => {
  const label = String(req.body?.label || 'Sponsored').slice(0, 60);
  db.prepare('UPDATE posts SET is_sponsored = 1, sponsor_label = ? WHERE id = ?').run(label, req.params.id);
  audit(req.user.id, 'post.sponsor', 'post', req.params.id, { label });
  res.json({ ok: true });
});
router.delete('/posts/:id/sponsor', (req, res) => {
  db.prepare('UPDATE posts SET is_sponsored = 0, sponsor_label = NULL WHERE id = ?').run(req.params.id);
  audit(req.user.id, 'post.unsponsor', 'post', req.params.id, {});
  res.json({ ok: true });
});

module.exports = router;
