// ═══════════════════════════════════════════════════════════════════
// VERCEL BLOB CACHE API - Simple Raw JSON Caching System
// 
// Features:
// - Stores COMPLETE raw JSON responses from TMDB/AniList/TVMaze APIs
// - 6-hour TTL (Time-To-Live) auto-expiry
// - Special pagination support for "recently-completed" section
// - Works with existing proxy setup (t-umi, aniocen, etc.)
//
// Actions: read, write, status, clear, list, init
// ═══════════════════════════════════════════════════════════════════

import { put, head, del, list } from '@vercel/blob';

// ─────────────────────────────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────────────────────────────

const CACHE_PREFIX = 'cache/';
const META_KEY = 'cache/_meta/status.json';
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
 * Check if cache is expired based on metadata
 */
function isExpired(metadata) {
  if (!metadata) return true;
  
  const uploadedAt = new Date(metadata.uploadedAt);
  const expiresAt = new Date(uploadedAt.getTime() + (TTL_SECONDS * 1000));
  return new Date() > expiresAt;
}

/**
 * Calculate seconds until expiry
 */
function getSecondsUntilExpiry(metadata) {
  if (!metadata) return 0;
  
  const uploadedAt = new Date(metadata.uploadedAt);
  const expiresAt = new Date(uploadedAt.getTime() + (TTL_SECONDS * 1000));
  const remaining = Math.floor((expiresAt - new Date()) / 1000);
  return Math.max(0, remaining);
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

  const startTime = Date.now();
  
  try {
    const { action, section, data, page } = req.body || {};
    
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
        
      default:
        return res.status(400).json({
          success: false,
          error: 'Invalid action',
          validActions: ['read', 'write', 'status', 'list', 'clear', 'clear-all']
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
        ttlSeconds: TTL_SECONDS
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
        responseTimeMs: duration
      }
    });
  }
}

// ─────────────────────────────────────────────────────────────────────
// CACHE OPERATIONS
// ─────────────────────────────────────────────────────────────────────

/**
 * Read cached data for a section
 */
async function readCache(section, page = null) {
  const blobKey = getBlobKey(section, page);
  
  try {
    // Check if blob exists and get metadata
    const metadata = await head(blobKey);
    
    if (!metadata) {
      return {
        data: null,
        found: false,
        reason: 'not_cached'
      };
    }
    
    // Check if expired
    if (isExpired(metadata)) {
      // Optionally delete expired cache
      // await del(blobKey);
      
      return {
        data: null,
        found: false,
        reason: 'expired',
        uploadedAt: metadata.uploadedAt,
        secondsUntilExpiry: 0
      };
    }
    
    // Note: We can't read blob content directly in serverless easily
    // Return metadata so client can fetch via URL or we stream it
    return {
      found: true,
      url: metadata.url,
      downloaded: false,
      uploadedAt: metadata.uploadedAt,
      sizeBytes: metadata.size,
      secondsUntilExpiry: getSecondsUntilExpiry(metadata),
      contentType: metadata.contentType
    };
    
  } catch (error) {
    // Blob doesn't exist
    return {
      data: null,
      found: false,
      reason: 'not_cached',
      error: error.message
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
  
  const blob = await put(blobKey, jsonString, {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false
  });
  
  console.log(`[Blob Cache] 💾 Stored: ${blobKey} (${jsonString.length} chars)`);
  
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
}

/**
 * Get cache status for a section or all sections
 */
async function getCacheStatus(section = null) {
  if (section) {
    // Status for specific section
    const blobKey = getBlobKey(section);
    
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
        status: isExpired(metadata) ? 'expired' : 'valid',
        uploadedAt: metadata.uploadedAt,
        sizeBytes: metadata.size,
        secondsUntilExpiry: getSecondsUntilExpiry(metadata),
        url: metadata.url
      };
      
    } catch (error) {
      return {
        section,
        found: false,
        status: 'error',
        error: error.message
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
    // Skip directory-style keys for now
    if (blobPath.endsWith('/')) continue;
    
    const blobKey = CACHE_PREFIX + blobPath;
    
    try {
      const metadata = await head(blobKey);
      
      if (metadata) {
        const valid = !isExpired(metadata);
        statuses[sectionName] = {
          found: true,
          status: valid ? 'valid' : 'expired',
          uploadedAt: metadata.uploadedAt,
          sizeBytes: metadata.size,
          secondsUntilExpiry: getSecondsUntilExpiry(metadata)
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
  }
  
  // Also check recently-completed pages
  statuses['recently-completed'] = { pages: {}, totalPages: 0 };
  try {
    const { blobs } = await list({ prefix: CACHE_PREFIX + 'recently-completed/' });
    const pageBlobs = blobs.filter(b => b.pathname.includes('page-'));
    statuses['recently-completed'].totalPages = pageBlobs.length;
    
    for (const pageBlob of pageBlobs) {
      const pageMatch = pageBlob.pathname.match(/page-(\d+)\.json$/);
      if (pageMatch) {
        const pageNum = pageMatch[1];
        statuses['recently-committed'].pages[pageNum] = {
          found: true,
          status: isExpired(pageBlob) ? 'expired' : 'valid',
          uploadedAt: pageBlob.uploadedAt,
          sizeBytes: pageBlob.size
        };
      }
    }
  } catch (error) {
    // No recently-completed pages cached yet
  }
  
  return {
    overview: {
      totalSections: Object.keys(SECTIONS).length,
      valid: validCount,
      expired: expiredCount,
      missing: missingCount,
      totalSizeBytes: totalSize,
      ttlSeconds: TTL_SECONDS
    },
    sections: statuses,
    generatedAt: new Date().toISOString()
  };
}

/**
 * List all cached items
 */
async function listCache() {
  try {
    const { blobs } = await list({ prefix: CACHE_PREFIX });
    
    const items = blobs.map(blob => ({
      pathname: blob.pathname.replace(CACHE_PREFIX, ''),
      url: blob.url,
      sizeBytes: blob.size,
      uploadedAt: blob.uploadedAt,
      isExpired: isExpired(blob),
      secondsUntilExpiry: getSecondsUntilExpiry(blob)
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
}

/**
 * Clear cache for a specific section
 */
async function clearCache(section) {
  const blobKey = getBlobKey(section);
  
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
}

/**
 * Clear ALL cache
 */
async function clearAllCache() {
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
}
