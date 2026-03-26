/**
 * Captive Portal - 5-Screen Flow
 *
 * Screen 1: Phone + Birthday input
 * Screen 2: Device type selection (phone / other)
 * Screen 3: Success - connected
 * Screen 4: Not found - retry
 * Screen 5: Error - auto-redirect to start
 */

let currentScreen = 0;
let personData = null;
let termsAccepted = false;

// ============================================================================
// SCREEN MANAGEMENT
// ============================================================================

function goToScreen(num) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  // Support named screens like "declined"
  const screen = document.getElementById(`screen-${num}`);
  if (screen) {
    screen.classList.add('active');
    // Re-trigger animation
    screen.style.animation = 'none';
    screen.offsetHeight; // force reflow
    screen.style.animation = '';
  }
  currentScreen = num;
}

// ============================================================================
// SCREEN 0: TERMS & CONDITIONS
// ============================================================================

function acceptTerms(type) {
  termsAccepted = true;
  goToScreen(1);
}

function declineTerms() {
  goToScreen('declined');
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

function showError(screenNum, elementId, message) {
  const el = document.getElementById(elementId);
  if (el) el.textContent = message;
}

function clearErrors() {
  document.querySelectorAll('.error-msg').forEach((el) => (el.textContent = ''));
}

// ============================================================================
// SCREEN 1: LOOKUP
// ============================================================================

document.getElementById('lookup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearErrors();

  const phone = document.getElementById('phone').value.trim();
  const birthday = document.getElementById('birthday').value;

  if (!phone || !birthday) {
    showError(1, 'screen1-error', 'Please fill in both fields.');
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
      showError(1, 'screen1-error', data.error || 'Something went wrong.');
      btn.disabled = false;
      btn.classList.remove('loading');
      return;
    }

    if (data.locked) {
      document.getElementById('error-message').textContent = data.message;
      goToScreen(5);
      startErrorCountdown();
      return;
    }

    if (data.found) {
      personData = data.person;
      document.getElementById('person-name').textContent = data.person.name;
      goToScreen(2);
    } else {
      document.getElementById('not-found-message').textContent =
        data.message || "We couldn't verify your identity.";
      if (data.remaining !== undefined) {
        const el = document.getElementById('remaining-attempts');
        el.textContent =
          data.remaining > 0
            ? `You have ${data.remaining} attempt${data.remaining !== 1 ? 's' : ''} remaining.`
            : 'No attempts remaining. Contact an administrator.';
      }
      goToScreen(4);
    }
  } catch (err) {
    console.error('Lookup error:', err);
    document.getElementById('error-message').textContent =
      'Connection error. Please try again.';
    goToScreen(5);
    startErrorCountdown();
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

  // Disable buttons during request
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
      showError(2, 'screen2-error', data.error || 'Registration failed.');
      buttons.forEach((b) => (b.disabled = false));
      return;
    }

    if (data.success) {
      document.getElementById('success-message').textContent = data.message;
      goToScreen(3);
      startSuccessCountdown();
    } else {
      document.getElementById('error-message').textContent =
        data.error || 'Registration failed.';
      goToScreen(5);
      startErrorCountdown();
    }
  } catch (err) {
    console.error('Register error:', err);
    document.getElementById('error-message').textContent =
      'Connection error. Please try again.';
    goToScreen(5);
    startErrorCountdown();
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
      // Try to close the window (works if opened by captive portal)
      try { window.close(); } catch (e) { /* ignore */ }
    } else {
      el.textContent = `This page will close in ${seconds} second${seconds !== 1 ? 's' : ''}...`;
    }
  }, 1000);
}

// ============================================================================
// SCREEN 5: ERROR COUNTDOWN
// ============================================================================

function startErrorCountdown() {
  let seconds = 5;
  const el = document.getElementById('error-countdown');
  el.textContent = seconds;

  const timer = setInterval(() => {
    seconds--;
    el.textContent = seconds;
    if (seconds <= 0) {
      clearInterval(timer);
      // Reset form and go back to screen 1
      document.getElementById('phone').value = '';
      document.getElementById('birthday').value = '';
      clearErrors();
      personData = null;
      goToScreen(1);
    }
  }, 1000);
}
