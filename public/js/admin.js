// Admin (staff) page: sign in, then view, search, edit, change the status of and delete reservations.
// Every action talks to the Express API; nothing here is stored only in the browser.
//
// Safety note: text that customers typed (names, requests...) is always put on the page with
// textContent / DOM methods, never innerHTML, so it can never run as HTML or script.

(function () {
  'use strict';

  const STATUS_LABELS = {
    pending: 'Pending',
    confirmed: 'Confirmed',
    cancelled: 'Cancelled',
    completed: 'Completed',
    no_show: 'No-show',
  };
  const STATUS_ACTION_LABELS = {
    pending: 'Back to pending',
    confirmed: 'Confirm',
    cancelled: 'Cancel reservation',
    completed: 'Mark completed',
    no_show: 'Mark no-show',
  };
  const EDIT_FIELDS = [
    'customer_name', 'phone', 'email', 'branch', 'guests',
    'reservation_date', 'reservation_time', 'status', 'special_requests', 'admin_notes',
  ];
  const EDIT_INPUT_IDS = {
    customer_name: 'e-name', phone: 'e-phone', email: 'e-email', branch: 'e-branch', guests: 'e-guests',
    reservation_date: 'e-date', reservation_time: 'e-time', status: 'e-status',
    special_requests: 'e-requests', admin_notes: 'e-notes',
  };
  const REQUIRED_EDIT_FIELDS = ['customer_name', 'phone', 'branch', 'guests', 'reservation_date', 'reservation_time', 'status'];

  const state = {
    config: null,
    page: 1,
    pageSize: 15,
    loadId: 0,            // lets us ignore out-of-date search results
    current: null,        // the reservation shown in the detail dialog
    pendingDelete: null,  // the reservation the delete dialog is about
    optionsReady: false,
  };

  const $ = (id) => document.getElementById(id);

  // ---------- small helpers ----------

  // Builds an element: h('button', { class: 'btn', text: 'Save', onclick: fn }, child1, child2)
  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    Object.entries(props || {}).forEach(([key, value]) => {
      if (value === undefined || value === null || value === false) return;
      if (key === 'class') el.className = value;
      else if (key === 'text') el.textContent = value;
      else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
      else el.setAttribute(key, value === true ? '' : value);
    });
    children.flat().forEach((child) => {
      if (child !== undefined && child !== null && child !== false) el.append(child);
    });
    return el;
  }

  function formatDateShort(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
    }).format(new Date(Date.UTC(y, m - 1, d)));
  }

  function statusBadge(status) {
    return h('span', { class: `badge badge-${status}`, text: STATUS_LABELS[status] || status });
  }

  function errorText(error) {
    return error.status === 0 ? 'Could not reach the server. Please check that it is running.' : error.message;
  }

  function toast(message, kind = 'success') {
    const box = h('div', { class: `toast alert alert-${kind}`, text: message });
    $('toasts').append(box);
    setTimeout(() => box.remove(), kind === 'error' ? 8000 : 4500);
  }

  // Like apiRequest, but if the server says we are no longer signed in,
  // go back to the sign-in screen and stop whatever was happening.
  async function adminRequest(method, path, body) {
    try {
      return await apiRequest(method, path, body);
    } catch (error) {
      if (error.status === 401) {
        showLogin('Your session has expired. Please sign in again.');
        error.sessionExpired = true;
      }
      throw error;
    }
  }

  // ---------- which screen is showing ----------

  function showView(name) {
    $('boot').hidden = name !== 'boot';
    $('login-view').hidden = name !== 'login';
    $('app-view').hidden = name !== 'app';
    document.title = name === 'app'
      ? 'Reservations | The Sifted Cafe staff'
      : 'Staff sign-in | The Sifted Cafe';
  }

  function setLoginStatus(message, kind = 'error') {
    const box = $('login-status');
    box.replaceChildren();
    if (message) box.append(h('div', { class: `alert alert-${kind}`, text: message }));
  }

  function showLogin(message, kind = 'error') {
    document.querySelectorAll('dialog[open]').forEach((dialog) => dialog.close());
    showView('login');
    $('login-password').value = '';
    setLoginStatus(message || '', kind);
    $('login-username').focus();
  }

  async function boot() {
    showView('boot');
    $('boot').textContent = 'Loading...';
    try {
      state.config = await getConfig();
      const me = await apiRequest('GET', '/api/auth/me');
      await enterApp(me.admin.username);
    } catch (error) {
      if (error.status === 401) {
        showLogin();
      } else {
        $('boot').replaceChildren(
          h('p', { text: errorText(error) }),
          h('button', { type: 'button', class: 'btn btn-primary btn-small', text: 'Try again', onclick: boot })
        );
      }
    }
  }

  async function enterApp(username) {
    if (!state.config) state.config = await getConfig();
    populateOptions();
    $('admin-username').textContent = username;
    showView('app');
    $('admin-main').focus({ preventScroll: true });
    refreshAll();
  }

  // Fill the drop-down lists once, using the branches and statuses from the server rules.
  function populateOptions() {
    if (state.optionsReady) return;
    state.config.statuses.forEach((s) => {
      $('f-status').append(new Option(STATUS_LABELS[s] || s, s));
      $('e-status').append(new Option(STATUS_LABELS[s] || s, s));
    });
    state.config.branches.forEach((b) => {
      $('f-branch').append(new Option(b.name, b.id));
      $('e-branch').append(new Option(b.name, b.id));
    });
    $('e-guests').max = String(state.config.maxGuests);
    state.optionsReady = true;
  }

  function refreshAll() {
    loadSummary();
    loadList();
  }

  // ---------- sign in / sign out ----------

  $('login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const username = $('login-username').value.trim();
    const password = $('login-password').value;
    setLoginStatus('');
    if (!username || !password) {
      setLoginStatus('Please enter your username and password.');
      return;
    }

    const button = $('login-submit');
    button.disabled = true;
    button.textContent = 'Signing in...';
    try {
      const data = await apiRequest('POST', '/api/auth/login', { username, password });
      $('login-password').value = '';
      await enterApp(data.admin.username);
    } catch (error) {
      setLoginStatus(errorText(error));
    } finally {
      button.disabled = false;
      button.textContent = 'Sign in';
    }
  });

  $('logout-button').addEventListener('click', async () => {
    try {
      await apiRequest('POST', '/api/auth/logout');
      showLogin('You have been signed out.', 'success');
    } catch (error) {
      toast(`Could not sign out: ${errorText(error)}`, 'error');
    }
  });

  // ---------- summary cards ----------

  async function loadSummary() {
    try {
      const { summary } = await adminRequest('GET', '/api/reservations/summary');
      const active = $('f-status').value;
      const cards = [['', 'All', summary.total]].concat(
        state.config.statuses.map((s) => [s, STATUS_LABELS[s] || s, summary[s]])
      );
      $('summary').replaceChildren(
        ...cards.map(([status, label, count]) =>
          h('button', {
            type: 'button',
            class: 'summary-card',
            'aria-pressed': String(active === status),
            onclick: () => { $('f-status').value = status; onFilterChange(); },
          },
          h('span', { class: 'summary-count', text: String(count) }),
          h('span', { class: 'summary-label', text: label }))
        )
      );
    } catch (error) {
      if (!error.sessionExpired) {
        $('summary').replaceChildren(h('p', { class: 'field-error', text: 'Could not load the counts.' }));
      }
    }
  }

  // ---------- the reservation list ----------

  function activeFilters() {
    return {
      search: $('f-search').value.trim(),
      status: $('f-status').value,
      branch: $('f-branch').value,
      dateFrom: $('f-from').value,
      dateTo: $('f-to').value,
    };
  }

  function buildQuery() {
    const params = new URLSearchParams();
    Object.entries(activeFilters()).forEach(([key, value]) => { if (value) params.set(key, value); });
    params.set('sort', $('f-sort').value);
    params.set('page', String(state.page));
    params.set('pageSize', String(state.pageSize));
    return params.toString();
  }

  function onFilterChange() {
    state.page = 1;
    loadList();
    loadSummary();
  }

  async function loadList() {
    const myId = ++state.loadId;
    const table = $('reservations-table');
    table.classList.add('is-loading');
    $('list-status').textContent = 'Loading reservations...';

    try {
      const data = await adminRequest('GET', `/api/reservations?${buildQuery()}`);
      if (myId !== state.loadId) return; // a newer search already replaced this one

      // After deleting the last row on a page, step back one page.
      if (data.reservations.length === 0 && data.pagination.total > 0 && state.page > 1) {
        state.page = data.pagination.totalPages;
        return loadList();
      }

      renderRows(data.reservations);
      renderPagination(data.pagination);
      const total = data.pagination.total;
      $('list-status').textContent = total === 0 ? '' : `${total} reservation${total === 1 ? '' : 's'} found`;
    } catch (error) {
      if (error.sessionExpired || myId !== state.loadId) return;
      renderMessageRow(
        h('p', { text: `We could not load the reservations. ${errorText(error)}` }),
        h('button', { type: 'button', class: 'btn btn-primary btn-small', text: 'Try again', onclick: loadList })
      );
      $('pagination').replaceChildren();
      $('list-status').textContent = '';
    } finally {
      if (myId === state.loadId) table.classList.remove('is-loading');
    }
  }

  function renderMessageRow(...content) {
    $('reservations-body').replaceChildren(
      h('tr', { class: 'message-row' }, h('td', { colspan: '8', class: 'table-message' }, ...content))
    );
  }

  function renderRows(items) {
    if (items.length === 0) {
      const filtered = Object.values(activeFilters()).some(Boolean);
      if (filtered) {
        renderMessageRow(
          h('p', { text: 'No reservations match these filters.' }),
          h('button', { type: 'button', class: 'btn btn-outline btn-small', text: 'Clear filters', onclick: clearFilters })
        );
      } else {
        renderMessageRow(h('p', { text: 'No reservations yet. New requests from the website will appear here.' }));
      }
      return;
    }

    $('reservations-body').replaceChildren(
      ...items.map((r) => {
        const who = `${r.reference} for ${r.customer_name}`;
        return h('tr', {},
          h('td', { 'data-label': 'Ref', class: 'ref', text: r.reference }),
          h('td', { 'data-label': 'Guest' },
            h('strong', { text: r.customer_name }),
            h('span', { class: 'sub', text: r.phone })),
          h('td', { 'data-label': 'Date and time' },
            formatDateShort(r.reservation_date),
            h('span', { class: 'sub', text: formatTime12(r.reservation_time) })),
          h('td', { 'data-label': 'Guests', text: String(r.guests) }),
          h('td', { 'data-label': 'Branch', text: r.branch_name }),
          h('td', { 'data-label': 'Status' }, statusBadge(r.status)),
          h('td', { 'data-label': 'Requested', text: r.created_at.slice(0, 16) }),
          h('td', { 'data-label': 'Actions' },
            h('div', { class: 'row-actions' },
              h('button', { type: 'button', class: 'btn btn-outline btn-small', 'aria-label': `View ${who}`, text: 'View', onclick: () => openDetail(r.id) }),
              h('button', { type: 'button', class: 'btn btn-outline btn-small', 'aria-label': `Edit ${who}`, text: 'Edit', onclick: () => openEdit(r) }),
              h('button', { type: 'button', class: 'btn btn-danger btn-small', 'aria-label': `Delete ${who}`, text: 'Delete', onclick: () => openDelete(r) })))
        );
      })
    );
  }

  function renderPagination(p) {
    const nav = $('pagination');
    nav.replaceChildren();
    if (p.total === 0) return;
    const from = (p.page - 1) * p.pageSize + 1;
    const to = Math.min(p.total, p.page * p.pageSize);
    nav.append(
      h('span', { class: 'pagination-info', text: `Showing ${from} to ${to} of ${p.total}` }),
      h('div', { class: 'pagination-buttons' },
        h('button', {
          type: 'button', class: 'btn btn-outline btn-small', text: 'Previous',
          disabled: p.page <= 1, onclick: () => { state.page -= 1; loadList(); },
        }),
        h('span', { text: `Page ${p.page} of ${p.totalPages}` }),
        h('button', {
          type: 'button', class: 'btn btn-outline btn-small', text: 'Next',
          disabled: p.page >= p.totalPages, onclick: () => { state.page += 1; loadList(); },
        }))
    );
  }

  // ---------- search and filters ----------

  let searchTimer = null;
  $('f-search').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(onFilterChange, 300); // wait until typing pauses
  });
  ['f-status', 'f-branch', 'f-from', 'f-to', 'f-sort'].forEach((id) => {
    $(id).addEventListener('change', onFilterChange);
  });
  $('filters').addEventListener('submit', (event) => event.preventDefault());
  $('f-clear').addEventListener('click', clearFilters);

  function clearFilters() {
    ['f-search', 'f-status', 'f-branch', 'f-from', 'f-to'].forEach((id) => { $(id).value = ''; });
    $('f-sort').value = 'newest';
    onFilterChange();
  }

  // ---------- detail dialog ----------

  async function openDetail(id) {
    const dialog = $('detail-dialog');
    state.current = null;
    $('detail-title').textContent = 'Reservation';
    $('detail-body').replaceChildren(h('p', { text: 'Loading...' }));
    $('detail-status-actions').replaceChildren();
    if (!dialog.open) dialog.showModal();

    try {
      const data = await adminRequest('GET', `/api/reservations/${id}`);
      state.current = data.reservation;
      renderDetail();
    } catch (error) {
      if (error.sessionExpired) return;
      $('detail-body').replaceChildren(h('p', { class: 'field-error', text: errorText(error) }));
    }
  }

  function renderDetail() {
    const r = state.current;
    $('detail-title').textContent = `Reservation ${r.reference}`;

    const rows = [
      ['Status', statusBadge(r.status)],
      ['Name', r.customer_name],
      ['Contact number', h('a', { href: `tel:${r.phone.replace(/[^\d+]/g, '')}`, text: r.phone })],
      ['Email', r.email ? h('a', { href: `mailto:${r.email}`, text: r.email }) : 'Not given'],
      ['Branch', r.branch_name],
      ['Date', formatDateLong(r.reservation_date)],
      ['Time', formatTime12(r.reservation_time)],
      ['Guests', String(r.guests)],
      ['Special requests', r.special_requests || 'None'],
      ['Staff notes', r.admin_notes || 'None'],
      ['Requested on', r.created_at],
      ['Last updated', r.updated_at],
    ];
    const list = h('dl', { class: 'detail-list' });
    rows.forEach(([label, value]) => list.append(h('dt', { text: label }), h('dd', {}, value)));
    $('detail-body').replaceChildren(list);

    const actions = $('detail-status-actions');
    actions.replaceChildren(h('span', { class: 'label', text: 'Change status:' }));
    state.config.statuses.filter((s) => s !== r.status).forEach((s) => {
      actions.append(h('button', {
        type: 'button',
        class: 'btn btn-outline btn-small',
        text: STATUS_ACTION_LABELS[s] || STATUS_LABELS[s],
        onclick: (event) => changeStatus(r.id, s, event.currentTarget),
      }));
    });
  }

  async function changeStatus(id, status, button) {
    const buttons = $('detail-status-actions').querySelectorAll('button');
    buttons.forEach((b) => { b.disabled = true; });
    button.textContent = 'Saving...';
    try {
      const data = await adminRequest('PATCH', `/api/reservations/${id}/status`, { status });
      state.current = data.reservation;
      renderDetail();
      toast(`Status changed to ${STATUS_LABELS[status]}.`);
      refreshAll();
    } catch (error) {
      if (error.sessionExpired) return;
      renderDetail(); // puts the buttons back
      toast(`Could not change the status: ${errorText(error)}`, 'error');
    }
  }

  $('detail-close').addEventListener('click', () => $('detail-dialog').close());
  $('detail-edit').addEventListener('click', () => { if (state.current) openEdit(state.current); });
  $('detail-delete').addEventListener('click', () => { if (state.current) openDelete(state.current); });

  // ---------- edit dialog ----------

  function setEditError(name, message) {
    const input = $(EDIT_INPUT_IDS[name]);
    $(`e-err-${name}`).textContent = message;
    input.closest('.field').classList.toggle('has-error', Boolean(message));
    if (message) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }

  function openEdit(r) {
    $('detail-dialog').close();
    EDIT_FIELDS.forEach((name) => {
      const value = r[name];
      $(EDIT_INPUT_IDS[name]).value = value === null || value === undefined ? '' : String(value);
      setEditError(name, '');
    });
    $('edit-status').replaceChildren();
    $('edit-title').textContent = `Edit reservation ${r.reference}`;
    $('edit-form').dataset.id = String(r.id);
    $('edit-dialog').showModal();
  }

  $('edit-cancel').addEventListener('click', () => $('edit-dialog').close());

  $('edit-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const id = $('edit-form').dataset.id;
    const body = {};
    EDIT_FIELDS.forEach((name) => { body[name] = $(EDIT_INPUT_IDS[name]).value.trim(); });
    $('edit-status').replaceChildren();

    // Quick check for empty required fields (the server checks everything else).
    let firstBad = null;
    EDIT_FIELDS.forEach((name) => {
      const missing = REQUIRED_EDIT_FIELDS.includes(name) && body[name] === '';
      setEditError(name, missing ? 'This field is required.' : '');
      if (missing && !firstBad) firstBad = name;
    });
    if (firstBad) {
      $(EDIT_INPUT_IDS[firstBad]).focus();
      return;
    }

    const saveButton = $('edit-save');
    saveButton.disabled = true;
    saveButton.textContent = 'Saving...';
    try {
      await adminRequest('PUT', `/api/reservations/${id}`, body);
      $('edit-dialog').close();
      toast('Reservation updated.');
      refreshAll();
    } catch (error) {
      if (error.sessionExpired) return;
      if (error.status === 400 && Object.keys(error.fieldErrors).length > 0) {
        EDIT_FIELDS.forEach((name) => setEditError(name, error.fieldErrors[name] || ''));
        const bad = EDIT_FIELDS.find((name) => error.fieldErrors[name]);
        if (bad) $(EDIT_INPUT_IDS[bad]).focus();
        $('edit-status').append(h('div', { class: 'alert alert-error', text: 'Please fix the highlighted fields.' }));
      } else {
        $('edit-status').append(h('div', { class: 'alert alert-error', text: `Could not save: ${errorText(error)}` }));
      }
    } finally {
      saveButton.disabled = false;
      saveButton.textContent = 'Save changes';
    }
  });

  // ---------- delete dialog (always asks first) ----------

  function openDelete(r) {
    state.pendingDelete = r;
    $('detail-dialog').close();
    $('delete-text').textContent =
      `Delete ${r.reference} for ${r.customer_name} on ${formatDateShort(r.reservation_date)} at ${formatTime12(r.reservation_time)}?`;
    $('delete-status').replaceChildren();
    $('delete-dialog').showModal();
  }

  $('delete-cancel').addEventListener('click', () => $('delete-dialog').close());

  $('delete-confirm').addEventListener('click', async () => {
    const r = state.pendingDelete;
    if (!r) return;
    const button = $('delete-confirm');
    button.disabled = true;
    button.textContent = 'Deleting...';
    $('delete-status').replaceChildren();
    try {
      await adminRequest('DELETE', `/api/reservations/${r.id}`);
      $('delete-dialog').close();
      state.pendingDelete = null;
      toast(`${r.reference} was deleted.`);
      refreshAll();
    } catch (error) {
      if (error.sessionExpired) return;
      $('delete-status').append(h('div', { class: 'alert alert-error', text: `Could not delete: ${errorText(error)}` }));
    } finally {
      button.disabled = false;
      button.textContent = 'Yes, delete';
    }
  });

  boot();
})();
