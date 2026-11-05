// Server-side role-based access control. NEVER trust the client for admin.
const db = require('../db');

function requireRole(...roles) {
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Login required.' });
    // re-read role from DB (fresh) — client claims mean nothing
    const row = await db.get('SELECT role, status FROM users WHERE id = $1', req.user.id);
    if (!row || row.status === 'suspended') return res.status(403).json({ error: 'Access denied.', code: 'FORBIDDEN' });
    if (!roles.includes(row.role)) {
      return res.status(403).json({ error: 'Admin access required.', code: 'NOT_ADMIN' });
    }
    next();
  };
}

async function audit(actorId, action, targetType, targetId, details) {
  await db.run(`INSERT INTO audit_log (actor_id, action, target_type, target_id, details)
              VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    actorId || null, action, targetType || null, targetId || null,
    JSON.stringify(details || {}));
}

module.exports = { requireRole, audit };
