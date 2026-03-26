const path = require('path');
const fs = require('fs');

module.exports = async function () {
  const testDbPath = path.join(__dirname, '..', 'db', 'test-portal.db');
  for (const suffix of ['', '-wal', '-shm']) {
    const f = testDbPath + suffix;
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
};
