require('dotenv').config(); // load .env file first, before anything else

const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const crypto = require('crypto');

const { morganMiddleware, logger } = require('./middleware/requestLogger');
const { readLimiter } = require('./middleware/rateLimiter');
const linksRouter = require('./routes/links');
const authRoutes = require('./routes/auth');
const analyticsRouter = require('./routes/analytics');
const { findByCode } = require('./models/link');
const { getLink, setLink } = require('./cache/redis');

function createApp() {
  const app = express();

  // ── Global middleware (runs on every request) ──────────────────
  app.use(helmet());        // adds security headers like X-Frame-Options, CSP etc
  app.use(compression());   // gzip compress all responses — saves bandwidth
  app.use(express.json({ limit: '1mb' })); // parse JSON request bodies
  app.use(morganMiddleware); // log every request

  // ── Health check ───────────────────────────────────────────────
  // This is what Docker, Kubernetes, and AWS use to know if your app is alive
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // ── API routes ─────────────────────────────────────────────────
  app.use('/api/auth', authRoutes);
  app.use('/api/links', linksRouter);
  app.use('/api/analytics', analyticsRouter);

  // ── The redirect — this is the core product feature ───────────
  // GET /:code → look up the code → 302 redirect to original URL
  app.get('/:code', readLimiter, async (req, res) => {
    const { code } = req.params;

    // 1. Try Redis cache first (fast path — microseconds)
    let link = await getLink(code);

    if (!link) {
      // 2. Cache miss — go to Postgres (slow path — milliseconds)
      link = await findByCode(code);
      if (link) await setLink(code, link); // store in cache for next time
    }

    if (!link) {
      return res.status(404).json({ error: 'Short link not found' });
    }

    // 3. Check if the link has expired
    if (link.expires_at && new Date(link.expires_at) < new Date()) {
      return res.status(410).json({ error: 'This short link has expired' });
      // 410 Gone = resource existed but is permanently gone (different from 404)
    }

    // 4. Redirect — 302 means temporary redirect (browser won't cache it)
    return res.redirect(302, link.original_url);
  });

  // ── 404 handler ────────────────────────────────────────────────
  app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // ── Global error handler ───────────────────────────────────────
  // Express recognises this by the 4 parameters (err, req, res, next)
  app.use((err, req, res, _next) => {
    logger.error('Unhandled error', { error: err.message, stack: err.stack });
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

module.exports = { createApp };