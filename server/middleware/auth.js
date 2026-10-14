// Protects staff-only routes. Every admin API route uses requireAdmin,
// so hiding buttons in the browser is never the only protection.

const db = require('../database');
const { COOKIE_NAME, parseCookies, hashToken } = require('../session');

async function requireAdmin(req, res, next) {
  try {
    const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
    if (!token) return res.status(401).json({ error: 'Please sign in.' });

    const rows = await db.query(
      `SELECT a.id, a.username
         FROM admin_sessions s
         JOIN admins a ON a.id = s.admin_id
        WHERE s.token_hash = ? AND s.expires_at > NOW()
        LIMIT 1`,
      [hashToken(token)]
    );
    if (rows.length === 0) return res.status(401).json({ error: 'Your session has expired. Please sign in again.' });

    req.admin = { id: rows[0].id, username: rows[0].username };
    next();
  } catch (err) {
    next(err); // handled by the error handler in server.js
  }
}

module.exports = { requireAdmin };
