/* js/dash-motion.js - animation helpers for account.html and staff.html. Does not touch any data.
   1) sets --i (order number) so CSS can stagger items   2) counts the staff numbers up
   3) button ripple   4) staggers reservation rows that js/account.js adds later. */
(function () {
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function stagger(selector, cap) {
    document.querySelectorAll(selector).forEach(function (el, i) { el.style.setProperty('--i', Math.min(i, cap || 99)); });
  }
  stagger('.dash-nav > *'); stagger('.dash-view .card, .dash-view .form-section', 8);
  stagger('.sd-hero > div:first-child > *'); stagger('.sd-metric'); stagger('.sd-tab'); stagger('.sd-seg-item');
  stagger('.sd-table tbody tr', 14);

  // Reservation rows appear after the page loads (js/account.js), so watch the list.
  document.querySelectorAll('.res-list').forEach(function (list) {
    new MutationObserver(function () { stagger('.res-list .res-row', 10); }).observe(list, { childList: true });
  });

  if (reduce) { return; }

  // Count-up for the staff numbers (Today / Pending / Proofs).
  document.querySelectorAll('.sd-metric b').forEach(function (b, k) {
    var end = parseInt(b.textContent, 10);
    if (isNaN(end) || end < 1) { return; }
    var t0 = null, delay = 350 + k * 90, dur = 900;
    b.textContent = '0';
    function tick(t) {
      if (t0 === null) { t0 = t; }
      var p = Math.min(1, (t - t0 - delay) / dur);
      if (p < 0) { requestAnimationFrame(tick); return; }
      b.textContent = Math.round(end * (1 - Math.pow(1 - p, 3)));
      if (p < 1) { requestAnimationFrame(tick); }
    }
    requestAnimationFrame(tick);
  });

  // Click ripple on buttons.
  document.addEventListener('click', function (ev) {
    var btn = ev.target.closest ? ev.target.closest('.btn') : null;
    if (!btn || btn.disabled) { return; }
    var r = btn.getBoundingClientRect(), dot = document.createElement('span');
    dot.className = 'dm-ripple';
    dot.style.left = (ev.clientX - r.left) + 'px';
    dot.style.top = (ev.clientY - r.top) + 'px';
    btn.appendChild(dot);
    setTimeout(function () { dot.remove(); }, 650);
  });
})();
