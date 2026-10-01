/**
 * health-monitor.routes.js
 *
 * GET /api/health-monitor/status  — summary of all your links' health
 * GET /api/health-monitor/:code   — health detail for one link
 * POST /api/health-monitor/:code/check — trigger an immediate check
 */

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { query } = require('../db/postgres');
const { getQueue } = require('../jobs/health.scheduler');

const router = express.Router();

// GET /api/health-monitor/status — overview of all your links' health
router.get('/status', requireAuth, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT
         health_status,
         COUNT(*) as count
       FROM links
       WHERE user_id = $1 AND active = TRUE
       GROUP BY health_status`,
      [req.user.id]
    );

    const summary = { healthy: 0, degraded: 0, dead: 0, unknown: 0 };
    result.rows.forEach(row => {
      summary[row.health_status || 'unknown'] = parseInt(row.count);
    });

    // Get dead/degraded links for immediate attention
    const problemLinks = await query(
      `SELECT code, url, health_status, last_checked_at
       FROM links
       WHERE user_id = $1
         AND active = TRUE
         AND health_status IN ('dead', 'degraded')
       ORDER BY last_checked_at DESC`,
      [req.user.id]
    );

    res.json({
      summary,
      problemLinks: problemLinks.rows
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/health-monitor/:code — health detail for one link
router.get('/:code', requireAuth, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT id, code, url, health_status, last_checked_at, created_at
       FROM links
       WHERE (code = $1 OR alias = $1)
         AND user_id = $2
         AND active = TRUE`,
      [req.params.code, req.user.id]
    );

    const link = result.rows[0];
    if (!link) return res.status(404).json({ error: 'Link not found' });

    // Pull last 10 health check audit events for this link
    const history = await query(
      `SELECT action, metadata, created_at
       FROM audit_logs
       WHERE link_id = $1
         AND action LIKE 'health.%'
       ORDER BY created_at DESC
       LIMIT 10`,
      [link.id]
    );

    res.json({ link, history: history.rows });
  } catch (err) {
    next(err);
  }
});

// POST /api/health-monitor/:code/check — trigger immediate check
router.post('/:code/check', requireAuth, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT id, url, user_id FROM links
       WHERE (code = $1 OR alias = $1)
         AND user_id = $2 AND active = TRUE`,
      [req.params.code, req.user.id]
    );

    const link = result.rows[0];
    if (!link) return res.status(404).json({ error: 'Link not found' });

    const queue = getQueue();
    await queue.add(`check-link-${link.id}`, {
      linkId: link.id,
      url: link.url,
      userId: link.user_id
    });

    res.json({ message: 'Health check queued', linkId: link.id });
  } catch (err) {
    next(err);
  }
});

module.exports = router;