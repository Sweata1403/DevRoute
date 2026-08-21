const Redis = require('ioredis');

let client;

function getClient() {
  if (!client) {
    client = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      lazyConnect: true,
      // Retry up to 5 times, waiting longer each time
      retryStrategy: (times) => {
        if (times > 5) return null; // give up — let app continue without cache
        return Math.min(times * 200, 2000);
      },
      enableOfflineQueue: false,
    });

    client.on('error', (err) => {
      // IMPORTANT: log the error but don't crash
      // The app should still work even if Redis is down — just slower
      console.error('[redis] Error:', err.message);
    });

    client.on('connect', () => console.log('[redis] Connected'));
  }
  return client;
}

// Get a link from cache — returns null if not cached or Redis is down
async function getLink(code) {
  try {
    const raw = await getClient().get(`link:${code}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null; // graceful degradation — fall back to DB
  }
}

// Store a link in cache for 24 hours
async function setLink(code, linkObj) {
  try {
    let ttl = 86400; // 24 hours in seconds
    if (linkObj.expires_at) {
      const remaining = Math.floor((new Date(linkObj.expires_at) - Date.now()) / 1000);
      if (remaining <= 0) return; // already expired — don't cache
      ttl = Math.min(ttl, remaining);
    }
    await getClient().set(`link:${code}`, JSON.stringify(linkObj), 'EX', ttl);
  } catch {
    // non-fatal — missing cache just means next request goes to DB
  }
}

// Remove from cache when a link is deleted
async function deleteLink(code) {
  try {
    await getClient().del(`link:${code}`);
  } catch { }
}

async function closeClient() {
  if (client) {
    await client.quit();
    client = null;
  }
}

module.exports = { getClient, getLink, setLink, deleteLink, closeClient };