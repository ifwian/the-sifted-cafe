'use strict';
// LOCAL TEST ONLY. A tiny stand-in for Supabase (GoTrue + PostgREST + Storage) that runs the REAL schema.sql
// on a local PostgreSQL, so tests exercise the Node API end to end (including RLS and the booking functions).
// It understands only the handful of REST calls our API makes. It is NOT part of the deployed app.
const http = require('http');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

function psql(db, sql) {
  const r = spawnSync('runuser', ['-u', 'postgres', '--', 'psql', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-d', db, '-c', sql], { encoding: 'utf8' });
  return r;
}
const lit = (v) => (v === null || v === undefined ? 'null' : typeof v === 'number' ? String(v) : `$q$${String(v)}$q$`);

function start(db) {
  const users = new Map();     // email -> { id, password }
  const tokens = new Map();    // access token -> sub
  const refresh = new Map();   // refresh token -> sub
  const files = new Map();     // storage path -> Buffer
  let port;

  const jwt = (sub) => {
    const t = 'h.' + Buffer.from(JSON.stringify({ sub, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated' })).toString('base64url') + '.s' + crypto.randomUUID();
    tokens.set(t, sub); return t;
  };
  const session = (sub) => {
    const rt = crypto.randomUUID(); refresh.set(rt, sub);
    return { access_token: jwt(sub), refresh_token: rt, expires_in: 3600, token_type: 'bearer', user: { id: sub } };
  };
  const subOf = (req) => tokens.get(String(req.headers.authorization || '').replace('Bearer ', ''));

  function asRole(sub, sql) {
    const pre = sub ? `set role authenticated; select set_config('request.jwt.claim.sub','${sub}',false);` : 'set role anon;';
    return psql(db, `${pre} ${sql}`);
  }
  function out(r) {
    if (r.status === 0) {
      const lines = r.stdout.split('\n').filter(Boolean);
      return { status: 200, body: lines.length ? lines[lines.length - 1] : 'null' };
    }
    const m = /ERROR:  (.*)/.exec(r.stderr) || [];
    const d = /DETAIL:  (.*)/.exec(r.stderr) || [];
    if (/permission denied|row-level security/i.test(r.stderr)) return { status: 403, body: JSON.stringify({ code: '42501', message: m[1] }) };
    return { status: 400, body: JSON.stringify({ code: 'P0001', message: m[1], details: d[1] || null }) };
  }

  // very small PostgREST query translator for SELECT on tables/views
  function select(sub, table, q) {
    const where = []; let order = ''; let limit = '';
    for (const [k, val] of q.entries()) {
      if (k === 'select') continue;
      if (k === 'order') { order = ' order by ' + val.split(',').map((x) => x.replace('.', ' ')).join(', '); continue; }
      if (k === 'limit') { limit = ' limit ' + Number(val); continue; }
      if (k === 'or') {
        const parts = val.slice(1, -1).split(',').map((x) => { const [c, , ...rest] = x.split('.'); return `${c} ilike ${lit(rest.join('.').replace(/\*/g, '%'))}`; });
        where.push('(' + parts.join(' or ') + ')'); continue;
      }
      if (val === 'is.null') where.push(`${k} is null`);
      else if (val === 'not.is.null') where.push(`${k} is not null`);
      else if (val.startsWith('eq.')) where.push(`${k} = ${lit(val.slice(3))}`);
    }
    const sql = `select coalesce(jsonb_agg(t), '[]'::jsonb) from (select * from public.${table}${where.length ? ' where ' + where.join(' and ') : ''}${order}${limit}) t`;
    return out(asRole(sub, sql));
  }

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      const url = new URL(req.url, 'http://x');
      const p = url.pathname;
      const json = () => { try { return JSON.parse(raw.toString() || '{}'); } catch (e) { return {}; } };
      const reply = (status, body) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };

      if (p === '/auth/v1/signup') {
        const b = json();
        if (users.has(b.email)) return reply(422, { msg: 'User already registered' });
        const id = crypto.randomUUID();
        const r = psql(db, `insert into auth.users (id,email,raw_user_meta_data) values ('${id}', ${lit(b.email)}, ${lit(JSON.stringify(b.data))}::jsonb)`);
        if (r.status !== 0) return reply(500, { msg: 'db error' });
        users.set(b.email, { id, password: b.password });
        return reply(200, session(id));
      }
      if (p === '/auth/v1/token') {
        const b = json();
        if (url.searchParams.get('grant_type') === 'refresh_token') {
          const sub = refresh.get(b.refresh_token);
          return sub ? reply(200, session(sub)) : reply(400, { error_code: 'refresh_token_not_found' });
        }
        const u = users.get(b.email);
        return u && u.password === b.password ? reply(200, session(u.id)) : reply(400, { error_code: 'invalid_credentials' });
      }
      if (p === '/auth/v1/logout') return reply(204, '');
      if (p === '/auth/v1/recover') return reply(200, {});
      if (p === '/auth/v1/user' && req.method === 'PUT') return subOf(req) ? reply(200, {}) : reply(401, {});

      if (p.startsWith('/rest/v1/rpc/')) {
        const fn = p.split('/').pop();
        const sub = subOf(req);
        if (!sub) return reply(401, { code: 'PGRST301', message: 'JWT invalid' });
        const args = Object.entries(json()).map(([k, v]) => `${k} => ${lit(v)}`).join(', ');
        const sets = fn === 'slot_availability' ? `select coalesce(jsonb_agg(t),'[]'::jsonb) from public.${fn}(${args}) t` : `select to_jsonb(public.${fn}(${args}))`;
        const o = out(asRole(sub, sets));
        return reply(o.status, o.body);
      }
      if (p.startsWith('/rest/v1/')) {
        const table = p.split('/').pop();
        const o = select(subOf(req), table, url.searchParams);
        return reply(o.status, o.body);
      }

      // storage (service role)
      const m = /^\/storage\/v1\/object\/(upload\/sign|sign)?\/?payment-proofs\/(.+)$/.exec(p);
      if (p.startsWith('/storage/v1/')) {
        const key = (/payment-proofs\/(.+)$/.exec(p) || [])[1];
        if (/\/object\/upload\/sign\//.test(p) && req.method === 'POST') return reply(200, { url: `/object/upload/sign/payment-proofs/${key}?token=t` });
        if (/\/object\/upload\/sign\//.test(p) && req.method === 'PUT') { files.set(key, raw.slice(raw.indexOf('\r\n\r\n', raw.indexOf('name=""')) + 4, raw.lastIndexOf('\r\n--'))); return reply(200, { Key: key }); }
        if (/\/object\/sign\//.test(p)) return files.has(key) ? reply(200, { signedURL: `/object/sign/payment-proofs/${key}?token=t` }) : reply(404, {});
        if (req.method === 'GET') return files.has(key) ? (res.end(files.get(key))) : reply(404, {});
        if (req.method === 'DELETE') { files.delete(key); return reply(200, {}); }
      }
      reply(404, { message: 'mock: not found ' + p });
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    port = server.address().port;
    resolve({ url: `http://127.0.0.1:${port}`, files, close: () => server.close() });
  }));
}
module.exports = { start, psql };
