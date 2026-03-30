/**
 * Captive Portal - 3-Screen Flow
 *
 * Screen 1: Login (phone + birthday + terms checkbox)
 * Screen 2: Device type selection (phone / other)
 * Screen 3: Success - connected
 */

let currentScreen = 1;
let personData = null;

// ============================================================================
// SCREEN MANAGEMENT
// ============================================================================

function goToScreen(num) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  const screen = document.getElementById(`screen-${num}`);
  if (screen) {
    screen.classList.add('active');
    screen.style.animation = 'none';
    screen.offsetHeight; // force reflow
    screen.style.animation = '';
  }
  currentScreen = num;
}

function showError(msg) {
  const el = document.getElementById('screen1-error');
  if (el) el.textContent = msg;
}

function clearErrors() {
  document.querySelectorAll('.error-msg').forEach((el) => (el.textContent = ''));
}

// ============================================================================
// MODALS
// ============================================================================

function openModal(id) {
  const modal = document.getElementById(id);
  if (modal) {
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) {
    modal.classList.remove('open');
    document.body.style.overflow = '';
  }
}

function closeModalOutside(event, id) {
  if (event.target === event.currentTarget) {
    closeModal(id);
  }
}

// ============================================================================
// SCREEN 1: LOOKUP
// ============================================================================

document.getElementById('lookup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearErrors();

  const phone = document.getElementById('phone').value.trim();
  const birthday = document.getElementById('birthday').value;
  const termsChecked = document.getElementById('terms-check').checked;

  if (!phone || !birthday) {
    showError('Please fill in both fields.');
    return;
  }

  if (!termsChecked) {
    showError('You must agree to the Terms & Conditions to continue.');
    return;
  }

  const btn = document.getElementById('lookup-btn');
  btn.disabled = true;
  btn.classList.add('loading');

  try {
    const res = await fetch('/api/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, birthday }),
    });

    const data = await res.json();

    if (!res.ok) {
      showError(data.error || 'Something went wrong.');
      return;
    }

    if (data.locked) {
      showError(data.message || 'Too many attempts. Contact an administrator.');
      return;
    }

    if (data.found) {
      personData = data.person;
      document.getElementById('person-name').textContent = data.person.name;
      goToScreen(2);
    } else {
      let msg = data.message || "We couldn't verify your identity.";
      if (data.remaining !== undefined) {
        msg += data.remaining > 0
          ? ` ${data.remaining} attempt${data.remaining !== 1 ? 's' : ''} remaining.`
          : ' No attempts remaining. Contact an administrator.';
      }
      showError(msg);
    }
  } catch (err) {
    console.error('Lookup error:', err);
    showError('Connection error. Please try again.');
  } finally {
    btn.disabled = false;
    btn.classList.remove('loading');
  }
});

// ============================================================================
// SCREEN 2: REGISTER DEVICE
// ============================================================================

async function registerDevice(deviceType) {
  clearErrors();

  const buttons = document.querySelectorAll('.device-btn');
  buttons.forEach((b) => (b.disabled = true));

  try {
    const res = await fetch('/api/register-device', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceType }),
    });

    const data = await res.json();

    if (!res.ok) {
      const el = document.getElementById('screen2-error');
      if (el) el.textContent = data.error || 'Registration failed.';
      return;
    }

    if (data.success) {
      document.getElementById('success-message').textContent = data.message;
      goToScreen(3);
      startSuccessCountdown();
    } else {
      const el = document.getElementById('screen2-error');
      if (el) el.textContent = data.error || 'Registration failed.';
    }
  } catch (err) {
    console.error('Register error:', err);
    const el = document.getElementById('screen2-error');
    if (el) el.textContent = 'Connection error. Please try again.';
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
}

// ============================================================================
// SCREEN 3: SUCCESS COUNTDOWN
// ============================================================================

function startSuccessCountdown() {
  let seconds = 5;
  const el = document.getElementById('countdown');
  el.textContent = `This page will close in ${seconds} seconds...`;

  const timer = setInterval(() => {
    seconds--;
    if (seconds <= 0) {
      clearInterval(timer);
      el.textContent = 'You can close this page now.';
      try { window.close(); } catch (e) { /* ignore */ }
    } else {
      el.textContent = `This page will close in ${seconds} second${seconds !== 1 ? 's' : ''}...`;
    }
  }, 1000);
}
