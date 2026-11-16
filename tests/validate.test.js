'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { meetsAdvanceRule, manilaParts, isValidDate } = require('../lib/time');
const { validateReservation, sniffType, computeAmounts } = require('../lib/validate');

const cfg = { branches: [{ code: 'calamba', first_hour: 10, last_hour: 21, capacity: 20 }], settings: { min_advance_hours: 24, max_days_ahead: 60, min_guests: 2 } };
const at = (s) => Date.parse(s); // e.g. '2026-11-15T10:00:00+08:00'
const base = { branch: 'calamba', guests: 4, payment_option: 'full', accept_policies: true };

test('24-hour rule: the four examples from the requirements (now = 15 Nov 2026, 10:00 Manila)', () => {
  const now = at('2026-11-15T10:00:00+08:00');
  assert.equal(meetsAdvanceRule('2026-11-15', '23:00', now, 24), false);   // same evening
  assert.equal(meetsAdvanceRule('2026-11-16', '09:00', now, 24), false);   // 9:00 (59 min short in hourly slots)
  assert.equal(meetsAdvanceRule('2026-11-16', '10:00', now, 24), true);    // exactly 24h
  assert.equal(meetsAdvanceRule('2026-11-16', '11:00', now, 24), true);
});
test('24-hour rule at 9:59:59 and 10:00:01 boundaries', () => {
  assert.equal(meetsAdvanceRule('2026-11-16', '10:00', at('2026-11-15T10:00:01+08:00'), 24), false);
  assert.equal(meetsAdvanceRule('2026-11-16', '10:00', at('2026-11-15T09:59:59+08:00'), 24), true);
});
test('timezone: server in UTC still evaluates Manila time (23:30 UTC = 07:30 next day Manila)', () => {
  assert.deepEqual(manilaParts(at('2026-11-15T23:30:00Z')), { date: '2026-11-16', time: '07:30' });
});
test('validateReservation uses the server clock and rejects bypass attempts', () => {
  const now = at('2026-11-15T10:00:00+08:00');
  const ok = validateReservation({ ...base, reservation_date: '2026-11-16', reservation_time: '10:00' }, cfg, now);
  assert.deepEqual(ok.errors, {});
  assert.match(validateReservation({ ...base, reservation_date: '2026-11-16', reservation_time: '09:00' }, cfg, now).errors.reservation_time || validateReservation({ ...base, reservation_date: '2026-11-16', reservation_time: '09:00' }, cfg, now).errors.reservation_date, /./);
  assert.match(validateReservation({ ...base, reservation_date: '2026-11-15', reservation_time: '23:00' }, cfg, now).errors.reservation_date || validateReservation({ ...base, reservation_date: '2026-11-15', reservation_time: '23:00' }, cfg, now).errors.reservation_time, /./);
  assert.match(validateReservation({ ...base, reservation_date: '2026-11-16', reservation_time: '10:00', guests: 1 }, cfg, now).errors.guests, /2 to 20/);
  assert.ok(validateReservation({ ...base, reservation_date: '2026-13-45', reservation_time: '10:00' }, cfg, now).errors.reservation_date);
  assert.ok(validateReservation({ ...base, reservation_date: '2026-11-16', reservation_time: '10:00', accept_policies: false }, cfg, now).errors.accept_policies);
  assert.ok(validateReservation({ ...base, reservation_date: '2027-06-01', reservation_time: '10:00' }, cfg, now).errors.reservation_date);
  assert.equal(isValidDate('2026-02-30'), false);
});
test('file sniffing trusts bytes, not names', () => {
  assert.equal(sniffType(Buffer.from('<html>')), null);
  assert.equal(sniffType(Buffer.from('%PDF-1.4 ...')), 'application/pdf');
  assert.equal(sniffType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0])), 'image/jpeg');
});
test('amounts: 30% downpayment, rounded up, never above total', () => {
  const a = computeAmounts(4, { reservation_fee: 0, minimum_spend_per_guest: 200, downpayment_percent: 30, duration_hours: 2 });
  assert.equal(a.total_amount, 800); assert.equal(a.options.downpayment.amount_due, 240); assert.equal(a.options.full.balance, 0);
});
