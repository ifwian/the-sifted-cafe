'use strict';
// A tiny Supabase client written with plain fetch (no npm packages needed).
//   anon key         -> public config reads and sign-in/sign-up (it is public by design)
//   user's JWT       -> every database call a signed-in person makes, so Row Level Security applies
//   service role key -> ONLY for private Storage (payment proofs). It never leaves the server.

const { ApiError } = require('./http');

const BUCKET = 'payment-proofs';

function env(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`[config] Missing environment variable ${name}`);
    throw new ApiError(500, 'The server is not configured yet. Please contact the cafe.', { code: 'missing_env' });
  }
  return v.replace(/\/+$/, '');
}
const baseUrl = () => env('SUPABASE_URL');

async function call(url, options = {}, timeoutMs = 10000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctl.signal });
  } catch (e) {
    console.error('[supabase] request failed:', e.name, String(url).split('?')[0]);
    throw new ApiError(503, 'We could not reach the database. Please try again in a moment.', { code: 'upstream_unreachable' });
  } finally {
    clearTimeout(timer);
  }
}

async function jsonOf(res) {
  const text = await res.text();
  try { return text ? JSON.parse(text) : null; } catch (e) { return { raw: text }; }
}

// ---------- Auth (GoTrue) ----------
async function authCall(path, { method = 'POST', body, token } = {}) {
  const anon = env('SUPABASE_ANON_KEY');
  const res = await call(`${baseUrl()}/auth/v1${path}`, {
    method,
    headers: { apikey: anon, Authorization: `Bearer ${token || anon}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: await jsonOf(res) };
}

// ---------- Database (PostgREST) ----------
/** GET/POST on /rest/v1. `token` = the user's JWT (RLS applies) or null for anonymous reads. */
async function rest(path, { method = 'GET', token, body, headers = {} } = {}) {
  const anon = env('SUPABASE_ANON_KEY');
  const res = await call(`${baseUrl()}/rest/v1/${path}`, {
    method,
    headers: { apikey: anon, Authorization: `Bearer ${token || anon}`, 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: await jsonOf(res) };
}
const rpc = (name, args, token) => rest(`rpc/${name}`, { method: 'POST', token, body: args || {} });

// ---------- Storage (service role, private bucket) ----------
async function storage(path, { method = 'GET', body, headers = {} } = {}) {
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  return call(`${baseUrl()}/storage/v1/${path}`, {
    method,
    headers: { apikey: key, Authorization: `Bearer ${key}`, ...headers },
    body,
  }, 15000);
}

/** One-time upload URL the browser can PUT the file to. Returns a full URL. */
async function createUploadUrl(objectPath) {
  const res = await storage(`object/upload/sign/${BUCKET}/${objectPath}`, { method: 'POST', headers: { 'x-upsert': 'false' } });
  const data = await jsonOf(res);
  if (!res.ok || !data || !data.url) {
    console.error('[storage] could not create upload URL', res.status);
    throw new ApiError(502, 'Could not prepare the upload. Please try again.');
  }
  return `${baseUrl()}/storage/v1${data.url}`;
}

/** The stored file's bytes (or null if it does not exist). */
async function downloadObject(objectPath) {
  const res = await storage(`object/${BUCKET}/${objectPath}`);
  if (!res.ok) return null;
  return Buffer.from(await res.arrayBuffer());
}

async function deleteObject(objectPath) {
  if (!objectPath) return;
  try { await storage(`object/${BUCKET}/${objectPath}`, { method: 'DELETE' }); }
  catch (e) { console.error('[storage] delete failed (ignored)'); }
}

/** A link that opens a private file for `seconds` seconds. */
async function signedReadUrl(objectPath, seconds = 60) {
  const res = await storage(`object/sign/${BUCKET}/${objectPath}`, {
    method: 'POST', body: JSON.stringify({ expiresIn: seconds }), headers: { 'Content-Type': 'application/json' },
  });
  const data = await jsonOf(res);
  if (!res.ok || !data || !data.signedURL) return null;
  return `${baseUrl()}/storage/v1${data.signedURL}`;
}

module.exports = { authCall, rest, rpc, createUploadUrl, downloadObject, deleteObject, signedReadUrl, BUCKET };
