// reserve.js
// The reservation form. It runs inside account.html (the customer page)
// (same markup, same ids), for signed-in customers only.
//   a. The browser checks what the customer typed.
//   b. The form is sent to the server, which checks it AGAIN.
//   c. The success message is shown ONLY if the server says it saved the reservation.

var form = document.getElementById('reservation-form');
var submitButton = document.getElementById('reservation-submit');
var statusBox = document.getElementById('form-status');
var successBox = document.getElementById('reservation-success');
var PREFIX = 'res-';

// The form fields (the ids are 'res-' + the name, with '-' instead of '_').
var FIELD_NAMES = ['name', 'phone', 'email', 'branch', 'guests', 'date', 'time', 'occasion', 'requests',
                   'payment_option', 'payment_reference', 'payment_proof', 'accept'];
function input(name) {
  return document.getElementById('res-' + name.replace(/_/g, '-'));
}
var CFG = window.SIFTED_CONFIG;
var PROOF_TYPES = ['image/png', 'image/jpeg', 'application/pdf'];

// ---------------------------------------------------------------
// Booking rules come from the SERVER (GET /api/config): branch hours and capacity, the advance-notice
// rule (24 hours) and the server clock. Nothing about hours or capacity is hardcoded in this file.
// The server and the database enforce the same rules again when the form is sent.
// ---------------------------------------------------------------
var MANILA_MS = 8 * 3600 * 1000;       // Asia/Manila is UTC+8 all year (no daylight saving)
var serverOffsetMs = 0;                // server clock minus this device's clock
var minAdvanceHours = 24;
var maxDaysAhead = 60;
var minGuests = 2;
var configLoaded = false;
function advanceMessage() { return 'Reservations must be made at least ' + minAdvanceHours + ' hours in advance.'; }
function nowMs() { return Date.now() + serverOffsetMs; }
function manilaDateTime(ms) { var iso = new Date(ms + MANILA_MS).toISOString(); return { date: iso.slice(0, 10), time: iso.slice(11, 16) }; }
function addDaysText(dateText, days) { return new Date(Date.parse(dateText + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10); }
function slotStartMs(dateText, timeText) { return Date.parse(dateText + 'T' + timeText + ':00+08:00'); }
function earliestMs() { return nowMs() + minAdvanceHours * 3600000; }
// The 24-hour rule for one slot
function slotAllowed(dateText, timeText) { return slotStartMs(dateText, timeText) >= earliestMs(); }
// First date that still has at least one bookable hour for the chosen branch (or any branch)
function minDateFor(branch) {
  var lastHour = 0;
  var keys = branch && BRANCH_HOURS[branch] ? [branch] : Object.keys(BRANCH_HOURS);
  keys.forEach(function (k) { lastHour = Math.max(lastHour, BRANCH_HOURS[k].close - 1); });
  var day = manilaDateTime(earliestMs()).date;
  if (slotStartMs(day, pad2(lastHour) + ':00') < earliestMs()) { day = addDaysText(day, 1); }
  return day;
}
function maxDateText() { return addDaysText(manilaDateTime(nowMs()).date, maxDaysAhead); }
// Disables dates that break the rule (the date picker greys out everything before min).
function refreshDateLimits() {
  var branch = input('branch').value;
  input('date').min = minDateFor(branch);
  input('date').max = maxDateText();
  if (input('date').value !== '' && input('date').value < input('date').min) {
    input('date').value = '';   // the chosen date is no longer allowed (time passed or branch changed)
    refreshAvailability();
  }
  applyAvailability();
}
setInterval(refreshDateLimits, 60000);   // keep the rule correct while the page stays open

// Opening hours: requests are every hour, from opening until 1 hour before closing.
// Max guests per reservation = branch capacity (the server enforces the real limit)
var BRANCH_MAX_GUESTS = {};   // filled from /api/config
var BRANCH_NAMES = {};
var BRANCH_HOURS = {};        // { code: { open: firstHour, close: lastHour + 1 } }
function maxGuests() {
  var own = BRANCH_MAX_GUESTS[input('branch').value];
  if (own) { return own; }
  var values = Object.keys(BRANCH_MAX_GUESTS).map(function (k) { return BRANCH_MAX_GUESTS[k]; });
  return values.length ? Math.max.apply(null, values) : 30;
}
var timeHint = document.getElementById('time-hint');

// Fills the Time list with the hours that fit the chosen branch.
function updateTimeOptions() {
  var branch = input('branch').value;
  var select = input('time');
  var keep = select.value;
  select.replaceChildren();
  var first = document.createElement('option');
  first.value = '';
  first.textContent = branch === '' ? 'Choose a branch first' : 'Select a time';
  select.append(first);
  if (BRANCH_HOURS[branch] === undefined) {
    timeHint.textContent = configLoaded ? 'Choose a branch to see the available times.' : 'Loading the available times...';
    return;
  }
  var h = BRANCH_HOURS[branch];
  for (var hour = h.open; hour <= h.close - 1; hour++) {
    var option = document.createElement('option');
    option.value = pad2(hour) + ':00';
    option.textContent = formatTime12(option.value);
    select.append(option);
  }
  select.value = keep;   // keep the chosen time if it still exists
  timeHint.textContent = 'Times are every hour, from ' + formatTime12(pad2(h.open) + ':00') + ' to ' +
    formatTime12(pad2(h.close - 1) + ':00') + ' (we close at ' + formatTime12(pad2(h.close) + ':00') +
    '). ' + advanceMessage();
  applyAvailability();
}
input('branch').addEventListener('change', function () {
  input('guests').max = String(maxGuests());
  updateTimeOptions(); refreshDateLimits(); refreshAvailability(); refreshQuote();
});
updateTimeOptions();

// ---------------------------------------------------------------
// Seats left per time slot. The SERVER knows the bookings (GET /api/availability);
// we only show the answer next to each time. The server checks again when you send the form.
// ---------------------------------------------------------------
var availability = null;   // { '12:00': 14, ... } or null when unknown

function applyAvailability() {
  var guests = Number(input('guests').value) || 0;
  var select = input('time');
  var options = select.querySelectorAll('option');
  for (var i = 0; i < options.length; i++) {
    var option = options[i];
    if (option.value === '') { continue; }
    var text = formatTime12(option.value);
    var disable = false;
    var chosenDate = input('date').value;
    if (chosenDate !== '' && slotAllowed(chosenDate, option.value) === false) {
      text += ' - needs ' + minAdvanceHours + 'h notice';   // the 24-hour rule
      disable = true;
    } else if (availability !== null && availability[option.value] !== undefined) {
      var left = availability[option.value];
      if (left === 0) {
        text += ' - fully booked';
        disable = true;
      } else if (left < guests) {
        text += ' - only ' + left + ' seat' + (left === 1 ? '' : 's') + ' left';
        disable = true;
      } else if (left <= 6) {
        text += ' - ' + left + ' seat' + (left === 1 ? '' : 's') + ' left';
      }
    }
    option.textContent = text;
    option.disabled = disable;
    if (disable && select.value === option.value) { select.value = ''; }
  }
}

async function refreshAvailability() {
  var branch = input('branch').value;
  var date = input('date').value;
  availability = null;
  applyAvailability();   // the 24-hour rule is applied at once, seat counts follow when the server answers
  if (branch === '' || date === '') { return; }
  var result = await sendJson('GET', '/api/availability?branch=' + encodeURIComponent(branch) + '&date=' + encodeURIComponent(date));
  // ignore an old answer if the choice changed while we waited
  if (input('branch').value === branch && input('date').value === date) {
    availability = result.status === 200 ? result.data.seats_left : null;
    applyAvailability();
  }
}
input('date').addEventListener('change', function () { refreshAvailability(); setFieldError(PREFIX, 'time', ''); });
input('guests').addEventListener('input', applyAvailability);

// Guests: the - and + buttons change the number (2 up to the branch limit)
document.querySelectorAll('.stepper-btn').forEach(function (button) {
  button.addEventListener('click', function () {
    var field = input('guests');
    var next = (Number(field.value) || 2) + Number(button.dataset.step);
    field.value = String(Math.min(maxGuests(), Math.max(2, next)));
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  });
});

// Reads every field. The result uses the names the server expects.
function readValues() {
  return {
    customer_name: input('name').value.trim(),
    phone: input('phone').value.trim(),
    email: input('email').value.trim(),
    branch: input('branch').value,
    guests: input('guests').value.trim(),
    reservation_date: input('date').value,
    reservation_time: input('time').value,
    occasion: input('occasion').value.trim(),
    special_requests: input('requests').value.trim(),
    payment_option: selectedOption(),
    payment_method: 'gcash',   // GCash is the only payment method
    payment_reference: input('payment_reference').value.trim(),
    accept_policies: input('accept').checked
  };
}

// Which payment option radio is chosen ('' if none)
function selectedOption() {
  var chosen = document.querySelector('input[name="payment_option"]:checked');
  return chosen ? chosen.value : '';
}

// The chosen proof file (or null)
function proofFile() {
  var files = input('payment_proof').files;
  return files.length > 0 ? files[0] : null;
}

// Server field names -> the short names used in the page ids
var SERVER_TO_PAGE = {
  customer_name: 'name', phone: 'phone', email: 'email', branch: 'branch', guests: 'guests',
  reservation_date: 'date', reservation_time: 'time', occasion: 'occasion', special_requests: 'requests',
  payment_option: 'payment_option', payment_reference: 'payment_reference', payment_proof: 'payment_proof', accept_policies: 'accept'
};

// Checks the values. Gives back an object of messages like { phone: '...' } (page names). Empty = fine.
function checkValues(values) {
  var errors = {};
  var nameMessage = checkName(values.customer_name);
  if (nameMessage !== '') { errors.name = nameMessage; }
  var phoneMessage = checkPhone(values.phone);
  if (phoneMessage !== '') { errors.phone = phoneMessage; }
  var emailMessage = checkEmail(values.email);
  if (emailMessage !== '') { errors.email = emailMessage; }

  if (values.branch === '') {
    errors.branch = 'Please choose a branch.';
  }
  var guests = Number(values.guests);
  if (values.guests === '') {
    errors.guests = 'Please enter the number of guests.';
  } else if (Number.isInteger(guests) === false) {
    errors.guests = 'Number of guests must be a whole number.';
  } else if (guests < minGuests || guests > maxGuests()) {
    errors.guests = 'Online reservations are for ' + minGuests + ' to ' + maxGuests() + ' guests. For larger groups, please call or message the cafe.';
  }
  // Dates like 2026-10-24 can be compared with < and >. The SERVER repeats every one of these checks.
  var todayText = manilaDateTime(nowMs()).date;
  if (values.reservation_date === '') {
    errors.date = 'Please choose a date.';
  } else if (values.reservation_date < todayText) {
    errors.date = 'That date has already passed. ' + advanceMessage();
  } else if (values.reservation_date < minDateFor(values.branch)) {
    errors.date = advanceMessage();
  } else if (values.reservation_date > maxDateText()) {
    errors.date = 'Reservations can be requested up to ' + maxDaysAhead + ' days ahead.';
  } else if (values.reservation_time !== '' && slotAllowed(values.reservation_date, values.reservation_time) === false) {
    errors.date = advanceMessage();
  }
  if (values.reservation_time === '') {
    errors.time = 'Please choose a time.';
  }
  if (values.occasion.length > 100) { errors.occasion = 'Occasion must be 100 characters or fewer.'; }
  if (values.special_requests.length > 500) { errors.requests = 'Special requests must be 500 characters or fewer.'; }

  // Payment
  if (values.payment_option === '') {
    errors.payment_option = 'Please choose Downpayment or Full payment.';
  }
  if (values.payment_reference !== '' && /^[0-9 ]{6,20}$/.test(values.payment_reference) === false) {
    errors.payment_reference = 'The GCash reference number can only have digits (6 to 20).';
  }
  var file = proofFile();
  if (CFG.requireProof) {
    if (file === null) {
      errors.payment_proof = 'Please attach your proof of payment.';
    } else if (PROOF_TYPES.indexOf(file.type) === -1) {
      errors.payment_proof = 'Proof of payment must be a PNG, JPG or PDF file.';
    } else if (file.size === 0 || file.size > CFG.maxProofMB * 1024 * 1024) {
      errors.payment_proof = 'Proof of payment must be smaller than ' + CFG.maxProofMB + ' MB.';
    }
  }
  if (values.accept_policies !== true) {
    errors.accept = 'Please accept the reservation terms before sending your request.';
  }
  return errors;
}

// Shows the errors (page names) and focuses the first wrong field.
function showErrors(errors) {
  showFieldErrors(PREFIX, FIELD_NAMES, errors);
}

// Errors from the server use the server's names, so rename them first.
function renameServerErrors(serverErrors) {
  var renamed = {};
  for (var key in serverErrors) {
    renamed[SERVER_TO_PAGE[key] || key] = serverErrors[key];
  }
  return renamed;
}

// Checks one field when the customer leaves it
function connectFieldEvents(name) {
  input(name).addEventListener('blur', function (event) {
    if (event.relatedTarget === submitButton) {
      return;   // the submit step checks every field anyway
    }
    setFieldError(PREFIX, name, checkValues(readValues())[name] || '');
  });
  // 'input' fires while typing; 'change' fires for lists, the checkbox and the file picker
  function recheck() {
    if (input(name).closest('.field').classList.contains('has-error')) {
      setFieldError(PREFIX, name, checkValues(readValues())[name] || '');
      // when no field shows an error any more, remove the red message above the button
      if (form.querySelector('.has-error') === null) {
        showMessage(statusBox, 'error', '');
      }
    }
  }
  input(name).addEventListener('input', recheck);
  input(name).addEventListener('change', recheck);
}
for (var j = 0; j < FIELD_NAMES.length; j++) {
  if (FIELD_NAMES[j] !== 'payment_option') {   // payment_option is a group of radio buttons, handled below
    connectFieldEvents(FIELD_NAMES[j]);
  }
}

// Fill in name, phone and email from the account. They are read-only because the database keeps them only in the users table.
async function prefill() {
  var me = await sendJson('GET', '/api/customer/me');
  if (me.status === 401) {
    goToSignIn(me.data.code, 'account.html#reserve');
    return;
  }
  if (me.status === 200) {
    input('name').value = me.data.customer.full_name;
    input('phone').value = me.data.customer.phone;
    input('email').value = me.data.customer.email;
    input('name').readOnly = true;
    input('phone').readOnly = true;
    input('email').readOnly = true;
    updatePaymentSection();   // refreshes the summary and the review list with the filled-in values
  }
}
prefill();


// ---------------------------------------------------------------
// Booking summary, payment option and payment instructions
// ---------------------------------------------------------------
// The amounts come from the server (POST /api/reservations/quote). The browser only DISPLAYS them.
var quote = null;   // the last answer from the server, or null

async function refreshQuote() {
  var guests = Number(input('guests').value);
  quote = null;
  if (Number.isInteger(guests) && guests >= 2 && guests <= maxGuests()) {
    var result = await sendJson('POST', '/api/reservations/quote', { guests: guests, branch: input('branch').value });
    if (result.status === 401) {
      goToSignIn(result.data.code, 'account.html#reserve');
      return;
    }
    if (result.status === 200) {
      quote = result.data.quote;
    }
  }
  updateReview();
  updatePaymentSection();
}

function addSummaryRow(list, label, value) {
  var dt = document.createElement('dt');
  var dd = document.createElement('dd');
  dt.textContent = label;
  dd.textContent = value;
  list.append(dt, dd);
}

// The time this reservation would end, like '2:00 PM'
function endTimeText(startText, hours) {
  var hour = Number(startText.slice(0, 2)) + Number(hours);
  return formatTime12(pad2(hour % 24) + startText.slice(2, 5));
}

// The short "Booking summary" at the end of the form: only what the customer is about to send.
function updateReview() {
  var list = document.getElementById('review-list');
  list.replaceChildren();
  var v = readValues();
  var branchName = BRANCH_NAMES[v.branch] || '';
  addSummaryRow(list, 'Name', v.customer_name || '-');
  addSummaryRow(list, 'Date', v.reservation_date ? formatDateLong(v.reservation_date) : '-');
  addSummaryRow(list, 'Time', v.reservation_time ? formatTime12(v.reservation_time) + ' to ' + endTimeText(v.reservation_time, CFG.durationHours) + (branchName ? ' (' + branchName + ')' : '') : '-');
  addSummaryRow(list, 'Guests', v.guests || '-');
  if (v.special_requests) { addSummaryRow(list, 'Special requests', v.special_requests); }
  if (quote !== null && v.payment_option !== '') {
    addSummaryRow(list, PAYMENT_OPTION_LABELS[v.payment_option], formatMoney(quote.options[v.payment_option].amount_due));
  } else if (quote !== null) {
    addSummaryRow(list, 'Downpayment (' + quote.downpayment_percent + '%)', formatMoney(quote.options.downpayment.amount_due));
  }
}
form.addEventListener('input', updateReview);
form.addEventListener('change', updateReview);

// Shows the amounts on the two option cards, and the payment instructions for the chosen method.
function updatePaymentSection() {
  var downText = 'Enter guests first';
  var fullText = 'Enter guests first';
  var downNote = 'Pay the required deposit now.';
  if (quote !== null) {
    downText = formatMoney(quote.options.downpayment.amount_due);
    fullText = formatMoney(quote.options.full.amount_due);
    downNote = 'Pay the deposit now. Remaining balance: ' + formatMoney(quote.options.downpayment.balance);
  }
  document.getElementById('opt-downpayment-amount').textContent = downText;
  document.getElementById('opt-full-amount').textContent = fullText;
  document.getElementById('opt-downpayment-note').textContent = downNote;
  document.getElementById('opt-full-note').textContent = 'Pay the whole amount now. Remaining balance: ' + formatMoney(0);

  // GCash card: recipient, QR image (from config.js) and the exact amount
  var gcash = CFG.gcash;
  var option = selectedOption();
  document.getElementById('pay-recipient').textContent = gcash.recipientName;
  document.getElementById('pay-note').textContent = gcash.note;
  var qr = document.getElementById('pay-qr');
  qr.src = gcash.qrImage;
  qr.alt = gcash.qrAlt;
  document.getElementById('qr-big').src = gcash.qrImage;
  document.getElementById('qr-big').alt = gcash.qrAlt;
  document.getElementById('pay-amount').textContent =
    (quote !== null && option !== '') ? formatMoney(quote.options[option].amount_due) : 'Choose a payment option (section B)';
  document.getElementById('proof-required-note').textContent = CFG.requireProof ? '(required: PNG, JPG or PDF, up to ' + CFG.maxProofMB + ' MB)' : '(optional: PNG, JPG or PDF)';
  updateReview();
}

// Keep the summary and payment section up to date
input('guests').addEventListener('input', refreshQuote);
input('guests').addEventListener('change', refreshQuote);
var optionRadios = document.querySelectorAll('input[name="payment_option"]');
for (var k = 0; k < optionRadios.length; k++) {
  optionRadios[k].addEventListener('change', function () {
    setFieldError(PREFIX, 'payment_option', '');
    updatePaymentSection();
  });
}

// Fill the terms from config.js: a few short groups, each a list of one-line rules, plus a privacy line
var policyList = document.getElementById('policy-list');
for (var p = 0; p < CFG.policies.length; p++) {
  // One <details> per group: native keyboard and touch support, no extra script needed.
  var group = document.createElement('details');
  group.className = 'terms-group';
  if (p === 0) { group.open = true; }   // the first group starts open
  var heading = document.createElement('summary');
  var title = document.createElement('span');
  title.textContent = CFG.policies[p].title;
  heading.append(title);
  var list = document.createElement('ul');
  for (var i = 0; i < CFG.policies[p].items.length; i++) {
    var li = document.createElement('li');
    li.textContent = CFG.policies[p].items[i];
    list.append(li);
  }
  group.append(heading, list);
  policyList.append(group);
}
document.getElementById('terms-privacy').textContent = CFG.privacyNote;
document.getElementById('duration-hint').textContent = 'Each reservation holds a table for ' + CFG.durationHours + ' hours.';
refreshQuote();

// Sends the form to the server in 3 steps: (1) ask for a one-time upload link, (2) upload the proof
// straight to private storage, (3) send the reservation. NO amounts are sent: the server works them out itself.
var submitting = false;
form.addEventListener('submit', async function (event) {
  event.preventDefault();   // stop the browser from reloading the page
  if (submitting) { return; }   // a second click or Enter press while sending is ignored
  showMessage(statusBox, 'error', '');

  var values = readValues();
  var errors = checkValues(values);
  showErrors(errors);
  if (Object.keys(errors).length > 0) {
    showMessage(statusBox, 'error', 'Please fix the highlighted fields and try again.');
    return;
  }

  submitting = true;
  submitButton.disabled = true;
  submitButton.setAttribute('aria-busy', 'true');
  function finish() {
    submitting = false;
    submitButton.disabled = false;
    submitButton.removeAttribute('aria-busy');
    submitButton.textContent = 'Send reservation request';
  }
  function fail(message, errorsFromServer) {
    finish();
    if (errorsFromServer) { showErrors(renameServerErrors(errorsFromServer)); }
    showMessage(statusBox, 'error', message);
  }

  var file = proofFile();
  var proofPath = '';
  var proofName = '';
  if (file !== null) {
    submitButton.textContent = 'Uploading proof...';
    var ticket = await sendJson('POST', '/api/uploads/proof-url', { content_type: file.type, size: file.size, filename: file.name });
    if (ticket.status === 401) { finish(); goToSignIn(ticket.data.code, 'account.html#reserve'); return; }
    if (ticket.status !== 200) { fail((ticket.data.error || 'Could not prepare the upload.') + ' Your request was NOT sent.', ticket.data.errors); return; }
    try {
      var upload = new FormData();
      upload.append('cacheControl', '3600');
      upload.append('', file);   // the same format the Supabase Storage upload endpoint expects
      var put = await fetch(ticket.data.upload_url, { method: 'PUT', headers: { 'x-upsert': 'false' }, body: upload });
      if (put.ok === false) { throw new Error('upload status ' + put.status); }
    } catch (error) {
      console.error('Proof upload failed', error);
      fail('The proof of payment could not be uploaded. Please try again. Your request was NOT sent.', { payment_proof: 'The upload failed. Please attach the file again.' });
      return;
    }
    proofPath = ticket.data.path;
    proofName = ticket.data.name;
  }

  submitButton.textContent = 'Sending...';
  var body = {};
  Object.keys(values).forEach(function (key) { body[key] = values[key]; });
  body.website = document.getElementById('res-website').value;   // the hidden bot trap. It must stay empty.
  body.payment_proof_path = proofPath;
  body.payment_proof_name = proofName;
  var result = await sendJson('POST', '/api/reservations', body);

  if (result.status === 201 || result.status === 200) {
    finish();
    showSuccess(result.data);
  } else if (result.status === 401) {
    finish();
    goToSignIn(result.data.code, 'account.html#reserve');
  } else if ((result.status === 400 || result.status === 409) && result.data.errors) {
    fail((result.data.errors.reservation_date || result.data.errors.reservation_time || 'Please fix the highlighted fields and try again.') + ' Your request was NOT sent.', result.data.errors);
    refreshAvailability();
  } else if (result.status === 0) {
    fail(result.data.error + ' Your request was NOT sent.');
  } else {
    fail((result.data.error || 'Something went wrong.') + ' Your request was NOT sent.');
  }
});

// Replaces the form with the "Request received" box.
// The reservation status and the payment status are shown separately on purpose.
function showSuccess(data) {
  var r = data.reservation;
  document.getElementById('success-message').textContent = data.message;
  var details = document.getElementById('success-details');
  details.replaceChildren();
  var rows = [
    ['Reference', r.reference], ['Name', r.customer_name], ['Branch', r.branch_name],
    ['Date', formatDateLong(r.reservation_date)], ['Time', formatTime12(r.reservation_time)],
    ['Guests', String(r.guests)],
    ['Reservation status', 'Pending: waiting for staff confirmation (not confirmed yet)'],
    ['Payment status', PAYMENT_LABELS[r.payment_status] || r.payment_status],
    ['Payment', (PAYMENT_OPTION_LABELS[r.payment_option] || '') + ' via GCash'],
    ['Total estimated amount', formatMoney(r.total_amount)],
    ['GCash amount sent', formatMoney(r.amount_due)],
    ['Remaining balance', formatMoney(r.balance)]
  ];
  for (var i = 0; i < rows.length; i++) {
    var label = document.createElement('dt');
    var value = document.createElement('dd');
    label.textContent = rows[i][0];
    value.textContent = rows[i][1];
    details.append(label, value);
  }
  form.hidden = true;
  successBox.hidden = false;
  successBox.focus();
  successBox.scrollIntoView({ block: 'start' });
}

// "Make another request" brings the form back (name, phone and email are filled again).
document.getElementById('new-request').addEventListener('click', function () {
  form.reset();
  updateTimeOptions();
  refreshQuote();
  for (var i = 0; i < FIELD_NAMES.length; i++) {
    setFieldError(PREFIX, FIELD_NAMES[i], '');
  }
  showMessage(statusBox, 'error', '');
  successBox.hidden = true;
  form.hidden = false;
  updatePaymentSection();
  prefill();
});


// Terms first: the form appears only after the customer accepts the terms.
(function () {
  var accept = document.getElementById('res-accept');
  var card = document.getElementById('form-card');
  if (!accept || !card) { return; }
  function sync() {
    card.hidden = !accept.checked;
    if (accept.checked) { setFieldError(PREFIX, 'accept', ''); }
  }
  accept.addEventListener('change', function () {
    sync();
    if (accept.checked) { card.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  });
  sync();
})();


// ---------------------------------------------------------------
// Load the booking rules from the server, then build the branch list, the time slots and the date limits.
// ---------------------------------------------------------------
async function loadServerConfig() {
  var result = await sendJson('GET', '/api/config');
  if (result.status !== 200) {
    document.getElementById('time-hint').textContent = 'We could not load the booking times. Please refresh the page.';
    showMessage(statusBox, 'error', 'We could not load the booking rules from the server, so reservations are paused. Please refresh the page.');
    submitButton.disabled = true;
    return;
  }
  var c = result.data;
  serverOffsetMs = Date.parse(c.server_now) - Date.now();
  minAdvanceHours = c.min_advance_hours;
  maxDaysAhead = c.max_days_ahead;
  minGuests = c.min_guests;
  CFG.durationHours = c.duration_hours;
  CFG.cancelHoursBefore = c.cancel_hours_before;
  if (c.gcash.recipient) { CFG.gcash.recipientName = c.gcash.recipient; }
  if (c.gcash.note) { CFG.gcash.note = c.gcash.note; }
  var select = input('branch');
  var chosen = select.value;
  select.replaceChildren();
  var placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Select a branch';
  select.append(placeholder);
  c.branches.forEach(function (b) {
    BRANCH_HOURS[b.code] = { open: b.first_hour, close: b.last_hour + 1 };
    BRANCH_MAX_GUESTS[b.code] = b.capacity;
    BRANCH_NAMES[b.code] = b.name;
    var option = document.createElement('option');
    option.value = b.code;
    option.textContent = b.name;
    select.append(option);
  });
  select.value = chosen;
  configLoaded = true;
  input('guests').max = String(maxGuests());
  var maxAll = maxGuests();
  var facts = { 'fact-guests': minGuests + '\u2013' + maxAll, 'fact-ahead': minAdvanceHours + ' h+', 'fact-cancel': c.cancel_hours_before + ' h before' };
  Object.keys(facts).forEach(function (id) { var el = document.getElementById(id); if (el) { el.textContent = facts[id]; } });
  document.getElementById('date-hint').textContent = advanceMessage();
  document.getElementById('duration-hint').textContent = 'Each reservation holds a table for ' + c.duration_hours + ' hours.';
  updateTimeOptions();
  refreshDateLimits();
  refreshQuote();
  updatePaymentSection();
}
loadServerConfig();
