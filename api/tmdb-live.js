// ─────────────────────────────────────────────────────────────────────────
// TMDB LIVE FETCH ENDPOINT with 6-Hour Server-Side Cache
//
// PURPOSE: Fetch TMDB data for specific countries when database has no cached
// data for those regions (e.g., TW, PK, TR, CL which are often empty).
//
// CACHE STRATEGY:
//   - 6-hour TTL (21600000ms) server-side in-memory cache
//   - CDN cache headers for edge caching (same 6h TTL for all users)
//   - Auto-refreshes after TTL expires (first request after expiry
//     re-fetches from TMDB, re-caches, and every user is served from the
//     fresh cache again)
//
// RATE LIMIT HANDLING:
//   - Sequential fetches (not parallel) to respect TMDB's 50 req/sec limit
//   - 250ms delay between TV and Movie requests for same country
//   - Max 4 pages per type; pagination stops early once 30 poster-valid
//     items are collected (posterless items are dropped before caching)
//
// USAGE:
//   GET /api/tmdb-live?country=TW&type=tv     → Taiwan TV shows
//   GET /api/tmdb-live?country=PK&type=movie  → Pakistani Movies
//   GET /api/tmdb-live?country=TR             → Both TV + Movies for Turkey
//
// RESPONSE FORMAT:
//   {
//     tv: [...],        // Array of TMDB TV objects (max 40)
//     movie: [...],     // Array of TMDB Movie objects (max 40)
//     _cache: { ... },  // Cache metadata
//     _source: 'tmdb-live',
//     _fetchedAt: 'ISO timestamp'
//   }
// ─────────────────────────────────────────────────────────────────────────

import { setCacheHeaders } from './_lib/cache.js';

// ── CONFIGURATION ──
const LIVE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours in milliseconds (aligned with _lib/cache.js policy)
const LIVE_TTL_SECONDS = LIVE_TTL_MS / 1000;

// ⚡ USE SAME ENDPOINTS AS AUTOMATION WORKER (T-UMI PROXY)
// Your automation uses: https://t-umi.zeraf.workers.dev/{tv|movie}/popular?watch_region={CODE}
const T_UMI_BASE = 'https://t-umi.zeraf.workers.dev';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';
const MAX_PAGES = 4; // Paginate deeper: posterless items get dropped below, so
                     // extra pages are needed to still fill the usable-items quota
const MIN_VALID_ITEMS = 30; // Stop paginating once this many VALID (poster) items collected
const ITEMS_PER_PAGE = 20; // TMDB default
const RATE_LIMIT_DELAY_MS = 400; // Match automation's 400ms delay between calls

// ── IN-MEMORY CACHE STORE ──
// Key format: "tmdb-live:{country}:{type}" → { data, expiresAt, fetchedAt, hitCount }
const liveCache = new Map();

/**
 * Get cached data if fresh, or return null if expired/not cached
 */
function getCached(key) {
  const now = Date.now();
  const entry = liveCache.get(key);
  
  if (!entry) return null;
  
  if (entry.expiresAt > now) {
    entry.hitCount = (entry.hitCount || 0) + 1;
    return entry.data;
  }
  
  // Expired - remove from cache
  liveCache.delete(key);
  return null;
}

/**
 * Store data in cache with TTL
 */
function setCached(key, data) {
  liveCache.set(key, {
    data,
    expiresAt: Date.now() + LIVE_TTL_MS,
    fetchedAt: new Date().toISOString(),
    hitCount: 1
  });
}

/**
 * Sleep utility for rate limiting
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Fetch TMDB results filtered by country of origin using DISCOVER endpoint.
 * 
 * IMPORTANT: The /popular endpoint ignores watch_region and returns global/US content!
 * We use /discover with with_origin_country to get ACTUAL country-specific content.
 * 
 * DATE FILTERING: Dynamically filters for CURRENT YEAR content only
 *   - Movies: release_date between Jan 1 and Dec 31 of current year
 *   - TV Shows: first_air_date between Jan 1 and Dec 31 of current year
 *   - This ensures users see RECENT content, not old classics
 * 
 * ENDPOINTS:
 *   TV:    https://t-umi.zeraf.workers.dev/discover/tv?with_origin_country={CODE}&first_air_date.gte=2026-01-01&...
 *   Movie: https://t-umi.zeraf.workers.dev/discover/movie?with_origin_country={CODE}&release_date.gte=2026-01-01&...
 * 
 * Respects rate limits by using delays between requests
 *
 * POSTER FILTER: items without a poster image (or a display name) are
 * dropped BEFORE caching, so the cached copy itself is clean and every
 * visitor gets poster-complete data straight from the cache.
 */
async function fetchTMDBPopular(type, countryCode, maxPages = MAX_PAGES) {
  const isMovie = type === 'movie';
  // ⚡ USE DISCOVER ENDPOINT (filters by origin country - returns LOCAL content!)
  // NOT /popular (ignores region, returns global US content)
  const endpoint = isMovie ? '/discover/movie' : '/discover/tv';
  
  // ⚡ DYNAMIC DATE RANGE - Always uses current year for RECENT content!
  const currentYear = new Date().getFullYear();
  const dateField = isMovie ? 'release_date' : 'first_air_date';
  const dateFilter = `${dateField}.gte=${currentYear}-01-01&${dateField}.lte=${currentYear}-12-31`;
  
  const allResults = [];
  const seenIds = new Set(); // dedupe across pages
  
  for (let page = 1; page <= maxPages; page++) {
    // Quota check: already collected enough USABLE (poster) items → stop
    if (allResults.length >= MIN_VALID_ITEMS) {
      break;
    }
    
    // Rate limit: delay between pages (match automation's 400ms)
    if (page > 1) {
      await sleep(RATE_LIMIT_DELAY_MS);
    }
    
    try {
      // ⚡ BUILD URL WITH COUNTRY + DATE FILTERS
      // with_origin_country=KR returns Korean content, PK returns Pakistani, etc.
      // Date filter ensures we get CURRENT YEAR releases only!
      // Sort by release date (NOT popularity) to get NEWEST content first!
      const sortBy = isMovie ? 'release_date.desc' : 'first_air_date.desc';
      const url = `${T_UMI_BASE}${endpoint}?with_origin_country=${countryCode}&${dateFilter}&sort_by=${sortBy}&page=${page}`;
      console.log(`[TMDB-Live] 📡 Fetching: ${type}/${countryCode} page ${page} (${currentYear})`);
      console.log(`[TMDB-Live] 🔗 URL: ${url}`);
      
      const response = await fetch(url);
      
      if (!response.ok) {
        console.warn(`[TMDB-Live] ⚠️ ${type}/${countryCode} p${page}: HTTP ${response.status}`);
        break; // Stop pagination on error
      }
      
      const data = await response.json();
      // T-UMI proxy returns data in same format as TMDB API
      const results = data.results || [];
      
      // ── POSTER FILTER + DEDUPE (server-side, applied before caching) ──
      // Keep only items that actually have a poster image AND a display
      // name — the client would render an ugly gradient placeholder for the
      // rest. Filtering here means the 6h cached copy is already clean.
      let kept = 0;
      for (const item of results) {
        if (!item || !item.poster_path) continue;
        const displayName = isMovie ? (item.title || item.original_title) : (item.name || item.original_name);
        if (!displayName) continue;
        if (seenIds.has(item.id)) continue;
        seenIds.add(item.id);
        allResults.push(item);
        kept++;
      }
      
      console.log(`[TMDB-Live] ✅ ${type}/${countryCode} p${page}: ${results.length} raw, ${kept} valid (posters), ${allResults.length} total`);
      
      // Stop if we got fewer results than requested (end of available data)
      if (results.length < ITEMS_PER_PAGE) {
        break;
      }
      
    } catch (error) {
      console.error(`[TMDB-Live] ❌ ${type}/${countryCode} p${page}:`, error.message);
      break; // Stop on network errors
    }
  }
  
  return allResults.slice(0, 50); // Cap at 50 items per type
}

/**
 * Main handler for /api/tmdb-live
 */
export default async function handler(req, res) {
  // Only allow GET method
  if (req.method !== 'GET') {
    return res.status(405).json({ 
      error: 'Method not allowed. Use GET.',
      _endpoint: 'tmdb-live'
    });
  }
  
  const { country, type } = req.query;
  
  // Validate required parameters
  if (!country) {
    return res.status(400).json({ 
      error: 'Missing required parameter: country',
      usage: '/api/tmdb-live?country={CODE}&type={tv|movie|both}',
      example: '/api/tmdb-live?country=TW&type=both',
      _endpoint: 'tmdb-live'
    });
  }
  
  // Normalize country code (uppercase, max 3 chars)
  const countryCode = country.toUpperCase().slice(0, 3);
  const requestType = (type || 'both').toLowerCase();
  
  console.log(`[TMDB-Live] 📡 Request: country=${countryCode}, type=${requestType}`);
  
  try {
    const result = {
      tv: [],
      movie: [],
      _source: 'tmdb-live',
      _country: countryCode,
      _fetchedAt: new Date().toISOString(),
      _cache: {}
    };
    
    // Determine which types to fetch
    const fetchTV = requestType === 'tv' || requestType === 'both';
    const fetchMovie = requestType === 'movie' || requestType === 'both';
    
    // ── FETCH TV SHOWS (with cache check) ──
    if (fetchTV) {
      const tvCacheKey = `tmdb-live:${countryCode}:tv`;
      let tvData = getCached(tvCacheKey);
      
      if (!tvData) {
        // Cache miss - fetch from T-UMI proxy (same as automation)
        console.log(`[TMDB-Live] 📺 Cache miss for TV/${countryCode}, fetching via T-UMI...`);
        tvData = await fetchTMDBPopular('tv', countryCode);
        setCached(tvCacheKey, tvData);
        console.log(`[TMDB-Live] 💾 Cached ${tvData.length} TV items for ${countryCode}`);
      } else {
        console.log(`[TMDB-Live] ✅ Cache HIT for TV/${countryCode}: ${tvData.length} items`);
      }
      
      result.tv = tvData;
    }
    
    // ── FETCH MOVIES (with cache check & delay) ──
    if (fetchMovie) {
      // Small delay between TV and Movie requests to be extra safe on rate limits
      if (fetchTV) {
        await sleep(RATE_LIMIT_DELAY_MS);
      }
      
      const movieCacheKey = `tmdb-live:${countryCode}:movie`;
      let movieData = getCached(movieCacheKey);
      
      if (!movieData) {
        // Cache miss - fetch from T-UMI proxy (same as automation)
        console.log(`[TMDB-Live] 🎬 Cache miss for Movie/${countryCode}, fetching via T-UMI...`);
        movieData = await fetchTMDBPopular('movie', countryCode);
        setCached(movieCacheKey, movieData);
        console.log(`[TMDB-Live] 💾 Cached ${movieData.length} Movie items for ${countryCode}`);
      } else {
        console.log(`[TMDB-Live] ✅ Cache HIT for Movie/${countryCode}: ${movieData.length} items`);
      }
      
      result.movie = movieData;
    }
    
    // ── BUILD CACHE METADATA ──
    const tvCacheInfo = getCacheInfo(`tmdb-live:${countryCode}:tv`);
    const movieCacheInfo = getCacheInfo(`tmdb-live:${countryCode}:movie`);
    
    result._cache = {
      ttl_hours: LIVE_TTL_SECONDS / 3600,
      tv: tvCacheInfo,
      movie: movieCacheInfo,
      message: 'Data served from cache if fresh, otherwise fetched live from TMDB'
    };
    
    // Set CDN cache headers (12h TTL + 24h stale-while-revalidate)
    setCacheHeaders(res);
    // Override with our 12h TTL
    res.setHeader('Cache-Control', `public, s-maxage=${LIVE_TTL_SECONDS}, stale-while-revalidate=86400`);
    
    console.log(`[TMDB-Live] ✅ Complete: ${result.tv.length} TV + ${result.movie.length} Movies for ${countryCode}`);
    
    return res.status(200).json(result);
    
  } catch (error) {
    console.error(`[TMDB-Live] ❌ Fatal error:`, error.message);
    
    return res.status(500).json({ 
      error: 'Failed to fetch TMDB data',
      message: error.message,
      _endpoint: 'tmdb-live',
      _country: countryCode,
      _timestamp: new Date().toISOString()
    });
  }
}

/**
 * Helper to get cache info (mirrors _lib/cache.js but uses our store)
 */
function getCacheInfo(key) {
  const entry = liveCache.get(key);
  const now = Date.now();
  
  if (!entry) {
    return {
      status: 'not_cached',
      ttl_ms: LIVE_TTL_MS,
      ttl_hours: LIVE_TTL_MS / (1000 * 60 * 60),
      message: 'Will fetch on first request'
    };
  }
  
  const remainingMs = Math.max(0, entry.expiresAt - now);
  const isFresh = remainingMs > 0;
  
  return {
    status: isFresh ? 'fresh' : 'expired',
    isCached: true,
    isFresh: isFresh,
    remaining_ms: remainingMs,
    remaining_minutes: Math.round(remainingMs / (1000 * 60)),
    ttl_ms: LIVE_TTL_MS,
    ttl_hours: LIVE_TTL_MS / (1000 * 60 * 60),
    fetched_at: entry.fetchedAt,
    hit_count: entry.hitCount || 0,
    message: isFresh 
      ? `Fresh cache, ${Math.round(remainingMs / (1000 * 60))}min remaining`
      : 'Expired, will refresh on next request'
  };
}

/**
 * Admin endpoint to clear TMDB live cache (optional, for testing)
 */
export function clearLiveCache(countryCode = null, type = null) {
  let cleared = 0;
  
  for (const [key] of liveCache) {
    if (!key.startsWith('tmdb-live:')) continue;
    
    const parts = key.split(':');
    const keyCountry = parts[1];
    const keyType = parts[2];
    
    // Filter by parameters if provided
    if (countryCode && keyCountry !== countryCode.toUpperCase()) continue;
    if (type && keyType !== type.toLowerCase()) continue;
    
    liveCache.delete(key);
    cleared++;
  }
  
  return cleared;
}
