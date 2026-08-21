const express = require('express');
const { isURL } = require('validator');
const { createLink, findByCode, listLinks, deleteLink } = require('../models/link');
const { getLink, setLink, deleteLink: deleteCached } = require('../cache/redis');
const { writeLimiter } = require('../middleware/rateLimiter');
const { logger } = require('../middleware/requestLogger');

const router = express.Router();

// ── POST /api/links — create a short link ──────────────────────
router.post('/', writeLimiter, async (req, res) => {
  const { url, alias, created_by: createdBy, expires_at: expiresAt } = req.body || {};

  // Validation — check inputs before touching the DB
  if (!url) {
    return res.status(400).json({ error: 'url is required' });
  }
  if (!isURL(url, { require_protocol: true })) {
    return res.status(400).json({ error: 'url must be a valid URL with http:// or https://' });
  }
  if (alias && !/^[a-zA-Z0-9_-]{2,16}$/.test(alias)) {
    return res.status(400).json({ error: 'alias must be 2–16 characters, letters/numbers/hyphens only' });
  }

  try {
    const link = await createLink({ originalUrl: url, alias, createdBy, expiresAt });
    await setLink(link.code, link); // warm the cache immediately after creation

    logger.info('Link created', { code: link.code });

    return res.status(201).json({
      code: link.code,
      short_url: `${process.env.BASE_URL || 'http://localhost:3000'}/${link.code}`,
      original_url: link.original_url,
      created_at: link.created_at,
      expires_at: link.expires_at
    });
  } catch (err) {
    if (err.status === 409) {
      return res.status(409).json({ error: err.message });
    }
    logger.error('Failed to create link', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/links — list all links ────────────────────────────
router.get('/', async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));

  try {
    const result = await listLinks({ page, limit });
    return res.json(result);
  } catch (err) {
    logger.error('Failed to list links', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/links/:code — get one link's metadata ─────────────
router.get('/:code', async (req, res) => {
  const { code } = req.params;

  // Cache-first pattern: check Redis before hitting Postgres
  let link = await getLink(code);
  if (!link) {
    link = await findByCode(code);
    if (link) await setLink(code, link); // populate cache for next time
  }

  if (!link) {
    return res.status(404).json({ error: 'Link not found' });
  }

  return res.json({
    code: link.code,
    short_url: `${process.env.BASE_URL || 'http://localhost:3000'}/${link.code}`,
    original_url: link.original_url,
    created_by: link.created_by,
    created_at: link.created_at,
    expires_at: link.expires_at
  });
});

// ── DELETE /api/links/:code — soft delete ──────────────────────
router.delete('/:code', writeLimiter, async (req, res) => {
  const { code } = req.params;

  try {
    const deleted = await deleteLink(code);
    if (!deleted) {
      return res.status(404).json({ error: 'Link not found' });
    }
    await deleteCached(code); // remove from cache too
    logger.info('Link deleted', { code });
    return res.status(204).send(); // 204 = success, no content to return
  } catch (err) {
    logger.error('Failed to delete link', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;