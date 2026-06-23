/**
 * aniumi — Universal API proxy for aniumi.vercel.app
 * Deployed at: https://aniumi.bionmovies47.workers.dev
 *
 * Routes:
 *   GET /jikan/<path>?<params>   → https://api.jikan.moe/v4/<path>?<params>
 *   GET /tmdb/<path>?<params>    → https://api.themoviedb.org/3/<path>?<params>
 *   GET /3/<path>?<params>       → https://api.themoviedb.org/3/<path>?<params>  (legacy compat)
 *   GET /anikoto/<path>?<params> → https://anikoto.bionmovies47.workers.dev/<path>?<params>
 *   GET /health                  → { ok: true }
 *
 * Features:
 *   CORS open to any origin, CF Cache API (5-min Jikan / 10-min TMDB / 2-min Anikoto),
 *   429/503 auto-retry with back-off, 8s timeout, graceful JSON errors.
 *
 * Env variable (CF dashboard → Workers → aniumi → Settings → Variables):
 *   TMDB_API_KEY — your TMDB v3 Bearer read-access token
 */

const JIKAN_BASE   = 'https://api.jikan.moe/v4';
const TMDB_BASE    = 'https://api.themoviedb.org/3';
const ANIKOTO_BASE = 'https://anikoto.bionmovies47.workers.dev';
const TTL          = { jikan: 300, tmdb: 600, anikoto: 120 };
const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age':       '86400',
};

function jsonResp(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json;charset=UTF-8', ...CORS, ...extra },
  });
}

async function proxyFetch(upstreamUrl, authHeaders = {}, ttl = 300) {
  const cache    = caches.default;
  const cacheKey = new Request(upstreamUrl, { method: 'GET' });

  // 1) Try CF cache first
  const cached = await cache.match(cacheKey);
  if (cached) {
    const r = new Response(cached.body, cached);
    r.headers.set('X-Cache', 'HIT');
    r.headers.set('Access-Control-Allow-Origin', '*');
    return r;
  }

  // 2) Fetch upstream with up to 3 attempts (handles 429 rate-limits)
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const ctrl = new AbortController();
      const tid  = setTimeout(() => ctrl.abort(), 8000);
      const res  = await fetch(upstreamUrl, {
        headers: { Accept: 'application/json', ...authHeaders },
        signal: ctrl.signal,
      });
      clearTimeout(tid);

      if ((res.status === 429 || res.status === 503) && attempt < 3) {
        await new Promise(r => setTimeout(r, attempt * 700));
        continue;
      }
      if (!res.ok) return jsonResp({ error: `Upstream ${res.status}`, url: upstreamUrl }, res.status);

      const data  = await res.json();
      const reply = jsonResp(data, 200, {
        'Cache-Control': `public, max-age=${ttl}, s-maxage=${ttl}`,
        'X-Cache': 'MISS',
        'X-Proxied': upstreamUrl,
      });
      cache.put(cacheKey, reply.clone()).catch(() => {});
      return reply;
    } catch (e) {
      lastErr = e;
      if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 500));
    }
  }
  return jsonResp({ error: lastErr?.message || 'Fetch failed', url: upstreamUrl }, 502);
}

export default {
  async fetch(request, env) {
    const { pathname: path, search } = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (path === '/health' || path === '/') {
      return jsonResp({ ok: true, ts: Date.now(), routes: ['/jikan/*','/tmdb/*','/3/*','/anikoto/*'] });
    }

    // ── Jikan ──────────────────────────────────────────────────────────────
    if (path.startsWith('/jikan/')) {
      return proxyFetch(`${JIKAN_BASE}/${path.slice(7)}${search}`, {}, TTL.jikan);
    }

    // ── TMDB /tmdb/* (new clean route) ─────────────────────────────────────
    if (path.startsWith('/tmdb/')) {
      const key = env?.TMDB_API_KEY || '';
      const auth = key ? { Authorization: `Bearer ${key}` } : {};
      return proxyFetch(`${TMDB_BASE}/${path.slice(6)}${search}`, auth, TTL.tmdb);
    }

    // ── TMDB /3/* (legacy — keeps existing aniocen.workers.dev calls working) ─
    if (path.startsWith('/3/')) {
      const key = env?.TMDB_API_KEY || '';
      const auth = key ? { Authorization: `Bearer ${key}` } : {};
      return proxyFetch(`${TMDB_BASE}/${path.slice(3)}${search}`, auth, TTL.tmdb);
    }

    // ── Anikoto ────────────────────────────────────────────────────────────
    if (path.startsWith('/anikoto/')) {
      return proxyFetch(`${ANIKOTO_BASE}/${path.slice(9)}${search}`, {}, TTL.anikoto);
    }

    return jsonResp({ error: 'Not found', path }, 404);
  },
};
