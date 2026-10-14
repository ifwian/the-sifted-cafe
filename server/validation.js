// Reservation validation. Pure functions with no database or Express code,
// so they are easy to read and to unit test (tests/unit/validation.test.js).
//
// The browser (public/js/reservation.js) checks the same rules for quick
// feedback, but THIS file is the one that is trusted.

const defaultConfig = require('./config');

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;
const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M}\s.'’-]*$/u;
const PHONE_RE = /^\+?[0-9\s\-()]+$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// Control characters (except normal newline/tab) are never wanted in text.
const CONTROL_CHARS_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

// ---------- small helpers ----------

function timeToMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(total) {
  const h = String(Math.floor(total / 60)).padStart(2, '0');
  const m = String(total % 60).padStart(2, '0');
  return `${h}:${m}`;
}

// Returns true only for real calendar dates (rejects 2026-02-31, month 13...).
function isRealDate(dateStr) {
  const match = DATE_RE.exec(dateStr);
  if (!match) return false;
  const [, y, m, d] = match.map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

// What date and time is it at the cafe right now (in the cafe's time zone)?
// Returns { date: 'YYYY-MM-DD', minutes: minutes since midnight }.
function getCafeNow(timezone, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type).value;
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

// All times a branch accepts reservations for, e.g. ['09:00', '09:30', ...].
function getSlotsForBranch(branch, config = defaultConfig) {
  const first = timeToMinutes(branch.open);
  const last = timeToMinutes(branch.close) - config.lastBookingBeforeCloseMinutes;
  const slots = [];
  for (let t = first; t <= last; t += config.slotMinutes) {
    slots.push(minutesToTime(t));
  }
  return slots;
}

function cleanText(value) {
  return String(value).replace(CONTROL_CHARS_RE, '').trim();
}

// ---------- main validator ----------

/**
 * Validate and clean a reservation.
 *
 * input   - the raw object from the request body
 * options - { isAdmin: false, now: new Date(), config }
 *   isAdmin: staff edits skip the "must be in the future", lead-time,
 *            booking-window and opening-hours rules (staff may need to
 *            record a past visit or make an exception). Formats, guest
 *            limits and the status list are still enforced.
 *
 * Returns { valid, errors, value }.
 *   errors: { fieldName: 'message' }   (empty when valid)
 *   value:  cleaned values ready for the database (only when valid)
 */
function validateReservation(input, options = {}) {
  const config = options.config || defaultConfig;
  const isAdmin = Boolean(options.isAdmin);
  const cafeNow = getCafeNow(config.timezone, options.now || new Date());
  const data = input && typeof input === 'object' ? input : {};
  const errors = {};
  const value = {};

  // --- name ---
  const name = typeof data.customer_name === 'string' ? cleanText(data.customer_name) : '';
  if (!name) errors.customer_name = 'Please enter your name.';
  else if (name.length < 2) errors.customer_name = 'Name must be at least 2 characters.';
  else if (name.length > 100) errors.customer_name = 'Name must be 100 characters or fewer.';
  else if (!NAME_RE.test(name)) {
    errors.customer_name = 'Name can only contain letters, spaces, apostrophes, periods and hyphens.';
  } else value.customer_name = name;

  // --- phone ---
  const phone = typeof data.phone === 'string' ? cleanText(data.phone) : '';
  const phoneDigits = phone.replace(/\D/g, '');
  if (!phone) errors.phone = 'Please enter a contact number.';
  else if (!PHONE_RE.test(phone) || phone.length > 20) {
    errors.phone = 'Contact number can only contain digits, spaces, + - ( ) and be at most 20 characters.';
  } else if (phoneDigits.length < 7 || phoneDigits.length > 15) {
    errors.phone = 'Contact number must have between 7 and 15 digits.';
  } else value.phone = phone;

  // --- email (optional) ---
  const rawEmail = typeof data.email === 'string' ? cleanText(data.email) : '';
  if (data.email !== undefined && data.email !== null && typeof data.email !== 'string') {
    errors.email = 'Email must be text.';
  } else if (rawEmail === '') {
    value.email = null;
  } else if (rawEmail.length > 254 || !EMAIL_RE.test(rawEmail)) {
    errors.email = 'Please enter a valid email address or leave it blank.';
  } else value.email = rawEmail.toLowerCase();

  // --- branch ---
  const branch = config.branches.find((b) => b.id === data.branch);
  if (!branch) errors.branch = 'Please choose a branch.';
  else value.branch = branch.id;

  // --- date ---
  const dateStr = typeof data.reservation_date === 'string' ? data.reservation_date.trim() : '';
  let dateOk = false;
  if (!dateStr) errors.reservation_date = 'Please choose a date.';
  else if (!isRealDate(dateStr)) errors.reservation_date = 'Please choose a valid date.';
  else if (!isAdmin && dateStr < cafeNow.date) errors.reservation_date = 'The date cannot be in the past.';
  else if (!isAdmin && dateStr > addDays(cafeNow.date, config.maxDaysAhead)) {
    errors.reservation_date = `Reservations can be requested up to ${config.maxDaysAhead} days ahead.`;
  } else {
    dateOk = true;
    value.reservation_date = dateStr;
  }

  // --- time ---
  const timeStr = typeof data.reservation_time === 'string' ? data.reservation_time.trim() : '';
  const timeMatch = TIME_RE.exec(timeStr);
  if (!timeStr) errors.reservation_time = 'Please choose a time.';
  else if (!timeMatch) errors.reservation_time = 'Please choose a valid time.';
  else {
    const hhmm = `${timeMatch[1]}:${timeMatch[2]}`;
    let timeOk = true;
    if (!isAdmin) {
      if (branch) {
        const slots = getSlotsForBranch(branch, config);
        if (!slots.includes(hhmm)) {
          errors.reservation_time = `That time is not available for ${branch.name}. Please pick one of the listed times.`;
          timeOk = false;
        }
      }
      if (
        timeOk && dateOk && dateStr === cafeNow.date &&
        timeToMinutes(hhmm) < cafeNow.minutes + config.minLeadMinutes
      ) {
        errors.reservation_time = 'That time is too soon. Please choose a later time or another date.';
        timeOk = false;
      }
    }
    if (timeOk) value.reservation_time = `${hhmm}:00`;
  }

  // --- guests ---
  const guestsRaw = typeof data.guests === 'string' ? data.guests.trim() : data.guests;
  const guests = typeof guestsRaw === 'number' ? guestsRaw : Number(guestsRaw);
  if (guestsRaw === undefined || guestsRaw === null || guestsRaw === '') {
    errors.guests = 'Please enter the number of guests.';
  } else if (typeof guestsRaw !== 'number' && typeof guestsRaw !== 'string') {
    errors.guests = 'Number of guests must be a whole number.';
  } else if (!Number.isInteger(guests)) {
    errors.guests = 'Number of guests must be a whole number.';
  } else if (guests < config.minGuests || guests > config.maxGuests) {
    errors.guests = `We take reservations for ${config.minGuests} to ${config.maxGuests} guests. For larger groups, please contact the cafe.`;
  } else value.guests = guests;

  // --- special requests (optional) ---
  if (data.special_requests !== undefined && data.special_requests !== null && typeof data.special_requests !== 'string') {
    errors.special_requests = 'Special requests must be text.';
  } else {
    const requests = cleanText(data.special_requests || '');
    if (requests.length > 500) errors.special_requests = 'Special requests must be 500 characters or fewer.';
    else value.special_requests = requests === '' ? null : requests;
  }

  // --- staff-only fields ---
  if (isAdmin) {
    if (!config.statuses.includes(data.status)) {
      errors.status = `Status must be one of: ${config.statuses.join(', ')}.`;
    } else value.status = data.status;

    if (data.admin_notes !== undefined && data.admin_notes !== null && typeof data.admin_notes !== 'string') {
      errors.admin_notes = 'Notes must be text.';
    } else {
      const notes = cleanText(data.admin_notes || '');
      if (notes.length > 1000) errors.admin_notes = 'Notes must be 1000 characters or fewer.';
      else value.admin_notes = notes === '' ? null : notes;
    }
  }

  const valid = Object.keys(errors).length === 0;
  return { valid, errors, value: valid ? value : undefined };
}

function validateStatus(status, config = defaultConfig) {
  return config.statuses.includes(status);
}

module.exports = {
  validateReservation,
  validateStatus,
  getCafeNow,
  getSlotsForBranch,
  isRealDate,
  addDays,
  timeToMinutes,
  minutesToTime,
};
