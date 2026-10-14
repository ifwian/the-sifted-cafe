// The reservation form on the landing page.
// 1. Check the input in the browser (quick feedback).
// 2. Send it to the Express server, which checks it AGAIN (the server is the one we trust).
// 3. Show success ONLY if the server says the reservation was really saved.

(function () {
  const form = document.getElementById('reservation-form');
  if (!form) return;

  const FIELD_NAMES = [
    'customer_name', 'phone', 'email', 'branch', 'guests',
    'reservation_date', 'reservation_time', 'special_requests',
  ];
  const inputs = {
    customer_name: document.getElementById('res-name'),
    phone: document.getElementById('res-phone'),
    email: document.getElementById('res-email'),
    branch: document.getElementById('res-branch'),
    guests: document.getElementById('res-guests'),
    reservation_date: document.getElementById('res-date'),
    reservation_time: document.getElementById('res-time'),
    special_requests: document.getElementById('res-requests'),
  };
  const submitButton = document.getElementById('reservation-submit');
  const statusBox = document.getElementById('form-status');
  const timeHint = document.getElementById('time-hint');
  const successBox = document.getElementById('reservation-success');

  let config = null; // reservation rules from the server

  // ---------- start-up: load the rules, then fill in the form ----------

  getConfig()
    .then((loaded) => {
      config = loaded;
      setUpForm();
    })
    .catch(() => {
      submitButton.disabled = true;
      showStatus('error', 'The reservation form could not load. Please open this site through the cafe server (npm start), or contact the cafe directly.');
    });

  function setUpForm() {
    config.branches.forEach((branch) => {
      inputs.branch.append(new Option(branch.name, branch.id));
    });

    inputs.guests.min = String(config.minGuests);
    inputs.guests.max = String(config.maxGuests);

    const today = getCafeNow(config.timezone).date;
    inputs.reservation_date.min = today;
    inputs.reservation_date.max = addDays(today, config.maxDaysAhead);

    inputs.branch.addEventListener('change', updateTimes);
    inputs.reservation_date.addEventListener('change', updateTimes);

    // Show an error when the visitor leaves a field, and clear it as soon as it is fixed.
    FIELD_NAMES.forEach((name) => {
      inputs[name].addEventListener('blur', () => checkSingleField(name));
      inputs[name].addEventListener('input', () => {
        if (inputs[name].closest('.field').classList.contains('has-error')) checkSingleField(name);
      });
    });

    updateTimes();
  }

  // Fill the "Time" list from the chosen branch and date.
  function updateTimes() {
    const select = inputs.reservation_time;
    const previous = select.value;
    select.length = 1; // keep only "Select a time"

    const branch = config.branches.find((b) => b.id === inputs.branch.value);
    const date = inputs.reservation_date.value;
    if (!branch || !date) {
      timeHint.textContent = 'Pick a branch and a date to see the request times for that branch.';
      return;
    }

    let slots = getSlotsForBranch(branch, config);
    const now = getCafeNow(config.timezone);
    if (date === now.date) {
      slots = slots.filter((slot) => timeToMinutes(slot) >= now.minutes + config.minLeadMinutes);
    }

    slots.forEach((slot) => select.append(new Option(formatTime12(slot), slot)));
    if (slots.includes(previous)) select.value = previous;

    timeHint.textContent = slots.length === 0
      ? 'There are no more request times today at this branch. Please choose another date.'
      : `${branch.name} is open ${formatTime12(branch.open)} to ${formatTime12(branch.close)}. Request times follow the opening hours; our team confirms every request.`;
  }

  // ---------- validation in the browser (same rules as server/validation.js) ----------

  function readValues() {
    const values = {};
    FIELD_NAMES.forEach((name) => { values[name] = inputs[name].value.trim(); });
    return values;
  }

  function validate(values) {
    const errors = {};

    if (!values.customer_name) errors.customer_name = 'Please enter your name.';
    else if (values.customer_name.length < 2) errors.customer_name = 'Name must be at least 2 characters.';
    else if (!/^[\p{L}\p{M}][\p{L}\p{M}\s.'’-]*$/u.test(values.customer_name)) {
      errors.customer_name = 'Name can only contain letters, spaces, apostrophes, periods and hyphens.';
    }

    const digits = values.phone.replace(/\D/g, '');
    if (!values.phone) errors.phone = 'Please enter a contact number.';
    else if (!/^\+?[0-9\s\-()]+$/.test(values.phone)) {
      errors.phone = 'Contact number can only contain digits, spaces, + - ( ).';
    } else if (digits.length < 7 || digits.length > 15) {
      errors.phone = 'Contact number must have between 7 and 15 digits.';
    }

    if (values.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(values.email)) {
      errors.email = 'Please enter a valid email address or leave it blank.';
    }

    if (!values.branch) errors.branch = 'Please choose a branch.';

    const guests = Number(values.guests);
    if (values.guests === '') errors.guests = 'Please enter the number of guests.';
    else if (!Number.isInteger(guests)) errors.guests = 'Number of guests must be a whole number.';
    else if (guests < config.minGuests || guests > config.maxGuests) {
      errors.guests = `We take reservations for ${config.minGuests} to ${config.maxGuests} guests. For larger groups, please contact the cafe.`;
    }

    const today = getCafeNow(config.timezone).date;
    if (!values.reservation_date) errors.reservation_date = 'Please choose a date.';
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(values.reservation_date)) errors.reservation_date = 'Please choose a valid date.';
    else if (values.reservation_date < today) errors.reservation_date = 'The date cannot be in the past.';
    else if (values.reservation_date > addDays(today, config.maxDaysAhead)) {
      errors.reservation_date = `Reservations can be requested up to ${config.maxDaysAhead} days ahead.`;
    }

    if (!values.reservation_time) errors.reservation_time = 'Please choose a time.';

    if (values.special_requests.length > 500) errors.special_requests = 'Special requests must be 500 characters or fewer.';

    return errors;
  }

  function checkSingleField(name) {
    if (!config) return;
    const message = validate(readValues())[name];
    setFieldError(name, message || '');
  }

  // ---------- showing and clearing messages ----------

  function setFieldError(name, message) {
    const field = inputs[name].closest('.field');
    document.getElementById(`err-${name}`).textContent = message;
    field.classList.toggle('has-error', Boolean(message));
    if (message) inputs[name].setAttribute('aria-invalid', 'true');
    else inputs[name].removeAttribute('aria-invalid');
  }

  function showFieldErrors(errors) {
    FIELD_NAMES.forEach((name) => setFieldError(name, errors[name] || ''));
    const firstBad = FIELD_NAMES.find((name) => errors[name]);
    if (firstBad) inputs[firstBad].focus();
  }

  function showStatus(kind, message) {
    statusBox.replaceChildren();
    const box = document.createElement('div');
    box.className = `alert alert-${kind}`;
    box.textContent = message;
    statusBox.append(box);
  }

  function setSubmitting(isSubmitting) {
    submitButton.disabled = isSubmitting;
    submitButton.textContent = isSubmitting ? 'Sending...' : 'Send reservation request';
  }

  // ---------- submitting ----------

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!config) return;
    statusBox.replaceChildren();

    const values = readValues();
    const errors = validate(values);
    if (Object.keys(errors).length > 0) {
      showFieldErrors(errors);
      showStatus('error', 'Please fix the highlighted fields and try again.');
      return;
    }

    setSubmitting(true);
    try {
      const data = await apiRequest('POST', '/api/reservations', {
        ...values,
        website: document.getElementById('res-website').value, // honeypot (must stay empty)
      });
      showSuccess(data); // only reached when the server saved the reservation
    } catch (error) {
      if (error.status === 400 && Object.keys(error.fieldErrors).length > 0) {
        showFieldErrors(error.fieldErrors);
        showStatus('error', 'Please fix the highlighted fields and try again.');
      } else if (error.status === 0) {
        showStatus('error', 'We could not reach the server, so your request was NOT sent. Please check your connection and try again.');
      } else {
        showStatus('error', `${error.message} Your request was NOT sent.`);
      }
    } finally {
      setSubmitting(false);
    }
  });

  function showSuccess(data) {
    const r = data.reservation;
    document.getElementById('success-message').textContent = data.message;

    const details = document.getElementById('success-details');
    details.replaceChildren();
    const rows = [
      ['Reference', r.reference],
      ['Name', r.customer_name],
      ['Branch', r.branch_name],
      ['Date', formatDateLong(r.reservation_date)],
      ['Time', formatTime12(r.reservation_time)],
      ['Guests', String(r.guests)],
      ['Status', 'Pending (waiting for staff confirmation)'],
    ];
    rows.forEach(([label, value]) => {
      const dt = document.createElement('dt');
      const dd = document.createElement('dd');
      dt.textContent = label;
      dd.textContent = value;
      details.append(dt, dd);
    });

    form.hidden = true;
    document.querySelector('.reserve-note').hidden = true;
    successBox.hidden = false;
    successBox.focus();
  }

  document.getElementById('new-request').addEventListener('click', () => {
    form.reset();
    FIELD_NAMES.forEach((name) => setFieldError(name, ''));
    statusBox.replaceChildren();
    updateTimes();
    successBox.hidden = true;
    form.hidden = false;
    document.querySelector('.reserve-note').hidden = false;
    inputs.customer_name.focus();
  });
})();
