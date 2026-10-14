// Small security helpers used by server.js and the admin routes.

// Basic security headers on every response.
function securityHeaders(req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    // The page may only load its own files, plus Google Fonts.
    'Content-Security-Policy': [
      "default-src 'self'",
      "style-src 'self' https://fonts.googleapis.com",
      "font-src https://fonts.gstatic.com",
      "img-src 'self' data:",
      "script-src 'self'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "base-uri 'self'",
    ].join('; '),
  });
  next();
}

// Extra protection against cross-site request forgery for staff actions.
// Our own admin page always sends this header with fetch(); a form posted
// from another website cannot add it. (The login cookie is also SameSite=Strict.)
function requireCsrfHeader(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('X-Requested-With') !== 'fetch') {
    return res.status(403).json({ error: 'Request blocked: missing security header.' });
  }
  next();
}

module.exports = { securityHeaders, requireCsrfHeader };
