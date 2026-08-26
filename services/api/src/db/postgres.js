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
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id          SERIAL PRIMARY KEY,
      email       VARCHAR(255) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at  TIMESTAMP DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS links (
      id          SERIAL PRIMARY KEY,
      code        VARCHAR(20) UNIQUE NOT NULL,
      url         TEXT NOT NULL,
      alias       VARCHAR(50) UNIQUE,
      user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
      expires_at  TIMESTAMP,
      max_clicks  INTEGER,
      active      BOOLEAN DEFAULT TRUE,
      created_at  TIMESTAMP DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS clicks (
      id         SERIAL PRIMARY KEY,
      link_id    INTEGER REFERENCES links(id) ON DELETE CASCADE,
      clicked_at TIMESTAMP DEFAULT NOW(),
      user_agent TEXT,
      ip_address INET,
      referer    TEXT
    )
  `);

  await query(`CREATE INDEX IF NOT EXISTS idx_links_code ON links(code)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_links_user_id ON links(user_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_clicks_link_id ON clicks(link_id)`);
}

async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = { query, runMigrations, closePool, getPool };