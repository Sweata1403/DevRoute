const { runMigrations, closePool } = require('../src/db/postgres');

module.exports = async function() {
  await runMigrations();
  await closePool();
};