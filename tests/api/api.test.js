// End-to-end API tests. They talk to a RUNNING server and a REAL MySQL database.
//
//   1. Start the server in one terminal:   npm start
//   2. Run the tests in another terminal:  npm run test:api
//
// The admin tests need an admin account. Set these in the same terminal first
// (Windows PowerShell):   $env:TEST_ADMIN_USER="yourname"; $env:TEST_ADMIN_PASSWORD="yourpassword"
// Without them the admin tests are skipped (the public tests still run).
// Optional: TEST_BASE_URL (default http://localhost:3000).
//
// Every record these tests create is named "Test Automated" and deleted at the end.

const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../../server/config');
const { getCafeNow, addDays } = require('../../server/validation');

const BASE = (process.env.TEST_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const ADMIN_USER = process.env.TEST_ADMIN_USER;
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD;
const hasAdmin = Boolean(ADMIN_USER && ADMIN_PASSWORD);
const adminOnly = { skip: hasAdmin ? false : 'set TEST_ADMIN_USER and TEST_ADMIN_PASSWORD to run this test' };

let cookie = '';           // the admin session cookie after login
const createdIds = [];     // reservations to clean up

// Sends a request. Returns { status, body, headers }.
async function call(method, path, { body, auth = false, headers = {} } = {}) {
  const options = { method, headers: { Accept: 'application/json', ...headers } };
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  if (method !== 'GET') options.headers['X-Requested-With'] = 'fetch';
  if (auth && cookie) options.headers.Cookie = cookie;
  const response = await fetch(BASE + path, options);
  let json = null;
  try { json = await response.json(); } catch { /* not JSON */ }
  return { status: response.status, body: json, headers: response.headers };
}

// A valid request for a date a few days ahead, so it never hits the "too soon" rule.
function validRequest(overrides = {}) {
  const date = addDays(getCafeNow(config.timezone).date, 3);
  return {
    customer_name: 'Test Automated',
    phone: '0917 000 0000',
    email: 'test.automated@example.com',
    branch: 'calamba',
    reservation_date: date,
    reservation_time: '12:00',
    guests: 2,
    special_requests: 'Created by the automated test',
    ...overrides,
  };
}

test.before(async () => {
  const health = await call('GET', '/api/health').catch(() => null);
  if (!health || health.status !== 200) {
    throw new Error(`Cannot reach a healthy server at ${BASE}. Start it with "npm start" and check the database connection first.`);
  }
});

test.after(async () => {
  if (!cookie) return;
  for (const id of createdIds) await call('DELETE', `/api/reservations/${id}`, { auth: true }).catch(() => {});
});

// ---------- public ----------

test('GET /api/config returns the reservation rules', async () => {
  const r = await call('GET', '/api/config');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.statuses, config.statuses);
  assert.ok(Array.isArray(r.body.branches) && r.body.branches.length > 0);
});

test('security headers are sent', async () => {
  const r = await call('GET', '/api/config');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(r.headers.get('x-powered-by'), null);
});

test('the website and admin pages are served', async () => {
  for (const [path, text] of [['/', 'Reserve a table'], ['/admin', 'Staff sign-in']]) {
    const response = await fetch(BASE + path);
    assert.equal(response.status, 200, path);
    assert.match(await response.text(), new RegExp(text), path);
  }
});

test('POST /api/reservations rejects an empty body with field errors', async () => {
  const r = await call('POST', '/api/reservations', { body: {} });
  assert.equal(r.status, 400);
  assert.ok(r.body.errors.customer_name && r.body.errors.phone && r.body.errors.guests);
});

test('POST /api/reservations rejects invalid values', async () => {
  const cases = [
    [{ phone: 'abc' }, 'phone'],
    [{ email: 'nope' }, 'email'],
    [{ guests: 0 }, 'guests'],
    [{ guests: config.maxGuests + 1 }, 'guests'],
    [{ branch: 'mars' }, 'branch'],
    [{ reservation_date: '2020-01-01' }, 'reservation_date'],
    [{ reservation_date: '2026-02-31' }, 'reservation_date'],
    [{ reservation_time: '03:00' }, 'reservation_time'],
    [{ customer_name: '<b>x</b>' }, 'customer_name'],
  ];
  for (const [change, field] of cases) {
    const r = await call('POST', '/api/reservations', { body: validRequest(change) });
    assert.equal(r.status, 400, `${field} should be rejected`);
    assert.ok(r.body.errors[field], `expected an error on ${field}`);
  }
});

test('POST /api/reservations rejects malformed JSON', async () => {
  const response = await fetch(`${BASE}/api/reservations`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{not json',
  });
  assert.equal(response.status, 400);
});

test('the hidden honeypot field turns bots away', async () => {
  const r = await call('POST', '/api/reservations', { body: validRequest({ website: 'http://spam.example' }) });
  assert.equal(r.status, 400);
});

test('a valid public request is saved as PENDING and never as confirmed', async () => {
  // Even if the sender tries to choose the status, the server ignores it.
  const r = await call('POST', '/api/reservations', { body: validRequest({ status: 'confirmed' }) });
  assert.equal(r.status, 201);
  assert.equal(r.body.reservation.status, 'pending');
  assert.match(r.body.reservation.reference, /^SC-\d{5}$/);
  assert.match(r.body.message, /NOT confirmed/);
  assert.equal(r.body.reservation.phone, undefined); // the public reply does not echo private details
  createdIds.push(Number(r.body.reservation.reference.slice(3)));
});

// ---------- staff routes must be protected ----------

test('every staff route returns 401 without a session', async () => {
  const routes = [
    ['GET', '/api/reservations'],
    ['GET', '/api/reservations/summary'],
    ['GET', '/api/reservations/1'],
    ['PUT', '/api/reservations/1', validRequest({ status: 'pending' })],
    ['PATCH', '/api/reservations/1/status', { status: 'confirmed' }],
    ['DELETE', '/api/reservations/1'],
    ['GET', '/api/auth/me'],
  ];
  for (const [method, path, body] of routes) {
    const r = await call(method, path, { body });
    assert.equal(r.status, 401, `${method} ${path}`);
  }
});

test('a made-up session cookie is rejected', async () => {
  const r = await call('GET', '/api/reservations', { headers: { Cookie: 'sifted_admin=' + 'a'.repeat(64) } });
  assert.equal(r.status, 401);
});

test('login rejects missing, wrong and non-text credentials', async () => {
  assert.equal((await call('POST', '/api/auth/login', { body: {} })).status, 400);
  assert.equal((await call('POST', '/api/auth/login', { body: { username: 5, password: {} } })).status, 400);
  const wrong = await call('POST', '/api/auth/login', { body: { username: 'nobody-here', password: 'wrong-password-123' } });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.body.error, 'Invalid username or password.');
});

test('login without the security header is blocked', async () => {
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'a', password: 'b' }),
  });
  assert.equal(response.status, 403);
});

// ---------- staff CRUD (needs an admin account) ----------

test('admin login sets an HttpOnly session cookie', adminOnly, async () => {
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
    body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASSWORD }),
  });
  assert.equal(response.status, 200, 'login failed: check TEST_ADMIN_USER / TEST_ADMIN_PASSWORD');
  const setCookie = response.headers.get('set-cookie');
  assert.match(setCookie, /sifted_admin=/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  cookie = setCookie.split(';')[0];
  assert.equal((await call('GET', '/api/auth/me', { auth: true })).body.admin.username, ADMIN_USER);
});

let reservationId;

test('CREATE then READ: a new request appears in the staff list and detail view', adminOnly, async () => {
  const created = await call('POST', '/api/reservations', { body: validRequest({ customer_name: 'Test Automated Reader' }) });
  assert.equal(created.status, 201);
  reservationId = Number(created.body.reservation.reference.slice(3));
  createdIds.push(reservationId);

  const detail = await call('GET', `/api/reservations/${reservationId}`, { auth: true });
  assert.equal(detail.status, 200);
  assert.equal(detail.body.reservation.customer_name, 'Test Automated Reader');
  assert.equal(detail.body.reservation.status, 'pending');
  assert.equal(detail.body.reservation.reservation_time, '12:00');
  assert.equal(detail.body.reservation.email, 'test.automated@example.com');

  const list = await call('GET', '/api/reservations?search=Test%20Automated%20Reader', { auth: true });
  assert.equal(list.status, 200);
  assert.ok(list.body.reservations.some((r) => r.id === reservationId));
  assert.ok(list.body.pagination.total >= 1);
});

test('READ: filters, sorting, paging and bad queries', adminOnly, async () => {
  const pending = await call('GET', '/api/reservations?status=pending&branch=calamba&sort=upcoming&pageSize=5', { auth: true });
  assert.equal(pending.status, 200);
  assert.ok(pending.body.reservations.every((r) => r.status === 'pending' && r.branch === 'calamba'));
  assert.ok(pending.body.reservations.length <= 5);
  assert.equal((await call('GET', '/api/reservations?status=bogus', { auth: true })).status, 400);
  assert.equal((await call('GET', '/api/reservations?pageSize=1000', { auth: true })).status, 400);
  assert.equal((await call('GET', "/api/reservations?search=%27%3B%20DROP%20TABLE%20reservations%3B--", { auth: true })).status, 200);
  assert.equal((await call('GET', '/api/reservations/abc', { auth: true })).status, 400);
  assert.equal((await call('GET', '/api/reservations/999999999', { auth: true })).status, 404);
  const summary = await call('GET', '/api/reservations/summary', { auth: true });
  assert.equal(summary.status, 200);
  assert.ok(summary.body.summary.total >= 1);
});

test('UPDATE: staff can edit details, notes and status', adminOnly, async () => {
  const body = {
    ...validRequest({ customer_name: 'Test Automated Edited', guests: 6, reservation_time: '14:30' }),
    status: 'confirmed',
    admin_notes: 'Confirmed by phone (automated test)',
  };
  const r = await call('PUT', `/api/reservations/${reservationId}`, { auth: true, body });
  assert.equal(r.status, 200);
  assert.equal(r.body.reservation.customer_name, 'Test Automated Edited');
  assert.equal(r.body.reservation.guests, 6);
  assert.equal(r.body.reservation.reservation_time, '14:30');
  assert.equal(r.body.reservation.status, 'confirmed');
  assert.equal(r.body.reservation.admin_notes, 'Confirmed by phone (automated test)');

  const bad = await call('PUT', `/api/reservations/${reservationId}`, { auth: true, body: { ...body, guests: 0, status: 'maybe' } });
  assert.equal(bad.status, 400);
  assert.ok(bad.body.errors.guests && bad.body.errors.status);
  assert.equal((await call('PUT', '/api/reservations/999999999', { auth: true, body })).status, 404);
});

test('UPDATE: status-only change accepts valid statuses and rejects others', adminOnly, async () => {
  const ok = await call('PATCH', `/api/reservations/${reservationId}/status`, { auth: true, body: { status: 'cancelled' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.reservation.status, 'cancelled');
  assert.equal((await call('PATCH', `/api/reservations/${reservationId}/status`, { auth: true, body: { status: 'done' } })).status, 400);
  assert.equal((await call('PATCH', '/api/reservations/999999999/status', { auth: true, body: { status: 'pending' } })).status, 404);
});

test('state-changing staff requests without the security header are blocked', adminOnly, async () => {
  const response = await fetch(`${BASE}/api/reservations/${reservationId}`, { method: 'DELETE', headers: { Cookie: cookie } });
  assert.equal(response.status, 403);
});

test('DELETE: removes the record, then it is gone', adminOnly, async () => {
  const r = await call('DELETE', `/api/reservations/${reservationId}`, { auth: true });
  assert.equal(r.status, 200);
  assert.equal((await call('GET', `/api/reservations/${reservationId}`, { auth: true })).status, 404);
  assert.equal((await call('DELETE', `/api/reservations/${reservationId}`, { auth: true })).status, 404);
});

test('logout ends the session', adminOnly, async () => {
  assert.equal((await call('POST', '/api/auth/logout', { auth: true })).status, 200);
  assert.equal((await call('GET', '/api/auth/me', { auth: true })).status, 401);
  cookie = ''; // cleanup in test.after needs a new login, so sign in again quietly
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
    body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASSWORD }),
  });
  if (response.status === 200) cookie = response.headers.get('set-cookie').split(';')[0];
});
