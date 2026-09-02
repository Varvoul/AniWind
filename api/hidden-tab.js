import { getSql, toArray } from './_lib/neon.js';
import { memoize, setCacheHeaders } from './_lib/cache.js';

function normalizeCountryMap(obj) {
  const out = {};
  for (const [country, val] of Object.entries(obj || {})) out[country] = toArray(val);
  return out;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed, use GET' });
  }

  try {
    const payload = await memoize('hidden_tab', async () => {
      const sql = getSql();
      const rows = await sql`SELECT hidden_tab AS col, hidden_tab_updated_at AS ts FROM public.public_frontend_data LIMIT 1`;
      const row = rows && rows[0];
      if (!row) return null;
      const raw = row.col || {};
      return {
        TMDB_TV: normalizeCountryMap(raw.TMDB_TV),
        TMDB_Movie: normalizeCountryMap(raw.TMDB_Movie),
        updated_at: row.ts, // this column's own timestamp — never the row's
      };
    });

    if (!payload) {
      return res.status(404).json({ error: 'hidden_tab has no row' });
    }

    setCacheHeaders(res);
    return res.status(200).json(payload);
  } catch (err) {
    return res.status(500).json({ error: 'DB fetch failed', message: err.message });
  }
}
