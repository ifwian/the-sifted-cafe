// The Sifted Cafe web server: serves the website (public/) and the JSON API (/api/...).
// Start it with:  npm start

require('dotenv').config();
const path = require('path');
const express = require('express');
const config = require('./config');
const db = require('./database');
const { securityHeaders } = require('./middleware/security');
const authRoutes = require('./routes/auth');
const reservationRoutes = require('./routes/reservations');

const app = express();
app.disable('x-powered-by');
app.use(securityHeaders);
app.use(express.json({ limit: '20kb' }));

// ---------- API ----------

// Reservation rules for the browser form (same values the server enforces).
app.get('/api/config', (req, res) => res.json(config));

// Quick check used for troubleshooting: http://localhost:3000/api/health
app.get('/api/health', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ status: 'ok', database: 'connected' });
  } catch (err) {
    const info = db.describeDbError(err);
    console.error(`[health] ${info.hint}`);
    res.status(503).json({ status: 'error', database: 'unavailable' });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/reservations', reservationRoutes);
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

// ---------- Website files ----------

const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir, { extensions: ['html'] })); // /admin opens admin.html

// ---------- Error handler (must be last) ----------

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'The request body is not valid JSON.' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'The request is too large.' });

  const info = db.describeDbError(err);
  console.error(`[error] ${req.method} ${req.originalUrl} -> ${info.hint}`);
  if (info.status === 500) console.error(err.stack);
  res.status(info.status).json({ error: info.message });
});

// ---------- Start ----------

async function start(port = Number(process.env.PORT) || 3000) {
  const server = await new Promise((resolve) => {
    const s = app.listen(port, () => resolve(s));
  });
  const actualPort = server.address().port;
  console.log(`\nThe Sifted Cafe is running:`);
  console.log(`  Website: http://localhost:${actualPort}/`);
  console.log(`  Admin:   http://localhost:${actualPort}/admin`);

  // Friendly startup check: the site still runs if the database is down,
  // but reservations and admin features will not work, so say so clearly.
  try {
    await db.query('SELECT 1');
    const [{ count }] = await db.query('SELECT COUNT(*) AS count FROM admins');
    console.log('  Database: connected');
    if (Number(count) === 0) console.log('  Note: no admin account yet. Run "npm run create-admin" to create one.');
  } catch (err) {
    const info = db.describeDbError(err);
    console.error(`\n  !! DATABASE PROBLEM: ${info.hint}`);
    console.error('  The website is running, but reservations and the admin page will not work until this is fixed.\n');
  }
  return server;
}

if (require.main === module) start();

module.exports = { app, start };
