'use strict';
// Single Vercel Function entry point used by the website.
//
// Vercel only matches one path segment for this project's API functions, so
// nested endpoints cannot be reached as /api/customer/me directly. The front
// end sends them here as /api/router?__path=customer/me, and this file rebuilds
// the original URL before handing it to the normal router in lib/routes.js.
const { handle } = require('../lib/routes');

module.exports = (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const originalPath = url.searchParams.get('__path');

  if (originalPath) {
    url.searchParams.delete('__path');
    const query = url.searchParams.toString();
    const cleanPath = originalPath.replace(/^\/+/, '');
    req.url = '/api/' + cleanPath + (query ? '?' + query : '');
  }

  return handle(req, res);
};
