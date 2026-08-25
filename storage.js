import { Redis } from '@upstash/redis';

// Mendukung dua kemungkinan nama variabel environment, tergantung cara
// Anda menyambungkan database di Vercel (integrasi "Upstash for Redis"
// / Vercel KV biasanya memakai KV_REST_API_URL / KV_REST_API_TOKEN,
// sedangkan Upstash langsung biasanya memakai UPSTASH_REDIS_REST_URL /
// UPSTASH_REDIS_REST_TOKEN).
const redis = new Redis({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Semua key situs ini diberi prefix supaya tidak bentrok jika database
// yang sama dipakai untuk keperluan lain.
const PREFIX = 'knpicibinong:';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const { key } = req.query;
      if (!key) return res.status(400).json({ error: 'key wajib diisi' });
      const value = await redis.get(PREFIX + key);
      return res.status(200).json({ key, value: value ?? null });
    }

    if (req.method === 'POST') {
      const { key, value } = req.body || {};
      if (!key) return res.status(400).json({ error: 'key wajib diisi' });
      await redis.set(PREFIX + key, value);
      return res.status(200).json({ key, value });
    }

    if (req.method === 'DELETE') {
      const { key } = req.body || {};
      if (!key) return res.status(400).json({ error: 'key wajib diisi' });
      await redis.del(PREFIX + key);
      return res.status(200).json({ key, deleted: true });
    }

    res.setHeader('Allow', ['GET', 'POST', 'DELETE']);
    return res.status(405).json({ error: 'Method tidak diizinkan' });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Terjadi kesalahan server' });
  }
}
