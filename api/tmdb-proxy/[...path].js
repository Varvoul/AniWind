// ─────────────────────────────────────────────────────────────────────────
// /api/tmdb-proxy/[...path] — server-side TMDB passthrough (t170)
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

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed. Use GET.' });
  }

  const token = process.env.TMDB_READ_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'TMDB_READ_TOKEN env var is not configured' });
  }

  // [...path] arrives as req.query.path (array of segments)
  const segs = req.query.path || [];
  const path = '/' + (Array.isArray(segs) ? segs.join('/') : String(segs));
  if (!ALLOWED.some(p => path === p || path.startsWith(p + '/'))) {
    return res.status(403).json({ error: 'Route not allowed', path });
  }

  // Strip client credential params, keep everything else (language, page, ...)
  const url = new URL(req.url, 'http://localhost');
  url.searchParams.delete('api_key');
  url.searchParams.delete('session_id');
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
