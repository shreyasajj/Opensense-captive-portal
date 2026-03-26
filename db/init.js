const Database = require('better-sqlite3');
const path = require('path');
const logger = require('../services/logger');

const dbPath = process.env.DB_PATH || path.join(__dirname, 'portal.db');
const db = new Database(dbPath);

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS persons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT NOT NULL,
    name TEXT,
    birthday TEXT,
    nextcloud_uid TEXT,
    approved INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mac_address TEXT NOT NULL UNIQUE,
    person_id INTEGER NOT NULL,
    device_type TEXT NOT NULL DEFAULT 'other',
    is_presence_tracker INTEGER DEFAULT 0,
    approved INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    last_seen TEXT,
    FOREIGN KEY (person_id) REFERENCES persons(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS handoff_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT NOT NULL UNIQUE,
    mac_address TEXT NOT NULL,
    ip_address TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    used INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS login_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone_number TEXT NOT NULL UNIQUE,
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    locked INTEGER DEFAULT 0,
    last_attempt TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS admin_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS errors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT DEFAULT (datetime('now')),
    type TEXT,
    message TEXT,
    details TEXT
  );

  CREATE TABLE IF NOT EXISTS unknown_macs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mac_address TEXT NOT NULL UNIQUE,
    first_seen TEXT DEFAULT (datetime('now')),
    last_seen TEXT DEFAULT (datetime('now')),
    tagged TEXT DEFAULT 'untracked'
  );

  CREATE INDEX IF NOT EXISTS idx_devices_person ON devices(person_id);
  CREATE INDEX IF NOT EXISTS idx_devices_mac ON devices(mac_address);
  CREATE INDEX IF NOT EXISTS idx_login_attempts_phone ON login_attempts(phone_number);
  CREATE INDEX IF NOT EXISTS idx_unknown_macs_mac ON unknown_macs(mac_address);
`);

// Seed default settings
const insertSetting = db.prepare(
  'INSERT OR IGNORE INTO admin_settings (key, value) VALUES (?, ?)'
);
insertSetting.run('default_allow', 'true');

logger.info('Database initialized');

module.exports = db;
