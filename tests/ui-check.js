'use strict';
// Browser check of the reservation form (needs Playwright + Chromium). The API is mocked, so this tests the PAGE only.
// Usage: node tests/ui-check.js   (starts its own static server for ./public)
const http = require('http'); const fs = require('fs'); const path = require('path');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..', 'public');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); fs.readFile(f, (e, d) => { if (e) { r.statusCode = 404; return r.end(); } r.setHeader('Content-Type', types[path.extname(f)] || 'application/octet-stream'); r.end(d); }); });
let fails = 0; const check = (name, cond, extra = '') => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : ' ' + extra)); if (!cond) fails++; };

(async () => {
  await new Promise((r) => srv.listen(0, r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch();
  for (const [label, viewport] of [['desktop', { width: 1280, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
    const page = await browser.newPage({ viewport });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    const posts = [];
    const json = (route, status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    await page.route('**/api/**', async (route) => {
      const u = new URL(route.request().url()); const m = route.request().method();
      if (u.pathname === '/api/customer/me') return json(route, 200, { customer: { id: 'u1', full_name: 'Alice Cruz', email: 'alice@test.ph', phone: '09171234567', role: 'customer' } });
      if (u.pathname === '/api/config') return json(route, 200, { server_now: '2026-11-15T10:20:00+08:00', min_advance_hours: 24, max_days_ahead: 60, min_guests: 2, duration_hours: 2, cancel_hours_before: 24,
        branches: [{ code: 'calamba', name: 'Calamba', first_hour: 10, last_hour: 21, capacity: 20 }, { code: 'cabuyao', name: 'Cabuyao', first_hour: 9, last_hour: 20, capacity: 30 }], gcash: { recipient: 'RO****O N.', note: '' } });
      if (u.pathname === '/api/my/reservations') return json(route, 200, { reservations: [] });
      if (u.pathname === '/api/availability') { const s = {}; for (let h = 9; h <= 21; h++) s[String(h).padStart(2, '0') + ':00'] = 20; return json(route, 200, { seats_left: s, bookable: {} }); }
      if (u.pathname === '/api/reservations/quote') { const g = JSON.parse(route.request().postData()).guests; const t = g * 200; const d = Math.ceil(t * 0.3); return json(route, 200, { quote: { guests: g, reservation_fee: 0, minimum_spend_per_guest: 200, minimum_spend: t, total_amount: t, downpayment_percent: 30, duration_hours: 2, options: { downpayment: { amount_due: d, balance: t - d }, full: { amount_due: t, balance: 0 } } } }); }
      if (u.pathname === '/api/uploads/proof-url') return json(route, 200, { upload_url: base + '/__upload', path: 'u1/x.png', name: 'proof.png' });
      if (u.pathname === '/api/reservations' && m === 'POST') { posts.push(JSON.parse(route.request().postData())); await new Promise((r) => setTimeout(r, 400));
        return json(route, 201, { message: 'Sent', reservation: { reference: 'SC-00001', customer_name: 'Alice Cruz', branch_name: 'Calamba', reservation_date: posts[0].reservation_date, reservation_time: posts[0].reservation_time, guests: 4, status: 'pending', payment_status: 'proof_submitted', payment_option: 'downpayment', payment_method: 'gcash', total_amount: 800, amount_due: 240, balance: 560 } }); }
      return json(route, 404, { error: 'unmocked ' + u.pathname });
    });
    await page.route('**/__upload', (route) => route.fulfill({ status: 200, body: '{}' }));
    await page.goto(base + '/account.html#reserve');
    await page.waitForSelector('#res-accept');
    await page.check('#res-accept');
    check(`${label}: form appears after accepting terms`, await page.isVisible('#form-card'));
    await page.waitForFunction(() => document.querySelectorAll('#res-branch option').length > 2);
    check(`${label}: name/phone/email prefilled from account`, (await page.inputValue('#res-name')) === 'Alice Cruz');
    await page.selectOption('#res-branch', 'calamba');
    check(`${label}: date picker min = 2026-11-16 (>=24h after 15 Nov 10:20)`, (await page.getAttribute('#res-date', 'min')) === '2026-11-16', await page.getAttribute('#res-date', 'min'));
    await page.fill('#res-date', '2026-11-16');
    await page.dispatchEvent('#res-date', 'change');
    const opts = await page.$$eval('#res-time option', (o) => o.map((x) => [x.value, x.disabled]));
    check(`${label}: 10:00 on 16 Nov is blocked (<24h), 11:00 allowed`, opts.find((o) => o[0] === '10:00')?.[1] === true && opts.find((o) => o[0] === '11:00')?.[1] === false, JSON.stringify(opts));
    check(`${label}: 24h explanation visible`, /at least 24 hours in advance/.test(await page.textContent('#date-hint')));
    await page.fill('#res-date', '2026-11-18'); await page.dispatchEvent('#res-date', 'change');
    await page.waitForTimeout(200);
    const later = await page.$$eval('#res-time option', (o) => o.filter((x) => x.value && x.disabled).length);
    check(`${label}: later date has all slots open`, later === 0, String(later));
    await page.selectOption('#res-time', '12:00');
    await page.fill('#res-guests', '4'); await page.dispatchEvent('#res-guests', 'input');
    await page.fill('#res-occasion', 'Birthday');
    await page.check('input[name="payment_option"][value="downpayment"]').catch(() => {});
    await page.fill('#res-payment-reference', '1234567890');
    await page.setInputFiles('#res-payment-proof', { name: 'proof.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64') });
    check(`${label}: every field can be filled`, (await page.inputValue('#res-time')) === '12:00' && (await page.inputValue('#res-guests')) === '4');
    // too-soon date typed by hand is refused by the page
    await page.fill('#res-date', '2026-11-15'); await page.dispatchEvent('#res-date', 'change');
    await page.click('#res-submit, button[type=submit]:visible');
    await page.waitForTimeout(300);
    check(`${label}: same-day date rejected with 24h message, nothing sent`, /24 hours in advance|already passed/.test(await page.textContent('#err-res-date')) && posts.length === 0, await page.textContent('#err-res-date'));
    await page.fill('#res-date', '2026-11-18'); await page.dispatchEvent('#res-date', 'change'); await page.waitForTimeout(200); await page.selectOption('#res-time', '12:00');
    await page.dblclick('form button[type=submit]:visible', { delay: 10 }).catch(() => {});
    await page.waitForTimeout(1500);
    check(`${label}: double click sends exactly ONE request`, posts.length === 1, String(posts.length));
    check(`${label}: payload has no price/status fields trusted from browser`, posts[0] && !('total_amount' in posts[0]) && !('payment_status' in posts[0]) && posts[0].payment_proof_path === 'u1/x.png', JSON.stringify(posts[0]));
    check(`${label}: success screen shows reference`, /SC-00001/.test(await page.textContent('body')));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    check(`${label}: no horizontal scroll`, !overflow);
    check(`${label}: no JavaScript errors`, errors.length === 0, errors.join(' | '));
    if (label === 'mobile') await page.screenshot({ path: '/tmp/ui-mobile.png' });
    await page.close();
  }
  await browser.close(); srv.close();
  console.log(fails ? `\n${fails} FAILED` : '\nALL UI CHECKS PASSED'); process.exit(fails ? 1 : 0);
})();
