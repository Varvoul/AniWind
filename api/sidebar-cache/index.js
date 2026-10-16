// /api/sidebar-cache?section=hiddenGem|topRanking|mostFavourite&type=tv|movie|anime-tv|anime-movie
//
// SHARED server-side cache for the info-page right sidebar (owner request
// 2026-10-16): Hidden Gem / Top Ranking / Most Favourite rarely change, so
// EVERY visitor is served from one shared copy instead of each browser
// hammering the upstream APIs. Both tv/movie toggles are cached separately
// (the `type` query covers them: tv | movie for TMDB pages, anime-tv |
// anime-movie for the ruri-fed anime pages).
//
// Freshness: 7-day TTL. A background-safe guard decides what enters the
// cache — a refresh only REPLACES the stored copy when the upstream answer
// VALIDATES (≥ 5 rows, each with a usable title/name and image or score);
// a corrupted/empty upstream answer NEVER overwrites the good copy (the
// stale one keeps serving until real data returns).
//
// Sources (same chains as the page's direct path, minus browser-only needs):
//   TMDB sections : mapple → t-umi → t-umi.zeraf → direct TMDB (Bearer)
//   anime sections: ruri worker
//
// Response: { ok, key, source, cached_at, age_seconds, ttl_seconds, count, data }
// CDN: s-maxage=3600 + stale-while-revalidate so cross-region traffic is
// absorbed at the edge; the in-memory copy is the second layer.
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const store = new Map(); // key -> { data, source, cachedAt, expiresAt }

const TMDB_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiI0Yjc0YzE4NjlkZGQxMWEzNTM1MDFlNGI0MjY4MzA3YyIsIm5iZiI6MTc2NDM5Mzg3MS4yNTEwMDAyLCJzdWIiOiI2OTJhODM4ZjNkNTVkM2Y1NzJiOGVlYjIiLCJzY29wZXMiOlsiYXBpX3JlYWQiXSwidmVyc2lvbiI6MX0.qN331VqKQ5rfgvkadaRLYG6fNXp4t_lOee3K15f4gCo';
const MAPPLE = 'https://mapple-tmdb-proxy.vercel.app/api';
const TUMI = ['https://t-umi.bionmovies47.workers.dev', 'https://t-umi.zeraf.workers.dev'];
const TMDB_DIRECT = 'https://api.themoviedb.org/3';
const RURI = 'https://ruri.bionmovies47.workers.dev';

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

async function fetchRuriSection(section, type) {
  const path = section === 'hiddenGem'
    ? `${RURI}/s-mal/anime/hidden-gems?type=${type}`
    : section === 'topRanking'
      ? `${RURI}/s-mal/top/anime?type=${type}`
      : `${RURI}/s-mal/favorites/anime?type=${type}`;
  const j = await fetchJson(path, 15000);
  const rows = j.data || [];
  if (!validate(rows)) throw new Error('ruri answer failed validation');
  return { data: rows.slice(0, 25), source: 'ruri worker' };
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
      ? await fetchRuriSection(section, ruriType)
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
