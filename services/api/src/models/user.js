const { query } = require('../db/postgres');
const bcrypt = require('bcryptjs');

/**
 * Create a new user account.
 * Password is hashed with bcrypt before storing - never saved in plaintext.
 */
async function createUser(email, password) {
  const saltRounds = 12;
  const passwordHash = await bcrypt.hash(password, saltRounds);

  const result = await query(
    `INSERT INTO users (email, password_hash)
     VALUES ($1, $2)
     RETURNING id, email, created_at`,
    [email, passwordHash]
  );

  return result.rows[0];
}

/**
 * Find a user by email for login.
 * Returns the full row including password_hash for verification.
 */
async function findByEmail(email) {
  const result = await query(
    `SELECT id, email, password_hash, created_at
     FROM users
     WHERE email = $1`,
    [email]
  );

  return result.rows[0] || null;
}

/**
 * Find a user by ID - used by the auth middleware
 * to attach the user to the request.
 */
async function findById(id) {
  const result = await query(
    `SELECT id, email, created_at
     FROM users
     WHERE id = $1`,
    [id]
  );

  return result.rows[0] || null;
}

/**
 * Verify a plaintext password against the stored hash.
 * bcrypt.compare is timing-safe - prevents timing attacks.
 */
async function verifyPassword(plaintext, hash) {
  return bcrypt.compare(plaintext, hash);
}

module.exports = { createUser, findByEmail, findById, verifyPassword };