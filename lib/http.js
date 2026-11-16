'use strict';
// HTTP helpers: JSON answers, errors, cookies, CSRF check, request body.

class ApiError extends Error {
  /** @param {number} status HTTP status  @param {string} message safe text for the user  @param {object} [extra] e.g. { errors: {field: 'text'}, code: '...' } */
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

function send(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(data));
}

function redirect(res, url) {
  res.statusCode = 302;
  res.setHeader('Location', url);
  res.setHeader('Cache-Control', 'no-store');
  res.end();
}

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function isHttps(req) {
  return String(req.headers['x-forwarded-proto'] || '').split(',')[0] === 'https';
}

/** Adds Set-Cookie headers. Cookies are HttpOnly (JavaScript cannot read them) and SameSite=Lax. */
function setCookies(req, res, cookies) {
  const secure = isHttps(req) ? '; Secure' : '';
  const list = cookies.map(({ name, value, maxAge }) =>
    `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`);
  const existing = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', (Array.isArray(existing) ? existing : existing ? [existing] : []).concat(list));
}

/**
 * CSRF protection for every request that changes data.
 * Our own pages always send "X-Requested-With: fetch"; another website cannot add that header
 * to a cross-site request. We also require the Origin (when sent) to be this same site.
 */
function csrfCheck(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return;
  if (req.headers['x-requested-with'] !== 'fetch') throw new ApiError(403, 'Request blocked (missing security header).');
  const origin = req.headers.origin;
  if (origin) {
    let host = '';
    try { host = new URL(origin).host; } catch (e) { host = ''; }
    const mine = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    if (host.toLowerCase() !== mine.toLowerCase()) throw new ApiError(403, 'Request blocked (wrong origin).');
  }
}

/** The JSON body as an object (Vercel parses it already; otherwise read it, max 64 KB). */
async function readJson(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body || '{}'); } catch (e) { throw new ApiError(400, 'The request was not valid JSON.'); }
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 65536) throw new ApiError(413, 'The request is too large.');
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { throw new ApiError(400, 'The request was not valid JSON.'); }
}

module.exports = { ApiError, send, redirect, parseCookies, setCookies, csrfCheck, readJson };
