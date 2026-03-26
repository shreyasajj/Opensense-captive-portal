const path = require('path');

// Set test DB before any imports that use it
process.env.DB_PATH = path.join(__dirname, '..', '..', 'db', 'test-attempts.db');
process.env.MAX_LOGIN_ATTEMPTS = '3';

const fs = require('fs');
const dbPath = process.env.DB_PATH;

// Clean before import
for (const suffix of ['', '-wal', '-shm']) {
  const f = dbPath + suffix;
  if (fs.existsSync(f)) fs.unlinkSync(f);
}

const db = require('../../db/init');
const attempts = require('../../services/attempts');

afterAll(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    const f = dbPath + suffix;
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
});

beforeEach(() => {
  db.prepare('DELETE FROM login_attempts').run();
});

describe('checkAttempts', () => {
  test('returns allowed for new phone number', () => {
    const result = attempts.checkAttempts('555-111-0000');
    expect(result.allowed).toBe(true);
    expect(result.attempts).toBe(0);
    expect(result.remaining).toBe(3);
  });

  test('returns correct remaining after some attempts', () => {
    attempts.incrementAttempts('555-111-0001');
    const result = attempts.checkAttempts('555-111-0001');
    expect(result.allowed).toBe(true);
    expect(result.attempts).toBe(1);
    expect(result.remaining).toBe(2);
  });
});

describe('incrementAttempts', () => {
  test('creates record on first failure', () => {
    const result = attempts.incrementAttempts('555-222-0000');
    expect(result.attempts).toBe(1);
    expect(result.remaining).toBe(2);
    expect(result.allowed).toBe(true);
  });

  test('increments existing record', () => {
    attempts.incrementAttempts('555-222-0001');
    const result = attempts.incrementAttempts('555-222-0001');
    expect(result.attempts).toBe(2);
    expect(result.remaining).toBe(1);
  });

  test('locks after max attempts reached', () => {
    attempts.incrementAttempts('555-222-0002');
    attempts.incrementAttempts('555-222-0002');
    const result = attempts.incrementAttempts('555-222-0002');
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.locked).toBe(true);
  });
});

describe('resetAttempts', () => {
  test('removes attempt record', () => {
    attempts.incrementAttempts('555-333-0000');
    attempts.resetAttempts('555-333-0000');
    const result = attempts.checkAttempts('555-333-0000');
    expect(result.allowed).toBe(true);
    expect(result.attempts).toBe(0);
  });

  test('no-op for unknown phone', () => {
    expect(() => attempts.resetAttempts('555-999-9999')).not.toThrow();
  });
});

describe('grantMoreChances', () => {
  test('unlocks and increases max attempts', () => {
    attempts.incrementAttempts('555-444-0000');
    attempts.incrementAttempts('555-444-0000');
    attempts.incrementAttempts('555-444-0000');
    // Should be locked now
    let result = attempts.checkAttempts('555-444-0000');
    expect(result.locked).toBe(true);

    attempts.grantMoreChances('555-444-0000', 3);
    result = attempts.checkAttempts('555-444-0000');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(3);
  });

  test('no-op for unknown phone', () => {
    expect(() => attempts.grantMoreChances('555-999-8888', 5)).not.toThrow();
  });
});
