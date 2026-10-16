import { getSql } from './_lib/neon.js';
import { memoize, setCacheHeaders, getCacheInfo } from './_lib/cache.js';
import { buildFallback, getLastGoodFallback, getHeroTvPool } from './_lib/fallback.js';

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
//
// V4.8.0 FIX: RAW passthrough — the endpoint now returns the DB column's
//   jsonb EXACTLY as stored (no toArray flattening, no restructuring), so
//   nothing from the automation (AniList proxy data, self-hosted Jikan v4
//   data, TMDB pages, hidden-tab regions) can ever be dropped or reshaped.
//   Key aliases are added only when the automation used a legacy spelling:
//   Anime/anime, tmdb_tv/tmdbTV, tmdb_movie/tmdbMovie, TMDB_TV, TMDB_Movie.
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
 * Pick the first defined value among legacy/current spellings of a key.
 * The automation has used several key spellings across versions; whichever
 * one is present in the stored jsonb is returned AS-IS (raw, unmodified).
 */
function pickRaw(raw, keys) {
  for (const k of keys) {
    if (raw && raw[k] !== undefined && raw[k] !== null) return raw[k];
  }
  return undefined;
}

/**
 * Load standard column data (hero-slider, top-airing, etc.)
 * V4.8.0: RAW passthrough of the whole jsonb — no flattening/transformation.
 */
async function loadStandardColumn(urlSegment) {
  return memoize(urlSegment, async () => {
    const sql = getSql();
    const rows = await STANDARD_COLUMN_QUERIES[urlSegment](sql);
    const row = rows && rows[0];
    if (!row) return null;

    const raw = row.col || {};

    // RAW values exactly as stored by the automation:
    //   Anime:      array of AniList objects OR array of Jikan v4 objects
    //               (whichever source the automation used for this cycle)
    //   tmdb_tv:    { "1": [...20 items], "2": [...] } paginated object
    //   tmdb_movie: { "1": [...], "2": [...] } paginated object
    return {
      Anime:      pickRaw(raw, ['Anime', 'anime', 'ANIME']) ?? [],
      tmdb_tv:    pickRaw(raw, ['tmdb_tv', 'tmdbTV', 'TMDB_TV']) ?? {},
      tmdb_movie: pickRaw(raw, ['tmdb_movie', 'tmdbMovie', 'TMDB_Movie', 'TMDB_MOVIE']) ?? {},

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
 * V4.8.0: raw passthrough (array stays exactly as stored)
 */
async function loadPopularAnime() {
  return memoize('popular_anime', async () => {
    const sql = getSql();
    const rows = await sql`SELECT popular_anime AS col FROM public.public_frontend_data LIMIT 1`;
    const row = rows && rows[0];
    if (!row) return null;
    return {
      data: row.col ?? [],
      _source: 'neon-db',
      _column: 'popular-anime',
      _fetchedAt: new Date().toISOString()
    };
  });
}

/**
 * Load hidden_tab (TMDB regional data)
 * V4.8.0: RAW passthrough — regions stay exactly as stored.
 * Database stores: { Anime: [], tmdb_tv: { US: [...], GB: [...] }, tmdb_movie: { US: [...], ... } }
 */
async function loadHiddenTab() {
  return memoize('hidden_tab', async () => {
    const sql = getSql();
    const rows = await sql`SELECT hidden_tab AS col, hidden_tab_updated_at AS ts FROM public.public_frontend_data LIMIT 1`;
    const row = rows && rows[0];
    if (!row) return null;

    const raw = row.col || {};

    const tvRaw = pickRaw(raw, ['tmdb_tv', 'tmdbTV', 'TMDB_TV']) ?? {};
    const movieRaw = pickRaw(raw, ['tmdb_movie', 'tmdbMovie', 'TMDB_Movie', 'TMDB_MOVIE']) ?? {};

    return {
      Anime: pickRaw(raw, ['Anime', 'anime', 'ANIME']) ?? [],
      tmdb_tv: tvRaw,
      tmdb_movie: movieRaw,
      updated_at: row.ts,
      _source: 'neon-db',
      _column: 'hidden-tab',
      _fetchedAt: new Date().toISOString(),

      // Convenience stats (read-only — does not modify the raw data above)
      _stats: {
        tvRegions: Object.keys(tvRaw || {}).length,
        movieRegions: Object.keys(movieRaw || {}).length,
        totalTvItems: Object.values(tvRaw || {}).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0),
        totalMovieItems: Object.values(movieRaw || {}).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0)
      }
    };
  });
}

/** Columns this endpoint knows: standard queries + the two special ones. */
const KNOWN_COLUMNS = new Set([
  ...Object.keys(STANDARD_COLUMN_QUERIES),
  'popular-anime',
  'hidden-tab'
]);

/** Per-column last-good payload memory (any source). Emergency serve when
 *  BOTH Neon and the upstream fallback fail — keeps the site rendering
 *  with slightly stale data instead of empty sections. */
const lastGoodAny = new Map(); // column -> payload

function loadColumn(column) {
  if (column === 'popular-anime') return loadPopularAnime();
  if (column === 'hidden-tab') return loadHiddenTab();
  if (STANDARD_COLUMN_QUERIES[column]) return loadStandardColumn(column);
  return null; // unknown column
}

/**
 * HERO TV purity (owner request 2026-10-15): the hero slider's TMDB TV pool
 * must be the mapple airing pool — pure currently-airing TV whose
 * first_air_date falls inside the dynamic 4-year window
 * [Jan 1 of (currentYear-3) .. today UTC] — on EVERY serving path,
 * INCLUDING when the anime pool comes from the Neon-recorded row.
 * The automation's recorded tmdb_tv (t-umi on_the_air pages 1-2, mixed
 * eras incl. decades-old long-runners) is treated as a DEGRADATION source
 * only: even then it is window-filtered before serving.
 *
 * Ordering of sources for the hero TV pool (owner instruction 2026-10-16):
 *   1. t-umi-airing         (owner CF endpoints bionmovies+zeraf, 12h pool
 *                            cache in the worker — PRIMARY)
 *   2. mapple-airing        (owner Vercel proxy, 30-min memo in fallback.js;
 *                            upstream discovery currently failing + poisoned
 *                            empty edge caches; empty answers self-heal via
 *                            cache-bust retry)
 *   3. on_the_air-chain     (t-umi on_the_air pages 1-6, mixed-era degradation)
 *   4. recorded-window-filtered (Neon/fallback pool minus out-of-window items)
 *
 * NOTE: returns a SHALLOW COPY — the payload object may be the memoized
 * Neon cache entry (6h TTL); mutating it in place would corrupt the cache
 * and the lastGoodAny emergency copy.
 */
export function windowFilterTmdbPool(tvObj) {
  const start = `${new Date().getUTCFullYear() - 3}-01-01`;
  const end = new Date().toISOString().split('T')[0];
  const out = {};
  for (const [k, arr] of Object.entries(tvObj || {})) {
    if (!Array.isArray(arr)) continue;
    const kept = arr.filter(it => {
      if (!it || typeof it !== 'object') return false;
      const d = it.first_air_date;
      if (!d) return true; // undated: keep (cannot judge — matches "no hidden-gem filters")
      return d >= start && d <= end;
    });
    if (kept.length) out[k] = kept;
  }
  return out;
}

export async function ensureMappleHeroTv(payload) {
  if (!payload || payload._tv_source) return payload; // fallback builder already stamped its TV source
  try {
    const pool = await getHeroTvPool();
    if (pool && pool.source !== 'unavailable' && Object.keys(pool.pages || {}).length) {
      return { ...payload, tmdb_tv: pool.pages, _tv_source: pool.source };
    }
  } catch (e) { /* degrade to window-filtered recorded pool below */ }
  return { ...payload, tmdb_tv: windowFilterTmdbPool(payload.tmdb_tv), _tv_source: 'recorded-window-filtered' };
}

/**
 * Resilient load chain (2026-10-15 Neon quota outage):
 *   1. Neon (via memoize — 6h memory TTL inside)
 *   2. upstream fallback builders (api/_lib/fallback.js — same sources
 *      the automation uses; 30-min memory cache inside)
 *   3. last good payload from memory (Neon OR fallback origin)
 *   4. rethrow -> 500 JSON (only when we truly have nothing)
 */
async function loadWithFallback(column) {
  let dbErr = null;
  try {
    const payload = await loadColumn(column);
    if (payload) {
      lastGoodAny.set(column, payload);
      return { payload, source: payload._source || 'neon-db' };
    }
  } catch (e) { dbErr = e; }

  // Neon down / empty -> upstream rebuild
  const fb = await buildFallback(column);
  if (fb) return { payload: fb, source: 'upstream-fallback' };

  // both dead -> previous good copy (may be minutes-old Neon data)
  const stale = lastGoodAny.get(column) || getLastGoodFallback(column);
  if (stale) return { payload: stale, source: 'stale-memory' };

  if (dbErr) throw dbErr;
  return null; // genuinely no data anywhere
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed, use GET' });
  }

  const column = req.query.column;

  try {
    let payload;
    let cacheInfo;
    let source = 'neon-db';
    
    if (!KNOWN_COLUMNS.has(column)) {
      return res.status(404).json({ error: `Unknown endpoint /api/${column}` });
    }

    const result = await loadWithFallback(column);
    if (!result) {
      return res.status(404).json({ error: `${column} has no data` });
    }
    payload = result.payload;
    source = result.source;
    if (column === 'hero-slider') payload = await ensureMappleHeroTv(payload);
    cacheInfo = getCacheInfo(column);

    // CDN cache headers:
    //   neon-db          -> standard 6h edge window
    //   upstream-fallback-> shorter 5-min window (fresh-ish data, Neon down)
    //   stale-memory     -> 1-min window, just enough to ride out an outage
    if (source === 'upstream-fallback') setCacheHeaders(res, 300);
    else if (source === 'stale-memory') setCacheHeaders(res, 60);
    else setCacheHeaders(res);
    res.setHeader('X-Data-Source', source);
    if (payload._tv_source) res.setHeader('X-TV-Source', payload._tv_source);

    // Cache info in every response
    const response = {
      ...payload,
      _cache: cacheInfo,
      _version: '4.8.1',
      _data_source: source,
      _timestamp: new Date().toISOString()
    };

    return res.status(200).json(response);
  } catch (err) {
    // Last-resort error: never cache it at the edge (a cached 500 would
    // blank a section for the whole TTL window).
    res.setHeader('Cache-Control', 'no-store');
    return res.status(500).json({
      error: 'DB fetch failed',
      message: err.message,
      _version: '4.8.1',
      _timestamp: new Date().toISOString()
    });
  }
}
