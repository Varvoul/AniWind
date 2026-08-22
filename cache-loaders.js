// ═══════════════════════════════════════════════════════════════════
// CACHE-AWARE SECTION LOADERS
// Wraps existing loaders to add read/write cache operations
// Add this script AFTER cache-integration.js in index.html
// ═══════════════════════════════════════════════════════════════════

(function() {
  'use strict';
  
  console.log('[Cache Loaders] 🚀 Initializing cache-aware section loaders...');
  
  // Wait for cache client to be ready
  function waitForCacheClient(maxAttempts = 50, interval = 100) {
    return new Promise((resolve, reject) => {
      let attempts = 0;
      
      const check = () => {
        attempts++;
        
        if (window.cacheClient && window.cacheClient.init) {
          console.log(`[Cache Loaders] ✅ Cache client ready after ${attempts} attempts`);
          resolve(true);
          return;
        }
        
        if (attempts >= maxAttempts) {
          console.warn('[Cache Loaders] ⚠️ Cache client not found after max attempts');
          resolve(false);
          return;
        }
        
        setTimeout(check, interval);
      };
      
      check();
    });
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // CACHE WRAPPER FUNCTION
  // Creates a cached version of any loader function
  // ═══════════════════════════════════════════════════════════════════
  
  function createCachedLoader(sectionName, originalLoader, options = {}) {
    const {
      renderFn = null,           // Render function name (string)
      enabled = true,
      debug = true
    } = options;
    
    return async function cachedLoader(...args) {
      if (!enabled || !window.cacheClient) {
        debug && console.log(`[Cache ${sectionName}] ⏭️ Cache disabled or unavailable, using original loader`);
        return originalLoader.apply(this, args);
      }
      
      const startTime = Date.now();
      
      try {
        // STEP 1: Try to load from cache
        const cachedData = await window.cacheClient.loadSection(sectionName);
        
        if (cachedData && cachedData.data) {
          const duration = Date.now() - startTime;
          debug && console.log(`[Cache ${sectionName}] ✅ CACHE HIT in ${duration}ms`);
          
          // Call render function with cached data
          if (renderFn && typeof window[renderFn] === 'function') {
            window[renderFn](cachedData.data);
          }
          
          return cachedData.data;
        }
        
        // STEP 2: Cache miss - fetch fresh data
        debug && console.log(`[Cache ${sectionName}] 💨 CACHE MISS, fetching fresh data...`);
        
        const freshData = await originalLoader.apply(this, args);
        
        // STEP 3: Write fresh data to cache
        if (freshData) {
          try {
            await window.cacheClient.writeSection(sectionName, freshData);
            const writeDuration = Date.now() - startTime;
            debug && console.log(`[Cache ${sectionName}] 💾 Cached successfully (${writeDuration}ms total)`);
          } catch (writeError) {
            console.warn(`[Cache ${sectionName}] ⚠️ Failed to cache data:`, writeError.message);
          }
        }
        
        return freshData;
        
      } catch (error) {
        console.error(`[Cache ${sectionName}] ❌ Error:`, error.message);
        
        // Fallback to original loader
        try {
          return originalLoader.apply(this, args);
        } catch (fallbackError) {
          console.error(`[Cache ${sectionName}] 💥 Fallback also failed:`, fallbackError.message);
          throw fallbackError;
        }
      }
    };
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // INJECT CACHED LOADERS INTO PAGE
  // Replaces global loader functions with cached versions
  // ═══════════════════════════════════════════════════════════════════
  
  async function injectCachedLoaders() {
    const hasCache = await waitForCacheClient();
    
    if (!hasCache) {
      console.warn('[Cache Loaders] ⚠️ Skipping injection - no cache client');
      return;
    }
    
    console.log('[Cache Loaders] 🔧 Injecting cached loaders...');
    
    // Store references to original functions
    const originalLoaders = {};
    
    // Define which loaders to wrap with their render functions
    const loadersToWrap = [
      { 
        name: 'loadHeroSlider', 
        section: 'heroSlider',
        renderFn: 'renderHeroSlider'
      },
      { 
        name: 'loadTopAiring', 
        section: 'topAiring',
        renderFn: 'renderTopAiring'
      },
      { 
        name: 'loadNewReleases', 
        section: 'newReleases',
        renderFn: null  // Has complex tab rendering, handle specially
      },
      { 
        name: 'loadUpcoming', 
        section: 'upcoming',
        renderFn: null  // Complex rendering
      }
    ];
    
    // Wrap each loader
    for (const loaderConfig of loadersToWrap) {
      const { name, section, renderFn } = loaderConfig;
      
      // Check if original function exists
      if (typeof window[name] === 'function') {
        // Store original
        originalLoaders[name] = window[name];
        
        // Create cached version
        window[name] = createCachedLoader(section, window[name], {
          renderFn: renderFn,
          debug: true
        });
        
        console.log(`[Cache Loaders] ✅ Wrapped: ${name} → cache section: ${section}`);
      } else {
        console.warn(`[Cache Loaders] ⚠️ Loader not found: ${name}`);
      }
    }
    
    // Store originals for debugging
    window._originalLoaders = originalLoaders;
    
    console.log('[Cache Loaders] ✅ All cached loaders injected successfully');
    console.log(`[Cache Loaders] 📦 Wrapped ${Object.keys(originalLoaders).length} loaders`);
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // MANUAL CACHE HELPERS
  // Functions to manually cache data after loading
  // ═══════════════════════════════════════════════════════════════════
  
  window.CacheHelpers = {
    /**
     * Manually cache data for a section
     * Use this inside your existing loaders after fetching data
     * 
     * @example
     * // Inside loadTopAiring() after getting data:
     * await CacheHelpers.cacheSection('topAiring', combinedData);
     */
    cacheSection: async function(sectionName, data) {
      if (!window.cacheClient) {
        console.warn('[Cache Helpers] ⚠️ Cache client not available');
        return false;
      }
      
      try {
        await window.cacheClient.writeSection(sectionName, data);
        console.log(`[Cache Helpers] ✅ Manually cached: ${sectionName}`);
        return true;
      } catch (error) {
        console.error(`[Cache Helpers] ❌ Failed to cache ${sectionName}:`, error.message);
        return false;
      }
    },
    
    /**
     * Try to load from cache, returns data or null
     * 
     * @example
     * const cached = await CacheHelpers.tryLoad('heroSlider');
     * if (cached) {
     *   renderHeroSlider(cached);  // Use cached data
     *   return;                   // Skip API call
     * }
     */
    tryLoad: async function(sectionName) {
      if (!window.cacheClient) {
        return null;
      }
      
      try {
        const result = await window.cacheClient.loadSection(sectionName);
        return result?.data || null;
      } catch (error) {
        console.warn(`[Cache Helpers] ⚠️ Failed to load ${sectionName}:`, error.message);
        return null;
      }
    },
    
    /**
     * Get current cache status
     */
    getStatus: function() {
      if (!window.cacheClient?.cacheStatus) {
        return { available: false };
      }
      
      return {
        available: true,
        valid: window.cacheClient.isCacheValid,
        status: window.cacheClient.cacheStatus?.status,
        sections: window.cacheClient.cacheStatus?.sections,
        loadedSections: Array.from(window.cacheClient.loadedSections),
        version: window.cacheClient.cacheVersion
      };
    }
  };
  
  // ═══════════════════════════════════════════════════════════════════
  // AUTO-INJECT ON DOM READY
  // ═══════════════════════════════════════════════════════════════════
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectCachedLoaders);
  } else {
    injectCachedLoaders();
  }
  
  console.log('[Cache Loaders] ✅ Module loaded');
  console.log('[Cache Loaders] 💡 Usage:');
  console.log('   - Automatic: Loaders are wrapped automatically');
  console.log('   - Manual: Use await CacheHelpers.cacheSection("sectionName", data)');
  console.log('   - Manual: Use const data = await CacheHelpers.tryLoad("sectionName")');
  
})();
