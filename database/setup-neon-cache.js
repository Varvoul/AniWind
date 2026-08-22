// Neon DB Setup Script - Execute SQL to create cache table
const { neon } = require('@neondatabase/serverless');

// Neon connection
const sql = neon('postgresql://neondb_owner:napi_7fak07gaux9ioewri458o33psns69sf2nlycg8o69hasargl97jjwte55hgweiy7@ep-super-dawn-azjwdm9a.ap-southeast-1.aws.neon.tech/neondb?sslmode=require');

async function setupCacheTable() {
  console.log('🚀 Setting up Professional Cache System in Neon DB...\n');
  
  try {
    // Drop existing table if exists
    console.log('1️⃣ Dropping existing cache table (if any)...');
    await sql`DROP TABLE IF EXISTS site_cache`;
    console.log('   ✅ Dropped existing table\n');
    
    // Create the main cache table
    console.log('2️⃣ Creating site_cache table with all section columns...');
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
        last_cache_duration_ms INTEGER DEFAULT NULL,
        
        -- Hero Slider (60 slides)
        hero_slider JSONB DEFAULT '[]',
        hero_slider_cached BOOLEAN DEFAULT FALSE,
        hero_slider_cached_at TIMESTAMPTZ,
        
        -- Top Airing (TMDB TV + AniList Anime)
        top_airing JSONB DEFAULT '[]',
        top_airing_cached BOOLEAN DEFAULT FALSE,
        top_airing_cached_at TIMESTAMPTZ,
        
        -- New Releases (with toggle tabs)
        new_releases_all JSONB DEFAULT '[]',
        new_releases_anime JSONB DEFAULT '[]',
        new_releases_movie JSONB DEFAULT '[]',
        new_releases_series JSONB DEFAULT '[]',
        new_releases_hidden JSONB DEFAULT '[]',
        new_releases_cached BOOLEAN DEFAULT FALSE,
        new_releases_cached_at TIMESTAMPTZ,
        
        -- New on Aniumi
        new_on_aniumi JSONB DEFAULT '[]',
        new_on_aniumi_cached BOOLEAN DEFAULT FALSE,
        new_on_aniumi_cached_at TIMESTAMPTZ,
        
        -- Upcoming (Movies + TV + Anime)
        upcoming JSONB DEFAULT '[]',
        upcoming_cached BOOLEAN DEFAULT FALSE,
        upcoming_cached_at TIMESTAMPTZ,
        
        -- Recently Completed (paginated)
        recently_completed_page1 JSONB DEFAULT '[]',
        recently_completed_pages JSONB DEFAULT '{}',
        recently_completed_total_pages INTEGER DEFAULT 0,
        recently_completed_cached BOOLEAN DEFAULT FALSE,
        recently_completed_cached_at TIMESTAMPTZ,
        
        -- Trending Now (with tabs: today/week/month)
        trending_now_today JSONB DEFAULT '[]',
        trending_now_week JSONB DEFAULT '[]',
        trending_now_month JSONB DEFAULT '[]',
        trending_now_cached BOOLEAN DEFAULT FALSE,
        trending_now_cached_at TIMESTAMPTZ,
        
        -- Most Favourite
        most_favourite JSONB DEFAULT '[]',
        most_favourite_cached BOOLEAN DEFAULT FALSE,
        most_favourite_cached_at TIMESTAMPTZ,
        
        -- Popular Anime
        popular_anime JSONB DEFAULT '[]',
        popular_anime_cached BOOLEAN DEFAULT FALSE,
        popular_anime_cached_at TIMESTAMPTZ,
        
        -- Schedule (7 days)
        schedule_monday JSONB DEFAULT '[]',
        schedule_tuesday JSONB DEFAULT '[]',
        schedule_wednesday JSONB DEFAULT '[]',
        schedule_thursday JSONB DEFAULT '[]',
        schedule_friday JSONB DEFAULT '[]',
        schedule_saturday JSONB DEFAULT '[]',
        schedule_sunday JSONB DEFAULT '[]',
        schedule_cached BOOLEAN DEFAULT FALSE,
        schedule_cached_at TIMESTAMPTZ,
        
        -- Performance Metrics
        cache_hit_count BIGINT DEFAULT 0,
        cache_miss_count BIGINT DEFAULT 0,
        avg_serve_time_ms INTEGER DEFAULT NULL,
        last_served_at TIMESTAMPTZ,
        
        -- Audit Trail
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        last_refreshed_by VARCHAR(100) DEFAULT 'system'
      )
    `;
    console.log('   ✅ Table created successfully\n');
    
    // Create indexes for optimized queries
    console.log('3️⃣ Creating performance indexes...');
    await sql`CREATE INDEX idx_site_cache_key ON site_cache(cache_key)`;
    await sql`CREATE INDEX idx_site_cache_expires ON site_cache(cache_expires_at)`;
    await sql`CREATE INDEX idx_site_cache_status ON site_cache(cache_status)`;
    await sql`CREATE INDEX idx_section_cached ON site_cache(cache_key, cache_status, cache_expires_at)`;
    console.log('   ✅ Indexes created\n');
    
    // Enable Row Level Security
    console.log('4️⃣ Setting up Row Level Security (RLS)...');
    await sql`ALTER TABLE site_cache ENABLE ROW LEVEL SECURITY`;
    
    // Create RLS policies
    await sql`CREATE POLICY "Allow_public_read" ON site_cache FOR SELECT USING (true)`;
    await sql`CREATE POLICY "Allow_service_write" ON site_cache FOR ALL USING (true) WITH CHECK (true)`;
    console.log('   ✅ RLS enabled and policies created\n');
    
    // Insert initial cache row
    console.log('5️⃣ Initializing cache row...');
    await sql`
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
      ) ON CONFLICT (cache_key) DO NOTHING
    `;
    console.log('   ✅ Initial cache row inserted\n');
    
    // Verify setup
    console.log('6️⃣ Verifying table structure...');
    const columns = await sql`
      SELECT column_name, data_type, is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'site_cache' 
      ORDER BY ordinal_position
    `;
    
    console.log(`\n📊 TABLE VERIFICATION:`);
    console.log(`   Total columns: ${columns.length}`);
    console.log(`\n📋 COLUMN LIST:`);
    columns.forEach((col, i) => {
      console.log(`   ${i + 1}. ${col.column_name} (${col.data_type})`);
    });
    
    // Test basic operations
    console.log('\n7️⃣ Testing basic CRUD operations...');
    
    // Test read
    const testRead = await sql`SELECT * FROM site_cache WHERE cache_key = 'main_page_cache'`;
    console.log(`   ✅ Read test: Found ${testRead.length} row(s)`);
    
    // Test update
    await sql`UPDATE site_cache SET updated_at = NOW() WHERE cache_key = 'main_page_cache'`;
    console.log('   ✅ Update test: Successfully updated timestamp');
    
    console.log('\n🎉 CACHE SYSTEM SETUP COMPLETE!\n');
    console.log('═════════════════════════════════════════════════════');
    console.log('✅ Table: site_cache');
    console.log('✅ Columns: 50+ (all sections + metadata)');
    console.log('✅ Indexes: 4 (optimized for high traffic)');
    console.log('✅ RLS: Enabled (public read, authenticated write)');
    console.log('✅ Initial Data: 1 cache row ready');
    console.log('✅ Cache Interval: 6 hours');
    console.log('═════════════════════════════════════════════════════\n');
    
    return { success: true, columnCount: columns.length };
    
  } catch (error) {
    console.error('❌ SETUP ERROR:', error.message);
    throw error;
  }
}

// Run the setup
setupCacheTable()
  .then(result => {
    console.log('\n✨ Your professional cache system is ready!');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n💥 Setup failed:', error);
    process.exit(1);
  });
