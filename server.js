const express = require('express');
const session = require('express-session');
const path = require('path');
const config = require('./config');
const logger = require('./services/logger');
const db = require('./db/init');
const presence = require('./services/presence');

const app = express();

// Trust proxy (for behind reverse proxy/OPNsense)
app.set('trust proxy', 1);

// Session middleware
app.use(
  session({
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 30 * 60 * 1000, // 30 minutes
      httpOnly: true,
      sameSite: 'lax',
    },
  })
);

// JSON body parser for admin routes
app.use('/admin/api', express.json());

// Mount routes
app.use('/', require('./routes/handoff'));
app.use('/', require('./routes/portal'));
app.use('/admin', require('./routes/admin'));
app.use('/api/ha', require('./routes/ha'));

// Serve static files
app.use('/portal', express.static(path.join(__dirname, 'public', 'portal')));
app.use('/admin', express.static(path.join(__dirname, 'public', 'admin')));

// Root redirect
app.get('/', (req, res) => {
  if (req.session.mac_address) {
    res.redirect('/portal/');
  } else {
    res.redirect('/portal/');
  }
});

// Global error handler
app.use((err, req, res, _next) => {
  logger.error('Unhandled error:', err.message, err.stack);
  try {
    db.prepare('INSERT INTO errors (type, message, details) VALUES (?, ?, ?)').run(
      'server',
      err.message,
      err.stack
    );
  } catch (e) {
    // ignore db errors in error handler
  }
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(config.port, () => {
  logger.info(`Captive portal server running on port ${config.port}`);
  logger.info(`Portal: http://localhost:${config.port}/portal/`);
  logger.info(`Admin:  http://localhost:${config.port}/admin/`);
});

// Start presence detection
presence.start();

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('Shutting down...');
  presence.stop();
  db.close();
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('Shutting down...');
  presence.stop();
  db.close();
  process.exit(0);
});
