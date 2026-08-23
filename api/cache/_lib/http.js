const TMDB_PROXY = 'https://t-umi.bionmovies47.workers.dev';
const ANILIST_ENDPOINT = 'https://graphql.anilist.co';

export async function fetchTMDB(endpoint, params = '') {
  const url = `${TMDB_PROXY}${endpoint}${params ? `?${params}` : ''}`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`TMDB proxy ${res.status} for ${endpoint}`);
  return res.json();
}

export async function fetchAniList(query, variables = {}) {
  const res = await fetch(ANILIST_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(10000),
  });
  const json = await res.json();
  if (!res.ok || json.errors) {
    throw new Error(`AniList error: ${json.errors ? JSON.stringify(json.errors) : res.status}`);
  }
  return json.data;
}
