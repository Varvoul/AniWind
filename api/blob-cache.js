// ═══════════════════════════════════════════════════════════════════
// VERCEL BLOB CACHE API - Simple Raw JSON Caching System v2.0
// 
// Features:
// - Stores COMPLETE raw JSON responses from TMDB/AniList/TVMaze APIs
// - 6-hour TTL (Time-To-Live) auto-expiry
// - Special pagination support for "recently-completed" section
// - Works with existing proxy setup (t-umi, aniocen, etc.)
// - Graceful fallback if Blob not configured
//
// Actions: read, write, status, clear, list, init
// ═══════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────────────────────────────

const CACHE_PREFIX = 'cache/';
const TTL_SECONDS = 6 * 60 * 60; // 6 hours in seconds

// All sections to cache (maps to blob keys)
const SECTIONS = {
  // Main sections
  'hero-slider': 'hero-slider.json',
  'top-airing': 'top-airing.json',
  
  // New Releases tabs
  'new-releases-all': 'new-releases/all.json',
  'new-releases-anime': 'new-releases/anime.json',
  'new-releases-movie': 'new-releases/movie.json',
  'new-releases-series': 'new-releases/series.json',
  'new-releases-hidden': 'new-releases/hidden.json',
  
  // Other sections
  'new-on-rowana': 'new-on-rowana.json',
  'upcoming-movies': 'upcoming/movies.json',
  'upcoming-tv': 'upcoming/tv.json',
  
  // Recently Completed (paginated - special handling)
  'recently-completed': 'recently-completed/', // Directory, not file
  
  // Trending Now (3 tabs)
  'trending-today': 'trending/today.json',
  'trending-week': 'trending/week.json',
  'trending-month': 'trending/month.json',
  
  // Popular sections
  'most-favourite': 'most-favourite.json',
  'popular-anime': 'popular-anime.json',
  
  // Schedule (7 days)
  'schedule-monday': 'schedule/monday.json',
  'schedule-tuesday': 'schedule/tuesday.json',
  'schedule-wednesday': 'schedule/wednesday.json',
  'schedule-thursday': 'schedule/thursday.json',
  'schedule-friday': 'schedule/friday.json',
  'schedule-saturday': 'schedule/saturday.json',
  'schedule-sunday': 'schedule/sunday.json'
};

// In-memory fallback storage (used when Blob is not available)
const memoryStore = new Map();
let blobAvailable = false;
let blobError = null;

// Try to import @vercel/blob - handle case where it's not configured
let put, head, del, list;

try {
  const blobModule = require('@vercel/blob');
  put = blobModule.put;
  head = blobModule.head;
  del = blobModule.del;
  list = blobModule.list;
  blobAvailable = true;
  console.log('[Blob Cache] ✅ @vercel/blob loaded successfully');
} catch (error) {
  blobAvailable = false;
  blobError = error.message;
  console.log(`[Blob Cache] ⚠️ @vercel/blob not available: ${error.message}`);
  console.log('[Blob Cache] 📦 Using in-memory fallback storage');
}

// ─────────────────────────────────────────────────────────────────────
// HELPER FUNCTIONS
// ─────────────────────────────────────────────────────────────────────

/**
 * Get blob key for a section
 */
function getBlobKey(section, page = null) {
  const baseKey = SECTIONS[section];
  if (!baseKey) {
    throw new Error(`Unknown section: ${section}`);
  }
  
  // Special handling for paginated recently-completed
  if (section === 'recently-completed' && page) {
    return CACHE_PREFIX + baseKey + `page-${page}.json`;
  }
  
  return CACHE_PREFIX + baseKey;
}

/**
 * Check if cache is expired based on timestamp
 */
function isExpired(timestamp) {
  if (!timestamp) return true;
  
  const uploadedAt = new Date(timestamp);
  const expiresAt = new Date(uploadedAt.getTime() + (TTL_SECONDS * 1000));
  return new Date() > expiresAt;
}

/**
 * Calculate seconds until expiry
 */
function getSecondsUntilExpiry(timestamp) {
  if (!timestamp) return 0;
  
  const uploadedAt = new Date(timestamp);
  const expiresAt = new Date(uploadedAt.getTime() + (TTL_SECONDS * 1000));
  const remaining = Math.floor((expiresAt - new Date()) / 1000);
  return Math.max(0, remaining);
}

/**
 * Generate a simple unique ID for memory store entries
 */
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// ─────────────────────────────────────────────────────────────────────
// MAIN HANDLER
// ─────────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only accept POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ 
      success: false, 
      error: 'Method not allowed. Use POST.' 
    });
  }

  const startTime = Date.now();
  
  try {
    // Parse request body manually (more reliable than req.body)
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const rawBody = Buffer.concat(chunks).toString('utf-8');
    
    let parsedBody;
    try {
      parsedBody = rawBody ? JSON.parse(rawBody) : {};
    } catch (e) {
      return res.status(400).json({
        success: false,
        error: 'Invalid JSON in request body'
      });
    }
    
    const { action, section, data, page } = parsedBody || {};
    
    console.log(`[Blob Cache] 📥 Request: ${action || 'unknown'} | Section: ${section || 'all'} | Time: ${new Date().toISOString()}`);
    
    let result;
    
    switch (action) {
      case 'read':
        result = await readCache(section, page);
        break;
        
      case 'write':
        result = await writeCache(section, data, page);
        break;
        
      case 'status':
        result = await getCacheStatus(section);
        break;
        
      case 'list':
        result = await listCache();
        break;
        
      case 'clear':
        result = await clearCache(section);
        break;
        
      case 'clear-all':
        result = await clearAllCache();
        break;
        
      case 'ping':
        result = { 
          message: 'pong', 
          blobAvailable, 
          storageType: blobAvailable ? 'vercel-blob' : 'memory-fallback',
          timestamp: new Date().toISOString()
        };
        break;
        
      default:
        return res.status(400).json({
          success: false,
          error: 'Invalid action',
          validActions: ['read', 'write', 'status', 'list', 'clear', 'clear-all', 'ping']
        });
    }
    
    const duration = Date.now() - startTime;
    console.log(`[Blob Cache] ✅ ${action} completed in ${duration}ms`);
    
    return res.status(200).json({
      success: true,
      ...result,
      _meta: {
        serverTime: new Date().toISOString(),
        responseTimeMs: duration,
        ttlSeconds: TTL_SECONDS,
        storageType: blobAvailable ? 'vercel-blob' : 'memory-fallback',
        blobConfigured: blobAvailable
      }
    });
    
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[Blob Cache] ❌ Error after ${duration}ms:`, error.message);
    
    return res.status(500).json({
      success: false,
      error: error.message,
      _meta: {
        serverTime: new Date().toISOString(),
        responseTimeMs: duration,
        blobConfigured: blobAvailable
      }
    });
  }
}

// ─────────────────────────────────────────────────────────────────────
// CACHE OPERATIONS (Unified - works with both Blob and Memory)
// ─────────────────────────────────────────────────────────────────────

/**
 * Read cached data for a section
 */
async function readCache(section, page = null) {
  const blobKey = getBlobKey(section, page);
  
  if (blobAvailable) {
    // Use Vercel Blob
    try {
      const metadata = await head(blobKey);
      
      if (!metadata) {
        return {
          data: null,
          found: false,
          reason: 'not_cached'
        };
      }
      
      // Check if expired
      if (isExpired(metadata.uploadedAt)) {
        return {
          data: null,
          found: false,
          reason: 'expired',
          uploadedAt: metadata.uploadedAt,
          secondsUntilExpiry: 0
        };
      }
      
      // Return URL for client to fetch
      return {
        found: true,
        url: metadata.url,
        downloaded: false,
        uploadedAt: metadata.uploadedAt,
        sizeBytes: metadata.size,
        secondsUntilExpiry: getSecondsUntilExpiry(metadata.uploadedAt),
        contentType: metadata.contentType
      };
      
    } catch (error) {
      return {
        data: null,
        found: false,
        reason: 'not_cached',
        error: error.message
      };
    }
  } else {
    // Use memory fallback
    const memoryKey = `${blobKey}${page ? `-page-${page}` : ''}`;
    const stored = memoryStore.get(memoryKey);
    
    if (!stored) {
      return {
        data: null,
        found: false,
        reason: 'not_cached',
        _note: 'Using memory fallback (Blob not configured)'
      };
    }
    
    if (isExpired(stored.timestamp)) {
      memoryStore.delete(memoryKey);
      return {
        data: null,
        found: false,
        reason: 'expired',
        _note: 'Using memory fallback (Blob not configured)'
      };
    }
    
    return {
      found: true,
      data: stored.data, // Return actual data from memory
      source: 'memory',
      uploadedAt: stored.timestamp,
      sizeBytes: JSON.stringify(stored.data).length,
      secondsUntilExpiry: getSecondsUntilExpiry(stored.timestamp),
      _note: 'Served from memory (configure Vercel Blob for persistence)'
    };
  }
}

/**
 * Write/cache data for a section (stores RAW JSON)
 */
async function writeCache(section, rawData, page = null) {
  const blobKey = getBlobKey(section, page);
  
  // Store as complete raw JSON string
  const jsonString = typeof rawData === 'string' ? rawData : JSON.stringify(rawData);
  
  if (blobAvailable) {
    // Use Vercel Blob
    const blob = await put(blobKey, jsonString, {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false
    });
    
    console.log(`[Blob Cache] 💾 Stored in Blob: ${blobKey} (${jsonString.length} chars)`);
    
    return {
      message: `Cached: ${section}${page ? ` (page ${page})` : ''}`,
      section,
      page: page || null,
      blobKey,
      url: blob.url,
      sizeBytes: blob.size,
      uploadedAt: blob.uploadedAt,
      expiresAt: new Date(Date.now() + (TTL_SECONDS * 1000)).toISOString()
    };
  } else {
    // Use memory fallback
    const memoryKey = `${blobKey}${page ? `-page-${page}` : ''}`;
    const timestamp = new Date().toISOString();
    
    memoryStore.set(memoryKey, {
      data: rawData, // Store original data (not stringified, to preserve structure)
      timestamp: timestamp,
      id: generateId()
    });
    
    console.log(`[Blob Cache] 💾 Stored in Memory: ${memoryKey} (${jsonString.length} chars)`);
    
    return {
      message: `Cached (memory): ${section}${page ? ` (page ${page})` : ''}`,
      section,
      page: page || null,
      blobKey: memoryKey,
      sizeBytes: jsonString.length,
      uploadedAt: timestamp,
      expiresAt: new Date(Date.now() + (TTL_SECONDS * 1000)).toISOString(),
      _warning: 'Stored in memory only - will be lost on serverless restart. Configure BLOB_READ_WRITE_TOKEN for persistent storage.'
    };
  }
}

/**
 * Get cache status for a section or all sections
 */
async function getCacheStatus(section = null) {
  if (section) {
    // Status for specific section
    const blobKey = getBlobKey(section);
    
    if (blobAvailable) {
      try {
        const metadata = await head(blobKey);
        
        if (!metadata) {
          return {
            section,
            found: false,
            status: 'not_cached'
          };
        }
        
        return {
          section,
          found: true,
          status: isExpired(metadata.uploadedAt) ? 'expired' : 'valid',
          uploadedAt: metadata.uploadedAt,
          sizeBytes: metadata.size,
          secondsUntilExpiry: getSecondsUntilExpiry(metadata.uploadedAt),
          url: metadata.url
        };
        
      } catch (error) {
        return {
          section,
          found: false,
          status: 'not_cached',
          error: error.message
        };
      }
    } else {
      // Memory fallback status
      const stored = memoryStore.get(blobKey);
      if (!stored) {
        return {
          section,
          found: false,
          status: 'not_cached',
          _note: 'Memory fallback mode'
        };
      }
      
      return {
        section,
        found: true,
        status: isExpired(stored.timestamp) ? 'expired' : 'valid',
        uploadedAt: stored.timestamp,
        sizeBytes: JSON.stringify(stored.data).length,
        secondsUntilExpiry: getSecondsUntilExpiry(stored.timestamp),
        _note: 'Memory fallback mode'
      };
    }
  }
  
  // Status for ALL sections
  const statuses = {};
  let totalSize = 0;
  let validCount = 0;
  let expiredCount = 0;
  let missingCount = 0;
  
  for (const [sectionName, blobPath] of Object.entries(SECTIONS)) {
    // Skip directory-style keys for individual checks
    if (blobPath.endsWith('/')) continue;
    
    const blobKey = CACHE_PREFIX + blobPath;
    
    if (blobAvailable) {
      try {
        const metadata = await head(blobKey);
        
        if (metadata) {
          const valid = !isExpired(metadata.uploadedAt);
          statuses[sectionName] = {
            found: true,
            status: valid ? 'valid' : 'expired',
            uploadedAt: metadata.uploadedAt,
            sizeBytes: metadata.size,
            secondsUntilExpiry: getSecondsUntilExpiry(metadata.uploadedAt)
          };
          
          totalSize += metadata.size || 0;
          if (valid) validCount++;
          else expiredCount++;
        } else {
          statuses[sectionName] = { found: false, status: 'not_cached' };
          missingCount++;
        }
      } catch (error) {
        statuses[sectionName] = { found: false, status: 'not_cached' };
        missingCount++;
      }
    } else {
      // Memory fallback
      const stored = memoryStore.get(blobKey);
      if (stored && !isExpired(stored.timestamp)) {
        statuses[sectionName] = {
          found: true,
          status: 'valid',
          uploadedAt: stored.timestamp,
          sizeBytes: JSON.stringify(stored.data).length,
          secondsUntilExpiry: getSecondsUntilExpiry(stored.timestamp)
        };
        totalSize += JSON.stringify(stored.data).length;
        validCount++;
      } else if (stored && isExpired(stored.timestamp)) {
        statuses[sectionName] = { found: true, status: 'expired' };
        expiredCount++;
      } else {
        statuses[sectionName] = { found: false, status: 'not_cached' };
        missingCount++;
      }
    }
  }
  
  // Check recently-completed pages
  statuses['recently-completed'] = { pages: {}, totalPages: 0 };
  
  if (blobAvailable) {
    try {
      const { blobs } = await list({ prefix: CACHE_PREFIX + 'recently-completed/' });
      const pageBlobs = blobs.filter(b => b.pathname.includes('page-'));
      statuses['recently-completed'].totalPages = pageBlobs.length;
      
      for (const pageBlob of pageBlobs) {
        const pageMatch = pageBlob.pathname.match(/page-(\d+)\.json$/);
        if (pageMatch) {
          const pageNum = pageMatch[1];
          statuses['recently-completed'].pages[pageNum] = {
            found: true,
            status: isExpired(pageBlob.uploadedAt) ? 'expired' : 'valid',
            uploadedAt: pageBlob.uploadedAt,
            sizeBytes: pageBlob.size
          };
        }
      }
    } catch (error) {
      // No recently-completed pages cached yet
    }
  } else {
    // Check memory for paginated entries
    let pageCount = 0;
    for (const [key, value] of memoryStore.entries()) {
      if (key.includes('recently-completed') && key.includes('page-')) {
        const pageMatch = key.match(/page-(\d+)/);
        if (pageMatch && !isExpired(value.timestamp)) {
          const pageNum = pageMatch[1];
          statuses['recently-completed'].pages[pageNum] = {
            found: true,
            status: 'valid',
            uploadedAt: value.timestamp,
            sizeBytes: JSON.stringify(value.data).length
          };
          pageCount++;
        }
      }
    }
    statuses['recently-completed'].totalPages = pageCount;
  }
  
  return {
    overview: {
      totalSections: Object.keys(SECTIONS).length,
      valid: validCount,
      expired: expiredCount,
      missing: missingCount,
      totalSizeBytes: totalSize,
      ttlSeconds: TTL_SECONDS,
      storageType: blobAvailable ? 'vercel-blob' : 'memory-fallback',
      blobConfigured: blobAvailable
    },
    sections: statuses,
    generatedAt: new Date().toISOString()
  };
}

/**
 * List all cached items
 */
async function listCache() {
  if (blobAvailable) {
    try {
      const { blobs } = await list({ prefix: CACHE_PREFIX });
      
      const items = blobs.map(blob => ({
        pathname: blob.pathname.replace(CACHE_PREFIX, ''),
        url: blob.url,
        sizeBytes: blob.size,
        uploadedAt: blob.uploadedAt,
        isExpired: isExpired(blob.uploadedAt),
        secondsUntilExpiry: getSecondsUntilExpiry(blob.uploadedAt)
      }));
      
      return {
        count: items.length,
        items: items.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))
      };
      
    } catch (error) {
      return {
        count: 0,
        items: [],
        error: error.message
      };
    }
  } else {
    // List from memory
    const items = [];
    for (const [key, value] of memoryStore.entries()) {
      items.push({
        pathname: key.replace(CACHE_PREFIX, ''),
        sizeBytes: JSON.stringify(value.data).length,
        uploadedAt: value.timestamp,
        isExpired: isExpired(value.timestamp),
        secondsUntilExpiry: getSecondsUntilExpiry(value.timestamp),
        source: 'memory'
      });
    }
    
    return {
      count: items.length,
      items: items.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt)),
      _note: 'Memory fallback - items lost on serverless restart'
    };
  }
}

/**
 * Clear cache for a specific section
 */
async function clearCache(section) {
  const blobKey = getBlobKey(section);
  
  if (blobAvailable) {
    try {
      await del(blobKey);
      return {
        message: `Cleared cache for: ${section}`,
        section,
        cleared: true
      };
    } catch (error) {
      return {
        message: `Failed to clear cache for: ${section}`,
        section,
        cleared: false,
        error: error.message
      };
    }
  } else {
    // Clear from memory
    const deleted = memoryStore.delete(blobKey);
    return {
      message: deleted 
        ? `Cleared memory cache for: ${section}`
        : `No cache found for: ${section}`,
      section,
      cleared: deleted,
      _note: 'Memory fallback'
    };
  }
}

/**
 * Clear ALL cache
 */
async function clearAllCache() {
  if (blobAvailable) {
    try {
      const { blobs } = await list({ prefix: CACHE_PREFIX });
      
      let cleared = 0;
      let failed = 0;
      
      for (const blob of blobs) {
        try {
          await del(blob.pathname);
          cleared++;
        } catch (error) {
          failed++;
          console.error(`[Blob Cache] Failed to delete: ${blob.pathname}`, error.message);
        }
      }
      
      return {
        message: 'Cleared all cache',
        totalItems: blobs.length,
        cleared,
        failed
      };
      
    } catch (error) {
      return {
        message: 'Failed to clear cache',
        error: error.message
      };
    }
  } else {
    // Clear all from memory
    const count = memoryStore.size;
    memoryStore.clear();
    
    return {
      message: 'Cleared all memory cache',
      totalItems: count,
      cleared: count,
      failed: 0,
      _note: 'Memory fallback cleared'
    };
  }
}
