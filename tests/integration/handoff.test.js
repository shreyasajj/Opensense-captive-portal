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

describe('POST /api/create-handoff-token', () => {
  test('creates a token with valid mac and ip', async () => {
    const res = await request(app)
      .post('/api/create-handoff-token')
      .send({ mac: 'AA:BB:CC:DD:EE:FF', ip: '192.168.1.100' })
      .expect(200);

    expect(res.body.token).toBeDefined();
    expect(res.body.token).toHaveLength(64); // 32 bytes hex
  });

  test('rejects missing mac', async () => {
    const res = await request(app)
      .post('/api/create-handoff-token')
      .send({ ip: '192.168.1.100' })
      .expect(400);

    expect(res.body.error).toMatch(/mac/i);
  });

  test('rejects missing ip', async () => {
    const res = await request(app)
      .post('/api/create-handoff-token')
      .send({ mac: 'AA:BB:CC:DD:EE:FF' })
      .expect(400);

    expect(res.body.error).toMatch(/ip/i);
  });

  test('rejects invalid MAC address', async () => {
    const res = await request(app)
      .post('/api/create-handoff-token')
      .send({ mac: 'invalid', ip: '192.168.1.100' })
      .expect(400);

    expect(res.body.error).toMatch(/invalid/i);
  });
});

describe('GET /handoff', () => {
  test('redirects to portal with valid token', async () => {
    // Create a token first
    const tokenRes = await request(app)
      .post('/api/create-handoff-token')
      .send({ mac: 'AA:BB:CC:DD:EE:FF', ip: '192.168.1.100' });

    const token = tokenRes.body.token;

    const res = await request(app)
      .get(`/handoff?token=${token}`)
      .expect(302);

    expect(res.headers.location).toBe('/portal/');
  });

  test('rejects missing token', async () => {
    await request(app).get('/handoff').expect(400);
  });

  test('rejects invalid token', async () => {
    await request(app).get('/handoff?token=nonexistent').expect(400);
  });

  test('rejects already-used token', async () => {
    const tokenRes = await request(app)
      .post('/api/create-handoff-token')
      .send({ mac: 'AA:BB:CC:DD:EE:FF', ip: '192.168.1.100' });

    const token = tokenRes.body.token;

    // Use the token
    await request(app).get(`/handoff?token=${token}`).expect(302);

    // Try again — should fail
    await request(app).get(`/handoff?token=${token}`).expect(400);
  });
});
