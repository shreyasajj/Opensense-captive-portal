const config = require('../config');

/**
 * Basic auth middleware for admin routes
 */
function adminAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="Admin"');
    return res.status(401).json({ error: 'Authentication required' });
  }

  const decoded = Buffer.from(authHeader.substring(6), 'base64').toString();
  const [user, password] = decoded.split(':');

  if (user === config.admin.user && password === config.admin.password) {
    return next();
  }

  res.set('WWW-Authenticate', 'Basic realm="Admin"');
  return res.status(401).json({ error: 'Invalid credentials' });
}

module.exports = adminAuth;
