const path = require('path');
const fs = require('fs');

// Must set env BEFORE requiring any app modules
const testDbPath = path.join(__dirname, '..', '..', 'db', 'test-integration.db');

// Clean up any previous test db
for (const suffix of ['', '-wal', '-shm']) {
  const f = testDbPath + suffix;
  if (fs.existsSync(f)) fs.unlinkSync(f);
}

process.env.DB_PATH = testDbPath;
process.env.SESSION_SECRET = 'test-secret';
process.env.NEXTCLOUD_URL = 'https://nextcloud.test.local';
process.env.NEXTCLOUD_USER = 'testuser';
process.env.NEXTCLOUD_PASSWORD = 'testpass';
process.env.MAX_LOGIN_ATTEMPTS = '3';
// Disable OPNsense so no real connections are made
delete process.env.OPNSENSE_URL;
delete process.env.OPNSENSE_API_KEY;
delete process.env.OPNSENSE_API_SECRET;

const express = require('express');
const session = require('express-session');
const db = require('../../db/init');

function createApp() {
  const app = express();

  app.set('trust proxy', 1);

  app.use(
    session({
      secret: 'test-secret',
      resave: false,
      saveUninitialized: false,
      cookie: { maxAge: 30 * 60 * 1000, httpOnly: true, sameSite: 'lax' },
    })
  );

  app.use('/admin/api', express.json());
  app.use('/', require('../../routes/handoff'));
  app.use('/', require('../../routes/portal'));
  app.use('/admin', require('../../routes/admin'));
  app.use('/api/ha', require('../../routes/ha'));

  app.use((err, req, res, _next) => {
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

function cleanDb() {
  db.prepare('DELETE FROM devices').run();
  db.prepare('DELETE FROM persons').run();
  db.prepare('DELETE FROM handoff_tokens').run();
  db.prepare('DELETE FROM login_attempts').run();
  db.prepare('DELETE FROM errors').run();
  db.prepare('DELETE FROM unknown_macs').run();
  db.prepare("INSERT OR REPLACE INTO admin_settings (key, value) VALUES ('default_allow', 'true')").run();
}

function closeDb() {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    const f = testDbPath + suffix;
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}

module.exports = { createApp, db, cleanDb, closeDb };
