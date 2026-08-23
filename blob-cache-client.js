// ═══════════════════════════════════════════════════════════════════
// VERCEL BLOB CACHE CLIENT - Frontend Integration
// 
// Simple client for caching raw API responses in Vercel Blob
// Integrates with existing TMDB/AniList/TVMaze/Anikoto APIs
//
// Usage:
//   const cached = await BlobCache.read('hero-slider');
//   if (cached.found) { use cached data }
//   else { fetch from API, then BlobCache.write('hero-slider', data) }
// ═══════════════════════════════════════════════════════════════════

class VercelBlobCacheClient {
  constructor(options = {}) {
    this.apiEndpoint = options.apiEndpoint || '/api/blob-cache';
    this.ttl = options.ttl || (6 * 60 * 60 * 1000); // 6 hours in ms
    this.debug = options.debug || false;
    
    // Cache status tracking
    this.cacheStatus = {};
    this.lastStatusCheck = null;
    
    this.log('✅ Vercel Blob Cache Client initialized');
  }
  
  // ─────────────────────────────────────────────────────────────────
  // CORE METHODS
  // ─────────────────────────────────────────────────────────────────
  
  /**
   * Read cached data for a section
   * @param {string} section - Section name (e.g., 'hero-slider')
   * @param {number} page - Page number (for paginated sections like 'recently-completed')
   * @returns {Promise<Object>} Cache result
   */
  async read(section, page = null) {
    try {
      this.log(`📖 Reading cache: ${section}${page ? ` (page ${page})` : ''}`);
      
      const response = await fetch(this.apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'read',
          section: section,
          page: page
        })
      });
      
      const result = await response.json();
      
      if (result.success && result.data?.found && !result.data.reason) {
        this.log(`✅ Cache HIT: ${section}`);
        
        // Fetch the actual data from the URL
        if (result.data.url) {
          const dataResponse = await fetch(result.data.url);
          const jsonData = await dataResponse.json();
          
          return {
            found: true,
            data: jsonData,
            source: 'blob-cache',
            uploadedAt: result.data.uploadedAt,
            secondsUntilExpiry: result.data.secondsUntilExpiry,
            sizeBytes: result.data.sizeBytes
          };
        }
      }
      
      this.log(`⚠️ Cache MISS: ${section} (${result.data?.reason || 'unknown'})`);
      return {
        found: false,
        reason: result.data?.reason || 'unknown'
      };
      
    } catch (error) {
      this.log(`❌ Error reading cache: ${error.message}`);
      return { found: false, error: error.message };
    }
  }
  
  /**
   * Write data to cache (stores RAW JSON)
   * @param {string} section - Section name
   * @param {*} rawData - Raw data to cache (will be JSON.stringified)
   * @param {number} page - Page number (optional)
   * @returns {Promise<Object>} Write result
   */
  async write(section, rawData, page = null) {
    try {
      this.log(`💾 Writing cache: ${section}${page ? ` (page ${page})` : ''} (${this.getDataSize(rawData)})`);
      
      const response = await fetch(this.apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'write',
          section: section,
          data: rawData, // Send raw - server will stringify
          page: page
        })
      });
      
      const result = await response.json();
      
      if (result.success) {
        this.log(`✅ Cached successfully: ${section}`);
        
        // Update local status
        this.cacheStatus[section] = {
          status: 'valid',
          updatedAt: new Date().toISOString(),
          sizeBytes: result.sizeBytes
        };
      } else {
        this.log(`❌ Failed to cache: ${result.error}`);
      }
      
      return result;
      
    } catch (error) {
      this.log(`❌ Error writing cache: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
  
  /**
   * Get data from cache OR fetch from source (with automatic caching)
   * @param {string} section - Section name
   * @param {Function} fetchFn - Async function that fetches fresh data
   * @param {Object} options - Options (page, forceRefresh, etc.)
   * @returns {Promise<*>} Data (from cache or fresh)
   */
  async getOrFetch(section, fetchFn, options = {}) {
    const { page = null, forceRefresh = false } = options;
    
    // If not forcing refresh, try cache first
    if (!forceRefresh) {
      const cached = await this.read(section, page);
      
      if (cached.found) {
        this.log(`🎯 Serving ${section} from BLOB CACHE`);
        return {
          data: cached.data,
          source: 'cache',
          cached: true
        };
      }
    }
    
    // Cache miss or forced refresh - fetch fresh data
    this.log(`🔄 Fetching fresh data for: ${section}`);
    
    try {
      const freshData = await fetchFn();
      
      // Cache the fresh data
      await this.write(section, freshData, page);
      
      return {
        data: freshData,
        source: 'fresh',
        cached: false
      };
      
    } catch (error) {
      this.log(`❌ Failed to fetch ${section}: ${error.message}`);
      throw error;
    }
  }
  
  // ─────────────────────────────────────────────────────────────────
  // STATUS & MANAGEMENT
  // ─────────────────────────────────────────────────────────────────
  
  /**
   * Get cache status for a section or all sections
   */
  async status(section = null) {
    try {
      const response = await fetch(this.apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'status',
          section: section
        })
      });
      
      const result = await response.json();
      
      if (result.success) {
        this.cacheStatus = result.sections || {};
        this.lastStatusCheck = new Date().toISOString();
      }
      
      return result;
      
    } catch (error) {
      this.log(`❌ Error getting status: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
  
  /**
   * Clear cache for a section
   */
  async clear(section) {
    try {
      const response = await fetch(this.apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'clear',
          section: section
        })
      });
      
      const result = await response.json();
      
      if (result.success) {
        this.log(`🗑️ Cleared cache: ${section}`);
        delete this.cacheStatus[section];
      }
      
      return result;
      
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  
  /**
   * Clear ALL cache
   */
  async clearAll() {
    try {
      const response = await fetch(this.apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'clear-all' })
      });
      
      const result = await response.json();
      
      if (result.success) {
        this.log('🗑️ Cleared ALL cache');
        this.cacheStatus = {};
      }
      
      return result;
      
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  
  // ─────────────────────────────────────────────────────────────────
  // CONVENIENCE METHODS FOR SPECIFIC SECTIONS
  // ─────────────────────────────────────────────────────────────────
  
  /**
   * Cache hero slider data
   */
  async getHeroSlider(fetchFn) {
    return this.getOrFetch('hero-slider', fetchFn);
  }
  
  /**
   * Cache top airing data
   */
  async getTopAiring(fetchFn) {
    return this.getOrFetch('top-airing', fetchFn);
  }
  
  /**
   * Cache new releases data (all tabs)
   */
  async getNewReleases(tab, fetchFn) {
    const sectionMap = {
      'all': 'new-releases-all',
      'anime': 'new-releases-anime',
      'movie': 'new-releases-movie',
      'series': 'new-releases-series',
      'hidden': 'new-releases-hidden'
    };
    
    const section = sectionMap[tab] || 'new-releases-all';
    return this.getOrFetch(section, fetchFn);
  }
  
  /**
   * Cache "New on Rowana" data
   */
  async getNewOnRowana(fetchFn) {
    return this.getOrFetch('new-on-rowana', fetchFn);
  }
  
  /**
   * Cache upcoming movies
   */
  async getUpcomingMovies(fetchFn) {
    return this.getOrFetch('upcoming-movies', fetchFn);
  }
  
  /**
   * Cache upcoming TV
   */
  async getUpcomingTV(fetchFn) {
    return this.getOrFetch('upcoming-tv', fetchFn);
  }
  
  /**
   * Cache recently completed (PAGINATED)
   * @param {number} page - Page number
   * @param {Function} fetchFn - Fetch function for this page
   */
  async getRecentlyCompleted(page, fetchFn) {
    return this.getOrFetch('recently-completed', fetchFn, { page });
  }
  
  /**
   * Cache trending data (3 tabs)
   */
  async getTrending(period, fetchFn) {
    const periodMap = {
      'today': 'trending-today',
      'week': 'trending-week',
      'month': 'trending-month'
    };
    
    const section = periodMap[period] || 'trending-today';
    return this.getOrFetch(section, fetchFn);
  }
  
  /**
   * Cache most favourite data
   */
  async getMostFavourite(fetchFn) {
    return this.getOrFetch('most-favourite', fetchFn);
  }
  
  /**
   * Cache popular anime data
   */
  async getPopularAnime(fetchFn) {
    return this.getOrFetch('popular-anime', fetchFn);
  }
  
  /**
   * Cache schedule data (by day)
   * @param {string} day - Day name (monday, tuesday, etc.)
   * @param {Function} fetchFn - Fetch function
   */
  async getSchedule(day, fetchFn) {
    const dayLower = day.toLowerCase();
    const section = `schedule-${dayLower}`;
    return this.getOrFetch(section, fetchFn);
  }
  
  // ─────────────────────────────────────────────────────────────────
  // UTILITY METHODS
  // ─────────────────────────────────────────────────────────────────
  
  /**
   * Estimate data size for logging
   */
  getDataSize(data) {
    try {
      const json = typeof data === 'string' ? data : JSON.stringify(data);
      const bytes = new Blob([json]).size;
      
      if (bytes < 1024) return `${bytes}B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
      return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
    } catch {
      return 'unknown size';
    }
  }
  
  /**
   * Conditional logging
   */
  log(...args) {
    if (this.debug) {
      console.log('[Blob Cache]', ...args);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
// GLOBAL INSTANCE & EXPORTS
// ─────────────────────────────────────────────────────────────────────

// Create global instance (singleton)
window.BlobCache = new VercelBlobCacheClient({
  apiEndpoint: '/api/blob-cache',
  ttl: 6 * 60 * 60 * 1000, // 6 hours
  debug: true // Enable console logging
});

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { VercelBlobCacheClient };
}

console.log('✅ [Blob Cache] Module loaded');
console.log('    Use: window.BlobCache.read("section")');
console.log('    Use: window.BlobCache.write("section", data)');
console.log('    Use: window.BlobCache.getHeroSlider(fetchFn)');
console.log('    Use: window.BlobCache.status()');
