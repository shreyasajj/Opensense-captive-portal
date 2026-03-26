process.env.ADMIN_USER = 'admin';
process.env.ADMIN_PASSWORD = 'testpass';

const adminAuth = require('../../middleware/adminAuth');

function mockReqRes(authHeader) {
  const req = { headers: {} };
  if (authHeader) req.headers.authorization = authHeader;
  const res = {
    _status: null,
    _body: null,
    _headers: {},
    status(code) { this._status = code; return this; },
    json(body) { this._body = body; return this; },
    set(key, value) { this._headers[key] = value; return this; },
  };
  return { req, res };
}

describe('adminAuth middleware', () => {
  test('rejects request with no auth header', () => {
    const { req, res } = mockReqRes();
    const next = jest.fn();
    adminAuth(req, res, next);
    expect(res._status).toBe(401);
    expect(res._headers['WWW-Authenticate']).toBeDefined();
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects request with invalid credentials', () => {
    const encoded = Buffer.from('wrong:wrong').toString('base64');
    const { req, res } = mockReqRes(`Basic ${encoded}`);
    const next = jest.fn();
    adminAuth(req, res, next);
    expect(res._status).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('accepts request with valid credentials', () => {
    const encoded = Buffer.from('admin:testpass').toString('base64');
    const { req, res } = mockReqRes(`Basic ${encoded}`);
    const next = jest.fn();
    adminAuth(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res._status).toBeNull();
  });

  test('rejects non-Basic auth scheme', () => {
    const { req, res } = mockReqRes('Bearer some-token');
    const next = jest.fn();
    adminAuth(req, res, next);
    expect(res._status).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });
});
