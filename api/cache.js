// ═══════════════════════════════════════════════════════════════════
// PROFESSIONAL CACHE API ENDPOINT
// Handles: Read/Write/Validate cache for all page sections
// Database: Neon PostgreSQL
// Cache Interval: 6 hours (global for all users)
// ═══════════════════════════════════════════════════════════════════

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { action, section, data, page } = req.body || {};
    
    console.log(`[Cache API] 📥 Request: ${action} | Section: ${section || 'all'} | Method: ${req.method}`);
    
    switch (action) {
      case 'status':
        return await getCacheStatus(res);
        
      case 'read':
        return await readCache(section, res);
        
      case 'write':
        return await writeCache(section, data, res);
        
      case 'write-batch':
        return await writeBatchCache(data, res);
        
      case 'validate':
        return await validateCache(res);
        
      case 'reset':
        return await resetCache(res);
        
      case 'init':
        return await initializeCache(res);
        
      default:
        return res.status(400).json({ 
          error: 'Invalid action', 
          validActions: ['status', 'read', 'write', 'write-batch', 'validate', 'reset', 'init']
        });
    }
    
  } catch (error) {
    console.error('[Cache API] ❌ Error:', error.message);
    return res.status(500).json({ error: 'Internal server error', message: error.message });
  }
}

// ═══════════════════════════════════════════════════════════════════
// DATABASE CONNECTION
// Uses Neon Serverless Driver for optimal performance
// ═══════════════════════════════════════════════════════════════════

async function getDB() {
  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(process.env.NEON_DATABASE_URL || 'postgresql://neondb_owner:npg_Wdf5XkBVbx1i@ep-super-dawn-azjwdm9a-pooler.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require');
  return sql;
}

// ═══════════════════════════════════════════════════════════════════
// CACHE OPERATIONS
// ═══════════════════════════════════════════════════════════════════

/**
 * Get overall cache status and metadata
 * Called on every page load to determine if cache is valid
 */
async function getCacheStatus(res) {
  const sql = await getDB();
  
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
    await initializeTable(sql);
    return getCacheStatus(res); // Retry after init
  }
  
  const cache = result[0];
  
  console.log(`[Cache API] 📊 Status: ${cache.cache_status} | Valid: ${cache.is_valid} | Sections: ${cache.completed_sections}/${cache.total_sections}`);
  
  return res.status(200).json({
    success: true,
    data: {
      status: cache.cache_status,
      isValid: cache.is_valid,
      expiresAt: cache.cache_expires_at,
      updatedAt: cache.cache_updated_at,
      version: cache.cache_version,
      sections: {
        completed: cache.completed_sections,
        total: cache.total_sections,
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
  });
}

/**
 * Read cached data for specific section(s)
 * Supports: single section, multiple sections, or 'all'
 * Optimized: Only returns requested data to minimize DB load
 */
async function readCache(section, res) {
  const sql = await getDB();
  const startTime = Date.now();
  
  // Update metrics
  await sql`UPDATE site_cache SET cache_hit_count = cache_hit_count + 1, last_served_at = NOW() WHERE cache_key = 'main_page_cache'`;
  
  let query;
  const sections = section === 'all' ? null : (Array.isArray(section) ? section : [section]);
  
  if (!sections || sections.includes('all')) {
    // Return ALL sections (full page load - use sparingly)
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
    // Return ONLY requested sections (optimized for scroll-based loading)
    const columns = sections.map(s => sectionToColumn(s)).filter(Boolean);
    
    if (columns.length === 0) {
      return res.status(400).json({ error: 'Invalid section name' });
    }
    
    query = sql`SELECT ${sql.unsafe(columns.join(', '))}, cache_status, cache_expires_at FROM site_cache WHERE cache_key = 'main_page_cache'`;
  }
  
  const result = await query;
  const duration = Date.now() - startTime;
  
  if (!result || result.length === 0) {
    return res.status(404).json({ error: 'Cache not found' });
  }
  
  const cacheData = result[0];
  
  console.log(`[Cache API] ✅ Read ${sections || 'all'} in ${duration}ms`);
  
  return res.status(200).json({
    success: true,
    data: transformCacheData(cacheData, sections),
    meta: {
      serveTimeMs: duration,
      servedAt: new Date().toISOString(),
      section: section || 'all'
    }
  });
}

/**
 * Write/update cache for a single section
 */
async function writeCache(section, data, res) {
  if (!section || !data) {
    return res.status(400).json({ error: 'Section and data are required' });
  }
  
  const sql = await getDB();
  const column = sectionToColumn(section);
  
  if (!column) {
    return res.status(400).json({ error: `Invalid section: ${section}` });
  }
  
  const cachedAtCol = column + '_cached_at';
  const cachedFlagCol = column + '_cached';
  
  await sql.begin(async (tx) => {
    // Update the section data
    await tx.unsafe(`
      UPDATE site_cache 
      SET ${column} = $1, ${cachedFlagCol} = true, ${cachedAtCol} = NOW(), updated_at = NOW()
      WHERE cache_key = 'main_page_cache'
    `, [JSON.stringify(data)]);
    
    // Recalculate overall cache status
    await tx`
      UPDATE site_cache SET
        cache_status = CASE
          WHEN (
            (CASE WHEN hero_slider_cached THEN 1 ELSE 0 END) +
            (CASE WHEN top_airing_cached THEN 1 ELSE 0 END) +
            (CASE WHEN new_releases_cached THEN 1 ELSE 0 END) +
            (CASE WHEN new_on_aniumi_cached THEN 1 ELSE 0 END) +
            (CASE WHEN upcoming_cached THEN 1 ELSE 0 END) +
            (CASE WHEN recently_completed_cached THEN 1 ELSE 0 END) +
            (CASE WHEN trending_now_cached THEN 1 ELSE 0 END) +
            (CASE WHEN most_favourite_cached THEN 1 ELSE 0 END) +
            (CASE WHEN popular_anime_cached THEN 1 ELSE 0 END) +
            (CASE WHEN schedule_cached THEN 1 ELSE 0 END)
          ) >= total_sections THEN 'complete'
          WHEN (
            (CASE WHEN hero_slider_cached THEN 1 ELSE 0 END) +
            (CASE WHEN top_airing_cached THEN 1 ELSE 0 END) +
            (CASE WHEN new_releases_cached THEN 1 ELSE 0 END) +
            (CASE WHEN new_on_aniumi_cached THEN 1 ELSE 0 END) +
            (CASE WHEN upcoming_cached THEN 1 ELSE 0 END) +
            (CASE WHEN recently_completed_cached THEN 1 ELSE 0 END) +
            (CASE WHEN trending_now_cached THEN 1 ELSE 0 END) +
            (CASE WHEN most_favourite_cached THEN 1 ELSE 0 END) +
            (CASE WHEN popular_anime_cached THEN 1 ELSE 0 END) +
            (CASE WHEN schedule_cached THEN 1 ELSE 0 END)
          ) > 0 THEN 'partial'
          ELSE 'empty'
        END,
        completed_sections = (
          (CASE WHEN hero_slider_cached THEN 1 ELSE 0 END) +
          (CASE WHEN top_airing_cached THEN 1 ELSE 0 END) +
          (CASE WHEN new_releases_cached THEN 1 ELSE 0 END) +
          (CASE WHEN new_on_aniumi_cached THEN 1 ELSE 0 END) +
          (CASE WHEN upcoming_cached THEN 1 ELSE 0 END) +
          (CASE WHEN recently_completed_cached THEN 1 ELSE 0 END) +
          (CASE WHEN trending_now_cached THEN 1 ELSE 0 END) +
          (CASE WHEN most_favourite_cached THEN 1 ELSE 0 END) +
          (CASE WHEN popular_anime_cached THEN 1 ELSE 0 END) +
          (CASE WHEN schedule_cached THEN 1 ELSE 0 END)
        )
      WHERE cache_key = 'main_page_cache'
    `;
  });
  
  console.log(`[Cache API] 💾 Written: ${section}`);
  
  return res.status(200).json({
    success: true,
    message: `Cache updated for ${section}`,
    section
  });
}

/**
 * Write multiple sections at once (batch operation)
 * More efficient than individual writes for full page refresh
 */
async function writeBatchCache(data, res) {
  if (!data || typeof data !== 'object') {
    return res.status(400).json({ error: 'Data object required with section keys' });
  }
  
  const sql = await getDB();
  const sections = Object.keys(data);
  
  console.log(`[Cache API] 📦 Batch write: ${sections.join(', ')}`);
  
  await sql.begin(async (tx) => {
    for (const [section, sectionData] of Object.entries(data)) {
      const column = sectionToColumn(section);
      if (!column) continue;
      
      const cachedAtCol = column + '_cached_at';
      const cachedFlagCol = column + '_cached';
      
      await tx.unsafe(`
        UPDATE site_cache 
        SET ${column} = $1, ${cachedFlagCol} = true, ${cachedAtCol} = NOW(), updated_at = NOW()
        WHERE cache_key = 'main_page_cache'
      `, [JSON.stringify(sectionData)]);
    }
    
    // Recalculate status after all updates
    await tx`
      UPDATE site_cache SET
        cache_status = CASE
          WHEN completed_sections >= total_sections THEN 'complete'
          WHEN completed_sections > 0 THEN 'partial'
          ELSE 'empty'
        END
      WHERE cache_key = 'main_page_cache'
    `;
  });
  
  return res.status(200).json({
    success: true,
    message: `Updated ${sections.length} sections`,
    sections
  });
}

/**
 * Validate cache and check what needs refreshing
 */
async function validateCache(res) {
  const sql = await getDB();
  
  const result = await sql`
    SELECT 
      *,
      CASE WHEN cache_expires_at > NOW() THEN true ELSE false END as is_not_expired,
      EXTRACT(EPOCH FROM (cache_expires_at - NOW())) as seconds_remaining
    FROM site_cache 
    WHERE cache_key = 'main_page_cache'
  `;
  
  if (!result || result.length === 0) {
    return res.json({ valid: false, needsRefresh: true, reason: 'not_initialized' });
  }
  
  const cache = result[0];
  const needsRefresh = !cache.is_not_expired || cache.cache_status !== 'complete';
  
  // Identify missing/incomplete sections
  const missingSections = [];
  const sectionMap = {
    'hero_slider': 'heroSlider',
    'top_airing': 'topAiring',
    'new_releases': 'newReleases',
    'new_on_aniumi': 'newOnAniumi',
    'upcoming': 'upcoming',
    'recently_completed': 'recentlyCompleted',
    'trending_now': 'trendingNow',
    'most_favourite': 'mostFavourite',
    'popular_anime': 'popularAnime',
    'schedule': 'schedule'
  };
  
  for (const [col, name] of Object.entries(sectionMap)) {
    const isCached = cache[col + '_cached'];
    if (!isCached) {
      missingSections.push(name);
    }
  }
  
  return res.json({
    valid: !needsRefresh,
    needsRefresh,
    reason: needsRefresh ? (cache.is_not_expired ? 'incomplete' : 'expired') : 'valid',
    currentStatus: cache.cache_status,
    secondsRemaining: Math.max(0, Math.floor(cache.seconds_remaining)),
    missingSections,
    completedSections: cache.completed_sections,
    totalSections: cache.total_sections
  });
}

/**
 * Reset cache for fresh refresh cycle
 */
async function resetCache(res) {
  const sql = await getDB();
  
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
      
      hero_slider = '[]'::jsonb,
      top_airing = '[]'::jsonb,
      new_releases_all = '[]'::jsonb,
      new_releases_anime = '[]'::jsonb,
      new_releases_movie = '[]'::jsonb,
      new_releases_series = '[]'::jsonb,
      new_releases_hidden = '[]'::jsonb,
      new_on_aniumi = '[]'::jsonb,
      upcoming = '[]'::jsonb,
      recently_completed_page1 = '[]'::jsonb,
      recently_completed_pages = '{}'::jsonb,
      trending_now_today = '[]'::jsonb,
      trending_now_week = '[]'::jsonb,
      trending_now_month = '[]'::jsonb,
      most_favourite = '[]'::jsonb,
      popular_anime = '[]'::jsonb,
      schedule_monday = '[]'::jsonb,
      schedule_tuesday = '[]'::jsonb,
      schedule_wednesday = '[]'::jsonb,
      schedule_thursday = '[]'::jsonb,
      schedule_friday = '[]'::jsonb,
      schedule_saturday = '[]'::jsonb,
      schedule_sunday = '[]'::jsonb,
      
      updated_at = NOW()
    WHERE cache_key = 'main_page_cache'
  `;
  
  console.log('[Cache API] 🔄 Cache reset for refresh');
  
  return res.json({ success: true, message: 'Cache reset successfully' });
}

/**
 * Initialize cache table if not exists
 */
async function initializeCache(res) {
  const sql = await getDB();
  
  try {
    await initializeTable(sql);
    return res.json({ success: true, message: 'Cache initialized' });
  } catch (error) {
    return res.status(500).json({ error: 'Initialization failed', message: error.message });
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
    'newReleases': 'new_releases_all',  // Default to 'all' tab
    'newReleasesAll': 'new_releases_all',
    'newReleasesAnime': 'new_releases_anime',
    'newReleasesMovie': 'new_releases_movie',
    'newReleasesSeries': 'new_releases_series',
    'newReleasesHidden': 'new_releases_hidden',
    'newOnAniumi': 'new_on_aniumi',
    'upcoming': 'upcoming',
    'recentlyCompleted': 'recently_completed_page1',
    'trendingNow': 'trending_now_today',  // Default to 'today' tab
    'trendingNowToday': 'trending_now_today',
    'trendingNowWeek': 'trending_now_week',
    'trendingNowMonth': 'trending_now_month',
    'mostFavourite': 'most_favourite',
    'popularAnime': 'popular_anime',
    'schedule': 'schedule_monday'  // Default to Monday, should specify day
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
      tuesday: schedule_tuesday,
      wednesday: schedule_wednesday,
      thursday: schedule_thursday,
      friday: schedule_friday,
      saturday: schedule_saturday,
      sunday: schedule_sunday
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
        total_sections INTEGER NOT NULL DEFAULT 12,
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
    await sql`CREATE POLICY "Allow_public_read" ON site_cache FOR SELECT USING (true)`;
    await sql`CREATE POLICY "Allow_service_write" ON site_cache FOR ALL USING (true) WITH CHECK (true)`;
    
    // Insert initial row
    await sql`
      INSERT INTO site_cache (cache_key, cache_status, cache_expires_at, completed_sections, total_sections)
      VALUES ('main_page_cache', 'empty', NOW() + INTERVAL '6 hours', 0, 12)
      ON CONFLICT (cache_key) DO NOTHING
    `;
    
    console.log('[Cache API] ✅ Cache table initialized');
  }
}
