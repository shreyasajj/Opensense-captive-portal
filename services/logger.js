/**
 * Simple logger module
 */
const levels = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = levels[process.env.LOG_LEVEL || 'info'];

function log(level, ...args) {
  if (levels[level] >= currentLevel) {
    const ts = new Date().toISOString();
    console[level === 'debug' ? 'log' : level](`[${ts}] [${level.toUpperCase()}]`, ...args);
  }
}

module.exports = {
  debug: (...args) => log('debug', ...args),
  info: (...args) => log('info', ...args),
  warn: (...args) => log('warn', ...args),
  error: (...args) => log('error', ...args),
};
