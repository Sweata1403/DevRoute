// services/api/src/middleware/verifyGitHubSignature.js

const crypto = require('crypto');

/**
 * Express middleware that verifies GitHub's HMAC-SHA256 webhook signature.
 * Must be used on routes mounted with express.raw() — NOT express.json() —
 * because the signature is computed over the raw request body.
 *
 * GitHub sends: X-Hub-Signature-256: sha256=<hex>
 */
function verifyGitHubSignature(req, res, next) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;

  if (!secret) {
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  const signature = req.headers['x-hub-signature-256'];
  if (!signature) {
    return res.status(401).json({ error: 'Missing X-Hub-Signature-256 header' });
  }

  // req.body is a Buffer here (express.raw middleware)
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(req.body);
  const expected = `sha256=${hmac.digest('hex')}`;

  // Timing-safe comparison prevents timing attacks
  const sigBuffer = Buffer.from(signature);
  const expBuffer = Buffer.from(expected);

  if (
    sigBuffer.length !== expBuffer.length ||
    !crypto.timingSafeEqual(sigBuffer, expBuffer)
  ) {
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  // Parse the raw body as JSON for downstream handlers
  try {
    req.body = JSON.parse(req.body.toString());
  } catch {
    return res.status(400).json({ error: 'Invalid JSON payload' });
  }

  next();
}

module.exports = { verifyGitHubSignature };