'use strict';
// Local development server: serves public/ and forwards /api/* to the real Vercel function.
//   npm run dev   ->   http://localhost:3000
// Environment variables are loaded from .env and .env.local (both git-ignored).
// This file is for development only; production uses api/router.js on Vercel.

const http = require('http');
const fs = require('fs');
const path = require('path');
const apiHandler = require('../api/router.js');

const root = path.join(__dirname, '..', 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.woff2': 'font/woff2',
};

// Tiny .env loader: real OS environment variables always win, .env.local overrides .env.
const fileEnv = {};
for (const name of ['.env', '.env.local']) {
  const file = path.join(__dirname, '..', name);
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue;
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) fileEnv[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
for (const [key, value] of Object.entries(fileEnv)) {
  if (!(key in process.env)) process.env[key] = value;
}

const server = http.createServer((req, res) => {
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch {
    res.statusCode = 400;
    return res.end('Bad request');
  }

  // API requests go to the exact same handler Vercel uses.
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    return apiHandler(req, res);
  }

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    res.statusCode = 400;
    return res.end('Bad request');
  }
  if (pathname === '/') pathname = '/index.html';

  const file = path.resolve(root, '.' + pathname);
  if (!file.startsWith(root + path.sep)) {
    res.statusCode = 403;
    return res.end('Forbidden');
  }

  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.end('Not found');
    }
    res.setHeader('Content-Type', TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    fs.createReadStream(file).pipe(res);
  });
});

const port = Number(process.env.PORT) || 3000;
server.listen(port, () => {
  console.log(`The Sifted Cafe dev server running at http://localhost:${port}`);
  console.log('Press Ctrl+C to stop.');
});
