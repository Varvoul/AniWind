import { getSql, toArray } from './_lib/neon.js';
import { memoize, setCacheHeaders, getCacheInfo } from './_lib/cache.js';

// ─────────────────────────────────────────────────────────────────────────
// One function serving every "/api/<column>" route (hero-slider, top-airing,
// new-releases, new-on-ruri, upcoming-shows, recently-completed,
// trending-now, most-favourite, popular-anime, hidden-tab).
//
// This is deliberately ONE file instead of ten: Vercel's Hobby plan caps a
// deployment at 12 Serverless Functions total, and ten single-purpose files
// (plus ani-schedule/[day].js, anilist.js, migrate-studios) blew past that.
// Vercel's own routing already resolves more-specific paths first, so this
// dynamic catch-all only ever receives requests that don't match a more
// specific static file — /api/anilist and /api/ani-schedule/monday are
// unaffected. Each column still runs its own literal tagged-template query
// (STANDARD_COLUMN_QUERIES below) rather than building SQL from the
// request — no dynamic SQL identifiers anywhere in this file.
//
// V4.7.2 FIX: Corrected column names to match automation storage:
//   - Database stores: tmdb_tv, tmdb_movie (snake_case)
//   - Previous code looked for: tmdbTV, tmdbMovie, TMDB_TV, TMDB_Movie (WRONG!)
//   - Now correctly reads: tmdb_tv, tmdb_movie
// ─────────────────────────────────────────────────────────────────────────

const STANDARD_COLUMN_QUERIES = {
  'hero-slider':        (sql) => sql`SELECT hero_slider AS col, hero_slider_updated_at AS ts FROM public.public_frontend_data LIMIT 1`,
  'top-airing':         (sql) => sql`SELECT top_airing AS col, top_airing_updated_at AS ts FROM public.public_frontend_data LIMIT 1`,
  'new-releases':       (sql) => sql`SELECT new_releases AS col, new_releases_updated_at AS ts FROM public.public_frontend_data LIMIT 1`,
  'new-on-ruri':        (sql) => sql`SELECT new_on_ruri AS col, new_on_ruri_updated_at AS ts FROM public.public_frontend_data LIMIT 1`,
  'upcoming-shows':     (sql) => sql`SELECT upcoming_shows AS col, upcoming_shows_updated_at AS ts FROM public.public_frontend_data LIMIT 1`,
  'recently-completed': (sql) => sql`SELECT recently_completed AS col, recently_completed_updated_at AS ts FROM public.public_frontend_data LIMIT 1`,
  'trending-now':       (sql) => sql`SELECT trending_now AS col, trending_now_updated_at AS ts FROM public.public_frontend_data LIMIT 1`,
  'most-favourite':     (sql) => sql`SELECT most_favourite AS col, most_favourite_updated_at AS ts FROM public.public_frontend_data LIMIT 1`,
};

/**
 * Normalize country/region map - ensures all values are arrays
 * Used for hidden_tab which stores TMDB data by region: { US: [...], GB: [...] }
 */
function normalizeCountryMap(obj) {
  const out = {};
  for (const [country, val] of Object.entries(obj || {})) out[country] = toArray(val);
  return out;
}

/**
 * Load standard column data (hero-slider, top-airing, etc.)
 * V4.7.2 FIXED: Now correctly reads tmdb_tv and tmdb_movie from database
 */
async function loadStandardColumn(urlSegment) {
  return memoize(urlSegment, async () => {
    const sql = getSql();
    const rows = await STANDARD_COLUMN_QUERIES[urlSegment](sql);
    const row = rows && rows[0];
    if (!row) return null;
    
    const raw = row.col || {};
    
    // V4.7.2 FIX: Use correct column names that match automation storage!
    // Automation stores: { Anime: [...], tmdb_tv: {...}, tmdb_movie: {...} }
    return {
      // Anime data (array of anime objects from Anilist/Jikan)
      Anime: toArray(raw.Anime),
      
      // TMDB TV data (object with page numbers or region codes as keys)
      // Example: { "1": [...20 items], "2": [...20 items] } for paginated
      // Or: { "US": [...20], "GB": [...20] } for hidden_tab regions
      tmdb_tv: raw.tmdb_tv || {},
      
      // TMDB Movie data (same structure as tmdb_tv)
      tmdb_movie: raw.tmdb_movie || {},
      
      // Metadata
      updated_at: row.ts, // this column's own timestamp
      _source: 'neon-db',
      _column: urlSegment,
      _fetchedAt: new Date().toISOString()
    };
  });
}

/**
 * Load popular_anime (manual section, no TMDB data)
 */
async function loadPopularAnime() {
  return memoize('popular_anime', async () => {
    const sql = getSql();
    const rows = await sql`SELECT popular_anime AS col FROM public.public_frontend_data LIMIT 1`;
    const row = rows && rows[0];
    if (!row) return null;
    return { 
      data: toArray(row.col),
      _source: 'neon-db',
      _column: 'popular-anime',
      _fetchedAt: new Date().toISOString()
    };
  });
}

/**
 * Load hidden_tab (TMDB regional data)
 * V4.7.2 FIXED: Now correctly returns tmdb_tv and tmdb_movie with region data
 */
async function loadHiddenTab() {
  return memoize('hidden_tab', async () => {
    const sql = getSql();
    const rows = await sql`SELECT hidden_tab AS col, hidden_tab_updated_at AS ts FROM public.public_frontend_data LIMIT 1`;
    const row = rows && rows[0];
    if (!row) return null;
    
    const raw = row.col || {};
    
    // V4.7.2 FIX: Use correct column names!
    // Database stores: { Anime: [], tmdb_tv: { US: [...], GB: [...] }, tmdb_movie: { US: [...], ... } }
    return {
      Anime: toArray(raw.Anime),
      tmdb_tv: normalizeCountryMap(raw.tmdb_tv),
      tmdb_movie: normalizeCountryMap(raw.tmdb_movie),
      updated_at: row.ts,
      _source: 'neon-db',
      _column: 'hidden-tab',
      _fetchedAt: new Date().toISOString(),
      
      // Convenience stats
      _stats: {
        tvRegions: Object.keys(raw.tmdb_tv || {}).length,
        movieRegions: Object.keys(raw.tmdb_movie || {}).length,
        totalTvItems: Object.values(raw.tmdb_tv || {}).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0),
        totalMovieItems: Object.values(raw.tmdb_movie || {}).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0)
      }
    };
  });
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed, use GET' });
  }

  const column = req.query.column;

  try {
    let payload;
    let cacheInfo;
    
    if (column === 'popular-anime') {
      payload = await loadPopularAnime();
      cacheInfo = getCacheInfo('popular_anime');
    } else if (column === 'hidden-tab') {
      payload = await loadHiddenTab();
      cacheInfo = getCacheInfo('hidden_tab');
    } else if (STANDARD_COLUMN_QUERIES[column]) {
      payload = await loadStandardColumn(column);
      cacheInfo = getCacheInfo(column);
    } else {
      return res.status(404).json({ error: `Unknown endpoint /api/${column}` });
    }

    if (!payload) {
      return res.status(404).json({ error: `${column} has no row` });
    }

    // Set CDN cache headers
    setCacheHeaders(res);
    
    // V4.7.2 NEW: Add cache info to response
    const response = {
      ...payload,
      _cache: cacheInfo,
      _version: '4.7.2',
      _timestamp: new Date().toISOString()
    };

    return res.status(200).json(response);
  } catch (err) {
    return res.status(500).json({ 
      error: 'DB fetch failed', 
      message: err.message,
      _version: '4.7.2',
      _timestamp: new Date().toISOString()
    });
  }
}
