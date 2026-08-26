const { query } = require('../db/postgres');
const { nanoid } = require('nanoid');
const QRCode = require('qrcode');

async function createLink({ url, alias, userId, expiresAt, maxClicks }) {
  let code = alias || nanoid(8);

  if (!alias) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const result = await query(
          `INSERT INTO links (code, url, user_id, expires_at, max_clicks)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING *`,
          [code, url, userId || null, expiresAt || null, maxClicks || null]
        );
        return result.rows[0];
      } catch (err) {
        if (err.code === '23505' && attempt < 2) {
          code = nanoid(8);
          continue;
        }
        throw err;
      }
    }
  }

  const result = await query(
    `INSERT INTO links (code, url, alias, user_id, expires_at, max_clicks)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [code, url, alias || null, userId || null, expiresAt || null, maxClicks || null]
  );
  return result.rows[0];
}

async function findByCode(code) {
  const result = await query(
    `SELECT * FROM links WHERE (code = $1 OR alias = $1) AND active = TRUE`,
    [code]
  );
  return result.rows[0] || null;
}

/**
 * Check if a link is still valid:
 * - not expired by date
 * - not exceeded max clicks
 */
async function isLinkValid(link) {
  if (link.expires_at && new Date() > new Date(link.expires_at)) {
    return false;
  }

  if (link.max_clicks) {
    const result = await query(
      `SELECT COUNT(*) FROM clicks WHERE link_id = $1`,
      [link.id]
    );
    if (parseInt(result.rows[0].count) >= link.max_clicks) {
      return false;
    }
  }

  return true;
}

async function listLinks({ userId, page = 1, limit = 20 }) {
  const offset = (page - 1) * limit;

  const whereClause = userId ? 'WHERE l.user_id = $3' : '';
  const params = userId
    ? [limit, offset, userId]
    : [limit, offset];

  const result = await query(
    `SELECT l.*,
            COUNT(c.id) AS click_count
     FROM links l
     LEFT JOIN clicks c ON c.link_id = l.id
     ${whereClause}
     GROUP BY l.id
     ORDER BY l.created_at DESC
     LIMIT $1 OFFSET $2`,
    params
  );

  return result.rows;
}

async function deleteLink(code, userId) {
  const result = await query(
    `UPDATE links
     SET active = FALSE
     WHERE (code = $1 OR alias = $1)
     AND ($2::integer IS NULL OR user_id = $2)
     RETURNING id`,
    [code, userId || null]
  );
  return result.rows[0] || null;
}

async function recordClick({ linkId, userAgent, ipAddress, referer }) {
  await query(
    `INSERT INTO clicks (link_id, user_agent, ip_address, referer)
     VALUES ($1, $2, $3, $4)`,
    [linkId, userAgent, ipAddress, referer]
  );
}

async function getAnalytics(code) {
  const link = await findByCode(code);
  if (!link) return null;

  const [total, recent, referers, clicksOverTime] = await Promise.all([
    query(`SELECT COUNT(*) FROM clicks WHERE link_id = $1`, [link.id]),
    query(
      `SELECT * FROM clicks WHERE link_id = $1 ORDER BY clicked_at DESC LIMIT 10`,
      [link.id]
    ),
    query(
      `SELECT referer, COUNT(*) as count
       FROM clicks WHERE link_id = $1 AND referer IS NOT NULL
       GROUP BY referer ORDER BY count DESC LIMIT 10`,
      [link.id]
    ),
    query(
      `SELECT DATE_TRUNC('day', clicked_at) as day, COUNT(*) as count
       FROM clicks WHERE link_id = $1
       GROUP BY day ORDER BY day DESC LIMIT 30`,
      [link.id]
    )
  ]);

  return {
    link,
    totalClicks: parseInt(total.rows[0].count),
    recentClicks: recent.rows,
    topReferers: referers.rows,
    clicksOverTime: clicksOverTime.rows
  };
}

/**
 * Generate a QR code as a PNG data URL for a short link.
 * The QR code encodes the full short URL so scanning
 * it redirects the user just like clicking the link.
 */
async function generateQRCode(code) {
  const shortUrl = `${process.env.BASE_URL}/${code}`;
  const dataUrl = await QRCode.toDataURL(shortUrl, {
    width: 300,
    margin: 2,
    color: {
      dark: '#000000',
      light: '#FFFFFF'
    }
  });
  return dataUrl;
}

module.exports = {
  createLink,
  findByCode,
  isLinkValid,
  listLinks,
  deleteLink,
  recordClick,
  getAnalytics,
  generateQRCode
};