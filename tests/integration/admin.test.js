const request = require('supertest');
const { createApp, db, cleanDb, closeDb } = require('./testApp');

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

describe('GET /admin/api/persons', () => {
  test('returns empty list initially', async () => {
    const res = await request(app)
      .get('/admin/api/persons')
      .expect(200);

    expect(res.body).toEqual([]);
  });

  test('returns persons with their devices', async () => {
    // Seed a person
    db.prepare(
      "INSERT INTO persons (phone, name, birthday) VALUES ('555-0001', 'Alice', '1990-01-01')"
    ).run();
    const person = db.prepare("SELECT * FROM persons WHERE phone = '555-0001'").get();

    db.prepare(
      "INSERT INTO devices (mac_address, person_id, device_type, approved) VALUES ('AA:BB:CC:DD:EE:01', ?, 'phone', 1)"
    ).run(person.id);

    const res = await request(app)
      .get('/admin/api/persons')
      .expect(200);

    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('Alice');
    expect(res.body[0].devices).toHaveLength(1);
    expect(res.body[0].devices[0].mac_address).toBe('AA:BB:CC:DD:EE:01');
  });
});

describe('DELETE /admin/api/persons/:id', () => {
  test('deletes a person and their devices', async () => {
    db.prepare(
      "INSERT INTO persons (phone, name) VALUES ('555-0002', 'Bob')"
    ).run();
    const person = db.prepare("SELECT * FROM persons WHERE phone = '555-0002'").get();

    db.prepare(
      "INSERT INTO devices (mac_address, person_id, device_type) VALUES ('AA:BB:CC:DD:EE:02', ?, 'phone')"
    ).run(person.id);

    const res = await request(app)
      .delete(`/admin/api/persons/${person.id}`)
      .expect(200);

    expect(res.body.success).toBe(true);

    // Verify cascade delete
    const devices = db.prepare('SELECT * FROM devices WHERE person_id = ?').all(person.id);
    expect(devices).toHaveLength(0);
  });

  test('returns 404 for non-existent person', async () => {
    await request(app)
      .delete('/admin/api/persons/99999')
      .expect(404);
  });
});

describe('GET /admin/api/devices', () => {
  test('returns all devices with person info', async () => {
    db.prepare(
      "INSERT INTO persons (phone, name) VALUES ('555-0003', 'Carol')"
    ).run();
    const person = db.prepare("SELECT * FROM persons WHERE phone = '555-0003'").get();

    db.prepare(
      "INSERT INTO devices (mac_address, person_id, device_type, approved) VALUES ('AA:BB:CC:DD:EE:03', ?, 'other', 0)"
    ).run(person.id);

    const res = await request(app)
      .get('/admin/api/devices')
      .expect(200);

    expect(res.body).toHaveLength(1);
    expect(res.body[0].person_name).toBe('Carol');
  });
});

describe('POST /admin/api/devices/:id/approve', () => {
  test('approves a pending device', async () => {
    db.prepare(
      "INSERT INTO persons (phone, name) VALUES ('555-0004', 'Dave')"
    ).run();
    const person = db.prepare("SELECT * FROM persons WHERE phone = '555-0004'").get();

    db.prepare(
      "INSERT INTO devices (mac_address, person_id, device_type, approved) VALUES ('AA:BB:CC:DD:EE:04', ?, 'phone', 0)"
    ).run(person.id);
    const device = db.prepare("SELECT * FROM devices WHERE mac_address = 'AA:BB:CC:DD:EE:04'").get();

    const res = await request(app)
      .post(`/admin/api/devices/${device.id}/approve`)
      .expect(200);

    expect(res.body.success).toBe(true);

    const updated = db.prepare('SELECT * FROM devices WHERE id = ?').get(device.id);
    expect(updated.approved).toBe(1);
  });
});

describe('POST /admin/api/devices/:id/set-phone', () => {
  test('sets a device as presence tracker', async () => {
    db.prepare(
      "INSERT INTO persons (phone, name) VALUES ('555-0005', 'Eve')"
    ).run();
    const person = db.prepare("SELECT * FROM persons WHERE phone = '555-0005'").get();

    db.prepare(
      "INSERT INTO devices (mac_address, person_id, device_type, is_presence_tracker) VALUES ('AA:BB:CC:DD:EE:05', ?, 'other', 0)"
    ).run(person.id);
    const device = db.prepare("SELECT * FROM devices WHERE mac_address = 'AA:BB:CC:DD:EE:05'").get();

    await request(app)
      .post(`/admin/api/devices/${device.id}/set-phone`)
      .expect(200);

    const updated = db.prepare('SELECT * FROM devices WHERE id = ?').get(device.id);
    expect(updated.is_presence_tracker).toBe(1);
    expect(updated.device_type).toBe('phone');
  });
});

describe('Login attempts admin API', () => {
  test('GET /admin/api/attempts returns attempt records', async () => {
    db.prepare(
      "INSERT INTO login_attempts (phone_number, attempts, max_attempts, locked) VALUES ('555-0006', 2, 3, 0)"
    ).run();

    const res = await request(app)
      .get('/admin/api/attempts')
      .expect(200);

    expect(res.body).toHaveLength(1);
    expect(res.body[0].phone_number).toBe('555-0006');
  });

  test('POST /admin/api/attempts/:phone/grant unlocks and grants more chances', async () => {
    db.prepare(
      "INSERT INTO login_attempts (phone_number, attempts, max_attempts, locked) VALUES ('555-0007', 3, 3, 1)"
    ).run();

    await request(app)
      .post(`/admin/api/attempts/${encodeURIComponent('555-0007')}/grant`)
      .send({ extra: 3 })
      .expect(200);

    const row = db.prepare("SELECT * FROM login_attempts WHERE phone_number = '555-0007'").get();
    expect(row.locked).toBe(0);
    expect(row.max_attempts).toBe(6); // 3 current + 3 extra
  });
});

describe('Settings API', () => {
  test('GET /admin/api/settings returns current settings', async () => {
    const res = await request(app)
      .get('/admin/api/settings')
      .expect(200);

    expect(res.body.default_allow).toBe('true');
  });

  test('PUT /admin/api/settings updates settings', async () => {
    await request(app)
      .put('/admin/api/settings')
      .send({ default_allow: 'false' })
      .expect(200);

    const row = db.prepare("SELECT value FROM admin_settings WHERE key = 'default_allow'").get();
    expect(row.value).toBe('false');
  });
});

describe('Error log API', () => {
  test('GET /admin/api/errors returns errors', async () => {
    db.prepare("INSERT INTO errors (type, message, details) VALUES ('test', 'test error', 'details')").run();

    const res = await request(app)
      .get('/admin/api/errors')
      .expect(200);

    expect(res.body.rows).toHaveLength(1);
    expect(res.body.total).toBe(1);
  });

  test('DELETE /admin/api/errors clears all errors', async () => {
    db.prepare("INSERT INTO errors (type, message) VALUES ('test', 'err1')").run();
    db.prepare("INSERT INTO errors (type, message) VALUES ('test', 'err2')").run();

    await request(app)
      .delete('/admin/api/errors')
      .expect(200);

    const count = db.prepare('SELECT COUNT(*) as c FROM errors').get().c;
    expect(count).toBe(0);
  });
});

describe('Unknown MACs API', () => {
  test('GET /admin/api/unknown-macs returns unknown MACs', async () => {
    db.prepare("INSERT INTO unknown_macs (mac_address) VALUES ('FF:FF:FF:FF:FF:01')").run();

    const res = await request(app)
      .get('/admin/api/unknown-macs')
      .expect(200);

    expect(res.body).toHaveLength(1);
  });

  test('POST /admin/api/unknown-macs/:id/tag tags a MAC', async () => {
    db.prepare("INSERT INTO unknown_macs (mac_address) VALUES ('FF:FF:FF:FF:FF:02')").run();
    const mac = db.prepare("SELECT * FROM unknown_macs WHERE mac_address = 'FF:FF:FF:FF:FF:02'").get();

    await request(app)
      .post(`/admin/api/unknown-macs/${mac.id}/tag`)
      .send({ tag: 'printer' })
      .expect(200);

    const updated = db.prepare('SELECT * FROM unknown_macs WHERE id = ?').get(mac.id);
    expect(updated.tagged).toBe('printer');
  });

  test('DELETE /admin/api/unknown-macs/:id removes entry', async () => {
    db.prepare("INSERT INTO unknown_macs (mac_address) VALUES ('FF:FF:FF:FF:FF:03')").run();
    const mac = db.prepare("SELECT * FROM unknown_macs WHERE mac_address = 'FF:FF:FF:FF:FF:03'").get();

    await request(app)
      .delete(`/admin/api/unknown-macs/${mac.id}`)
      .expect(200);

    const deleted = db.prepare('SELECT * FROM unknown_macs WHERE id = ?').get(mac.id);
    expect(deleted).toBeUndefined();
  });
});
