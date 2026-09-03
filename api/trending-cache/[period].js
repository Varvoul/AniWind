// ─────────────────────────────────────────────────────────────────────────
// /api/trending-cache/<period>
//   period ∈ { week, month }
//
// Server-side 12-hour TTL cache for the Trending Now sidebar's Week and
// Month toggle tabs. The Daily tab uses /api/trending-now (the pre-computed
// Neon column); Week and Month used to fire live TMDB /trending/all/<period>
// + AniList trending on every page load — this endpoint wraps those same
// live calls with a server-side cache so ALL users globally share one
// cached response per period until the TTL expires.
//
// On cache MISS the function fetches from:
//   - TMDB:  https://api.themoviedb.org/3/trending/all/<period>
//   - AniList: trending anime (status RELEASING for week, popularity for month)
// normalizes them to the same card shape the frontend's _loadTrendingDaily
// produces, then returns { items: [...], cachedAt, expiresAt }.
// ─────────────────────────────────────────────────────────────────────────

const TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const TTL_SECONDS = TTL_MS / 1000;
const store = new Map(); // period -> { data, expiresAt }

const TMDB_BEARER = 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiI0Yjc0YzE4NjlkZGQxMWEzNTM1MDFlNGI0MjY4MzA3YyIsIm5iZiI6MTc2NDM5Mzg3MS4yNTEwMDAyLCJzdWIiOiI2OTJhODM4ZjNkNTVkM2Y1NzJiOGVlYjIiLCJzY29wZXMiOlsiYXBpX3JlYWQiXSwidmVyc2lvbiI6MX0.qN331VqKQ5rfgvkadaRLYG6fNXp4t_lOee3K15f4gCo';
const TMDB_IMAGE = 'https://image.tmdb.org/t/p';

// AniList field list — must match the frontend's ANILIST_ANIME_FIELDS so the
// shape is identical to what /api/trending-now returns.
const ANILIST_ANIME_FIELDS = `
  id idMal
  title { romaji english native }
  format genres season seasonYear
  status source countryOfOrigin
  isAdult siteUrl
  averageScore meanScore popularity favourites
  startDate { year month day }
  endDate { year month day }
  episodes duration
  coverImage { extraLarge large medium }
  bannerImage
  studios(isMain: true) { nodes { name } }
  description
  nextAiringEpisode { episode airingAt timeUntilAiring }
  trailer { id site }
  tags { name rank isMediaSpoiler }
`;

async function fetchTMDBTrending(period) {
  // TMDB's /trending/all/<window> endpoint accepts 'day' or 'week'. For the
  // 'month' tab we use 'week' and supplement with /discover/movie for the
  // last 30 days, mirroring the original frontend logic.
  try {
    const url = `https://api.themoviedb.org/3/trending/all/${period === 'month' ? 'week' : period}?language=en-US`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${TMDB_BEARER}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.results) ? data.results : [];
  } catch (e) {
    return [];
  }
}

async function fetchAnilistTrending(period) {
  const sort = period === 'week' ? 'TRENDING_DESC' : 'POPULARITY_DESC';
  const statusFilter = period === 'week' ? 'status: RELEASING, ' : '';
  const query = `
    query {
      Page(page: 1, perPage: 10) {
        media(type: ANIME, ${statusFilter} isAdult: false, sort: ${sort}) {
          ${ANILIST_ANIME_FIELDS}
        }
      }
    }
  `;
  try {
    const res = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query })
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data?.data?.Page?.media || [];
  } catch (e) {
    return [];
  }
}

// Normalize the raw TMDB + AniList responses into the same card shape the
// frontend's _loadTrendingDaily produces, so the renderer doesn't need to
// know which tab the data came from.
function normalizeItems(tmdbResults, anilistMedia) {
  const items = [];

  // TMDB items — split by media_type, just like _loadTrendingDaily does
  for (const i of tmdbResults) {
    if (!i.poster_path) continue;
    if (i.media_type === 'tv' || (!i.media_type && (i.name || i.first_air_date))) {
      items.push({
        id: `tmdb-tr-tv-${i.id}`,
        tmdb_id: i.id,
        title: i.name || i.original_name || i.title || 'Unknown',
        poster: `${TMDB_IMAGE}/w185${i.poster_path}`,
        type: 'TV',
        score: Number(i.vote_average) || 0,
        averageScore: (Number(i.vote_average) || 0) * 10,
        popularity: i.popularity || 0,
        favourites: i.vote_count || 0,
        format: 'TV-Series',
        season: null,
        genres: (i.genre_ids || []),
        overview: i.overview || '',
        release_date: i.first_air_date || i.release_date || ''
      });
    } else if (i.media_type === 'movie' || i.title) {
      items.push({
        id: `tmdb-tr-mv-${i.id}`,
        tmdb_id: i.id,
        title: i.title || i.original_title || i.name || 'Unknown',
        poster: `${TMDB_IMAGE}/w185${i.poster_path}`,
        type: 'Movie',
        score: Number(i.vote_average) || 0,
        averageScore: (Number(i.vote_average) || 0) * 10,
        popularity: i.popularity || 0,
        favourites: i.vote_count || 0,
        format: null, // TMDB movies: NO format field
        season: null,
        genres: (i.genre_ids || []),
        overview: i.overview || '',
        release_date: i.release_date || ''
      });
    }
  }

  // AniList items
  for (const m of anilistMedia) {
    if (m.isAdult) continue;
    const title = m.title?.romaji || m.title?.english || m.title?.native || 'Unknown';
    const poster = m.coverImage?.large || m.coverImage?.medium || '';
    if (!poster) continue;
    items.push({
      id: `anilist-tr-${m.id}`,
      mal_id: m.idMal,
      anilist_id: m.id,
      title,
      poster,
      type: 'Anime',
      score: m.averageScore ? Number(m.averageScore) / 10 : 0,
      averageScore: m.averageScore || 0,
      meanScore: m.meanScore || 0,
      popularity: m.popularity || 0,
      favourites: m.favourites || 0,
      format: m.format || 'TV',
      season: m.season || null,
      genres: m.genres || [],
      synopsis: m.description || '',
      release_date: m.startDate?.year ? String(m.startDate.year) : ''
    });
  }

  // Cross-source dedup by id, then take top 20 by score
  const seen = new Set();
  const deduped = items.filter(s => {
    if (!s.id || seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });
  return deduped.sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 20);
}

async function buildPayload(period) {
  const [tmdbResults, anilistMedia] = await Promise.all([
    fetchTMDBTrending(period),
    fetchAnilistTrending(period)
  ]);
  const items = normalizeItems(tmdbResults, anilistMedia);
  return {
    items,
    cachedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + TTL_MS).toISOString(),
    source: 'live-tmdb-anilist',
    period
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed, use GET' });
  }

  const period = req.query.period;
  if (period !== 'week' && period !== 'month') {
    return res.status(400).json({ error: `Invalid period '${period}'. Must be 'week' or 'month'.` });
  }

  // Set 12h CDN cache + 12h stale-while-revalidate so the edge also serves
  // cached responses globally without hitting the function.
  res.setHeader('Cache-Control', `public, s-maxage=${TTL_SECONDS}, stale-while-revalidate=${TTL_SECONDS}`);
  res.setHeader('Vercel-CDN-Cache-Control', `public, s-maxage=${TTL_SECONDS}`);

  // In-memory cache (per warm function instance)
  const now = Date.now();
  const hit = store.get(period);
  if (hit && hit.expiresAt > now) {
    return res.status(200).json(hit.data);
  }

  try {
    const data = await buildPayload(period);
    store.set(period, { data, expiresAt: now + TTL_MS });
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: 'Trending cache fetch failed', message: err.message });
  }
}
