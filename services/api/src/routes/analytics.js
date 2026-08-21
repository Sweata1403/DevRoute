const express = require('express');
const { getAnalytics } = require('../models/link');
const { logger } = require('../middleware/requestLogger');

const router = express.Router();

// GET /api/analytics/:code — click analytics for a short link
router.get('/:code', async (req, res) => {
  const { code } = req.params;

  try {
    const data = await getAnalytics(code);
    if (!data) {
      return res.status(404).json({ error: 'Link not found' });
    }
    return res.json(data);
  } catch (err) {
    logger.error('Failed to fetch analytics', { code, error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;