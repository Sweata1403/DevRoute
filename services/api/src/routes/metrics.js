/**
 * metrics.routes.js
 *
 * GET /metrics  — Prometheus-compatible metrics scrape endpoint
 *
 * Exposes:
 *   devroute_links_total          — gauge: total active links per user (label: user_id)
 *   devroute_links_by_health      — gauge: active links per health_status
 *   devroute_clicks_total         — counter: total click events recorded
 *   devroute_health_checks_total  — counter: health checks performed (label: result)
 *   + default Node.js / process metrics from prom-client
 *
 * Install:  npm install prom-client   (in services/api)
 * Mount:    app.use('/metrics', metricsRouter)   — BEFORE requireAuth
 *           (Prometheus scraper hits /metrics without a Bearer token)
 *
 * In Grafana, add a Prometheus data source pointing at http://<ec2-ip>:3000
 * and import dashboard JSON or build panels manually.
 */

const express = require('express');
const client = require('prom-client');
const { query } = require('../db/postgres');

const router = express.Router();

// ── Prometheus registry ──────────────────────────────────────────────────────
const register = new client.Registry();

// Collect default Node.js metrics (event loop lag, heap, GC, etc.)
client.collectDefaultMetrics({ register });

// ── Custom gauges / counters ─────────────────────────────────────────────────
const linksTotal = new client.Gauge({
  name: 'devroute_links_total',
  help: 'Total active short links',
  registers: [register],
});

const linksByHealth = new client.Gauge({
  name: 'devroute_links_by_health',
  help: 'Active links grouped by health_status',
  labelNames: ['status'],
  registers: [register],
});

const clicksTotal = new client.Gauge({
  name: 'devroute_clicks_total',
  help: 'Total click-through events across all links',
  registers: [register],
});

const healthChecksTotal = new client.Gauge({
  name: 'devroute_health_checks_total',
  help: 'Total health checks performed, labelled by result',
  labelNames: ['result'],
  registers: [register],
});

// ── Scrape endpoint ──────────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    // 1. Total active links
    const totalRes = await query(
      `SELECT COUNT(*) AS total FROM links WHERE active = TRUE`
    );
    linksTotal.set(parseInt(totalRes.rows[0]?.total ?? 0));

    // 2. Links by health status
    const healthRes = await query(
      `SELECT health_status, COUNT(*) AS cnt
       FROM links WHERE active = TRUE
       GROUP BY health_status`
    );
    // Reset all labels first so removed statuses don't linger
    linksByHealth.reset();
    for (const row of healthRes.rows) {
      linksByHealth.set({ status: row.health_status ?? 'unknown' }, parseInt(row.cnt));
    }

    // 3. Total clicks — count rows in click_events table
    const clickRes = await query(
      `SELECT COUNT(*) AS total FROM click_events`
    ).catch(() => ({ rows: [{ total: 0 }] }));
    clicksTotal.set(parseInt(clickRes.rows[0]?.total ?? 0));

    // 4. Health check counts from audit_logs
    const checkRes = await query(
      `SELECT action, COUNT(*) AS cnt
       FROM audit_logs
       WHERE action LIKE 'health.%'
       GROUP BY action`
    );
    healthChecksTotal.reset();
    for (const row of checkRes.rows) {
      const result = row.action.replace('health.', ''); // healthy | degraded | dead
      healthChecksTotal.set({ result }, parseInt(row.cnt));
    }

    // Return Prometheus text format
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (err) {
    next(err);
  }
});

module.exports = router;