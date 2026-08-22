// ═══════════════════════════════════════════════════════════════════
// PROFESSIONAL CLIENT-SIDE CACHE MANAGER
// Handles: Cache validation, DB read/write, partial caching, scroll-based loading
// Cache Interval: 6 hours (global for all users)
// Database: Neon PostgreSQL via /api/cache endpoint
// ═══════════════════════════════════════════════════════════════════

class ProfessionalCacheManager {
  constructor() {
    // ═══ CONFIGURATION ═══
    this.config = {
      apiEndpoint: '/api/cache',
      cacheInterval: 6 * 60 * 60 * 1000, // 6 hours in ms
      sections: [
        'heroSlider',
        'topAiring', 
        'newReleases',
        'newOnAniumi',
        'upcoming',
        'recentlyCompleted',
        'trendingNow',
        'mostFavourite',
        'popularAnime',
        'schedule'
      ],
      scrollThreshold: 200, // px before viewport to trigger load
      debounceMs: 100 // Scroll event debounce
    };
    
    // ═══ STATE ═══
    this.state = {
      initialized: false,
      isValid: false,
      status: null, // 'complete', 'partial', 'empty', 'expired'
      loadedSections: new Set(),
      pendingSections: new Set(),
      failedSections: new Set(),
      lastValidated: null,
      version: null,
      metrics: {
        hitCount: 0,
        missCount: 0,
        dbServeTime: 0
      }
    };
    
    // ═══ OBSERVERS & HANDLERS ═══
    this.scrollObserver = null;
    this.sectionObservers = new Map();
    this.scrollHandler = null;
    
    console.log('[Cache Manager] 🚀 Initialized');
  }

  // ═══════════════════════════════════════════════════════════════════
  // INITIALIZATION
  // Called once on page load to check cache status
  // ═══════════════════════════════════════════════════════════════════
  
  async initialize() {
    if (this.state.initialized) return this.state;
    
    console.log('[Cache Manager] 🔍 Checking cache status...');
    
    try {
      const status = await this.getCacheStatus();
      
      this.state.isValid = status.data.isValid;
      this.state.status = status.data.status;
      this.state.version = status.data.version;
      this.state.metrics = status.data.metrics;
      this.state.lastValidated = new Date();
      this.state.initialized = true;
      
      console.log(`[Cache Manager] 📊 Status: ${status.data.status} | Valid: ${status.data.isValid}`);
      console.log(`[Cache Manager] 📈 Sections: ${status.data.sections.completed}/${status.data.sections.total}`);
      console.log(`[Cache Manager] ⏱️ Expires in: ${this._formatTime(status.data.metrics.secondsUntilExpiry)}`);
      
      if (!status.data.isValid) {
        console.log('[Cache Manager] 🔄 Cache invalid/expired - will use live APIs');
        
        if (status.data.status === 'partial') {
          console.warn('[Cache Manager] ⚠️ Partial cache detected - missing:', status.data.sections.details);
          this._logMissingSections(status.data.sections.details);
        }
      } else {
        console.log('[Cache Manager] ✅ Valid cache - will serve from DB');
        this._setupScrollBasedLoading();
      }
      
      return this.state;
      
    } catch (error) {
      console.error('[Cache Manager] ❌ Init error:', error.message);
      this.state.initialized = true; // Mark as init even on error to allow fallback
      this.state.status = 'error';
      return this.state;
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // CACHE STATUS CHECK
  // Validates if current cache is usable
  // ═══════════════════════════════════════════════════════════════════
  
  async getCacheStatus() {
    const response = await fetch(this.config.apiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'status' })
    });
    
    if (!response.ok) {
      throw new Error(`Cache API error: ${response.status}`);
    }
    
    return response.json();
  }

  // ═══════════════════════════════════════════════════════════════════
  // READ FROM CACHE (OPTIMIZED)
  // Supports: single section, array of sections, or 'all'
  // Only fetches requested data to minimize DB load
  // ═══════════════════════════════════════════════════════════════════
  
  async readFromCache(sections = 'all') {
    const startTime = Date.now();
    
    try {
      const response = await fetch(this.config.apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          action: 'read', 
          section: sections 
        })
      });
      
      if (!response.ok) {
        throw new Error(`Read error: ${response.status}`);
      }
      
      const result = await response.json();
      const duration = Date.now() - startTime;
      
      this.state.metrics.dbServeTime = duration;
      
      console.log(`[Cache Manager] ✅ Read ${Array.isArray(sections) ? sections.join(',') : sections} in ${duration}ms`);
      
      return result.data;
      
    } catch (error) {
      console.error('[Cache Manager] ❌ Read error:', error.message);
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // WRITE TO CACHE (SECTION UPDATE)
  // Called after each section finishes fetching + filtering
  // Updates only the specific section column in DB
  // ═══════════════════════════════════════════════════════════════════
  
  async writeToCache(section, data) {
    if (!section || !data) {
      console.warn('[Cache Manager] ⚠️ writeToCache called without section/data');
      return false;
    }
    
    try {
      const response = await fetch(this.config.apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          action: 'write', 
          section, 
          data 
        })
      });
      
      if (!response.ok) {
        throw new Error(`Write error: ${response.status}`);
      }
      
      const result = await response.json();
      
      this.state.loadedSections.add(section);
      this.state.pendingSections.delete(section);
      
      console.log(`[Cache Manager] 💾 Saved: ${section} (${Array.isArray(data) ? data.length : 'object'} items)`);
      
      return result.success;
      
    } catch (error) {
      console.error(`[Cache Manager] ❌ Write error [${section}]:`, error.message);
      this.state.failedSections.add(section);
      return false;
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // BATCH WRITE (MULTIPLE SECTIONS)
  // More efficient than individual writes for full page refresh
  // ═══════════════════════════════════════════════════════════════════
  
  async writeBatchToCache(dataObject) {
    if (!dataObject || typeof dataObject !== 'object') {
      console.warn('[Cache Manager] ⚠️ writeBatchToCache called without data object');
      return false;
    }
    
    try {
      const response = await fetch(this.config.apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          action: 'write-batch', 
          data: dataObject 
        })
      });
      
      if (!response.ok) {
        throw new Error(`Batch write error: ${response.status}`);
      }
      
      const result = await response.json();
      
      // Update local state
      Object.keys(dataObject).forEach(section => {
        this.state.loadedSections.add(section);
        this.state.pendingSections.delete(section);
      });
      
      console.log(`[Cache Manager] 📦 Batch saved: ${Object.keys(dataObject).join(', ')}`);
      
      return result.success;
      
    } catch (error) {
      console.error('[Cache Manager] ❌ Batch write error:', error.message);
      return false;
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // SCROLL-BASED LAZY LOADING FROM DB
  // CRITICAL OPTIMIZATION: Don't load all data at once!
  // Load sections as user scrolls to them
  // Reduces initial payload and DB load significantly
  // ═══════════════════════════════════════════════════════════════════
  
  _setupScrollBasedLoading() {
    if (!this.state.isValid) return;
    
    console.log('[Cache Manager] 👁️ Setting up scroll-based lazy loading...');
    
    // Debounced scroll handler
    let scrollTimeout;
    this.scrollHandler = () => {
      if (scrollTimeout) clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => this._checkVisibleSections(), this.config.debounceMs);
    };
    
    window.addEventListener('scroll', this.scrollHandler, { passive: true });
    
    // Also check on resize
    window.addEventListener('resize', this.scrollHandler, { passive: true });
    
    // Initial check after short delay (let page render)
    setTimeout(() => this._checkVisibleSections(), 100);
  }
  
  _checkVisibleSections() {
    if (!this.state.isValid) return;
    
    const sections = this._getSectionElements();
    const viewportHeight = window.innerHeight;
    
    sections.forEach(({ id, element, sectionName }) => {
      // Skip if already loaded or pending
      if (this.state.loadedSections.has(sectionName) || 
          this.state.pendingSections.has(sectionName)) {
        return;
      }
      
      const rect = element.getBoundingClientRect();
      const isInViewport = rect.top < viewportHeight + this.config.scrollThreshold && 
                          rect.bottom > -this.config.scrollThreshold;
      
      if (isInViewport) {
        this._loadSectionFromDB(sectionName, id, element);
      }
    });
  }
  
  _getSectionElements() {
    // Map DOM elements to cache section names
    const mapping = [
      { id: 'heroSlider', sectionName: 'heroSlider', element: document.getElementById('heroSlider') || document.querySelector('.hero-slider') },
      { id: 'topAiringList', sectionName: 'topAiring', element: document.getElementById('topAiringList') || document.getElementById('topAiringScroll') },
      { id: 'newReleasesGrid', sectionName: 'newReleases', element: document.getElementById('newReleasesGrid') },
      { id: 'newAnioceanGrid', sectionName: 'newOnAniumi', element: document.getElementById('newAnioceanGrid') },
      { id: 'upcomingScroll', sectionName: 'upcoming', element: document.getElementById('upcomingScroll') },
      { id: 'completedGrid', sectionName: 'recentlyCompleted', element: document.getElementById('completedGrid') },
      { id: 'trendingList', sectionName: 'trendingNow', element: document.getElementById('trendingList') },
      { id: 'popularList', sectionName: 'mostFavourite', element: document.getElementById('popularList') },
      { id: 'popularAnimeList', sectionName: 'popularAnime', element: document.getElementById('popularAnimeList') },
      { id: 'scheduleContainer', sectionName: 'schedule', element: document.getElementById('scheduleContainer') || document.querySelector('.schedule-section') }
    ];
    
    return mapping.filter(item => item.element);
  }
  
  async _loadSectionFromDB(sectionName, elementId, element) {
    this.state.pendingSections.add(sectionName);
    
    console.log(`[Cache Manager] 📥 Loading from DB: ${sectionName}`);
    
    const data = await this.readFromCache(sectionName);
    
    if (data && data[sectionName]) {
      // Call the appropriate render function based on section
      this._renderSectionFromCache(sectionName, data[sectionName], element);
      this.state.loadedSections.add(sectionName);
      console.log(`[Cache Manager] ✅ Rendered: ${sectionName}`);
    } else {
      console.warn(`[Cache Manager] ⚠️ No cached data for: ${sectionName}, falling back to API`);
      this.state.failedSections.add(sectionName);
      // Trigger live API load as fallback
      this._triggerLiveLoad(sectionName);
    }
    
    this.state.pendingSections.delete(sectionName);
  }
  
  _renderSectionFromCache(sectionName, data, element) {
    // This will be overridden by specific render functions
    // Each section knows how to render its own cached data
    console.log(`[Cache Manager] 🎨 Rendering cached data for: ${sectionName}`);
    
    // Dispatch custom event so section handlers can pick it up
    const event = new CustomEvent('cacheDataLoaded', {
      detail: { section: sectionName, data, element }
    });
    document.dispatchEvent(event);
  }

  // ═══════════════════════════════════════════════════════════════════
  // LIVE API FALLBACK
  // Triggered when cache miss or invalid data
  // ═══════════════════════════════════════════════════════════════════
  
  _triggerLiveLoad(sectionName) {
    console.log(`[Cache Manager] 🔄 Triggering live API for: ${sectionName}`);
    
    // Dispatch event for section to handle
    const event = new CustomEvent('cacheMiss', { detail: { section: sectionName } });
    document.dispatchEvent(event);
  }

  // ═══════════════════════════════════════════════════════════════════
  // CACHE REFRESH (EXPIRED/INVALID)
  // Resets cache and triggers fresh API calls for all sections
  // Implements PARTIAL CACHING: saves what we get, marks what's missing
  // ═══════════════════════════════════════════════════════════════════
  
  async refreshCache() {
    console.log('[Cache Manager] 🔄 Starting full cache refresh...');
    const startTime = Date.now();
    
    try {
      // Reset cache in DB
      await this._resetCacheDB();
      
      // Dispatch global refresh event
      const refreshEvent = new CustomEvent('cacheRefreshStart', {
        detail: { timestamp: new Date(), manager: this }
      });
      document.dispatchEvent(refreshEvent);
      
      console.log('[Cache Manager] ⏱️ Refresh initiated - waiting for sections to complete...');
      
      return true;
      
    } catch (error) {
      console.error('[Cache Manager] ❌ Refresh error:', error.message);
      return false;
    }
  }
  
  async _resetCacheDB() {
    try {
      const response = await fetch(this.config.apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset' })
      });
      
      if (!response.ok) {
        throw new Error('Reset failed');
      }
      
      console.log('[Cache Manager] 🗑️ Cache reset in DB');
      return true;
      
    } catch (error) {
      console.error('[Cache Manager] ❌ Reset error:', error.message);
      return false;
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // SECTION COMPLETION TRACKING
  // Called by each section when it finishes caching its data
  // Tracks progress toward 100% complete cache
  // ═══════════════════════════════════════════════════════════════════
  
  markSectionComplete(sectionName, success = true) {
    if (success) {
      this.state.loadedSections.add(sectionName);
      console.log(`[Cache Manager] ✅ Section complete: ${sectionName} (${this.state.loadedSections.size}/10)`);
    } else {
      this.state.failedSections.add(sectionName);
      console.warn(`[Cache Manager] ❌ Section failed: ${sectionName}`);
    }
    
    this.state.pendingSections.delete(sectionName);
    
    // Check if all sections are done
    this._checkAllSectionsComplete();
  }
  
  markSectionPending(sectionName) {
    this.state.pendingSections.add(sectionName);
    console.log(`[Cache Manager] ⏳ Section pending: ${sectionName}`);
  }
  
  _checkAllSectionsComplete() {
    const total = this.config.sections.length;
    const completed = this.state.loadedSections.size;
    const failed = this.state.failedSections.size;
    const pending = this.state.pendingSections.size;
    
    console.log(`[Cache Manager] 📊 Progress: ${completed}/${total} complete, ${failed} failed, ${pending} pending`);
    
    if (completed + failed >= total) {
      // All sections processed (some may have failed)
      const event = new CustomEvent('cacheRefreshComplete', {
        detail: {
          timestamp: new Date(),
          total,
          completed,
          failed,
          failedSections: Array.from(this.state.failedSections),
          isFullyComplete: failed === 0
        }
      });
      document.dispatchEvent(event);
      
      if (failed === 0) {
        console.log('[Cache Manager] 🎉 CACHE 100% COMPLETE! All sections saved to DB.');
      } else {
        console.warn(`[Cache Manager] ⚠️ CACHE PARTIAL: ${failed} sections failed - will retry on next visit`);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // UTILITY FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════
  
  _formatTime(seconds) {
    if (!seconds || seconds < 0) return 'expired';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m ${seconds % 60}s`;
  }
  
  _logMissingSections(details) {
    const missing = [];
    for (const [name, isCached] of Object.entries(details)) {
      if (!isCached) missing.push(name);
    }
    if (missing.length > 0) {
      console.table(missing.map(name => ({ Section: name, Status: '❌ Missing' })));
    }
  }
  
  getStatusSummary() {
    return {
      initialized: this.state.initialized,
      isValid: this.state.isValid,
      status: this.state.status,
      version: this.state.version,
      loaded: Array.from(this.state.loadedSections),
      pending: Array.from(this.state.pendingSections),
      failed: Array.from(this.state.failedSections),
      metrics: this.state.metrics
    };
  }
  
  destroy() {
    // Cleanup listeners
    if (this.scrollHandler) {
      window.removeEventListener('scroll', this.scrollHandler);
      window.removeEventListener('resize', this.scrollHandler);
    }
    
    // Clear observers
    this.sectionObservers.forEach(observer => observer.disconnect());
    this.sectionObservers.clear();
    
    console.log('[Cache Manager] 🔒 Destroyed and cleaned up');
  }
}

// ═══════════════════════════════════════════════════════════════════
// GLOBAL INSTANCE
// Single instance used across entire application
// ═══════════════════════════════════════════════════════════════════

window.cacheManager = new ProfessionalCacheManager();

console.log('[Cache Manager] ✨ Global instance created: window.cacheManager');
