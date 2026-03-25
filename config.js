require('dotenv').config();

module.exports = {
  port: parseInt(process.env.PORT || '3000', 10),
  sessionSecret: process.env.SESSION_SECRET || 'change-me',

  nextcloud: {
    url: process.env.NEXTCLOUD_URL,
    user: process.env.NEXTCLOUD_USER,
    password: process.env.NEXTCLOUD_PASSWORD,
    addressbook: process.env.NEXTCLOUD_ADDRESSBOOK || 'contacts',
  },

  opnsense: {
    url: process.env.OPNSENSE_URL,
    apiKey: process.env.OPNSENSE_API_KEY,
    apiSecret: process.env.OPNSENSE_API_SECRET,
    zoneId: process.env.OPNSENSE_ZONE_ID || '0',
    verifySsl: process.env.OPNSENSE_VERIFY_SSL === 'true',
  },

  admin: {
    user: process.env.ADMIN_USER || 'admin',
    password: process.env.ADMIN_PASSWORD || 'admin',
  },

  arpPollInterval: parseInt(process.env.ARP_POLL_INTERVAL_MS || '60000', 10),
  maxLoginAttempts: parseInt(process.env.MAX_LOGIN_ATTEMPTS || '3', 10),
};
