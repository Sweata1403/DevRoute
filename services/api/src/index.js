require('dotenv').config();

const { createApp } = require('./app');
const { runMigrations, closePool } = require('./db/postgres');
const { closeClient } = require('./cache/redis');
const { logger } = require('./middleware/requestLogger');

const PORT = parseInt(process.env.PORT || '3000');

async function start() {
  // Step 1: run DB migrations before accepting any traffic
  try {
    await runMigrations();
  } catch (err) {
    logger.error('Migration failed — cannot start', { error: err.message });
    process.exit(1); // exit with error code — Docker/ECS will restart the container
  }

  // Step 2: create the Express app
  const app = createApp();

  // Step 3: start listening
  const server = app.listen(PORT, () => {
    logger.info(`DevRoute API started`, {
      port: PORT,
      env: process.env.NODE_ENV || 'development'
    });
  });

  // ── Graceful shutdown ────────────────────────────────────────
  // When Kubernetes/ECS stops your container it sends SIGTERM
  // You have a few seconds to finish current requests before it force-kills
  async function shutdown(signal) {
    logger.info(`${signal} received — shutting down gracefully`);
    server.close(async () => {
      await closePool();   // close DB connections
      await closeClient(); // close Redis connection
      logger.info('Shutdown complete');
      process.exit(0);
    });

    // If shutdown takes more than 10s, force exit
    setTimeout(() => process.exit(1), 10000);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT')); // Ctrl+C in terminal
}

// Only start the server if this file is run directly
// (not when imported by tests)
if (require.main === module) {
  start();
}

module.exports = { start };