'use strict';
// End-to-end API tests: real Node API code + real schema.sql on a local PostgreSQL, with a mock of the Supabase HTTP services.
// Run:  node --test tests/      (needs a running local PostgreSQL; skipped when psql is unavailable)
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');
const { spawnSync } = require('child_process');
const mock = require('./mock-supabase');

const DB = 'sifted_api';
const havePg = spawnSync('which', ['psql']).status === 0 && spawnSync('runuser', ['-u', 'postgres', '--', 'psql', '-Atc', 'select 1'], { encoding: 'utf8' }).status === 0;

// 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

function pg(sql) { const r = mock.psql(DB, sql); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); }

function client(base) {
  const jar = {};
  return async function call(method, url, body, headers = {}) {
    const h = { 'X-Requested-With': 'fetch', 'Content-Type': 'application/json', cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '), ...headers };
    if (headers.__raw) { delete h.__raw; }
    const res = await fetch(base + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); if (/Max-Age=0/.test(c)) delete jar[kv.slice(0, i)]; else jar[kv.slice(0, i)] = kv.slice(i + 1); }
    const text = await res.text();
    let data = null; try { data = JSON.parse(text); } catch (e) { /* not json */ }
    return { status: res.status, data, location: res.headers.get('location'), headers: res.headers, jar };
  };
}

test('API end to end', { skip: !havePg && 'PostgreSQL not available' }, async (t) => {
  spawnSync('runuser', ['-u', 'postgres', '--', 'dropdb', '--if-exists', DB]);
  spawnSync('runuser', ['-u', 'postgres', '--', 'createdb', DB]);
  for (const f of ['supabase_stub.sql', '../supabase/schema.sql']) {
    const r = spawnSync('runuser', ['-u', 'postgres', '--', 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', DB, '-f', path.join(__dirname, f)], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  }
  const sb = await mock.start(DB);
  Object.assign(process.env, { SUPABASE_URL: sb.url, SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service', SITE_URL: 'https://example.test' });
  const { handle } = require('../lib/routes');
  const api = http.createServer((req, res) => handle(req, res));
  await new Promise((r) => api.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${api.address().port}`;
  t.after(() => { api.close(); sb.close(); spawnSync('runuser', ['-u', 'postgres', '--', 'dropdb', DB]); });

  const day = (n) => new Date(Date.now() + 8 * 3600e3 + n * 86400e3).toISOString().slice(0, 10);
  const alice = client(base), bob = client(base), staff = client(base), anon = client(base);
  const ok = async (p, status = 200) => { const r = await p; assert.equal(r.status, status, JSON.stringify(r.data)); return r; };

  await t.test('public config comes from the database', async () => {
    const r = await ok(anon('GET', '/api/config'));
    assert.equal(r.data.min_advance_hours, 24);
    assert.deepEqual(r.data.branches.map((b) => b.code).sort(), ['cabuyao', 'calamba']);
    assert.ok(r.data.server_now);
  });

  await t.test('registration validates input and signs the user in', async () => {
    const bad = await alice('POST', '/api/customer/register', { full_name: 'A', email: 'nope', phone: '1', password: 'short' });
    assert.equal(bad.status, 400); assert.ok(bad.data.errors.email && bad.data.errors.password && bad.data.errors.phone);
    await ok(alice('POST', '/api/customer/register', { full_name: 'Alice Cruz', email: 'alice@test.ph', phone: '0917 123 4567', password: 'Secret123' }), 201);
    await ok(bob('POST', '/api/customer/register', { full_name: 'Bob Reyes', email: 'bob@test.ph', phone: '09179876543', password: 'Secret123' }), 201);
    const dup = await anon('POST', '/api/customer/register', { full_name: 'Alice Cruz', email: 'alice@test.ph', phone: '0917 123 4567', password: 'Secret123' });
    assert.equal(dup.status, 409);
    const me = await ok(alice('GET', '/api/customer/me'));
    assert.equal(me.data.customer.role, 'customer');
    assert.ok(!JSON.stringify(me.data).includes('password'));
  });

  await t.test('cookies are HttpOnly + SameSite', async () => {
    const r = await ok(anon('POST', '/api/customer/login', { email: 'alice@test.ph', password: 'Secret123' }));
    const c = r.headers.getSetCookie().join(' | ');
    assert.match(c, /sb_at=.*HttpOnly.*SameSite=Lax/);
    const wrong = await anon('POST', '/api/customer/login', { email: 'alice@test.ph', password: 'wrong' });
    assert.equal(wrong.status, 401);
  });

  await t.test('CSRF: requests without the security header or from another origin are blocked', async () => {
    const r1 = await alice('POST', '/api/customer/logout', {}, { 'X-Requested-With': '' });
    assert.equal(r1.status, 403);
    const r2 = await alice('POST', '/api/customer/logout', {}, { Origin: 'https://evil.example' });
    assert.equal(r2.status, 403);
    await ok(alice('GET', '/api/customer/me'));   // still signed in
  });

  await t.test('signed-out users cannot use protected endpoints', async () => {
    const nobody = client(base);
    for (const [m, u] of [['GET', '/api/my/reservations'], ['GET', '/api/availability?branch=calamba&date=' + day(3)], ['POST', '/api/reservations'], ['GET', '/api/staff/reservations'], ['POST', '/api/uploads/proof-url']]) {
      const r = await nobody(m, u, m === 'POST' ? {} : undefined);
      assert.equal(r.status, 401, `${m} ${u}`);
    }
  });

  async function uploadProof(who, bytes = PNG, type = 'image/png') {
    const ticket = await ok(who('POST', '/api/uploads/proof-url', { content_type: type, size: bytes.length, filename: 'gcash.png' }));
    const fd = new FormData(); fd.append('cacheControl', '3600'); fd.append('', new Blob([bytes]));
    const put = await fetch(ticket.data.upload_url, { method: 'PUT', body: fd });
    assert.equal(put.status, 200);
    return ticket.data;
  }
  const form = (extra) => ({ branch: 'calamba', reservation_date: day(4), reservation_time: '12:00', guests: 4, payment_option: 'downpayment', accept_policies: true, website: '', ...extra });

  await t.test('upload rules: bad type and oversize are refused before upload', async () => {
    assert.equal((await alice('POST', '/api/uploads/proof-url', { content_type: 'text/html', size: 100, filename: 'x.html' })).status, 400);
    assert.equal((await alice('POST', '/api/uploads/proof-url', { content_type: 'image/png', size: 9 * 1024 * 1024, filename: 'x.png' })).status, 400);
  });

  await t.test('24-hour rule is enforced by the API (past, today, <24h)', async () => {
    const proof = await uploadProof(alice);
    for (const [d, label] of [[day(-1), 'yesterday'], [day(0), 'today'], [new Date(Date.now() + 8 * 3600e3 + 12 * 3600e3).toISOString().slice(0, 10), '12h ahead']]) {
      const r = await alice('POST', '/api/reservations', form({ reservation_date: d, payment_proof_path: proof.path, payment_proof_name: 'g.png' }));
      assert.equal(r.status, 400, label);
      assert.match(r.data.errors.reservation_date, /24 hours in advance/);
    }
  });

  await t.test('invalid fields are rejected (bad time, guests, option, bot trap, missing proof)', async () => {
    const proof = await uploadProof(alice);
    const p = { payment_proof_path: proof.path, payment_proof_name: 'g.png' };
    assert.ok((await alice('POST', '/api/reservations', form({ ...p, reservation_time: '03:00' }))).data.errors.reservation_time);
    assert.ok((await alice('POST', '/api/reservations', form({ ...p, reservation_time: '12:30' }))).data.errors.reservation_time);
    assert.ok((await alice('POST', '/api/reservations', form({ ...p, guests: 99 }))).data.errors.guests);
    assert.ok((await alice('POST', '/api/reservations', form({ ...p, payment_option: 'free' }))).data.errors.payment_option);
    assert.equal((await alice('POST', '/api/reservations', form({ ...p, website: 'spam' }))).status, 400);
    assert.ok((await alice('POST', '/api/reservations', form({ payment_proof_path: '' }))).data.errors.payment_proof);
    assert.ok((await alice('POST', '/api/reservations', form({ ...p, reservation_date: '2026-02-31' }))).data.errors.reservation_date);
  });

  await t.test('a fake "proof" (HTML renamed .png) is rejected and deleted', async () => {
    const proof = await uploadProof(alice, Buffer.from('<html><script>alert(1)</script></html>'));
    const r = await alice('POST', '/api/reservations', form({ payment_proof_path: proof.path, payment_proof_name: 'x.png' }));
    assert.equal(r.status, 400); assert.match(r.data.errors.payment_proof, /PNG, JPG or PDF/);
    assert.equal(sb.files.has(proof.path), false);
  });

  let resId;
  await t.test('valid reservation is saved; amounts come from the server', async () => {
    const proof = await uploadProof(alice);
    const r = await ok(alice('POST', '/api/reservations', form({ payment_proof_path: proof.path, payment_proof_name: 'gcash.png', total_amount: 1, amount_due: 1, payment_status: 'verified' }) ), 201);
    assert.equal(r.data.reservation.status, 'pending');
    assert.equal(r.data.reservation.payment_status, 'proof_submitted');
    assert.equal(r.data.reservation.total_amount, 800);
    assert.equal(r.data.reservation.amount_due, 240);
    assert.equal(pg(`select count(*) from reservations`), '1');
    resId = Number(pg(`select id from reservations`));
  });

  await t.test('double submit of the same slot is refused', async () => {
    const proof = await uploadProof(alice);
    const r = await alice('POST', '/api/reservations', form({ payment_proof_path: proof.path, payment_proof_name: 'g.png' }));
    assert.equal(r.status, 409); assert.ok(r.data.errors.reservation_time);
    assert.equal(sb.files.has(proof.path), false, 'orphan upload cleaned up');
  });

  await t.test('capacity: Bob cannot take more seats than remain', async () => {
    const proof = await uploadProof(bob);
    const r = await bob('POST', '/api/reservations', form({ guests: 17, payment_proof_path: proof.path, payment_proof_name: 'g.png' }));
    assert.equal(r.status, 409); assert.match(r.data.errors.reservation_time, /fully booked/);
    const av = await ok(bob('GET', `/api/availability?branch=calamba&date=${day(4)}`));
    assert.equal(av.data.seats_left['12:00'], 16);
    assert.equal(av.data.bookable['12:00'], true);
    const today = await ok(bob('GET', `/api/availability?branch=calamba&date=${day(0)}`));
    assert.ok(Object.values(today.data.bookable).every((b) => b === false), 'today has no bookable slot');
  });

  await t.test('customers only see their own history', async () => {
    const mine = await ok(alice('GET', '/api/my/reservations'));
    assert.equal(mine.data.reservations.length, 1);
    assert.equal(mine.data.reservations[0].phase, 'upcoming');
    assert.equal(mine.data.reservations[0].can_cancel, true);
    assert.equal(mine.data.reservations[0].admin_notes, undefined);
    assert.equal((await ok(bob('GET', '/api/my/reservations'))).data.reservations.length, 0);
    assert.equal((await bob('POST', `/api/reservations/${resId}/cancel`, {})).status, 404);
  });

  await t.test('customers cannot reach staff functions', async () => {
    assert.equal((await alice('GET', '/api/staff/reservations')).status, 403);
    assert.equal((await alice('POST', `/api/staff/reservations/${resId}/action`, { action: 'verify' })).status, 403);
    assert.equal((await alice('GET', `/api/staff/reservations/${resId}/proof`)).status, 403);
    assert.equal((await alice('GET', `/api/staff/reservations/${resId}`)).status, 403);
  });

  await t.test('staff workflow: list, verify, confirm, proof link, complete, archive, delete', async () => {
    await ok(staff('POST', '/api/customer/register', { full_name: 'Sam Staff', email: 'staff@test.ph', phone: '09170000000', password: 'Secret123' }), 201);
    assert.equal((await staff('GET', '/api/staff/reservations')).status, 403, 'a new account is a customer, never staff');
    pg(`update public.profiles set role='staff' where email='staff@test.ph'`);
    await ok(staff('POST', '/api/customer/login', { email: 'staff@test.ph', password: 'Secret123' }));
    const list = await ok(staff('GET', '/api/staff/reservations?payment=proof_submitted'));
    assert.equal(list.data.reservations.length, 1); assert.equal(list.data.counts.proofs_to_check, 1);
    assert.equal((await ok(staff('GET', '/api/staff/reservations?q=alice'))).data.reservations.length, 1);
    assert.equal((await ok(staff('GET', '/api/staff/reservations?q=nobody'))).data.reservations.length, 0);
    const act = (action, text) => staff('POST', `/api/staff/reservations/${resId}/action`, { action, text });
    assert.equal((await act('confirm')).status, 409, 'cannot confirm before verified');
    const proof = await staff('GET', `/api/staff/reservations/${resId}/proof`);
    assert.equal(proof.status, 302); assert.match(proof.location, /object\/sign\/payment-proofs\//);
    await ok(act('verify'));
    await ok(act('confirm'));
    await ok(act('complete'));
    await ok(act('archive'));
    assert.equal((await ok(staff('GET', '/api/staff/reservations?view=archive'))).data.reservations.length, 1);
    await ok(act('delete'));
    assert.equal(pg(`select count(*) from reservations`), '0');
    assert.equal(sb.files.size, 0, 'proof file removed with the reservation');
  });

  await t.test('forgot / reset password answers generically and validates', async () => {
    const r1 = await ok(anon('POST', '/api/customer/forgot-password', { email: 'nobody@test.ph' }));
    assert.match(r1.data.message, /If that email has an account/);
    assert.equal((await anon('POST', '/api/customer/reset-password', { access_token: 'x', password: 'Newpass123' })).status, 400);
  });

  await t.test('logout clears the session', async () => {
    await ok(alice('POST', '/api/customer/logout', {}));
    assert.equal((await alice('GET', '/api/customer/me')).status, 401);
  });

  await t.test('unknown routes and wrong methods', async () => {
    assert.equal((await anon('GET', '/api/nope')).status, 404);
    assert.equal((await anon('GET', '/api/customer/login')).status, 405);
  });
});
