/**
 * audit.routes.js
 *
 * GET /api/audit        — your own audit trail (auth required)
 * GET /api/audit/:code  — audit trail for a specific link you own
 */

const express = require('express');
const { getAuditLogs } = require('../models/audit');
const { requireAuth } = require('../middleware/auth');
const { findByCode } = require('../models/link');

const router = express.Router();

// GET /api/audit — list audit events for the logged-in user
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const page  = parseInt(req.query.page)  || 1;
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const action = req.query.action || null; // e.g. ?action=link or ?action=redirect

    const logs = await getAuditLogs({ userId: req.user.id, action, page, limit });
    res.json({ logs, page, limit });
  } catch (err) {
    next(err);
  }
});

// GET /api/audit/:code — audit trail for one specific link (must be yours)
router.get('/:code', requireAuth, async (req, res, next) => {
  try {
    const link = await findByCode(req.params.code);

    if (!link) {
      return res.status(404).json({ error: 'Link not found' });
    }

    if (link.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Not your link' });
    }

    const page  = parseInt(req.query.page)  || 1;
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);

    const logs = await getAuditLogs({ linkId: link.id, page, limit });
    res.json({ link: { code: link.code, url: link.url }, logs, page, limit });
  } catch (err) {
    next(err);
  }
});

module.exports = router;