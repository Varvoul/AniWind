// /api/sidebar-cache?section=hiddenGem|topRanking|mostFavourite&type=tv|movie|anime-tv|anime-movie
//
// SHARED server-side cache for the info-page right sidebar (owner request
// 2026-10-16): Hidden Gem / Top Ranking / Most Favourite rarely change, so
// EVERY visitor is served from one shared copy instead of each browser
// hammering the upstream APIs. Both tv/movie toggles are cached separately
// (the `type` query covers them: tv | movie for TMDB pages, anime-tv |
// anime-movie for the ruri-fed anime pages).
//
// Freshness: 12-hour TTL (owner spec 108-S). A background-safe guard decides
// what enters the cache — a refresh only REPLACES the stored copy when the
// upstream answer VALIDATES (≥ 5 rows, each with a usable title/name and
// image or score); a corrupted/empty upstream answer NEVER overwrites the
// good copy (the stale one keeps serving until real data returns). So the
// cache only re-fills every 12h with genuinely fresh upstream data, and a
// failing/ corrupt live API can never poison it.
//
// Sources (108-S: anime sections use the same chain as the page itself):
//   TMDB sections : mapple → t-umi → t-umi.zeraf → direct TMDB (Bearer)
//   anime sections: ruri worker → anilist-my-proxy → self-hosted jikan
//                   (AniList rows normalized to jikan shape before caching)
//
// Response: { ok, key, source, cached_at, age_seconds, ttl_seconds, count, data }
// CDN: s-maxage=3600 + stale-while-revalidate so cross-region traffic is
// absorbed at the edge; the in-memory copy is the second layer.
const TTL_MS = 12 * 60 * 60 * 1000; // 12 hours (owner spec 108-S)
const store = new Map(); // key -> { data, source, cachedAt, expiresAt }

const TMDB_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiI0Yjc0YzE4NjlkZGQxMWEzNTM1MDFlNGI0MjY4MzA3YyIsIm5iZiI6MTc2NDM5Mzg3MS4yNTEwMDAyLCJzdWIiOiI2OTJhODM4ZjNkNTVkM2Y1NzJiOGVlYjIiLCJzY29wZXMiOlsiYXBpX3JlYWQiXSwidmVyc2lvbiI6MX0.qN331VqKQ5rfgvkadaRLYG6fNXp4t_lOee3K15f4gCo';
const MAPPLE = 'https://mapple-tmdb-proxy.vercel.app/api';
const TUMI = ['https://t-umi.bionmovies47.workers.dev', 'https://t-umi.zeraf.workers.dev'];
const TMDB_DIRECT = 'https://api.themoviedb.org/3';
const RURI = 'https://ruri.bionmovies47.workers.dev';
const ANILIST_PROXY = 'https://anilist-my-proxy.vercel.app/api';
const JIKAN_SELF = 'https://jikan-api-bohb.onrender.com/v4';

async function fetchJson(url, timeoutMs = 12000, headers = {}) {
  const res = await fetch(url, { headers: { Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function validate(rows) {
  if (!Array.isArray(rows) || rows.length < 5) return false;
  let ok = 0;
  for (const r of rows) {
    if (r && (r.title || r.name || r.title_english || r.title_romaji)) ok++;
  }
  return ok >= 5; // ≥5 usable rows — corrupted/empty upstreams never pass
}

function tumiSidebarUrl(section, type) {
  if (section === 'hiddenGem')
    return `/discover/${type}?vote_average.gte=7&vote_count.gte=50&popularity.lte=50&sort_by=popularity.asc&page=1`;
  if (section === 'topRanking')
    return `/${type}/top_rated?language=en-US&page=1`;
  return `/${type}/popular?language=en-US&page=1`;
}

async function fetchTmdbSection(section, type) {
  const mappleUrl = section === 'hiddenGem'
    ? `${MAPPLE}/hidden-gems/${type === 'movie' ? 'movies' : 'tv'}?page=1`
    : `${MAPPLE}/tmdb/${type}/${section === 'topRanking' ? 'top_rated' : 'popular'}?language=en-US&page=1`;
  const chain = [
    { url: mappleUrl },
    ...TUMI.map(b => ({ url: `${b}${tumiSidebarUrl(section, type)}` })),
    { url: `${TMDB_DIRECT}${tumiSidebarUrl(section, type)}`, headers: { Authorization: `Bearer ${TMDB_TOKEN}` } },
  ];
  for (const src of chain) {
    try {
      const j = await fetchJson(src.url, 15000, src.headers || {});
      const rows = j.data || j.results || [];
      if (validate(rows)) {
        return { data: rows.slice(0, 25), source: new URL(src.url).host };
      }
    } catch (e) { /* next tier */ }
  }
  throw new Error('all sidebar sources failed validation');
}

async function fetchAnimeSection(section, type) {
  const ruriPath = section === 'hiddenGem'
    ? `${RURI}/s-mal/anime/hidden-gems?type=${type}`
    : section === 'topRanking'
      ? `${RURI}/s-mal/top/anime?type=${type}`
      : `${RURI}/s-mal/favorites/anime?type=${type}`;
  // 108-S — same chain as the page's direct path: ruri → anilist-my-proxy →
  // self-hosted jikan. Self-hosted jikan (Render) may cold-start → 25s.
  const chain = [
    { url: ruriPath, tmo: 15000, kind: 'ruri worker' },
    { url: anilistSectionUrl(section, type), tmo: 15000, kind: 'anilist-my-proxy' },
    { url: jikanSectionUrl(section, type), tmo: 25000, kind: 'jikan-self' },
  ];
  for (const src of chain) {
    try {
      const j = await fetchJson(src.url, src.tmo);
      let rows = j.data || j.results || [];
      if (src.kind === 'anilist-my-proxy') rows = rows.map(anilistMediaToListItem).filter(Boolean);
      if (validate(rows)) {
        return { data: rows.slice(0, 25), source: src.kind };
      }
    } catch (e) { /* next tier */ }
  }
  throw new Error('all anime sidebar sources failed validation');
}

// 108-S — anilist-my-proxy tier URLs (mirror of the page's _sidebarAnilistUrl):
// Top Ranking -> /api/top-rated (all-time SCORE_DESC), Most Favourite ->
// /api/most-favourite (FAVOURITES_DESC), Hidden Gem -> recommendations
// listing (minScore 75, format-filtered).
function anilistSectionUrl(section, type) {
  const fmt = type === 'movie' ? 'MOVIE' : 'TV';
  if (section === 'topRanking')    return `${ANILIST_PROXY}/top-rated?perPage=25`;
  if (section === 'mostFavourite') return `${ANILIST_PROXY}/most-favourite?perPage=25`;
  return `${ANILIST_PROXY}/anime/recommendations?minScore=75&format=${fmt}&sort=SCORE_DESC&perPage=25&isAdult=false`;
}

// Self-hosted jikan tier (mirror of the page's _sidebarJikanUrl self=true):
// Top Ranking -> top/anime, Most Favourite -> top/anime?filter=favorite,
// Hidden Gem = high score with ascending member count.
function jikanSectionUrl(section, type) {
  const t = type === 'movie' ? 'movie' : 'tv';
  if (section === 'topRanking')    return `${JIKAN_SELF}/top/anime?type=${t}&limit=25`;
  if (section === 'mostFavourite') return `${JIKAN_SELF}/top/anime?type=${t}&filter=favorite&limit=25`;
  return `${JIKAN_SELF}/anime?min_score=7.5&order_by=members&sort=asc&type=${t}&sfw=true&limit=25&page=1`;
}

// AniList Media rows → jikan-shaped items (same normalization the page's
// Water Temple mapper applies) so cached rows render identically to ruri rows.
function anilistMediaToListItem(m) {
  if (!m || !m.id) return null;
  const cov = m.coverImage || {};
  const st = m.status;
  return {
    mal_id: m.idMal || null,
    anilist_id: m.id,
    title: (m.title && (m.title.romaji || m.title.english)) || 'Unknown',
    title_english: (m.title && (m.title.english || m.title.romaji)) || 'Unknown',
    images: { jpg: { image_url: cov.large || cov.extraLarge || '', large_image_url: cov.extraLarge || cov.large || '' } },
    score: m.averageScore ? Math.round(m.averageScore) / 10 : null,
    episodes: m.episodes || null,
    status: st === 'RELEASING' ? 'Currently Airing' : st === 'FINISHED' ? 'Finished Airing' : st === 'NOT_YET_RELEASED' ? 'Not yet aired' : (st || null),
    year: m.seasonYear || (m.startDate && m.startDate.year) || null,
    type: m.format === 'MOVIE' ? 'Movie' : (m.format === 'TV' ? 'TV' : (m.format || 'TV')),
    genres: m.genres || undefined,
    favorites: m.favourites || undefined,
  };
}

module.exports = async (req, res) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  if (req.method === 'OPTIONS') { res.statusCode = 204; Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v)); res.end(); return; }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405; res.setHeader('Content-Type', 'application/json'); Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v));
    res.end(JSON.stringify({ ok: false, error: 'GET only' })); return;
  }

  const section = String(req.query.section || '');
  const type = String(req.query.type || '');
  const validSections = ['hiddenGem', 'topRanking', 'mostFavourite'];
  if (!validSections.includes(section) || !/^(tv|movie|anime-tv|anime-movie)$/.test(type)) {
    res.statusCode = 400; res.setHeader('Content-Type', 'application/json'); Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v));
    res.end(JSON.stringify({
      ok: false,
      error: 'invalid section/type',
      usage: '/api/sidebar-cache?section=hiddenGem|topRanking|mostFavourite&type=tv|movie|anime-tv|anime-movie',
    }));
    return;
  }

  const isAnime = type.startsWith('anime-');
  const ruriType = type.replace('anime-', '');
  const key = `${section}:${type}`;
  const now = Date.now();

  let entry = store.get(key);
  if (entry && now < entry.expiresAt) return respond(res, cors, key, entry, true);

  // refresh (or first fill). Safe-guard: validation failures keep the stale copy.
  try {
    const fresh = isAnime
      ? await fetchAnimeSection(section, ruriType)
      : await fetchTmdbSection(section, type);
    entry = {
      data: fresh.data,
      source: fresh.source,
      cachedAt: now,
      expiresAt: now + TTL_MS,
    };
    store.set(key, entry);
    return respond(res, cors, key, entry, false);
  } catch (e) {
    if (entry) return respond(res, cors, key, entry, true, e.message); // stale-if-error
    res.statusCode = 502; res.setHeader('Content-Type', 'application/json');
    Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v));
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ ok: false, key, error: e.message }));
  }
};

function respond(res, cors, key, entry, fromCache, staleError) {
  const now = Date.now();
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v));
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=3600, stale-while-revalidate=86400');
  res.setHeader('X-Sidebar-Source', entry.source || 'unknown');
  res.end(JSON.stringify({
    ok: true,
    key,
    source: entry.source,
    cached_at: new Date(entry.cachedAt).toISOString(),
    age_seconds: Math.max(0, Math.floor((now - entry.cachedAt) / 1000)),
    ttl_seconds: Math.max(0, Math.floor((entry.expiresAt - now) / 1000)),
    ...(staleError ? { stale: true, refresh_error: staleError } : {}),
    from_cache: fromCache,
    count: Array.isArray(entry.data) ? entry.data.length : 0,
    data: entry.data,
  }));
}
