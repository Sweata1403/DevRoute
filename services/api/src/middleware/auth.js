const jwt = require('jsonwebtoken');
const { findById } = require('../models/user');

/**
 * Protects routes that require a logged-in user.
 * Reads the Bearer token from the Authorization header,
 * verifies it, fetches the user, and attaches them to req.user.
 */
async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid authorization header' });
    }

    const token = authHeader.split(' ')[1];

    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Token expired' });
      }
      return res.status(401).json({ error: 'Invalid token' });
    }

    const user = await findById(payload.userId);
    if (!user) {
      return res.status(401).json({ error: 'User no longer exists' });
    }

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Optional auth - attaches user to req if token is present,
 * but does not block the request if no token is provided.
 * Used for endpoints that work for both guests and logged-in users.
 */
async function optionalAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next();
    }

    const token = authHeader.split(' ')[1];

    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      const user = await findById(payload.userId);
      if (user) req.user = user;
    } catch {
      // Invalid token - just continue as guest
    }

    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireAuth, optionalAuth };