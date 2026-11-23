// ─────────────────────────────────────────────────────────────────────────
// /api/tumi — public client-facing t-umi proxy.
//
// The browser calls this; the server adds the X-Proxy-Key header and
// /p/<URL_PATH_SECRET>/ prefix required by the locked-down t-umi CF workers.
// Auth secrets live in Vercel env vars and NEVER reach the browser.
//
// ROUTING (vercel.json):
//   /api/tumi/:path*  →  /api/tumi?path=:path*
//   e.g. /api/tumi/tv/popular?language=en-US  →  req.query.path = "tv/popular"
//
// USAGE FROM CLIENT:
//   fetch(`/api/tumi/movie/155?append_to_response=credits`)
//   fetch(`/api/tumi/tv/popular?page=1`)
//
// FALLBACK: tries t-umi.bionmovies47 first, then t-umi.zeraf. On 401/403/404
// from the first tier, returns that response immediately (path or auth issue
// — same on the second tier). On 429/5xx or network error, tries the next
// tier. On total failure, returns 502.
//
// CACHE: passes through the t-umi worker's Cache-Control header (already set
// per-path: 7d for genre, 12h for movie, 6h for tv, 15m for search, etc.).
// ─────────────────────────────────────────────────────────────────────────

import { tumiFetch, TIERS } from './_lib/tumi-auth.js';

export default async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed. Use GET.' });
  }

  // Path arrives via Vercel rewrite as req.query.path (string or segment array)
  const segs = req.query.path || '';
  const path = '/' + (Array.isArray(segs) ? segs.join('/') : String(segs).replace(/^\/+/, ''));
  if (path === '/' || path === '/undefined') {
    return res.status(400).json({
      error: 'Missing t-umi route after /api/tumi',
      usage: '/api/tumi/movie/155?append_to_response=credits',
    });
  }

  // Strip our internal routing param, keep everything else (page, language,
  // append_to_response, watch_region, sort_by, etc.)
  const url = new URL(req.url, 'http://localhost');
  url.searchParams.delete('path');
  const qs = url.searchParams.toString();

  // Forward to t-umi (helper handles auth + tier fallback)
  try {
    const upstream = await tumiFetch(path, {
      qs,
      signal: AbortSignal.timeout(15000),
    });
    const body = await upstream.text();
    const ct = upstream.headers.get('Content-Type') || 'application/json';
    const cc = upstream.headers.get('Cache-Control') || 'public, max-age=300';
    res.setHeader('Content-Type', ct);
    res.setHeader('Cache-Control', cc);
    res.setHeader('Access-Control-Allow-Origin', '*');
    // Surface the t-umi cache header for debugging
    const xCache = upstream.headers.get('X-Tmdb-Cache');
    if (xCache) res.setHeader('X-Tmdb-Cache', xCache);
    return res.status(upstream.status).send(body);
  } catch (e) {
    return res.status(502).json({
      error: 't-umi upstream failed',
      detail: e.message,
      tiers: TIERS.map(t => ({ base: t.base, configured: !!(t.headerSecret && t.urlSecret) })),
    });
  }
}
