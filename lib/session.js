'use strict';
// Sessions. Supabase Auth issues a short-lived access token (JWT) and a refresh token.
// We keep both in HttpOnly cookies, so page JavaScript can never read them (protects against XSS theft).
// The access token is verified by Supabase itself: we use it to call the database, and the database
// refuses forged or expired tokens. Our own code never has to trust a token's contents.

const { ApiError, parseCookies, setCookies } = require('./http');
const supa = require('./supa');

const AT = 'sb_at';
const RT = 'sb_rt';
const THIRTY_DAYS = 60 * 60 * 24 * 30;

function decodeJwt(token) {
  try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')); } catch (e) { return null; }
}

function storeSession(req, res, s) {
  setCookies(req, res, [
    { name: AT, value: s.access_token, maxAge: Math.max(60, Number(s.expires_in) || 3600) },
    { name: RT, value: s.refresh_token, maxAge: THIRTY_DAYS },
  ]);
}

function clearSession(req, res) {
  setCookies(req, res, [{ name: AT, value: '', maxAge: 0 }, { name: RT, value: '', maxAge: 0 }]);
}

async function refresh(req, res, refreshToken) {
  const r = await supa.authCall('/token?grant_type=refresh_token', { body: { refresh_token: refreshToken } });
  if (r.status !== 200 || !r.data || !r.data.access_token) { clearSession(req, res); return null; }
  storeSession(req, res, r.data);
  return r.data.access_token;
}

/** The profile row of the token's owner. RLS only returns it when the token is genuine. */
async function loadProfile(token) {
  const claims = decodeJwt(token);
  if (!claims || !claims.sub || !/^[0-9a-f-]{36}$/i.test(claims.sub)) return null;
  const r = await supa.rest(`profiles?select=id,full_name,email,phone,role&id=eq.${claims.sub}`, { token });
  if (r.status === 200 && Array.isArray(r.data) && r.data[0]) return r.data[0];
  return null;
}

/** { token, user } for the signed-in person, or null. Silently renews an expired access token. */
async function getSession(req, res) {
  const cookies = parseCookies(req);
  let token = cookies[AT] || '';
  const rt = cookies[RT] || '';
  const claims = token ? decodeJwt(token) : null;
  const fresh = claims && claims.exp && claims.exp * 1000 > Date.now() + 15000;
  if (!fresh) {
    if (!rt) return null;
    token = await refresh(req, res, rt);
    if (!token) return null;
  }
  let user = await loadProfile(token);
  if (!user && fresh && rt) {   // the token looked fine but was rejected: try once with a renewed one
    token = await refresh(req, res, rt);
    user = token ? await loadProfile(token) : null;
  }
  return user ? { token, user } : null;
}

async function requireUser(req, res) {
  const s = await getSession(req, res);
  if (!s) throw new ApiError(401, 'Please sign in first.', { code: 'not_signed_in' });
  return s;
}
async function requireCustomer(req, res) {
  const s = await requireUser(req, res);
  if (s.user.role !== 'customer') throw new ApiError(403, 'Only customer accounts can do this.');
  return s;
}
async function requireStaff(req, res) {
  const s = await requireUser(req, res);
  if (s.user.role !== 'staff') throw new ApiError(403, 'Staff only.', { code: 'staff_only' });
  return s;
}

module.exports = { getSession, requireUser, requireCustomer, requireStaff, storeSession, clearSession };
