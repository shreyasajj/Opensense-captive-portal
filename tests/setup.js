const path = require('path');
const fs = require('fs');

module.exports = async function () {
  // Set test database path
  const testDbPath = path.join(__dirname, '..', 'db', 'test-portal.db');
  process.env.DB_PATH = testDbPath;

  // Provide dummy env vars so config doesn't break
  process.env.SESSION_SECRET = 'test-secret';
  process.env.NEXTCLOUD_URL = 'https://nextcloud.test.local';
  process.env.NEXTCLOUD_USER = 'testuser';
  process.env.NEXTCLOUD_PASSWORD = 'testpass';
  process.env.ADMIN_USER = 'admin';
  process.env.ADMIN_PASSWORD = 'admin';
  process.env.MAX_LOGIN_ATTEMPTS = '3';

  // Clean up any leftover test db
  for (const suffix of ['', '-wal', '-shm']) {
    const f = testDbPath + suffix;
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
};
