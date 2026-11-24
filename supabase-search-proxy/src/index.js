/**
 * supabase-search-proxy
 *
 * Edge proxy in front of three whitelisted Supabase RPC functions
 * (search_anime_data, get_anime_data_by_mal_ids, search_anikoto_fuzzy).
 *
 * Why this exists: those RPCs already hard-cap rows per call server-side
 * (Postgres LEAST(...) clamps), but nothing stopped a client from calling
 * them thousands of times per second to slowly exfiltrate the whole table.
 * This Worker adds a per-IP rate limit at Cloudflare's edge, before the
 * request ever reaches Supabase, and restricts the proxy to ONLY the
 * three named functions — it is not a generic "call any RPC" endpoint.
 */

const ALLOWED_ORIGINS = [
  'https://ruristream.vercel.app',
  'https://aniocean.vercel.app',
  'https://muvix-vq.blogspot.com'
];

// Only these three RPCs may be called through this proxy. Anything else 404s.
const ALLOWED_FUNCTIONS = new Set([
  'search_anime_data',
  'get_anime_data_by_mal_ids',
  'search_anikoto_fuzzy'
]);

const NO_CACHE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  'Pragma': 'no-cache'
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const isAllowedOrigin = !origin || ALLOWED_ORIGINS.includes(origin);
    const allowOrigin = isAllowedOrigin ? (origin || '*') : ALLOWED_ORIGINS[0];

    const corsHeaders = {
      'Access-Control-Allow-Origin': allowOrigin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin'
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { ...corsHeaders, ...NO_CACHE_HEADERS } });
    }

    if (origin && !isAllowedOrigin) {
      return new Response(JSON.stringify({ error: 'Forbidden: unauthorized origin' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json', ...NO_CACHE_HEADERS }
      });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed. POST only.' }), {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json', ...NO_CACHE_HEADERS }
      });
    }

    // The RPC function name is the URL path, e.g. POST /search_anime_data
    const fnName = url.pathname.replace(/^\//, '');
    if (!ALLOWED_FUNCTIONS.has(fnName)) {
      return new Response(JSON.stringify({ error: 'Unknown or disallowed function', allowed: [...ALLOWED_FUNCTIONS] }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json', ...NO_CACHE_HEADERS }
      });
    }

    // ── Edge rate limit: one shared budget per client IP across all three
    //    functions (30 requests / 60s). This runs BEFORE anything touches
    //    Supabase — a client that exceeds it never reaches the database at all. ──
    const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';
    const { success } = await env.SEARCH_RATE_LIMITER.limit({ key: clientIp });
    if (!success) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded. Please slow down.' }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': '60', ...NO_CACHE_HEADERS }
      });
    }

    let body;
    try {
      body = await request.text();
      // Reject absurdly large bodies outright (legit search params are tiny)
      if (body.length > 2000) {
        throw new Error('Request body too large');
      }
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Invalid request body' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json', ...NO_CACHE_HEADERS }
      });
    }

    try {
      const supabaseUrl = `${env.SUPABASE_URL}/rest/v1/rpc/${fnName}`;
      const upstream = await fetch(supabaseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': env.SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${env.SUPABASE_ANON_KEY}`
        },
        body,
        signal: AbortSignal.timeout(8000)
      });

      const responseBody = await upstream.text();
      return new Response(responseBody, {
        status: upstream.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json', ...NO_CACHE_HEADERS }
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Upstream error', message: e.message }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json', ...NO_CACHE_HEADERS }
      });
    }
  }
};
