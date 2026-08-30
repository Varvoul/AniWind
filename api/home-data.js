import { neon } from '@neondatabase/serverless';

// ─────────────────────────────────────────────────────────────────────────
// AniWind homepage data API
//
// Serves the single cached row from Neon's `public.public_frontend_data`
// view (hero slider, top airing, new releases, etc.) as one JSON payload.
//
// IMPORTANT — why this exists as a server function instead of the frontend
// calling Neon directly:
//   1. The Neon connection string / API key is a full-access database
//      credential. It must never ship inside client-side JS (shared.js),
//      because that file is public in this repo and served to every
//      visitor's browser — anyone could read it and get full read/write
//      access to the database (or, with a Neon *management* API key,
//      to the whole Neon account/billing). Keeping the credential in a
//      Vercel Environment Variable (server-side only) is the only safe
//      option. See NEON_DATABASE_URL below.
//   2. Fronting the DB with this function + an HTTP cache means Vercel's
//      CDN can absorb nearly all homepage traffic. The Neon compute only
//      gets a real query roughly once per CACHE_SECONDS window, no matter
//      how many visitors hit the site — which is what keeps DB CPU time,
//      timeouts, and cold-start overload off the table at scale.
//
// Setup required (one-time, in the Vercel dashboard → Project → Settings
// → Environment Variables):
//   NEON_DATABASE_URL = <the pooled Neon connection string>
//   (Use the "-pooler" host Neon gives you, not the direct host — the
//   pooled endpoint is what lets many concurrent function invocations
//   share connections instead of exhausting Postgres' connection limit.)
// ─────────────────────────────────────────────────────────────────────────

const CACHE_SECONDS = 90;          // fresh for 90s
const STALE_WHILE_REVALIDATE = 600; // serve stale (and refresh in bg) for up to 10min after that

const SIMPLE_SECTIONS = [
  'hero_slider',
  'top_airing',
  'new_releases',
  'new_on_ruri',
  'upcoming_shows',
  'recently_completed',
  'trending_now',
  'most_favourite',
];

// Recursively flattens any {key: array-or-object, ...} shape into one flat
// array. Handles two real data quirks seen in this view:
//   - `tmdbTV` sub-keys are sometimes an object keyed by rotating page/genre
//     numbers (e.g. {"13":[...], "14":[...]}) instead of a plain array.
//   - `ani_schedule.Anime.<Day>` is nested one level deeper again.
// Plain arrays pass through untouched.
function toArray(v) {
  if (Array.isArray(v)) return v;
  if (v && typeof v === 'object') return Object.values(v).flatMap(toArray);
  return [];
}

function normalizeTypeSplit(obj) {
  obj = obj || {};
  return {
    Anime: toArray(obj.Anime),
    tmdbTV: toArray(obj.tmdbTV),
    tmdbMovie: toArray(obj.tmdbMovie),
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed, use GET' });
  }

  if (!process.env.NEON_DATABASE_URL) {
    // Fail soft: the frontend treats a non-200 as "no DB data" and falls
    // back to its existing live API calls, so a missing env var degrades
    // the site instead of breaking it.
    return res.status(503).json({ error: 'NEON_DATABASE_URL is not configured' });
  }

  try {
    const sql = neon(process.env.NEON_DATABASE_URL);

    const rows = await sql`
      SELECT
        hero_slider, hero_slider_updated_at,
        top_airing, top_airing_updated_at,
        new_releases, new_releases_updated_at,
        new_on_ruri, new_on_ruri_updated_at,
        upcoming_shows, upcoming_shows_updated_at,
        recently_completed, recently_completed_updated_at,
        trending_now, trending_now_updated_at,
        most_favourite, most_favourite_updated_at,
        popular_anime,
        hidden_tab, hidden_tab_updated_at,
        ani_schedule, ani_schedule_updated_at,
        updated_at
      FROM public.public_frontend_data
      LIMIT 1
    `;

    const row = rows && rows[0];
    if (!row) {
      return res.status(404).json({ error: 'public_frontend_data has no row' });
    }

    const payload = { updated_at: row.updated_at };

    for (const section of SIMPLE_SECTIONS) {
      payload[section] = {
        ...normalizeTypeSplit(row[section]),
        updated_at: row[`${section}_updated_at`],
      };
    }

    // popular_anime: flat AniList array already, no type split
    payload.popular_anime = toArray(row.popular_anime);

    // hidden_tab: { TMDB_TV: {country: [...]}, TMDB_Movie: {country: [...]} }
    const hiddenRaw = row.hidden_tab || {};
    const normalizeCountryMap = (obj) => {
      const out = {};
      for (const [country, val] of Object.entries(obj || {})) out[country] = toArray(val);
      return out;
    };
    payload.hidden_tab = {
      TMDB_TV: normalizeCountryMap(hiddenRaw.TMDB_TV),
      TMDB_Movie: normalizeCountryMap(hiddenRaw.TMDB_Movie),
      updated_at: row.hidden_tab_updated_at,
    };

    // ani_schedule: { Anime: { Monday: [...], Tuesday: [...], ... } }
    // (source rows are Jikan-shaped objects, day-keyed; DB only carries
    // anime, so tvmaze/tmdb schedule stays on the existing live fetch)
    const scheduleRaw = (row.ani_schedule && row.ani_schedule.Anime) || {};
    const scheduleByDay = {};
    for (const [day, val] of Object.entries(scheduleRaw)) scheduleByDay[day] = toArray(val);
    payload.ani_schedule = { Anime: scheduleByDay, updated_at: row.ani_schedule_updated_at };

    res.setHeader(
      'Cache-Control',
      `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${STALE_WHILE_REVALIDATE}`
    );
    return res.status(200).json(payload);
  } catch (err) {
    return res.status(500).json({ error: 'DB fetch failed', message: err.message });
  }
}
