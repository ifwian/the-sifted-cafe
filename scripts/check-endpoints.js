// Checks that every API call made by the browser code (public/js/*.js) matches
// a route that really exists on the server (server/**). It only reads files:
// no server or database is needed.
//
//   npm run check

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

// ---- 1. Routes defined on the server ----
function readFile(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

const serverSource = readFile('server/server.js');
const routes = new Set();

// app.get('/api/config', ...)  (routes defined directly in server.js)
for (const m of serverSource.matchAll(/app\.(get|post|put|patch|delete)\(\s*'(\/api[^']*)'/g)) {
  routes.add(`${m[1].toUpperCase()} ${m[2]}`);
}

// app.use('/api/auth', authRoutes) + const authRoutes = require('./routes/auth')
const requires = {};
for (const m of serverSource.matchAll(/const (\w+) = require\('\.\/routes\/([\w-]+)'\)/g)) requires[m[1]] = m[2];
for (const m of serverSource.matchAll(/app\.use\(\s*'(\/api\/[\w-]+)'\s*,\s*(\w+)\s*\)/g)) {
  const file = requires[m[2]];
  if (!file) continue;
  const source = readFile(`server/routes/${file}.js`);
  for (const r of source.matchAll(/router\.(get|post|put|patch|delete)\(\s*'([^']*)'/g)) {
    routes.add(`${r[1].toUpperCase()} ${m[1]}${r[2] === '/' ? '' : r[2]}`);
  }
}

const normalise = (p) => p.replace(/\$\{[^}]+\}/g, ':param').replace(/:\w+/g, ':param').split('?')[0];

// ---- 2. Calls made by the browser code ----
const jsDir = path.join(root, 'public', 'js');
const calls = [];
for (const file of fs.readdirSync(jsDir).filter((f) => f.endsWith('.js'))) {
  const source = fs.readFileSync(path.join(jsDir, file), 'utf8');
  for (const m of source.matchAll(/(?:apiRequest|adminRequest)\(\s*'(GET|POST|PUT|PATCH|DELETE)'\s*,\s*([`'"])(\/api[^`'"]*)\2/g)) {
    calls.push({ file, method: m[1], path: m[3] });
  }
}

// ---- 3. Compare ----
const known = new Set([...routes].map((r) => { const [method, p] = r.split(' '); return `${method} ${normalise(p)}`; }));
let missing = 0;
for (const c of calls) {
  const key = `${c.method} ${normalise(c.path)}`;
  const ok = known.has(key);
  if (!ok) missing += 1;
  console.log(`${ok ? 'OK     ' : 'MISSING'} ${c.method.padEnd(6)} ${c.path}   (${c.file})`);
}
const used = new Set(calls.map((c) => `${c.method} ${normalise(c.path)}`));
const unused = [...known].filter((k) => !used.has(k));

console.log(`\n${calls.length} browser calls checked against ${known.size} server routes.`);
if (unused.length) console.log(`Server routes not called by the browser code: ${unused.join(', ')}`);
if (missing > 0) {
  console.error(`\nFAILED: ${missing} call(s) have no matching server route.`);
  process.exit(1);
}
console.log('PASSED: every browser call matches a server route.');
