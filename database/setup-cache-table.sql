-- ═══════════════════════════════════════════════════════════════════
-- PROFESSIONAL CACHE SYSTEM FOR ANIME STREAMING SITE
-- Database: Neon PostgreSQL
-- Purpose: Interval-based (6-hour) global cache for all page sections
-- ═══════════════════════════════════════════════════════════════════

-- Drop existing cache table if it exists (for fresh start)
DROP TABLE IF EXISTS site_cache;

-- ═══════════════════════════════════════════════════════════════════
-- MAIN CACHE TABLE
-- Single row design: One row stores ALL section caches
-- Updated every 6 hours, serves millions of users from DB
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE site_cache (
  -- Primary identifier (single row system)
  id SERIAL PRIMARY KEY,
  
  -- ═══ CACHE METADATA ═══
  cache_key VARCHAR(50) UNIQUE NOT NULL DEFAULT 'main_page_cache',
  cache_status VARCHAR(20) NOT NULL DEFAULT 'empty',  -- 'complete', 'partial', 'expired', 'empty'
  cache_updated_at TIMESTAMPTZ DEFAULT NOW(),
  cache_expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '6 hours',
  cache_version INTEGER NOT NULL DEFAULT 1,
  total_sections INTEGER NOT NULL DEFAULT 12,  -- Total sections to cache
  completed_sections INTEGER NOT NULL DEFAULT 0,  -- How many are actually cached
  last_cache_duration_ms INTEGER DEFAULT NULL,  -- How long last full cache took
  
  -- ═══ SECTION: HERO SLIDER (60 slides) ═══
  -- Contains: TMDB trending movies + popular anime + top TV shows
  hero_slider JSONB DEFAULT '[]',
  hero_slider_cached BOOLEAN DEFAULT FALSE,
  hero_slider_cached_at TIMESTAMPTZ,
  
  -- ═══ SECTION: TOP AIRING (TMDB TV + AniList Anime) ═══
  -- Contains: Currently airing anime + popular TV shows
  top_airing JSONB DEFAULT '[]',
  top_airing_cached BOOLEAN DEFAULT FALSE,
  top_airing_cached_at TIMESTAMPTZ,
  
  -- ═══ SECTION: NEW RELEASES (with toggle tabs) ═══
  -- Tabs: "All", "Anime", "Movie", "Series", "Hidden"
  -- Each tab contains its own filtered dataset
  new_releases_all JSONB DEFAULT '[]',        -- All content mixed
  new_releases_anime JSONB DEFAULT '[]',      -- Anime only tab
  new_releases_movie JSONB DEFAULT '[]',      -- Movies only tab
  new_releases_series JSONB DEFAULT '[]',     -- Series/TV only tab
  new_releases_hidden JSONB DEFAULT '[]',     -- Hidden/gem content
  new_releases_cached BOOLEAN DEFAULT FALSE,
  new_releases_cached_at TIMESTAMPTZ,
  
  -- ═══ SECTION: NEW ON ANIUMI ═══
  -- Contains: Latest additions to the platform
  new_on_aniumi JSONB DEFAULT '[]',
  new_on_aniumi_cached BOOLEAN DEFAULT FALSE,
  new_on_aniumi_cached_at TIMESTAMPTZ,
  
  -- ═══ SECTION: UPCOMING (Movies + TV + Anime) ═══
  -- Contains: Future releases across all formats
  upcoming JSONB DEFAULT '[]',
  upcoming_cached BOOLEAN DEFAULT FALSE,
  upcoming_cached_at TIMESTAMPTZ,
  
  -- ═══ SECTION: RECENTLY COMPLETED (paginated) ═══
  -- Page 1 is always cached, other pages cached on demand
  recently_completed_page1 JSONB DEFAULT '[]',
  recently_completed_pages JSONB DEFAULT '{}',  -- {"2": [...], "3": [...]}
  recently_completed_total_pages INTEGER DEFAULT 0,
  recently_completed_cached BOOLEAN DEFAULT FALSE,
  recently_completed_cached_at TIMESTAMPTZ,
  
  -- ═══ SECTION: TRENDING NOW (with toggle tabs) ═══
  -- Tabs: Today, This Week, This Month
  trending_now_today JSONB DEFAULT '[]',
  trending_now_week JSONB DEFAULT '[]',
  trending_now_month JSONB DEFAULT '[]',
  trending_now_cached BOOLEAN DEFAULT FALSE,
  trending_now_cached_at TIMESTAMPTZ,
  
  -- ═══ SECTION: MOST FAVOURITE ═══
  -- Contains: User-favourite content
  most_favourite JSONB DEFAULT '[]',
  most_favourite_cached BOOLEAN DEFAULT FALSE,
  most_favourite_cached_at TIMESTAMPTZ,
  
  -- ═══ SECTION: POPULAR ANIME ═══
  -- Contains: All-time popular anime from AniList
  popular_anime JSONB DEFAULT '[]',
  popular_anime_cached BOOLEAN DEFAULT FALSE,
  popular_anime_cached_at TIMESTAMPTZ,
  
  -- ═══ SECTION: SCHEDULE (7 days) ═══
  -- Each day contains airing schedule for that day
  schedule_monday JSONB DEFAULT '[]',
  schedule_tuesday JSONB DEFAULT '[]',
  schedule_wednesday JSONB DEFAULT '[]',
  schedule_thursday JSONB DEFAULT '[]',
  schedule_friday JSONB DEFAULT '[]',
  schedule_saturday JSONB DEFAULT '[]',
  schedule_sunday JSONB DEFAULT '[]',
  schedule_cached BOOLEAN DEFAULT FALSE,
  schedule_cached_at TIMESTAMPTZ,
  
  -- ═══ PERFORMANCE METRICS ═══
  cache_hit_count BIGINT DEFAULT 0,           -- Times served from cache
  cache_miss_count BIGINT DEFAULT 0,          -- Times needed refresh
  avg_serve_time_ms INTEGER DEFAULT NULL,     -- Average DB serve time
  last_served_at TIMESTAMPTZ,                 -- Last time data was served
  
  -- ═══ AUDIT TRAIL ═══
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_refreshed_by VARCHAR(100) DEFAULT 'system'  -- IP or 'system'
);

-- ═══════════════════════════════════════════════════════════════════
-- INDEXES FOR OPTIMIZED QUERIES
-- Critical for serving millions of users efficiently
-- ═══════════════════════════════════════════════════════════════════

-- Primary lookup index (used on every page load)
CREATE INDEX idx_site_cache_key ON site_cache(cache_key);

-- Expiration check index (for cache validation)
CREATE INDEX idx_site_cache_expires ON site_cache(cache_expires_at);

-- Status index (for finding partial/expired caches)
CREATE INDEX idx_site_cache_status ON site_cache(cache_status);

-- Composite index for section-specific queries
CREATE INDEX idx_section_cached ON site_cache(cache_key, cache_status, cache_expires_at);

-- ═══════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY (RLS)
-- Only allow frontend application to access this table
-- ═══════════════════════════════════════════════════════════════════

-- Enable RLS on the table
ALTER TABLE site_cache ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Allow anyone to READ cache (public data)
CREATE POLICY "Allow_public_read" ON site_cache
  FOR SELECT USING (true);

-- RLS Policy: Allow service role to WRITE (via API key authentication)
CREATE POLICY "Allow_service_write" ON site_cache
  FOR ALL USING (true)
  WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════
-- INITIALIZATION: Insert the single cache row
-- This row will be updated, never duplicated
-- ═══════════════════════════════════════════════════════════════════

INSERT INTO site_cache (
  cache_key, 
  cache_status, 
  cache_expires_at,
  completed_sections,
  total_sections
) VALUES (
  'main_page_cache',
  'empty',
  NOW() + INTERVAL '6 hours',
  0,
  12
) ON CONFLICT (cache_key) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════
-- HELPER FUNCTIONS FOR CACHE MANAGEMENT
-- ═══════════════════════════════════════════════════════════════════

-- Function to check if cache is valid (not expired)
CREATE OR REPLACE FUNCTION is_cache_valid()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM site_cache 
    WHERE cache_key = 'main_page_cache' 
    AND cache_expires_at > NOW()
    AND cache_status = 'complete'
  );
END;
$$ LANGUAGE plpgsql;

-- Function to get cache status with details
CREATE OR REPLACE FUNCTION get_cache_status()
RETURNS JSON AS $$
DECLARE
  cache_rec RECORD;
  result JSON;
BEGIN
  SELECT * INTO cache_rec FROM site_cache WHERE cache_key = 'main_page_cache';
  
  IF cache_rec IS NULL THEN
    RETURN json_build_object('error', 'Cache not initialized');
  END IF;
  
  result := json_build_object(
    'status', cache_rec.cache_status,
    'expires_at', cache_rec.cache_expires_at,
    'updated_at', cache_rec.cache_updated_at,
    'completed_sections', cache_rec.completed_sections,
    'total_sections', cache_rec.total_sections,
    'is_valid', (cache_rec.cache_expires_at > NOW() AND cache_rec.cache_status = 'complete'),
    'version', cache_rec.cache_version,
    'hit_count', cache_rec.cache_hit_count,
    'miss_count', cache_rec.cache_miss_count
  );
  
  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Function to update cache metrics on serve
CREATE OR REPLACE FUNCTION increment_cache_hit()
RETURNS VOID AS $$
BEGIN
  UPDATE site_cache 
  SET 
    cache_hit_count = cache_hit_count + 1,
    last_served_at = NOW()
  WHERE cache_key = 'main_page_cache';
END;
$$ LANGUAGE plpgsql;

-- Function to recalculate cache status after section update
CREATE OR REPLACE FUNCTION recalculate_cache_status()
RETURNS TEXT AS $$
DECLARE
  completed INT;
  total INT;
  status TEXT;
BEGIN
  -- Count how many sections are cached
  SELECT 
    (CASE WHEN hero_slider_cached THEN 1 ELSE 0 END +
     CASE WHEN top_airing_cached THEN 1 ELSE 0 END +
     CASE WHEN new_releases_cached THEN 1 ELSE 0 END +
     CASE WHEN new_on_aniumi_cached THEN 1 ELSE 0 END +
     CASE WHEN upcoming_cached THEN 1 ELSE 0 END +
     CASE WHEN recently_completed_cached THEN 1 ELSE 0 END +
     CASE WHEN trending_now_cached THEN 1 ELSE 0 END +
     CASE WHEN most_favourite_cached THEN 1 ELSE 0 END +
     CASE WHEN popular_anime_cached THEN 1 ELSE 0 END +
     CASE WHEN schedule_cached THEN 1 ELSE 0 END),
    total_sections
  INTO completed, total
  FROM site_cache WHERE cache_key = 'main_page_cache';
  
  -- Determine status
  IF completed >= total THEN
    status := 'complete';
  ELSIF completed > 0 THEN
    status := 'partial';
  ELSE
    status := 'empty';
  END IF;
  
  -- Update the record
  UPDATE site_cache 
  SET 
    cache_status = status,
    completed_sections = completed,
    updated_at = NOW()
  WHERE cache_key = 'main_page_cache';
  
  RETURN status;
END;
$$ LANGUAGE plpgsql;

-- Function to reset cache for refresh (keeps structure, clears data)
CREATE OR REPLACE FUNCTION reset_cache_for_refresh()
RETURNS VOID AS $$
BEGIN
  UPDATE site_cache SET
    cache_status = 'expired',
    cache_updated_at = NOW(),
    cache_expires_at = NOW() + INTERVAL '6 hours',
    cache_version = cache_version + 1,
    cache_miss_count = cache_miss_count + 1,
    completed_sections = 0,
    
    -- Reset all section flags
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
    
    -- Clear all data (set to empty arrays/objects)
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
  WHERE cache_key = 'main_page_cache';
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════════════
-- VERIFICATION: Show created table structure
-- ═══════════════════════════════════════════════════════════════════

-- Comment the table for documentation
COMMENT ON TABLE site_cache IS 'Professional interval-based cache system for main page. Stores all section data with 6-hour expiry. Single row design for optimal performance.';

COMMENT ON COLUMN site_cache.cache_status IS 'Cache completeness: complete=all sections cached, partial=some sections, empty=no data, expired=needs refresh';
COMMENT ON COLUMN site_cache.hero_slider IS 'Hero slider data: 60 slides (movies + anime + TV)';
COMMENT ON COLUMN site_cache.new_releases_all IS 'New Releases "All" tab data';

-- Final verification query
SELECT 
  column_name, 
  data_type, 
  is_nullable,
  column_default
FROM information_schema.columns 
WHERE table_name = 'site_cache'
ORDER BY ordinal_position;
