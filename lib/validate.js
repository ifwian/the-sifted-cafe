'use strict';
// Input validation. The browser checks too, but THIS is the check that counts.
// Every validator returns { values, errors } where errors is { fieldName: 'message' } (empty = fine).

const { isValidDate, meetsAdvanceRule, manilaParts, addDays } = require('./time');

const ADVANCE_MESSAGE = 'Reservations must be made at least 24 hours in advance.';

function clean(value, max, nullIfEmpty = false) {
  let t = String(value == null ? '' : value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  if (t.length > max) t = t.slice(0, max);
  return t === '' && nullIfEmpty ? null : t;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M}\s.'’-]*$/u;

function checkName(name) {
  if (!name) return 'Please enter your name.';
  if (name.length < 2) return 'Name must be at least 2 characters.';
  if (!NAME_RE.test(name)) return 'Name can only contain letters, spaces, apostrophes, periods and hyphens.';
  return '';
}
function checkPhone(phone) {
  const digits = phone.replace(/\D/g, '');
  if (!phone) return 'Please enter a contact number.';
  if (!/^\+?[0-9\s\-()]+$/.test(phone)) return 'Contact number can only contain digits, spaces, + - ( ).';
  if (digits.length < 7 || digits.length > 15) return 'Contact number must have between 7 and 15 digits.';
  return '';
}
function checkEmail(email) {
  if (!email) return 'Please enter your email address.';
  if (email.length > 150 || !EMAIL_RE.test(email)) return 'Please enter a valid email address.';
  return '';
}
function checkPassword(pw) {
  if (typeof pw !== 'string' || !pw) return 'Please create a password.';
  if (pw.length < 8 || pw.length > 72 || !/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) {
    return 'Password must be 8 to 72 characters with a letter and a number.';
  }
  return '';
}

function validateRegister(d) {
  const values = {
    full_name: clean(d.full_name, 100), email: clean(d.email, 150).toLowerCase(),
    phone: clean(d.phone, 30), password: typeof d.password === 'string' ? d.password : '',
  };
  const errors = {};
  const set = (k, m) => { if (m) errors[k] = m; };
  set('full_name', checkName(values.full_name));
  set('email', checkEmail(values.email));
  set('phone', checkPhone(values.phone));
  set('password', checkPassword(values.password));
  if (d.confirm_password !== undefined && d.confirm_password !== values.password) errors.confirm_password = 'Passwords do not match.';
  return { values, errors };
}

/**
 * Reservation fields. `cfg` = { branches: [{code, first_hour, last_hour, capacity}], settings: {min_advance_hours, max_days_ahead, min_guests} }.
 * `nowMs` is the SERVER clock. Contact details are NOT read from the form: they belong to the signed-in account.
 */
function validateReservation(d, cfg, nowMs = Date.now()) {
  const errors = {};
  const s = cfg.settings;
  const values = {
    branch: String(d.branch || ''),
    reservation_date: String(d.reservation_date || ''),
    reservation_time: String(d.reservation_time || '').slice(0, 5),
    guests: d.guests,
    occasion: clean(d.occasion, 100, true),
    special_requests: clean(d.special_requests, 500, true),
    payment_option: String(d.payment_option || ''),
    payment_reference: clean(String(d.payment_reference || '').replace(/\s/g, ''), 20, true),
  };
  const branch = cfg.branches.find((b) => b.code === values.branch);
  if (!branch) errors.branch = 'Please choose a branch.';

  const g = Number(values.guests);
  const max = branch ? branch.capacity : Math.max(...cfg.branches.map((b) => b.capacity));
  if (values.guests === '' || values.guests == null || !Number.isInteger(g) || g < s.min_guests || g > max) {
    errors.guests = `Online reservations are for ${s.min_guests} to ${max} guests. For larger groups, please call or message the cafe.`;
  } else values.guests = g;

  if (!isValidDate(values.reservation_date)) {
    errors.reservation_date = 'Please choose a date.';
  } else if (!/^\d{2}:00$/.test(values.reservation_time)) {
    errors.reservation_time = 'Please pick one of the listed times for this branch (every hour while open).';
  } else {
    const hour = Number(values.reservation_time.slice(0, 2));
    if (branch && (hour < branch.first_hour || hour > branch.last_hour)) {
      errors.reservation_time = 'Please pick one of the listed times for this branch (every hour while open).';
    } else if (!meetsAdvanceRule(values.reservation_date, values.reservation_time, nowMs, s.min_advance_hours)) {
      errors.reservation_date = ADVANCE_MESSAGE;
    } else if (values.reservation_date > addDays(manilaParts(nowMs).date, s.max_days_ahead)) {
      errors.reservation_date = `Please choose a date within the next ${s.max_days_ahead} days.`;
    }
  }
  if (!values.reservation_time) errors.reservation_time = 'Please choose a time.';

  if (values.payment_option !== 'downpayment' && values.payment_option !== 'full') errors.payment_option = 'Please choose Downpayment or Full payment.';
  if (values.payment_reference && !/^[0-9]{6,20}$/.test(values.payment_reference)) errors.payment_reference = 'The GCash reference number can only have digits (6 to 20).';
  if (d.accept_policies !== true && d.accept_policies !== 'true') errors.accept_policies = 'Please confirm that you read the policies.';
  return { values, errors };
}

/** Money amounts (same formula as create_reservation() in schema.sql; the database is the authority). */
function computeAmounts(guests, p) {
  const total = p.reservation_fee + guests * p.minimum_spend_per_guest;
  const deposit = Math.min(Math.ceil((total * p.downpayment_percent) / 100), total);
  return {
    guests, reservation_fee: p.reservation_fee, minimum_spend_per_guest: p.minimum_spend_per_guest,
    minimum_spend: guests * p.minimum_spend_per_guest, total_amount: total, downpayment_percent: p.downpayment_percent,
    duration_hours: p.duration_hours,
    options: { downpayment: { amount_due: deposit, balance: total - deposit }, full: { amount_due: total, balance: 0 } },
  };
}

// ---------- Payment proof files ----------
const PROOF_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'application/pdf': 'pdf' };
const MAX_PROOF_BYTES = 3 * 1024 * 1024;

/** What kind of file are these bytes REALLY? (the file name and the browser's claim are not trusted). */
function sniffType(buf) {
  if (buf.length > 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 5 && buf.slice(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  return null;
}

function validateProofRequest(d) {
  const type = String(d.content_type || '');
  const size = Number(d.size);
  if (!PROOF_TYPES[type]) return { error: 'Proof of payment must be a PNG, JPG or PDF file.' };
  if (!Number.isFinite(size) || size <= 0 || size > MAX_PROOF_BYTES) return { error: 'Proof of payment must be smaller than 3 MB.' };
  return { ext: PROOF_TYPES[type], type, name: clean(String(d.filename || 'proof').split(/[\\/]/).pop(), 150) || 'proof' };
}

module.exports = {
  clean, checkName, checkPhone, checkEmail, checkPassword, validateRegister, validateReservation,
  computeAmounts, sniffType, validateProofRequest, PROOF_TYPES, MAX_PROOF_BYTES, ADVANCE_MESSAGE,
};
