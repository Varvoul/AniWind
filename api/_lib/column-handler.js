import { toArray } from './neon.js';
import { memoize, setCacheHeaders } from './cache.js';

/**
 * Builds a Vercel handler for one of the "standard" columns — shaped
 * { Anime: [...], tmdbTV: [...], tmdbMovie: [...] } with their own
 * dedicated `<column>_updated_at`. `queryRow` is a per-endpoint function
 * running that column's own literal (not dynamically-built) tagged-
 * template query, so there's no dynamic SQL identifier involved anywhere.
 * Caches the normalized result for 6h and returns just that column's own
 * updated_at — never the row-level `updated_at`.
 */
export function makeColumnHandler(cacheKey, queryRow) {
  return async function handler(req, res) {
    if (req.method !== 'GET') {
      return res.status(405).json({ error: 'Method not allowed, use GET' });
    }

    try {
      const payload = await memoize(cacheKey, async () => {
        const row = await queryRow();
        if (!row) return null;
        const raw = row.col || {};
        return {
          Anime: toArray(raw.Anime),
          tmdbTV: toArray(raw.tmdbTV),
          tmdbMovie: toArray(raw.tmdbMovie),
          updated_at: row.ts, // this column's own timestamp — never the row's
        };
      });

      if (!payload) {
        return res.status(404).json({ error: `${cacheKey} has no row` });
      }

      setCacheHeaders(res);
      return res.status(200).json(payload);
    } catch (err) {
      return res.status(500).json({ error: 'DB fetch failed', message: err.message });
    }
  };
}
