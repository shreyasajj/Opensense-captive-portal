/**
 * OPNsense Integration Module
 * Handles MAC whitelist management via OPNsense Captive Portal API
 */
const https = require('https');
const http = require('http');
const logger = require('./logger');
const db = require('../db/init');

class OPNsenseError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'OPNsenseError';
    this.code = code;
    this.details = details;
  }
}

const ErrorCodes = {
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  INVALID_MAC: 'INVALID_MAC',
  CONNECTION_FAILED: 'CONNECTION_FAILED',
  ZONE_NOT_FOUND: 'ZONE_NOT_FOUND',
  ZONE_CONFIG_FAILED: 'ZONE_CONFIG_FAILED',
  UPDATE_FAILED: 'UPDATE_FAILED',
  RECONFIGURE_FAILED: 'RECONFIGURE_FAILED',
};

// Simple async lock to prevent race conditions
class AsyncLock {
  constructor() {
    this.locked = false;
    this.queue = [];
  }
  async acquire() {
    return new Promise((resolve) => {
      if (!this.locked) { this.locked = true; resolve(); }
      else { this.queue.push(resolve); }
    });
  }
  release() {
    if (this.queue.length > 0) this.queue.shift()();
    else this.locked = false;
  }
  async withLock(fn) {
    await this.acquire();
    try { return await fn(); }
    finally { this.release(); }
  }
}

const opnsenseLock = new AsyncLock();

function getConfig(contentType = false) {
  const config = {
    url: process.env.OPNSENSE_URL,
    apiKey: process.env.OPNSENSE_API_KEY,
    apiSecret: process.env.OPNSENSE_API_SECRET,
    zoneId: process.env.OPNSENSE_ZONE_ID || '0',
    verifySsl: process.env.OPNSENSE_VERIFY_SSL === 'true',
    contentType,
    enabled: false,
  };
  if (config.url && config.apiKey && config.apiSecret) {
    config.enabled = true;
    config.auth = 'Basic ' + Buffer.from(`${config.apiKey}:${config.apiSecret}`).toString('base64');
  }
  return config;
}

async function opnsenseFetch(url, options, config) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === 'https:';
    const lib = isHttps ? https : http;

    const headers = { Authorization: config.auth, ...options.headers };
    if (config.contentType) headers['Content-Type'] = 'application/json';

    const reqOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers,
      rejectUnauthorized: config.verifySsl,
      timeout: 30000,
    };

    const req = lib.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          json: () => {
            try { return Promise.resolve(JSON.parse(data)); }
            catch (e) { return Promise.reject(new OPNsenseError(`Invalid JSON: ${data.substring(0, 100)}`, ErrorCodes.CONNECTION_FAILED)); }
          },
          text: () => Promise.resolve(data),
        });
      });
    });

    req.on('error', (error) => reject(new OPNsenseError(`Connection failed: ${error.message}`, ErrorCodes.CONNECTION_FAILED)));
    req.on('timeout', () => { req.destroy(); reject(new OPNsenseError('Connection timed out', ErrorCodes.CONNECTION_FAILED)); });
    if (options.body) req.write(options.body);
    req.end();
  });
}

function normalizeMacAddress(mac) {
  if (!mac) return null;
  const clean = mac.toUpperCase().replace(/[^A-F0-9]/g, '');
  if (clean.length !== 12) return null;
  return clean.match(/.{2}/g).join(':');
}

function extractMacAddresses(zoneConfig) {
  const allowedMACs = zoneConfig?.zone?.allowedMACAddresses || {};
  const macs = [];
  for (const [key, value] of Object.entries(allowedMACs)) {
    if (key && key !== '' && value?.selected === 1) {
      const normalized = normalizeMacAddress(key);
      if (normalized) macs.push(normalized);
    }
  }
  return macs;
}

function buildZoneUpdatePayload(zoneConfig, newMacList) {
  const zone = zoneConfig.zone;
  const getSelectedValue = (obj) => {
    if (typeof obj === 'string') return obj;
    if (typeof obj !== 'object' || obj === null) return '';
    for (const [key, value] of Object.entries(obj)) {
      if (value?.selected === 1) return key;
    }
    return '';
  };
  const getSelectedValues = (obj) => {
    if (typeof obj === 'string') return obj;
    if (typeof obj !== 'object' || obj === null) return '';
    const selected = [];
    for (const [key, value] of Object.entries(obj)) {
      if (value?.selected === 1 && key !== '') selected.push(key);
    }
    return selected.join(',');
  };
  return {
    zone: {
      enabled: zone.enabled || '1',
      interfaces: getSelectedValues(zone.interfaces),
      disableRules: zone.disableRules || '0',
      authservers: getSelectedValues(zone.authservers),
      alwaysSendAccountingReqs: zone.alwaysSendAccountingReqs || '0',
      authEnforceGroup: getSelectedValue(zone.authEnforceGroup),
      idletimeout: zone.idletimeout || '0',
      hardtimeout: zone.hardtimeout || '0',
      concurrentlogins: zone.concurrentlogins || '1',
      certificate: getSelectedValue(zone.certificate),
      servername: zone.servername || '',
      allowedAddresses: getSelectedValues(zone.allowedAddresses),
      allowedMACAddresses: newMacList.join(','),
      extendedPreAuthData: zone.extendedPreAuthData || '0',
      template: getSelectedValue(zone.template),
      description: zone.description || '',
    },
  };
}

async function getZoneUUID(config) {
  const response = await opnsenseFetch(`${config.url}/api/captiveportal/settings/search_zones`, { method: 'POST' }, config);
  if (!response.ok) throw new OPNsenseError(`Failed to search zones: HTTP ${response.status}`, ErrorCodes.ZONE_NOT_FOUND);
  const data = await response.json();
  const zone = data.rows?.find((z) => z.zoneid === config.zoneId);
  if (!zone) throw new OPNsenseError(`Zone "${config.zoneId}" not found`, ErrorCodes.ZONE_NOT_FOUND);
  return zone.uuid;
}

async function getZoneConfig(config, zoneUUID) {
  const response = await opnsenseFetch(`${config.url}/api/captiveportal/settings/get_zone/${zoneUUID}`, { method: 'GET' }, config);
  if (!response.ok) throw new OPNsenseError(`Failed to get zone config: HTTP ${response.status}`, ErrorCodes.ZONE_CONFIG_FAILED);
  const zoneConfig = await response.json();
  if (!zoneConfig?.zone) throw new OPNsenseError('Invalid zone config response', ErrorCodes.ZONE_CONFIG_FAILED);
  return zoneConfig;
}

async function updateZoneConfig(config, zoneUUID, payload) {
  const response = await opnsenseFetch(
    `${config.url}/api/captiveportal/settings/set_zone/${zoneUUID}`,
    { method: 'POST', body: JSON.stringify(payload) },
    config
  );
  if (!response.ok) throw new OPNsenseError(`Failed to update zone: HTTP ${response.status}`, ErrorCodes.UPDATE_FAILED);
  const result = await response.json();
  if (result.validations && Object.keys(result.validations).length > 0) {
    throw new OPNsenseError(`Validation failed: ${JSON.stringify(result.validations)}`, ErrorCodes.UPDATE_FAILED);
  }
  return true;
}

async function reconfigureCaptivePortal(config) {
  const response = await opnsenseFetch(`${config.url}/api/captiveportal/service/reconfigure`, { method: 'POST' }, config);
  if (!response.ok) throw new OPNsenseError(`Reconfigure failed: HTTP ${response.status}`, ErrorCodes.RECONFIGURE_FAILED);
  const result = await response.json();
  if (result.status !== 'ok') throw new OPNsenseError(`Reconfigure error: ${JSON.stringify(result)}`, ErrorCodes.RECONFIGURE_FAILED);
  logger.info('Captive portal reconfigured');
  return true;
}

/**
 * Add MAC to OPNsense whitelist
 */
async function allowMac(mac) {
  const config = getConfig();
  const contentConfig = getConfig(true);
  if (!config.enabled) {
    logger.info('OPNsense not configured - skipping MAC whitelist');
    return { success: true, skipped: true };
  }
  const normalized = normalizeMacAddress(mac);
  if (!normalized) throw new OPNsenseError(`Invalid MAC: ${mac}`, ErrorCodes.INVALID_MAC);

  return opnsenseLock.withLock(async () => {
    const zoneUUID = await getZoneUUID(config);
    const zoneConfig = await getZoneConfig(config, zoneUUID);
    const currentMacs = extractMacAddresses(zoneConfig);

    if (currentMacs.includes(normalized)) {
      logger.info(`MAC ${normalized} already whitelisted`);
      return { success: true, alreadyExists: true };
    }

    const newMacList = [...currentMacs, normalized];
    const payload = buildZoneUpdatePayload(zoneConfig, newMacList);
    await updateZoneConfig(contentConfig, zoneUUID, payload);
    await reconfigureCaptivePortal(config);

    logger.info(`Added MAC ${normalized} to whitelist`);
    return { success: true };
  });
}

/**
 * Remove MAC from OPNsense whitelist
 */
async function revokeMac(mac) {
  const config = getConfig();
  const contentConfig = getConfig(true);
  if (!config.enabled) return { success: true, skipped: true };

  const normalized = normalizeMacAddress(mac);
  if (!normalized) throw new OPNsenseError(`Invalid MAC: ${mac}`, ErrorCodes.INVALID_MAC);

  return opnsenseLock.withLock(async () => {
    const zoneUUID = await getZoneUUID(config);
    const zoneConfig = await getZoneConfig(config, zoneUUID);
    const currentMacs = extractMacAddresses(zoneConfig);

    if (!currentMacs.includes(normalized)) {
      logger.info(`MAC ${normalized} not in whitelist`);
      return { success: true, notFound: true };
    }

    const newMacList = currentMacs.filter((m) => m !== normalized);
    const payload = buildZoneUpdatePayload(zoneConfig, newMacList);
    await updateZoneConfig(contentConfig, zoneUUID, payload);
    await reconfigureCaptivePortal(config);

    logger.info(`Removed MAC ${normalized} from whitelist`);
    return { success: true };
  });
}

/**
 * Get whitelisted MACs from OPNsense
 */
async function getWhitelistedMacs() {
  const config = getConfig();
  if (!config.enabled) return { success: true, macs: [], skipped: true };
  const zoneUUID = await getZoneUUID(config);
  const zoneConfig = await getZoneConfig(config, zoneUUID);
  return { success: true, macs: extractMacAddresses(zoneConfig) };
}

/**
 * Get ARP table for presence detection
 */
async function getArpTable() {
  const config = getConfig();
  if (!config.enabled) return [];
  try {
    const response = await opnsenseFetch(`${config.url}/api/diagnostics/interface/getArp`, { method: 'GET' }, config);
    if (!response.ok) { logger.error('Failed to get ARP table:', response.status); return []; }
    const data = await response.json();
    const entries = data.rows || data.arp || [];
    const macs = [];
    for (const entry of entries) {
      if (entry.mac && entry.expired !== '1' && entry.expired !== true) {
        const n = normalizeMacAddress(entry.mac);
        if (n) macs.push(n);
      }
    }
    return macs;
  } catch (error) {
    logger.error('Error getting ARP table:', error.message);
    return [];
  }
}

function logError(type, message, details = '') {
  try {
    db.prepare('INSERT INTO errors (type, message, details) VALUES (?, ?, ?)').run(type, message, typeof details === 'string' ? details : JSON.stringify(details));
  } catch (e) {
    logger.error('Failed to log error to DB:', e.message);
  }
}

module.exports = {
  OPNsenseError,
  ErrorCodes,
  normalizeMacAddress,
  allowMac,
  revokeMac,
  getWhitelistedMacs,
  getArpTable,
  logError,
};
