// staff.js - the staff page (staff.html). Loads real reservations from /api/staff/*, shows them, and runs the staff actions.
// The server and database decide who is staff; this page only displays what they allow.
(function () {
  'use strict';
  var detail = document.getElementById('detail-modal');
  var body = document.getElementById('detail-modal-body');
  var confirmBox = document.getElementById('confirm-modal');
  var toasts = document.getElementById('sd-toasts');

  // Every button that changes data asks first. {ref} is replaced by the reservation reference.
  var CONFIRM_TEXT = {
    confirmed: { title: 'Confirm {ref}?', yes: 'Yes, confirm it', cls: 'btn-confirm',
      body: 'The customer will see this reservation as Confirmed.' },
    completed: { title: 'Mark {ref} as completed?', yes: 'Yes, mark completed', cls: 'btn-primary',
      body: 'This cannot be changed afterwards.' },
    verify: { title: 'Verify payment for {ref}?', yes: 'Yes, verify payment', cls: 'btn-verify',
      body: 'Please check the proof against the cafe’s GCash records first. A proof is only a screenshot.' },
    unverify: { title: 'Undo verification for {ref}?', yes: 'Yes, undo it', cls: 'btn-outline',
      body: 'The payment goes back to Awaiting verification.' },
    cancelled: { title: 'Cancel {ref}?', yes: 'Yes, cancel it', cls: 'btn-warn',
      body: 'The reservation will be marked as cancelled and its table will be released. The record is kept in the list.' },
    archive: { title: 'Archive {ref}?', yes: 'Yes, archive it', cls: 'btn-primary',
      body: 'The reservation moves out of the active list into the Archive. Nothing is deleted: you can view it and restore it at any time.' },
    delete: { title: 'Permanently delete {ref}?', yes: 'Yes, delete permanently', cls: 'btn-danger',
      body: 'This removes the archived reservation, its payment record and its uploaded proof from the database. It cannot be undone. Use Restore instead if you may need it again.' },
    reject_payment: { title: 'Reject the payment proof for {ref}?', yes: 'Yes, reject proof', cls: 'btn-warn',
      body: 'The customer will be asked to send a new proof. The reservation stays pending.' },
    restore: { title: 'Restore {ref}?', yes: 'Yes, restore it', cls: 'btn-primary',
      body: 'The reservation returns to the active reservation list with its status and payment unchanged.' }
  };

  // ---------- Notifications (bottom-right) ----------
  // The stack is a "popover", so it floats above the pop-up windows. While a window is open the
  // stack is moved inside it (an open window blocks clicks on everything outside), so the close
  // button of a notification always works.
  function syncToasts() {
    if (!toasts.showPopover) { return; }   // old browser: the CSS fallback shows a plain stack
    var hasToast = toasts.querySelector('.sd-toast') !== null;
    var isShown = toasts.matches(':popover-open');
    if (hasToast && !isShown) { toasts.showPopover(); }
    if (!hasToast && isShown) { toasts.hidePopover(); }
  }
  function placeToasts() {
    var host = document.querySelector('dialog[open]') || document.body;
    if (toasts.parentNode !== host) { host.appendChild(toasts); }
    syncToasts();
  }
  function closeToast(toast) {
    if (toast.classList.contains('is-leaving')) { return; }
    clearTimeout(toast.timer);
    toast.classList.remove('is-new');
    toast.classList.add('is-leaving');
    var remove = function () { toast.remove(); syncToasts(); };
    toast.addEventListener('animationend', function (e) { if (e.target === toast) { remove(); } });
    setTimeout(remove, 400);   // safety net (reduced-motion users get no animation)
  }
  function armToast(toast) {
    var left = toast.classList.contains('sd-toast-error') ? 9000 : 6000;
    var started = 0;
    toast.style.setProperty('--life', left + 'ms');
    function run() { started = Date.now(); toast.timer = setTimeout(function () { closeToast(toast); }, left); }
    function pause() { clearTimeout(toast.timer); left -= Date.now() - started; }
    toast.addEventListener('mouseenter', pause);
    toast.addEventListener('mouseleave', run);
    toast.addEventListener('focusin', pause);
    toast.addEventListener('focusout', run);
    toast.addEventListener('animationend', function () { toast.classList.remove('is-new'); });
    run();
  }
  // Public helper: window.sdToast('ok' | 'error', 'text')
  window.sdToast = function (type, text) {
    var toast = document.createElement('div');
    var ok = (type === 'ok');
    toast.className = 'sd-toast ' + (ok ? 'sd-toast-ok' : 'sd-toast-error') + ' is-new';
    toast.setAttribute('role', ok ? 'status' : 'alert');
    toast.innerHTML = '<span class="sd-toast-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false">' +
      (ok ? '<path d="M5 12.5l4.5 4.5L19 7.5"/>' : '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5M12 16h.01"/>') + '</svg></span>' +
      '<div class="sd-toast-text"><strong></strong><p></p></div>' +
      '<button type="button" class="sd-toast-x" data-toast-close aria-label="Dismiss notification">&times;</button>' +
      '<span class="sd-toast-bar" aria-hidden="true"></span>';
    toast.querySelector('strong').textContent = ok ? 'Done' : 'Could not do that';
    toast.querySelector('p').textContent = text;
    toasts.appendChild(toast);
    armToast(toast);
    placeToasts();
  };

  // ---------- Small DOM helper (text is always inserted as text, never as HTML) ----------
  function h(tag, attrs) {
    var el = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      if (k === 'class') { el.className = attrs[k]; }
      else if (k === 'text') { el.textContent = attrs[k]; }
      else { el.setAttribute(k, attrs[k]); }
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined || c === false) { continue; }
      (Array.isArray(c) ? c : [c]).forEach(function (item) {
        el.append(item.nodeType ? item : document.createTextNode(String(item)));
      });
    }
    return el;
  }
  var STATUS_TEXT = { pending: 'Pending', confirmed: 'Confirmed', completed: 'Completed', cancelled: 'Cancelled' };
  var PAY_TEXT = { unpaid: 'Unpaid', proof_submitted: 'Awaiting verification', verified: 'Verified', rejected: 'Rejected' };
  var ACTION_OF = { confirmed: 'confirm', completed: 'complete', cancelled: 'cancel', verify: 'verify', unverify: 'unverify',
    reject_payment: 'reject_payment', archive: 'archive', restore: 'restore', delete: 'delete' };
  function peso(n) { return '₱' + Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function initials(name) { return (String(name).trim().split(/\s+/).slice(0, 2).map(function (p) { return p.charAt(0).toUpperCase(); }).join('')) || '?'; }
  function manila(iso) {
    return iso ? new Date(iso).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
  }
  function badge(kind, text) { return h('span', { class: 'badge badge-' + kind, text: text }); }

  function nextStatuses(status, pay) {
    if (status === 'pending') { return pay === 'verified' ? ['confirmed', 'cancelled'] : ['cancelled']; }
    if (status === 'confirmed') { return ['completed', 'cancelled']; }
    return [];
  }
  function actButton(kind, r, label, cls) {
    return h('button', { type: 'button', class: 'btn ' + cls + ' btn-small', 'data-act': kind, 'data-id': r.id, 'data-ref': r.reference },
      label, h('span', { class: 'visually-hidden', text: ' ' + r.reference }));
  }

  // ---------- State from the address: staff.html?view=archive&status=pending&... ----------
  var params = new URLSearchParams(location.search);
  var isArchive = params.get('view') === 'archive';
  var FILTERS = ['status', 'branch', 'payment', 'date', 'q'];
  var current = {};     // id -> reservation (for the details window)
  var staffToday = '';

  function listUrl(extra) {
    var q = new URLSearchParams();
    if (isArchive) { q.set('view', 'archive'); }
    FILTERS.forEach(function (k) { if (params.get(k)) { q.set(k, params.get(k)); } });
    Object.keys(extra || {}).forEach(function (k) { if (extra[k]) { q.set(k, extra[k]); } else { q.delete(k); } });
    var text = q.toString();
    return 'staff.html' + (text ? '?' + text : '');
  }

  // ---------- Rendering ----------
  function renderHeader(me, data) {
    var c = data.counts;
    document.getElementById('staff-name').textContent = me.full_name;
    document.getElementById('staff-initials').textContent = initials(me.full_name);
    document.getElementById('tab-active').setAttribute('aria-current', isArchive ? 'false' : 'page');
    document.getElementById('tab-archive').setAttribute('aria-current', isArchive ? 'page' : 'false');
    [['tab-pending', c.pending], ['tab-archived', c.archived]].forEach(function (x) {
      var el = document.getElementById(x[0]); el.textContent = x[1]; el.hidden = x[1] < 1;
    });
    document.getElementById('hero-archive').hidden = !isArchive;
    document.getElementById('hero-active').hidden = isArchive;
    document.getElementById('status-seg').hidden = isArchive;
    if (isArchive) { return; }
    staffToday = data.today;
    document.getElementById('hero-date').textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'Asia/Manila' });
    document.getElementById('hero-title').textContent = 'Welcome back, ' + me.full_name.split(' ')[0];
    document.getElementById('hero-text').replaceChildren(
      h('strong', { text: c.today }), ' reservation' + (c.today === 1 ? '' : 's') + ' today and ',
      h('strong', { text: c.proofs_to_check }), ' payment proof' + (c.proofs_to_check === 1 ? '' : 's') + ' waiting to be checked.');
    function metric(id, n, hot, href) {
      var a = document.getElementById(id);
      a.querySelector('b').textContent = n; a.classList.toggle('is-hot', hot); a.href = href;
    }
    metric('metric-today', c.today, false, 'staff.html?date=' + data.today);
    metric('metric-pending', c.pending, c.pending > 0, 'staff.html?status=pending');
    metric('metric-proofs', c.proofs_to_check, c.proofs_to_check > 0, 'staff.html?payment=proof_submitted');
    var seg = document.getElementById('status-seg');
    seg.replaceChildren();
    var all = c.pending + c.confirmed + c.completed + c.cancelled;
    [['', 'All', all], ['pending', 'Pending', c.pending], ['confirmed', 'Confirmed', c.confirmed], ['completed', 'Completed', c.completed], ['cancelled', 'Cancelled', c.cancelled]].forEach(function (x) {
      var on = (params.get('status') || '') === x[0];
      var a = h('a', { class: 'sd-seg-item ' + (x[0] === '' ? 'is-all' : 'is-' + x[0]) + (on ? ' is-on' : ''), href: listUrl({ status: x[0] }) }, x[1] + ' ', h('small', { text: x[2] }));
      if (on) { a.setAttribute('aria-current', 'true'); }
      seg.append(a);
    });
  }

  function renderRows(list) {
    var body = document.getElementById('rows');
    body.replaceChildren();
    current = {};
    list.forEach(function (r) {
      current[r.id] = r;
      var actions = h('div', { class: 'sd-actions' }, h('button', { type: 'button', class: 'btn btn-view btn-small', 'data-view': r.id }, 'View', h('span', { class: 'visually-hidden', text: ' ' + r.reference })));
      if (isArchive) {
        actions.append(actButton('restore', r, 'Restore', 'btn-primary'), actButton('delete', r, 'Delete', 'btn-danger'));
      } else {
        var nx = nextStatuses(r.status, r.payment_status);
        if (nx.indexOf('confirmed') > -1) { actions.append(actButton('confirmed', r, 'Confirm', 'btn-confirm')); }
        if (nx.indexOf('cancelled') > -1) { actions.append(actButton('cancelled', r, 'Cancel', 'btn-warn')); }
        if (r.status === 'completed' || r.status === 'cancelled') { actions.append(actButton('archive', r, 'Archive', 'btn-archive')); }
      }
      var tr = h('tr', { 'data-status': r.status },
        h('td', { 'data-label': 'Reference' }, h('strong', { text: r.reference }), h('span', { class: 'sd-sub', text: r.branch_name })),
        h('td', { 'data-label': 'Customer' }, h('span', { class: 'sd-person' }, h('span', { class: 'sd-avatar', 'aria-hidden': 'true', text: initials(r.customer_name) }),
          h('span', null, h('strong', { text: r.customer_name }), h('span', { class: 'sd-sub', text: r.phone })))),
        h('td', { 'data-label': 'Date and time' }, formatDateShort(r.reservation_date), h('span', { class: 'sd-sub', text: formatTime12(r.reservation_time) })),
        h('td', { 'data-label': 'Guests', text: r.guests }),
        h('td', { 'data-label': 'Amount due', text: peso(r.amount_due) }),
        h('td', { 'data-label': 'Payment' }, badge(r.payment_status, PAY_TEXT[r.payment_status] || r.payment_status)),
        h('td', { 'data-label': 'Status' }, badge(r.status, STATUS_TEXT[r.status] || r.status)),
        isArchive ? h('td', { 'data-label': 'Archived', text: manila(r.archived_at) }) : null,
        h('td', { 'data-label': 'Actions' }, actions));
      body.append(tr);
    });
    document.getElementById('th-archived').hidden = !isArchive;
    document.getElementById('table-caption').textContent = isArchive ? 'Archived reservations' : 'Customer reservations';
    document.getElementById('table-wrap').hidden = list.length === 0;
    var foot = document.getElementById('list-foot');
    foot.hidden = list.length === 0;
    foot.textContent = 'Showing ' + list.length + (isArchive ? ' archived' : '') + ' reservation' + (list.length === 1 ? '' : 's') + (list.length >= 300 ? ' (first 300)' : '');
    var empty = document.getElementById('list-empty');
    empty.hidden = list.length > 0;
    empty.replaceChildren(h('h2', { text: isArchive ? 'Nothing archived yet' : 'No reservations found' }),
      h('p', { text: isArchive ? 'Completed or cancelled reservations you archive will be kept here. Try clearing the filters if you expected some.' : 'New customer requests will appear here as soon as they are sent. Try clearing the filters if you expected some.' }));
  }

  function fact(label, value) { return h('div', null, h('dt', { text: label }), h('dd', { text: value })); }

  function renderDetail(s) {
    var arch = !!s.archived_at;
    var nx = arch ? [] : nextStatuses(s.status, s.payment_status);
    var endHour = (Number(s.reservation_time.slice(0, 2)) + (detailHours || 2)) % 24;
    var pay = h('div', { class: 'sd-pay' },
      h('div', { class: 'sd-pay-head' }, h('strong', { text: 'GCash payment' }), badge(s.payment_status, PAY_TEXT[s.payment_status] || s.payment_status)),
      h('div', { class: 'sd-proof' }, h('span', null,
        s.has_proof
          ? [h('strong', { text: s.proof_name || 'Proof of payment' }), h('span', { class: 'sd-sub' }, h('a', { href: '/api/staff/reservations/' + s.id + '/proof', target: '_blank', rel: 'noopener' }, 'Open proof of payment'))]
          : [h('strong', { text: 'No proof uploaded' }), h('span', { class: 'sd-sub', text: 'Nothing to check' })])),
      h('dl', { class: 'sd-facts sd-facts-tight' },
        fact('Total estimated', peso(s.total_amount)), fact('Amount paid now', peso(s.amount_due)), fact('Remaining balance', peso(s.balance)),
        fact('GCash reference', s.payment_reference || 'Not given'),
        s.payment_status === 'verified' ? fact('Verified', (s.verified_by_name || 'Staff') + ', ' + manila(s.verified_at)) : null,
        s.payment_status === 'rejected' && s.rejection_reason ? fact('Rejection reason', s.rejection_reason) : null),
      h('p', { class: 'sd-sub', text: 'A proof is only a screenshot. Check the cafe\'s own GCash records before marking it verified.' }));
    var history = h('ol', null, h('li', null, h('span', { text: 'Requested' }), h('time', { text: manila(s.created_at) })));
    if (s.payment_status === 'verified' && s.verified_at) { history.append(h('li', null, h('span', { text: 'Payment verified by ' + (s.verified_by_name || 'staff') }), h('time', { text: manila(s.verified_at) }))); }
    if (s.updated_at && s.updated_at !== s.created_at) { history.append(h('li', null, h('span', { text: 'Last updated (now ' + (STATUS_TEXT[s.status] || s.status).toLowerCase() + ')' }), h('time', { text: manila(s.updated_at) }))); }
    if (arch) { history.append(h('li', null, h('span', { text: 'Archived' }), h('time', { text: manila(s.archived_at) }))); }

    var notes = h('textarea', { name: 'notes', rows: '3', maxlength: '500', placeholder: 'Visible to staff only' });
    notes.value = s.admin_notes || '';
    var notesForm = h('form', { class: 'sd-notes', 'data-notes-form': s.id }, h('label', null, 'Staff notes ', notes), h('button', { type: 'submit', class: 'btn btn-outline btn-small', text: 'Save notes' }));

    var actions = h('div', { class: 'dialog-actions' });
    if (nx.indexOf('confirmed') > -1) { actions.append(actButton('confirmed', s, 'Confirm', 'btn-confirm')); }
    if (nx.indexOf('completed') > -1) { actions.append(actButton('completed', s, 'Mark completed', 'btn-primary')); }
    if (!arch && s.payment_status === 'proof_submitted' && (s.status === 'pending' || s.status === 'confirmed')) { actions.append(actButton('verify', s, 'Verify payment', 'btn-verify')); }
    if (!arch && s.payment_status === 'proof_submitted' && s.status === 'pending') { actions.append(actButton('reject_payment', s, 'Reject proof', 'btn-warn')); }
    if (!arch && s.payment_status === 'verified' && s.status === 'pending') { actions.append(actButton('unverify', s, 'Undo verification', 'btn-outline')); }
    if (nx.indexOf('cancelled') > -1) { actions.append(actButton('cancelled', s, 'Cancel reservation', 'btn-warn')); }
    if (arch) { actions.append(actButton('restore', s, 'Restore to active list', 'btn-primary'), actButton('delete', s, 'Delete permanently', 'btn-danger')); }
    else if (s.status === 'completed' || s.status === 'cancelled') { actions.append(actButton('archive', s, 'Archive', 'btn-archive')); }

    var hint = null;
    if (!arch && s.status === 'pending' && s.payment_status !== 'verified') { hint = 'Verify the payment first. The Confirm button appears once the payment is verified.'; }
    else if (arch) { hint = 'This reservation is archived. Restore it to work on it again, or delete it permanently.'; }
    else if (!nx.length) { hint = 'This reservation is ' + s.status + ', so its status can no longer be changed.'; }

    return h('div', { class: 'sd-detail' },
      h('div', { class: 'sd-detail-head' }, h('h3', { id: 'detail-title', text: s.reference }), h('span', { class: 'sd-head-badges' }, arch ? badge('archived', 'Archived') : null, badge(s.status, STATUS_TEXT[s.status] || s.status))),
      h('div', { class: 'sd-person sd-person-lg' }, h('span', { class: 'sd-avatar', 'aria-hidden': 'true', text: initials(s.customer_name) }),
        h('span', null, h('strong', { text: s.customer_name }), h('span', { class: 'sd-sub', text: s.phone + ' · ' + s.email }))),
      h('dl', { class: 'sd-facts' },
        fact('Branch', s.branch_name), fact('Date', formatDateShort(s.reservation_date)),
        fact('Time', formatTime12(s.reservation_time) + ' to ' + formatTime12(('0' + endHour).slice(-2) + ':00')),
        fact('Guests', String(s.guests)), fact('Occasion', s.occasion || 'None'), fact('Special requests / notes', s.special_requests || 'None')),
      pay, h('div', { class: 'sd-history' }, h('strong', { text: 'History' }), history), notesForm, actions,
      hint ? h('p', { class: 'sd-sub', text: hint }) : null);
  }
  var detailHours = 2;

  // ---------- Loading ----------
  var staffMe = null;
  async function load() {
    document.getElementById('list-loading').hidden = false;
    document.getElementById('list-error').hidden = true;
    var result = await sendJson('GET', '/api/staff/reservations' + location.search.replace(/^\?/, '?'));
    document.getElementById('list-loading').hidden = true;
    if (result.status === 401) { location.replace('login.html?next=staff.html'); return; }
    if (result.status === 403) { location.replace('account.html'); return; }
    if (result.status !== 200) {
      document.getElementById('list-error-text').textContent = result.data.error || 'We could not load the reservations.';
      document.getElementById('list-error').hidden = false;
      document.getElementById('main').hidden = false;
      return;
    }
    detailHours = result.data.duration_hours || 2;
    renderHeader(staffMe, result.data);
    renderRows(result.data.reservations);
    document.getElementById('main').hidden = false;
  }

  async function start() {
    var me = await sendJson('GET', '/api/customer/me');
    if (me.status === 401) { location.replace('login.html?next=staff.html'); return; }
    if (me.status !== 200) { document.getElementById('main').hidden = false; document.getElementById('list-error-text').textContent = me.data.error || 'Could not load your account.'; document.getElementById('list-error').hidden = false; return; }
    if (me.data.customer.role !== 'staff') { location.replace('account.html'); return; }   // the API also refuses customers
    staffMe = me.data.customer;
    // fill the filter form from the address
    FILTERS.forEach(function (k) { var el = document.getElementById('f-' + k); if (el) { el.value = params.get(k) || ''; } });
    document.getElementById('f-view').disabled = !isArchive;
    if (isArchive) { document.getElementById('f-view').value = 'archive'; }
    document.getElementById('f-status').disabled = !params.get('status');
    document.getElementById('btn-today').href = listUrl({ date: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }), status: '' });
    document.getElementById('btn-clear').href = isArchive ? 'staff.html?view=archive' : 'staff.html';
    await load();
  }

  document.getElementById('filter-form').addEventListener('submit', function () {
    // do not put empty fields in the address
    Array.prototype.forEach.call(this.elements, function (el) { if (el.name && el.value === '') { el.disabled = true; } });
  });
  document.getElementById('list-retry').addEventListener('click', load);
  document.getElementById('logout-button').addEventListener('click', async function () {
    await sendJson('POST', '/api/customer/logout');
    location.href = 'index.html';
  });

  // ---------- Pop-up windows and actions ----------
  var reopenId = null;   // the reservation whose View window was open when a confirmation opened
  function openDialog(dialog) {
    if (!dialog.open) { dialog.showModal(); }
    placeToasts();
  }

  async function openDetail(id) {
    body.textContent = 'Loading...';
    openDialog(detail);
    var result = await sendJson('GET', '/api/staff/reservations/' + id);
    if (result.status !== 200) { body.textContent = (result.data && result.data.error) || 'Could not load the details. Please close this window and try again.'; return; }
    detailHours = result.data.duration_hours || detailHours;
    body.replaceChildren(renderDetail(result.data.reservation));
  }

  document.addEventListener('click', function (event) {
    var toastClose = event.target.closest('[data-toast-close]');
    if (toastClose) { closeToast(toastClose.closest('.sd-toast')); return; }
    var closeButton = event.target.closest('[data-close]');
    if (closeButton) { closeButton.closest('dialog').close(); return; }
    if (event.target.tagName === 'DIALOG') { event.target.close(); return; }

    var view = event.target.closest('[data-view]');
    if (view) { openDetail(view.dataset.view); return; }

    var actionButton = event.target.closest('[data-act]');
    if (actionButton) {
      var kind = actionButton.dataset.act;
      var text = CONFIRM_TEXT[kind];
      if (!text) { return; }
      document.getElementById('confirm-id').value = actionButton.dataset.id;
      document.getElementById('confirm-action').value = kind;
      document.getElementById('confirm-title').textContent = text.title.replace('{ref}', actionButton.dataset.ref);
      document.getElementById('confirm-text').textContent = text.body;
      document.getElementById('confirm-reason-wrap').hidden = kind !== 'reject_payment';
      document.getElementById('confirm-reason').value = '';
      var yesButton = document.getElementById('confirm-submit');
      yesButton.textContent = text.yes;
      yesButton.className = 'btn btn-small ' + text.cls;
      yesButton.disabled = false;
      reopenId = detail.open ? actionButton.dataset.id : null;
      detail.close();
      openDialog(confirmBox);
    }
  });

  async function runAction(id, kind, text) {
    var result = await sendJson('POST', '/api/staff/reservations/' + id + '/action', { action: ACTION_OF[kind] || kind, text: text || '' });
    if (result.status === 401) { location.replace('login.html?next=staff.html'); return false; }
    window.sdToast(result.status === 200 ? 'ok' : 'error', result.status === 200 ? result.data.message : (result.data.error || 'Something went wrong.'));
    await load();
    return result.status === 200;
  }

  document.getElementById('confirm-form').addEventListener('submit', async function (event) {
    event.preventDefault();
    var yes = document.getElementById('confirm-submit');
    if (yes.disabled) { return; }   // stops double clicks
    yes.disabled = true;
    var id = document.getElementById('confirm-id').value;
    var kind = document.getElementById('confirm-action').value;
    reopenId = null;
    var ok = await runAction(id, kind, kind === 'reject_payment' ? document.getElementById('confirm-reason').value : '');
    confirmBox.close();
    if (kind !== 'delete' && ok) { openDetail(id); }   // show the updated reservation again
  });

  document.addEventListener('submit', async function (event) {
    var form = event.target.closest('[data-notes-form]');
    if (!form) { return; }
    event.preventDefault();
    var button = form.querySelector('button');
    button.disabled = true;
    await runAction(form.dataset.notesForm, 'notes', form.elements.notes.value);
    button.disabled = false;
  });

  // "Go back" / close goes back to the details window instead of leaving the screen empty.
  confirmBox.addEventListener('close', function () { if (reopenId) { var id = reopenId; reopenId = null; openDetail(id); } placeToasts(); });
  detail.addEventListener('close', placeToasts);

  start();
})();
