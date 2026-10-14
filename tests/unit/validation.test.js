// Unit tests for server/validation.js. No database or server needed.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateReservation, validateStatus, getSlotsForBranch, isRealDate, addDays, getCafeNow,
} = require('../../server/validation');
const config = require('../../server/config');

// Fixed "now": 2026-10-13 10:00 in Manila (= 02:00 UTC), so tests never depend on today's date.
const NOW = new Date('2026-10-13T02:00:00Z');
const opts = { now: NOW };

// A reservation that should pass. Individual tests change one field at a time.
const good = () => ({
  customer_name: 'Ana Dela Cruz',
  phone: '0917 123 4567',
  email: 'Ana@Example.com',
  branch: 'calamba',
  reservation_date: '2026-10-20',
  reservation_time: '19:00',
  guests: 4,
  special_requests: 'Near a power outlet please',
});

test('a correct reservation is valid and cleaned for the database', () => {
  const r = validateReservation(good(), opts);
  assert.equal(r.valid, true);
  assert.deepEqual(r.errors, {});
  assert.equal(r.value.reservation_time, '19:00:00');
  assert.equal(r.value.email, 'ana@example.com'); // lower-cased
  assert.equal(r.value.guests, 4);
  assert.equal(r.value.status, undefined); // public requests never choose a status
});

test('optional fields can be empty', () => {
  const r = validateReservation({ ...good(), email: '', special_requests: '' }, opts);
  assert.equal(r.valid, true);
  assert.equal(r.value.email, null);
  assert.equal(r.value.special_requests, null);
});

test('an empty request reports every required field', () => {
  const r = validateReservation({}, opts);
  assert.equal(r.valid, false);
  for (const field of ['customer_name', 'phone', 'branch', 'reservation_date', 'reservation_time', 'guests']) {
    assert.ok(r.errors[field], `expected an error for ${field}`);
  }
  assert.equal(r.value, undefined);
});

test('null, a number or an array instead of an object is rejected, not crashed on', () => {
  for (const input of [null, undefined, 5, 'text', []]) {
    assert.equal(validateReservation(input, opts).valid, false);
  }
});

test('names: too short, digits, markup and very long names are rejected', () => {
  for (const name of ['A', '12345', '<script>alert(1)</script>', "Robert'); DROP TABLE reservations;--", 'x'.repeat(101)]) {
    const r = validateReservation({ ...good(), customer_name: name }, opts);
    assert.ok(r.errors.customer_name, `name should be rejected: ${name.slice(0, 20)}`);
  }
});

test('names: accents, apostrophes and hyphens are accepted', () => {
  for (const name of ["Zoë Dela Peña", "Mary-Ann O'Brien", 'José Jr.']) {
    assert.equal(validateReservation({ ...good(), customer_name: name }, opts).valid, true, name);
  }
});

test('phone numbers: letters, too few digits and too many characters are rejected', () => {
  for (const phone of ['abc', '12345', '09171234567890123456789', '+63 (917) abc', '']) {
    assert.ok(validateReservation({ ...good(), phone }, opts).errors.phone, phone);
  }
  assert.equal(validateReservation({ ...good(), phone: '+63 917 123 4567' }, opts).valid, true);
});

test('email must look like an email when given', () => {
  for (const email of ['not-an-email', 'a@b', 'a b@c.com', '@x.com']) {
    assert.ok(validateReservation({ ...good(), email }, opts).errors.email, email);
  }
  assert.ok(validateReservation({ ...good(), email: 12345 }, opts).errors.email);
});

test('branch must be one of the configured branches', () => {
  assert.ok(validateReservation({ ...good(), branch: 'manila' }, opts).errors.branch);
  assert.ok(validateReservation({ ...good(), branch: '' }, opts).errors.branch);
  assert.equal(validateReservation({ ...good(), branch: 'cabuyao', reservation_time: '21:00' }, opts).valid, true);
});

test('dates: impossible, malformed, past and too-far-ahead dates are rejected', () => {
  assert.ok(validateReservation({ ...good(), reservation_date: '2026-02-31' }, opts).errors.reservation_date);
  assert.ok(validateReservation({ ...good(), reservation_date: '2026-13-01' }, opts).errors.reservation_date);
  assert.ok(validateReservation({ ...good(), reservation_date: '20/10/2026' }, opts).errors.reservation_date);
  assert.ok(validateReservation({ ...good(), reservation_date: '2026-10-12' }, opts).errors.reservation_date); // yesterday
  assert.ok(validateReservation({ ...good(), reservation_date: addDays('2026-10-13', config.maxDaysAhead + 1) }, opts).errors.reservation_date);
  // The last allowed day is accepted.
  assert.equal(validateReservation({ ...good(), reservation_date: addDays('2026-10-13', config.maxDaysAhead) }, opts).valid, true);
});

test('times: must be one of the branch time slots', () => {
  const bad = ['08:30', '20:30', '21:00', '19:15', '25:00', 'noon', '7pm'];
  for (const t of bad) {
    assert.ok(validateReservation({ ...good(), reservation_time: t }, opts).errors.reservation_time, `Calamba ${t}`);
  }
  assert.equal(validateReservation({ ...good(), reservation_time: '09:00' }, opts).valid, true); // opening time
  assert.equal(validateReservation({ ...good(), reservation_time: '20:00' }, opts).valid, true); // last slot (close 21:00 - 60 min)
});

test('same-day requests must be at least the minimum lead time from now', () => {
  const today = '2026-10-13'; // it is 10:00 at the cafe in these tests
  assert.ok(validateReservation({ ...good(), reservation_date: today, reservation_time: '10:30' }, opts).errors.reservation_time);
  assert.ok(validateReservation({ ...good(), reservation_date: today, reservation_time: '10:00' }, opts).errors.reservation_time);
  assert.equal(validateReservation({ ...good(), reservation_date: today, reservation_time: '11:00' }, opts).valid, true);
});

test('guests: whole numbers inside the allowed range only', () => {
  for (const guests of [0, -1, config.maxGuests + 1, 2.5, 'abc', '', null, undefined, NaN, {}, [3]]) {
    assert.ok(validateReservation({ ...good(), guests }, opts).errors.guests, `guests=${JSON.stringify(guests)}`);
  }
  for (const guests of [1, config.maxGuests, '4']) {
    assert.equal(validateReservation({ ...good(), guests }, opts).valid, true, `guests=${guests}`);
  }
});

test('special requests: limited to 500 characters and control characters are removed', () => {
  assert.ok(validateReservation({ ...good(), special_requests: 'x'.repeat(501) }, opts).errors.special_requests);
  assert.ok(validateReservation({ ...good(), special_requests: { a: 1 } }, opts).errors.special_requests);
  const r = validateReservation({ ...good(), special_requests: 'Hello\u0000 World\u0007' }, opts);
  assert.equal(r.value.special_requests, 'Hello World');
});

test('staff edits: need a valid status and may use past dates and any time', () => {
  const staff = { now: NOW, isAdmin: true };
  const past = { ...good(), reservation_date: '2026-01-05', reservation_time: '06:15', status: 'completed' };
  assert.equal(validateReservation(past, staff).valid, true);
  assert.ok(validateReservation({ ...past, status: 'maybe' }, staff).errors.status);
  assert.ok(validateReservation({ ...past, status: undefined }, staff).errors.status);
  // Format rules still apply to staff.
  assert.ok(validateReservation({ ...past, reservation_date: '2026-02-31' }, staff).errors.reservation_date);
  assert.ok(validateReservation({ ...past, reservation_time: '99:99' }, staff).errors.reservation_time);
  assert.ok(validateReservation({ ...past, guests: 0 }, staff).errors.guests);
  // admin_notes are cleaned and length-limited.
  assert.ok(validateReservation({ ...past, admin_notes: 'x'.repeat(1001) }, staff).errors.admin_notes);
  assert.equal(validateReservation({ ...past, admin_notes: '  call back  ' }, staff).value.admin_notes, 'call back');
});

test('the public form can never set status or staff notes', () => {
  const r = validateReservation({ ...good(), status: 'confirmed', admin_notes: 'vip' }, opts);
  assert.equal(r.valid, true);
  assert.equal(r.value.status, undefined);
  assert.equal(r.value.admin_notes, undefined);
});

test('validateStatus accepts only configured statuses', () => {
  for (const s of config.statuses) assert.equal(validateStatus(s), true);
  for (const s of ['', 'PENDING', 'done', null, undefined, 1]) assert.equal(validateStatus(s), false);
});

test('slots follow opening hours, the slot length and the last-booking rule', () => {
  const calamba = getSlotsForBranch(config.branches.find((b) => b.id === 'calamba'));
  assert.equal(calamba[0], '09:00');
  assert.equal(calamba[calamba.length - 1], '20:00');
  assert.equal(calamba.length, 23);
  const cabuyao = getSlotsForBranch(config.branches.find((b) => b.id === 'cabuyao'));
  assert.equal(cabuyao[0], '10:00');
  assert.equal(cabuyao[cabuyao.length - 1], '21:00');
});

test('isRealDate and addDays handle month ends and leap years', () => {
  assert.equal(isRealDate('2028-02-29'), true);
  assert.equal(isRealDate('2026-02-29'), false);
  assert.equal(isRealDate('2026-04-31'), false);
  assert.equal(isRealDate('2026-4-5'), false);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
});

test('getCafeNow uses the cafe time zone, not the computer time zone', () => {
  // 17:30 UTC on Oct 13 is already 01:30 on Oct 14 in Manila (UTC+8).
  assert.deepEqual(getCafeNow('Asia/Manila', new Date('2026-10-13T17:30:00Z')), { date: '2026-10-14', minutes: 90 });
});
