// ═══════════════════════════════════════════════════════════════════
// PROFESSIONAL CACHE CLIENT FOR FRONTEND
// Integrates with /api/cache endpoint for Neon DB caching
// Features: Progressive loading, 6-hour TTL, partial cache support
// ═══════════════════════════════════════════════════════════════════

class ProfessionalCacheClient {
  constructor(options = {}) {
    this.apiEndpoint = options.apiEndpoint || '/api/cache';
    this.cacheInterval = options.cacheInterval || 6 * 60 * 60 * 1000; // 6 hours
    this.debug = options.debug || false;
    
    // Cache state
    this.cacheStatus = null;
    this.loadedSections = new Set();
    this.isCacheValid = false;
    this.cacheVersion = null;
    
    // Progressive loading state
    this.scrollObserver = null;
    this.sectionElements = {};
    this.loadingPromises = {};
    
    // Performance metrics
    this.metrics = {
      cacheHits: 0,
      cacheMisses: 0,
      avgLoadTime: 0,
      totalLoads: 0
    };
    
    // Bind methods
    this.init = this.init.bind(this);
    this.checkStatus = this.checkStatus.bind(this);
    this.loadSection = this.loadSection.bind(this);
    this.writeSection = this.writeSection.bind(this);
    this.setupProgressiveLoading = this.setupProgressiveLoading.bind(this);
  }

  // ═══════════════════════════════════════════════════════════════════
  // INITIALIZATION
  // Called on page load to check cache status
  // ═══════════════════════════════════════════════════════════════════
  
  async init() {
    try {
      console.log('[Cache Client] 🚀 Initializing professional cache system...');
      
      const status = await this.checkStatus();
      
      if (status.isValid) {
        console.log(`[Cache Client] ✅ Cache is VALID | Expires in ${status.metrics.secondsUntilExpiry}s`);
        console.log(`[Cache Client] 📊 Sections: ${status.sections.completed}/${status.sections.total}`);
        this.isCacheValid = true;
        this.cacheStatus = status;
        
        // Setup progressive loading for valid cache
        this.setupProgressiveLoading();
        
        return {
          success: true,
          cacheHit: true,
          status: status
        };
      } else {
        console.log(`[Cache Client] ⚠️ Cache INVALID | Reason: ${status.isValid ? 'incomplete' : 'expired'}`);
        console.log(`[Cache Client] 🔄 Will fetch fresh data and populate cache`);
        
        return {
          success: true,
          cacheHit: false,
          status: status,
          needsRefresh: true
        };
      }
      
    } catch (error) {
      console.error('[Cache Client] ❌ Init failed:', error.message);
      // Continue without cache - will fetch from APIs directly
      return {
        success: false,
        error: error.message,
        cacheHit: false
      };
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // CACHE STATUS CHECK
  // Validates if cache exists and is not expired
  // ═══════════════════════════════════════════════════════════════════
  
  async checkStatus() {
    const startTime = Date.now();
    
    try {
      const response = await fetch(this.apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'status' })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const result = await response.json();
      const duration = Date.now() - startTime;
      
      if (result.success) {
        this.cacheStatus = result.data;
        this.cacheVersion = result.data.version;
        
        this.log('status', `Checked in ${duration}ms | Valid: ${result.data.isValid}`);
        
        return result.data;
      } else {
        throw new Error(result.error || 'Status check failed');
      }
      
    } catch (error) {
      this.log('error', `Status check failed: ${error.message}`);
      throw error;
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // SECTION LOADING (PROGRESSIVE)
  // Loads individual sections based on scroll position
  // ═══════════════════════════════════════════════════════════════════
  
  async loadSection(sectionName, options = {}) {
    // Return cached result if already loaded
    if (this.loadedSections.has(sectionName) && !options.forceRefresh) {
      this.log('hit', `Section "${sectionName}" from memory cache`);
      return this.loadingPromises[sectionName];
    }
    
    // Prevent duplicate loads
    if (this.loadingPromises[sectionName] && !options.forceRefresh) {
      return this.loadingPromises[sectionName];
    }
    
    const startTime = Date.now();
    
    try {
      // Create loading promise
      const loadPromise = this._loadFromDB(sectionName);
      this.loadingPromises[sectionName] = loadPromise;
      
      const result = await loadPromise;
      const duration = Date.now() - startTime;
      
      // Update metrics
      this.metrics.totalLoads++;
      this.metrics.avgLoadTime = (
        (this.metrics.avgLoadTime * (this.metrics.totalLoads - 1)) + duration
      ) / this.metrics.totalLoads;
      
      if (result.success && result.data) {
        this.metrics.cacheHits++;
        this.loadedSections.add(sectionName);
        this.log('load', `✅ "${sectionName}" in ${duration}ms (CACHE HIT)`);
        return result.data;
      } else {
        this.metrics.cacheMisses++;
        this.log('miss', `⚠️ "${sectionName}" not cached (CACHE MISS)`);
        return null;
      }
      
    } catch (error) {
      this.metrics.cacheMisses++;
      this.log('error', `❌ Failed to load "${sectionName}": ${error.message}`);
      return null;
    }
  }

  async _loadFromDB(sectionName) {
    const response = await fetch(this.apiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'read',
        section: sectionName
      })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    return response.json();
  }

  // ═══════════════════════════════════════════════════════════════════
  // CACHE WRITING
  // Writes section data to cache after fetching from APIs
  // ═══════════════════════════════════════════════════════════════════
  
  async writeSection(sectionName, data) {
    try {
      const response = await fetch(this.apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'write',
          section: sectionName,
          data: data
        })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const result = await response.json();
      
      if (result.success) {
        this.log('write', `💾 Cached "${sectionName}" (${Array.isArray(data) ? data.length : 'object'} items)`);
        
        // Add to loaded sections
        this.loadedSections.add(sectionName);
        
        // Update cache status
        if (this.cacheStatus) {
          this.cacheStatus.sections.completed++;
          
          // Check if cache is now complete
          if (this.cacheStatus.sections.completed >= this.cacheStatus.sections.total) {
            this.cacheStatus.status = 'complete';
            this.isCacheValid = true;
            this.log('complete', '🎉 All sections cached! Cache is now COMPLETE');
          }
        }
      }
      
      return result;
      
    } catch (error) {
      this.log('error', `Failed to write "${sectionName}": ${error.message}`);
      // Don't throw - cache write failure shouldn't break the page
      return { success: false, error: error.message };
    }
  }

  // Batch write multiple sections at once
  async writeBatch(sectionsData) {
    try {
      const response = await fetch(this.apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'write-batch',
          data: sectionsData
        })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const result = await response.json();
      
      if (result.success) {
        this.log('batch', `📦 Batch cached ${Object.keys(sectionsData).length} sections`);
        
        // Mark all as loaded
        Object.keys(sectionsData).forEach(section => {
          this.loadedSections.add(section);
        });
      }
      
      return result;
      
    } catch (error) {
      this.log('error', `Batch write failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // PROGRESSIVE / SCROLL-BASED LOADING
  // Only loads sections when they enter viewport
  // Critical for performance with millions of users
  // ═══════════════════════════════════════════════════════════════════
  
  setupProgressiveLoading() {
    if (!this.isCacheValid) {
      this.log('progressive', 'Skipping - cache not valid');
      return;
    }
    
    this.log('progressive', '🔄 Setting up scroll-based progressive loading...');
    
    // Define section mappings (DOM ID → cache section name)
    this.sectionMap = {
      'heroSlider': 'heroSlider',
      'topAiringSection': 'topAiring', 
      'newReleasesSection': 'newReleases',
      'newOnAniumiSection': 'newOnAniumi',
      'upcomingSection': 'upcoming',
      'recentlyCompletedSection': 'recentlyCompleted',
      'trendingNowSection': 'trendingNow',
      'mostFavouriteSection': 'mostFavourite',
      'popularAnimeSection': 'popularAnime',
      'scheduleSection': 'schedule'
    };
    
    // Setup IntersectionObserver for lazy loading
    if ('IntersectionObserver' in window) {
      this.scrollObserver = new IntersectionObserver(
        (entries) => this._handleIntersection(entries),
        {
          root: null,
          rootMargin: '200px', // Start loading 200px before visible
          threshold: 0
        }
      );
      
      // Observe all section elements
      Object.keys(this.sectionMap).forEach(elementId => {
        const element = document.getElementById(elementId);
        if (element) {
          this.sectionElements[elementId] = element;
          this.scrollObserver.observe(element);
          this.log('observe', `👁️ Observing #${elementId}`);
        } else {
          this.log('warn', `⚠️ Element #${elementId} not found`);
        }
      });
      
    } else {
      // Fallback: Load all sections at once
      this.log('warn', 'IntersectionObserver not supported, loading all sections');
      this._loadAllSections();
    }
  }

  _handleIntersection(entries) {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const elementId = entry.target.id;
        const sectionName = this.sectionMap[elementId];
        
        if (sectionName && !this.loadedSections.has(sectionName)) {
          this.log('visible', `📍 #${elementId} visible, loading "${sectionName}"...`);
          this.loadSection(sectionName).then(data => {
            if (data) {
              this._renderSection(elementId, sectionName, data);
            }
          });
        }
        
        // Stop observing once loaded
        if (this.loadedSections.has(this.sectionMap[elementId])) {
          this.scrollObserver.unobserve(entry.target);
        }
      }
    });
  }

  async _loadAllSections() {
    // Fallback: Load all sections at once (for older browsers)
    const loadPromises = Object.entries(this.sectionMap).map(async ([elementId, sectionName]) => {
      const data = await this.loadSection(sectionName);
      if (data) {
        this._renderSection(elementId, sectionName, data);
      }
    });
    
    await Promise.all(loadPromises);
  }

  _renderSection(elementId, sectionName, data) {
    // This should be overridden or connected to existing render functions
    // For now, just log and store the data
    this.log('render', `🎨 Data ready for #${elementId} (${sectionName})`);
    
    // Dispatch custom event for the main app to handle rendering
    const event = new CustomEvent('cacheDataLoaded', {
      detail: { elementId, sectionName, data }
    });
    window.dispatchEvent(event);
  }

  // ═══════════════════════════════════════════════════════════════════
  // CACHE REFRESH
  // Handles 6-hour expiry and refresh cycle
  // ═══════════════════════════════════════════════════════════════════
  
  async resetCache() {
    try {
      const response = await fetch(this.apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset' })
      });
      
      const result = await response.json();
      
      if (result.success) {
        // Reset local state
        this.loadedSections.clear();
        this.isCacheValid = false;
        this.cacheStatus = null;
        
        // Clear loading promises
        this.loadingPromises = {};
        
        this.log('reset', '🔄 Cache reset for refresh cycle');
      }
      
      return result;
      
    } catch (error) {
      this.log('error', `Reset failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  // Get cache completion percentage
  getCompletionPercentage() {
    if (!this.cacheStatus || !this.cacheStatus.sections) return 0;
    
    const { completed, total } = this.cacheStatus.sections;
    return Math.round((completed / total) * 100);
  }

  // ═══════════════════════════════════════════════════════════════════
  // LOGGING & DEBUGGING
  // ═══════════════════════════════════════════════════════════════════
  
  log(type, message) {
    if (!this.debug) return;
    
    const timestamp = new Date().toLocaleTimeString();
    const prefix = `[Cache Client ${timestamp}]`;
    
    switch (type) {
      case 'error':
        console.error(`${prefix} ❌ ${message}`);
        break;
      case 'warn':
        console.warn(`${prefix} ⚠️  ${message}`);
        break;
      case 'hit':
        console.log(`${prefix} 🎯 ${message}`);
        break;
      case 'miss':
        console.log(`${prefix} 💨 ${message}`);
        break;
      case 'write':
        console.log(`${prefix} 💾 ${message}`);
        break;
      case 'load':
        console.log(`${prefix} 📥 ${message}`);
        break;
      default:
        console.log(`${prefix} ${message}`);
    }
  }

  // Get performance report
  getMetrics() {
    return {
      ...this.metrics,
      completionPercentage: this.getCompletionPercentage(),
      loadedSections: Array.from(this.loadedSections),
      isCacheValid: this.isCacheValid,
      cacheVersion: this.cacheVersion
    };
  }

  // Destroy cleanup
  destroy() {
    if (this.scrollObserver) {
      this.scrollObserver.disconnect();
    }
    this.loadedSections.clear();
    this.loadingPromises = {};
    this.log('cleanup', '🧹 Cache client destroyed');
  }
}

// Export for use
window.ProfessionalCacheClient = ProfessionalCacheClient;

// Auto-initialize if configured
if (typeof window !== 'undefined' && window.AUTO_INIT_CACHE) {
  window.cacheClient = new ProfessionalCacheClient({ debug: true });
  window.cacheClient.init();
}
