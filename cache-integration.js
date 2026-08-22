// ═══════════════════════════════════════════════════════════════════
// CACHE INTEGRATION LAYER
// Bridges ProfessionalCacheManager with existing section loaders
// Adds 6-hour interval caching to all page sections
// Supports: Full cache, partial cache, scroll-based serving, live fallback
// ═══════════════════════════════════════════════════════════════════

const CacheIntegration = {
  // ═══ CONFIGURATION ═══
  config: {
    enabled: true,  // Master switch to disable caching globally
    logLevel: 'info', // 'debug', 'info', 'warn', 'error', 'silent'
    retryFailedSections: true,  // Retry failed sections on next visit
    prefetchVisibleSections: true  // Pre-load sections near viewport
  },
  
  // ═══ STATE ═══
  state: {
    initialized: false,
    cacheValid: false,
    usingCachedData: false,
    refreshInProgress: false,
    sectionsServedFromCache: new Set(),
    sectionsFetchedLive: new Set(),
    startTime: null
  },

  // ═══════════════════════════════════════════════════════════════════
  // INITIALIZATION
  // Called from main init() function before registering sections
  // ═══════════════════════════════════════════════════════════════════
  
  async initialize() {
    if (!this.config.enabled) {
      this._log('info', '⚙️ Cache integration disabled by config');
      return { usingCache: false, reason: 'disabled' };
    }
    
    this.state.startTime = Date.now();
    this._log('info', '🚀 Initializing cache integration...');
    
    try {
      // Initialize the cache manager
      const cacheStatus = await window.cacheManager.initialize();
      
      this.state.cacheValid = cacheStatus.isValid;
      this.state.initialized = true;
      
      if (cacheStatus.isValid) {
        this.state.usingCachedData = true;
        this._log('info', `✅ Valid cache found (v${cacheStatus.version})`);
        this._log('info', `   Sections: ${cacheStatus.data.sections.completed}/${cacheStatus.data.sections.total}`);
        this._log('info', `   Expires in: ${this._formatTime(cacheStatus.data.metrics.secondsUntilExpiry)}`);
        this._log('info', `   Hits: ${cacheStatus.data.metrics.hitCount} | Misses: ${cacheStatus.data.metrics.missCount}`);
        
        // Setup event listeners for cache-driven loading
        this._setupCacheEventListeners();
        
        return { 
          usingCache: true, 
          status: cacheStatus.data.status,
          sections: cacheStatus.data.sections 
        };
      } else {
        this.state.usingCachedData = false;
        this._log('info', `🔄 No valid cache (${cacheStatus.data.status}) - will use live APIs + cache results`);
        
        // Setup listeners to capture data when it's fetched
        this._setupCaptureListeners();
        
        return { 
          usingCache: false, 
          reason: cacheStatus.data.status,
          missingSections: this._getMissingSections(cacheStatus.data.sections.details)
        };
      }
      
    } catch (error) {
      this._log('error', `❌ Cache init failed: ${error.message}`);
      this.state.usingCachedData = false;
      return { usingCache: false, reason: 'error', error: error.message };
    }
  },

  // ═══════════════════════════════════════════════════════════════════
  // SECTION LOADING WRAPPERS
  // These replace or wrap existing load functions with cache-aware versions
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Get cache-aware loader for a section
   * Returns a function that checks cache first, falls back to live API
   */
  getSectionLoader(sectionName, originalLoadFn, options = {}) {
    const self = this;
    
    return async function(...args) {
      const startTime = Date.now();
      self._log('debug', `▶️ Loading section: ${sectionName}`);
      
      if (self.state.usingCachedData && self.state.cacheValid) {
        // Try to load from cache first
        const cachedData = await self._loadFromCache(sectionName);
        
        if (cachedData) {
          const duration = Date.now() - startTime;
          self.state.sectionsServedFromCache.add(sectionName);
          self._log('info', `✅ ${sectionName} served from cache in ${duration}ms`);
          
          // Call original render function with cached data if provided
          if (options.renderFn && cachedData) {
            options.renderFn(cachedData);
          }
          
          return cachedData;
        }
      }
      
      // Fall back to live API (and capture result for caching)
      self._log('debug', `🌐 ${sectionName} fetching from live API...`);
      self.state.sectionsFetchedLive.add(sectionName);
      
      const liveData = await originalLoadFn.apply(this, args);
      
      // Capture and cache the result (async, non-blocking)
      if (liveData) {
        self._captureAndCache(sectionName, liveData);
      }
      
      const duration = Date.now() - startTime;
      self._log('info', `✅ ${sectionName} loaded live in ${duration}ms`);
      
      return liveData;
    };
  },

  // ═══════════════════════════════════════════════════════════════════
  // CACHE DATA LOADING
  // ═══════════════════════════════════════════════════════════════════
  
  async _loadFromCache(sectionName) {
    try {
      const data = await window.cacheManager.readFromCache(sectionName);
      
      if (data && data[sectionName]) {
        return data[sectionName];
      } else if (Array.isArray(data)) {
        return data;
      } else {
        this._log('warn', `⚠️ No cached data for: ${sectionName}`);
        return null;
      }
    } catch (error) {
      this._log('error', `❌ Cache read error [${sectionName}]: ${error.message}`);
      return null;
    }
  }

  /**
   * Load multiple sections from cache in one DB call (optimized)
   */
  async _loadMultipleFromCache(sectionNames) {
    try {
      const data = await window.cacheManager.readFromCache(sectionNames);
      return data;
    } catch (error) {
      this._log('error', `❌ Batch cache read error: ${error.message}`);
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // DATA CAPTURE & CACHING
  // Intercepts section data after API fetch and stores in DB
  // ═══════════════════════════════════════════════════════════════════
  
  /**
   * Capture section data and write to cache (non-blocking)
   */
  async _captureAndCache(sectionName, data) {
    if (!data || !this.config.enabled) return;
    
    this._log('debug', `💾 Caching: ${sectionName} (${Array.isArray(data) ? data.length : 'object'} items)`);
    
    // Write to cache asynchronously (don't block UI)
    window.cacheManager.writeToCache(sectionName, data).then(success => {
      if (success) {
        window.cacheManager.markSectionComplete(sectionName, true);
        this._log('debug', `✅ Cached: ${sectionName}`);
      } else {
        window.cacheManager.markSectionComplete(sectionName, false);
        this._log('warn', `❌ Failed to cache: ${sectionName}`);
      }
    }).catch(error => {
      this._log('error', `❌ Cache write error [${sectionName}]: ${error.message}`);
      window.cacheManager.markSectionComplete(sectionName, false);
    });
  }

  /**
   * Batch cache multiple sections at once (more efficient)
   */
  async _batchCacheSections(dataMap) {
    if (!dataMap || typeof dataMap !== 'object') return;
    
    this._log('info', `📦 Batch caching: ${Object.keys(dataMap).join(', ')}`);
    
    await window.cacheManager.writeBatchToCache(dataMap);
    
    // Mark all as complete
    Object.keys(dataMap).forEach(section => {
      window.cacheManager.markSectionComplete(section, true);
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // EVENT LISTENERS
  // Handle cache-related custom events
  // ═══════════════════════════════════════════════════════════════════
  
  _setupCacheEventListeners() {
    // Listen for cache data loaded events (from scroll-based loader)
    document.addEventListener('cacheDataLoaded', (event) => {
      const { section, data, element } = event.detail;
      this._log('debug', `📥 Cache data received for: ${section}`);
      this.state.sectionsServedFromCache.add(section);
    });
    
    // Listen for cache miss events (need to load from API)
    document.addEventListener('cacheMiss', (event) => {
      const { section } = event.detail;
      this._log('debug', `❌ Cache miss for: ${section}, triggering live load`);
      this.state.sectionsFetchedLive.add(section);
    });
    
    // Listen for refresh start
    document.addEventListener('cacheRefreshStart', (event) => {
      this.state.refreshInProgress = true;
      this._log('info', '🔄 Cache refresh started');
    });
    
    // Listen for refresh complete
    document.addEventListener('cacheRefreshComplete', (event) => {
      const { isFullyComplete, completed, failed, failedSections } = event.detail;
      this.state.refreshInProgress = false;
      
      if (isFullyComplete) {
        this._log('info', `🎉 Cache refresh COMPLETE! All ${completed} sections cached.`);
      } else {
        this._log('warn', `⚠️ Cache refresh PARTIAL: ${completed} ok, ${failed} failed`);
        this._log('warn', `   Failed: ${failedSections.join(', ')}`);
      }
    });
  }

  /**
   * Setup listeners to capture data when sections load via live API
   * Used when cache is invalid/expired
   */
  _setupCaptureListeners() {
    // These will be called by modified section loaders
    this._log('debug', '🎯 Setting up data capture listeners');
  }

  // ═══════════════════════════════════════════════════════════════════
  // UTILITY FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════
  
  _getMissingSections(details) {
    if (!details) return [];
    return Object.entries(details)
      .filter(([name, cached]) => !cached)
      .map(([name]) => name);
  }
  
  _formatTime(seconds) {
    if (!seconds || seconds < 0) return 'expired';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  }
  
  _log(level, message) {
    const levels = ['debug', 'info', 'warn', 'error', 'silent'];
    const levelPriority = levels.indexOf(level);
    const configPriority = levels.indexOf(this.config.logLevel);
    
    if (levelPriority >= configPriority) {
      const prefix = `[Cache Integration]`;
      switch(level) {
        case 'debug': console.debug(prefix, message); break;
        case 'info': console.log(prefix, message); break;
        case 'warn': console.warn(prefix, message); break;
        case 'error': console.error(prefix, message); break;
      }
    }
  }

  /**
   * Get current status summary
   */
  getStatus() {
    return {
      ...this.state,
      cacheManagerStatus: window.cacheManager?.getStatusSummary()
    };
  }

  /**
   * Force refresh cache (admin/debug use)
   */
  async forceRefresh() {
    this._log('info', '🔄 Force refresh requested...');
    this.state.usingCachedData = false;
    await window.cacheManager.refreshCache();
  }
};

// Make it globally available
window.CacheIntegration = CacheIntegration;

console.log('[Cache Integration] ✨ Module loaded: window.CacheIntegration');
