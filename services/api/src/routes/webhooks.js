// services/api/src/routes/webhooks.js

/**
 * GitHub Webhook Auto-Linking
 *
 * POST /api/webhooks/github
 *
 * Supported events:
 *   push             → short link to the commit diff
 *   pull_request     → short link to the PR (on open/reopen)
 *   deployment_status → short link to the deployment URL (on success)
 *
 * The route uses express.raw() so the HMAC can be verified over
 * the original bytes before we parse JSON.
 */

const express = require('express');
const { nanoid } = require('nanoid');
const { verifyGitHubSignature } = require('../middleware/verifyGitHubSignature');
const { query } = require('../db/postgres');
const { writeAuditLog } = require('../models/audit');
const { logger } = require('../middleware/requestLogger');

const router = express.Router();

// Must parse raw bytes BEFORE our JSON body-parser runs (wired in app.js)
router.use(express.raw({ type: 'application/json' }));
router.use(verifyGitHubSignature);

/**
 * Generate a short, readable code for auto-created webhook links.
 * Format: gh-{eventType}-{random6}
 * e.g. gh-push-a3f9kz
 */
function generateWebhookCode(eventType) {
  return `gh-${eventType}-${nanoid(6)}`;
}

/**
 * Create a short link in the DB for a GitHub event.
 * These links have no owner (user_id = null) but are tagged with webhook_source.
 */
async function createWebhookLink({ code, url, description, repo, eventType }) {
  const result = await query(
    `INSERT INTO links (code, url, active, webhook_source, created_at)
     VALUES ($1, $2, TRUE, $3, NOW())
     RETURNING id, code`,
    [
      code,
      url,
      JSON.stringify({ source: 'github', repo, eventType, description })
    ]
  );
  return result.rows[0];
}

// POST /api/webhooks/github
router.post('/github', async (req, res) => {
  const event = req.headers['x-github-event'];
  const payload = req.body;

  logger.info(`GitHub webhook received: ${event}`);

  try {
    let link = null;
    let description = '';

    if (event === 'push') {
      // Only handle branch pushes (not tag pushes)
      if (!payload.ref?.startsWith('refs/heads/')) {
        return res.json({ message: 'Tag push ignored' });
      }

      const repo = payload.repository?.full_name;
      const branch = payload.ref.replace('refs/heads/', '');
      const sha = payload.after?.slice(0, 7);
      const compareUrl = payload.compare; // GitHub's compare URL for this push

      if (!compareUrl) return res.json({ message: 'No compare URL in payload' });

      const code = generateWebhookCode('push');
      description = `Push to ${repo}@${branch} (${sha})`;

      link = await createWebhookLink({
        code,
        url: compareUrl,
        description,
        repo,
        eventType: 'push'
      });

      writeAuditLog({
        action: 'link.created',
        linkId: link.id,
        metadata: { source: 'github_webhook', event: 'push', repo, branch, sha }
      }).catch(() => {});

    } else if (event === 'pull_request') {
      const action = payload.action;
      if (!['opened', 'reopened'].includes(action)) {
        return res.json({ message: `PR action '${action}' ignored` });
      }

      const repo = payload.repository?.full_name;
      const pr = payload.pull_request;
      const prUrl = pr?.html_url;
      const prNumber = pr?.number;
      const prTitle = pr?.title;

      if (!prUrl) return res.json({ message: 'No PR URL in payload' });

      const code = generateWebhookCode('pr');
      description = `PR #${prNumber}: ${prTitle} (${repo})`;

      link = await createWebhookLink({
        code,
        url: prUrl,
        description,
        repo,
        eventType: 'pull_request'
      });

      writeAuditLog({
        action: 'link.created',
        linkId: link.id,
        metadata: { source: 'github_webhook', event: 'pull_request', repo, prNumber }
      }).catch(() => {});

    } else if (event === 'deployment_status') {
      const status = payload.deployment_status?.state;
      if (status !== 'success') {
        return res.json({ message: `Deployment status '${status}' ignored` });
      }

      const repo = payload.repository?.full_name;
      const env = payload.deployment?.environment;
      const deployUrl =
        payload.deployment_status?.target_url ||
        payload.deployment?.payload?.web_url;

      if (!deployUrl) return res.json({ message: 'No deployment URL in payload' });

      const code = generateWebhookCode('deploy');
      description = `Deployment to ${env} (${repo})`;

      link = await createWebhookLink({
        code,
        url: deployUrl,
        description,
        repo,
        eventType: 'deployment_status'
      });

      writeAuditLog({
        action: 'link.created',
        linkId: link.id,
        metadata: { source: 'github_webhook', event: 'deployment_status', repo, env }
      }).catch(() => {});

    } else {
      return res.json({ message: `Event '${event}' not handled` });
    }

    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    const shortUrl = `${baseUrl}/${link.code}`;

    logger.info(`Webhook auto-link created: ${shortUrl} → ${description}`);

    res.json({
      message: 'Short link created',
      code: link.code,
      shortUrl,
      description
    });

  } catch (err) {
    logger.error('GitHub webhook handler failed', { error: err.message });
    res.status(500).json({ error: 'Failed to process webhook' });
  }
});

module.exports = router;