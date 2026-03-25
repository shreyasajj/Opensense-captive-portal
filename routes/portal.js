const express = require('express');
const db = require('../db/init');
const carddav = require('../services/carddav');
const attempts = require('../services/attempts');
const opnsense = require('../services/opnsense');
const logger = require('../services/logger');

const router = express.Router();

/**
 * Middleware: require valid handoff session
 */
function requireHandoff(req, res, next) {
  if (!req.session.mac_address) {
    return res.status(403).json({ error: 'No valid session. Please connect through the WiFi portal.' });
  }
  next();
}

/**
 * POST /api/lookup
 * Look up a contact by phone number and birthday
 */
router.post('/api/lookup', requireHandoff, express.json(), async (req, res) => {
  try {
    const { phone, birthday } = req.body;
    if (!phone || !birthday) {
      return res.status(400).json({ error: 'Phone number and birthday are required' });
    }

    // Check login attempts
    const attemptStatus = attempts.checkAttempts(phone);
    if (!attemptStatus.allowed) {
      return res.json({
        found: false,
        locked: true,
        message: 'Too many failed attempts. Please contact an administrator.',
      });
    }

    // Search Nextcloud contacts
    let contacts;
    try {
      contacts = await carddav.searchByPhone(phone);
    } catch (err) {
      logger.error('CardDAV search error:', err.message);
      opnsense.logError('carddav', `Search failed for ${phone}`, err.message);
      return res.status(500).json({ error: 'Failed to search contacts. Please try again.' });
    }

    if (!contacts || contacts.length === 0) {
      const result = attempts.incrementAttempts(phone);
      return res.json({
        found: false,
        message: 'Contact not found.',
        remaining: result.remaining,
      });
    }

    // Find a contact whose birthday matches
    const matchedContact = contacts.find((c) => carddav.validateBirthday(c, birthday));

    if (!matchedContact) {
      const result = attempts.incrementAttempts(phone);
      return res.json({
        found: false,
        message: 'Birthday does not match.',
        remaining: result.remaining,
      });
    }

    // Success - reset attempts
    attempts.resetAttempts(phone);

    // Upsert person in our database
    const existing = db.prepare('SELECT * FROM persons WHERE phone = ?').get(phone);
    let personId;

    if (existing) {
      personId = existing.id;
      db.prepare('UPDATE persons SET name = ?, birthday = ?, nextcloud_uid = ?, updated_at = datetime(\'now\') WHERE id = ?')
        .run(matchedContact.name, matchedContact.birthday, matchedContact.uid, existing.id);
    } else {
      const result = db.prepare(
        'INSERT INTO persons (phone, name, birthday, nextcloud_uid, approved) VALUES (?, ?, ?, ?, 1)'
      ).run(phone, matchedContact.name, matchedContact.birthday, matchedContact.uid);
      personId = result.lastInsertRowid;
    }

    // Store person info in session for device registration
    req.session.personId = personId;
    req.session.personName = matchedContact.name;

    logger.info(`Contact found: ${matchedContact.name} (person ${personId})`);

    res.json({
      found: true,
      person: { id: personId, name: matchedContact.name },
    });
  } catch (err) {
    logger.error('Lookup error:', err.message);
    opnsense.logError('lookup', err.message, err.stack);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

/**
 * POST /api/register-device
 * Register the current device (MAC) for the authenticated person
 */
router.post('/api/register-device', requireHandoff, express.json(), async (req, res) => {
  try {
    const { deviceType } = req.body; // 'phone' or 'other'
    const personId = req.session.personId;
    const mac = req.session.mac_address;

    if (!personId) {
      return res.status(400).json({ error: 'Please look up your contact first.' });
    }
    if (!deviceType || !['phone', 'other'].includes(deviceType)) {
      return res.status(400).json({ error: 'Device type must be "phone" or "other".' });
    }

    const isPhone = deviceType === 'phone';

    // If this is a phone, override the previous phone for this person
    if (isPhone) {
      const oldPhone = db.prepare(
        'SELECT * FROM devices WHERE person_id = ? AND is_presence_tracker = 1'
      ).get(personId);

      if (oldPhone) {
        // Revoke old phone MAC from OPNsense
        try {
          await opnsense.revokeMac(oldPhone.mac_address);
        } catch (err) {
          logger.warn('Failed to revoke old phone MAC:', err.message);
        }
        db.prepare('DELETE FROM devices WHERE id = ?').run(oldPhone.id);
        logger.info(`Replaced old phone device (MAC: ${oldPhone.mac_address}) for person ${personId}`);
      }
    }

    // Check if this MAC is already registered
    const existingDevice = db.prepare('SELECT * FROM devices WHERE mac_address = ?').get(mac);
    if (existingDevice) {
      // Update existing device record
      db.prepare(
        'UPDATE devices SET person_id = ?, device_type = ?, is_presence_tracker = ?, approved = 1, last_seen = datetime(\'now\') WHERE id = ?'
      ).run(personId, deviceType, isPhone ? 1 : 0, existingDevice.id);
    } else {
      db.prepare(
        'INSERT INTO devices (mac_address, person_id, device_type, is_presence_tracker, approved) VALUES (?, ?, ?, ?, 1)'
      ).run(mac, personId, deviceType, isPhone ? 1 : 0);
    }

    // Check default_allow setting
    const setting = db.prepare("SELECT value FROM admin_settings WHERE key = 'default_allow'").get();
    const defaultAllow = setting?.value === 'true';

    let approved = false;

    if (defaultAllow) {
      // Auto-approve: add MAC to OPNsense whitelist
      try {
        await opnsense.allowMac(mac);
        db.prepare('UPDATE devices SET approved = 1 WHERE mac_address = ?').run(mac);
        approved = true;
      } catch (err) {
        logger.error('Failed to whitelist MAC:', err.message);
        opnsense.logError('whitelist', `Failed to add ${mac}`, err.message);
        // Still mark as approved in DB, admin can retry OPNsense later
        db.prepare('UPDATE devices SET approved = 1 WHERE mac_address = ?').run(mac);
        approved = true;
      }
    } else {
      // Check if person already has approved devices (returning user)
      const approvedDevices = db.prepare(
        'SELECT COUNT(*) as count FROM devices WHERE person_id = ? AND approved = 1 AND mac_address != ?'
      ).get(personId, mac);

      if (approvedDevices.count > 0) {
        // Returning user with approved devices - auto approve
        try { await opnsense.allowMac(mac); } catch (err) { logger.warn('MAC whitelist failed:', err.message); }
        db.prepare('UPDATE devices SET approved = 1 WHERE mac_address = ?').run(mac);
        approved = true;
      } else {
        // New person - needs admin approval
        db.prepare('UPDATE devices SET approved = 0 WHERE mac_address = ?').run(mac);
        approved = false;
      }
    }

    // Remove from unknown_macs if it was there
    db.prepare('DELETE FROM unknown_macs WHERE mac_address = ?').run(mac);

    logger.info(`Device registered: MAC ${mac}, type ${deviceType}, approved: ${approved}`);

    res.json({
      success: true,
      approved,
      message: approved
        ? 'You are now connected to WiFi!'
        : 'Your access request has been submitted. An administrator will approve it shortly.',
    });
  } catch (err) {
    logger.error('Register device error:', err.message);
    opnsense.logError('register_device', err.message, err.stack);
    res.status(500).json({ error: 'Failed to register device. Please try again.' });
  }
});

module.exports = router;
