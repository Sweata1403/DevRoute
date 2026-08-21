const { Pool } = require('pg');

// Pool = a group of ready-to-use DB connections
// We create it once and reuse it across the whole app
let pool;

function getPool() {
  if (!pool) {
    pool = new Pool({
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.POSTGRES_PORT || '5432'),
      database: process.env.POSTGRES_DB || 'devroute',
      user: process.env.POSTGRES_USER || 'devroute',
      password: process.env.POSTGRES_PASSWORD || 'devroute_secret',
      max: 10,                      // max 10 connections in the pool
      idleTimeoutMillis: 30000,     // close idle connections after 30s
      connectionTimeoutMillis: 5000 // fail fast if DB is unreachable
    });

    pool.on('error', (err) => {
      console.error('Unexpected Postgres error', err);
    });
  }
  return pool;
}

// Simple wrapper — call this anywhere you need to query the DB
async function query(text, params) {
  return getPool().query(text, params);
}

// Creates our tables on first startup
// Uses CREATE TABLE IF NOT EXISTS — safe to run multiple times
async function runMigrations() {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN'); // start a transaction

    // links table — stores the short codes and their target URLs
    await client.query(`
      CREATE TABLE IF NOT EXISTS links (
        id           SERIAL PRIMARY KEY,
        code         VARCHAR(16) UNIQUE NOT NULL,
        original_url TEXT NOT NULL,
        created_by   VARCHAR(255),
        expires_at   TIMESTAMP,
        created_at   TIMESTAMP DEFAULT NOW(),
        active       BOOLEAN DEFAULT TRUE
      )
    `);

    // clicks table — every redirect gets recorded here
    await client.query(`
      CREATE TABLE IF NOT EXISTS clicks (
        id         BIGSERIAL PRIMARY KEY,
        link_id    INT REFERENCES links(id) ON DELETE CASCADE,
        clicked_at TIMESTAMP DEFAULT NOW(),
        ip_hash    VARCHAR(64),
        user_agent TEXT,
        referrer   TEXT,
        country    VARCHAR(2)
      )
    `);

    // Index on code — speeds up the most common query (redirect lookup)
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_links_code ON links(code)
    `);

    await client.query('COMMIT'); // save all changes
    console.log('[db] Migrations complete');
  } catch (err) {
    await client.query('ROLLBACK'); // undo if anything failed
    throw err;
  } finally {
    client.release(); // return connection to pool
  }
}

async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = { query, runMigrations, closePool, getPool };