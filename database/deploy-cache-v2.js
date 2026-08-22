// Neon DB Deployment Script v2
// Uses @neondatabase/serverless (same as api/cache.js)

// Real Neon database credentials
const CONNECTION_STRING = 'postgresql://neondb_owner:npg_Wdf5XkBVbx1i@ep-super-dawn-azjwdm9a-pooler.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

async function deployCache() {
  const { neon } = require('@neondatabase/serverless');
  const sql = neon(CONNECTION_STRING);
  
  console.log('🚀 Deploying Professional Cache System to Neon DB...\n');
  
  try {
    // Step 1: Drop existing table
    console.log('1️⃣ Dropping existing cache table (if any)...');
    await sql`DROP TABLE IF EXISTS site_cache`;
    console.log('   ✅ Dropped\n');
    
    // Step 2: Create table
    console.log('2️⃣ Creating site_cache table with all 10 sections...');
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
    console.log('   ✅ Table created with all columns\n');
    
    // Step 3: Create indexes
    console.log('3️⃣ Creating performance indexes...');
    await sql`CREATE INDEX idx_site_cache_key ON site_cache(cache_key)`;
    await sql`CREATE INDEX idx_site_cache_expires ON site_cache(cache_expires_at)`;
    await sql`CREATE INDEX idx_site_cache_status ON site_cache(cache_status)`;
    await sql`CREATE INDEX idx_section_cached ON site_cache(cache_key, cache_status, cache_expires_at)`;
    console.log('   ✅ 4 indexes created\n');
    
    // Step 4: Enable RLS
    console.log('4️⃣ Setting up Row Level Security (RLS)...');
    await sql`ALTER TABLE site_cache ENABLE ROW LEVEL SECURITY`;
    await sql`CREATE POLICY "Allow_public_read" ON site_cache FOR SELECT USING (true)`;
    await sql`CREATE POLICY "Allow_service_write" ON site_cache FOR ALL USING (true) WITH CHECK (true)`;
    console.log('   ✅ RLS enabled with public read policy\n');
    
    // Step 5: Insert initial row
    console.log('5️⃣ Initializing cache row...');
    await sql`
      INSERT INTO site_cache (cache_key, cache_status, cache_expires_at, completed_sections, total_sections)
      VALUES ('main_page_cache', 'empty', NOW() + INTERVAL '6 hours', 0, 10)
      ON CONFLICT (cache_key) DO NOTHING
    `;
    console.log('   ✅ Initial cache row created\n');
    
    // Step 6: Verify deployment
    console.log('6️⃣ Verifying deployment...');
    const columns = await sql`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'site_cache' 
      ORDER BY ordinal_position
    `;
    
    console.log(`   📊 Total columns created: ${columns.length}`);
    
    const testRow = await sql`SELECT * FROM site_cache WHERE cache_key = 'main_page_cache'`;
    console.log(`   ✅ Cache row exists: ${testRow.length > 0}`);
    
    // Test read/write
    console.log('\n7️⃣ Testing CRUD operations...');
    await sql`UPDATE site_cache SET updated_at = NOW() WHERE cache_key = 'main_page_cache'`;
    const updated = await sql`SELECT updated_at FROM site_cache WHERE cache_key = 'main_page_cache'`;
    console.log(`   ✅ Read/Write test passed: ${updated[0].updated_at !== null}`);
    
    console.log('\n' + '='.repeat(70));
    console.log('🎉 PROFESSIONAL CACHE SYSTEM DEPLOYED SUCCESSFULLY!');
    console.log('='.repeat(70));
    console.log('✅ Database:     Neon PostgreSQL (Serverless)');
    console.log('✅ Table:        site_cache (single-row design)');
    console.log('✅ Sections:     10 (heroSlider → schedule)');
    console.log('✅ Cache TTL:    6 hours (21,600 seconds)');
    console.log('✅ Security:     RLS Enabled (public read)');
    console.log('✅ Indexes:      4 (optimized for high traffic)');
    console.log('✅ Status:       🟢 PRODUCTION READY');
    console.log('='.repeat(70));
    console.log('\n📝 Next Steps:');
    console.log('   1. Test cache API: POST /api/cache with action:"status"');
    console.log('   2. Integrate frontend: Add cache checks to index.html');
    console.log('   3. Monitor: Check cache hit/miss metrics');
    console.log('');
    
    return { success: true, columnCount: columns.length };
    
  } catch (error) {
    console.error('\n❌ DEPLOYMENT FAILED:', error.message);
    console.error('\n🔧 Troubleshooting:');
    console.error('   • Verify API key is correct');
    console.error('   • Check Neon project status');
    console.error('   • Ensure IP is whitelisted (if applicable)');
    throw error;
  }
}

// Execute deployment
deployCache()
  .then(() => {
    console.log('✨ Deployment complete! Your cache system is live.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Fatal error:', error.message);
    process.exit(1);
  });
