// ─────────────────────────────────────────────────────────────────────────
// t-umi auth helper — wraps fetch() with the X-Proxy-Key header and
// /p/<URL_PATH_SECRET>/ URL prefix required by the locked-down t-umi CF
// workers in BOTH Cloudflare accounts (bionmovies47 + zeraf).
//
// SECRETS LIVE IN VERCEL ENV VARS, NEVER IN CLIENT CODE.
// Required env vars (set in Vercel project → Settings → Environment Variables):
//   T_UMI_BIONMOVIES_HEADER_SECRET   — 9-char alphanumeric
//   T_UMI_BIONMOVIES_URL_PATH_SECRET — 43-char URL-safe
//   T_UMI_ZERAF_HEADER_SECRET        — 9-char alphanumeric (different from above)
//   T_UMI_ZERAF_URL_PATH_SECRET      — 43-char URL-safe (different from above)
//
// All four must be set. If any is missing, tumiFetch() throws and the caller
// falls back to the next tier (Neon cache, AniList, etc.) — same behaviour
// as a t-umi outage.
//
// Used by:
//   api/_lib/fallback.js   (homepage section fallbacks)
//   api/tmdb-live.js       (per-country live TMDB)
//   api/browse.js          (browse page filter queries)
//   api/sidebar-cache/index.js
//   api/tumi.js            (public /api/tumi/<path> client-facing route)
// ─────────────────────────────────────────────────────────────────────────

const T_UMI_BIONMOVIES_BASE = 'https://t-umi.bionmovies47.workers.dev';
const T_UMI_ZERAF_BASE      = 'https://t-umi.zeraf.workers.dev';

// Read secrets at module load (Vercel injects process.env at cold start).
// Re-reading inside each call would be slightly slower but more resilient
// to env-var rotation without a redeploy; we read once at module init for speed.
const BIONMOVIES = {
  base:        T_UMI_BIONMOVIES_BASE,
  headerSecret: process.env.T_UMI_BIONMOVIES_HEADER_SECRET,
  urlSecret:    process.env.T_UMI_BIONMOVIES_URL_PATH_SECRET,
};
const ZERAF = {
  base:        T_UMI_ZERAF_BASE,
  headerSecret: process.env.T_UMI_ZERAF_HEADER_SECRET,
  urlSecret:    process.env.T_UMI_ZERAF_URL_PATH_SECRET,
};

// Try bionmovies47 first (same account as the site, lower latency), zeraf second.
const TIERS = [BIONMOVIES, ZERAF];

function buildAuthedUrl(tier, path, qs = '') {
  const cleanPath = path.replace(/^\/+/, '');
  return `${tier.base}/p/${tier.urlSecret}/${cleanPath}${qs ? '?' + qs : ''}`;
}

function authHeaders(tier) {
  return {
    'X-Proxy-Key': tier.headerSecret,
    'Accept': 'application/json',
  };
}

/**
 * Fetch from t-umi with auth. Tries bionmovies47 first, then zeraf.
 *
 * @param {string} path  - TMDB path, e.g. "/tv/popular" or "/movie/155"
 * @param {object} opts  - { qs: "page=1&language=en-US", method: "GET",
 *                          headers: {...}, signal: AbortSignal }
 * @returns {Promise<Response>} - the first successful Response (res.ok)
 * @throws if all tiers fail or env vars are missing
 */
export async function tumiFetch(path, opts = {}) {
  const qs = opts.qs || '';
  let lastErr;
  for (const tier of TIERS) {
    if (!tier.headerSecret || !tier.urlSecret) {
      lastErr = new Error(`t-umi auth env vars missing for ${tier.base}`);
      continue;
    }
    try {
      const url = buildAuthedUrl(tier, path, qs);
      const res = await fetch(url, {
        method: opts.method || 'GET',
        headers: { ...authHeaders(tier), ...(opts.headers || {}) },
        signal: opts.signal,
      });
      if (res.ok) return res;
      // 401/403/404 = auth or path issue — don't retry the next tier (same path will 401 there too)
      // 429/5xx = transient — try next tier
      if (res.status === 401 || res.status === 403 || res.status === 404) {
        return res; // let the caller handle the error response
      }
      lastErr = new Error(`HTTP ${res.status} from ${tier.base}`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('t-umi fetch failed (no tiers configured)');
}

/**
 * Fetch JSON from t-umi with auth. Returns parsed JSON.
 * Throws on auth failure or network error.
 */
export async function tumiFetchJson(path, opts = {}) {
  const res = await tumiFetch(path, opts);
  return res.json();
}

/**
 * Build the authed URL for a specific tier (used by api/tumi.js to stream
 * the raw response back to the client without parsing).
 * Returns { url, headers } or null if the tier is not configured.
 */
export function authedTierConfig(tierIndex = 0) {
  const tier = TIERS[tierIndex];
  if (!tier || !tier.headerSecret || !tier.urlSecret) return null;
  return {
    base: tier.base,
    headerSecret: tier.headerSecret,
    urlSecret: tier.urlSecret,
  };
}

export { T_UMI_BIONMOVIES_BASE, T_UMI_ZERAF_BASE, TIERS };
