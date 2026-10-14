// Unit tests for the small helper modules: sessions, rate limiter, database error messages,
// and a consistency check between server/config.js and database.sql.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const session = require('../../server/session');
const { RateLimiter } = require('../../server/middleware/rateLimit');
const { describeDbError } = require('../../server/dbErrors');
const config = require('../../server/config');

test('session tokens are random, long, and hashed with SHA-256', () => {
  const a = session.generateToken();
  const b = session.generateToken();
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, b);
  const hash = session.hashToken(a);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.notEqual(hash, a); // the database never stores the real token
  assert.equal(hash, session.hashToken(a));
});

test('cookie parsing handles several cookies, spaces and bad encoding', () => {
  assert.deepEqual(session.parseCookies('a=1; sifted_admin=abc123; b=x%20y'), { a: '1', sifted_admin: 'abc123', b: 'x y' });
  assert.deepEqual(session.parseCookies(undefined), {});
  assert.doesNotThrow(() => session.parseCookies('bad=%E0%A4%A; ok=1'));
});

test('the session cookie is HttpOnly and SameSite=Strict; Secure only when asked', () => {
  const dev = session.buildSessionCookie('tok', { maxAgeSeconds: 100, secure: false });
  assert.match(dev, /HttpOnly/);
  assert.match(dev, /SameSite=Strict/);
  assert.match(dev, /Max-Age=100/);
  assert.doesNotMatch(dev, /Secure/);
  assert.match(session.buildSessionCookie('tok', { maxAgeSeconds: 100, secure: true }), /; Secure/);
  assert.match(session.buildClearCookie({ secure: false }), /Max-Age=0/);
});

test('SESSION_HOURS falls back to 8 for missing or silly values', () => {
  const old = process.env.SESSION_HOURS;
  try {
    for (const [value, expected] of [[undefined, 8], ['abc', 8], ['0', 8], ['-3', 8], ['500', 8], ['2', 2]]) {
      if (value === undefined) delete process.env.SESSION_HOURS; else process.env.SESSION_HOURS = value;
      assert.equal(session.getSessionHours(), expected, `SESSION_HOURS=${value}`);
    }
  } finally {
    if (old === undefined) delete process.env.SESSION_HOURS; else process.env.SESSION_HOURS = old;
  }
});

test('rate limiter blocks after the limit, then allows again after the window', () => {
  const limiter = new RateLimiter({ windowMs: 1000, max: 3 });
  const t = 1_000_000;
  assert.equal(limiter.hit('ip', t).allowed, true);
  assert.equal(limiter.hit('ip', t + 10).allowed, true);
  assert.equal(limiter.hit('ip', t + 20).allowed, true);
  const blocked = limiter.hit('ip', t + 30);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds >= 1);
  assert.equal(limiter.hit('other-ip', t + 30).allowed, true); // other clients are unaffected
  assert.equal(limiter.hit('ip', t + 1500).allowed, true);      // window has passed
});

test('rate limiter reset and cleanup forget old entries', () => {
  const limiter = new RateLimiter({ windowMs: 1000, max: 1 });
  limiter.hit('a', 0);
  limiter.reset('a');
  assert.equal(limiter.hit('a', 1).allowed, true);
  limiter.cleanup(10_000);
  assert.equal(limiter.hits.size, 0);
});

test('database errors become friendly browser text and useful terminal hints', () => {
  const down = describeDbError({ code: 'ECONNREFUSED' });
  assert.equal(down.status, 503);
  assert.doesNotMatch(down.message, /ECONNREFUSED|mysql|password/i); // nothing technical for visitors
  assert.match(down.hint, /MySQL server running/);
  assert.match(describeDbError({ code: 'ER_ACCESS_DENIED_ERROR' }).hint, /DB_PASSWORD/);
  assert.match(describeDbError({ code: 'ER_BAD_DB_ERROR' }).hint, /database.sql/);
  assert.match(describeDbError({ code: 'ER_NO_SUCH_TABLE' }).hint, /database.sql/);
  const other = describeDbError(new Error('boom'));
  assert.equal(other.status, 500);
  assert.doesNotMatch(other.message, /boom/);
  assert.doesNotThrow(() => describeDbError(undefined));
});

test('server/config.js matches database.sql (statuses and branch ids fit the columns)', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'database.sql'), 'utf8');
  const enumMatch = /status\s+ENUM\(([^)]*)\)/i.exec(sql);
  assert.ok(enumMatch, 'status ENUM not found in database.sql');
  const sqlStatuses = enumMatch[1].split(',').map((s) => s.trim().replace(/'/g, ''));
  assert.deepEqual(sqlStatuses, config.statuses);
  assert.match(sql, /DEFAULT 'pending'/);
  const branchLength = Number(/branch\s+VARCHAR\((\d+)\)/i.exec(sql)[1]);
  for (const b of config.branches) assert.ok(b.id.length <= branchLength, `${b.id} fits the branch column`);
});

test('config opening hours are sensible', () => {
  for (const b of config.branches) {
    assert.match(b.open, /^\d\d:\d\d$/);
    assert.match(b.close, /^\d\d:\d\d$/);
    assert.ok(b.open < b.close, `${b.id} opens before it closes`);
  }
  assert.ok(config.minGuests >= 1 && config.maxGuests >= config.minGuests);
});
