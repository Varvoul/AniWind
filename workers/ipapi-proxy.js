/**
 * ipapi-proxy — CORS proxy for ipapi.co
 * Deployed at: https://ipapi-proxy.bionmovies47.workers.dev
 *
 * Usage:
 *   GET /json  →  https://ipapi.co/json  (proxied with CORS headers)
 *   GET /<any-path>  →  https://ipapi.co/<any-path>
 *
 * Cache: 1 hour (IP geolocation rarely changes).
 */

const UPSTREAM = 'https://ipapi.co';
const CACHE_TTL = 3600; // 1 hour

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/+/, '') || 'json';
    const upstreamUrl = `${UPSTREAM}/${path}${url.search}`;

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(),
      });
    }

    try {
      // Check CF cache first
      const cache = caches.default;
      const cacheKey = new Request(upstreamUrl, request);
      let cached = await cache.match(cacheKey);
      if (cached) {
        return new Response(cached.body, {
          status: cached.status,
          headers: { ...corsHeaders(), 'cf-cache-status': 'HIT' },
        });
      }

      // Fetch from ipapi.co
      const res = await fetch(upstreamUrl, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(8000),
      });

      // Read and re-serve with CORS + cache
      const body = await res.text();
      const resp = new Response(body, {
        status: res.status,
        headers: {
          ...corsHeaders(),
          'Content-Type': res.headers.get('Content-Type') || 'application/json',
          'Cache-Control': `public, max-age=${CACHE_TTL}`,
          'cf-cache-status': 'MISS',
        },
      });

      // Store in CF cache on success
      if (res.ok) {
        const ctx = { waitUntil: (p) => p };
        // In CF Workers, waitUntil is available on the execution context.
        // For simple workers, we just put it in cache synchronously.
        await cache.put(cacheKey, resp.clone());
      }

      return resp;
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 502,
        headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
      });
    }
  },
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}