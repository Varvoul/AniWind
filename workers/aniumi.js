/**
 * aniumi — Jikan API proxy for aniumi.vercel.app
 * 
 * Routes:
 *   /jikan/*        → https://api.jikan.moe/v4/*  (with caching + rate-limit retry)
 *   /health         → {"ok":true}
 *
 * Features:
 *   - CORS headers so the browser can call it directly
 *   - Cloudflare Cache API (5-min TTL) to avoid hammering Jikan's 3 req/s limit
 *   - Automatic 429 retry with back-off (up to 3 attempts)
 *   - Forwards all query params unchanged
 */

const JIKAN_BASE = 'https://api.jikan.moe/v4';
const CACHE_TTL  = 300; // 5 minutes
const MAX_RETRY  = 3;
const ALLOWED_ORIGINS = [
  'https://aniumi.vercel.app',
  'https://aniocean.vercel.app',
  'http://localhost',
];

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age':       '86400',
};

function jsonResp(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json;charset=UTF-8',
      ...CORS_HEADERS,
      ...extra,
    },
  });
}

async function fetchJikanWithRetry(url, attempt = 1) {
  const res = await fetch(url, {
    headers: { 'Accept': 'application/json' },
    cf: { cacheTtl: CACHE_TTL, cacheEverything: true },
  });

  // Jikan rate-limit: retry with exponential back-off
  if (res.status === 429 && attempt < MAX_RETRY) {
    const wait = attempt * 600; // 600ms, 1200ms
    await new Promise(r => setTimeout(r, wait));
    return fetchJikanWithRetry(url, attempt + 1);
  }

  return res;
}

export default {
  async fetch(request, env, ctx) {
    const url    = new URL(request.url);
    const path   = url.pathname;

    // ── Pre-flight CORS ──────────────────────────────────────
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // ── Health check ─────────────────────────────────────────
    if (path === '/health') {
      return jsonResp({ ok: true, ts: Date.now() });
    }

    // ── Jikan proxy: /jikan/<endpoint>?<params> ───────────────
    if (path.startsWith('/jikan/')) {
      const jikanPath   = path.replace('/jikan/', '');
      const queryString = url.search; // preserves ?filter=...&limit=...&page=...
      const jikanUrl    = `${JIKAN_BASE}/${jikanPath}${queryString}`;

      // Check Cloudflare cache first
      const cache     = caches.default;
      const cacheKey  = new Request(jikanUrl, { method: 'GET' });
      const cached    = await cache.match(cacheKey);
      if (cached) {
        // Return cached response with a header so we can debug cache hits
        const cachedClone = new Response(cached.body, cached);
        cachedClone.headers.set('X-Cache', 'HIT');
        cachedClone.headers.set('Access-Control-Allow-Origin', '*');
        return cachedClone;
      }

      try {
        const upstream = await fetchJikanWithRetry(jikanUrl);

        if (!upstream.ok) {
          return jsonResp(
            { error: `Jikan returned ${upstream.status}`, url: jikanUrl },
            upstream.status
          );
        }

        const data = await upstream.json();
        const resp = jsonResp(data, 200, {
          'Cache-Control': `public, max-age=${CACHE_TTL}, s-maxage=${CACHE_TTL}`,
          'X-Cache': 'MISS',
          'X-Proxied-From': jikanUrl,
        });

        // Store in Cloudflare cache (non-blocking)
        ctx.waitUntil(cache.put(cacheKey, resp.clone()));

        return resp;
      } catch (err) {
        return jsonResp({ error: err.message, url: jikanUrl }, 502);
      }
    }

    // ── 404 for anything else ─────────────────────────────────
    return jsonResp({ error: 'Not found', path }, 404);
  },
};
