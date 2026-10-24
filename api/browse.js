// ─────────────────────────────────────────────────────────────────────────
// /api/browse — unified, filterable browse endpoint for the browse page.
//
// Serves every browse-style clean URL on the site:
//   /browse, /genre/:n, /country/:n, /type/:n, /status/:n, /new-releases,
//   /recent, /latest-updates, /anime/genre|studio|status/:n,
//   /anime/season/:s/year/:y, /tv/*, /movie/* (the page itself parses the
//   path and forwards the filters here as query params).
//
// DATA CHAINS (owner spec):
//   anime : ruri s-mal -> ruri anikoto -> [anikoto recent feed] ->
//           anilist-my-proxy -> anilist-scraper -> self-hosted jikan
//   tmdb  : t-umi.bionmovies47 (CF account 1) -> t-umi.zeraf (CF account 2)
//           (+ mapple hidden-gems for the Hidden tab)
// Legs are capability-routed: a query is served by the first leg that
// natively supports ALL of its active filters; legs that can only partially
// support a query apply the remaining filters as POST-filters (walking
// source pages to fill the requested window). Unsupported-anywhere filters
// produce honest `warnings` — never silently wrong data.
//
// CACHE (owner spec): exact-key TTL — key covers EVERY normalized param,
// so any filter change = new key = fresh fetch, then cached for the next
// visitor (server-side cache shared across users). TTL 30 min + edge
// s-maxage 1800 / SWR 86400. Write-only-on-valid: empty/failed upstream
// responses are never cached over a good copy. `?refresh=1` bypasses.
// ─────────────────────────────────────────────────────────────────────────

const VERSION = 'browse v1';

const RURI_BASE      = 'https://ruri.bionmovies47.workers.dev';
const RECENT_BASE    = 'https://anikoto.bionmovies47.workers.dev/recent-anime';
const PROXY_BASE     = 'https://anilist-my-proxy.vercel.app';
const SCRAPER_BASE   = 'https://anilist-scraper-steel.vercel.app';
const JIKAN_BASE     = 'https://jikan-api-bohb.onrender.com/v4';
const TUMI_PRIMARY   = 'https://t-umi.bionmovies47.workers.dev';
const TUMI_BACKUP    = 'https://t-umi.zeraf.workers.dev';
const MAPPLE_BASE    = 'https://mapple-tmdb-proxy.vercel.app';
const TMDB_IMG       = 'https://image.tmdb.org/t/p';

const TTL_MS = 30 * 60 * 1000; // 30 min server cache (owner spec: agent-chosen)
const EDGE_TTL = 1800;
const MAX_PER_PAGE = 50;
const MAX_PAGE = 500;
const MAX_SOURCE_PAGES = 7;    // upstream pages one browse request may consume
const ANILIST_TOTAL_CAP = 5000; // AniList reports pageInfo.total capped at 5000 while deep pages are empty — never trust >= this value

// ── lookups ──────────────────────────────────────────────────────────────
const COUNTRY_ISO = {
  'argentina':'AR','australia':'AU','austria':'AT','belgium':'BE','brazil':'BR',
  'canada':'CA','china':'CN','colombia':'CO','czech-republic':'CZ','denmark':'DK',
  'finland':'FI','france':'FR','germany':'DE','hong-kong':'HK','hungary':'HU',
  'india':'IN','ireland':'IE','israel':'IL','italy':'IT','japan':'JP',
  'luxembourg':'LU','mexico':'MX','netherlands':'NL','new-zealand':'NZ',
  'nigeria':'NG','norway':'NO','philippines':'PH','poland':'PL','romania':'RO',
  'russia':'RU','south-africa':'ZA','south-korea':'KR','spain':'ES','sweden':'SE',
  'switzerland':'CH','taiwan':'TW','thailand':'TH','turkey':'TR',
  'united-kingdom':'GB','united-states':'US'
};

// genre slug -> MAL/ruri genre-or-theme name (ilike substring match)
const GENRE_NAME = {
  'action':'Action','adventure':'Adventure','animation':'Animation',
  'comedy':'Comedy','drama':'Drama','ecchi':'Ecchi','fantasy':'Fantasy',
  'horror':'Horror','mystery':'Mystery','romance':'Romance','sci-fi':'Sci-Fi',
  'slice-of-life':'Slice of Life','sports':'Sports','supernatural':'Supernatural',
  'thriller':'Thriller','music':'Music','mecha':'Mecha','military':'Military',
  'magic':'Magic','demons':'Demons','super-power':'Super Power','vampire':'Vampire',
  'space':'Space','police':'Police','psychological':'Psychological','parody':'Parody',
  'samurai':'Samurai','historical':'Historical','kids':'Kids','gourmet':'Gourmet',
  'isekai':'Isekai','iyashikei':'Iyashikei','harem':'Harem','reverse-harem':'Reverse Harem',
  'school':'School','shounen':'Shounen','shoujo':'Shoujo','seinen':'Seinen','josei':'Josei',
  'mahou-shoujo':'Mahou Shoujo','kodomomuke':'Kodomomuke','boys-love':'Boys Love',
  'girls-love':'Girls Love','martial-arts':'Martial Arts','avant-garde':'Avant Garde',
  'suspense':'Suspense','mythology':'Mythology','time-travel':'Time Travel',
  'workplace':'Workplace','survival':'Survival','video-game':'Video Game',
  'racing':'Racing','medical':'Medical','pets':'Pets','anthropomorphic':'Anthropomorphic',
  'performing-arts':'Performing Arts','otaku-culture':'Otaku Culture',
  'strategy-game':'Strategy Game','team-sports':'Team Sports','adult-cast':'Adult Cast',
  'music-musical':'Music'
};

// AniList GENRE enum names (everything else is a TAG on AniList)
const ANILIST_GENRES = new Set(['Action','Adventure','Comedy','Drama','Ecchi','Fantasy',
  'Horror','Mahou Shoujo','Mecha','Music','Mystery','Psychological','Romance','Sci-Fi',
  'Slice of Life','Sports','Supernatural','Thriller']);

// MAL genre ids for jikan (safe subset)
const JIKAN_GENRE_ID = {
  'action':1,'adventure':2,'comedy':4,'drama':8,'fantasy':10,'horror':14,
  'mystery':7,'romance':22,'sci-fi':24,'slice-of-life':36,'sports':30,
  'supernatural':37,'thriller':41,'ecchi':9,'music':19,'mecha':18,'military':38,
  'magic':16,'demons':6,'super-power':31,'vampire':32,'space':29,'police':39,
  'psychological':40,'parody':20,'samurai':21,'historical':13,'kids':15,
  'gourmet':34,'isekai':62,'harem':35,'shounen':43,'shoujo':25,'seinen':42,'josei':43
};

// TMDB genre ids per kind (slug -> id); tv uses Action & Adventure style ids
const TMDB_TV_GENRE = {
  'action':10759,'action-adventure':10759,'adventure':10759,'animation':16,
  'comedy':35,'crime':80,'documentary':99,'drama':18,'family':10751,'kids':10762,
  'mystery':9648,'news':10763,'reality':10764,'reality-tv':10764,'sci-fi':10765,
  'sci-fi-fantasy':10765,'fantasy':10765,'soap':10766,'talk':10767,'talk-show':10767,
  'war':10768,'war-politics':10768,'western':37,'music-musical':10402
};
const TMDB_MOVIE_GENRE = {
  'action':28,'action-adventure':28,'adventure':12,'animation':16,'comedy':35,
  'crime':80,'documentary':99,'drama':18,'family':10751,'fantasy':14,'history':36,
  'horror':27,'music':10402,'mystery':9648,'romance':10749,'sci-fi':878,
  'science-fiction':878,'sci-fi-fantasy':878,'tv-movie':10770,'thriller':53,
  'war':10752,'western':37,'music-musical':10402
};
// TMDB id -> display name (for normalizing genre_ids on results)
const TMDB_GENRE_NAME = {
  28:'Action',12:'Adventure',16:'Animation',35:'Comedy',80:'Crime',99:'Documentary',
  18:'Drama',10751:'Family',14:'Fantasy',36:'History',27:'Horror',10402:'Music',
  9648:'Mystery',10749:'Romance',878:'Science Fiction',10770:'TV Movie',53:'Thriller',
  10752:'War',37:'Western',10759:'Action & Adventure',10762:'Kids',10763:'News',
  10764:'Reality',10765:'Sci-Fi & Fantasy',10766:'Soap',10767:'Talk',
  10768:'War & Politics'
};

const STUDIO_NAME = {
  'toei-animation':'Toei Animation','madhouse':'Madhouse','bones':'Bones',
  'kyoto-animation':'Kyoto Animation','a-1-pictures':'A-1 Pictures','mappa':'MAPPA',
  'wit-studio':'Wit Studio','ufotable':'ufotable','j-c-staff':'J.C.Staff',
  'production-i-g':'Production I.G'
};
const TMDB_COMPANY_ID = {
  'warner-bros-pictures':174,'universal-pictures':33,'walt-disney-pictures':2,
  'paramount-pictures':4,'columbia-pictures':5,'twentieth-century-fox':25,
  'mgm':21,'marvel-studios':420,'legendary-pictures':923,'a24':41077
};

const SOURCE_NAME = {
  'manga':'Manga','original':'Original','light-novel':'Light Novel','other':'Other',
  'video-game':'Video game','visual-novel':'Visual novel','novel':'Novel',
  'web-novel':'Web novel','unknown':'Unknown','web-manga':'Web manga','game':'Game',
  '4-koma-manga':'4-koma manga','book':'Book','picture-book':'Picture book',
  'mixed-media':'Mixed media','card-game':'Card game','music':'Music','radio':'Radio'
};
const ANILIST_SOURCE = {
  'manga':'MANGA','original':'ORIGINAL','light-novel':'LIGHT_NOVEL','other':'OTHER',
  'video-game':'VIDEO_GAME','visual-novel':'VISUAL_NOVEL','novel':'NOVEL',
  'web-novel':'WEB_NOVEL','game':'GAME','picture-book':'PICTURE_BOOK',
  'mixed-media':'MULTIMEDIA_PROJECT'
};

const ANIME_STATUS = {
  'currently-airing':{ ruri:'currently-airing', anilist:'RELEASING', jikan:'airing', display:'Currently Airing' },
  'finished-airing':{ ruri:'finished-airing', anilist:'FINISHED', jikan:'complete', display:'Finished Airing' },
  'not-yet-aired':  { ruri:'not-yet-aired',   anilist:'NOT_YET_RELEASED', jikan:'upcoming', display:'Not yet aired' },
  'cancelled':      { ruri:null, anilist:'CANCELLED', jikan:null, display:'Cancelled' },
  'on-hiatus':      { ruri:null, anilist:'HIATUS', jikan:null, display:'On Hiatus' }
};
const TV_STATUS = {
  'returning-series':{ tmdb:0, display:'Returning Series' },
  'ended':           { tmdb:3, display:'Ended' },
  'canceled':        { tmdb:4, display:'Canceled' },
  'in-production':   { tmdb:2, display:'In Production' },
  'planned':         { tmdb:1, display:'Planned' }
};
const MOVIE_STATUS = {
  'released':        { mode:'past', display:'Released' },
  'post-production': { mode:'future', display:'Post Production' },
  'in-production':   { mode:'future', display:'In Production' },
  'planned':         { mode:'future', display:'Planned' },
  'rumored':         { mode:'none', display:'Rumored' }
};
// aggregate status used by /status/ongoing|airing|upcoming in mixed mode
const AGG_STATUS = {
  'ongoing': { anime:'currently-airing', tv:'returning-series', movie:null },
  'airing':  { anime:'currently-airing', tv:'returning-series', movie:null },
  'upcoming':{ anime:'not-yet-aired', tv:'in-production', movie:'future-release' }
};

const RATING = {
  'g':    { ruri:'g',    jikan:'g',    display:'G — All Ages' },
  'pg':   { ruri:'pg',   jikan:'pg',   display:'PG — Children' },
  'pg13': { ruri:'pg13', jikan:'pg13', display:'PG-13 — Teens 13+' },
  'r17':  { ruri:'r17',  jikan:'r17',  display:'R — 17+ (Violence & Profanity)' },
  'r_plus':{ ruri:'r_plus', jikan:'r+', display:'R+ — Mild Nudity' },
  'rx':   { ruri:'rx',   jikan:null,   display:'Rx — Hentai' }
};

const RURI_TYPE = { 'tv':'tv','movie':'movie','ova':'ova','ona':'ona',
  'tv-special':'special','tv-short':null,'music':'music','series':null,'drama':null };
const ANILIST_FORMAT = { 'tv':'TV','movie':'MOVIE','ova':'OVA','ona':'ONA',
  'tv-short':'TV_SHORT','tv-special':'SPECIAL' };
const JIKAN_TYPE = { 'tv':'tv','movie':'movie','ova':'ova','ona':'ona',
  'tv-special':'special','music':'music' };
const SEASON_START = { winter:'-01-01', spring:'-04-01', summer:'-07-01', fall:'-10-01' };

// ── small helpers ────────────────────────────────────────────────────────
function json(res, code, obj, headers) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (headers) for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(obj));
}
function setEdge(res, ttl = EDGE_TTL) {
  res.setHeader('Cache-Control', `public, s-maxage=${ttl}, stale-while-revalidate=86400, stale-if-error=604800`);
  res.setHeader('Vercel-CDN-Cache-Control', `public, s-maxage=${ttl}, stale-if-error=604800`);
}
function noEdge(res) {
  res.setHeader('Cache-Control', 'no-store');
}
async function fetchJson(url, opts = {}, timeoutMs = 10000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...opts, signal: ctl.signal });
    const text = await r.text();
    let body = null;
    try { body = JSON.parse(text); } catch (_) {}
    if (!r.ok) {
      const err = new Error(`HTTP ${r.status}${body && body.message ? ': ' + body.message : ''}`);
      err.status = r.status; err.body = body;
      throw err;
    }
    if (body === null) throw new Error('invalid JSON response');
    return body;
  } finally { clearTimeout(t); }
}
const slugifyTitle = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const titleCaseSlug = s => String(s || '').split(/[-\s]+/).filter(Boolean).map(w =>
  (w === 'sci-fi' || w === 'tv' || w === 'a24' || w === 'mgm') ? w.toUpperCase() === w ? w : ({ 'sci-fi':'Sci-Fi','tv':'TV','a24':'A24','mgm':'MGM' }[w] || w)
  : w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
const parseGenresField = g => {
  if (Array.isArray(g)) {
    return g.flatMap(x => typeof x === 'string' ? [x] : (x && x.name ? [x.name] : []));
  }
  if (typeof g === 'string') {
    try { const p = JSON.parse(g); return Array.isArray(p) ? parseGenresField(p) : [g]; }
    catch (_) { return g ? [g] : []; }
  }
  return [];
};
const score10 = v => { const n = parseFloat(v); return isFinite(n) && n > 0 ? (n <= 10 ? n : n / 10) : null; };

// ── cache (exact-key, write-only-on-valid, shared across visitors) ───────
const store = new Map();
function cacheGet(key) {
  const hit = store.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) { store.delete(key); return null; }
  hit.hitCount = (hit.hitCount || 0) + 1;
  return hit;
}
function cacheSet(key, data) {
  if (store.size > 600) { // prune oldest third
    const keys = [...store.keys()].slice(0, 200);
    for (const k of keys) store.delete(k);
  }
  store.set(key, { data, expiresAt: Date.now() + TTL_MS, fetchedAt: new Date().toISOString(), hitCount: 0 });
}

// ── normalizers: source item -> unified browse card ─────────────────────
function uniAnime(o) {
  const mal = o.mal_id != null ? parseInt(o.mal_id, 10) || null : null;
  const anilist = o.anilist_id != null ? parseInt(o.anilist_id, 10) || null : null;
  const title = o.title_english || o.title || o.title_japanese || 'Untitled';
  const img = (o.images && (o.images.jpg || o.images.webp)) || {};
  const cover = img.large_image_url || img.image_url || (img.large ? img.large : null) || null;
  const genres = [...new Set([...parseGenresField(o.genres), ...parseGenresField(o.themes), ...parseGenresField(o.demographics)])];
  const studios = parseGenresField(o.studios);
  const hasSub = o.has_sub === true || (parseInt(o.is_sub, 10) || 0) > 0 || o.is_sub === true;
  const hasDub = o.has_dub === true || (parseInt(o.is_dub, 10) || 0) > 0 || o.is_dub === true;
  let info = null;
  if (mal) info = `/info/anime/jikan-${mal}/${slugifyTitle(title)}`;
  else if (o.anikoto_id) info = `/info/anime/anikoto-${o.anikoto_id}/${slugifyTitle(title)}`;
  else if (anilist) info = `/info/anime/anilist-${anilist}/${slugifyTitle(title)}`;
  return {
    kind: 'anime', id: mal || anilist || (o.anikoto_id ? 'a' + o.anikoto_id : slugifyTitle(title)),
    mal_id: mal, anilist_id: anilist, anikoto_id: o.anikoto_id || null, tmdb_id: null,
    title, cover, banner: o.banner_image || null,
    score: score10(o.score != null ? o.score : o.score_numeric),
    type: o.type || null, status: o.status || null,
    year: parseInt(o.year, 10) || (o.aired && o.aired.from ? parseInt(String(o.aired.from).slice(0, 4), 10) : null) || null,
    season: o.season || null,
    episodes: parseInt(o.episodes, 10) || null,
    genres, studios, source: o.source || null,
    language: hasSub && hasDub ? 'sub,dub' : hasDub ? 'dub' : hasSub ? 'sub' : null,
    rating: o.rating || null, popularity: parseInt(o.members, 10) || null,
    info_url: info
  };
}
function uniAnilist(m) {
  const title = (m.title && (m.title.english || m.title.romaji || m.title.native)) || 'Untitled';
  const genres = m.genres || [];
  const studios = ((m.studios && m.studios.nodes) || []).map(s => s.name);
  const mal = m.idMal || null;
  const fmtMap = { TV:'TV', TV_SHORT:'TV Short', MOVIE:'Movie', OVA:'OVA', ONA:'ONA', SPECIAL:'Special', MUSIC:'Music' };
  const stMap = { RELEASING:'Currently Airing', FINISHED:'Finished Airing', NOT_YET_RELEASED:'Not yet aired', CANCELLED:'Cancelled', HIATUS:'On Hiatus' };
  return {
    kind: 'anime', id: mal || m.id, mal_id: mal, anilist_id: m.id || null, tmdb_id: null,
    title, cover: (m.coverImage && (m.coverImage.extraLarge || m.coverImage.large || m.coverImage.medium)) || null,
    banner: m.bannerImage || null, score: m.averageScore ? m.averageScore / 10 : null,
    type: fmtMap[m.format] || m.format || null, status: stMap[m.status] || m.status || null,
    year: m.seasonYear || (m.startDate && m.startDate.year) || null, season: m.season ? String(m.season).toLowerCase() : null,
    episodes: m.episodes || null, genres, studios,
    source: m.source ? String(m.source).toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : null,
    language: null, rating: null, popularity: m.popularity || null,
    info_url: mal ? `/info/anime/jikan-${mal}/${slugifyTitle(title)}` : `/info/anime/anilist-${m.id}/${slugifyTitle(title)}`
  };
}
function uniTmdb(r, kind, statusHint) {
  const title = r.title || r.name || 'Untitled';
  const genres = (r.genre_ids || []).map(id => TMDB_GENRE_NAME[id]).filter(Boolean);
  const date = r.release_date || r.first_air_date || '';
  const cover = r.poster_path ? `${TMDB_IMG}/w500${r.poster_path}` : null;
  return {
    kind, id: 't' + r.id, mal_id: null, anilist_id: null, tmdb_id: r.id,
    title, cover, banner: r.backdrop_path ? `${TMDB_IMG}/w780${r.backdrop_path}` : null,
    score: r.vote_average ? Math.round(r.vote_average * 10) / 10 : null,
    type: kind === 'tv' ? 'TV' : 'Movie',
    status: r.status || statusHint || null,
    year: date ? parseInt(date.slice(0, 4), 10) : null,
    season: null, episodes: r.number_of_episodes || null,
    genres, studios: [], source: null, language: null, rating: null,
    popularity: r.popularity ? Math.round(r.popularity) : null,
    info_url: kind === 'tv'
      ? `/info/tv/tmdb-tv-${r.id}/${slugifyTitle(title)}`
      : `/info/movie/tmdb-movie-${r.id}/${slugifyTitle(title)}`
  };
}

// ── post-filters (applied when a leg lacks a native param) ──────────────
function matchesUni(it, f) {
  if (f.years && f.years.length && !f.years.includes(it.year)) return false;
  if (f.season && String(it.season || '').toLowerCase() !== f.season) return false;
  if (f.extraGenres && f.extraGenres.length) {
    const names = (it.genres || []).map(g => String(g).toLowerCase().replace(/\s+/g, ' ').trim());
    if (!f.extraGenres.some(g => names.includes(g))) return false;
  }
  if (f.source && String(it.source || '').toLowerCase().replace(/\s+/g, ' ') !== SOURCE_NAME[f.source].toLowerCase()) return false;
  if (f.studioName) {
    const names = (it.studios || []).map(s => String(s).toLowerCase());
    if (!names.some(n => n.includes(f.studioName.toLowerCase()))) return false;
  }
  if (f.rating) {
    const r = String(it.rating || '').toUpperCase();
    const map = { 'g':'G', 'pg':'PG', 'pg13':'PG-13', 'r17':'R - 17', 'r17b':'R - 17', 'r_plus':'R+', 'rx':'RX' };
    if (!r.startsWith(map[f.rating] || '')) return false;
  }
  if (f.language) {
    const want = f.language.split(',');
    const have = String(it.language || '').split(',');
    if (!want.every(w => have.includes(w))) return false;
  }
  if (f.status && !statusMatches(it, f.status)) return false;
  return true;
}
// status post-filter: compare against the canonical display string
function statusMatches(it, statusKey) {
  if (!statusKey) return true;
  const want = (ANIME_STATUS[statusKey] && ANIME_STATUS[statusKey].display || '').toLowerCase();
  if (!want) return true;
  return String(it.status || '').toLowerCase() === want;
}

// ── ANIME LEGS ───────────────────────────────────────────────────────────
// each leg: { name, supports(f) -> true|'post'|false, fetch({f, page, perPage}) }
function ruriParams(f, perPage, page, profile) {
  const p = new URLSearchParams();
  p.set('page', page); p.set('limit', Math.min(perPage, 25));
  if (f.sfw && f.rating !== 'rx') p.set('sfw', 'true');
  if (f.q) p.set('q', f.q);
  if (f.genres && f.genres.length) {
    const names = f.genres.map(g => GENRE_NAME[g]).filter(Boolean);
    if (names.length) p.set('genres', names.slice(0, 6).join(','));
  }
  if (f.status && ANIME_STATUS[f.status] && ANIME_STATUS[f.status].ruri) p.set('status', ANIME_STATUS[f.status].ruri);
  if (f.type && RURI_TYPE[f.type]) p.set('type', RURI_TYPE[f.type]);
  if (f.rating && RATING[f.rating] && profile !== 's-mal') p.set('rated', RATING[f.rating].ruri); // s-mal rated ilike is slow -> post-filter instead
  if (f.language) p.set('language', f.language);
  if (f.year && !f.season) p.set('start_date', `${f.year}-01-01`); // narrow + post-filter year
  if (f.season && f.year) p.set('start_date', `${f.year}${SEASON_START[f.season] || '-01-01'}`);
  return p;
}
async function fetchRuri(profile, f, page, perPage, sortMap) {
  const p = ruriParams(f, perPage, page, profile);
  if (sortMap) { p.set('order_by', sortMap[0]); p.set('sort', sortMap[1]); }
  const j = await fetchJson(`${RURI_BASE}/${profile}/anime?${p}`, {}, 12000);
  const items = (j.data || []).map(uniAnime);
  const pg = j.pagination || {};
  return {
    items,
    rawTotal: (pg.items && pg.items.total) || items.length,
    hasNext: !!pg.has_next_page,
    lastPage: pg.last_visible_page || null
  };
}
async function fetchRuriStudio(profile, f, page, perPage, sortMap) {
  const name = STUDIO_NAME[f.studio] || titleCaseSlug(f.studio);
  const p = new URLSearchParams();
  p.set('page', page); p.set('limit', Math.min(perPage, 25));
  const j = await fetchJson(`${RURI_BASE}/${profile}/anime/studio/${encodeURIComponent(name)}?${p}`, {}, 12000);
  const items = (j.data || []).map(uniAnime);
  const pg = j.pagination || {};
  return { items, rawTotal: (pg.items && pg.items.total) || items.length, hasNext: !!pg.has_next_page, lastPage: pg.last_visible_page || null };
}
async function fetchRecentFeed(f, page, perPage) {
  const p = new URLSearchParams();
  p.set('page', page); p.set('per_page', Math.min(perPage, 100));
  const j = await fetchJson(`${RECENT_BASE}?${p}`, {}, 10000);
  const items = (j.data || []).map(uniAnime);
  const pg = j.pagination || {};
  return { items, rawTotal: pg.total || items.length, hasNext: page < (pg.total_pages || 1), lastPage: pg.total_pages || null };
}
const PROXY_SORT_CATEGORY = {
  'default':        ['popular',  null],
  'most-viewed':    ['popular',  null],
  'score':          ['top-rated', null],
  'release-date':   ['new-releases', null],
  'latest-added':   ['new-added', null],
  'name':           ['popular',  'TITLE_ROMAJI_DESC'],
  'episodes':       ['popular',  null]
};
async function fetchProxyCategory(f, page, perPage, sort) {
  const [cat, forcedSort] = PROXY_SORT_CATEGORY[sort] || PROXY_SORT_CATEGORY['default'];
  const p = new URLSearchParams();
  p.set('page', page); p.set('perPage', Math.min(perPage, 50));
  if (f.status && ANIME_STATUS[f.status]) p.set('status', ANIME_STATUS[f.status].anilist);
  if (f.type && ANILIST_FORMAT[f.type]) p.set('format', ANILIST_FORMAT[f.type]);
  if (f.year) p.set('year', f.year);
  if (f.genres && f.genres.length) {
    const al = f.genres.map(g => GENRE_NAME[g]).filter(n => ANILIST_GENRES.has(n));
    if (al.length) p.set('genre', al[0]); // categories accept a single genre
  }
  if (forcedSort) p.set('sort', forcedSort);
  const j = await fetchJson(`${PROXY_BASE}/api/${cat}?${p}`, {}, 12000);
  const items = (Array.isArray(j.data) ? j.data : ((j.data && j.data.Page && j.data.Page.media) || [])).map(uniAnilist);
  const info = j.pagination || (j.data && j.data.Page && j.data.Page.pageInfo) || {};
  return { items, rawTotal: info.total || items.length, hasNext: !!info.hasNextPage, lastPage: info.lastPage || null, totalBogus: (info.total || 0) >= ANILIST_TOTAL_CAP };
}
async function fetchProxySeason(f, page, perPage, sort) {
  const p = new URLSearchParams();
  p.set('page', page); p.set('perPage', Math.min(perPage, 50));
  if (f.q) p.set('search', f.q);
  if (f.genres && f.genres.length) {
    const g = [], t = [];
    for (const slug of f.genres) {
      const name = GENRE_NAME[slug];
      if (!name) continue;
      (ANILIST_GENRES.has(name) ? g : t).push(name);
    }
    if (g.length) p.set('genres', g.join(','));
    if (t.length) p.set('tags', t.join(','));
  }
  if (f.type && ANILIST_FORMAT[f.type]) p.set('format_in', ANILIST_FORMAT[f.type]);
  if (f.status && ANIME_STATUS[f.status]) p.set('status_in', ANIME_STATUS[f.status].anilist);
  if (f.country) p.set('country', COUNTRY_ISO[f.country] || '');
  // t133 FIX: the proxy parses `genre`/`genres` (genreVars) — it does NOT read
  // `genre_in` despite its doc comment, so the old param was silently dropped
  // and the season leg served unfiltered-by-genre pages with inflated totals.
  if (sort && sort !== 'default') {
    const map = { 'score':'SCORE_DESC','most-viewed':'POPULARITY_DESC','release-date':'START_DATE_DESC','name':'TITLE_ROMAJI','latest-added':'ID_DESC','latest-updated':'UPDATED_AT_DESC','episodes':'EPISODES_DESC' };
    if (map[sort]) p.set('sort', map[sort]);
  }
  const j = await fetchJson(`${PROXY_BASE}/api/season/${f.season}/${f.year}?${p}`, {}, 12000);
  const page_ = (j.data && j.data.Page) || {};
  const items = (page_.media || []).map(uniAnilist);
  const info = page_.pageInfo || {};
  return { items, rawTotal: info.total || items.length, hasNext: !!info.hasNextPage, lastPage: info.lastPage || null, totalBogus: (info.total || 0) >= ANILIST_TOTAL_CAP };
}
async function fetchProxySearch(f, page, perPage) {
  const p = new URLSearchParams();
  p.set('q', f.q); p.set('page', page); p.set('perPage', Math.min(perPage, 50));
  const j = await fetchJson(`${PROXY_BASE}/api/search/anime?${p}`, {}, 12000);
  const items = (Array.isArray(j.data) ? j.data : ((j.data && j.data.Page && j.data.Page.media) || [])).map(uniAnilist);
  const info = j.pagination || (j.data && j.data.Page && j.data.Page.pageInfo) || {};
  return { items, rawTotal: info.total || items.length, hasNext: !!info.hasNextPage, lastPage: info.lastPage || null, totalBogus: (info.total || 0) >= ANILIST_TOTAL_CAP };
}
async function fetchProxyStudio(f, page, perPage, sort) {
  const name = STUDIO_NAME[f.studio] || titleCaseSlug(f.studio);
  const p = new URLSearchParams();
  p.set('page', page); p.set('perPage', Math.min(perPage, 50));
  if (sort === 'score') p.set('sort', 'SCORE_DESC');
  if (sort === 'most-viewed') p.set('sort', 'POPULARITY_DESC');
  if (sort === 'release-date') p.set('sort', 'START_DATE_DESC');
  if (sort === 'latest-added') p.set('sort', 'ID_DESC');
  const j = await fetchJson(`${PROXY_BASE}/api/studio/${encodeURIComponent(name)}?${p}`, {}, 12000);
  const st = j.data && j.data.Studio ? j.data.Studio.media : null;
  const edges = (st && (st.edges || st.media)) || [];
  const items = edges.map(e => uniAnilist(e.node || e)).filter(Boolean);
  const info = (st && st.pageInfo) || {};
  return { items, rawTotal: info.total || items.length, hasNext: !!info.hasNextPage, lastPage: info.lastPage || null, totalBogus: (info.total || 0) >= ANILIST_TOTAL_CAP };
}
const SCRAPER_ORDER = { 'default':'score','score':'score','most-viewed':'popularity','release-date':'start_date','name':'title','latest-added':'start_date' };
async function fetchScraper(f, page, perPage, sort) {
  const p = new URLSearchParams();
  p.set('page', page); p.set('limit', Math.min(perPage, 25));
  if (f.type && ANILIST_FORMAT[f.type]) p.set('type', ANILIST_FORMAT[f.type]);
  if (f.genres && f.genres.length) {
    const names = f.genres.map(g => GENRE_NAME[g]).filter(Boolean);
    if (names.length) p.set('genres', names.slice(0, 6).join(','));
  }
  const ob = SCRAPER_ORDER[sort] || 'score';
  p.set('order_by', ob);
  p.set('sort', ob === 'title' ? 'asc' : 'desc');
  if (f.sfw && f.rating !== 'rx') p.set('sfw', 'true');
  const j = await fetchJson(`${SCRAPER_BASE}/v4/anime?${p}`, {}, 12000);
  const items = (j.data || []).map(uniAnime);
  const pg = j.pagination || {};
  return { items, rawTotal: (pg.items && pg.items.total) || items.length, hasNext: !!pg.has_next_page, lastPage: pg.last_visible_page || null };
}
async function fetchScraperSeason(f, page, perPage, sort) {
  const p = new URLSearchParams();
  p.set('page', page); p.set('limit', Math.min(perPage, 25));
  const ob = SCRAPER_ORDER[sort] || 'score';
  p.set('order_by', ob); p.set('sort', ob === 'title' ? 'asc' : 'desc');
  if (f.sfw && f.rating !== 'rx') p.set('sfw', 'true');
  // t133 FIX: the scraper supports native type/genres on seasons — apply them
  // upstream so this leg only walks when a true post-filter remains
  if (f.type && ANILIST_FORMAT[f.type]) p.set('type', ANILIST_FORMAT[f.type]);
  if (f.genres && f.genres.length) {
    const names = f.genres.map(g => GENRE_NAME[g]).filter(Boolean);
    if (names.length) p.set('genres', names.slice(0, 6).join(','));
  }
  const j = await fetchJson(`${SCRAPER_BASE}/v4/seasons/${f.year}/${f.season}?${p}`, {}, 12000);
  const items = (j.data || []).map(uniAnime);
  const pg = j.pagination || {};
  return { items, rawTotal: (pg.items && pg.items.total) || items.length, hasNext: !!pg.has_next_page, lastPage: pg.last_visible_page || null };
}
async function fetchScraperStudio(f, page, perPage, sort) {
  const name = STUDIO_NAME[f.studio] || titleCaseSlug(f.studio);
  const p = new URLSearchParams();
  p.set('page', page); p.set('limit', Math.min(perPage, 25));
  const j = await fetchJson(`${SCRAPER_BASE}/v4/studios/${encodeURIComponent(name)}?${p}`, {}, 12000);
  const items = (j.data || []).map(uniAnime);
  const pg = j.pagination || {};
  return { items, rawTotal: (pg.items && pg.items.total) || items.length, hasNext: !!pg.has_next_page, lastPage: pg.last_visible_page || null };
}
const JIKAN_ORDER = { 'default':'score','score':'score','most-viewed':'members','release-date':'start_date','name':'title','episodes':'episodes','latest-added':'mal_id' };
async function fetchJikan(f, page, perPage, sort) {
  const p = new URLSearchParams();
  p.set('page', page); p.set('limit', Math.min(perPage, 25));
  p.set('sfw', 'true');
  if (f.q) p.set('q', f.q);
  if (f.genres && f.genres.length) {
    const ids = f.genres.map(g => JIKAN_GENRE_ID[g]).filter(Boolean);
    if (ids.length) p.set('genres', ids.join(','));
  }
  if (f.status && ANIME_STATUS[f.status] && ANIME_STATUS[f.status].jikan) p.set('status', ANIME_STATUS[f.status].jikan);
  if (f.type && JIKAN_TYPE[f.type]) p.set('type', JIKAN_TYPE[f.type]);
  if (f.rating && RATING[f.rating] && RATING[f.rating].jikan) p.set('rating', RATING[f.rating].jikan);
  const ob = JIKAN_ORDER[sort] || 'score';
  p.set('order_by', ob);
  p.set('sort', (ob === 'title' || ob === 'mal_id' ? (ob === 'mal_id' ? 'desc' : 'asc') : 'desc'));
  const j = await fetchJson(`${JIKAN_BASE}/anime?${p}`, {}, 30000);
  const items = (j.data || []).map(uniAnime);
  const pg = j.pagination || {};
  return { items, rawTotal: (pg.items && pg.items.total) || items.length, hasNext: !!pg.has_next_page, lastPage: pg.last_visible_page || null };
}
async function fetchJikanSeason(f, page, perPage, sort) {
  const j = await fetchJson(`${JIKAN_BASE}/seasons/${f.year}/${f.season}?page=${page}&sfw=true`, {}, 30000);
  const items = (j.data || []).map(uniAnime);
  const pg = j.pagination || {};
  return { items, rawTotal: (pg.items && pg.items.total) || items.length, hasNext: !!pg.has_next_page, lastPage: pg.last_visible_page || null };
}

// ── TMDB LEGS (t-umi passthrough, both CF accounts) ─────────────────────
const TMDB_SORT = {
  'default':       { tv:'popularity.desc', movie:'popularity.desc' },
  'most-viewed':   { tv:'popularity.desc', movie:'popularity.desc' },
  'score':         { tv:'vote_average.desc', movie:'vote_average.desc' },
  'name':          { tv:'name.asc', movie:'title.asc' },
  'release-date':  { tv:'first_air_date.desc', movie:'primary_release_date.desc' },
  'latest-added':  { tv:'first_air_date.desc', movie:'primary_release_date.desc' },
  'episodes':      { tv:'vote_count.desc', movie:'vote_count.desc' }
};
function tmdbKindSplit(f) {
  // returns ['tv'], ['movie'] or ['tv','movie'] for this tmdb sub-query
  if (f.type === 'series' || f.type === 'tv' || f.type === 'drama') return ['tv'];
  if (f.type === 'movie') return ['movie'];
  if (f.type && RURI_TYPE[f.type] !== undefined && !['tv','movie'].includes(f.type)) return []; // anime-only types
  if (f.tvStatus) return ['tv'];
  if (f.movieStatus) return ['movie'];
  return ['tv', 'movie'];
}
async function fetchTmdb(base, f, page, perPage, kind, sort, warnings) {
  const p = new URLSearchParams();
  p.set('page', page);
  p.set('include_adult', 'false');
  let statusHint = null;
  if (f.q) {
    p.set('query', f.q);
    if (f.year) { // search has no year filter — hint via year cannot apply; post-filter instead
    }
    const j = await fetchJson(`${base}/search/${kind}?${p}`, {}, 12000);
    let results = j.results || [];
    if (f.year) results = results.filter(r => (r.release_date || r.first_air_date || '').startsWith(String(f.year)));
    if (f.genres && f.genres.length) {
      const ids = f.genres.map(g => (kind === 'tv' ? TMDB_TV_GENRE[g] : TMDB_MOVIE_GENRE[g])).filter(Boolean);
      if (ids.length) results = results.filter(r => (r.genre_ids || []).some(id => ids.includes(id)));
      else results = [];
    }
    return { items: results.slice(0, perPage).map(r => uniTmdb(r, kind, statusHint)), rawTotal: j.total_results || results.length, hasNext: !!j.has_next_page, lastPage: j.total_pages || null, approx: true };
  }
  // discover
  if (f.genres && f.genres.length) {
    const ids = [...new Set(f.genres.map(g => (kind === 'tv' ? TMDB_TV_GENRE[g] : TMDB_MOVIE_GENRE[g])).filter(Boolean))];
    if (!ids.length) return { items: [], rawTotal: 0, hasNext: false, lastPage: 0, legitEmpty: true };
    p.set('with_genres', ids.join('|')); // OR semantics
  }
  if (f.country) p.set('with_origin_country', COUNTRY_ISO[f.country] || '');
  if (f.studio && f.studioName) {
    const known = TMDB_COMPANY_ID[f.studio];
    const companyId = known || await resolveCompanyId(base, f.studio, f.studioName);
    if (!companyId) return { items: [], rawTotal: 0, hasNext: false, lastPage: 0, legitEmpty: true };
    p.set('with_companies', String(companyId));
  }
  if (f.year) { if (kind === 'tv') p.set('first_air_date_year', f.year); else p.set('primary_release_year', f.year); }
  if (f.tvStatus && kind === 'tv') { p.set('with_status', String(TV_STATUS[f.tvStatus].tmdb)); statusHint = TV_STATUS[f.tvStatus].display; }
  if (f.movieStatus && kind === 'movie') {
    const today = new Date().toISOString().slice(0, 10);
    if (f.movieStatus === 'released') { p.set('primary_release_date.lte', today); p.set('vote_count.gte', '5'); statusHint = 'Released'; }
    else if (f.movieStatus === 'future-release') { p.set('primary_release_date.gte', today); statusHint = 'Upcoming'; }
    else if (MOVIE_STATUS[f.movieStatus] && MOVIE_STATUS[f.movieStatus].mode === 'future') { p.set('primary_release_date.gte', today); statusHint = MOVIE_STATUS[f.movieStatus].display; }
    // 'rumored' -> no filter (warning added by planner)
  }
  const sb = TMDB_SORT[sort] || TMDB_SORT['default'];
  p.set('sort_by', sb[kind] || 'popularity.desc');
  if (sort === 'score') p.set('vote_count.gte', '300');
  const j = await fetchJson(`${base}/discover/${kind}?${p}`, {}, 12000);
  const items = (j.results || []).map(r => uniTmdb(r, kind, statusHint));
  return { items, rawTotal: j.total_results || items.length, hasNext: !!j.has_next_page, lastPage: j.total_pages || null };
}
// resolve arbitrary TMDB studio/company slugs (from info-page links) to
// company ids via TMDB /search/company, cached for the process lifetime
const COMPANY_ID_CACHE = new Map();
async function resolveCompanyId(base, slug, name) {
  const key = String(slug || name || '').toLowerCase();
  if (COMPANY_ID_CACHE.has(key)) return COMPANY_ID_CACHE.get(key);
  try {
    const j = await fetchJson(`${base}/search/company?query=${encodeURIComponent(name || titleCaseSlug(slug))}`, {}, 10000);
    const id = (j.results && j.results[0] && j.results[0].id) || null;
    COMPANY_ID_CACHE.set(key, id);
    return id;
  } catch (e) {
    COMPANY_ID_CACHE.set(key, null);
    return null;
  }
}
async function fetchMappleHidden(f, page, perPage, kind) {
  const j = await fetchJson(`${MAPPLE_BASE}/api/hidden-gems/${kind === 'tv' ? 'tv' : 'movies'}?page=${page}`, {}, 40000);
  const items = (j.results || []).map(r => uniTmdb(r, kind, null));
  return { items: items.slice(0, perPage), rawTotal: j.total_results || items.length, hasNext: !!j.has_next_page, lastPage: j.total_pages || null };
}

// ── planner: order the legs for this exact query ─────────────────────────
// post-filter objects are FLAT: { years, season, status, source, rating,
// language, extraGenres, studioName } — consumed by matchesUni().
function mkPost(f, opts = {}) {
  const post = {};
  const statusNative = f.status && ANIME_STATUS[f.status] && ANIME_STATUS[f.status].ruri; // ruri supports the 3 basic statuses natively
  if (f.year) post.years = [f.year];
  if (f.season && !opts.noSeason) post.season = f.season;   // noSeason: the leg already scopes by season natively
  const st = opts.status !== undefined ? opts.status : f.status;
  if (st && !(opts.nativeStatus && statusNative)) post.status = st;
  if (f.source) post.source = f.source;
  if (f.rating) post.rating = f.rating;
  if (f.language) post.language = f.language;
  if (opts.nativeGenres) {
    // leg filters genres natively — no genre post-filter needed
  } else if (opts.extraGenres !== undefined) {
    if (opts.extraGenres && opts.extraGenres.length) post.extraGenres = opts.extraGenres;
  } else if (f.genres && f.genres.length) {
    // for legs whose native genre match is substring-loose, tighten with exact names
    const exact = f.genres.map(g => GENRE_NAME[g]).filter(Boolean).map(n => n.toLowerCase());
    if (exact.length) post.extraGenres = exact;
  }
  if (opts.studioName) post.studioName = opts.studioName;
  return post;
}
const genreNamesLower = f => (f.genres || []).map(g => GENRE_NAME[g]).filter(Boolean).map(n => n.toLowerCase());

function buildAnimePlan(f, sort, warnings) {
  const RURI_SORTS = {
    'default':['score','desc'], 'score':['score','desc'], 'most-viewed':['members','desc'],
    'release-date':['start_date','desc'], 'name':['title','asc'], 'episodes':['episodes','desc'],
    'latest-added':['mal_id','desc']
  };
  const plan = [];
  const languageRestricted = !!f.language;
  // Series / Drama are TMDB-only types — the anime side must not serve
  // unfiltered results for them
  if (f.type === 'series' || f.type === 'drama') return [];

  if (f.studio) {
    plan.push({ name:'ruri-s-mal:studio', call:(p,pp)=>fetchRuriStudio('s-mal', f, p, pp), post:mkPost(f) });
    plan.push({ name:'anilist-proxy:studio', call:(p,pp)=>fetchProxyStudio(f, p, pp, sort), post:mkPost(f, { extraGenres:genreNamesLower(f) }) });
    plan.push({ name:'anilist-scraper:studio', call:(p,pp)=>fetchScraperStudio(f, p, pp, sort), post:mkPost(f, { extraGenres:genreNamesLower(f) }) });
    if (f.language) {
      plan.length = 0;
      plan.push({ name:'ruri-s-mal:studio', call:(p,pp)=>fetchRuriStudio('s-mal', f, p, pp), post:mkPost(f) });
      plan.push({ name:'ruri-anikoto:studio', call:(p,pp)=>fetchRuriStudio('anikoto', f, p, pp), post:mkPost(f) });
      warnings.push('Language filter restricts this query to ruri sources.');
    }
    return plan;
  }
  if ((sort === 'latest-updated' || sort === 'latest-added') && !f.q) {
    if (!f.genres || !f.genres.length) {
      plan.push({ name:'anikoto-recent', call:(p,pp)=>fetchRecentFeed(f, p, pp), post:mkPost(f, { noSeason:true }) });
    }
    if (sort === 'latest-added' && f.season && f.year) {
      plan.push({ name:'anilist-proxy:season', call:(p,pp)=>fetchProxySeason(f, p, pp, 'latest-added'), post:mkPost(f, { extraGenres:[] }) });
    } else if (sort === 'latest-added') {
      plan.push({ name:'anilist-proxy:new-added', call:(p,pp)=>fetchProxyCategory(f, p, pp, 'latest-added'), post:mkPost(f, { extraGenres:genreNamesLower(f), years:null }) });
    }
    if (sort === 'latest-updated') warnings.push('Sorted by recently updated (anikoto feed); fallback approximates with newest releases.');
    plan.push({ name:'anilist-proxy:new-releases', call:(p,pp)=>fetchProxyCategory(f, p, pp, 'release-date'), post:mkPost(f, { extraGenres:genreNamesLower(f) }) });
    plan.push({ name:'ruri-s-mal', call:(p,pp)=>fetchRuri('s-mal', f, p, pp, RURI_SORTS['release-date']), post:mkPost(f, { nativeGenres:true, nativeStatus:true }) });
    if (languageRestricted) return plan.filter(x => x.name.startsWith('ruri') || x.name === 'anikoto-recent');
    return plan;
  }
  if (f.season && f.year) {
    // proxy/scraper/jikan all scope by season+year natively (noSeason) — only
    // ruri lacks a season param and needs the post-filter walk
    plan.push({ name:'anilist-proxy:season', call:(p,pp)=>fetchProxySeason(f, p, pp, sort), post:mkPost(f, { extraGenres:[], noSeason:true }) });
    plan.push({ name:'ruri-s-mal', call:(p,pp)=>fetchRuri('s-mal', f, p, pp, RURI_SORTS[sort] || RURI_SORTS['default']), post:mkPost(f, { nativeGenres:true, nativeStatus:true }) });
    plan.push({ name:'anilist-scraper:season', call:(p,pp)=>fetchScraperSeason(f, p, pp, sort), post:mkPost(f, { extraGenres:genreNamesLower(f), noSeason:true }) });
    plan.push({ name:'jikan:season', call:(p,pp)=>fetchJikanSeason(f, p, pp, sort), post:mkPost(f, { extraGenres:genreNamesLower(f), noSeason:true }) });
    if (languageRestricted) return plan.filter(x => x.name.startsWith('ruri'));
    return plan;
  }
  // default listing chain (owner spec order): ruri s-mal -> ruri anikoto -> proxy -> scraper -> jikan
  const ruriSort = RURI_SORTS[sort] || RURI_SORTS['default'];
  if ((sort === 'latest-updated' || sort === 'latest-added') && f.q) warnings.push('Search results are relevance-ranked; recency sort applies where sources support it.');
  // tv-short only exists on AniList — route there first for that type
  if (f.type === 'tv-short') {
    plan.push(f.q
      ? { name:'anilist-proxy:search', call:(p,pp)=>fetchProxySearch(f, p, pp), post:mkPost(f, { extraGenres:genreNamesLower(f), years:f.year?[f.year]:null }) }
      : { name:'anilist-proxy:category', call:(p,pp)=>fetchProxyCategory(f, p, pp, sort), post:mkPost(f, { extraGenres:genreNamesLower(f) }) });
    plan.push({ name:'anilist-scraper', call:(p,pp)=>fetchScraper(f, p, pp, sort), post:mkPost(f, { extraGenres:genreNamesLower(f) }) });
    warnings.push('TV Short type is served by AniList sources.');
    if (languageRestricted) return [];
    return plan;
  }
  // capability gates: anikoto rows carry rating+language but NO source;
  // AniList/scraper carry source but NO MAL rating; only ruri s-mal has all.
  const legs = [
    { name:'ruri-s-mal', call:(p,pp)=>fetchRuri('s-mal', f, p, pp, ruriSort), post:mkPost(f, { nativeGenres:true, nativeStatus:true }) },
    { name:'ruri-anikoto', call:(p,pp)=>fetchRuri('anikoto', f, p, pp, ruriSort), post:mkPost(f, { nativeGenres:true, nativeStatus:true }) },
    { name:'anilist-proxy:search', call:(p,pp)=>fetchProxySearch(f, p, pp), post:mkPost(f, { extraGenres:genreNamesLower(f), years:f.year?[f.year]:null }) },
    { name:'anilist-proxy:category', call:(p,pp)=>fetchProxyCategory(f, p, pp, sort), post:mkPost(f, { extraGenres:genreNamesLower(f) }) },
    { name:'anilist-scraper', call:(p,pp)=>fetchScraper(f, p, pp, sort), post:mkPost(f, { extraGenres:genreNamesLower(f) }) },
    { name:'jikan', call:(p,pp)=>fetchJikan(f, p, pp, sort), post:mkPost(f, { extraGenres:genreNamesLower(f) }) }
  ];
  const has = k => !!f[k];
  const ok = L => {
    if (L.name === 'ruri-anikoto' && has('source')) return false;                 // no source data
    if (L.name === 'anikoto-recent' && (has('source') || has('rating'))) return false;
    if ((L.name.startsWith('anilist') || L.name === 'anilist-scraper') && has('rating')) return false; // no MAL rating
    return true;
  };
  for (const L of legs) {
    if (L.name === 'anilist-proxy:search' && !f.q) continue;
    if (L.name === 'anilist-proxy:category' && f.q) continue;
    if (languageRestricted && !L.name.startsWith('ruri')) continue;
    if (ok(L)) plan.push(L);
  }
  // rating-only queries: anikoto matches rated natively and fast -> try it first
  if (has('rating') && !has('source')) {
    const ai = plan.findIndex(L => L.name === 'ruri-anikoto');
    if (ai > 0) { const [L] = plan.splice(ai, 1); plan.unshift(L); }
  }
  if (!plan.length) warnings.push('The selected filter combination is only served by ruri sources, which are currently unavailable.');
  return plan;
}

function buildTmdbPlan(f, sort, warnings) {
  const plan = [];
  const kinds = tmdbKindSplit(f);
  const bases = [TUMI_PRIMARY, TUMI_BACKUP];
  if (f.studio && STUDIO_NAME[f.studio]) {
    // an ANIME studio was requested — TMDB has no equivalent; empty is the
    // honest answer (unfiltered results would mislead)
    warnings.push('Anime studio selected — no TMDB equivalent.');
    return plan;
  }
  if (f.hidden) {
    for (const kind of (kinds.length ? kinds : ['tv','movie'])) {
      plan.push({ name:`mapple:hidden-${kind}`, kind, call:(p,pp)=>fetchMappleHidden(f, p, pp, kind), post:{} });
    }
    return plan;
  }
  bases.forEach((base, i) => {
    for (const kind of (kinds.length ? kinds : ['tv','movie'])) {
      plan.push({
        name:`t-umi${i === 0 ? '' : ':zeraf'}:${kind}`,
        kind,
        call:(p, pp)=>fetchTmdb(base, f, p, pp, kind, sort, warnings),
        post:{}
      });
    }
  });
  if (f.rating || f.language || f.source || f.season) warnings.push('Rating/Language/Source/Season filters only apply to anime; ignored for TMDB results.');
  return plan;
}

// ── runner: fetch a browse page from the first leg that can fill it ──────
// t133 PAGINATION FIX — the old runner guessed a source window, took the
// FIRST perPage passing items and reported the source's own lastPage as the
// page count. That produced: pagination claiming 200 pages for a 3-page
// result, duplicated/missing cards between consecutive pages (perPage >
// source page size windows overlapped), and dead pages once the guessed
// window slid past the data. Now:
//   native legs  — fetch exactly the source pages covering the raw range
//                  [ (page-1)*perPage .. page*perPage ) and SLICE at the
//                  absolute offset: no duplicates, no gaps, true totals.
//   walked legs  — same window widened by the observed pass-rate (remembered
//                  per filter-signature), overlap-trimmed against the page
//                  served immediately before; totals stay estimates but are
//                  stable, capped by the source total, and NEVER taken from
//                  the source's own last_visible_page.
const WALK_STATS = new Map();   // sig+leg -> walk memory (rate + window cursor)
const WALK_STATS_TTL = 30 * 60 * 1000;
const LAST_SERVED = new Map();  // filter sig -> { page, ids[] } of the most recent page served (ANY leg) — used to trim cross-leg overlap
const STICKY_LEG = new Map();   // filter sig -> leg name that served the last page — keeps consecutive pages on ONE source (stable order, no cross-leg dupes)
function filterSig(f) {
  return JSON.stringify([f.media, f.q, f.genres, f.country, f.type, f.status, f.season, f.year,
    f.language, f.rating, f.source, f.studio, f.sort, f.hidden]);
}
function walkSig(f, legName) { return filterSig(f) + '|' + legName; }
function walkStatsFor(sig) {
  const hit = WALK_STATS.get(sig);
  if (hit && hit.at > Date.now() - WALK_STATS_TTL) return hit;
  if (hit) WALK_STATS.delete(sig);
  const fresh = { scanned: 0, passed: 0, rate: 1, cursorPage: 0, cursorIds: null, nextRawPage: 1, at: Date.now() };
  WALK_STATS.set(sig, fresh);
  if (WALK_STATS.size > 300) WALK_STATS.delete(WALK_STATS.keys().next().value);
  return fresh;
}
const clampNum = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const itemKey = it => String(it.id) + '|' + (it.title || '');
// cross-source overlap key: ids differ between sources (mal vs anilist vs tmdb),
// titles are the stable join — used ONLY for the cross-leg page trim
const fuzzyKey = it => String(it.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');

async function runPlan(plan, f, page, perPage, warnings, sigNs = '') {
  const errors = [];
  // t133: leg stickiness — consecutive pages of the same filter set continue on
  // the SAME source whenever it can still fill the page (stable ordering, no
  // duplicated cards at leg-switch boundaries)
  const fSig = filterSig(f) + (sigNs ? '|' + sigNs : '');
  const sticky = STICKY_LEG.get(fSig) || null;
  let ordered = plan;
  if (sticky) {
    const i = plan.findIndex(L => L.name === sticky);
    if (i > 0) ordered = [plan[i], ...plan.slice(0, i), ...plan.slice(i + 1)];
  }
  for (const leg of ordered) {
    const post = Object.assign({}, leg.post || {});
    if (f.studio && leg.name.includes('ruri') === false && leg.name.includes('studio') === false) post.studioName = null;
    const S = leg.name.startsWith('t-umi') ? 20 : 25;   // source page size
    const offset = (page - 1) * perPage;                 // 0-based first item this page must show
    try {
      const needsWalk = Object.values(post).some(v => v != null && (!(Array.isArray(v)) || v.length));
      const st = needsWalk ? walkStatsFor(walkSig(f, leg.name)) : null;

      // ── plan the source window ──
      let startPage, endPage;
      if (!needsWalk) {
        startPage = Math.floor(offset / S) + 1;
        endPage = Math.ceil(page * perPage / S);
      } else {
        const rate = clampNum(st.rate, 0.2, 1);
        const rawFrom = Math.floor(offset / rate);
        const rawTo = Math.ceil(page * perPage / rate);
        startPage = Math.floor(rawFrom / S) + 1;
        endPage = Math.ceil(rawTo / S);
        if (page === st.cursorPage + 1 && st.nextRawPage > startPage) startPage = st.nextRawPage; // sequential: continue where the last page stopped
        if (endPage - startPage + 1 > MAX_SOURCE_PAGES) startPage = endPage - MAX_SOURCE_PAGES + 1; // keep the right edge
        startPage = Math.max(1, startPage);
      }
      if (endPage < startPage) endPage = startPage;
      const hardEnd = needsWalk ? startPage + MAX_SOURCE_PAGES - 1 : endPage;

      // ── fetch the window (batches of 3, walk may extend while underfull) ──
      let collected = [];
      let rawTotal = 0, hasNext = false, lastPage = null, approx = false, sourceExhausted = false, totalBogus = false;
      let p = startPage;
      while (p <= Math.min(endPage, hardEnd)) {
        const batchEnd = Math.min(p + 2, endPage, hardEnd);
        const batch = [];
        for (let q = p; q <= batchEnd; q++) batch.push(leg.call(q, S));
        const rs = await Promise.all(batch);
        for (const r of rs) {
          collected.push(...r.items);
          rawTotal = Math.max(rawTotal, r.rawTotal || 0);
          hasNext = r.hasNext;
          lastPage = r.lastPage || lastPage;
          approx = approx || r.approx;
          totalBogus = totalBogus || !!r.totalBogus;
          if (r.items.length < S || !r.hasNext) sourceExhausted = true;
        }
        p = batchEnd + 1;
        if (needsWalk) {
          if (sourceExhausted) break;
          const passedSoFar = collected.reduce((n, it) => n + (matchesUni(it, post) ? 1 : 0), 0);
          if (passedSoFar >= perPage) break;               // enough to fill this page
          endPage = Math.min(endPage + 3, hardEnd);        // extend while the window underfills
        }
      }

      // ── shape the page ──
      let items, total, outHasNext;
      if (!needsWalk) {
        const sliceFrom = Math.max(0, offset - (startPage - 1) * S);
        items = collected.slice(sliceFrom, sliceFrom + perPage);
        if (totalBogus && rawTotal >= ANILIST_TOTAL_CAP) {
          // AniList's total is a display cap (real pages run dry much earlier) —
          // only claim what is proven plus one lookahead page
          total = offset + items.length + (hasNext ? perPage : 0);
          outHasNext = hasNext;
        } else {
          total = rawTotal || (offset + items.length);
          outHasNext = offset + items.length < total;
        }
      } else {
        const passed = collected.filter(it => matchesUni(it, post));
        // trim overlap with the most recently served page of this filter set,
        // whichever leg served it (sequential browsing) — fuzzy title key so
        // cross-source repeats (mal vs anilist vs tmdb ids) are caught too
        let pool = passed;
        const lastServed = LAST_SERVED.get(fSig);
        if (page === (lastServed && lastServed.page) + 1 && Array.isArray(lastServed.ids) && lastServed.ids.length) {
          const seenIds = new Set(lastServed.ids);
          pool = passed.filter(it => !seenIds.has(fuzzyKey(it)));
        }
        // dedupe within the request, then take the page
        const seen = new Set();
        items = [];
        for (const it of pool) {
          const k = itemKey(it);
          if (seen.has(k)) continue;
          seen.add(k);
          items.push(it);
          if (items.length >= perPage) break;
        }
        // cumulative pass-rate memory (kept across pages of the same filter set)
        st.scanned += collected.length;
        st.passed += passed.length;
        st.rate = st.scanned ? clampNum(st.passed / st.scanned, 0.05, 1) : 1;
        st.nextRawPage = Math.min(p, hardEnd + 1);
        st.at = Date.now();
        approx = true;
        if (sourceExhausted) {
          total = offset + items.length;                   // exact: nothing left upstream
          outHasNext = false;
        } else {
          let est = rawTotal ? Math.round(rawTotal * st.rate) : 0;
          if (totalBogus) est = Math.min(est, offset + items.length + (hasNext ? perPage : 0)); // AniList 5000-cap guard
          total = clampNum(Math.max(est, offset + items.length), 0, rawTotal || est || (offset + items.length));
          outHasNext = hasNext && items.length > 0 && offset + items.length < total;
        }
      }

      if (items.length || rawTotal === 0) {
        // remember this page for cross-leg trimming + leg stickiness
        LAST_SERVED.set(fSig, { page, ids: items.map(fuzzyKey), at: Date.now() });
        if (LAST_SERVED.size > 300) LAST_SERVED.delete(LAST_SERVED.keys().next().value);
        STICKY_LEG.set(fSig, leg.name);
        if (STICKY_LEG.size > 300) STICKY_LEG.delete(STICKY_LEG.keys().next().value);
        return {
          items,
          total,
          hasNext: outHasNext,
          lastPage: lastPage,
          source: leg.name,
          approx: approx || needsWalk,
          moreLegs: ordered.indexOf(leg) < ordered.length - 1
        };
      }
      // empty result from a healthy leg — try the next leg in case this one
      // is missing the data (owner rule: empty never wins over a good copy)
      errors.push(`${leg.name}: empty`);
      console.error(`[browse] leg empty: ${leg.name} (rawTotal=${rawTotal}, window=${startPage}..${endPage})`);
      if (sticky === leg.name) STICKY_LEG.delete(fSig);  // exhausted stickiness — free the ordering
      if (leg.legitEmpty) break;
    } catch (e) {
      errors.push(`${leg.name}: ${e.message}`);
      console.error(`[browse] leg failed: ${leg.name}: ${e.message}`);
    }
  }
  console.error(`[browse] all legs failed: ${errors.join(' ; ')}`);
  return { items: [], total: 0, hasNext: false, lastPage: null, source: null, errors, approx: false };
}

// ── mixed (All) runner: anime 2/3 + tmdb 1/3, interleaved 2:1 ────────────
async function runMixed(animePlan, tmdbPlan, f, page, perPage, warnings) {
  const anN = Math.ceil(perPage * 2 / 3);
  const tmN = Math.max(perPage - anN, 1);
  const [an, tm] = await Promise.all([
    runPlan(animePlan, f, page, anN, warnings, 'anime'),
    runPlan(tmdbPlan, f, page, tmN, warnings, 'tmdb')
  ]);
  // interleave 2 anime : 1 tmdb
  const items = [];
  let a = 0, t = 0;
  while (items.length < perPage && (a < an.items.length || t < tm.items.length)) {
    for (let k = 0; k < 2 && a < an.items.length && items.length < perPage; k++) items.push(an.items[a++]);
    if (t < tm.items.length && items.length < perPage) items.push(tm.items[t++]);
    if (a >= an.items.length && t >= tm.items.length) break;
  }
  const total = (an.total || 0) + (tm.total || 0);
  const anLP = an.lastPage || Math.ceil((an.total || 0) / anN);
  const tmLP = tm.lastPage || Math.ceil((tm.total || 0) / tmN);
  return {
    items, total,
    lastPage: Math.max(anLP || 1, tmLP || 1) || null,
    hasNext: an.hasNext || tm.hasNext,
    moreLegs: an.moreLegs || tm.moreLegs,
    source: `mixed[anime:${an.source || 'failed'} + tmdb:${tm.source || 'failed'}]`,
    errors: [...(an.errors || []), ...(tm.errors || [])],
    approx: an.approx || tm.approx
  };
}

// ── request parsing ──────────────────────────────────────────────────────
function parseParams(q) {
  const currentYear = new Date().getFullYear();
  const f = { warnings: [] };
  const media = (q.get('media') || 'all').toLowerCase();
  f.media = ['all', 'anime', 'tmdb'].includes(media) ? media : 'all';
  f.q = (q.get('q') || '').trim().slice(0, 120);
  f.genres = (q.get('genres') || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean).slice(0, 6);
  f.country = (q.get('country') || '').trim().toLowerCase();
  f.type = (q.get('type') || '').trim().toLowerCase();
  if (f.country && !COUNTRY_ISO[f.country]) f.country = '';
  f.status = (q.get('status') || '').trim().toLowerCase();
  f.season = (q.get('season') || '').trim().toLowerCase();
  if (!['winter','spring','summer','fall'].includes(f.season)) f.season = '';
  f.year = parseInt(q.get('year'), 10) || null;
  if (f.year && (f.year < 1960 || f.year > currentYear + 1)) f.year = null;
  f.language = (q.get('language') || '').trim().toLowerCase();
  if (!['sub','dub','sub,dub'].includes(f.language)) f.language = '';
  f.rating = (q.get('rating') || '').trim().toLowerCase();
  if (!RATING[f.rating]) f.rating = '';
  f.source = (q.get('source') || '').trim().toLowerCase();
  if (!SOURCE_NAME[f.source]) f.source = '';
  f.studio = (q.get('studio') || '').trim().toLowerCase();
  f.sort = (q.get('sort') || 'default').trim().toLowerCase();
  if (!['default','latest-updated','latest-added','score','name','release-date','most-viewed','episodes'].includes(f.sort)) f.sort = 'default';
  f.hidden = q.get('hidden') === '1';
  f.sfw = q.get('sfw') !== '0';
  f.page = Math.max(1, parseInt(q.get('page'), 10) || 1);
  if (f.page > MAX_PAGE) f.page = MAX_PAGE;
  f.perPage = Math.min(MAX_PER_PAGE, Math.max(1, parseInt(q.get('perPage'), 10) || 42));
  // aggregate status (/status/ongoing etc.) expands per side
  f.tvStatus = null; f.movieStatus = null; f.animeStatus = f.status;
  if (AGG_STATUS[f.status]) {
    const agg = AGG_STATUS[f.status];
    f.animeStatus = agg.anime;
    if (agg.tv) f.tvStatus = agg.tv;
    if (agg.movie === 'future-release') f.movieStatus = 'future-release';
    else if (agg.movie) f.movieStatus = agg.movie;
  } else if (ANIME_STATUS[f.status]) {
    f.animeStatus = f.status;
  } else if (TV_STATUS[f.status]) {
    f.tvStatus = f.status; f.animeStatus = null;
  } else if (MOVIE_STATUS[f.status]) {
    f.movieStatus = f.status; f.animeStatus = null;
  } else {
    f.animeStatus = null;
  }
  if (f.studio && STUDIO_NAME[f.studio]) f.studioName = STUDIO_NAME[f.studio];
  else if (f.studio && TMDB_COMPANY_ID[f.studio]) f.studioName = titleCaseSlug(f.studio);
  else if (f.studio) f.studioName = titleCaseSlug(f.studio);
  else f.studioName = null;
  // "drama" type = TMDB tv with Drama genre
  if (f.type === 'drama' && !f.genres.includes('drama')) f.genres = [...f.genres, 'drama'].slice(0, 6);
  return f;
}

// ── main handler ─────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (req.method !== 'GET') return json(res, 405, { ok:false, error:{ code:'method_not_allowed', message:'Use GET.' } });
  const url = new URL(req.url, 'https://x');
  const q = url.searchParams;
  if (q.get('refresh') !== '1') {
    const key = VERSION + ' | ' + [...q.entries()].filter(([k]) => k !== 'refresh').sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${k}=${v}`).join('&');
    const hit = cacheGet(key);
    if (hit) {
      setEdge(res);
      return json(res, 200, Object.assign({}, hit.data, { cache: { hit:true, key, cached_at: hit.fetchedAt, ttl_seconds: TTL_MS/1000 } }));
    }
    try {
      const out = await handle(q);
      if (out && out.ok && (out.items.length > 0 || out.legitEmpty)) {
        cacheSet(key, Object.assign({}, out, { cache: { hit:false, key, cached_at: new Date().toISOString(), ttl_seconds: TTL_MS/1000 } }));
      }
      if (out && out.ok) { setEdge(res); return json(res, 200, Object.assign({}, out, { cache: { hit:false, key, cached_at: new Date().toISOString(), ttl_seconds: TTL_MS/1000 } })); }
      noEdge(res);
      return json(res, out && out.status || 502, out || { ok:false });
    } catch (e) {
      noEdge(res);
      return json(res, 502, { ok:false, error:{ code:'upstream_failed', message:'All data sources are currently unavailable. Please retry in a moment.' }, detail:e.message });
    }
  }
  // refresh=1 — bypass cache reads AND edge
  try {
    const out = await handle(q);
    noEdge(res);
    return json(res, out && out.ok ? 200 : (out && out.status || 502), Object.assign({}, out, { cache: { hit:false, refresh:true, key:null } }));
  } catch (e) {
    noEdge(res);
    return json(res, 502, { ok:false, error:{ code:'upstream_failed', message:'All data sources are currently unavailable. Please retry in a moment.' }, detail:e.message });
  }
};

async function handle(q) {
  const f = parseParams(q);
  const warnings = f.warnings || [];
  const wantAnime = f.media === 'all' || f.media === 'anime';
  const wantTmdb = f.media === 'all' || f.media === 'tmdb';

  // anime-side filters only make sense on the anime half
  const anF = Object.assign({}, f, { status: f.animeStatus });
  const tmF = Object.assign({}, f, { status: null, tvStatus: f.tvStatus, movieStatus: f.movieStatus === 'future-release' ? 'future-release' : f.movieStatus, studio: (f.studio && STUDIO_NAME[f.studio]) ? null : f.studio, hidden: f.hidden && f.media !== 'anime' });
  if (f.rating || f.language || f.source || f.season) {
    if (f.media === 'tmdb') warnings.push('Rating/Language/Source/Season filters only apply to anime.');
  }
  if (f.media === 'anime' && f.hidden) warnings.push('Hidden gems are TMDB (non-anime) content — showing them anyway.');

  let result;
  if (f.media === 'all' && !f.hidden) {
    const animePlan = buildAnimePlan(anF, f.sort, warnings);
    const tmdbPlan = buildTmdbPlan(tmF, f.sort, warnings);
    result = await runMixed(animePlan, tmdbPlan, f, f.page, f.perPage, warnings);
  } else if (wantAnime && (f.media === 'anime' || f.hidden === false)) {
    const plan = buildAnimePlan(anF, f.sort, warnings);
    result = await runPlan(plan, anF, f.page, f.perPage, warnings);
    if (f.media === 'anime' && (f.rating || f.language || f.source)) { /* filters already honored */ }
  } else {
    const plan = buildTmdbPlan(tmF, f.sort, warnings);
    result = await runPlan(plan, tmF, f.page, f.perPage, warnings);
  }

  // t133 FIX: one page-count formula for every path. The old code mixed the
  // source's own lastPage (counted in SOURCE page sizes, and raw-catalog wide
  // for post-filtered legs) with ceil(total/perPage) — that is where "200
  // pages" came from. total is the (filtered) title count for THIS query, so
  // ceil(total/perPage) is always the honest page count.
  let totalPages = Math.max(1, Math.ceil((result.total || 0) / f.perPage));
  let hasNext = !!result.hasNext && f.page < totalPages;
  // t133: a SHORT page from the winning leg with untried legs left usually
  // means this source ran dry while others still hold data — keep the next
  // button alive instead of dead-ending at the leg boundary (the next click
  // continues on the next leg; a genuinely-empty result still shows the
  // honest empty state with a back-to-page-1 button)
  if (!hasNext && Array.isArray(result.items) && result.items.length > 0 &&
      result.items.length < f.perPage && result.moreLegs) {
    hasNext = true;
    totalPages = Math.max(totalPages, f.page + 1);
  }
  const applied = {
    media: f.media, q: f.q || null, genres: f.genres.length ? f.genres : null,
    country: f.country || null, type: f.type || null,
    status: f.status || null, season: f.season || null, year: f.year || null,
    language: f.language || null, rating: f.rating || null, source: f.source || null,
    studio: f.studio || null, sort: f.sort, hidden: f.hidden || null,
    sfw: f.sfw, page: f.page, perPage: f.perPage
  };
  return {
    ok: true,
    endpoint: '/api/browse',
    version: VERSION,
    applied,
    page: f.page,
    perPage: f.perPage,
    total: result.total || 0,
    totalPages,
    hasNext,
    sourceLastPage: result.lastPage || null,
    approximate: !!result.approx,
    servedBy: result.source || null,
    warnings: warnings.length ? warnings : undefined,
    legErrors: result.errors && result.errors.length ? result.errors : undefined,
    legitEmpty: result.total === 0 && (!result.errors || !result.errors.length),
    items: result.items || []
  };
}
