// ═══════════════════════════════════════════════════════════════════
// CACHE INTEGRATION FOR INDEX.HTML
// Connects ProfessionalCacheClient to existing section loaders
// Implements: Cache-first loading, progressive serving, auto-write
// ═══════════════════════════════════════════════════════════════════

(function() {
  'use strict';
  
  // ═══════════════════════════════════════════════════════════════════
  // GLOBAL CACHE INSTANCE
  // Available throughout the application
  // ═══════════════════════════════════════════════════════════════════
  
  window.cacheClient = new ProfessionalCacheClient({
    apiEndpoint: '/api/cache',
    debug: true // Set to false in production
  });
  
  // Track if we're in a refresh cycle (cache expired)
  window.isRefreshingCache = false;
  window.cacheRefreshProgress = {
    total: 10,
    completed: 0,
    sections: {}
  };
  
  // ═══════════════════════════════════════════════════════════════════
  // CACHE-AWARE SECTION LOADER
  // Wrapper for existing load functions to add caching
  // ═══════════════════════════════════════════════════════════════════
  
  /**
   * Create a cached version of any section loader
   * @param {string} sectionName - Cache section name (e.g., 'heroSlider')
   * @param {Function} originalLoader - Original async load function
   * @param {Object} options - Configuration options
   * @returns {Function} Cached loader function
   */
  function createCachedLoader(sectionName, originalLoader, options = {}) {
    const {
      enabled = true,           // Enable/disable caching for this section
      ttl = null,               // Custom TTL (overrides global)
      transformFn = null,       // Transform data before caching
      validateFn = null         // Validate cached data before using
    } = options;
    
    return async function cachedLoader(...args) {
      if (!enabled) {
        return originalLoader.apply(this, args);
      }
      
      const startTime = Date.now();
      
      try {
        // 1. Try to load from cache first
        const cachedData = await window.cacheClient.loadSection(sectionName);
        
        if (cachedData) {
          // Validate cached data if validator provided
          if (validateFn && !validateFn(cachedData)) {
            console.log(`[Cache Integration] ⚠️ Invalid cached data for ${sectionName}, fetching fresh`);
            throw new Error('Invalid cache');
          }
          
          console.log(`[Cache Integration] ✅ ${sectionName}: CACHE HIT (${Date.now() - startTime}ms)`);
          
          // Return cached data (transformed if needed)
          return transformFn ? transformFn(cachedData) : cachedData;
        }
        
        // 2. Cache miss - fetch from original source
        console.log(`[Cache Integration] 💨 ${sectionName}: CACHE MISS, fetching from API`);
        const freshData = await originalLoader.apply(this, args);
        
        // 3. Write fresh data to cache
        if (freshData) {
          const dataToCache = transformFn ? transformFn(freshData) : freshData;
          await window.cacheClient.writeSection(sectionName, dataToCache);
          
          // Update refresh progress
          updateRefreshProgress(sectionName, true);
        }
        
        console.log(`[Cache Integration] 🆕 ${sectionName}: Fresh data fetched & cached (${Date.now() - startTime}ms)`);
        
        return freshData;
        
      } catch (error) {
        console.error(`[Cache Integration] ❌ ${sectionName} error:`, error.message);
        
        // Fallback to original loader on error
        try {
          return originalLoader.apply(this, args);
        } catch (fallbackError) {
          console.error(`[Cache Integration] 💥 ${sectionName} fallback failed:`, fallbackError.message);
          throw fallbackError;
        }
      }
    };
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // REFRESH PROGRESS TRACKING
  // Shows cache completion percentage during refresh cycles
  // ═══════════════════════════════════════════════════════════════════
  
  function updateRefreshProgress(sectionName, success) {
    if (!window.cacheRefreshProgress.sections[sectionName]) {
      window.cacheRefreshProgress.sections[sectionName] = success;
      if (success) window.cacheRefreshProgress.completed++;
      
      const percentage = Math.round(
        (window.cacheRefreshProgress.completed / window.cacheRefreshProgress.total) * 100
      );
      
      console.log(`[Cache Refresh] 📊 Progress: ${percentage}% (${window.cacheRefreshProgress.completed}/${window.cacheRefreshProgress.total} sections)`);
      
      // Dispatch progress event
      window.dispatchEvent(new CustomEvent('cacheRefreshProgress', {
        detail: {
          section: sectionName,
          success: success,
          completed: window.cacheRefreshProgress.completed,
          total: window.cacheRefreshProgress.total,
          percentage: percentage
        }
      }));
    }
  }
  
  function resetRefreshProgress() {
    window.cacheRefreshProgress = {
      total: 10,
      completed: 0,
      sections: {}
    };
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // PAGE INITIALIZATION
  // Called on DOMContentLoaded or when ready
  // ═══════════════════════════════════════════════════════════════════
  
  async function initializePageWithCache() {
    console.log('='.repeat(70));
    console.log('🚀 INITIALIZING PAGE WITH PROFESSIONAL CACHE SYSTEM');
    console.log('='.repeat(70));
    
    try {
      // Step 1: Initialize cache client and check status
      const initResult = await window.cacheClient.init();
      
      if (initResult.cacheHit) {
        // ✅ CACHE HIT - Load from DB progressively
        console.log('\n📦 CACHE VALID - Loading from database...');
        console.log('   Strategy: Progressive/scroll-based loading');
        console.log('   Sections will load as user scrolls\n');
        
        // Setup is handled by cacheClient.init() -> setupProgressiveLoading()
        
        // Listen for cache data events to render sections
        window.addEventListener('cacheDataLoaded', handleCacheDataLoaded);
        
      } else if (initResult.needsRefresh) {
        // 🔄 CACHE MISS/EXPIRED - Fetch fresh and populate cache
        console.log('\n🔄 CACHE EXPIRED OR EMPTY - Starting refresh cycle...');
        console.log('   Strategy: Fetch from APIs → Store in cache → Serve');
        console.log('   This happens once every 6 hours\n');
        
        window.isRefreshingCache = true;
        resetRefreshProgress();
        
        // The existing page loaders will automatically write to cache
        // via the cached wrappers (if integrated)
        
      } else {
        // ⚠️ Cache error - continue without cache
        console.log('\n⚠️ CACHE UNAVAILABLE - Running without cache');
        console.log('   All data will be fetched directly from APIs\n');
      }
      
      // Show initial status in console
      console.log('─'.repeat(70));
      console.log('📊 INITIAL CACHE STATUS:');
      console.log(`   Valid: ${initResult.cacheHit ? '✅ YES' : '❌ NO'}`);
      console.log(`   Version: ${window.cacheClient.cacheVersion || 'N/A'}`);
      
      if (initResult.status) {
        console.log(`   Sections: ${initResult.status.sections?.completed || 0}/${initResult.status.sections?.total || 10}`);
        console.log(`   Expires: ${initResult.status.metrics?.secondsUntilExpiry || 'N/A'}s`);
      }
      console.log('─'.repeat(70) + '\n');
      
      return initResult;
      
    } catch (error) {
      console.error('[Cache Integration] ❌ Initialization failed:', error.message);
      console.log('   Continuing without cache...\n');
      return { success: false, cacheHit: false };
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // EVENT HANDLERS
  // ═══════════════════════════════════════════════════════════════════
  
  /**
   * Handle cached data loaded event
   * Renders the section with cached data
   */
  function handleCacheDataLoaded(event) {
    const { elementId, sectionName, data } = event.detail;
    
    console.log(`[Cache Integration] 🎨 Rendering cached data for ${sectionName} in #${elementId}`);
    
    // Call existing render functions based on section name
    switch (sectionName) {
      case 'heroSlider':
        if (typeof renderHeroSlider === 'function') {
          renderHeroSlider(data);
        }
        break;
        
      case 'topAiring':
        if (typeof renderTopAiring === 'function') {
          renderTopAiring(data);
        }
        break;
        
      case 'newReleases':
        if (typeof renderNewReleases === 'function') {
          renderNewReleases(data);
        }
        break;
        
      case 'upcoming':
        if (typeof renderUpcoming === 'function') {
          renderUpcoming(data);
        }
        break;
        
      case 'trendingNow':
        if (typeof renderTrendingNow === 'function') {
          renderTrendingNow(data);
        }
        break;
        
      default:
        console.log(`[Cache Integration] ℹ️ No renderer for ${sectionName}, dispatching custom event`);
        // Data is available in event.detail.data for custom handling
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // PUBLIC API
  // Expose useful functions globally
  // ═══════════════════════════════════════════════════════════════════
  
  window.CacheIntegration = {
    initialize: initializePageWithCache,
    createCachedLoader: createCachedLoader,
    getProgress: () => window.cacheRefreshProgress,
    getMetrics: () => window.cacheClient.getMetrics(),
    forceRefresh: async () => {
      await window.cacheClient.resetCache();
      resetRefreshProgress();
      window.isRefreshingCache = true;
      return initializePageWithCache();
    },
    getStatus: () => window.cacheClient.cacheStatus
  };
  
  // ═══════════════════════════════════════════════════════════════════
  // AUTO-INITIALIZE WHEN DOM READY
  // ═══════════════════════════════════════════════════════════════════
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializePageWithCache);
  } else {
    // DOM already ready
    initializePageWithCache();
  }
  
  console.log('✅ Cache integration module loaded');
  console.log('   Use: window.CacheIntegration.initialize() to manually start');
  console.log('   Use: window.CacheIntegration.forceRefresh() to force cache refresh\n');

})();
