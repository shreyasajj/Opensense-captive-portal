const express = require('express');
const db = require('../db/init');
const config = require('../config');
const logger = require('../services/logger');

const router = express.Router();

// Presence threshold: device seen within last 2 minutes = home
const PRESENCE_THRESHOLD_MS = 2 * 60 * 1000;

function parseTimestamp(ts) {
  if (!ts) return 0;
  // DB stores either ISO with Z or datetime('now') without Z
  return new Date(ts.endsWith('Z') ? ts : ts + 'Z').getTime();
}

/**
 * Token auth middleware for HA endpoints.
 * Accepts: Authorization: Bearer <token>  or  ?token=<token>
 */
function tokenAuth(req, res, next) {
  const token = config.haApiToken;
  if (!token) {
    return res.status(503).json({ error: 'Home Assistant API not configured. Set HA_API_TOKEN.' });
  }

  const auth = req.headers.authorization;
  const provided = auth && auth.startsWith('Bearer ')
    ? auth.slice(7)
    : req.query.token;

  if (!provided || provided !== token) {
    return res.status(401).json({ error: 'Invalid or missing API token' });
  }

  next();
}

router.use(tokenAuth);

// ============================================================================
// GET /api/ha/status — Overview dashboard for HA sensors
// ============================================================================

router.get('/status', (req, res) => {
  const now = Date.now();

  const totalPersons = db.prepare('SELECT COUNT(*) as c FROM persons').get().c;
  const totalDevices = db.prepare('SELECT COUNT(*) as c FROM devices').get().c;
  const approvedDevices = db.prepare('SELECT COUNT(*) as c FROM devices WHERE approved = 1').get().c;
  const pendingDevices = db.prepare('SELECT COUNT(*) as c FROM devices WHERE approved = 0').get().c;
  const unknownMacs = db.prepare('SELECT COUNT(*) as c FROM unknown_macs').get().c;
  const errorCount = db.prepare('SELECT COUNT(*) as c FROM errors').get().c;

  // Locked accounts (exhausted attempts)
  const lockedAttempts = db.prepare('SELECT COUNT(*) as c FROM login_attempts WHERE locked = 1').get().c;
  const totalAttemptRecords = db.prepare('SELECT COUNT(*) as c FROM login_attempts').get().c;

  // Online devices (seen within threshold)
  const allDevices = db.prepare('SELECT last_seen FROM devices').all();
  const onlineDevices = allDevices.filter(
    (d) => d.last_seen && now - parseTimestamp(d.last_seen) < PRESENCE_THRESHOLD_MS
  ).length;

  // Persons currently home (have at least one presence tracker online)
  const trackers = db.prepare(`
    SELECT d.last_seen, d.person_id, p.name
    FROM devices d JOIN persons p ON d.person_id = p.id
    WHERE d.is_presence_tracker = 1
  `).all();
  const personsHome = trackers.filter(
    (t) => t.last_seen && now - parseTimestamp(t.last_seen) < PRESENCE_THRESHOLD_MS
  ).length;

  res.json({
    persons: {
      total: totalPersons,
      home: personsHome,
      away: totalPersons - personsHome,
    },
    devices: {
      total: totalDevices,
      approved: approvedDevices,
      pending: pendingDevices,
      online: onlineDevices,
      offline: totalDevices - onlineDevices,
    },
    login_attempts: {
      locked_accounts: lockedAttempts,
      total_tracked: totalAttemptRecords,
    },
    unknown_macs: unknownMacs,
    errors: errorCount,
  });
});

// ============================================================================
// GET /api/ha/persons — Per-person presence and device details
// ============================================================================

router.get('/persons', (req, res) => {
  const now = Date.now();

  const persons = db.prepare('SELECT id, phone, name, birthday, created_at FROM persons ORDER BY name').all();
  const getDevices = db.prepare('SELECT id, mac_address, device_type, is_presence_tracker, approved, last_seen FROM devices WHERE person_id = ?');

  const result = persons.map((p) => {
    const devices = getDevices.all(p.id).map((d) => {
      const online = d.last_seen && now - parseTimestamp(d.last_seen) < PRESENCE_THRESHOLD_MS;
      return { ...d, online };
    });

    const tracker = devices.find((d) => d.is_presence_tracker);
    const home = tracker ? tracker.online : devices.some((d) => d.online);

    return {
      id: p.id,
      name: p.name,
      phone: p.phone,
      home,
      device_count: devices.length,
      devices,
    };
  });

  res.json(result);
});

// ============================================================================
// GET /api/ha/persons/:id — Single person detail
// ============================================================================

router.get('/persons/:id', (req, res) => {
  const now = Date.now();
  const person = db.prepare('SELECT id, phone, name, birthday, created_at FROM persons WHERE id = ?').get(req.params.id);
  if (!person) return res.status(404).json({ error: 'Person not found' });

  const devices = db.prepare('SELECT id, mac_address, device_type, is_presence_tracker, approved, last_seen FROM devices WHERE person_id = ?')
    .all(person.id)
    .map((d) => {
      const online = d.last_seen && now - parseTimestamp(d.last_seen) < PRESENCE_THRESHOLD_MS;
      return { ...d, online };
    });

  const tracker = devices.find((d) => d.is_presence_tracker);
  const home = tracker ? tracker.online : devices.some((d) => d.online);

  res.json({ ...person, home, devices });
});

// ============================================================================
// GET /api/ha/attempts — Locked accounts needing attention
// ============================================================================

router.get('/attempts', (req, res) => {
  const rows = db.prepare('SELECT phone_number, attempts, max_attempts, locked, last_attempt FROM login_attempts ORDER BY locked DESC, last_attempt DESC').all();

  res.json(rows.map((r) => ({
    phone: r.phone_number,
    attempts: r.attempts,
    max_attempts: r.max_attempts,
    locked: !!r.locked,
    needs_refill: r.attempts >= r.max_attempts,
    last_attempt: r.last_attempt,
  })));
});

module.exports = router;
