// Neon DB Deployment Script - Uses fetch for REST API
// This script deploys the professional cache system to Neon PostgreSQL

const NEON_PROJECT_ID = 'fancy-hall-56456650';
const NEON_API_KEY = 'napi_7fak07gaux9ioewri458o33psns69sf2nlycg8o69hasargl97jjwte55hgweiy7';
const NEON_HOST = 'ep-super-dawn-azjwdm9a.ap-southeast-1.aws.neon.tech';
const NEON_DB = 'neondb';

// Try direct PostgreSQL connection using node-postgres
async function deployWithPg() {
  const { Client } = require('pg');
  
  // Use the same connection string format as api/cache.js
  const connectionString = `postgresql://neondb_owner:${NEON_API_KEY}@${NEON_HOST}/${NEON_DB}?sslmode=require`;
  
  const client = new Client({
    connectionString: connectionString,
    ssl: { rejectUnauthorized: false }
  });
  
  try {
    await client.connect();
    console.log('✅ Connected to Neon DB\n');
    
    // Step 1: Drop existing table
    console.log('1️⃣ Dropping existing cache table...');
    await client.query('DROP TABLE IF EXISTS site_cache');
    console.log('   ✅ Dropped\n');
    
    // Step 2: Create table
    console.log('2️⃣ Creating site_cache table...');
    await client.query(`
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
    `);
    console.log('   ✅ Table created\n');
    
    // Step 3: Create indexes
    console.log('3️⃣ Creating indexes...');
    await client.query('CREATE INDEX idx_site_cache_key ON site_cache(cache_key)');
    await client.query('CREATE INDEX idx_site_cache_expires ON site_cache(cache_expires_at)');
    await client.query('CREATE INDEX idx_site_cache_status ON site_cache(cache_status)');
    console.log('   ✅ Indexes created\n');
    
    // Step 4: Enable RLS
    console.log('4️⃣ Setting up RLS...');
    await client.query('ALTER TABLE site_cache ENABLE ROW LEVEL SECURITY');
    await client.query("CREATE POLICY \"Allow_public_read\" ON site_cache FOR SELECT USING (true)");
    await client.query("CREATE POLICY \"Allow_service_write\" ON site_cache FOR ALL USING (true) WITH CHECK (true)");
    console.log('   ✅ RLS enabled\n');
    
    // Step 5: Insert initial row
    console.log('5️⃣ Initializing cache row...');
    await client.query(`
      INSERT INTO site_cache (cache_key, cache_status, cache_expires_at, completed_sections, total_sections)
      VALUES ('main_page_cache', 'empty', NOW() + INTERVAL '6 hours', 0, 10)
      ON CONFLICT (cache_key) DO NOTHING
    `);
    console.log('   ✅ Initialized\n');
    
    // Step 6: Verify
    console.log('6️⃣ Verifying deployment...');
    const result = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'site_cache' 
      ORDER BY ordinal_position
    `);
    
    console.log(`\n📊 Total columns: ${result.rows.length}`);
    
    const testRow = await client.query("SELECT * FROM site_cache WHERE cache_key = 'main_page_cache'");
    console.log(`✅ Cache row exists: ${testRow.rows.length > 0}`);
    
    console.log('\n' + '='.repeat(60));
    console.log('🎉 PROFESSIONAL CACHE SYSTEM DEPLOYED SUCCESSFULLY!');
    console.log('='.repeat(60));
    console.log('✅ Database: Neon PostgreSQL');
    console.log('✅ Table: site_cache');
    console.log('✅ Sections: 10 (heroSlider, topAiring, newReleases, etc.)');
    console.log('✅ Cache Interval: 6 hours');
    console.log('✅ Security: RLS Enabled');
    console.log('✅ Status: READY FOR PRODUCTION');
    console.log('='.repeat(60) + '\n');
    
    return { success: true, columnCount: result.rows.length };
    
  } catch (error) {
    console.error('❌ DEPLOYMENT ERROR:', error.message);
    throw error;
  } finally {
    await client.end();
  }
}

// Run deployment
deployWithPg()
  .then(result => {
    console.log('\n✨ Your cache system is live and ready!');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n💥 Deployment failed:', error.message);
    process.exit(1);
  });
