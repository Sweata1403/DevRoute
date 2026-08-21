const { query } = require('../db/postgres');
const { customAlphabet } = require('nanoid');

// customAlphabet lets us define exactly which characters to use
// We exclude confusing chars like 0/O, 1/l/I
const generateCode = customAlphabet(
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
  8  // 8 characters long
);
// 62^8 = 218 trillion possible codes — we won't run out


async function createLink({ originalUrl, alias, createdBy, expiresAt }) {
  const code = alias || generateCode();

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await query(
        `INSERT INTO links (code, original_url, created_by, expires_at)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [attempt === 0 ? code : generateCode(), originalUrl, createdBy || null, expiresAt || null]
      );
      return result.rows[0]; // return the created row
    } catch (err) {
      if (err.code === '23505') {
        // 23505 = PostgreSQL unique_violation error code
        if (alias) {
          // User picked this alias — it's taken, tell them
          throw Object.assign(new Error('Alias already in use'), { status: 409 });
        }
        // Random code collision — extremely rare but retry with a new code
        continue;
      }
      throw err; // some other DB error — re-throw it
    }
  }
  throw new Error('Failed to generate unique code after 3 attempts');
}


async function findByCode(code) {
  const result = await query(
    `SELECT * FROM links WHERE code = $1 AND active = TRUE`,
    [code]
  );
  return result.rows[0] || null; // return the row or null if not found
}

async function listLinks({ page = 1, limit = 20 } = {}) {
  const offset = (page - 1) * limit;
  const result = await query(
    `SELECT id, code, original_url, created_by, expires_at, created_at,
            (SELECT COUNT(*) FROM clicks WHERE link_id = links.id) AS click_count
     FROM links
     WHERE active = TRUE
     ORDER BY created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  const countResult = await query(
    `SELECT COUNT(*) FROM links WHERE active = TRUE`
  );
  return {
    links: result.rows,
    total: parseInt(countResult.rows[0].count),
    page,
    limit
  };
}

async function deleteLink(code) {
  // Soft delete — we set active=FALSE instead of actually deleting
  // This preserves click history and makes rollback easy
  const result = await query(
    `UPDATE links SET active = FALSE WHERE code = $1 AND active = TRUE RETURNING id`,
    [code]
  );
  return result.rowCount > 0; // true if something was deleted, false if not found
}


async function recordClick({ linkId, ipHash, userAgent, referrer, country }) {
  await query(
    `INSERT INTO clicks (link_id, ip_hash, user_agent, referrer, country)
     VALUES ($1, $2, $3, $4, $5)`,
    [linkId, ipHash, userAgent || null, referrer || null, country || null]
  );
}

async function getAnalytics(code) {
  const linkResult = await query(
    `SELECT id, code, original_url, created_at FROM links WHERE code = $1`,
    [code]
  );
  if (!linkResult.rows[0]) return null;
  const link = linkResult.rows[0];

  // Run all 4 analytics queries in PARALLEL — not one after the other
  // Promise.all means total time = slowest single query, not sum of all 4
  const [total, byCountry, byReferrer, overTime] = await Promise.all([

    query(`SELECT COUNT(*) AS count FROM clicks WHERE link_id = $1`, [link.id]),

    query(
      `SELECT COALESCE(country, 'unknown') AS country, COUNT(*) AS count
       FROM clicks WHERE link_id = $1
       GROUP BY country ORDER BY count DESC LIMIT 10`,
      [link.id]
    ),

    query(
      `SELECT COALESCE(referrer, 'direct') AS referrer, COUNT(*) AS count
       FROM clicks WHERE link_id = $1
       GROUP BY referrer ORDER BY count DESC LIMIT 10`,
      [link.id]
    ),

    query(
      `SELECT DATE(clicked_at) AS date, COUNT(*) AS count
       FROM clicks
       WHERE link_id = $1 AND clicked_at >= NOW() - INTERVAL '30 days'
       GROUP BY date ORDER BY date`,
      [link.id]
    )
  ]);

  return {
    code: link.code,
    original_url: link.original_url,
    created_at: link.created_at,
    total_clicks: parseInt(total.rows[0].count),
    by_country: byCountry.rows,
    by_referrer: byReferrer.rows,
    over_time: overTime.rows
  };
}


module.exports = {
  createLink,
  findByCode,
  listLinks,
  deleteLink,
  recordClick,
  getAnalytics
};