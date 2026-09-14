// ─────────────────────────────────────────────────────────────────────────
// Shared 6-hour TTL cache for the column endpoints.
//
// Two layers, both aimed at the same goal — "don't hit Neon on every
// request":
//   1. In-memory: each endpoint file is its own serverless function, and
//      Vercel reuses ("keeps warm") a function's process across nearby
//      invocations. `memoize()` below caches the query result in that
//      process's memory for TTL_MS, so repeat requests hit a warm instance
//      return instantly with zero DB round-trip.
//   2. CDN: `setCacheHeaders()` sets Cache-Control so Vercel's edge network
//      can also serve requests straight from cache, including to a *cold*
//      function instance that hasn't queried anything yet.
// Either layer alone already keeps DB load low; together they mean Neon
// only sees a real query roughly once per 6 hours per endpoint, regardless
// of how much traffic the site gets in between.
//
// V4.7.2 NEW: Added getCacheInfo() for cache metadata in responses
// ─────────────────────────────────────────────────────────────────────────

export const TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const TTL_SECONDS = TTL_MS / 1000;

const store = new Map(); // key -> { data, expiresAt, fetchedAt, hitCount }

/** Returns the cached value for `key` if still fresh, otherwise calls
 *  `fetcher()`, caches the result for TTL_MS, and returns it. */
export async function memoize(key, fetcher) {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expiresAt > now) {
    hit.hitCount = (hit.hitCount || 0) + 1;
    return hit.data;
  }
  const data = await fetcher();
  store.set(key, { 
    data, 
    expiresAt: now + TTL_MS,
    fetchedAt: new Date().toISOString(),
    hitCount: 1
  });
  return data;
}

/** Sets the CDN-facing cache headers for a 6h TTL with a 24h
 *  stale-while-revalidate window (serves the stale copy instantly while
 *  quietly refetching in the background, instead of making a live visitor
 *  wait on a cold cache). */
export function setCacheHeaders(res) {
  res.setHeader('Cache-Control', `public, s-maxage=${TTL_SECONDS}, stale-while-revalidate=86400`);
  res.setHeader('Vercel-CDN-Cache-Control', `public, s-maxage=${TTL_SECONDS}`);
}

/**
 * V4.7.2 NEW: Get cache information for a given key
 * Returns cache metadata without exposing internal implementation details
 */
export function getCacheInfo(key) {
  const entry = store.get(key);
  const now = Date.now();
  
  if (!entry) {
    return {
      status: 'not_cached',
      ttl_ms: TTL_MS,
      ttl_hours: TTL_MS / (1000 * 60 * 60),
      message: 'Data will be fetched on first request'
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
    ttl_ms: TTL_MS,
    ttl_hours: TTL_MS / (1000 * 60 * 60),
    fetched_at: entry.fetchedAt,
    hit_count: entry.hitCount || 0,
    message: isFresh 
      ? `Cache fresh, ${Math.round(remainingMs / (1000 * 60))}min remaining`
      : 'Cache expired, will refresh on next request'
  };
}

/** Clear cache for a specific key (for testing/admin) */
export function clearCache(key) {
  return store.delete(key);
}

/** Clear all cache (for testing/admin) */
export function clearAllCache() {
  const size = store.size;
  store.clear();
  return size;
}
