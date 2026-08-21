const rateLimit = require('express-rate-limit');

const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000');

// Strict limit for creating/deleting links — 20 per minute per IP
const writeLimiter = rateLimit({
  windowMs,
  max: 20,
  standardHeaders: true,   // sends RateLimit headers in response
  legacyHeaders: false,
  message: {
    error: 'Too many requests — slow down'
  }
});

// Lenient limit for redirects and reads — 200 per minute per IP
const readLimiter = rateLimit({
  windowMs,
  max: parseInt(process.env.RATE_LIMIT_MAX || '200'),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests — slow down'
  }
});

module.exports = { writeLimiter, readLimiter };