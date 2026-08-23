// ═══════════════════════════════════════════════════════════════════
// BLOB CACHE INTEGRATION - Auto-caches all API responses
// 
// This script WRAPS your existing data loading functions to:
// 1. Check Vercel Blob Cache FIRST before fetching
// 2. Return cached data if valid (speeds up page load!)
// 3. Store fresh API responses in cache for next visit
//
// Load this AFTER blob-cache-client.js and shared.js
// ═══════════════════════════════════════════════════════════════════

(function() {
  'use strict';
  
  console.log('[Cache Integration] 🚀 Initializing auto-cache system...');
  
  // Wait for BlobCache to be available
  function waitForBlobCache(callback, maxAttempts = 10) {
    let attempts = 0;
    
    const check = () => {
      attempts++;
      
      if (window.BlobCache) {
        console.log(`[Cache Integration] ✅ BlobCache ready after ${attempts} attempts`);
        callback();
        return;
      }
      
      if (attempts >= maxAttempts) {
        console.warn('[Cache Integration] ⚠️ BlobCache not found, running without cache');
        callback(); // Continue anyway, just won't cache
        return;
      }
      
      setTimeout(check, 100);
    };
    
    check();
  }
  
  // ─────────────────────────────────────────────────────────────────────
  // CACHED FETCH WRAPPER
  // ─────────────────────────────────────────────────────────────────────
  
  /**
   * Wrap a fetch function with automatic caching
   * @param {string} sectionName - Cache section key
   * @param {Function} originalFetch - The original async fetch function
   * @param {Object} options - Options {page, forceRefresh}
   * @returns {Promise} - The data (from cache or fresh)
   */
  function withCache(sectionName, originalFetch, options = {}) {
    return async function(...args) {
      const startTime = performance.now();
      
      // If BlobCache not available, just call original
      if (!window.BlobCache) {
        console.log(`[Cache] ⏭️ No cache client, fetching fresh: ${sectionName}`);
        return originalFetch.apply(this, args);
      }
      
      const { page = null, forceRefresh = false } = options;
      
      try {
        // STEP 1: Try to read from cache
        if (!forceRefresh) {
          const cached = await window.BlobCache.read(sectionName, page);
          
          if (cached.found && cached.data) {
            const duration = Math.round(performance.now() - startTime);
            console.log(`[Cache] 🎯 HIT: ${sectionName}${page ? ` (p${page})` : ''} (${duration}ms)`);
            
            // Return cached data (it's already parsed JSON)
            return cached.data;
          }
        }
        
        // STEP 2: Cache miss or forced refresh - fetch fresh data
        console.log(`[Cache] 🔄 MISS: ${sectionName}${page ? ` (p${page})` : ''} - fetching fresh...`);
        
        const freshData = await originalFetch.apply(this, args);
        
        // STEP 3: Store in cache for next time
        if (freshData) {
          try {
            await window.BlobCache.write(sectionName, freshData, page);
            const duration = Math.round(performance.now() - startTime);
            console.log(`[Cache] 💾 STORED: ${sectionName}${page ? ` (p${page})` : ''} (${duration}ms)`);
          } catch (cacheError) {
            console.warn(`[Cache] ⚠️ Failed to cache ${sectionName}:`, cacheError.message);
          }
        }
        
        return freshData;
        
      } catch (error) {
        console.error(`[Cache] ❌ Error in ${sectionName}:`, error);
        // If cache fails, still try to get fresh data
        return originalFetch.apply(this, args);
      }
    };
  }
  
  // ─────────────────────────────────────────────────────────────────────
  // INTEGRATION: Wrap existing loading functions
  // ─────────────────────────────────────────────────────────────────────
  
  function integrateWithExistingLoaders() {
    console.log('[Cache Integration] 🔧 Wrapping existing loaders with cache...');
    
    let wrappedCount = 0;
    
    // Helper to safely wrap a function
    function wrapIfExists(obj, funcName, sectionName, options = {}) {
      if (obj && typeof obj[funcName] === 'function') {
        const original = obj[funcName].bind(obj);
        obj[funcName] = withCache(sectionName, original, options);
        wrappedCount++;
        console.log(`[Cache] ✅ Wrapped: ${funcName} → ${sectionName}`);
        return true;
      }
      return false;
    }
    
    // Try to wrap common global functions
    // These are the main data loaders in your index.html
    
    if (typeof window !== 'undefined') {
      // Hero Slider
      wrapIfExists(window, 'loadHeroSlider', 'hero-slider');
      
      // Top Airing
      wrapIfExists(window, 'loadTopAiring', 'top-airing');
      
      // New Releases (various tabs)
      wrapIfExists(window, 'loadNewReleases', 'new-releases-all');
      
      // Upcoming sections
      wrapIfExists(window, 'loadUpcoming', 'upcoming-movies');
      
      // Recently Completed (paginated)
      wrapIfExists(window, 'loadRecentlyCompleted', 'recently-completed', { supportsPagination: true });
      
      // Trending
      wrapIfExists(window, 'loadTrending', 'trending-today');
      
      // Most Favourite / Popular
      wrapIfExists(window, 'loadMostFavourite', 'most-favourite');
      wrapIfExists(window, 'loadPopularAnime', 'popular-anime');
      
      // Schedule
      wrapIfExists(window, 'loadSchedule', 'schedule-monday');
    }
    
    console.log(`[Cache Integration] ✅ Wrapped ${wrappedCount} functions with cache`);
    return wrappedCount;
  }
  
  // ─────────────────────────────────────────────────────────────────────
  // FETCH INTERCEPTOR (Alternative approach)
  // Intercepts specific API URLs and caches responses
  // ─────────────────────────────────────────────────────────────────────
  
  function setupFetchInterceptor() {
    if (!window.BlobCache) return;
    
    const originalFetch = window.fetch;
    const cacheablePatterns = [
      // TMDB API patterns (via proxy)
      /t-umi\.bionmovies47\.workers\.dev.*\/(tv\/on_the_air|trending|discover|upcoming)/,
      /aniocen\.bionmovies47\.workers\.dev/,
      // AniList
      /graphql\.anilist\.co/,
      /aniumi\.bionmovies47\.workers\.dev.*anilist/,
      // TVMaze
      /tvmaze\.com/,
      // Jikan
      /api\.jikan\.moe/,
      /aniumi\.bionmovies47\.workers\.dev.*jikan/,
      // Anikoto
      /anikoto\.bionmovies47\.workers\.dev/
    ];
    
    /**
     * Determine cache section name from URL
     */
    function getSectionFromUrl(url) {
      if (url.includes('on_the_air') || url.includes('tv/on_the_air')) return 'hero-slider';
      if (url.includes('trending/day') || url.includes('trending/all/day')) return 'trending-today';
      if (url.includes('trending/week') || url.includes('trending/all/week')) return 'trending-week';
      if (url.includes('upcoming')) return url.includes('movie') ? 'upcoming-movies' : 'upcoming-tv';
      if (url.includes('anilist') || url.includes('graphql.anilist')) {
        if (url.includes('RELEASING') || url.includes('airing')) return 'top-airing';
        if (url.includes('POPULARITY_DESC')) return 'popular-anime';
        if (url.includes('SCORE_DESC')) return 'most-favourite';
      }
      if (url.includes('tvmaze')) return 'top-airing';
      if (url.includes('jikan')) return 'new-releases-anime';
      if (url.includes('anikoto') || url.includes('recent-anime')) return 'new-on-rowana';
      
      return null; // Not cacheable
    }
    
    /**
     * Check if URL should be cached
     */
    function shouldCacheUrl(url) {
      return cacheablePatterns.some(pattern => pattern.test(url));
    }
    
    // Replace fetch with cached version (only for GET requests to cacheable URLs)
    window.fetch = async function(input, init) {
      const url = typeof input === 'string' ? input : input.url;
      const method = (init && init.method) || 'GET';
      
      // Only cache GET requests to known API endpoints
      if (method === 'GET' && url && shouldCacheUrl(url)) {
        const section = getSectionFromUrl(url);
        
        if (section && window.BlobCache) {
          try {
            // Try cache first
            const cached = await window.BlobCache.read(section);
            
            if (cached.found && cached.data) {
              console.log(`[Cache Interceptor] 🎯 HIT: ${section}`);
              return new Response(JSON.stringify(cached.data), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
              });
            }
            
            // Cache miss - do real fetch
            console.log(`[Cache Interceptor] 🔄 MISS: ${section}`);
            const response = await originalFetch.call(this, input, init);
            
            // Clone response to cache it (without consuming original)
            if (response.ok) {
              try {
                const clone = response.clone();
                const data = await clone.json();
                
                // Store in cache asynchronously (don't block response)
                window.BlobCache.write(section, data).catch(e => 
                  console.warn('[Cache Interceptor] ⚠️ Cache write failed:', e.message)
                );
              } catch (e) {
                // Non-JSON response, skip caching
              }
            }
            
            return response;
            
          } catch (error) {
            console.warn('[Cache Interceptor] ⚠️ Error, falling back to direct fetch:', error.message);
            return originalFetch.call(this, input, init);
          }
        }
      }
      
      // For non-cacheable requests, use original fetch
      return originalFetch.call(this, input, init);
    };
    
    console.log('[Cache Integration] ✅ Fetch interceptor installed');
  }
  
  // ─────────────────────────────────────────────────────────────────────
  // MANUAL CACHE HELPERS (exposed for manual use)
  // ─────────────────────────────────────────────────────────────────────
  
  window.CacheHelpers = {
    /**
     * Manually cache a section's data
     */
    cacheSection: async function(sectionName, data, page = null) {
      if (!window.BlobCache) {
        console.warn('[CacheHelpers] ⚠️ BlobCache not available');
        return false;
      }
      
      try {
        await window.BlobCache.write(sectionName, data, page);
        console.log(`[CacheHelpers] ✅ Cached: ${sectionName}`);
        return true;
      } catch (e) {
        console.error(`[CacheHelpers] ❌ Failed to cache ${sectionName}:`, e);
        return false;
      }
    },
    
    /**
     * Manually retrieve cached section data
     */
    tryLoad: async function(sectionName, page = null) {
      if (!window.BlobCache) return null;
      
      try {
        const result = await window.BlobCache.read(sectionName, page);
        return result.found ? result.data : null;
      } catch (e) {
        console.error(`[CacheHelpers] ❌ Failed to load ${sectionName}:`, e);
        return null;
      }
    },
    
    /**
     * Force refresh a section (clear cache, fetch new)
     */
    forceRefresh: async function(sectionName, fetchFn, page = null) {
      if (!window.BlobCache) return fetchFn();
      
      try {
        // Clear existing cache first
        await window.BlobCache.clear(sectionName);
        
        // Fetch fresh data
        const data = await fetchFn();
        
        // Store in cache
        await window.BlobCache.write(sectionName, data, page);
        
        console.log(`[CacheHelpers] 🔄 Force refreshed: ${sectionName}`);
        return data;
      } catch (e) {
        console.error(`[CacheHelpers] ❌ Force refresh failed:`, e);
        return fetchFn(); // Fallback to original
      }
    },
    
    /**
     * Get current cache status
     */
    getStatus: async function() {
      if (!window.BlobCache) return null;
      
      try {
        return await window.BlobCache.status();
      } catch (e) {
        console.error('[CacheHelpers] ❌ Status check failed:', e);
        return null;
      }
    },
    
    /**
     * Clear all cache
     */
    clearAll: async function() {
      if (!window.BlobCache) return false;
      
      try {
        await window.BlobCache.clearAll();
        console.log('[CacheHelpers] 🗑️ All cache cleared');
        return true;
      } catch (e) {
        console.error('[CacheHelpers] ❌ Clear failed:', e);
        return false;
      }
    }
  };
  
  // ─────────────────────────────────────────────────────────────────────
  // INITIALIZATION
  // ─────────────────────────────────────────────────────────────────────
  
  waitForBlobCache(() => {
    console.log('[Cache Integration] 🚀 Starting integration...');
    
    // Method 1: Try to wrap existing loader functions
    const wrappedCount = integrateWithExistingLoaders();
    
    // Method 2: Install fetch interceptor (catches all API calls)
    setupFetchInterceptor();
    
    console.log(`[Cache Integration] ✅ Initialization complete`);
    console.log(`[Cache Integration] 📊 Wrapped ${wrappedCount} functions + fetch interceptor active`);
    console.log(`[Cache Integration] 💡 Usage:`);
    console.log(`    - Automatic: All TMDB/AniList/TVMaze/Jikan API calls will be cached`);
    console.log(`    - Manual: Use CacheHelpers.cacheSection("name", data)`);
    console.log(`    - Manual: Use CacheHelpers.tryLoad("name") to retrieve`);
    console.log(`    - Status: Use CacheHelpers.getStatus() to see all cached sections`);
  });
  
})();

console.log('✅ [Cache Integration] Module loaded');
console.log('    Auto-integration will start once BlobCache is ready');
