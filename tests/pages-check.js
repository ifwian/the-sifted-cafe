'use strict';
// Browser smoke test: every page loads without JS errors / missing local files, and the staff page works (API mocked).
const http = require('http'); const fs = require('fs'); const path = require('path');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..', 'public');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); fs.readFile(f, (e, d) => { if (e) { r.statusCode = 404; return r.end(); } r.setHeader('Content-Type', types[path.extname(f)] || 'application/octet-stream'); r.end(d); }); });
let fails = 0; const check = (n, c, x = '') => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' ' + x)); if (!c) fails++; };
const row = { id: 7, reference: 'SC-00007', user_id: 'u', branch: 'calamba', branch_name: 'Calamba', reservation_date: '2026-11-20', reservation_time: '12:00', guests: 4, occasion: null, special_requests: null, status: 'pending', admin_notes: null, created_at: '2026-11-15T02:00:00Z', updated_at: '2026-11-15T02:00:00Z', archived_at: null, customer_name: 'Alice Cruz', phone: '0917', email: 'a@t.ph', payment_option: 'downpayment', total_amount: 800, amount_due: 240, balance: 560, payment_reference: '123456', proof_name: 'p.png', has_proof: true, payment_status: 'proof_submitted' };
(async () => {
  await new Promise((r) => srv.listen(0, r)); const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch();
  for (const p of fs.readdirSync(root).filter((f) => f.endsWith('.html'))) {
    const page = await browser.newPage(); const bad = [];
    page.on('pageerror', (e) => bad.push(e.message));
    page.on('response', (r) => { if (r.url().startsWith(base) && r.status() >= 400 && !r.url().includes('/api/')) bad.push(r.status() + ' ' + r.url().replace(base, '')); });
    await page.route('**/api/**', (r) => r.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"x"}' }));
    await page.route(/fonts\.(googleapis|gstatic)|unpkg|openstreetmap/, (r) => r.abort());
    await page.goto(base + '/' + p); await page.waitForTimeout(400);
    const links = await page.$$eval('a[href]', (a) => a.map((x) => x.getAttribute('href')).filter((h) => h && !/^(https?:|mailto:|tel:|#|javascript:)/.test(h)).map((h) => h.split('#')[0].split('?')[0]).filter(Boolean));
    const missing = [...new Set(links)].filter((l) => !fs.existsSync(path.join(root, l)));
    check(`${p}: loads, no JS errors, no missing assets/links`, bad.length === 0 && missing.length === 0, JSON.stringify({ bad, missing }));
    await page.close();
  }
  // staff page
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }); const errs = []; const actions = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
  await page.route('**/api/**', (route) => { const u = new URL(route.request().url()); const j = (s, b) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });
    if (u.pathname === '/api/customer/me') return j(200, { customer: { id: 's', full_name: 'Sam Staff', role: 'staff' } });
    if (u.pathname === '/api/staff/reservations') return j(200, { reservations: [row], counts: { pending: 1, confirmed: 0, cancelled: 0, completed: 0, today: 0, proofs_to_check: 1, archived: 0 }, today: '2026-11-15', duration_hours: 2 });
    if (u.pathname === '/api/staff/reservations/7') return j(200, { reservation: row, duration_hours: 2 });
    if (u.pathname === '/api/staff/reservations/7/action') { actions.push(JSON.parse(route.request().postData())); return j(200, { ok: true, message: 'Reservation SC-00007 payment was marked as verified.' }); }
    return j(404, {}); });
  await page.goto(base + '/staff.html'); await page.waitForSelector('#rows tr');
  check('staff: reservation row rendered from API', /Alice Cruz/.test(await page.textContent('#rows')));
  check('staff: Confirm hidden until payment verified', !(await page.textContent('#rows')).includes('Confirm'));
  await page.click('[data-view="7"]'); await page.waitForSelector('#detail-modal[open] .sd-detail');
  check('staff: detail window shows proof link', await page.isVisible('a[href="/api/staff/reservations/7/proof"]'));
  await page.click('#detail-modal [data-act="verify"]'); await page.waitForSelector('#confirm-modal[open]'); await page.click('#confirm-submit'); await page.waitForTimeout(600);
  check('staff: verify sends the right action to the API', actions.length === 1 && actions[0].action === 'verify', JSON.stringify(actions));
  check('staff: no JS errors', errs.length === 0, errs.join('|'));
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(200);
  check('staff mobile: no horizontal scroll', !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)));
  await browser.close(); srv.close(); console.log(fails ? `\n${fails} FAILED` : '\nALL PAGE CHECKS PASSED'); process.exit(fails ? 1 : 0);
})();
