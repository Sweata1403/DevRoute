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
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  ssl: process.env.NODE_ENV === 'production' 
    ? { rejectUnauthorized: false } 
    : false
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

  await query(`
  ALTER TABLE links
  ADD COLUMN IF NOT EXISTS health_status VARCHAR(20) DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMP
 `);

  await query(`
  ALTER TABLE links
  ADD COLUMN IF NOT EXISTS webhook_source JSONB
 `);

  await query(`
  CREATE TABLE IF NOT EXISTS audit_logs (
    id          SERIAL PRIMARY KEY,
    action      VARCHAR(100) NOT NULL,
    user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    link_id     INTEGER REFERENCES links(id) ON DELETE SET NULL,
    ip_address  INET,
    user_agent  TEXT,
    metadata    JSONB,
    created_at  TIMESTAMP DEFAULT NOW()
  )
`);
  
  await query(`CREATE INDEX IF NOT EXISTS idx_links_webhook ON links((webhook_source IS NOT NULL))`);
  await query(`CREATE INDEX IF NOT EXISTS idx_links_health ON links(health_status)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_audit_user_id ON audit_logs(user_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_audit_link_id ON audit_logs(link_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action)`);
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