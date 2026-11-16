// forgot.js - the "Forgot password?" form (forgot-password.html).
// The customer types their email; Supabase Auth emails a secure reset link (opens reset-password.html).
// Uses helpers from shared.js and auth.js (checkEmail, readInput, showFieldErrors...).

var resetForm = document.getElementById('reset-form');

if (resetForm) {
  document.getElementById('reset-email').addEventListener('input', function () {
    if (this.closest('.field').classList.contains('has-error')) { setFieldError('reset-', 'email', ''); }
  });

  resetForm.addEventListener('submit', async function (event) {
    event.preventDefault();
    showMessage(authStatus, 'error', '');
    var email = readInput('reset-', 'email').trim();
    var message = checkEmail(email);
    setFieldError('reset-', 'email', message);
    if (message !== '') { document.getElementById('reset-email').focus(); return; }

    var button = document.getElementById('reset-submit');
    button.disabled = true;
    button.textContent = 'Sending...';
    var result = await sendJson('POST', '/api/customer/forgot-password', { email: email });
    button.disabled = false;
    button.textContent = 'Send reset link';
    if (result.status === 200) {
      showMessage(authStatus, 'success', result.data.message);
      return;
    }
    showMessage(authStatus, 'error', (result.data && result.data.error) || 'Something went wrong. Please try again.');
  });
}
