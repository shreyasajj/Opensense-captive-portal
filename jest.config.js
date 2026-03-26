module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'services/**/*.js',
    'routes/**/*.js',
    'middleware/**/*.js',
    'db/**/*.js',
    '!**/node_modules/**',
  ],
  globalSetup: './tests/setup.js',
  globalTeardown: './tests/teardown.js',
};
