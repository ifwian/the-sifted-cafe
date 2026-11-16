// reset.js - reset-password.html. The email link brings the visitor here with a one-time token in the
// address (#access_token=...). We send it, with the new password, to our API, which asks Supabase Auth to change it.

var resetForm = document.getElementById('reset-form');
var RESET_FIELDS = ['password', 'confirm_password'];
var hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
var recoveryToken = hashParams.get('access_token') || '';
if (window.location.hash) { history.replaceState(null, '', window.location.pathname); }   // keep the token out of the address bar

if (recoveryToken === '') {
  showMessage(authStatus, 'error', 'This reset link is not valid or has expired. Please request a new one on the Forgot password page.');
  document.getElementById('reset-submit').disabled = true;
}

resetForm.addEventListener('submit', async function (event) {
  event.preventDefault();
  showMessage(authStatus, 'error', '');
  var values = { password: readInput('reset-', 'password'), confirm_password: readInput('reset-', 'confirm_password') };
  var errors = {};
  if (values.password.length < 8 || /[A-Za-z]/.test(values.password) === false || /[0-9]/.test(values.password) === false) {
    errors.password = 'Password must be at least 8 characters with a letter and a number.';
  }
  if (values.confirm_password !== values.password) { errors.confirm_password = 'Passwords do not match.'; }
  showFieldErrors('reset-', RESET_FIELDS, errors);
  if (Object.keys(errors).length > 0) { return; }

  var button = document.getElementById('reset-submit');
  button.disabled = true;
  button.textContent = 'Changing...';
  var result = await sendJson('POST', '/api/customer/reset-password', { access_token: recoveryToken, password: values.password });
  if (result.status === 200) {
    showMessage(authStatus, 'success', 'Password changed! Taking you to the log in page...');
    setTimeout(function () { window.location.href = 'login.html'; }, 1800);
    return;
  }
  button.disabled = false;
  button.textContent = 'Change password';
  if (result.data && result.data.errors) { showFieldErrors('reset-', RESET_FIELDS, result.data.errors); }
  showMessage(authStatus, 'error', (result.data && result.data.error) || 'Something went wrong. Please try again.');
});
