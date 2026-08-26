const express = require('express');
const { isURL } = require('validator');
const {
  createLink, findByCode, listLinks,
  deleteLink, generateQRCode
} = require('../models/link');
const { getCache, setCache, deleteCache } = require('../cache/redis');
const { requireAuth, optionalAuth } = require('../middleware/auth');

const router = express.Router();

// POST /api/links - create a short link (auth required)
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { url, alias, expiresAt, maxClicks } = req.body;

    if (!url || !isURL(url, { require_protocol: true })) {
      return res.status(400).json({ error: 'A valid URL with protocol is required' });
    }

    if (alias && !/^[a-zA-Z0-9_-]{3,50}$/.test(alias)) {
      return res.status(400).json({
        error: 'Alias must be 3-50 characters, letters, numbers, hyphens and underscores only'
      });
    }

    if (expiresAt && isNaN(Date.parse(expiresAt))) {
      return res.status(400).json({ error: 'expiresAt must be a valid date' });
    }

    if (maxClicks && (!Number.isInteger(maxClicks) || maxClicks < 1)) {
      return res.status(400).json({ error: 'maxClicks must be a positive integer' });
    }

    const link = await createLink({
      url,
      alias,
      userId: req.user.id,
      expiresAt: expiresAt || null,
      maxClicks: maxClicks || null
    });

    res.status(201).json(link);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Alias already in use' });
    }
    next(err);
  }
});

// GET /api/links - list links (auth required, own links only)
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);

    const links = await listLinks({ userId: req.user.id, page, limit });
    res.json({ links, page, limit });
  } catch (err) {
    next(err);
  }
});

// GET /api/links/:code - get a single link
router.get('/:code', optionalAuth, async (req, res, next) => {
  try {
    const { code } = req.params;

    const cached = await getCache(code);
    if (cached) return res.json(cached);

    const link = await findByCode(code);
    if (!link) return res.status(404).json({ error: 'Link not found' });

    await setCache(code, link);
    res.json(link);
  } catch (err) {
    next(err);
  }
});

// GET /api/links/:code/qr - get QR code for a link
router.get('/:code/qr', async (req, res, next) => {
  try {
    const { code } = req.params;

    const link = await findByCode(code);
    if (!link) return res.status(404).json({ error: 'Link not found' });

    const qrDataUrl = await generateQRCode(code);

    // Strip the data:image/png;base64, prefix and send as PNG
    const base64Data = qrDataUrl.replace(/^data:image\/png;base64,/, '');
    const imgBuffer = Buffer.from(base64Data, 'base64');

    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(imgBuffer);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/links/:code - soft delete (auth required, own links only)
router.delete('/:code', requireAuth, async (req, res, next) => {
  try {
    const { code } = req.params;

    const deleted = await deleteLink(code, req.user.id);
    if (!deleted) return res.status(404).json({ error: 'Link not found or not yours' });

    await deleteCache(code);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;