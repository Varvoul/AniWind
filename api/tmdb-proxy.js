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
import { cfWorkerFetch } from './_lib/cf-worker-auth.js';

// ── CF worker proxy dispatch table ──
// Each entry: { param: query param name, worker: cf-worker-auth.js worker key }
// vercel.json rewrites /api/<route>/:path* → /api/tmdb-proxy?<param>=:path*
const CF_DISPATCH = [
  { param: 'ruri_path',              worker: 'ruri' },
  { param: 'anikoto_path',           worker: 'anikoto' },
  { param: 'ipapi_path',             worker: 'ipapi-proxy' },
  { param: 'supabase_search_path',   worker: 'supabase-search-proxy' },
  // t227: owner Vercel projects (schedule legs + t130 fallback legs + info
  // /full tiers). vercel.json rewrites /api/anilist-proxy/:path* and
  // /api/anilist-scraper/:path* → here, so browser pages never hit the
  // authed upstreams directly (they 401 without server-side creds).
  { param: 'alproxy_path',           worker: 'anilist-my-proxy' },
  { param: 'alscraper_path',         worker: 'anilist-scraper' },
];

export default async function handler(req, res) {
  // ── Jikan proxy (Render) — checked FIRST to avoid interference from
  //    the /api/tmdb-proxy/:path* rewrite which can strip query params ──
  const jkPath = req.query.jk;
  if (jkPath !== undefined) {
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      return res.status(204).end();
    }
    const jpath = '/' + (Array.isArray(jkPath) ? jkPath.join('/') : String(jkPath).replace(/^\/+/, ''));
    const jurl = new URL(req.url, 'http://localhost');
    jurl.searchParams.delete('jk');
    const jqs = jurl.searchParams.toString();
    const jFullPath = jpath + (jqs ? '?' + jqs : '');
    try {
      const { cfWorkerFetch } = await import('./_lib/cf-worker-auth.js');
      const upstream = await cfWorkerFetch('jikan', jFullPath, {
        signal: AbortSignal.timeout(20000),
        method: req.method,
      });
      const jbody = await upstream.text();
      const jct = upstream.headers.get('Content-Type') || 'application/json';
      const jcc = upstream.headers.get('Cache-Control') || 'public, max-age=300';
      res.setHeader('Content-Type', jct);
      res.setHeader('Cache-Control', jcc);
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(upstream.status).send(jbody);
    } catch (e) {
      return res.status(502).json({ error: 'Jikan upstream failed', detail: e.message });
    }
  }

  // ── Public doc endpoints for /api/<route> base paths — no auth, no secrets ──
  const docReq = req.query.doc;
  if (docReq !== undefined) {
    const routeName = Array.isArray(docReq) ? docReq[0] : String(docReq);
    const docHtml = `<!doctype html><html><head><meta charset="utf-8"><title>${routeName} Proxy</title><style>body{font:14px/1.55 sans-serif;max-width:600px;margin:40px auto;padding:0 20px;color:#1a1a1a}h1{font-size:22px;margin:0 0 4px}.tag{display:inline-block;font-size:11px;background:#e8e8ec;padding:2px 7px;border-radius:3px;color:#444}</style></head><body><h1>${routeName} Proxy <span class="tag">authenticated</span></h1><p>This is an authenticated API endpoint. Authentication is handled server-side.</p><p>Usage: <code>GET /api/${routeName}/&lt;path&gt;</code></p></body></html>`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.status(200).send(docHtml);
  }

  // t194 dispatch — the AnimeThemes scraper API shares this function file
  // (Vercel Hobby caps deployments at 12 functions; a 13th fails the build).
  // vercel.json rewrites /api/animethemes/:path* -> here as at_path, so the
  // public surface stays /api/animethemes/anime?... exactly like the official API.
  const atPath = req.query.at_path;
  if (atPath !== undefined) {
    return animethemesHandler(req, res, Array.isArray(atPath) ? atPath.join('/') : atPath);
  }

  // 2026-11-24: CF worker proxy dispatch — single-param-per-worker pattern
  // (same as the working tumi_path dispatch). Each rewrite uses ONE query param,
  // avoiding the Vercel rewrite engine bug with `&` in destinations.
  for (const { param, worker } of CF_DISPATCH) {
    const pathParam = req.query[param];
    if (pathParam !== undefined) {
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        return res.status(204).end();
      }
      const path = '/' + (Array.isArray(pathParam) ? pathParam.join('/') : String(pathParam).replace(/^\/+/, ''));
      // Strip the routing param, keep all client-supplied query params
      const url = new URL(req.url, 'http://localhost');
      url.searchParams.delete(param);
      const qs = url.searchParams.toString();
      const fullPath = path + (qs ? '?' + qs : '');
      try {
        const upstream = await cfWorkerFetch(worker, fullPath, {
          signal: AbortSignal.timeout(15000),
          method: req.method,
          headers: req.method !== 'GET' ? { 'Content-Type': req.headers['content-type'] || 'application/json' } : undefined,
          body: req.method !== 'GET' && req.method !== 'HEAD' ? (typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {})) : undefined,
        });
        const body = await upstream.text();
        const ct = upstream.headers.get('Content-Type') || 'application/json';
        res.setHeader('Content-Type', ct);
        res.setHeader('Cache-Control', upstream.headers.get('Cache-Control') || 'public, max-age=60');
        res.setHeader('Access-Control-Allow-Origin', '*');
        return res.status(upstream.status).send(body);
      } catch (e) {
        return res.status(502).json({ error: `CF worker ${worker} upstream failed`, detail: e.message });
      }
    }
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
    // Strip our internal routing param AND the leaked `path` param (Vercel
    // applies both rewrites, leaving a stray path= from /api/tmdb-proxy/:path*).
    // Also strip `debug` (t228: the old ?debug=1 diagnostic response — env
    // presence flags + upstream body preview — was publicly callable; removed).
    const url = new URL(req.url, 'http://localhost');
    url.searchParams.delete('tumi_path');
    url.searchParams.delete('path');      // leaked from /api/tmdb-proxy/:path* rewrite
    url.searchParams.delete('debug');     // removed t228 — no debug output anymore
    const qs = url.searchParams.toString();
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
