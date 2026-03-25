/**
 * Nextcloud CardDAV Integration
 * Searches contacts by phone number and validates birthday
 */
const https = require('https');
const http = require('http');
const config = require('../config');
const logger = require('./logger');

/**
 * Make a request to Nextcloud CardDAV
 */
function carddavRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const baseUrl = config.nextcloud.url;
    if (!baseUrl) {
      return reject(new Error('Nextcloud URL not configured'));
    }
    const urlObj = new URL(path, baseUrl);
    const isHttps = urlObj.protocol === 'https:';
    const lib = isHttps ? https : http;
    const auth = Buffer.from(`${config.nextcloud.user}:${config.nextcloud.password}`).toString('base64');

    const headers = {
      Authorization: `Basic ${auth}`,
      Depth: '1',
    };
    if (body) {
      headers['Content-Type'] = 'application/xml; charset=utf-8';
      headers['Content-Length'] = Buffer.byteLength(body);
    }

    const req = lib.request(
      {
        hostname: urlObj.hostname,
        port: urlObj.port || (isHttps ? 443 : 80),
        path: urlObj.pathname,
        method,
        headers,
        rejectUnauthorized: false,
        timeout: 15000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      }
    );

    req.on('error', (err) => reject(err));
    req.on('timeout', () => { req.destroy(); reject(new Error('CardDAV request timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

/**
 * Normalize phone number: strip everything except digits, handle country codes
 */
function normalizePhone(phone) {
  if (!phone) return '';
  // Remove all non-digit chars except leading +
  let digits = phone.replace(/[^\d+]/g, '');
  // Remove leading + and country code patterns
  digits = digits.replace(/^\+/, '');
  // Remove leading zeros
  digits = digits.replace(/^0+/, '');
  return digits;
}

/**
 * Parse a vCard string into an object with the fields we care about
 */
function parseVCard(vcardText) {
  const result = { phones: [], name: '', birthday: '', uid: '' };

  const lines = vcardText.replace(/\r\n /g, '').replace(/\r\n\t/g, '').split(/\r\n|\r|\n/);

  for (const line of lines) {
    const upper = line.toUpperCase();

    if (upper.startsWith('FN:') || upper.startsWith('FN;')) {
      result.name = line.substring(line.indexOf(':') + 1).trim();
    } else if (upper.startsWith('TEL:') || upper.startsWith('TEL;')) {
      const value = line.substring(line.indexOf(':') + 1).trim();
      if (value) result.phones.push(value);
    } else if (upper.startsWith('BDAY:') || upper.startsWith('BDAY;')) {
      result.birthday = line.substring(line.indexOf(':') + 1).trim();
    } else if (upper.startsWith('UID:') || upper.startsWith('UID;')) {
      result.uid = line.substring(line.indexOf(':') + 1).trim();
    }
  }

  return result;
}

/**
 * Extract month-day from a birthday string
 * Handles: YYYY-MM-DD, YYYYMMDD, --MMDD, --MM-DD, MM-DD
 */
function extractMonthDay(bdayStr) {
  if (!bdayStr) return null;
  const clean = bdayStr.trim();

  // --MMDD or --MM-DD
  if (clean.startsWith('--')) {
    const rest = clean.substring(2).replace(/-/g, '');
    if (rest.length >= 4) return { month: parseInt(rest.substring(0, 2), 10), day: parseInt(rest.substring(2, 4), 10) };
  }

  // YYYYMMDD
  if (/^\d{8}$/.test(clean)) {
    return { month: parseInt(clean.substring(4, 6), 10), day: parseInt(clean.substring(6, 8), 10) };
  }

  // YYYY-MM-DD
  const dashMatch = clean.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (dashMatch) {
    return { month: parseInt(dashMatch[2], 10), day: parseInt(dashMatch[3], 10) };
  }

  // MM-DD or MM/DD
  const shortMatch = clean.match(/^(\d{1,2})[\/\-](\d{1,2})$/);
  if (shortMatch) {
    return { month: parseInt(shortMatch[1], 10), day: parseInt(shortMatch[2], 10) };
  }

  return null;
}

/**
 * Search Nextcloud contacts by phone number using CardDAV REPORT
 */
async function searchByPhone(phoneNumber) {
  const addressbook = config.nextcloud.addressbook;
  const user = config.nextcloud.user;
  const davPath = `/remote.php/dav/addressbooks/users/${user}/${addressbook}/`;

  // CardDAV addressbook-query to search by TEL property
  const xmlBody = `<?xml version="1.0" encoding="UTF-8"?>
<C:addressbook-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
  <D:prop>
    <D:getetag/>
    <C:address-data/>
  </D:prop>
  <C:filter>
    <C:prop-filter name="TEL">
      <C:text-match collation="i;unicode-casemap" match-type="contains">${normalizePhone(phoneNumber)}</C:text-match>
    </C:prop-filter>
  </C:filter>
</C:addressbook-query>`;

  logger.debug('CardDAV searching for phone:', normalizePhone(phoneNumber));

  const response = await carddavRequest('REPORT', davPath, xmlBody);

  if (response.status !== 207 && response.status !== 200) {
    logger.error('CardDAV search failed:', response.status, response.body.substring(0, 200));
    throw new Error(`CardDAV search failed with status ${response.status}`);
  }

  // Parse the multistatus XML response to extract vCards
  const contacts = [];
  const vcardRegex = /BEGIN:VCARD[\s\S]*?END:VCARD/g;
  let match;
  while ((match = vcardRegex.exec(response.body)) !== null) {
    const parsed = parseVCard(match[0]);
    // Verify this contact actually has the phone number we searched for
    const normalizedSearch = normalizePhone(phoneNumber);
    const hasPhone = parsed.phones.some((p) => normalizePhone(p).includes(normalizedSearch) || normalizedSearch.includes(normalizePhone(p)));
    if (hasPhone) {
      contacts.push(parsed);
    }
  }

  logger.info(`CardDAV found ${contacts.length} contacts for phone ${phoneNumber}`);
  return contacts;
}

/**
 * Validate that a contact's birthday matches the provided one
 * @param {object} contact - parsed vCard contact
 * @param {string} inputBirthday - user input in YYYY-MM-DD or MM-DD format
 * @returns {boolean}
 */
function validateBirthday(contact, inputBirthday) {
  const contactBday = extractMonthDay(contact.birthday);
  const inputBday = extractMonthDay(inputBirthday);

  if (!contactBday || !inputBday) {
    logger.warn('Could not parse birthday for validation', { contact: contact.birthday, input: inputBirthday });
    return false;
  }

  return contactBday.month === inputBday.month && contactBday.day === inputBday.day;
}

module.exports = {
  searchByPhone,
  validateBirthday,
  normalizePhone,
  parseVCard,
  extractMonthDay,
};
