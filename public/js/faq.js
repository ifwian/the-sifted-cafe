/* js/faq.js - small round FAQ button (bottom-right) that opens a small FAQ window.
   Self-contained: it adds its own CSS and HTML, so a page only needs <script src="js/faq.js" defer>. */
(function () {
  var c = window.SIFTED_CONFIG || {};
  var down = c.downpaymentPercent || 30, cancelH = c.cancelHoursBefore || 24, grace = c.graceMinutes || 15;

  var FAQ = [
    ['How do I reserve a table?', 'Create a free account and log in, then fill in the reservation form: branch, date, time and guests. Pay through GCash and attach your proof of payment to send the request.'],
    ['Is my reservation confirmed right away?', 'No. It stays Pending until our staff check your payment proof and confirm it. You can follow the status in your account.'],
    ['How much do I pay?', 'You choose a downpayment (' + down + '% of the total) or pay in full. GCash is the only payment method.'],
    ['How early can I book?', 'At least 1 day ahead, up to 60 days ahead. A reservation needs at least 2 guests.'],
    ['Can I cancel?', 'Yes. You can cancel a pending or confirmed reservation up to ' + cancelH + ' hours before it starts. After that, please contact the cafe.'],
    ['How long is my table held?', 'We hold your table for ' + grace + ' minutes after your reservation time.'],
    ['Where are you located?', 'We have two branches, Calamba and Cabuyao. Addresses and opening hours are on the Visit page.']
  ];

  var css = '#faq-fab{position:fixed;right:20px;bottom:20px;z-index:900;width:46px;height:46px;display:flex;align-items:center;justify-content:center;padding:0;border:0;border-radius:50%;background:var(--brand,#5b3a29);color:#fff;box-shadow:0 8px 20px rgba(47,28,19,.35);cursor:pointer;transition:transform .2s,background-color .2s,box-shadow .2s}' +
    '#faq-fab:hover{transform:translateY(-2px) scale(1.06);background:var(--brand-hover,#43281b)}#faq-fab:focus-visible{outline:3px solid var(--focus-on-dark,#ffd45e);outline-offset:2px}' +
    '#faq-fab svg{width:24px;height:24px;transition:transform .3s}#faq-fab[aria-expanded="true"] svg{transform:rotate(360deg)}' +
    '#faq-panel{position:fixed;right:20px;bottom:76px;z-index:900;width:min(320px,calc(100vw - 32px));max-height:min(60vh,420px);display:flex;flex-direction:column;background:var(--surface,#fff);border:1px solid var(--line-cool,#e7dcc7);border-radius:16px;box-shadow:0 18px 44px rgba(47,28,19,.28);overflow:hidden;opacity:0;transform:translateY(12px) scale(.96);transform-origin:bottom right;visibility:hidden;transition:opacity .22s,transform .22s,visibility .22s}' +
    '#faq-panel.is-open{opacity:1;transform:none;visibility:visible}' +
    '#faq-panel header{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;background:var(--brand-deep,#2f1c13);color:var(--on-dark,#fbf3e4)}' +
    '#faq-panel h2{margin:0;font-family:var(--font-display,Georgia,serif);font-size:1rem;color:inherit}' +
    '#faq-close{width:28px;height:28px;border:0;border-radius:50%;background:transparent;color:inherit;font-size:20px;line-height:1;cursor:pointer}#faq-close:hover{background:rgba(255,255,255,.15)}' +
    '#faq-list{overflow-y:auto;padding:6px 14px 10px;color:var(--ink,#262a4d);font-size:.875rem}' +
    '#faq-list details{border-bottom:1px solid var(--line-cool,#e7dcc7)}#faq-list details:last-child{border-bottom:0}' +
    '#faq-list summary{display:flex;justify-content:space-between;gap:10px;padding:10px 0;font-weight:600;cursor:pointer;list-style:none}#faq-list summary::-webkit-details-marker{display:none}' +
    '#faq-list summary::after{content:"+";flex:none;color:var(--brand,#5b3a29);font-size:1.1rem;line-height:1.2;transition:transform .2s}#faq-list details[open] summary::after{transform:rotate(45deg)}' +
    '#faq-list p{margin:0 0 10px;color:var(--muted,#675d52);line-height:1.5;animation:faq-in .25s both}@keyframes faq-in{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}' +
    '@media print{#faq-fab,#faq-panel{display:none}}@media (prefers-reduced-motion:reduce){#faq-fab,#faq-fab svg,#faq-panel,#faq-list p{transition:none;animation:none}}';
  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  var fab = document.createElement('button');
  fab.id = 'faq-fab'; fab.type = 'button';
  fab.setAttribute('aria-label', 'Open frequently asked questions');
  fab.setAttribute('aria-expanded', 'false'); fab.setAttribute('aria-controls', 'faq-panel');
  fab.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.6-3 4.2"/><path d="M12 17.5h.01"/></svg>';

  var panel = document.createElement('div');
  panel.id = 'faq-panel'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Frequently asked questions');
  panel.innerHTML = '<header><h2>Frequently asked</h2><button id="faq-close" type="button" aria-label="Close">&times;</button></header><div id="faq-list"></div>';
  var list = panel.querySelector('#faq-list');
  FAQ.forEach(function (item) {
    var d = document.createElement('details'), s = document.createElement('summary'), p = document.createElement('p');
    s.textContent = item[0]; p.textContent = item[1];
    d.appendChild(s); d.appendChild(p); list.appendChild(d);
  });
  // Only one answer open at a time.
  list.addEventListener('toggle', function (ev) {
    if (ev.target.open) { list.querySelectorAll('details').forEach(function (d) { if (d !== ev.target) { d.open = false; } }); }
  }, true);

  function setOpen(open) {
    panel.classList.toggle('is-open', open);
    fab.setAttribute('aria-expanded', open ? 'true' : 'false');
    fab.setAttribute('aria-label', open ? 'Close frequently asked questions' : 'Open frequently asked questions');
  }
  fab.addEventListener('click', function () { setOpen(!panel.classList.contains('is-open')); });
  panel.querySelector('#faq-close').addEventListener('click', function () { setOpen(false); fab.focus(); });
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && panel.classList.contains('is-open')) { setOpen(false); fab.focus(); } });
  document.addEventListener('click', function (ev) {
    if (panel.classList.contains('is-open') && !panel.contains(ev.target) && !fab.contains(ev.target)) { setOpen(false); }
  });

  document.body.appendChild(panel);
  document.body.appendChild(fab);
})();
