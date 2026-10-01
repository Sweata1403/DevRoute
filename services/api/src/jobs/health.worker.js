/**
 * health.worker.js
 *
 * BullMQ worker that processes link health check jobs.
 * Each job pings one URL and updates the link's health_status in Postgres.
 *
 * Statuses:
 *   healthy   — 2xx response within timeout
 *   degraded  — 3xx, 4xx, or slow response (>5s)
 *   dead      — connection refused, DNS failure, or 5xx
 *   unknown   — never checked yet (default)
 */

const { Worker } = require('bullmq');
const axios = require('axios');
const { query } = require('../db/postgres');
const { writeAuditLog } = require('../models/audit');
const { logger } = require('../middleware/requestLogger');
const { getRedisConnection } = require('../cache/redis');

const QUEUE_NAME = 'link-health';
const TIMEOUT_MS = 8000; // 8 seconds — generous but not forever

async function checkUrl(url) {
  const start = Date.now();
  try {
    const response = await axios.get(url, {
      timeout: TIMEOUT_MS,
      maxRedirects: 5,
      validateStatus: () => true, // don't throw on any HTTP status
      headers: {
        'User-Agent': 'DevRoute-HealthMonitor/1.0'
      }
    });

    const duration = Date.now() - start;
    const status = response.status;

    if (status >= 200 && status < 300 && duration < 5000) {
      return { status: 'healthy', httpStatus: status, duration };
    } else if (status >= 500) {
      return { status: 'dead', httpStatus: status, duration };
    } else {
      return { status: 'degraded', httpStatus: status, duration };
    }
  } catch (err) {
    const duration = Date.now() - start;
    // ECONNREFUSED, ETIMEDOUT, ENOTFOUND = dead
    return { status: 'dead', error: err.message, duration };
  }
}

function createWorker() {
  const connection = getRedisConnection();

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const { linkId, url, userId } = job.data;

      logger.info(`Health check: checking link ${linkId} → ${url}`);

      const result = await checkUrl(url);

      // Update health_status and last_checked_at in DB
      await query(
        `UPDATE links
         SET health_status = $1, last_checked_at = NOW()
         WHERE id = $2`,
        [result.status, linkId]
      );

      // Write to audit log so owners can see health history
      await writeAuditLog({
        action: `health.${result.status}`,
        userId,
        linkId,
        metadata: {
          url,
          httpStatus: result.httpStatus,
          duration: result.duration,
          error: result.error
        }
      });

      logger.info(`Health check: link ${linkId} is ${result.status} (${result.duration}ms)`);

      return result;
    },
    {
      connection,
      concurrency: 5 // check 5 URLs at a time
    }
  );

  worker.on('failed', (job, err) => {
    logger.error(`Health check job failed for link ${job?.data?.linkId}`, { error: err.message });
  });

  logger.info('Link health monitor worker started');
  return worker;
}

module.exports = { createWorker };