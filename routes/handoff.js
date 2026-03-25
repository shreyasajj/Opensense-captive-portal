const express = require('express');
const crypto = require('crypto');
const db = require('../db/init');
const logger = require('../services/logger');
const { normalizeMacAddress, logError } = require('../services/opnsense');

const router = express.Router();

const TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * POST /api/create-handoff-token
 * Called from the OPNsense captive portal page to create a one-time token
 */
router.post('/api/create-handoff-token', express.json(), (req, res) => {
  try {
    const { mac, ip } = req.body;
    if (!mac || !ip) {
      return res.status(400).json({ error: 'mac and ip required' });
    }

    const normalized = normalizeMacAddress(mac);
    if (!normalized) {
      return res.status(400).json({ error: 'Invalid MAC address' });
    }

    const token = crypto.randomBytes(32).toString('hex');

    db.prepare(
      'INSERT INTO handoff_tokens (token, mac_address, ip_address) VALUES (?, ?, ?)'
    ).run(token, normalized, ip);

    logger.info(`Handoff token created for MAC ${normalized}`);
    res.json({ token });
  } catch (err) {
    logger.error('Create handoff token error:', err.message);
    logError('handoff', 'Failed to create token', err.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

/**
 * GET /handoff?token=xxx
 * Validates the one-time token, stores MAC in session, redirects to portal
 */
router.get('/handoff', (req, res) => {
  try {
    const { token } = req.query;
    if (!token) {
      return res.status(400).send(errorPage('Missing token'));
    }

    const row = db.prepare(
      'SELECT * FROM handoff_tokens WHERE token = ? AND used = 0'
    ).get(token);

    if (!row) {
      return res.status(400).send(errorPage('Invalid or expired token'));
    }

    // Check TTL
    const created = new Date(row.created_at + 'Z').getTime();
    if (Date.now() - created > TOKEN_TTL_MS) {
      db.prepare('UPDATE handoff_tokens SET used = 1 WHERE id = ?').run(row.id);
      return res.status(400).send(errorPage('Token expired'));
    }

    // Mark as used
    db.prepare('UPDATE handoff_tokens SET used = 1 WHERE id = ?').run(row.id);

    // Store in session
    req.session.mac_address = row.mac_address;
    req.session.ip_address = row.ip_address;
    req.session.handoff_at = new Date().toISOString();

    logger.info(`Handoff successful for MAC ${row.mac_address}`);
    res.redirect('/portal/');
  } catch (err) {
    logger.error('Handoff error:', err.message);
    logError('handoff', 'Handoff failed', err.message);
    res.status(500).send(errorPage('Something went wrong'));
  }
});

function errorPage(message) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Error</title><style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f3f4f6;}
.box{background:#fff;padding:40px;border-radius:16px;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,0.1);}
h1{color:#dc2626;font-size:1.5rem;}p{color:#6b7280;}</style></head>
<body><div class="box"><h1>Connection Error</h1><p>${message}</p></div></body></html>`;
}

module.exports = router;
