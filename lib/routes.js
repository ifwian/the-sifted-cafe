'use strict';
// All API routes. api/[...path].js sends every /api/* request here.
// Rule of thumb: this file checks WHO is asking and WHAT they sent; the database (schema.sql) enforces the business rules.

const crypto = require('crypto');
const { ApiError, send, redirect, csrfCheck, readJson } = require('./http');
const supa = require('./supa');
const session = require('./session');
const v = require('./validate');
const { manilaParts, slotStartMs, addDays } = require('./time');

// ---------------------------------------------------------------- database errors -> friendly messages
const DB_ERRORS = {
  not_signed_in: [401, 'Please sign in first.'],
  not_customer: [403, 'Only customer accounts can make reservations.'],
  forbidden: [403, 'Staff only.'],
  bad_branch: [400, 'Please choose a branch.', 'branch'],
  bad_guests: [400, 'That number of guests is not available online. For larger groups, please call or message the cafe.', 'guests'],
  bad_date: [400, 'Please choose a date.', 'reservation_date'],
  bad_time: [400, 'Please pick one of the listed times for this branch (every hour while open).', 'reservation_time'],
  too_soon: [400, v.ADVANCE_MESSAGE, 'reservation_date'],
  too_far: [400, 'That date is too far ahead. Please choose a nearer date.', 'reservation_date'],
  bad_option: [400, 'Please choose Downpayment or Full payment.', 'payment_option'],
  bad_reference: [400, 'The GCash reference number can only have digits (6 to 20).', 'payment_reference'],
  slot_full: [409, 'Sorry, that time is fully booked for this branch. Please choose another time or date.', 'reservation_time'],
  duplicate: [409, 'You already have an open request for this branch, date and time. Check My account before sending another one.', 'reservation_time'],
  not_found: [404, 'That reservation was not found.'],
  not_open: [409, 'This reservation is already closed and cannot be cancelled.'],
  already_started: [409, 'This reservation has already started and can no longer be cancelled online. Please contact the cafe directly.'],
  proof_locked: [409, 'A proof was already sent for this reservation and is waiting for staff.'],
  payment_not_verified: [409, 'Verify the payment first. A reservation can only be confirmed after its payment is verified.'],
  no_proof: [409, 'Only a payment with an uploaded proof can be verified or rejected.'],
  bad_transition: [409, 'That change is not allowed for the reservation in its current state.'],
  already_archived: [409, 'That reservation is already archived.'],
  not_finished: [409, 'Only completed or cancelled reservations can be archived. Complete or cancel it first.'],
  not_archived: [409, 'That reservation is not in the archive.'],
  bad_action: [400, 'Unknown action.'],
};
const FIELD_NAMES = { date: 'reservation_date', time: 'reservation_time' };

/** Turns a failed PostgREST answer into an ApiError (never leaks SQL details). */
function dbFail(r) {
  const body = r.data || {};
  if (r.status === 401 || (body.code && String(body.code).startsWith('PGRST3'))) {
    return new ApiError(401, 'Your session has expired. Please sign in again.', { code: 'session_expired' });
  }
  const known = DB_ERRORS[body.message];
  if (known) {
    const [status, message, field] = known;
    const f = FIELD_NAMES[body.details] || body.details || field;
    return new ApiError(status, message, field || f ? { errors: { [f || field]: message } } : {});
  }
  if (r.status === 403 || body.code === '42501') return new ApiError(403, 'You do not have permission to do that.');
  console.error('[database] unexpected error', r.status, body.code, body.message);
  return new ApiError(500, 'Something went wrong on our side. Please try again.');
}
function must(r) { if (r.status < 200 || r.status >= 300) throw dbFail(r); return r.data; }

// ---------------------------------------------------------------- cafe configuration (public, cached 60 s)
let configCache = { at: 0, value: null };
async function getConfig() {
  if (configCache.value && Date.now() - configCache.at < 60000) return configCache.value;
  const [b, s] = await Promise.all([
    supa.rest('branches?select=code,name,first_hour,last_hour,capacity&active=eq.true&order=name'),
    supa.rest('cafe_settings?select=key,value'),
  ]);
  const branches = must(b);
  const raw = Object.fromEntries(must(s).map((x) => [x.key, x.value]));
  const num = (k) => Number(raw[k]);
  const value = {
    branches,
    settings: {
      min_advance_hours: num('min_advance_hours'), max_days_ahead: num('max_days_ahead'), min_guests: num('min_guests'),
      duration_hours: num('duration_hours'), cancel_hours_before: num('cancel_hours_before'),
      reservation_fee: num('reservation_fee'), minimum_spend_per_guest: num('minimum_spend_per_guest'), downpayment_percent: num('downpayment_percent'),
    },
    gcash: { recipient: raw.gcash_recipient || '', note: raw.gcash_note || '' },
  };
  configCache = { at: Date.now(), value };
  return value;
}

// ---------------------------------------------------------------- shaping rows for the pages
const money = (x) => (x == null ? 0 : Number(x));

function shapeReservation(row, settings, forStaff) {
  const r = { ...row };
  r.total_amount = money(r.total_amount); r.amount_due = money(r.amount_due); r.balance = money(r.balance);
  r.payment_method = r.payment_method || 'gcash';
  r.payment_status = r.payment_status || 'unpaid';
  r.has_proof = !!r.has_proof;
  const start = slotStartMs(r.reservation_date, r.reservation_time);
  const open = r.status === 'pending' || r.status === 'confirmed';
  r.can_cancel = open && Date.now() < start;
  const deadline = start - settings.cancel_hours_before * 3600000;
  r.cancel_late = r.can_cancel && Date.now() > deadline;
  const dl = manilaParts(deadline);
  r.cancel_deadline = `${dl.date} ${dl.time}`;
  if (!forStaff) {
    r.phase = open && r.reservation_date >= manilaParts().date ? 'upcoming' : 'history';
    delete r.admin_notes; delete r.user_id; delete r.archived_at; delete r.verified_by_name; delete r.verified_at;
  }
  return r;
}

const publicUser = (u) => ({ id: u.id, full_name: u.full_name, email: u.email, phone: u.phone, role: u.role });

// ---------------------------------------------------------------- account routes
async function register(req, res) {
  const { values, errors } = v.validateRegister(await readJson(req));
  if (Object.keys(errors).length) throw new ApiError(400, 'Please fix the highlighted fields.', { errors });
  const r = await supa.authCall('/signup', {
    body: { email: values.email, password: values.password, data: { full_name: values.full_name, phone: values.phone } },
  });
  if (r.status === 422 || r.status === 400) {
    const msg = String((r.data && (r.data.msg || r.data.message || r.data.error_description)) || '');
    if (/already|registered/i.test(msg)) throw new ApiError(409, 'An account with this email already exists. Please log in.', { errors: { email: 'An account with this email already exists.' } });
    if (/password/i.test(msg)) throw new ApiError(400, 'Please choose a stronger password.', { errors: { password: 'Please choose a stronger password.' } });
    throw new ApiError(400, 'We could not create the account. Please check your details.');
  }
  if (r.status === 429) throw new ApiError(429, 'Too many sign-up attempts. Please wait a few minutes and try again.');
  if (r.status >= 300 || !r.data) { console.error('[auth] signup failed', r.status); throw new ApiError(502, 'We could not create the account right now. Please try again.'); }
  if (r.data.access_token) {   // email confirmation is OFF: signed in immediately
    session.storeSession(req, res, r.data);
    const user = await loadAfterLogin(r.data.access_token);
    return send(res, 201, { customer: publicUser(user) });
  }
  // A user object with NO identities means the email is already registered (Supabase hides this when confirmation is on).
  if (r.data.identities && r.data.identities.length === 0) throw new ApiError(409, 'An account with this email already exists. Please log in.', { errors: { email: 'An account with this email already exists.' } });
  return send(res, 201, { customer: null, needs_confirmation: true, message: 'Account created! Please check your email and click the confirmation link, then log in.' });
}

async function loadAfterLogin(token) {
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  const r = await supa.rest(`profiles?select=id,full_name,email,phone,role&id=eq.${claims.sub}`, { token });
  const row = must(r)[0];
  if (!row) throw new ApiError(500, 'Your account profile is missing. Please contact the cafe.');
  return row;
}

async function login(req, res) {
  const d = await readJson(req);
  const email = v.clean(d.email, 150).toLowerCase();
  const password = typeof d.password === 'string' ? d.password : '';
  if (!email || !password) throw new ApiError(400, 'Please enter your email and password.', { errors: { email: !email ? 'Please enter your email address.' : undefined, password: !password ? 'Please enter your password.' : undefined } });
  const r = await supa.authCall('/token?grant_type=password', { body: { email, password } });
  if (r.status === 429) throw new ApiError(429, 'Too many attempts. Please wait a few minutes and try again.');
  if (r.status !== 200 || !r.data.access_token) {
    if (r.data && r.data.error_code === 'email_not_confirmed') throw new ApiError(401, 'Please confirm your email first (check your inbox), then log in.');
    if (r.status >= 500) throw new ApiError(502, 'We could not sign you in right now. Please try again.');
    throw new ApiError(401, 'Incorrect email or password.');
  }
  session.storeSession(req, res, r.data);
  send(res, 200, { customer: publicUser(await loadAfterLogin(r.data.access_token)) });
}

async function logout(req, res) {
  const s = await session.getSession(req, res).catch(() => null);
  if (s) await supa.authCall('/logout', { token: s.token }).catch(() => null);
  session.clearSession(req, res);
  send(res, 200, { ok: true });
}

async function forgotPassword(req, res) {
  const email = v.clean((await readJson(req)).email, 150).toLowerCase();
  const msg = v.checkEmail(email);
  if (msg) throw new ApiError(400, msg, { errors: { email: msg } });
  const site = (process.env.SITE_URL || `https://${req.headers['x-forwarded-host'] || req.headers.host}`).replace(/\/+$/, '');
  await supa.authCall(`/recover?redirect_to=${encodeURIComponent(site + '/reset-password.html')}`, { body: { email } }).catch(() => null);
  // Same answer whether or not the email exists, so nobody can probe which emails have accounts.
  send(res, 200, { ok: true, message: 'If that email has an account, we sent a link to reset the password. Please check your inbox.' });
}

async function resetPassword(req, res) {
  const d = await readJson(req);
  const msg = v.checkPassword(d.password);
  if (msg) throw new ApiError(400, msg, { errors: { password: msg } });
  if (typeof d.access_token !== 'string' || d.access_token.split('.').length !== 3) throw new ApiError(400, 'This reset link is not valid. Please request a new one.');
  const r = await supa.authCall('/user', { method: 'PUT', token: d.access_token, body: { password: d.password } });
  if (r.status !== 200) {
    const same = r.data && r.data.error_code === 'same_password';
    throw new ApiError(400, same ? 'Please choose a password you have not used before.' : 'This reset link has expired. Please request a new one.');
  }
  send(res, 200, { ok: true });
}

// ---------------------------------------------------------------- reservation routes
async function config(req, res) {
  const c = await getConfig();
  const now = Date.now();
  send(res, 200, {
    server_now: new Date(now).toISOString(), manila_now: manilaParts(now), timezone: 'Asia/Manila',
    ...c.settings, branches: c.branches, gcash: c.gcash,
    proof: { max_bytes: v.MAX_PROOF_BYTES, types: Object.keys(v.PROOF_TYPES) },
  });
}

async function availability(req, res, url) {
  const { token } = await session.requireUser(req, res);
  const branch = url.searchParams.get('branch') || '';
  const date = url.searchParams.get('date') || '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^[a-z0-9_-]+$/.test(branch)) throw new ApiError(400, 'Choose a branch and a date.');
  const rows = must(await supa.rpc('slot_availability', { p_branch: branch, p_date: date }, token));
  send(res, 200, {
    seats_left: Object.fromEntries(rows.map((x) => [x.slot, x.seats_left])),
    bookable: Object.fromEntries(rows.map((x) => [x.slot, x.bookable])),
  });
}

async function quote(req, res) {
  await session.requireUser(req, res);
  const d = await readJson(req);
  const c = await getConfig();
  const branch = c.branches.find((b) => b.code === d.branch);
  const max = branch ? branch.capacity : Math.max(...c.branches.map((b) => b.capacity));
  const g = Number(d.guests);
  if (!Number.isInteger(g) || g < c.settings.min_guests || g > max) {
    const msg = `Online reservations are for ${c.settings.min_guests} to ${max} guests.`;
    throw new ApiError(400, msg, { errors: { guests: msg } });
  }
  send(res, 200, { quote: v.computeAmounts(g, c.settings) });
}

/** Step 1 of sending proof: the browser asks for a one-time upload link, then uploads straight to private storage. */
async function proofUrl(req, res) {
  const { user } = await session.requireCustomer(req, res);
  const p = v.validateProofRequest(await readJson(req));
  if (p.error) throw new ApiError(400, p.error, { errors: { payment_proof: p.error } });
  const path = `${user.id}/${crypto.randomUUID()}.${p.ext}`;
  send(res, 200, { upload_url: await supa.createUploadUrl(path), path, name: p.name });
}

/** Re-reads the uploaded file and checks its REAL type and size. Deletes it when it is not acceptable. */
async function checkUploadedProof(userId, path) {
  const mine = typeof path === 'string' && path.startsWith(userId + '/') && /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(png|jpg|pdf)$/.test(path);
  if (!mine) return 'Please attach your proof of payment.';
  const bytes = await supa.downloadObject(path);
  if (!bytes) return 'The proof of payment was not uploaded. Please attach it again.';
  const type = v.sniffType(bytes);
  if (!type || bytes.length > v.MAX_PROOF_BYTES || v.PROOF_TYPES[type] !== path.split('.').pop()) {
    await supa.deleteObject(path);
    return !type ? 'Proof of payment must be a PNG, JPG or PDF file.' : 'Proof of payment must be smaller than 3 MB.';
  }
  return '';
}

async function createReservation(req, res) {
  const { token, user } = await session.requireCustomer(req, res);
  const d = await readJson(req);
  if (v.clean(d.website, 50)) throw new ApiError(400, 'Something went wrong. Please try again.');   // bot trap
  const c = await getConfig();
  const { values, errors } = v.validateReservation(d, c);
  const proofPath = d.payment_proof_path;
  if (!errors.payment_proof) {
    const problem = await checkUploadedProof(user.id, proofPath);
    if (problem) errors.payment_proof = problem;
  }
  if (Object.keys(errors).length) {
    if (!errors.payment_proof || Object.keys(errors).length > 1) await supa.deleteObject(typeof proofPath === 'string' && proofPath.startsWith(user.id + '/') ? proofPath : '');
    throw new ApiError(400, 'Please fix the highlighted fields.', { errors });
  }
  const r = await supa.rpc('create_reservation', {
    p_branch: values.branch, p_date: values.reservation_date, p_time: values.reservation_time, p_guests: values.guests,
    p_occasion: values.occasion, p_requests: values.special_requests, p_payment_option: values.payment_option,
    p_reference: values.payment_reference, p_proof_path: proofPath, p_proof_name: v.clean(d.payment_proof_name, 150, true),
  }, token);
  if (r.status < 200 || r.status >= 300) {
    await supa.deleteObject(proofPath);   // do not leave an orphan file behind
    throw dbFail(r);
  }
  const rows = must(await supa.rest(`reservation_details?select=*&id=eq.${Number(r.data)}`, { token }));
  const made = shapeReservation(rows[0], c.settings, false);
  send(res, 201, {
    message: 'Your reservation request has been sent and is waiting for staff confirmation. It is NOT confirmed yet, and your GCash payment is not verified yet. Please wait for our team to contact you.',
    reservation: Object.fromEntries(['reference', 'customer_name', 'branch_name', 'reservation_date', 'reservation_time', 'guests', 'status',
      'payment_status', 'payment_option', 'payment_method', 'total_amount', 'amount_due', 'balance'].map((k) => [k, made[k]])),
  });
}

async function myReservations(req, res) {
  const { token, user } = await session.requireCustomer(req, res);
  const c = await getConfig();
  const rows = must(await supa.rest(
    `reservation_details?select=*&user_id=eq.${user.id}&order=reservation_date.desc,reservation_time.desc&limit=200`, { token }));
  send(res, 200, { reservations: rows.map((r) => shapeReservation(r, c.settings, false)) });
}

async function cancelMine(req, res, id) {
  const { token } = await session.requireCustomer(req, res);
  must(await supa.rpc('customer_cancel', { p_id: id }, token));
  send(res, 200, { ok: true, message: 'Your reservation was cancelled. If you paid a deposit, our staff will contact you about it according to the cancellation terms.' });
}

/** Re-send a proof for a reservation whose first proof was missing or rejected. */
async function resubmitProof(req, res, id) {
  const { token, user } = await session.requireCustomer(req, res);
  const d = await readJson(req);
  const problem = await checkUploadedProof(user.id, d.payment_proof_path);
  if (problem) throw new ApiError(400, problem, { errors: { payment_proof: problem } });
  const r = await supa.rpc('customer_submit_proof', { p_id: id, p_path: d.payment_proof_path, p_name: v.clean(d.payment_proof_name, 150, true), p_reference: v.clean(d.payment_reference, 20, true) }, token);
  if (r.status >= 300) { await supa.deleteObject(d.payment_proof_path); throw dbFail(r); }
  send(res, 200, { ok: true });
}

// ---------------------------------------------------------------- staff routes (the database re-checks the role on every action)
const STAFF_STATUS = ['pending', 'confirmed', 'cancelled', 'completed'];
const PAY_STATUS = ['unpaid', 'proof_submitted', 'verified', 'rejected'];

async function staffList(req, res, url) {
  const { token } = await session.requireStaff(req, res);
  const q = url.searchParams;
  const archive = q.get('view') === 'archive';
  const f = [`archived_at=${archive ? 'not.is.null' : 'is.null'}`];
  if (STAFF_STATUS.includes(q.get('status'))) f.push(`status=eq.${q.get('status')}`);
  if (PAY_STATUS.includes(q.get('payment'))) f.push(`payment_status=eq.${q.get('payment')}`);
  if (/^[a-z0-9_-]+$/.test(q.get('branch') || '')) f.push(`branch=eq.${q.get('branch')}`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(q.get('date') || '')) f.push(`reservation_date=eq.${q.get('date')}`);
  const term = String(q.get('q') || '').replace(/[^\p{L}\p{N}@.+\- ]/gu, '').trim().slice(0, 60);
  if (term) f.push(`or=(customer_name.ilike.*${term}*,phone.ilike.*${term}*,email.ilike.*${term}*)`);
  const order = archive ? 'archived_at.desc,id.desc' : 'reservation_date.asc,reservation_time.asc,id.asc';
  const [rows, all] = await Promise.all([
    supa.rest(`reservation_details?select=*&${f.join('&')}&order=${order}&limit=300`, { token }),
    supa.rest('reservation_details?select=status,payment_status,archived_at,reservation_date&limit=5000', { token }),
  ]);
  const c = await getConfig();
  const today = manilaParts().date;
  const counts = { pending: 0, confirmed: 0, cancelled: 0, completed: 0, today: 0, proofs_to_check: 0, archived: 0 };
  for (const x of must(all)) {
    if (x.archived_at) { counts.archived++; continue; }
    counts[x.status]++;
    const open = x.status === 'pending' || x.status === 'confirmed';
    if (open && x.reservation_date === today) counts.today++;
    if (open && x.payment_status === 'proof_submitted') counts.proofs_to_check++;
  }
  send(res, 200, { reservations: must(rows).map((r) => shapeReservation(r, c.settings, true)), counts, today, duration_hours: c.settings.duration_hours });
}

async function staffOne(req, res, id) {
  const { token } = await session.requireStaff(req, res);
  const rows = must(await supa.rest(`reservation_details?select=*&id=eq.${id}`, { token }));
  if (!rows[0]) throw new ApiError(404, 'That reservation was not found.');
  const c = await getConfig();
  send(res, 200, { reservation: shapeReservation(rows[0], c.settings, true), duration_hours: c.settings.duration_hours });
}

const ACTION_DONE = {
  confirm: 'is now confirmed.', complete: 'is now completed.', cancel: 'is now cancelled.', verify: 'payment was marked as verified.',
  reject_payment: 'payment proof was rejected. The customer can send a new one.', unverify: 'payment was set back to awaiting verification.',
  notes: 'notes saved.', archive: 'was moved to the Archive.', restore: 'was restored to the active list.', delete: 'was permanently deleted.',
};

async function staffAction(req, res, id) {
  const { token } = await session.requireStaff(req, res);
  const d = await readJson(req);
  const action = String(d.action || '');
  if (!ACTION_DONE[action]) throw new ApiError(400, 'Unknown action.');
  const r = await supa.rpc('staff_action', { p_id: id, p_action: action, p_text: v.clean(d.text, 500, true) }, token);
  const oldPath = must(r);
  if (action === 'delete' && oldPath) await supa.deleteObject(oldPath);   // remove the proof file too
  send(res, 200, { ok: true, message: `Reservation SC-${String(id).padStart(5, '0')} ${ACTION_DONE[action]}` });
}

async function staffProof(req, res, id) {
  const { token } = await session.requireStaff(req, res);
  const path = must(await supa.rpc('staff_proof_path', { p_id: id }, token));
  const link = path ? await supa.signedReadUrl(path, 60) : null;
  if (!link) throw new ApiError(404, 'No proof found.');
  redirect(res, link);   // a link that stops working after 60 seconds
}

// ---------------------------------------------------------------- router
const table = [
  ['GET', /^\/api\/config$/, config],
  ['POST', /^\/api\/customer\/register$/, register],
  ['POST', /^\/api\/customer\/login$/, login],
  ['POST', /^\/api\/customer\/logout$/, logout],
  ['POST', /^\/api\/customer\/forgot-password$/, forgotPassword],
  ['POST', /^\/api\/customer\/reset-password$/, resetPassword],
  ['GET', /^\/api\/customer\/me$/, async (req, res) => { const s = await session.requireUser(req, res); send(res, 200, { customer: publicUser(s.user) }); }],
  ['GET', /^\/api\/availability$/, availability],
  ['POST', /^\/api\/reservations\/quote$/, quote],
  ['POST', /^\/api\/uploads\/proof-url$/, proofUrl],
  ['POST', /^\/api\/reservations$/, createReservation],
  ['GET', /^\/api\/my\/reservations$/, myReservations],
  ['POST', /^\/api\/reservations\/(\d+)\/cancel$/, (rq, rs, u, m) => cancelMine(rq, rs, Number(m[1]))],
  ['POST', /^\/api\/reservations\/(\d+)\/proof$/, (rq, rs, u, m) => resubmitProof(rq, rs, Number(m[1]))],
  ['GET', /^\/api\/staff\/reservations$/, staffList],
  ['GET', /^\/api\/staff\/reservations\/(\d+)$/, (rq, rs, u, m) => staffOne(rq, rs, Number(m[1]))],
  ['POST', /^\/api\/staff\/reservations\/(\d+)\/action$/, (rq, rs, u, m) => staffAction(rq, rs, Number(m[1]))],
  ['GET', /^\/api\/staff\/reservations\/(\d+)\/proof$/, (rq, rs, u, m) => staffProof(rq, rs, Number(m[1]))],
];

async function handle(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname.replace(/\/+$/, '') || '/';
    let matchedPath = false;
    for (const [method, re, fn] of table) {
      const m = re.exec(path);
      if (!m) continue;
      matchedPath = true;
      if (method !== req.method) continue;
      csrfCheck(req);
      return await fn(req, res, url, m);
    }
    throw new ApiError(matchedPath ? 405 : 404, matchedPath ? 'Method not allowed.' : 'Not found.');
  } catch (e) {
    if (e instanceof ApiError) {
      return send(res, e.status, { error: e.message, ...e.extra, errors: cleanErrors(e.extra && e.extra.errors) });
    }
    console.error('[api] unexpected error:', e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e);
    send(res, 500, { error: 'Something went wrong on our side. Please try again.' });
  }
}
function cleanErrors(errors) {
  if (!errors) return undefined;
  const out = Object.fromEntries(Object.entries(errors).filter(([, m]) => m));
  return Object.keys(out).length ? out : undefined;
}

module.exports = { handle, dbFail, shapeReservation, getConfig, _resetConfigCache: () => { configCache = { at: 0, value: null }; } };
