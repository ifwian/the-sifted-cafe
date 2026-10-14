// Helpers for the admin login session. Pure functions (no database, no Express)
// so they can be unit tested.
//
// How sessions work here:
//  1. After a correct password, the server makes a random token and sends it
//     to the browser in an HttpOnly cookie (JavaScript on the page cannot read it).
//  2. The database stores only the SHA-256 HASH of that token.
//  3. On every admin request the server hashes the cookie value and looks it up.

const crypto = require('crypto');

const COOKIE_NAME = 'sifted_admin';

function generateToken() {
  return crypto.randomBytes(32).toString('hex'); // 64 hex characters
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

// Turns the "Cookie" request header into a plain object.
function parseCookies(header) {
  const cookies = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const val = part.slice(index + 1).trim();
    if (!key) continue;
    try {
      cookies[key] = decodeURIComponent(val);
    } catch {
      cookies[key] = val;
    }
  }
  return cookies;
}

function buildSessionCookie(token, { maxAgeSeconds, secure }) {
  const flags = [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (secure) flags.push('Secure');
  return flags.join('; ');
}

function buildClearCookie({ secure }) {
  const flags = [`${COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0'];
  if (secure) flags.push('Secure');
  return flags.join('; ');
}

function getSessionHours() {
  const hours = Number(process.env.SESSION_HOURS);
  return Number.isFinite(hours) && hours > 0 && hours <= 72 ? hours : 8;
}

module.exports = {
  COOKIE_NAME,
  generateToken,
  hashToken,
  parseCookies,
  buildSessionCookie,
  buildClearCookie,
  getSessionHours,
};
