// Alternative: Use fetch to call Neon REST API directly
//
// NEON_API_URL / NEON_API_KEY are read from environment variables — never
// hardcode a live key in this file. Set them before running:
//   NEON_API_URL=... NEON_API_KEY=... node database/setup-neon-rest.js
const NEON_API_URL = process.env.NEON_API_URL;
const NEON_API_KEY = process.env.NEON_API_KEY;

if (!NEON_API_URL || !NEON_API_KEY) {
  throw new Error(
    'Missing NEON_API_URL or NEON_API_KEY environment variable. ' +
    'Set both before running this script — see the comment at the top of this file.'
  );
}

async function neonSQL(query) {
  const response = await fetch(`${NEON_API_URL}/rpc/exec_sql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${NEON_API_KEY}`,
      'apikey': NEON_API_KEY
    },
    body: JSON.stringify({ sql: query })
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Neon API Error: ${response.status} - ${error}`);
  }
  
  return response.json();
}

async function setupCacheTable() {
  console.log('🚀 Setting up Professional Cache System in Neon DB...\n');
  
  try {
    // Step 1: Drop existing table
    console.log('1️⃣ Dropping existing cache table (if any)...');
    await neonSQL('DROP TABLE IF EXISTS site_cache');
    console.log('   ✅ Dropped\n');
    
    // Step 2: Create the main cache table
    console.log('2️⃣ Creating site_cache table...');
    await neonSQL(`
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
    `);
    console.log('   ✅ Table created\n');
    
    // Step 3: Create indexes
    console.log('3️⃣ Creating performance indexes...');
    await neonSQL('CREATE INDEX idx_site_cache_key ON site_cache(cache_key)');
    await neonSQL('CREATE INDEX idx_site_cache_expires ON site_cache(cache_expires_at)');
    await neonSQL('CREATE INDEX idx_site_cache_status ON site_cache(cache_status)');
    console.log('   ✅ Indexes created\n');
    
    // Step 4: Enable RLS
    console.log('4️⃣ Setting up Row Level Security...');
    await neonSQL('ALTER TABLE site_cache ENABLE ROW LEVEL SECURITY');
    await neonSQL("CREATE POLICY \"Allow_public_read\" ON site_cache FOR SELECT USING (true)");
    await neonSQL("CREATE POLICY \"Allow_service_write\" ON site_cache FOR ALL USING (true) WITH CHECK (true)");
    console.log('   ✅ RLS enabled\n');
    
    // Step 5: Insert initial row
    console.log('5️⃣ Initializing cache...');
    await neonSQL(`
      INSERT INTO site_cache (cache_key, cache_status, cache_expires_at, completed_sections, total_sections)
      VALUES ('main_page_cache', 'empty', NOW() + INTERVAL '6 hours', 0, 12)
      ON CONFLICT (cache_key) DO NOTHING
    `);
    console.log('   ✅ Initialized\n');
    
    // Step 6: Verify
    console.log('6️⃣ Verifying setup...');
    const verify = await neonSQL(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'site_cache' 
      ORDER BY ordinal_position
    `);
    
    console.log(`\n📊 Created ${verify.length} columns`);
    
    const testRow = await neonSQL("SELECT * FROM site_cache WHERE cache_key = 'main_page_cache'");
    console.log(`✅ Test row exists: ${testRow.length > 0}`);
    
    console.log('\n🎉 PROFESSIONAL CACHE SYSTEM READY!\n');
    return { success: true };
    
  } catch (error) {
    console.error('❌ ERROR:', error.message);
    throw error;
  }
}

setupCacheTable()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
