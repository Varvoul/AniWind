// ═══════════════════════════════════════════════════════════════════
// PROFESSIONAL CACHE API ENDPOINT v3.1
// Handles: Read/Write/Validate cache for all page sections
// Database: Neon PostgreSQL (Serverless)
// Cache Interval: 6 hours (global for all users)
// 
// FIXES IN v3.1:
// - CRITICAL: Use Client.query() for dynamic SQL (node-postgres compatible)
// - neon() function only supports tagged template literals (no dynamic columns)
// - Client class allows client.query() for dynamic column names
// - Proper connection lifecycle management for serverless
//
// PREVIOUS FIXES IN v3.0:
// - Removed sql.unsafe() calls (not supported by neon serverless)
//
// PREVIOUS FIXES IN v2.0:
// - Static import for @neondatabase/serverless
// - Better error handling and logging
// ═══════════════════════════════════════════════════════════════════

// Static import - more reliable in Vercel serverless functions
import { neon, Client } from '@neondatabase/serverless';

// ═══════════════════════════════════════════════════════════════════
// DATABASE CONNECTION CONFIGURATION
// ═══════════════════════════════════════════════════════════════════

const NEON_CONNECTION_STRING = process.env.NEON_DATABASE_URL || 
  'postgresql://neondb_owner:npg_Wdf5XkBVbx1i@ep-super-dawn-azjwdm9a-pooler.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

// Create SQL connection instance (reusable)
let sql = null;

function getSQL() {
  if (!sql) {
    try {
      sql = neon(NEON_CONNECTION_STRING);
      console.log('[Cache API] ✅ Database connection initialized');
    } catch (error) {
      console.error('[Cache API] ❌ Failed to initialize database connection:', error.message);
      throw error;
    }
  }
  return sql;
}

// ═══════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════════════

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const startTime = Date.now();
  
  try {
    const { action, section, data } = req.body || {};
    
    console.log(`[Cache API] 📥 Request: ${action || 'unknown'} | Section: ${section || 'all'} | Time: ${new Date().toISOString()}`);
    
    let result;
    
    switch (action) {
      case 'status':
        result = await getCacheStatus();
        break;
        
      case 'read':
        result = await readCache(section);
        break;
        
      case 'write':
        result = await writeCache(section, data);
        break;
        
      case 'write-batch':
        result = await writeBatchCache(data);
        break;
        
      case 'validate':
        result = await validateCache();
        break;
        
      case 'reset':
        result = await resetCache();
        break;
        
      case 'init':
        result = await initializeCache();
        break;
        
      case 'health':
        result = { success: true, status: 'healthy', timestamp: new Date().toISOString() };
        break;
        
      default:
        return res.status(400).json({ 
          success: false,
          error: 'Invalid action', 
          validActions: ['status', 'read', 'write', 'write-batch', 'validate', 'reset', 'init', 'health']
        });
    }
    
    const duration = Date.now() - startTime;
    console.log(`[Cache API] ✅ ${action} completed in ${duration}ms`);
    
    return res.status(200).json({
      success: true,
      ...result,
      _meta: {
        serverTime: new Date().toISOString(),
        responseTimeMs: duration
      }
    });
    
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[Cache API] ❌ Error after ${duration}ms:`, error.message);
    console.error('[Cache API] Stack:', error.stack);
    
    return res.status(500).json({ 
      success: false,
      error: 'Internal server error', 
      message: error.message,
      _meta: {
        serverTime: new Date().toISOString(),
        responseTimeMs: duration
      }
    });
  }
}

// ═══════════════════════════════════════════════════════════════════
// CACHE OPERATIONS
// ═══════════════════════════════════════════════════════════════════

/**
 * Get overall cache status and metadata
 */
async function getCacheStatus() {
  const sql = getSQL();
  
  const result = await sql`
    SELECT 
      cache_status,
      cache_updated_at,
      cache_expires_at,
      cache_version,
      completed_sections,
      total_sections,
      cache_hit_count,
      cache_miss_count,
      last_served_at,
      
      -- Individual section status
      hero_slider_cached,
      top_airing_cached,
      new_releases_cached,
      new_on_aniumi_cached,
      upcoming_cached,
      recently_completed_cached,
      trending_now_cached,
      most_favourite_cached,
      popular_anime_cached,
      schedule_cached,
      
      -- Calculate if cache is valid
      CASE 
        WHEN cache_expires_at > NOW() AND cache_status = 'complete' THEN true 
        ELSE false 
      END as is_valid,
      
      -- Time until expiry
      EXTRACT(EPOCH FROM (cache_expires_at - NOW())) as seconds_until_expiry
      
    FROM site_cache 
    WHERE cache_key = 'main_page_cache'
  `;
  
  if (!result || result.length === 0) {
    // Initialize cache if not exists
    console.log('[Cache API] 🔧 Cache not found, initializing...');
    await initializeTable(sql);
    return getCacheStatus(); // Retry after init
  }
  
  const cache = result[0];
  
  return {
    data: {
      status: cache.cache_status,
      isValid: cache.is_valid,
      expiresAt: cache.cache_expires_at,
      updatedAt: cache.cache_updated_at,
      version: cache.cache_version,
      sections: {
        completed: parseInt(cache.completed_sections),
        total: parseInt(cache.total_sections),
        details: {
          heroSlider: cache.hero_slider_cached,
          topAiring: cache.top_airing_cached,
          newReleases: cache.new_releases_cached,
          newOnAniumi: cache.new_on_aniumi_cached,
          upcoming: cache.upcoming_cached,
          recentlyCompleted: cache.recently_completed_cached,
          trendingNow: cache.trending_now_cached,
          mostFavourite: cache.most_favourite_cached,
          popularAnime: cache.popular_anime_cached,
          schedule: cache.schedule_cached
        }
      },
      metrics: {
        hitCount: parseInt(cache.cache_hit_count),
        missCount: parseInt(cache.cache_miss_count),
        secondsUntilExpiry: Math.max(0, Math.floor(cache.seconds_until_expiry))
      }
    }
  };
}

/**
 * Read cached data for specific section(s)
 */
async function readCache(section) {
  const sql = getSQL();
  const startTime = Date.now();
  
  // Update metrics
  await sql`UPDATE site_cache SET cache_hit_count = cache_hit_count + 1, last_served_at = NOW() WHERE cache_key = 'main_page_cache'`;
  
  let query;
  const sections = !section || section === 'all' ? null : (Array.isArray(section) ? section : [section]);
  
  if (!sections || sections.includes('all')) {
    // Return ALL sections
    query = sql`
      SELECT 
        hero_slider,
        top_airing,
        new_releases_all,
        new_releases_anime,
        new_releases_movie,
        new_releases_series,
        new_releases_hidden,
        new_on_aniumi,
        upcoming,
        recently_completed_page1,
        recently_completed_pages,
        recently_completed_total_pages,
        trending_now_today,
        trending_now_week,
        trending_now_month,
        most_favourite,
        popular_anime,
        schedule_monday,
        schedule_tuesday,
        schedule_wednesday,
        schedule_thursday,
        schedule_friday,
        schedule_saturday,
        schedule_sunday,
        cache_status,
        cache_expires_at
      FROM site_cache 
      WHERE cache_key = 'main_page_cache'
    `;
  } else {
    // Return ALL sections even when specific ones requested
    // (neon serverless doesn't support dynamic column selection via sql.unsafe)
    // Frontend will filter what it needs - minimal overhead for JSONB data
    query = sql`
      SELECT 
        hero_slider,
        top_airing,
        new_releases_all,
        new_releases_anime,
        new_releases_movie,
        new_releases_series,
        new_releases_hidden,
        new_on_aniumi,
        upcoming,
        recently_completed_page1,
        recently_completed_pages,
        recently_completed_total_pages,
        trending_now_today,
        trending_now_week,
        trending_now_month,
        most_favourite,
        popular_anime,
        schedule_monday,
        schedule_tuesday,
        schedule_wednesday,
        schedule_thursday,
        schedule_friday,
        schedule_saturday,
        schedule_sunday,
        cache_status,
        cache_expires_at
      FROM site_cache 
      WHERE cache_key = 'main_page_cache'
    `;
  }
  
  const result = await query;
  const duration = Date.now() - startTime;
  
  if (!result || result.length === 0) {
    throw new Error('Cache not found');
  }
  
  const cacheData = result[0];
  
  return {
    data: transformCacheData(cacheData, sections),
    meta: {
      serveTimeMs: duration,
      servedAt: new Date().toISOString(),
      section: section || 'all'
    }
  };
}

/**
 * Execute a dynamic UPDATE query with validated column name
 * Uses Client.query() which supports dynamic SQL (node-postgres compatible)
 * Column names are validated by sectionToColumn() whitelist - safe from SQL injection
 */
async function executeDynamicUpdate(column, value, whereClause = "cache_key = 'main_page_cache'") {
  const client = new Client(NEON_CONNECTION_STRING);
  
  try {
    await client.connect();
    // Construct query with validated column name (whitelist-validated, safe from SQL injection)
    const query = `UPDATE site_cache SET ${column} = $1, updated_at = NOW() WHERE ${whereClause}`;
    await client.query(query, [value]);
  } finally {
    // Always close connection in serverless environment
    await client.end();
  }
}

/**
 * Write/update cache for a single section
 */
async function writeCache(section, data) {
  if (!section || data === undefined) {
    throw new Error('Section and data are required');
  }
  
  const column = sectionToColumn(section);
  
  if (!column) {
    throw new Error(`Invalid section: ${section}`);
  }
  
  const jsonData = JSON.stringify(data);
  
  // Update the section data using dynamic query
  // Column name is validated by sectionToColumn() whitelist - SQL injection safe
  await executeDynamicUpdate(column, jsonData);
  
  // Update cached flag if column exists
  const flagCol = column + '_cached';
  try {
    await executeDynamicUpdate(flagCol, 'true');
  } catch (e) {
    // Flag column might not exist, that's ok
    console.log(`[Cache API] ⚠️ Could not update flag ${flagCol}`);
  }
  
  // Recalculate overall cache status
  const sql = getSQL();
  try {
    await recalculateStatus(sql);
  } catch (e) {}
  
  return { message: `Cache updated for ${section}`, section };
}

/**
 * Write multiple sections at once (batch operation)
 */
async function writeBatchCache(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('Data object required with section keys');
  }
  
  const sections = Object.keys(data);
  
  console.log(`[Cache API] 📦 Batch write: ${sections.join(', ')}`);
  
  // Write each section sequentially (neon serverless doesn't support transactions well)
  for (const [section, sectionData] of Object.entries(data)) {
    const column = sectionToColumn(section);
    if (!column) continue;
    
    const jsonData = JSON.stringify(sectionData);
    
    // Using dynamic update with validated column name
    await executeDynamicUpdate(column, jsonData);
    
    // Update flag
    const flagCol = column + '_cached';
    try {
      await executeDynamicUpdate(flagCol, 'true');
    } catch (e) {}
  }
  
  // Recalculate status
  const sql = getSQL();
  try {
    await recalculateStatus(sql);
  } catch (e) {}
  
  return { message: `Updated ${sections.length} sections`, sections };
}

/**
 * Validate cache and check what needs refreshing
 */
async function validateCache() {
  const sql = getSQL();
  
  const result = await sql`
    SELECT 
      *,
      CASE WHEN cache_expires_at > NOW() THEN true ELSE false END as is_not_expired,
      EXTRACT(EPOCH FROM (cache_expires_at - NOW())) as seconds_remaining
    FROM site_cache 
    WHERE cache_key = 'main_page_cache'
  `;
  
  if (!result || result.length === 0) {
    return { valid: false, needsRefresh: true, reason: 'not_initialized' };
  }
  
  const cache = result[0];
  const needsRefresh = !cache.is_not_expired || cache.cache_status !== 'complete';
  
  // Identify missing/incomplete sections
  const missingSections = [];
  const sectionMap = {
    'hero_slider_cached': 'heroSlider',
    'top_airing_cached': 'topAiring',
    'new_releases_cached': 'newReleases',
    'new_on_aniumi_cached': 'newOnAniumi',
    'upcoming_cached': 'upcoming',
    'recently_completed_cached': 'recentlyCompleted',
    'trending_now_cached': 'trendingNow',
    'most_favourite_cached': 'mostFavourite',
    'popular_anime_cached': 'popularAnime',
    'schedule_cached': 'schedule'
  };
  
  for (const [col, name] of Object.entries(sectionMap)) {
    if (!cache[col]) {
      missingSections.push(name);
    }
  }
  
  return {
    valid: !needsRefresh,
    needsRefresh,
    reason: needsRefresh ? (cache.is_not_expired ? 'incomplete' : 'expired') : 'valid',
    currentStatus: cache.cache_status,
    secondsRemaining: Math.max(0, Math.floor(cache.seconds_remaining)),
    missingSections,
    completedSections: parseInt(cache.completed_sections),
    totalSections: parseInt(cache.total_sections)
  };
}

/**
 * Reset cache for fresh refresh cycle
 */
async function resetCache() {
  const sql = getSQL();
  
  await sql`
    UPDATE site_cache SET
      cache_status = 'expired',
      cache_updated_at = NOW(),
      cache_expires_at = NOW() + INTERVAL '6 hours',
      cache_version = cache_version + 1,
      cache_miss_count = cache_miss_count + 1,
      completed_sections = 0,
      
      hero_slider_cached = false,
      top_airing_cached = false,
      new_releases_cached = false,
      new_on_aniumi_cached = false,
      upcoming_cached = false,
      recently_completed_cached = false,
      trending_now_cached = false,
      most_favourite_cached = false,
      popular_anime_cached = false,
      schedule_cached = false,
      
      updated_at = NOW()
    WHERE cache_key = 'main_page_cache'
  `;
  
  return { message: 'Cache reset successfully' };
}

/**
 * Initialize cache table if not exists
 */
async function initializeCache() {
  const sql = getSQL();
  
  try {
    await initializeTable(sql);
    return { message: 'Cache initialized' };
  } catch (error) {
    throw new Error(`Initialization failed: ${error.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

/**
 * Map section names to database column names
 */
function sectionToColumn(section) {
  const mapping = {
    'heroSlider': 'hero_slider',
    'hero_slider': 'hero_slider',
    'topAiring': 'top_airing',
    'top_airing': 'top_airing',
    'newReleases': 'new_releases_all',
    'newReleasesAll': 'new_releases_all',
    'newReleasesAnime': 'new_releases_anime',
    'newReleasesMovie': 'new_releases_movie',
    'newReleasesSeries': 'new_releases_series',
    'newReleasesHidden': 'new_releases_hidden',
    'newOnAniumi': 'new_on_aniumi',
    'upcoming': 'upcoming',
    'recentlyCompleted': 'recently_completed_page1',
    'trendingNow': 'trending_now_today',
    'trendingNowToday': 'trending_now_today',
    'trendingNowWeek': 'trending_now_week',
    'trendingNowMonth': 'trending_now_month',
    'mostFavourite': 'most_favourite',
    'popularAnime': 'popular_anime',
    'scheduleMonday': 'schedule_monday',
    'scheduleTuesday': 'schedule_tuesday',
    'scheduleWednesday': 'schedule_wednesday',
    'scheduleThursday': 'schedule_thursday',
    'scheduleFriday': 'schedule_friday',
    'scheduleSaturday': 'schedule_saturday',
    'scheduleSunday': 'schedule_sunday',
    'schedule': 'schedule_monday'
  };
  
  return mapping[section] || null;
}

/**
 * Transform raw DB data to frontend-friendly format
 */
function transformCacheData(rawData, sections) {
  const transform = {
    heroSlider: rawData.hero_slider,
    topAiring: rawData.top_airing,
    newReleases: {
      all: rawData.new_releases_all,
      anime: rawData.new_releases_anime,
      movie: rawData.new_releases_movie,
      series: rawData.new_releases_series,
      hidden: rawData.new_releases_hidden
    },
    newOnAniumi: rawData.new_on_aniumi,
    upcoming: rawData.upcoming,
    recentlyCompleted: {
      page1: rawData.recently_completed_page1,
      pages: rawData.recently_completed_pages,
      totalPages: rawData.recently_completed_total_pages
    },
    trendingNow: {
      today: rawData.trending_now_today,
      week: rawData.trending_now_week,
      month: rawData.trending_now_month
    },
    mostFavourite: rawData.most_favourite,
    popularAnime: rawData.popular_anime,
    schedule: {
      monday: rawData.schedule_monday,
      tuesday: rawData.schedule_tuesday,
      wednesday: rawData.schedule_wednesday,
      thursday: rawData.schedule_thursday,
      friday: rawData.schedule_friday,
      saturday: rawData.schedule_saturday,
      sunday: rawData.schedule_sunday
    },
    _meta: {
      status: rawData.cache_status,
      expiresAt: rawData.cache_expires_at
    }
  };
  
  // If specific sections requested, only return those
  if (sections && !sections.includes('all')) {
    const filtered = { _meta: transform._meta };
    for (const sec of sections) {
      if (transform[sec]) {
        filtered[sec] = transform[sec];
      }
    }
    return filtered;
  }
  
  return transform;
}

/**
 * Recalculate cache status after updates
 */
async function recalculateStatus(sql) {
  await sql`
    UPDATE site_cache SET
      cache_status = CASE
        WHEN completed_sections >= total_sections THEN 'complete'
        WHEN completed_sections > 0 THEN 'partial'
        ELSE 'empty'
      END
    WHERE cache_key = 'main_page_cache'
  `;
}

/**
 * Initialize table structure if not exists
 */
async function initializeTable(sql) {
  // Check if table exists
  const exists = await sql`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_name = 'site_cache'
    )
  `;
  
  if (!exists[0]?.exists) {
    console.log('[Cache API] 🔧 Initializing cache table...');
    
    await sql`
      CREATE TABLE site_cache (
        id SERIAL PRIMARY KEY,
        cache_key VARCHAR(50) UNIQUE NOT NULL DEFAULT 'main_page_cache',
        cache_status VARCHAR(20) NOT NULL DEFAULT 'empty',
        cache_updated_at TIMESTAMPTZ DEFAULT NOW(),
        cache_expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '6 hours',
        cache_version INTEGER NOT NULL DEFAULT 1,
        total_sections INTEGER NOT NULL DEFAULT 10,
        completed_sections INTEGER NOT NULL DEFAULT 0,
        
        hero_slider JSONB DEFAULT '[]',
        hero_slider_cached BOOLEAN DEFAULT FALSE,
        hero_slider_cached_at TIMESTAMPTZ,
        
        top_airing JSONB DEFAULT '[]',
        top_airing_cached BOOLEAN DEFAULT FALSE,
        top_airing_cached_at TIMESTAMPTZ,
        
        new_releases_all JSONB DEFAULT '[]',
        new_releases_anime JSONB DEFAULT '[]',
        new_releases_movie JSONB DEFAULT '[]',
        new_releases_series JSONB DEFAULT '[]',
        new_releases_hidden JSONB DEFAULT '[]',
        new_releases_cached BOOLEAN DEFAULT FALSE,
        new_releases_cached_at TIMESTAMPTZ,
        
        new_on_aniumi JSONB DEFAULT '[]',
        new_on_aniumi_cached BOOLEAN DEFAULT FALSE,
        new_on_aniumi_cached_at TIMESTAMPTZ,
        
        upcoming JSONB DEFAULT '[]',
        upcoming_cached BOOLEAN DEFAULT FALSE,
        upcoming_cached_at TIMESTAMPTZ,
        
        recently_completed_page1 JSONB DEFAULT '[]',
        recently_completed_pages JSONB DEFAULT '{}',
        recently_completed_total_pages INTEGER DEFAULT 0,
        recently_completed_cached BOOLEAN DEFAULT FALSE,
        recently_completed_cached_at TIMESTAMPTZ,
        
        trending_now_today JSONB DEFAULT '[]',
        trending_now_week JSONB DEFAULT '[]',
        trending_now_month JSONB DEFAULT '[]',
        trending_now_cached BOOLEAN DEFAULT FALSE,
        trending_now_cached_at TIMESTAMPTZ,
        
        most_favourite JSONB DEFAULT '[]',
        most_favourite_cached BOOLEAN DEFAULT FALSE,
        most_favourite_cached_at TIMESTAMPTZ,
        
        popular_anime JSONB DEFAULT '[]',
        popular_anime_cached BOOLEAN DEFAULT FALSE,
        popular_anime_cached_at TIMESTAMPTZ,
        
        schedule_monday JSONB DEFAULT '[]',
        schedule_tuesday JSONB DEFAULT '[]',
        schedule_wednesday JSONB DEFAULT '[]',
        schedule_thursday JSONB DEFAULT '[]',
        schedule_friday JSONB DEFAULT '[]',
        schedule_saturday JSONB DEFAULT '[]',
        schedule_sunday JSONB DEFAULT '[]',
        schedule_cached BOOLEAN DEFAULT FALSE,
        schedule_cached_at TIMESTAMPTZ,
        
        cache_hit_count BIGINT DEFAULT 0,
        cache_miss_count BIGINT DEFAULT 0,
        avg_serve_time_ms INTEGER DEFAULT NULL,
        last_served_at TIMESTAMPTZ,
        
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        last_refreshed_by VARCHAR(100) DEFAULT 'system'
      )
    `;
    
    // Create indexes
    await sql`CREATE INDEX IF NOT EXISTS idx_site_cache_key ON site_cache(cache_key)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_site_cache_expires ON site_cache(cache_expires_at)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_site_cache_status ON site_cache(cache_status)`;
    
    // Enable RLS
    await sql`ALTER TABLE site_cache ENABLE ROW LEVEL SECURITY`;
    await sql`CREATE POLICY IF NOT EXISTS "Allow_public_read" ON site_cache FOR SELECT USING (true)`;
    await sql`CREATE POLICY IF NOT EXISTS "Allow_service_write" ON site_cache FOR ALL USING (true) WITH CHECK (true)`;
    
    // Insert initial row
    await sql`
      INSERT INTO site_cache (cache_key, cache_status, cache_expires_at, completed_sections, total_sections)
      VALUES ('main_page_cache', 'empty', NOW() + INTERVAL '6 hours', 0, 10)
      ON CONFLICT (cache_key) DO NOTHING
    `;
    
    console.log('[Cache API] ✅ Cache table initialized successfully');
  }
}
