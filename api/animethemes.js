// ─────────────────────────────────────────────────────────────────────────
// /api/animethemes — AnimeThemes JSON:API v1-compatible scraper proxy (t194)
//
// WHY: the official AnimeThemes APIs are down (api.animethemes.moe → 503,
// graphql.animethemes.moe → 404 since 2026-11-14). Their static site still
// serves complete per-anime theme payloads. The t194 crawler
// (scripts/t194_at_crawler.py) snapshots every anime from that static site
// and normalizes it into the official v1 (JSON:API) response shape.
//
// This endpoint serves the same surface the official REST API had,
// backed by the crawled dataset (data/animethemes/ in this repo):
//   /api/animethemes/anime          index  (filter / include / sort / page)
//   /api/animethemes/anime/{slug|id}  show
//   /api/animethemes/theme          index + /theme/{id}
//   /api/animethemes/song           index
//   /api/animethemes/artist         index
//   /api/animethemes/video          index
//   /api/animethemes/series         index
//   /api/animethemes/studio         index
//   /api/animethemes/audio          index
//   /api/animethemes/image          index
//   /api/animethemes/search?q=      global search (anime/artists/songs/themes)
//   /api/animethemes/year           year+season catalog; /year/{year}
//   admin/auth/list resources (playlists, users, ...) → 501 (auth-only,
//   cannot exist in a public scrape).
//
// PARAMETERS (official JSON:API style):
//   filter[has]=resources|images|series|studios|themes
//   filter[site]=MyAnimeList|AniList|Kitsu|AniDB  (+ filter[external_id]=n)
//   filter[external_id]=n        (any external id when site omitted)
//   filter[id]=a,b  filter[slug]=a,b  filter[name]=fuzzy
//   filter[year]=1995|1995-2000  filter[season]=SPRING|...
//   filter[type]=OP|ED  filter[sequence]=n  filter[group]=...
//   filter[title]=fuzzy (song)  filter[basename|resolution|source|...] (video)
//   q=term (search + fuzzy name match)
//   include=animethemes.song,animethemes.animethemeentries.videos,... (dot paths)
//   sort=id|name|slug|year|mal_id|type|sequence|title  (prefix '-' = desc)
//   page[number]=1.. page[size]=1..200
//   fields[anime]=id,name,... (sparse fieldsets)
//
// RESPONSE SHAPE: identical key style to the official API:
//   /anime          → { anime: [...], links: {...}, meta: {...} }
//   /theme          → { theme: [...], links, meta }   etc.
//   /search         → { search: { anime: [], artists: [], songs: [], themes: [] } }
//   /year           → { years: [ { year, seasons: [...] } ] }
// Video links point at https://v.animethemes.moe/{basename} — the real CDN.
//
// CACHE: dataset chunks cached in instance memory (10 min TTL); responses
// carry s-maxage=300 + stale-while-revalidate so Vercel edge caches them.
// ─────────────────────────────────────────────────────────────────────────

const VERSION = 'animethemes v1 scraper (t194)';

const DATASET_BASE = process.env.AT_DATASET_BASE ||
  'https://raw.githubusercontent.com/Varvoul/AniWind/main/data/animethemes';

const VIDEO_HOST = 'https://v.animethemes.moe';

// ── dataset cache (instance-level, TTL-based) ────────────────────────────
const TTL_MS = 10 * 60 * 1000;
let _index = null, _indexAt = 0, _indexPromise = null;
const _chunks = new Map(); // k -> { at, data }

async function fetchJson(url, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal,
      headers: { 'User-Agent': 'ruristream-animethemes-proxy/1.0' } });
    if (!res.ok) throw new Error(`dataset HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(t); }
}

async function loadIndex() {
  const now = Date.now();
  if (_index && now - _indexAt < TTL_MS) return _index;
  if (!_indexPromise) {
    _indexPromise = fetchJson(`${DATASET_BASE}/index.json`).then(d => {
      _index = d; _indexAt = Date.now(); _indexPromise = null;
      return d;
    }).catch(e => { _indexPromise = null; throw e; });
  }
  return _indexPromise;
}

async function loadChunk(k) {
  const hit = _chunks.get(k);
  const now = Date.now();
  if (hit && now - hit.at < TTL_MS) return hit.data;
  const d = await fetchJson(`${DATASET_BASE}/chunks/chunk_${String(k).padStart(3, '0')}.json`);
  _chunks.set(k, { at: now, data: d });
  if (_chunks.size > 60) { // keep memory bounded
    const first = _chunks.keys().next().value;
    if (first !== k) _chunks.delete(first);
  }
  return d;
}

// ── helpers ──────────────────────────────────────────────────────────────
const SITE_ALIASES = {
  myanimelist: 'mal_id', mal: 'mal_id',
  anilist: 'anilist_id',
  kitsu: 'kitsu_id',
  anidb: 'anidb_id',
};

function filterArr(v) { // filter[a]=x,y or repeated params
  if (v === undefined || v === null) return null;
  return String(v).split(',').map(s => s.trim()).filter(Boolean);
}

function eqAny(arr, val) { return arr ? arr.map(String).includes(String(val)) : false; }

function fuzzy(hay, needle) {
  return (hay || '').toLowerCase().includes(String(needle).toLowerCase());
}

function parseYear(v) { // 1995 or 1995-2000
  const s = String(v);
  const m = s.match(/^(\d{4})-(\d{4})$/);
  if (m) return [Number(m[1]), Number(m[2])];
  const y = Number(s);
  return Number.isFinite(y) && y > 1900 ? [y, y] : null;
}

function chunkOfRowPos(pos) { return Math.floor(pos / 100); }

async function getRecordsForRows(rows) { // rows = index rows → full records
  const groups = new Map();
  rows.forEach(r => {
    const k = chunkOfRowPos(r._pos);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r._pos);
  });
  const out = new Map(); // pos -> record
  for (const [k, poss] of groups) {
    const d = await loadChunk(k);
    poss.forEach(pos => {
      const rec = d.anime[pos - k * 100];
      if (rec) out.set(pos, rec);
    });
  }
  return out;
}

// include handling — dot paths like animethemes.animethemeentries.videos
function wantsInclude(incSet, path) {
  return incSet.has(path) || [...incSet].some(p => p.startsWith(path + '.'));
}

function attachIncludes(rec, incSet) {
  const out = { ...rec };
  if (incSet.size) {
    if (!wantsInclude(incSet, 'animethemes')) {
      delete out.animethemes;
    } else {
      out.animethemes = (out.animethemes || []).map(t => {
        const th = { ...t };
        if (!incSet.has('animethemes.song')) delete th.song;
        if (wantsInclude(incSet, 'animethemes.animethemeentries') || incSet.has('animethemes.entries')) {
          th.animethemeentries = (th.animethemeentries || []).map(e => {
            const en = { ...e };
            if (wantsInclude(incSet, 'animethemes.animethemeentries.videos') ||
                incSet.has('animethemes.entries.videos')) {
              en.videos = en.videos || [];
            } else {
              delete en.videos;
            }
            return en;
          });
          if (incSet.has('animethemes.entries')) {
            th.entries = th.animethemeentries; // alias used by the newer docs
          }
        } else {
          delete th.animethemeentries;
        }
        return th;
      });
    }
    if (!wantsInclude(incSet, 'images')) delete out.images;
    if (!wantsInclude(incSet, 'series')) delete out.series;
    if (!wantsInclude(incSet, 'studios')) delete out.studios;
    if (!wantsInclude(incSet, 'synonyms')) delete out.synonyms;
  } else {
    // strict v1 default: bare anime record, relations only via include
    delete out.animethemes; delete out.images; delete out.series;
    delete out.studios; delete out.synonyms;
  }
  return out;
}

function parseInclude(searchParams) {
  const raw = searchParams.get('include');
  const set = new Set();
  if (raw) raw.split(',').map(s => s.trim().toLowerCase()).forEach(s => {
    set.add(s);
    // accept the consumer's exact v1 paths; also register shortened forms
    set.add(s.replace(/^animethemes\./, '').replace(/^animethemeentries\./, ''));
  });
  return set;
}

function sparseFields(rec, searchParams, type) {
  const f = searchParams.get(`fields[${type}]`);
  if (!f) return rec;
  const keep = new Set(f.split(',').map(s => s.trim()).filter(Boolean));
  const out = {};
  for (const k of Object.keys(rec)) if (keep.has(k)) out[k] = rec[k];
  return out;
}

function paginate(list, searchParams, path) {
  let size = Number(searchParams.get('page[size]'));
  if (!Number.isFinite(size) || size <= 0) size = 100;
  size = Math.min(size, 200);
  let num = Number(searchParams.get('page[number]'));
  if (!Number.isFinite(num) || num <= 0) num = 1;
  const total = list.length;
  const lastPage = Math.max(1, Math.ceil(total / size));
  num = Math.min(num, lastPage);
  const slice = list.slice((num - 1) * size, num * size);
  const qs = new URLSearchParams(searchParams);
  const pageUrl = n => {
    qs.set('page[size]', String(size)); qs.set('page[number]', String(n));
    return `${path}?${qs.toString()}`;
  };
  return {
    slice,
    meta: { current_page: num, from: total ? (num - 1) * size + 1 : null,
            last_page: lastPage, path, per_page: size,
            to: Math.min(num * size, total), total },
    links: { first: pageUrl(1), last: pageUrl(lastPage),
             prev: num > 1 ? pageUrl(num - 1) : null,
             next: num < lastPage ? pageUrl(num + 1) : null },
  };
}

function applySort(list, sort, keyFns) {
  if (!sort) return list;
  let field = sort, desc = false;
  if (field.startsWith('-')) { desc = true; field = field.slice(1); }
  const fn = keyFns[field];
  if (!fn) return list;
  const sorted = [...list].sort((a, b) => {
    const ka = fn(a), kb = fn(b);
    if (ka === kb) return 0;
    if (ka === null || ka === undefined) return 1;
    if (kb === null || kb === undefined) return -1;
    return ka < kb ? -1 : 1;
  });
  return desc ? sorted.reverse() : sorted;
}

// ── anime filtering ──────────────────────────────────────────────────────
function filterAnime(rows, sp) {
  const fId = filterArr(sp.get('filter[id]'));
  const fSlug = filterArr(sp.get('filter[slug]'));
  const fName = sp.get('filter[name]');
  const fYear = sp.get('filter[year]') ? parseYear(sp.get('filter[year]')) : null;
  const fSeason = sp.get('filter[season]') ? String(sp.get('filter[season]')).toUpperCase() : null;
  const fFormat = sp.get('filter[format]') ? String(sp.get('filter[format]')).toUpperCase() : null;
  const fHas = filterArr(sp.get('filter[has]'));
  const fSite = sp.get('filter[site]');
  const fExt = sp.get('filter[external_id]');
  const fQ = sp.get('filter[q]');
  const idField = fSite ? SITE_ALIASES[String(fSite).toLowerCase()] : null;
  if (fSite && !idField) return { error: `unknown filter[site] "${fSite}" (use MyAnimeList|AniList|Kitsu|AniDB)` };
  const hasExt = fExt !== null && fExt !== undefined && fExt !== '';
  const extNum = hasExt ? Number(fExt) : null;
  if (hasExt && !Number.isFinite(extNum)) return { error: 'filter[external_id] must be numeric' };
  if (hasExt && !fSite) return { error: 'filter[external_id] requires filter[site]' };

  return { rows: rows.filter(r => {
    if (fId && !eqAny(fId, r.id)) return false;
    if (fSlug && !fSlug.includes(r.slug)) return false;
    if (fName && !fuzzy(r.name, fName) && !fuzzy(r.english, fName)) return false;
    if (fQ && !fuzzy(r.name, fQ) && !fuzzy(r.english, fQ)) return false;
    if (fYear && !(r.year && r.year >= fYear[0] && r.year <= fYear[1])) return false;
    if (fSeason && String(r.season || '') !== fSeason) return false;
    if (fFormat && String(r.format || '').toUpperCase() !== fFormat) return false;
    if (fHas) {
      if (fHas.includes('resources') && r.mal_id === null && r.anilist_id === null &&
          r.kitsu_id === null) return false;
      if (fHas.includes('themes') && !r.themes) return false;
    }
    if (hasExt && idField && r[idField] !== extNum) return false;
    return true;
  }) };
}

// ── derived resource views (song/artist/video/…) ─────────────────────────
function flattenThemes(rows, recordsMap) {
  const out = [];
  rows.forEach(r => {
    const rec = recordsMap.get(r._pos);
    if (!rec) return;
    (rec.animethemes || []).forEach(t => {
      out.push({ ...t, anime: { id: rec.id, slug: rec.slug, name: rec.name,
        year: rec.year, mal_id: rec.mal_id, anilist_id: rec.anilist_id } });
    });
  });
  return out;
}

function themeView(t) {
  return {
    id: t.id, type: t.type, sequence: t.sequence, group: t.group, slug: t.slug,
    song: t.song ? { id: t.song.id, title: t.song.title,
      artists: t.song.artists || [] } : null,
    animethemeentries: (t.animethemeentries || []).map(e => ({
      id: e.id, episodes: e.episodes, version: e.version,
      nsfw: e.nsfw, spoiler: e.spoiler, notes: e.notes,
      videos: e.videos || [],
    })),
    anime: t.anime || undefined,
  };
}

function songView(t) {
  return {
    id: t.song.id, title: t.song.title,
    artists: t.song.artists || [],
    animethemes: [{ id: t.id, type: t.type, sequence: t.sequence, slug: t.slug,
      anime: t.anime }],
  };
}

function hashId(s) { // stable pseudo-id for slug-keyed entities
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
  return Math.abs(h) % 100000000;
}

// ── request entry ────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  const sp = new URL(req.url, 'https://x').searchParams;
  // path arrives as a string via the /api/animethemes/:path* rewrite, or as an
  // array when the function is mounted with a catch-all file name
  const rawPath = req.query.path;
  const path = (Array.isArray(rawPath) ? rawPath.join('/') : (rawPath || ''))
    .replace(/\/+$/, '');
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'ruristream.vercel.app';
  const self = `${proto}://${host}/api/animethemes`;

  const jsonOut = (code, body) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=86400');
    res.setHeader('X-Data-Source', VERSION);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(code).json(body);
  };

  try {
    const index = await loadIndex();
    const rowsAll = index.anime.map((r, pos) => ({ ...r, _pos: pos }));

    const incSet = parseInclude(sp);
    const q = sp.get('q');
    const pagePath = `${self}/${path || 'anime'}`;

    // /year + /year/{year}
    if (path === 'year' || path.startsWith('year/')) {
      const map = new Map();
      rowsAll.forEach(r => {
        if (!r.year) return;
        if (!map.has(r.year)) map.set(r.year, new Set());
        if (r.season) map.get(r.year).add(r.season);
      });
      const ORDER = ['WINTER', 'SPRING', 'SUMMER', 'FALL'];
      const years = [...map.keys()].sort((a, b) => b - a).map(y => ({
        year: y,
        seasons: ORDER.filter(s => map.get(y).has(s))
          .concat([...map.get(y)].filter(x => !ORDER.includes(x))),
      }));
      if (path === 'year') return jsonOut(200, { years });
      const y = Number(path.split('/')[1]);
      const hit = years.find(x => x.year === y);
      return hit ? jsonOut(200, { year: hit })
        : jsonOut(404, { error: `no data for year ${y}` });
    }

    // /search?q=
    if (path === 'search') {
      const term = (q || sp.get('filter[q]') || '').trim();
      if (!term) return jsonOut(400, { error: 'q parameter required (e.g. ?q=kusuriya)' });
      const tLower = term.toLowerCase();
      const animeHits = rowsAll.filter(r => fuzzy(r.name, tLower) || fuzzy(r.english, tLower));
      animeHits.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      const animeSlice = animeHits.slice(0, 20);
      const recs = await getRecordsForRows(animeSlice);
      const artistMap = new Map(), songHits = [], themeHits = [];
      animeSlice.forEach(r => {
        const rec = recs.get(r._pos);
        (rec ? rec.animethemes : []).forEach(t => {
          themeHits.push(themeView(t));
          if (t.song) {
            const s = { id: t.song.id, title: t.song.title,
              anime: { id: rec.id, slug: rec.slug, name: rec.name } };
            if (!songHits.some(x => x.id === s.id && x.title === s.title)) songHits.push(s);
            (t.song.artists || []).forEach(a => {
              if (!artistMap.has(a.name)) artistMap.set(a.name, { name: a.name, slug: a.slug, songs: [] });
              artistMap.get(a.name).songs.push({ id: t.song.id, title: t.song.title, slug: t.slug, anime: s.anime });
            });
          }
        });
      });
      return jsonOut(200, {
        search: {
          anime: animeSlice.map(r => ({ id: r.id, slug: r.slug, name: r.name,
            english: r.english, year: r.year, mal_id: r.mal_id, anilist_id: r.anilist_id,
            themes: r.themes })),
          artists: [...artistMap.values()].slice(0, 20),
          songs: songHits.slice(0, 20),
          themes: themeHits.slice(0, 20),
        },
      });
    }

    // /anime index + /anime/{id|slug}
    if (path === 'anime' || path.startsWith('anime/')) {
      const showId = path === 'anime' ? null : path.split('/')[1];
      let rows = rowsAll;
      if (showId !== null) {
        const bySlug = rows.find(r => r.slug === showId);
        const byNum = /^\d+$/.test(showId)
          ? rows.find(r => String(r.id) === showId || String(r.mal_id) === showId)
          : null;
        const row = bySlug || byNum;
        if (!row) return jsonOut(404, { error: `anime "${showId}" not found` });
        const recs = await getRecordsForRows([row]);
        const rec = recs.get(row._pos);
        if (!rec) return jsonOut(503, { error: 'dataset chunk unavailable' });
        const out = attachIncludes({ ...rec }, incSet);
        return jsonOut(200, { anime: sparseFields(out, sp, 'anime') });
      }
      const filtered = filterAnime(rows, sp);
      if (filtered.error) return jsonOut(400, { error: filtered.error });
      rows = filtered.rows;
      rows = applySort(rows, sp.get('sort'), {
        id: r => r.id, name: r => (r.name || '').toLowerCase(),
        slug: r => r.slug, year: r => r.year, mal_id: r => r.mal_id,
        anilist_id: r => r.anilist_id, themes: r => r.themes,
      });
      const pg = paginate(rows, sp, pagePath);
      const recs = await getRecordsForRows(pg.slice);
      const animeList = pg.slice.map(r => {
        const rec = recs.get(r._pos);
        return rec ? sparseFields(attachIncludes({ ...rec }, incSet), sp, 'anime')
          : { id: r.id, slug: r.slug, name: r.name, english: r.english,
              mal_id: r.mal_id, anilist_id: r.anilist_id, year: r.year };
      });
      return jsonOut(200, { anime: animeList, links: pg.links, meta: pg.meta });
    }

    // /theme index + /theme/{id}
    if (path === 'theme' || path.startsWith('theme/')) {
      const recs = await getRecordsForRows(rowsAll);
      let themes = flattenThemes(rowsAll, recs);
      if (path !== 'theme') {
        const tid = Number(path.split('/')[1]);
        themes = themes.filter(t => t.id === tid);
        if (!themes.length) return jsonOut(404, { error: `theme ${path.split('/')[1]} not found` });
      } else {
        const fId = filterArr(sp.get('filter[id]'));
        const fSlug = filterArr(sp.get('filter[slug]'));
        const fType = sp.get('filter[type]') ? String(sp.get('filter[type]')).toUpperCase() : null;
        const fSeqRaw = sp.get('filter[sequence]');
        const fSeq = fSeqRaw !== null && fSeqRaw !== '' ? Number(fSeqRaw) : null;
        const fGroup = sp.get('filter[group]');
        const fAnime = sp.get('filter[anime]');
        const fTitle = sp.get('filter[title]');
        const fArtist = sp.get('filter[artist]');
        if (fId) themes = themes.filter(t => eqAny(fId, t.id));
        if (fSlug) themes = themes.filter(t => fSlug.includes(t.slug));
        if (fType) themes = themes.filter(t => t.type === fType);
        if (fSeq !== null && Number.isFinite(fSeq)) themes = themes.filter(t => t.sequence === fSeq);
        if (fGroup) themes = themes.filter(t => fuzzy(t.group, fGroup));
        if (fAnime) themes = themes.filter(t => fuzzy(t.anime && t.anime.slug, fAnime) || fuzzy(t.anime && t.anime.name, fAnime));
        if (fTitle) themes = themes.filter(t => fuzzy(t.song && t.song.title, fTitle));
        if (fArtist) themes = themes.filter(t => (t.song && t.song.artists || []).some(a => fuzzy(a.name, fArtist)));
        if (q) themes = themes.filter(t => fuzzy(t.song && t.song.title, q) ||
          fuzzy(t.anime && t.anime.name, q) ||
          (t.song && t.song.artists || []).some(a => fuzzy(a.name, q)));
        themes = applySort(themes, sp.get('sort'), {
          id: t => t.id, type: t => t.type, sequence: t => t.sequence,
          group: t => t.group, slug: t => t.slug,
          title: t => (t.song && t.song.title || '').toLowerCase(),
        });
      }
      const withInc = themes.map(t => {
        const tv = themeView(t);
        if (incSet.size && !wantsInclude(incSet, 'animethemeentries') &&
            !wantsInclude(incSet, 'entries')) {
          delete tv.animethemeentries;
        }
        if (wantsInclude(incSet, 'entries')) tv.entries = tv.animethemeentries;
        if (incSet.size && !wantsInclude(incSet, 'song')) delete tv.song;
        if (incSet.size && !wantsInclude(incSet, 'anime')) delete tv.anime;
        return sparseFields(tv, sp, 'theme');
      });
      const pg = paginate(withInc, sp, pagePath);
      return jsonOut(200, { theme: pg.slice, links: pg.links, meta: pg.meta });
    }

    // /song index
    if (path === 'song') {
      const recs = await getRecordsForRows(rowsAll);
      const themesFlat = flattenThemes(rowsAll, recs).filter(t => t.song && t.song.id);
      const fTitle = sp.get('filter[title]');
      const fArtist = sp.get('filter[artist]');
      let themes = themesFlat;
      if (fTitle) themes = themes.filter(t => fuzzy(t.song.title, fTitle));
      if (fArtist) themes = themes.filter(t => (t.song.artists || []).some(a => fuzzy(a.name, fArtist)));
      if (q) themes = themes.filter(t => fuzzy(t.song.title, q) ||
        (t.song.artists || []).some(a => fuzzy(a.name, q)));
      const uniq = new Map();
      themes.forEach(t => {
        const key = t.song.id + '|' + t.song.title;
        if (!uniq.has(key)) uniq.set(key, songView(t));
        else uniq.get(key).animethemes.push(songView(t).animethemes[0]);
      });
      const list = applySort([...uniq.values()], sp.get('sort'), {
        id: s => s.id, title: s => (s.title || '').toLowerCase(),
      });
      const pg = paginate(list, sp, pagePath);
      return jsonOut(200, { song: pg.slice, links: pg.links, meta: pg.meta });
    }

    // /artist index (+ /artist/{slug})
    if (path === 'artist' || path.startsWith('artist/')) {
      const recs = await getRecordsForRows(rowsAll);
      const themes = flattenThemes(rowsAll, recs);
      const map = new Map();
      themes.forEach(t => (t.song && t.song.artists || []).forEach(a => {
        if (!a.name) return;
        const key = a.slug || a.name;
        if (!map.has(key)) map.set(key, { id: hashId(key), name: a.name,
          slug: a.slug || null, songs: [] });
        map.get(key).songs.push({ id: t.song.id, title: t.song.title,
          theme: { id: t.id, type: t.type, sequence: t.sequence, slug: t.slug },
          anime: t.anime });
      }));
      let artists = [...map.values()];
      if (path !== 'artist') {
        const key = path.split('/')[1];
        artists = artists.filter(a => a.slug === key || String(a.id) === key ||
          fuzzy(a.name, key.replace(/-/g, ' ')));
        if (!artists.length) return jsonOut(404, { error: `artist "${key}" not found` });
      } else {
        const fName = sp.get('filter[name]');
        const fSlug = filterArr(sp.get('filter[slug]'));
        const fId = filterArr(sp.get('filter[id]'));
        if (fName) artists = artists.filter(a => fuzzy(a.name, fName));
        if (fSlug) artists = artists.filter(a => fSlug.includes(a.slug));
        if (fId) artists = artists.filter(a => eqAny(fId, a.id));
        if (q) artists = artists.filter(a => fuzzy(a.name, q));
        artists = applySort(artists, sp.get('sort'), {
          id: a => a.id, name: a => (a.name || '').toLowerCase(), slug: a => a.slug,
        });
        if (incSet.size && !wantsInclude(incSet, 'songs')) {
          artists = artists.map(a => { const c = { ...a }; delete c.songs; return c; });
        }
      }
      const pg = paginate(artists, sp, pagePath);
      return jsonOut(200, { artist: pg.slice, links: pg.links, meta: pg.meta });
    }

    // /video index
    if (path === 'video') {
      const recs = await getRecordsForRows(rowsAll);
      const themes = flattenThemes(rowsAll, recs);
      let videos = [];
      themes.forEach(t => (t.animethemeentries || []).forEach(e => {
        (e.videos || []).forEach(v => {
          videos.push({ ...v, audio: { id: v.id,
            basename: (v.basename || '').replace(/\.webm$/, '.ogg'),
            link: (v.basename || '').replace(/\.webm$/, '.ogg') ?
              `${VIDEO_HOST}/${v.basename.replace(/\.webm$/, '.ogg')}` : null } });
        });
      }));
      const fId = filterArr(sp.get('filter[id]'));
      const fBase = filterArr(sp.get('filter[basename]'));
      const fResRaw = sp.get('filter[resolution]');
      const fRes = fResRaw !== null && fResRaw !== '' ? Number(fResRaw) : null;
      const fSource = sp.get('filter[source]') ? String(sp.get('filter[source]')).toUpperCase() : null;
      const boolOf = v => v === 'true' ? true : v === 'false' ? false : null;
      const fSub = boolOf(sp.get('filter[subbed]')), fLy = boolOf(sp.get('filter[lyrics]'));
      const fNc = boolOf(sp.get('filter[nc]')), fUn = boolOf(sp.get('filter[uncen]'));
      if (fId) videos = videos.filter(v => eqAny(fId, v.id));
      if (fBase) videos = videos.filter(v => fBase.includes(v.basename));
      if (fRes !== null && Number.isFinite(fRes)) videos = videos.filter(v => v.resolution === fRes);
      if (fSource) videos = videos.filter(v => String(v.source || '').toUpperCase() === fSource);
      if (fSub !== null) videos = videos.filter(v => v.subbed === fSub);
      if (fLy !== null) videos = videos.filter(v => v.lyrics === fLy);
      if (fNc !== null) videos = videos.filter(v => v.nc === fNc);
      if (fUn !== null) videos = videos.filter(v => v.uncen === fUn);
      if (q) videos = videos.filter(v => fuzzy(v.basename, q) || fuzzy(v.filename, q));
      videos = applySort(videos, sp.get('sort'), {
        id: v => v.id, resolution: v => v.resolution, basename: v => v.basename,
      });
      const pg = paginate(videos, sp, pagePath);
      return jsonOut(200, { video: pg.slice, links: pg.links, meta: pg.meta });
    }

    // /audio index (derived: official v1 audio = video audio track)
    if (path === 'audio') {
      const recs = await getRecordsForRows(rowsAll);
      const themes = flattenThemes(rowsAll, recs);
      const seen = new Set();
      const audios = [];
      themes.forEach(t => (t.animethemeentries || []).forEach(e => {
        (e.videos || []).forEach(v => {
          const ab = (v.basename || '').replace(/\.webm$/, '.ogg');
          if (!ab || seen.has(ab)) return;
          seen.add(ab);
          audios.push({ id: v.id, basename: ab,
            link: `${VIDEO_HOST}/${ab}`, size: null, // size requires per-file HEAD; not scraped
            theme: { id: t.id, type: t.type, sequence: t.sequence, slug: t.slug },
            anime: t.anime });
        });
      }));
      const pg = paginate(audios, sp, pagePath);
      return jsonOut(200, { audio: pg.slice, links: pg.links, meta: pg.meta });
    }

    // /image index (anime covers/banners from the scrape)
    if (path === 'image') {
      const recs = await getRecordsForRows(rowsAll);
      const images = [];
      rowsAll.forEach(r => {
        const rec = recs.get(r._pos);
        const img = rec && rec.images || {};
        for (const facet of Object.keys(img)) {
          images.push({ id: hashId(r.slug + facet), link: img[facet],
            facet: facet.toUpperCase(),
            anime: { id: r.id, slug: r.slug, name: r.name } });
        }
      });
      const fFacet = sp.get('filter[facet]') ? String(sp.get('filter[facet]')).toUpperCase() : null;
      const filtered = fFacet ? images.filter(i => i.facet === fFacet) : images;
      const pg = paginate(filtered, sp, pagePath);
      return jsonOut(200, { image: pg.slice, links: pg.links, meta: pg.meta });
    }

    // /series + /studio indexes
    if (path === 'series' || path === 'studio') {
      const recs = await getRecordsForRows(rowsAll);
      const map = new Map();
      rowsAll.forEach(r => {
        const rec = recs.get(r._pos);
        const list = rec && (path === 'series' ? rec.series : rec.studios) || [];
        list.forEach(s => {
          const key = s.slug || s.name;
          if (!key) return;
          if (!map.has(key)) map.set(key, { id: s.id || hashId(key), name: s.name,
            slug: s.slug || null, anime: [] });
          map.get(key).anime.push({ id: r.id, slug: r.slug, name: r.name, year: r.year });
        });
      });
      let list = [...map.values()];
      const fName = sp.get('filter[name]');
      const fSlug = filterArr(sp.get('filter[slug]'));
      if (fName) list = list.filter(x => fuzzy(x.name, fName));
      if (fSlug) list = list.filter(x => fSlug.includes(x.slug));
      if (q) list = list.filter(x => fuzzy(x.name, q));
      const pg = paginate(list, sp, pagePath);
      return jsonOut(200, { [path]: pg.slice, links: pg.links, meta: pg.meta });
    }

    // /resource — static catalog of external sites (official v1 /resource)
    if (path === 'resource') {
      const list = [
        { id: 1, site: 'MAL', siteLocalized: 'MyAnimeList' },
        { id: 2, site: 'ANILIST', siteLocalized: 'AniList' },
        { id: 3, site: 'KITSU', siteLocalized: 'Kitsu' },
        { id: 4, site: 'ANIDB', siteLocalized: 'aniDB' },
        { id: 5, site: 'OS', siteLocalized: 'Official Site' },
        { id: 6, site: 'TWITTER', siteLocalized: 'Twitter' },
        { id: 7, site: 'YOUTUBE', siteLocalized: 'YouTube' },
        { id: 8, site: 'WIKI', siteLocalized: 'Wikipedia' },
        { id: 9, site: 'VGMDB', siteLocalized: 'VGMdb' },
      ];
      const pg = paginate(list, sp, pagePath);
      return jsonOut(200, { resource: pg.slice, links: pg.links, meta: pg.meta });
    }

    // auth-only / admin / list resources cannot exist in a public scrape
    if (['playlist', 'user', 'role', 'permission', 'announcement', 'feature',
         'featured-theme', 'me', 'page'].some(p => path === p || path.startsWith(p + '/'))) {
      return jsonOut(501, { error: 'resource requires authentication on the official API and cannot be provided by the public scrape', resource: path });
    }

    return jsonOut(404, { error: `unknown endpoint "${path}"`,
      endpoints: ['anime', 'anime/{slug|id}', 'theme', 'theme/{id}', 'song', 'artist',
        'artist/{slug}', 'video', 'series', 'studio', 'audio', 'image', 'search?q=',
        'year', 'year/{year}', 'resource'] });
  } catch (e) {
    return jsonOut(503, { error: 'dataset temporarily unavailable',
      detail: String(e && e.message || e).slice(0, 200),
      hint: 'the crawled AnimeThemes dataset (GitHub raw) did not respond — retry shortly' });
  }
};
