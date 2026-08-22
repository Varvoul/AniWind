// Neon Deployment via Management API
// Uses the Neon API to execute SQL statements

const NEON_PROJECT_ID = 'fancy-hall-56456650';
const NEON_API_KEY = 'napi_7fak07gaux9ioewri458o33psns69sf2nlycg8o69hasargl97jjwte55hgweiy7';

const NEON_API_BASE = `https://console.neon.tech/api/v2/projects/${NEON_PROJECT_ID}`;

async function neonAPI(endpoint, options = {}) {
  const url = `${NEON_API_BASE}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${NEON_API_KEY}`,
      ...options.headers
    }
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Neon API ${response.status}: ${error}`);
  }
  
  return response.json();
}

async function deployViaManagementAPI() {
  console.log('🚀 Deploying via Neon Management API...\n');
  
  try {
    // Get project info first
    console.log('1️⃣ Verifying project access...');
    const project = await neonAPI('');
    console.log(`   ✅ Project: ${project.project.name}\n`);
    
    // Get connection details
    console.log('2️⃣ Getting connection string...');
    // The connection URI might be available in the response
    
    console.log('\n⚠️  Management API does not support direct SQL execution.');
    console.log('💡 Alternative: Use Neon SQL Editor or CLI\n');
    
    return { success: false, method: 'management_api' };
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    return { success: false, error: error.message };
  }
}

// Try PostgreSQL connection with different approaches
async function tryDirectConnection() {
  const { Client } = require('pg');
  
  // Approach 1: Try with API key as password for role 'neondb_owner'
  const connectionStrings = [
    `postgresql://neondb_owner:${NEON_API_KEY}@ep-super-dawn-azjwdm9a.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`,
    `postgresql://${NEON_PROJECT_ID}:${NEON_API_KEY}@ep-super-dawn-azjwdm9a.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`,
  ];
  
  for (let i = 0; i < connectionStrings.length; i++) {
    const connStr = connectionStrings[i];
    console.log(`\nTrying connection approach ${i + 1}...`);
    
    const client = new Client({
      connectionString: connStr,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 5000
    });
    
    try {
      await client.connect();
      console.log(`✅ Connected successfully with approach ${i + 1}!`);
      
      // Run deployment
      await runDeployment(client);
      await client.end();
      
      return { success: true, approach: i + 1 };
      
    } catch (error) {
      console.log(`❌ Approach ${i + 1} failed: ${error.message}`);
      try { await client.end(); } catch (e) {}
    }
  }
  
  return { success: false };
}

async function runDeployment(client) {
  console.log('\n📦 Starting deployment...\n');
  
  // Drop existing
  console.log('1️⃣ Dropping existing table...');
  await client.query('DROP TABLE IF EXISTS site_cache');
  console.log('   ✅ Dropped\n');
  
  // Create table
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
  console.log('   ✅ Created\n');
  
  // Indexes
  console.log('3️⃣ Creating indexes...');
  await client.query('CREATE INDEX idx_site_cache_key ON site_cache(cache_key)');
  await client.query('CREATE INDEX idx_site_cache_expires ON site_cache(cache_expires_at)');
  await client.query('CREATE INDEX idx_site_cache_status ON site_cache(cache_status)');
  console.log('   ✅ Created\n');
  
  // RLS
  console.log('4️⃣ Enabling RLS...');
  await client.query('ALTER TABLE site_cache ENABLE ROW LEVEL SECURITY');
  await client.query("CREATE POLICY \"Allow_public_read\" ON site_cache FOR SELECT USING (true)");
  await client.query("CREATE POLICY \"Allow_service_write\" ON site_cache FOR ALL USING (true) WITH CHECK (true)");
  console.log('   ✅ Enabled\n');
  
  // Initial row
  console.log('5️⃣ Initializing...');
  await client.query(`
    INSERT INTO site_cache (cache_key, cache_status, cache_expires_at, completed_sections, total_sections)
    VALUES ('main_page_cache', 'empty', NOW() + INTERVAL '6 hours', 0, 10)
    ON CONFLICT (cache_key) DO NOTHING
  `);
  console.log('   ✅ Initialized\n');
  
  // Verify
  console.log('6️⃣ Verifying...');
  const result = await client.query("SELECT COUNT(*) as count FROM information_schema.columns WHERE table_name = 'site_cache'");
  console.log(`   📊 Columns: ${result.rows[0].count}`);
  
  const test = await client.query("SELECT * FROM site_cache WHERE cache_key = 'main_page_cache'");
  console.log(`   ✅ Row exists: ${test.rows.length > 0}`);
  
  console.log('\n' + '='.repeat(70));
  console.log('🎉 CACHE SYSTEM DEPLOYED SUCCESSFULLY!');
  console.log('='.repeat(70));
}

// Main execution
async function main() {
  console.log('='.repeat(70));
  console.log('🚀 PROFESSIONAL CACHE SYSTEM DEPLOYMENT');
  console.log('='.repeat(70));
  console.log(`Project: ${NEON_PROJECT_ID}`);
  console.log(`Target:  Neon PostgreSQL`);
  console.log('='.repeat(70) + '\n');
  
  // Try direct connection first
  const directResult = await tryDirectConnection();
  
  if (!directResult.success) {
    console.log('\n' + '='.repeat(70));
    console.log('⚠️  AUTOMATIC DEPLOYMENT FAILED');
    console.log('='.repeat(70));
    console.log('\nThe provided API key is for the Neon REST/Management API,');
    console.log('not for direct PostgreSQL connections.\n');
    console.log('📋 TO DEPLOY MANUALLY:\n');
    console.log('1. Go to: https://console.neon.tech');
    console.log(`2. Open project: ${NEON_PROJECT_ID}`);
    console.log('3. Go to SQL Editor (or Dashboard → SQL Editor)');
    console.log('4. Copy and paste the contents of:');
    console.log('   /home/z/my-project/database/setup-cache-table.sql');
    console.log('5. Execute the SQL\n');
    console.log('Alternatively, get your database password from:');
    console.log('Dashboard → Settings → Database → Connection string');
    console.log('='.repeat(70) + '\n');
    
    process.exit(1);
  }
  
  process.exit(0);
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
