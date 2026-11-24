// api/_lib/cf-worker-auth.js
// Generic auth helper for ALL authed CF workers.
// Reads per-worker secrets from Vercel env vars and makes authed requests
// with X-Proxy-Key header + /p/<URL_PATH_SECRET>/ URL prefix.
//
// Env var naming convention:
//   <WORKER_PREFIX>_HEADER_SECRET   — 9-char X-Proxy-Key value
//   <WORKER_PREFIX>_URL_PATH_SECRET — 43-char URL path secret
//
// WORKERS map: worker_key → { base, envPrefix }
// worker_key is the URL path segment used in /api/<worker_key>/...

const WORKERS = {
  ruri:                  { base: 'https://ruri.bionmovies47.workers.dev',                  envPrefix: 'RURI' },
  anikoto:               { base: 'https://anikoto.bionmovies47.workers.dev',               envPrefix: 'ANIKOTO' },
  'anikoto-proxy':       { base: 'https://anikoto-proxy.zeraf.workers.dev',                envPrefix: 'ANIKOTO_PROXY' },
  'ipapi-proxy':         { base: 'https://ipapi-proxy.bionmovies47.workers.dev',           envPrefix: 'IPAPI_PROXY' },
  'supabase-search-proxy': { base: 'https://supabase-search-proxy.bionmovies47.workers.dev', envPrefix: 'SUPABASE_SEARCH_PROXY' },
  'ani-pm-proxy':        { base: 'https://ani-pm-proxy.bionmovies47.workers.dev',          envPrefix: 'ANI_PM_PROXY' },
  'aniumi-data-proxy':   { base: 'https://aniumi-data-proxy.bionmovies47.workers.dev',     envPrefix: 'ANIUMI_DATA_PROXY' },
  jikan:                 { base: 'https://jikan-api-bohb.onrender.com',                    envPrefix: 'JIKAN', pathPrefix: 'v4' },
};

/**
 * Fetch from an authed CF worker.
 * @param {string} workerKey - key in WORKERS map (e.g. "ruri")
 * @param {string} path - path on the worker (e.g. "/s-mal/anime/search?q=naruto")
 * @param {object} opts - { signal, method, headers, body }
 * @returns {Promise<Response>}
 */
export async function cfWorkerFetch(workerKey, path, opts = {}) {
  const w = WORKERS[workerKey];
  if (!w) throw new Error(`Unknown CF worker: ${workerKey}`);
  const headerSecret = process.env[`${w.envPrefix}_HEADER_SECRET`];
  const urlSecret    = process.env[`${w.envPrefix}_URL_PATH_SECRET`];
  if (!headerSecret || !urlSecret) {
    throw new Error(`Missing env vars for ${workerKey}: ${w.envPrefix}_HEADER_SECRET / ${w.envPrefix}_URL_PATH_SECRET`);
  }
  const cleanPath = path.replace(/^\/+/, '');
  const fullPath = w.pathPrefix ? `${w.pathPrefix}/${cleanPath}` : cleanPath;
  const url = `${w.base}/p/${urlSecret}/${fullPath}`;
  return fetch(url, {
    method: opts.method || 'GET',
    headers: {
      'X-Proxy-Key': headerSecret,
      'Accept': 'application/json',
      ...(opts.headers || {}),
    },
    body: opts.body,
    signal: opts.signal,
  });
}

/**
 * Fetch JSON from an authed CF worker.
 */
export async function cfWorkerFetchJson(workerKey, path, opts = {}) {
  const res = await cfWorkerFetch(workerKey, path, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${workerKey}`);
  return res.json();
}

export { WORKERS };
