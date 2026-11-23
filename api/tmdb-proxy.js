// ─────────────────────────────────────────────────────────────────────────
// /api/tmdb-proxy — server-side TMDB passthrough (t170)
//
// ROUTING: vercel.json rewrites /api/tmdb-proxy/:path* to
// /api/tmdb-proxy?path=:path* (catch-all folders proved unreliable for
// nested serverless functions), so the target arrives as req.query.path
// — either "trending/tv/week" or ["trending","tv","week"].
//
// WHY: the TMDB v4 read token used to be hardcoded in index.html and
// info.html — shipped to every visitor's browser AND public in the repo.
// This edge function keeps the token in a Vercel env var
// (TMDB_READ_TOKEN) and forwards requests server-side, so client pages
// call /api/tmdb-proxy/... with NO credentials attached.
//
//   GET /api/tmdb-proxy/trending/tv/week?language=en-US
//   GET /api/tmdb-proxy/tv/12345?append_to_response=credits
//
// SECURITY:
//   - GET only; path must start with an allow-listed TMDB route prefix
//     (blocks /auth, /account, write endpoints, etc.).
//   - Client-supplied credential params (api_key, session_id) are stripped.
//   - The Bearer token never leaves the server.
//
// CACHE: edge s-maxage 5 min + stale-while-revalidate 1 h (client tiers
// already hold 15–60 min caches upstream via t-umi).
// ─────────────────────────────────────────────────────────────────────────

const TMDB_API = 'https://api.themoviedb.org/3';

// Route allow-list: only public read routes the site actually uses.
const ALLOWED = [
  '/tv', '/movie', '/search', '/discover', '/trending', '/find',
  '/genre', '/person', '/network', '/watch', '/company', '/collection'
];

import animethemesHandler from './_lib/animethemes.js';
import { tumiFetch } from './_lib/tumi-auth.js';

export default async function handler(req, res) {
  // t194 dispatch — the AnimeThemes scraper API shares this function file
  // (Vercel Hobby caps deployments at 12 functions; a 13th fails the build).
  // vercel.json rewrites /api/animethemes/:path* -> here as at_path, so the
  // public surface stays /api/animethemes/anime?... exactly like the official API.
  const atPath = req.query.at_path;
  if (atPath !== undefined) {
    return animethemesHandler(req, res, Array.isArray(atPath) ? atPath.join('/') : atPath);
  }

  // 2026-11-23: t-umi auth proxy shares this function file too (same Hobby
  // cap reason). vercel.json rewrites /api/tumi/:path* → here as tumi_path.
  // The authed t-umi fetch (X-Proxy-Key + /p/<secret>/ prefix) is handled by
  // tumiFetch; secrets live in Vercel env, never reach the browser.
  const tumiPath = req.query.tumi_path;
  if (tumiPath !== undefined) {
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      return res.status(204).end();
    }
    if (req.method !== 'GET') {
      return res.status(405).json({ error: 'Method not allowed. Use GET.' });
    }
    const segs = tumiPath;
    const path = '/' + (Array.isArray(segs) ? segs.join('/') : String(segs).replace(/^\/+/, ''));
    if (path === '/' || path === '/undefined') {
      return res.status(400).json({
        error: 'Missing t-umi route after /api/tumi',
        usage: '/api/tumi/movie/155?append_to_response=credits',
      });
    }
    // Strip our internal routing param, keep everything else
    const url = new URL(req.url, 'http://localhost');
    url.searchParams.delete('tumi_path');
    const qs = url.searchParams.toString();
    // Debug mode — returns the constructed URL + env presence without calling t-umi
    if (url.searchParams.has('debug')) {
      const bionmoviesConfigured = !!(process.env.T_UMI_BIONMOVIES_HEADER_SECRET && process.env.T_UMI_BIONMOVIES_URL_PATH_SECRET);
      const zerafConfigured = !!(process.env.T_UMI_ZERAF_HEADER_SECRET && process.env.T_UMI_ZERAF_URL_PATH_SECRET);
      return res.status(200).json({
        debug: true,
        path,
        qs,
        envs: {
          T_UMI_BIONMOVIES_HEADER_SECRET:   process.env.T_UMI_BIONMOVIES_HEADER_SECRET   ? 'set' : 'MISSING',
          T_UMI_BIONMOVIES_URL_PATH_SECRET: process.env.T_UMI_BIONMOVIES_URL_PATH_SECRET ? 'set' : 'MISSING',
          T_UMI_ZERAF_HEADER_SECRET:        process.env.T_UMI_ZERAF_HEADER_SECRET        ? 'set' : 'MISSING',
          T_UMI_ZERAF_URL_PATH_SECRET:      process.env.T_UMI_ZERAF_URL_PATH_SECRET      ? 'set' : 'MISSING',
        },
        tiers: [
          { base: 'https://t-umi.bionmovies47.workers.dev', configured: bionmoviesConfigured },
          { base: 'https://t-umi.zeraf.workers.dev',        configured: zerafConfigured },
        ],
      });
    }
    try {
      const upstream = await tumiFetch(path, { qs, signal: AbortSignal.timeout(15000) });
      const body = await upstream.text();
      const ct = upstream.headers.get('Content-Type') || 'application/json';
      const cc = upstream.headers.get('Cache-Control') || 'public, max-age=300';
      res.setHeader('Content-Type', ct);
      res.setHeader('Cache-Control', cc);
      res.setHeader('Access-Control-Allow-Origin', '*');
      const xCache = upstream.headers.get('X-Tmdb-Cache');
      if (xCache) res.setHeader('X-Tmdb-Cache', xCache);
      return res.status(upstream.status).send(body);
    } catch (e) {
      return res.status(502).json({ error: 't-umi upstream failed', detail: e.message });
    }
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed. Use GET.' });
  }

  const token = process.env.TMDB_READ_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'TMDB_READ_TOKEN env var is not configured' });
  }

  // Target arrives via rewrite as req.query.path (string or segment array)
  const segs = req.query.path || '';
  const path = '/' + (Array.isArray(segs) ? segs.join('/') : String(segs).replace(/^\/+/, ''));
  if (path === '/') {
    return res.status(400).json({
      error: 'Missing TMDB route after /api/tmdb-proxy',
      usage: '/api/tmdb-proxy/trending/tv/week?language=en-US'
    });
  }
  if (!ALLOWED.some(p => path === p || path.startsWith(p + '/'))) {
    return res.status(403).json({ error: 'Route not allowed', path });
  }

  // Strip credential params + the internal routing param, keep the rest
  const url = new URL(req.url, 'http://localhost');
  url.searchParams.delete('api_key');
  url.searchParams.delete('session_id');
  url.searchParams.delete('path');
  const qs = url.searchParams.toString();

  try {
    const r = await fetch(`${TMDB_API}${path}${qs ? `?${qs}` : ''}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(10000)
    });
    const body = await r.json().catch(() => ({ error: 'non-JSON upstream response' }));
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
    return res.status(r.status).json(body);
  } catch (e) {
    return res.status(502).json({ error: 'TMDB upstream failed', message: e.message });
  }
}
