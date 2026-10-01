/**
 * audit.model.js
 *
 * Every significant action in DevRoute is written here:
 * - link.created, link.deleted, link.expired, link.maxed
 * - user.registered, user.login, user.login_failed
 * - redirect.success, redirect.expired, redirect.not_found
 *
 * This is a compliance/observability feature — Capgemini-style
 * enterprise apps always have an audit trail for SOC2 / ISO 27001.
 */

const { query } = require('../db/postgres');

/**
 * Write one audit event. Fire-and-forget safe — catch errors at call site.
 *
 * @param {object} params
 * @param {string} params.action     - e.g. 'link.created', 'redirect.expired'
 * @param {number} [params.userId]   - who did it (null for anonymous)
 * @param {number} [params.linkId]   - which link was involved
 * @param {string} [params.ipAddress]
 * @param {string} [params.userAgent]
 * @param {object} [params.metadata] - any extra context as JSON
 */
async function writeAuditLog({ action, userId, linkId, ipAddress, userAgent, metadata }) {
  await query(
    `INSERT INTO audit_logs (action, user_id, link_id, ip_address, user_agent, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      action,
      userId || null,
      linkId || null,
      ipAddress || null,
      userAgent || null,
      metadata ? JSON.stringify(metadata) : null
    ]
  );
}

/**
 * Fetch audit logs — filterable by userId, linkId, or action prefix.
 * Returns newest first, paginated.
 */
async function getAuditLogs({ userId, linkId, action, page = 1, limit = 50 }) {
  const conditions = [];
  const params = [];
  let i = 1;

  if (userId) { conditions.push(`user_id = $${i++}`); params.push(userId); }
  if (linkId) { conditions.push(`link_id = $${i++}`); params.push(linkId); }
  if (action) { conditions.push(`action LIKE $${i++}`); params.push(`${action}%`); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const offset = (page - 1) * limit;

  params.push(limit, offset);

  const result = await query(
    `SELECT al.*, u.email as user_email
     FROM audit_logs al
     LEFT JOIN users u ON u.id = al.user_id
     ${where}
     ORDER BY al.created_at DESC
     LIMIT $${i++} OFFSET $${i}`,
    params
  );

  return result.rows;
}

module.exports = { writeAuditLog, getAuditLogs };