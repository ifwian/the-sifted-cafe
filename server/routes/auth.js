// Admin sign-in / sign-out.
//   POST /api/auth/login   { username, password }  -> sets the session cookie
//   POST /api/auth/logout                          -> clears it
//   GET  /api/auth/me                              -> who is signed in?

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../database');
const { requireAdmin } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimit');
const { requireCsrfHeader } = require('../middleware/security');
const session = require('../session');

const router = express.Router();

const BCRYPT_COST = 12;
// Compared against when the username does not exist, so a wrong username and a
// wrong password take about the same time (stops "does this user exist?" guessing).
const DUMMY_HASH = bcrypt.hashSync('this-is-not-a-real-password', BCRYPT_COST);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many sign-in attempts. Please wait a few minutes and try again.',
});

const isSecure = () => process.env.NODE_ENV === 'production';

router.post('/login', requireCsrfHeader, loginLimiter, async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password) {
      return res.status(400).json({ error: 'Please enter your username and password.' });
    }
    if (username.length > 50 || password.length > 200) {
      return res.status(400).json({ error: 'Invalid username or password.' });
    }

    const rows = await db.query('SELECT id, username, password_hash FROM admins WHERE username = ? LIMIT 1', [
      username.trim(),
    ]);
    const admin = rows[0];
    const passwordOk = await bcrypt.compare(password, admin ? admin.password_hash : DUMMY_HASH);
    if (!admin || !passwordOk) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    const hours = session.getSessionHours();
    const token = session.generateToken();
    await db.execute('DELETE FROM admin_sessions WHERE expires_at < NOW()'); // tidy old sessions
    await db.execute(
      'INSERT INTO admin_sessions (admin_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? HOUR))',
      [admin.id, session.hashToken(token), hours]
    );
    await db.execute('UPDATE admins SET last_login_at = NOW() WHERE id = ?', [admin.id]);

    loginLimiter.limiter.reset(req.ip);
    res.set('Set-Cookie', session.buildSessionCookie(token, { maxAgeSeconds: hours * 3600, secure: isSecure() }));
    res.json({ admin: { username: admin.username } });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', requireCsrfHeader, async (req, res, next) => {
  try {
    const token = session.parseCookies(req.headers.cookie)[session.COOKIE_NAME];
    if (token) await db.execute('DELETE FROM admin_sessions WHERE token_hash = ?', [session.hashToken(token)]);
    res.set('Set-Cookie', session.buildClearCookie({ secure: isSecure() }));
    res.json({ message: 'Signed out.' });
  } catch (err) {
    next(err);
  }
});

router.get('/me', requireAdmin, (req, res) => {
  res.json({ admin: { username: req.admin.username } });
});

module.exports = router;
