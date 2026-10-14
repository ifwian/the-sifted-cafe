// Reservation API.
//
//   PUBLIC
//     POST   /api/reservations              customer submits a request (status = pending)
//   STAFF ONLY (need the admin session cookie)
//     GET    /api/reservations              list + search/filter/pages
//     GET    /api/reservations/summary      counts per status
//     GET    /api/reservations/:id          one reservation
//     PUT    /api/reservations/:id          edit details and status
//     PATCH  /api/reservations/:id/status   change only the status
//     DELETE /api/reservations/:id          delete

const express = require('express');
const db = require('../database');
const config = require('../config');
const { requireAdmin } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimit');
const { requireCsrfHeader } = require('../middleware/security');
const { validateReservation, validateStatus } = require('../validation');
const { parseListQuery } = require('../listQuery');

const router = express.Router();

// Express 4 does not catch errors thrown inside async handlers, so wrap them.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const createLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many reservation requests from this device. Please wait a few minutes or contact the cafe directly.',
});

const COLUMNS = `id, customer_name, phone, email, branch, reservation_date, reservation_time,
                 guests, special_requests, status, admin_notes, created_at, updated_at`;

// ---------- formatting helpers ----------

const referenceFor = (id) => `SC-${String(id).padStart(5, '0')}`;

function toApi(row) {
  const branch = config.branches.find((b) => b.id === row.branch);
  return {
    id: row.id,
    reference: referenceFor(row.id),
    customer_name: row.customer_name,
    phone: row.phone,
    email: row.email,
    branch: row.branch,
    branch_name: branch ? branch.name : row.branch,
    reservation_date: row.reservation_date,
    reservation_time: String(row.reservation_time).slice(0, 5), // 'HH:MM'
    guests: row.guests,
    special_requests: row.special_requests,
    status: row.status,
    admin_notes: row.admin_notes,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function parseId(value) {
  return /^\d{1,10}$/.test(String(value)) ? Number(value) : null;
}

async function findById(id) {
  const rows = await db.query(`SELECT ${COLUMNS} FROM reservations WHERE id = ? LIMIT 1`, [id]);
  return rows[0] || null;
}

// ---------- PUBLIC: create ----------

router.post('/', wrap(async (req, res) => {
  const body = req.body || {};

  // Honeypot: real visitors never see this hidden field. A bot that fills it is turned away.
  if (typeof body.website === 'string' && body.website.trim() !== '') {
    return res.status(400).json({ error: 'We could not process this request.' });
  }

  const { valid, errors, value } = validateReservation(body);
  if (!valid) {
    return res.status(400).json({ error: 'Please fix the highlighted fields.', errors });
  }

  // Only requests that would really be saved count toward the limit, so a customer
  // who mistypes the form a few times is never locked out.
  const attempt = createLimiter.limiter.hit(req.ip);
  if (!attempt.allowed) {
    res.set('Retry-After', String(attempt.retryAfterSeconds));
    return res.status(429).json({ error: createLimiter.message });
  }

  const result = await db.execute(
    `INSERT INTO reservations
       (customer_name, phone, email, branch, reservation_date, reservation_time, guests, special_requests, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    [
      value.customer_name, value.phone, value.email, value.branch,
      value.reservation_date, value.reservation_time, value.guests, value.special_requests,
    ]
  );

  // Only reached if the INSERT succeeded.
  const saved = toApi(await findById(result.insertId));
  res.status(201).json({
    message: 'Your reservation request has been received. It is NOT confirmed yet: our team will contact you to confirm.',
    reservation: {
      reference: saved.reference,
      customer_name: saved.customer_name,
      branch_name: saved.branch_name,
      reservation_date: saved.reservation_date,
      reservation_time: saved.reservation_time,
      guests: saved.guests,
      status: saved.status,
    },
  });
}));

// ---------- STAFF: everything below needs a signed-in admin ----------

router.use(requireAdmin, requireCsrfHeader);

router.get('/summary', wrap(async (req, res) => {
  const rows = await db.query('SELECT status, COUNT(*) AS count FROM reservations GROUP BY status');
  const summary = { total: 0 };
  config.statuses.forEach((s) => { summary[s] = 0; });
  rows.forEach((r) => {
    summary[r.status] = Number(r.count);
    summary.total += Number(r.count);
  });
  res.json({ summary });
}));

router.get('/', wrap(async (req, res) => {
  const parsed = parseListQuery(req.query);
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  const countRows = await db.query(`SELECT COUNT(*) AS total FROM reservations ${parsed.whereSql}`, parsed.params);
  const total = Number(countRows[0].total);

  // pageSize and offset are whole numbers already validated by parseListQuery,
  // and MySQL does not accept "?" placeholders for LIMIT/OFFSET in prepared statements.
  const rows = await db.query(
    `SELECT ${COLUMNS} FROM reservations ${parsed.whereSql}
      ORDER BY ${parsed.orderBy}
      LIMIT ${parsed.pageSize} OFFSET ${parsed.offset}`,
    parsed.params
  );

  res.json({
    reservations: rows.map(toApi),
    pagination: {
      page: parsed.page,
      pageSize: parsed.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / parsed.pageSize)),
    },
  });
}));

router.get('/:id', wrap(async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Invalid reservation id.' });
  const row = await findById(id);
  if (!row) return res.status(404).json({ error: 'Reservation not found.' });
  res.json({ reservation: toApi(row) });
}));

router.put('/:id', wrap(async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Invalid reservation id.' });
  if (!(await findById(id))) return res.status(404).json({ error: 'Reservation not found.' });

  const { valid, errors, value } = validateReservation(req.body, { isAdmin: true });
  if (!valid) return res.status(400).json({ error: 'Please fix the highlighted fields.', errors });

  await db.execute(
    `UPDATE reservations
        SET customer_name = ?, phone = ?, email = ?, branch = ?, reservation_date = ?,
            reservation_time = ?, guests = ?, special_requests = ?, status = ?, admin_notes = ?
      WHERE id = ?`,
    [
      value.customer_name, value.phone, value.email, value.branch, value.reservation_date,
      value.reservation_time, value.guests, value.special_requests, value.status, value.admin_notes,
      id,
    ]
  );
  res.json({ message: 'Reservation updated.', reservation: toApi(await findById(id)) });
}));

router.patch('/:id/status', wrap(async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Invalid reservation id.' });
  const status = req.body && req.body.status;
  if (!validateStatus(status)) {
    return res.status(400).json({ error: `Status must be one of: ${config.statuses.join(', ')}.` });
  }
  if (!(await findById(id))) return res.status(404).json({ error: 'Reservation not found.' });

  await db.execute('UPDATE reservations SET status = ? WHERE id = ?', [status, id]);
  res.json({ message: 'Status updated.', reservation: toApi(await findById(id)) });
}));

router.delete('/:id', wrap(async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Invalid reservation id.' });
  const result = await db.execute('DELETE FROM reservations WHERE id = ?', [id]);
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Reservation not found.' });
  res.json({ message: 'Reservation deleted.' });
}));

module.exports = router;
