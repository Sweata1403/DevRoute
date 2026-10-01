/**
 * expiry.job.js
 *
 * Background cron job that runs every minute and:
 * 1. Marks date-expired links as inactive in Postgres
 * 2. Marks max-click-exceeded links as inactive in Postgres
 * 3. Clears those links from the Redis cache
 *
 * This is a safety net — the redirect handler also checks expiry
 * on every request, but this job ensures the DB stays clean and
 * listLinks() shows the correct status without an extra query.
 */

const cron = require('node-cron');
const { query } = require('../db/postgres');
const { deleteCache } = require('../cache/redis');
const { logger } = require('../middleware/requestLogger');

async function expireByDate() {
  // Find all links past their expiry date that are still marked active
  const result = await query(`
    UPDATE links
    SET active = FALSE
    WHERE active = TRUE
      AND expires_at IS NOT NULL
      AND expires_at < NOW()
    RETURNING code, id
  `);

  const expired = result.rows;

  if (expired.length > 0) {
    logger.info(`Expiry job: deactivated ${expired.length} date-expired link(s)`);

    // Clear each from Redis so stale data isn't served
    await Promise.all(expired.map(link => deleteCache(link.code)));
  }

  return expired.length;
}

async function expireByClickCount() {
  // Find links where click count >= max_clicks and still active
  const result = await query(`
    UPDATE links
    SET active = FALSE
    WHERE active = TRUE
      AND max_clicks IS NOT NULL
      AND (
        SELECT COUNT(*) FROM clicks WHERE clicks.link_id = links.id
      ) >= max_clicks
    RETURNING code, id
  `);

  const maxed = result.rows;

  if (maxed.length > 0) {
    logger.info(`Expiry job: deactivated ${maxed.length} max-click link(s)`);
    await Promise.all(maxed.map(link => deleteCache(link.code)));
  }

  return maxed.length;
}

function startExpiryJob() {
  // Run every minute: "* * * * *"
  cron.schedule('* * * * *', async () => {
    try {
      const [byDate, byClicks] = await Promise.all([
        expireByDate(),
        expireByClickCount()
      ]);

      if (byDate + byClicks > 0) {
        logger.info(`Expiry job complete: ${byDate} date-expired, ${byClicks} click-maxed`);
      }
    } catch (err) {
      logger.error('Expiry job failed', { error: err.message });
    }
  });

  logger.info('Link expiry cron job started (runs every minute)');
}

module.exports = { startExpiryJob };