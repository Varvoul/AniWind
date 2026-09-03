// ─────────────────────────────────────────────────────────────────────────
// /api/recently-completed-cache/<page>
//   page ∈ { 3, 4, 5, 6, 7, 8, 9, 10 }
//
// Server-side 12-hour TTL cache for the Recently Completed grid's later
// pages. Pages 1 and 2 are served from /api/recently-completed (the Neon
// DB column with equal anime/TV/movie distribution). Pages 3+ used to fire
// live TMDB /discover + AniList on every page load — this endpoint wraps
// those same live calls with a server-side cache so ALL users globally
// share one cached response per page until the TTL expires.
//
// On cache MISS the function fetches from:
//   - TMDB /discover/tv (with_status=ended, last 6 months, page N)
//   - TMDB /discover/movie (with_release_type=2|3, last 6 months, page N)
//   - AniList (status=FINISHED, format_in=[TV,TV_SHORT], sort=END_DATE_DESC, page N)
// and returns { tv: [...], movie: [...], anime: [...] } in the raw
// API shapes so the frontend's existing extraction logic works unchanged.
// ─────────────────────────────────────────────────────────────────────────

const TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const TTL_SECONDS = TTL_MS / 1000;
const store = new Map(); // page -> { data, expiresAt }

const TMDB_BEARER = 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiI0Yjc0YzE4NjlkZGQxMWEzNTM1MDFlNGI0MjY4MzA3YyIsIm5iZiI6MTc2NDM5Mzg3MS4yNTEwMDAyLCJzdWIiOiI2OTJhODM4ZjNkNTVkM2Y1NzJiOGVlYjIiLCJzY29wZXMiOlsiYXBpX3JlYWQiXSwidmVyc2lvbiI6MX0.qN331VqKQ5rfgvkadaRLYG6fNXp4t_lOee3K15f4gCo';

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

async function fetchTMDBDiscover(endpoint, params) {
  const url = `https://api.themoviedb.org/3${endpoint}?${params}`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${TMDB_BEARER}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) return { results: [] };
    return await res.json();
  } catch (e) {
    return { results: [] };
  }
}

async function fetchAnilistCompleted(gridPage) {
  // AniList caps this query at 50 results per request (perPage=100 still
  // returns only 50), and 50 anime + 20 TV + 20 movies is not enough to fill
  // 10 complete grid rows (~70 items) after poster/MAL filtering. So each
  // grid page fetches TWO AniList pages with a unique mapping so adjacent
  // grid pages never duplicate shows:
  //   grid page N → AniList pages (2N-3, 2N-2)
  //     grid 3 → 3,4   grid 4 → 5,6  ...  grid 10 → 17,18
  const query = `
    query ($page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        media(
          type: ANIME,
          status: FINISHED,
          format_in: [TV, TV_SHORT],
          isAdult: false,
          sort: [END_DATE_DESC]
        ) {
          ${ANILIST_ANIME_FIELDS}
        }
      }
    }
  `;
  const anilistPages = [gridPage * 2 - 3, gridPage * 2 - 2];
  const settled = await Promise.all(anilistPages.map(async (p) => {
    try {
      const res = await fetch('https://graphql.anilist.co', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query, variables: { page: p, perPage: 50 } }),
        signal: AbortSignal.timeout(10000)
      });
      if (!res.ok) return [];
      const json = await res.json();
      return json?.data?.Page?.media || [];
    } catch (e) {
      return [];
    }
  }));
  // Flatten in page order (newest first) — unique per grid page, no overlap.
  return settled.flat();
}

async function buildPayload(pageStr) {
  const page = parseInt(pageStr, 10);
  if (isNaN(page) || page < 3 || page > 10) {
    return { error: 'page must be between 3 and 10', status: 400 };
  }

  // Mirror the frontend's date range: last 6 months
  const today = new Date().toISOString().split('T')[0];
  const sixMonthsAgo = new Date(Date.now() - 6 * 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  // Fetch TV + Movies + Anime in parallel
  const [tvData, movieData, anilistAnime] = await Promise.all([
    fetchTMDBDiscover('/discover/tv',
      `sort_by=first_air_date.desc&with_status=ended&first_air_date.gte=${sixMonthsAgo}&first_air_date.lte=${today}&page=${page}&language=en-US`),
    fetchTMDBDiscover('/discover/movie',
      `sort_by=release_date.desc&with_release_type=2|3&release_date.gte=${sixMonthsAgo}&release_date.lte=${today}&page=${page}&language=en-US`),
    fetchAnilistCompleted(page)
  ]);

  return {
    tv: tvData?.results || [],
    movie: movieData?.results || [],
    anime: anilistAnime,
    cachedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + TTL_MS).toISOString(),
    source: 'live-tmdb-anilist',
    page
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed, use GET' });
  }

  const page = req.query.page;
  const pageNum = parseInt(page, 10);
  if (isNaN(pageNum) || pageNum < 3 || pageNum > 10) {
    return res.status(400).json({ error: `Invalid page '${page}'. Must be between 3 and 10.` });
  }

  // Set 12h CDN cache + 12h stale-while-revalidate so the edge also serves
  // cached responses globally without hitting the function.
  res.setHeader('Cache-Control', `public, s-maxage=${TTL_SECONDS}, stale-while-revalidate=${TTL_SECONDS}`);
  res.setHeader('Vercel-CDN-Cache-Control', `public, s-maxage=${TTL_SECONDS}`);

  // In-memory cache (per warm function instance)
  const now = Date.now();
  const hit = store.get(pageNum);
  if (hit && hit.expiresAt > now) {
    return res.status(200).json(hit.data);
  }

  try {
    const data = await buildPayload(page);
    if (data.error) {
      return res.status(data.status).json({ error: data.error });
    }
    store.set(pageNum, { data, expiresAt: now + TTL_MS });
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: 'Recently completed cache fetch failed', message: err.message });
  }
}
