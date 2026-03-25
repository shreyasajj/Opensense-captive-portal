const express = require('express');
const db = require('../db/init');
const adminAuth = require('../middleware/adminAuth');
const opnsense = require('../services/opnsense');
const attemptsService = require('../services/attempts');
const logger = require('../services/logger');

const router = express.Router();

// All admin API routes require authentication
router.use(adminAuth);

// ============================================================================
// PERSONS
// ============================================================================

/** GET /admin/api/persons - List all persons with their devices */
router.get('/api/persons', (req, res) => {
  const persons = db.prepare(`
    SELECT p.*,
      (SELECT COUNT(*) FROM devices d WHERE d.person_id = p.id) as device_count
    FROM persons p ORDER BY p.created_at DESC
  `).all();

  // Attach devices for each person
  const getDevices = db.prepare('SELECT * FROM devices WHERE person_id = ? ORDER BY created_at DESC');
  for (const p of persons) {
    p.devices = getDevices.all(p.id);
  }

  res.json(persons);
});

/** DELETE /admin/api/persons/:id - Remove person and revoke all their devices */
router.delete('/api/persons/:id', async (req, res) => {
  const person = db.prepare('SELECT * FROM persons WHERE id = ?').get(req.params.id);
  if (!person) return res.status(404).json({ error: 'Person not found' });

  const devices = db.prepare('SELECT * FROM devices WHERE person_id = ?').all(person.id);

  // Revoke all MACs from OPNsense
  for (const device of devices) {
    try {
      await opnsense.revokeMac(device.mac_address);
    } catch (err) {
      logger.warn(`Failed to revoke MAC ${device.mac_address}:`, err.message);
    }
  }

  // Delete person (cascades to devices due to foreign key)
  db.prepare('DELETE FROM persons WHERE id = ?').run(person.id);
  logger.info(`Admin removed person ${person.name} (${person.phone}) and ${devices.length} devices`);

  res.json({ success: true, revokedDevices: devices.length });
});

// ============================================================================
// DEVICES
// ============================================================================

/** GET /admin/api/devices - List all devices */
router.get('/api/devices', (req, res) => {
  const devices = db.prepare(`
    SELECT d.*, p.name as person_name, p.phone as person_phone
    FROM devices d
    LEFT JOIN persons p ON d.person_id = p.id
    ORDER BY d.created_at DESC
  `).all();
  res.json(devices);
});

/** DELETE /admin/api/devices/:id - Remove a device and revoke its MAC */
router.delete('/api/devices/:id', async (req, res) => {
  const device = db.prepare('SELECT * FROM devices WHERE id = ?').get(req.params.id);
  if (!device) return res.status(404).json({ error: 'Device not found' });

  try {
    await opnsense.revokeMac(device.mac_address);
  } catch (err) {
    logger.warn(`Failed to revoke MAC ${device.mac_address}:`, err.message);
  }

  db.prepare('DELETE FROM devices WHERE id = ?').run(device.id);
  logger.info(`Admin removed device ${device.mac_address}`);

  res.json({ success: true });
});

/** POST /admin/api/devices/:id/set-phone - Set device as presence tracker */
router.post('/api/devices/:id/set-phone', (req, res) => {
  const device = db.prepare('SELECT * FROM devices WHERE id = ?').get(req.params.id);
  if (!device) return res.status(404).json({ error: 'Device not found' });

  // Unset any existing presence tracker for this person
  db.prepare('UPDATE devices SET is_presence_tracker = 0, device_type = \'other\' WHERE person_id = ? AND is_presence_tracker = 1')
    .run(device.person_id);

  // Set this device as the tracker
  db.prepare('UPDATE devices SET is_presence_tracker = 1, device_type = \'phone\' WHERE id = ?')
    .run(device.id);

  logger.info(`Admin set device ${device.mac_address} as presence tracker for person ${device.person_id}`);
  res.json({ success: true });
});

/** POST /admin/api/devices/:id/approve - Approve a pending device */
router.post('/api/devices/:id/approve', async (req, res) => {
  const device = db.prepare('SELECT * FROM devices WHERE id = ?').get(req.params.id);
  if (!device) return res.status(404).json({ error: 'Device not found' });

  try {
    await opnsense.allowMac(device.mac_address);
  } catch (err) {
    logger.error(`Failed to whitelist MAC ${device.mac_address}:`, err.message);
    opnsense.logError('admin_approve', `Failed to whitelist ${device.mac_address}`, err.message);
    return res.status(500).json({ error: 'Failed to add to OPNsense whitelist' });
  }

  db.prepare('UPDATE devices SET approved = 1 WHERE id = ?').run(device.id);
  logger.info(`Admin approved device ${device.mac_address}`);

  res.json({ success: true });
});

// ============================================================================
// LOGIN ATTEMPTS
// ============================================================================

/** GET /admin/api/attempts - List all login attempt records */
router.get('/api/attempts', (req, res) => {
  const rows = db.prepare('SELECT * FROM login_attempts ORDER BY last_attempt DESC').all();
  res.json(rows);
});

/** POST /admin/api/attempts/:phone/grant - Grant more login chances */
router.post('/api/attempts/:phone/grant', (req, res) => {
  const phone = decodeURIComponent(req.params.phone);
  const extra = parseInt(req.body?.extra || '3', 10);
  attemptsService.grantMoreChances(phone, extra);
  logger.info(`Admin granted ${extra} more chances to ${phone}`);
  res.json({ success: true });
});

// ============================================================================
// SETTINGS
// ============================================================================

/** GET /admin/api/settings - Get all settings */
router.get('/api/settings', (req, res) => {
  const rows = db.prepare('SELECT * FROM admin_settings').all();
  const settings = {};
  for (const row of rows) settings[row.key] = row.value;
  res.json(settings);
});

/** PUT /admin/api/settings - Update settings */
router.put('/api/settings', express.json(), (req, res) => {
  const upsert = db.prepare('INSERT OR REPLACE INTO admin_settings (key, value) VALUES (?, ?)');
  const updateMany = db.transaction((entries) => {
    for (const [key, value] of entries) upsert.run(key, String(value));
  });
  updateMany(Object.entries(req.body));
  logger.info('Admin updated settings:', Object.keys(req.body).join(', '));
  res.json({ success: true });
});

// ============================================================================
// ERRORS
// ============================================================================

/** GET /admin/api/errors - Get error log (paginated) */
router.get('/api/errors', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
  const offset = parseInt(req.query.offset || '0', 10);
  const rows = db.prepare('SELECT * FROM errors ORDER BY timestamp DESC LIMIT ? OFFSET ?').all(limit, offset);
  const total = db.prepare('SELECT COUNT(*) as count FROM errors').get().count;
  res.json({ rows, total });
});

/** DELETE /admin/api/errors - Clear error log */
router.delete('/api/errors', (req, res) => {
  db.prepare('DELETE FROM errors').run();
  res.json({ success: true });
});

// ============================================================================
// UNKNOWN MACS
// ============================================================================

/** GET /admin/api/unknown-macs - List unknown MACs */
router.get('/api/unknown-macs', (req, res) => {
  const rows = db.prepare('SELECT * FROM unknown_macs ORDER BY last_seen DESC').all();
  res.json(rows);
});

/** POST /admin/api/unknown-macs/:id/tag - Tag an unknown MAC */
router.post('/api/unknown-macs/:id/tag', express.json(), (req, res) => {
  const { tag } = req.body;
  if (!tag) return res.status(400).json({ error: 'Tag required' });
  db.prepare('UPDATE unknown_macs SET tagged = ? WHERE id = ?').run(tag, req.params.id);
  res.json({ success: true });
});

/** DELETE /admin/api/unknown-macs/:id - Remove an unknown MAC entry */
router.delete('/api/unknown-macs/:id', (req, res) => {
  db.prepare('DELETE FROM unknown_macs WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
