/**
 * health.scheduler.js
 *
 * Cron job that runs every 30 minutes and enqueues
 * one health check job per active link into BullMQ.
 *
 * The worker (health.worker.js) picks them up and
 * pings each URL concurrently.
 */

const cron = require('node-cron');
const { Queue } = require('bullmq');
const { query } = require('../db/postgres');
const { logger } = require('../middleware/requestLogger');
const { getRedisConnection } = require('../cache/redis');

const QUEUE_NAME = 'link-health';

let healthQueue;

function getQueue() {
  if (!healthQueue) {
    healthQueue = new Queue(QUEUE_NAME, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 100, // keep last 100 completed jobs
        removeOnFail: 50
      }
    });
  }
  return healthQueue;
}

async function enqueueHealthChecks() {
  // Fetch all active links (skip ones checked in last 25 minutes to avoid overlap)
  const result = await query(`
    SELECT id, url, user_id
    FROM links
    WHERE active = TRUE
      AND (last_checked_at IS NULL OR last_checked_at < NOW() - INTERVAL '25 minutes')
    ORDER BY last_checked_at ASC NULLS FIRST
    LIMIT 500
  `);

  const links = result.rows;

  if (links.length === 0) {
    logger.info('Health scheduler: no links to check');
    return;
  }

  const queue = getQueue();

  // Add all links as individual jobs
  const jobs = links.map(link => ({
    name: `check-link-${link.id}`,
    data: { linkId: link.id, url: link.url, userId: link.user_id }
  }));

  await queue.addBulk(jobs);

  logger.info(`Health scheduler: enqueued ${links.length} health check jobs`);
}

function startHealthScheduler() {
  // Run every 30 minutes
  cron.schedule('*/30 * * * *', async () => {
    try {
      await enqueueHealthChecks();
    } catch (err) {
      logger.error('Health scheduler failed', { error: err.message });
    }
  });

  // Also run once on startup after a 10 second delay
  setTimeout(async () => {
    try {
      await enqueueHealthChecks();
    } catch (err) {
      logger.error('Initial health check failed', { error: err.message });
    }
  }, 10000);

  logger.info('Link health scheduler started (runs every 30 minutes)');
}

module.exports = { startHealthScheduler, getQueue };