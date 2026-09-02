import { getSql, toArray } from './_lib/neon.js';
import { memoize, setCacheHeaders } from './_lib/cache.js';

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

function normalizeCountryMap(obj) {
  const out = {};
  for (const [country, val] of Object.entries(obj || {})) out[country] = toArray(val);
  return out;
}

async function loadStandardColumn(urlSegment) {
  return memoize(urlSegment, async () => {
    const sql = getSql();
    const rows = await STANDARD_COLUMN_QUERIES[urlSegment](sql);
    const row = rows && rows[0];
    if (!row) return null;
    const raw = row.col || {};
    return {
      Anime: toArray(raw.Anime),
      tmdbTV: toArray(raw.tmdbTV),
      tmdbMovie: toArray(raw.tmdbMovie),
      updated_at: row.ts, // this column's own timestamp — never the row's
    };
  });
}

async function loadPopularAnime() {
  return memoize('popular_anime', async () => {
    const sql = getSql();
    const rows = await sql`SELECT popular_anime AS col FROM public.public_frontend_data LIMIT 1`;
    const row = rows && rows[0];
    if (!row) return null;
    // No dedicated `_updated_at` column exists for popular_anime in the
    // view — no per-column timestamp is fabricated for it, and the
    // row-level `updated_at` is intentionally never surfaced here either.
    return { data: toArray(row.col) };
  });
}

async function loadHiddenTab() {
  return memoize('hidden_tab', async () => {
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
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed, use GET' });
  }

  const column = req.query.column;

  try {
    let payload;
    if (column === 'popular-anime') {
      payload = await loadPopularAnime();
    } else if (column === 'hidden-tab') {
      payload = await loadHiddenTab();
    } else if (STANDARD_COLUMN_QUERIES[column]) {
      payload = await loadStandardColumn(column);
    } else {
      return res.status(404).json({ error: `Unknown endpoint /api/${column}` });
    }

    if (!payload) {
      return res.status(404).json({ error: `${column} has no row` });
    }

    setCacheHeaders(res);
    return res.status(200).json(payload);
  } catch (err) {
    return res.status(500).json({ error: 'DB fetch failed', message: err.message });
  }
}
