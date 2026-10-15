// ─────────────────────────────────────────────────────────────────────────
// Upstream fallback builders for the index-page section endpoints.
//
// WHY: every /api/<column> section read used to depend 100% on Neon
// (`public_frontend_data`). When the Neon free-tier quota exhausted
// (2026-10-15 outage) all nine sections went empty for the whole site.
// This module lets each endpoint rebuild its payload from the SAME public
// upstreams the automation uses, so a Neon outage no longer takes the
// homepage down.
//
// Sources (all probed live 2026-10-15):
//   anime  https://anilist-my-proxy.vercel.app/api/<name>   -> { data: [AniList media] }
//   anime  https://anikotoapi.site/recent-anime             -> { data: [anikoto items] }
//          fallback https://anikoto.bionmovies47.workers.dev/recent-anime
//   tmdb   https://t-umi.bionmovies47.workers.dev/<path>   -> raw TMDB page (proxy holds key)
//          fallback https://t-umi.zeraf.workers.dev/<path>
//   NOTE: mapplee.com / mapple.fun now answers 401 Unauthorized to
//   server-side calls (browser-only) so it CANNOT be used here; the
//   t-umi pair covers the TMDB fallback chain instead.
//
// Output shapes mirror exactly what the automation stores and what
// index.html consumers expect (V4.8.0 raw passthrough):
//   standard:  { Anime: [...], tmdb_tv: { "<page>": [...] }, tmdb_movie: [...], ... }
//   hidden-tab:{ Anime: [], tmdb_tv: { <CC>: [...] }, tmdb_movie: { <CC>: [...] } }
//   popular:   { data: [...] }
//
// Caching: each builder result is memoized per warm instance for 30 min
// (FALLBACK_TTL_MS) and the last good copy is kept indefinitely so a
// total upstream failure can still serve the previous snapshot.
// ─────────────────────────────────────────────────────────────────────────

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const ANILIST_PROXY = 'https://anilist-my-proxy.vercel.app/api';
const ANIKOTO_PRIMARY = 'https://anikotoapi.site/recent-anime';
const ANIKOTO_FALLBACK = 'https://anikoto.bionmovies47.workers.dev/recent-anime';
const T_UMI_PRIMARY = 'https://t-umi.bionmovies47.workers.dev';
const T_UMI_FALLBACK = 'https://t-umi.zeraf.workers.dev';

const REQ_TIMEOUT_MS = 6000;
const FALLBACK_TTL_MS = 30 * 60 * 1000; // 30 min per warm instance

const builderCache = new Map();  // column -> { data, expiresAt }
const lastGood = new Map();      // column -> data (kept for emergency stale serve)

async function fetchJson(url, timeoutMs = REQ_TIMEOUT_MS) {
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': BROWSER_UA },
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.slice(0, 80)}`);
  return res.json();
}

/** AniList proxy items; returns [] on failure (never throws). */
async function getAni(name, params = {}) {
  try {
    const qs = new URLSearchParams({ perPage: '50', ...params }).toString();
    const j = await fetchJson(`${ANILIST_PROXY}/${name}${qs ? '?' + qs : ''}`);
    const arr = Array.isArray(j?.data) ? j.data : [];
    return arr.filter(Boolean);
  } catch (e) { return []; }
}

/** Anikoto recent items; primary -> CF fallback. */
async function getAnikoto(perPage = 100) {
  try {
    const j = await fetchJson(`${ANIKOTO_PRIMARY}?per_page=${perPage}`);
    if (Array.isArray(j?.data)) return j.data;
  } catch (e) { /* fall through */ }
  try {
    const j = await fetchJson(`${ANIKOTO_FALLBACK}?per_page=${perPage}`);
    return Array.isArray(j?.data) ? j.data : [];
  } catch (e) { return []; }
}

/** One TMDB page via t-umi chain (bionmovies47 -> zeraf). Raw page or null. */
async function getTmdbPage(path, params = {}) {
  const qs = new URLSearchParams(params).toString();
  for (const base of [T_UMI_PRIMARY, T_UMI_FALLBACK]) {
    try {
      return await fetchJson(`${base}${path}${qs ? '?' + qs : ''}`);
    } catch (e) { /* try next */ }
  }
  return null;
}

/** TMDB results array (page flattened), [] on failure. */
async function getTmdbResults(path, params = {}) {
  const page = await getTmdbPage(path, params);
  return Array.isArray(page?.results) ? page.results : [];
}

/**
 * Fetch a RANGE of TMDB pages in parallel, keyed by page number — mirrors the
 * automation's pagination storage: results.tmdbTV[String(page)] = [...].
 * V4.9.4: the automation deliberately assigns DIFFERENT on_the_air page
 * ranges to different sections (hero 1-6, top_airing 7-12, new_releases
 * 13-14) so the same 20 shows never repeat across sections. Single-page
 * fallback builders broke that contract and every section showed identical
 * TV. Ranges below match AUTOMATION_ENDPOINTS exactly.
 */
async function getTmdbPages(path, params = {}, startPage, endPage) {
  const pages = {};
  const tasks = [];
  for (let p = startPage; p <= endPage; p++) {
    tasks.push(getTmdbResults(path, { ...params, page: String(p) }).then(r => { pages[String(p)] = r; }));
  }
  await Promise.all(tasks);
  // Drop empty pages so shape checks (Object.keys(...).length) stay honest.
  for (const k of Object.keys(pages)) if (!pages[k].length) delete pages[k];
  return pages;
}

/** Flat array across a page range (automation tmdbMovie storage shape). */
async function getTmdbPagesFlat(path, params = {}, startPage, endPage) {
  const pages = await getTmdbPages(path, params, startPage, endPage);
  return Object.keys(pages).sort((a, b) => a - b).flatMap(k => pages[k]);
}

const stamp = () => new Date().toISOString();

// ── Column builders (shapes = automation raw payload) ────────────────────
const BUILDERS = {
  // Automation: anilist currently-airing (50) + TMDB on_the_air pages 1-6.
  'hero-slider': async () => {
    const [ani, tv] = await Promise.all([
      getAni('currently-airing'),
      getTmdbPages('/tv/on_the_air', {}, 1, 6)
    ]);
    return { Anime: ani, tmdb_tv: tv, tmdb_movie: [], updated_at: stamp() };
  },

  // Automation: anilist top-airing (50) + TMDB on_the_air pages 7-12
  // (hero consumes 1-6, new_releases 13-14 — ranges never overlap).
  'top-airing': async () => {
    const [ani, tv] = await Promise.all([
      getAni('top-airing'),
      getTmdbPages('/tv/on_the_air', {}, 7, 12)
    ]);
    return { Anime: ani, tmdb_tv: tv, tmdb_movie: [], updated_at: stamp() };
  },

  // Automation: anilist currently-airing TV (50) + on_the_air pages 13-14
  // (page-keyed) + now_playing movies pages 1-2 (FLAT array — matches the
  // automation's tmdbMovie storage; index.html flattens both shapes).
  'new-releases': async () => {
    const [ani, movie, tv] = await Promise.all([
      getAni('currently-airing', { format: 'TV' }),
      getTmdbPagesFlat('/movie/now_playing', {}, 1, 2),
      getTmdbPages('/tv/on_the_air', {}, 13, 14)
    ]);
    return { Anime: ani, tmdb_tv: tv, tmdb_movie: movie, updated_at: stamp() };
  },

  'new-on-ruri': async () => {
    const ani = await getAnikoto(100);
    return { Anime: ani, tmdb_tv: {}, tmdb_movie: [], updated_at: stamp() };
  },

  // Automation: upcoming movies pages 1-10 (flat) + discover TV pages 1-2
  // (page-keyed, popularity.desc, first_air_date >= today) + anilist upcoming.
  'upcoming-shows': async () => {
    const [ani, movie, tv] = await Promise.all([
      getAni('upcoming'),
      getTmdbPagesFlat('/movie/upcoming', {}, 1, 10),
      getTmdbPages('/discover/tv', { sort_by: 'popularity.desc', 'first_air_date.gte': new Date().toISOString().split('T')[0] }, 1, 2)
    ]);
    return { Anime: ani, tmdb_tv: tv, tmdb_movie: movie, updated_at: stamp() };
  },

  // Automation: discover TV (ended, last 6mo) pages 1-2 (page-keyed) +
  // discover movies (release_type 2|3, last 6mo) pages 1-2 (flat) +
  // anilist recently-completed TV (50). 2 pages each ≈ 130-item pool so the
  // homepage renders its full 10 complete rows on grid page 1 (V4.9.4).
  'recently-completed': async () => {
    const sixMonthsAgo = (() => { const d = new Date(); d.setMonth(d.getMonth() - 6); return d.toISOString().split('T')[0]; })();
    const today = new Date().toISOString().split('T')[0];
    const tvParams = { sort_by: 'first_air_date.desc', with_status: 'ended', 'first_air_date.gte': sixMonthsAgo, 'first_air_date.lte': today };
    const mvParams = { sort_by: 'release_date.desc', with_release_type: '2|3', 'release_date.gte': sixMonthsAgo, 'release_date.lte': today };
    const [ani, tv, movie] = await Promise.all([
      getAni('recently-completed', { format: 'TV' }),
      getTmdbPages('/discover/tv', tvParams, 1, 2),
      getTmdbPagesFlat('/discover/movie', mvParams, 1, 2)
    ]);
    return { Anime: ani, tmdb_tv: tv, tmdb_movie: movie, updated_at: stamp() };
  },

  'trending-now': async () => {
    const [week, ani] = await Promise.all([
      getTmdbResults('/trending/all/week'),
      getAni('trending-week')
    ]);
    return { Anime: ani, tmdb_tv: week.length ? { 'mixed_1': week } : {}, tmdb_movie: [], updated_at: stamp() };
  },

  'most-favourite': async () => {
    const [ani, movie, tv] = await Promise.all([
      getAni('most-favourite'),
      getTmdbResults('/discover/movie', { sort_by: 'vote_count.desc', 'vote_count.gte': '5000', language: 'en-US', page: '1' }),
      getTmdbResults('/discover/tv', { sort_by: 'vote_count.desc', 'vote_count.gte': '2000', language: 'en-US', page: '1' })
    ]);
    return { Anime: ani, tmdb_tv: tv.length ? { '1': tv } : {}, tmdb_movie: movie, updated_at: stamp() };
  },

  'popular-anime': async () => {
    const ani = await getAni('popular');
    return { data: ani, updated_at: stamp() };
  },

  // Homepage consumers read: AU/CA/CN (top-airing TV) + DE/CL/GB (+TH) (new-releases).
  // Build those first so the cold path stays inside the function timeout;
  // the remaining automation countries (KR TR PK IN ID PH VN TW) are only
  // worth building once Neon is back (the automation owns them).
  'hidden-tab': async () => {
    const countries = ['AU', 'CA', 'CN', 'DE', 'CL', 'GB', 'TH'];
    const year = new Date().getFullYear();
    const tv = {}, movie = {};
    await Promise.allSettled(countries.map(async cc => {
      const base = { with_origin_country: cc, sort_by: 'popularity.desc', page: '1' };
      const [m, t] = await Promise.all([
        getTmdbResults('/discover/movie', { ...base, 'release_date.gte': `${year}-01-01`, 'release_date.lte': `${year}-12-31` }),
        getTmdbResults('/discover/tv', { ...base, 'first_air_date.gte': `${year}-01-01`, 'first_air_date.lte': `${year}-12-31` })
      ]);
      if (m.length) movie[cc] = m;
      if (t.length) tv[cc] = t;
    }));
    return { Anime: [], tmdb_tv: tv, tmdb_movie: movie, updated_at: stamp() };
  }
};

/**
 * Build a column payload from upstreams. Memoized 30 min per warm
 * instance; last good copy retained indefinitely for stale serve.
 * Returns null when the column has no builder or every source failed.
 */
export async function buildFallback(column) {
  const builder = BUILDERS[column];
  if (!builder) return null;

  const now = Date.now();
  const hit = builderCache.get(column);
  if (hit && hit.expiresAt > now) return hit.data;

  try {
    const data = await builder();
    const empty = data.Anime && Array.isArray(data.Anime) && !data.Anime.length &&
      (!data.tmdb_tv || !Object.keys(data.tmdb_tv).length) &&
      (!data.tmdb_movie || (Array.isArray(data.tmdb_movie) ? !data.tmdb_movie.length : !Object.keys(data.tmdb_movie).length)) &&
      (!data.data || !data.data.length);
    if (empty) return hit ? hit.data : null;  // all sources dead -> keep old copy
    const payload = { ...data, _source: 'upstream-fallback', _column: column, _fetchedAt: stamp() };
    builderCache.set(column, { data: payload, expiresAt: now + FALLBACK_TTL_MS });
    lastGood.set(column, payload);
    return payload;
  } catch (e) {
    return hit ? hit.data : (lastGood.get(column) || null);
  }
}

/** Emergency serve: last good fallback copy even if expired (or null). */
export function getLastGoodFallback(column) {
  return lastGood.get(column) || null;
}
