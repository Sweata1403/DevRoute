require('dotenv').config(); // load .env file first, before anything else

const webhooksRouter = require('./routes/webhooks');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const crypto = require('crypto');
const auditRouter = require('./routes/audit');
const { writeAuditLog } = require('./models/audit');
const healthMonitorRouter = require('./routes/health-monitor');


const { morganMiddleware, logger } = require('./middleware/requestLogger');
const { readLimiter } = require('./middleware/rateLimiter');
const linksRouter = require('./routes/links');
const authRoutes = require('./routes/auth');
const analyticsRouter = require('./routes/analytics');
const { findByCode, recordClick, markLinkInactive, getClickCount } = require('./models/link');
const { getLink, setLink, deleteCache } = require('./cache/redis');

function createApp() {
  const app = express();

  // ── Global middleware (runs on every request) ──────────────────
  app.use(helmet());        // adds security headers like X-Frame-Options, CSP etc
  app.use(compression());   // gzip compress all responses — saves bandwidth
  app.use('/api/webhooks', webhooksRouter);
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
  app.use('/api/audit', auditRouter);
  app.use('/api/health-monitor', healthMonitorRouter);
    // ── The redirect — this is the core product feature ───────────
  // GET /:code → look up the code → 302 redirect to original URL
  app.get('/:code', readLimiter, async (req, res) => {
    const { code } = req.params;

    // 1. Try Redis cache first (fast path — microseconds)
    let link = await getLink(code);

    if (!link) {
      // 2. Cache miss — go to Postgres (slow path — milliseconds)
      link = await findByCode(code);
      if (link) await setLink(code, link);
    }

    if (!link) {
      writeAuditLog({ action: 'redirect.not_found', ipAddress: req.ip, metadata: { code } }).catch(() => {});
      return res.status(404).json({ error: 'Short link not found' });
    }

    // 3. Check if the link has expired by date
    if (link.expires_at && new Date(link.expires_at) < new Date()) {
      await deleteCache(link.code);
      await markLinkInactive(link.id);
      writeAuditLog({ action: 'redirect.expired', userId: link.user_id, linkId: link.id, ipAddress: req.ip }).catch(() => {});
      return res.status(410).json({ error: 'This short link has expired' });
    }

    // 4. Check if max clicks has been reached
    if (link.max_clicks) {
      const clickCount = await getClickCount(link.id);
      if (clickCount >= link.max_clicks) {
        await deleteCache(link.code);
        await markLinkInactive(link.id);
        writeAuditLog({ action: 'redirect.maxed', userId: link.user_id, linkId: link.id, ipAddress: req.ip }).catch(() => {});
        return res.status(410).json({ error: 'This short link has reached its maximum clicks' });
      }
    }

    // 5. Record the click (fire and forget — don't slow down the redirect)
    recordClick({
      linkId: link.id,
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
      referer: req.headers['referer'] || null
    }).catch(err => logger.error('Failed to record click', { error: err.message }));

    // 6. Audit successful redirect
    writeAuditLog({ action: 'redirect.success', userId: link.user_id, linkId: link.id, ipAddress: req.ip }).catch(() => {});

    // 7. Redirect — 302 means temporary redirect
    return res.redirect(302, link.url);
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