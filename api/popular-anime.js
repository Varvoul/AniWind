import { getSql, toArray } from './_lib/neon.js';
import { memoize, setCacheHeaders } from './_lib/cache.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed, use GET' });
  }

  try {
    const payload = await memoize('popular_anime', async () => {
      const sql = getSql();
      const rows = await sql`SELECT popular_anime AS col FROM public.public_frontend_data LIMIT 1`;
      const row = rows && rows[0];
      if (!row) return null;
      // popular_anime has no dedicated `_updated_at` column in the view —
      // no per-column timestamp is fabricated for it (and the row-level
      // `updated_at` is intentionally never surfaced here either).
      return { data: toArray(row.col) };
    });

    if (!payload) {
      return res.status(404).json({ error: 'popular_anime has no row' });
    }

    setCacheHeaders(res);
    return res.status(200).json(payload);
  } catch (err) {
    return res.status(500).json({ error: 'DB fetch failed', message: err.message });
  }
}
