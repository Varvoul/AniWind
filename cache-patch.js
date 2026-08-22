// ═══════════════════════════════════════════════════════════════════
// CACHE INTEGRATION PATCH FOR HOME PAGE
// 
// INSTRUCTIONS:
// 1. Include cache-manager.js BEFORE this file
// 2. Include this file AFTER main home.js but BEFORE DOMContentLoaded
// 3. This patch modifies the init() function to add 6-hour interval caching
//
// FEATURES:
// ✅ Checks cache validity on page load (6-hour interval)
// ✅ Serves from DB when cache is valid (optimized for millions of users)
// ✅ Falls back to live APIs when cache expires/invalid
// ✅ Partial cache support (completes missing sections on next visit)
// ✅ Scroll-based lazy loading from DB (doesn't load all at once)
// ✅ Automatic cache refresh after 6 hours
// ✅ Console logging for debugging cache status
// ═══════════════════════════════════════════════════════════════════

(function() {
  'use strict';
  
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║     🚀 PROFESSIONAL CACHE SYSTEM - INTEGRATION PATCH     ║');
  console.log('║     Cache Interval: 6 hours | DB: Neon PostgreSQL       ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  
  // ═══════════════════════════════════════════════════════════════════
  // CACHE-AWARE SECTION LOADERS
  // These wrappers check cache first, then fall back to live API
  // ═══════════════════════════════════════════════════════════════════
  
  /**
   * Create a cached version of any section loader function
   * @param {string} sectionName - Name matching DB column
   * @param {Function} originalFn - Original load function
   * @param {Object} options - Additional options
   * @returns {Function} Cached loader function
   */
  function createCachedLoader(sectionName, originalFn, options = {}) {
    return async function(...args) {
      const startTime = performance.now();
      const tag = `[Cache:${sectionName}]`;
      
      console.log(`${tag} ▶️ Loading...`);
      
      // Check if we should use cache
      if (window._cacheValid) {
        console.log(`${tag} 📦 Attempting to serve from cache...`);
        
        try {
          const cachedData = await window.cacheManager.readFromCache(sectionName);
          
          if (cachedData && (cachedData[sectionName] || Array.isArray(cachedData))) {
            const data = cachedData[sectionName] || cachedData;
            const duration = Math.round(performance.now() - startTime);
            
            console.log(`${tag} ✅ Served from DB in ${duration}ms (${Array.isArray(data) ? data.length : 'object'} items)`);
            window._sectionsServedFromCache.add(sectionName);
            
            // If there's a custom render function for cached data, use it
            if (options.renderCached) {
              options.renderCached(data);
            }
            
            return data;
          }
        } catch (error) {
          console.warn(`${tag} ⚠️ Cache read failed:`, error.message);
        }
      }
      
      // Fall back to live API
      console.log(`${tag} 🌐 Fetching from live API...`);
      window._sectionsFetchedLive.add(sectionName);
      
      try {
        const result = await originalFn.apply(this, args);
        const duration = Math.round(performance.now() - startTime);
        
        console.log(`${tag} ✅ Live fetch complete in ${duration}ms`);
        
        // Cache the result asynchronously (non-blocking)
        if (result) {
          _cacheSectionData(sectionName, result);
        }
        
        return result;
        
      } catch (error) {
        console.error(`${tag} ❌ Load failed:`, error.message);
        throw error;
      }
    };
  }
  
  /**
   * Cache section data to DB (non-blocking)
   */
  async function _cacheSectionData(sectionName, data) {
    if (!data || !window.cacheManager) return;
    
    // Don't wait for cache write to complete - don't block UI
    window.cacheManager.writeToCache(sectionName, data).then(success => {
      if (success) {
        window.cacheManager.markSectionComplete(sectionName, true);
        console.log(`[Cache:${sectionName}] 💾 Saved to DB`);
      } else {
        window.cacheManager.markSectionComplete(sectionName, false);
        console.warn(`[Cache:${sectionName}] ⚠️ Failed to save`);
      }
    }).catch(err => {
      console.error(`[Cache:${sectionName}] ❌ Save error:`, err.message);
      window.cacheManager.markSectionComplete(sectionName, false);
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // INITIALIZATION MODIFICATION
  // Patches the init() function to add cache initialization
  // ═══════════════════════════════════════════════════════════════════
  
  // Store references to original functions before modification
  let _originalInit = null;
  
  /**
   * Apply the cache integration patch
   * Call this after defining init() but before DOMContentLoaded
   */
  window.applyCachePatch = async function() {
    console.log('[Cache Patch] 🔧 Applying integration patch...');
    
    // Initialize global state
    window._cacheValid = false;
    window._sectionsServedFromCache = new Set();
    window._sectionsFetchedLive = new Set();
    window._cacheInitTime = Date.now();
    
    // Step 1: Initialize cache manager and check status
    console.log('[Cache Patch] 🔍 Checking cache status...');
    
    try {
      const cacheStatus = await window.cacheManager.initialize();
      
      window._cacheValid = cacheStatus.isValid;
      
      if (cacheStatus.isValid) {
        console.log(`[Cache Patch] ✅ VALID CACHE FOUND`);
        console.log(`[Cache Patch]    Status: ${cacheStatus.data.status}`);
        console.log(`[Cache Patch]    Version: v${cacheStatus.data.version}`);
        console.log(`[Cache Patch]    Sections: ${cacheStatus.data.sections.completed}/${cacheStatus.data.sections.total}`);
        console.log(`[Cache Patch]    Expires in: ${_formatTime(cacheStatus.data.metrics.secondsUntilExpiry)}`);
        console.log(`[Cache Patch]    Hits: ${cacheStatus.data.metrics.hitCount.toLocaleString()} | Misses: ${cacheStatus.data.metrics.missCount}`);
        
        // Setup scroll-based lazy loading from DB
        if (window.cacheManager.state.isValid) {
          window.cacheManager._setupScrollBasedLoading();
          console.log('[Cache Patch] 👁️ Scroll-based DB loading enabled');
        }
        
      } else {
        console.log(`[Cache Patch] 🔄 NO VALID CACHE (${cacheStatus.data.status})`);
        console.log('[Cache Patch]    Will use live APIs + capture results for caching');
        
        if (cacheStatus.data.status === 'partial') {
          console.warn('[Cache Patch] ⚠️ PARTIAL CACHE - some sections missing:');
          _logMissingSections(cacheStatus.data.sections.details);
        }
      }
      
    } catch (error) {
      console.error('[Cache Patch] ❌ Cache init failed:', error.message);
      console.log('[Cache Patch]    Falling back to live APIs without caching');
      window._cacheValid = false;
    }
    
    // Step 2: Setup event listeners for cache operations
    _setupCacheEvents();
    
    console.log('[Cache Patch] ✅ Patch applied successfully');
    return window._cacheValid;
  };
  
  /**
   * Setup event listeners for cache operations
   */
  function _setupCacheEvents() {
    // Listen for cache refresh completion
    document.addEventListener('cacheRefreshComplete', (event) => {
      const { isFullyComplete, completed, failed, failedSections } = event.detail;
      
      console.log('╔══════════════════════════════════════════════════════════╗');
      console.log('║           📊 CACHE REFRESH COMPLETE                      ║');
      console.log('╚══════════════════════════════════════════════════════════╝');
      console.log(`   Status: ${isFullyComplete ? '✅ FULL' : '⚠️ PARTIAL'}`);
      console.log(`   Completed: ${completed}/10 sections`);
      
      if (!isFullyComplete && failedSections.length > 0) {
        console.log(`   Failed: ${failedSections.join(', ')}`);
        console.log('   These will be retried on next page load.');
      }
      
      // Update local state
      if (isFullyComplete) {
        window._cacheValid = true;
      }
    });
    
    // Listen for individual section completions
    document.addEventListener('sectionCached', (event) => {
      const { section, success, itemCount } = event.detail;
      const icon = success ? '✅' : '❌';
      console.log(`[Cache Progress] ${icon} ${section}${itemCount ? ` (${itemCount} items)` : ''}`);
    });
  }
  
  function _logMissingSections(details) {
    if (!details) return;
    
    const missing = Object.entries(details)
      .filter(([name, cached]) => !cached)
      .map(([name]) => name);
    
    if (missing.length > 0) {
      console.table(missing.map(name => ({ 
        'Missing Section': name, 
        'Will Load From': 'Live API',
        'Then Cache': '✅ Yes'
      })));
    }
  }
  
  function _formatTime(seconds) {
    if (!seconds || seconds < 0) return 'EXPIRED';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m ${seconds % 60}s`;
  }

  // ═══════════════════════════════════════════════════════════════════
  // HELPER: Get cached loader for a specific section
  // Usage: const cachedLoadHero = getCachedLoader('heroSlider', loadHero);
  // ═══════════════════════════════════════════════════════════════════
  
  window.getCachedLoader = function(sectionName, originalFn, options) {
    return createCachedLoader(sectionName, originalFn, options);
  };
  
  /**
   * Get current cache integration status
   */
  window.getCacheStatus = function() {
    return {
      enabled: !!window.cacheManager,
      valid: window._cacheValid,
      servedFromCache: Array.from(window._sectionsServedFromCache || []),
      fetchedLive: Array.from(window._sectionsFetchedLive || []),
      managerStatus: window.cacheManager?.getStatusSummary(),
      uptime: Date.now() - window._cacheInitTime
    };
  };
  
  /**
   * Manually trigger cache refresh (for admin/testing)
   */
  window.refreshCache = async function() {
    console.log('[Manual Refresh] 🔄 Forcing cache refresh...');
    window._cacheValid = false;
    
    if (window.cacheManager) {
      await window.cacheManager.refreshCache();
    }
    
    // Reload page to pick up fresh data
    setTimeout(() => {
      window.location.reload();
    }, 1000);
  };

  console.log('[Cache Patch] ✨ Patch loaded. Call applyCachePatch() in init()');
  console.log('[Cache Patch]    Available: window.getCachedLoader(), window.getCacheStatus(), window.refreshCache()');
  
})();
