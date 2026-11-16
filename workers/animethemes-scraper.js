// ─────────────────────────────────────────────────────────────────────────
// Cloudflare Worker variant of the AnimeThemes scraper API (t194).
//
// Same surface and response shapes as api/animethemes/[[...path]].js (Vercel),
// reading the same crawled dataset (data/animethemes/ on this repo's main
// branch via raw.githubusercontent.com). Deployed at
//   https://animethemes-scraper.<your-subdomain>.workers.dev
//
// Deploy (owner runs this — the agent sandbox has no Cloudflare token):
//   cd /home/z/my-project/aniwind
//   npx wrangler deploy workers/animethemes-scraper.js --name animethemes-scraper --compatibility-date 2024-01-01
// Or wire it into workers/wrangler.toml and `npx wrangler deploy`.
// ─────────────────────────────────────────────────────────────────────────

const DATASET_BASE = 'https://raw.githubusercontent.com/Varvoul/AniWind/main/data/animethemes';
const VIDEO_HOST = 'https://v.animethemes.moe';
const VERSION = 'animethemes v1 scraper CF (t194)';

const TTL_MS = 10 * 60 * 1000;
let _index = null, _indexAt = 0;
const _chunks = new Map();

const SITE_ALIASES = {
  myanimelist: 'mal_id', mal: 'mal_id',
  anilist: 'anilist_id',
  kitsu: 'kitsu_id',
  anidb: 'anidb_id',
};

async function fetchJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'ruristream-animethemes-scraper/1.0' } });
  if (!r.ok) throw new Error(`dataset HTTP ${r.status}`);
  return r.json();
}

async function loadIndex() {
  if (_index && Date.now() - _indexAt < TTL_MS) return _index;
  _index = await fetchJson(`${DATASET_BASE}/index.json`);
  _indexAt = Date.now();
  return _index;
}

async function loadChunk(k) {
  const hit = _chunks.get(k);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;
  const d = await fetchJson(`${DATASET_BASE}/chunks/chunk_${String(k).padStart(3, '0')}.json`);
  _chunks.set(k, { at: Date.now(), data: d });
  if (_chunks.size > 60) _chunks.delete(_chunks.keys().next().value);
  return d;
}

// ── shared helpers (kept in sync with the Vercel handler) ────────────────
const filterArr = v => v === null || v === undefined || v === '' ? null :
  String(v).split(',').map(s => s.trim()).filter(Boolean);
const eqAny = (arr, val) => arr ? arr.map(String).includes(String(val)) : false;
const fuzzy = (hay, needle) => (hay || '').toLowerCase().includes(String(needle).toLowerCase());
const hashId = s => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h) % 100000000; };

function parseYear(v) {
  const m = String(v).match(/^(\d{4})-(\d{4})$/);
  if (m) return [Number(m[1]), Number(m[2])];
  const y = Number(v);
  return Number.isFinite(y) && y > 1900 ? [y, y] : null;
}

function parseInclude(sp) {
  const raw = sp.get('include');
  const set = new Set();
  if (raw) raw.split(',').map(s => s.trim().toLowerCase()).forEach(s => {
    set.add(s);
    set.add(s.replace(/^animethemes\./, '').replace(/^animethemeentries\./, ''));
  });
  return set;
}

const wantsInclude = (set, p) => set.has(p) || [...set].some(x => x.startsWith(p + '.'));

function attachIncludes(rec, incSet) {
  const out = { ...rec };
  if (!incSet.size) {
    delete out.animethemes; delete out.images; delete out.series;
    delete out.studios; delete out.synonyms;
    return out;
  }
  if (wantsInclude(incSet, 'animethemes')) {
    out.animethemes = (out.animethemes || []).map(t => {
      const th = { ...t };
      if (!incSet.has('animethemes.song')) delete th.song;
      if (wantsInclude(incSet, 'animethemes.animethemeentries')) {
        th.animethemeentries = (th.animethemeentries || []).map(e => {
          const en = { ...e };
          if (!wantsInclude(incSet, 'animethemes.animethemeentries.videos')) delete en.videos;
          return en;
        });
      } else delete th.animethemeentries;
      return th;
    });
  } else delete out.animethemes;
  if (!wantsInclude(incSet, 'images')) delete out.images;
  if (!wantsInclude(incSet, 'series')) delete out.series;
  if (!wantsInclude(incSet, 'studios')) delete out.studios;
  if (!wantsInclude(incSet, 'synonyms')) delete out.synonyms;
  return out;
}

function paginate(list, sp, path) {
  let size = Number(sp.get('page[size]')); if (!Number.isFinite(size) || size <= 0) size = 100;
  size = Math.min(size, 200);
  let num = Number(sp.get('page[number]')); if (!Number.isFinite(num) || num <= 0) num = 1;
  const total = list.length, lastPage = Math.max(1, Math.ceil(total / size));
  num = Math.min(num, lastPage);
  const qs = new URLSearchParams(sp);
  const pageUrl = n => { qs.set('page[size]', String(size)); qs.set('page[number]', String(n)); return `${path}?${qs}`; };
  return { slice: list.slice((num - 1) * size, num * size),
    meta: { current_page: num, from: total ? (num - 1) * size + 1 : null, last_page: lastPage,
      path, per_page: size, to: Math.min(num * size, total), total },
    links: { first: pageUrl(1), last: pageUrl(lastPage), prev: num > 1 ? pageUrl(num - 1) : null,
      next: num < lastPage ? pageUrl(num + 1) : null } };
}

function applySort(list, sort, keyFns) {
  if (!sort) return list;
  let f = sort, desc = false;
  if (f.startsWith('-')) { desc = true; f = f.slice(1); }
  const fn = keyFns[f]; if (!fn) return list;
  const out = [...list].sort((a, b) => { const ka = fn(a), kb = fn(b);
    if (ka === kb) return 0; if (ka == null) return 1; if (kb == null) return -1; return ka < kb ? -1 : 1; });
  return desc ? out.reverse() : out;
}

function flattenThemes(rows, recsMap) {
  const out = [];
  rows.forEach(r => {
    const rec = recsMap.get(r._pos);
    if (rec) (rec.animethemes || []).forEach(t => out.push({ ...t,
      anime: { id: rec.id, slug: rec.slug, name: rec.name, year: rec.year,
        mal_id: rec.mal_id, anilist_id: rec.anilist_id } }));
  });
  return out;
}

async function getRecordsForRows(rows) {
  const groups = new Map();
  rows.forEach(r => { const k = Math.floor(r._pos / 100);
    if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r._pos); });
  const out = new Map();
  for (const [k, poss] of groups) {
    const d = await loadChunk(k);
    poss.forEach(pos => { const rec = d.anime[pos - k * 100]; if (rec) out.set(pos, rec); });
  }
  return out;
}

function filterAnime(rows, sp) {
  const fSite = sp.get('filter[site]');
  const idField = fSite ? SITE_ALIASES[String(fSite).toLowerCase()] : null;
  if (fSite && !idField) return { error: `unknown filter[site] "${fSite}"` };
  const hasExt = !!sp.get('filter[external_id]');
  if (hasExt && !fSite) return { error: 'filter[external_id] requires filter[site]' };
  const extNum = hasExt ? Number(sp.get('filter[external_id]')) : null;
  if (hasExt && !Number.isFinite(extNum)) return { error: 'filter[external_id] must be numeric' };
  const fId = filterArr(sp.get('filter[id]')), fSlug = filterArr(sp.get('filter[slug]'));
  const fName = sp.get('filter[name]'), fQ = sp.get('filter[q]');
  const fYear = sp.get('filter[year]') ? parseYear(sp.get('filter[year]')) : null;
  const fSeason = sp.get('filter[season]') ? String(sp.get('filter[season]')).toUpperCase() : null;
  const fHas = filterArr(sp.get('filter[has]'));
  return { rows: rows.filter(r => {
    if (fId && !eqAny(fId, r.id)) return false;
    if (fSlug && !fSlug.includes(r.slug)) return false;
    if (fName && !fuzzy(r.name, fName) && !fuzzy(r.english, fName)) return false;
    if (fQ && !fuzzy(r.name, fQ) && !fuzzy(r.english, fQ)) return false;
    if (fYear && !(r.year && r.year >= fYear[0] && r.year <= fYear[1])) return false;
    if (fSeason && String(r.season || '') !== fSeason) return false;
    if (fHas && fHas.includes('resources') && r.mal_id == null && r.anilist_id == null && r.kitsu_id == null) return false;
    if (hasExt && idField && r[idField] !== extNum) return false;
    return true;
  }) };
}

function themeView(t) {
  return { id: t.id, type: t.type, sequence: t.sequence, group: t.group, slug: t.slug,
    song: t.song ? { id: t.song.id, title: t.song.title, artists: t.song.artists || [] } : null,
    animethemeentries: (t.animethemeentries || []).map(e => ({ id: e.id, episodes: e.episodes,
      version: e.version, nsfw: e.nsfw, spoiler: e.spoiler, notes: e.notes, videos: e.videos || [] })),
    anime: t.anime || undefined };
}

function jsonOut(code, body) {
  return new Response(JSON.stringify(body), { status: code, headers: {
    'Content-Type': 'application/json',
    'Cache-Control': 's-maxage=300, stale-while-revalidate=86400',
    'X-Data-Source': VERSION, 'Access-Control-Allow-Origin': '*' } });
}

export default {
  async fetch(req) {
    const u = new URL(req.url);
    const sp = u.searchParams;
    const path = decodeURIComponent(u.pathname.replace(/^\/+/, '')).replace(/\/+$/, '');
    try {
      const index = await loadIndex();
      const rowsAll = index.anime.map((r, pos) => ({ ...r, _pos: pos }));
      const incSet = parseInclude(sp);
      const q = sp.get('q');
      const pagePath = `${u.origin}/${path || 'anime'}`;

      if (path === 'year' || path.startsWith('year/')) {
        const map = new Map();
        rowsAll.forEach(r => { if (!r.year) return;
          if (!map.has(r.year)) map.set(r.year, new Set()); if (r.season) map.get(r.year).add(r.season); });
        const ORDER = ['WINTER', 'SPRING', 'SUMMER', 'FALL'];
        const years = [...map.keys()].sort((a, b) => b - a).map(y => ({ year: y,
          seasons: ORDER.filter(s => map.get(y).has(s)).concat([...map.get(y)].filter(x => !ORDER.includes(x))) }));
        if (path === 'year') return jsonOut(200, { years });
        const y = Number(path.split('/')[1]);
        const hit = years.find(x => x.year === y);
        return hit ? jsonOut(200, { year: hit }) : jsonOut(404, { error: `no data for year ${y}` });
      }

      if (path === 'search') {
        const term = (q || sp.get('filter[q]') || '').trim();
        if (!term) return jsonOut(400, { error: 'q parameter required' });
        const tLow = term.toLowerCase();
        const animeSlice = rowsAll.filter(r => fuzzy(r.name, tLow) || fuzzy(r.english, tLow))
          .sort((a, b) => (a.name || '').localeCompare(b.name || '')).slice(0, 20);
        const recs = await getRecordsForRows(animeSlice);
        const artistMap = new Map(), songHits = [], themeHits = [];
        animeSlice.forEach(r => { const rec = recs.get(r._pos);
          (rec ? rec.animethemes : []).forEach(t => {
            themeHits.push(themeView(t));
            if (t.song) {
              const s = { id: t.song.id, title: t.song.title, anime: { id: rec.id, slug: rec.slug, name: rec.name } };
              if (!songHits.some(x => x.id === s.id && x.title === s.title)) songHits.push(s);
              (t.song.artists || []).forEach(a => {
                if (!artistMap.has(a.name)) artistMap.set(a.name, { name: a.name, slug: a.slug, songs: [] });
                artistMap.get(a.name).songs.push({ id: t.song.id, title: t.song.title, slug: t.slug, anime: s.anime }); });
            } }); });
        return jsonOut(200, { search: {
          anime: animeSlice.map(r => ({ id: r.id, slug: r.slug, name: r.name, english: r.english,
            year: r.year, mal_id: r.mal_id, anilist_id: r.anilist_id, themes: r.themes })),
          artists: [...artistMap.values()].slice(0, 20),
          songs: songHits.slice(0, 20), themes: themeHits.slice(0, 20) } });
      }

      if (path === 'anime' || path.startsWith('anime/')) {
        const showId = path === 'anime' ? null : path.split('/')[1];
        let rows = rowsAll;
        if (showId !== null) {
          const row = rows.find(r => r.slug === showId) || (/^\d+$/.test(showId)
            ? rows.find(r => String(r.id) === showId || String(r.mal_id) === showId) : null);
          if (!row) return jsonOut(404, { error: `anime "${showId}" not found` });
          const recs = await getRecordsForRows([row]);
          const rec = recs.get(row._pos);
          if (!rec) return jsonOut(503, { error: 'dataset chunk unavailable' });
          return jsonOut(200, { anime: attachIncludes({ ...rec }, incSet) });
        }
        const filtered = filterAnime(rows, sp);
        if (filtered.error) return jsonOut(400, { error: filtered.error });
        rows = applySort(filtered.rows, sp.get('sort'), {
          id: r => r.id, name: r => (r.name || '').toLowerCase(), slug: r => r.slug,
          year: r => r.year, mal_id: r => r.mal_id, anilist_id: r => r.anilist_id, themes: r => r.themes });
        const pg = paginate(rows, sp, pagePath);
        const recs = await getRecordsForRows(pg.slice);
        return jsonOut(200, { anime: pg.slice.map(r => {
          const rec = recs.get(r._pos);
          return rec ? attachIncludes({ ...rec }, incSet) :
            { id: r.id, slug: r.slug, name: r.name, english: r.english, mal_id: r.mal_id, anilist_id: r.anilist_id, year: r.year };
        }), links: pg.links, meta: pg.meta });
      }

      if (path === 'theme' || path.startsWith('theme/')) {
        const recs = await getRecordsForRows(rowsAll);
        let themes = flattenThemes(rowsAll, recs);
        if (path !== 'theme') {
          const tid = Number(path.split('/')[1]);
          themes = themes.filter(t => t.id === tid);
          if (!themes.length) return jsonOut(404, { error: `theme ${path.split('/')[1]} not found` });
        } else {
          const fId = filterArr(sp.get('filter[id]')), fSlug = filterArr(sp.get('filter[slug]'));
          const fType = sp.get('filter[type]') ? String(sp.get('filter[type]')).toUpperCase() : null;
          const fSeq = sp.get('filter[sequence]') ? Number(sp.get('filter[sequence]')) : null;
          const fAnime = sp.get('filter[anime]'), fTitle = sp.get('filter[title]'), fArtist = sp.get('filter[artist]');
          if (fId) themes = themes.filter(t => eqAny(fId, t.id));
          if (fSlug) themes = themes.filter(t => fSlug.includes(t.slug));
          if (fType) themes = themes.filter(t => t.type === fType);
          if (fSeq !== null && Number.isFinite(fSeq)) themes = themes.filter(t => t.sequence === fSeq);
          if (fAnime) themes = themes.filter(t => fuzzy(t.anime && t.anime.slug, fAnime) || fuzzy(t.anime && t.anime.name, fAnime));
          if (fTitle) themes = themes.filter(t => fuzzy(t.song && t.song.title, fTitle));
          if (fArtist) themes = themes.filter(t => (t.song && t.song.artists || []).some(a => fuzzy(a.name, fArtist)));
          if (q) themes = themes.filter(t => fuzzy(t.song && t.song.title, q) || fuzzy(t.anime && t.anime.name, q) ||
            (t.song && t.song.artists || []).some(a => fuzzy(a.name, q)));
          themes = applySort(themes, sp.get('sort'), { id: t => t.id, type: t => t.type,
            sequence: t => t.sequence, slug: t => t.slug, title: t => (t.song && t.song.title || '').toLowerCase() });
        }
        const withInc = themes.map(t => { const tv = themeView(t);
          if (incSet.size && !wantsInclude(incSet, 'animethemeentries') && !wantsInclude(incSet, 'entries')) delete tv.animethemeentries;
          if (incSet.size && !wantsInclude(incSet, 'song')) delete tv.song;
          if (incSet.size && !wantsInclude(incSet, 'anime')) delete tv.anime;
          return tv; });
        const pg = paginate(withInc, sp, pagePath);
        return jsonOut(200, { theme: pg.slice, links: pg.links, meta: pg.meta });
      }

      if (path === 'song') {
        const recs = await getRecordsForRows(rowsAll);
        let themes = flattenThemes(rowsAll, recs).filter(t => t.song && t.song.id);
        const fTitle = sp.get('filter[title]'), fArtist = sp.get('filter[artist]');
        if (fTitle) themes = themes.filter(t => fuzzy(t.song.title, fTitle));
        if (fArtist) themes = themes.filter(t => (t.song.artists || []).some(a => fuzzy(a.name, fArtist)));
        if (q) themes = themes.filter(t => fuzzy(t.song.title, q) || (t.song.artists || []).some(a => fuzzy(a.name, q)));
        const uniq = new Map();
        themes.forEach(t => { const key = t.song.id + '|' + t.song.title;
          if (!uniq.has(key)) uniq.set(key, { id: t.song.id, title: t.song.title,
            artists: t.song.artists || [], animethemes: [{ id: t.id, type: t.type,
              sequence: t.sequence, slug: t.slug, anime: t.anime }] });
          else uniq.get(key).animethemes.push({ id: t.id, type: t.type, sequence: t.sequence, slug: t.slug, anime: t.anime }); });
        const pg = paginate(applySort([...uniq.values()], sp.get('sort'),
          { id: s => s.id, title: s => (s.title || '').toLowerCase() }), sp, pagePath);
        return jsonOut(200, { song: pg.slice, links: pg.links, meta: pg.meta });
      }

      if (path === 'artist' || path.startsWith('artist/')) {
        const recs = await getRecordsForRows(rowsAll);
        const map = new Map();
        flattenThemes(rowsAll, recs).forEach(t => (t.song && t.song.artists || []).forEach(a => {
          if (!a.name) return; const key = a.slug || a.name;
          if (!map.has(key)) map.set(key, { id: hashId(key), name: a.name, slug: a.slug || null, songs: [] });
          map.get(key).songs.push({ id: t.song.id, title: t.song.title,
            theme: { id: t.id, type: t.type, sequence: t.sequence, slug: t.slug }, anime: t.anime }); }));
        let artists = [...map.values()];
        if (path !== 'artist') {
          const key = path.split('/')[1];
          artists = artists.filter(a => a.slug === key || String(a.id) === key || fuzzy(a.name, key.replace(/-/g, ' ')));
          if (!artists.length) return jsonOut(404, { error: `artist "${key}" not found` });
        } else {
          const fName = sp.get('filter[name]'), fSlug = filterArr(sp.get('filter[slug]')), fId = filterArr(sp.get('filter[id]'));
          if (fName) artists = artists.filter(a => fuzzy(a.name, fName));
          if (fSlug) artists = artists.filter(a => fSlug.includes(a.slug));
          if (fId) artists = artists.filter(a => eqAny(fId, a.id));
          if (q) artists = artists.filter(a => fuzzy(a.name, q));
          artists = applySort(artists, sp.get('sort'), { id: a => a.id, name: a => (a.name || '').toLowerCase(), slug: a => a.slug });
        }
        const pg = paginate(artists, sp, pagePath);
        return jsonOut(200, { artist: pg.slice, links: pg.links, meta: pg.meta });
      }

      if (path === 'video' || path === 'audio') {
        const recs = await getRecordsForRows(rowsAll);
        const list = [];
        flattenThemes(rowsAll, recs).forEach(t => (t.animethemeentries || []).forEach(e => {
          if (path === 'video') (e.videos || []).forEach(v => list.push({ ...v,
            audio: { id: v.id, basename: (v.basename || '').replace(/\.webm$/, '.ogg'),
              link: `${VIDEO_HOST}/${(v.basename || '').replace(/\.webm$/, '.ogg')}` } }));
          else (e.videos || []).forEach(v => { const ab = (v.basename || '').replace(/\.webm$/, '.ogg');
            if (ab && !list.some(x => x.basename === ab)) list.push({ id: v.id, basename: ab,
              link: `${VIDEO_HOST}/${ab}`, size: null,
              theme: { id: t.id, type: t.type, sequence: t.sequence, slug: t.slug }, anime: t.anime }); });
        }));
        const fId = filterArr(sp.get('filter[id]'));
        const filtered = fId ? list.filter(v => eqAny(fId, v.id)) : list;
        const pg = paginate(filtered, sp, pagePath);
        return jsonOut(200, { [path]: pg.slice, links: pg.links, meta: pg.meta });
      }

      if (path === 'series' || path === 'studio') {
        const recs = await getRecordsForRows(rowsAll);
        const map = new Map();
        rowsAll.forEach(r => { const rec = recs.get(r._pos);
          (rec && (path === 'series' ? rec.series : rec.studios) || []).forEach(s => {
            const key = s.slug || s.name; if (!key) return;
            if (!map.has(key)) map.set(key, { id: s.id || hashId(key), name: s.name, slug: s.slug || null, anime: [] });
            map.get(key).anime.push({ id: r.id, slug: r.slug, name: r.name, year: r.year }); }); });
        const pg = paginate([...map.values()], sp, pagePath);
        return jsonOut(200, { [path]: pg.slice, links: pg.links, meta: pg.meta });
      }

      if (path === 'resource') {
        const pg = paginate([
          { id: 1, site: 'MAL', siteLocalized: 'MyAnimeList' },
          { id: 2, site: 'ANILIST', siteLocalized: 'AniList' },
          { id: 3, site: 'KITSU', siteLocalized: 'Kitsu' },
          { id: 4, site: 'ANIDB', siteLocalized: 'aniDB' },
        ], sp, pagePath);
        return jsonOut(200, { resource: pg.slice, links: pg.links, meta: pg.meta });
      }

      if (['playlist', 'user', 'role', 'permission', 'announcement', 'feature', 'featured-theme', 'me', 'page']
          .some(p => path === p || path.startsWith(p + '/'))) {
        return jsonOut(501, { error: 'resource requires authentication on the official API and cannot be provided by the public scrape', resource: path });
      }

      return jsonOut(404, { error: `unknown endpoint "${path}"`,
        endpoints: ['anime', 'anime/{slug|id}', 'theme', 'song', 'artist', 'video', 'audio',
          'series', 'studio', 'search?q=', 'year', 'year/{year}', 'resource'] });
    } catch (e) {
      return jsonOut(503, { error: 'dataset temporarily unavailable',
        detail: String(e && e.message || e).slice(0, 200) });
    }
  },
};
