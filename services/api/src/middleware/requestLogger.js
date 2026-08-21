const morgan = require('morgan');
const winston = require('winston');

// Winston = the actual logger (writes structured log entries)
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    // In production: JSON logs (easy to parse by tools like Datadog/CloudWatch)
    // In development: human-readable coloured logs
    process.env.NODE_ENV === 'production'
      ? winston.format.json()
      : winston.format.combine(
          winston.format.colorize(),
          winston.format.printf(({ timestamp, level, message, ...meta }) => {
            const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
            return `${timestamp} [${level}] ${message}${metaStr}`;
          })
        )
  ),
  transports: [new winston.transports.Console()]
});

// Morgan = HTTP request logger, streams output into Winston
const morganMiddleware = morgan(
  ':method :url :status :res[content-length] - :response-time ms',
  {
    stream: { write: (msg) => logger.http(msg.trim()) },
    // Skip health checks — they happen every 30s and clutter logs
    skip: (req) => req.path === '/health' || req.path === '/metrics'
  }
);

module.exports = { morganMiddleware, logger };