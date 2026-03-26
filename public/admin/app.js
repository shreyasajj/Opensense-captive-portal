/**
 * Admin Panel - Dashboard Logic
 */

// ============================================================================
// API
// ============================================================================

async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch('/admin' + path, opts);
  return res.json();
}

// ============================================================================
// NAVIGATION
// ============================================================================

document.querySelectorAll('.nav-link').forEach((link) => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    document.querySelectorAll('.nav-link').forEach((l) => l.classList.remove('active'));
    link.classList.add('active');
    const tab = link.dataset.tab;
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    document.getElementById('tab-' + tab).classList.add('active');

    // Load data for the tab
    if (tab === 'people') loadPersons();
    else if (tab === 'attempts') loadAttempts();
    else if (tab === 'unknown') loadUnknownMacs();
    else if (tab === 'errors') loadErrors();
    else if (tab === 'settings') loadSettings();
  });
});

// ============================================================================
// PEOPLE & DEVICES
// ============================================================================

async function loadPersons() {
  const data = await api('GET', '/api/persons');
  if (!data) return;
  const container = document.getElementById('persons-list');

  if (data.length === 0) {
    container.innerHTML = '<div class="empty">No people registered yet.</div>';
    return;
  }

  container.innerHTML = data.map((p) => {
    const devices = (p.devices || []).map((d) => {
      const isOnline = d.last_seen && (Date.now() - new Date(d.last_seen + 'Z').getTime()) < 120000;
      return `<div class="device-row">
        <div class="device-info">
          <span>${d.device_type === 'phone' ? '&#128241;' : '&#128187;'}</span>
          <code>${d.mac_address}</code>
          <span class="badge ${d.device_type}">${d.device_type}</span>
          ${d.is_presence_tracker ? '<span class="badge tracker">Tracker</span>' : ''}
          <span class="badge ${d.approved ? 'approved' : 'pending'}">${d.approved ? 'Approved' : 'Pending'}</span>
          <span class="badge ${isOnline ? 'online' : 'offline'}">${isOnline ? 'Online' : 'Offline'}</span>
        </div>
        <div class="device-actions">
          ${!d.approved ? `<button class="btn small success" onclick="approveDevice(${d.id})">Approve</button>` : ''}
          ${!d.is_presence_tracker ? `<button class="btn small outline" onclick="setPhone(${d.id})">Set as Phone</button>` : ''}
          <button class="btn small danger" onclick="removeDevice(${d.id})">Remove</button>
        </div>
      </div>`;
    }).join('');

    return `<div class="person-card">
      <div class="person-header">
        <div class="person-info">
          <h3>${escapeHtml(p.name || 'Unknown')}</h3>
          <span>${escapeHtml(p.phone)} &middot; Birthday: ${escapeHtml(p.birthday || 'N/A')}</span>
        </div>
        <button class="btn small danger" onclick="removePerson(${p.id})">Remove Person</button>
      </div>
      <div class="device-list">
        ${devices || '<div style="color:#9ca3af;font-size:0.85rem;padding:8px;">No devices</div>'}
      </div>
    </div>`;
  }).join('');
}

async function removePerson(id) {
  if (!confirm('Remove this person and revoke all their devices?')) return;
  await api('DELETE', `/api/persons/${id}`);
  loadPersons();
}

async function removeDevice(id) {
  if (!confirm('Remove this device and revoke WiFi access?')) return;
  await api('DELETE', `/api/devices/${id}`);
  loadPersons();
}

async function setPhone(id) {
  await api('POST', `/api/devices/${id}/set-phone`);
  loadPersons();
}

async function approveDevice(id) {
  await api('POST', `/api/devices/${id}/approve`);
  loadPersons();
}

// ============================================================================
// LOGIN ATTEMPTS
// ============================================================================

async function loadAttempts() {
  const data = await api('GET', '/api/attempts');
  if (!data) return;
  const tbody = document.querySelector('#attempts-table tbody');

  if (data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty">No login attempts recorded.</td></tr>';
    return;
  }

  tbody.innerHTML = data.map((a) => `<tr>
    <td>${escapeHtml(a.phone_number)}</td>
    <td>${a.attempts} / ${a.max_attempts}</td>
    <td><span class="badge ${a.locked ? 'locked' : 'approved'}">${a.locked ? 'Locked' : 'Active'}</span></td>
    <td>${formatDate(a.last_attempt)}</td>
    <td><button class="btn small success" onclick="grantChances('${escapeHtml(a.phone_number)}')">Grant 3 More</button></td>
  </tr>`).join('');
}

async function grantChances(phone) {
  await api('POST', `/api/attempts/${encodeURIComponent(phone)}/grant`, { extra: 3 });
  loadAttempts();
}

// ============================================================================
// UNKNOWN MACS
// ============================================================================

async function loadUnknownMacs() {
  const data = await api('GET', '/api/unknown-macs');
  if (!data) return;
  const tbody = document.querySelector('#unknown-table tbody');

  if (data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty">No unknown MAC addresses detected.</td></tr>';
    return;
  }

  tbody.innerHTML = data.map((m) => `<tr>
    <td><code>${m.mac_address}</code></td>
    <td>${formatDate(m.first_seen)}</td>
    <td>${formatDate(m.last_seen)}</td>
    <td><span class="badge">${escapeHtml(m.tagged)}</span></td>
    <td>
      <button class="btn small outline" onclick="tagMac(${m.id})">Tag</button>
      <button class="btn small danger" onclick="removeUnknownMac(${m.id})">Remove</button>
    </td>
  </tr>`).join('');
}

async function tagMac(id) {
  const tag = prompt('Enter tag for this MAC:', 'validated');
  if (!tag) return;
  await api('POST', `/api/unknown-macs/${id}/tag`, { tag });
  loadUnknownMacs();
}

async function removeUnknownMac(id) {
  await api('DELETE', `/api/unknown-macs/${id}`);
  loadUnknownMacs();
}

// ============================================================================
// ERRORS
// ============================================================================

async function loadErrors() {
  const data = await api('GET', '/api/errors');
  if (!data) return;
  const tbody = document.querySelector('#errors-table tbody');

  if (!data.rows || data.rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty">No errors recorded.</td></tr>';
    return;
  }

  tbody.innerHTML = data.rows.map((e) => `<tr>
    <td>${formatDate(e.timestamp)}</td>
    <td><span class="badge">${escapeHtml(e.type || '')}</span></td>
    <td>${escapeHtml(e.message || '')}</td>
    <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeAttr(e.details || '')}">${escapeHtml((e.details || '').substring(0, 100))}</td>
  </tr>`).join('');
}

async function clearErrors() {
  if (!confirm('Clear all error logs?')) return;
  await api('DELETE', '/api/errors');
  loadErrors();
}

// ============================================================================
// SETTINGS
// ============================================================================

async function loadSettings() {
  const data = await api('GET', '/api/settings');
  if (!data) return;
  document.getElementById('setting-default-allow').checked = data.default_allow === 'true';
}

async function updateSetting(key, value) {
  await api('PUT', '/api/settings', { [key]: value ? 'true' : 'false' });
}

// ============================================================================
// HELPERS
// ============================================================================

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatDate(dateStr) {
  if (!dateStr) return 'N/A';
  try {
    const d = new Date(dateStr + (dateStr.endsWith('Z') ? '' : 'Z'));
    return d.toLocaleString();
  } catch {
    return dateStr;
  }
}

// ============================================================================
// INIT
// ============================================================================

// Load initial data
loadPersons();
loadSettings();
