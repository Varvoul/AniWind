// ═══════════════════════════════════════════════════════════════════
// VERCEL BLOB CACHE API - Working Private Store v7.0
// 
// Store: store_VcHlC7LrB4RyYVJn (PRIVATE)
// Available methods: put, head, list, del, getDownloadUrl
// NOTE: No get() method in Edge Functions - use getDownloadUrl() + fetch
//
// ═══════════════════════════════════════════════════════════════════

const CACHE_PREFIX = 'cache/';
const TTL_SECONDS = 6 * 60 * 60;

const SECTIONS = {
  'hero-slider': 'hero-slider.json',
  'top-airing': 'top-airing.json',
  'new-releases-all': 'new-releases/all.json',
  'new-releases-anime': 'new-releases/anime.json',
  'new-releases-movie': 'new-releases/movie.json',
  'new-releases-series': 'new-releases/series.json',
  'new-releases-hidden': 'new-releases/hidden.json',
  'new-on-rowana': 'new-on-rowana.json',
  'upcoming-movies': 'upcoming/movies.json',
  'upcoming-tv': 'upcoming/tv.json',
  'recently-completed': 'recently-completed/',
  'trending-today': 'trending/today.json',
  'trending-week': 'trending/week.json',
  'trending-month': 'trending/month.json',
  'most-favourite': 'most-favourite.json',
  'popular-anime': 'popular-anime.json',
  'schedule-monday': 'schedule/monday.json',
  'schedule-tuesday': 'schedule/tuesday.json',
  'schedule-wednesday': 'schedule/wednesday.json',
  'schedule-thursday': 'schedule/thursday.json',
  'schedule-friday': 'schedule/friday.json',
  'schedule-saturday': 'schedule/saturday.json',
  'schedule-sunday': 'schedule/sunday.json',
  // Aliases
  'heroSlider': 'hero-slider.json',
  'topAiring': 'top-airing.json',
  'newReleases': 'new-releases/all.json',
  'newReleasesAll': 'new-releases/all.json',
  'newReleasesAnime': 'new-releases/anime.json',
  'newReleasesMovie': 'new-releases/movie.json',
  'newReleasesSeries': 'new-releases/series.json',
  'newReleasesHidden': 'new-releases/hidden.json',
  'newOnRowana': 'new-on-rowana.json',
  'upcomingMovies': 'upcoming/movies.json',
  'upcomingTv': 'upcoming/tv.json',
  'recentlyCompleted': 'recently-completed/',
  'trendingToday': 'trending/today.json',
  'trendingWeek': 'trending/week.json',
  'trendingMonth': 'trending/month.json',
  'mostFavourite': 'most-favourite.json',
  'popularAnime': 'popular-anime.json',
  'upcoming': 'upcoming/movies.json',
};

const memoryStore = new Map();
let blobAvailable = false;
let Blob = null;

try {
  Blob = require('@vercel/blob');
  if (Blob && Blob.put) {
    blobAvailable = true;
    console.log('[Blob Cache] ✅ @vercel/blob loaded (PRIVATE store v7.0)');
  }
} catch (e) {
  console.log(`[Blob Cache] ⚠️ Memory mode (${e.message})`);
}

function getBlobKey(section, page = null) {
  const baseKey = SECTIONS[section];
  if (!baseKey) throw new Error(`Unknown section: ${section}`);
  if ((section === 'recently-completed' || section === 'recentlyCompleted') && page) {
    return CACHE_PREFIX + baseKey + `page-${page}.json`;
  }
  return CACHE_PREFIX + baseKey;
}

function isExpired(timestamp) {
  if (!timestamp) return true;
  return Date.now() > new Date(timestamp).getTime() + (TTL_SECONDS * 1000);
}

function getTTL(timestamp) {
  if (!timestamp) return 0;
  return Math.max(0, Math.floor((new Date(timestamp).getTime() + (TTL_SECONDS * 1000) - Date.now()) / 1000));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });

  const start = Date.now();
  
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString()); }
  catch { return res.status(400).json({ error: 'Invalid JSON' }); }

  const { action, section, data, page } = body || {};
  console.log(`[Blob Cache] ${action} ${section || ''} ${page ? `p${page}` : ''}`);

  try {
    let result;
    switch (action) {
      case 'ping': result = handlePing(); break;
      case 'read': result = await readCache(section, page); break;
      case 'write': result = await writeCache(section, data, page); break;
      case 'status': result = await getStatus(section); break;
      case 'list': result = await listAll(); break;
      case 'clear': result = await clear(section); break;
      case 'clear-all': result = await clearAll(); break;
      default: return res.status(400).json({ error: 'Invalid action' });
    }
    
    return res.json({
      success: true,
      ...result,
      _meta: { ms: Date.now() - start, ttl: TTL_SECONDS, storage: blobAvailable ? 'blob-private' : 'memory' }
    });
    
  } catch (e) {
    console.error('[Blob Cache]', e.message);
    return res.status(500).json({ success: false, error: e.message });
  }
}

function handlePing() {
  return { 
    message: 'pong', 
    blobAvailable, 
    mode: 'PRIVATE-v7',
    storeId: 'store_VcHlC7LrB4RyYVJn',
    time: new Date().toISOString(),
    methods: {
      put: !!Blob?.put,
      head: !!Blob?.head,
      list: !!Blob?.list,
      del: !!Blob?.del,
      getDownloadUrl: !!Blob?.getDownloadUrl,
      copy: !!Blob?.copy
    }
  };
}

async function readCache(section, page) {
  const key = getBlobKey(section, page);
  
  if (blobAvailable) {
    try {
      // Step 1: Check if blob exists and get metadata
      const meta = await Blob.head(key);
      
      if (!meta) {
        return { found: false, reason: 'not_cached' };
      }
      
      // Step 2: Check expiry
      const uploadedAt = meta.uploadedAt || new Date().toISOString();
      if (isExpired(uploadedAt)) {
        return { found: false, reason: 'expired', ttl: 0 };
      }
      
      // Step 3: Get download URL for private blob
      let downloadUrl;
      if (Blob.getDownloadUrl) {
        try {
          downloadUrl = await Blob.getDownloadUrl(key, { access: 'private' });
        } catch (urlError) {
          console.log(`[Blob Cache] getDownloadUrl failed: ${urlError.message}, trying direct URL`);
          downloadUrl = meta.url; // Fallback to metadata URL
        }
      } else {
        downloadUrl = meta.url;
      }
      
      // Step 4: Fetch the actual content using the URL
      const response = await fetch(downloadUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} when fetching blob`);
      }
      
      const data = await response.text();
      const parsed = JSON.parse(data);
      
      console.log(`[Blob Cache] 📖 READ ${key} (${data.length} chars) ✅`);
      return { 
        found: true, 
        data: parsed,
        size: data.length, 
        ttl: getTTL(uploadedAt),
        source: 'blob-private',
        at: uploadedAt
      };
    } catch (e) {
      console.log(`[Blob Cache] ⚠️ Read error: ${e.message}`);
      return { found: false, reason: 'error', error: e.message };
    }
  } else {
    // Memory fallback
    const memKey = key + (page ? `-p${page}` : '');
    const stored = memoryStore.get(memKey);
    if (!stored) return { found: false, reason: 'not_cached', _note: 'memory mode' };
    if (isExpired(stored.t)) { memoryStore.delete(memKey); return { found: false, reason: 'expired' }; }
    return { found: true, data: stored.d, size: JSON.stringify(stored.d).length, ttl: getTTL(stored.t), source: 'memory' };
  }
}

async function writeCache(section, data, page) {
  const key = getBlobKey(section, page);
  const json = typeof data === 'string' ? data : JSON.stringify(data);
  const t = new Date().toISOString();
  
  if (blobAvailable) {
    try {
      // Write to private blob store
      const blob = await Blob.put(key, json, { 
        access: 'private', 
        contentType: 'application/json', 
        addRandomSuffix: false 
      });
      
      console.log(`[Blob Cache] 💾 WRITTEN ${key} (${json.length} chars) to PRIVATE store ✅`);
      return { 
        message: `[BLOB] Cached: ${section}${page ? ` p${page}` : ''}`, 
        key, 
        size: blob?.size || json.length, 
        at: t,
        store: 'private'
      };
    } catch (e) {
      console.error(`[Blob Cache] ❌ Write failed: ${e.message}`);
      
      // Memory fallback
      const memKey = key + (page ? `-p${page}` : '');
      memoryStore.set(memKey, { d: data, t });
      
      return { 
        message: `[MEM] Cached: ${section}`, 
        key: memKey, 
        size: json.length, 
        at: t, 
        _warn: `Blob write failed: ${e.message}`
      };
    }
  } else {
    const memKey = key + (page ? `-p${page}` : '');
    memoryStore.set(memKey, { d: data, t });
    console.log(`[Blob Cache] 💾 [MEM] ${memKey} (${json.length} chars)`);
    return { message: `[MEM] Cached: ${section}`, key: memKey, size: json.length, at: t };
  }
}

async function getStatus(section) {
  if (section) {
    const key = getBlobKey(section);
    if (blobAvailable) {
      try {
        const meta = await Blob.head(key);
        if (!meta) return { section, found: false, status: 'missing' };
        return { section, found: true, status: isExpired(meta.uploadedAt) ? 'expired' : 'valid', size: meta.size, ttl: getTTL(meta.uploadedAt), store: 'private' };
      } catch (e) { return { section, found: false, status: 'error', error: e.message }; }
    } else {
      const s = memoryStore.get(key);
      if (!s) return { section, found: false, status: 'missing' };
      return { section, found: true, status: isExpired(s.t) ? 'expired' : 'valid', size: JSON.stringify(s.d).length, ttl: getTTL(s.t) };
    }
  }

  const statuses = {};
  let valid = 0, expired = 0, missing = 0, totalSize = 0;

  for (const [name, path] of Object.entries(SECTIONS)) {
    if (path.endsWith('/')) continue;
    const key = CACHE_PREFIX + path;
    
    if (blobAvailable) {
      try {
        const m = await Blob.head(key);
        if (m) {
          const v = !isExpired(m.uploadedAt);
          statuses[name] = { found: true, status: v ? 'valid' : 'expired', size: m.size, ttl: getTTL(m.uploadedAt), store: 'private' };
          totalSize += m.size || 0; v ? valid++ : expired++;
        } else { statuses[name] = { found: false }; missing++; }
      } catch (e) { statuses[name] = { found: false }; missing++; }
    } else {
      const s = memoryStore.get(key);
      if (s && !isExpired(s.t)) { statuses[name] = { found: true, status: 'valid', size: JSON.stringify(s.d).length, ttl: getTTL(s.t) }; totalSize += JSON.stringify(s.d).length; valid++; }
      else if (s) { statuses[name] = { found: true, status: 'expired' }; expired++; }
      else { statuses[name] = { found: false }; missing++; }
    }
  }

  statuses['recently-completed'] = { pages: {}, total: 0 };
  if (blobAvailable) {
    try {
      const { blobs } = await Blob.list({ prefix: CACHE_PREFIX + 'recently-completed/' });
      const pages = blobs.filter(b => b.pathname.includes('page-'));
      statuses['recently-completed'].total = pages.length;
      pages.forEach(p => {
        const m = p.pathname.match(/page-(\d+)\.json$/);
        if (m) statuses['recently-completed'].pages[m[1]] = { found: true, status: isExpired(p.uploadedAt) ? 'expired' : 'valid', size: p.size };
      });
    } catch (e) {}
  }

  return { overview: { total: Object.keys(SECTIONS).length, valid, expired, missing, totalSize, ttl: TTL_SECONDS, storage: blobAvailable ? 'blob-private' : 'memory' }, sections: statuses };
}

async function listAll() {
  if (blobAvailable) {
    try {
      const { blobs } = await Blob.list({ prefix: CACHE_PREFIX });
      return { count: blobs.length, items: blobs.map(b => ({ path: b.pathname.replace(CACHE_PREFIX,''), size: b.size, at: b.uploadedAt, exp: isExpired(b.uploadedAt), ttl: getTTL(b.uploadedAt) })).sort((a,b) => new Date(b.at) - new Date(a.at)) };
    } catch (e) { return { count: 0, items: [], error: e.message }; }
  } else {
    const items = [];
    for (const [k, v] of memoryStore) items.push({ path: k.replace(CACHE_PREFIX,''), size: JSON.stringify(v.d).length, at: v.t, exp: isExpired(v.t), ttl: getTTL(v.t) });
    return { count: items.length, items: items.sort((a,b) => new Date(b.at) - new Date(a.at)) };
  }
}

async function clear(section) {
  const key = getBlobKey(section);
  if (blobAvailable) {
    try { await Blob.del(key); return { cleared: true, section }; }
    catch (e) { return { cleared: false, section, error: e.message }; }
  } else {
    return { cleared: memoryStore.delete(key), section };
  }
}

async function clearAll() {
  if (blobAvailable) {
    try {
      const { blobs } = await Blob.list({ prefix: CACHE_PREFIX });
      let c = 0, f = 0;
      for (const b of blobs) {
        try { await Blob.del(b.pathname); c++; }
        catch { f++; }
      }
      return { total: blobs.length, cleared: c, failed: f };
    } catch (e) { return { error: e.message }; }
  } else {
    const c = memoryStore.size;
    memoryStore.clear();
    return { total: c, cleared: c, failed: 0 };
  }
}
