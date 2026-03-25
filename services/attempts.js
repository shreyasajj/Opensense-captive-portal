/**
 * Login Attempt Tracking
 * Limits login attempts per phone number
 */
const db = require('../db/init');
const config = require('../config');

/**
 * Check if a phone number is allowed to attempt login
 */
function checkAttempts(phone) {
  const row = db.prepare('SELECT * FROM login_attempts WHERE phone_number = ?').get(phone);
  if (!row) {
    return { allowed: true, attempts: 0, remaining: config.maxLoginAttempts };
  }
  if (row.locked) {
    return { allowed: false, attempts: row.attempts, remaining: 0, locked: true };
  }
  const maxAttempts = row.max_attempts || config.maxLoginAttempts;
  const remaining = Math.max(0, maxAttempts - row.attempts);
  return { allowed: remaining > 0, attempts: row.attempts, remaining, locked: false };
}

/**
 * Increment failed attempts for a phone number
 */
function incrementAttempts(phone) {
  const existing = db.prepare('SELECT * FROM login_attempts WHERE phone_number = ?').get(phone);
  const maxAttempts = existing?.max_attempts || config.maxLoginAttempts;

  if (!existing) {
    db.prepare(
      'INSERT INTO login_attempts (phone_number, attempts, max_attempts, locked, last_attempt) VALUES (?, 1, ?, 0, datetime(\'now\'))'
    ).run(phone, maxAttempts);
  } else {
    const newAttempts = existing.attempts + 1;
    const locked = newAttempts >= maxAttempts ? 1 : 0;
    db.prepare(
      'UPDATE login_attempts SET attempts = ?, locked = ?, last_attempt = datetime(\'now\') WHERE phone_number = ?'
    ).run(newAttempts, locked, phone);
  }

  return checkAttempts(phone);
}

/**
 * Reset attempts on successful login
 */
function resetAttempts(phone) {
  db.prepare('DELETE FROM login_attempts WHERE phone_number = ?').run(phone);
}

/**
 * Admin: grant more chances (reset attempts, unlock)
 */
function grantMoreChances(phone, extraAttempts) {
  const existing = db.prepare('SELECT * FROM login_attempts WHERE phone_number = ?').get(phone);
  if (!existing) return;

  const newMax = existing.attempts + (extraAttempts || config.maxLoginAttempts);
  db.prepare(
    'UPDATE login_attempts SET locked = 0, max_attempts = ?, last_attempt = datetime(\'now\') WHERE phone_number = ?'
  ).run(newMax, phone);
}

module.exports = { checkAttempts, incrementAttempts, resetAttempts, grantMoreChances };
