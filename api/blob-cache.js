// ═══════════════════════════════════════════════════════════════════
// VERCEL BLOB CACHE API - Simple Raw JSON Caching System v3.0
// 
// Features:
// - Stores COMPLETE raw JSON responses from TMDB/AniList/TVMaze APIs
// - 6-hour TTL (Time-To-Live) auto-expiry
// - Special pagination support for "recently-completed" section
// - Works with existing proxy setup (t-umi, aniocen, etc.)
// - Graceful fallback if Blob not configured (uses memory)
//
// Actions: read, write, status, clear, list, ping
// ═══════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────────────────────────────

const CACHE_PREFIX = 'cache/';
const TTL_SECONDS = 6 * 60 * 60; // 6 hours in seconds

// All sections to cache (maps to blob keys)
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
  'schedule-sunday': 'schedule/sunday.json'
};

// In-memory fallback storage
const memoryStore = new Map();
let blobAvailable = false;

// Try to load @vercel/blob
let Blob;
try {
  Blob = require('@vercel/blob');
  blobAvailable = true;
  console.log('[Blob Cache] ✅ @vercel/blob loaded');
} catch (e) {
  blobAvailable = false;
  console.log(`[Blob Cache] ⚠️ Using memory fallback (${e.message})`);
}

// ─────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────

function getBlobKey(section, page = null) {
  const baseKey = SECTIONS[section];
  if (!baseKey) throw new Error(`Unknown section: ${section}`);
  if (section === 'recently-completed' && page) {
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
  const remaining = Math.floor((new Date(timestamp).getTime() + (TTL_SECONDS * 1000) - Date.now()) / 1000);
  return Math.max(0, remaining);
}

// ─────────────────────────────────────────────────────────────────────
// HANDLER
// ─────────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });

  const start = Date.now();
  
  // Parse body
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
      case 'ping': result = { message: 'pong', blobAvailable, time: new Date().toISOString() }; break;
      case 'read': result = await readCache(section, page); break;
      case 'write': result = await writeCache(section, data, page); break;
      case 'status': result = await getStatus(section); break;
      case 'list': result = await listAll(); break;
      case 'clear': result = await clear(section); break;
      case 'clear-all': result = await clearAll(); break;
      default: return res.status(400).json({ error: 'Invalid action', valid: ['ping','read','write','status','list','clear','clear-all'] });
    }
    
    return res.json({
      success: true,
      ...result,
      _meta: { ms: Date.now() - start, ttl: TTL_SECONDS, storage: blobAvailable ? 'blob' : 'memory' }
    });
    
  } catch (e) {
    console.error('[Blob Cache]', e.message);
    return res.status(500).json({ success: false, error: e.message, _meta: { ms: Date.now() - start } });
  }
}

// ─────────────────────────────────────────────────────────────────────
// OPERATIONS
// ─────────────────────────────────────────────────────────────────────

async function readCache(section, page) {
  const key = getBlobKey(section, page);
  
  if (blobAvailable) {
    try {
      const meta = await Blob.head(key);
      if (!meta) return { found: false, reason: 'not_cached' };
      if (isExpired(meta.uploadedAt)) return { found: false, reason: 'expired', ttl: 0 };
      
      // For private blobs, download and return data directly
      // For public blobs, return URL (client can fetch)
      const isPrivate = !meta.url.startsWith('https://public-');
      
      if (isPrivate) {
        // Download blob content server-side
        const blob = await Blob.get(key);
        const data = await blob.text();
        return { 
          found: true, 
          data: JSON.parse(data), // Return actual parsed data
          size: meta.size, 
          ttl: getTTL(meta.uploadedAt),
          source: 'blob-private'
        };
      } else {
        return { found: true, url: meta.url, size: meta.size, ttl: getTTL(meta.uploadedAt), source: 'blob-public' };
      }
    } catch (e) {
      return { found: false, reason: 'error', error: e.message };
    }
  } else {
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
  
  if (blobAvailable) {
    // Try public first, then private, then memory fallback
    let blob;
    try {
      // Try public access
      blob = await Blob.put(key, json, { access: 'public', contentType: 'application/json', addRandomSuffix: false });
    } catch (pubError) {
      try {
        // If public fails, try private
        console.log(`[Blob Cache] Public access failed, trying private: ${pubError.message}`);
        blob = await Blob.put(key, json, { access: 'private', contentType: 'application/json', addRandomSuffix: false });
      } catch (privError) {
        // Both failed - use memory fallback
        console.log(`[Blob Cache] Private also failed, using memory: ${privError.message}`);
        blobAvailable = false; // Disable blob for this request
        
        const memKey = key + (page ? `-p${page}` : '');
        const t = new Date().toISOString();
        memoryStore.set(memKey, { d: data, t });
        
        return { 
          message: `[MEM] Cached: ${section}`, 
          key: memKey, 
          size: json.length, 
          at: t, 
          _warn: 'Using memory (Blob store config conflict)' 
        };
      }
    }
    
    console.log(`[Blob Cache] 💾 ${key} (${json.length} chars)`);
    return { message: `Cached: ${section}${page ? ` p${page}` : ''}`, key, url: blob.url, size: blob.size, at: blob.uploadedAt };
  } else {
    const memKey = key + (page ? `-p${page}` : '');
    const t = new Date().toISOString();
    memoryStore.set(memKey, { d: data, t });
    console.log(`[Blob Cache] 💾 [MEM] ${memKey} (${json.length} chars)`);
    return { message: `[MEM] Cached: ${section}`, key: memKey, size: json.length, at: t, _warn: 'Memory only - restart clears it' };
  }
}

async function getStatus(section) {
  if (section) {
    const key = getBlobKey(section);
    if (blobAvailable) {
      try {
        const meta = await Blob.head(key);
        if (!meta) return { section, found: false, status: 'missing' };
        return { section, found: true, status: isExpired(meta.uploadedAt) ? 'expired' : 'valid', size: meta.size, ttl: getTTL(meta.uploadedAt) };
      } catch { return { section, found: false, status: 'missing' }; }
    } else {
      const s = memoryStore.get(key);
      if (!s) return { section, found: false, status: 'missing' };
      return { section, found: true, status: isExpired(s.t) ? 'expired' : 'valid', size: JSON.stringify(s.d).length, ttl: getTTL(s.t) };
    }
  }

  // All sections
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
          statuses[name] = { found: true, status: v ? 'valid' : 'expired', size: m.size, ttl: getTTL(m.uploadedAt) };
          totalSize += m.size || 0; v ? valid++ : expired++;
        } else { statuses[name] = { found: false }; missing++; }
      } catch { statuses[name] = { found: false }; missing++; }
    } else {
      const s = memoryStore.get(key);
      if (s && !isExpired(s.t)) { statuses[name] = { found: true, status: 'valid', size: JSON.stringify(s.d).length, ttl: getTTL(s.t) }; totalSize += JSON.stringify(s.d).length; valid++; }
      else if (s) { statuses[name] = { found: true, status: 'expired' }; expired++; }
      else { statuses[name] = { found: false }; missing++; }
    }
  }

  // Recently completed pages
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
    } catch {}
  } else {
    let pc = 0;
    for (const [k, v] of memoryStore) {
      if (k.includes('recently-completed') && k.includes('page-') && !isExpired(v.t)) {
        const m = k.match(/page-(\d+)/);
        if (m) { statuses['recently-completed'].pages[m[1]] = { found: true, status: 'valid' }; pc++; }
      }
    }
    statuses['recently-completed'].total = pc;
  }

  return { overview: { total: Object.keys(SECTIONS).length, valid, expired, missing, totalSize, ttl: TTL_SECONDS, storage: blobAvailable ? 'blob' : 'memory' }, sections: statuses };
}

async function listAll() {
  if (blobAvailable) {
    try {
      const { blobs } = await Blob.list({ prefix: CACHE_PREFIX });
      return { count: blobs.length, items: blobs.map(b => ({ path: b.pathname.replace(CACHE_PREFIX,''), url: b.url, size: b.size, at: b.uploadedAt, exp: isExpired(b.uploadedAt), ttl: getTTL(b.uploadedAt) })).sort((a,b) => new Date(b.at) - new Date(a.at)) };
    } catch { return { count: 0, items: [] }; }
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

