// Shared helpers used by the website and the admin page.
// Loaded first, so main.js, reservation.js and admin.js can use these functions.

// An error that remembers the HTTP status and any per-field messages from the server.
class ApiError extends Error {
  constructor(status, message, fieldErrors) {
    super(message);
    this.status = status;           // 0 means "could not reach the server"
    this.fieldErrors = fieldErrors || {};
  }
}

// Sends a request to our Express server and returns the parsed JSON.
//   apiRequest('GET', '/api/config')
//   apiRequest('POST', '/api/reservations', { ...data })
// It throws an ApiError when the server answers with an error status.
async function apiRequest(method, path, body) {
  const options = {
    method,
    headers: { Accept: 'application/json', 'X-Requested-With': 'fetch' },
    credentials: 'same-origin', // send the admin login cookie
  };
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(path, options);
  } catch (networkError) {
    throw new ApiError(0, 'Could not reach the server.');
  }

  let data = null;
  try {
    data = await response.json();
  } catch (parseError) {
    // The server did not send JSON (for example an HTML error page).
  }

  if (!response.ok) {
    throw new ApiError(response.status, (data && data.error) || 'Something went wrong.', data && data.errors);
  }
  return data;
}

// The reservation rules come from the server (server/config.js). Fetched once and reused.
let configPromise = null;
function getConfig() {
  if (!configPromise) {
    configPromise = apiRequest('GET', '/api/config').catch((error) => {
      configPromise = null; // allow a retry next time
      throw error;
    });
  }
  return configPromise;
}

// ---------- date and time helpers ----------

// '14:30' -> '2:30 PM'
function formatTime12(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${suffix}`;
}

// '2026-10-20' -> 'Tuesday, October 20, 2026'
function formatDateLong(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

function timeToMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(total) {
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

// Today's date and the current time at the cafe (in the cafe's time zone).
function getCafeNow(timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type).value;
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// Every request time a branch offers, e.g. ['09:00', '09:30', ...].
function getSlotsForBranch(branch, config) {
  const slots = [];
  const last = timeToMinutes(branch.close) - config.lastBookingBeforeCloseMinutes;
  for (let t = timeToMinutes(branch.open); t <= last; t += config.slotMinutes) slots.push(minutesToTime(t));
  return slots;
}
