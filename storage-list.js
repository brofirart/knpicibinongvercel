import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});

const PREFIX = 'knpicibinong:';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method tidak diizinkan' });
  }
  try {
    const prefix = (req.query.prefix || '').toString();
    const keys = await redis.keys(PREFIX + prefix + '*');
    return res.status(200).json({
      keys: keys.map(k => k.slice(PREFIX.length)),
      prefix: prefix || undefined,
      shared: true,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Terjadi kesalahan server' });
  }
}
