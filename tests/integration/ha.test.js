const request = require('supertest');
const { createApp, db, cleanDb, closeDb } = require('./testApp');

// Set HA token before app is created
process.env.HA_API_TOKEN = 'test-ha-token';

let app;

beforeAll(() => {
  app = createApp();
});

beforeEach(() => {
  cleanDb();
});

afterAll(() => {
  closeDb();
});

const authHeader = { Authorization: 'Bearer test-ha-token' };

describe('HA API authentication', () => {
  test('rejects requests without token', async () => {
    await request(app).get('/api/ha/status').expect(401);
  });

  test('rejects requests with wrong token', async () => {
    await request(app)
      .get('/api/ha/status')
      .set('Authorization', 'Bearer wrong-token')
      .expect(401);
  });

  test('accepts token via query param', async () => {
    await request(app)
      .get('/api/ha/status?token=test-ha-token')
      .expect(200);
  });
});

describe('GET /api/ha/status', () => {
  test('returns zeroed counts when empty', async () => {
    const res = await request(app)
      .get('/api/ha/status')
      .set(authHeader)
      .expect(200);

    expect(res.body.persons).toEqual({ total: 0, home: 0, away: 0 });
    expect(res.body.devices).toEqual({ total: 0, approved: 0, pending: 0, online: 0, offline: 0 });
    expect(res.body.login_attempts).toEqual({ locked_accounts: 0, total_tracked: 0 });
    expect(res.body.unknown_macs).toBe(0);
    expect(res.body.errors).toBe(0);
  });

  test('returns correct counts with data', async () => {
    db.prepare("INSERT INTO persons (phone, name) VALUES ('555-0001', 'Alice')").run();
    const person = db.prepare("SELECT id FROM persons WHERE phone = '555-0001'").get();

    db.prepare("INSERT INTO devices (mac_address, person_id, device_type, approved) VALUES ('AA:BB:CC:DD:EE:01', ?, 'phone', 1)").run(person.id);
    db.prepare("INSERT INTO devices (mac_address, person_id, device_type, approved) VALUES ('AA:BB:CC:DD:EE:02', ?, 'other', 0)").run(person.id);
    db.prepare("INSERT INTO login_attempts (phone_number, attempts, max_attempts, locked) VALUES ('555-0099', 3, 3, 1)").run();
    db.prepare("INSERT INTO unknown_macs (mac_address) VALUES ('FF:FF:FF:FF:FF:01')").run();

    const res = await request(app)
      .get('/api/ha/status')
      .set(authHeader)
      .expect(200);

    expect(res.body.persons.total).toBe(1);
    expect(res.body.devices.total).toBe(2);
    expect(res.body.devices.approved).toBe(1);
    expect(res.body.devices.pending).toBe(1);
    expect(res.body.login_attempts.locked_accounts).toBe(1);
    expect(res.body.unknown_macs).toBe(1);
  });
});

describe('GET /api/ha/persons', () => {
  test('returns persons with presence status', async () => {
    db.prepare("INSERT INTO persons (phone, name) VALUES ('555-0001', 'Alice')").run();
    const person = db.prepare("SELECT id FROM persons WHERE phone = '555-0001'").get();

    // Device seen just now = online
    const now = new Date().toISOString();
    db.prepare("INSERT INTO devices (mac_address, person_id, device_type, is_presence_tracker, approved, last_seen) VALUES ('AA:BB:CC:DD:EE:01', ?, 'phone', 1, 1, ?)").run(person.id, now);

    const res = await request(app)
      .get('/api/ha/persons')
      .set(authHeader)
      .expect(200);

    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('Alice');
    expect(res.body[0].home).toBe(true);
    expect(res.body[0].devices[0].online).toBe(true);
  });

  test('marks person as away when tracker not seen recently', async () => {
    db.prepare("INSERT INTO persons (phone, name) VALUES ('555-0002', 'Bob')").run();
    const person = db.prepare("SELECT id FROM persons WHERE phone = '555-0002'").get();

    // Device seen 10 minutes ago = offline
    const old = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    db.prepare("INSERT INTO devices (mac_address, person_id, device_type, is_presence_tracker, approved, last_seen) VALUES ('AA:BB:CC:DD:EE:02', ?, 'phone', 1, 1, ?)").run(person.id, old);

    const res = await request(app)
      .get('/api/ha/persons')
      .set(authHeader)
      .expect(200);

    expect(res.body[0].home).toBe(false);
    expect(res.body[0].devices[0].online).toBe(false);
  });
});

describe('GET /api/ha/persons/:id', () => {
  test('returns single person detail', async () => {
    db.prepare("INSERT INTO persons (phone, name) VALUES ('555-0001', 'Alice')").run();
    const person = db.prepare("SELECT id FROM persons WHERE phone = '555-0001'").get();

    const res = await request(app)
      .get(`/api/ha/persons/${person.id}`)
      .set(authHeader)
      .expect(200);

    expect(res.body.name).toBe('Alice');
    expect(res.body.devices).toEqual([]);
    expect(res.body.home).toBe(false);
  });

  test('returns 404 for unknown person', async () => {
    await request(app)
      .get('/api/ha/persons/99999')
      .set(authHeader)
      .expect(404);
  });
});

describe('GET /api/ha/attempts', () => {
  test('returns attempts with needs_refill flag', async () => {
    db.prepare("INSERT INTO login_attempts (phone_number, attempts, max_attempts, locked) VALUES ('555-0001', 3, 3, 1)").run();
    db.prepare("INSERT INTO login_attempts (phone_number, attempts, max_attempts, locked) VALUES ('555-0002', 1, 3, 0)").run();

    const res = await request(app)
      .get('/api/ha/attempts')
      .set(authHeader)
      .expect(200);

    expect(res.body).toHaveLength(2);

    const locked = res.body.find((a) => a.phone === '555-0001');
    expect(locked.locked).toBe(true);
    expect(locked.needs_refill).toBe(true);

    const active = res.body.find((a) => a.phone === '555-0002');
    expect(active.locked).toBe(false);
    expect(active.needs_refill).toBe(false);
  });
});
