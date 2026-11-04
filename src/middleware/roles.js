// Server-side role-based access control. NEVER trust the client for admin.
const db = require('../db');

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Login required.' });
    // re-read role from DB (fresh) — client claims mean nothing
    const row = db.prepare('SELECT role, status FROM users WHERE id = ?').get(req.user.id);
    if (!row || row.status === 'suspended') return res.status(403).json({ error: 'Access denied.', code: 'FORBIDDEN' });
    if (!roles.includes(row.role)) {
      return res.status(403).json({ error: 'Admin access required.', code: 'NOT_ADMIN' });
    }
    next();
  };
}

function audit(actorId, action, targetType, targetId, details) {
  db.prepare(`INSERT INTO audit_log (actor_id, action, target_type, target_id, details)
              VALUES (?,?,?,?,?)`).run(
    actorId || null, action, targetType || null, targetId || null,
    JSON.stringify(details || {}));
}

module.exports = { requireRole, audit };
