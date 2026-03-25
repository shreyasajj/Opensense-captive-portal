/**
 * Presence Detection Service
 * Polls ARP table to track which devices are online
 */
const db = require('../db/init');
const opnsense = require('./opnsense');
const logger = require('./logger');
const config = require('../config');

let pollInterval = null;

/**
 * Single poll cycle: check ARP table and update device/unknown_mac records
 */
async function poll() {
  try {
    const arpMacs = await opnsense.getArpTable();
    if (arpMacs.length === 0) return;

    const now = new Date().toISOString();

    // Get all known device MACs
    const knownDevices = db.prepare('SELECT mac_address FROM devices').all();
    const knownSet = new Set(knownDevices.map((d) => d.mac_address));

    const updateDeviceSeen = db.prepare('UPDATE devices SET last_seen = ? WHERE mac_address = ?');
    const upsertUnknown = db.prepare(`
      INSERT INTO unknown_macs (mac_address, first_seen, last_seen, tagged)
      VALUES (?, ?, ?, 'untracked')
      ON CONFLICT(mac_address) DO UPDATE SET last_seen = ?
    `);

    const updateMany = db.transaction((macs) => {
      for (const mac of macs) {
        if (knownSet.has(mac)) {
          updateDeviceSeen.run(now, mac);
        } else {
          upsertUnknown.run(mac, now, now, now);
        }
      }
    });

    updateMany(arpMacs);
    logger.debug(`ARP poll: ${arpMacs.length} MACs seen, ${arpMacs.filter((m) => knownSet.has(m)).length} known`);
  } catch (err) {
    logger.error('Presence poll error:', err.message);
    opnsense.logError('presence_poll', err.message);
  }
}

/**
 * Start the polling loop
 */
function start() {
  if (pollInterval) return;
  const interval = config.arpPollInterval;
  logger.info(`Starting presence detection (interval: ${interval}ms)`);
  poll(); // Initial poll
  pollInterval = setInterval(poll, interval);
}

/**
 * Stop the polling loop
 */
function stop() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
    logger.info('Presence detection stopped');
  }
}

module.exports = { start, stop, poll };
